import { useCallback, useEffect, useRef, useState } from 'react';

import { useServices } from '@/container';
import { type Result } from '@/domain/result';
import type { GenerationProgress } from '@/services/generation';

export function useGeneration(projectId: string) {
  const services = useServices();
  const [progress, setProgress] = useState<GenerationProgress | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const timer = useRef<ReturnType<typeof setInterval> | null>(null);

  const stopPolling = useCallback(() => {
    if (timer.current) {
      clearInterval(timer.current);
      timer.current = null;
    }
  }, []);

  useEffect(() => stopPolling, [stopPolling]);

  const poll = useCallback(
    async (jobId: string) => {
      const p = await services.generation.getProgress(jobId);
      if (p) {
        setProgress((prev) =>
          prev &&
          prev.status === p.status &&
          prev.progress === p.progress &&
          prev.totalSegments === p.totalSegments &&
          prev.error === p.error
            ? prev
            : p,
        );
      }
      if (p && (p.status === 'done' || p.status === 'failed')) stopPolling();
    },
    [services, stopPolling],
  );

  const watch = useCallback(
    (jobId: string) => {
      stopPolling();
      void poll(jobId);
      timer.current = setInterval(() => void poll(jobId), 800);
    },
    [poll, stopPolling],
  );

  /** busy/error 脚手架收口：三份 try/finally 样板合一（M-2） */
  const runGuarded = useCallback(
    async <T,>(action: () => Promise<Result<T>>, onOk?: (value: T) => void): Promise<Result<T>> => {
      setBusy(true);
      setError(null);
      try {
        const result = await action();
        if (!result.ok) setError(result.error.message);
        else onOk?.(result.value);
        return result;
      } finally {
        setBusy(false);
      }
    },
    [],
  );

  const start = useCallback(
    (chapterId: string) =>
      runGuarded(async () => {
        const result = await services.generation.startGeneration({
          commandId: services.newCommandId(),
          projectId,
          chapterId,
        });
        if (result.ok) watch(result.value.jobId);
        return result;
      }),
    [projectId, runGuarded, services, watch],
  );

  const retry = useCallback(
    (jobId: string) =>
      runGuarded(async () => {
        const result = await services.generation.retryGeneration({ projectId, jobId });
        if (result.ok) watch(jobId);
        return result;
      }),
    [projectId, runGuarded, services, watch],
  );

  const cancel = useCallback(
    (jobId: string) => runGuarded(() => services.generation.cancelGeneration({ projectId, jobId })),
    [projectId, runGuarded, services],
  );

  const preview = useCallback(
    (chapterId: string) =>
      // 试听统一走全局播放服务（独占音频设备，避免与整章播放叠音）
      runGuarded(async () => {
        const result = await services.generation.previewSegment({ projectId, chapterId });
        if (result.ok) await services.playback.playStandalone(result.value.filePath);
        return result;
      }),
    [projectId, runGuarded, services],
  );

  return { progress, busy, error, start, retry, cancel, preview, stopPreview: () => services.playback.stop() };
}
