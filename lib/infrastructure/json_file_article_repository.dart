import 'dart:convert';
import 'dart:io';

import '../application/article_repository.dart';
import '../domain/article.dart';
import '../domain/front_matter_codec.dart';

class JsonFileArticleRepository implements ArticleRepository {
  JsonFileArticleRepository(this.root);
  final Directory root;

  Directory get articlesDirectory =>
      Directory('${root.path}${Platform.pathSeparator}articles');
  Directory get trashDirectory =>
      Directory('${root.path}${Platform.pathSeparator}trash');
  Directory get exportsDirectory =>
      Directory('${root.path}${Platform.pathSeparator}exports');
  Directory get snapshotsDirectory =>
      Directory('${root.path}${Platform.pathSeparator}snapshots');
  File get indexFile =>
      File('${articlesDirectory.path}${Platform.pathSeparator}index.json');

  Future<void> init() async {
    await articlesDirectory.create(recursive: true);
    await trashDirectory.create(recursive: true);
    await exportsDirectory.create(recursive: true);
    await snapshotsDirectory.create(recursive: true);
    if (!await indexFile.exists()) await _atomicWrite(indexFile, '[]');
  }

  @override
  Future<Article?> get(String id) async {
    await init();
    final File file = _articleFile(id);
    if (!await file.exists()) return null;
    return Article.fromJson(
        (jsonDecode(await file.readAsString()) as Map).cast<String, Object?>());
  }

  @override
  Future<List<Article>> list({String? text}) async {
    await init();
    final List<Article> result = <Article>[];
    for (final FileSystemEntity entity in articlesDirectory.listSync()) {
      if (entity is! File ||
          !entity.path.endsWith('.json') ||
          entity.path.endsWith('index.json')) continue;
      try {
        final Article article = Article.fromJson(
            (jsonDecode(await entity.readAsString()) as Map)
                .cast<String, Object?>());
        final String query = text?.toLowerCase() ?? '';
        if (query.isEmpty ||
            '${article.title} ${article.body}'.toLowerCase().contains(query))
          result.add(article);
      } on FormatException {
        // A corrupt article is skipped and can be reported by the diagnostics screen.
      }
    }
    result.sort((Article left, Article right) =>
        right.updatedAt.compareTo(left.updatedAt));
    return result;
  }

  @override
  Future<void> put(Article article, {required int expectedRevision}) async {
    await init();
    validateArticle(article);
    final Article? current = await get(article.id);
    if ((current?.localRevision ?? 0) != expectedRevision)
      throw RevisionConflict(expectedRevision, current?.localRevision ?? 0);
    await _atomicWrite(_articleFile(article.id), article.encode());
    await snapshot(article);
    await _writeIndex();
  }

  @override
  Future<void> moveToTrash(String id) async {
    final Article? article = await get(id);
    if (article == null) return;
    await _atomicWrite(
        File(
            '${trashDirectory.path}${Platform.pathSeparator}${id}_${DateTime.now().microsecondsSinceEpoch}.json'),
        article.encode());
    await _articleFile(id).delete();
    await _writeIndex();
  }

  @override
  Future<List<Article>> listTrash() async {
    await init();
    final List<Article> values = <Article>[];
    await for (final FileSystemEntity entity in trashDirectory.list()) {
      if (entity is! File || !entity.path.endsWith('.json')) continue;
      try {
        values.add(Article.fromJson(
            (jsonDecode(await entity.readAsString()) as Map)
                .cast<String, Object?>()));
      } on FormatException {
        // A corrupt trash item is skipped and surfaced by diagnostics.
      }
    }
    values.sort((Article left, Article right) =>
        right.updatedAt.compareTo(left.updatedAt));
    return values;
  }

  @override
  Future<void> restoreFromTrash(String id) async {
    if (!_safeId(id))
      throw const FormatException('Article id is not a safe file name');
    await init();
    final List<File> candidates = <File>[];
    await for (final FileSystemEntity entity in trashDirectory.list()) {
      if (entity is File &&
          RegExp('^${RegExp.escape(id)}_\\d+\\.json' + r'$')
              .hasMatch(entity.uri.pathSegments.last)) {
        candidates.add(entity);
      }
    }
    if (candidates.isEmpty) throw StateError('Trash item not found');
    candidates.sort((File left, File right) => right.path.compareTo(left.path));
    final File source = candidates.first;
    final Article article = Article.fromJson(
        (jsonDecode(await source.readAsString()) as Map)
            .cast<String, Object?>());
    await put(article, expectedRevision: 0);
    await source.delete();
  }

