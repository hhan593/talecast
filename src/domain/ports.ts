/**
 * 端口（ports & adapters）：domain 需要什么由这里定义，adapters 负责实现。
 * 依赖方向唯一：services 依赖 ports，adapters 实现 ports，domain 不 import 任何上层（docs/plan.md 5.1）。
 * P0 只落地仓储与回执存储；KeyStore/TtsGateway/AudioPlayer 的实现随 P2/P3/P4 接入。
 */

import type { CommandReceipt } from './commands';
import type { ChapterDraft, ProposalStatus } from './split';
import type {
  BindingRecord,
  BindingTargetType,
  CharacterRecord,
  Chapter,
  GenerationJobRecord,
  GenerationSegmentRecord,
  Project,
  SourceInfo,
  VoiceInfo,
  VoiceRecord,
} from './types';

export interface ProjectRepository {
  list(): Promise<Project[]>;
  get(id: Project['id']): Promise<Project | null>;
  create(input: { id: Project['id']; title: string; description: string; createdAt: number }): Promise<Project>;
}

export interface ReceiptStore {
  get<T>(commandId: string): Promise<CommandReceipt<T> | null>;
  put<T>(receipt: CommandReceipt<T>): Promise<void>;
}

// ---------------------------------------------------------------------------
// P1：来源、章节、候选、阅读位置
// ---------------------------------------------------------------------------

/** 系统文件选择器：P1 只接受 UTF-8 TXT */
export interface FilePicker {
  pickTextFile(): Promise<{ name: string; bytes: Uint8Array } | null>;
}

/** 沙盒文件存储：sources/<raw_sha>.raw 与 <raw_sha>.txt（不可变，按内容寻址） */
export interface SourceFileStore {
  writeRawBytes(sha256: string, bytes: Uint8Array): Promise<void>;
  writeDecodedText(sha256: string, text: string): Promise<void>;
  readDecodedText(sha256: string): Promise<string>;
}

export interface ChapterEditKind {
  kind: 'rename' | 'boundary' | 'split' | 'delete';
}

export interface SplitProposalRecord {
  id: string;
  projectId: Project['id'];
  sourceId: string;
  payloadJson: string;
  previousJson: string;
  status: ProposalStatus;
  createdAt: number;
  adoptedAt: number | null;
}

export interface SplitProposalRepository {
  insert(record: SplitProposalRecord): Promise<void>;
  get(id: string): Promise<SplitProposalRecord | null>;
  latestAdopted(projectId: Project['id']): Promise<SplitProposalRecord | null>;
  setStatus(id: string, status: ProposalStatus, adoptedAt: number | null): Promise<void>;
  /** 采用时点重录"上一版"快照：撤销恢复到采用前一刻（含提出候选后的编辑） */
  setPreviousJson(id: string, previousJson: string): Promise<void>;
}

export interface ChapterEditRecord {
  id: string;
  projectId: Project['id'];
  chapterId: string;
  kind: ChapterEditKind['kind'];
  payloadJson: string;
  revision: number;
  createdAt: number;
}

export interface ChapterEditRepository {
  insert(record: ChapterEditRecord): Promise<void>;
  listByProject(projectId: Project['id']): Promise<ChapterEditRecord[]>;
}

export interface ReadingState {
  projectId: Project['id'];
  /** 章节落点（文本阅读）；可为 null（只更新音频位置） */
  chapterId: string | null;
  charOffset: number | null;
  audioSegmentOrdinal: number | null;
  audioOffsetMs: number | null;
  updatedAt: number;
}

/** set 支持部分更新：未提供的字段保留旧值（文本位置与音频位置互不覆盖） */
export interface ReadingStateRepository {
  get(projectId: Project['id']): Promise<ReadingState | null>;
  set(state: Omit<ReadingState, 'updatedAt'>): Promise<void>;
}

/**
 * 来源与章节的统一存储端口。
 * 事务性约定（adapters 用同一 SQLite 事务保证，services 只声明语义）：
 * - createSourceWithChapters：来源 + 初始章节原子写入；
 * - replaceChapters：整体替换章节集合，bumpRevision 时 revision+1（采用/撤销）；
 * - mutateChapters：单章编辑 + 审计行 + revision+1（人工修正不改来源）。
 */
export interface LibraryRepository {
  createSourceWithChapters(
    source: Omit<SourceInfo, 'id'> & { id: string },
    drafts: ChapterDraft[],
  ): Promise<SourceInfo>;
  getSource(projectId: Project['id']): Promise<SourceInfo | null>;
  listChapters(projectId: Project['id']): Promise<Chapter[]>;
  replaceChapters(
    projectId: Project['id'],
    sourceId: string,
    drafts: ChapterDraft[],
    options: { bumpRevision: boolean },
  ): Promise<Project>;
  mutateChapters(
    projectId: Project['id'],
    edit: { kind: ChapterEditKind['kind']; chapterId: string; payload: Record<string, unknown> },
    mutate: (chapters: Chapter[]) => Chapter[],
  ): Promise<{ chapters: Chapter[]; project: Project }>;
}

export interface KeyStore {
  get(key: string): Promise<string | null>;
  set(key: string, value: string): Promise<void>;
  delete(key: string): Promise<void>;
}

