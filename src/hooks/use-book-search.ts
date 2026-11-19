import { useCallback, useState } from 'react';

import { useServices } from '@/container';
import type { BookSearchResult } from '@/services/search';

/** 全文搜索数据入口（R3） */
export function useBookSearch(projectId: string) {
  const services = useServices();
  const [results, setResults] = useState<BookSearchResult[] | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const search = useCallback(
    async (query: string) => {
      if (query.trim().length === 0) return;
      setBusy(true);
      setError(null);
      try {
        const result = await services.search.searchBook(projectId, query);
        if (!result.ok) {
          setError(result.error.message);
          setResults(null);
          return;
        }
        setResults(result.value);
      } finally {
        setBusy(false);
      }
    },
    [projectId, services],
  );

  const clear = useCallback(() => {
    setResults(null);
    setError(null);
  }, []);

  return { results, busy, error, search, clear };
}
