import type { RequestLogRepository, SettingsRepository } from '@/domain/ports';

import type { TalecastDatabase } from '../db';

interface SettingRow {
  key: string;
  value: string;
}

/** 非敏感设置的 SQLite 存储（端点、模型名）；密钥一律走 SecureStore（KeyStore） */
export class SqliteSettingsRepository implements SettingsRepository {
  constructor(private readonly db: TalecastDatabase) {}

  async get(key: string): Promise<string | null> {
    const row = this.db.getFirstSync<SettingRow>('SELECT value FROM settings WHERE key = ?', key);
    return row?.value ?? null;
  }

  async set(key: string, value: string): Promise<void> {
    this.db.runSync(
      'INSERT INTO settings (key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value',
      key,
      value,
    );
  }

  async all(): Promise<Record<string, string>> {
    const rows = this.db.getAllSync<SettingRow>('SELECT * FROM settings');
    return Object.fromEntries(rows.map((row) => [row.key, row.value]));
  }
}

interface LogRow {
  kind: string;
  ok: number;
}

export class SqliteRequestLogRepository implements RequestLogRepository {
  constructor(private readonly db: TalecastDatabase) {}

  async log(kind: 'tts' | 'llm', ok: boolean, note: string): Promise<void> {
    this.db.runSync(
      'INSERT INTO provider_requests (id, kind, ok, note, created_at) VALUES (?, ?, ?, ?, ?)',
      `req-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
      kind,
      ok ? 1 : 0,
      note,
      Date.now(),
    );
  }

  async counts(): Promise<{ ttsOk: number; ttsFailed: number; llmOk: number; llmFailed: number }> {
    const rows = this.db.getAllSync<LogRow>('SELECT kind, ok FROM provider_requests');
    let ttsOk = 0;
    let ttsFailed = 0;
    let llmOk = 0;
    let llmFailed = 0;
    for (const row of rows) {
      if (row.kind === 'tts') {
        if (row.ok === 1) ttsOk += 1;
        else ttsFailed += 1;
      } else if (row.ok === 1) {
        llmOk += 1;
      } else {
        llmFailed += 1;
      }
    }
    return { ttsOk, ttsFailed, llmOk, llmFailed };
  }
}
