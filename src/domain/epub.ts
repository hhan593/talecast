/**
 * EPUB 解析（docs/design/2026-11-19-phase2-plan.md §4）：
 * EPUB = ZIP 容器（META-INF/container.xml → OPF → spine 顺序 XHTML）。
 * 纯函数 + 依赖注入（unzip/解析器经参数传入），Node 与 RN 行为一致、可测。
 * XHTML 去标签保留章节文本与 <h1-6>/<title> 标题；产物走现有导入管线
 * （title + fullText → 正则分章候选兜底）。
 */

export interface EpubChapter {
  title: string;
  /** 纯文本（段落数组 join('\n')） */
  text: string;
}

export interface EpubParseResult {
  bookTitle: string;
  chapters: EpubChapter[];
}

/** XHTML/HTML 去标签：块级标签转换行，实体还原（最小集） */
export function stripHtml(html: string): string {
  return html
    .replace(/<\s*(script|style)[^>]*>[\s\S]*?<\s*\/\s*\1\s*>/gi, '')
    .replace(/<\s*br\s*\/?>/gi, '\n')
    .replace(/<\s*\/\s*(p|div|h[1-6]|li|tr)\s*>/gi, '\n')
    .replace(/<[^>]+>/g, '')
    .replace(/&nbsp;/g, ' ')
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&#(\d+);/g, (_, code) => String.fromCodePoint(Number(code)))
    .replace(/[ \t]+/g, ' ');
}

/** 从 container.xml 提取 OPF 路径 */
export function opfPathFromContainer(containerXml: string): string | null {
  const m = /full-path="([^"]+)"/.exec(containerXml);
  return m ? m[1] : null;
}

/** 从 OPF 提取书名与 spine 文件列表（顺序 = 阅读顺序） */
export function parseOpf(
  opfXml: string,
): { bookTitle: string; spineFiles: string[] } | null {
  const titleMatch = /<[^>]*?dc:title[^>]*>([^<]+)<\/[^>]*dc:title>/i.exec(opfXml);
  if (!titleMatch) return null;
  const idToHref = new Map<string, string>();
  const itemRe = /<item\b[^>]*>/g;
  for (const itemTag of opfXml.match(itemRe) ?? []) {
    const id = /id="([^"]+)"/.exec(itemTag)?.[1];
    const href = /href="([^"]+)"/.exec(itemTag)?.[1];
    if (id && href) idToHref.set(id, href);
  }
  const spineRe = /<itemref\b[^>]*idref="([^"]+)"[^>]*>/g;
  const spineFiles: string[] = [];
  for (const m of opfXml.match(spineRe) ?? []) {
    const idref = /idref="([^"]+)"/.exec(m)?.[1];
    const href = idref ? idToHref.get(idref) : undefined;
    if (href) spineFiles.push(href);
  }
  if (spineFiles.length === 0) return null;
  return { bookTitle: titleMatch[1].trim(), spineFiles };
}

/** 目录路径解析：相对 OPF 目录拼接（URL 归一化简化版） */
export function resolveRelative(opfDir: string, href: string): string {
  const clean = href.split('#')[0];
  if (clean.startsWith('/')) return clean.slice(1);
  let dir = opfDir;
  let rel = clean;
  while (rel.startsWith('../')) {
    const idx = dir.lastIndexOf('/');
    if (idx === -1) break;
    dir = dir.slice(0, idx);
    rel = rel.slice(3);
  }
  return dir ? `${dir}/${rel}` : rel;
}

export interface EpubDeps {
  /** 解压入口（适配 jszip）：路径 → 内容（utf8） */
  readFile: (path: string) => Promise<string>;
  /** 路径存在性（可选） */
  exists: (path: string) => Promise<boolean>;
}

/** EPUB → 结构化文本（书名 + 章节文本数组）；解析失败抛出带原因的错误 */
export async function parseEpub(deps: EpubDeps, epubBytes: Uint8Array): Promise<EpubParseResult> {
  const containerXml = await deps.readFile('META-INF/container.xml');
  const opfPath = opfPathFromContainer(containerXml);
  if (!opfPath) throw new Error('container.xml 缺少 OPF 路径');
  const opfDir = opfPath.includes('/') ? opfPath.slice(0, opfPath.lastIndexOf('/')) : '';
  const opfXml = await deps.readFile(opfPath);
  const opf = parseOpf(opfXml);
  if (!opf) throw new Error('OPF 解析失败：缺少标题或 spine');

  const chapters: EpubChapter[] = [];
  for (const href of opf.spineFiles) {
    const path = resolveRelative(opfDir, href);
    const html = await deps.readFile(path);
    const text = stripHtml(html)
      .split('\n')
      .map((line) => line.trim())
      .filter((line) => line.length > 0)
      .join('\n');
    if (text.length === 0) continue;
    const titleMatch = /<h[1-6][^>]*>([\s\S]*?)<\/h[1-6]>/i.exec(html);
    const rawTitle = titleMatch ? stripHtml(titleMatch[1]).trim() : '';
    chapters.push({ title: rawTitle.length > 0 ? rawTitle : text.slice(0, 12), text });
  }
  if (chapters.length === 0) throw new Error('EPUB 内没有可提取的文本内容');
  return { bookTitle: opf.bookTitle, chapters };
}
