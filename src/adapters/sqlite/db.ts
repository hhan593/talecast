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
  {
    version: 2,
    description: 'P1：来源/章节/分章候选/章节编辑审计/阅读位置',
    statements: [
      `CREATE TABLE IF NOT EXISTS sources (
        id TEXT PRIMARY KEY NOT NULL,
        project_id TEXT NOT NULL REFERENCES projects(id),
        filename TEXT NOT NULL,
        encoding TEXT NOT NULL DEFAULT 'utf-8',
        raw_sha256 TEXT NOT NULL,
        text_sha256 TEXT NOT NULL,
        byte_size INTEGER NOT NULL,
        created_at INTEGER NOT NULL
      )`,
      `CREATE TABLE IF NOT EXISTS chapters (
        id TEXT PRIMARY KEY NOT NULL,
        project_id TEXT NOT NULL REFERENCES projects(id),
        source_id TEXT NOT NULL REFERENCES sources(id),
        title TEXT NOT NULL,
        start_offset INTEGER NOT NULL,
        end_offset INTEGER NOT NULL,
        volume INTEGER NOT NULL DEFAULT 0,
        ordinal INTEGER NOT NULL,
        heading_line INTEGER
      )`,
      `CREATE INDEX IF NOT EXISTS idx_chapters_project ON chapters(project_id, ordinal)`,
      `CREATE TABLE IF NOT EXISTS split_proposals (
        id TEXT PRIMARY KEY NOT NULL,
        project_id TEXT NOT NULL REFERENCES projects(id),
        source_id TEXT NOT NULL,
        payload_json TEXT NOT NULL,
        previous_json TEXT NOT NULL,
        status TEXT NOT NULL,
        created_at INTEGER NOT NULL,
        adopted_at INTEGER
      )`,
      `CREATE TABLE IF NOT EXISTS chapter_edits (
        id TEXT PRIMARY KEY NOT NULL,
        project_id TEXT NOT NULL REFERENCES projects(id),
        chapter_id TEXT NOT NULL,
        kind TEXT NOT NULL,
        payload_json TEXT NOT NULL,
        revision INTEGER NOT NULL,
        created_at INTEGER NOT NULL
      )`,
      `CREATE TABLE IF NOT EXISTS reading_state (
        project_id TEXT PRIMARY KEY NOT NULL REFERENCES projects(id),
        chapter_id TEXT NOT NULL,
        char_offset INTEGER NOT NULL DEFAULT 0,
        audio_segment_ordinal INTEGER,
        audio_offset_ms INTEGER,
        updated_at INTEGER NOT NULL
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
