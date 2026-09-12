import '../domain/article.dart';

class RevisionConflict implements Exception {
  const RevisionConflict(this.expected, this.actual);
  final int expected;
  final int actual;
  @override
  String toString() => 'RevisionConflict(expected: $expected, actual: $actual)';
}

abstract interface class ArticleRepository {
  Future<Article?> get(String id);
  Future<List<Article>> list({String? text});
  Future<void> put(Article article, {required int expectedRevision});
  Future<void> moveToTrash(String id);
  Future<List<Article>> listTrash();
  Future<void> restoreFromTrash(String id);
  Future<void> deleteTrash(String id);
  Future<void> exportMarkdown(Article article);
  Future<void> snapshot(Article article);
  Future<List<Article>> listSnapshots(String id);
  Future<Article> restoreSnapshot(String id, int revision,
      {required int expectedCurrentRevision});
  Future<void> deleteSnapshot(String id, int revision);
}

class MemoryArticleRepository implements ArticleRepository {
  final Map<String, Article> _articles = <String, Article>{};
  final Map<String, Article> _trash = <String, Article>{};
  final Map<String, Map<int, Article>> _snapshots =
      <String, Map<int, Article>>{};

  @override
  Future<Article?> get(String id) async {
    _validateId(id);
    return _articles[id];
  }

  @override
  Future<List<Article>> list({String? text}) async {
    final String query = text?.toLowerCase() ?? '';
    final List<Article> values = _articles.values
        .where((Article article) =>
            query.isEmpty ||
            '${article.title} ${article.body}'.toLowerCase().contains(query))
        .toList();
    values.sort((Article left, Article right) =>
        right.updatedAt.compareTo(left.updatedAt));
    return List<Article>.unmodifiable(values);
  }

  @override
  Future<void> put(Article article, {required int expectedRevision}) async {
    validateArticle(article);
    final int actual = _articles[article.id]?.localRevision ?? 0;
    if (actual != expectedRevision)
      throw RevisionConflict(expectedRevision, actual);
    _articles[article.id] = article;
  }

  @override
  Future<void> moveToTrash(String id) async {
    _validateId(id);
    final Article? article = _articles.remove(id);
    if (article != null) _trash[id] = article;
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
    final Article? article = _trash[id];
    if (article == null) throw StateError('Trash item not found');
    await put(article, expectedRevision: 0);
    _trash.remove(id);
  }

  @override
  Future<void> deleteTrash(String id) async {
    _validateId(id);
    _trash.remove(id);
  }

  @override
  Future<void> exportMarkdown(Article article) async {}

  @override
  Future<void> snapshot(Article article) async => snapshotArticle(article);

  @override
  Future<List<Article>> listSnapshots(String id) async =>
      (_snapshots[id]?.values.toList() ?? <Article>[]).toList(growable: false);

  @override
  Future<Article> restoreSnapshot(String id, int revision,
      {required int expectedCurrentRevision}) async {
    final Article? current = _articles[id];
    final Article? snapshot = _snapshots[id]?[revision];
    if (current == null || snapshot == null)
      throw StateError('Snapshot not found');
    if (current.localRevision != expectedCurrentRevision) {
      throw RevisionConflict(expectedCurrentRevision, current.localRevision);
    }
    final Article restored = snapshot.copyWith(
        localRevision: current.localRevision + 1, updatedAt: DateTime.now());
    _articles[id] = restored;
    await snapshotArticle(restored);
    return restored;
  }

  @override
  Future<void> deleteSnapshot(String id, int revision) async {
    _snapshots[id]?.remove(revision);
  }

  Future<void> snapshotArticle(Article article) async {
    _snapshots.putIfAbsent(
        article.id, () => <int, Article>{})[article.localRevision] = article;
  }

  void _validateId(String id) {
    if (!RegExp(r'^[a-zA-Z0-9_-]{1,100}$').hasMatch(id)) {
      throw const FormatException('Invalid article id');
    }
  }
}
