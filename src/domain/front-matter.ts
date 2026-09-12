import type { Article } from './article.ts';

export type FrontMatterDocument = { data: Record<string, unknown>; body: string; raw?: string };

function parseScalar(value: string): unknown {
  const trimmed = value.trim();
  if (!trimmed) return '';
  if (trimmed === 'true') return true;
  if (trimmed === 'false') return false;
  if (trimmed === 'null' || trimmed === '~') return null;
  if (/^-?\d+(\.\d+)?$/.test(trimmed)) return Number(trimmed);
  if ((trimmed.startsWith('"') && trimmed.endsWith('"')) || (trimmed.startsWith("'") && trimmed.endsWith("'"))) return trimmed.slice(1, -1);
  if (trimmed.startsWith('[') && trimmed.endsWith(']')) {
    return trimmed.slice(1, -1).split(',').map((x) => x.trim()).filter(Boolean).map((x) => parseScalar(x));
  }
  return trimmed;
}

export class FrontMatterCodec {
  decode(markdown: string): FrontMatterDocument {
    const normalized = markdown.replaceAll('\r\n', '\n');
    if (!normalized.startsWith('---\n')) return { data: {}, body: normalized };
    const end = normalized.indexOf('\n---', 4);
    if (end < 0) return { data: {}, body: normalized };
    const raw = normalized.slice(4, end);
    const body = normalized.slice(end + 4).replace(/^\n+/, '');
    const data: Record<string, unknown> = {};
    for (const line of raw.split('\n')) {
      const separator = line.indexOf(':');
      if (separator <= 0) continue;
      const key = line.slice(0, separator).trim();
      data[key] = parseScalar(line.slice(separator + 1));
    }
    return { data, body, raw };
  }

  encode(data: Record<string, unknown>, body: string): string {
    const lines = Object.entries(data).filter(([, value]) => value !== undefined && value !== null && value !== '').map(([key, value]) => `${key}: ${this.formatValue(value)}`);
    return `---\n${lines.join('\n')}\n---\n\n${body}`;
  }

  formatValue(value: unknown): string {
    if (Array.isArray(value)) return `[${value.map((item) => typeof item === 'string' ? JSON.stringify(item) : String(item)).join(', ')}]`;
    if (typeof value === 'string' && /[:#\[\]{},]/.test(value)) return JSON.stringify(value);
    return String(value);
  }

  fromArticle(article: Article, framework: string, date: string, template?: string): { markdown: string; warnings: string[] } {
    const data: Record<string, unknown> = {
      ...article.metadata.extraFrontMatter,
      title: article.title,
      date,
      tags: article.metadata.tags.length ? article.metadata.tags : undefined,
      categories: article.metadata.categories.length ? article.metadata.categories : undefined,
      cover: article.metadata.cover,
      type: article.metadata.kind,
      templateId: article.metadata.templateId,
      slug: article.metadata.slug,
      volume: article.volume,
      scheduleAt: article.scheduleAt,
      published: article.published,
    };
    const warnings: string[] = [];
    if (template) {
      const rendered = template.split('\n').flatMap((line) => {
        let drop = false;
        const replaced = line.replace(/\{\{\s*([\w.-]+)\s*\}\}/g, (_match, key: string) => {
          if (!(key in data)) { warnings.push(`Unknown template placeholder: ${key}`); drop = true; return ''; }
          const value = data[key];
          if (value === undefined || value === null || value === '') { drop = true; return ''; }
          return Array.isArray(value) ? value.join(', ') : String(value);
        });
        return drop ? [] : [replaced];
      }).join('\n');
      return { markdown: `${rendered.trim()}\n\n${article.body}`, warnings };
    }
    if (framework === 'pelican') {
      const pelican = { Title: article.title, Date: date, Tags: data.tags, Category: article.metadata.categories[0] };
      return { markdown: this.encode(pelican, article.body), warnings };
    }
    return { markdown: this.encode(data, article.body), warnings };
  }
}
