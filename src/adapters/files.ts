import * as DocumentPicker from 'expo-document-picker';
import * as FileSystem from 'expo-file-system/legacy';

import { base64ToBytes, bytesToBase64 } from '@/domain/base64';
import type { AudioFileStore, FilePicker, SourceFileStore } from '@/domain/ports';

/**
 * 文件能力适配（docs/plan.md 3.1 文件）：iOS Files / Android SAF 导入，沙盒内持久化。
 * 沙盒布局：
 * - documentDirectory/sources/<raw_sha256>.raw 与 .txt（按内容寻址，不可变）
 * - documentDirectory/audio/<text_hash>.mp3（生成与试听共用 → 试听转正零成本）
 * SDK 58 起 expo-file-system 的旧 API 移至 expo-file-system/legacy，content:// 读取走旧 API。
 */

const SOURCES_DIR = 'sources';
const AUDIO_DIR = 'audio';

/** 解码文本缓存：键为内容哈希、值不可变；生成/播放/阅读/助手 6 个场景共用（M-4） */
const decodedTextCache = new Map<string, string>();

/** 系统文件选择器实现：只接受文本类文件；用户取消返回 null */
export const documentPickerFilePicker: FilePicker = {
  async pickTextFile() {
    const result = await DocumentPicker.getDocumentAsync({
      type: ['text/plain', 'application/octet-stream'],
      copyToCacheDirectory: true,
      multiple: false,
    });
    if (result.canceled || result.assets.length === 0) return null;
    const asset = result.assets[0];
    const base64 = await FileSystem.readAsStringAsync(asset.uri, {
      encoding: FileSystem.EncodingType.Base64,
    });
    return { name: asset.name ?? 'import.txt', bytes: base64ToBytes(base64) };
  },
};

function directoryUri(name: string): string {
  return `${FileSystem.documentDirectory ?? ''}${name}/`;
}

/** makeDirectoryAsync(intermediates) 对已存在目录幂等，无需预检存在性（TOCTOU） */
async function ensureDir(dir: string): Promise<string> {
  await FileSystem.makeDirectoryAsync(dir, { intermediates: true });
  return dir;
}

/** 先写临时文件再原子改名，避免半写文件占据正式路径 */
async function writeFileAtomically(targetPath: string, data: string, encoding: FileSystem.EncodingType): Promise<void> {
  const temp = `${targetPath}.tmp`;
  await FileSystem.writeAsStringAsync(temp, data, { encoding });
  await FileSystem.moveAsync({ from: temp, to: targetPath });
}

function sourcesDirectoryUri(): string {
  return directoryUri(SOURCES_DIR);
}

/** 沙盒按内容寻址存储实现：写后不可变；同哈希重复导入直接复用 */
export const sandboxSourceFileStore: SourceFileStore = {
  async writeRawBytes(sha256, bytes) {
    const dir = await ensureDir(directoryUri(SOURCES_DIR));
    const target = `${dir}${sha256}.raw`;
    const info = await FileSystem.getInfoAsync(target);
    if (!info.exists) {
      await writeFileAtomically(target, bytesToBase64(bytes), FileSystem.EncodingType.Base64);
    }
  },

  async writeDecodedText(sha256, text) {
    const dir = await ensureDir(directoryUri(SOURCES_DIR));
    const target = `${dir}${sha256}.txt`;
    const info = await FileSystem.getInfoAsync(target);
    if (!info.exists) {
      await FileSystem.writeAsStringAsync(target, text, {
        encoding: FileSystem.EncodingType.UTF8,
      });
    }
  },

  async readDecodedText(sha256) {
    const cached = decodedTextCache.get(sha256);
    if (cached !== undefined) return cached;
    const target = `${sourcesDirectoryUri()}${sha256}.txt`;
    const text = await FileSystem.readAsStringAsync(target, { encoding: FileSystem.EncodingType.UTF8 });
    // 键是内容哈希（写后不可变），缓存无失效问题；仅保留最近 2 份防内存膨胀
    decodedTextCache.set(sha256, text);
    if (decodedTextCache.size > 2) {
      const oldest = decodedTextCache.keys().next().value;
      if (oldest !== undefined) decodedTextCache.delete(oldest);
    }
    return text;
  },
};

function audioDirectoryUri(): string {
  return directoryUri(AUDIO_DIR);
}

/** 生成与试听共用的音频存储：同一 text_hash 只有一份文件（重试零请求、试听直接转正） */
export const sandboxAudioFileStore: AudioFileStore = {
  pathFor(textHash) {
    return `${audioDirectoryUri()}${textHash}.mp3`;
  },

  async exists(textHash) {
    const info = await FileSystem.getInfoAsync(this.pathFor(textHash));
    return info.exists;
  },

  async write(textHash, bytes) {
    const dir = await ensureDir(directoryUri(AUDIO_DIR));
    const target = `${dir}${textHash}.mp3`;
    const info = await FileSystem.getInfoAsync(target);
    if (info.exists) return target;
    await writeFileAtomically(target, bytesToBase64(bytes), FileSystem.EncodingType.Base64);
    return target;
  },
};
