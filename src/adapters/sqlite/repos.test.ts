import BetterSqlite3 from 'better-sqlite3';
import { describe, expect, it } from 'vitest';

import { LATEST_SCHEMA_VERSION, migrateDatabase, type TalecastDatabase } from './schema';
import { SqliteAnnotationRepository } from './repos/annotations';
import { SqliteBookmarkRepository } from './repos/bookmarks';
import { SqliteReadingStateRepository } from './repos/reading-state';

/**
 * SQLite 适配器测试（issue #80）：用 better-sqlite3 桥接 expo-sqlite 的同步 API
 * （runSync/getAllSync/getFirstSync/execSync/withTransactionSync），在 Node/vitest
 * 里跑**真实 SQL**——补 v0.19.1 reading_state NOT NULL 事故暴露的盲区：
 * services 的内存 fake 不执行 SQL，约束/占位/COALESCE 语义只有这里能验证。
 */

function makeRawDb(): BetterSqlite3.Database {
  return new BetterSqlite3(':memory:');
}

/** 桥接 better-sqlite3 → expo-sqlite 同步 API（runSync/getAllSync/getFirstSync/execSync/withTransactionSync） */
function wrap(db: BetterSqlite3.Database): TalecastDatabase {
  const shim = {
    runSync: (sql: string, ...params: unknown[]) => db.prepare(sql).run(...(params as never[])),
    getAllSync: (sql: string, ...params: unknown[]) =>
      db.prepare(sql).all(...(params as never[])),
    getFirstSync: (sql: string, ...params: unknown[]) =>
      db.prepare(sql).get(...(params as never[])) ?? null,
    execSync: (sql: string) => db.exec(sql),
    withTransactionSync: <T,>(fn: () => T): T => {
      db.exec('BEGIN');
      try {
        const result = fn();
        db.exec('COMMIT');
        return result;
      } catch (error) {
        db.exec('ROLLBACK');
        throw error;
      }
    },
  };
  return shim as unknown as TalecastDatabase;
}

/** 仓储测试用：迁移 + 种项目行（reading_state/bookmarks/annotations 均有 REFERENCES projects(id) 外键；
 *  better-sqlite3 默认开 FK，与 expo-sqlite 生产行为一致——真机上保存时项目必然已存在） */
function makeMigratedDb(): TalecastDatabase {
  const raw = makeRawDb();
  const db = wrap(raw);
  migrateDatabase(db);
  db.runSync(
    `INSERT INTO projects (id, title, description, revision, created_at, updated_at)
     VALUES ('p1', '种子书', '', 1, 1, 1)`,
  );
  return db;
}

