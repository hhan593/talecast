import {
  assertAnnotationNote,
  assertAnnotationSpan,
  buildAnnotationExcerpt,
  renderAnnotationsMarkdown,
  type AnnotationRecord,
  type AnnotationMarkdownItem,
} from '@/domain/annotations';
import { resolveIdempotent, type Command } from '@/domain/commands';
import type { AnnotationRepository, LibraryRepository, ProjectRepository, ReceiptStore, SourceFileStore } from '@/domain/ports';
import { errorMessage, err, ok, type Result } from '@/domain/result';

/**
 * 划线与笔记服务（v0.12.0）：添加（幂等回执）/ 删除 / 笔记编辑 / Markdown 导出。
 * 摘录从来源原文切片（书级偏移），导出按章节顺序聚合。
 */
export interface AnnotationsDeps {
  annotationRepository: AnnotationRepository;
  libraryRepository: LibraryRepository;
  projectRepository: ProjectRepository;
  sourceFileStore: SourceFileStore;
  receiptStore: ReceiptStore;
}

export interface AddAnnotationCommand extends Command {
  projectId: string;
  chapterId: string;
  startOffset: number;
  endOffset: number;
  note?: string;
}

export function createAnnotationsService(deps: AnnotationsDeps) {
  return {
    async addAnnotation(command: AddAnnotationCommand): Promise<Result<{ annotation: AnnotationRecord }>> {
      const receipt = await deps.receiptStore.get<{ annotation: AnnotationRecord }>(command.commandId);
      return resolveIdempotent(receipt, async () => {
        const chapters = await deps.libraryRepository.listChapters(command.projectId);
        const chapter = chapters.find((c) => c.id === command.chapterId);
        if (!chapter) return err('not_found', '章节不存在');
        const spanError = assertAnnotationSpan(command.startOffset, command.endOffset, chapter.endOffset);
        if (spanError) return err('invalid', spanError);
        const note = command.note ?? '';
        const noteError = assertAnnotationNote(note);
        if (noteError) return err('invalid', noteError);
        const now = Date.now();
        const record: AnnotationRecord = {
          id: command.commandId,
          projectId: command.projectId,
          chapterId: command.chapterId,
          startOffset: command.startOffset,
          endOffset: command.endOffset,
          kind: 'underline',
          note,
          createdAt: now,
          updatedAt: now,
        };
        await deps.annotationRepository.insert(record);
        await deps.receiptStore.put({
          commandId: command.commandId,
          result: ok({ annotation: record }),
          createdAt: Date.now(),
        });
        return ok({ annotation: record });
      });
    },

    async removeAnnotation(annotationId: string): Promise<void> {
      await deps.annotationRepository.remove(annotationId);
    },

    async setNote(annotationId: string, note: string): Promise<Result<null>> {
      const noteError = assertAnnotationNote(note);
      if (noteError) return err('invalid', noteError);
      await deps.annotationRepository.update(annotationId, { note });
      return ok(null);
    },

    listAnnotations(projectId: string): Promise<AnnotationRecord[]> {
      return deps.annotationRepository.list(projectId);
    },

    /** Markdown 导出：按章节顺序聚合划线与笔记（含上下文摘录） */
    async exportMarkdown(projectId: string): Promise<Result<{ markdown: string; count: number }>> {
      try {
        const [records, chapters, source, project] = await Promise.all([
          deps.annotationRepository.list(projectId),
          deps.libraryRepository.listChapters(projectId),
          deps.libraryRepository.getSource(projectId),
          deps.projectRepository.get(projectId),
        ]);
        const chapterById = new Map(chapters.map((c) => [c.id, c]));
        const fullText = source ? await deps.sourceFileStore.readDecodedText(source.textSha256) : '';
        const items: AnnotationMarkdownItem[] = [];
        for (const record of records) {
          const chapter = chapterById.get(record.chapterId);
          const start = Math.max(0, record.startOffset);
          const end = Math.max(start + 1, record.endOffset);
          const { excerpt } = fullText
            ? buildAnnotationExcerpt(fullText, start, end)
            : { excerpt: fullText.slice(start, end) || '（原文已重新导入，摘录不可用）' };
          items.push({
            chapterTitle: chapter?.title ?? '未知章节',
            excerpt,
            note: record.note,
            createdAt: record.createdAt,
          });
        }
        const title = project?.title ?? source?.filename.replace(/\.(txt|epub)$/i, '') ?? '我的书';
        const markdown = renderAnnotationsMarkdown(title, items);
        return ok({ markdown, count: items.length });
      } catch (error) {
        return err('storage', `导出失败：${errorMessage(error)}`);
      }
    },
  };
}

export type AnnotationsService = ReturnType<typeof createAnnotationsService>;
