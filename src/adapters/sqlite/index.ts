import { migrateDatabase, openDatabase } from './db';
import { SqliteProjectRepository } from './repos/projects';
import { SqliteReceiptStore } from './repos/receipts';

/** SQLite 适配器装配：打开 → 迁移 → 实现各仓储端口。仅由 container.tsx 调用。 */
export function createSqliteAdapters() {
  const db = openDatabase();
  migrateDatabase(db);

  return {
    projectRepository: new SqliteProjectRepository(db),
    receiptStore: new SqliteReceiptStore(db),
  };
}
