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

  /** 命令包装收口：newCommandId + 可选刷新（M-2） */
  const runCommand = useCallback(
    async <T,>(command: (commandId: string) => Promise<Result<T>>, options?: { refresh?: boolean }) => {
      const result = await run(() => command(services.newCommandId()));
      if (result.ok && options?.refresh !== false) await refresh();
      return result;
    },
    [refresh, run, services],
  );

  /** 选文件直接导入（issue #63：编码自动识别，不向用户展示格式信息/选项；失败时经 error 提示） */
  const pickImportTxt = useCallback(
    () =>
      run(async () => {
        const imported = await services.import.pickAndImport({
          projectId,
          commandId: services.newCommandId(),
        });
        if (imported.ok && imported.value) await refresh();
        return imported;
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
      runCommand(
        (commandId) =>
          services.splitReview.adoptProposal({
            commandId,
            projectId,
            proposalId,
            expectedRevision: revision,
          }),
      ),
    [projectId, revision, runCommand, services],
  );

  const undo = useCallback(
    (proposalId: string) =>
      runCommand(
        (commandId) =>
          services.splitReview.undoAdopt({
            commandId,
            projectId,
            proposalId,
            expectedRevision: revision,
          }),
      ),
    [projectId, revision, runCommand, services],
  );

  const rename = useCallback(
    (chapterId: string, newTitle: string) =>
      runCommand(
        (commandId) =>
          services.chapterEdits.renameChapter({
            commandId,
            projectId,
            chapterId,
            newTitle,
            expectedRevision: revision,
          }),
      ),
    [projectId, revision, runCommand, services],
  );

  const splitAt = useCallback(
    (chapterId: string, splitAtOffset: number) =>
      runCommand(
        (commandId) =>
          services.chapterEdits.splitChapter({
            commandId,
            projectId,
            chapterId,
            splitAtOffset,
            expectedRevision: revision,
          }),
      ),
    [projectId, revision, runCommand, services],
  );

  const moveBoundary = useCallback(
    (chapterId: string, newEndOffset: number) =>
      runCommand(
        (commandId) =>
          services.chapterEdits.moveBoundary({
            commandId,
            projectId,
            chapterId,
            newEndOffset,
            expectedRevision: revision,
          }),
      ),
    [projectId, revision, runCommand, services],
  );

  const remove = useCallback(
    (chapterId: string) =>
      runCommand(
        (commandId) =>
          services.chapterEdits.deleteChapter({
            commandId,
            projectId,
            chapterId,
            expectedRevision: revision,
          }),
      ),
    [projectId, revision, runCommand, services],
  );

  return {
    chapters,
    source,
    busy,
    error,
    setError,
    refresh,
    pickImportTxt,
    resplit,
    adopt,
    undo,
    rename,
    splitAt,
    moveBoundary,
    remove,
  };
}
