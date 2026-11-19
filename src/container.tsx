import { createContext, useContext, type ReactNode } from 'react';
import * as Crypto from 'expo-crypto';
import { Platform } from 'react-native';

import { TrackPlayerAudioService } from '@/adapters/audio-track-player';
import { EdgeTtsGateway } from '@/adapters/edge/tts';
import {
  documentPickerBackupFile,
  documentPickerFilePicker,
  sandboxAudioFileStore,
  sandboxSourceFileStore,
  shareTextFile,
} from '@/adapters/files';
import { EXPORTS_DIR_URI, Mp3ChapterExporter } from '@/adapters/audio-export';
import { createOpenAiCompatibleLlmGateway } from '@/adapters/llm/client';
import { coverFileStore } from '@/adapters/files';
import { ScreenOrientationAdapter } from '@/adapters/screen';
import { createSqliteAdapters } from '@/adapters/sqlite';
import { secureStoreKeyStore } from '@/adapters/secure-store';
import { createAnnotationsService } from '@/services/annotations';
import { createAssistantService } from '@/services/assistant';
import { createDialogueAttributionService } from '@/services/dialogue-attribution';
import { createBookmarksService } from '@/services/bookmarks';
import { createJszipEpubDeps } from '@/adapters/epub';
import { coverMime, findCoverPath, opfPathFromContainer, parseEpub } from '@/domain/epub';
import { createChapterEditService } from '@/services/chapter-edits';
import { createSearchService } from '@/services/search';
import { createCharactersService } from '@/services/characters';
import { createGenerationService } from '@/services/generation';
import { createImportService } from '@/services/import';
import { createLibraryQueryService } from '@/services/library-query';
import { createPlaybackService } from '@/services/playback';
import { createProjectsService } from '@/services/projects';
import { createReadingService } from '@/services/reading';
import { createExportService } from '@/services/export';
import { createSettingsService } from '@/services/settings';
import { createStatsService } from '@/services/stats';
import { createBackupService } from '@/services/backup';
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

class WebNoopAudioPlayer {
  async load() { throw new Error('Web 预览不支持播放，请在 App 中使用'); }
  async play() { throw new Error('Web 预览不支持播放'); }
  async pause() { throw new Error('Web 预览不支持播放'); }
  async seek() { throw new Error('Web 预览不支持播放'); }
  async setRate() { throw new Error('Web 预览不支持播放'); }
  async setVolume(): Promise<void> { /* noop：睡眠渐弱在 Web 退化为直接暂停 */ }
  onProgress(): () => void { return () => undefined; }
  onPlaybackEnd(): () => void { return () => undefined; }
  release(): void { /* noop */ }
}

const edgeTtsGateway = new EdgeTtsGateway();
const llmGateway = createOpenAiCompatibleLlmGateway({
  keyStore: secureStoreKeyStore,
  settingsRepository: adapters.settingsRepository,
});
// 仅原生环境构造 track-player（其 Node 存根会在 server 渲染阶段抛错）
const audioPlayer =
  Platform.OS === 'android' || Platform.OS === 'ios'
    ? new TrackPlayerAudioService({ defaultTitle: 'TaleCast', defaultArtist: '有声书' })
    : new WebNoopAudioPlayer();

const coverStore = coverFileStore;

const libraryQuery = createLibraryQueryService({
  libraryRepository: adapters.libraryRepository,
  splitProposalRepository: adapters.splitProposalRepository,
  sourceFileStore: sandboxSourceFileStore,
});

const dialogueAttributionService = createDialogueAttributionService({
  llmGateway,
  settingsRepository: adapters.settingsRepository,
  characterRepository: adapters.characterRepository,
  bindingRepository: adapters.bindingRepository,
  libraryRepository: adapters.libraryRepository,
  sourceFileStore: sandboxSourceFileStore,
});

