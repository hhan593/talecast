import type { BookmarkRepository } from '@/domain/ports';
import { ok, type Result } from '@/domain/result';
import type { BookmarkRecord } from '@/domain/types';

/**
 * 书签用例（docs/design/2026-11-19-manual-reading-plan.md R3）：
 * 同章节同偏移幂等（UNIQUE 约束语义，重复添加返回 exists）；删除按 id；列表按创建时间倒序。
 */
export interface BookmarksDeps {
  bookmarkRepository: BookmarkRepository;
}

export interface AddBookmarkCommand {
  commandId: string;
  projectId: string;
  chapterId: string;
  charOffset: number;
  excerpt?: string;
}

export type AddBookmarkResult = 'added' | 'exists';

export function createBookmarksService(deps: BookmarksDeps) {
  return {
    async listBookmarks(projectId: string): Promise<BookmarkRecord[]> {
      return deps.bookmarkRepository.list(projectId);
    },

    async addBookmark(command: AddBookmarkCommand): Promise<Result<AddBookmarkResult>> {
      const record: BookmarkRecord = {
        id: `bm-${command.commandId}`,
        projectId: command.projectId,
        chapterId: command.chapterId,
        charOffset: command.charOffset,
        excerpt: command.excerpt ?? '',
        createdAt: Date.now(),
      };
      const outcome = await deps.bookmarkRepository.add(record);
      return outcome === 'added' ? ok(outcome) : ok(outcome);
    },

    async removeBookmark(bookmarkId: string): Promise<Result<null>> {
      await deps.bookmarkRepository.remove(bookmarkId);
      return ok(null);
    },
  };
}

export type BookmarksService = ReturnType<typeof createBookmarksService>;
