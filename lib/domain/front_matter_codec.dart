import 'article.dart';

class FrontMatterDocument {
  const FrontMatterDocument({required this.data, required this.body});
  final Map<String, Object?> data;
  final String body;
}

class FrontMatterCodec {
  const FrontMatterCodec();

  FrontMatterDocument decode(String markdown) {
    final String normalized = markdown.replaceAll('\r\n', '\n');
    if (!normalized.startsWith('---\n'))
      return FrontMatterDocument(
          data: const <String, Object?>{}, body: normalized);
    final int end = normalized.indexOf('\n---', 4);
    if (end < 0)
      return FrontMatterDocument(
          data: const <String, Object?>{}, body: normalized);
    final Map<String, Object?> data = <String, Object?>{};
    for (final String line in normalized.substring(4, end).split('\n')) {
      final int separator = line.indexOf(':');
      if (separator <= 0) continue;
      data[line.substring(0, separator).trim()] =
          _parse(line.substring(separator + 1));
    }
    return FrontMatterDocument(
        data: data,
        body: normalized.substring(end + 4).replaceFirst(RegExp(r'^\n+'), ''));
  }

  String encode(Map<String, Object?> data, String body) {
    final Iterable<String> lines = data.entries
        .where((MapEntry<String, Object?> entry) =>
            entry.value != null && entry.value != '')
        .map((MapEntry<String, Object?> entry) =>
            '${entry.key}: ${_format(entry.value)}');
    return '---\n${lines.join('\n')}\n---\n\n$body';
  }

  String fromArticle(Article article, {required String date}) =>
      encode(<String, Object?>{
        ...article.metadata.extraFrontMatter,
        'title': article.title,
        'date': date,
        'tags': article.metadata.tags.isEmpty ? null : article.metadata.tags,
        'categories': article.metadata.categories.isEmpty
            ? null
            : article.metadata.categories,
        'cover': article.metadata.cover,
        'type': article.metadata.kind.name,
        'templateId': article.metadata.templateId,
        'slug': article.metadata.slug,
        'volume': article.volume,
        'scheduleAt': article.scheduleAt?.toIso8601String(),
        'published': article.published,
      }, article.body);

  Article articleFromMarkdown(String markdown, {String? fallbackTitle}) {
    final FrontMatterDocument document = decode(markdown);
    final Map<String, Object?> data = document.data;
    final ArticleMetadata metadata = ArticleMetadata(
      tags: _stringList(data['tags']),
      categories: _stringList(data['categories']),
      cover: data['cover'] is String ? data['cover'] as String : null,
      kind: data['kind'] == 'page' || data['type'] == 'page'
          ? ArticleKind.page
          : ArticleKind.post,
      templateId: data['templateId'] is String
          ? data['templateId'] as String
          : data['template'] is String
              ? data['template'] as String
              : null,
      slug: data['slug'] is String ? data['slug'] as String : null,
      extraFrontMatter: Map<String, Object?>.fromEntries(data.entries.where(
          (MapEntry<String, Object?> entry) =>
              !_knownKeys.contains(entry.key))),
    );
    final Article article = newArticle(
        title: (data['title'] as String?)?.trim().isNotEmpty == true
            ? data['title'] as String
            : fallbackTitle ?? 'Imported document',
        body: document.body);
    return article.copyWith(
      metadata: metadata,
      volume: data['volume'] is String ? data['volume'] as String : null,
      scheduleAt: data['scheduleAt'] is String
          ? DateTime.tryParse(data['scheduleAt'] as String)
          : null,
      published: data['published'] == true,
    );
  }

  static const Set<String> _knownKeys = <String>{
    'title',
    'date',
    'tags',
    'categories',
    'cover',
    'type',
    'kind',
    'template',
    'templateId',
    'slug',
    'volume',
    'scheduleAt',
    'published',
  };

  static List<String> _stringList(Object? value) {
    if (value is List) {
      return value.whereType<String>().toList(growable: false);
    }
    if (value is String) {
      return value
          .split(',')
          .map((String item) => item.trim())
          .where((String item) => item.isNotEmpty)
          .toList(growable: false);
    }
    return const <String>[];
  }

  static Object? _parse(String value) {
    final String trimmed = value.trim();
    if (trimmed == 'true') return true;
    if (trimmed == 'false') return false;
    if (trimmed == 'null' || trimmed == '~') return null;
    if (num.tryParse(trimmed) != null) return num.parse(trimmed);
    if (trimmed.startsWith('[') && trimmed.endsWith(']'))
      return trimmed
          .substring(1, trimmed.length - 1)
          .split(',')
          .map((String item) => item.trim())
          .where((String item) => item.isNotEmpty)
          .toList(growable: false);
    return trimmed.replaceAll('"', '').replaceAll("'", '');
  }

  static String _format(Object? value) => value is List
      ? '[${value.map((Object? item) => item is String ? '"$item"' : item).join(', ')}]'
      : value is String && RegExp(r'[:#\[\]{},]').hasMatch(value)
          ? '"$value"'
          : '$value';
}
