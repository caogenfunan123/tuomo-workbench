enum WorkspaceMode { simple, standard }

enum WorkspaceTheme { system, light, dark }

class RecentDocument {
  const RecentDocument(
      {required this.id, required this.title, required this.updatedAt});

  final String id;
  final String title;
  final DateTime updatedAt;

  Map<String, Object?> toJson() => <String, Object?>{
        'id': id,
        'title': title,
        'updatedAt': updatedAt.toIso8601String(),
      };

  factory RecentDocument.fromJson(Map<Object?, Object?> json) => RecentDocument(
        id: json['id'] as String? ?? '',
        title: json['title'] as String? ?? '未命名文章',
        updatedAt: DateTime.tryParse(json['updatedAt'] as String? ?? '') ??
            DateTime.fromMillisecondsSinceEpoch(0),
      );
}

class WorkspacePreferences {
  const WorkspacePreferences({
    this.mode = WorkspaceMode.standard,
    this.theme = WorkspaceTheme.system,
    this.nightMode = false,
    this.focusMode = false,
    this.typewriterMode = false,
    this.editorFontSize = 16,
    this.sidebarVisible = true,
    this.sidebarPinned = true,
    this.recentDocuments = const <RecentDocument>[],
  });

  final WorkspaceMode mode;
  final WorkspaceTheme theme;
  final bool nightMode;
  final bool focusMode;
  final bool typewriterMode;
  final double editorFontSize;
  final bool sidebarVisible;
  final bool sidebarPinned;
  final List<RecentDocument> recentDocuments;

  WorkspacePreferences copyWith({
    WorkspaceMode? mode,
    WorkspaceTheme? theme,
    bool? nightMode,
    bool? focusMode,
    bool? typewriterMode,
    double? editorFontSize,
    bool? sidebarVisible,
    bool? sidebarPinned,
    List<RecentDocument>? recentDocuments,
  }) =>
      WorkspacePreferences(
        mode: mode ?? this.mode,
        theme: theme ?? this.theme,
        nightMode: nightMode ?? this.nightMode,
        focusMode: focusMode ?? this.focusMode,
        typewriterMode: typewriterMode ?? this.typewriterMode,
        editorFontSize: editorFontSize ?? this.editorFontSize,
        sidebarVisible: sidebarVisible ?? this.sidebarVisible,
        sidebarPinned: sidebarPinned ?? this.sidebarPinned,
        recentDocuments: recentDocuments ?? this.recentDocuments,
      );

  Map<String, Object?> toJson() => <String, Object?>{
        'mode': mode.name,
        'theme': theme.name,
        'nightMode': nightMode,
        'focusMode': focusMode,
        'typewriterMode': typewriterMode,
        'editorFontSize': editorFontSize,
        'sidebarVisible': sidebarVisible,
        'sidebarPinned': sidebarPinned,
        'recentDocuments': recentDocuments
            .map((RecentDocument value) => value.toJson())
            .toList(),
      };

  factory WorkspacePreferences.fromJson(Map<String, Object?> json) {
    final String mode = json['mode'] as String? ?? WorkspaceMode.standard.name;
    final String theme = json['theme'] as String? ?? WorkspaceTheme.system.name;
    final double fontSize = (json['editorFontSize'] as num?)?.toDouble() ?? 16;
    final List<RecentDocument> recentDocuments = (json['recentDocuments']
            is List)
        ? (json['recentDocuments'] as List)
            .whereType<Map<Object?, Object?>>()
            .map(
                (Map<Object?, Object?> value) => RecentDocument.fromJson(value))
            .where((RecentDocument value) => value.id.isNotEmpty)
            .take(12)
            .toList()
        : const <RecentDocument>[];
    return WorkspacePreferences(
      mode: WorkspaceMode.values.firstWhere(
        (WorkspaceMode value) => value.name == mode,
        orElse: () => WorkspaceMode.standard,
      ),
      theme: WorkspaceTheme.values.firstWhere(
        (WorkspaceTheme value) => value.name == theme,
        orElse: () => WorkspaceTheme.system,
      ),
      nightMode: json['nightMode'] == true,
      focusMode: json['focusMode'] == true,
      typewriterMode: json['typewriterMode'] == true,
      editorFontSize: fontSize.clamp(12, 32).toDouble(),
      sidebarVisible: json['sidebarVisible'] != false,
      sidebarPinned: json['sidebarPinned'] != false,
      recentDocuments: recentDocuments,
    );
  }
}

abstract interface class PreferencesStore {
  Future<WorkspacePreferences> load();
  Future<void> save(WorkspacePreferences preferences);
}

class MemoryPreferencesStore implements PreferencesStore {
  WorkspacePreferences value = const WorkspacePreferences();

  @override
  Future<WorkspacePreferences> load() async => value;

  @override
  Future<void> save(WorkspacePreferences preferences) async {
    value = preferences;
  }
}
