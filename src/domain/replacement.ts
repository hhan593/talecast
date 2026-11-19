/**
 * 替换净化规则（docs/design/2026-11-19-reading-experience-plan.md RE-3）：
 * 展示层变换——来源不变（sha256 不变）。规则列表在阅读/导出时应用于文本。
 * Legado 风格：find（正则或字面量）→ replace。默认模板去常见页眉页脚广告。
 */

export interface ReplacementRule {
  find: string;
  replace: string;
  /** true = find 按正则解释（默认 false = 字面量替换） */
  isRegex?: boolean;
}

/** 内置默认净化模板（去常见网文页眉页脚广告行） */
export const DEFAULT_REPLACEMENT_RULES: ReplacementRule[] = [
  { find: '^\\s*[（(]?本章由[\\S\\s]*?[）)]?\\s*$', replace: '', isRegex: true },
  { find: '^\\s*[（(]?更多精彩[\\S\\s]*?[）)]?\\s*$', replace: '', isRegex: true },
  { find: '^\\s*[（(]?请记住本书[\\S\\s]*?[）)]?\\s*$', replace: '', isRegex: true },
  { find: '^\\s*[（(]?首发[\\S\\s]*?[）)]?\\s*$', replace: '', isRegex: true },
];

/** 应用替换规则列表到文本（顺序执行，行为保持——来源不变） */
export function applyReplacements(
  text: string,
  rules: ReplacementRule[],
): string {
  let result = text;
  for (const rule of rules) {
    if (rule.isRegex) {
      try {
        result = result.replace(new RegExp(rule.find, 'gm'), rule.replace);
      } catch {
        // 无效正则：跳过该规则（不抛错——净化是可选增强）
      }
    } else {
      result = result.split(rule.find).join(rule.replace);
    }
  }
  return result;
}

/** 序列化/反序列化（settings 表存储） */
export function serializeRules(rules: ReplacementRule[]): string {
  return JSON.stringify(rules);
}

export function deserializeRules(json: string): ReplacementRule[] {
  try {
    const parsed = JSON.parse(json) as unknown;
    if (!Array.isArray(parsed)) return [];
    return parsed.filter(
      (item): item is ReplacementRule =>
        typeof item === 'object' && item !== null && typeof (item as ReplacementRule).find === 'string',
    );
  } catch {
    return [];
  }
}