describe('SQLite 适配器（issue #80：真实 SQL 测试）', () => {
  it('迁移：建库推进到最新 user_version，schema 含核心表', () => {
    const raw = makeRawDb();
    const db = wrap(raw);
    expect(LATEST_SCHEMA_VERSION).toBeGreaterThan(0);
    migrateDatabase(db);
    const version = db.getFirstSync<{ user_version: number }>('PRAGMA user_version');
    expect(version?.user_version).toBe(LATEST_SCHEMA_VERSION);
    const tables = db
      .getAllSync<{ name: string }>(
        "SELECT name FROM sqlite_master WHERE type = 'table' ORDER BY name",
      )
      .map((t) => t.name);
    for (const table of ['projects', 'sources', 'chapters', 'reading_state', 'bookmarks', 'annotations', 'command_receipts']) {
      expect(tables).toContain(table);
    }
    // 幂等：重复迁移不报错、版本不变
    expect(() => migrateDatabase(db)).not.toThrow();
    expect(db.getFirstSync<{ user_version: number }>('PRAGMA user_version')?.user_version).toBe(
      LATEST_SCHEMA_VERSION,
    );
  });

  it('迁移：库版本高于应用支持时拒绝降级', () => {
    const db = wrap(makeRawDb());
    db.execSync('PRAGMA user_version = 9999');
    expect(() => migrateDatabase(db)).toThrow(/高于本应用支持的最高版本/);
  });

  describe('reading_state（v0.19.1 NOT NULL 事故的回归锚点）', () => {
    it('只存偏好（无章节）也能落库：占位行 + COALESCE 部分更新', async () => {
      const db = makeMigratedDb();
      migrateDatabase(db);
      const repo = new SqliteReadingStateRepository(db);
      // 事故场景：保存偏好时没有章节 → chapter_id null → 旧实现 INSERT 违约整条失败
      repo.set({ projectId: 'p1', chapterId: null, charOffset: null, audioSegmentOrdinal: null, audioOffsetMs: null, readerMode: 'paged', fontSize: 'xlarge' });
      const state = await repo.get('p1');
      expect(state).not.toBeNull();
      expect(state?.readerMode).toBe('paged');
      expect(state?.fontSize).toBe('xlarge');
      expect(state?.chapterId).toBeNull();
      // 占位行 char_offset = 0：COALESCE 后保持 0（下游 restorePosition 把 0 视为「无文本位置」）
      expect(state?.charOffset).toBe(0);
    });

    it('部分更新互不覆盖：文本位置/音频位置/偏好各自独立写入', async () => {
      const db = makeMigratedDb();
      migrateDatabase(db);
      const repo = new SqliteReadingStateRepository(db);
      repo.set({ projectId: 'p1', chapterId: 'ch-1', charOffset: 120, audioSegmentOrdinal: null, audioOffsetMs: null, readerMode: null, fontSize: null });
      repo.set({ projectId: 'p1', chapterId: null, charOffset: null, audioSegmentOrdinal: 3, audioOffsetMs: 1500, readerMode: null, fontSize: null });
      const state = await repo.get('p1');
      expect(state?.chapterId).toBe('ch-1');
      expect(state?.charOffset).toBe(120);
      expect(state?.audioSegmentOrdinal).toBe(3);
      expect(state?.audioOffsetMs).toBe(1500);
      // 偏好补写不覆盖位置
      repo.set({ projectId: 'p1', chapterId: null, charOffset: null, audioSegmentOrdinal: null, audioOffsetMs: null, readerMode: 'scroll', fontSize: 'large' });
      const final = await repo.get('p1');
      expect(final?.chapterId).toBe('ch-1');
      expect(final?.charOffset).toBe(120);
      expect(final?.readerMode).toBe('scroll');
      expect(final?.fontSize).toBe('large');
    });

    it('get：无行返回 null；chapter_id 空串占位映射回 null', async () => {
      const db = makeMigratedDb();
      migrateDatabase(db);
      const repo = new SqliteReadingStateRepository(db);
      expect(await repo.get('p-none')).toBeNull();
      repo.set({ projectId: 'p1', chapterId: null, charOffset: null, audioSegmentOrdinal: null, audioOffsetMs: null, readerMode: null, fontSize: null });
      expect((await repo.get('p1'))?.chapterId).toBeNull();
    });
  });

  describe('bookmarks / annotations（备份回链依赖的幂等与排序语义）', () => {
    it('bookmarks：同项目同章节同偏移幂等返回 exists（备份重复导入不双份）', async () => {
      const db = makeMigratedDb();
      migrateDatabase(db);
      const repo = new SqliteBookmarkRepository(db);
      const record = { id: 'b1', projectId: 'p1', chapterId: 'ch-1', charOffset: 33, excerpt: '摘录', createdAt: 1 };
      expect(await repo.add(record)).toBe('added');
      expect(await repo.add({ ...record, id: 'b2' })).toBe('exists');
      expect(await repo.list('p1')).toHaveLength(1);
    });

    it('annotations：insert/list 往返保真并按 start_offset 排序', async () => {
      const db = makeMigratedDb();
      migrateDatabase(db);
      const repo = new SqliteAnnotationRepository(db);
      const make = (id: string, start: number, note = '') => ({
        id,
        projectId: 'p1',
        chapterId: 'ch-1',
        startOffset: start,
        endOffset: start + 10,
        kind: 'underline' as const,
        note,
        createdAt: 1,
        updatedAt: 1,
      });
      repo.insert(make('a2', 100, '笔记'));
      repo.insert(make('a1', 20));
      const rows = await repo.list('p1');
      expect(rows.map((r) => r.id)).toEqual(['a1', 'a2']);
      expect(rows[1].note).toBe('笔记');
    });
  });
});
