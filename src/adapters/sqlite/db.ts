import * as SQLite from 'expo-sqlite';

/**
 * SQLite 打开与迁移（docs/plan.md 5.2）。
 * 版本策略：user_version 标识结构版本，只前进不降级；
 * 遇到高于本应用支持的版本直接拒绝并提示，不做自动迁移、不删除用户数据。
 */

export type TalecastDatabase = SQLite.SQLiteDatabase;

const DATABASE_NAME = 'talecast.db';

export function openDatabase(): TalecastDatabase {
  return SQLite.openDatabaseSync(DATABASE_NAME);
}

export interface Migration {
  version: number;
  description: string;
  statements: string[];
}

export const MIGRATIONS: Migration[] = [
  {
    version: 1,
    description: 'projects 与 command_receipts 基础表',
    statements: [
      `CREATE TABLE IF NOT EXISTS projects (
        id TEXT PRIMARY KEY NOT NULL,
        title TEXT NOT NULL,
        description TEXT NOT NULL DEFAULT '',
        revision INTEGER NOT NULL DEFAULT 0,
        created_at INTEGER NOT NULL,
        updated_at INTEGER NOT NULL
      )`,
      `CREATE TABLE IF NOT EXISTS command_receipts (
        command_id TEXT PRIMARY KEY NOT NULL,
        result_json TEXT NOT NULL,
        created_at INTEGER NOT NULL
      )`,
    ],
  },
];

export const LATEST_SCHEMA_VERSION = MIGRATIONS[MIGRATIONS.length - 1]?.version ?? 0;

export function migrateDatabase(db: TalecastDatabase): void {
  const row = db.getFirstSync<{ user_version: number }>('PRAGMA user_version');
  const current = row?.user_version ?? 0;

  if (current > LATEST_SCHEMA_VERSION) {
    throw new Error(
      `数据库版本 v${current} 高于本应用支持的最高版本 v${LATEST_SCHEMA_VERSION}；为保护数据不自动降级，请升级应用后重试`,
    );
  }

  for (const migration of MIGRATIONS) {
    if (migration.version <= current) continue;
    db.withTransactionSync(() => {
      for (const statement of migration.statements) {
        db.execSync(statement);
      }
    });
    db.execSync(`PRAGMA user_version = ${migration.version}`);
  }
}
