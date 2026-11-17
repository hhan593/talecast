import type { ProposalStatus } from '@/domain/split';
import type { SplitProposalRecord, SplitProposalRepository } from '@/domain/ports';

import type { TalecastDatabase } from '../db';

interface ProposalRow {
  id: string;
  project_id: string;
  source_id: string;
  payload_json: string;
  previous_json: string;
  status: string;
  created_at: number;
  adopted_at: number | null;
}

function toRecord(row: ProposalRow): SplitProposalRecord {
  return {
    id: row.id,
    projectId: row.project_id,
    sourceId: row.source_id,
    payloadJson: row.payload_json,
    previousJson: row.previous_json,
    status: row.status as ProposalStatus,
    createdAt: row.created_at,
    adoptedAt: row.adopted_at,
  };
}

export class SqliteSplitProposalRepository implements SplitProposalRepository {
  constructor(private readonly db: TalecastDatabase) {}

  async insert(record: SplitProposalRecord): Promise<void> {
    this.db.runSync(
      `INSERT INTO split_proposals (id, project_id, source_id, payload_json, previous_json, status, created_at, adopted_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
      record.id,
      record.projectId,
      record.sourceId,
      record.payloadJson,
      record.previousJson,
      record.status,
      record.createdAt,
      record.adoptedAt,
    );
  }

  async get(id: string): Promise<SplitProposalRecord | null> {
    const row = this.db.getFirstSync<ProposalRow>(
      'SELECT * FROM split_proposals WHERE id = ?',
      id,
    );
    return row ? toRecord(row) : null;
  }

  async setStatus(id: string, status: ProposalStatus, adoptedAt: number | null): Promise<void> {
    this.db.runSync(
      'UPDATE split_proposals SET status = ?, adopted_at = ? WHERE id = ?',
      status,
      adoptedAt,
      id,
    );
  }

  async setPreviousJson(id: string, previousJson: string): Promise<void> {
    this.db.runSync(
      'UPDATE split_proposals SET previous_json = ? WHERE id = ?',
      previousJson,
      id,
    );
  }
}
