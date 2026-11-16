import type { ChapterEditRecord, ChapterEditRepository, ReadingState, ReadingStateRepository } from '@/domain/ports';

import type { TalecastDatabase } from '../db';

interface EditRow {
  id: string;
  project_id: string;
  chapter_id: string;
  kind: string;
  payload_json: string;
  revision: number;
  created_at: number;
}

function toEdit(row: EditRow): ChapterEditRecord {
  return {
    id: row.id,
    projectId: row.project_id,
    chapterId: row.chapter_id,
    kind: row.kind as ChapterEditRecord['kind'],
    payloadJson: row.payload_json,
    revision: row.revision,
    createdAt: row.created_at,
  };
}

export class SqliteChapterEditRepository implements ChapterEditRepository {
  constructor(private readonly db: TalecastDatabase) {}

  async insert(record: ChapterEditRecord): Promise<void> {
    this.db.runSync(
      `INSERT INTO chapter_edits (id, project_id, chapter_id, kind, payload_json, revision, created_at)
       VALUES (?, ?, ?, ?, ?, ?, ?)`,
      record.id,
      record.projectId,
      record.chapterId,
      record.kind,
      record.payloadJson,
      record.revision,
      record.createdAt,
    );
  }

  async listByProject(projectId: string): Promise<ChapterEditRecord[]> {
    const rows = this.db.getAllSync<EditRow>(
      'SELECT * FROM chapter_edits WHERE project_id = ? ORDER BY created_at DESC',
      projectId,
    );
    return rows.map(toEdit);
  }
}

interface ReadingStateRow {
  project_id: string;
  chapter_id: string;
  char_offset: number;
  updated_at: number;
}

export class SqliteReadingStateRepository implements ReadingStateRepository {
  constructor(private readonly db: TalecastDatabase) {}

  async get(projectId: string): Promise<ReadingState | null> {
    const row = this.db.getFirstSync<ReadingStateRow>(
      'SELECT * FROM reading_state WHERE project_id = ?',
      projectId,
    );
    return row
      ? {
          projectId: row.project_id,
          chapterId: row.chapter_id,
          charOffset: row.char_offset,
          updatedAt: row.updated_at,
        }
      : null;
  }

  async set(state: ReadingState): Promise<void> {
    this.db.runSync(
      `INSERT INTO reading_state (project_id, chapter_id, char_offset, updated_at)
       VALUES (?, ?, ?, ?)
       ON CONFLICT(project_id) DO UPDATE SET chapter_id = excluded.chapter_id,
         char_offset = excluded.char_offset, updated_at = excluded.updated_at`,
      state.projectId,
      state.chapterId,
      state.charOffset,
      state.updatedAt,
    );
  }
}
