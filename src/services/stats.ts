/**
 * 阅读统计（RE-4④）：本地记录（无上传），每日阅读时长与字数。
 * 存 SQLite stats 表（迁移 v6 同期，暂用 settings JSON）。
 */
import type { SettingsRepository } from '@/domain/ports';

export interface StatsDeps {
  settingsRepository: SettingsRepository;
}

export interface ReadingStats {
  /** 今日阅读毫秒数 */
  todayMs: number;
  /** 今日阅读字数 */
  todayChars: number;
  /** 累计阅读毫秒数 */
  totalMs: number;
  /** 今日日期（YYYY-MM-DD） */
  date: string;
}

const STATS_KEY = 'reading-stats';

export function createStatsService(deps: StatsDeps) {
  return {
    async getStats(): Promise<ReadingStats> {
      const json = await deps.settingsRepository.get(STATS_KEY);
      if (!json) {
        return { todayMs: 0, todayChars: 0, totalMs: 0, date: todayStr() };
      }
      try {
        const parsed = JSON.parse(json) as ReadingStats;
        if (parsed.date !== todayStr()) {
          // 新的一天：今日清零，累计保留
          return { todayMs: 0, todayChars: 0, totalMs: parsed.totalMs, date: todayStr() };
        }
        return parsed;
      } catch {
        return { todayMs: 0, todayChars: 0, totalMs: 0, date: todayStr() };
      }
    },

    /** 阅读会话结束时累计（阅读屏卸载或定时器触发） */
    async recordSession(durationMs: number, charsRead: number): Promise<void> {
      const stats = await this.getStats();
      const updated: ReadingStats = {
        todayMs: stats.todayMs + durationMs,
        todayChars: stats.todayChars + charsRead,
        totalMs: stats.totalMs + durationMs,
        date: todayStr(),
      };
      await deps.settingsRepository.set(STATS_KEY, JSON.stringify(updated));
    },
  };
}

function todayStr(): string {
  return new Date().toISOString().slice(0, 10);
}

export type StatsService = ReturnType<typeof createStatsService>;
