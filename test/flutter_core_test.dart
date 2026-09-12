import 'dart:convert';
import 'dart:io';

import 'package:archive/archive.dart';
import 'package:flutter/material.dart';
import 'package:flutter/services.dart';
import 'package:flutter_test/flutter_test.dart';

import '../lib/application/article_repository.dart';
import '../lib/application/content_tools.dart' as content_tools;
import '../lib/application/document_export.dart';
import '../lib/application/editor_session.dart';
import '../lib/application/preferences.dart';
import '../lib/application/secret_store.dart';
import '../lib/domain/article.dart';
import '../lib/domain/front_matter_codec.dart';
import '../lib/infrastructure/json_file_article_repository.dart';
import '../lib/infrastructure/flutter_secure_secret_store.dart';
import '../lib/infrastructure/preferences_store_io.dart';
import '../lib/infrastructure/session_recovery_json.dart';
import '../lib/platform/capabilities.dart';
import '../lib/platform/ports.dart';
import '../lib/presentation/app.dart';
import '../lib/presentation/editor_pane.dart';

class _TestSecretStore implements SecretStore {
  final Map<String, String> values = <String, String>{};

  @override
  Future<SecretRef> put(String value, {String? id}) async {
    final String key = id ?? 'test-key';
    values[key] = value;
    return SecretRef(key);
  }

  @override
  Future<String?> get(SecretRef ref) async => values[ref.id];

  @override
  Future<void> delete(SecretRef ref) async => values.remove(ref.id);
}

class _FailingRepository extends MemoryArticleRepository {
  @override
  Future<List<Article>> list({String? text}) async {
    throw StateError('storage unavailable');
  }
}

class _NoopFilePicker implements FilePickerPort {
  @override
  Future<PickedFile?> pickMarkdown() async => null;

  @override
  Future<PickedFile?> pickImage() async => null;

  @override
  Future<String?> saveFile(
          {required String suggestedName, required List<int> bytes}) async =>
      suggestedName;
}

class _NoopWindow implements WindowPort {
  @override
  Future<void> setTitle(String title) async {}

  @override
  Future<void> setSize({required double width, required double height}) async {}
}

class _NoopQuickNote implements QuickNotePort {
  @override
  Future<void> openQuickNote() async {}

  @override
  Future<void> initialize(QuickNoteHandler handler) async {}

  @override
  void dispose() {}
}

class _NoopPreview implements PreviewPort {
  @override
  Future<void> show(String markdown) async {}
}

class _NoopRemoteTools implements RemoteToolsPort {
  @override
  Future<List<RssToolItem>> refreshRss(String url) async => <RssToolItem>[];

  @override
  Future<LinkToolReport> checkLinks(String markdown) async =>
      const LinkToolReport(results: <LinkToolResult>[], cancelled: false);

  @override
  Future<ImageToolResult> uploadImage(
          {required String siteId,
          required PickedFile image,
          required String mimeType}) async =>
      const ImageToolResult(ok: false, error: 'not configured');
}

PlatformServices _fallbackPreviewServices() => PlatformServices(
    info: const PlatformAdapterInfo(
        platform: TuomoPlatform.desktop,
        capabilities: PlatformCapabilities(
            supportsStdio: false,
            supportsNativePaths: false,
            supportsQuickNote: false,
            supportsFilePicker: true,
            supportsWindow: false,
            supportsPreview: false)),
    filePicker: _NoopFilePicker(),
    window: _NoopWindow(),
    quickNote: _NoopQuickNote(),
    preview: _NoopPreview(),
    remoteTools: _NoopRemoteTools());

