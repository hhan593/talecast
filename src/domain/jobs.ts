/**
 * 生成任务状态机与幂等哈希构成（docs/plan.md 5.3 生成流程）。
 * 哈希规则用纯函数冻结在 domain，services 与 adapters 共用，防止口径漂移。
 *
 * input_hash = SHA-256(章节文本哈希 + 绑定 revision + voice_id + provider + 参数
 *                      + 音频格式 + SEGMENTER_VERSION)
 * 任一项变化都产生新任务，旧段缓存不会被误用。
 *
 * 段级幂等（generation_segments.text_hash）：
 *   text_hash = SHA-256(段文本 + voice_id + provider + 参数)
 * 命中 done 段（且音频文件存在）直接复用文件——重试只补缺失段，零重复请求。
 */

import { sha256Text } from './hash';
import { SEGMENTER_VERSION, type Segment } from './segmenter';
import type { VoiceSpan } from './dialogue';

export interface GenerationJobInput {
  chapterTextSha256: string;
  bindingRevision: number;
  voiceId: string;
  provider: string;
  providerParamsJson: string;
  audioFormat: string;
  /** 多声计划指纹（v0.9.0）：仅在对话分声开启时传入；单声路径缺省 → 哈希与旧版完全一致 */
  voicePlanJson?: string;
}

export function computeJobInputHash(input: GenerationJobInput): string {
  const parts = [
    input.chapterTextSha256,
    String(input.bindingRevision),
    input.voiceId,
    input.provider,
    input.providerParamsJson,
    input.audioFormat,
    SEGMENTER_VERSION,
  ];
  if (input.voicePlanJson !== undefined) parts.push(input.voicePlanJson);
  return sha256Text(parts.join('|'));
}

export interface GenerationSegmentInput {
  segmentText: string;
  voiceId: string;
  provider: string;
  providerParamsJson: string;
}

/** 段级幂等单元：text_hash + 统一音频格式 → 音频文件按内容寻址（试听转正零成本） */
export function computeSegmentTextHash(input: GenerationSegmentInput): string {
  return sha256Text(
    [input.segmentText, input.voiceId, input.provider, input.providerParamsJson, SEGMENTER_VERSION].join('|'),
  );
}

export type JobStatus = 'pending' | 'running' | 'done' | 'failed';
export type SegmentStatus = 'pending' | 'generating' | 'done' | 'failed';

/** 首版单章生成字数上限（docs/plan.md 4.2：首版给出更小的明确上限） */
export const MAX_CHAPTER_GENERATION_CHARS = 30_000;

export function checkChapterGenerationSize(chapterCharLength: number): boolean {
  return chapterCharLength <= MAX_CHAPTER_GENERATION_CHARS;
}

export interface TtsProsody {
  /** 相对语速，如 '-20%' / '+20%'；缺省为标准 */
  rate?: string;
  /** 相对音调，如 '-10%' / '+10%' */
  pitch?: string;
  /** 相对音量，如 '-20%' / '+20%' */
  volume?: string;
}

/** 确定性序列化：键序固定、标准值剔除，保证同参数 → 同字符串 → 同 text_hash（缺省为 '{}'） */
export function buildProsodyJson(prosody: TtsProsody): string {
  const clean: Partial<Record<'rate' | 'pitch' | 'volume', string>> = {};
  if (prosody.rate && prosody.rate !== '+0%') clean.rate = prosody.rate;
  if (prosody.pitch && prosody.pitch !== '+0%') clean.pitch = prosody.pitch;
  if (prosody.volume && prosody.volume !== '+0%') clean.volume = prosody.volume;
  const keys = ['rate', 'pitch', 'volume'] as const;
  if (keys.every((key) => !(key in clean))) return '{}';
  return JSON.stringify(Object.fromEntries(keys.filter((key) => key in clean).map((key) => [key, clean[key]])));
}

export function parseProsodyJson(json: string): TtsProsody {
  try {
    const parsed = JSON.parse(json) as TtsProsody;
    return { rate: parsed.rate, volume: parsed.volume, pitch: parsed.pitch };
  } catch {
    return {};
  }
}

/** 任务级前置检查：章节已导入、已绑定音色、无同章节活动任务 */
export function assertJobStartable(input: {
  chapterExists: boolean;
  hasVoiceBinding: boolean;
  activeJobExists: boolean;
}): string | null {
  if (!input.chapterExists) return '章节不存在';
  if (!input.hasVoiceBinding) return '本章尚未绑定音色，请先在角色中心绑定';
  if (input.activeJobExists) return '本章已有进行中的生成任务，等待完成或失败后再试';
  return null;
}

/** 把章节文本切分为带幂等哈希的段（segmenter 输出 + text_hash） */
export function buildSegmentPlan(
  chapterText: string,
  segmentInput: Omit<GenerationSegmentInput, 'segmentText'>,
  segmentForTtsImpl: (text: string, maxLength?: number) => Segment[],
  maxLength?: number,
): Array<{ ordinal: number; text: string; textHash: string }> {
  const segments = segmentForTtsImpl(chapterText, maxLength);
  return segments.map((segment) => ({
    ordinal: segment.ordinal,
    text: segment.text,
    textHash: computeSegmentTextHash({ ...segmentInput, segmentText: segment.text }),
  }));
}

export interface VoicePlanSegment {
  /** 全局连续序号（跨 voice span 重排） */
  ordinal: number;
  text: string;
  /** 'narrator' | characterId */
  voiceKey: string;
}

/** 多声计划：voice span 内部再走 TTS 分段器（句切 + 上限），ordinal 全局连续；纯空白段跳过（无语音价值，省请求） */
export function buildVoiceSegmentPlan(
  spans: VoiceSpan[],
  segmentForTtsImpl: (text: string, maxLength?: number) => Segment[],
  maxLength?: number,
): VoicePlanSegment[] {
  const plan: VoicePlanSegment[] = [];
  let ordinal = 0;
  for (const span of spans) {
    if (span.text.trim().length === 0) continue;
    for (const segment of segmentForTtsImpl(span.text, maxLength)) {
      if (segment.text.trim().length === 0) continue;
      plan.push({ ordinal, text: segment.text, voiceKey: span.voiceKey });
      ordinal += 1;
    }
  }
  return plan;
}
