import * as FileSystem from 'expo-file-system/legacy';

/**
 * 自建崩溃/错误日志（v0.15.0）：JS 层异常（ErrorUtils 全局 + ErrorBoundary 钩子）落盘。
 * 原生层崩溃（OOM 等）无法捕获——范围仅 JS 异常，诚实记录于计划书。
 * 环形上限 20 条；仅本地，无上报。
 */
const LOG_PATH = `${FileSystem.cacheDirectory}talecast-crash-log.json`;
const MAX_ENTRIES = 20;

export interface CrashEntry {
  at: number;
  source: 'global' | 'boundary';
  message: string;
  stack: string | null;
}

async function readAll(): Promise<CrashEntry[]> {
  try {
    const raw = await FileSystem.readAsStringAsync(LOG_PATH);
    const parsed = JSON.parse(raw) as CrashEntry[];
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}

async function writeAll(entries: CrashEntry[]): Promise<void> {
  await FileSystem.writeAsStringAsync(LOG_PATH, JSON.stringify(entries.slice(-MAX_ENTRIES)), {
    encoding: FileSystem.EncodingType.UTF8,
  });
}

/** 全局 JS 异常钩子：保留原 handler（若有）并在其之前落盘 */
export function installCrashLog(): void {
  const globalWithErrorUtils = globalThis as { ErrorUtils?: {
    setGlobalHandler(handler: (error: unknown, isFatal?: boolean) => void): void;
    getGlobalHandler?(): ((error: unknown, isFatal?: boolean) => void) | null;
  } };
  if (!globalWithErrorUtils.ErrorUtils) return;
  const previous = globalWithErrorUtils.ErrorUtils.getGlobalHandler?.() ?? null;
  globalWithErrorUtils.ErrorUtils.setGlobalHandler((error, isFatal) => {
    const message = error instanceof Error ? error.message : String(error);
    const stack = error instanceof Error ? (error.stack ?? null) : null;
    void (async () => {
      try {
        const entries = await readAll();
        entries.push({ at: Date.now(), source: 'global', message: message.slice(0, 500), stack: stack?.slice(0, 2000) ?? null });
        await writeAll(entries);
      } catch {
        // 日志失败不阻塞崩溃处理
      }
      try {
        previous?.(error, isFatal);
      } catch {
        // 原 handler 失败忽略
      }
    })();
  });
}

/** 服务面：设置页查看/清空 + ErrorBoundary 写入 */
export function createCrashLogService() {
  return {
    recent(): Promise<CrashEntry[]> {
      return readAll();
    },
    async record(source: 'boundary', error: unknown): Promise<void> {
      try {
        const entries = await readAll();
        entries.push({
          at: Date.now(),
          source,
          message: (error instanceof Error ? error.message : String(error)).slice(0, 500),
          stack: (error instanceof Error ? error.stack : null)?.slice(0, 2000) ?? null,
        });
        await writeAll(entries);
      } catch {
        // 静默
      }
    },
    async clear(): Promise<void> {
      await writeAll([]);
    },
  };
}

export type CrashLogService = ReturnType<typeof createCrashLogService>;
