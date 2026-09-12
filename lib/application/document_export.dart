import 'dart:convert';
import 'dart:math' as math;

import 'package:archive/archive.dart';

import '../domain/article.dart';
import '../domain/front_matter_codec.dart';

enum DocumentExportFormat { markdown, html, pdf, docx, epub, png }

class ExportedDocument {
  const ExportedDocument(
      {required this.filename, required this.mimeType, required this.bytes});

  final String filename;
  final String mimeType;
  final List<int> bytes;
}

ExportedDocument exportDocument(Article article, DocumentExportFormat format) {
  final String name = _safeName(article.title);
  final String markdown = const FrontMatterCodec()
      .fromArticle(article, date: article.updatedAt.toIso8601String());
  return switch (format) {
    DocumentExportFormat.markdown => ExportedDocument(
        filename: '$name.md',
        mimeType: 'text/markdown',
        bytes: utf8.encode(markdown)),
    DocumentExportFormat.html => ExportedDocument(
        filename: '$name.html',
        mimeType: 'text/html',
        bytes: utf8.encode(_htmlDocument(article))),
    DocumentExportFormat.pdf => ExportedDocument(
        filename: '$name.pdf',
        mimeType: 'application/pdf',
        bytes: _pdfBytes(article)),
    DocumentExportFormat.docx => ExportedDocument(
        filename: '$name.docx',
        mimeType:
            'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
        bytes: _docxBytes(article)),
    DocumentExportFormat.epub => ExportedDocument(
        filename: '$name.epub',
        mimeType: 'application/epub+zip',
        bytes: _epubBytes(article)),
    DocumentExportFormat.png => ExportedDocument(
        filename: '$name.png',
        mimeType: 'image/png',
        bytes: _pngBytes(article)),
  };
}

String _safeName(String title) {
  final String normalized = (title.isEmpty ? 'untitled' : title)
      .replaceAll(RegExp(r'[\\/:*?"<>|#%]+'), '-')
      .replaceAll(RegExp(r'\s+'), '-');
  final String value = normalized.substring(0, normalized.length.clamp(1, 80));
  return value.isEmpty ? 'untitled' : value;
}

String _htmlDocument(Article article) =>
    '<!doctype html><meta charset="utf-8"><title>${_escape(article.title)}</title><article>${_markdownToHtml(article.body)}</article>';

String _markdownToHtml(String markdown) {
  final List<String> lines = markdown.replaceAll('\r\n', '\n').split('\n');
  final List<String> blocks = <String>[];
  int index = 0;
  while (index < lines.length) {
    if (lines[index].trim().isEmpty) {
      index++;
      continue;
    }
    final RegExpMatch? fence = RegExp(r'^```(.*)$').firstMatch(lines[index]);
    if (fence != null) {
      final String language = fence.group(1)?.trim() ?? '';
      final List<String> code = <String>[];
      index++;
      while (
          index < lines.length && !RegExp(r'^```\s*$').hasMatch(lines[index])) {
        code.add(lines[index]);
        index++;
      }
      if (index < lines.length) index++;
      blocks.add(
          '<pre><code${language.isEmpty ? '' : ' class="language-${_escapeAttribute(language)}"'}>${_escape(code.join('\n'))}</code></pre>');
      continue;
    }
    final RegExpMatch? heading =
        RegExp(r'^(#{1,6})\s+(.+?)\s*#*$').firstMatch(lines[index]);
    if (heading != null) {
      final int level = heading.group(1)!.length;
      blocks.add('<h$level>${_inlineHtml(heading.group(2)!)}</h$level>');
      index++;
      continue;
    }
    if (RegExp(r'^\s*[-*+]\s+').hasMatch(lines[index])) {
      final List<String> items = <String>[];
      while (index < lines.length &&
          RegExp(r'^\s*[-*+]\s+').hasMatch(lines[index])) {
        items.add(
            '<li>${_inlineHtml(lines[index].replaceFirst(RegExp(r'^\s*[-*+]\s+'), ''))}</li>');
        index++;
      }
      blocks.add('<ul>${items.join()}</ul>');
      continue;
    }
    if (lines[index].trimLeft().startsWith('>')) {
      final List<String> quote = <String>[];
      while (index < lines.length && lines[index].trimLeft().startsWith('>')) {
        quote.add(lines[index].replaceFirst(RegExp(r'^\s*>\s?'), ''));
        index++;
      }
      blocks.add(
          '<blockquote>${quote.map(_inlineHtml).join('<br>')}</blockquote>');
      continue;
    }
    final List<String> paragraph = <String>[lines[index++]];
    while (index < lines.length &&
        lines[index].trim().isNotEmpty &&
        !RegExp(r'^```|^(#{1,6})\s+|^\s*[-*+]\s+|^\s*>')
            .hasMatch(lines[index])) {
      paragraph.add(lines[index++]);
    }
    blocks.add('<p>${paragraph.map(_inlineHtml).join('<br>')}</p>');
  }
  return blocks.join();
}

