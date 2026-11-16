import { migrateDatabase, openDatabase } from './db';
import { SqliteLibraryRepository } from './repos/library';
import { SqliteChapterEditRepository, SqliteReadingStateRepository } from './repos/misc';
import { SqliteProjectRepository } from './repos/projects';
import { SqliteReceiptStore } from './repos/receipts';
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
    chapterEditRepository: new SqliteChapterEditRepository(db),
    readingStateRepository: new SqliteReadingStateRepository(db),
  };
}
