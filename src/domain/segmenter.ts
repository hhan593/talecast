/**
 * TTS 分段器：按句切分并打包到长度上限内。
 * 必须确定性输出（同输入同段序同文本），段文本哈希才能作为幂等单元稳定命中（docs/plan.md 5.3）。
 */

export const SEGMENTER_VERSION = 'p0-1';

export interface Segment {
  ordinal: number;
  text: string;
}

const DEFAULT_MAX_LENGTH = 1200;

/** 按终止标点/换行切句；句尾标点跟随句子，末尾无标点的残余作为一句 */
function splitSentences(text: string): string[] {
  return text.match(/[^。！？；…\n]*[。！？；…\n]+|[^。！？；…\n]+$/g) ?? [];
}

/**
 * 只求首段：与 segmentForTts(text, maxLength)[0] 逐字等价，
 * 但在产出首段后立即返回（试听场景避免整章切分与全量哈希）。
 */
export function firstSegmentForTts(text: string, maxLength: number = DEFAULT_MAX_LENGTH): Segment | null {
  if (maxLength <= 0) throw new RangeError('maxLength 必须为正数');
  if (text.length === 0) return null;
  let current = '';
  for (const sentence of splitSentences(text)) {
    if (sentence.length > maxLength) {
      if (current) return { ordinal: 0, text: current };
      return { ordinal: 0, text: sentence.slice(0, maxLength) };
    }
    if (current.length + sentence.length > maxLength) {
      return { ordinal: 0, text: current };
    }
    current += sentence;
  }
  return current ? { ordinal: 0, text: current } : null;
}

export function segmentForTts(text: string, maxLength: number = DEFAULT_MAX_LENGTH): Segment[] {
  if (maxLength <= 0) throw new RangeError('maxLength 必须为正数');
  if (text.length === 0) return [];

  const segments: string[] = [];
  let current = '';
  for (const sentence of splitSentences(text)) {
    if (sentence.length > maxLength) {
      // 超长单句硬切（如无标点的长段落），保证段长恒受上限约束
      if (current) {
        segments.push(current);
        current = '';
      }
      for (let i = 0; i < sentence.length; i += maxLength) {
        segments.push(sentence.slice(i, i + maxLength));
      }
      continue;
    }
    if (current.length + sentence.length > maxLength) {
      if (current) segments.push(current);
      current = sentence;
    } else {
      current += sentence;
    }
  }
  if (current) segments.push(current);

  return segments.map((segmentText, ordinal) => ({ ordinal, text: segmentText }));
}
