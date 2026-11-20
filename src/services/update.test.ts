import { describe, expect, it } from 'vitest';

import type { UpdateGateway } from '@/domain/ports';
import type { ReleaseInfo } from '@/domain/update';

import { FakeSettingsRepository } from './fakes';
import { createUpdateService } from './update';

const RELEASE_V20: ReleaseInfo = {
  tagName: 'v0.20.0',
  htmlUrl: 'https://github.com/hhan593/talecast/releases/tag/v0.20.0',
  notes: '- 修复若干问题',
};

function fakeGateway(release: ReleaseInfo | null, log: { calls: number } = { calls: 0 }): UpdateGateway {
  return {
    async fetchLatestRelease() {
      log.calls += 1;
      return release;
    },
  };
}

const CURRENT = '0.19.1';

describe('update service', () => {
  it('远端更新 → available，并写入节流时间与缓存', async () => {
    const settings = new FakeSettingsRepository();
    const service = createUpdateService({
      gateway: fakeGateway(RELEASE_V20),
      settingsRepository: settings,
      currentVersion: CURRENT,
    });
    const result = await service.check({ manual: true });
    expect(result.status).toBe('available');
    expect(result.release?.tagName).toBe('v0.20.0');
    expect(Number.isFinite(Number(await settings.get('update-last-check-at')))).toBe(true);
    expect(JSON.parse((await settings.get('update-last-release-json')) ?? '{}').tagName).toBe('v0.20.0');
  });

  it('远端不新于本地 → up-to-date', async () => {
    const service = createUpdateService({
      gateway: fakeGateway({ ...RELEASE_V20, tagName: 'v0.19.1' }),
      settingsRepository: new FakeSettingsRepository(),
      currentVersion: CURRENT,
    });
    expect((await service.check({ manual: true })).status).toBe('up-to-date');
  });

  it('静默检查 24h 内复用缓存，不再请求 GitHub', async () => {
    const settings = new FakeSettingsRepository();
    const log = { calls: 0 };
    const service = createUpdateService({
      gateway: fakeGateway(RELEASE_V20, log),
      settingsRepository: settings,
      currentVersion: CURRENT,
    });
    await service.check({ manual: true }); // 首次请求并写缓存
    const silent = await service.check({ manual: false }); // 24h 内 → 走缓存
    expect(log.calls).toBe(1);
    expect(silent.status).toBe('available');
  });

  it('无缓存时静默检查会请求；失败 → unavailable 且不写节流时间', async () => {
    const settings = new FakeSettingsRepository();
    const service = createUpdateService({
      gateway: fakeGateway(null),
      settingsRepository: settings,
      currentVersion: CURRENT,
    });
    const result = await service.check({ manual: false });
    expect(result.status).toBe('unavailable');
    expect(await settings.get('update-last-check-at')).toBeNull();
  });

  it('缓存复判：升级安装后缓存里的旧 Release 不再提示', async () => {
    const settings = new FakeSettingsRepository();
    settings.set('update-last-check-at', String(Date.now()));
    settings.set('update-last-release-json', JSON.stringify(RELEASE_V20));
    const service = createUpdateService({
      gateway: fakeGateway(null),
      settingsRepository: settings,
      currentVersion: '0.20.0', // 用户已升级到缓存版本
    });
    expect((await service.check({ manual: false })).status).toBe('up-to-date');
  });

  it('手动检查始终请求（绕过节流）', async () => {
    const settings = new FakeSettingsRepository();
    const log = { calls: 0 };
    const service = createUpdateService({
      gateway: fakeGateway(RELEASE_V20, log),
      settingsRepository: settings,
      currentVersion: CURRENT,
    });
    await service.check({ manual: true });
    await service.check({ manual: true });
    expect(log.calls).toBe(2);
  });
});
