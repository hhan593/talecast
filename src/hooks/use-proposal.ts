import { useCallback, useEffect, useState } from 'react';

import { useServices } from '@/container';
import type { ChapterDraft, ProposalStatus } from '@/domain/split';
import type { SplitProposalRecord } from '@/domain/ports';

/** 审阅 modal 的数据入口：候选章节 + 采用/撤销（docs/plan.md 5.3 分章流程） */
export function useProposal(projectId: string, proposalId: string, revision: number) {
  const services = useServices();
  const [record, setRecord] = useState<SplitProposalRecord | null>(null);
  const [drafts, setDrafts] = useState<ChapterDraft[]>([]);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const reload = useCallback(async () => {
    const found = await services.libraryQuery.getProposal(proposalId);
    setRecord(found);
    setDrafts(found ? (JSON.parse(found.payloadJson) as ChapterDraft[]) : []);
  }, [proposalId, services]);

  useEffect(() => {
    void reload();
  }, [reload]);

  const adopt = useCallback(async () => {
    setBusy(true);
    try {
      const result = await services.splitReview.adoptProposal({
        commandId: services.newCommandId(),
        projectId,
        proposalId,
        expectedRevision: revision,
      });
      if (!result.ok) setError(result.error.message);
      else setError(null);
      await reload();
      return result;
    } finally {
      setBusy(false);
    }
  }, [projectId, proposalId, reload, revision, services]);

  const undo = useCallback(async () => {
    setBusy(true);
    try {
      const result = await services.splitReview.undoAdopt({
        commandId: services.newCommandId(),
        projectId,
        proposalId,
        expectedRevision: revision,
      });
      if (!result.ok) setError(result.error.message);
      else setError(null);
      await reload();
      return result;
    } finally {
      setBusy(false);
    }
  }, [projectId, proposalId, reload, revision, services]);

  const status: ProposalStatus | null = record?.status ?? null;
  return { record, drafts, status, busy, error, adopt, undo };
}
