import { useCallback, useEffect, useState } from 'react';

import { useServices } from '@/container';
import type { Project } from '@/domain/types';

/** 书架页的数据入口：UI 的唯一服务层访问方式（组件不直连 services/adapters） */
export function useProjects() {
  const services = useServices();
  const [projects, setProjects] = useState<Project[] | null>(null);
  const [error, setError] = useState<string | null>(null);

  const refresh = useCallback(async () => {
    try {
      setProjects(await services.projects.listProjects());
      setError(null);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    }
  }, [services]);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  const createProject = useCallback(
    async (title: string) => {
      const result = await services.projects.createProject({
        commandId: services.newCommandId(),
        title,
      });
      if (!result.ok) setError(result.error.message);
      await refresh();
      return result;
    },
    [refresh, services],
  );

  const deleteProject = useCallback(
    async (projectId: string) => {
      const result = await services.projects.deleteProject({ projectId });
      if (!result.ok) setError(result.error.message);
      await refresh();
      return result;
    },
    [refresh, services],
  );

  return { projects, error, refresh, createProject, deleteProject };
}
