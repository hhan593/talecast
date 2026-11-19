import { readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

import { sha256Bytes } from '@/domain/hash';
import { createImportService } from './import';
import { createChapterEditService } from './chapter-edits';
import { createReadingService } from './reading';
import { createProjectsService } from './projects';
import { createLibraryQueryService } from './library-query';
import { createSplitReviewService } from './split-review';
import {
  FakeFilePicker,
  FakeLibraryRepository,
  FakeProjectRepository,
  FakeReceiptStore,
  FakeReadingStateRepository,
  FakeSourceFileStore,
  FakeSplitProposalRepository,
  textToBytes,
} from './fakes';

const SAMPLE_NOVEL_PATH = join(__dirname, '..', '..', 'tests', 'fixtures', 'sample-novel.txt');

async function loadSample(): Promise<Uint8Array> {
  const text = await readFile(SAMPLE_NOVEL_PATH, 'utf-8');
  return textToBytes(text);
}

function setup() {
  const project = {
    id: 'p1',
    title: '示例工程',
    description: '',
    tags: [],
    revision: 0,
    createdAt: 1,
    updatedAt: 1,
  };
  const projects = new FakeProjectRepository([project]);
  const library = new FakeLibraryRepository([project]);
  const receipts = new FakeReceiptStore();
  const files = new FakeSourceFileStore();
  const proposals = new FakeSplitProposalRepository();
  const readingStates = new FakeReadingStateRepository();
  return {
    project,
    projects,
    library,
    receipts,
    files,
    proposals,
    readingStates,
    importService: createImportService({
      filePicker: new FakeFilePicker(null),
      libraryRepository: library,
      sourceFileStore: files,
      receiptStore: receipts,
    }),
    splitReview: createSplitReviewService({
      projectRepository: projects,
      libraryRepository: library,
      splitProposalRepository: proposals,
      sourceFileStore: files,
      receiptStore: receipts,
    }),
    chapterEdits: createChapterEditService({
      projectRepository: projects,
      libraryRepository: library,
      receiptStore: receipts,
    }),
    reading: createReadingService({
      readingStateRepository: readingStates,
      libraryQuery: createLibraryQueryService({
        libraryRepository: library,
        splitProposalRepository: proposals,
        sourceFileStore: files,
      }),
    }),
    projectsService: createProjectsService({
      projectRepository: projects,
      receiptStore: receipts,
    }),
  };
}

describe('P1 导入 → 分章 → 采用/撤销 → 编辑 全流程', () => {
  it('导入示例小说：双哈希、不可变文件、初始章节', async () => {
    const s = setup();
    const bytes = await loadSample();
    const result = await s.importService.importSource({
      commandId: 'cmd-import-1',
      projectId: 'p1',
      fileName: 'sample-novel.txt',
      bytes,
    });
    expect(result.ok).toBe(true);
    if (!result.ok) return;

    expect(result.value.source.filename).toBe('sample-novel.txt');
    expect(result.value.source.rawSha256).toBe(sha256Bytes(bytes));
    expect(result.value.source.byteSize).toBe(bytes.length);
    // 双哈希口径：raw = 原始字节身份，text = 解码文本身份。
    // 来源是 UTF-8 时两者字节流相同，哈希值相等是预期行为（GB18030 输入被拒绝，不会出现不同值）。
    const text = new TextDecoder().decode(bytes);
    expect(result.value.source.textSha256).toBe(sha256Bytes(new TextEncoder().encode(text)));
    // 不可变文件已按内容寻址落盘
    expect(s.files.raw.get(result.value.source.rawSha256)).toEqual(bytes);
    expect(s.files.text.get(result.value.source.textSha256)).toContain('第三章 归来');
    // 初始章节由正则产出：前言 + 三章
    expect(result.value.chapters.map((d) => d.title)).toEqual(['前言', '第一章 重逢', '第二章 别离', '第三章 归来']);
    // 原子写发生
    expect(s.library.calls).toContain('createSourceWithChapters');
  });

  it('幂等：相同 commandId 重复导入返回旧回执，不重复写', async () => {
    const s = setup();
    const bytes = await loadSample();
    const command = { commandId: 'cmd-import-1', projectId: 'p1', fileName: 'sample-novel.txt', bytes };
    await s.importService.importSource(command);
    const second = await s.importService.importSource(command);
    expect(second.ok).toBe(true);
    expect(s.library.calls.filter((c) => c === 'createSourceWithChapters')).toHaveLength(1);
  });

  it('拒绝非 UTF-8 字节并给出明确文案', async () => {
    const s = setup();
    const gbkBytes = new Uint8Array([0xd6, 0xd0, 0xb9, 0xfa]); // "中国" 的 GBK 字节
    const result = await s.importService.importSource({
      commandId: 'cmd-gbk',
      projectId: 'p1',
      fileName: 'gbk.txt',
      bytes: gbkBytes,
    });
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.error.code).toBe('invalid');
    expect(result.error.message).toContain('UTF-8');
  });

  it('一本书只接受一份文本来源', async () => {
    const s = setup();
    const bytes = await loadSample();
    await s.importService.importSource({ commandId: 'c1', projectId: 'p1', fileName: 'a.txt', bytes });
    const result = await s.importService.importSource({
      commandId: 'c2',
      projectId: 'p1',
      fileName: 'b.txt',
      bytes: textToBytes('另一本书\n内容'),
    });
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.error.message).toContain('只支持一份');
  });

  it('重新分章 → 采用推进 revision → 撤销回退上一版；来源文本不变', async () => {
    const s = setup();
    const bytes = await loadSample();
    await s.importService.importSource({ commandId: 'c-import', projectId: 'p1', fileName: 'n.txt', bytes });
    const revisionBefore = s.project.revision;

    const proposed = await s.splitReview.proposeResplit({ commandId: 'c-prop', projectId: 'p1' });
    expect(proposed.ok).toBe(true);
    if (!proposed.ok) return;

    // 人工编辑制造"上一版"差异：改名第一章
    const chapters = await s.library.listChapters('p1');
    const renamed = await s.chapterEdits.renameChapter({
      commandId: 'c-rename',
      projectId: 'p1',
      chapterId: chapters[1].id,
      newTitle: '第一章 重逢（改）',
      expectedRevision: s.project.revision,
    });
    expect(renamed.ok).toBe(true);

    const adopted = await s.splitReview.adoptProposal({
      commandId: 'c-adopt',
      projectId: 'p1',
      proposalId: proposed.value.proposalId,
      expectedRevision: s.project.revision,
    });
    expect(adopted.ok).toBe(true);
    expect(s.project.revision).toBe(revisionBefore + 2); // 编辑 +1、采用 +1
    // 采用后目录回到正则结果（改名被覆盖）
    const afterAdopt = await s.library.listChapters('p1');
    expect(afterAdopt.map((c) => c.title)).toEqual(['前言', '第一章 重逢', '第二章 别离', '第三章 归来']);

    const undone = await s.splitReview.undoAdopt({
      commandId: 'c-undo',
      projectId: 'p1',
      proposalId: proposed.value.proposalId,
      expectedRevision: s.project.revision,
    });
    expect(undone.ok).toBe(true);
    expect(s.project.revision).toBe(revisionBefore + 3);
    const afterUndo = await s.library.listChapters('p1');
    // 撤销回到采用前的上一版（保留人工改名）
    expect(afterUndo.map((c) => c.title)).toContain('第一章 重逢（改）');
    // 来源不变：文件仍按原哈希存在
    const source = await s.library.getSource('p1');
    expect(s.files.text.get(source!.textSha256)).toContain('第三章 归来');
  });

  it('expectedRevision 不匹配时采用返回 conflict 且无写', async () => {
    const s = setup();
    const bytes = await loadSample();
    await s.importService.importSource({ commandId: 'c-import', projectId: 'p1', fileName: 'n.txt', bytes });
    const proposed = await s.splitReview.proposeResplit({ commandId: 'c-prop', projectId: 'p1' });
    expect(proposed.ok).toBe(true);
    if (!proposed.ok) return;

    const result = await s.splitReview.adoptProposal({
      commandId: 'c-adopt',
      projectId: 'p1',
      proposalId: proposed.value.proposalId,
      expectedRevision: s.project.revision + 5,
    });
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.error.code).toBe('conflict');
    expect(s.library.calls.filter((c) => c.startsWith('replaceChapters'))).toHaveLength(0);
  });

  it('章节编辑：拆分/边界/删除，区间保持衔接覆盖', async () => {
    const s = setup();
    const bytes = await loadSample();
    await s.importService.importSource({ commandId: 'c-import', projectId: 'p1', fileName: 'n.txt', bytes });
    let chapters = await s.library.listChapters('p1');
    const chapter = chapters[2]; // 第二章 别离

    // 拆分（增）
    const mid = Math.floor((chapter.startOffset + chapter.endOffset) / 2);
    const split = await s.chapterEdits.splitChapter({
      commandId: 'c-split',
      projectId: 'p1',
      chapterId: chapter.id,
      splitAtOffset: mid,
      expectedRevision: s.project.revision,
    });
    expect(split.ok).toBe(true);
    chapters = await s.library.listChapters('p1');
    expect(chapters.length).toBe(5);
    expect(chapters[3].title).toBe('第二章 别离（下）');

    // 边界移动（调）
    const newEnd = chapters[2].startOffset + 5;
    const moved = await s.chapterEdits.moveBoundary({
      commandId: 'c-boundary',
      projectId: 'p1',
      chapterId: chapters[2].id,
      newEndOffset: newEnd,
      expectedRevision: s.project.revision,
    });
    expect(moved.ok).toBe(true);
    chapters = await s.library.listChapters('p1');
    expect(chapters[2].endOffset).toBe(newEnd);
    expect(chapters[3].startOffset).toBe(newEnd);

    // 删除（删）：并入前一章
    const deleted = await s.chapterEdits.deleteChapter({
      commandId: 'c-delete',
      projectId: 'p1',
      chapterId: chapters[3].id,
      expectedRevision: s.project.revision,
    });
    expect(deleted.ok).toBe(true);
    chapters = await s.library.listChapters('p1');
    expect(chapters.length).toBe(4);
    expect(chapters[2].endOffset).toBeGreaterThan(newEnd);

    // 全程区间衔接且覆盖全文
    const source = await s.library.getSource('p1');
    const text = await s.files.readDecodedText(source!.textSha256);
    for (let i = 1; i < chapters.length; i++) {
      expect(chapters[i].startOffset).toBe(chapters[i - 1].endOffset);
    }
    expect(chapters[0].startOffset).toBe(0);
    expect(chapters[chapters.length - 1].endOffset).toBe(text.length);
  });

  it('阅读位置：恢复时对已消失章节回退第一章', async () => {
    const s = setup();
    const bytes = await loadSample();
    await s.importService.importSource({ commandId: 'c-import', projectId: 'p1', fileName: 'n.txt', bytes });
    const chapters = await s.library.listChapters('p1');

    await s.reading.savePosition('p1', chapters[2].id, 42);
    expect(await s.reading.restorePosition('p1', chapters)).toEqual({
      chapterId: chapters[2].id,
      charOffset: 42,
    });

    // 章节集合变化后旧落点失效 → 回退第一章
    const rebuilt = [chapters[0], chapters[1]];
    const restored = await s.reading.restorePosition('p1', rebuilt);
    expect(restored).toEqual({ chapterId: chapters[0].id, charOffset: 0 });
  });
});

describe('工程删除服务', () => {
  it('删除工程后工程不可再取，重复删除返回 not_found', async () => {
    const s = setup();
    const first = await s.projectsService.deleteProject({ projectId: 'p1' });
    expect(first.ok).toBe(true);
    expect(await s.projects.get('p1')).toBeNull();

    const second = await s.projectsService.deleteProject({ projectId: 'p1' });
    expect(second.ok).toBe(false);
    if (!second.ok) expect(second.error.code).toBe('not_found');
  });
});
