import { describe, expect, it } from 'vitest';

import { createBackupService } from './backup';
import { FakeBookmarkRepository, FakeProjectRepository, FakeSettingsRepository } from './fakes';

function setup(overrides: Partial<Parameters<typeof createBackupService>[0]> = {}) {
  const project = { id: 'p1', title: '示例书', description: '', revision: 2, createdAt: 1, updatedAt: 1 };
  const projects = new FakeProjectRepository([project]);
  const bookmarks = new FakeBookmarkRepository();
  const settings = new FakeSettingsRepository();
  settings.map.set('llm-endpoint', 'https://secret.example');
  settings.map.set('replacement-rules', '[]');
  const service = createBackupService({
    projectRepository: projects,
    bookmarkRepository: bookmarks,
    settingsRepository: settings,
    ...overrides,
  });
  return { projects, bookmarks, settings, service };
}

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

  it('导出并分享：调用注入的 share', async () => {
    let shared: unknown = null;
    const s = setup({ share: async (data) => void (shared = data) });
    const result = await s.service.exportAndShare();
    expect(result.ok).toBe(true);
    expect(shared).not.toBeNull();
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
