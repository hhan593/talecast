import { migrateDatabase, openDatabase } from './db';
import { SqliteAssistantRepository } from './repos/assistant';
import { SqliteGenerationStore, SqliteBindingRepository, SqliteCharacterRepository, SqliteVoiceRepository } from './repos/generation';
import { SqliteLibraryRepository } from './repos/library';
import { SqliteReadingStateRepository } from './repos/misc';
import { SqliteProjectRepository } from './repos/projects';
import { SqliteReceiptStore } from './repos/receipts';
import { SqliteRequestLogRepository, SqliteSettingsRepository } from './repos/settings';
import { SqliteSplitProposalRepository } from './repos/proposals';

/** SQLite 适配器装配：打开 → 迁移 → 实现各仓储端口。仅由 container.tsx 调用。 */
export function createSqliteAdapters() {
  const db = openDatabase();
  migrateDatabase(db);

  return {
    projectRepository: new SqliteProjectRepository(db),
    receiptStore: new SqliteReceiptStore(db),
    libraryRepository: new SqliteLibraryRepository(db),
    splitProposalRepository: new SqliteSplitProposalRepository(db),
    readingStateRepository: new SqliteReadingStateRepository(db),
    voiceRepository: new SqliteVoiceRepository(db),
    characterRepository: new SqliteCharacterRepository(db),
    bindingRepository: new SqliteBindingRepository(db),
    generationStore: new SqliteGenerationStore(db),
    settingsRepository: new SqliteSettingsRepository(db),
    requestLogRepository: new SqliteRequestLogRepository(db),
    assistantRepository: new SqliteAssistantRepository(db),
  };
}
