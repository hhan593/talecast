import type { Chapter } from '@/domain/types';
import type { LibraryRepository, SourceFileStore, SplitProposalRepository } from '@/domain/ports';

/**
 * 只读查询服务：目录、来源、候选、章节正文切片。查询不走命令/回执。
 */
export function createLibraryQueryService(deps: {
  libraryRepository: LibraryRepository;
  splitProposalRepository: SplitProposalRepository;
  sourceFileStore: SourceFileStore;
}) {
  return {
    listChapters(projectId: string) {
      return deps.libraryRepository.listChapters(projectId);
    },
    getSource(projectId: string) {
      return deps.libraryRepository.getSource(projectId);
    },
    getProposal(id: string) {
      return deps.splitProposalRepository.get(id);
    },
    /**
     * 章节正文切片的唯一实现：listChapters → getSource → readDecodedText → 字符偏移 slice。
     * 分章偏移是核心不变量，生成/播放/阅读共用此入口，避免口径漂移（M-1）。
     */
    async readChapterSlice(
      projectId: string,
      chapterId: string,
    ): Promise<{ chapter: Chapter; chapterText: string } | null> {
      const chapters = await deps.libraryRepository.listChapters(projectId);
      const chapter = chapters.find((c) => c.id === chapterId) ?? null;
      const source = await deps.libraryRepository.getSource(projectId);
      if (!chapter || !source) return null;
      const text = await deps.sourceFileStore.readDecodedText(source.textSha256);
      return { chapter, chapterText: text.slice(chapter.startOffset, chapter.endOffset) };
    },
  };
}

export type LibraryQueryService = ReturnType<typeof createLibraryQueryService>;
