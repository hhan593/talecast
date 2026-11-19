import { describe, expect, it } from 'vitest';

import { createDialogueAttributionService } from './dialogue-attribution';
import { FakeLlmGateway, FakeSettingsRepository } from './fakes';

function setup(llmResponse: string | null, opts: { llmOn?: boolean } = {}) {
  const llm = new FakeLlmGateway();
  llm.response = llmResponse;
  const settings = new FakeSettingsRepository();
  if (opts.llmOn) settings.map.set('llm-attribute-dialogue', 'on');
  const library = {
    listChapters: async () => [{ id: 'ch1', title: '第一章', startOffset: 0, endOffset: 100, headingLine: 0 }],
    getSource: async () => null,
    createSourceWithChapters: async () => null,
    replaceChapters: async () => null,
    mutateChapters: async () => null,
  } as never;
  const service = createDialogueAttributionService({
    llmGateway: llm,
    settingsRepository: settings,
    characterRepository: {
      list: async () => [
        { id: 'char-lin', projectId: 'p1', name: '林晚', aliasesJson: '[]', profileJson: '{}', confirmed: true, manualProtected: true, createdAt: 1, updatedAt: 1 },
      ],
      get: async () => null,
      insert: async () => undefined,
      update: async () => undefined,
      delete: async () => undefined,
    },
    bindingRepository: {
      getForTarget: async () => null,
      list: async () => [{ id: 'b1', projectId: 'p1', targetType: 'character', targetId: 'char-lin', voiceId: 'v2', providerParamsJson: '{}', revision: 1, updatedAt: 1 }],
      upsert: async () => null,
    } as never,
    libraryRepository: library,
    sourceFileStore: null as never,
  });
  return { llm, settings, service };
}

describe('v0.13.0 LLM 段落级说话人归属', () => {
  const text = '林晚走了进来。\n她冷冷开口：“都出去。”\n没人敢动。';

  it('开关未开启：直接拒绝', async () => {
    const { service } = setup('[]');
    const result = await service.attributeChapter('p1', 'ch1', text);
    expect(result.ok).toBe(false);
  });

  it('LLM 正常输出：段落序号 → 书级偏移覆盖', async () => {
    const { service } = setup('[{"p":1,"s":"林晚"}]', { llmOn: true });
    const result = await service.attributeChapter('p1', 'ch1', text);
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    // 段落 1 起点 = 行0 长度 + 1
    expect(result.value).toEqual([{ paragraphStart: text.indexOf('她冷冷开口'), characterId: 'char-lin' }]);
  });

  it('缓存：同文本同角色集第二次不再调用 LLM', async () => {
    const { llm, service } = setup('[{"p":1,"s":"林晚"}]', { llmOn: true });
    await service.attributeChapter('p1', 'ch1', text);
    const callsAfterFirst = llm.calls.length;
    await service.attributeChapter('p1', 'ch1', text);
    expect(llm.calls.length).toBe(callsAfterFirst);
  });

  it('LLM 输出无法解析：明确错误（调用方回退启发式）', async () => {
    const { service } = setup('这不是 JSON', { llmOn: true });
    const result = await service.attributeChapter('p1', 'ch1', text);
    expect(result.ok).toBe(false);
  });

  it('空行排版：段落序号跳过空行对齐段首（issue #29）', async () => {
    const { service, settings } = setup('[{"p":1,"s":"林晚"}]', { llmOn: true });
    const spaced = '林晚走了进来。\n\n她冷冷开口："都出去。"\n\n没人敢动。';
    const result = await service.attributeChapter('p1', 'ch1', spaced);
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    // 段落 1 = 第一个非空行之后的有内容行 → "她冷冷开口" 段首（不是空行位置）
    expect(result.value).toEqual([{ paragraphStart: spaced.indexOf('她冷冷开口'), characterId: 'char-lin' }]);
    void settings;
  });

  it('未知角色名/越界段落被过滤', async () => {
    const { service } = setup('[{"p":1,"s":"路人甲"},{"p":99,"s":"林晚"}]', { llmOn: true });
    const result = await service.attributeChapter('p1', 'ch1', text);
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.value.length).toBe(0);
  });
});