void main() {
  test('Dart core preserves Article JSON and Front Matter unknown fields', () {
    final Article article = newArticle(id: 'a', title: 'Hello', body: 'Body');
    final Article restored = Article.fromJson(article.toJson());
    expect(restored.title, 'Hello');
    final FrontMatterDocument document = const FrontMatterCodec()
        .decode('---\ntitle: Hello\ncustom: keep\n---\n\nBody');
    expect(document.data['custom'], 'keep');
    expect(document.body, 'Body');
  });

  test('Dart content tools provide stats, TOC, formatting and replacement', () {
    const String markdown = '# 标题\n\nHello hello\n\n```dart\ncode\n```';
    final content_tools.MarkdownStats stats =
        content_tools.markdownStats(markdown);
    expect(stats.headings, 1);
    expect(stats.codeBlocks, 1);
    expect(content_tools.formatMarkdown('a  \n\n\nb'), 'a\n\nb\n');
    expect(
        content_tools
            .tableOfContents('# 标题\n## 子标题')
            .map((entry) => entry.anchor),
        <String>['标题', '子标题']);
    expect(content_tools.findAndReplace(markdown, 'hello', 'hi'),
        contains('hi hi'));
    expect(
        content_tools.htmlToMarkdown(
            '<h2>小节</h2><p>正文 &amp; 内容</p><ul><li>项目</li></ul>'),
        '## 小节\n\n正文 & 内容\n\n- 项目\n');
    final String xml = '''<?xml version="1.0"?>
<w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main"><w:body><w:p><w:r><w:t>第一段</w:t></w:r></w:p><w:p><w:r><w:t>第二段 &amp; 内容</w:t></w:r></w:p></w:body></w:document>''';
    final List<int> xmlBytes = utf8.encode(xml);
    final Archive archive = Archive()
      ..addFile(ArchiveFile('word/document.xml', xmlBytes.length, xmlBytes));
    final List<int> docx = ZipEncoder().encode(archive);
    expect(content_tools.docxToMarkdown(docx), '第一段\n\n第二段 & 内容\n');
    final Article article = newArticle(
        title: '导出',
        body:
            '# 正文\n\n[链接](https://example.com) ![图](https://example.com/a.png)');
    final ExportedDocument html =
        exportDocument(article, DocumentExportFormat.html);
    expect(utf8.decode(html.bytes), contains('<h1>正文</h1>'));
    expect(utf8.decode(html.bytes), contains('<a href="https://example.com"'));
    expect(utf8.decode(html.bytes),
        contains('<img src="https://example.com/a.png"'));
    final ExportedDocument pdf =
        exportDocument(article, DocumentExportFormat.pdf);
    expect(utf8.decode(pdf.bytes), startsWith('%PDF-1.4'));
    final ExportedDocument exportedDocx =
        exportDocument(article, DocumentExportFormat.docx);
    expect(exportedDocx.bytes.take(2), <int>[80, 75]);
    final ExportedDocument epub =
        exportDocument(article, DocumentExportFormat.epub);
    expect(epub.bytes.take(2), <int>[80, 75]);
    final Archive epubArchive = ZipDecoder().decodeBytes(epub.bytes);
    expect(epubArchive.findFile('mimetype')?.readBytes(),
        utf8.encode('application/epub+zip'));
    expect(epubArchive.findFile('mimetype')?.compression, CompressionType.none);
    final ExportedDocument png =
        exportDocument(article, DocumentExportFormat.png);
    expect(png.bytes.take(8), <int>[137, 80, 78, 71, 13, 10, 26, 10]);
  });

  test('Front Matter imports an article without dropping metadata', () {
    const String markdown =
        '---\ntitle: Imported\ntags: [one, two]\ncategories: notes\nkind: page\ncustom: keep\n---\n\nBody';
    final Article article =
        const FrontMatterCodec().articleFromMarkdown(markdown);
    expect(article.title, 'Imported');
    expect(article.metadata.kind, ArticleKind.page);
    expect(article.metadata.tags, <String>['one', 'two']);
    expect(article.metadata.categories, <String>['notes']);
    expect(article.metadata.extraFrontMatter['custom'], 'keep');
  });

  test('Dart editor session uses revision CAS and independent dirty state',
      () async {
    final MemoryArticleRepository repository = MemoryArticleRepository();
    final DocumentSession session =
        DocumentSession(newArticle(id: 'a', body: 'one'));
    await repository.put(session.article, expectedRevision: 0);
    session.edit(body: 'two');
    session.edit(title: 'Updated twice');
    expect(session.isDirty, isTrue);
    await session.save(repository);
    expect(session.status, SaveStatus.saved);
    expect((await repository.get(session.article.id))?.title, 'Updated twice');
  });

  test('editor recovery persists dirty sessions and clears after save',
      () async {
    final MemoryArticleRepository repository = MemoryArticleRepository();
    final Article article = newArticle(id: 'recoverable', body: 'saved');
    await repository.put(article, expectedRevision: 0);
    final MemorySessionRecoveryStore recovery = MemorySessionRecoveryStore();
    final EditorSessionStore first = EditorSessionStore(recovery: recovery);
    final DocumentSession session = first.open(article);
    session.edit(body: 'unsaved after restart');
    await Future<void>.delayed(Duration.zero);
    final EditorSessionStore second = EditorSessionStore(recovery: recovery);
    final DocumentSession restored = await second.openAndRecover(article);
    expect(restored.article.body, 'unsaved after restart');
    expect(restored.isDirty, isTrue);
    await session.save(repository);
    await Future<void>.delayed(Duration.zero);
    expect(await recovery.load(article.id), isNull);
  });

  test('native JSON session recovery survives a new store instance', () async {
    final Directory root =
        await Directory.systemTemp.createTemp('tuomo-session-');
    addTearDown(() => root.delete(recursive: true));
    final JsonFileSessionRecoveryStore first =
        JsonFileSessionRecoveryStore(root);
    final Article article = newArticle(id: 'native-recovery', body: 'draft');
    await first.save(
        article.id,
        SessionRecoverySnapshot(
            article: article, savedRevision: 0, savedTitle: '', savedBody: ''));
    final JsonFileSessionRecoveryStore second =
        JsonFileSessionRecoveryStore(root);
    expect((await second.load(article.id))?.article.body, 'draft');
    expect(second.load('../escape'), throwsFormatException);
  });

  test('JSON repository persists articles and moves deleted content to trash',
      () async {
    final Directory root = await Directory.systemTemp.createTemp('tuomo-test-');
    addTearDown(() => root.delete(recursive: true));
    final JsonFileArticleRepository repository =
        JsonFileArticleRepository(root);
    final Article article = newArticle(id: 'persistent', title: 'Persisted');

    await repository.put(article, expectedRevision: 0);
    expect((await repository.get(article.id))?.title, 'Persisted');
    await repository.exportMarkdown(article);
    expect(
        root
            .listSync(recursive: true)
            .whereType<File>()
            .any((File file) => file.path.contains('exports')),
        isTrue);
    expect(
        root
            .listSync(recursive: true)
            .whereType<File>()
            .any((File file) => file.path.contains('snapshots')),
        isTrue);
    expect((await repository.listSnapshots(article.id)).isNotEmpty, isTrue);
    final Article restored = await repository.restoreSnapshot(article.id, 1,
        expectedCurrentRevision: article.localRevision);
    expect(restored.localRevision, 2);
    await repository.moveToTrash(article.id);
    expect(await repository.get(article.id), isNull);
    expect(
      root
          .listSync(recursive: true)
          .whereType<File>()
          .any((File file) => file.path.contains('trash')),
      isTrue,
    );
    expect((await repository.listTrash()).single.id, article.id);
    await repository.restoreFromTrash(article.id);
    expect((await repository.get(article.id))?.title, 'Persisted');
    await repository.moveToTrash(article.id);
    await repository.deleteTrash(article.id);
    expect(await repository.listTrash(), isEmpty);
  });

  test('JSON repository rejects unsafe article ids', () async {
    final Directory root = await Directory.systemTemp.createTemp('tuomo-safe-');
    addTearDown(() => root.delete(recursive: true));
    final JsonFileArticleRepository repository =
        JsonFileArticleRepository(root);
    expect(repository.get('../escape'), throwsFormatException);
  });

  test('Dart memory repository rejects unsafe article ids', () async {
    final MemoryArticleRepository repository = MemoryArticleRepository();
    expect(repository.get('../escape'), throwsFormatException);
    expect(repository.moveToTrash('../escape'), throwsFormatException);
    expect(() => newArticle(id: '../escape'), throwsFormatException);
  });

  test('Dart article copyWith can explicitly clear optional metadata', () {
    final DateTime scheduled = DateTime.utc(2026, 1, 1);
    final Article article = newArticle(title: 'Clear').copyWith(
        metadata: const ArticleMetadata(
            cover: 'https://example.test/cover.png',
            slug: 'clear-me',
            templateId: 'template'),
        volume: 'volume',
        scheduleAt: scheduled);
    final Article cleared = article.copyWith(
        metadata: article.metadata
            .copyWith(cover: null, slug: null, templateId: null),
        volume: null,
        scheduleAt: null);
    expect(cleared.metadata.cover, isNull);
    expect(cleared.metadata.slug, isNull);
    expect(cleared.metadata.templateId, isNull);
    expect(cleared.volume, isNull);
    expect(cleared.scheduleAt, isNull);
  });

  test('workspace preferences round-trip and clamp unsafe editor sizes',
      () async {
    final RecentDocument recent = RecentDocument(
        id: 'recent', title: '最近文章', updatedAt: DateTime.utc(2026, 1, 2));
    final MemoryPreferencesStore store = MemoryPreferencesStore();
    final WorkspacePreferences value = const WorkspacePreferences(
        mode: WorkspaceMode.simple,
        theme: WorkspaceTheme.dark,
        nightMode: true,
        focusMode: true,
        typewriterMode: true,
        editorFontSize: 32,
        sidebarVisible: false,
        sidebarPinned: false);
    await store.save(value.copyWith(recentDocuments: <RecentDocument>[recent]));
    final WorkspacePreferences restored = await store.load();
    expect(restored.mode, WorkspaceMode.simple);
    expect(restored.theme, WorkspaceTheme.dark);
    expect(restored.nightMode, isTrue);
    expect(restored.focusMode, isTrue);
    expect(restored.typewriterMode, isTrue);
    expect(restored.sidebarVisible, isFalse);
    expect(restored.sidebarPinned, isFalse);
    expect(restored.recentDocuments.single.id, 'recent');
    expect(restored.recentDocuments.single.title, '最近文章');
    expect(
        WorkspacePreferences.fromJson(<String, Object?>{
          'editorFontSize': 999,
          'mode': 'unknown',
          'theme': 'unknown',
        }).editorFontSize,
        32);
  });

  test('native JSON preferences survive a new store instance', () async {
    final Directory root =
        await Directory.systemTemp.createTemp('tuomo-preferences-');
    addTearDown(() => root.delete(recursive: true));
    final File file =
        File('${root.path}${Platform.pathSeparator}preferences.json');
    final JsonPreferencesStore first = JsonPreferencesStore(file: file);
    await first.save(const WorkspacePreferences(
        mode: WorkspaceMode.simple, theme: WorkspaceTheme.dark));
    final JsonPreferencesStore second = JsonPreferencesStore(file: file);
    final WorkspacePreferences restored = await second.load();
    expect(restored.mode, WorkspaceMode.simple);
    expect(restored.theme, WorkspaceTheme.dark);
  });

  testWidgets('desktop file drop port decodes native document events',
      (WidgetTester tester) async {
    const MethodChannel channel = MethodChannel('test/tuomo/file-drop');
    final MethodChannelFileDropPort port =
        MethodChannelFileDropPort(channel, TuomoPlatform.desktop);
    PickedFile? dropped;
    await port.initialize((PickedFile file) async => dropped = file);
    await tester.binding.defaultBinaryMessenger.handlePlatformMessage(
      channel.name,
      const StandardMethodCodec()
          .encodeMethodCall(const MethodCall('fileDropped', <String, Object?>{
        'name': 'dropped.md',
        'bytes': <int>[35, 32, 84, 105, 116, 108, 101],
      })),
      (_) {},
    );
    await tester.pump();
    expect(dropped?.name, 'dropped.md');
    expect(dropped?.bytes,
        Uint8List.fromList(<int>[35, 32, 84, 105, 116, 108, 101]));
    port.dispose();
  });

  testWidgets('native quick-note events use the shared platform event router',
      (WidgetTester tester) async {
    const MethodChannel channel = MethodChannel('test/tuomo/quick-note');
    final MethodChannelPlatformEvents events =
        MethodChannelPlatformEvents(channel);
    final MethodChannelQuickNotePort port = MethodChannelQuickNotePort(
        channel, TuomoPlatform.mobile,
        events: events);
    int requests = 0;
    await port.initialize(() async => requests++);
    await tester.binding.defaultBinaryMessenger.handlePlatformMessage(
      channel.name,
      const StandardMethodCodec()
          .encodeMethodCall(const MethodCall('quickNoteRequested')),
      (_) {},
    );
    await tester.pump();
    expect(requests, 1);
    port.dispose();
  });

  test('secure secret store rejects unsafe references on read and delete', () {
    final FlutterSecureSecretStore store = FlutterSecureSecretStore();
    const SecretRef unsafe = SecretRef('../escape');
    expect(() => store.get(unsafe), throwsArgumentError);
    expect(() => store.delete(unsafe), throwsArgumentError);
  });

  testWidgets('Flutter Markdown preview renders common rich blocks',
      (WidgetTester tester) async {
    await tester.pumpWidget(const MaterialApp(
        home: Scaffold(
            body: SingleChildScrollView(child: MarkdownPreview(markdown: '''# 标题

| A | B |
| --- | --- |
| 1 | 2 |

1. 第一项
2. 第二项

> 引用

\$\$x^2\$\$

```mermaid
graph TD
```''')))));
    expect(find.text('标题'), findsOneWidget);
    expect(find.text('A'), findsOneWidget);
    expect(find.text('1.'), findsOneWidget);
    expect(find.text('引用'), findsOneWidget);
    expect(find.text('x^2'), findsOneWidget);
    expect(find.text('mermaid'), findsOneWidget);
  });

  testWidgets('Flutter workspace exposes navigation and real feature entries',
      (WidgetTester tester) async {
    final WorkspaceController controller = WorkspaceController(
        repository: MemoryArticleRepository(),
        secretStore: _TestSecretStore(),
        platformServices: _fallbackPreviewServices(),
        preferencesStore: MemoryPreferencesStore());
    await tester.pumpWidget(TuomoApp(controller: controller));
    await tester.pumpAndSettle();
    expect(find.text('首页'), findsOneWidget);
    expect(find.text('写作'), findsOneWidget);
    expect(find.text('发布'), findsOneWidget);
    await tester.tap(find.byTooltip('命令面板'));
    await tester.pumpAndSettle();
    expect(find.text('命令面板'), findsOneWidget);
    await tester.tap(find.text('取消'));
    await tester.pumpAndSettle();
    expect(find.text('离线优先写作工作台'), findsOneWidget);
    await tester.tap(find.byTooltip('快速笔记'));
    await tester.pumpAndSettle();
    expect(find.text('搜索草稿'), findsOneWidget);
    expect(find.byTooltip('打开预览'), findsOneWidget);
    await tester.tap(find.byTooltip('打开预览'));
    await tester.pumpAndSettle();
    expect(find.text('关闭'), findsOneWidget);
    await tester.tap(find.text('关闭'));
    await tester.pumpAndSettle();
    await tester.tap(find.text('发布'));
    await tester.pumpAndSettle();
    expect(find.text('发布中心'), findsWidgets);
    expect(find.text('远程站点服务不可用'), findsOneWidget);
    await tester.tap(find.text('全部功能'));
    await tester.pumpAndSettle();
    expect(find.text('全部功能'), findsWidgets);
    expect(find.text('本地写作与数据'), findsOneWidget);
    await tester.tap(find.text('工具'));
    await tester.pumpAndSettle();
    expect(find.text('上传图片并插入'), findsOneWidget);
    expect(find.text('刷新 RSS'), findsOneWidget);
    await tester.tap(find.text('设置').first);
    await tester.pumpAndSettle();
    expect(find.text('设置与安全'), findsWidgets);
    await tester.tap(find.byType(SwitchListTile).first);
    await tester.pumpAndSettle();
    expect(controller.preferences.mode, WorkspaceMode.simple);
    controller.dispose();
  });

  testWidgets(
      'Flutter workspace degrades storage failures without blocking the editor',
      (WidgetTester tester) async {
    final WorkspaceController controller = WorkspaceController(
        repository: _FailingRepository(),
        secretStore: _TestSecretStore(),
        preferencesStore: MemoryPreferencesStore());
    await tester.pumpWidget(TuomoApp(controller: controller));
    await tester.pumpAndSettle();
    expect(find.text('已启用安全降级'), findsOneWidget);
    expect(controller.articles, isNotEmpty);
    controller.dispose();
  });
}
