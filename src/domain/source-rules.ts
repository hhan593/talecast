/**
 * 书源规则数据模型骨架（docs/design/2026-11-19-phase2-plan.md §6 阶段二前置）：
 * Legado 书源 JSON 的子集 → 类型化规则对象。只做解析与校验，不含执行调度
 * （网络请求调度涉及版权与 robots 边界，独立评估后置）。
 */

export interface BookSourceRule {
  sourceName: string;
  sourceUrl: string;
  /** 搜索页 URL 模板（{{key}} 占位） */
  searchUrl?: string;
  ruleSearch?: {
    bookList?: string;
    name?: string;
    author?: string;
    bookUrl?: string;
  };
  ruleBookInfo?: {
    name?: string;
    author?: string;
    intro?: string;
    tocUrl?: string;
  };
  ruleToc?: {
    chapterList?: string;
    chapterName?: string;
    chapterUrl?: string;
  };
  ruleContent?: {
    content?: string;
  };
}

export interface ParsedBookSource {
  sourceName: string;
  sourceUrl: string;
  hasSearch: boolean;
  hasToc: boolean;
  hasContent: boolean;
}

/** 解析 Legado 兼容书源 JSON（单个对象或数组），校验必填字段 */
export function parseBookSourceRule(json: string): ParsedBookSource[] | null {
  let parsed: unknown;
  try {
    parsed = JSON.parse(json);
  } catch {
    return null;
  }
  const list = Array.isArray(parsed) ? parsed : [parsed];
  const out: ParsedBookSource[] = [];
  for (const raw of list) {
    const item = raw as Record<string, unknown>;
    const sourceName = typeof item.sourceName === 'string' ? item.sourceName : '';
    const sourceUrl = typeof item.sourceUrl === 'string' ? item.sourceUrl : '';
    if (sourceName.length === 0 || sourceUrl.length === 0) return null;
    const rules = (item.ruleSearch ?? {}) as Record<string, unknown>;
    const toc = (item.ruleToc ?? {}) as Record<string, unknown>;
    const content = (item.ruleContent ?? {}) as Record<string, unknown>;
    out.push({
      sourceName,
      sourceUrl,
      hasSearch: typeof rules.bookList === 'string',
      hasToc: typeof toc.chapterList === 'string',
      hasContent: typeof content.content === 'string',
    });
  }
  return out;
}
