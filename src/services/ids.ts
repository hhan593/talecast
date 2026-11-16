/**
 * P0 临时命令 id 生成。
 * P1 接入来源哈希时会一并引入 expo-crypto（SHA-256 / randomUUID），此处统一替换。
 */

export function newCommandId(): string {
  return `cmd-${Date.now()}-${Math.random().toString(36).slice(2, 10)}`;
}
