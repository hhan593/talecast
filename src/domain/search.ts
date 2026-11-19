/**
 * 全文搜索（docs/design/2026-11-19-manual-reading-plan.md R3）：
 * 纯扫描实现（indexOf 循环），结果带全文偏移与章节归属；
 * 中文精确匹配，拉丁文大小写不敏感（双方小写后比较）。
 */

export interface SearchHit {
  /** 命中起始的全文字符偏移 */
  charOffset: number;
  /** 命中上下文（命中词前后各取 excerptRadius 字符） */
  excerpt: string;
}

const EXCERPT_RADIUS = 18;

function normalize(s: string): string {
  return s.toLowerCase();
}

/** 在全文中扫描 query 的所有出现位置（确定性） */
export function findHitOffsets(text: string, query: string): number[] {
  if (query.length === 0) return [];
  const haystack = normalize(text);
  const needle = normalize(query);
  if (needle.length === 0) return [];
  const offsets: number[] = [];
  let cursor = 0;
  for (;;) {
    const found = haystack.indexOf(needle, cursor);
    if (found === -1) break;
    offsets.push(found);
    cursor = found + needle.length;
  }
  return offsets;
}

export interface SearchHitInput {
  chapterId: string;
  chapterTitle: string;
  /** 章节区间 [start, end)（全文字符偏移） */
  startOffset: number;
  endOffset: number;
}

/** 全文扫描 → 按章节归属折叠的结果（命中偏移所在章节；摘录截断不丢命中词） */
export function searchBook(
  text: string,
  query: string,
  chapters: Array<SearchHitInput>,
): Array<SearchHit & SearchHitInput> {
  const hits: Array<SearchHit & SearchHitInput> = [];
  for (const offset of findHitOffsets(text, query)) {
    const chapter =
      chapters.find((c) => offset >= c.startOffset && offset < c.endOffset) ??
      chapters[chapters.length - 1];
    if (!chapter) continue;
    const from = Math.max(0, offset - EXCERPT_RADIUS);
    const to = Math.min(text.length, offset + query.length + EXCERPT_RADIUS);
    hits.push({
      chapterId: chapter.chapterId,
      chapterTitle: chapter.chapterTitle,
      startOffset: chapter.startOffset,
      endOffset: chapter.endOffset,
      charOffset: offset,
      excerpt: (from > 0 ? '…' : '') + text.slice(from, to) + (to < text.length ? '…' : ''),
    });
  }
  return hits;
}
