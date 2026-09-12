import { deflateSync } from 'node:zlib';
import { DomainError } from '../domain/errors.ts';
import type { Article } from '../domain/article.ts';
import { FrontMatterCodec } from '../domain/front-matter.ts';
import { createZip } from '../infrastructure/zip.ts';
import { markdownToHtml } from './content-tools.ts';

export type ExportFormat = 'markdown' | 'html' | 'pdf' | 'docx' | 'epub' | 'png';
export type ExportedDocument = { format: ExportFormat; filename: string; mimeType: string; bytes: Uint8Array };

function xmlEscape(value: string): string { return value.replaceAll('&', '&amp;').replaceAll('<', '&lt;').replaceAll('>', '&gt;').replaceAll('"', '&quot;'); }
function safeName(title: string): string { return (title || 'untitled').replace(/[\\/:*?"<>|#%]+/g, '-').replace(/\s+/g, '-').slice(0, 80) || 'untitled'; }

function createPdf(title: string, body: string): Uint8Array {
  const text = (`${title}\n\n${body}`).replaceAll('\\', '\\\\').replaceAll('(', '\\(').replaceAll(')', '\\)').replace(/[^\x20-\x7e\n]/g, '?'); const stream = `BT /F1 12 Tf 50 780 Td (${text.replaceAll('\n', ') Tj 0 -16 Td (')}) Tj ET`;
  const objects = [`1 0 obj<< /Type /Catalog /Pages 2 0 R >>endobj\n`, `2 0 obj<< /Type /Pages /Kids [3 0 R] /Count 1 >>endobj\n`, `3 0 obj<< /Type /Page /Parent 2 0 R /MediaBox [0 0 612 792] /Resources << /Font << /F1 4 0 R >> >> /Contents 5 0 R >>endobj\n`, `4 0 obj<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>endobj\n`, `5 0 obj<< /Length ${Buffer.byteLength(stream)} >>stream\n${stream}\nendstream\nendobj\n`]; let output = '%PDF-1.4\n'; const offsets = [0]; for (const object of objects) { offsets.push(Buffer.byteLength(output)); output += object; } const xref = Buffer.byteLength(output); output += `xref\n0 ${objects.length + 1}\n0000000000 65535 f \n${offsets.slice(1).map((offset) => `${String(offset).padStart(10, '0')} 00000 n \n`).join('')}trailer<< /Size ${objects.length + 1} /Root 1 0 R >>\nstartxref\n${xref}\n%%EOF`; return Buffer.from(output, 'utf8');
}

function createPng(title: string, body: string): Uint8Array {
  const width = 800; const lines = `${title}\n${body}`.split(/\r?\n/); const height = Math.max(1, Math.min(4000, lines.length * 12 + 20)); const raw = Buffer.alloc((width * 4 + 1) * height); for (let y = 0; y < height; y++) { raw[y * (width * 4 + 1)] = 0; for (let x = 0; x < width; x++) { const i = y * (width * 4 + 1) + 1 + x * 4; raw[i] = raw[i + 1] = raw[i + 2] = 255; raw[i + 3] = 255; } const line = lines[Math.floor(Math.max(0, y - 10) / 12)] ?? ''; if (y >= 10 && y % 12 < 8) for (let x = 10; x < Math.min(width - 10, 10 + line.length * 8); x++) { const i = y * (width * 4 + 1) + 1 + x * 4; raw[i] = raw[i + 1] = raw[i + 2] = 20; } }
  const chunk = (type: string, data: Uint8Array) => { const typeBytes = Buffer.from(type); const crcData = Buffer.concat([typeBytes, Buffer.from(data)]); const crc = pngCrc32(crcData); const value = Buffer.alloc(4); value.writeUInt32BE(data.length, 0); const crcBuffer = Buffer.alloc(4); crcBuffer.writeUInt32BE(crc, 0); return Buffer.concat([value, typeBytes, Buffer.from(data), crcBuffer]); };
  const header = Buffer.from([137,80,78,71,13,10,26,10]); const ihdr = Buffer.alloc(13); ihdr.writeUInt32BE(width, 0); ihdr.writeUInt32BE(height, 4); ihdr[8] = 8; ihdr[9] = 6; return Buffer.concat([header, chunk('IHDR', ihdr), chunk('IDAT', deflateSync(raw)), chunk('IEND', Buffer.alloc(0))]);
}
function pngCrc32(data: Uint8Array): number { let crc = 0xffffffff; for (const byte of data) { crc ^= byte; for (let bit = 0; bit < 8; bit++) crc = (crc >>> 1) ^ (0xedb88320 & -(crc & 1)); } return (crc ^ 0xffffffff) >>> 0; }

export function exportArticle(article: Article, format: ExportFormat): ExportedDocument {
  const name = safeName(article.title); const markdown = `# ${article.title}\n\n${article.body}\n`;
  const frontMatter = new FrontMatterCodec().encode({ ...article.metadata.extraFrontMatter, title: article.title, tags: article.metadata.tags.length ? article.metadata.tags : undefined, categories: article.metadata.categories.length ? article.metadata.categories : undefined, cover: article.metadata.cover, type: article.metadata.kind, templateId: article.metadata.templateId, slug: article.metadata.slug, volume: article.volume, scheduleAt: article.scheduleAt, published: article.published }, article.body);
  if (format === 'markdown') return { format, filename: `${name}.md`, mimeType: 'text/markdown', bytes: Buffer.from(frontMatter) };
  if (format === 'html') return { format, filename: `${name}.html`, mimeType: 'text/html', bytes: Buffer.from(`<!doctype html><meta charset="utf-8"><title>${xmlEscape(article.title)}</title><article>${markdownToHtml(article.body)}</article>`) };
  if (format === 'pdf') return { format, filename: `${name}.pdf`, mimeType: 'application/pdf', bytes: createPdf(article.title, article.body) };
  if (format === 'png') return { format, filename: `${name}.png`, mimeType: 'image/png', bytes: createPng(article.title, article.body) };
  if (format === 'docx') { const document = `<?xml version="1.0" encoding="UTF-8"?><w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main"><w:body>${markdown.split(/\r?\n/).map((line) => `<w:p><w:r><w:t xml:space="preserve">${xmlEscape(line)}</w:t></w:r></w:p>`).join('')}</w:body></w:document>`; return { format, filename: `${name}.docx`, mimeType: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document', bytes: createZip([{ name: '[Content_Types].xml', data: '<?xml version="1.0"?><Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="xml" ContentType="application/xml"/><Override PartName="/word/document.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml"/></Types>' }, { name: '_rels/.rels', data: '<?xml version="1.0"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="word/document.xml"/></Relationships>' }, { name: 'word/document.xml', data: document, compress: true }]) }; }
  if (format === 'epub') { const chapter = `<?xml version="1.0" encoding="UTF-8"?><html xmlns="http://www.w3.org/1999/xhtml"><head><title>${xmlEscape(article.title)}</title></head><body><h1>${xmlEscape(article.title)}</h1>${markdownToHtml(article.body)}</body></html>`; return { format, filename: `${name}.epub`, mimeType: 'application/epub+zip', bytes: createZip([{ name: 'mimetype', data: 'application/epub+zip' }, { name: 'META-INF/container.xml', data: '<?xml version="1.0"?><container version="1.0" xmlns="urn:oasis:names:tc:opendocument:xmlns:container"><rootfiles><rootfile full-path="OEBPS/chapter.xhtml" media-type="application/xhtml+xml"/></rootfiles></container>' }, { name: 'OEBPS/chapter.xhtml', data: chapter }]) }; }
  throw new DomainError('unsupported', `Unsupported export format: ${format}`);
}