export interface TtsGateway {
  listVoices(): Promise<VoiceInfo[]>;
  /** 合成单段，返回统一格式的音频字节（写入按内容寻址的 AudioFileStore） */
  synthesize(input: { text: string; voiceId: string }): Promise<Uint8Array>;
}

/** 远程文本模型（OpenAI 兼容）；P2 角色抽取与 P3 助手共用。onDelta 提供流式增量（P3 助手） */
export interface LlmGateway {
  complete(input: {
    system: string;
    user: string;
    signal?: AbortSignal;
    onDelta?: (delta: string) => void;
  }): Promise<string>;
}

// ---------------------------------------------------------------------------
// P2：音色快照、角色、绑定、生成任务存储
// ---------------------------------------------------------------------------

export interface VoiceRecordRepository {
  /** 音色快照整体刷新（voices/list 拉取后入库） */
  replaceAllForProvider(provider: string, voices: Array<Omit<VoiceRecord, 'id'>>): Promise<void>;
  list(provider: string): Promise<Array<VoiceRecord>>;
  findByVoiceId(provider: string, voiceId: string): Promise<VoiceRecord | null>;
}

export interface CharacterRepository {
  list(projectId: Project['id']): Promise<Array<CharacterRecord>>;
  get(id: string): Promise<CharacterRecord | null>;
  insert(record: CharacterRecord): Promise<void>;
  update(id: string, patch: Partial<Pick<CharacterRecord, 'name' | 'aliasesJson' | 'profileJson' | 'confirmed' | 'manualProtected'>>): Promise<void>;
  delete(id: string): Promise<void>;
}

export interface BindingRepository {
  getForTarget(projectId: Project['id'], targetType: BindingTargetType, targetId: string | null): Promise<BindingRecord | null>;
  list(projectId: Project['id']): Promise<Array<BindingRecord>>;
  /** 幂等回执语义由 services 层保证；upsert 时 revision+1 */
  upsert(record: Omit<BindingRecord, 'id' | 'revision' | 'updatedAt'>): Promise<BindingRecord>;
}

export interface GenerationStore {
  createJob(job: GenerationJobRecord, segments: Array<GenerationSegmentRecord>): Promise<void>;
  getJob(id: string): Promise<GenerationJobRecord | null>;
  findByInputHash(projectId: Project['id'], inputHash: string): Promise<GenerationJobRecord | null>;
  getActiveJobByChapter(projectId: Project['id'], chapterId: string): Promise<GenerationJobRecord | null>;
  listJobsByChapter(projectId: Project['id'], chapterId: string): Promise<Array<GenerationJobRecord>>;
  updateJob(id: string, patch: Partial<Pick<GenerationJobRecord, 'status' | 'progress' | 'error'>>): Promise<void>;
  listSegments(jobId: string): Promise<Array<GenerationSegmentRecord>>;
  updateSegment(id: string, patch: Partial<Pick<GenerationSegmentRecord, 'status' | 'filePath' | 'error'>>): Promise<void>;
  /** 应用启动恢复：运行中任务标记为失败（可重试，已完成段保留） */
  markInterruptedJobsFailed(): Promise<number>;
}

export interface SettingsRepository {
  get(key: string): Promise<string | null>;
  set(key: string, value: string): Promise<void>;
  all(): Promise<Record<string, string>>;
}

export interface RequestLogRepository {
  log(kind: 'tts' | 'llm', ok: boolean, note: string): Promise<void>;
  counts(): Promise<{ ttsOk: number; ttsFailed: number; llmOk: number; llmFailed: number }>;
}

/** 按内容寻址的音频文件存储：audio/<text_hash>.mp3（试听与生成共用 → 试听转正零成本） */
export interface AudioFileStore {
  pathFor(textHash: string): string;
  exists(textHash: string): Promise<boolean>;
  write(textHash: string, bytes: Uint8Array): Promise<string>;
}

export interface AudioPlayer {
  load(uri: string): Promise<void>;
  play(): Promise<void>;
  pause(): Promise<void>;
  /** 跳转到段内毫秒位置（拖动进度/点段跳转） */
  seek(positionMs: number): Promise<void>;
  onProgress(callback: (positionMs: number) => void): () => void;
  onPlaybackEnd(callback: () => void): () => void;
  release(): void;
}

// ---------------------------------------------------------------------------
// P3：工程助手会话
// ---------------------------------------------------------------------------

export interface AssistantSessionRecord {
  id: string;
  projectId: Project['id'];
  taskKind: 'general';
  chapterId: string | null;
  createdAt: number;
}

export interface AssistantMessageRecord {
  id: string;
  sessionId: string;
  ordinal: number;
  role: 'user' | 'assistant';
  partsJson: string;
  version: number;
  createdAt: number;
}

export interface AssistantRepository {
  getOrCreateSession(projectId: Project['id']): Promise<AssistantSessionRecord>;
  listMessages(sessionId: string, options: { limit: number; beforeOrdinal?: number }): Promise<Array<AssistantMessageRecord>>;
  appendMessage(record: AssistantMessageRecord): Promise<void>;
  /** 流式追加：更新 parts_json 并 version+1（按会话内 ordinal 定位） */
  updateMessageParts(sessionId: string, ordinal: number, partsJson: string, nextVersion: number): Promise<void>;
  countMessages(sessionId: string): Promise<number>;
}
