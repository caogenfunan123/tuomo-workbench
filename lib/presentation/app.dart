import 'dart:async';
import 'dart:convert';

import 'package:flutter/material.dart';
import 'package:flutter/services.dart';

import '../application/article_repository.dart';
import '../application/content_tools.dart' as content_tools;
import '../application/document_export.dart' as document_export;
import '../application/editor_session.dart';
import '../application/preferences.dart';
import '../application/secret_store.dart';
import '../domain/article.dart';
import '../domain/front_matter_codec.dart';
import '../platform/capabilities.dart';
import '../platform/ports.dart';
import '../infrastructure/preferences_store.dart';
import 'editor_pane.dart';

part 'workspace_layout.dart';
part 'workspace_home.dart';
part 'workspace_editor.dart';
part 'workspace_operations.dart';

class WorkspaceController extends ChangeNotifier {
  WorkspaceController(
      {ArticleRepository? repository,
      required this.secretStore,
      PlatformServices? platformServices,
      SessionRecoveryStore? recoveryStore,
      PreferencesStore? preferencesStore})
      : repository = repository ?? MemoryArticleRepository(),
        preferencesStore = preferencesStore ?? createPreferencesStore() {
    this.platformServices = platformServices ?? createPlatformServices();
    editorStore = EditorSessionStore(recovery: recoveryStore);
    _load();
  }

  ArticleRepository repository;
  final SecretStore secretStore;
  final PreferencesStore preferencesStore;
  late final PlatformServices platformServices;
  late final EditorSessionStore editorStore;
  WorkspacePreferences preferences = const WorkspacePreferences();
  List<Article> articles = <Article>[];
  List<Article> trash = <Article>[];
  bool loading = true;
  String? initializationWarning;
  String searchText = '';
  int searchGeneration = 0;

  List<Article> get recentArticles => preferences.recentDocuments
      .map((RecentDocument recent) => articles
          .where((Article article) => article.id == recent.id)
          .firstOrNull)
      .whereType<Article>()
      .toList();

  Future<void> _load() async {
    try {
      try {
        preferences =
            await preferencesStore.load().timeout(const Duration(seconds: 5));
      } catch (error) {
        debugPrint('Preferences unavailable: $error');
      }
      articles = await repository.list(text: searchText);
      if (articles.isEmpty) {
        final Article welcome =
            newArticle(title: '欢迎使用拓墨', body: '这是一个离线优先的 Markdown 草稿。');
        await repository.put(welcome, expectedRevision: 0);
        articles = <Article>[welcome];
      }
      try {
        for (final Article article in articles) {
          final SessionRecoverySnapshot? snapshot =
              await editorStore.recovery?.load(article.id);
          if (snapshot != null &&
              snapshot.article.localRevision >= article.localRevision) {
            await editorStore.openAndRecover(article);
            break;
          }
        }
      } catch (error) {
        debugPrint('Session recovery unavailable: $error');
      }
    } catch (error) {
      initializationWarning = '本地存储暂不可用，已切换到内存草稿；原有文件未覆盖。';
      repository = MemoryArticleRepository();
      final Article fallback =
          newArticle(title: '欢迎使用拓墨', body: '这是一个离线优先的 Markdown 草稿。');
      await repository.put(fallback, expectedRevision: 0);
      articles = <Article>[fallback];
      debugPrint('Workspace storage degraded: $error');
    } finally {
      loading = false;
      notifyListeners();
    }
  }

  Future<void> updatePreferences(WorkspacePreferences value) async {
    preferences = value;
    notifyListeners();
    try {
      await preferencesStore.save(value).timeout(const Duration(seconds: 5));
    } catch (error) {
      debugPrint('Preferences save unavailable: $error');
    }
  }

  Future<DocumentSession> createArticle() async {
    final Article article = newArticle(title: '未命名文章');
    await repository.put(article, expectedRevision: 0);
    articles = await repository.list(text: searchText);
    await recordRecent(article);
    final DocumentSession session = await editorStore.openAndRecover(article);
    notifyListeners();
    return session;
  }

  Future<DocumentSession?> openArticle(String id) async {
    final Article? article = await repository.get(id);
    if (article == null) return null;
    await recordRecent(article);
    final DocumentSession session = await editorStore.openAndRecover(article);
    notifyListeners();
    return session;
  }

  Future<DocumentSession?> importMarkdown() async {
    final PickedFile? picked = await platformServices.filePicker.pickMarkdown();
    if (picked == null) return null;
    return importPickedFile(picked);
  }

