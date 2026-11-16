import type { AssistantMessageRecord, AssistantRepository, AssistantSessionRecord } from '@/domain/ports';

import type { TalecastDatabase } from '../db';

interface SessionRow {
  id: string;
  project_id: string;
  task_kind: string;
  chapter_id: string | null;
  created_at: number;
}

interface MessageRow {
  id: string;
  session_id: string;
  ordinal: number;
  role: string;
  parts_json: string;
  version: number;
  created_at: number;
}

function toSession(row: SessionRow): AssistantSessionRecord {
  return {
    id: row.id,
    projectId: row.project_id,
    taskKind: row.task_kind as AssistantSessionRecord['taskKind'],
    chapterId: row.chapter_id,
    createdAt: row.created_at,
  };
}

function toMessage(row: MessageRow): AssistantMessageRecord {
  return {
    id: row.id,
    sessionId: row.session_id,
    ordinal: row.ordinal,
    role: row.role as AssistantMessageRecord['role'],
    partsJson: row.parts_json,
    version: row.version,
    createdAt: row.created_at,
  };
}

/** 工程助手会话存储：单一会话（UNIQUE project+task），消息按序号写入 */
export class SqliteAssistantRepository implements AssistantRepository {
  constructor(private readonly db: TalecastDatabase) {}

  async getOrCreateSession(projectId: string): Promise<AssistantSessionRecord> {
    const existing = this.db.getFirstSync<SessionRow>(
      "SELECT * FROM assistant_sessions WHERE project_id = ? AND task_kind = 'general'",
      projectId,
    );
    if (existing) return toSession(existing);
    const id = `sess-${projectId}`;
    const now = Date.now();
    this.db.runSync(
      'INSERT OR IGNORE INTO assistant_sessions (id, project_id, task_kind, chapter_id, created_at) VALUES (?, ?, ?, NULL, ?)',
      id,
      projectId,
      'general',
      now,
    );
    const row = this.db.getFirstSync<SessionRow>('SELECT * FROM assistant_sessions WHERE id = ?', id);
    if (!row) throw new Error('助手会话创建失败');
    return toSession(row);
  }

  async listMessages(
    sessionId: string,
    options: { limit: number; beforeOrdinal?: number },
  ): Promise<AssistantMessageRecord[]> {
    const rows = options.beforeOrdinal !== undefined
      ? this.db.getAllSync<MessageRow>(
          'SELECT * FROM assistant_messages WHERE session_id = ? AND ordinal < ? ORDER BY ordinal DESC LIMIT ?',
          sessionId,
          options.beforeOrdinal,
          options.limit,
        )
      : this.db.getAllSync<MessageRow>(
          'SELECT * FROM assistant_messages WHERE session_id = ? ORDER BY ordinal DESC LIMIT ?',
          sessionId,
          options.limit,
        );
    return rows.reverse().map(toMessage);
  }

  async appendMessage(record: AssistantMessageRecord): Promise<void> {
    this.db.runSync(
      `INSERT INTO assistant_messages (id, session_id, ordinal, role, parts_json, version, created_at)
       VALUES (?, ?, ?, ?, ?, ?, ?)`,
      record.id,
      record.sessionId,
      record.ordinal,
      record.role,
      record.partsJson,
      record.version,
      record.createdAt,
    );
  }

  async updateMessageParts(sessionId: string, ordinal: number, partsJson: string, nextVersion: number): Promise<void> {
    this.db.runSync(
      'UPDATE assistant_messages SET parts_json = ?, version = ? WHERE session_id = ? AND ordinal = ?',
      partsJson,
      nextVersion,
      sessionId,
      ordinal,
    );
  }

  async countMessages(sessionId: string): Promise<number> {
    const row = this.db.getFirstSync<{ count: number }>(
      'SELECT COUNT(*) AS count FROM assistant_messages WHERE session_id = ?',
      sessionId,
    );
    return row?.count ?? 0;
  }
}
