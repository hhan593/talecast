import { buildInitialChapterDrafts, type ChapterDraft } from '@/domain/split';
import { parseEpub } from '@/domain/epub';
import { checkImportSize, decodeValidatedUtf8, isValidUtf8 } from '@/domain/source';
import { sha256Bytes, sha256Text } from '@/domain/hash';
import { resolveIdempotent, type Command } from '@/domain/commands';
import { parseMobi } from '@/domain/mobi';
import { stripHtml } from '@/domain/epub';
import type { FilePicker, LibraryRepository, ReceiptStore, SourceFileStore } from '@/domain/ports';
import { errorMessage, err, ok, type Result } from '@/domain/result';
import type { SourceInfo } from '@/domain/types';

/**
 * 导入用例（docs/plan.md 5.3 导入流程）：
 * 系统选择器取文件 → 校验 UTF-8 → 双哈希 → 写不可变文件 → 同一事务写 sources + 初始 chapters → 回执。
 * 一个书籍一份来源；重复导入给出明确错误。
 */

export interface ImportDeps {
  filePicker: FilePicker;
  libraryRepository: LibraryRepository;
  sourceFileStore: SourceFileStore;
  receiptStore: ReceiptStore;
  /** EPUB 解析适配（v0.5.0）：jszip 注入实现 */
  epubParser?: {
    parseEpub(bytes: Uint8Array): Promise<{ bookTitle: string; chapters: Array<{ title: string; text: string }> }>;
    /** 封面提取（v0.14.0）：返回字节与 MIME；无封面/不支持返回 null */
    extractCover?(bytes: Uint8Array): Promise<{ bytes: Uint8Array; mime: string } | null>;
  };
  /** 封面持久化（v0.14.0，容器注入沙盒实现）；路径经 settings `cover:<projectId>` 记录 */
  coverStore?: {
    write(projectId: string, bytes: Uint8Array, mime: string): Promise<string>;
  };
  settingsRepository?: import('@/domain/ports').SettingsRepository;
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



async function runMobiImport(
  deps: ImportDeps,
  command: ImportSourceCommand,
): Promise<Result<ImportSourceResult>> {
  const existing = await deps.libraryRepository.getSource(command.projectId);
  if (existing) {
    return err('invalid', `本书已导入《${existing.filename}》。一本书只支持一份文本来源`);
  }
  try {
    const parsed = parseMobi(command.bytes, stripHtml);
    const drafts: ChapterDraft[] = [];
    let fullText = '';
    for (const chapter of parsed.chapters) {
      const chunk = `${chapter.title}\n${chapter.text}\n`;
      drafts.push({
        title: chapter.title,
        startOffset: fullText.length,
        endOffset: fullText.length + chunk.length,
        headingLine: null,
      });
      fullText += chunk;
    }
    const rawSha256 = sha256Bytes(command.bytes);
    const textSha256 = sha256Text(fullText);
    await deps.sourceFileStore.writeRawBytes(rawSha256, command.bytes);
    await deps.sourceFileStore.writeDecodedText(textSha256, fullText);
    const source = await deps.libraryRepository.createSourceWithChapters(
      {
        id: `src-${command.projectId}-${rawSha256.slice(0, 16)}`,
        projectId: command.projectId,
        filename: command.fileName,
        encoding: 'utf-8',
        byteSize: command.bytes.length,
        rawSha256,
        textSha256,
        createdAt: Date.now(),
      },
      drafts,
    );
    await deps.receiptStore.put({
      commandId: command.commandId,
      result: ok({ source, chapters: drafts }),
      createdAt: Date.now(),
    });
    return ok({ source, chapters: drafts });
  } catch (error) {
    return err('invalid', `MOBI 解析失败：${error instanceof Error ? error.message : String(error)}`);
  }
}

async function runEpubImport(
  deps: ImportDeps,
  command: ImportSourceCommand,
): Promise<Result<ImportSourceResult>> {
  if (!deps.epubParser) return err('invalid', 'EPUB 支持未启用');
  const existing = await deps.libraryRepository.getSource(command.projectId);
  if (existing) {
    return err('invalid', `本书已导入《${existing.filename}》。一本书只支持一份文本来源`);
  }
  try {
    const parsed = await deps.epubParser.parseEpub(command.bytes);
    // 组装全文：每章 = 标题行 + 正文 + 换行；章节草案指向标题行起点（EPUB 自带结构，不走正则候选）
    const drafts: ChapterDraft[] = [];
    let fullText = '';
    for (const chapter of parsed.chapters) {
      const chunk = `${chapter.title}\n${chapter.text}\n`;
      drafts.push({
        title: chapter.title,
        startOffset: fullText.length,
        endOffset: fullText.length + chunk.length,
        headingLine: null,
      });
      fullText += chunk;
    }
    const rawSha256 = sha256Bytes(command.bytes);
    const textSha256 = sha256Text(fullText);
    await deps.sourceFileStore.writeRawBytes(rawSha256, command.bytes);
    await deps.sourceFileStore.writeDecodedText(textSha256, fullText);
    // 封面提取（v0.14.0）：失败静默（书架回退生成式封面）
    if (deps.coverStore && deps.epubParser?.extractCover) {
      try {
        const cover = await deps.epubParser.extractCover(command.bytes);
        if (cover) {
          const coverPath = await deps.coverStore.write(command.projectId, cover.bytes, cover.mime);
          if (deps.settingsRepository) {
            await deps.settingsRepository.set(`cover:${command.projectId}`, coverPath);
          }
        }
      } catch {
        // 封面失败不影响导入
      }
    }
    const source = await deps.libraryRepository.createSourceWithChapters(
      {
        id: `src-${command.projectId}-${rawSha256.slice(0, 16)}`,
        projectId: command.projectId,
        filename: command.fileName,
        encoding: 'utf-8',
        rawSha256,
        textSha256,
        byteSize: command.bytes.length,
        createdAt: Date.now(),
      },
      drafts,
    );
    const result: ImportSourceResult = { source, chapters: drafts };
    await deps.receiptStore.put({
      commandId: command.commandId,
      result: ok(result),
      createdAt: Date.now(),
    });
    return ok(result);
  } catch (error) {
    return err('invalid', `EPUB 解析失败：${error instanceof Error ? error.message : String(error)}`);
  }
}


function runImport(deps: ImportDeps, command: ImportSourceCommand): Promise<Result<ImportSourceResult>> {
  const { bytes, projectId } = command;

  if (bytes.length === 0) return Promise.resolve(err('invalid', '文件内容为空'));
  // EPUB 分支（v0.5.0）：二进制 ZIP 容器，内部 XHTML 自身 UTF-8；在 UTF-8 字节校验之前分流
  if (deps.epubParser && (command.fileName.toLowerCase().endsWith('.epub') || (bytes[0] === 0x50 && bytes[1] === 0x4b))) {
    return runEpubImport(deps, command);
  }
  // MOBI/AZW3/PRC（v0.14.0）：自研 PalmDOC 解析，整本单章（由"重新分章"提候选）
  const lowerName = command.fileName.toLowerCase();
  if (lowerName.endsWith('.mobi') || lowerName.endsWith('.azw3') || lowerName.endsWith('.prc')) {
    // 大小校验（issue #34）：MOBI/EPUB 分支此前绕过 TXT 的 16MB 上限
    if (command.bytes.length > 16 * 1024 * 1024) {
      return Promise.resolve(err('invalid', `文件超出 16MB 上限（${(command.bytes.length / 1024 / 1024).toFixed(1)}MB）`));
    }
    return runMobiImport(deps, command);
  }
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

    const text = decodeValidatedUtf8(bytes);
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
        err('storage', `导入写入失败：${errorMessage(error)}`),
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
