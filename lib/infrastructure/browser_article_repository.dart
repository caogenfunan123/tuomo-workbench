import 'dart:convert';

// The browser storage adapter is conditionally imported only for Web builds.
// ignore_for_file: deprecated_member_use
import 'dart:html' as html;

import '../application/article_repository.dart';
import '../domain/article.dart';
import '../domain/front_matter_codec.dart';

class BrowserArticleRepository implements ArticleRepository {
  BrowserArticleRepository({html.Storage? storage})
      : _storage = storage ?? html.window.localStorage {
    _articles = _readArticles('tuomo.articles');
    _trash = _readTrash();
    _snapshots = _readSnapshots();
  }

  final html.Storage _storage;
  late Map<String, Article> _articles;
  late Map<String, Article> _trash;
  late Map<String, Map<int, Article>> _snapshots;

  @override
  Future<Article?> get(String id) async {
    _validateId(id);
    return _articles[id];
  }

  @override
  Future<List<Article>> list({String? text}) async {
    final String query = text?.trim().toLowerCase() ?? '';
    final List<Article> values = _articles.values
        .where((Article article) =>
            query.isEmpty ||
            '${article.title} ${article.body}'.toLowerCase().contains(query))
        .toList()
      ..sort((Article left, Article right) =>
          right.updatedAt.compareTo(left.updatedAt));
    return List<Article>.unmodifiable(values);
  }

  @override
  Future<void> put(Article article, {required int expectedRevision}) async {
    validateArticle(article);
    final int actual = _articles[article.id]?.localRevision ?? 0;
    if (actual != expectedRevision) {
      throw RevisionConflict(expectedRevision, actual);
    }
    _articles[article.id] = article;
    _persist();
  }

  @override
  Future<void> moveToTrash(String id) async {
    _validateId(id);
    final Article? article = _articles.remove(id);
    if (article == null) return;
    _trash['$id-${DateTime.now().microsecondsSinceEpoch}'] = article;
    _persist();
  }

  @override
  Future<List<Article>> listTrash() async {
    final List<Article> values = _trash.values.toList()
      ..sort((Article left, Article right) =>
          right.updatedAt.compareTo(left.updatedAt));
    return List<Article>.unmodifiable(values);
  }

  @override
  Future<void> restoreFromTrash(String id) async {
    _validateId(id);
    final List<String> keys = _trash.keys
        .where((String key) => key.startsWith('$id-'))
        .toList()
      ..sort();
    if (keys.isEmpty) throw StateError('Trash item not found');
    final String key = keys.last;
    final Article article = _trash[key]!;
    await put(article, expectedRevision: 0);
    _trash.remove(key);
    _persist();
  }

  @override
  Future<void> deleteTrash(String id) async {
    _validateId(id);
    _trash.removeWhere((String key, Article _) => key.startsWith('$id-'));
    _persist();
  }

  @override
  Future<void> exportMarkdown(Article article) async {
    final String markdown = const FrontMatterCodec()
        .fromArticle(article, date: article.updatedAt.toIso8601String());
    final String safeName = (article.title.isEmpty ? 'untitled' : article.title)
        .replaceAll(RegExp(r'[^a-zA-Z0-9_\-\u4e00-\u9fff]+'), '-');
    final html.AnchorElement anchor = html.AnchorElement(
        href:
            'data:text/markdown;charset=utf-8,${Uri.encodeComponent(markdown)}')
      ..download = '${article.id}-$safeName.md'
      ..style.display = 'none';
    html.document.body?.children.add(anchor);
    anchor.click();
    anchor.remove();
  }

  @override
  Future<void> snapshot(Article article) async {
    _snapshots.putIfAbsent(
        article.id, () => <int, Article>{})[article.localRevision] = article;
    _persist();
  }

  @override
  Future<List<Article>> listSnapshots(String id) async {
    _validateId(id);
    final List<Article> values = (_snapshots[id]?.values.toList() ??
        <Article>[])
      ..sort((Article left, Article right) =>
          right.localRevision.compareTo(left.localRevision));
    return List<Article>.unmodifiable(values);
  }

