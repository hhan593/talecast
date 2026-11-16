/**
 * 分章规则：本地正则检测章节标题（docs/plan.md 4.1.3）。
 * P0 落地基础规则并配测试；人工改标题、调边界、候选审阅结构随 P1 落地。
 */

export interface ChapterHeading {
  /** 解码文本中的行号（0 起） */
  lineIndex: number;
  title: string;
}

/**
 * 章节标题形如"第一章 重逢 / 第 12 章 山雨欲来 / 第两百三十一章"。
 * 标题必须独立成行：序号后若紧跟其他文字（无空白），视为正文而非标题；
 * 标题（含空白）总长受 50 字上限约束，防止长句开头碰巧像标题。
 */
const HEADING_PATTERN =
  /^(第\s*[0-9〇零一二三四五六七八九十百千两]+\s*[章节卷回部集篇])(\s+\S.{0,49})?\s*$/;

export function detectChapterHeadings(lines: string[]): ChapterHeading[] {
  const headings: ChapterHeading[] = [];
  for (let i = 0; i < lines.length; i++) {
    const match = HEADING_PATTERN.exec(lines[i].trim());
    if (match) {
      headings.push({ lineIndex: i, title: match[1] + (match[2] ?? '') });
    }
  }
  return headings;
}
