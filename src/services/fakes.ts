import { bytesToBase64 } from '@/domain/base64';
import type { CommandReceipt } from '@/domain/commands';
import type { ChapterDraft } from '@/domain/split';
import type { AssistantMessageRecord, AssistantSessionRecord } from '@/domain/ports';
import type {
  BindingRecord,
  BindingTargetType,
  CharacterRecord,
  Chapter,
  GenerationJobRecord,
  GenerationSegmentRecord,
  Project,
  SourceInfo,
  VoiceRecord,
} from '@/domain/types';
import type {
  AudioFileStore,
  AudioPlayer,
  BindingRepository,
  CharacterRepository,
  ChapterEditRecord,
  ChapterEditRepository,
  FilePicker,
  GenerationStore,
  LibraryRepository,
  LlmGateway,
  ProjectRepository,
  ReceiptStore,
  RequestLogRepository,
  SourceFileStore,
  SplitProposalRecord,
  SplitProposalRepository,
  ReadingState,
  AssistantRepository,
  ReadingStateRepository,
  SettingsRepository,
  TtsGateway,
  VoiceRecordRepository,
} from '@/domain/ports';

/**
 * in-memory fakes：services 用例测试用（docs/plan.md 5.4 services 编排测试）。
 * 语义贴近 SQLite 实现：replaceChapters/mutateChapters 按端口约定推进 revision。
 */

export class FakeProjectRepository implements ProjectRepository {
  constructor(public rows: Project[]) {}

  list(): Promise<Project[]> {
    return Promise.resolve([...this.rows]);
  }

  get(id: string): Promise<Project | null> {
    return Promise.resolve(this.rows.find((p) => p.id === id) ?? null);
  }

  create(input: { id: string; title: string; description: string; createdAt: number }): Promise<Project> {
    const project: Project = { ...input, revision: 0, updatedAt: input.createdAt };
    this.rows.push(project);
    return Promise.resolve(project);
  }

  /** 与 SQLite 实现同语义：级联删除（fakes 关联表同步清空） */
  async delete(projectId: string): Promise<void> {
    this.rows = this.rows.filter((p) => p.id !== projectId);
  }
}

export class FakeReceiptStore implements ReceiptStore {
  private map = new Map<string, CommandReceipt<unknown>>();

  get<T>(commandId: string): Promise<CommandReceipt<T> | null> {
    const hit = this.map.get(commandId);
    return Promise.resolve(hit ? (hit as CommandReceipt<T>) : null);
  }

  put<T>(receipt: CommandReceipt<T>): Promise<void> {
    this.map.set(receipt.commandId, receipt as CommandReceipt<unknown>);
    return Promise.resolve();
  }
}

export class FakeSourceFileStore implements SourceFileStore {
  public raw = new Map<string, Uint8Array>();
  public text = new Map<string, string>();

  async writeRawBytes(sha256: string, bytes: Uint8Array): Promise<void> {
    this.raw.set(sha256, bytes);
  }

  async writeDecodedText(sha256: string, text: string): Promise<void> {
    this.text.set(sha256, text);
  }

  async readDecodedText(sha256: string): Promise<string> {
    const text = this.text.get(sha256);
    if (text === undefined) throw new Error(`文本不存在：${sha256}`);
    return text;
  }
}

export class FakeFilePicker implements FilePicker {
  constructor(private result: { name: string; bytes: Uint8Array } | null) {}

  pickTextFile(): Promise<{ name: string; bytes: Uint8Array } | null> {
    return Promise.resolve(this.result);
  }
}

export class FakeLibraryRepository implements LibraryRepository {
  public sources: SourceInfo[] = [];
  public chapters: Chapter[] = [];
  /** 记录事务调用，供断言原子写发生 */
  public calls: string[] = [];

  constructor(public projects: Project[]) {}

  async createSourceWithChapters(
    source: Omit<SourceInfo, 'id'> & { id: string },
    drafts: ChapterDraft[],
  ): Promise<SourceInfo> {
    this.calls.push('createSourceWithChapters');
    if (this.sources.some((s) => s.id === source.id)) {
      throw new Error('UNIQUE constraint failed: sources.id');
    }
    const record: SourceInfo = { ...source };
    this.sources.push(record);
    this.chapters = drafts.map((draft, ordinal) => ({
      id: `ch-${source.projectId}-${ordinal}-${draft.startOffset}`,
      projectId: source.projectId,
      sourceId: source.id,
      title: draft.title,
      startOffset: draft.startOffset,
      endOffset: draft.endOffset,
      volume: 0,
      ordinal,
      headingLine: draft.headingLine,
    }));
    return record;
  }

