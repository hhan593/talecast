import { describe, expect, it } from 'vitest';

import type { AnnotationRecord } from '@/domain/annotations';
import type { Chapter } from '@/domain/types';

import { createBackupService } from './backup';
import {
  FakeAnnotationRepository,
  FakeBookmarkRepository,
  FakeLibraryRepository,
  FakeProjectRepository,
  FakeSettingsRepository,
} from './fakes';

function setup(overrides: Partial<Parameters<typeof createBackupService>[0]> = {}) {
  const project = { id: 'p1', title: '示例书', description: '', tags: [], revision: 2, createdAt: 1, updatedAt: 1 };
  const projects = new FakeProjectRepository([project]);
  const bookmarks = new FakeBookmarkRepository();
  const annotations = new FakeAnnotationRepository();
  const library = new FakeLibraryRepository([project]);
  const settings = new FakeSettingsRepository();
  settings.map.set('llm-endpoint', 'https://secret.example');
  settings.map.set('replacement-rules', '[]');
  const chapter: Chapter = {
    id: 'ch-p1-0-0',
    projectId: 'p1',
    sourceId: 'src-p1-x',
    title: '第一章',
    startOffset: 0,
    endOffset: 100,
    volume: 0,
    ordinal: 0,
    headingLine: 0,
  };
  library.chapters.push(chapter);
  const service = createBackupService({
    projectRepository: projects,
    bookmarkRepository: bookmarks,
    annotationRepository: annotations,
    libraryRepository: library,
    settingsRepository: settings,
    ...overrides,
  });
  return { projects, bookmarks, annotations, library, settings, service, chapter };
}

const annotation = (overrides: Partial<AnnotationRecord> = {}): AnnotationRecord => ({
  id: 'a1',
  projectId: 'p1',
  chapterId: 'ch-p1-0-0',
  startOffset: 10,
  endOffset: 20,
  kind: 'underline',
  note: '重要伏笔',
  createdAt: 111,
  updatedAt: 222,
  ...overrides,
});

describe('v0.10.0 JSON 备份', () => {
  it('导出：含书架/书签/设置且过滤 LLM 密钥类', async () => {
    const s = setup();
    const result = await s.service.exportBackup();
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.value.version).toBe(1);
    expect(result.value.projects).toEqual([{ id: 'p1', title: '示例书', revision: 2 }]);
    expect(result.value.settings['replacement-rules']).toBe('[]');
    expect(result.value.settings['llm-endpoint']).toBeUndefined();
  });

  it('导出并分享：服务产出 {name, content} 交给注入的 share（issue #41）', async () => {
    const shared: { name: string; content: string }[] = [];
    const s = setup({ share: async (file) => void shared.push(file) });
    const result = await s.service.exportAndShare();
    expect(result.ok).toBe(true);
    expect(shared.length).toBe(1);
    expect(shared[0].name).toMatch(/^talecast-backup-\d{4}-\d{2}-\d{2}\.json$/);
    expect(shared[0].content).toContain('"version": 1');
  });

  it('导入：非法 JSON / 版本不符给出明确错误', async () => {
    const s = setup();
    const badJson = await s.service.importBackup(new TextEncoder().encode('not json'));
    expect(badJson.ok).toBe(false);
    const badVersion = await s.service.importBackup(
      new TextEncoder().encode(JSON.stringify({ version: 99, settings: {} })),
    );
    expect(badVersion.ok).toBe(false);
    if (badVersion.ok) return;
    expect(badVersion.error.message).toContain('版本');
  });

  it('导入：恢复设置项且跳过 LLM 密钥类', async () => {
    const s = setup();
    const bytes = new TextEncoder().encode(
      JSON.stringify({
        version: 1,
        exportedAt: '2026-11-20T00:00:00.000Z',
        projects: [],
        bookmarks: [],
        settings: { 'replacement-rules': '[{"kind":"literal"}]', 'reader-theme': 'night', 'llm-api-key': 'sk-x' },
      }),
    );
    const result = await s.service.importBackup(bytes);
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.value.restoredSettings).toBe(2);
    expect(await s.settings.get('replacement-rules')).toBe('[{"kind":"literal"}]');
    expect(await s.settings.get('reader-theme')).toBe('night');
    expect(await s.settings.get('llm-api-key')).toBeNull();
  });

  it('从选取器导入：取消返回 0 项；未注入 picker 明确报错', async () => {
    const s = setup({
      pickBackupFile: async () => {
        const bytes = new TextEncoder().encode(JSON.stringify({ version: 1, settings: { 'reader-theme': 'green' } }));
        return { name: 'backup.json', bytes };
      },
    });
    const result = await s.service.importFromPicker();
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.value.restoredSettings).toBe(1);

    const noPicker = setup();
    const blocked = await noPicker.service.importFromPicker();
    expect(blocked.ok).toBe(false);
  });
});

