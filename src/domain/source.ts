/**
 * 不可变来源与导入规则（docs/plan.md 4.1.2 / 5.3 导入流程）。
 * 原文不可变：原始字节按哈希落盘，解码文本单独保存，任何编辑都不改写来源。
 * 双哈希 = raw_sha256（原始字节身份）+ text_sha256（解码文本身份）。
 * 章节以解码文本的字符偏移（JS 字符串索引）表达，基准是解码后的全文。
 */

/** 首版单文件上限：16MB（docs/plan.md 4.2 不做 128MiB/一万章大容量目标） */
export const MAX_IMPORT_BYTES = 16 * 1024 * 1024;

export function checkImportSize(byteSize: number): boolean {
  return byteSize <= MAX_IMPORT_BYTES;
}

export interface Paragraph {
  /** 段落文本（不含换行） */
  text: string;
  /** 段落在全文中的起始字符偏移（含章节基准） */
  startOffset: number;
  endOffset: number;
}

/** 章节正文按空行/换行分段；偏移为全文绝对偏移，供阅读位置与高亮映射 */
export function splitParagraphs(chapterText: string, chapterStartOffset: number): Paragraph[] {
  const paragraphs: Paragraph[] = [];
  let offset = 0;
  for (;;) {
    const newline = chapterText.indexOf('\n', offset);
    const lineEnd = newline === -1 ? chapterText.length : newline;
    const raw = chapterText.slice(offset, lineEnd);
    const trimmed = raw.trim();
    if (trimmed.length > 0) {
      const lead = raw.length - raw.trimStart().length;
      paragraphs.push({
        text: trimmed,
        startOffset: chapterStartOffset + offset + lead,
        endOffset: chapterStartOffset + offset + lead + trimmed.length,
      });
    }
    if (newline === -1) break;
    offset = newline + 1;
  }
  return paragraphs;
}
