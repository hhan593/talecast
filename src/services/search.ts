import { searchBook } from '@/domain/search';
import type { LibraryRepository, SourceFileStore } from '@/domain/ports';
import { errError, err, ok, type Result } from '@/domain/result';

/**
 * 全文搜索服务（docs/design/2026-11-19-manual-reading-plan.md R3）：
 * 全书纯扫描（domain/search 确定性），结果带章节归属与偏移，可跳转。
 */
export interface SearchDeps {
  libraryRepository: LibraryRepository;
  sourceFileStore: SourceFileStore;
}

export interface BookSearchResult {
  chapterId: string;
  chapterTitle: string;
  charOffset: number;
  excerpt: string;
}

export function createSearchService(deps: SearchDeps) {
  return {
    async searchBook(
      projectId: string,
      query: string,
    ): Promise<Result<BookSearchResult[]>> {
      const source = await deps.libraryRepository.getSource(projectId);
      if (!source) return errError('noSource');
      if (query.trim().length === 0) return errError('queryEmpty');
      const text = await deps.sourceFileStore.readDecodedText(source.textSha256);
      const chapters = await deps.libraryRepository.listChapters(projectId);
      const hits = searchBook(
        text,
        query.trim(),
        chapters.map((c) => ({
          chapterId: c.id,
          chapterTitle: c.title,
          startOffset: c.startOffset,
          endOffset: c.endOffset,
        })),
      );
      return ok(
        hits.map((hit) => ({
          chapterId: hit.chapterId,
          chapterTitle: hit.chapterTitle,
          charOffset: hit.charOffset,
          excerpt: hit.excerpt,
        })),
      );
    },
  };
}

export type SearchService = ReturnType<typeof createSearchService>;
