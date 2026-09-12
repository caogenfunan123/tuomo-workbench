import 'dart:convert';
import 'dart:io';

import '../application/editor_session.dart';

class JsonFileSessionRecoveryStore implements SessionRecoveryStore {
  JsonFileSessionRecoveryStore(this.root);
  final Directory root;

  @override
  Future<void> save(String articleId, SessionRecoverySnapshot snapshot) async {
    final File file = _file(articleId);
    await root.create(recursive: true);
    final File temporary =
        File('${file.path}.${DateTime.now().microsecondsSinceEpoch}.tmp');
    await temporary.writeAsString(jsonEncode(snapshot.toJson()), flush: true);
    if (await file.exists()) await file.delete();
    await temporary.rename(file.path);
  }

  @override
  Future<SessionRecoverySnapshot?> load(String articleId) async {
    final File file = _file(articleId);
    if (!await file.exists()) return null;
    try {
      return SessionRecoverySnapshot.fromJson(
          (jsonDecode(await file.readAsString()) as Map)
              .cast<String, Object?>());
    } catch (_) {
      return null;
    }
  }

  @override
  Future<void> remove(String articleId) async {
    final File file = _file(articleId);
    if (await file.exists()) await file.delete();
  }

  File _file(String articleId) {
    if (!RegExp(r'^[a-zA-Z0-9_-]{1,100}$').hasMatch(articleId)) {
      throw const FormatException('Invalid article id');
    }
    return File('${root.path}${Platform.pathSeparator}$articleId.json');
  }
}
