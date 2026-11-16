import * as SecureStore from 'expo-secure-store';

import type { KeyStore } from '@/domain/ports';

/**
 * 密钥存储（docs/plan.md 3.1 / 7）：只存 SecureStore；
 * 不打印、不写日志、不进 SQLite（P4 加固项已随 P2 提前落地，供 LLM 配置使用）。
 */
export const secureStoreKeyStore: KeyStore = {
  async get(key: string): Promise<string | null> {
    return SecureStore.getItemAsync(key);
  },
  async set(key: string, value: string): Promise<void> {
    await SecureStore.setItemAsync(key, value, {
      keychainAccessible: SecureStore.WHEN_UNLOCKED,
    });
  },
  async delete(key: string): Promise<void> {
    await SecureStore.deleteItemAsync(key);
  },
};
