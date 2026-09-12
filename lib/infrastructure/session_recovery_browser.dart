import 'dart:convert';

// ignore_for_file: deprecated_member_use
import 'dart:html' as html;

import '../application/editor_session.dart';

class BrowserSessionRecoveryStore implements SessionRecoveryStore {
  BrowserSessionRecoveryStore({html.Storage? storage})
      : _storage = storage ?? html.window.localStorage;

  final html.Storage _storage;

  @override
  Future<void> save(String articleId, SessionRecoverySnapshot snapshot) async {
    _storage[_key(articleId)] = jsonEncode(snapshot.toJson());
  }

  @override
  Future<SessionRecoverySnapshot?> load(String articleId) async {
    final String? raw = _storage[_key(articleId)];
    if (raw == null) return null;
    try {
      return SessionRecoverySnapshot.fromJson(
          (jsonDecode(raw) as Map).cast<String, Object?>());
    } catch (_) {
      return null;
    }
  }

  @override
  Future<void> remove(String articleId) async {
    _storage.remove(_key(articleId));
  }

  String _key(String articleId) {
    if (!RegExp(r'^[a-zA-Z0-9_-]{1,100}$').hasMatch(articleId)) {
      throw ArgumentError.value(articleId, 'articleId', 'must be safe');
    }
    return 'tuomo.session.$articleId';
  }
}
