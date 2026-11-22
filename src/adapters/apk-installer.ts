import * as FileSystem from 'expo-file-system/legacy';
import * as IntentLauncher from 'expo-intent-launcher';

import { base64ToBytes } from '@/domain/base64';
import { Sha256 } from '@/domain/apk-hash';
import type { ApkInstaller as ApkInstallerPort } from '@/domain/ports';

/**
 * APK 下载与安装（issue #85 P2，Android only）：
 * - 下载：createDownloadResumable + 进度回调（写入应用缓存）
 * - 校验：legacy API 分块 base64 读取 → 增量 SHA-256（domain/apk-hash.ts），
 *   与 Release 产物 SHA256SUMS 比对，不匹配即放弃安装
 * - 安装：file:// → content://（getContentUriAsync）→ ACTION_VIEW 拉起系统安装器；
 *   未授予「安装未知应用」权限时由系统引导授权，失败返回 failed（UI 回落跳转 Release 页）
 */

const APK_LOCAL_PATH = `${FileSystem.cacheDirectory}talecast-update.apk`;

/** base64 分块读取大小：4 字符 = 3 字节，必须保持 4 的倍数对齐 */
const READ_CHUNK_CHARS = 4 * 1024 * 1024;

export function createApkInstaller(): ApkInstallerPort {
  return {
    async download(url, onProgress) {
      try {
        const resumable = FileSystem.createDownloadResumable(url, APK_LOCAL_PATH, {}, (progress) =>
          onProgress(progress.totalBytesWritten, progress.totalBytesExpectedToWrite),
        );
        const result = await resumable.downloadAsync();
        return result ? { localUri: result.uri } : null;
      } catch {
        return null;
      }
    },

    async sha256File(fileUri) {
      try {
        const base64 = await FileSystem.readAsStringAsync(fileUri, {
          encoding: FileSystem.EncodingType.Base64,
        });
        const hasher = new Sha256();
        for (let i = 0; i < base64.length; i += READ_CHUNK_CHARS) {
          const slice = base64.slice(i, i + READ_CHUNK_CHARS);
          hasher.update(base64ToBytes(slice));
        }
        return hasher.digest();
      } catch {
        return null;
      }
    },

    async install(fileUri) {
      try {
        const contentUri = await FileSystem.getContentUriAsync(fileUri);
        await IntentLauncher.startActivityAsync('android.intent.action.VIEW', {
          data: contentUri,
          type: 'application/vnd.android.package-archive',
          flags: 1, // NEW_TASK
        });
        return 'launched';
      } catch {
        return 'failed';
      }
    },
  };
}
