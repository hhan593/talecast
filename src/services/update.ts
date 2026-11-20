/**
 * 应用内更新检查编排（issue #58 P1，仅 Android）。
 * 请求 GitHub latest Release 并与本地版本比较；静默检查 24h 节流
 * （GitHub 匿名限额 60 次/小时/IP），Release 元数据缓存进 settings。
 * 网络失败静默降级为 unavailable——不阻塞启动、不弹错误。
 */
import type { SettingsRepository, UpdateGateway } from '@/domain/ports';
import { isReleaseNewer, type ReleaseInfo } from '@/domain/update';

export interface UpdateDeps {
  gateway: UpdateGateway;
  settingsRepository: SettingsRepository;
  /** 本地版本（组合根从 expo-constants 注入 app.json 的 expo.version） */
  currentVersion: string;
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
  };
}

export type UpdateService = ReturnType<typeof createUpdateService>;
