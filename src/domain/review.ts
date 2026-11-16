/**
 * 候选审阅、采用、撤销规则（docs/plan.md 4.1.3 / 5.3 分章流程）。
 * 核心约束：候选不直改工程；采用走显式命令（幂等回执 + revision 推进）；
 * 撤销只回退目录，不改来源。实现见 src/services/split-review.ts（候选结构在 split.ts，回执在 commands.ts）。
 */

export {};
