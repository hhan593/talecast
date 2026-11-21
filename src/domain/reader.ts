/**
 * 手动阅读分页（docs/design/2026-11-19-manual-reading-plan.md §4.2）。
 * 字符偏移确定性分页：同输入（文本 + metrics）→ 同分页；按偏移切分不丢字，
 * CJK 逐字换行假设下中英混排允许 ±1 字误差（页尾留白，市面简版阅读器同款取舍）。
 *
 * 视觉段模型：每个原始行（\n 分隔）按 charsPerLine 切成若干"视觉段"
 * （每段 1 个视觉行；空行 = 零宽段，计 1 行）；视觉段按 linesPerPage
 * 打包成页，页边界落在段边界上——长段落可跨页，页为半开字符区间
 * [startOffset, endOffset)，衔接覆盖全文（与 chapters 表同一套不变量）。
 *
 * 段间距（v0.8.0）：提供 lineHeightPx + paragraphSpacingPx 时改按像素预算
 * 打包——段边界（上一段尾与下一段首同页）额外计段间距；跨页边界处不重复计，
 * 渲染层对应规则：页内最后一块不加 marginBottom。缩进（indentChars）在
 * 段首行少排 N 字，渲染层以全角空格补齐，保证分页与渲染一致不切字。
 */

export interface PageMetrics {
  /** 每行可容纳的字符数（探针按正文字号测量得出） */
  charsPerLine: number;
  /** 每栏容纳的视觉行数 */
  linesPerPage: number;
  /** 栏数：1=竖屏单栏（默认），2=横屏对页（一个滑动单位 = columns 个栏） */
  columns?: 1 | 2;
  /** 行高（像素）：与 paragraphSpacingPx 同时提供时启用像素预算分页 */
  lineHeightPx?: number;
  /** 段间距（像素）：段尾额外预留高度 */
  paragraphSpacingPx?: number;
  /** 首行缩进（字符数）：段首行少排 N 字，渲染层补全角空格 */
  indentChars?: number;
}

export interface ReaderPage {
  ordinal: number;
  startOffset: number;
  endOffset: number;
}

/**
 * 翻页动画（v0.19.0；v0.20.2 补 vertical 上下，issue #94）：
 * slide 平移 / cover 覆盖 / curl 卷页近似 / vertical 上下（PagerView 纵向） / none 无动画瞬切。
 * none 复用 PagerView 的 setPageWithoutAnimation，不新增渲染路径。
 */
export type PageTurnStyle = 'slide' | 'cover' | 'curl' | 'vertical' | 'none';

export interface ReaderSegment {
  /** 段首在全文中的字符偏移 */
  startOffset: number;
  endOffset: number;
  /** 段文本（不含换行；空行为空串） */
  text: string;
  /** 该段是否为原始行末段（行尾换行已纳入 endOffset）——像素预算分页的段间距判据 */
  endsLine?: boolean;
}

export function assertMetrics(metrics: PageMetrics): void {
  if (!Number.isInteger(metrics.charsPerLine) || metrics.charsPerLine <= 0) {
    throw new RangeError('charsPerLine 必须为正整数');
  }
  if (!Number.isInteger(metrics.linesPerPage) || metrics.linesPerPage <= 0) {
    throw new RangeError('linesPerPage 必须为正整数');
  }
  if (metrics.columns !== undefined && metrics.columns !== 1 && metrics.columns !== 2) {
    throw new RangeError('columns 仅支持 1（单栏）或 2（横屏双栏）');
  }
}

/** 视觉段：原始行按 charsPerLine 硬切（CJK 逐字换行假设；空行为零宽段） */
function toSegments(text: string, baseOffset: number, metrics: PageMetrics): ReaderSegment[] {
  const charsPerLine = metrics.charsPerLine;
  const indent = metrics.indentChars ?? 0;
  const segments: ReaderSegment[] = [];
  let lineStart = 0;
  for (;;) {
    const newline = text.indexOf('\n', lineStart);
    const lineEnd = newline === -1 ? text.length : newline;
    const raw = text.slice(lineStart, lineEnd);
    for (let i = 0; i < raw.length; ) {
      // 段首行按缩进少排 N 字（渲染层补全角空格）；行内后续段满排
      const cap = i === 0 && indent > 0 ? Math.max(1, charsPerLine - indent) : charsPerLine;
      const chunkEnd = Math.min(i + cap, raw.length);
      const isLastChunk = chunkEnd >= raw.length;
      // 行尾段把换行符纳入 endOffset：页切片直接拼接即全文（不丢任何字符）
      const segEnd = isLastChunk && newline !== -1 ? lineEnd + 1 : lineStart + chunkEnd;
      segments.push({
        startOffset: baseOffset + lineStart + i,
        endOffset: baseOffset + segEnd,
        text: raw.slice(i, chunkEnd),
        endsLine: isLastChunk,
      });
      i = chunkEnd;
    }
    if (raw.length === 0) {
      // 空行 = 一个换行符：段覆盖该字符（有宽度），保证页切片拼接不丢换行
      segments.push({
        startOffset: baseOffset + lineStart,
        endOffset: baseOffset + lineEnd + (newline !== -1 ? 1 : 0),
        text: '',
        endsLine: true,
      });
    }
    if (newline === -1) break;
    lineStart = newline + 1;
  }
  return segments;
}

