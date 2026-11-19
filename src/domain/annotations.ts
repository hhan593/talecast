/**
 * 划线与笔记（docs/design/2026-11-20-v0.10-v0.16-roadmap.md v0.12.0）。
 * 书级字符偏移半开区间 [start, end)（与书签/阅读位置同一套不变量）；
 * 章节重排后偏移可能失效——不迁移，按偏移尽力回位（与书签同取舍）。
 * 纯函数：区间校验、摘录截取、Markdown 导出渲染。
 */

export const MAX_ANNOTATION_SPAN_CHARS = 2000;
export const MAX_ANNOTATION_NOTE_CHARS = 2000;
export const EXCERPT_CONTEXT_CHARS = 60;

export interface AnnotationRecord {
  id: string;
  projectId: string;
  chapterId: string;
  startOffset: number;
  endOffset: number;
  /** v1 仅划线；note 为空串即纯划线 */
  kind: 'underline';
  note: string;
  createdAt: number;
  updatedAt: number;
}

/** 划线区间校验：正整数、半开区间、长度上限；返回错误消息或 null */
export function assertAnnotationSpan(startOffset: number, endOffset: number, chapterEndOffset: number): string | null {
  if (!Number.isInteger(startOffset) || !Number.isInteger(endOffset)) return '划线区间必须是整数偏移';
  if (startOffset < 0 || endOffset <= startOffset) return '划线区间无效（需 start < end）';
  if (endOffset - startOffset > MAX_ANNOTATION_SPAN_CHARS) {
    return `划线最长 ${MAX_ANNOTATION_SPAN_CHARS} 字，请分段划线`;
  }
  if (endOffset > chapterEndOffset) return '划线超出章节范围';
  return null;
}

/** 笔记长度校验 */
export function assertAnnotationNote(note: string): string | null {
  if (note.length > MAX_ANNOTATION_NOTE_CHARS) {
    return `笔记最长 ${MAX_ANNOTATION_NOTE_CHARS} 字`;
  }
  return null;
}

/** 摘录渲染：划线原文 + 前后各 60 字上下文（原文全文级切片） */
export function buildAnnotationExcerpt(
  fullText: string,
  startOffset: number,
  endOffset: number,
): { excerpt: string; contextBefore: string; contextAfter: string } {
  const excerpt = fullText.slice(startOffset, endOffset).replace(/\s+/g, ' ').trim();
  const contextBefore = fullText
    .slice(Math.max(0, startOffset - EXCERPT_CONTEXT_CHARS), startOffset)
    .replace(/\s+/g, ' ')
    .trim();
  const contextAfter = fullText
    .slice(endOffset, Math.min(fullText.length, endOffset + EXCERPT_CONTEXT_CHARS))
    .replace(/\s+/g, ' ')
    .trim();
  return { excerpt, contextBefore, contextAfter };
}

export interface AnnotationMarkdownItem {
  chapterTitle: string;
  excerpt: string;
  note: string;
  createdAt: number;
}

/** Markdown 导出渲染（确定性：同输入同输出） */
export function renderAnnotationsMarkdown(bookTitle: string, items: AnnotationMarkdownItem[]): string {
  const lines: string[] = [`# 《${bookTitle}》 划线与笔记`, ''];
  if (items.length === 0) {
    lines.push('（暂无划线与笔记）');
    return lines.join('\n');
  }
  let lastChapter: string | null = null;
  for (const item of items) {
    if (item.chapterTitle !== lastChapter) {
      lines.push(`## ${item.chapterTitle}`, '');
      lastChapter = item.chapterTitle;
    }
    lines.push(`> ${item.excerpt}`, '');
    if (item.note.length > 0) {
      lines.push(`**笔记**：${item.note}`, '');
    }
    const date = new Date(item.createdAt);
    const dateStr = `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}`;
    lines.push(`<sub>${dateStr}</sub>`, '', '---', '');
  }
  return lines.join('\n');
}

/**
 * 高亮渲染辅助：把文本按区间集合切片（普通/高亮交替）。
 * 区间为文本内相对偏移半开区间，重叠合并；确定性输出。
 */
export interface StyledSlice {
  text: string;
  highlighted: boolean;
}

export function sliceStyledText(text: string, ranges: Array<{ start: number; end: number }>): StyledSlice[] {
  if (ranges.length === 0 || text.length === 0) return [{ text, highlighted: false }];
  const sorted = [...ranges].sort((a, b) => a.start - b.start);
  const merged: Array<{ start: number; end: number }> = [];
  for (const range of sorted) {
    const start = Math.max(0, range.start);
    const end = Math.min(text.length, range.end);
    if (end <= start) continue;
    const last = merged[merged.length - 1];
    if (last && start <= last.end) last.end = Math.max(last.end, end);
    else merged.push({ start, end });
  }
  if (merged.length === 0) return [{ text, highlighted: false }];
  const slices: StyledSlice[] = [];
  let cursor = 0;
  for (const range of merged) {
    if (range.start > cursor) slices.push({ text: text.slice(cursor, range.start), highlighted: false });
    slices.push({ text: text.slice(range.start, range.end), highlighted: true });
    cursor = range.end;
  }
  if (cursor < text.length) slices.push({ text: text.slice(cursor), highlighted: false });
  return slices;
}
