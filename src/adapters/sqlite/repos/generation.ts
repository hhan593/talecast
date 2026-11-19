import type { GenerationStore } from '@/domain/ports';
import type { JobStatus, SegmentStatus } from '@/domain/jobs';
import type { GenerationJobRecord, GenerationSegmentRecord } from '@/domain/types';

import type { TalecastDatabase } from '../db';

interface JobRow {
  id: string;
  project_id: string;
  chapter_id: string;
  status: string;
  provider: string;
  input_hash: string;
  voice_id: string;
  binding_revision: number;
  total_segments: number;
  progress: number;
  error: string | null;
  created_at: number;
  updated_at: number;
}

interface SegmentRow {
  id: string;
  job_id: string;
  ordinal: number;
  text: string;
  text_hash: string;
  status: string;
  file_path: string | null;
  error: string | null;
  updated_at: number;
}

function toJob(row: JobRow): GenerationJobRecord {
  return {
    id: row.id,
    projectId: row.project_id,
    chapterId: row.chapter_id,
    status: row.status as JobStatus,
    provider: row.provider,
    inputHash: row.input_hash,
    voiceId: row.voice_id,
    bindingRevision: row.binding_revision,
    totalSegments: row.total_segments,
    progress: row.progress,
    error: row.error,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

function toSegment(row: SegmentRow): GenerationSegmentRecord {
  return {
    id: row.id,
    jobId: row.job_id,
    ordinal: row.ordinal,
    text: row.text,
    textHash: row.text_hash,
    status: row.status as SegmentStatus,
    filePath: row.file_path,
    error: row.error,
    updatedAt: row.updated_at,
  };
}

export class SqliteGenerationStore implements GenerationStore {
  constructor(private readonly db: TalecastDatabase) {}

  async createJob(job: GenerationJobRecord, segments: Array<GenerationSegmentRecord>): Promise<void> {
    this.db.withTransactionSync(() => {
      this.db.runSync(
        `INSERT INTO generation_jobs (id, project_id, chapter_id, status, provider, input_hash, voice_id, binding_revision, total_segments, progress, error, created_at, updated_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        job.id,
        job.projectId,
        job.chapterId,
        job.status,
        job.provider,
        job.inputHash,
        job.voiceId,
        job.bindingRevision,
        job.totalSegments,
        job.progress,
        job.error,
        job.createdAt,
        job.updatedAt,
      );
      for (const segment of segments) {
        this.db.runSync(
          `INSERT INTO generation_segments (id, job_id, ordinal, text, text_hash, status, file_path, error, updated_at)
           VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
          segment.id,
          segment.jobId,
          segment.ordinal,
          segment.text,
          segment.textHash,
          segment.status,
          segment.filePath,
          segment.error,
          segment.updatedAt,
        );
      }
    });
  }

  async getJob(id: string): Promise<GenerationJobRecord | null> {
    const row = this.db.getFirstSync<JobRow>('SELECT * FROM generation_jobs WHERE id = ?', id);
    return row ? toJob(row) : null;
  }

  async findByInputHash(projectId: string, inputHash: string): Promise<GenerationJobRecord | null> {
    const row = this.db.getFirstSync<JobRow>(
      'SELECT * FROM generation_jobs WHERE project_id = ? AND input_hash = ? ORDER BY created_at DESC LIMIT 1',
      projectId,
      inputHash,
    );
    return row ? toJob(row) : null;
  }

  async getActiveJobByChapter(projectId: string, chapterId: string): Promise<GenerationJobRecord | null> {
    const row = this.db.getFirstSync<JobRow>(
      `SELECT * FROM generation_jobs WHERE project_id = ? AND chapter_id = ? AND status IN ('pending','running')
       ORDER BY created_at DESC LIMIT 1`,
      projectId,
      chapterId,
    );
    return row ? toJob(row) : null;
  }

  async listJobsByChapter(projectId: string, chapterId: string): Promise<GenerationJobRecord[]> {
    const rows = this.db.getAllSync<JobRow>(
      'SELECT * FROM generation_jobs WHERE project_id = ? AND chapter_id = ? ORDER BY created_at DESC',
      projectId,
      chapterId,
    );
    return rows.map(toJob);
  }

  async updateJob(
    id: string,
    patch: Partial<Pick<GenerationJobRecord, 'status' | 'progress' | 'error'>>,
  ): Promise<void> {
    // 单语句部分更新（issue #21）：生成热循环每段只发一条写
    const sets: string[] = [];
    const values: (string | number | null)[] = [];
    if (patch.status !== undefined) {
      sets.push('status = ?');
      values.push(patch.status);
    }
    if (patch.progress !== undefined) {
      sets.push('progress = ?');
      values.push(patch.progress);
    }
    if (patch.error !== undefined) {
      sets.push('error = ?');
      values.push(patch.error);
    }
    sets.push('updated_at = ?');
    values.push(Date.now(), id);
    this.db.runSync(`UPDATE generation_jobs SET ${sets.join(', ')} WHERE id = ?`, ...values, );
  }

  async listSegments(jobId: string): Promise<GenerationSegmentRecord[]> {
    const rows = this.db.getAllSync<SegmentRow>(
      'SELECT * FROM generation_segments WHERE job_id = ? ORDER BY ordinal ASC',
      jobId,
    );
    return rows.map(toSegment);
  }

  async updateSegment(
    id: string,
    patch: Partial<Pick<GenerationSegmentRecord, 'status' | 'filePath' | 'error'>>,
  ): Promise<void> {
    // 单语句部分更新（issue #21）
    const sets: string[] = [];
    const values: (string | number | null)[] = [];
    if (patch.status !== undefined) {
      sets.push('status = ?');
      values.push(patch.status);
    }
    if (patch.filePath !== undefined) {
      sets.push('file_path = ?');
      values.push(patch.filePath);
    }
    if (patch.error !== undefined) {
      sets.push('error = ?');
      values.push(patch.error);
    }
    sets.push('updated_at = ?');
    values.push(Date.now(), id);
    this.db.runSync(`UPDATE generation_segments SET ${sets.join(', ')} WHERE id = ?`, ...values);
  }

  async markInterruptedJobsFailed(): Promise<number> {
    const now = Date.now();
    this.db.runSync(
      `UPDATE generation_jobs SET status = 'failed', error = '应用重启中断了本次生成；已完成段已保留，重试只补缺失段', updated_at = ?
       WHERE status IN ('pending','running')`,
      now,
    );
    const row = this.db.getFirstSync<{ changes: number }>('SELECT changes() AS changes');
    return row?.changes ?? 0;
  }
}
