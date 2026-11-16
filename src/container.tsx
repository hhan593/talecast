import { createContext, useContext, type ReactNode } from 'react';
import * as Crypto from 'expo-crypto';

import { documentPickerFilePicker, sandboxSourceFileStore } from '@/adapters/files';
import { createSqliteAdapters } from '@/adapters/sqlite';
import { createChapterEditService } from '@/services/chapter-edits';
import { createImportService } from '@/services/import';
import { createLibraryQueryService } from '@/services/library-query';
import { createProjectsService } from '@/services/projects';
import { createReadingService } from '@/services/reading';
import { createSplitReviewService } from '@/services/split-review';

/**
 * 组合根（docs/plan.md 0.1 #13）：唯一的实例化与装配点。
 * 依赖方向：app → hooks → services → domain ← adapters；
 * 本文件依赖所有层但只做装配。组件经 useServices 消费，不直接 import adapters。
 */

const adapters = createSqliteAdapters();

const newCommandId = (): string => Crypto.randomUUID();

const services = {
  projects: createProjectsService({
    projectRepository: adapters.projectRepository,
    receiptStore: adapters.receiptStore,
  }),
  import: createImportService({
    filePicker: documentPickerFilePicker,
    libraryRepository: adapters.libraryRepository,
    sourceFileStore: sandboxSourceFileStore,
    receiptStore: adapters.receiptStore,
  }),
  libraryQuery: createLibraryQueryService({
    libraryRepository: adapters.libraryRepository,
    splitProposalRepository: adapters.splitProposalRepository,
  }),
  splitReview: createSplitReviewService({
    projectRepository: adapters.projectRepository,
    libraryRepository: adapters.libraryRepository,
    splitProposalRepository: adapters.splitProposalRepository,
    sourceFileStore: sandboxSourceFileStore,
    receiptStore: adapters.receiptStore,
  }),
  chapterEdits: createChapterEditService({
    projectRepository: adapters.projectRepository,
    libraryRepository: adapters.libraryRepository,
    receiptStore: adapters.receiptStore,
  }),
  reading: createReadingService({
    readingStateRepository: adapters.readingStateRepository,
    libraryRepository: adapters.libraryRepository,
    sourceFileStore: sandboxSourceFileStore,
  }),
  newCommandId,
};

export type Services = typeof services;

const ServicesContext = createContext<Services>(services);

export function ServicesProvider({ children }: { children: ReactNode }) {
  return <ServicesContext.Provider value={services}>{children}</ServicesContext.Provider>;
}

export function useServices(): Services {
  return useContext(ServicesContext);
}
