import 'dart:async';

import '../domain/article.dart';
import 'article_repository.dart';

enum SaveStatus { clean, dirty, saving, saved, failed }

class SessionRecoverySnapshot {
  const SessionRecoverySnapshot({
    required this.article,
    required this.savedRevision,
    required this.savedTitle,
    required this.savedBody,
  });

  final Article article;
  final int savedRevision;
  final String savedTitle;
  final String savedBody;

  Map<String, Object?> toJson() => <String, Object?>{
        'article': article.toJson(),
        'savedRevision': savedRevision,
        'savedTitle': savedTitle,
        'savedBody': savedBody,
      };

  factory SessionRecoverySnapshot.fromJson(Map<String, Object?> json) =>
      SessionRecoverySnapshot(
        article:
            Article.fromJson((json['article']! as Map).cast<String, Object?>()),
        savedRevision: json['savedRevision'] as int? ?? 0,
        savedTitle: json['savedTitle'] as String? ?? '',
        savedBody: json['savedBody'] as String? ?? '',
      );
}

abstract interface class SessionRecoveryStore {
  Future<void> save(String articleId, SessionRecoverySnapshot snapshot);
  Future<SessionRecoverySnapshot?> load(String articleId);
  Future<void> remove(String articleId);
}

class MemorySessionRecoveryStore implements SessionRecoveryStore {
  final Map<String, SessionRecoverySnapshot> _values =
      <String, SessionRecoverySnapshot>{};

  @override
  Future<void> save(String articleId, SessionRecoverySnapshot snapshot) async {
    _values[articleId] = snapshot;
  }

  @override
  Future<SessionRecoverySnapshot?> load(String articleId) async =>
      _values[articleId];

  @override
  Future<void> remove(String articleId) async {
    _values.remove(articleId);
  }
}

/// Minimal application-layer notification primitive.
///
/// The editor state is consumed by Flutter today, but it is intentionally not
/// coupled to Flutter so the same session/save behavior can be reused by
/// another presenter or exercised in a pure Dart process.
abstract class ApplicationNotifier {
  final List<void Function()> _listeners = <void Function()>[];

  void addListener(void Function() listener) {
    if (!_listeners.contains(listener)) _listeners.add(listener);
  }

  void removeListener(void Function() listener) {
    _listeners.remove(listener);
  }

  void notifyListeners() {
    for (final void Function() listener
        in List<void Function()>.of(_listeners)) {
      listener();
    }
  }

  void dispose() {
    _listeners.clear();
  }
}

class DocumentSession extends ApplicationNotifier {
  DocumentSession(Article article)
      : _article = article,
        _savedRevision = article.localRevision {
    _savedTitle = article.title;
    _savedBody = article.body;
  }

  Article _article;
  int _savedRevision;
  SaveStatus _status = SaveStatus.clean;

  Article get article => _article;
  SaveStatus get status => _status;
  bool get isDirty =>
      _article.localRevision != _savedRevision ||
      _article.title != _savedTitle ||
      _article.body != _savedBody;
  SessionRecoverySnapshot get recoverySnapshot => SessionRecoverySnapshot(
        article: _article,
        savedRevision: _savedRevision,
        savedTitle: _savedTitle,
        savedBody: _savedBody,
      );
  late String _savedTitle;
  late String _savedBody;

  void edit({
    String? title,
    String? body,
    ArticleMetadata? metadata,
    String? volume,
    DateTime? scheduleAt,
    bool? published,
  }) {
    _article = _article.copyWith(
        title: title,
        body: body,
        metadata: metadata,
        volume: volume,
        scheduleAt: scheduleAt,
        published: published,
        localRevision: _article.localRevision + 1,
        updatedAt: DateTime.now());
    _status = isDirty ? SaveStatus.dirty : SaveStatus.clean;
    notifyListeners();
  }

  Future<void> save(ArticleRepository repository) async {
    if (!isDirty) return;
    final Article snapshot = _article;
    _status = SaveStatus.saving;
    notifyListeners();
    try {
      await repository.put(snapshot, expectedRevision: _savedRevision);
      await repository.exportMarkdown(snapshot);
      await repository.snapshot(snapshot);
      if (snapshot.localRevision == _article.localRevision) {
        _savedRevision = snapshot.localRevision;
        _savedTitle = snapshot.title;
        _savedBody = snapshot.body;
        _status = SaveStatus.saved;
      }
    } on RevisionConflict {
      _status = SaveStatus.failed;
      rethrow;
    } catch (_) {
      _status = SaveStatus.failed;
      rethrow;
    } finally {
      notifyListeners();
    }
  }

  void reload(Article article) {
    _article = article;
    _savedRevision = article.localRevision;
    _savedTitle = article.title;
    _savedBody = article.body;
    _status = SaveStatus.clean;
    notifyListeners();
  }

  void restoreRecovery(SessionRecoverySnapshot snapshot) {
    if (snapshot.article.id != _article.id) return;
    _article = snapshot.article;
    _savedRevision = snapshot.savedRevision;
    _savedTitle = snapshot.savedTitle;
    _savedBody = snapshot.savedBody;
    _status = isDirty ? SaveStatus.dirty : SaveStatus.clean;
    notifyListeners();
  }
}

class EditorSessionStore extends ApplicationNotifier {
  EditorSessionStore({this.recovery});

  final SessionRecoveryStore? recovery;
  final Map<String, DocumentSession> _sessions = <String, DocumentSession>{};
  final Map<String, Future<void>> _recoveryTasks = <String, Future<void>>{};
  String? _activeId;

  Iterable<DocumentSession> get sessions => _sessions.values;
  DocumentSession? get active =>
      _activeId == null ? null : _sessions[_activeId];

  DocumentSession open(Article article) {
    final DocumentSession session = _sessions.putIfAbsent(article.id, () {
      final DocumentSession created = DocumentSession(article);
      created.addListener(() => _persist(created));
      return created;
    });
    _activeId = article.id;
    notifyListeners();
    return session;
  }

  Future<DocumentSession> openAndRecover(Article article) async {
    final DocumentSession session = open(article);
    final SessionRecoverySnapshot? snapshot = await recovery?.load(article.id);
    if (snapshot != null &&
        snapshot.article.localRevision >= article.localRevision) {
      session.restoreRecovery(snapshot);
    }
    return session;
  }

  DocumentSession replace(Article article) {
    final DocumentSession? current = _sessions[article.id];
    if (current == null) {
      return open(article);
    }
    current.reload(article);
    _activeId = article.id;
    notifyListeners();
    return current;
  }

  void switchTo(String id) {
    if (!_sessions.containsKey(id)) return;
    _activeId = id;
    notifyListeners();
  }

  Future<void> flushAll(ArticleRepository repository) async {
    for (final DocumentSession session in _sessions.values) {
      await session.save(repository);
    }
  }

  void _persist(DocumentSession session) {
    final SessionRecoveryStore? store = recovery;
    if (store == null) return;
    final String articleId = session.article.id;
    final Future<void> previous =
        _recoveryTasks[articleId] ?? Future<void>.value();
    final Future<void> next = previous.then((_) async {
      if (session.isDirty) {
        await store.save(articleId, session.recoverySnapshot);
      } else {
        await store.remove(articleId);
      }
    });
    _recoveryTasks[articleId] = next.catchError((Object _) {});
    unawaited(_recoveryTasks[articleId]!);
  }
}
