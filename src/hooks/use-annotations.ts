import { useCallback, useEffect, useState } from 'react';

import { useServices } from '@/container';
import type { AnnotationRecord } from '@/domain/annotations';

/** 划线与笔记数据入口（v0.12.0）：列表/添加/删除/笔记编辑 */
export function useAnnotations(projectId: string) {
  const services = useServices();
  const [annotations, setAnnotations] = useState<AnnotationRecord[]>([]);

  const refresh = useCallback(async () => {
    setAnnotations(await services.annotations.listAnnotations(projectId));
  }, [projectId, services]);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  const add = useCallback(
    async (chapterId: string, startOffset: number, endOffset: number, note: string) => {
      await services.annotations.addAnnotation({
        commandId: services.newCommandId(),
        projectId,
        chapterId,
        startOffset,
        endOffset,
        note,
      });
      await refresh();
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

  return { annotations, refresh, add, remove, setNote };
}
