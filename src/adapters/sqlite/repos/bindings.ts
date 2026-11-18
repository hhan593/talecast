import type { BindingRepository } from '@/domain/ports';
import type { BindingRecord, BindingTargetType } from '@/domain/types';

import type { TalecastDatabase } from '../db';

interface BindingRow {
  id: string;
  project_id: string;
  target_type: string;
  target_id: string | null;
  voice_id: string;
  provider_params_json: string;
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
    providerParamsJson: row.provider_params_json,
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
      `INSERT INTO bindings (id, project_id, target_type, target_id, voice_id, provider_params_json, revision, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, 1, ?)
       ON CONFLICT(project_id, target_type, target_id) DO UPDATE SET
         voice_id = excluded.voice_id, provider_params_json = excluded.provider_params_json,
         revision = revision + 1, updated_at = excluded.updated_at`,
      `bind-${record.projectId}-${record.targetType}-${record.targetId ?? 'narrator'}`,
      record.projectId,
      record.targetType,
      record.targetId,
      record.voiceId,
      record.providerParamsJson,
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
