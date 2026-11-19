import { splitParagraphs, type Paragraph } from '@/domain/source';
import { applyReplacements, deserializeRules } from '@/domain/replacement';
import type { LibraryRepository, ReadingStateRepository, SourceFileStore } from '@/domain/ports';
import { err, ok, type Result } from '@/domain/result';
import type { Chapter } from '@/domain/types';

/**
 * 阅读位置与正文读取（docs/plan.md 4.1.1 / 5.3 播放流程）。
 * 章节集合被采用/撤销/编辑后，落点的章节可能已不存在：回退到第一章（幂等且可预期）。
 */

export interface ReadingDeps {
  readingStateRepository: ReadingStateRepository;
  libraryQuery: import('@/services/library-query').LibraryQueryService;
  /** 净化规则读取（settings 表）；可选——未注入则不做净化 */
  settingsRepository?: import('@/domain/ports').SettingsRepository;
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
      if (!state || state.chapterId === null) {
        return { chapterId: chapters[0].id, charOffset: 0 };
      }
      const exists = chapters.some((c) => c.id === state.chapterId);
      if (!exists) {
        return { chapterId: chapters[0].id, charOffset: 0 };
      }
      return { chapterId: state.chapterId, charOffset: state.charOffset ?? 0 };
    },

    savePosition(projectId: string, chapterId: string, charOffset: number): Promise<void> {
      return deps.readingStateRepository.set({
        projectId,
        chapterId,
        charOffset,
        audioSegmentOrdinal: null,
        audioOffsetMs: null,
        readerMode: null,
        fontSize: null,
      });
    },

    /** 阅读偏好持久化（R2）：模式与字号，不动文本/音频位置 */
    saveReaderPrefs(
      projectId: string,
      readerMode: 'scroll' | 'paged',
      fontSize: 'small' | 'standard' | 'large' | 'xlarge',
    ): Promise<void> {
      return deps.readingStateRepository.set({
        projectId,
        chapterId: null,
        charOffset: null,
        audioSegmentOrdinal: null,
        audioOffsetMs: null,
        readerMode,
        fontSize,
      });
    },

    async restoreReaderPrefs(
      projectId: string,
    ): Promise<{ mode: 'scroll' | 'paged'; fontSize: 'small' | 'standard' | 'large' | 'xlarge' }> {
      const state = await deps.readingStateRepository.get(projectId);
      return {
        mode: state?.readerMode === 'paged' ? 'paged' : 'scroll',
        fontSize:
          state?.fontSize === 'small' || state?.fontSize === 'large' || state?.fontSize === 'xlarge'
            ? state.fontSize
            : 'standard',
      };
    },

    /** 章节正文读取：解码文本按章节偏移切片 + 分段（正文高亮/播放映射共用） */
    async getChapterText(projectId: string, chapterId: string): Promise<Result<ChapterTextResult>> {
      const slice = await deps.libraryQuery.readChapterSlice(projectId, chapterId);
      if (!slice) return err('not_found', '章节不存在');
      const { chapter, chapterText: rawText } = slice;
      // 净化（RE-3）：展示层变换，来源不变
      let chapterText = rawText;
      if (deps.settingsRepository) {
        const rulesJson = await deps.settingsRepository.get('replacement-rules');
        if (rulesJson) {
          chapterText = applyReplacements(rawText, deserializeRules(rulesJson));
        }
      }
      return ok({
        chapter,
        chapterText,
        paragraphs: splitParagraphs(chapterText, chapter.startOffset),
      });
    },
  };
}

export type ReadingService = ReturnType<typeof createReadingService>;
