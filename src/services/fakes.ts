import { bytesToBase64 } from '@/domain/base64';
import type { CommandReceipt } from '@/domain/commands';
import type { ChapterDraft } from '@/domain/split';
import type { Chapter, Project, SourceInfo } from '@/domain/types';
import type {
  ChapterEditRecord,
  ChapterEditRepository,
  FilePicker,
  LibraryRepository,
  ProjectRepository,
  ReceiptStore,
  SourceFileStore,
  SplitProposalRecord,
  SplitProposalRepository,
  ReadingState,
  ReadingStateRepository,
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

  async set(state: ReadingState): Promise<void> {
    this.rows.set(state.projectId, state);
  }
}

/** 测试辅助：文本 → bytes（走真实编码路径） */
export function textToBytes(text: string): Uint8Array {
  return new TextEncoder().encode(text);
}

export { bytesToBase64 };
