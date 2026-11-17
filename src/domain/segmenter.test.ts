import { describe, expect, it } from 'vitest';

import { firstSegmentForTts, segmentForTts } from './segmenter';

describe('segmentForTts', () => {
  const text = '第一句话。第二句话！第三句话？';

  it('确定性：同输入同输出（幂等单元的前提）', () => {
    expect(segmentForTts(text)).toEqual(segmentForTts(text));
  });

  it('按句打包且每段不超过上限，文本不丢字符', () => {
    const segments = segmentForTts(text, 10);
    expect(segments.every((s) => s.text.length <= 10)).toBe(true);
    expect(segments.map((s) => s.text).join('')).toBe(text);
    expect(segments.map((s) => s.ordinal)).toEqual([0, 1]);
  });

  it('超长单句硬切，不留空段', () => {
    const long = '啊'.repeat(50) + '。';
    const segments = segmentForTts(long, 10);
    expect(segments.every((s) => s.text.length > 0 && s.text.length <= 10)).toBe(true);
    expect(segments[segments.length - 1].text).toBe('。');
  });

  it('空文本返回空数组', () => {
    expect(segmentForTts('')).toEqual([]);
  });

  it('非法上限抛错', () => {
    expect(() => segmentForTts(text, 0)).toThrow(RangeError);
  });
});

describe('firstSegmentForTts', () => {
  const cases = [
    '第一句。第二句！第三句？第四句很长一些，确保多句打包到同一个段里去。',
    '啊'.repeat(50) + '。',
    '无终止标点的结尾残余',
    '',
  ];
  for (const maxLength of [10, 1200]) {
    it(`与 segmentForTts 首段逐字等价（maxLength=${maxLength}）`, () => {
      for (const text of cases) {
        expect(firstSegmentForTts(text, maxLength)).toEqual(segmentForTts(text, maxLength)[0] ?? null);
      }
    });
  }
});
