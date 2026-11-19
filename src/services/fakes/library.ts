import { utf8Bytes } from '@/domain/hash';
import type { ChapterDraft } from '@/domain/split';
import type {
  Chapter,
  GenerationJobRecord,
  GenerationSegmentRecord,
  Project,
  SourceInfo,
} from '@/domain/types';
import type {
  ChapterEditKind,
  FilePicker,
  LibraryRepository,
  ReadingState,
  ReadingStateRepository,
  SourceFileStore,
  SplitProposalRecord,
  SplitProposalRepository,
} from '@/domain/ports';

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
    if (!project) throw new Error('书籍不存在');
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
    if (!project) throw new Error('书籍不存在');
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
      readerMode: state.readerMode ?? existing?.readerMode ?? null,
      fontSize: state.fontSize ?? existing?.fontSize ?? null,
      updatedAt: Date.now(),
    };
    this.rows.set(state.projectId, merged);
  }
}

/** 测试辅助：文本 → bytes（走真实编码路径） */
export const textToBytes = utf8Bytes;
