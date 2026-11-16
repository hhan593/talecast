import { parseResplitProposalBlock, ASSISTANT_SYSTEM_PROMPT } from '@/domain/assistant';
import type {
  AssistantMessageRecord,
  AssistantRepository,
  LibraryRepository,
  LlmGateway,
  SourceFileStore,
  SplitProposalRepository,
} from '@/domain/ports';
import { err, ok, type Result } from '@/domain/result';

/**
 * 工程助手（docs/plan.md 4.1.7 / 5.3 助手流程）：
 * 单一会话 + SSE 流式消息 + 候选产出。
 * 分章候选只写入 split_proposals（pending），采用必须走显式命令——助手无直改权限。
 */

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
  version: number;
}

function partsToText(partsJson: string): string {
  try {
    const parts = JSON.parse(partsJson) as Array<{ type?: string; text?: string }>;
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
    const parts = JSON.parse(partsJson) as Array<{ type?: string; proposalId?: string }>;
    const candidate = parts.find((part) => part.type === 'resplit_candidate');
    return candidate?.proposalId ?? null;
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
    version: record.version,
  };
}

export function createAssistantService(deps: AssistantDeps) {
  async function buildContext(projectId: string): Promise<{ chapterMeta: string; textHead: string; textLength: number }> {
    const source = await deps.libraryRepository.getSource(projectId);
    const chapters = await deps.libraryRepository.listChapters(projectId);
    const chapterMeta = chapters
      .map((chapter) => `- 《${chapter.title}》 偏移 ${chapter.startOffset}–${chapter.endOffset}`)
      .join('\n');
    let textHead = '';
    let textLength = 0;
    if (source) {
      const text = await deps.sourceFileStore.readDecodedText(source.textSha256);
      textLength = text.length;
      textHead = text.slice(0, 1200);
    }
    return { chapterMeta, textHead, textLength };
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
      onDelta?: (delta: string) => void;
    }): Promise<Result<{ assistantText: string; proposalId: string | null }>> {
      if (command.userText.trim().length === 0) return err('invalid', '消息不能为空');
      const session = await deps.assistantRepository.getOrCreateSession(command.projectId);
      const context = await buildContext(command.projectId);
      const baseOrdinal = await deps.assistantRepository.countMessages(session.id);

      const userRecord: AssistantMessageRecord = {
        id: `msg-${command.commandId}-u`,
        sessionId: session.id,
        ordinal: baseOrdinal,
        role: 'user',
        partsJson: JSON.stringify([{ type: 'text', text: command.userText }]),
        version: 0,
        createdAt: Date.now(),
      };
      await deps.assistantRepository.appendMessage(userRecord);

      const contextPrompt =
        '【工程上下文】\n章节目录（字符偏移，半开区间）：\n' +
        (context.chapterMeta || '（还没有章节）') +
        `\n全文共 ${context.textLength} 字。\n开头预览：\n${context.textHead}\n\n【用户消息】\n${command.userText}`;

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
        const message = error instanceof Error ? error.message : String(error);
        await deps.assistantRepository.updateMessageParts(
          session.id,
          assistantRecord.ordinal,
          JSON.stringify([{ type: 'text', text: `${assistantText}（出错）${message}` }]),
          version + 1,
        );
        const code = message.includes('未配置文本模型') ? 'invalid' : 'network';
        return err(code as 'invalid' | 'network', message);
      }

      // 候选产出：分章候选 → pending 提案；绝不直接改章节
      const proposalBlock = parseResplitProposalBlock(assistantText, context.textLength);
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
              previousJson: JSON.stringify(
                currentChapters.map((chapter) => ({
                  title: chapter.title,
                  startOffset: chapter.startOffset,
                  endOffset: chapter.endOffset,
                  headingLine: chapter.headingLine,
                })),
              ),
              status: 'pending',
              createdAt: Date.now(),
              adoptedAt: null,
            });
          } catch {
            // 同 commandId 重复提交：候选已存在，直接复用
          }
        }
      }

      const parts: Array<{ type: string; text?: string; proposalId?: string }> = [
        { type: 'text', text: assistantText },
      ];
      if (proposalId) parts.push({ type: 'resplit_candidate', proposalId });
      await deps.assistantRepository.updateMessageParts(session.id, assistantRecord.ordinal, JSON.stringify(parts), version + 1);

      return ok({ assistantText, proposalId });
    },
  };
}

export type AssistantService = ReturnType<typeof createAssistantService>;