/** 分页：视觉段打包（确定性：同输入同分页） */
export function paginateText(text: string, baseOffset: number, metrics: PageMetrics): ReaderPage[] {
  assertMetrics(metrics);
  const segments = toSegments(text, baseOffset, metrics);
  if (segments.length === 0) return [];

  const columns = metrics.columns ?? 1;
  const pages: ReaderPage[] = [];

  if (metrics.lineHeightPx !== undefined && metrics.paragraphSpacingPx !== undefined) {
    // 像素预算打包：行高逐行累计，段边界（同页内）额外计段间距；
    // 页尾恰好落在段边界时间距不计入（与渲染层"页内最后一块不加 margin"一致）
    const lineHeight = metrics.lineHeightPx;
    const spacing = metrics.paragraphSpacingPx;
    const capacity = metrics.linesPerPage * lineHeight * columns;
    const EPSILON = 0.01;
    let group: ReaderSegment[] = [];
    let used = 0;
    for (let i = 0; i < segments.length; i++) {
      const seg = segments[i];
      const gapBefore = group.length > 0 && segments[i - 1].endsLine === true ? spacing : 0;
      if (group.length > 0 && used + gapBefore + lineHeight > capacity + EPSILON) {
        pages.push({ ordinal: pages.length, startOffset: group[0].startOffset, endOffset: group[group.length - 1].endOffset });
        group = [];
        used = 0;
      }
      const charged = group.length === 0 ? lineHeight : gapBefore + lineHeight;
      group.push(seg);
      used += charged;
    }
    if (group.length > 0) {
      pages.push({ ordinal: pages.length, startOffset: group[0].startOffset, endOffset: group[group.length - 1].endOffset });
    }
    return pages;
  }

  // 整数行打包（旧行为：每页固定 linesPerPage×columns 个视觉段）
  const perScreen = metrics.linesPerPage * columns;
  let ordinal = 0;
  for (let i = 0; i < segments.length; i += perScreen) {
    const group = segments.slice(i, i + perScreen);
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

/**
 * 滚动模式位置互查（issue #64 收尾）：ScrollView 无虚拟化可视区回调，
 * 位置持久化改为「每段实测 y（单调不减）+ 滚动偏移」纯函数互查。
 */
/** 滚动偏移 → 顶边所在段索引（最后一个 top ≤ scrollY 的段；越界回落首段） */
export function paragraphIndexAtScrollY(tops: number[], scrollY: number): number {
  let index = 0;
  for (let i = 0; i < tops.length; i++) {
    if (tops[i] <= scrollY) index = i;
    else break;
  }
  return index;
}

/** 字符偏移 → 段索引（最后一个 startOffset ≤ offset 的段；越界回落首段） */
export function paragraphIndexForOffset(startOffsets: number[], offset: number): number {
  let index = 0;
  for (let i = 0; i < startOffsets.length; i++) {
    if (startOffsets[i] <= offset) index = i;
    else break;
  }
  return index;
}

/**
 * 排版常量（v0.20.x 自 reader-view 下沉，issue #81）：字号/行距/段距/边距
 * 的档位表与 key 类型。分页 metrics 与自动滚屏共用；渲染层从 domain 引用
 * （reader-view re-export 保持既有 import 路径兼容）。
 */
export const FONT_SIZES = { small: 14, standard: 15.5, large: 18, xlarge: 21 } as const;
export type FontSizeKey = keyof typeof FONT_SIZES;
export const LINE_SPACINGS = { compact: 1.5, standard: 1.7, relaxed: 1.9 } as const;
export type LineSpacingKey = keyof typeof LINE_SPACINGS;
/** 段间距（像素）：翻页分页按像素预算预留，滚动模式为段落纵向内边距 */
export const PARAGRAPH_SPACINGS = { compact: 4, standard: 12, relaxed: 20 } as const;
export type ParagraphSpacingKey = keyof typeof PARAGRAPH_SPACINGS;
export const MARGINS = { narrow: 12, standard: 20, wide: 32 } as const;
export type MarginKey = keyof typeof MARGINS;
