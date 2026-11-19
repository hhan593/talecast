/**
 * 手动阅读分页（docs/design/2026-11-19-manual-reading-plan.md §4.2）。
 * 字符偏移确定性分页：同输入（文本 + metrics）→ 同分页；按偏移切分不丢字，
 * CJK 逐字换行假设下中英混排允许 ±1 字误差（页尾留白，市面简版阅读器同款取舍）。
 *
 * 视觉段模型：每个原始行（\n 分隔）按 charsPerLine 切成若干"视觉段"
 * （每段 1 个视觉行；空行 = 零宽段，计 1 行）；视觉段按 linesPerPage
 * 打包成页，页边界落在段边界上——长段落可跨页，页为半开字符区间
 * [startOffset, endOffset)，衔接覆盖全文（与 chapters 表同一套不变量）。
 */

export interface PageMetrics {
  /** 每行可容纳的字符数（探针按正文字号测量得出） */
  charsPerLine: number;
  /** 每页容纳的视觉行数 */
  linesPerPage: number;
}

export interface ReaderPage {
  ordinal: number;
  startOffset: number;
  endOffset: number;
}

export interface ReaderSegment {
  /** 段首在全文中的字符偏移 */
  startOffset: number;
  endOffset: number;
  /** 段文本（不含换行；空行为空串） */
  text: string;
}

export function assertMetrics(metrics: PageMetrics): void {
  if (!Number.isInteger(metrics.charsPerLine) || metrics.charsPerLine <= 0) {
    throw new RangeError('charsPerLine 必须为正整数');
  }
  if (!Number.isInteger(metrics.linesPerPage) || metrics.linesPerPage <= 0) {
    throw new RangeError('linesPerPage 必须为正整数');
  }
}

/** 视觉段：原始行按 charsPerLine 硬切（CJK 逐字换行假设；空行为零宽段） */
function toSegments(text: string, baseOffset: number, charsPerLine: number): ReaderSegment[] {
  const segments: ReaderSegment[] = [];
  let lineStart = 0;
  for (;;) {
    const newline = text.indexOf('\n', lineStart);
    const lineEnd = newline === -1 ? text.length : newline;
    const raw = text.slice(lineStart, lineEnd);
    for (let i = 0; i < raw.length; i += charsPerLine) {
      const chunkEnd = Math.min(i + charsPerLine, raw.length);
      const isLastChunk = i + charsPerLine >= raw.length;
      // 行尾段把换行符纳入 endOffset：页切片直接拼接即全文（不丢任何字符）
      const segEnd = isLastChunk && newline !== -1 ? lineEnd + 1 : lineStart + chunkEnd;
      segments.push({
        startOffset: baseOffset + lineStart + i,
        endOffset: baseOffset + segEnd,
        text: raw.slice(i, chunkEnd),
      });
    }
    if (raw.length === 0) {
      // 空行 = 一个换行符：段覆盖该字符（有宽度），保证页切片拼接不丢换行
      segments.push({
        startOffset: baseOffset + lineStart,
        endOffset: baseOffset + lineEnd + (newline !== -1 ? 1 : 0),
        text: '',
      });
    }
    if (newline === -1) break;
    lineStart = newline + 1;
  }
  return segments;
}

/** 分页：视觉段按 linesPerPage 打包（确定性：同输入同分页） */
export function paginateText(text: string, baseOffset: number, metrics: PageMetrics): ReaderPage[] {
  assertMetrics(metrics);
  const segments = toSegments(text, baseOffset, metrics.charsPerLine);
  if (segments.length === 0) return [];

  const pages: ReaderPage[] = [];
  let ordinal = 0;
  for (let i = 0; i < segments.length; i += metrics.linesPerPage) {
    const group = segments.slice(i, i + metrics.linesPerPage);
    pages.push({
      ordinal,
      startOffset: group[0].startOffset,
      endOffset: group[group.length - 1].endOffset,
    });
    ordinal += 1;
  }
  return pages;
}

/** 偏移 → 页索引（最后一个 startOffset ≤ offset 的页；越界回落首页） */
export function pageForOffset(pages: ReaderPage[], offset: number): number {
  let index = 0;
  for (let i = 0; i < pages.length; i++) {
    if (pages[i].startOffset <= offset) index = i;
    else break;
  }
  return index;
}
