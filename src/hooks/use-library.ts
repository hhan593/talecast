import { useCallback, useEffect, useState } from 'react';

import { useServices } from '@/container';
import { errorMessage, type Result } from '@/domain/result';
import type { Chapter, SourceInfo } from '@/domain/types';

/**
 * 工作台数据入口（docs/plan.md 4.1）：目录、来源、导入、重新分章、章节编辑。
 * 全部写操作经 services（命令 + 幂等回执 + revision 守卫），UI 只消费 Result。
 */
export function useLibrary(projectId: string, revision: number) {
  const services = useServices();
  const [chapters, setChapters] = useState<Chapter[] | null>(null);
  const [source, setSource] = useState<SourceInfo | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const refresh = useCallback(async () => {
    try {
      const [chapterRows, sourceInfo] = await Promise.all([
        services.libraryQuery.listChapters(projectId),
        services.libraryQuery.getSource(projectId),
      ]);
      setChapters(chapterRows);
      setSource(sourceInfo);
      setError(null);
    } catch (e) {
      setError(errorMessage(e));
    }
  }, [projectId, services]);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  const run = useCallback(async <T,>(action: () => Promise<Result<T>>): Promise<Result<T>> => {
    setBusy(true);
    try {
      const result = await action();
      if (!result.ok) setError(result.error.message);
      else setError(null);
      return result;
    } finally {
      setBusy(false);
    }
  }, []);

  const importTxt = useCallback(
    () =>
      run(async () => {
        const result = await services.import.pickAndImport({
          projectId,
          commandId: services.newCommandId(),
        });
        if (result.ok && result.value !== null) await refresh();
        return result;
      }),
    [projectId, refresh, run, services],
  );

  const resplit = useCallback(
    () =>
      run(async () => {
        const result = await services.splitReview.proposeResplit({
          commandId: services.newCommandId(),
          projectId,
        });
        return result;
      }),
    [projectId, run, services],
  );

  const adopt = useCallback(
    (proposalId: string) =>
      run(async () => {
        const result = await services.splitReview.adoptProposal({
          commandId: services.newCommandId(),
          projectId,
          proposalId,
          expectedRevision: revision,
        });
        if (result.ok) await refresh();
        return result;
      }),
    [projectId, refresh, revision, run, services],
  );

  const undo = useCallback(
    (proposalId: string) =>
      run(async () => {
        const result = await services.splitReview.undoAdopt({
          commandId: services.newCommandId(),
          projectId,
          proposalId,
          expectedRevision: revision,
        });
        if (result.ok) await refresh();
        return result;
      }),
    [projectId, refresh, revision, run, services],
  );

  const rename = useCallback(
    (chapterId: string, newTitle: string) =>
      run(async () => {
        const result = await services.chapterEdits.renameChapter({
          commandId: services.newCommandId(),
          projectId,
          chapterId,
          newTitle,
          expectedRevision: revision,
        });
        if (result.ok) await refresh();
        return result;
      }),
    [projectId, refresh, revision, run, services],
  );

  const splitAt = useCallback(
    (chapterId: string, splitAtOffset: number) =>
      run(async () => {
        const result = await services.chapterEdits.splitChapter({
          commandId: services.newCommandId(),
          projectId,
          chapterId,
          splitAtOffset,
          expectedRevision: revision,
        });
        if (result.ok) await refresh();
        return result;
      }),
    [projectId, refresh, revision, run, services],
  );

  const moveBoundary = useCallback(
    (chapterId: string, newEndOffset: number) =>
      run(async () => {
        const result = await services.chapterEdits.moveBoundary({
          commandId: services.newCommandId(),
          projectId,
          chapterId,
          newEndOffset,
          expectedRevision: revision,
        });
        if (result.ok) await refresh();
        return result;
      }),
    [projectId, refresh, revision, run, services],
  );

  const remove = useCallback(
    (chapterId: string) =>
      run(async () => {
        const result = await services.chapterEdits.deleteChapter({
          commandId: services.newCommandId(),
          projectId,
          chapterId,
          expectedRevision: revision,
        });
        if (result.ok) await refresh();
        return result;
      }),
    [projectId, refresh, revision, run, services],
  );

  return {
    chapters,
    source,
    busy,
    error,
    setError,
    refresh,
    importTxt,
    resplit,
    adopt,
    undo,
    rename,
    splitAt,
    moveBoundary,
    remove,
  };
}
