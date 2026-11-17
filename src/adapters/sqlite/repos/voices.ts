import type { VoiceRecordRepository } from '@/domain/ports';
import type { VoiceRecord } from '@/domain/types';

import type { TalecastDatabase } from '../db';

interface VoiceRow {
  id: string;
  provider: string;
  voice_id: string;
  name: string;
  description: string;
}

function toVoice(row: VoiceRow): VoiceRecord {
  return {
    id: row.id,
    provider: row.provider,
    voiceId: row.voice_id,
    name: row.name,
    description: row.description,
  };
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
    return rows.map(toVoice);
  }

}
