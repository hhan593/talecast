import { assertJobStartable, buildSegmentPlan, checkChapterGenerationSize, computeJobInputHash } from '@/domain/jobs';
import { EDGE_AUDIO_FORMAT, EDGE_TTS_PROVIDER } from '@/domain/contracts';
import { resolveIdempotent, type Command } from '@/domain/commands';
import { segmentForTts } from '@/domain/segmenter';
import { sha256Text } from '@/domain/hash';
import type {
  AudioFileStore,
  BindingRepository,
  GenerationStore,
  LibraryRepository,
  RequestLogRepository,
  SourceFileStore,
  TtsGateway,
} from '@/domain/ports';
import type { GenerationJobRecord, GenerationSegmentRecord } from '@/domain/types';
import { err, ok, type Result } from '@/domain/result';

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
  projectRepository: import('@/domain/ports').ProjectRepository;
  libraryRepository: LibraryRepository;
  sourceFileStore: SourceFileStore;
  bindingRepository: BindingRepository;
  generationStore: GenerationStore;
  ttsGateway: TtsGateway;
  audioFileStore: AudioFileStore;
  requestLogRepository: RequestLogRepository;
  receiptStore: import('@/domain/ports').ReceiptStore;
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

export function createGenerationService(deps: GenerationDeps) {
  /** 取消标记：内存态（重启即清空，中断恢复走 markInterruptedJobsFailed） */
  const cancelledJobs = new Set<string>();

  async function loadChapterText(projectId: string, chapterId: string) {
    const chapters = await deps.libraryRepository.listChapters(projectId);
    const chapter = chapters.find((c) => c.id === chapterId) ?? null;
    const source = await deps.libraryRepository.getSource(projectId);
    if (!chapter || !source) return null;
    const fullText = await deps.sourceFileStore.readDecodedText(source.textSha256);
    const chapterText = fullText.slice(chapter.startOffset, chapter.endOffset);
    return { chapter, chapterText };
  }

  async function runJobSegments(jobId: string): Promise<void> {
    const job = await deps.generationStore.getJob(jobId);
    if (!job) return;
    const segments = await deps.generationStore.listSegments(jobId);
    await deps.generationStore.updateJob(jobId, { status: 'running' });

    let progress = job.progress;
    for (const segment of segments) {
      if (segment.status === 'done') continue; // 幂等复用：已完成段零请求
      if (cancelledJobs.has(jobId)) {
        await deps.generationStore.updateJob(jobId, {
          status: 'failed',
          error: `已取消：完成 ${progress}/${job.totalSegments} 段，已完成段保留，可重试续跑`,
        });
        return;
      }
      await deps.generationStore.updateSegment(segment.id, { status: 'generating', error: null });
      try {
        const audio = await deps.ttsGateway.synthesize({
          text: segment.text,
          voiceId: job.voiceId,
        });
        if (cancelledJobs.has(jobId)) {
          // 长请求返回后才取消：音频已产出，落盘为缓存不浪费本次请求
          const filePath = await deps.audioFileStore.write(segment.textHash, audio);
          await deps.generationStore.updateSegment(segment.id, { status: 'done', filePath, error: null });
          progress += 1;
          await deps.generationStore.updateJob(jobId, { progress });
          await deps.generationStore.updateJob(jobId, {
            status: 'failed',
            error: `已取消：完成 ${progress}/${job.totalSegments} 段，已完成段保留，可重试续跑`,
          });
          return;
        }
        const filePath = await deps.audioFileStore.write(segment.textHash, audio);
        await deps.generationStore.updateSegment(segment.id, { status: 'done', filePath, error: null });
        await deps.requestLogRepository.log('tts', true, segment.textHash.slice(0, 16));
        progress += 1;
        await deps.generationStore.updateJob(jobId, { progress });
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
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

  return {
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

        const binding = await deps.bindingRepository.getForTarget(command.projectId, 'narrator', null);
        const guardError = assertJobStartable({
          chapterExists: true,
          hasVoiceBinding: binding !== null,
          activeJobExists: (await deps.generationStore.getActiveJobByChapter(command.projectId, command.chapterId)) !== null,
        });
        if (guardError) return err('busy' as const, guardError);

        const voiceId = binding!.voiceId;
        const input = {
          chapterTextSha256: sha256Text(chapterText),
          bindingRevision: binding!.revision,
          voiceId,
          provider: PROVIDER,
          providerParamsJson: PROVIDER_PARAMS_JSON,
          audioFormat: EDGE_AUDIO_FORMAT,
        };
        const inputHash = computeJobInputHash(input);

        // input_hash 幂等：同输入的已完成任务直接复用，不重新请求
        const existing = await deps.generationStore.findByInputHash(command.projectId, inputHash);
        if (existing && existing.status === 'done') {
          return ok({ jobId: existing.id, totalSegments: existing.totalSegments, reusedSegments: existing.totalSegments });
        }

        const plan = buildSegmentPlan(chapterText, { voiceId, provider: PROVIDER, providerParamsJson: PROVIDER_PARAMS_JSON }, segmentForTts);
        const now = Date.now();
        const jobId = command.commandId; // 命令 id 即任务 id：重复提交天然幂等
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
      const binding = await deps.bindingRepository.getForTarget(command.projectId, 'narrator', null);
      if (!binding) return err('invalid', '请先在角色中心给旁白绑定音色，再试听');
      const chapterText = loaded.chapterText;
      if (chapterText.length === 0) return err('invalid', '本章内容为空');
      const plan = buildSegmentPlan(chapterText, { voiceId: binding.voiceId, provider: PROVIDER, providerParamsJson: PROVIDER_PARAMS_JSON }, segmentForTts);
      const first = plan[0];
      const existingPath = deps.audioFileStore.pathFor(first.textHash);
      if (await deps.audioFileStore.exists(first.textHash)) {
        return ok({ filePath: existingPath, textHash: first.textHash, cached: true });
      }
      try {
        const audio = await deps.ttsGateway.synthesize({ text: first.text, voiceId: binding.voiceId });
        const filePath = await deps.audioFileStore.write(first.textHash, audio);
        await deps.requestLogRepository.log('tts', true, first.textHash.slice(0, 16));
        return ok({ filePath, textHash: first.textHash, cached: false });
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
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
}

export type GenerationService = ReturnType<typeof createGenerationService>;
