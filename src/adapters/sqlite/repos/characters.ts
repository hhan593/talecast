import type { CharacterRepository } from '@/domain/ports';
import type { CharacterRecord } from '@/domain/types';

import type { TalecastDatabase } from '../db';

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
