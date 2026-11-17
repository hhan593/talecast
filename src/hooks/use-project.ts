import { useEffect, useState } from 'react';

import { useServices } from '@/container';
import type { Project } from '@/domain/types';

/** 书籍详情加载：notFound = 未加载到且已完成加载（外壳收口空状态用） */
export function useProject(id: string) {
  const services = useServices();
  const [loading, setLoading] = useState(true);
  const [project, setProject] = useState<Project | null>(null);

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    setProject(null);
    services.projects
      .getProject(id)
      .then((found) => {
        if (!cancelled) setProject(found);
      })
      .catch(() => {
        if (!cancelled) setProject(null);
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [id, services]);

  return { project, loading, notFound: !loading && project === null };
}