  async getSource(projectId: string): Promise<SourceInfo | null> {
    return this.sources.filter((s) => s.projectId === projectId).at(-1) ?? null;
  }

  async listChapters(projectId: string): Promise<Chapter[]> {
    return this.chapters.filter((c) => c.projectId === projectId);
  }

  async replaceChapters(
    projectId: string,
    sourceId: string,
    drafts: ChapterDraft[],
    options: { bumpRevision: boolean },
  ): Promise<Project> {
    this.calls.push(`replaceChapters(${options.bumpRevision ? '+rev' : 'keep-rev'})`);
    const project = this.projects.find((p) => p.id === projectId);
    if (!project) throw new Error('工程不存在');
    this.chapters = drafts.map((draft, ordinal) => ({
      id: `ch-${projectId}-${ordinal}-${draft.startOffset}`,
      projectId,
      sourceId,
      title: draft.title,
      startOffset: draft.startOffset,
      endOffset: draft.endOffset,
      volume: 0,
      ordinal,
      headingLine: draft.headingLine,
    }));
    if (options.bumpRevision) {
      project.revision += 1;
      project.updatedAt = Date.now();
    }
    return { ...project };
  }

  async mutateChapters(
    projectId: string,
    edit: { kind: string; chapterId: string; payload: Record<string, unknown> },
    mutate: (chapters: Chapter[]) => Chapter[],
  ): Promise<{ chapters: Chapter[]; project: Project }> {
    this.calls.push(`mutateChapters(${edit.kind})`);
    const current = await this.listChapters(projectId);
    this.chapters = mutate(current);
    const project = this.projects.find((p) => p.id === projectId);
    if (!project) throw new Error('工程不存在');
    project.revision += 1;
    project.updatedAt = Date.now();
    return { chapters: this.chapters, project: { ...project } };
  }
}

export class FakeSplitProposalRepository implements SplitProposalRepository {
  public rows: SplitProposalRecord[] = [];

  async insert(record: SplitProposalRecord): Promise<void> {
    this.rows.push(record);
  }

  async get(id: string): Promise<SplitProposalRecord | null> {
    return this.rows.find((r) => r.id === id) ?? null;
  }

  async latestAdopted(projectId: string): Promise<SplitProposalRecord | null> {
    const adopted = this.rows
      .filter((r) => r.projectId === projectId && r.status === 'adopted')
      .sort((a, b) => (b.adoptedAt ?? 0) - (a.adoptedAt ?? 0));
    return adopted[0] ?? null;
  }

  async setStatus(id: string, status: SplitProposalRecord['status'], adoptedAt: number | null): Promise<void> {
    const row = this.rows.find((r) => r.id === id);
    if (!row) throw new Error('proposal 不存在');
    row.status = status;
    row.adoptedAt = adoptedAt;
  }

  async setPreviousJson(id: string, previousJson: string): Promise<void> {
    const row = this.rows.find((r) => r.id === id);
    if (!row) throw new Error('proposal 不存在');
    row.previousJson = previousJson;
  }
}

export class FakeChapterEditRepository implements ChapterEditRepository {
  public rows: ChapterEditRecord[] = [];

  async insert(record: ChapterEditRecord): Promise<void> {
    this.rows.push(record);
  }

  async listByProject(projectId: string): Promise<ChapterEditRecord[]> {
    return this.rows.filter((r) => r.projectId === projectId);
  }
}

export class FakeReadingStateRepository implements ReadingStateRepository {
  public rows = new Map<string, ReadingState>();

  async get(projectId: string): Promise<ReadingState | null> {
    return this.rows.get(projectId) ?? null;
  }

