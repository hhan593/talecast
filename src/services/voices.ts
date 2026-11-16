import type { TtsGateway, VoiceRecordRepository } from '@/domain/ports';
import { err, ok, type Result } from '@/domain/result';
import type { VoiceRecord } from '@/domain/types';

/**
 * 音色快照（docs/plan.md 4.1.4 / P2）：voices/list 拉取 → 入库为快照；
 * 绑定与音色选择只读快照，不实时请求。
 */

export interface VoicesDeps {
  ttsGateway: TtsGateway;
  voiceRepository: VoiceRecordRepository;
}

export const EDGE_TTS_PROVIDER = 'edge-tts';

export function createVoicesService(deps: VoicesDeps) {
  return {
    /** 刷新音色快照；失败给出明确文案（时钟偏移/协议变更/网络） */
    async refreshVoices(): Promise<Result<{ count: number }>> {
      try {
        const voices = await deps.ttsGateway.listVoices();
        await deps.voiceRepository.replaceAllForProvider(
          EDGE_TTS_PROVIDER,
          voices.map((voice) => ({
            provider: voice.provider,
            voiceId: voice.voiceId,
            name: voice.name,
            description: voice.description ?? '',
          })),
        );
        return ok({ count: voices.length });
      } catch (error) {
        return err('network', `音色列表获取失败：${error instanceof Error ? error.message : String(error)}`);
      }
    },

    async listVoices(provider: string = EDGE_TTS_PROVIDER): Promise<VoiceRecord[]> {
      return deps.voiceRepository.list(provider);
    },

    async findVoice(provider: string, voiceId: string): Promise<VoiceRecord | null> {
      return deps.voiceRepository.findByVoiceId(provider, voiceId);
    },
  };
}

export type VoicesService = ReturnType<typeof createVoicesService>;
