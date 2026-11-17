import { buildInitialChapterDrafts, type ChapterDraft } from '@/domain/split';
import { checkImportSize, decodeUtf8, isValidUtf8 } from '@/domain/source';
import { sha256Bytes, sha256Text } from '@/domain/hash';
import { resolveIdempotent, type Command } from '@/domain/commands';
import type { FilePicker, LibraryRepository, ReceiptStore, SourceFileStore } from '@/domain/ports';
import { err, ok, type Result } from '@/domain/result';
import type { SourceInfo } from '@/domain/types';

/**
 * 导入用例（docs/plan.md 5.3 导入流程）：
 * 系统选择器取文件 → 校验 UTF-8 → 双哈希 → 写不可变文件 → 同一事务写 sources + 初始 chapters → 回执。
 * P1 约束：一个工程一份来源；重复导入给出明确错误。
 */

export interface ImportDeps {
  filePicker: FilePicker;
  libraryRepository: LibraryRepository;
  sourceFileStore: SourceFileStore;
  receiptStore: ReceiptStore;
}

export interface ImportSourceCommand extends Command {
  projectId: string;
  fileName: string;
  bytes: Uint8Array;
}

export interface ImportSourceResult {
  source: SourceInfo;
  chapters: ChapterDraft[];
}

function runImport(deps: ImportDeps, command: ImportSourceCommand): Promise<Result<ImportSourceResult>> {
  const { bytes, projectId } = command;

  if (bytes.length === 0) return Promise.resolve(err('invalid', '文件内容为空'));
  if (!checkImportSize(bytes.length)) {
    return Promise.resolve(
      err('invalid', `文件超出首版 16MB 上限（当前 ${(bytes.length / 1024 / 1024).toFixed(1)}MB），请拆分后导入`),
    );
  }
  if (!isValidUtf8(bytes)) {
    return Promise.resolve(
      err('invalid', '该文件不是 UTF-8 编码。首版只接受 UTF-8，请先在电脑上转码后重新导入'),
    );
  }

  return deps.libraryRepository.getSource(projectId).then((existing) => {
    if (existing) {
      return err('invalid', `本书已导入《${existing.filename}》。一本书只支持一份文本来源`);
    }

    const text = decodeUtf8(bytes);
    const rawSha256 = sha256Bytes(bytes);
    const textSha256 = sha256Text(text);
    const drafts = buildInitialChapterDrafts(text);

    // 先落不可变文件，再发布数据库记录（确认前的数据不承诺恢复）
    return deps.sourceFileStore
      .writeRawBytes(rawSha256, bytes)
      .then(() => deps.sourceFileStore.writeDecodedText(textSha256, text))
      .then(() =>
        deps.libraryRepository.createSourceWithChapters(
          {
            // 来源 id 按工程隔离（同文件可导入到不同工程；工程内由 service 层保证唯一来源）
            id: `src-${projectId}-${rawSha256.slice(0, 16)}`,
            projectId,
            filename: command.fileName,
            encoding: 'utf-8',
            rawSha256,
            textSha256,
            byteSize: bytes.length,
            createdAt: Date.now(),
          },
          drafts,
        ),
      )
      .then((source) => {
        const result: ImportSourceResult = { source, chapters: drafts };
        return deps.receiptStore
          .put({ commandId: command.commandId, result: ok(result), createdAt: Date.now() })
          .then(() => ok(result));
      })
      .catch((error: unknown) =>
        err('storage', `导入写入失败：${error instanceof Error ? error.message : String(error)}`),
      );
  });
}

export function createImportService(deps: ImportDeps) {
  return {
    /** 幂等入口：相同 commandId 直接返回旧回执，不重复写文件/数据库 */
    importSource(command: ImportSourceCommand): Promise<Result<ImportSourceResult>> {
      return deps.receiptStore
        .get<ImportSourceResult>(command.commandId)
        .then((receipt) => resolveIdempotent(receipt, () => runImport(deps, command)));
    },

    /** 从系统文件选择器发起导入；用户取消返回 ok(null)，其余与 importSource 相同 */
    async pickAndImport(command: {
      projectId: string;
      commandId: string;
    }): Promise<Result<ImportSourceResult | null>> {
      const picked = await deps.filePicker.pickTextFile();
      if (!picked) return ok(null);
      return this.importSource({
        commandId: command.commandId,
        projectId: command.projectId,
        fileName: picked.name,
        bytes: picked.bytes,
      });
    },
  };
}

export type ImportService = ReturnType<typeof createImportService>;