  Future<DocumentSession> importPickedFile(PickedFile picked) async {
    final String text = utf8.decode(picked.bytes, allowMalformed: true);
    final String fallbackTitle =
        picked.name.replaceFirst(RegExp(r'\.[^.]+$'), '');
    final String extension = picked.name.toLowerCase().split('.').last;
    final String markdown = switch (extension) {
      'html' || 'htm' => content_tools.htmlToMarkdown(text),
      'docx' => content_tools.docxToMarkdown(picked.bytes),
      _ => text,
    };
    final Article article = const FrontMatterCodec()
        .articleFromMarkdown(markdown, fallbackTitle: fallbackTitle);
    await repository.put(article, expectedRevision: 0);
    articles = await repository.list(text: searchText);
    await recordRecent(article, path: picked.path);
    final DocumentSession session = await editorStore.openAndRecover(article);
    notifyListeners();
    return session;
  }

  Future<void> save(DocumentSession session) async {
    await session.save(repository);
    articles = await repository.list(text: searchText);
    await recordRecent(session.article);
    notifyListeners();
  }

  Future<void> recordRecent(Article article, {String? path}) async {
    final List<RecentDocument> recent = <RecentDocument>[
      RecentDocument(
          id: article.id, title: article.title, updatedAt: article.updatedAt),
      ...preferences.recentDocuments
          .where((RecentDocument value) => value.id != article.id),
    ].take(12).toList();
    await updatePreferences(preferences.copyWith(recentDocuments: recent));
    if (path != null && path.trim().isNotEmpty) {
      try {
        await platformServices.recentFiles
            .record(path: path, title: article.title);
      } catch (error) {
        debugPrint('Recent file integration unavailable: $error');
      }
    }
  }

  Future<void> search(String value) async {
    searchText = value;
    final int generation = ++searchGeneration;
    final List<Article> result = await repository.list(text: searchText);
    if (generation != searchGeneration) return;
    articles = result;
    notifyListeners();
  }

  Future<void> delete(String id) async {
    await repository.moveToTrash(id);
    articles = await repository.list(text: searchText);
    trash = await repository.listTrash();
    notifyListeners();
  }

  Future<void> refreshTrash() async {
    trash = await repository.listTrash();
    notifyListeners();
  }

  Future<void> restoreTrash(String id) async {
    await repository.restoreFromTrash(id);
    articles = await repository.list(text: searchText);
    trash = await repository.listTrash();
    notifyListeners();
  }

  Future<void> deleteTrash(String id) async {
    await repository.deleteTrash(id);
    trash = await repository.listTrash();
    notifyListeners();
  }

  Future<List<Article>> listSnapshots(String id) =>
      repository.listSnapshots(id);

  Future<void> restoreSnapshot(String id, int revision) async {
    final Article? current = await repository.get(id);
    if (current == null) return;
    final Article restored = await repository.restoreSnapshot(id, revision,
        expectedCurrentRevision: current.localRevision);
    editorStore.replace(restored);
    articles = await repository.list(text: searchText);
    notifyListeners();
  }

  Future<void> deleteSnapshot(String id, int revision) async {
    await repository.deleteSnapshot(id, revision);
    notifyListeners();
  }

  Future<void> exportMarkdown(DocumentSession session) async {
    await exportDocument(
        session, document_export.DocumentExportFormat.markdown);
  }

  Future<void> exportDocument(DocumentSession session,
      document_export.DocumentExportFormat format) async {
    final document_export.ExportedDocument document =
        document_export.exportDocument(session.article, format);
    final String? savedPath = await platformServices.filePicker.saveFile(
        suggestedName: '${session.article.id}-${document.filename}',
        bytes: document.bytes);
    if (savedPath != null && savedPath.trim().isNotEmpty) {
      try {
        await platformServices.recentFiles
            .record(path: savedPath, title: session.article.title);
      } catch (error) {
        debugPrint('Recent file integration unavailable: $error');
      }
    }
  }

