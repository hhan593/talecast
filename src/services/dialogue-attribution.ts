import { buildDialogueCandidates } from '@/domain/dialogue';

import type { CharacterRepository, LlmGateway, LibraryRepository, SettingsRepository, SourceFileStore, BindingRepository } from '@/domain/ports';
import { sha256Text } from '@/domain/hash';
import { errorMessage, err, ok, type Result } from '@/domain/result';

/**
 * LLM 段落级说话人归属（v0.13.0，可选增强）：
 * 启发式归属无法处理的"无引号对话/代词对话"由 LLM 补充。
 * 结果按 正文hash+角色集hash 缓存于 settings；LLM 不可用/失败 → 静默回退启发式。
 */
export interface DialogueAttributionDeps {
  llmGateway: LlmGateway;
  settingsRepository: SettingsRepository;
  characterRepository: CharacterRepository;
  bindingRepository: BindingRepository;
  libraryRepository: LibraryRepository;
  sourceFileStore: SourceFileStore;
}

export interface SpeakerOverride {
  paragraphStart: number;
  characterId: string;
}

const MAX_LLM_TEXT_CHARS = 30_000;

export function createDialogueAttributionService(deps: DialogueAttributionDeps) {
  /** 角色候选（同 buildDialogueCandidates 语义：已确认 × 已绑定） */
  async function candidates(projectId: string): Promise<{ key: string; names: string[] }[]> {
    const characters = await deps.characterRepository.list(projectId);
    const bindings = await deps.bindingRepository.list(projectId);
    return buildDialogueCandidates(characters, bindings);
  }

  return {
    /**
     * 归属一章：返回 [段落起点, 角色id] 覆盖列表（仅覆盖 LLM 有把握的段落）。
     * settings 开关 `llm-attribute-dialogue` 默认关。
     */
    async attributeChapter(
      projectId: string,
      chapterId: string,
      chapterText: string,
    ): Promise<Result<SpeakerOverride[]>> {
      const enabled = await deps.settingsRepository.get('llm-attribute-dialogue');
      if (enabled !== 'on') return err('invalid', 'LLM 归属未开启');
      const list = await candidates(projectId);
      if (list.length === 0) return ok([]);
      const cacheKey = `speaker-attribution:${projectId}:${chapterId}`;
      const characterHash = sha256Text(list.map((c) => `${c.key}:${c.names.join('|')}`).join(';'));
      const textSha = sha256Text(chapterText);
      const cached = await deps.settingsRepository.get(cacheKey);
      if (cached) {
        try {
          const parsed = JSON.parse(cached) as { textSha: string; characterHash: string; overrides: SpeakerOverride[] };
          if (parsed.textSha === textSha && parsed.characterHash === characterHash) {
            return ok(parsed.overrides);
          }
        } catch {
          // 缓存损坏按未命中处理
        }
      }

      const nameToId = new Map<string, string>();
      for (const candidate of list) {
        for (const name of candidate.names) nameToId.set(name, candidate.key);
      }
      const system =
        '你是小说对话归属助手。给定角色名单与正文，判断每个含对话段落的说话人。' +
        '只输出 JSON 数组，格式 [{"p":段落序号,"s":"角色名"}]，段落序号从 0 起；' +
        '说话人不明的段落不要输出。不要输出任何其他内容。';
      const text = chapterText.length > MAX_LLM_TEXT_CHARS ? chapterText.slice(0, MAX_LLM_TEXT_CHARS) : chapterText;
      const user = `角色：${list.flatMap((c) => c.names).join('、')}

正文：
${text}`;
      let raw: string;
      try {
        raw = await deps.llmGateway.complete({ system, user });
      } catch (error) {
        return err('network', `LLM 归属失败：${errorMessage(error)}`);
      }
      let overrides: SpeakerOverride[];
      try {
        const parsed = JSON.parse(raw.trim()) as { p: number; s: string }[];
        // 段落起点表：按 LLM 提示口径构建——跳过空行的段落序号 → 段首偏移
        //（item.p 只数非空行；消费端 applyAttributionOverrides 用同一文本的原始行区间匹配）
        const lines = chapterText.split('\n');
        const paragraphStarts: number[] = [];
        let cursor = 0;
        for (const line of lines) {
          if (line.trim().length > 0) paragraphStarts.push(cursor);
          cursor += line.length + 1;
        }
        overrides = [];
        for (const item of parsed) {
          if (typeof item.p !== 'number' || typeof item.s !== 'string') continue;
          const characterId = nameToId.get(item.s);
          if (!characterId || item.p < 0 || item.p >= paragraphStarts.length) continue;
          overrides.push({ paragraphStart: paragraphStarts[item.p], characterId });
        }
      } catch {
        return err('invalid', 'LLM 归属输出无法解析');
      }
      await deps.settingsRepository.set(
        cacheKey,
        JSON.stringify({ textSha, characterHash, overrides }),
      );
      return ok(overrides);
    },
  };
}

export type DialogueAttributionService = ReturnType<typeof createDialogueAttributionService>;
