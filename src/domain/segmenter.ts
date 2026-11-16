/**
 * TTS 分段器：按句切分并打包到长度上限内。
 * 必须确定性输出（同输入同段序同文本），段文本哈希才能作为幂等单元稳定命中（docs/plan.md 5.3）。
 * P0 落地基础实现并配测试；provider 字数上限参数化，P2 接 Edge TTS 时按协议微调。
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
