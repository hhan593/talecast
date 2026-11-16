import { splitParagraphs, type Paragraph } from '@/domain/source';
import type { LibraryRepository, ReadingStateRepository, SourceFileStore } from '@/domain/ports';
import { err, ok, type Result } from '@/domain/result';
import type { Chapter } from '@/domain/types';

/**
 * 阅读位置与正文读取（docs/plan.md 4.1.1 / 5.3 播放流程）。
 * 章节集合被采用/撤销/编辑后，落点的章节可能已不存在：回退到第一章（幂等且可预期）。
 */

export interface ReadingDeps {
  readingStateRepository: ReadingStateRepository;
  libraryRepository: LibraryRepository;
  sourceFileStore: SourceFileStore;
}

export interface ReadingPosition {
  chapterId: string;
  charOffset: number;
}

export interface ChapterTextResult {
  chapter: Chapter;
  /** 章节正文（解码文本切片） */
  chapterText: string;
  paragraphs: Paragraph[];
}

export function createReadingService(deps: ReadingDeps) {
  return {
    async restorePosition(projectId: string, chapters: Chapter[]): Promise<ReadingPosition | null> {
      if (chapters.length === 0) return null;
      const state = await deps.readingStateRepository.get(projectId);
      if (!state) {
        return { chapterId: chapters[0].id, charOffset: 0 };
      }
      const exists = chapters.some((c) => c.id === state.chapterId);
      if (!exists) {
        return { chapterId: chapters[0].id, charOffset: 0 };
      }
      return { chapterId: state.chapterId, charOffset: state.charOffset };
    },

    savePosition(projectId: string, chapterId: string, charOffset: number): Promise<void> {
      return deps.readingStateRepository.set({
        projectId,
        chapterId,
        charOffset,
        updatedAt: Date.now(),
      });
    },

    /** 章节正文读取：解码文本按章节偏移切片 + 分段（正文高亮/播放映射共用） */
    async getChapterText(projectId: string, chapterId: string): Promise<Result<ChapterTextResult>> {
      const chapters = await deps.libraryRepository.listChapters(projectId);
      const chapter = chapters.find((c) => c.id === chapterId) ?? null;
      if (!chapter) return err('not_found', '章节不存在');
      const source = await deps.libraryRepository.getSource(projectId);
      if (!source) return err('invalid', '工程还没有导入来源');
      const text = await deps.sourceFileStore.readDecodedText(source.textSha256);
      const chapterText = text.slice(chapter.startOffset, chapter.endOffset);
      return ok({
        chapter,
        chapterText,
        paragraphs: splitParagraphs(chapterText, chapter.startOffset),
      });
    },
  };
}

export type ReadingService = ReturnType<typeof createReadingService>;
