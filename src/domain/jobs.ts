/**
 * 生成任务状态机与 input_hash 构成（docs/plan.md 5.3 生成流程）。
 * P2 落地实现；本文件先冻结关键规则定义，防止实现时口径漂移。
 *
 * input_hash = SHA-256(章节文本哈希 + 绑定 revision + voice_id + provider + 请求参数
 *                      + 音频格式 + SEGMENTER_VERSION)
 * 任一项变化都产生新任务，旧段缓存不会被误用。
 *
 * 段级幂等（generation_segments.text_hash）：
 *   text_hash = SHA-256(段文本 + voice_id + provider + 参数)
 * 命中 done 段直接复用文件，未命中才请求 provider——重试零重复计费。
 */

export interface GenerationJobInput {
  chapterTextSha256: string;
  bindingRevision: number;
  voiceId: string;
  provider: string;
  providerParamsJson: string;
  audioFormat: string;
  segmenterVersion: string;
}

export interface GenerationSegmentInput {
  segmentText: string;
  voiceId: string;
  provider: string;
  providerParamsJson: string;
}
