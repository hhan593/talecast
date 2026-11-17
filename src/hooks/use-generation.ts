import { useCallback, useEffect, useRef, useState } from 'react';

import { useServices } from '@/container';
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

  const start = useCallback(
    async (chapterId: string) => {
      setBusy(true);
      setError(null);
      try {
        const result = await services.generation.startGeneration({
          commandId: services.newCommandId(),
          projectId,
          chapterId,
        });
        if (!result.ok) {
          setError(result.error.message);
          return result;
        }
        watch(result.value.jobId);
        return result;
      } finally {
        setBusy(false);
      }
    },
    [projectId, services, watch],
  );

  const retry = useCallback(
    async (jobId: string) => {
      setBusy(true);
      setError(null);
      try {
        const result = await services.generation.retryGeneration({ projectId, jobId });
        if (!result.ok) {
          setError(result.error.message);
          return result;
        }
        watch(jobId);
        return result;
      } finally {
        setBusy(false);
      }
    },
    [projectId, services, watch],
  );

  const cancel = useCallback(
    async (jobId: string) => {
      const result = await services.generation.cancelGeneration({ projectId, jobId });
      if (!result.ok) setError(result.error.message);
      return result;
    },
    [projectId, services],
  );

  const preview = useCallback(
    async (chapterId: string) => {
      setBusy(true);
      setError(null);
      try {
        const result = await services.generation.previewSegment({ projectId, chapterId });
        if (!result.ok) {
          setError(result.error.message);
          return result;
        }
        services.previewPlayer.play(result.value.filePath);
        return result;
      } finally {
        setBusy(false);
      }
    },
    [projectId, services],
  );

  return { progress, busy, error, start, retry, cancel, preview, stopPreview: () => services.previewPlayer.stop() };
}
