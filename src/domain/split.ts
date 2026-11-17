/**
 * 分章规则与候选结构（docs/plan.md 4.1.3 / 5.3 分章流程）。
 * 候选而非直改：正则产出 ChapterDraft[] 形成候选，审阅采用才写正式章节；
 * 采用/撤销走显式命令（幂等回执 + revision 推进），撤销只回退目录不改来源。
 */

export interface ChapterHeading {
  /** 解码文本中的行号（0 起） */
  lineIndex: number;
  /** 该行首字符在全文中的偏移（字符偏移，解码文本基准） */
  startOffset: number;
  title: string;
}

/**
 * 章节标题形如"第一章 重逢 / 第 12 章 山雨欲来 / 第两百三十一章"。
 * 标题必须独立成行：序号后若紧跟其他文字（无空白），视为正文而非标题；
 * 标题（含空白）总长受 50 字上限约束，防止长句开头碰巧像标题。
 */
const HEADING_PATTERN =
  /^(第\s*[0-9〇零一二三四五六七八九十百千两]+\s*[章节卷回部集篇])(\s+\S.{0,49})?\s*$/;

/** 行感知版：直接在解码全文上扫描，带出行号与字符偏移（导入/重新分章共用） */
export function detectChapterHeadingsInText(text: string): ChapterHeading[] {
  const headings: ChapterHeading[] = [];
  let offset = 0;
  let lineIndex = 0;
  for (;;) {
    const newline = text.indexOf('\n', offset);
    const lineEnd = newline === -1 ? text.length : newline;
    const raw = text.slice(offset, lineEnd);
    const match = HEADING_PATTERN.exec(raw.trim());
    if (match) {
      headings.push({ lineIndex, startOffset: offset, title: match[1] + (match[2] ?? '') });
    }
    if (newline === -1) break;
    offset = newline + 1;
    lineIndex += 1;
  }
  return headings;
}

export interface ChapterDraft {
  title: string;
  /** 半开区间 [startOffset, endOffset)，分区不重叠、覆盖全文 */
  startOffset: number;
  endOffset: number;
  headingLine: number | null;
}

/** 把章节（正式章节或草案）投影为草案快照：只保留分章结构的四个字段，剥离 id/sourceId 等元数据 */
export function toChapterDrafts(chapters: readonly ChapterDraft[]): ChapterDraft[] {
  return chapters.map((chapter) => ({
    title: chapter.title,
    startOffset: chapter.startOffset,
    endOffset: chapter.endOffset,
    headingLine: chapter.headingLine,
  }));
}

/**
 * 由标题命中构建章节草案：首个标题前的非空文字归入"前言"，末章收尾到全文末尾。
 * 无命中时整本作为单章（用户可在审阅后人工调整或重新分章）。
 */
export function buildChapterDrafts(text: string, headings: ChapterHeading[]): ChapterDraft[] {
  const drafts: ChapterDraft[] = [];
  if (headings.length === 0) {
    return [
      { title: '全文', startOffset: 0, endOffset: text.length, headingLine: null },
    ];
  }
  const first = headings[0];
  if (text.slice(0, first.startOffset).trim().length > 0) {
    drafts.push({ title: '前言', startOffset: 0, endOffset: first.startOffset, headingLine: null });
  }
  for (let i = 0; i < headings.length; i++) {
    const heading = headings[i];
    const endOffset = i + 1 < headings.length ? headings[i + 1].startOffset : text.length;
    drafts.push({
      title: heading.title,
      startOffset: heading.startOffset,
      endOffset,
      headingLine: heading.lineIndex,
    });
  }
  return drafts;
}

/** 导入即用的初始章节 = 正则扫描 + 打包（同一事务写 sources + chapters） */
export function buildInitialChapterDrafts(text: string): ChapterDraft[] {
  return buildChapterDrafts(text, detectChapterHeadingsInText(text));
}

// 候选与采用/撤销的状态规则

export type ProposalStatus = 'pending' | 'adopted' | 'withdrawn';

export function assertAdoptable(
  status: ProposalStatus,
  currentRevision: number,
  expectedRevision: number,
): string | null {
  if (status !== 'pending') return '该候选已被采用或撤销';
  if (currentRevision !== expectedRevision) return '工程已被其他操作修改，请刷新后重试';
  return null;
}

export function assertUndoable(
  status: ProposalStatus,
  currentRevision: number,
  expectedRevision: number,
): string | null {
  if (status !== 'adopted') return '只有已采用的候选才能撤销';
  if (currentRevision !== expectedRevision) return '工程已被其他操作修改，请刷新后重试';
  return null;
}
