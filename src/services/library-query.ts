import type { LibraryRepository, SplitProposalRepository } from '@/domain/ports';

/**
 * 只读查询服务：目录、来源、候选记录。查询不走命令/回执。
 */
export function createLibraryQueryService(deps: {
  libraryRepository: LibraryRepository;
  splitProposalRepository: SplitProposalRepository;
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
  };
}

export type LibraryQueryService = ReturnType<typeof createLibraryQueryService>;
