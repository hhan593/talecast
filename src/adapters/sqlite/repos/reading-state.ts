import type { ReadingState, ReadingStateRepository } from '@/domain/ports';

import type { TalecastDatabase } from '../db';

interface ReadingStateRow {
  project_id: string;
  chapter_id: string | null;
  char_offset: number | null;
  audio_segment_ordinal: number | null;
  audio_offset_ms: number | null;
  reader_mode: string;
  font_size: string;
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
          charOffset: row.char_offset,
          audioSegmentOrdinal: row.audio_segment_ordinal,
          audioOffsetMs: row.audio_offset_ms,
          // 预置行用空串占位（chapter_id 是 NOT NULL）：空串对上层等价于「还没有位置」
          chapterId: row.chapter_id === '' ? null : row.chapter_id,
          readerMode: row.reader_mode as ReadingState['readerMode'],
          fontSize: row.font_size as ReadingState['fontSize'],
          updatedAt: row.updated_at,
        }
      : null;
  }

  /**
   * 部分更新：未提供的字段保留旧值（文本位置/音频位置/偏好互不覆盖）。
   *
   * 注意：chapter_id / reader_mode / font_size 都是 NOT NULL（后者带 DEFAULT），
   * 而保存「只有偏好」的状态时 chapter_id 为 null——直接 INSERT 会触发 NOT NULL 约束，
   * 整行写不进去（ON CONFLICT 的 UPDATE 分支根本轮不到）。所以先 INSERT OR IGNORE
   * 用空串占位把行建出来，再用一条 UPDATE + COALESCE 做真正的部分更新。
   */
  async set(state: Omit<ReadingState, 'updatedAt'>): Promise<void> {
    const now = Date.now();
    this.db.runSync(
      `INSERT OR IGNORE INTO reading_state (project_id, chapter_id, char_offset, updated_at)
       VALUES (?, '', 0, ?)`,
      state.projectId,
      now,
    );
    this.db.runSync(
      `UPDATE reading_state SET
         chapter_id = COALESCE(?, chapter_id),
         char_offset = COALESCE(?, char_offset),
         audio_segment_ordinal = COALESCE(?, audio_segment_ordinal),
         audio_offset_ms = COALESCE(?, audio_offset_ms),
         reader_mode = COALESCE(?, reader_mode),
         font_size = COALESCE(?, font_size),
         updated_at = ?
       WHERE project_id = ?`,
      state.chapterId ?? null,
      state.charOffset ?? null,
      state.audioSegmentOrdinal ?? null,
      state.audioOffsetMs ?? null,
      state.readerMode ?? null,
      state.fontSize ?? null,
      now,
      state.projectId,
    );
  }
}
