import type { AnnotationRepository } from '@/domain/ports';
import type { AnnotationRecord } from '@/domain/annotations';

import type { TalecastDatabase } from '../db';

interface AnnotationRow {
  id: string;
  project_id: string;
  chapter_id: string;
  start_offset: number;
  end_offset: number;
  kind: string;
  note: string;
  created_at: number;
  updated_at: number;
}

function toRecord(row: AnnotationRow): AnnotationRecord {
  return {
    id: row.id,
    projectId: row.project_id,
    chapterId: row.chapter_id,
    startOffset: row.start_offset,
    endOffset: row.end_offset,
    kind: 'underline',
    note: row.note,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

export class SqliteAnnotationRepository implements AnnotationRepository {
  constructor(private readonly db: TalecastDatabase) {}

  async list(projectId: string): Promise<AnnotationRecord[]> {
    const rows = this.db.getAllSync<AnnotationRow>(
      'SELECT * FROM annotations WHERE project_id = ? ORDER BY start_offset ASC',
      projectId,
    );
    return rows.map(toRecord);
  }

  async insert(record: AnnotationRecord): Promise<void> {
    this.db.runSync(
      `INSERT INTO annotations (id, project_id, chapter_id, start_offset, end_offset, kind, note, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      record.id,
      record.projectId,
      record.chapterId,
      record.startOffset,
      record.endOffset,
      record.kind,
      record.note,
      record.createdAt,
      record.updatedAt,
    );
  }

  async update(id: string, patch: { note?: string; kind?: 'underline' }): Promise<void> {
    const sets: string[] = [];
    const values: (string | number)[] = [];
    if (patch.note !== undefined) {
      sets.push('note = ?');
      values.push(patch.note);
    }
    if (patch.kind !== undefined) {
      sets.push('kind = ?');
      values.push(patch.kind);
    }
    if (sets.length === 0) return;
    sets.push('updated_at = ?');
    values.push(Date.now(), id);
    this.db.runSync(`UPDATE annotations SET ${sets.join(', ')} WHERE id = ?`, ...values);
  }

  async remove(id: string): Promise<void> {
    this.db.runSync('DELETE FROM annotations WHERE id = ?', id);
  }
}
