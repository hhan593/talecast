/**
 * 应用内更新检查（issue #58 P1，仅 Android）。
 * 纯函数：GitHub Release tag 与本地版本的比较、Release 说明截断。
 * 版本规则：点分段数字比较（忽略前缀 v，段数不齐补零，1.0 == 1.0.0）；
 * 任一侧非法时宁可不提示（false），不做 best-effort 猜测。
 */

export interface ReleaseInfo {
  /** Release tag，如 "v0.19.1" */
  tagName: string;
  /** Release 页 URL（「更新」按钮的跳转目标） */
  htmlUrl: string;
  /** Release 说明（弹窗展示，超长由 truncateNotes 截断） */
  notes: string;
}

/** "v0.19.1" → [0, 19, 1]；非法（空段 / 非数字段）→ null */
export function parseVersionTag(tag: string): number[] | null {
  const cleaned = tag.trim().replace(/^v/i, '');
  if (cleaned.length === 0) return null;
  const parts = cleaned.split('.');
  if (parts.some((p) => !/^\d+$/.test(p))) return null;
  return parts.map((p) => Number.parseInt(p, 10));
}

/** 版本比较：a < b → -1，a = b → 0，a > b → 1；任一侧非法 → null */
export function compareVersions(a: string, b: string): number | null {
  const pa = parseVersionTag(a);
  const pb = parseVersionTag(b);
  if (!pa || !pb) return null;
  const length = Math.max(pa.length, pb.length);
  for (let i = 0; i < length; i++) {
    const diff = (pa[i] ?? 0) - (pb[i] ?? 0);
    if (diff !== 0) return diff > 0 ? 1 : -1;
  }
  return 0;
}

/** 远端 Release 是否比本地版本新（任一侧解析失败 → false，静默不提示） */
export function isReleaseNewer(releaseTag: string, localVersion: string): boolean {
  const cmp = compareVersions(releaseTag, localVersion);
  return cmp !== null && cmp > 0;
}

/** Release 说明截断：去掉首尾空白，超长以省略号收尾（Alert 弹窗内展示） */
export function truncateNotes(notes: string, max = 300): string {
  const trimmed = notes.trim();
  return trimmed.length > max ? `${trimmed.slice(0, max)}…` : trimmed;
}
