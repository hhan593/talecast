import * as SQLite from 'expo-sqlite';

import { migrateDatabase } from './schema';

import type { TalecastDatabase } from './schema';

export type { TalecastDatabase };
export { LATEST_SCHEMA_VERSION, MIGRATIONS, migrateDatabase, type Migration } from './schema';

const DATABASE_NAME = 'talecast.db';

export function openDatabase(): TalecastDatabase {
  return SQLite.openDatabaseSync(DATABASE_NAME);
}

// 迁移在首次打开时执行（container 装配期）：openDatabase → migrateDatabase
export function openAndMigrateDatabase(): TalecastDatabase {
  const db = openDatabase();
  migrateDatabase(db);
  return db;
}
