import { describe, expect, it } from 'vitest';

import { EDGE_TTS_PROVIDER } from '@/domain/contracts';
import type { VoiceRecord } from '@/domain/types';
import { createVoicesService } from './voices';

/** 只实现 VoiceRecordRepository 的两条路径，便于断言"播种/刷新"的落库行为 */
function repoStub(initial: VoiceRecord[] = []) {
  let rows = [...initial];
  return {
    rows: () => rows,
    async replaceAllForProvider(provider: string, voices: Omit<VoiceRecord, "id">[]) {
      rows = rows.filter((row) => row.provider !== provider);
      rows.push(...voices.map((voice, index) => ({ id: `${provider}-${index}`, ...voice })));
    },
    async list(provider: string) {
      return rows.filter((row) => row.provider === provider);
    },
  };
}

function gatewayStub(voices: { voiceId: string; name: string }[] | Error) {
  return {
    async listVoices() {
      if (voices instanceof Error) throw voices;
      return voices.map((voice) => ({
        provider: EDGE_TTS_PROVIDER,
        voiceId: voice.voiceId,
        name: voice.name,
        description: '',
      }));
    },
  };
}

describe('voices service', () => {
  it('音色库为空时用内置清单播种（离线也能选音色）', async () => {
    const repo = repoStub();
    const service = createVoicesService({ ttsGateway: gatewayStub([]) as never, voiceRepository: repo });
    const voices = await service.listVoices();
    expect(voices.length).toBeGreaterThanOrEqual(10);
    expect(voices.some((voice) => voice.voiceId === 'zh-CN-XiaoxiaoNeural')).toBe(true);
    // 播种后可被角色中心再次读取（不依赖网络）
    expect((await service.listVoices()).length).toBe(voices.length);
  });

  it('已有音色时不再播种', async () => {
    const repo = repoStub([
      { id: 'v1', provider: EDGE_TTS_PROVIDER, voiceId: 'zh-CN-YunxiNeural', name: 'Yunxi', description: '' },
    ]);
    const service = createVoicesService({ ttsGateway: gatewayStub([]) as never, voiceRepository: repo });
    const voices = await service.listVoices();
    expect(voices).toHaveLength(1);
    expect(voices[0].voiceId).toBe('zh-CN-YunxiNeural');
  });

  it('刷新成功替换快照；刷新失败保留原快照并给出可读错误', async () => {
    const repo = repoStub();
    const okService = createVoicesService({
      ttsGateway: gatewayStub([{ voiceId: 'zh-CN-XiaoyiNeural', name: 'Xiaoyi' }]) as never,
      voiceRepository: repo,
    });
    const refreshed = await okService.refreshVoices();
    expect(refreshed.ok).toBe(true);
    expect(repo.rows().map((row) => row.voiceId)).toEqual(['zh-CN-XiaoyiNeural']);

    const failService = createVoicesService({
      ttsGateway: gatewayStub(new Error('HTTP 401（请检查手机系统时间是否准确）')) as never,
      voiceRepository: repo,
    });
    const failed = await failService.refreshVoices();
    expect(failed.ok).toBe(false);
    if (failed.ok) return;
    expect(failed.error.code).toBe('network');
    expect(failed.error.message).toContain('401');
    // 失败不清空：用户仍能在旧快照里选音色
    expect(repo.rows()).toHaveLength(1);
  });
});
