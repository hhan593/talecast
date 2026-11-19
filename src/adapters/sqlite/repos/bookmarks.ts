import type { BookmarkRecord } from '@/domain/types';
import type { BookmarkRepository } from '@/domain/ports';

import type { TalecastDatabase } from '../db';

interface BookmarkRow {
  id: string;
  project_id: string;
  chapter_id: string;
  char_offset: number;
  excerpt: string;
  created_at: number;
}

function toRecord(row: BookmarkRow): BookmarkRecord {
  return {
    id: row.id,
    projectId: row.project_id,
    chapterId: row.chapter_id,
    charOffset: row.char_offset,
    excerpt: row.excerpt,
    createdAt: row.created_at,
  };
}

export class SqliteBookmarkRepository implements BookmarkRepository {
  constructor(private readonly db: TalecastDatabase) {}

  async list(projectId: string): Promise<BookmarkRecord[]> {
    const rows = this.db.getAllSync<BookmarkRow>(
      'SELECT * FROM bookmarks WHERE project_id = ? ORDER BY created_at DESC',
      projectId,
    );
    return rows.map(toRecord);
  }

  async add(record: BookmarkRecord): Promise<'added' | 'exists'> {
    const existing = this.db.getFirstSync<BookmarkRow>(
      'SELECT id FROM bookmarks WHERE project_id = ? AND chapter_id = ? AND char_offset = ?',
      record.projectId,
      record.chapterId,
      record.charOffset,
    );
    if (existing) return 'exists';
    this.db.runSync(
      `INSERT INTO bookmarks (id, project_id, chapter_id, char_offset, excerpt, created_at)
       VALUES (?, ?, ?, ?, ?, ?)`,
      record.id,
      record.projectId,
      record.chapterId,
      record.charOffset,
      record.excerpt,
      record.createdAt,
    );
    return 'added';
  }

  async remove(id: string): Promise<void> {
    this.db.runSync('DELETE FROM bookmarks WHERE id = ?', id);
  }
}
