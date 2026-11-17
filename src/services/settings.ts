import { LLM_API_KEY, LLM_ENDPOINT_KEY, LLM_MODEL_KEY } from '@/domain/contracts';
import type { KeyStore, RequestLogRepository, SettingsRepository } from '@/domain/ports';

/**
 * 服务连接配置（docs/plan.md 5.3 助手/3.1 密钥）：
 * 端点与模型名是非敏感配置 → SQLite settings；API Key 只存 SecureStore，读回时只报存在性。
 * 请求用量（P4）：tts/llm 成功与失败计数来自 provider_requests。
 */

export interface SettingsDeps {
  settingsRepository: SettingsRepository;
  keyStore: KeyStore;
  requestLogRepository: RequestLogRepository;
}

export interface LlmConfigView {
  endpoint: string | null;
  model: string | null;
  /** 只暴露"是否已设置"，绝不返回密钥内容 */
  hasApiKey: boolean;
}

export function createSettingsService(deps: SettingsDeps) {
  return {
    async getLlmConfig(): Promise<LlmConfigView> {
      const [endpoint, model, apiKey] = await Promise.all([
        deps.settingsRepository.get(LLM_ENDPOINT_KEY),
        deps.settingsRepository.get(LLM_MODEL_KEY),
        deps.keyStore.get(LLM_API_KEY),
      ]);
      return { endpoint, model, hasApiKey: apiKey !== null };
    },

    async saveLlmConfig(input: { endpoint: string; model: string; apiKey?: string }): Promise<void> {
      await deps.settingsRepository.set(LLM_ENDPOINT_KEY, input.endpoint.trim().replace(/\/$/, ''));
      await deps.settingsRepository.set(LLM_MODEL_KEY, input.model.trim());
      if (input.apiKey !== undefined && input.apiKey.trim().length > 0) {
        await deps.keyStore.set(LLM_API_KEY, input.apiKey.trim());
      }
    },

    /** 请求用量（P4）：来自 provider_requests 的成功/失败计数 */
    async getUsage(): Promise<{ ttsOk: number; ttsFailed: number; llmOk: number; llmFailed: number }> {
      return deps.requestLogRepository.counts();
    },
  };
}

export type SettingsService = ReturnType<typeof createSettingsService>;
