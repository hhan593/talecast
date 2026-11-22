/**
 * 应用内更新检查编排（issue #58 P1，仅 Android）。
 * 请求 GitHub latest Release 并与本地版本比较；静默检查 24h 节流
 * （GitHub 匿名限额 60 次/小时/IP），Release 元数据缓存进 settings。
 * 网络失败静默降级为 unavailable——不阻塞启动、不弹错误。
 */
import { err, ok, type Result } from '@/domain/result';
import type { ApkInstaller, SettingsRepository, UpdateGateway } from '@/domain/ports';
import {
  findAndroidApkAsset,
  findChecksumAsset,
  isReleaseNewer,
  type ReleaseAsset,
  type ReleaseInfo,
} from '@/domain/update';

export interface UpdateDeps {
  gateway: UpdateGateway;
  settingsRepository: SettingsRepository;
  /** 本地版本（组合根从 expo-constants 注入 app.json 的 expo.version） */
  currentVersion: string;
  /** P2（issue #85）：APK 下载/校验/安装适配器；未注入则站内安装不可用（回落跳转 Release 页） */
  apkInstaller?: ApkInstaller;
}

export interface InstallPhaseEvent {
  phase: 'downloading' | 'verifying' | 'ready' | 'failed';
  /** 下载进度 0-100（仅 downloading） */
  progress?: number;
  error?: string;
}

/** 静默检查节流窗口 */
const SILENT_THROTTLE_MS = 24 * 60 * 60 * 1000;
const LAST_CHECK_KEY = 'update-last-check-at';
const LAST_RELEASE_KEY = 'update-last-release-json';

export type UpdateCheckStatus = 'available' | 'up-to-date' | 'unavailable';

export interface UpdateCheckResult {
  status: UpdateCheckStatus;
  release: ReleaseInfo | null;
}

export function createUpdateService(deps: UpdateDeps) {
  const { gateway, settingsRepository, currentVersion } = deps;

  async function readCachedRelease(): Promise<ReleaseInfo | null> {
    const raw = await settingsRepository.get(LAST_RELEASE_KEY);
    if (!raw) return null;
    try {
      return JSON.parse(raw) as ReleaseInfo;
    } catch {
      return null;
    }
  }

  function decide(release: ReleaseInfo | null): UpdateCheckResult {
    if (!release) return { status: 'unavailable', release: null };
    if (isReleaseNewer(release.tagName, currentVersion)) {
      return { status: 'available', release };
    }
    return { status: 'up-to-date', release };
  }

  return {
    currentVersion,

    /**
     * 检查更新。
     * - manual=false（启动静默）：24h 内不请求，复用缓存 Release 复判
     *   （用户可能已升级安装，缓存复判仍能给出正确状态）
     * - manual=true（设置页手动）：总是请求；结果无论有无新版本都提示
     * - 失败 → unavailable（静默检查不写节流时间戳，下次启动尽早重试）
     */
    async check(options: { manual: boolean }): Promise<UpdateCheckResult> {
      if (!options.manual) {
        const last = Number.parseInt((await settingsRepository.get(LAST_CHECK_KEY)) ?? '', 10);
        if (Number.isFinite(last) && Date.now() - last < SILENT_THROTTLE_MS) {
          return decide(await readCachedRelease());
        }
      }
      const release = await gateway.fetchLatestRelease();
      if (release === null) {
        return { status: 'unavailable', release: null };
      }
      await settingsRepository.set(LAST_CHECK_KEY, String(Date.now()));
      await settingsRepository.set(LAST_RELEASE_KEY, JSON.stringify(release));
      return decide(release);
    },

    /**
     * P2（issue #85）：站内下载 APK → SHA256SUMS 校验 → 拉起系统安装器。
     * 阶段经 onPhase 上报（UI 显示下载进度/校验中/失败原因）；
     * 未注入 apkInstaller（非 Android/旧实现）→ err，UI 回落跳转 Release 页。
     */
    async downloadAndInstallApk(
      release: ReleaseInfo,
      onPhase: (event: InstallPhaseEvent) => void,
    ): Promise<Result<'launched'>> {
      const installer = deps.apkInstaller;
      if (!installer) return err('invalid', '当前版本不支持站内安装，请到 Release 页手动下载');
      const apk = findAndroidApkAsset(release.assets);
      if (!apk) return err('not_found', '该 Release 缺少 Android APK 产物，请到 Release 页下载');
      const sums = findChecksumAsset(release.assets);

      onPhase({ phase: 'downloading', progress: 0 });
      const downloaded = await installer.download(apk.url, (written, total) => {
        const totalSafe = total > 0 ? total : 1;
        onPhase({ phase: 'downloading', progress: Math.min(100, Math.round((written / totalSafe) * 100)) });
      });
      if (!downloaded) {
        onPhase({ phase: 'failed', error: '下载失败，请检查网络后重试' });
        return err('network', 'APK 下载失败，请检查网络后重试');
      }

      onPhase({ phase: 'verifying' });
      if (sums) {
        const sumsText = await deps.gateway.fetchText(sums.url);
        if (sumsText === null) {
          onPhase({ phase: 'failed', error: '校验和文件下载失败' });
          return err('network', '校验和文件下载失败，请稍后重试');
        }
        const expected = parseChecksumFor(sumsText, apk.name);
        if (expected) {
          const actual = await installer.sha256File(downloaded.localUri);
          if (actual === null || actual.toLowerCase() !== expected.toLowerCase()) {
            onPhase({ phase: 'failed', error: 'APK 校验失败，已放弃安装' });
            return err('storage', 'APK 校验失败，文件可能损坏，已放弃安装');
          }
        }
        // 校验和文件缺失该条目时跳过校验（保留下载产物）
      }

      onPhase({ phase: 'ready' });
      const installed = await installer.install(downloaded.localUri);
      if (installed !== 'launched') {
        onPhase({ phase: 'failed', error: '无法拉起安装器，请到 Release 页手动下载' });
        return err('storage', '无法拉起安装器，请到 Release 页手动下载');
      }
      return ok('launched');
    },
  };
}

export type UpdateService = ReturnType<typeof createUpdateService>;

/** SHA256SUMS 行解析：取指定文件名的 hash（形如 "<hex>  <filename>"） */
export function parseChecksumFor(sumsText: string, filename: string): string | null {
  for (const line of sumsText.split('\n')) {
    const m = line.match(/^([a-fA-F0-9]{64})\s+\*?(.+)$/);
    if (m && m[2].trim() === filename) return m[1];
  }
  return null;
}
