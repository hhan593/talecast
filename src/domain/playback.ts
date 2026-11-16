/**
 * 段队列推导与段内进度 → 正文高亮映射（docs/plan.md 4.1.6 / 5.3 播放流程）。
 * 核心约束：当前段 ordinal 即高亮单元，段内不逐字对齐；
 * 位置权威来源是 reading_state，播放器实例不在屏幕组件上（P3 已落地：编排见 src/services/playback.ts（全局单例），本文件保留映射规则占位。
 */

export {};
