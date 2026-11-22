import { resolveIdempotent, type Command } from '@/domain/commands';
import type {
  CharacterRepository,
  LlmGateway,
  LibraryRepository,
  ReceiptStore,
  RequestLogRepository,
  SourceFileStore,
} from '@/domain/ports';
import { errError, errorMessage, err, ok, remoteErrorCode, type Result } from '@/domain/result';
import type { CharacterRecord } from '@/domain/types';

export interface CharactersDeps {
  characterRepository: CharacterRepository;
  libraryRepository: LibraryRepository;
  sourceFileStore: SourceFileStore;
  llmGateway: LlmGateway;
  requestLogRepository: RequestLogRepository;
  receiptStore: ReceiptStore;
}

export interface ExtractCharactersCommand extends Command {
  projectId: string;
  /** 抽取样本章节数（默认前 3 章，避免整本超限） */
  maxChapters?: number;
  maxCharsPerChapter?: number;
}

const EXTRACTION_SYSTEM_PROMPT =
  '你是中文小说的角色分析助手。从给定的章节文本中提取出场角色。' +
  '只输出 JSON，不要解释。格式：{"characters":[{"name":"角色名","aliases":["别名"],"profile":"一句话身份/性格描述"}]}。' +
  '要求：1) 只列真实出场且有名字的角色，合并同一角色的不同称呼（主名取最常用者）；' +
  '2) 无名群众/龙套不列；3) profile 不超过 40 字；4) 如果没有明确角色，返回 {"characters":[]}。';

function parseCharacterJson(raw: string): { name: string; aliases?: string[]; profile?: string }[] {
  const cleaned = raw.replace(/```json|```/g, '').trim();
  const start = cleaned.indexOf('{');
  const end = cleaned.lastIndexOf('}');
  if (start === -1 || end === -1 || end <= start) {
    throw new Error('模型未返回可解析的 JSON');
  }
  const parsed = JSON.parse(cleaned.slice(start, end + 1)) as {
    characters?: { name?: string; aliases?: string[]; profile?: string }[];
  };
  const characters = Array.isArray(parsed.characters) ? parsed.characters : [];
  return characters
    .filter((c) => typeof c.name === 'string' && c.name.trim().length > 0)
    .map((c) => ({ name: c.name!.trim(), aliases: c.aliases, profile: c.profile }));
}

export function createCharactersService(deps: CharactersDeps) {
  return {
    async listCharacters(projectId: string): Promise<CharacterRecord[]> {
      return deps.characterRepository.list(projectId);
    },

    async extractCandidates(command: ExtractCharactersCommand): Promise<Result<{ count: number }>> {
      const receipt = await deps.receiptStore.get<{ count: number }>(command.commandId);
      return resolveIdempotent(receipt, async () => {
        const source = await deps.libraryRepository.getSource(command.projectId);
        if (!source) return errError('noText');
        const chapters = await deps.libraryRepository.listChapters(command.projectId);
        if (chapters.length === 0) return errError('noChapters');

        const maxChapters = Math.min(Math.max(command.maxChapters ?? 3, 1), chapters.length);
        const maxChars = command.maxCharsPerChapter ?? 2000;
        const text = await deps.sourceFileStore.readDecodedText(source.textSha256);
        const samples = chapters
          .slice(0, maxChapters)
          .map((chapter) => text.slice(chapter.startOffset, chapter.endOffset).slice(0, maxChars));
        const userPrompt = `章节文本如下（共 ${samples.length} 段样本）：\n\n${samples.join('\n\n---\n\n')}`;

        let raw: string;
        try {
          raw = await deps.llmGateway.complete({ system: EXTRACTION_SYSTEM_PROMPT, user: userPrompt });
          await deps.requestLogRepository.log('llm', true, `characters:${command.projectId}`);
        } catch (error) {
          const message = errorMessage(error);
          await deps.requestLogRepository.log('llm', false, message.slice(0, 200));
          return err(remoteErrorCode(error), message);
        }

        let candidates: { name: string; aliases?: string[]; profile?: string }[];
        try {
          candidates = parseCharacterJson(raw);
        } catch (error) {
          return err('invalid', `角色抽取结果解析失败：${errorMessage(error)}`);
        }

        const existing = await deps.characterRepository.list(command.projectId);
        const protectedNames = new Set(
          existing.filter((c) => c.manualProtected).map((c) => c.name),
        );
        const existingNames = new Set(existing.map((c) => c.name));
        const now = Date.now();
        let inserted = 0;
        for (const candidate of candidates) {
          if (existingNames.has(candidate.name) || protectedNames.has(candidate.name)) continue;
          await deps.characterRepository.insert({
            id: `char-${command.commandId}-${inserted}`,
            projectId: command.projectId,
            name: candidate.name,
            aliasesJson: JSON.stringify(candidate.aliases ?? []),
            profileJson: JSON.stringify({ profile: candidate.profile ?? '' }),
            confirmed: false,
            manualProtected: false,
            createdAt: now,
            updatedAt: now,
          });
          inserted += 1;
        }
        await deps.receiptStore.put({
          commandId: command.commandId,
          result: ok({ count: inserted }),
          createdAt: Date.now(),
        });
        return ok({ count: inserted });
      });
    },

    async confirmCharacter(command: { commandId: string; characterId: string }): Promise<Result<null>> {
      const receipt = await deps.receiptStore.get<null>(command.commandId);
      return resolveIdempotent(receipt, async () => {
        const character = await deps.characterRepository.get(command.characterId);
        if (!character) return errError('characterMissing');
        await deps.characterRepository.update(command.characterId, { confirmed: true, manualProtected: true });
        await deps.receiptStore.put({
          commandId: command.commandId,
          result: ok(null),
          createdAt: Date.now(),
        });
        return ok(null);
      });
    },

    async renameCharacter(characterId: string, newName: string): Promise<Result<null>> {
      const name = newName.trim();
      if (name.length === 0 || name.length > 30) return errError('characterNameLength');
      const character = await deps.characterRepository.get(characterId);
      if (!character) return errError('characterMissing');
      await deps.characterRepository.update(characterId, { name });
      return ok(null);
    },

    async deleteCharacter(characterId: string): Promise<Result<null>> {
      const character = await deps.characterRepository.get(characterId);
      if (!character) return errError('characterMissing');
      if (character.manualProtected && character.confirmed) {
        return errError('characterProtected');
      }
      await deps.characterRepository.delete(characterId);
      return ok(null);
    },
  };
}

export type CharactersService = ReturnType<typeof createCharactersService>;
