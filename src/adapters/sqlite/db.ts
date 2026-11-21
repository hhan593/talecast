import * as SQLite from 'expo-sqlite';

import { migrateDatabase } from './schema';

import type { TalecastDatabase } from './schema';

export type { TalecastDatabase };
export { LATEST_SCHEMA_VERSION, MIGRATIONS, migrateDatabase, type Migration } from './schema';

const DATABASE_NAME = 'talecast.db';

export function openDatabase(): TalecastDatabase {
  return SQLite.openDatabaseSync(DATABASE_NAME);
}

/** web 专用（issue #93）：worker 异步加载，await 本方法即完成预热；
 * 之后的同步 openDatabase 就绪可用。原生端与 openDatabase 等价。 */
export async function openDatabaseAsync(): Promise<TalecastDatabase> {
  return SQLite.openDatabaseAsync(DATABASE_NAME);
}

// 迁移在首次打开时执行（container 装配期）：openDatabase → migrateDatabase
export function openAndMigrateDatabase(): TalecastDatabase {
  const db = openDatabase();
  migrateDatabase(db);
  return db;
}
