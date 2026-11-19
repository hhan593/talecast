/**
 * 阅读主题（docs/design/2026-11-19-reading-experience-plan.md RE-1）：
 * 四套主题作用于阅读页（背景/正文/工具栏），书架等 chrome 保持系统明暗。
 * 类名走 NativeWind 任意值，确定性映射（无运行时颜色计算）。
 */

export type ReaderThemeKey = 'paper' | 'green' | 'white' | 'night';

export interface ReaderThemeTokens {
  /** 阅读页背景 */
  bg: string;
  /** 卡片/工具栏底 */
  surface: string;
  /** 正文与标题 */
  text: string;
  /** 次要文本 */
  muted: string;
  /** 边框 */
  border: string;
  /** 主行动按钮底 */
  action: string;
  /** 主行动按钮文字 */
  actionText: string;
  /** 强调（朗读段高亮底） */
  highlightBg: string;
  /** 章节序号点缀 */
  accent: string;
}

export const READER_THEMES: Record<ReaderThemeKey, ReaderThemeTokens & { label: string }> = {
  paper: {
    label: '纸感',
    bg: 'bg-[#F6F1E7]',
    surface: 'bg-[#FDFBF5]',
    text: 'text-[#2C2822]',
    muted: 'text-[#8C8272]',
    border: 'border-[#E6DECE]',
    action: 'bg-[#B5442D]',
    actionText: 'text-[#FDFBF5]',
    highlightBg: 'bg-[#F3E2DB]',
    accent: 'text-[#B5442D]',
  },
  green: {
    label: '护眼',
    bg: 'bg-[#C7E3CE]',
    surface: 'bg-[#DDEFD4]',
    text: 'text-[#28372B]',
    muted: 'text-[#5E7263]',
    border: 'border-[#ABCFB4]',
    action: 'bg-[#3E6B4C]',
    actionText: 'text-[#DDEFD4]',
    highlightBg: 'bg-[#B4D9BF]',
    accent: 'text-[#3E6B4C]',
  },
  white: {
    label: '纯白',
    bg: 'bg-white',
    surface: 'bg-[#F4F5F7]',
    text: 'text-[#111827]',
    muted: 'text-[#6B7280]',
    border: 'border-[#E5E7EB]',
    action: 'bg-[#4F46E5]',
    actionText: 'text-white',
    highlightBg: 'bg-[#EEF0FE]',
    accent: 'text-[#4F46E5]',
  },
  night: {
    label: '暖黑',
    bg: 'bg-[#0D0F14]',
    surface: 'bg-[#161A22]',
    text: 'text-[#EAE7E0]',
    muted: 'text-[#7E8598]',
    border: 'border-[#262C38]',
    action: 'bg-[#D9A441]',
    actionText: 'text-[#10131B]',
    highlightBg: 'bg-[#3A3446]',
    accent: 'text-[#D9A441]',
  },
};

/** 主题循环顺序：纸感 → 护眼 → 纯白 → 暖黑 */
export const THEME_CYCLE: ReaderThemeKey[] = ['paper', 'green', 'white', 'night'];

export function nextTheme(current: ReaderThemeKey): ReaderThemeKey {
  const index = THEME_CYCLE.indexOf(current);
  return THEME_CYCLE[(index + 1) % THEME_CYCLE.length];
}

export function isReaderThemeKey(value: string): value is ReaderThemeKey {
  return value === 'paper' || value === 'green' || value === 'white' || value === 'night';
}
