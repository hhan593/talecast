import { describe, expect, it } from 'vitest';

import { segmentForTts } from './segmenter';
import { assertJobStartable, buildSegmentPlan, computeJobInputHash, computeSegmentTextHash } from './jobs';

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
