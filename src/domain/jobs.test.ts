import { describe, expect, it } from 'vitest';

import { segmentForTts } from './segmenter';
import { assertJobStartable, buildProsodyJson, buildSegmentPlan, buildVoiceSegmentPlan, computeJobInputHash, computeSegmentTextHash, parseProsodyJson } from './jobs';

const baseInput = {
  chapterTextSha256: 'a'.repeat(64),
  bindingRevision: 3,
  voiceId: 'zh-CN-XiaoxiaoNeural',
  provider: 'edge-tts',
  providerParamsJson: '{}',
  audioFormat: 'audio-24khz-48kbitrate-mono-mp3',
};

describe('computeJobInputHash', () => {
  it('任一输入变化都产生不同哈希（防旧缓存误用）', () => {
    const base = computeJobInputHash(baseInput);
    expect(computeJobInputHash(baseInput)).toBe(base);
    expect(computeJobInputHash({ ...baseInput, bindingRevision: 4 })).not.toBe(base);
    expect(computeJobInputHash({ ...baseInput, voiceId: 'zh-CN-YunxiNeural' })).not.toBe(base);
    expect(computeJobInputHash({ ...baseInput, providerParamsJson: '{"rate":"+10%"}' })).not.toBe(base);
    expect(computeJobInputHash({ ...baseInput, chapterTextSha256: 'b'.repeat(64) })).not.toBe(base);
  });
});

describe('computeSegmentTextHash', () => {
  it('段文本相同则哈希相同（试听转正/断点复用的基础）', () => {
    const a = computeSegmentTextHash({ ...baseInput, segmentText: '同一段文本。' });
    const b = computeSegmentTextHash({ ...baseInput, segmentText: '同一段文本。' });
    expect(a).toBe(b);
    expect(computeSegmentTextHash({ ...baseInput, segmentText: '另一段。' })).not.toBe(a);
  });
});

describe('buildSegmentPlan', () => {
  it('确定性切段并逐段带 text_hash', () => {
    const text = '第一句。第二句！第三句？';
    const planA = buildSegmentPlan(text, baseInput, segmentForTts, 10);
    const planB = buildSegmentPlan(text, baseInput, segmentForTts, 10);
    expect(planA).toEqual(planB);
    // 映射契约：text_hash 必须等于对"该段文本"独立计算的结果
    expect(
      planA.map((s) => [s.text, s.textHash]),
    ).toEqual(
      planA.map((s) => [
        s.text,
        computeSegmentTextHash({ ...baseInput, segmentText: s.text }),
      ]),
    );
  });
});

describe('assertJobStartable', () => {
  it('三类前置：章节存在、已绑定、无活动任务', () => {
    expect(assertJobStartable({ chapterExists: true, hasVoiceBinding: true, activeJobExists: false })).toBeNull();
    expect(assertJobStartable({ chapterExists: false, hasVoiceBinding: true, activeJobExists: false })).toMatch(/章节不存在/);
    expect(assertJobStartable({ chapterExists: true, hasVoiceBinding: false, activeJobExists: false })).toMatch(/绑定音色/);
    expect(assertJobStartable({ chapterExists: true, hasVoiceBinding: true, activeJobExists: true })).toMatch(/进行中/);
  });
});

describe('parseProsodyJson', () => {
  it('容错解析：坏 JSON 回落空对象', () => {
    expect(parseProsodyJson('not-json')).toEqual({});
    expect(parseProsodyJson('{}')).toEqual({});
  });
});

describe('v0.9.0 buildVoiceSegmentPlan（多声分段）', () => {
  it('按 voice span 分段：voiceKey 跟随 span，ordinal 全局连续', () => {
    const spans = [
      { startOffset: 0, endOffset: 5, voiceKey: 'narrator', text: '旁白一句。' },
      { startOffset: 5, endOffset: 14, voiceKey: 'char-a', text: '“台词在这。”' },
      { startOffset: 14, endOffset: 24, voiceKey: 'narrator', text: '旁白收尾两句话。' },
    ];
    const plan = buildVoiceSegmentPlan(spans, segmentForTts);
    expect(plan.map((p) => p.ordinal)).toEqual(plan.map((_, i) => i));
    const dialogueSegments = plan.filter((p) => p.voiceKey === 'char-a');
    expect(dialogueSegments.length).toBeGreaterThanOrEqual(1);
    expect(dialogueSegments.every((p) => p.text.includes('台词'))).toBe(true);
    // 拼接覆盖：全部段文本连接 = span 文本连接（空段已跳过）
    expect(plan.map((p) => p.text).join('')).toBe('旁白一句。“台词在这。”旁白收尾两句话。');
  });

  it('纯空白 span（换行）跳过：不产生空请求段', () => {
    const spans = [
      { startOffset: 0, endOffset: 6, voiceKey: 'narrator', text: '旁白。\n' },
      { startOffset: 6, endOffset: 7, voiceKey: 'narrator', text: '\n' },
      { startOffset: 7, endOffset: 12, voiceKey: 'char-a', text: '“接着。”' },
    ];
    const plan = buildVoiceSegmentPlan(spans, segmentForTts);
    expect(plan.every((p) => p.text.trim().length > 0)).toBe(true);
  });

  it('maxLength 传入分段器：段长受上限约束', () => {
    const long = '很'.repeat(300);
    const spans = [{ startOffset: 0, endOffset: 300, voiceKey: 'char-a', text: long }];
    const plan = buildVoiceSegmentPlan(spans, segmentForTts, 120);
    expect(plan.length).toBe(3);
    expect(plan.every((p) => p.text.length <= 120)).toBe(true);
    expect(plan.every((p) => p.voiceKey === 'char-a')).toBe(true);
  });
});
