import type { BindingRepository, CharacterRepository, GenerationStore, VoiceRecordRepository } from '@/domain/ports';
import type { JobStatus, SegmentStatus } from '@/domain/jobs';
import type {
  BindingRecord,
  BindingTargetType,
  CharacterRecord,
  GenerationJobRecord,
  GenerationSegmentRecord,
  VoiceRecord,
} from '@/domain/types';

import type { TalecastDatabase } from '../db';

// ---------------------------------------------------------------------------
// 音色快照
// ---------------------------------------------------------------------------

interface VoiceRow {
  id: string;
  provider: string;
  voice_id: string;
  name: string;
  description: string;
}

export class SqliteVoiceRepository implements VoiceRecordRepository {
  constructor(private readonly db: TalecastDatabase) {}

  async replaceAllForProvider(provider: string, voices: Array<Omit<VoiceRecord, 'id'>>): Promise<void> {
    this.db.withTransactionSync(() => {
      this.db.runSync('DELETE FROM voices WHERE provider = ?', provider);
      for (const voice of voices) {
        this.db.runSync(
          'INSERT OR IGNORE INTO voices (id, provider, voice_id, name, description) VALUES (?, ?, ?, ?, ?)',
          `voice-${provider}-${voice.voiceId}`,
          provider,
          voice.voiceId,
          voice.name,
          voice.description,
        );
      }
    });
  }

  async list(provider: string): Promise<VoiceRecord[]> {
    const rows = this.db.getAllSync<VoiceRow>(
      'SELECT * FROM voices WHERE provider = ? ORDER BY voice_id ASC',
      provider,
    );
    return rows.map((row) => ({
      id: row.id,
      provider: row.provider,
      voiceId: row.voice_id,
      name: row.name,
      description: row.description,
    }));
  }

  async findByVoiceId(provider: string, voiceId: string): Promise<VoiceRecord | null> {
    const row = this.db.getFirstSync<VoiceRow>(
      'SELECT * FROM voices WHERE provider = ? AND voice_id = ?',
      provider,
      voiceId,
    );
    return row
      ? { id: row.id, provider: row.provider, voiceId: row.voice_id, name: row.name, description: row.description }
      : null;
  }
}

// ---------------------------------------------------------------------------
// 角色
// ---------------------------------------------------------------------------

interface CharacterRow {
  id: string;
  project_id: string;
  name: string;
  aliases_json: string;
  profile_json: string;
  confirmed: number;
  manual_protected: number;
  created_at: number;
  updated_at: number;
}

