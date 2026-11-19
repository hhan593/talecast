
export type ProjectId = string;

export interface Project {
  id: ProjectId;
  title: string;
  description: string;
  /** 乐观并发修订号：任何采用类命令使它 +1（expectedRevision 校验的基础） */
  revision: number;
  createdAt: number;
  updatedAt: number;
}

export interface SourceInfo {
  id: string;
  projectId: ProjectId;
  filename: string;
  /** 首版恒为 'utf-8'（docs/plan.md 4.2） */
  encoding: 'utf-8';
  rawSha256: string;
  textSha256: string;
  byteSize: number;
  createdAt: number;
}

export interface Chapter {
  id: string;
  projectId: ProjectId;
  sourceId: string;
  title: string;
  /** 半开区间 [startOffset, endOffset)，解码文本字符偏移，分区不重叠 */
  startOffset: number;
  endOffset: number;
  volume: number;
  ordinal: number;
  headingLine: number | null;
}

export interface VoiceInfo {
  provider: string;
  /** provider 内的音色标识，如 Edge TTS 的 zh-CN-XiaoxiaoNeural */
  voiceId: string;
  name: string;
  description: string;
}


export interface CharacterRecord {
  id: string;
  projectId: ProjectId;
  name: string;
  aliasesJson: string;
  profileJson: string;
  /** 人工确认后才可参与生成；确认即施加人工保护 */
  confirmed: boolean;
  /** 人工保护：确认后的身份/绑定不被模型建议覆盖（docs/plan.md 4.1.4） */
  manualProtected: boolean;
  createdAt: number;
  updatedAt: number;
}

export interface BookmarkRecord {
  id: string;
  projectId: ProjectId;
  chapterId: string;
  charOffset: number;
  /** 添加时的上下文摘录（书签列表展示） */
  excerpt: string;
  createdAt: number;
}

export interface VoiceRecord {
  id: string;
  provider: string;
  voiceId: string;
  name: string;
  description: string;
}

export type BindingTargetType = 'narrator' | 'character';

export interface BindingRecord {
  id: string;
  projectId: ProjectId;
  targetType: BindingTargetType;
  /** narrator 绑定为 null */
  targetId: string | null;
  voiceId: string;
  /** 合成参数（prosody JSON）：参与 input_hash，变更即失效旧缓存 */
  providerParamsJson: string;
  /** 绑定修订号：参与生成任务的 input_hash（绑定变更 → 旧缓存失效） */
  revision: number;
  updatedAt: number;
}

export interface GenerationJobRecord {
  id: string;
  projectId: ProjectId;
  chapterId: string;
  status: import('./jobs').JobStatus;
  provider: string;
  inputHash: string;
  voiceId: string;
  bindingRevision: number;
  totalSegments: number;
  /** 已完成段数 */
  progress: number;
  error: string | null;
  createdAt: number;
  updatedAt: number;
}

export interface GenerationSegmentRecord {
  id: string;
  jobId: string;
  ordinal: number;
  text: string;
  textHash: string;
  status: import('./jobs').SegmentStatus;
  filePath: string | null;
  error: string | null;
  updatedAt: number;
  /** 段级音色（v0.9.0 对话分声）；null = 旧单声任务，合成回落 job.voiceId */
  voiceId: string | null;
  /** 段级合成参数；null = 旧单声任务 */
  providerParamsJson: string | null;
}
