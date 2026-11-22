import {
  parseResplitProposalBlock,
  ASSISTANT_SYSTEM_PROMPT,
  ASSISTANT_BOOK_HEAD_CHARS,
  ASSISTANT_CONTEXT_CHAR_LIMIT,
  resolveAssistantScope,
  type AssistantScope,
} from '@/domain/assistant';
import { toChapterDrafts } from '@/domain/split';
import type {
  AssistantMessageRecord,
  AssistantRepository,
  LibraryRepository,
  LlmGateway,
  SourceFileStore,
  SplitProposalRepository,
} from '@/domain/ports';
import { errError, errorMessage, err, ok, remoteErrorCode, type Result } from '@/domain/result';


export type { AssistantScope } from '@/domain/assistant';

export interface AssistantDeps {
  assistantRepository: AssistantRepository;
  llmGateway: LlmGateway;
  libraryRepository: LibraryRepository;
  sourceFileStore: SourceFileStore;
  splitProposalRepository: SplitProposalRepository;
}

export interface AssistantMessageView {
  id: string;
  ordinal: number;
  role: 'user' | 'assistant';
  text: string;
  /** 候选卡：助手产出的分章候选（待审阅） */
  proposalId: string | null;
  /** 用户消息：本次实际发送给模型的范围告知 */
  scopeNotice: string | null;
  version: number;
}

function partsToText(partsJson: string): string {
  try {
    const parts = JSON.parse(partsJson) as { type?: string; text?: string }[];
    return parts
      .filter((part) => part.type === 'text' && typeof part.text === 'string')
      .map((part) => part.text)
      .join('');
  } catch {
    return '';
  }
}

function partsToProposalId(partsJson: string): string | null {
  try {
    const parts = JSON.parse(partsJson) as { type?: string; proposalId?: string }[];
    const candidate = parts.find((part) => part.type === 'resplit_candidate');
    return candidate?.proposalId ?? null;
  } catch {
    return null;
  }
}

function partsToScopeNotice(partsJson: string): string | null {
  try {
    const parts = JSON.parse(partsJson) as { type?: string; text?: string }[];
    const part = parts.find((p) => p.type === 'scope_notice');
    return part?.text ?? null;
  } catch {
    return null;
  }
}

function toView(record: AssistantMessageRecord): AssistantMessageView {
  return {
    id: record.id,
    ordinal: record.ordinal,
    role: record.role,
    text: partsToText(record.partsJson),
    proposalId: partsToProposalId(record.partsJson),
    scopeNotice: partsToScopeNotice(record.partsJson),
    version: record.version,
  };
}

