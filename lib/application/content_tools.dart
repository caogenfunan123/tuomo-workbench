import 'dart:convert';

import 'package:archive/archive.dart';

class MarkdownStats {
  const MarkdownStats({
    required this.words,
    required this.characters,
    required this.lines,
    required this.headings,
    required this.links,
    required this.codeBlocks,
  });

  final int words;
  final int characters;
  final int lines;
  final int headings;
  final int links;
  final int codeBlocks;
}

MarkdownStats markdownStats(String markdown) {
  final String text = markdown.replaceAll(RegExp(r'```[\s\S]*?```'), '');
  final int latinWords = RegExp(r'[A-Za-z0-9_]+').allMatches(text).length;
  final int cjkWords = RegExp(r'[\u4e00-\u9fff]').allMatches(text).length;
  return MarkdownStats(
    words: latinWords + cjkWords,
    characters: text.replaceAll(RegExp(r'\s'), '').runes.length,
    lines: markdown.split(RegExp(r'\r?\n')).length,
    headings: RegExp(r'^#{1,6}\s', multiLine: true).allMatches(markdown).length,
    links: RegExp(r'!?\[[^\]]*\]\([^)]*\)').allMatches(markdown).length,
    codeBlocks:
        RegExp(r'^```', multiLine: true).allMatches(markdown).length ~/ 2,
  );
}

String formatMarkdown(String markdown) =>
    markdown
        .replaceAll('\r\n', '\n')
        .split('\n')
        .map((String line) => line.replaceFirst(RegExp(r'[ \t]+$'), ''))
        .join('\n')
        .replaceAll(RegExp(r'\n{3,}'), '\n\n')
        .trimRight() +
    '\n';

String htmlToMarkdown(String html) {
  String value = html
      .replaceAll(RegExp(r'<script[\s\S]*?</script>', caseSensitive: false), '')
      .replaceAll(RegExp(r'<style[\s\S]*?</style>', caseSensitive: false), '')
      .replaceAllMapped(
          RegExp(r'<h([1-6])[^>]*>([\s\S]*?)</h\1>', caseSensitive: false),
          (Match match) =>
              '${'#' * int.parse(match.group(1)!)} ${_stripTags(match.group(2)!)}\n\n')
      .replaceAllMapped(
          RegExp(r'<li[^>]*>([\s\S]*?)</li>', caseSensitive: false),
          (Match match) => '- ${_stripTags(match.group(1)!)}\n')
      .replaceAll(RegExp(r'<br\s*/?>', caseSensitive: false), '\n')
      .replaceAll(RegExp(r'</p\s*>', caseSensitive: false), '\n\n');
  value = _stripTags(value);
  return formatMarkdown(_decodeEntities(value));
}

String docxToMarkdown(List<int> bytes) {
  final Archive archive = ZipDecoder().decodeBytes(bytes);
  ArchiveFile? document;
  for (final ArchiveFile file in archive) {
    if (file.name == 'word/document.xml') {
      document = file;
      break;
    }
  }
  if (document == null) {
    throw const FormatException(
        'DOCX archive does not contain word/document.xml');
  }
  final String xml =
      utf8.decode(document.readBytes() ?? <int>[], allowMalformed: true);
  final List<String> paragraphs = RegExp(r'<w:p\b[\s\S]*?</w:p>',
          caseSensitive: false)
      .allMatches(xml)
      .map((Match paragraph) =>
          RegExp(r'<w:t\b[^>]*>([\s\S]*?)</w:t>', caseSensitive: false)
              .allMatches(paragraph.group(0)!)
              .map((Match text) => _decodeEntities(_stripTags(text.group(1)!)))
              .join(''))
      .where((String value) => value.trim().isNotEmpty)
      .toList();
  if (paragraphs.isNotEmpty) return formatMarkdown(paragraphs.join('\n\n'));
  return formatMarkdown(_decodeEntities(_stripTags(xml)));
}

String _stripTags(String value) => value.replaceAll(RegExp(r'<[^>]+>'), '');

String _decodeEntities(String value) => value
    .replaceAll('&nbsp;', ' ')
    .replaceAll('&amp;', '&')
    .replaceAll('&lt;', '<')
    .replaceAll('&gt;', '>')
    .replaceAll('&quot;', '"')
    .replaceAll('&#39;', "'");

class TableOfContentsEntry {
  const TableOfContentsEntry(
      {required this.level, required this.text, required this.anchor});

  final int level;
  final String text;
  final String anchor;
}

List<TableOfContentsEntry> tableOfContents(String markdown) {
  final Map<String, int> used = <String, int>{};
  return RegExp(r'^(#{1,6})\s+(.+?)\s*#*\s*$', multiLine: true)
      .allMatches(markdown)
      .map((RegExpMatch match) {
    final String text = match.group(2)!.trim();
    final String base = _anchorBase(text);
    final int count = (used[base] ?? 0) + 1;
    used[base] = count;
    return TableOfContentsEntry(
        level: match.group(1)!.length,
        text: text,
        anchor: count == 1 ? base : '$base-$count');
  }).toList();
}

String findAndReplace(String markdown, String search, String replacement,
    {bool caseSensitive = false, bool wholeWord = false}) {
  if (search.isEmpty) return markdown;
  final String word = wholeWord ? r'\b' : '';
  final RegExp expression = RegExp('$word${RegExp.escape(search)}$word',
      caseSensitive: caseSensitive);
  return markdown.replaceAllMapped(expression, (_) => replacement);
}

String _anchorBase(String value) {
  final String normalized = value
      .toLowerCase()
      .replaceAll(RegExp(r'[^\p{L}\p{N}]+', unicode: true), '-')
      .replaceAll(RegExp(r'^-+|-+$'), '');
  return normalized.isEmpty ? 'section' : normalized;
}
