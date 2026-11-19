import * as SQLite from 'expo-sqlite';


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
  {
    version: 3,
    description: 'P2：角色/音色/绑定/生成任务与段/设置/请求用量',
    statements: [
      `CREATE TABLE IF NOT EXISTS characters (
        id TEXT PRIMARY KEY NOT NULL,
        project_id TEXT NOT NULL REFERENCES projects(id),
        name TEXT NOT NULL,
        aliases_json TEXT NOT NULL DEFAULT '[]',
        profile_json TEXT NOT NULL DEFAULT '{}',
        confirmed INTEGER NOT NULL DEFAULT 0,
        manual_protected INTEGER NOT NULL DEFAULT 0,
        created_at INTEGER NOT NULL,
        updated_at INTEGER NOT NULL
      )`,
      `CREATE TABLE IF NOT EXISTS voices (
        id TEXT PRIMARY KEY NOT NULL,
        provider TEXT NOT NULL,
        voice_id TEXT NOT NULL,
        name TEXT NOT NULL,
        description TEXT NOT NULL DEFAULT '',
        UNIQUE(provider, voice_id)
      )`,
      `CREATE TABLE IF NOT EXISTS bindings (
        id TEXT PRIMARY KEY NOT NULL,
        project_id TEXT NOT NULL REFERENCES projects(id),
        target_type TEXT NOT NULL,
        target_id TEXT,
        voice_id TEXT NOT NULL,
        revision INTEGER NOT NULL DEFAULT 0,
        updated_at INTEGER NOT NULL,
        UNIQUE(project_id, target_type, target_id)
      )`,
      `CREATE TABLE IF NOT EXISTS generation_jobs (
        id TEXT PRIMARY KEY NOT NULL,
        project_id TEXT NOT NULL REFERENCES projects(id),
        chapter_id TEXT NOT NULL,
        status TEXT NOT NULL,
        provider TEXT NOT NULL,
        input_hash TEXT NOT NULL,
        voice_id TEXT NOT NULL,
        binding_revision INTEGER NOT NULL,
        total_segments INTEGER NOT NULL,
        progress INTEGER NOT NULL DEFAULT 0,
        error TEXT,
        created_at INTEGER NOT NULL,
        updated_at INTEGER NOT NULL
      )`,
      `CREATE INDEX IF NOT EXISTS idx_jobs_chapter ON generation_jobs(project_id, chapter_id)`,
      `CREATE INDEX IF NOT EXISTS idx_jobs_input ON generation_jobs(project_id, input_hash)`,
      `CREATE TABLE IF NOT EXISTS generation_segments (
        id TEXT PRIMARY KEY NOT NULL,
        job_id TEXT NOT NULL REFERENCES generation_jobs(id),
        ordinal INTEGER NOT NULL,
        text TEXT NOT NULL,
        text_hash TEXT NOT NULL,
        status TEXT NOT NULL,
        file_path TEXT,
        error TEXT,
        updated_at INTEGER NOT NULL
      )`,
      `CREATE INDEX IF NOT EXISTS idx_segments_job ON generation_segments(job_id, ordinal)`,
      `CREATE TABLE IF NOT EXISTS settings (
        key TEXT PRIMARY KEY NOT NULL,
        value TEXT NOT NULL
      )`,
      `CREATE TABLE IF NOT EXISTS provider_requests (
        id TEXT PRIMARY KEY NOT NULL,
        kind TEXT NOT NULL,
        ok INTEGER NOT NULL,
        note TEXT NOT NULL DEFAULT '',
        created_at INTEGER NOT NULL
      )`,
    ],
  },
  {
    version: 5,
    description: 'bindings.provider_params_json（TTS 参数参与 input_hash）',
    statements: [
      `ALTER TABLE bindings ADD COLUMN provider_params_json TEXT NOT NULL DEFAULT '{}'`,
    ],
  },
  {
    version: 6,
    description: 'R2/R3：reading_state 阅读偏好 + bookmarks 书签表',
    statements: [
      `ALTER TABLE reading_state ADD COLUMN reader_mode TEXT NOT NULL DEFAULT 'scroll'`,
      `ALTER TABLE reading_state ADD COLUMN font_size TEXT NOT NULL DEFAULT 'standard'`,
      `CREATE TABLE IF NOT EXISTS bookmarks (
        id TEXT PRIMARY KEY NOT NULL,
        project_id TEXT NOT NULL REFERENCES projects(id),
        chapter_id TEXT NOT NULL,
        char_offset INTEGER NOT NULL,
        excerpt TEXT NOT NULL DEFAULT '',
        created_at INTEGER NOT NULL,
        UNIQUE(project_id, chapter_id, char_offset)
      )`,
    ],
  },
  {
    version: 4,
    description: 'P3：书籍助手会话与消息',
    statements: [
      `CREATE TABLE IF NOT EXISTS assistant_sessions (
        id TEXT PRIMARY KEY NOT NULL,
        project_id TEXT NOT NULL REFERENCES projects(id),
        task_kind TEXT NOT NULL DEFAULT 'general',
        chapter_id TEXT,
        created_at INTEGER NOT NULL,
        UNIQUE(project_id, task_kind)
      )`,
      `CREATE TABLE IF NOT EXISTS assistant_messages (
        id TEXT PRIMARY KEY NOT NULL,
        session_id TEXT NOT NULL REFERENCES assistant_sessions(id),
        ordinal INTEGER NOT NULL,
        role TEXT NOT NULL,
        parts_json TEXT NOT NULL,
        version INTEGER NOT NULL DEFAULT 0,
        created_at INTEGER NOT NULL,
        UNIQUE(session_id, ordinal)
      )`,
    ],
  },
  {
    version: 7,
    description: '段级音色（v0.9.0 对话分声）：generation_segments 增加 voice_id / provider_params_json',
    statements: [
      'ALTER TABLE generation_segments ADD COLUMN voice_id TEXT',
      'ALTER TABLE generation_segments ADD COLUMN provider_params_json TEXT',
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
