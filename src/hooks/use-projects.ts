import { useCallback, useEffect, useState } from 'react';

import { useServices } from '@/container';
import { errorMessage, type Result } from '@/domain/result';
import type { Project } from '@/domain/types';

export function useProjects() {
  const services = useServices();
  const [projects, setProjects] = useState<Project[] | null>(null);
  const [error, setError] = useState<string | null>(null);

  const refresh = useCallback(async () => {
    try {
      setProjects(await services.projects.listProjects());
      setError(null);
    } catch (e) {
      setError(errorMessage(e));
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


  const updateTags = useCallback(
    async (projectId: string, tags: string[]) => {
      await services.projects.updateTags(projectId, tags);
      await refresh();
    },
    [refresh, services],
  );
  return { projects, error, refresh, createProject, deleteProject, updateTags };
}
