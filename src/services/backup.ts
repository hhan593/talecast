import type {
  AnnotationRepository,
  BookmarkRepository,
  LibraryRepository,
  ProjectRepository,
  SettingsRepository,
} from '@/domain/ports';
import { errError, errorMessage, err, ok, type Result } from '@/domain/result';

/**
 * JSON 数据备份（RE-4⑤）：导出书架+偏好+书签+划线笔记为可读 JSON，文件分享。
 * 来源文件（TXT/EPUB）不包含——用户保留原始文件即可重建。
 * 导入恢复（v0.10.0 起设置项；v0.20.3 起书签与标注，issue #79）：
 * 章节重导后 id 确定性可回链（ch-{projectId}-{ordinal}-{startOffset}），按
 * 「项目存在 + 章节 id 存在」尽力回填，幂等去重（同 id/同章节偏移跳过）；
 * 项目不存在或章节已重排的记录跳过并计数，不做合并猜测。
 */
export interface BackupDeps {
  projectRepository: ProjectRepository;
  bookmarkRepository: BookmarkRepository;
  annotationRepository: AnnotationRepository;
  /** 恢复时校验章节 id 是否存在（重导后确定性回链的判据） */
  libraryRepository: LibraryRepository;
  settingsRepository: SettingsRepository;
  /** 备份文件分享（容器注入平台实现；服务产出文件名与内容） */
  share?: (file: { name: string; content: string }) => Promise<void>;
  /** 备份文件选取（容器注入；未注入则导入入口不可用） */
  pickBackupFile?: () => Promise<{ name: string; bytes: Uint8Array } | null>;
}

export interface BackupData {
  version: 1;
  exportedAt: string;
  projects: { id: string; title: string; revision: number }[];
  bookmarks: {
    projectId: string;
    chapterId: string;
    charOffset: number;
    excerpt: string;
    createdAt: number;
  }[];
  /** v0.20.3 增补（issue #79）：划线与笔记；旧版本备份无此字段，导入按缺省跳过 */
  annotations?: {
    id: string;
    projectId: string;
    chapterId: string;
    startOffset: number;
    endOffset: number;
    note: string;
    createdAt: number;
    updatedAt: number;
  }[];
  settings: Record<string, string>;
}

export interface ImportSummary {
  restoredSettings: number;
  restoredBookmarks: number;
  restoredAnnotations: number;
  /** 项目/章节对不上（重排、未重导）而跳过的标注数 */
  skippedAnnotations: number;
}