  @override
  Future<void> deleteTrash(String id) async {
    if (!_safeId(id))
      throw const FormatException('Article id is not a safe file name');
    await init();
    await for (final FileSystemEntity entity in trashDirectory.list()) {
      if (entity is File &&
          RegExp('^${RegExp.escape(id)}_\\d+\\.json' + r'$')
              .hasMatch(entity.uri.pathSegments.last)) {
        await entity.delete();
      }
    }
  }

  @override
  Future<void> exportMarkdown(Article article) async {
    await init();
    final String safeTitle =
        (article.title.isEmpty ? 'untitled' : article.title)
            .replaceAll(RegExp(r'[^a-zA-Z0-9_\-\u4e00-\u9fff]+'), '-');
    final File target = File(
        '${exportsDirectory.path}${Platform.pathSeparator}${article.id}-$safeTitle.md');
    final String markdown = const FrontMatterCodec()
        .fromArticle(article, date: article.updatedAt.toIso8601String());
    await _atomicWrite(target, markdown);
  }

  @override
  Future<void> snapshot(Article article) async {
    await init();
    final Directory directory = Directory(
        '${snapshotsDirectory.path}${Platform.pathSeparator}${article.id}');
    await directory.create(recursive: true);
    await _atomicWrite(
        File(
            '${directory.path}${Platform.pathSeparator}${article.localRevision}.json'),
        article.encode());
  }

  @override
  Future<List<Article>> listSnapshots(String id) async {
    if (!_safeId(id))
      throw const FormatException('Article id is not a safe file name');
    await init();
    final Directory directory =
        Directory('${snapshotsDirectory.path}${Platform.pathSeparator}$id');
    if (!await directory.exists()) return <Article>[];
    final List<Article> values = <Article>[];
    await for (final FileSystemEntity entity in directory.list()) {
      if (entity is! File || !entity.path.endsWith('.json')) continue;
      try {
        values.add(Article.fromJson(
            (jsonDecode(await entity.readAsString()) as Map)
                .cast<String, Object?>()));
      } on FormatException {
        // A corrupt snapshot is skipped and surfaced by diagnostics.
      }
    }
    values.sort((Article left, Article right) =>
        right.localRevision.compareTo(left.localRevision));
    return values;
  }

  @override
  Future<Article> restoreSnapshot(String id, int revision,
      {required int expectedCurrentRevision}) async {
    if (!_safeId(id))
      throw const FormatException('Article id is not a safe file name');
    final Article? current = await get(id);
    if (current == null) throw StateError('Article not found');
    if (current.localRevision != expectedCurrentRevision) {
      throw RevisionConflict(expectedCurrentRevision, current.localRevision);
    }
    final File file = File(
        '${snapshotsDirectory.path}${Platform.pathSeparator}$id${Platform.pathSeparator}$revision.json');
    if (!await file.exists()) throw StateError('Snapshot not found');
    final Article source = Article.fromJson(
        (jsonDecode(await file.readAsString()) as Map).cast<String, Object?>());
    final Article restored = source.copyWith(
        localRevision: current.localRevision + 1, updatedAt: DateTime.now());
    await put(restored, expectedRevision: expectedCurrentRevision);
    return restored;
  }

  @override
  Future<void> deleteSnapshot(String id, int revision) async {
    if (!_safeId(id))
      throw const FormatException('Article id is not a safe file name');
    final File file = File(
        '${snapshotsDirectory.path}${Platform.pathSeparator}$id${Platform.pathSeparator}$revision.json');
    if (await file.exists()) await file.delete();
  }

  bool _safeId(String id) => RegExp(r'^[a-zA-Z0-9_-]{1,100}$').hasMatch(id);

  Future<void> _writeIndex() async {
    final List<Article> values = await list();
    await _atomicWrite(indexFile,
        jsonEncode(values.map((Article article) => article.toJson()).toList()));
  }

  File _articleFile(String id) {
    if (!RegExp(r'^[a-zA-Z0-9_-]{1,100}$').hasMatch(id)) {
      throw const FormatException('Article id is not a safe file name');
    }
    return File('${articlesDirectory.path}${Platform.pathSeparator}$id.json');
  }

  Future<void> _atomicWrite(File target, String content) async {
    final File temporary =
        File('${target.path}.${DateTime.now().microsecondsSinceEpoch}.tmp');
    await temporary.writeAsString(content, flush: true);
    if (await target.exists()) await target.delete();
    await temporary.rename(target.path);
  }
}
