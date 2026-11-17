import { EDGE_TTS_PROVIDER } from '@/domain/contracts';
import type { TtsGateway, VoiceRecordRepository } from '@/domain/ports';
import { err, ok, type Result } from '@/domain/result';
import type { VoiceRecord } from '@/domain/types';

export interface VoicesDeps {
  ttsGateway: TtsGateway;
  voiceRepository: VoiceRecordRepository;
}

export { EDGE_TTS_PROVIDER };

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
