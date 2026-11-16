import { fetch } from 'expo/fetch';

import { createSseParser, type SseEvent } from './parse-sse';

/**
 * OpenAI 兼容 chat/completions 流式调用（docs/plan.md 3.1：RN 全局 fetch 不支持
 * ReadableStream，SSE 必须走 expo/fetch）。
 * 真实网络链路需在 Expo Go 设备端做 P0 冒烟验收；解析逻辑已被 parse-sse.test.ts 覆盖。
 */

export interface StreamChatInput {
  baseUrl: string;
  apiKey: string;
  model: string;
  messages: Array<{ role: 'system' | 'user' | 'assistant'; content: string }>;
  signal?: AbortSignal;
}

export async function streamChatCompletion(
  input: StreamChatInput,
  onEvent: (event: SseEvent) => void,
): Promise<void> {
  const response = await fetch(`${input.baseUrl.replace(/\/$/, '')}/chat/completions`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${input.apiKey}`,
    },
    body: JSON.stringify({
      model: input.model,
      messages: input.messages,
      stream: true,
    }),
    signal: input.signal,
  });

  if (!response.ok) {
    throw new Error(`LLM 请求失败：HTTP ${response.status}`);
  }
  if (!response.body) {
    throw new Error('LLM 响应缺少可读流；请确认使用 expo/fetch 且服务端支持 stream=true');
  }

  const reader = response.body.getReader();
  const decoder = new TextDecoder();
  const parser = createSseParser(onEvent);
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    parser.push(decoder.decode(value, { stream: true }));
  }
  parser.push(decoder.decode());
}
