import { describe, expect, it } from 'vitest';

import { FakeRequestLogRepository, FakeSettingsRepository } from './fakes';
import { createSettingsService } from './settings';

describe('settings service · 翻页样式白名单（issue #94）', () => {
  function makeService() {
    const settings = new FakeSettingsRepository();
    const service = createSettingsService({
      settingsRepository: settings,
      keyStore: {
        get: async () => null,
        set: async () => undefined,
        delete: async () => undefined,
      },
      requestLogRepository: new FakeRequestLogRepository(),
    });
    return { service, settings };
  }

  it('合法值原样保留（含新增的 vertical）', async () => {
    const { service } = makeService();
    for (const style of ['slide', 'cover', 'curl', 'vertical', 'none'] as const) {
      await service.setPageTurnStyle(style);
      expect(await service.getPageTurnStyle()).toBe(style);
    }
  });

  it('非法/历史遗留脏数据回落 slide', async () => {
    const { service, settings } = makeService();
    await settings.set('page-turn-style', 'diagonal');
    expect(await service.getPageTurnStyle()).toBe('slide');
    expect(await service.getPageTurnStyle()).not.toBe('vertical');
  });
});
