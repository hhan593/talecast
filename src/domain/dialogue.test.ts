import { describe, expect, it } from 'vitest';

import {
  NARRATOR_VOICE_KEY,
  attributeQuote,
  buildVoicePlanFingerprint,
  planVoiceSpans,
} from './dialogue';

const CANDIDATES = [
  { key: 'char-lin', names: ['林晚', '晚姐'] },
  { key: 'char-zhao', names: ['赵四'] },
];

function joined(spans: ReturnType<typeof planVoiceSpans>, source: string): string {
  return spans.map((span) => source.slice(span.startOffset, span.endOffset)).join('');
}

describe('planVoiceSpans：引号区检测与覆盖', () => {
  it('四种引号配对均成区，spans 拼接覆盖全文', () => {
    const source = '「甲」他说。\n“乙”她道。\n『丙』有人喊。\n"丁"末句。';
    const spans = planVoiceSpans(source, []);
    expect(joined(spans, source)).toBe(source);
    // 每种引号各自成区（候选为空 → 全旁白 key，用 span 文本判区）
    for (const quoted of ['「甲」', '“乙”', '『丙』', '"丁"']) {
      expect(spans.some((span) => span.text.includes(quoted))).toBe(true);
    }
  });

  it('未闭合引号视作旁白（不吞掉后续文本）', () => {
    const source = '他说："然后就没有然后了';
    const spans = planVoiceSpans(source, []);
    expect(joined(spans, source)).toBe(source);
    expect(spans.every((span) => span.voiceKey === NARRATOR_VOICE_KEY)).toBe(true);
  });

  it('引号跨段允许（多段独白）：归属判据覆盖首尾段', () => {
    const source = '林晚说：“第一句\n第二句仍像台词。”';
    const spans = planVoiceSpans(source, CANDIDATES);
    expect(joined(spans, source)).toBe(source);
    const quote = spans.find((span) => span.text.includes('第二句'))!;
    expect(quote.voiceKey).toBe('char-lin'); // 跨段引号仍归林晚（首段含"林晚说："）
  });

  it('跨段引号内的换行符留在引号区（拼接覆盖不变量）', () => {
    const source = '开头。\n“甲\n乙”\n结尾。';
    const spans = planVoiceSpans(source, []);
    expect(joined(spans, source)).toBe(source);
    const quote = spans.find((span) => span.text.includes('甲\n乙'))!;
    expect(quote.text).toBe('“甲\n乙”');
  });
});

describe('planVoiceSpans：说话人归属', () => {
  it('引号外命中角色名 → 角色音色', () => {
    const source = '林晚冷声道："滚出去。"';
    const spans = planVoiceSpans(source, CANDIDATES);
    const quote = spans.find((span) => span.text.includes('滚出去'))!;
    expect(quote.voiceKey).toBe('char-lin');
  });

  it('引号内人名不归属（只扫引号外文本）', () => {
    const source = '"林晚，你来一下。"门外的人说。';
    const spans = planVoiceSpans(source, CANDIDATES);
    const quote = spans.find((span) => span.text.includes('你来一下'))!;
    expect(quote.voiceKey).toBe(NARRATOR_VOICE_KEY);
  });

  it('最长别名优先（晚姐 比 林晚 长？否——用更长别名验证）', () => {
    const candidates = [
      { key: 'char-short', names: ['林晚'] },
      { key: 'char-long', names: ['林晚姐姐'] },
    ];
    const source = '林晚姐姐开口："好。"';
    const spans = planVoiceSpans(source, candidates);
    const quote = spans.find((span) => span.text.includes('好。'))!;
    expect(quote.voiceKey).toBe('char-long');
  });

  it('未命中候选 → 旁白', () => {
    const source = '旁人喊道："走！"';
    const spans = planVoiceSpans(source, CANDIDATES);
    const quote = spans.find((span) => span.text.includes('走！'))!;
    expect(quote.voiceKey).toBe(NARRATOR_VOICE_KEY);
  });

  it('同段多引号共用同一次归属', () => {
    const source = '赵四道："好。"又道："快走。"';
    const spans = planVoiceSpans(source, CANDIDATES);
    const quotes = spans.filter((span) => span.text.includes('好。') || span.text.includes('快走。'));
    expect(quotes.length).toBe(2);
    expect(quotes.every((span) => span.voiceKey === 'char-zhao')).toBe(true);
  });
});

describe('attributeQuote / buildVoicePlanFingerprint', () => {
  it('attributeQuote：无命中返回 null', () => {
    expect(attributeQuote('没有任何角色', CANDIDATES)).toBeNull();
    expect(attributeQuote('林晚在场', CANDIDATES)).toBe('char-lin');
  });

  it('指纹确定性：条目顺序无关、revision/params/voice 变化即变化', () => {
    const a = buildVoicePlanFingerprint([
      { key: 'narrator', voiceId: 'v1', providerParamsJson: '{}', revision: 1 },
      { key: 'c2', voiceId: 'v2', providerParamsJson: '{}', revision: 2 },
    ]);
    const b = buildVoicePlanFingerprint([
      { key: 'c2', voiceId: 'v2', providerParamsJson: '{}', revision: 2 },
      { key: 'narrator', voiceId: 'v1', providerParamsJson: '{}', revision: 1 },
    ]);
    expect(a).toBe(b);
    const c = buildVoicePlanFingerprint([
      { key: 'narrator', voiceId: 'v1', providerParamsJson: '{}', revision: 2 },
      { key: 'c2', voiceId: 'v2', providerParamsJson: '{}', revision: 2 },
    ]);
    expect(c).not.toBe(a);
  });
});
