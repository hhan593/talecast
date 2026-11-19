import { describe, expect, it } from 'vitest';

import { createAnnotationsService } from './annotations';
import {
  FakeAnnotationRepository,
  FakeProjectRepository,
  FakeReceiptStore,
  FakeSourceFileStore,
  textToBytes,
} from './fakes';

async function setup() {
  const project = { id: 'p1', title: '示例书', description: '', revision: 0, createdAt: 1, updatedAt: 1 };
  const projects = new FakeProjectRepository([project]);
  const library = {
    listChapters: async () => [
      { id: 'ch1', title: '第一章', startOffset: 0, endOffset: 50, headingLine: 0 },
    ],
    getSource: async () => ({ id: 's1', projectId: 'p1', filename: 'n.txt', rawSha256: 'a', textSha256: 'b', importedAt: 1 }),
    createSourceWithChapters: async () => null,
    replaceChapters: async () => null,
    mutateChapters: async () => null,
  } as never;
  const files = new FakeSourceFileStore();
  const fullText = '第一章\n' + '正文内容若干字。'.repeat(10) + '末尾。';
  await files.writeDecodedText('b', fullText);
  const service = createAnnotationsService({
    annotationRepository: new FakeAnnotationRepository(),
    libraryRepository: library,
    projectRepository: projects,
    sourceFileStore: files,
    receiptStore: new FakeReceiptStore(),
  });
  return { service, fullText };
}

describe('v0.12.0 划线与笔记（service）', () => {
  it('添加：区间校验失败拒绝；成功入库', async () => {
    const { service, fullText } = await setup();
    const bad = await service.addAnnotation({
      commandId: 'c1',
      projectId: 'p1',
      chapterId: 'ch1',
      startOffset: 30,
      endOffset: 20,
    });
    expect(bad.ok).toBe(false);
    const good = await service.addAnnotation({
      commandId: 'c1',
      projectId: 'p1',
      chapterId: 'ch1',
      startOffset: 10,
      endOffset: 30,
      note: '记一笔',
    });
    expect(good.ok).toBe(true);
    const list = await service.listAnnotations('p1');
    expect(list.length).toBe(1);
    expect(list[0].note).toBe('记一笔');
    void fullText;
  });

  it('幂等：同 commandId 重复提交不重复入库', async () => {
    const { service } = await setup();
    await service.addAnnotation({ commandId: 'c1', projectId: 'p1', chapterId: 'ch1', startOffset: 10, endOffset: 20 });
    await service.addAnnotation({ commandId: 'c1', projectId: 'p1', chapterId: 'ch1', startOffset: 10, endOffset: 20 });
    expect((await service.listAnnotations('p1')).length).toBe(1);
  });

  it('笔记编辑与删除', async () => {
    const { service } = await setup();
    const added = await service.addAnnotation({ commandId: 'c1', projectId: 'p1', chapterId: 'ch1', startOffset: 10, endOffset: 20 });
    if (!added.ok) throw new Error(added.error.message);
    await service.setNote(added.value.annotation.id, '更新后的笔记');
    expect((await service.listAnnotations('p1'))[0].note).toBe('更新后的笔记');
    await service.removeAnnotation(added.value.annotation.id);
    expect((await service.listAnnotations('p1')).length).toBe(0);
  });

  it('Markdown 导出：书名来自项目、摘录来自原文', async () => {
    const { service, fullText } = await setup();
    await service.addAnnotation({
      commandId: 'c1',
      projectId: 'p1',
      chapterId: 'ch1',
      startOffset: fullText.indexOf('正文'),
      endOffset: fullText.indexOf('正文') + 6,
      note: '精彩',
    });
    const result = await service.exportMarkdown('p1');
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.value.count).toBe(1);
    expect(result.value.markdown).toContain('《示例书》');
    expect(result.value.markdown).toContain('## 第一章');
    expect(result.value.markdown).toContain('**笔记**：精彩');
  });
});
