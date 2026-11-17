/**
 * 跨层共享的契约常量：由 adapters 与 services 共同引用，避免 services 反向依赖
 * 具体适配器实现。这些值是稳定的外部契约（设置键、Edge 协议字段），不随用例变化。
 */

/** OpenAI 兼容网关的非敏感配置键（SQLite settings）与密钥键（SecureStore） */
export const LLM_ENDPOINT_KEY = 'llm-endpoint';
export const LLM_MODEL_KEY = 'llm-model';
export const LLM_API_KEY = 'llm-api-key';

/** Edge TTS 音频输出格式（段间播放衔接要求全链路统一） */
export const EDGE_AUDIO_FORMAT = 'audio-24khz-48kbitrate-mono-mp3';

/** Edge TTS provider 标识：音色快照桶键、生成任务元数据、fake 数据共用 */
export const EDGE_TTS_PROVIDER = 'edge-tts';