describe('v0.20.3 备份补标注与书签回填（issue #79）', () => {
  it('导出包含划线笔记与书签（带 projectId/createdAt）', async () => {
    const s = setup();
    await s.annotations.insert(annotation());
    await s.bookmarks.add({
      id: 'b1',
      projectId: 'p1',
      chapterId: 'ch-p1-0-0',
      charOffset: 33,
      excerpt: '摘录',
      createdAt: 55,
    });
    const result = await s.service.exportBackup();
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.value.annotations).toEqual([annotation()]);
    expect(result.value.bookmarks).toEqual([
      { projectId: 'p1', chapterId: 'ch-p1-0-0', charOffset: 33, excerpt: '摘录', createdAt: 55 },
    ]);
  });

  it('导入：项目与章节都对得上时回填标注', async () => {
    const s = setup();
    const bytes = new TextEncoder().encode(
      JSON.stringify({ version: 1, settings: {}, annotations: [annotation()] }),
    );
    const result = await s.service.importBackup(bytes);
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.value.restoredAnnotations).toBe(1);
    expect(result.value.skippedAnnotations).toBe(0);
    expect(await s.annotations.list('p1')).toEqual([annotation()]);
  });

  it('导入：章节对不上（重排/未重导）→ 跳过并计数', async () => {
    const s = setup();
    const bytes = new TextEncoder().encode(
      JSON.stringify({
        version: 1,
        settings: {},
        annotations: [
          annotation({ id: 'a-gone', chapterId: 'ch-p1-9-9000' }),
          annotation({ id: 'a-other-project', projectId: 'p-missing' }),
          {
            id: 'a-bad-shape',
            projectId: 'p1',
            chapterId: 'ch-p1-0-0',
            startOffset: 'nan',
            endOffset: 20,
            kind: 'underline',
            note: '',
            createdAt: 1,
            updatedAt: 1,
          } as unknown as AnnotationRecord,
        ],
      }),
    );
    const result = await s.service.importBackup(bytes);
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.value.restoredAnnotations).toBe(0);
    expect(result.value.skippedAnnotations).toBe(3);
    expect(await s.annotations.list('p1')).toEqual([]);
  });

  it('导入：同一备份重复导入不产生双份（同 id 幂等跳过）', async () => {
    const s = setup();
    const bytes = new TextEncoder().encode(
      JSON.stringify({ version: 1, settings: {}, annotations: [annotation()] }),
    );
    const first = await s.service.importBackup(bytes);
    const second = await s.service.importBackup(bytes);
    expect(first.ok && second.ok).toBe(true);
    if (!(first.ok && second.ok)) return;
    expect(first.value.restoredAnnotations).toBe(1);
    expect(second.value.restoredAnnotations).toBe(0);
    expect((await s.annotations.list('p1')).length).toBe(1);
  });

  it('导入：书签按章节回链且重复导入去重', async () => {
    const s = setup();
    const bytes = new TextEncoder().encode(
      JSON.stringify({
        version: 1,
        settings: {},
        bookmarks: [{ id: 'b1', projectId: 'p1', chapterId: 'ch-p1-0-0', charOffset: 33, excerpt: '摘录', createdAt: 55 }],
      }),
    );
    const first = await s.service.importBackup(bytes);
    const second = await s.service.importBackup(bytes);
    expect(first.ok && second.ok).toBe(true);
    if (!(first.ok && second.ok)) return;
    expect(first.value.restoredBookmarks).toBe(1);
    expect(second.value.restoredBookmarks).toBe(0);
    expect((await s.bookmarks.list('p1')).length).toBe(1);
  });

  it('旧版本备份（无 annotations/bookmarks 字段）照常恢复设置', async () => {
    const s = setup();
    const bytes = new TextEncoder().encode(JSON.stringify({ version: 1, settings: { 'reader-theme': 'paper' } }));
    const result = await s.service.importBackup(bytes);
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.value.restoredAnnotations).toBe(0);
    expect(result.value.restoredBookmarks).toBe(0);
  });
});
