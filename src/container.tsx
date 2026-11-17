import { createContext, useContext, type ReactNode } from 'react';
import * as Crypto from 'expo-crypto';

import { ExpoAudioPlayerService } from '@/adapters/audio';
import { EdgeTtsGateway } from '@/adapters/edge/tts';
import { documentPickerFilePicker, sandboxAudioFileStore, sandboxSourceFileStore } from '@/adapters/files';
import { createOpenAiCompatibleLlmGateway } from '@/adapters/llm/client';
import { createSqliteAdapters } from '@/adapters/sqlite';
import { secureStoreKeyStore } from '@/adapters/secure-store';
import { createAssistantService } from '@/services/assistant';
import { createChapterEditService } from '@/services/chapter-edits';
import { createCharactersService } from '@/services/characters';
import { createGenerationService } from '@/services/generation';
import { createImportService } from '@/services/import';
import { createLibraryQueryService } from '@/services/library-query';
import { createPlaybackService } from '@/services/playback';
import { createProjectsService } from '@/services/projects';
import { createReadingService } from '@/services/reading';
import { createSettingsService } from '@/services/settings';
import { createSplitReviewService } from '@/services/split-review';
import { createVoicesService } from '@/services/voices';
import { createBindingsService } from '@/services/bindings';

/**
 * 组合根（docs/plan.md 0.1 #13）：唯一的实例化与装配点。
 * 依赖方向：app → hooks → services → domain ← adapters；
 * 本文件依赖所有层但只做装配。组件经 useServices 消费，不直接 import adapters。
 */

const adapters = createSqliteAdapters();

const newCommandId = (): string => Crypto.randomUUID();

const edgeTtsGateway = new EdgeTtsGateway();
const llmGateway = createOpenAiCompatibleLlmGateway({
  keyStore: secureStoreKeyStore,
  settingsRepository: adapters.settingsRepository,
});
const audioPlayer = new ExpoAudioPlayerService();

const libraryQuery = createLibraryQueryService({
  libraryRepository: adapters.libraryRepository,
  splitProposalRepository: adapters.splitProposalRepository,
  sourceFileStore: sandboxSourceFileStore,
});

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
  libraryQuery,  splitReview: createSplitReviewService({
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
    libraryQuery,
  }),
  voices: createVoicesService({ ttsGateway: edgeTtsGateway, voiceRepository: adapters.voiceRepository }),
  characters: createCharactersService({
    characterRepository: adapters.characterRepository,
    libraryRepository: adapters.libraryRepository,
    sourceFileStore: sandboxSourceFileStore,
    llmGateway,
    requestLogRepository: adapters.requestLogRepository,
    receiptStore: adapters.receiptStore,
  }),
  bindings: createBindingsService({
    bindingRepository: adapters.bindingRepository,
    characterRepository: adapters.characterRepository,
    receiptStore: adapters.receiptStore,
  }),
  generation: createGenerationService({
    projectRepository: adapters.projectRepository,
    libraryRepository: adapters.libraryRepository,
    libraryQuery,
    sourceFileStore: sandboxSourceFileStore,
    bindingRepository: adapters.bindingRepository,
    generationStore: adapters.generationStore,
    ttsGateway: edgeTtsGateway,
    audioFileStore: sandboxAudioFileStore,
    requestLogRepository: adapters.requestLogRepository,
    receiptStore: adapters.receiptStore,
  }),
  settings: createSettingsService({
    settingsRepository: adapters.settingsRepository,
    keyStore: secureStoreKeyStore,
    requestLogRepository: adapters.requestLogRepository,
  }),
  playback: createPlaybackService({
    audioPlayer,
    generationStore: adapters.generationStore,
    libraryQuery,
    readingStateRepository: adapters.readingStateRepository,
  }),
  assistant: createAssistantService({
    assistantRepository: adapters.assistantRepository,
    llmGateway,
    libraryRepository: adapters.libraryRepository,
    sourceFileStore: sandboxSourceFileStore,
    splitProposalRepository: adapters.splitProposalRepository,
  }),
  newCommandId,
};

// 应用启动恢复：中断的生成任务标记失败，保留已完成段供重试（docs/plan.md P2 验收）
void services.generation.recoverInterrupted();

export type Services = typeof services;

const ServicesContext = createContext<Services>(services);

export function ServicesProvider({ children }: { children: ReactNode }) {
  return <ServicesContext.Provider value={services}>{children}</ServicesContext.Provider>;
}

export function useServices(): Services {
  return useContext(ServicesContext);
}
