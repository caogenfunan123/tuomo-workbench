import { DomainError } from '../domain/errors.ts';
import { createArticle, normalizeList } from '../domain/article.ts';
import { FrontMatterCodec } from '../domain/front-matter.ts';
import { readZipEntry } from '../infrastructure/zip.ts';
import { htmlToMarkdown } from './content-tools.ts';

export type ImportFormat = 'markdown' | 'html' | 'docx';
export function importArticle(input: { format: ImportFormat; filename: string; bytes: Uint8Array }): ReturnType<typeof createArticle> {
  let text = new TextDecoder('utf-8').decode(input.bytes); let title = input.filename.replace(/\.[^.]+$/, ''); let body = text;
  let metadata: Parameters<typeof createArticle>[0]['metadata'];
  let frontMatter: ReturnType<FrontMatterCodec['decode']> | undefined;
  if (input.format === 'markdown') {
    const decoded = new FrontMatterCodec().decode(text);
    frontMatter = decoded;
    title = String(decoded.data.title ?? title);
    body = decoded.body;
    const kind = decoded.data.kind === 'page' || decoded.data.type === 'page' ? 'page' : 'post';
    const known = new Set(['title', 'date', 'tags', 'categories', 'cover', 'type', 'kind', 'slug', 'template', 'templateId', 'volume', 'scheduleAt', 'published']);
    metadata = { tags: normalizeList(asStringList(decoded.data.tags)), categories: normalizeList(asStringList(decoded.data.categories)), cover: typeof decoded.data.cover === 'string' ? decoded.data.cover : undefined, kind, templateId: typeof decoded.data.templateId === 'string' ? decoded.data.templateId : typeof decoded.data.template === 'string' ? decoded.data.template : undefined, slug: typeof decoded.data.slug === 'string' ? decoded.data.slug : undefined, extraFrontMatter: Object.fromEntries(Object.entries(decoded.data).filter(([key]) => !known.has(key))) };
  }
  else if (input.format === 'html') { const titleMatch = /<title[^>]*>([\s\S]*?)<\/title>/i.exec(text); title = titleMatch?.[1]?.trim() || title; body = htmlToMarkdown(text.replace(/<head>[\s\S]*?<\/head>/i, '')); }
  else if (input.format === 'docx') {
    if (!text.includes('<w:document')) { const xml = readZipEntry(input.bytes, 'word/document.xml'); if (!xml) throw new DomainError('unsupported', 'DOCX archive does not contain word/document.xml'); text = new TextDecoder('utf-8').decode(xml); }
    const paragraphs = [...text.matchAll(/<w:p\b[\s\S]*?<\/w:p>/gi)].map((paragraph) => [...paragraph[0].matchAll(/<w:t\b[^>]*>([\s\S]*?)<\/w:t>/gi)].map((match) => decodeXml(match[1])).join('')).filter(Boolean);
    body = paragraphs.length ? paragraphs.join('\n\n') : decodeXml(text.replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim());
  }
  return createArticle({
    title: title.trim() || 'Imported document',
    body,
    metadata,
    volume: typeof frontMatter?.data.volume === 'string' ? frontMatter.data.volume : undefined,
    scheduleAt: typeof frontMatter?.data.scheduleAt === 'string' ? frontMatter.data.scheduleAt : undefined,
    published: frontMatter?.data.published === true,
  });
}

function asStringList(value: unknown): string[] { return Array.isArray(value) ? value.map(String) : typeof value === 'string' ? value.split(',') : []; }

function decodeXml(value: string): string {
  return value.replace(/&#(\d+);/g, (_match, code) => String.fromCodePoint(Number(code))).replace(/&#x([0-9a-f]+);/gi, (_match, code) => String.fromCodePoint(Number.parseInt(code, 16))).replaceAll('&quot;', '"').replaceAll('&apos;', "'").replaceAll('&amp;', '&').replaceAll('&lt;', '<').replaceAll('&gt;', '>');
}
