/**
 * 不可变来源、哈希与修订规则（docs/plan.md 4.1.2 / 5.3 导入流程）。
 * 实现随 P1 导入闭环落地：双哈希（raw_sha256 / text_sha256）、UTF-8 校验（fatal decode）、
 * 解码文本字符偏移基准、同一事务写 sources 与初始 chapters。
 */

export {};