  /** 与 SQLite 实现同语义：部分更新，未提供的字段保留旧值 */
  async set(state: Omit<ReadingState, 'updatedAt'>): Promise<void> {
    const existing = this.rows.get(state.projectId);
    const merged: ReadingState = {
      projectId: state.projectId,
      chapterId: state.chapterId ?? existing?.chapterId ?? null,
      charOffset: state.charOffset ?? existing?.charOffset ?? null,
      audioSegmentOrdinal: state.audioSegmentOrdinal ?? existing?.audioSegmentOrdinal ?? null,
      audioOffsetMs: state.audioOffsetMs ?? existing?.audioOffsetMs ?? null,
      updatedAt: Date.now(),
    };
    this.rows.set(state.projectId, merged);
  }
}

/** 测试辅助：文本 → bytes（走真实编码路径） */
export function textToBytes(text: string): Uint8Array {
  return new TextEncoder().encode(text);
}

export { bytesToBase64 };

// ---------------------------------------------------------------------------
// P2 fakes：TTS/LLM 网关、音频存储、绑定、角色、生成存储、设置、请求日志
// ---------------------------------------------------------------------------

export class FakeTtsGateway implements TtsGateway {
  /** 合成请求计数：验证"重试请求数 = 缺失段数" */
  public synthCalls: string[] = [];
  /** 包含这些关键字的文本合成会失败（模拟单段失败） */
  public failTextIncludes: string[] = [];
  /** 按请求序号（0 起）注入失败，与分段结果解耦 */
  public failCallIndexes: number[] = [];
  /** 每次合成的模拟延迟（毫秒），供取消时序测试 */
  public synthDelayMs = 0;

  async listVoices() {
    return [
      { provider: 'edge-tts', voiceId: 'zh-CN-XiaoxiaoNeural', name: '晓晓', description: '女' },
      { provider: 'edge-tts', voiceId: 'zh-CN-YunxiNeural', name: '云希', description: '男' },
    ];
  }

  async synthesize(input: { text: string; voiceId: string }): Promise<Uint8Array> {
    const index = this.synthCalls.length;
    if (this.synthDelayMs > 0) {
      await new Promise((resolve) => setTimeout(resolve, this.synthDelayMs));
    }
    this.synthCalls.push(`${input.voiceId}:${input.text}`);
    if (this.failCallIndexes.includes(index) || this.failTextIncludes.some((marker) => input.text.includes(marker))) {
      throw new Error('模拟合成失败');
    }
    // 确定性伪音频载荷
    return new TextEncoder().encode(`audio(${input.voiceId}):${input.text}`);
  }
}

export class FakeAudioFileStore implements AudioFileStore {
  public files = new Map<string, string>();

  pathFor(textHash: string): string {
    return `fake://audio/${textHash}.mp3`;
  }

  async exists(textHash: string): Promise<boolean> {
    return this.files.has(textHash);
  }

  async write(textHash: string, _bytes: Uint8Array): Promise<string> {
    this.files.set(textHash, this.pathFor(textHash));
    return this.pathFor(textHash);
  }
}

export class FakeBindingRepository implements BindingRepository {
  public rows: BindingRecord[] = [];

  async getForTarget(projectId: string, targetType: BindingTargetType, targetId: string | null): Promise<BindingRecord | null> {
    return (
      this.rows.find((r) => r.projectId === projectId && r.targetType === targetType && r.targetId === (targetId ?? null)) ?? null
    );
  }

  async list(projectId: string): Promise<BindingRecord[]> {
    return this.rows.filter((r) => r.projectId === projectId);
  }

  async upsert(record: Omit<BindingRecord, 'id' | 'revision' | 'updatedAt'>): Promise<BindingRecord> {
    const existing = this.rows.find(
      (r) =>
        r.projectId === record.projectId && r.targetType === record.targetType && r.targetId === (record.targetId ?? null),
    );
    if (existing) {
      existing.voiceId = record.voiceId;
      existing.revision += 1;
      existing.updatedAt = Date.now();
      return { ...existing };
    }
    const created: BindingRecord = {
      id: `bind-${this.rows.length}`,
      projectId: record.projectId,
      targetType: record.targetType,
      targetId: record.targetId ?? null,
      voiceId: record.voiceId,
      revision: 1,
      updatedAt: Date.now(),
    };
    this.rows.push(created);
    return { ...created };
  }
}

export class FakeCharacterRepository implements CharacterRepository {
  public rows: CharacterRecord[] = [];