String _inlineHtml(String value) => _escape(value)
    .replaceAllMapped(RegExp(r'`([^`]+)`'),
        (Match match) => '<code>${_escape(match.group(1)!)}</code>')
    .replaceAllMapped(RegExp(r'!?\[([^\]]*)\]\(([^)\s]+)\)'), (Match match) {
      final String url = _safeUrl(match.group(2)!);
      return match.group(0)!.startsWith('![')
          ? '<img src="${_escapeAttribute(url)}" alt="${_escapeAttribute(match.group(1)!)}">'
          : '<a href="${_escapeAttribute(url)}" rel="noreferrer noopener">${_escape(match.group(1)!)}</a>';
    })
    .replaceAllMapped(RegExp(r'\*\*([^*]+)\*\*'),
        (Match match) => '<strong>${_escape(match.group(1)!)}</strong>')
    .replaceAllMapped(RegExp(r'(?<!\*)\*([^*]+)\*(?!\*)'),
        (Match match) => '<em>${_escape(match.group(1)!)}</em>');

List<int> _docxBytes(Article article) {
  final String body = article.body
      .split(RegExp(r'\r?\n'))
      .map((String line) =>
          '<w:p><w:r><w:t xml:space="preserve">${_xmlEscape(line)}</w:t></w:r></w:p>')
      .join();
  return _zip(<String, String>{
    '[Content_Types].xml':
        '<?xml version="1.0"?><Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="xml" ContentType="application/xml"/><Override PartName="/word/document.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml"/></Types>',
    '_rels/.rels':
        '<?xml version="1.0"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="word/document.xml"/></Relationships>',
    'word/document.xml':
        '<?xml version="1.0" encoding="UTF-8"?><w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main"><w:body>$body</w:body></w:document>',
  });
}

List<int> _pdfBytes(Article article) {
  final String printable = '${article.title}\n\n${article.body}'
      .replaceAll('\\', '\\\\')
      .replaceAll('(', '\\(')
      .replaceAll(')', '\\)')
      .replaceAll(RegExp(r'[^\x20-\x7e\n]'), '?');
  final String stream =
      'BT /F1 12 Tf 50 780 Td (${printable.replaceAll('\n', ') Tj 0 -16 Td (')}) Tj ET';
  final List<String> objects = <String>[
    '1 0 obj<< /Type /Catalog /Pages 2 0 R >>endobj\n',
    '2 0 obj<< /Type /Pages /Kids [3 0 R] /Count 1 >>endobj\n',
    '3 0 obj<< /Type /Page /Parent 2 0 R /MediaBox [0 0 612 792] /Resources << /Font << /F1 4 0 R >> >> /Contents 5 0 R >>endobj\n',
    '4 0 obj<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>endobj\n',
    '5 0 obj<< /Length ${utf8.encode(stream).length} >>stream\n$stream\nendstream\nendobj\n',
  ];
  final StringBuffer output = StringBuffer('%PDF-1.4\n');
  final List<int> offsets = <int>[0];
  for (final String object in objects) {
    offsets.add(utf8.encode(output.toString()).length);
    output.write(object);
  }
  final int xref = utf8.encode(output.toString()).length;
  output.write('xref\n0 ${objects.length + 1}\n');
  output.write('0000000000 65535 f \n');
  for (final int offset in offsets.skip(1)) {
    output.write('${offset.toString().padLeft(10, '0')} 00000 n \n');
  }
  output.write(
      'trailer<< /Size ${objects.length + 1} /Root 1 0 R >>\nstartxref\n$xref\n%%EOF');
  return utf8.encode(output.toString());
}

