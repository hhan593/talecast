import type { CommandReceipt } from './commands';
import type { TtsProsody } from './jobs';
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
  /** 级联删除书籍全部数据（章节/来源/候选/编辑/阅读位置/绑定/角色/生成任务与段/助手会话），同一事务 */
  delete(projectId: Project['id']): Promise<void>;
}

export interface ReceiptStore {
  get<T>(commandId: string): Promise<CommandReceipt<T> | null>;
  put<T>(receipt: CommandReceipt<T>): Promise<void>;
}


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
  setStatus(id: string, status: ProposalStatus, adoptedAt: number | null): Promise<void>;
  /** 采用时点重录"上一版"快照：撤销恢复到采用前一刻（含提出候选后的编辑） */
  setPreviousJson(id: string, previousJson: string): Promise<void>;
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
  /** 合成单段，返回统一格式的音频字节（写入按内容寻址的 AudioFileStore）；prosody 为 F-2 合成参数 */
  synthesize(input: { text: string; voiceId: string; prosody?: TtsProsody }): Promise<Uint8Array>;
}

export interface LlmGateway {
  complete(input: {
    system: string;
    user: string;
    signal?: AbortSignal;
    onDelta?: (delta: string) => void;
  }): Promise<string>;
}


export interface VoiceRecordRepository {
  /** 音色快照整体刷新（voices/list 拉取后入库） */
  replaceAllForProvider(provider: string, voices: Array<Omit<VoiceRecord, 'id'>>): Promise<void>;
  list(provider: string): Promise<Array<VoiceRecord>>;
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
/** 章节音频导出：同参 MP3 段按序字节拼接即合法整章文件（Edge 统一编码保证） */
export interface ChapterExporter {
  concatToFile(segmentPaths: string[], outputPath: string): Promise<string>;
  share(uri: string): Promise<void>;
}

export interface AudioFileStore {
  pathFor(textHash: string): string;
  exists(textHash: string): Promise<boolean>;
  write(textHash: string, bytes: Uint8Array): Promise<string>;
}

export interface AudioPlayer {
  /** meta 供锁屏/通知栏展示（标题=章节名，作者=书名） */
  load(uri: string, meta?: { title?: string; artist?: string }): Promise<void>;
  play(): Promise<void>;
  pause(): Promise<void>;
  /** 跳转到段内毫秒位置（拖动进度/点段跳转） */
  seek(positionMs: number): Promise<void>;
  /** 播放速率（0.8–2.0），即时生效（F-1） */
  setRate(rate: number): Promise<void>;
  onProgress(callback: (positionMs: number) => void): () => void;
  onPlaybackEnd(callback: () => void): () => void;
  release(): void;
}


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
