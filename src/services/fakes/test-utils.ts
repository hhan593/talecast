import { utf8Bytes } from '@/domain/hash';

/** 测试辅助：文本 → bytes（走真实编码路径） */
export function textToBytes(text: string): Uint8Array {
  return utf8Bytes(text);
}
