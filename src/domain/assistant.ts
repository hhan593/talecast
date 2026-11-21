
import type { Chapter } from './types';

/** 助手上下文范围（book=目录+开头预览；chapter=整章；selection=选中段落） */
export type AssistantScope =
  | { kind: 'book' }
  | { kind: 'chapter'; chapterId: string }
  | { kind: 'selection'; chapterId: string; startOffset: number; endOffset: number };

/** 与对话归属一致的单次 LLM 文本上限；超出截断并告知模型与用户 */
export const ASSISTANT_CONTEXT_CHAR_LIMIT = 30_000;
/** book 范围只发目录 + 开头预览，不发全书 */
export const ASSISTANT_BOOK_HEAD_CHARS = 1200;

export interface ResolvedAssistantScope {
  label: string;
  /** UI 发送前告知：本次实际提交给文本模型的内容 */
  notice: string;
  /** 书级偏移（半开区间）；book 范围为 null */
  startOffset: number | null;
  endOffset: number | null;
  truncated: boolean;
}

/** 解析范围并返回人话告知；章节不存在/选区越界返回 null（服务层据此拒绝，不静默降级） */
export function resolveAssistantScope(
  scope: AssistantScope,
  chapters: Pick<Chapter, 'id' | 'title' | 'startOffset' | 'endOffset'>[],
): ResolvedAssistantScope | null {
  if (scope.kind === 'book') {
    return {
      label: '全书概览',
      notice: `章节目录 + 开头 ${ASSISTANT_BOOK_HEAD_CHARS} 字（不发送全书正文）`,
      startOffset: null,
      endOffset: null,
      truncated: false,
    };
  }
  const chapter = chapters.find((c) => c.id === scope.chapterId);
  if (!chapter) return null;
  if (scope.kind === 'selection') {
    if (
      !Number.isFinite(scope.startOffset) || !Number.isFinite(scope.endOffset) ||
      scope.startOffset < chapter.startOffset || scope.endOffset > chapter.endOffset ||
      scope.endOffset <= scope.startOffset
    ) return null;
    const chars = scope.endOffset - scope.startOffset;
    return {
      label: `选中段落 · ${chapter.title}`,
      notice: `《${chapter.title}》选中片段 ${chars} 字（书级偏移 ${scope.startOffset}–${scope.endOffset}）${chars > ASSISTANT_CONTEXT_CHAR_LIMIT ? `，仅发送前 ${ASSISTANT_CONTEXT_CHAR_LIMIT} 字` : ''}`,
      startOffset: scope.startOffset,
      endOffset: scope.endOffset,
      truncated: chars > ASSISTANT_CONTEXT_CHAR_LIMIT,
    };
  }
  const chars = chapter.endOffset - chapter.startOffset;
  return {
    label: chapter.title,
    notice: `《${chapter.title}》正文 ${chars} 字（书级偏移 ${chapter.startOffset}–${chapter.endOffset}）${chars > ASSISTANT_CONTEXT_CHAR_LIMIT ? `，仅发送前 ${ASSISTANT_CONTEXT_CHAR_LIMIT} 字` : ''}`,
    startOffset: chapter.startOffset,
    endOffset: chapter.endOffset,
    truncated: chars > ASSISTANT_CONTEXT_CHAR_LIMIT,
  };
}

export const ASSISTANT_SYSTEM_PROMPT =
  '你是 TaleCast 的书籍助手，服务于有声书制作流程。规则：\n' +
  '1. 你只提出建议（候选），绝不直接修改书籍数据；用户在审阅界面显式采用后才会生效。\n' +
  '2. 回答用中文，简洁。\n' +
  '3. 当用户要求重新分章/调整章节时，输出一个 ```json 代码块，格式：\n' +
  '{"type":"resplit_proposal","chapters":[{"title":"章节名","startOffset":0,"endOffset":120}]}。\n' +
  'startOffset/endOffset 是基于全文的字符偏移（半开区间），必须按原文标题位置推断。\n' +
  '4. 不确定时先提问，不要编造原文内容。';

export interface ResplitProposalBlock {
  type: 'resplit_proposal';
  chapters: { title: string; startOffset: number; endOffset: number }[];
}

/**
 * 从助手输出中解析分章候选 JSON 块（```json ... ```），找不到返回 null。
 * 候选校验：offset 数值合法、单调不重叠、落在 [0, textLength] 内。
 */
export function parseResplitProposalBlock(output: string, textLength: number): ResplitProposalBlock | null {
  const fenceStart = output.indexOf('```json');
  if (fenceStart === -1) return null;
  const blockStart = output.indexOf('{', fenceStart);
  const fenceEnd = output.indexOf('```', fenceStart + 7);
  if (blockStart === -1 || fenceEnd === -1 || fenceEnd <= blockStart) return null;
  const blockEnd = output.lastIndexOf('}', fenceEnd);
  if (blockEnd <= blockStart) return null;

  let parsed: unknown;
  try {
    parsed = JSON.parse(output.slice(blockStart, blockEnd + 1));
  } catch {
    return null;
  }
  const candidate = parsed as { type?: string; chapters?: unknown };
  if (candidate.type !== 'resplit_proposal' || !Array.isArray(candidate.chapters)) return null;

  const chapters: { title: string; startOffset: number; endOffset: number }[] = [];
  let cursor = 0;
  for (const raw of candidate.chapters) {
    const item = raw as { title?: unknown; startOffset?: unknown; endOffset?: unknown };
    const title = typeof item.title === 'string' ? item.title.trim() : '';
    const startOffset = typeof item.startOffset === 'number' ? Math.floor(item.startOffset) : Number.NaN;
    const endOffset = typeof item.endOffset === 'number' ? Math.floor(item.endOffset) : Number.NaN;
    if (title.length === 0 || title.length > 60) return null;
    if (!Number.isFinite(startOffset) || !Number.isFinite(endOffset)) return null;
    if (startOffset < cursor || endOffset <= startOffset || endOffset > textLength) return null;
    chapters.push({ title, startOffset, endOffset });
    cursor = endOffset;
  }
  if (chapters.length === 0) return null;
  return { type: 'resplit_proposal', chapters };
}
