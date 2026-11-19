import { useCallback, useEffect, useState } from 'react';

import { useServices } from '@/container';
import type { PlaybackState } from '@/services/playback';

export function usePlayback(projectId: string) {
  const services = useServices();
  const [state, setState] = useState<PlaybackState>(services.playback.getState());
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    const unsubscribe = services.playback.subscribe((next) => setState(next));
    setState(services.playback.getState());
    return unsubscribe;
  }, [services]);

  const playChapter = useCallback(
    async (chapterId: string, startSegmentIndex = 0) => {
      const result = await services.playback.playChapter(projectId, chapterId, startSegmentIndex);
      if (!result.ok) setError(result.error.message);
      else setError(null);
      return result;
    },
    [projectId, services],
  );

  const pause = useCallback(async () => services.playback.pause(), [services]);
  const resume = useCallback(async () => services.playback.resume(), [services]);
  const seekToSegment = useCallback(
    async (index: number, offsetMs = 0) => {
      const result = await services.playback.seekToSegment(index, offsetMs);
      if (!result.ok) setError(result.error.message);
      return result;
    },
    [services],
  );
  const stop = useCallback(() => services.playback.stop(), [services]);
  const setRate = useCallback(
    async (next: number) => {
      const result = await services.playback.setRate(next);
      if (!result.ok) setError(result.error.message);
      return result;
    },
    [services],
  );
  const setSleepTimer = useCallback(
    async (mode: import('@/services/playback').SleepTimerMode, minutes?: number) => {
      const result = await services.playback.setSleepTimer(mode, minutes);
      if (!result.ok) setError(result.error.message);
      return result;
    },
    [services],
  );
  const cancelSleepTimer = useCallback(() => services.playback.cancelSleepTimer(), [services]);

  return { state, error, playChapter, pause, resume, seekToSegment, stop, setRate, setSleepTimer, cancelSleepTimer };
}
