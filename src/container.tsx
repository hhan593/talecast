import { createContext, useContext, type ReactNode } from 'react';

import { createSqliteAdapters } from '@/adapters/sqlite';
import { createProjectsService } from '@/services/projects';

/**
 * 组合根（docs/plan.md 0.1 #13）：唯一的实例化与装配点。
 * 依赖方向：app → hooks → services → domain ← adapters；
 * 本文件依赖所有层但只做装配。组件经 useServices 消费，不直接 import adapters。
 */

const adapters = createSqliteAdapters();

const services = {
  projects: createProjectsService({
    projectRepository: adapters.projectRepository,
    receiptStore: adapters.receiptStore,
  }),
};

export type Services = typeof services;

const ServicesContext = createContext<Services>(services);

export function ServicesProvider({ children }: { children: ReactNode }) {
  return <ServicesContext.Provider value={services}>{children}</ServicesContext.Provider>;
}

export function useServices(): Services {
  return useContext(ServicesContext);
}