export function createAssistantService(deps: AssistantDeps) {
  /** 按用户可见范围构建上下文：章节/选区用书级偏移从原文取真实片段，超上限截断 */
  async function buildContext(
    projectId: string,
    scope: AssistantScope,
  ): Promise<Result<{ chapterMeta: string; scopeText: string; textLength: number; notice: string }>> {
    const source = await deps.libraryRepository.getSource(projectId);
    const chapters = await deps.libraryRepository.listChapters(projectId);
    const resolved = resolveAssistantScope(scope, chapters);
    if (!resolved) return errError('scopeInvalid');
    const chapterMeta = chapters
      .map((chapter) => `- 《${chapter.title}》 偏移 ${chapter.startOffset}–${chapter.endOffset}`)
      .join('\n');
    let scopeText = '';
    let textLength = 0;
    if (source) {
      const text = await deps.sourceFileStore.readDecodedText(source.textSha256);
      textLength = text.length;
      if (scope.kind === 'book') {
        scopeText = text.slice(0, ASSISTANT_BOOK_HEAD_CHARS);
      } else {
        const start = resolved.startOffset!;
        const end = Math.min(resolved.endOffset!, start + ASSISTANT_CONTEXT_CHAR_LIMIT);
        scopeText = text.slice(start, end);
      }
    }
    return ok({ chapterMeta, scopeText, textLength, notice: resolved.notice });
  }

  return {
    async listMessages(projectId: string, options: { limit: number; beforeOrdinal?: number }): Promise<AssistantMessageView[]> {
      const session = await deps.assistantRepository.getOrCreateSession(projectId);
      const records = await deps.assistantRepository.listMessages(session.id, options);
      return records.map(toView);
    },

    /** 发送用户消息并流式生成回复；产出的分章候选落 pending 提案，采用仍须显式命令 */
    async sendMessage(command: {
      projectId: string;
      commandId: string;
      userText: string;
      scope?: AssistantScope;
      onDelta?: (delta: string) => void;
    }): Promise<Result<{ assistantText: string; proposalId: string | null; scopeNotice: string }>> {
      if (command.userText.trim().length === 0) return errError('messageEmpty');
      const scope: AssistantScope = command.scope ?? { kind: 'book' };
      const session = await deps.assistantRepository.getOrCreateSession(command.projectId);
      const contextResult = await buildContext(command.projectId, scope);
      if (!contextResult.ok) return contextResult;
      const context = contextResult.value;
      const baseOrdinal = await deps.assistantRepository.countMessages(session.id);

      const userRecord: AssistantMessageRecord = {
        id: `msg-${command.commandId}-u`,
        sessionId: session.id,
        ordinal: baseOrdinal,
        role: 'user',
        partsJson: JSON.stringify([
          { type: 'text', text: command.userText },
          { type: 'scope_notice', text: context.notice },
        ]),
        version: 0,
        createdAt: Date.now(),
      };
      await deps.assistantRepository.appendMessage(userRecord);

      const contextPrompt =
        `【本次发送范围】${context.notice}\n` +
        '【书籍上下文】\n章节目录（字符偏移，半开区间）：\n' +
        (context.chapterMeta || '（还没有章节）') +
        `\n全文共 ${context.textLength} 字。\n本次提供的正文片段：\n${context.scopeText}\n\n【用户消息】\n${command.userText}`;

      // 先落占位消息，流式增量节流持久化（docs/plan.md 5.3：按会话序号写入，中断可恢复）
      const assistantRecord: AssistantMessageRecord = {
        id: `msg-${command.commandId}-a`,
        sessionId: session.id,
        ordinal: baseOrdinal + 1,
        role: 'assistant',
        partsJson: JSON.stringify([{ type: 'text', text: '' }]),
        version: 0,
        createdAt: Date.now(),
      };
      await deps.assistantRepository.appendMessage(assistantRecord);

      let assistantText = '';
      let version = 0;
      let lastPersistMs = 0;
      const persistStream = (): Promise<void> => {
        version += 1;
        return deps.assistantRepository.updateMessageParts(
          session.id,
          assistantRecord.ordinal,
          JSON.stringify([{ type: 'text', text: assistantText }]),
          version,
        );
      };
      try {
        assistantText = await deps.llmGateway.complete({
          system: ASSISTANT_SYSTEM_PROMPT,
          user: contextPrompt,
          onDelta: (delta) => {
            assistantText += delta;
            command.onDelta?.(delta);
            const now = Date.now();
            if (now - lastPersistMs >= 400) {
              lastPersistMs = now;
              void persistStream();
            }
          },
        });
        await persistStream();
      } catch (error) {
        const message = errorMessage(error);
        await deps.assistantRepository.updateMessageParts(
          session.id,
          assistantRecord.ordinal,
          JSON.stringify([{ type: 'text', text: `${assistantText}（出错）${message}` }]),
          version + 1,
        );
        return err(remoteErrorCode(error), message);
      }

      // 候选产出：全书分章候选需要全书偏移视野；局部范围不产出候选（避免凭半本书猜偏移）
      const proposalBlock = scope.kind === 'book'
        ? parseResplitProposalBlock(assistantText, context.textLength)
        : null;
      let proposalId: string | null = null;
      if (proposalBlock) {
        const currentChapters = await deps.libraryRepository.listChapters(command.projectId);
        const source = await deps.libraryRepository.getSource(command.projectId);
        if (source) {
          proposalId = `prop-${command.commandId}`;
          try {
            await deps.splitProposalRepository.insert({
              id: proposalId,
              projectId: command.projectId,
              sourceId: source.id,
              payloadJson: JSON.stringify(proposalBlock.chapters),
              previousJson: JSON.stringify(toChapterDrafts(currentChapters)),
              status: 'pending',
              createdAt: Date.now(),
              adoptedAt: null,
            });
          } catch {
            // 同 commandId 重复提交：候选已存在，直接复用
          }
        }
      }

      const parts: { type: string; text?: string; proposalId?: string }[] = [
        { type: 'text', text: assistantText },
      ];
      if (proposalId) parts.push({ type: 'resplit_candidate', proposalId });
      await deps.assistantRepository.updateMessageParts(session.id, assistantRecord.ordinal, JSON.stringify(parts), version + 1);

      return ok({ assistantText, proposalId, scopeNotice: context.notice });
    },
  };
}

export type AssistantService = ReturnType<typeof createAssistantService>;
