import { assertJobStartable, buildSegmentPlan, buildVoiceSegmentPlan, checkChapterGenerationSize, computeJobInputHash, computeSegmentTextHash, parseProsodyJson } from '@/domain/jobs';
import { NARRATOR_VOICE_KEY, applyAttributionOverrides, buildDialogueCandidates, buildVoicePlanFingerprint, planVoiceSpans } from '@/domain/dialogue';
import { EDGE_AUDIO_FORMAT, EDGE_TTS_PROVIDER } from '@/domain/contracts';
import { DEFAULT_NARRATOR_VOICE_ID } from '@/domain/edge-voices';
import { resolveIdempotent, type Command } from '@/domain/commands';
import { segmentForTts } from '@/domain/segmenter';
import { sha256Text } from '@/domain/hash';
import type {
  AudioFileStore,
  BindingRepository,
  CharacterRepository,
  GenerationStore,
  LibraryRepository,
  ProjectRepository,
  ReceiptStore,
  RequestLogRepository,
  SettingsRepository,
  SourceFileStore,
  TtsGateway,
} from '@/domain/ports';
import type { BindingRecord, CharacterRecord, GenerationJobRecord, GenerationSegmentRecord } from '@/domain/types';
import { errorMessage, err, ok, type Result } from '@/domain/result';

/**
 * 生成任务（docs/plan.md 4.1.5 / 5.3 生成流程）：
 * - input_hash 幂等：同输入的已完成任务直接复用；
 * - 段级幂等：done 段 + 音频文件存在 → 零请求复用（试听转正与失败重试共用此路径）；
 * - 失败只补缺失段：重试的 provider 请求数 = 缺失段数；
 * - 统一音频格式由 Edge 协议层锁定。
 */

const PROVIDER = EDGE_TTS_PROVIDER;
const PROVIDER_PARAMS_JSON = '{}';

export interface GenerationDeps {
  /** 可选：LLM 段落级说话人归属（v0.13.0，测试可省略） */
  dialogueAttribution?: import('@/services/dialogue-attribution').DialogueAttributionService;
  projectRepository: ProjectRepository;
  libraryRepository: LibraryRepository;
  libraryQuery: import('@/services/library-query').LibraryQueryService;
  sourceFileStore: SourceFileStore;
  bindingRepository: BindingRepository;
  characterRepository: CharacterRepository;
  generationStore: GenerationStore;
  ttsGateway: TtsGateway;
  audioFileStore: AudioFileStore;
  requestLogRepository: RequestLogRepository;
  receiptStore: ReceiptStore;
  /** 可选：对话分声开关读取（缺省视为开启） */
  settingsRepository?: SettingsRepository;
}

interface PlannedSegment {
  ordinal: number;
  text: string;
  textHash: string;
  voiceId: string;
  providerParamsJson: string;
}

export interface StartGenerationCommand extends Command {
  projectId: string;
  chapterId: string;
}

export interface GenerationProgress {
  jobId: string;
  status: GenerationJobRecord['status'];
  progress: number;
  totalSegments: number;
  error: string | null;
  segments: Array<GenerationSegmentRecord>;
}

/** 合成参数归一（issue #41）：空参数对象转 undefined，两处合成调用共用 */
function prosodyOrNull(json: string): import('@/domain/jobs').TtsProsody | undefined {
  const prosody = parseProsodyJson(json);
  return Object.keys(prosody).length > 0 ? prosody : undefined;
}

