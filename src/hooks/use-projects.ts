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

  const createTestProject = useCallback(async () => {
    const result = await services.projects.createTestProject({
      commandId: services.newCommandId(),
      title: `测试工程 ${new Date().toLocaleTimeString('zh-CN')}`,
      description: 'P0 数据底座验收用的测试工程',
    });
    if (!result.ok) setError(result.error.message);
    await refresh();
    return result;
  }, [services, refresh]);

  return { projects, error, refresh, createTestProject };
}
