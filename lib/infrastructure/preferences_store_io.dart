import 'dart:convert';
import 'dart:io';

import 'package:path_provider/path_provider.dart';

import '../application/preferences.dart';

class JsonPreferencesStore implements PreferencesStore {
  JsonPreferencesStore({File? file}) : _fileOverride = file;

  final File? _fileOverride;

  Future<File> _file() async {
    final File? override = _fileOverride;
    if (override != null) {
      await override.parent.create(recursive: true);
      return override;
    }
    final Directory root = await getApplicationSupportDirectory();
    final Directory settings =
        Directory('${root.path}${Platform.pathSeparator}settings');
    await settings.create(recursive: true);
    return File('${settings.path}${Platform.pathSeparator}preferences.json');
  }

  @override
  Future<WorkspacePreferences> load() async {
    try {
      final String text = await (await _file()).readAsString();
      final Object? decoded = jsonDecode(text);
      if (decoded is Map) {
        return WorkspacePreferences.fromJson(
            Map<String, Object?>.from(decoded));
      }
    } catch (_) {
      // A missing or corrupt preference file must never block the editor.
    }
    return const WorkspacePreferences();
  }

  @override
  Future<void> save(WorkspacePreferences preferences) async {
    final File file = await _file();
    final File temporary = File('${file.path}.tmp');
    await temporary.writeAsString(jsonEncode(preferences.toJson()),
        flush: true);
    if (await file.exists()) await file.delete();
    await temporary.rename(file.path);
  }
}

PreferencesStore createPreferencesStore() => JsonPreferencesStore();