  async list(projectId: string): Promise<CharacterRecord[]> {
    return this.rows.filter((r) => r.projectId === projectId);
  }

  async get(id: string): Promise<CharacterRecord | null> {
    return this.rows.find((r) => r.id === id) ?? null;
  }

  async insert(record: CharacterRecord): Promise<void> {
    this.rows.push({ ...record });
  }

  async update(
    id: string,
    patch: Partial<Pick<CharacterRecord, 'name' | 'aliasesJson' | 'profileJson' | 'confirmed' | 'manualProtected'>>,
  ): Promise<void> {
    const row = this.rows.find((r) => r.id === id);
    if (!row) throw new Error('不存在');
    Object.assign(row, patch, { updatedAt: Date.now() });
  }

  async delete(id: string): Promise<void> {
    this.rows = this.rows.filter((r) => r.id !== id);
  }
}

export class FakeGenerationStore implements GenerationStore {
  public jobs = new Map<string, GenerationJobRecord>();
  public segments = new Map<string, GenerationSegmentRecord[]>();

  async createJob(job: GenerationJobRecord, segments: Array<GenerationSegmentRecord>): Promise<void> {
    this.jobs.set(job.id, { ...job });
    this.segments.set(job.id, segments.map((s) => ({ ...s })));
  }

  async getJob(id: string): Promise<GenerationJobRecord | null> {
    return this.jobs.get(id) ?? null;
  }

  async findByInputHash(projectId: string, inputHash: string): Promise<GenerationJobRecord | null> {
    const list = [...this.jobs.values()]
      .filter((j) => j.projectId === projectId && j.inputHash === inputHash)
      .sort((a, b) => b.createdAt - a.createdAt);
    return list[0] ?? null;
  }

  async getActiveJobByChapter(projectId: string, chapterId: string): Promise<GenerationJobRecord | null> {
    return (
      [...this.jobs.values()].find(
        (j) => j.projectId === projectId && j.chapterId === chapterId && (j.status === 'pending' || j.status === 'running'),
      ) ?? null
    );
  }

  async listJobsByChapter(projectId: string, chapterId: string): Promise<GenerationJobRecord[]> {
    return [...this.jobs.values()].filter((j) => j.projectId === projectId && j.chapterId === chapterId);
  }

  async updateJob(
    id: string,
    patch: Partial<Pick<GenerationJobRecord, 'status' | 'progress' | 'error'>>,
  ): Promise<void> {
    const job = this.jobs.get(id);
    if (!job) throw new Error('job 不存在');
    Object.assign(job, patch, { updatedAt: Date.now() });
  }

  async listSegments(jobId: string): Promise<GenerationSegmentRecord[]> {
    return [...(this.segments.get(jobId) ?? [])];
  }

  async updateSegment(
    id: string,
    patch: Partial<Pick<GenerationSegmentRecord, 'status' | 'filePath' | 'error'>>,
  ): Promise<void> {
    for (const list of this.segments.values()) {
      const segment = list.find((s) => s.id === id);
      if (segment) {
        Object.assign(segment, patch, { updatedAt: Date.now() });
        return;
      }
    }
    throw new Error('segment 不存在');
  }

  async markInterruptedJobsFailed(): Promise<number> {
    let count = 0;
    for (const job of this.jobs.values()) {
      if (job.status === 'pending' || job.status === 'running') {
        job.status = 'failed';
        job.error = '应用重启中断';
        count += 1;
      }
    }
    return count;
  }
}

export class FakeRequestLogRepository implements RequestLogRepository {
  public rows: Array<{ kind: 'tts' | 'llm'; ok: boolean; note: string }> = [];

  async log(kind: 'tts' | 'llm', ok: boolean, note: string): Promise<void> {
    this.rows.push({ kind, ok, note });
  }

  async counts(): Promise<{ ttsOk: number; ttsFailed: number; llmOk: number; llmFailed: number }> {
    const counts = { ttsOk: 0, ttsFailed: 0, llmOk: 0, llmFailed: 0 };
    for (const row of this.rows) {
      if (row.kind === 'tts') {
        counts[row.ok ? 'ttsOk' : 'ttsFailed'] += 1;
      } else {
        counts[row.ok ? 'llmOk' : 'llmFailed'] += 1;
      }
    }
    return counts;
  }
}

