import { useCallback, useEffect, useState } from 'react';

import { useServices } from '@/container';
import type { AnnotationRecord } from '@/domain/annotations';


/** 划线与笔记数据入口（v0.12.0）：列表/添加/删除/笔记编辑（失败经 Result 透出，issue #33） */
export function useAnnotations(projectId: string) {
  const services = useServices();
  const [annotations, setAnnotations] = useState<AnnotationRecord[]>([]);
  const [lastError, setLastError] = useState<string | null>(null);

  const refresh = useCallback(async () => {
    setAnnotations(await services.annotations.listAnnotations(projectId));
  }, [projectId, services]);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  const add = useCallback(
    async (chapterId: string, startOffset: number, endOffset: number, note: string) => {
      const result = await services.annotations.addAnnotation({
        commandId: services.newCommandId(),
        projectId,
        chapterId,
        startOffset,
        endOffset,
        note,
      });
      if (!result.ok) {
        setLastError(result.error.message);
        return result;
      }
      setLastError(null);
      await refresh();
      return result;
    },
    [projectId, refresh, services],
  );

  const remove = useCallback(
    async (annotationId: string) => {
      await services.annotations.removeAnnotation(annotationId);
      await refresh();
    },
    [refresh, services],
  );

  const setNote = useCallback(
    async (annotationId: string, note: string) => {
      await services.annotations.setNote(annotationId, note);
      await refresh();
    },
    [refresh, services],
  );

  return { annotations, lastError, refresh, add, remove, setNote };
}