  @override
  Future<Article> restoreSnapshot(String id, int revision,
      {required int expectedCurrentRevision}) async {
    _validateId(id);
    final Article? current = _articles[id];
    final Article? source = _snapshots[id]?[revision];
    if (current == null || source == null) {
      throw StateError('Snapshot not found');
    }
    if (current.localRevision != expectedCurrentRevision) {
      throw RevisionConflict(expectedCurrentRevision, current.localRevision);
    }
    final Article restored = source.copyWith(
        localRevision: current.localRevision + 1, updatedAt: DateTime.now());
    _articles[id] = restored;
    await snapshot(restored);
    _persist();
    return restored;
  }

  @override
  Future<void> deleteSnapshot(String id, int revision) async {
    _validateId(id);
    _snapshots[id]?.remove(revision);
    _persist();
  }

  Map<String, Article> _readArticles(String key) {
    try {
      final String? raw = _storage[key];
      if (raw == null) return <String, Article>{};
      final Object? decoded = jsonDecode(raw);
      if (decoded is! List) return <String, Article>{};
      final Map<String, Article> result = <String, Article>{};
      for (final Object? value in decoded) {
        if (value is! Map) continue;
        try {
          final Article article =
              Article.fromJson(value.cast<String, Object?>());
          result[article.id] = article;
        } catch (_) {}
      }
      return result;
    } catch (_) {
      return <String, Article>{};
    }
  }

  Map<String, Article> _readTrash() {
    try {
      final String? raw = _storage['tuomo.trash'];
      final Object? decoded = raw == null ? null : jsonDecode(raw);
      if (decoded is! List) return <String, Article>{};
      final Map<String, Article> result = <String, Article>{};
      for (final Object? value in decoded) {
        if (value is! Map) continue;
        try {
          final Object? encodedArticle = value['article'];
          final Map<String, Object?> json = encodedArticle is Map
              ? encodedArticle.cast<String, Object?>()
              : value.cast<String, Object?>();
          final Article article = Article.fromJson(json);
          final String key = value['key'] is String
              ? value['key'] as String
              : '${article.id}-${article.updatedAt.microsecondsSinceEpoch}';
          result[key] = article;
        } catch (_) {}
      }
      return result;
    } catch (_) {
      return <String, Article>{};
    }
  }

  Map<String, Map<int, Article>> _readSnapshots() {
    final Map<String, Map<int, Article>> result = <String, Map<int, Article>>{};
    try {
      final String? raw = _storage['tuomo.snapshots'];
      final Object? decoded = raw == null ? null : jsonDecode(raw);
      if (decoded is! Map) return result;
      for (final MapEntry<Object?, Object?> entry in decoded.entries) {
        if (entry.key is! String || entry.value is! List) continue;
        final Map<int, Article> values = <int, Article>{};
        for (final Object? item in entry.value as List) {
          if (item is! Map) continue;
          try {
            final Article article =
                Article.fromJson(item.cast<String, Object?>());
            values[article.localRevision] = article;
          } catch (_) {}
        }
        result[entry.key! as String] = values;
      }
    } catch (_) {
      return <String, Map<int, Article>>{};
    }
    return result;
  }

  void _persist() {
    try {
      _storage['tuomo.articles'] = jsonEncode(
          _articles.values.map((Article value) => value.toJson()).toList());
      _storage['tuomo.trash'] = jsonEncode(_trash.entries
          .map((MapEntry<String, Article> entry) => <String, Object?>{
                'key': entry.key,
                'article': entry.value.toJson(),
              })
          .toList());
      _storage['tuomo.snapshots'] = jsonEncode(<String, Object?>{
        for (final MapEntry<String, Map<int, Article>> entry
            in _snapshots.entries)
          entry.key: entry.value.values
              .map((Article value) => value.toJson())
              .toList(),
      });
    } catch (_) {
      // Browser storage can be unavailable in private/blocked contexts; the
      // in-memory state remains usable and the UI can offer an export fallback.
    }
  }

  void _validateId(String id) {
    if (!RegExp(r'^[a-zA-Z0-9_-]{1,100}$').hasMatch(id)) {
      throw const FormatException('Invalid article id');
    }
  }
}
