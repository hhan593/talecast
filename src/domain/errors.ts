/**
 * 错误文案表（issue #82）：err() 的文案键 → 双语文案。
 * 键由各服务以 errError('<key>') 引用；i18n 覆盖测试（errors.test.ts）
 * 保证每个键 zh/en 齐备且唯一。模板条目以函数承载参数插值。
 */
import type { CommandErrorCode } from './result';

type ErrorText = string | ((params: Record<string, string>) => string);

export interface ErrorEntry {
  code: CommandErrorCode;
  zh: ErrorText;
  en: ErrorText;
}

export const ERRORS = {
  // ---- 导入 / 来源（import.ts / source-url.ts）----
  urlInvalid: { code: 'invalid', zh: 'URL 格式不正确', en: 'Invalid URL format' },
  downloadEmpty: { code: 'invalid', zh: '下载内容为空', en: 'Downloaded content is empty' },
  urlFileTooLarge: {
    code: 'invalid',
    zh: (p: Record<string, string>) => `文件超出 16MB 上限（${p.size}MB）`,
    en: (p: Record<string, string>) => `File exceeds the 16MB limit (${p.size}MB)`,
  },
  downloadFailed: {
    code: 'network',
    zh: (p: Record<string, string>) => `下载失败：${p.reason}`,
    en: (p: Record<string, string>) => `Download failed: ${p.reason}`,
  },
  emptyFile: { code: 'invalid', zh: '文件内容为空', en: 'File content is empty' },
  fileTooLarge: {
    code: 'invalid',
    zh: (p: Record<string, string>) => `文件超出首版 16MB 上限（当前 ${p.size}MB），请拆分后导入`,
    en: (p: Record<string, string>) => `File exceeds the 16MB import limit (${p.size}MB). Split it first`,
  },
  alreadyImported: {
    code: 'invalid',
    zh: (p: Record<string, string>) => `本书已导入《${p.name}》。一本书只支持一份文本来源`,
    en: (p: Record<string, string>) => `This book already has "${p.name}" imported. One book supports a single text source`,
  },
  epubDisabled: { code: 'invalid', zh: 'EPUB 支持未启用', en: 'EPUB support is not enabled' },
  // ---- 分章 / 章节编辑 / 项目（split-review / projects / chapter-edits）----
  noText: { code: 'invalid', zh: '还没有导入文本，先导入 TXT', en: 'No text imported yet — import a TXT first' },
  bookMissing: { code: 'not_found', zh: '书籍不存在', en: 'Book not found' },
  proposalMissing: { code: 'not_found', zh: '候选不存在', en: 'Proposal not found' },
  revisionConflict: {
    code: 'conflict',
    zh: '书籍已被其他操作修改，请刷新后重试',
    en: 'The book was modified by another action — refresh and retry',
  },
  titleLength: {
    code: 'invalid',
    zh: '标题需为 1-60 个字符',
    en: 'Title must be 1-60 characters',
  },
  tagsUnsupported: {
    code: 'invalid',
    zh: '当前存储不支持标签',
    en: 'Tags are not supported by the current storage',
  },
  // ---- 标注 / 搜索 / 阅读（annotations / search / reading）----
  chapterMissing: { code: 'not_found', zh: '章节不存在', en: 'Chapter not found' },
  noSource: { code: 'invalid', zh: '书籍还没有导入来源', en: 'No text source imported for this book' },
  queryEmpty: { code: 'invalid', zh: '搜索词不能为空', en: 'Search query is empty' },
  // ---- 角色 / 绑定（characters / bindings）----
  noChapters: { code: 'invalid', zh: '还没有章节', en: 'No chapters yet' },
  characterMissing: { code: 'not_found', zh: '角色不存在', en: 'Character not found' },
  characterNameLength: {
    code: 'invalid',
    zh: '角色名需为 1-30 个字符',
    en: 'Character name must be 1-30 characters',
  },
  characterProtected: {
    code: 'busy',
    zh: '已确认角色受人工保护；请先在书籍内解除引用后再删除（P2 提供删除入口前，可直接改名）',
    en: 'Confirmed characters are protected; unbind it in the book first (rename it for now until a delete entry ships)',
  },
  characterTargetMissing: {
    code: 'invalid',
    zh: '角色绑定缺少目标角色',
    en: 'Character binding requires a target character',
  },
  characterUnconfirmed: {
    code: 'invalid',
    zh: '只有人工确认过的角色才能绑定音色',
    en: 'Only manually confirmed characters can bind a voice',
  },
  // ---- 助手 / 导出（assistant / export）----
  scopeInvalid: {
    code: 'invalid',
    zh: '助手上下文范围无效：章节不存在或选区越界',
    en: 'Invalid assistant scope: chapter missing or selection out of bounds',
  },
  messageEmpty: { code: 'invalid', zh: '消息不能为空', en: 'Message is empty' },
  noDoneAudio: {
    code: 'invalid',
    zh: '本章还没有已完成的生成音频，请先点"生成本章"',
    en: 'No finished audio for this chapter yet — tap "Generate chapter" first',
  },
  exportFailed: {
    code: 'storage',
    zh: (p: Record<string, string>) => `导出失败：${p.reason}`,
    en: (p: Record<string, string>) => `Export failed: ${p.reason}`,
  },
  shareFailed: {
    code: 'storage',
    zh: (p: Record<string, string>) => `分享失败：${p.reason}`,
    en: (p: Record<string, string>) => `Share failed: ${p.reason}`,
  },
  // ---- 生成（generation）----
  chapterOrSourceMissing: {
    code: 'not_found',
    zh: '章节或来源不存在',
    en: 'Chapter or source not found',
  },
  chapterTooLarge: {
    code: 'invalid',
    zh: (p: Record<string, string>) => `本章 ${p.size} 字超出首版单章 3 万字上限，请拆章后生成`,
    en: (p: Record<string, string>) => `This chapter has ${p.size} chars, over the 30k per-chapter limit. Split it first`,
  },
  jobMissing: { code: 'not_found', zh: '任务不存在', en: 'Job not found' },
  jobRunning: { code: 'busy', zh: '任务仍在进行中，稍候刷新进度', en: 'Job is still running — refresh later' },
  jobFinished: { code: 'busy', zh: '任务已结束，无需取消', en: 'Job already finished — nothing to cancel' },
  chapterEmpty: { code: 'invalid', zh: '本章内容为空', en: 'Chapter content is empty' },
  previewFailed: {
    code: 'network',
    zh: (p: Record<string, string>) => `试听合成失败：${p.reason}`,
    en: (p: Record<string, string>) => `Preview synthesis failed: ${p.reason}`,
  },
  // ---- 备份（backup）----
  shareUnsupported: { code: 'invalid', zh: '当前环境不支持分享', en: 'Sharing is not supported here' },
  invalidJson: { code: 'invalid', zh: '备份文件不是有效的 JSON', en: 'Backup file is not valid JSON' },
  invalidFormat: { code: 'invalid', zh: '备份文件格式不正确', en: 'Backup file format is incorrect' },
  versionUnsupported: {
    code: 'invalid',
    zh: '备份版本不受支持，请升级应用后再导入',
    en: 'Backup version not supported — upgrade the app first',
  },
  missingSettings: { code: 'invalid', zh: '备份缺少设置项', en: 'Backup is missing settings' },
  importUnsupported: { code: 'invalid', zh: '当前环境不支持导入', en: 'Import is not supported here' },
  // ---- 播放（playback）----
  noAudioSegments: { code: 'invalid', zh: '本章没有可用音频段', en: 'No usable audio segments for this chapter' },
  noQueue: { code: 'invalid', zh: '当前没有播放队列', en: 'No playback queue' },
  sleepRange: { code: 'invalid', zh: '定时时长需为 1-240 分钟', en: 'Sleep timer must be 1-240 minutes' },
  rateRange: { code: 'invalid', zh: '倍速超出支持范围', en: 'Rate is out of the supported range' },
  rateSetFailed: {
    code: 'network',
    zh: (p: Record<string, string>) => `倍速设置失败：${p.reason}`,
    en: (p: Record<string, string>) => `Rate change failed: ${p.reason}`,
  },
  // ---- 更新（update）----
  inAppUnsupported: {
    code: 'invalid',
    zh: '当前版本不支持站内安装，请到 Release 页手动下载',
    en: 'In-app install is not supported in this version — download from the Release page',
  },
  missingApkAsset: {
    code: 'not_found',
    zh: '该 Release 缺少 Android APK 产物，请到 Release 页下载',
    en: 'This release has no Android APK asset — download from the Release page',
  },
  apkDownloadFailed: {
    code: 'network',
    zh: 'APK 下载失败，请检查网络后重试',
    en: 'APK download failed — check your network and retry',
  },
  checksumDownloadFailed: {
    code: 'network',
    zh: '校验和文件下载失败，请稍后重试',
    en: 'Checksum file download failed — retry later',
  },
  apkChecksumMismatch: {
    code: 'storage',
    zh: 'APK 校验失败，文件可能损坏，已放弃安装',
    en: 'APK checksum mismatch — file may be corrupted, install aborted',
  },
  installerLaunchFailed: {
    code: 'storage',
    zh: '无法拉起安装器，请到 Release 页手动下载',
    en: 'Could not launch the installer — download from the Release page',
  },
  // ---- 归属（dialogue-attribution）----
  attributionDisabled: { code: 'invalid', zh: 'LLM 归属未开启', en: 'LLM attribution is disabled' },
  attributionUnparsable: {
    code: 'invalid',
    zh: 'LLM 归属输出无法解析',
    en: 'LLM attribution output is unparsable',
  },
} as const;

export type ErrorKey = keyof typeof ERRORS;
