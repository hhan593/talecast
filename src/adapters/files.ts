import * as DocumentPicker from 'expo-document-picker';
import * as FileSystem from 'expo-file-system/legacy';

import { base64ToBytes, bytesToBase64 } from '@/domain/base64';
import type { FilePicker, SourceFileStore } from '@/domain/ports';

/**
 * 文件能力适配（docs/plan.md 3.1 文件）：iOS Files / Android SAF 导入，沙盒内持久化。
 * 沙盒布局：documentDirectory/sources/<raw_sha256>.raw 与 .txt（按内容寻址，不可变）。
 * SDK 58 起 expo-file-system 的旧 API 移至 expo-file-system/legacy，content:// 读取走旧 API。
 */

const SOURCES_DIR = 'sources';

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

function sourcesDirectoryUri(): string {
  return `${FileSystem.documentDirectory ?? ''}${SOURCES_DIR}/`;
}

async function ensureSourcesDir(): Promise<string> {
  const dir = sourcesDirectoryUri();
  const info = await FileSystem.getInfoAsync(dir);
  if (!info.exists) {
    await FileSystem.makeDirectoryAsync(dir, { intermediates: true });
  }
  return dir;
}

/** 沙盒按内容寻址存储实现：写后不可变；同哈希重复导入直接复用 */
export const sandboxSourceFileStore: SourceFileStore = {
  async writeRawBytes(sha256, bytes) {
    const dir = await ensureSourcesDir();
    const target = `${dir}${sha256}.raw`;
    const info = await FileSystem.getInfoAsync(target);
    if (!info.exists) {
      // 写临时文件后改名，避免半写文件占据正式路径
      const temp = `${dir}${sha256}.raw.tmp`;
      await FileSystem.writeAsStringAsync(temp, bytesToBase64(bytes), {
        encoding: FileSystem.EncodingType.Base64,
      });
      await FileSystem.moveAsync({ from: temp, to: target });
    }
  },

  async writeDecodedText(sha256, text) {
    const dir = await ensureSourcesDir();
    const target = `${dir}${sha256}.txt`;
    const info = await FileSystem.getInfoAsync(target);
    if (!info.exists) {
      await FileSystem.writeAsStringAsync(target, text, {
        encoding: FileSystem.EncodingType.UTF8,
      });
    }
  },

  async readDecodedText(sha256) {
    const target = `${sourcesDirectoryUri()}${sha256}.txt`;
    return FileSystem.readAsStringAsync(target, { encoding: FileSystem.EncodingType.UTF8 });
  },
};