  Future<void> previewMarkdown(
      BuildContext context, DocumentSession session) async {
    final String markdown = session.article.body;
    if (platformServices.info.capabilities.supportsPreview) {
      try {
        await platformServices.preview.show(markdown);
        return;
      } on PlatformCapabilityException {
        // Tests, partial desktop builds and missing plugins use the same safe
        // in-app preview instead of turning preview into a hard failure.
      }
    }
    if (!context.mounted) return;
    await showDialog<void>(
        context: context,
        builder: (BuildContext dialogContext) => AlertDialog(
              title: Text(session.article.title.isEmpty
                  ? '预览'
                  : '预览 · ${session.article.title}'),
              content: SizedBox(
                  width: 760,
                  height: 560,
                  child: SingleChildScrollView(
                      padding: const EdgeInsets.all(12),
                      child: MarkdownPreview(markdown: markdown))),
              actions: <Widget>[
                TextButton(
                    onPressed: () => Navigator.of(dialogContext).pop(),
                    child: const Text('关闭')),
              ],
            ));
  }
}

class TuomoApp extends StatelessWidget {
  const TuomoApp({super.key, required this.controller});
  final WorkspaceController controller;

  @override
  Widget build(BuildContext context) => AnimatedBuilder(
      animation: controller,
      builder: (BuildContext context, Widget? child) {
        final ThemeMode mode = controller.preferences.nightMode
            ? ThemeMode.dark
            : switch (controller.preferences.theme) {
                WorkspaceTheme.system => ThemeMode.system,
                WorkspaceTheme.light => ThemeMode.light,
                WorkspaceTheme.dark => ThemeMode.dark,
              };
        return MaterialApp(
          title: '拓墨',
          theme: ThemeData(
              colorSchemeSeed: Colors.indigo,
              brightness: Brightness.light,
              useMaterial3: true),
          darkTheme: ThemeData(
              colorSchemeSeed: Colors.indigo,
              brightness: Brightness.dark,
              useMaterial3: true),
          themeMode: mode,
          home: child,
        );
      },
      child: WorkspaceScreen(controller: controller));
}

class WorkspaceScreen extends StatefulWidget {
  const WorkspaceScreen({super.key, required this.controller});
  final WorkspaceController controller;

  @override
  State<WorkspaceScreen> createState() => _WorkspaceScreenState();
}

