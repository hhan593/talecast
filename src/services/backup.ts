import type { BookmarkRepository, ProjectRepository, SettingsRepository } from '@/domain/ports';
import { errorMessage, err, ok, type Result } from '@/domain/result';

/**
 * JSON 数据备份（RE-4⑤）：导出书架+偏好+书签为可读 JSON，文件分享。
 * 来源文件（TXT/EPUB）不包含——用户保留原始文件即可重建。
 * 导入恢复（v0.10.0）：仅恢复设置项（替换净化规则、阅读偏好等）；
 * 书籍正文与书签依赖原文件重新导入，不做合并（避免跨库 chapterId 悬挂）。
 */
export interface BackupDeps {
  projectRepository: ProjectRepository;
  bookmarkRepository: BookmarkRepository;
  settingsRepository: SettingsRepository;
  /** 备份文件分享（容器注入平台实现） */
  share?: (data: BackupData) => Promise<void>;
  /** 备份文件选取（容器注入；未注入则导入入口不可用） */
  pickBackupFile?: () => Promise<{ name: string; bytes: Uint8Array } | null>;
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

    /** 导出并调起系统分享（未注入 share 时返回明确错误） */
    async exportAndShare(): Promise<Result<null>> {
      const backup = await this.exportBackup();
      if (!backup.ok) return backup;
      if (!deps.share) return err('invalid', '当前环境不支持分享');
      try {
        await deps.share(backup.value);
        return ok(null);
      } catch (error) {
        return err('storage', `备份分享失败：${errorMessage(error)}`);
      }
    },

    /**
     * 从备份文件恢复设置项：校验版本与形状，逐条写回 settings（跳过 LLM 密钥类）。
     * 书籍与书签不在恢复范围（正文需重新导入原文件）。
     */
    async importBackup(bytes: Uint8Array): Promise<Result<{ restoredSettings: number }>> {
      let parsed: unknown;
      try {
        parsed = JSON.parse(new TextDecoder().decode(bytes));
      } catch {
        return err('invalid', '备份文件不是有效的 JSON');
      }
      if (typeof parsed !== 'object' || parsed === null) return err('invalid', '备份文件格式不正确');
      const data = parsed as { version?: unknown; settings?: unknown };
      if (data.version !== 1) return err('invalid', '备份版本不受支持，请升级应用后再导入');
      if (typeof data.settings !== 'object' || data.settings === null) {
        return err('invalid', '备份缺少设置项');
      }
      const entries = Object.entries(data.settings as Record<string, unknown>).filter(
        ([key, value]) => typeof value === 'string' && !key.startsWith('llm-'),
      );
      for (const [key, value] of entries) {
        await deps.settingsRepository.set(key, value as string);
      }
      return ok({ restoredSettings: entries.length });
    },

    /** 从系统文件选取备份并恢复（未注入 picker 时返回明确错误） */
    async importFromPicker(): Promise<Result<{ restoredSettings: number }>> {
      if (!deps.pickBackupFile) return err('invalid', '当前环境不支持导入');
      const picked = await deps.pickBackupFile();
      if (!picked) return ok({ restoredSettings: 0 });
      return this.importBackup(picked.bytes);
    },
  };
}

export type BackupService = ReturnType<typeof createBackupService>;
