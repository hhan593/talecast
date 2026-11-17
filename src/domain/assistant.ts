
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
  chapters: Array<{ title: string; startOffset: number; endOffset: number }>;
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

  const chapters: Array<{ title: string; startOffset: number; endOffset: number }> = [];
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
