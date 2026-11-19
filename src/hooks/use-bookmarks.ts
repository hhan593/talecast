import { useCallback, useEffect, useState } from 'react';

import { useServices } from '@/container';
import type { BookmarkRecord } from '@/domain/types';

/** 书签数据入口（R3）：列表/添加/删除 */
export function useBookmarks(projectId: string) {
  const services = useServices();
  const [bookmarks, setBookmarks] = useState<BookmarkRecord[]>([]);

  const refresh = useCallback(async () => {
    setBookmarks(await services.bookmarks.listBookmarks(projectId));
  }, [projectId, services]);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  const add = useCallback(
    async (chapterId: string, charOffset: number, excerpt: string) => {
      await services.bookmarks.addBookmark({
        commandId: services.newCommandId(),
        projectId,
        chapterId,
        charOffset,
        excerpt,
      });
      await refresh();
    },
    [projectId, refresh, services],
  );

  const remove = useCallback(
    async (bookmarkId: string) => {
      await services.bookmarks.removeBookmark(bookmarkId);
      await refresh();
    },
    [refresh, services],
  );

  return { bookmarks, refresh, add, remove };
}
