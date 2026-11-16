import type { ChapterDraft } from '@/domain/split';
import type { LibraryRepository } from '@/domain/ports';
import type { Chapter, Project, SourceInfo } from '@/domain/types';

import type { TalecastDatabase } from '../db';

interface SourceRow {
  id: string;
  project_id: string;
  filename: string;
  encoding: string;
  raw_sha256: string;
  text_sha256: string;
  byte_size: number;
  created_at: number;
}

interface ChapterRow {
  id: string;
  project_id: string;
  source_id: string;
  title: string;
  start_offset: number;
  end_offset: number;
  volume: number;
  ordinal: number;
  heading_line: number | null;
}

interface ProjectRow {
  id: string;
  title: string;
  description: string;
  revision: number;
  created_at: number;
  updated_at: number;
}

function toSource(row: SourceRow): SourceInfo {
  return {
    id: row.id,
    projectId: row.project_id,
    filename: row.filename,
    encoding: row.encoding as SourceInfo['encoding'],
    rawSha256: row.raw_sha256,
    textSha256: row.text_sha256,
    byteSize: row.byte_size,
    createdAt: row.created_at,
  };
}

function toChapter(row: ChapterRow): Chapter {
  return {
    id: row.id,
    projectId: row.project_id,
    sourceId: row.source_id,
    title: row.title,
    startOffset: row.start_offset,
    endOffset: row.end_offset,
    volume: row.volume,
    ordinal: row.ordinal,
    headingLine: row.heading_line,
  };
}

function toProject(row: ProjectRow): Project {
  return {
    id: row.id,
    title: row.title,
    description: row.description,
    revision: row.revision,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

function getProjectSync(db: TalecastDatabase, id: string): Project {
  const row = db.getFirstSync<ProjectRow>('SELECT * FROM projects WHERE id = ?', id);
  if (!row) throw new Error(`工程不存在：${id}`);
  return toProject(row);
}

function insertChaptersSync(db: TalecastDatabase, projectId: string, sourceId: string, drafts: ChapterDraft[]): void {
  for (let ordinal = 0; ordinal < drafts.length; ordinal++) {
    const draft = drafts[ordinal];
    db.runSync(
      `INSERT INTO chapters (id, project_id, source_id, title, start_offset, end_offset, volume, ordinal, heading_line)
       VALUES (?, ?, ?, ?, ?, ?, 0, ?, ?)`,
      `ch-${projectId}-${ordinal}-${draft.startOffset}`,
      projectId,
      sourceId,
      draft.title,
      draft.startOffset,
      draft.endOffset,
      ordinal,
      draft.headingLine,
    );
  }
}

/**
 * 来源与章节存储（LibraryRepository 的 SQLite 实现）。
 * 所有跨表写都在同一事务内：来源+初始章节 / 整体替换+revision 推进 / 单章编辑+审计+revision 推进。
 */
export class SqliteLibraryRepository implements LibraryRepository {
  constructor(private readonly db: TalecastDatabase) {}

  async createSourceWithChapters(
    source: Omit<SourceInfo, 'id'> & { id: string },
    drafts: ChapterDraft[],
  ): Promise<SourceInfo> {
    this.db.withTransactionSync(() => {
      this.db.runSync(
        `INSERT INTO sources (id, project_id, filename, encoding, raw_sha256, text_sha256, byte_size, created_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
        source.id,
        source.projectId,
        source.filename,
        source.encoding,
        source.rawSha256,
        source.textSha256,
        source.byteSize,
        source.createdAt,
      );
      insertChaptersSync(this.db, source.projectId, source.id, drafts);
    });
    return source;
  }

  async getSource(projectId: string): Promise<SourceInfo | null> {
    const row = this.db.getFirstSync<SourceRow>(
      'SELECT * FROM sources WHERE project_id = ? ORDER BY created_at DESC LIMIT 1',
      projectId,
    );
    return row ? toSource(row) : null;
  }

  async listChapters(projectId: string): Promise<Chapter[]> {
    const rows = this.db.getAllSync<ChapterRow>(
      'SELECT * FROM chapters WHERE project_id = ? ORDER BY ordinal ASC',
      projectId,
    );
    return rows.map(toChapter);
  }

  async replaceChapters(
    projectId: string,
    sourceId: string,
    drafts: ChapterDraft[],
    options: { bumpRevision: boolean },
  ): Promise<Project> {
    const now = Date.now();
    this.db.withTransactionSync(() => {
      this.db.runSync('DELETE FROM chapters WHERE project_id = ?', projectId);
      insertChaptersSync(this.db, projectId, sourceId, drafts);
      if (options.bumpRevision) {
        this.db.runSync(
          'UPDATE projects SET revision = revision + 1, updated_at = ? WHERE id = ?',
          now,
          projectId,
        );
      }
    });
    return getProjectSync(this.db, projectId);
  }

  async mutateChapters(
    projectId: string,
    edit: { kind: string; chapterId: string; payload: Record<string, unknown> },
    mutate: (chapters: Chapter[]) => Chapter[],
  ): Promise<{ chapters: Chapter[]; project: Project }> {
    const now = Date.now();
    let chapters: Chapter[] = [];
    this.db.withTransactionSync(() => {
      const rows = this.db.getAllSync<ChapterRow>(
        'SELECT * FROM chapters WHERE project_id = ? ORDER BY ordinal ASC',
        projectId,
      );
      chapters = mutate(rows.map(toChapter));
      this.db.runSync('DELETE FROM chapters WHERE project_id = ?', projectId);
      for (const chapter of chapters) {
        this.db.runSync(
          `INSERT INTO chapters (id, project_id, source_id, title, start_offset, end_offset, volume, ordinal, heading_line)
           VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
          chapter.id,
          chapter.projectId,
          chapter.sourceId,
          chapter.title,
          chapter.startOffset,
          chapter.endOffset,
          chapter.volume,
          chapter.ordinal,
          chapter.headingLine,
        );
      }
      this.db.runSync(
        `INSERT INTO chapter_edits (id, project_id, chapter_id, kind, payload_json, revision, created_at)
         VALUES (?, ?, ?, ?, ?, ?, ?)`,
        `edit-${now}-${Math.random().toString(36).slice(2, 8)}`,
        projectId,
        edit.chapterId,
        edit.kind,
        JSON.stringify(edit.payload),
        // mutation 结束后读取 revision（mutate 闭包内不能写库），用当前值 +1 记账
        this.getFirstSyncRevision(projectId) + 1,
        now,
      );
      this.db.runSync(
        'UPDATE projects SET revision = revision + 1, updated_at = ? WHERE id = ?',
        now,
        projectId,
      );
    });
    return { chapters, project: getProjectSync(this.db, projectId) };
  }

  private getFirstSyncRevision(projectId: string): number {
    const row = this.db.getFirstSync<{ revision: number }>(
      'SELECT revision FROM projects WHERE id = ?',
      projectId,
    );
    return row?.revision ?? 0;
  }
}
