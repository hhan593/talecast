import { describe, expect, it } from 'vitest';

import { createStatsService } from './stats';
import { FakeSettingsRepository } from './fakes';

describe('stats service', () => {
  it('默认值为零', async () => {
    const service = createStatsService({ settingsRepository: new FakeSettingsRepository() });
    const stats = await service.getStats();
    expect(stats.todayMs).toBe(0);
    expect(stats.todayChars).toBe(0);
  });

  it('recordSession 累计时长与字数', async () => {
    const service = createStatsService({ settingsRepository: new FakeSettingsRepository() });
    await service.recordSession(60_000, 500);
    const stats = await service.getStats();
    expect(stats.todayMs).toBe(60_000);
    expect(stats.todayChars).toBe(500);
  });
});
