import { DomainError } from '../domain/errors.ts';
import type { GatewayRequestOptions } from './ports.ts';

export type MarkdownStats = { words: number; characters: number; lines: number; headings: number; links: number; codeBlocks: number };
export function markdownStats(markdown: string): MarkdownStats { const text = markdown.replace(/```[\s\S]*?```/g, ''); return { words: (text.match(/[A-Za-z0-9_]+/g) ?? []).length + (text.match(/[\u4e00-\u9fff]/g) ?? []).length, characters: [...text.replace(/\s/g, '')].length, lines: markdown.split(/\r?\n/).length, headings: (markdown.match(/^#{1,6}\s/gm) ?? []).length, links: (markdown.match(/!?\[[^\]]*\]\([^)]*\)/g) ?? []).length, codeBlocks: (markdown.match(/^```/gm) ?? []).length / 2 };
}
export function formatMarkdown(markdown: string): string { return markdown.replaceAll('\r\n', '\n').split('\n').map((line) => line.replace(/[ \t]+$/g, '')).join('\n').replace(/\n{3,}/g, '\n\n').trimEnd() + '\n'; }
export type TableOfContentsEntry = { level: number; text: string; anchor: string };
export function tableOfContents(markdown: string): TableOfContentsEntry[] { const used = new Map<string, number>(); return [...markdown.matchAll(/^(#{1,6})\s+(.+?)\s*#*\s*$/gm)].map((match) => { const level = match[1].length; const text = match[2].trim(); const base = text.toLowerCase().replace(/[^\p{L}\p{N}]+/gu, '-').replace(/^-+|-+$/g, '') || 'section'; const count = (used.get(base) ?? 0) + 1; used.set(base, count); return { level, text, anchor: count === 1 ? base : `${base}-${count}` }; }); }
export function findAndReplace(markdown: string, search: string, replacement: string, options: { caseSensitive?: boolean; wholeWord?: boolean } = {}): string { if (!search) return markdown; const escaped = search.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'); const pattern = options.wholeWord ? `\\b${escaped}\\b` : escaped; return markdown.replace(new RegExp(pattern, options.caseSensitive ? 'g' : 'gi'), replacement); }
export function htmlToMarkdown(html: string): string {
  return html.replace(/<script[\s\S]*?<\/script>|<style[\s\S]*?<\/style>/gi, '').replace(/<h([1-6])[^>]*>(.*?)<\/h\1>/gis, (_m, level, text) => `${'#'.repeat(Number(level))} ${text}\n\n`).replace(/<li[^>]*>(.*?)<\/li>/gis, '- $1\n').replace(/<br\s*\/?>(?=.)/gi, '\n').replace(/<\/p>/gi, '\n\n').replace(/<[^>]+>/g, '').replace(/&nbsp;/g, ' ').replace(/&amp;/g, '&').replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&quot;/g, '"').trim();
}

export function markdownToHtml(markdown: string): string {
  const lines = formatMarkdown(markdown).trim().split('\n');
  const blocks: string[] = [];
  const headingAnchors = new Map<string, number>();
  let index = 0;
  while (index < lines.length) {
    if (!lines[index].trim()) { index++; continue; }
    const fence = /^```([\w-]*)\s*$/.exec(lines[index]);
    if (fence) {
      const language = fence[1].toLowerCase();
      const body: string[] = [];
      index++;
      while (index < lines.length && !/^```\s*$/.test(lines[index])) body.push(lines[index++]);
      if (index < lines.length) index++;
      if (language === 'mermaid') blocks.push(`<pre class="mermaid">${escapeHtml(body.join('\n'))}</pre>`);
      else blocks.push(`<pre><code${language ? ` class="language-${escapeAttr(language)}"` : ''}>${escapeHtml(body.join('\n'))}</code></pre>`);
      continue;
    }
    const heading = /^(#{1,6})\s+(.+?)\s*#*$/.exec(lines[index]);
    if (heading) { const anchor = headingAnchor(heading[2], headingAnchors); blocks.push(`<h${heading[1].length} id="${escapeAttr(anchor)}">${inlineMarkdown(heading[2])}</h${heading[1].length}>`); index++; continue; }
    if (/^\s*\|/.test(lines[index]) && index + 1 < lines.length && /^\s*\|?\s*:?-{3,}/.test(lines[index + 1])) {
      const rows: string[][] = [];
      let firstRow = true;
      while (index < lines.length && /^\s*\|/.test(lines[index])) {
        rows.push(tableCells(lines[index++]));
        if (firstRow) { firstRow = false; if (index < lines.length && /^\s*\|?\s*:?-{3,}/.test(lines[index])) index++; }
      }
      if (rows.length) blocks.push(`<table><thead><tr>${rows[0].map((cell) => `<th>${inlineMarkdown(cell)}</th>`).join('')}</tr></thead><tbody>${rows.slice(1).map((row) => `<tr>${row.map((cell) => `<td>${inlineMarkdown(cell)}</td>`).join('')}</tr>`).join('')}</tbody></table>`);
      continue;
    }
    if (/^\s*[-*+]\s+/.test(lines[index])) {
      const items: string[] = [];
      while (index < lines.length && /^\s*[-*+]\s+/.test(lines[index])) items.push(`<li>${inlineMarkdown(lines[index++].replace(/^\s*[-*+]\s+/, ''))}</li>`);
      blocks.push(`<ul>${items.join('')}</ul>`); continue;
    }
    if (/^\s*\d+[.)]\s+/.test(lines[index])) {
      const items: string[] = [];
      while (index < lines.length && /^\s*\d+[.)]\s+/.test(lines[index])) items.push(`<li>${inlineMarkdown(lines[index++].replace(/^\s*\d+[.)]\s+/, ''))}</li>`);
      blocks.push(`<ol>${items.join('')}</ol>`); continue;
    }
    if (/^>\s?/.test(lines[index])) {
      const quote: string[] = [];
      while (index < lines.length && /^>\s?/.test(lines[index])) quote.push(inlineMarkdown(lines[index++].replace(/^>\s?/, '')));
      blocks.push(`<blockquote>${quote.join('<br>')}</blockquote>`); continue;
    }
    if (/^\$\$/.test(lines[index])) {
      const math: string[] = [lines[index++].replace(/^\$\$\s?/, '')];
      while (index < lines.length && !/\$\$\s*$/.test(lines[index])) math.push(lines[index++]);
      if (index < lines.length) math.push(lines[index++].replace(/\s*\$\$$/, ''));
      blocks.push(`<div class="math-block" data-math="${escapeAttr(math.join('\n'))}">${escapeHtml(math.join('\n'))}</div>`); continue;
    }
    const paragraph: string[] = [];
    while (index < lines.length && lines[index].trim() && !/^```/.test(lines[index]) && !/^(#{1,6})\s+/.test(lines[index])) paragraph.push(lines[index++]);
    blocks.push(`<p>${paragraph.map(inlineMarkdown).join('<br>')}</p>`);
  }
  return blocks.join('');
}

function tableCells(line: string): string[] { return line.trim().replace(/^\|/, '').replace(/\|$/, '').split('|').map((cell) => cell.trim()); }
function headingAnchor(text: string, used: Map<string, number>): string { const base = text.trim().replace(/\s*#+\s*$/, '').toLowerCase().replace(/[^\p{L}\p{N}]+/gu, '-').replace(/^-+|-+$/g, '') || 'section'; const count = (used.get(base) ?? 0) + 1; used.set(base, count); return count === 1 ? base : `${base}-${count}`; }
function inlineMarkdown(value: string): string {
  const code: string[] = [];
  let escaped = value.replace(/`([^`]+)`/g, (_match, text) => { const token = `\u0000${code.length}\u0000`; code.push(`<code>${escapeHtml(text)}</code>`); return token; });
  escaped = escapeHtml(escaped).replace(/(!?)(\[[^\]]*\])\(([^)\s]+)(?:\s+["']([^"']*)["'])?\)/g, (_match, marker, label, url, title) => { const image = marker === '!'; const text = label.slice(1, -1); const safe = safeUrl(url); return image ? `<img src="${escapeAttr(safe)}" alt="${escapeAttr(text)}">` : `<a href="${escapeAttr(safe)}"${title ? ` title="${escapeAttr(title)}"` : ''} rel="noreferrer noopener">${escapeHtml(text)}</a>`; }).replace(/\*\*([^*]+)\*\*/g, '<strong>$1</strong>').replace(/__([^_]+)__/g, '<strong>$1</strong>').replace(/(?<!\*)\*([^*]+)\*(?!\*)/g, '<em>$1</em>').replace(/(?<!_)_([^_]+)_(?!_)/g, '<em>$1</em>');
  return escaped.replace(/\u0000(\d+)\u0000/g, (_match, number) => code[Number(number)] ?? '');
}
function safeUrl(value: string): string { try { const url = new URL(value, 'https://tuomo.invalid'); if (url.protocol !== 'http:' && url.protocol !== 'https:' && url.protocol !== 'mailto:' && !value.startsWith('#')) return '#'; return value; } catch { return '#'; } }
function escapeAttr(value: string): string { return escapeHtml(value).replaceAll('"', '&quot;').replaceAll("'", '&#39;'); }
function escapeHtml(value: string): string { return value.replaceAll('&', '&amp;').replaceAll('<', '&lt;').replaceAll('>', '&gt;').replaceAll('"', '&quot;'); }

export type LinkResult = { url: string; ok: boolean; status?: number; error?: string };
export type LinkCheckOptions = { concurrency?: number; signal?: AbortSignal; onProgress?: (result: LinkResult, completed: number, total: number) => void };
export type LinkCheckDetailedResult = { results: LinkResult[]; cancelled: boolean };
export async function checkLinks(markdown: string, probe: (url: string, signal?: AbortSignal) => Promise<{ ok: boolean; status?: number }>, concurrencyOrOptions: number | LinkCheckOptions = 4): Promise<LinkResult[]> {
  return (await checkLinksDetailed(markdown, probe, typeof concurrencyOrOptions === 'number' ? { concurrency: concurrencyOrOptions } : concurrencyOrOptions)).results;
}
export async function checkLinksDetailed(markdown: string, probe: (url: string, signal?: AbortSignal) => Promise<{ ok: boolean; status?: number }>, options: LinkCheckOptions = {}): Promise<LinkCheckDetailedResult> {
  const urls = [...new Set([...markdown.matchAll(/https?:\/\/[^\s)\]">]+/g)].map((match) => match[0]))];
  if (options.signal?.aborted) return { results: [], cancelled: true };
  const results: Array<LinkResult | undefined> = new Array(urls.length); let next = 0; let cancelled = false;
  const consume = async (): Promise<void> => {
    while (true) {
      if (options.signal?.aborted) { cancelled = true; return; }
      const index = next++;
      if (index >= urls.length) return;
      try { results[index] = { url: urls[index], ...(await probe(urls[index], options.signal)) }; }
      catch (error) { results[index] = { url: urls[index], ok: false, error: error instanceof Error ? error.message : String(error) }; }
      const completed = results.filter((result): result is LinkResult => result !== undefined).length;
      options.onProgress?.(results[index]!, completed, urls.length);
    }
  };
  const concurrency = Math.min(Math.max(1, options.concurrency ?? 4), 4, Math.max(1, urls.length));
  await Promise.all(Array.from({ length: concurrency }, consume));
  return { results: results.filter((result): result is LinkResult => result !== undefined), cancelled };
}
export function replaceLinks(markdown: string, replacements: Record<string, string>): string { return markdown.replace(/https?:\/\/[^\s)\]">]+/g, (url) => replacements[url] ?? url); }

export type RssItem = { title: string; link?: string; description?: string; publishedAt?: string; guid?: string };
export class RssFeedService {
  private readonly fetchText: (url: string, options?: GatewayRequestOptions) => Promise<string>;
  constructor(fetchText: (url: string, options?: GatewayRequestOptions) => Promise<string>) { this.fetchText = fetchText; }
  async refresh(url: string, options: GatewayRequestOptions = {}): Promise<RssItem[]> { const xml = await this.fetchText(url, options); return [...xml.matchAll(/<(item|entry)\b[\s\S]*?<\/(item|entry)>/gi)].map((match) => { const block = match[0]; const value = (tag: string) => { const found = new RegExp(`<${tag}[^>]*>([\\s\\S]*?)<\\/${tag}>`, 'i').exec(block); return found?.[1]?.replace(/<!\[CDATA\[|\]\]>/g, '').trim(); }; return { title: value('title') ?? '', link: value('link') ?? block.match(/<link[^>]+href=["']([^"']+)/i)?.[1], description: value('description') ?? value('summary'), publishedAt: value('pubDate') ?? value('published') ?? value('updated'), guid: value('guid') ?? value('id') }; }).filter((item) => item.title); }
}

export type ImageUploadResult = { markdownUrl: string; remoteId?: string };
export interface ImageHostGateway { upload(bytes: Uint8Array, filename: string, mimeType: string, options?: GatewayRequestOptions): Promise<ImageUploadResult>; }
export type ImageProcess = (bytes: Uint8Array, filename: string) => Promise<{ bytes: Uint8Array; filename: string; mimeType: string }>;
export class ImageHostUseCase {
  private readonly gateway: ImageHostGateway;
  private readonly process: ImageProcess;
  constructor(gateway: ImageHostGateway, process: ImageProcess = async (bytes, filename) => ({ bytes, filename, mimeType: 'application/octet-stream' })) { this.gateway = gateway; this.process = process; }
  async execute(bytes: Uint8Array, filename: string, mimeType: string, options: GatewayRequestOptions = {}): Promise<{ ok: boolean; result?: ImageUploadResult; retry: { bytes: Uint8Array; filename: string; mimeType: string }; error?: string }> { const retry = await this.process(bytes, filename); try { return { ok: true, result: await this.gateway.upload(retry.bytes, retry.filename, retry.mimeType, options), retry }; } catch (error) { return { ok: false, retry, error: error instanceof Error ? error.message : String(error) }; }
  }
}

export type BatchUploadResult = { path: string; method: 'git-data' | 'contents' | 'cli' | 'failed'; error?: string };
export type BatchUploadOptions = { concurrency?: number; signal?: AbortSignal; onProgress?: (result: BatchUploadResult, completed: number, total: number) => void };
export type BatchUploadDetailedResult = { results: BatchUploadResult[]; cancelled: boolean };
export class BatchUploadUseCase {
  private readonly gitData: (files: Record<string, Uint8Array>) => Promise<void>;
  private readonly contents: (path: string, data: Uint8Array) => Promise<void>;
  private readonly cli: (path: string, data: Uint8Array) => Promise<void>;
  constructor(gitData: (files: Record<string, Uint8Array>) => Promise<void>, contents: (path: string, data: Uint8Array) => Promise<void>, cli: (path: string, data: Uint8Array) => Promise<void>) { this.gitData = gitData; this.contents = contents; this.cli = cli; }
  async execute(files: Record<string, Uint8Array>, options: BatchUploadOptions = {}): Promise<BatchUploadResult[]> { return (await this.executeDetailed(files, options)).results; }
  async executeDetailed(files: Record<string, Uint8Array>, options: BatchUploadOptions = {}): Promise<BatchUploadDetailedResult> {
    const entries = Object.entries(files);
    if (!entries.length) return { results: [], cancelled: false };
    if (options.signal?.aborted) return { results: [], cancelled: true };
    try {
      await this.gitData(files);
      const results = entries.map(([path]) => ({ path, method: 'git-data' as const }));
      results.forEach((result, index) => options.onProgress?.(result, index + 1, entries.length));
      return { results, cancelled: false };
    } catch {
      // Fall through to the documented per-file Contents → CLI chain.
    }
    const results: BatchUploadResult[] = [];
    let next = 0; let cancelled = false;
    const consume = async (): Promise<void> => {
      while (true) {
        if (options.signal?.aborted) { cancelled = true; return; }
        const index = next++;
        if (index >= entries.length) return;
        const [path, data] = entries[index];
        let result: BatchUploadResult;
        try { await this.contents(path, data); result = { path, method: 'contents' }; }
        catch {
          try { await this.cli(path, data); result = { path, method: 'cli' }; }
          catch (error) { result = { path, method: 'failed', error: error instanceof Error ? error.message : String(error) }; }
        }
        results[index] = result;
        options.onProgress?.(result, results.filter(Boolean).length, entries.length);
      }
    };
    const concurrency = Math.min(Math.max(1, options.concurrency ?? 4), entries.length);
    await Promise.all(Array.from({ length: concurrency }, consume));
    return { results: results.filter((result): result is BatchUploadResult => result !== undefined), cancelled };
  }
}

export function repairUtf8(bytes: Uint8Array, encoding: 'utf-8' | 'gb18030' = 'utf-8'): string { try { return new TextDecoder(encoding, { fatal: true }).decode(bytes); } catch (error) { throw new DomainError('validation', `Unable to decode input as ${encoding}`, { cause: error instanceof Error ? error.message : String(error) }); } }

export type SpellIssue = { word: string; start: number; end: number; suggestions: string[] };
export function spellCheck(markdown: string, dictionary: ReadonlySet<string>, options: { maxSuggestions?: number; maxDistance?: number } = {}): SpellIssue[] {
  const masked = markdown.replace(/```[\s\S]*?```|`[^`]*`|https?:\/\/[^\s)]+/g, (value) => ' '.repeat(value.length));
  const words = [...masked.matchAll(/\b[A-Za-z][A-Za-z'-]{1,}\b/g)];
  const normalized = new Set([...dictionary].map((word) => word.toLowerCase()));
  const maxSuggestions = options.maxSuggestions ?? 3;
  const maxDistance = options.maxDistance ?? 2;
  return words.flatMap((match) => {
    const word = match[0];
    if (normalized.has(word.toLowerCase())) return [];
    const suggestions = [...normalized]
      .filter((candidate) => Math.abs(candidate.length - word.length) <= maxDistance)
      .map((candidate) => ({ candidate, distance: editDistance(word.toLowerCase(), candidate) }))
      .filter((item) => item.distance <= maxDistance)
      .sort((left, right) => left.distance - right.distance || left.candidate.localeCompare(right.candidate))
      .slice(0, maxSuggestions)
      .map((item) => item.candidate);
    return [{ word, start: match.index ?? 0, end: (match.index ?? 0) + word.length, suggestions }];
  });
}
function editDistance(left: string, right: string): number {
  const previous = Array.from({ length: right.length + 1 }, (_, index) => index);
  for (let row = 1; row <= left.length; row++) {
    let diagonal = previous[0]; previous[0] = row;
    for (let column = 1; column <= right.length; column++) {
      const above = previous[column];
      previous[column] = left[row - 1] === right[column - 1] ? diagonal : 1 + Math.min(above, previous[column - 1], diagonal);
      diagonal = above;
    }
  }
  return previous[right.length];
}

export type UserPreferences = { mode: 'simple' | 'standard'; pinned: string[]; hidden: string[]; theme: string; editorTheme: string; nightMode: boolean; language?: 'zh-CN' | 'en-US'; proxyUrl?: string };
export class PreferencesStore {
  private preferences: UserPreferences;
  constructor(initial: Partial<UserPreferences> = {}) { this.preferences = { mode: 'simple', pinned: [], hidden: [], theme: 'system', editorTheme: 'default', nightMode: false, language: 'zh-CN', proxyUrl: '', ...initial }; }
  get(): UserPreferences { return structuredClone(this.preferences); }
  update(patch: Partial<UserPreferences>): UserPreferences { this.preferences = { ...this.preferences, ...patch, pinned: [...new Set(patch.pinned ?? this.preferences.pinned)], hidden: [...new Set(patch.hidden ?? this.preferences.hidden)] }; return this.get(); }
}