class _WorkspaceScreenState extends State<WorkspaceScreen>
    with WidgetsBindingObserver {
  DocumentSession? session;
  int section = 0;
  Timer? periodicSave;
  bool recoveryScheduled = false;

  @override
  void initState() {
    super.initState();
    WidgetsBinding.instance.addObserver(this);
    unawaited(widget.controller.platformServices.fileDrop
        .initialize(_handleDroppedFile));
    unawaited(widget.controller.platformServices.quickNote
        .initialize(_handleQuickNoteRequested));
    periodicSave =
        Timer.periodic(const Duration(seconds: 30), (_) => _flushSessions());
  }

  @override
  void didChangeAppLifecycleState(AppLifecycleState state) {
    if (state == AppLifecycleState.paused ||
        state == AppLifecycleState.inactive ||
        state == AppLifecycleState.detached) {
      _flushSessions();
    }
  }

  void _flushSessions() {
    unawaited(widget.controller.editorStore
        .flushAll(widget.controller.repository)
        .catchError((Object _) {}));
  }

  Future<void> _handleDroppedFile(PickedFile file) async {
    try {
      session = await widget.controller.importPickedFile(file);
      if (mounted) _setState(() => section = 1);
    } catch (error) {
      if (mounted) {
        ScaffoldMessenger.of(context)
            .showSnackBar(SnackBar(content: Text('拖放导入失败：$error')));
      }
    }
  }

  Future<void> _handleQuickNoteRequested() async {
    if (!mounted) return;
    session = await widget.controller.createArticle();
    if (mounted) _setState(() => section = 1);
  }

  void _setState(VoidCallback callback) => setState(callback);

  Future<void> _showCommandPalette() async {
    final int? target = await showDialog<int>(
      context: context,
      builder: (BuildContext dialogContext) => AlertDialog(
        title: const Text('命令面板'),
        content: SizedBox(
          width: 420,
          child: ListView.builder(
            shrinkWrap: true,
            itemCount: _sectionTitles.length,
            itemBuilder: (BuildContext _, int index) => ListTile(
              leading: const Icon(Icons.arrow_forward),
              title: Text(_sectionTitles[index]),
              onTap: () => Navigator.of(dialogContext).pop(index),
            ),
          ),
        ),
        actions: <Widget>[
          TextButton(
            onPressed: () => Navigator.of(dialogContext).pop(),
            child: const Text('取消'),
          ),
        ],
      ),
    );
    if (target != null && mounted) _setState(() => section = target);
  }

  @override
  void dispose() {
    WidgetsBinding.instance.removeObserver(this);
    widget.controller.platformServices.fileDrop.dispose();
    widget.controller.platformServices.quickNote.dispose();
    periodicSave?.cancel();
    _flushSessions();
    super.dispose();
  }

  @override
  Widget build(BuildContext context) => AnimatedBuilder(
        animation: widget.controller,
        builder: (BuildContext context, Widget? child) {
          if (widget.controller.loading)
            return const Scaffold(
                body: Center(child: CircularProgressIndicator()));
          final DocumentSession? recovered =
              widget.controller.editorStore.active;
          if (session == null && recovered != null && !recoveryScheduled) {
            recoveryScheduled = true;
            WidgetsBinding.instance.addPostFrameCallback((_) {
              if (!mounted) return;
              setState(() {
                session = recovered;
                section = 1;
              });
            });
          }
          return CallbackShortcuts(
            bindings: <ShortcutActivator, VoidCallback>{
              const SingleActivator(LogicalKeyboardKey.keyK, control: true):
                  () => unawaited(_showCommandPalette()),
              const SingleActivator(LogicalKeyboardKey.keyK, meta: true): () =>
                  unawaited(_showCommandPalette()),
            },
            child: Focus(
              autofocus: true,
              child: Scaffold(
                appBar: AppBar(title: Text(_sectionTitle()), actions: <Widget>[
                  if (!widget.controller.preferences.focusMode)
                    IconButton(
                        onPressed: _showCommandPalette,
                        icon: const Icon(Icons.manage_search),
                        tooltip: '命令面板'),
                  if (widget.controller.preferences.focusMode)
                    IconButton(
                        onPressed: () => unawaited(widget.controller
                            .updatePreferences(widget.controller.preferences
                                .copyWith(focusMode: false))),
                        icon: const Icon(Icons.fullscreen_exit),
                        tooltip: '退出专注模式'),
                  if (section == 0)
                    IconButton(
                        onPressed: () async {
                          await _createQuickNote();
                        },
                        icon: const Icon(Icons.note_add_outlined),
                        tooltip: '快速笔记'),
                  if (section == 1 || section == 2)
                    IconButton(
                        onPressed: () async {
                          session = await widget.controller.createArticle();
                          setState(() {});
                        },
                        icon: const Icon(Icons.add),
                        tooltip: '新建文章'),
                  if (section == 1 || section == 2)
                    IconButton(
                        onPressed: () async {
                          try {
                            session = await widget.controller.importMarkdown();
                            if (mounted) setState(() {});
                          } catch (error) {
                            if (mounted) {
                              ScaffoldMessenger.of(context).showSnackBar(
                                  SnackBar(content: Text('导入失败：$error')));
                            }
                          }
                        },
                        icon: const Icon(Icons.file_open_outlined),
                        tooltip: '导入文档'),
                  if (section == 2)
                    IconButton(
                        onPressed: _showTrash,
                        icon: const Icon(Icons.delete_sweep_outlined),
                        tooltip: '回收站'),
                  if ((section == 1 || section == 2) && session != null)
                    IconButton(
                        onPressed: _showSnapshots,
                        icon: const Icon(Icons.history),
                        tooltip: '版本快照'),
                  if (!_isCompact(context) &&
                      !widget.controller.preferences.focusMode)
                    IconButton(
                        onPressed: () => unawaited(widget.controller
                            .updatePreferences(widget.controller.preferences
                                .copyWith(
                                    sidebarVisible: !widget.controller
                                        .preferences.sidebarVisible))),
                        icon: Icon(widget.controller.preferences.sidebarVisible
                            ? Icons.view_sidebar_outlined
                            : Icons.view_sidebar),
                        tooltip: widget.controller.preferences.sidebarVisible
                            ? '隐藏侧边栏'
                            : '显示侧边栏'),
                  if (_isCompact(context))
                    PopupMenuButton<int>(
                        tooltip: '全部功能',
                        onSelected: (int value) =>
                            setState(() => section = value),
                        itemBuilder: (BuildContext context) =>
                            List<PopupMenuEntry<int>>.generate(
                                _sectionTitles.length,
                                (int index) => PopupMenuItem<int>(
                                    value: index,
                                    child: Text(_sectionTitles[index]))))
                ]),
                body: widget.controller.preferences.focusMode
                    ? _content(context)
                    : _isCompact(context)
                        ? _compactBody(context)
                        : _wideBody(context),
                bottomNavigationBar: widget.controller.preferences.focusMode
                    ? null
                    : _isCompact(context)
                        ? _compactNavigation()
                        : null,
              ),
            ),
          );
        },
      );
}
