// ignore_for_file: deprecated_member_use

import 'dart:convert';
import 'dart:html' as html;

import '../application/preferences.dart';

class BrowserPreferencesStore implements PreferencesStore {
  static const String _key = 'tuomo.workspace.preferences.v1';

  @override
  Future<WorkspacePreferences> load() async {
    final String? text = html.window.localStorage[_key];
    if (text == null) return const WorkspacePreferences();
    try {
      final Object? decoded = jsonDecode(text);
      if (decoded is Map) {
        return WorkspacePreferences.fromJson(
            Map<String, Object?>.from(decoded));
      }
    } catch (_) {
      // A corrupt browser preference is discarded without blocking writing.
    }
    return const WorkspacePreferences();
  }

  @override
  Future<void> save(WorkspacePreferences preferences) async {
    html.window.localStorage[_key] = jsonEncode(preferences.toJson());
  }
}

PreferencesStore createPreferencesStore() => BrowserPreferencesStore();
