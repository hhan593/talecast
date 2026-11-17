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

export interface GenerationJobInput {
  chapterTextSha256: string;
  bindingRevision: number;
  voiceId: string;
  provider: string;
  providerParamsJson: string;
  audioFormat: string;
}

export function computeJobInputHash(input: GenerationJobInput): string {
  return sha256Text(
    [
      input.chapterTextSha256,
      String(input.bindingRevision),
      input.voiceId,
      input.provider,
      input.providerParamsJson,
      input.audioFormat,
      SEGMENTER_VERSION,
    ].join('|'),
  );
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
