import { fetch } from 'expo/fetch';

import { createSseParser } from './parse-sse';
import type { KeyStore, LlmGateway, SettingsRepository } from '@/domain/ports';

/**
 * OpenAI 兼容文本模型网关（docs/plan.md 3.1 网络）：流式调用并聚合为完整文本。
 * 端点/模型为非敏感配置走 SQLite settings；密钥只存 SecureStore（KeyStore）。
 */

export const LLM_ENDPOINT_KEY = 'llm-endpoint';
export const LLM_MODEL_KEY = 'llm-model';
export const LLM_API_KEY = 'llm-api-key';

interface ChatDelta {
  choices?: Array<{ delta?: { content?: string } }>;
}

export function createOpenAiCompatibleLlmGateway(deps: {
  keyStore: KeyStore;
  settingsRepository: SettingsRepository;
}): LlmGateway {
  return {
    async complete(input: { system: string; user: string; signal?: AbortSignal }): Promise<string> {
      const endpoint = await deps.settingsRepository.get(LLM_ENDPOINT_KEY);
      const model = await deps.settingsRepository.get(LLM_MODEL_KEY);
      const apiKey = await deps.keyStore.get(LLM_API_KEY);
      if (!endpoint || !model || !apiKey) {
        throw new Error('未配置文本模型：请到 设置 → 服务连接 填写端点、模型与密钥');
      }

      const response = await fetch(`${endpoint.replace(/\/$/, '')}/chat/completions`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${apiKey}`,
        },
        body: JSON.stringify({
          model,
          messages: [
            { role: 'system', content: input.system },
            { role: 'user', content: input.user },
          ],
          stream: true,
        }),
        signal: input.signal,
      });
      if (!response.ok) {
        throw new Error(`LLM 请求失败：HTTP ${response.status}`);
      }
      if (!response.body) {
        throw new Error('LLM 响应缺少可读流');
      }

      let assembled = '';
      const parser = createSseParser((event) => {
        if (event.data === '[DONE]') return;
        try {
          const delta = JSON.parse(event.data) as ChatDelta;
          const content = delta.choices?.[0]?.delta?.content;
          if (typeof content === 'string') assembled += content;
        } catch {
          // 非 JSON 行忽略
        }
      });
      const reader = response.body.getReader();
      const decoder = new TextDecoder();
      for (;;) {
        const { done, value } = await reader.read();
        if (done) break;
        parser.push(decoder.decode(value, { stream: true }));
      }
      parser.push(decoder.decode());
      if (assembled.length === 0) throw new Error('LLM 未返回内容');
      return assembled;
    },
  };
}
