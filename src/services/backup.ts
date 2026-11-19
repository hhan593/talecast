import type { BookmarkRepository, ProjectRepository, SettingsRepository } from '@/domain/ports';
import { err, ok, type Result } from '@/domain/result';

/**
 * JSON 数据备份（RE-4⑤）：导出书架+偏好+书签为可读 JSON，文件分享。
 * 来源文件（TXT/EPUB）不包含——用户保留原始文件即可重建。
 */
export interface BackupDeps {
  projectRepository: ProjectRepository;
  bookmarkRepository: BookmarkRepository;
  settingsRepository: SettingsRepository;
}

export interface BackupData {
  version: 1;
  exportedAt: string;
  projects: Array<{ id: string; title: string; revision: number }>;
  bookmarks: Array<{ chapterId: string; charOffset: number; excerpt: string }>;
  settings: Record<string, string>;
}

export function createBackupService(deps: BackupDeps) {
  return {
    async exportBackup(): Promise<Result<BackupData>> {
      try {
        const projects = await deps.projectRepository.list();
        const bookmarks = await deps.bookmarkRepository.list('*');
        const settings = await deps.settingsRepository.all();
        const backup: BackupData = {
          version: 1,
          exportedAt: new Date().toISOString(),
          projects: projects.map((p) => ({ id: p.id, title: p.title, revision: p.revision })),
          bookmarks: bookmarks.map((b) => ({
            chapterId: b.chapterId,
            charOffset: b.charOffset,
            excerpt: b.excerpt,
          })),
          settings: Object.fromEntries(
            Object.entries(settings).filter(([key]) => !key.startsWith('llm-')),
          ),
        };
        return ok(backup);
      } catch (error) {
        return err('storage', `备份导出失败：${error instanceof Error ? error.message : String(error)}`);
      }
    },
  };
}

export type BackupService = ReturnType<typeof createBackupService>;
