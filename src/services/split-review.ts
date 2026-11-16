import {
  assertAdoptable,
  assertUndoable,
  buildInitialChapterDrafts,
  type ChapterDraft,
} from '@/domain/split';
import { resolveIdempotent, type Command } from '@/domain/commands';
import type {
  LibraryRepository,
  ProjectRepository,
  ReceiptStore,
  SourceFileStore,
  SplitProposalRepository,
} from '@/domain/ports';
import { err, ok, type Result } from '@/domain/result';

/**
 * 分章候选流程（docs/plan.md 5.3 分章流程）：
 * 重新分章产出 pending 候选（携带采用前快照）→ 人工审阅 → 采用推进 revision → 撤销回退目录。
 * 撤销只回退章节集合，不改来源。守卫（状态 + expectedRevision）在任何写操作之前完成。
 */

export interface SplitReviewDeps {
  projectRepository: ProjectRepository;
  libraryRepository: LibraryRepository;
  splitProposalRepository: SplitProposalRepository;
  sourceFileStore: SourceFileStore;
  receiptStore: ReceiptStore;
}

export interface ProposeResplitCommand extends Command {
  projectId: string;
}

/** 采用/撤销受 revision 守卫：expectedRevision 必填 */
export interface AdoptProposalCommand extends Omit<Command, 'expectedRevision'> {
  projectId: string;
  proposalId: string;
  expectedRevision: number;
}

export interface ResplitResult {
  proposalId: string;
  chapterCount: number;
}

function toDrafts(chapters: ChapterDraft[]): ChapterDraft[] {
  return chapters.map((chapter) => ({
    title: chapter.title,
    startOffset: chapter.startOffset,
    endOffset: chapter.endOffset,
    headingLine: chapter.headingLine,
  }));
}

export function createSplitReviewService(deps: SplitReviewDeps) {
  return {
    /** 重新分章：正则重扫全文形成 pending 候选；不改当前目录，审阅后才生效 */
    async proposeResplit(command: ProposeResplitCommand): Promise<Result<ResplitResult>> {
      const receipt = await deps.receiptStore.get<ResplitResult>(command.commandId);
      return resolveIdempotent(receipt, async () => {
        const source = await deps.libraryRepository.getSource(command.projectId);
        if (!source) return err('invalid', '工程还没有导入来源，先导入 TXT');

        const text = await deps.sourceFileStore.readDecodedText(source.textSha256);
        const drafts = buildInitialChapterDrafts(text);
        const previous = toDrafts(await deps.libraryRepository.listChapters(command.projectId));

        const proposalId = `prop-${command.commandId}`;
        await deps.splitProposalRepository.insert({
          id: proposalId,
          projectId: command.projectId,
          sourceId: source.id,
          payloadJson: JSON.stringify(drafts),
          previousJson: JSON.stringify(previous),
          status: 'pending',
          createdAt: Date.now(),
          adoptedAt: null,
        });
        const result: ResplitResult = { proposalId, chapterCount: drafts.length };
        await deps.receiptStore.put({
          commandId: command.commandId,
          result: ok(result),
          createdAt: Date.now(),
        });
        return ok(result);
      });
    },

    /** 采用候选：显式命令；expectedRevision 不匹配直接 conflict，不产生任何写 */
    async adoptProposal(command: AdoptProposalCommand): Promise<Result<{ chapterCount: number }>> {
      const receipt = await deps.receiptStore.get<{ chapterCount: number }>(command.commandId);
      return resolveIdempotent(receipt, async () => {
        const project = await deps.projectRepository.get(command.projectId);
        if (!project) return err('not_found', '工程不存在');
        const proposal = await deps.splitProposalRepository.get(command.proposalId);
        if (!proposal || proposal.projectId !== command.projectId) {
          return err('not_found', '候选不存在');
        }
        const guardError = assertAdoptable(proposal.status, project.revision, command.expectedRevision);
        if (guardError) return err('conflict', guardError);

        const drafts = JSON.parse(proposal.payloadJson) as ChapterDraft[];
        // 撤销语义：回到"采用时点"的目录（采用与提出候选之间的编辑也被保留）
        const previousAtAdopt = toDrafts(await deps.libraryRepository.listChapters(command.projectId));
        await deps.splitProposalRepository.setPreviousJson(command.proposalId, JSON.stringify(previousAtAdopt));
        await deps.libraryRepository.replaceChapters(
          command.projectId,
          proposal.sourceId,
          drafts,
          { bumpRevision: true },
        );
        await deps.splitProposalRepository.setStatus(command.proposalId, 'adopted', Date.now());
        const result = { chapterCount: drafts.length };
        await deps.receiptStore.put({
          commandId: command.commandId,
          result: ok(result),
          createdAt: Date.now(),
        });
        return ok(result);
      });
    },

    /** 撤销采用：回退到候选采用前的目录快照；revision 再推进一次 */
    async undoAdopt(command: AdoptProposalCommand): Promise<Result<{ chapterCount: number }>> {
      const receipt = await deps.receiptStore.get<{ chapterCount: number }>(command.commandId);
      return resolveIdempotent(receipt, async () => {
        const project = await deps.projectRepository.get(command.projectId);
        if (!project) return err('not_found', '工程不存在');
        const proposal = await deps.splitProposalRepository.get(command.proposalId);
        if (!proposal || proposal.projectId !== command.projectId) {
          return err('not_found', '候选不存在');
        }
        const guardError = assertUndoable(proposal.status, project.revision, command.expectedRevision);
        if (guardError) return err('conflict', guardError);

        const previous = JSON.parse(proposal.previousJson) as ChapterDraft[];
        await deps.libraryRepository.replaceChapters(
          command.projectId,
          proposal.sourceId,
          previous,
          { bumpRevision: true },
        );
        await deps.splitProposalRepository.setStatus(command.proposalId, 'withdrawn', null);
        const result = { chapterCount: previous.length };
        await deps.receiptStore.put({
          commandId: command.commandId,
          result: ok(result),
          createdAt: Date.now(),
        });
        return ok(result);
      });
    },
  };
}

export type SplitReviewService = ReturnType<typeof createSplitReviewService>;
