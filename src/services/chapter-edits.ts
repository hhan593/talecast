import { resolveIdempotent, type Command } from '@/domain/commands';
import type { ChapterEditKind, LibraryRepository, ProjectRepository } from '@/domain/ports';
import type { ReceiptStore } from '@/domain/ports';
import { err, ok, type Result } from '@/domain/result';
import type { Chapter, Project } from '@/domain/types';

/**
 * 章节人工编辑（docs/plan.md 4.1.3：改标题、调边界、增删章节；5.2 chapter_edits 审计）。
 * 约束：只改章节集合（解码文本的偏移区间），来源正文不变；每次编辑 revision +1 并留审计行。
 * 边界只在相邻章节之间移动（末章收尾固定），因此不需要读源文本即可校验。
 * 校验失败在 mutate 闭包内 throw，由 runEdit 统一转为 err('invalid')，不产生任何写。
 */

export interface ChapterEditDeps {
  projectRepository: ProjectRepository;
  libraryRepository: LibraryRepository;
  receiptStore: ReceiptStore;
}

export interface RenameChapterCommand extends Omit<Command, 'expectedRevision'> {
  projectId: string;
  chapterId: string;
  newTitle: string;
  expectedRevision: number;
}

export interface MoveBoundaryCommand extends Omit<Command, 'expectedRevision'> {
  projectId: string;
  chapterId: string;
  /** 该章新的 endOffset；必须落在 (startOffset, 下一章 startOffset) 内 */
  newEndOffset: number;
  expectedRevision: number;
}

export interface SplitChapterCommand extends Omit<Command, 'expectedRevision'> {
  projectId: string;
  chapterId: string;
  /** 切分点：新章从该字符偏移开始，必须落在章内且不贴边 */
  splitAtOffset: number;
  expectedRevision: number;
}

export interface DeleteChapterCommand extends Omit<Command, 'expectedRevision'> {
  projectId: string;
  chapterId: string;
  expectedRevision: number;
}

type EditResult = { chapters: Chapter[]; project: Project };

function runEdit<T extends Command & { projectId: string; chapterId: string }>(
  deps: ChapterEditDeps,
  command: T,
  kind: ChapterEditKind['kind'],
  payload: Record<string, unknown>,
  mutate: (chapters: Chapter[]) => Chapter[],
): Promise<Result<EditResult>> {
  return deps.receiptStore.get<EditResult>(command.commandId).then((receipt) =>
    resolveIdempotent(receipt, async () => {
      const project = await deps.projectRepository.get(command.projectId);
      if (!project) return err('not_found', '工程不存在');
      if (project.revision !== command.expectedRevision) {
        return err('conflict', '工程已被其他操作修改，请刷新后重试');
      }
      try {
        const result = await deps.libraryRepository.mutateChapters(
          command.projectId,
          { kind, chapterId: command.chapterId, payload },
          mutate,
        );
        return ok(result);
      } catch (error) {
        return err('invalid', error instanceof Error ? error.message : String(error));
      }
    }),
  );
}

function renumber(chapters: Chapter[]): Chapter[] {
  return chapters.map((chapter, index) => ({ ...chapter, ordinal: index }));
}

function requireChapter(chapters: Chapter[], chapterId: string): { chapter: Chapter; index: number } {
  const index = chapters.findIndex((c) => c.id === chapterId);
  if (index === -1) throw new Error('章节不存在');
  return { chapter: chapters[index], index };
}

export function createChapterEditService(deps: ChapterEditDeps) {
  return {
    renameChapter(command: RenameChapterCommand): Promise<Result<EditResult>> {
      const newTitle = command.newTitle.trim();
      if (newTitle.length === 0 || newTitle.length > 60) {
        return Promise.resolve(err('invalid', '标题需为 1-60 个字符'));
      }
      return runEdit(deps, command, 'rename', { newTitle }, (chapters) => {
        const { chapter, index } = requireChapter(chapters, command.chapterId);
        const next = [...chapters];
        next[index] = { ...chapter, title: newTitle };
        return renumber(next);
      });
    },

    moveBoundary(command: MoveBoundaryCommand): Promise<Result<EditResult>> {
      return runEdit(deps, command, 'boundary', { newEndOffset: command.newEndOffset }, (chapters) => {
        const { chapter, index } = requireChapter(chapters, command.chapterId);
        const nextChapter = chapters[index + 1];
        if (!nextChapter) throw new Error('末章收尾固定，不能调整边界');
        if (command.newEndOffset <= chapter.startOffset || command.newEndOffset >= nextChapter.startOffset) {
          throw new Error('边界必须落在本章与下一章之间');
        }
        const next = [...chapters];
        next[index] = { ...chapter, endOffset: command.newEndOffset };
        next[index + 1] = { ...nextChapter, startOffset: command.newEndOffset };
        return renumber(next);
      });
    },

    splitChapter(command: SplitChapterCommand): Promise<Result<EditResult>> {
      return runEdit(deps, command, 'split', { splitAtOffset: command.splitAtOffset }, (chapters) => {
        const { chapter, index } = requireChapter(chapters, command.chapterId);
        if (command.splitAtOffset <= chapter.startOffset || command.splitAtOffset >= chapter.endOffset) {
          throw new Error('切分点必须落在章节内部');
        }
        const first: Chapter = { ...chapter, endOffset: command.splitAtOffset };
        const second: Chapter = {
          ...chapter,
          id: `${chapter.id}-b`,
          title: `${chapter.title}（下）`,
          startOffset: command.splitAtOffset,
          headingLine: null,
        };
        const next = [...chapters];
        next.splice(index, 1, first, second);
        return renumber(next);
      });
    },

    deleteChapter(command: DeleteChapterCommand): Promise<Result<EditResult>> {
      return runEdit(deps, command, 'delete', {}, (chapters) => {
        const { chapter, index } = requireChapter(chapters, command.chapterId);
        if (chapters.length === 1) {
          throw new Error('至少保留一个章节；如需整本重分请使用重新分章');
        }
        const next = chapters.filter((c) => c.id !== command.chapterId);
        // 删除章节的正文并入相邻章：优先并入前一章，无前章则并入后一章
        if (index > 0) {
          const prev = next[index - 1];
          next[index - 1] = { ...prev, endOffset: chapter.endOffset };
        } else {
          const following = next[0];
          next[0] = { ...following, startOffset: chapter.startOffset };
        }
        return renumber(next);
      });
    },
  };
}

export type ChapterEditService = ReturnType<typeof createChapterEditService>;
