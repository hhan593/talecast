import { describe, expect, it } from 'vitest';

import { createCharactersService } from './characters';
import { createImportService } from './import';
import {
  FakeCharacterRepository,
  FakeLibraryRepository,
  FakeLlmGateway,
  FakeProjectRepository,
  FakeReceiptStore,
  FakeRequestLogRepository,
  FakeSourceFileStore,
  textToBytes,
} from './fakes';
import type { CharacterRecord } from '@/domain/types';

const now = 1;

function protectedCharacter(name: string): CharacterRecord {
  return {
    id: `char-${name}`,
    projectId: 'p1',
    name,
    aliasesJson: '[]',
    profileJson: JSON.stringify({ profile: '已确认角色' }),
    confirmed: true,
    manualProtected: true,
    createdAt: now,
    updatedAt: now,
  };
}

async function setup(existing: CharacterRecord[] = []) {
  const project = { id: 'p1', title: '示例', description: '', revision: 0, createdAt: now, updatedAt: now };
  const library = new FakeLibraryRepository([project]);
  const files = new FakeSourceFileStore();
  const receipts = new FakeReceiptStore();
  const llm = new FakeLlmGateway();
  const charactersRepo = new FakeCharacterRepository();
  charactersRepo.rows = [...existing];

  const importService = createImportService({
    filePicker: { pickTextFile: async () => null },
    libraryRepository: library,
    sourceFileStore: files,
    receiptStore: receipts,
  });
  const filler = '夜里落了细雨，屋檐下的灯忽明忽暗。';
  await importService.importSource({
    commandId: 'c-import',
    projectId: 'p1',
    fileName: 'n.txt',
    bytes: textToBytes(`第一章 起\n${filler.repeat(10)}`),
  });

  const characters = createCharactersService({
    characterRepository: charactersRepo,
    libraryRepository: library,
    sourceFileStore: files,
    llmGateway: llm,
    requestLogRepository: new FakeRequestLogRepository(),
    receiptStore: receipts,
  });
  return { characters, charactersRepo, llm };
}

describe('角色人工保护', () => {
  it('人工确认同时置 confirmed 与 manualProtected', async () => {
    const { characters, charactersRepo } = await setup([{ ...protectedCharacter('阿福'), confirmed: false, manualProtected: false }]);
    const result = await characters.confirmCharacter({ commandId: 'c-confirm', characterId: 'char-阿福' });
    expect(result.ok).toBe(true);
    const saved = await charactersRepo.get('char-阿福');
    expect(saved?.confirmed).toBe(true);
    expect(saved?.manualProtected).toBe(true);
  });

  it('抽取不覆盖已人工保护的同名角色，也不重复入库', async () => {
    const { characters, charactersRepo, llm } = await setup([protectedCharacter('阿福')]);
    llm.response = JSON.stringify({ characters: [{ name: '阿福', profile: '模型改写' }, { name: '新角色' }] });

    const result = await characters.extractCandidates({ commandId: 'c-extract', projectId: 'p1' });
    expect(result.ok).toBe(true);
    const rows = await charactersRepo.list('p1');
    expect(rows.filter((c) => c.name === '阿福')).toHaveLength(1);
    expect(rows.find((c) => c.name === '阿福')?.profileJson).toContain('已确认角色');
    expect(rows.some((c) => c.name === '新角色')).toBe(true);
  });
});
