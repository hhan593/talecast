import { EDGE_TTS_PROVIDER } from './contracts';
import type { VoiceInfo } from './types';

/**
 * 内置中文音色兜底清单（v0.17.1）。
 *
 * 用途：音色列表是网络拉取的，但「能不能开始听」不应该依赖一次成功请求——
 * 首次安装、离线、或服务端再次变更协议时，用户仍应能选到音色并生成。
 * 清单取自 Edge voices/list 的 zh-* 快照；联网刷新会整体替换为最新列表。
 */

export const DEFAULT_NARRATOR_VOICE_ID = 'zh-CN-XiaoxiaoNeural';

interface FallbackVoice {
  voiceId: string;
  label: string;
  gender: '女' | '男';
  locale: string;
  localeName: string;
}

const FALLBACK: FallbackVoice[] = [
  { voiceId: 'zh-CN-XiaoxiaoNeural', label: 'Xiaoxiao · Chinese (Mainland)', gender: '女', locale: 'zh-CN', localeName: 'Chinese (Mandarin, Simplified)' },
  { voiceId: 'zh-CN-XiaoyiNeural', label: 'Xiaoyi · Chinese (Mainland)', gender: '女', locale: 'zh-CN', localeName: 'Chinese (Mandarin, Simplified)' },
  { voiceId: 'zh-CN-YunxiNeural', label: 'Yunxi · Chinese (Mainland)', gender: '男', locale: 'zh-CN', localeName: 'Chinese (Mandarin, Simplified)' },
  { voiceId: 'zh-CN-YunjianNeural', label: 'Yunjian · Chinese (Mainland)', gender: '男', locale: 'zh-CN', localeName: 'Chinese (Mandarin, Simplified)' },
  { voiceId: 'zh-CN-YunxiaNeural', label: 'Yunxia · Chinese (Mainland)', gender: '男', locale: 'zh-CN', localeName: 'Chinese (Mandarin, Simplified)' },
  { voiceId: 'zh-CN-YunyangNeural', label: 'Yunyang · Chinese (Mainland)', gender: '男', locale: 'zh-CN', localeName: 'Chinese (Mandarin, Simplified)' },
  { voiceId: 'zh-CN-liaoning-XiaobeiNeural', label: 'Xiaobei · Chinese (Northeastern Mandarin)', gender: '女', locale: 'zh-CN', localeName: 'Chinese (Northeastern Mandarin, Simplified)' },
  { voiceId: 'zh-CN-shaanxi-XiaoniNeural', label: 'Xiaoni · Chinese (Zhongyuan Mandarin Shaanxi)', gender: '女', locale: 'zh-CN', localeName: 'Chinese (Zhongyuan Mandarin Shaanxi, Simplified)' },
  { voiceId: 'zh-HK-HiuGaaiNeural', label: 'HiuGaai · Chinese (Cantonese Traditional)', gender: '女', locale: 'zh-HK', localeName: 'Chinese (Cantonese, Traditional)' },
  { voiceId: 'zh-HK-HiuMaanNeural', label: 'HiuMaan · Chinese (Hong Kong SAR)', gender: '女', locale: 'zh-HK', localeName: 'Chinese (Cantonese, Traditional)' },
  { voiceId: 'zh-HK-WanLungNeural', label: 'WanLung · Chinese (Hong Kong SAR)', gender: '男', locale: 'zh-HK', localeName: 'Chinese (Cantonese, Traditional)' },
  { voiceId: 'zh-TW-HsiaoChenNeural', label: 'HsiaoChen · Chinese (Taiwan)', gender: '女', locale: 'zh-TW', localeName: 'Chinese (Taiwanese Mandarin, Traditional)' },
  { voiceId: 'zh-TW-HsiaoYuNeural', label: 'HsiaoYu · Chinese (Taiwanese Mandarin)', gender: '女', locale: 'zh-TW', localeName: 'Chinese (Taiwanese Mandarin, Traditional)' },
  { voiceId: 'zh-TW-YunJheNeural', label: 'YunJhe · Chinese (Taiwan)', gender: '男', locale: 'zh-TW', localeName: 'Chinese (Taiwanese Mandarin, Traditional)' },
];

export function fallbackVoices(): VoiceInfo[] {
  return FALLBACK.map((voice) => ({
    provider: EDGE_TTS_PROVIDER,
    voiceId: voice.voiceId,
    name: voice.label,
    description: `${voice.locale} · ${voice.gender === '女' ? '女/Female' : '男/Male'} · ${voice.localeName}`,
  }));
}

/** 默认旁白音色的人类可读名（用于"已自动选择"的提示文案） */
export function defaultVoiceLabel(): string {
  const voice = FALLBACK.find((item) => item.voiceId === DEFAULT_NARRATOR_VOICE_ID);
  return voice ? voice.label.split(' · ')[0] : '默认音色';
}