List<int> _pngBytes(Article article) {
  const int width = 800;
  final List<String> lines = <String>[
    article.title,
    ...article.body.split('\n')
  ];
  final int height = math.max(1, math.min(4000, lines.length * 12 + 20));
  final List<int> raw = List<int>.filled((width * 4 + 1) * height, 255);
  for (int y = 0; y < height; y++) {
    raw[y * (width * 4 + 1)] = 0;
  }
  for (int lineIndex = 0; lineIndex < lines.length; lineIndex++) {
    final int startY = 10 + lineIndex * 12;
    final int lineWidth =
        math.min(width - 20, 20 + lines[lineIndex].runes.length * 8);
    for (int y = startY; y < math.min(startY + 7, height); y++) {
      for (int x = 10; x < lineWidth; x++) {
        final int offset = y * (width * 4 + 1) + 1 + x * 4;
        raw[offset] = 20;
        raw[offset + 1] = 20;
        raw[offset + 2] = 20;
        raw[offset + 3] = 255;
      }
    }
  }
  final List<int> idat = const ZLibEncoder().encodeBytes(raw);
  return <int>[
    ...<int>[137, 80, 78, 71, 13, 10, 26, 10],
    ..._pngChunk('IHDR', <int>[
      ..._u32be(width),
      ..._u32be(height),
      8,
      6,
      0,
      0,
      0,
    ]),
    ..._pngChunk('IDAT', idat),
    ..._pngChunk('IEND', const <int>[]),
  ];
}

List<int> _pngChunk(String type, List<int> data) {
  final List<int> payload = <int>[...ascii.encode(type), ...data];
  return <int>[
    ..._u32be(data.length),
    ...payload,
    ..._u32be(getCrc32(payload)),
  ];
}

List<int> _u32be(int value) => <int>[
      (value >> 24) & 0xff,
      (value >> 16) & 0xff,
      (value >> 8) & 0xff,
      value & 0xff,
    ];

List<int> _epubBytes(Article article) => _zip(
      <String, String>{
        'mimetype': 'application/epub+zip',
        'META-INF/container.xml':
            '<?xml version="1.0"?><container version="1.0" xmlns="urn:oasis:names:tc:opendocument:xmlns:container"><rootfiles><rootfile full-path="OEBPS/chapter.xhtml" media-type="application/xhtml+xml"/></rootfiles></container>',
        'OEBPS/chapter.xhtml':
            '<?xml version="1.0" encoding="UTF-8"?><html xmlns="http://www.w3.org/1999/xhtml"><head><title>${_escape(article.title)}</title></head><body><h1>${_escape(article.title)}</h1>${_markdownToHtml(article.body)}</body></html>',
      },
      noCompress: <String>{'mimetype'},
    );

List<int> _zip(Map<String, String> entries,
    {Set<String> noCompress = const <String>{}}) {
  final Archive archive = Archive();
  for (final MapEntry<String, String> entry in entries.entries) {
    final List<int> bytes = utf8.encode(entry.value);
    archive.addFile(noCompress.contains(entry.key)
        ? ArchiveFile.noCompress(entry.key, bytes.length, bytes)
        : ArchiveFile(entry.key, bytes.length, bytes));
  }
  return ZipEncoder().encode(archive);
}

String _safeUrl(String value) {
  final Uri? uri = Uri.tryParse(value);
  if (uri == null ||
      !<String>{'http', 'https', 'mailto'}.contains(uri.scheme) &&
          !value.startsWith('#')) return '#';
  return value;
}

String _xmlEscape(String value) => value
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;');

String _escape(String value) => _xmlEscape(value);
String _escapeAttribute(String value) =>
    _escape(value).replaceAll("'", '&#39;');
