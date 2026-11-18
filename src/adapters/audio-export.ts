import * as FileSystem from 'expo-file-system/legacy';
import * as Sharing from 'expo-sharing';

import { base64ToBytes, bytesToBase64, concatBytes } from '@/domain/base64';
import type { ChapterExporter } from '@/domain/ports';

/**
 * 章节导出适配：Edge 各段为同一编码参数的 MP3，字节顺序拼接即合法整章文件，
 * 无需 ffmpeg/重编码（docs/design/2026-11-18-v0.2.0-spec.md F-3）。
 */
/** 导出产物目录（cache 沙盒内），由 container 注入服务 */
export const EXPORTS_DIR_URI = `${(FileSystem.documentDirectory ?? '')}exports/`;

export class Mp3ChapterExporter implements ChapterExporter {
  async concatToFile(segmentPaths: string[], outputPath: string): Promise<string> {
    const chunks: Uint8Array[] = [];
    for (const path of segmentPaths) {
      const base64 = await FileSystem.readAsStringAsync(path, {
        encoding: FileSystem.EncodingType.Base64,
      });
      chunks.push(base64ToBytes(base64));
    }
    await FileSystem.writeAsStringAsync(outputPath, bytesToBase64(concatBytes(chunks)), {
      encoding: FileSystem.EncodingType.Base64,
    });
    return outputPath;
  }

  async share(uri: string): Promise<void> {
    await Sharing.shareAsync(uri, { mimeType: 'audio/mpeg', UTI: 'public.mp3' });
  }
}