const generationService = createGenerationService({
  dialogueAttribution: dialogueAttributionService,
  projectRepository: adapters.projectRepository,
  libraryRepository: adapters.libraryRepository,
  libraryQuery,
  sourceFileStore: sandboxSourceFileStore,
  bindingRepository: adapters.bindingRepository,
  characterRepository: adapters.characterRepository,
  generationStore: adapters.generationStore,
  ttsGateway: edgeTtsGateway,
  audioFileStore: sandboxAudioFileStore,
  requestLogRepository: adapters.requestLogRepository,
  receiptStore: adapters.receiptStore,
  settingsRepository: adapters.settingsRepository,
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
    epubParser: {
      parseEpub: (bytes) => parseEpub(createJszipEpubDeps(bytes), bytes),
      extractCover: async (bytes) => {
        const deps = createJszipEpubDeps(bytes);
        const containerXml = await deps.readFile('META-INF/container.xml');
        const opfPath = opfPathFromContainer(containerXml);
        if (!opfPath) return null;
        const opfDir = opfPath.includes('/') ? opfPath.slice(0, opfPath.lastIndexOf('/')) : '';
        const opfXml = await deps.readFile(opfPath);
        const coverPath = findCoverPath(opfXml, opfDir);
        if (!coverPath || !deps.readFileBytes) return null;
        const coverBytes = await deps.readFileBytes(coverPath);
        if (coverBytes.length === 0) return null;
        return { bytes: coverBytes, mime: coverMime(coverPath) };
      },
    },
    coverStore,
    settingsRepository: adapters.settingsRepository,
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
  generation: generationService,
  export: createExportService({
    generationStore: adapters.generationStore,
    exporter: new Mp3ChapterExporter(),
    receiptStore: adapters.receiptStore,
    cacheDirUri: EXPORTS_DIR_URI,
  }),
  settings: createSettingsService({
    settingsRepository: adapters.settingsRepository,
    keyStore: secureStoreKeyStore,
    requestLogRepository: adapters.requestLogRepository,
  }),
  playback: createPlaybackService({
    audioPlayer,
    audioFileStore: sandboxAudioFileStore,
    generationStore: adapters.generationStore,
    libraryQuery,
    settingsRepository: adapters.settingsRepository,
    readingStateRepository: adapters.readingStateRepository,
    generationService,
  }),
  assistant: createAssistantService({
    assistantRepository: adapters.assistantRepository,
    llmGateway,
    libraryRepository: adapters.libraryRepository,
    sourceFileStore: sandboxSourceFileStore,
    splitProposalRepository: adapters.splitProposalRepository,
  }),
  bookmarks: createBookmarksService({
    bookmarkRepository: adapters.bookmarkRepository,
  }),
  search: createSearchService({
    libraryRepository: adapters.libraryRepository,
    sourceFileStore: sandboxSourceFileStore,
  }),
  stats: createStatsService({ settingsRepository: adapters.settingsRepository }),
  annotations: createAnnotationsService({
    annotationRepository: adapters.annotationRepository,
    libraryRepository: adapters.libraryRepository,
    projectRepository: adapters.projectRepository,
    sourceFileStore: sandboxSourceFileStore,
    receiptStore: adapters.receiptStore,
  }),
  backup: createBackupService({
    projectRepository: adapters.projectRepository,
    bookmarkRepository: adapters.bookmarkRepository,
    settingsRepository: adapters.settingsRepository,
    share: (data) => shareTextFile(`talecast-backup-${data.exportedAt.slice(0, 10)}.json`, JSON.stringify(data, null, 2)),
    pickBackupFile: () => documentPickerBackupFile(),
  }),
  screenOrientation: new ScreenOrientationAdapter(),
  newCommandId,
  /** 通用文本文件分享（笔记导出等）：adapter 能力经组合根透出（唯一出口） */
  shareTextFile,
};

// 应用启动恢复：中断的生成任务标记失败；倍速偏好恢复（F-1）。
// 仅原生环境执行：Expo Router 的 server 渲染 pass 会执行本模块（Node 无原生模块）
if (Platform.OS === 'android' || Platform.OS === 'ios') {
  void services.generation.recoverInterrupted();
  void services.playback.restoreRate();
}

export type Services = typeof services;

const ServicesContext = createContext<Services>(services);

export function ServicesProvider({ children }: { children: ReactNode }) {
  return <ServicesContext.Provider value={services}>{children}</ServicesContext.Provider>;
}

export function useServices(): Services {
  return useContext(ServicesContext);
}