export class FakeSettingsRepository implements SettingsRepository {
  public map = new Map<string, string>();

  async get(key: string): Promise<string | null> {
    return this.map.get(key) ?? null;
  }

  async set(key: string, value: string): Promise<void> {
    this.map.set(key, value);
  }

  async all(): Promise<Record<string, string>> {
    return Object.fromEntries(this.map);
  }
}

export class FakeLlmGateway implements LlmGateway {
  public calls: Array<{ system: string; user: string }> = [];
  public response: string | null = null;
  /** 分块流式：设置后按块回调 onDelta，块间等待 chunkDelayMs（模拟真实网络） */
  public streamChunks: string[] | null = null;
  public chunkDelayMs = 0;
  public error: Error | null = null;

  async complete(input: { system: string; user: string; onDelta?: (delta: string) => void }): Promise<string> {
    this.calls.push(input);
    if (this.error) throw this.error;
    const response = this.response ?? '{"characters":[]}';
    if (this.streamChunks !== null) {
      for (const chunk of this.streamChunks) {
        if (this.chunkDelayMs > 0) {
          await new Promise((resolve) => setTimeout(resolve, this.chunkDelayMs));
        }
        input.onDelta?.(chunk);
      }
      return this.streamChunks.join('');
    }
    input.onDelta?.(response);
    return response;
  }
}

export class FakeAudioPlayer implements AudioPlayer {
  public loaded: string[] = [];
  public plays = 0;
  public pauses = 0;
  public seeks: number[] = [];
  public released = 0;
  private progressCb: ((ms: number) => void) | null = null;
  private endCb: (() => void) | null = null;

  async load(uri: string): Promise<void> {
    this.loaded.push(uri);
  }

  async play(): Promise<void> {
    this.plays += 1;
  }

  async pause(): Promise<void> {
    this.pauses += 1;
  }

  async seek(positionMs: number): Promise<void> {
    this.seeks.push(positionMs);
  }

  onProgress(callback: (positionMs: number) => void): () => void {
    this.progressCb = callback;
    return () => {
      this.progressCb = null;
    };
  }

  onPlaybackEnd(callback: () => void): () => void {
    this.endCb = callback;
    return () => {
      this.endCb = null;
    };
  }

  release(): void {
    this.released += 1;
  }

  /** 测试辅助：模拟进度回调 */
  fireProgress(positionMs: number): void {
    this.progressCb?.(positionMs);
  }

  /** 测试辅助：模拟当前文件播放到结尾 */
  fireEnd(): void {
    this.endCb?.();
  }
}

export class FakeAssistantRepository implements AssistantRepository {
  public sessions = new Map<string, AssistantSessionRecord>();
  public messages: AssistantMessageRecord[] = [];

  async getOrCreateSession(projectId: string): Promise<AssistantSessionRecord> {
    const id = `sess-${projectId}`;
    let session = this.sessions.get(id);
    if (!session) {
      session = { id, projectId, taskKind: 'general', chapterId: null, createdAt: Date.now() };
      this.sessions.set(id, session);
    }
    return { ...session };
  }

  async listMessages(
    sessionId: string,
    options: { limit: number; beforeOrdinal?: number },
  ): Promise<AssistantMessageRecord[]> {
    const list = this.messages
      .filter((m) => m.sessionId === sessionId && (options.beforeOrdinal === undefined || m.ordinal < options.beforeOrdinal))
      .sort((a, b) => b.ordinal - a.ordinal)
      .slice(0, options.limit);
    return list.reverse().map((m) => ({ ...m }));
  }

  async appendMessage(record: AssistantMessageRecord): Promise<void> {
    if (this.messages.some((m) => m.id === record.id)) throw new Error('UNIQUE constraint failed');
    this.messages.push({ ...record });
  }

  async updateMessageParts(sessionId: string, ordinal: number, partsJson: string, nextVersion: number): Promise<void> {
    const message = this.messages.find((m) => m.sessionId === sessionId && m.ordinal === ordinal);
    if (!message) throw new Error('message 不存在');
    message.partsJson = partsJson;
    message.version = nextVersion;
  }

  async countMessages(sessionId: string): Promise<number> {
    return this.messages.filter((m) => m.sessionId === sessionId).length;
  }
}
