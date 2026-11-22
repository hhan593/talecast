import { resolveIdempotent, type Command } from '@/domain/commands';
import type { ChapterExporter, GenerationStore, ReceiptStore } from '@/domain/ports';
import { errError, err, ok, type Result } from '@/domain/result';

/**
 * 章节音频导出（docs/design/2026-11-18-v0.2.0-spec.md F-3）：
 * 仅 done 段参与拼接；段序即播放序；同 job 的导出文件按 jobId 落 cache（幂等复用）。
 */
export interface ExportDeps {
  generationStore: GenerationStore;
  exporter: ChapterExporter;
  receiptStore: ReceiptStore;
  cacheDirUri: string;
}

export interface ExportChapterCommand extends Command {
  projectId: string;
  chapterId: string;
}

export function createExportService(deps: ExportDeps) {
  async function doneSegmentPaths(projectId: string, chapterId: string): Promise<string[] | null> {
    const jobs = await deps.generationStore.listJobsByChapter(projectId, chapterId);
    const doneJob = jobs.find((job) => job.status === 'done');
    if (!doneJob) return null;
    const segments = (await deps.generationStore.listSegments(doneJob.id)).filter(
      (segment) => segment.status === 'done' && segment.filePath !== null,
    );
    if (segments.length === 0) return null;
    return segments.map((segment) => segment.filePath!);
  }

  return {
    async exportChapter(
      command: ExportChapterCommand,
    ): Promise<Result<{ uri: string; segmentCount: number }>> {
      const receipt = await deps.receiptStore.get<{ uri: string; segmentCount: number }>(command.commandId);
      return resolveIdempotent(receipt, async () => {
        const paths = await doneSegmentPaths(command.projectId, command.chapterId);
        if (paths === null) return errError('noDoneAudio');
        const outputPath = `${deps.cacheDirUri}exports/${command.projectId}-${command.chapterId}.mp3`;
        try {
          await deps.exporter.concatToFile(paths, outputPath);
        } catch (error) {
          return errError('exportFailed', { reason: error instanceof Error ? error.message : String(error) });
        }
        const result = { uri: outputPath, segmentCount: paths.length };
        await deps.receiptStore.put({
          commandId: command.commandId,
          result: ok(result),
          createdAt: Date.now(),
        });
        return ok(result);
      });
    },

    async share(uri: string): Promise<Result<null>> {
      try {
        await deps.exporter.share(uri);
        return ok(null);
      } catch (error) {
        return errError('shareFailed', { reason: error instanceof Error ? error.message : String(error) });
      }
    },
  };
}

export type ExportService = ReturnType<typeof createExportService>;
