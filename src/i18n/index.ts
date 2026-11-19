/**
 * 轻量 i18n（v0.14.0）：zh/en 双语字典 + 模块级 locale + t()。
 * 设计取舍（docs/design/2026-11-20-v0.10-v0.16-roadmap.md）：
 * - 不引入 i18next 依赖（个人应用体量，纯字典够用）
 * - 模块级单例 + useI18n() 的 locale state 驱动重渲
 * - 缺失键回退中文（字典按 zh 全量维护，en 渐进补齐）
 * - v0.14 覆盖核心四界面（书架/设置/工作台/阅读器）；长尾文案渐进抽取
 */

export type Locale = 'zh' | 'en';
export type LanguageSetting = 'system' | 'zh' | 'en';

const zh = {
  // 书架
  'shelf.title': 'TaleCast',
  'shelf.subtitle': '书架 · 把一本小说变成可以听的章节音频',
  'shelf.add': '＋ 添加书籍',
  'shelf.empty': '书架还是空的。点"添加书籍"创建一本书籍，再导入 UTF-8 TXT 文本。',
  'shelf.grid': '▦ 网格',
  'shelf.list': '☰ 列表',
  'shelf.filterAll': '全部',
  'shelf.sort': '排序',
  'shelf.sortRecent': '最近',
  'shelf.sortCreated': '添加',
  'shelf.sortTitle': '标题',
  'shelf.deleteConfirm': '的章节、候选与生成任务将全部删除，且不可恢复。确认删除？',
  'shelf.editTags': '编辑标签',
  'shelf.deleteBook': '删除书籍',
  'shelf.refresh': '刷新',
  'shelf.tagsDialogSuffix': ' · 标签',
  // 工作台
  'workbench.characters': '角色中心',
  'workbench.assistant': '书籍助手',
  'workbench.importTxt': '导入 UTF-8 TXT',
  'workbench.resplit': '重新分章',
  'workbench.dialogueVoices': '对话分声',
  'workbench.chapters': '章节',
  'workbench.bookmarks': '书签',
  'workbench.notes': '笔记',
  'workbench.search': '搜索',
  'workbench.searchPlaceholder': '搜索全文关键词',
  'workbench.searchButton': '搜索',
  'workbench.searching': '搜索中',
  'workbench.catalogEmpty': '还没有章节。导入一本 UTF-8 TXT 小说开始制作。',
  'workbench.bookmarksEmpty': '还没有书签。阅读时点工具栏「书签」即可收藏当前段落。',
  'workbench.notesEmpty': '还没有划线与笔记。阅读时长按段落即可划线或写笔记。',
  'workbench.exportMarkdown': '导出 Markdown',
  // 阅读器
  'reader.backToCatalog': '返回目录',
  'reader.playChapter': '播放整章',
  'reader.pause': '暂停',
  'reader.resume': '继续',
  'reader.bookmark': '书签',
  'reader.prevChapter': '上一章',
  'reader.nextChapter': '下一章',
  'reader.underline': '划线',
  'reader.note': '笔记',
  'reader.copy': '复制',
  'reader.cancel': '取消',
  'reader.minutesLeft': '分钟',
  // 设置
  'settings.title': '设置',
  'settings.llmSection': '服务连接 · 文本模型（OpenAI 兼容）',
  'settings.endpoint': '端点 Base URL',
  'settings.model': '模型名',
  'settings.apiKey': 'API Key',
  'settings.save': '保存服务连接',
  'settings.ttsSection': '语音生成',
  'settings.usageSection': '请求用量（本机累计）',
  'settings.backupSection': '数据备份（JSON）',
  'settings.exportBackup': '导出备份',
  'settings.importBackup': '导入恢复',
  'settings.readingSection': '阅读',
  'settings.statsSection': '阅读统计（本机）',
  'settings.errorBoundarySection': '能力边界',
  'settings.languageSection': '界面语言',
  'settings.languageSystem': '跟随系统',
} as const;

export type StringKey = keyof typeof zh;

const en: Partial<Record<StringKey, string>> = {
  'shelf.subtitle': 'Bookshelf · Turn a novel into listenable chapters',
  'shelf.add': '＋ Add Book',
  'shelf.empty': 'Your shelf is empty. Tap "Add Book", then import a UTF-8 TXT file.',
  'shelf.grid': '▦ Grid',
  'shelf.list': '☰ List',
  'shelf.filterAll': 'All',
  'shelf.sort': 'Sort',
  'shelf.sortRecent': 'Recent',
  'shelf.sortCreated': 'Added',
  'shelf.sortTitle': 'Title',
  'shelf.editTags': 'Edit Tags',
  'shelf.deleteBook': 'Delete Book',
  'shelf.refresh': 'Refresh',
  'workbench.characters': 'Characters',
  'workbench.assistant': 'Assistant',
  'workbench.importTxt': 'Import UTF-8 TXT',
  'workbench.resplit': 'Re-split Chapters',
  'workbench.dialogueVoices': 'Dialogue Voices',
  'workbench.chapters': 'Chapters',
  'workbench.bookmarks': 'Bookmarks',
  'workbench.notes': 'Notes',
  'workbench.search': 'Search',
  'workbench.searchPlaceholder': 'Search full text',
  'workbench.searchButton': 'Search',
  'workbench.searching': 'Searching',
  'reader.backToCatalog': 'Catalog',
  'reader.playChapter': 'Play Chapter',
  'reader.pause': 'Pause',
  'reader.resume': 'Resume',
  'reader.bookmark': 'Bookmark',
  'reader.prevChapter': 'Prev',
  'reader.nextChapter': 'Next',
  'reader.underline': 'Underline',
  'reader.note': 'Note',
  'reader.copy': 'Copy',
  'reader.cancel': 'Cancel',
  'settings.title': 'Settings',
  'settings.llmSection': 'LLM Service (OpenAI-compatible)',
  'settings.endpoint': 'Base URL',
  'settings.model': 'Model',
  'settings.apiKey': 'API Key',
  'settings.save': 'Save Connection',
  'settings.ttsSection': 'Voice Synthesis',
  'settings.usageSection': 'Request Usage (local)',
  'settings.backupSection': 'Data Backup (JSON)',
  'settings.exportBackup': 'Export Backup',
  'settings.importBackup': 'Import Restore',
  'settings.readingSection': 'Reading',
  'settings.statsSection': 'Reading Stats (local)',
  'settings.languageSection': 'Language',
  'settings.languageSystem': 'System',
};

const STRINGS: Record<Locale, Partial<Record<StringKey, string>>> = { zh, en };

let currentLocale: Locale = 'zh';
const listeners = new Set<(locale: Locale) => void>();

export function setLocale(locale: Locale): void {
  if (currentLocale === locale) return;
  currentLocale = locale;
  for (const listener of listeners) listener(locale);
}

/** 语言变更订阅（useI18n 重渲驱动） */
export function subscribeLocale(listener: (locale: Locale) => void): () => void {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

export function getLocale(): Locale {
  return currentLocale;
}

/** 翻译：缺失键回退中文，再回退键名 */
export function t(key: StringKey): string {
  return STRINGS[currentLocale][key] ?? STRINGS.zh[key] ?? key;
}

/** 解析设置值 → locale（system 用系统语言，非中英环境回退英文） */
export function resolveLocale(setting: LanguageSetting | null): Locale {
  if (setting === 'zh') return 'zh';
  if (setting === 'en') return 'en';
  const system = typeof navigator !== 'undefined' ? navigator.language : 'zh-CN';
  return system.toLowerCase().startsWith('zh') ? 'zh' : 'en';
}
