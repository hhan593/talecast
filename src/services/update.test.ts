import { describe, expect, it } from 'vitest';

import type { UpdateGateway } from '@/domain/ports';
import type { ReleaseInfo } from '@/domain/update';

import { FakeSettingsRepository } from './fakes';
import { createUpdateService } from './update';
import type { ApkInstaller } from '@/domain/ports';

const RELEASE_WITH_ASSETS: ReleaseInfo = {
  tagName: 'v0.21.0',
  htmlUrl: 'https://github.com/hhan593/talecast/releases/tag/v0.21.0',
  notes: '',
  assets: [
    { name: 'TaleCast-v0.21.0-android.apk', url: 'https://example.com/TaleCast-v0.21.0-android.apk' },
    { name: 'SHA256SUMS', url: 'https://example.com/SHA256SUMS' },
  ],
};
const APK_HASH = 'a'.repeat(64);

class FakeApkInstaller implements ApkInstaller {
  public downloadResult: { localUri: string } | null = { localUri: 'file:///cache/update.apk' };
  public fileHash: string | null = APK_HASH;
  public installResult: 'launched' | 'failed' = 'launched';
  public installCalls = 0;

  async download(_url: string, _onProgress: (written: number, total: number) => void): Promise<{ localUri: string } | null> {
    return this.downloadResult;
  }
  async sha256File(_fileUri: string): Promise<string | null> {
    return this.fileHash;
  }
  async install(_fileUri: string): Promise<'launched' | 'failed'> {
    this.installCalls += 1;
    return this.installResult;
  }
}

const SUMS = `${'a'.repeat(64)}  TaleCast-v0.21.0-android.apk`;

function makeInstallerService(
  overrides: Partial<Pick<ApkInstaller, 'download' | 'sha256File' | 'install'>> = {},
  release: ReleaseInfo = RELEASE_WITH_ASSETS,
) {
  const settings = new FakeSettingsRepository();
  const installer = new FakeApkInstaller();
  if (overrides.download) installer.download = overrides.download;
  if (overrides.sha256File) installer.sha256File = overrides.sha256File;
  if (overrides.install) installer.install = overrides.install;
  const service = createUpdateService({
    gateway: {
      async fetchLatestRelease() {
        return release;
      },
      async fetchText(url) {
        return url.includes('SHA256SUMS') ? SUMS : null;
      },
    },
    settingsRepository: settings,
    currentVersion: CURRENT,
    apkInstaller: installer,
  });
  return { service, installer };
}

const noopPhase = (): void => undefined;

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
    async fetchText() {
      return null;
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


describe('update service · 站内下载安装（issue #85 P2）', () => {
  it('全链路：下载 → 校验匹配 → 拉起安装器，阶段回调齐全', async () => {
    const { service, installer } = makeInstallerService();
    const phases: string[] = [];
    const result = await service.downloadAndInstallApk(RELEASE_WITH_ASSETS, (e) => phases.push(e.phase));
    expect(result.ok).toBe(true);
    expect(installer.installCalls).toBe(1);
    expect(phases).toContain('downloading');
    expect(phases).toContain('verifying');
    expect(phases).toContain('ready');
  });

  it('SHA256 不匹配 → 放弃安装，不拉起安装器', async () => {
    const { service, installer } = makeInstallerService({
      sha256File: async () => 'b'.repeat(64),
    });
    const result = await service.downloadAndInstallApk(RELEASE_WITH_ASSETS, noopPhase);
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error.message).toContain('校验失败');
    expect(installer.installCalls).toBe(0);
  });

  it('Release 缺少 APK 产物 → not_found', async () => {
    const { service } = makeInstallerService({}, {
      tagName: 'v0.21.0',
      htmlUrl: 'https://example.com',
      notes: '',
    });
    const result = await service.downloadAndInstallApk(
      { tagName: 'v0.21.0', htmlUrl: 'https://example.com', notes: '' },
      noopPhase,
    );
    expect(result.ok).toBe(false);
  });

  it('下载失败（network）→ network 错误', async () => {
    const { service } = makeInstallerService({ download: async () => null });
    const result = await service.downloadAndInstallApk(RELEASE_WITH_ASSETS, noopPhase);
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error.code).toBe('network');
  });

  it('拉起安装器失败 → storage 错误', async () => {
    const { service } = makeInstallerService({ install: async () => 'failed' });
    const result = await service.downloadAndInstallApk(RELEASE_WITH_ASSETS, noopPhase);
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error.code).toBe('storage');
  });
});
