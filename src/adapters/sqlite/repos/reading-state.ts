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
          chapterId: row.chapter_id,
          charOffset: row.char_offset,
          audioSegmentOrdinal: row.audio_segment_ordinal,
          audioOffsetMs: row.audio_offset_ms,
          readerMode: row.reader_mode as ReadingState['readerMode'],
          fontSize: row.font_size as ReadingState['fontSize'],
          updatedAt: row.updated_at,
        }
      : null;
  }

  /** 部分更新：未提供的字段 COALESCE 保留旧值（文本位置/音频位置/偏好互不覆盖） */
  async set(state: Omit<ReadingState, 'updatedAt'>): Promise<void> {
    this.db.runSync(
      `INSERT INTO reading_state (project_id, chapter_id, char_offset, audio_segment_ordinal, audio_offset_ms, reader_mode, font_size, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?)
       ON CONFLICT(project_id) DO UPDATE SET
         chapter_id = COALESCE(excluded.chapter_id, chapter_id),
         char_offset = COALESCE(excluded.char_offset, char_offset),
         audio_segment_ordinal = COALESCE(excluded.audio_segment_ordinal, audio_segment_ordinal),
         audio_offset_ms = COALESCE(excluded.audio_offset_ms, audio_offset_ms),
         reader_mode = COALESCE(excluded.reader_mode, reader_mode),
         font_size = COALESCE(excluded.font_size, font_size),
         updated_at = excluded.updated_at`,
      state.projectId,
      state.chapterId ?? null,
      state.charOffset ?? null,
      state.audioSegmentOrdinal ?? null,
      state.audioOffsetMs ?? null,
      state.readerMode ?? null,
      state.fontSize ?? null,
      Date.now(),
    );
  }
}