function toCharacter(row: CharacterRow): CharacterRecord {
  return {
    id: row.id,
    projectId: row.project_id,
    name: row.name,
    aliasesJson: row.aliases_json,
    profileJson: row.profile_json,
    confirmed: row.confirmed === 1,
    manualProtected: row.manual_protected === 1,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

export class SqliteCharacterRepository implements CharacterRepository {
  constructor(private readonly db: TalecastDatabase) {}

  async list(projectId: string): Promise<CharacterRecord[]> {
    const rows = this.db.getAllSync<CharacterRow>(
      'SELECT * FROM characters WHERE project_id = ? ORDER BY created_at ASC',
      projectId,
    );
    return rows.map(toCharacter);
  }

  async get(id: string): Promise<CharacterRecord | null> {
    const row = this.db.getFirstSync<CharacterRow>('SELECT * FROM characters WHERE id = ?', id);
    return row ? toCharacter(row) : null;
  }

  async insert(record: CharacterRecord): Promise<void> {
    this.db.runSync(
      `INSERT INTO characters (id, project_id, name, aliases_json, profile_json, confirmed, manual_protected, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      record.id,
      record.projectId,
      record.name,
      record.aliasesJson,
      record.profileJson,
      record.confirmed ? 1 : 0,
      record.manualProtected ? 1 : 0,
      record.createdAt,
      record.updatedAt,
    );
  }

  async update(
    id: string,
    patch: Partial<Pick<CharacterRecord, 'name' | 'aliasesJson' | 'profileJson' | 'confirmed' | 'manualProtected'>>,
  ): Promise<void> {
    if (patch.name !== undefined) {
      this.db.runSync('UPDATE characters SET name = ?, updated_at = ? WHERE id = ?', patch.name, Date.now(), id);
    }
    if (patch.aliasesJson !== undefined) {
      this.db.runSync('UPDATE characters SET aliases_json = ?, updated_at = ? WHERE id = ?', patch.aliasesJson, Date.now(), id);
    }
    if (patch.profileJson !== undefined) {
      this.db.runSync('UPDATE characters SET profile_json = ?, updated_at = ? WHERE id = ?', patch.profileJson, Date.now(), id);
    }
    if (patch.confirmed !== undefined) {
      this.db.runSync('UPDATE characters SET confirmed = ?, updated_at = ? WHERE id = ?', patch.confirmed ? 1 : 0, Date.now(), id);
    }
    if (patch.manualProtected !== undefined) {
      this.db.runSync('UPDATE characters SET manual_protected = ?, updated_at = ? WHERE id = ?', patch.manualProtected ? 1 : 0, Date.now(), id);
    }
  }

  async delete(id: string): Promise<void> {
    this.db.runSync('DELETE FROM characters WHERE id = ?', id);
  }
}

// ---------------------------------------------------------------------------
// 绑定
// ---------------------------------------------------------------------------

interface BindingRow {
  id: string;
  project_id: string;
  target_type: string;
  target_id: string | null;
  voice_id: string;
  revision: number;
  updated_at: number;
}

function toBinding(row: BindingRow): BindingRecord {
  return {
    id: row.id,
    projectId: row.project_id,
    targetType: row.target_type as BindingTargetType,
    targetId: row.target_id,
    voiceId: row.voice_id,
    revision: row.revision,
    updatedAt: row.updated_at,
  };
}

export class SqliteBindingRepository implements BindingRepository {
  constructor(private readonly db: TalecastDatabase) {}

  async getForTarget(projectId: string, targetType: BindingTargetType, targetId: string | null): Promise<BindingRecord | null> {
    const row = this.db.getFirstSync<BindingRow>(
      'SELECT * FROM bindings WHERE project_id = ? AND target_type = ? AND target_id IS ?',
      projectId,
      targetType,
      targetId,
    );
    return row ? toBinding(row) : null;
  }

  async list(projectId: string): Promise<BindingRecord[]> {
    const rows = this.db.getAllSync<BindingRow>(
      'SELECT * FROM bindings WHERE project_id = ? ORDER BY updated_at DESC',
      projectId,
    );
    return rows.map(toBinding);
  }

  async upsert(record: Omit<BindingRecord, 'id' | 'revision' | 'updatedAt'>): Promise<BindingRecord> {
    const now = Date.now();
    this.db.runSync(
      `INSERT INTO bindings (id, project_id, target_type, target_id, voice_id, revision, updated_at)
       VALUES (?, ?, ?, ?, ?, 1, ?)
       ON CONFLICT(project_id, target_type, target_id) DO UPDATE SET
         voice_id = excluded.voice_id, revision = revision + 1, updated_at = excluded.updated_at`,
      `bind-${record.projectId}-${record.targetType}-${record.targetId ?? 'narrator'}`,
      record.projectId,
      record.targetType,
      record.targetId,
      record.voiceId,
      now,
    );
    const row = this.db.getFirstSync<BindingRow>(
      'SELECT * FROM bindings WHERE project_id = ? AND target_type = ? AND target_id IS ?',
      record.projectId,
      record.targetType,
      record.targetId,
    );
    if (!row) throw new Error('绑定写入失败');
    return toBinding(row);
  }
}

// ---------------------------------------------------------------------------
// 生成任务与段
// ---------------------------------------------------------------------------

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
    if (patch.status !== undefined) {
      this.db.runSync('UPDATE generation_jobs SET status = ?, updated_at = ? WHERE id = ?', patch.status, Date.now(), id);
    }
    if (patch.progress !== undefined) {
      this.db.runSync('UPDATE generation_jobs SET progress = ?, updated_at = ? WHERE id = ?', patch.progress, Date.now(), id);
    }
    if (patch.error !== undefined) {
      this.db.runSync('UPDATE generation_jobs SET error = ?, updated_at = ? WHERE id = ?', patch.error, Date.now(), id);
    }
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
    if (patch.status !== undefined) {
      this.db.runSync('UPDATE generation_segments SET status = ?, updated_at = ? WHERE id = ?', patch.status, Date.now(), id);
    }
    if (patch.filePath !== undefined) {
      this.db.runSync('UPDATE generation_segments SET file_path = ?, updated_at = ? WHERE id = ?', patch.filePath, Date.now(), id);
    }
    if (patch.error !== undefined) {
      this.db.runSync('UPDATE generation_segments SET error = ?, updated_at = ? WHERE id = ?', patch.error, Date.now(), id);
    }
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