export function createBackupService(deps: BackupDeps) {
  return {
    async exportBackup(): Promise<Result<BackupData>> {
      try {
        const projects = await deps.projectRepository.list();
        const settings = await deps.settingsRepository.all();
        // 按项目遍历取书签/标注：仓储 list 是精确 project_id 匹配
        // （旧实现传 '*' 通配符，真机上书签导出实际为空——issue #79 顺带修）
        const bookmarks = [];
        const annotations = [];
        for (const project of projects) {
          bookmarks.push(...(await deps.bookmarkRepository.list(project.id)));
          annotations.push(...(await deps.annotationRepository.list(project.id)));
        }
        const backup: BackupData = {
          version: 1,
          exportedAt: new Date().toISOString(),
          projects: projects.map((p) => ({ id: p.id, title: p.title, revision: p.revision })),
          bookmarks: bookmarks.map((b) => ({
            projectId: b.projectId,
            chapterId: b.chapterId,
            charOffset: b.charOffset,
            excerpt: b.excerpt,
            createdAt: b.createdAt,
          })),
          annotations: annotations.map((a) => ({
            id: a.id,
            projectId: a.projectId,
            chapterId: a.chapterId,
            startOffset: a.startOffset,
            endOffset: a.endOffset,
            kind: a.kind,
            note: a.note,
            createdAt: a.createdAt,
            updatedAt: a.updatedAt,
          })),
          settings: Object.fromEntries(
            Object.entries(settings).filter(([key]) => !key.startsWith('llm-')),
          ),
        };
        return ok(backup);
      } catch (error) {
        return errError('exportFailed', { reason: error instanceof Error ? error.message : String(error) });
      }
    },

    /** 导出并调起系统分享（文件名/序列化是服务输出契约，issue #41） */
    async exportAndShare(): Promise<Result<null>> {
      const backup = await this.exportBackup();
      if (!backup.ok) return backup;
      if (!deps.share) return errError('shareUnsupported');
      try {
        const filename = `talecast-backup-${backup.value.exportedAt.slice(0, 10)}.json`;
        await deps.share({ name: filename, content: JSON.stringify(backup.value, null, 2) });
        return ok(null);
      } catch (error) {
        return err('storage', `备份分享失败：${errorMessage(error)}`);
      }
    },

    /**
     * 从备份文件恢复：设置项逐条写回（跳过 LLM 密钥类）；
     * 书签与标注按「项目存在 + 章节 id 存在」回链恢复——章节 id 随项目与
     * 原文确定性生成，重新导入同一文件到同一项目即回链成功；重排/未重导
     * 的跳过计数。同 id 已存在则跳过（重复导入同一备份不产生双份）。
     */
    async importBackup(bytes: Uint8Array): Promise<Result<ImportSummary>> {
      let parsed: unknown;
      try {
        parsed = JSON.parse(new TextDecoder().decode(bytes));
      } catch {
        return errError('invalidJson');
      }
      if (typeof parsed !== 'object' || parsed === null) return errError('invalidFormat');
      const data = parsed as {
        version?: unknown;
        settings?: unknown;
        bookmarks?: unknown;
        annotations?: unknown;
      };
      if (data.version !== 1) return errError('versionUnsupported');
      if (typeof data.settings !== 'object' || data.settings === null) {
        return errError('missingSettings');
      }
      const entries = Object.entries(data.settings as Record<string, unknown>).filter(
        ([key, value]) => typeof value === 'string' && !key.startsWith('llm-'),
      );
      for (const [key, value] of entries) {
        await deps.settingsRepository.set(key, value as string);
      }

      const summary: ImportSummary = {
        restoredSettings: entries.length,
        restoredBookmarks: 0,
        restoredAnnotations: 0,
        skippedAnnotations: 0,
      };

      // 书签恢复：项目与章节都在才回填；add 的 UNIQUE 语义天然去重
      if (Array.isArray(data.bookmarks)) {
        for (const raw of data.bookmarks) {
          const b = raw as Partial<Parameters<typeof deps.bookmarkRepository.add>[0]> & {
            projectId?: string;
            chapterId?: string;
          };
          if (
            typeof b.id !== 'string' ||
            typeof b.projectId !== 'string' ||
            typeof b.chapterId !== 'string' ||
            typeof b.charOffset !== 'number' ||
            typeof b.excerpt !== 'string'
          ) {
            continue;
          }
          const chapters = await deps.libraryRepository.listChapters(b.projectId);
          if (!chapters.some((c) => c.id === b.chapterId)) continue;
          const result = await deps.bookmarkRepository.add({
            id: b.id,
            projectId: b.projectId,
            chapterId: b.chapterId,
            charOffset: b.charOffset,
            excerpt: b.excerpt,
            createdAt: typeof b.createdAt === 'number' ? b.createdAt : Date.now(),
          });
          if (result === 'added') summary.restoredBookmarks += 1;
        }
      }

      // 标注恢复（issue #79）：同 id 幂等；项目/章节对不上则跳过计数
      if (Array.isArray(data.annotations)) {
        for (const raw of data.annotations) {
          const a = raw as Partial<Parameters<typeof deps.annotationRepository.insert>[0]>;
          if (
            typeof a.id !== 'string' ||
            typeof a.projectId !== 'string' ||
            typeof a.chapterId !== 'string' ||
            typeof a.startOffset !== 'number' ||
            typeof a.endOffset !== 'number'
          ) {
            summary.skippedAnnotations += 1;
            continue;
          }
          const project = await deps.projectRepository.get(a.projectId);
          if (!project) {
            summary.skippedAnnotations += 1;
            continue;
          }
          const chapters = await deps.libraryRepository.listChapters(a.projectId);
          if (!chapters.some((c) => c.id === a.chapterId)) {
            summary.skippedAnnotations += 1;
            continue;
          }
          const existing = await deps.annotationRepository.list(a.projectId);
          if (existing.some((e) => e.id === a.id)) {
            continue; // 重复导入同一备份：同 id 幂等跳过
          }
          await deps.annotationRepository.insert({
            id: a.id,
            projectId: a.projectId,
            chapterId: a.chapterId,
            startOffset: a.startOffset,
            endOffset: a.endOffset,
            kind: a.kind === 'underline' ? 'underline' : 'underline',
            note: typeof a.note === 'string' ? a.note : '',
            createdAt: typeof a.createdAt === 'number' ? a.createdAt : Date.now(),
            updatedAt: typeof a.updatedAt === 'number' ? a.updatedAt : Date.now(),
          });
          summary.restoredAnnotations += 1;
        }
      }

      return ok(summary);
    },

    /** 从系统文件选取备份并恢复（未注入 picker 时返回明确错误） */
    async importFromPicker(): Promise<Result<ImportSummary>> {
      if (!deps.pickBackupFile) return errError('importUnsupported');
      const picked = await deps.pickBackupFile();
      if (!picked) {
        return ok({ restoredSettings: 0, restoredBookmarks: 0, restoredAnnotations: 0, skippedAnnotations: 0 });
      }
      return this.importBackup(picked.bytes);
    },
  };
}

export type BackupService = ReturnType<typeof createBackupService>;
