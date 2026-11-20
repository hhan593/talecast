import { useCallback, useEffect, useState } from 'react';

import { useServices } from '@/container';
import type { EncodingChoice, EncodingDetection } from '@/domain/encoding';
import { err, errorMessage, ok, type Result } from '@/domain/result';
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
  /** 选文件后待确认编码的导入；未确认前不写盘 */
  const [pendingImport, setPendingImport] = useState<{
    commandId: string;
    fileName: string;
    bytes: Uint8Array;
    detection: EncodingDetection;
  } | null>(null);
  const [importEncoding, setImportEncoding] = useState<EncodingChoice>('auto');

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

  /** 第一步：选文件 + 识别编码（只内存暂存，不写盘） */
  const pickImportTxt = useCallback(
    () =>
      run(async () => {
        const result = await services.import.pickImportFile();
        if (!result.ok) return result;
        if (!result.value) return ok(null);
        const picked = result.value;
        const lowerName = picked.fileName.toLowerCase();
        const containerFile =
          lowerName.endsWith('.epub') || lowerName.endsWith('.mobi') ||
          lowerName.endsWith('.azw3') || lowerName.endsWith('.prc') ||
          (picked.bytes[0] === 0x50 && picked.bytes[1] === 0x4b); // ZIP container
        if (containerFile) {
          // EPUB/MOBI 的编码由各自解析器处理，不弹 TXT 编码选择
          const imported = await services.import.importSource({
            commandId: services.newCommandId(),
            projectId,
            fileName: picked.fileName,
            bytes: picked.bytes,
          });
          if (imported.ok) await refresh();
          return imported;
        }
        setPendingImport({
          commandId: services.newCommandId(),
          fileName: picked.fileName,
          bytes: picked.bytes,
          detection: picked.detection,
        });
        setImportEncoding('auto');
        return ok(null);
    }),
    [projectId, refresh, run, services],
  );

  /** 第二步：按确认/覆盖的编码真正导入 */
  const confirmImportTxt = useCallback(
    () =>
      run(async () => {
        if (!pendingImport) return err('invalid', '请先选择要导入的文件');
        const result = await services.import.importSource({
          commandId: pendingImport.commandId,
          projectId,
          fileName: pendingImport.fileName,
          bytes: pendingImport.bytes,
          encoding: importEncoding,
        });
        if (result.ok) {
          await refresh();
          setPendingImport(null);
        }
        return result;
      }),
    [importEncoding, pendingImport, projectId, refresh, run, services],
  );

  const cancelImportTxt = useCallback(() => setPendingImport(null), []);

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
    pendingImport,
    importEncoding,
    setImportEncoding,
    confirmImportTxt,
    cancelImportTxt,
    resplit,
    adopt,
    undo,
    rename,
    splitAt,
    moveBoundary,
    remove,
  };
}