export function createGenerationService(deps: GenerationDeps) {
  /** 取消标记：内存态（重启即清空，中断恢复走 markInterruptedJobsFailed） */
  const cancelledJobs = new Set<string>();

  async function loadChapterText(projectId: string, chapterId: string) {
    const slice = await deps.libraryQuery.readChapterSlice(projectId, chapterId);
    return slice;
  }

  /** 试听首段有意义文本的最小长度（太短的段多是章名行，试听体验差；转正语义不受影响） */
  const PREVIEW_MIN_CHARS = 40;

  /**
   * 章节计划（v0.9.0）：对话分声开启时按引号归属拆 voice span 再分段；
   * startGeneration 与 previewSegment 共用，保证试听与生成的段哈希一致（转正零冲突）。
   */
  async function planChapterSegments(
    projectId: string,
    chapterId: string,
    chapterText: string,
    binding: BindingRecord,
  ): Promise<{ plan: PlannedSegment[]; voicePlanJson?: string }> {
    const voiceId = binding.voiceId;
    const providerParamsJson = binding.providerParamsJson || '{}';
    const dialogueEnabled =
      (await deps.settingsRepository?.get(`dialogue-voices:${projectId}`)) !== 'off';
    if (!dialogueEnabled) {
      return {
        plan: buildSegmentPlan(
          chapterText,
          { voiceId, provider: PROVIDER, providerParamsJson },
          segmentForTts,
        ).map((segment) => ({ ...segment, voiceId, providerParamsJson })),
      };
    }
    const characters = await deps.characterRepository.list(projectId);
    const bindings = await deps.bindingRepository.list(projectId);
    const candidates = buildDialogueCandidates(characters, bindings);
    let spans = planVoiceSpans(chapterText, candidates);
    // LLM 段落级归属（v0.13.0 可选）：启发式之上的补充覆盖；失败/未配置静默回退
    const llmAttributionOn = (await deps.settingsRepository?.get('llm-attribute-dialogue')) === 'on';
    if (llmAttributionOn && deps.dialogueAttribution) {
      try {
        const overrides = await deps.dialogueAttribution.attributeChapter(projectId, chapterId, chapterText);
        if (overrides.ok && overrides.value.length > 0) {
          spans = applyAttributionOverrides(spans, chapterText, overrides.value);
        }
      } catch {
        // 归属失败不影响生成（回退启发式）
      }
    }
    const voiceByKey = new Map([
      [NARRATOR_VOICE_KEY, { voiceId, providerParamsJson, revision: binding.revision }],
    ]);
    for (const record of bindings) {
      if (record.targetType !== 'character' || record.targetId === null) continue;
      const character = characters.find((c) => c.id === record.targetId);
      if (!character) continue;
      voiceByKey.set(record.targetId, {
        voiceId: record.voiceId,
        providerParamsJson: record.providerParamsJson || '{}',
        revision: record.revision,
      });
    }
    const voicePlan = buildVoiceSegmentPlan(spans, segmentForTts);
    const plan = voicePlan.map((segment) => {
      const voice = voiceByKey.get(segment.voiceKey) ?? voiceByKey.get(NARRATOR_VOICE_KEY)!;
      return {
        ordinal: segment.ordinal,
        text: segment.text,
        textHash: computeSegmentTextHash({
          segmentText: segment.text,
          voiceId: voice.voiceId,
          provider: PROVIDER,
          providerParamsJson: voice.providerParamsJson,
        }),
        voiceId: voice.voiceId,
        providerParamsJson: voice.providerParamsJson,
      };
    });
    // 指纹只含实际用到的音色：任一相关绑定 revision 变化 → input_hash 变化
    const usedKeys = new Set(voicePlan.map((segment) => segment.voiceKey));
    const voicePlanJson = buildVoicePlanFingerprint(
      [...voiceByKey.entries()]
        .filter(([key]) => usedKeys.has(key))
        .map(([key, voice]) => ({
          key,
          voiceId: voice.voiceId,
          providerParamsJson: voice.providerParamsJson,
          revision: voice.revision,
        })),
    );
    return { plan, voicePlanJson };
  }

  async function runJobSegments(jobId: string): Promise<void> {
    const job = await deps.generationStore.getJob(jobId);
    if (!job) return;
    const segments = await deps.generationStore.listSegments(jobId);
    await deps.generationStore.updateJob(jobId, { status: 'running' });

    let progress = job.progress;
    const cancelMessage = () =>
      `已取消：完成 ${progress}/${job.totalSegments} 段，已完成段保留，可重试续跑`;
    for (const segment of segments) {
      if (segment.status === 'done') continue;
      if (cancelledJobs.has(jobId)) {
        await deps.generationStore.updateJob(jobId, { status: 'failed', error: cancelMessage() });
        return;
      }
      await deps.generationStore.updateSegment(segment.id, { status: 'generating', error: null });
      try {
        // 段级音色（v0.9.0 对话分声）：null = 旧单声任务回落 job.voiceId
        const voiceId = segment.voiceId ?? job.voiceId;
        // 段级合成参数（v0.13.0）：角色绑定的语速/音调/音量真正落地
        const synthesizeInput = {
          text: segment.text,
          voiceId,
          prosody: prosodyOrNull(segment.providerParamsJson ?? '{}'),
        };
        let audio: Uint8Array;
        let words: import('@/domain/ports').WordTimelineItem[] = [];
        if (deps.ttsGateway.synthesizeWithTimeline) {
          const result = await deps.ttsGateway.synthesizeWithTimeline(synthesizeInput);
          audio = result.audio;
          words = result.words;
        } else {
          audio = await deps.ttsGateway.synthesize(synthesizeInput);
        }
        const cancelledNow = cancelledJobs.has(jobId);
        // 取消时已产出的音频仍落盘为缓存，不浪费本次请求
        const filePath = await deps.audioFileStore.write(segment.textHash, audio);
        // 词级时间线落盘（v0.13.0 卡拉OK）：伴生 JSON，播放端按进度对齐
        if (words.length > 0 && deps.audioFileStore.writeText) {
          try {
            await deps.audioFileStore.writeText(
              filePath,
              JSON.stringify({ segmentText: segment.text, words }),
            );
          } catch {
            // 时间线失败不影响音频
          }
        }
        await deps.generationStore.updateSegment(segment.id, { status: 'done', filePath, error: null });
        if (!cancelledNow) {
          await deps.requestLogRepository.log('tts', true, segment.textHash.slice(0, 16));
        }
        progress += 1;
        await deps.generationStore.updateJob(jobId, { progress });
        if (cancelledNow) {
          await deps.generationStore.updateJob(jobId, { status: 'failed', error: cancelMessage() });
          return;
        }
      } catch (error) {
        const message = errorMessage(error);
        await deps.requestLogRepository.log('tts', false, message.slice(0, 200));
        await deps.generationStore.updateSegment(segment.id, { status: 'failed', error: message });
        await deps.generationStore.updateJob(jobId, {
          status: 'failed',
          error: `第 ${segment.ordinal + 1} 段合成失败：${message}（已完成 ${progress}/${job.totalSegments} 段已保留，重试只补缺失段）`,
        });
        return;
      }
    }
    await deps.generationStore.updateJob(jobId, { status: 'done', error: null });
  }

  /**
   * 首次使用的兜底：没有旁白绑定时自动绑定默认中文音色。
   * 目的：只听旁白不需要先做 LLM 角色抽取或手工配置；默认值可在角色中心随时更换。
   */
  async function resolveNarratorBinding(projectId: string): Promise<BindingRecord> {
    const existing = await deps.bindingRepository.getForTarget(projectId, 'narrator', null);
    if (existing) return existing;
    return deps.bindingRepository.upsert({
      projectId,
      targetType: 'narrator',
      targetId: null,
      voiceId: DEFAULT_NARRATOR_VOICE_ID,
      providerParamsJson: '{}',
    });
  }

  const api = {
    /**
     * 发起整章生成：前置检查 → input_hash 幂等 → 建任务与段 → 后台跑段循环。
     * 返回即任务已建；进度经 getProgress 轮询。
     */
    async startGeneration(command: StartGenerationCommand): Promise<Result<{ jobId: string; totalSegments: number; reusedSegments: number }>> {
      const receipt = await deps.receiptStore.get<{ jobId: string; totalSegments: number; reusedSegments: number }>(command.commandId);
      return resolveIdempotent(receipt, async () => {
        const loaded = await loadChapterText(command.projectId, command.chapterId);
        if (!loaded) return err('not_found', '章节或来源不存在');
        const { chapter, chapterText } = loaded;

        if (!checkChapterGenerationSize(chapterText.length)) {
          return err('invalid', `本章 ${chapterText.length} 字超出首版单章 3 万字上限，请拆章后生成`);
        }

        const binding = await resolveNarratorBinding(command.projectId);
        const guardError = assertJobStartable({
          chapterExists: true,
          hasVoiceBinding: true,
          activeJobExists: (await deps.generationStore.getActiveJobByChapter(command.projectId, command.chapterId)) !== null,
        });
        if (guardError) return err('busy' as const, guardError);

        const voiceId = binding.voiceId;
        const providerParamsJson = binding.providerParamsJson || '{}';
        const { plan, voicePlanJson } = await planChapterSegments(command.projectId, command.chapterId, chapterText, binding);

        const input = {
          chapterTextSha256: sha256Text(chapterText),
          bindingRevision: binding.revision,
          voiceId,
          provider: PROVIDER,
          providerParamsJson,
          audioFormat: EDGE_AUDIO_FORMAT,
        };
        const inputHash = computeJobInputHash({ ...input, voicePlanJson });

        // input_hash 幂等：同输入的已完成任务直接复用，不重新请求
        const existing = await deps.generationStore.findByInputHash(command.projectId, inputHash);
        if (existing && existing.status === 'done') {
          return ok({ jobId: existing.id, totalSegments: existing.totalSegments, reusedSegments: existing.totalSegments });
        }

        // 并发窗口缩窄（issue #40）：createJob 前再查一次 input_hash——
        // 双击/手动与预生成并发时，先到者已建任务则复用
        const raced = await deps.generationStore.findByInputHash(command.projectId, inputHash);
        if (raced && (raced.status === 'pending' || raced.status === 'running' || raced.status === 'done')) {
          return ok({ jobId: raced.id, totalSegments: raced.totalSegments, reusedSegments: raced.progress });
        }
        const now = Date.now();
        const jobId = command.commandId; // 命令 id 即任务 id：重复提交天然幂等 // 命令 id 即任务 id：重复提交天然幂等
        const existences = await Promise.all(plan.map((s) => deps.audioFileStore.exists(s.textHash)));
        let reusedSegments = 0;
        const segments: Array<GenerationSegmentRecord> = plan.map((segment, i) => {
          const audioExists = existences[i];
          if (audioExists) reusedSegments += 1;
          return {
            id: `seg-${jobId}-${segment.ordinal}`,
            jobId,
            ordinal: segment.ordinal,
            text: segment.text,
            textHash: segment.textHash,
            status: audioExists ? 'done' : 'pending',
            filePath: audioExists ? deps.audioFileStore.pathFor(segment.textHash) : null,
            error: null,
            updatedAt: now,
            voiceId: segment.voiceId,
            providerParamsJson: segment.providerParamsJson,
          };
        });
        const job: GenerationJobRecord = {
          id: jobId,
          projectId: command.projectId,
          chapterId: command.chapterId,
          status: 'pending',
          provider: PROVIDER,
          inputHash,
          voiceId,
          bindingRevision: binding!.revision,
          totalSegments: plan.length,
          progress: reusedSegments,
          error: null,
          createdAt: now,
          updatedAt: now,
        };
        await deps.generationStore.createJob(job, segments);
        void runJobSegments(jobId);
        return ok({ jobId, totalSegments: plan.length, reusedSegments });
      });
    },

    /**
     * 预生成下一章（v0.8.0）：播放某章成功后为其下一章自动发起生成，连播零等待。
     * 由播放侧触发（始终只领先播放进度一章，不自我链式）；开关 settings
     * `auto-pregen-next` = 'false' 关闭（默认开）；后台增强，失败静默。
     */
    async pregenNextChapter(projectId: string, currentChapterId: string): Promise<void> {
      try {
        const enabled = await deps.settingsRepository?.get('auto-pregen-next');
        // 'false' 为历史遗留值；'off' 来自设置页开关（issue #99）
        if (enabled === 'false' || enabled === 'off') return;
        const chapters = await deps.libraryRepository.listChapters(projectId);
        const index = chapters.findIndex((c) => c.id === currentChapterId);
        const next = chapters[index + 1];
        if (!next) return;
        const jobs = await deps.generationStore.listJobsByChapter(projectId, next.id);
        if (jobs.some((j) => j.status === 'done' || j.status === 'running' || j.status === 'pending')) return;
        await api.startGeneration({
          commandId: `pregen-${next.id}-${Date.now()}`,
          projectId,
          chapterId: next.id,
        });
      } catch {
        // 预生成失败静默：连播侧已有"下一章未生成即停"兜底
      }
    },

    /** 重试：只请求缺失/失败段（done 段直接跳过）——provider 请求数 = 缺失段数 */
    async retryGeneration(command: { projectId: string; jobId: string }): Promise<Result<{ jobId: string }>> {
      const job = await deps.generationStore.getJob(command.jobId);
      if (!job || job.projectId !== command.projectId) return err('not_found', '任务不存在');
      if (job.status === 'running' || job.status === 'pending') {
        return err('busy', '任务仍在进行中，稍候刷新进度');
      }
      cancelledJobs.delete(job.id);
      await deps.generationStore.updateJob(job.id, { status: 'pending', error: null });
      void runJobSegments(job.id);
      return ok({ jobId: job.id });
    },

    /** 取消进行中的任务：已完成段保留为缓存（未落盘的合成结果也不浪费），重试续跑 */
    async cancelGeneration(command: { projectId: string; jobId: string }): Promise<Result<null>> {
      const job = await deps.generationStore.getJob(command.jobId);
      if (!job || job.projectId !== command.projectId) return err('not_found', '任务不存在');
      if (job.status !== 'running' && job.status !== 'pending') {
        return err('busy', '任务已结束，无需取消');
      }
      cancelledJobs.add(job.id);
      return ok(null);
    },

    /** 单段试听：不建任务；音频按 text_hash 落盘，生成时自动转正 */
    async previewSegment(command: { projectId: string; chapterId: string }): Promise<Result<{ filePath: string; textHash: string; cached: boolean }>> {
      const loaded = await loadChapterText(command.projectId, command.chapterId);
      if (!loaded) return err('not_found', '章节或来源不存在');
      const binding = await resolveNarratorBinding(command.projectId);
      const chapterText = loaded.chapterText;
      if (chapterText.length === 0) return err('invalid', '本章内容为空');
      // 试听与生成共用同一计划（v0.9.0）：段哈希一致 → 试听文件生成时零请求转正
      const { plan } = await planChapterSegments(command.projectId, command.chapterId, chapterText, binding);
      if (plan.length === 0) return err('invalid', '本章内容为空');
      const first = plan.find((segment) => segment.text.length >= PREVIEW_MIN_CHARS) ?? plan[0];
      const existingPath = deps.audioFileStore.pathFor(first.textHash);
      if (await deps.audioFileStore.exists(first.textHash)) {
        return ok({ filePath: existingPath, textHash: first.textHash, cached: true });
      }
      try {
        const audio = await deps.ttsGateway.synthesize({
          text: first.text,
          voiceId: first.voiceId,
          prosody: prosodyOrNull(first.providerParamsJson ?? '{}'),
        });
        const filePath = await deps.audioFileStore.write(first.textHash, audio);
        await deps.requestLogRepository.log('tts', true, first.textHash.slice(0, 16));
        return ok({ filePath, textHash: first.textHash, cached: false });
      } catch (error) {
        const message = errorMessage(error);
        await deps.requestLogRepository.log('tts', false, message.slice(0, 200));
        return err('network', `试听合成失败：${message}`);
      }
    },

    async getProgress(jobId: string): Promise<GenerationProgress | null> {
      const job = await deps.generationStore.getJob(jobId);
      if (!job) return null;
      const segments = await deps.generationStore.listSegments(jobId);
      return {
        jobId: job.id,
        status: job.status,
        progress: job.progress,
        totalSegments: job.totalSegments,
        error: job.error,
        segments,
      };
    },

    async listJobsByChapter(projectId: string, chapterId: string): Promise<GenerationJobRecord[]> {
      return deps.generationStore.listJobsByChapter(projectId, chapterId);
    },

    /** 应用启动恢复：中断任务标记失败，保留已完成段供重试 */
    async recoverInterrupted(): Promise<number> {
      return deps.generationStore.markInterruptedJobsFailed();
    },
  };
  return api;
}

export type GenerationService = ReturnType<typeof createGenerationService>;
