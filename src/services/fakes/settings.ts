import type { RequestLogRepository, SettingsRepository } from '@/domain/ports';

export class FakeRequestLogRepository implements RequestLogRepository {
  public rows: Array<{ kind: 'tts' | 'llm'; ok: boolean; note: string }> = [];

  async log(kind: 'tts' | 'llm', ok: boolean, note: string): Promise<void> {
    this.rows.push({ kind, ok, note });
  }

  async counts(): Promise<{ ttsOk: number; ttsFailed: number; llmOk: number; llmFailed: number }> {
    const counts = { ttsOk: 0, ttsFailed: 0, llmOk: 0, llmFailed: 0 };
    for (const row of this.rows) {
      if (row.kind === 'tts') {
        counts[row.ok ? 'ttsOk' : 'ttsFailed'] += 1;
      } else {
        counts[row.ok ? 'llmOk' : 'llmFailed'] += 1;
      }
    }
    return counts;
  }
}

export class FakeSettingsRepository implements SettingsRepository {
  public map = new Map<string, string>();

  async get(key: string): Promise<string | null> {
    return this.map.get(key) ?? null;
  }

  async set(key: string, value: string): Promise<void> {
    this.map.set(key, value);
  }

  async all(): Promise<Record<string, string>> {
    return Object.fromEntries(this.map);
  }
}
