import 'dart:typed_data';

import '../domain/article.dart';

class PickedFile {
  const PickedFile({required this.name, required this.bytes, this.path});

  final String name;
  final Uint8List bytes;

  /// Native source path/URI when the platform can provide one.
  final String? path;
}

abstract interface class FilePickerPort {
  Future<PickedFile?> pickMarkdown();
  Future<PickedFile?> pickImage();
  Future<String?> saveFile(
      {required String suggestedName, required List<int> bytes});
}

typedef FileDropHandler = Future<void> Function(PickedFile file);

abstract interface class FileDropPort {
  Future<void> initialize(FileDropHandler handler);
  void dispose();
}

abstract interface class RecentFilesPort {
  Future<void> record({required String path, String? title});
}

class UnavailableRecentFiles implements RecentFilesPort {
  const UnavailableRecentFiles(this.platform);

  final String platform;

  @override
  Future<void> record({required String path, String? title}) async {}
}

class UnavailableFileDrop implements FileDropPort {
  const UnavailableFileDrop(this.platform);

  final String platform;

  @override
  Future<void> initialize(FileDropHandler handler) async {}

  @override
  void dispose() {}
}

class RssToolItem {
  const RssToolItem({required this.title, this.link, this.publishedAt});
  final String title;
  final String? link;
  final String? publishedAt;
}

class LinkToolResult {
  const LinkToolResult(
      {required this.url, required this.ok, this.status, this.error});
  final String url;
  final bool ok;
  final int? status;
  final String? error;
}

class LinkToolReport {
  const LinkToolReport({required this.results, required this.cancelled});
  final List<LinkToolResult> results;
  final bool cancelled;
}

class ImageToolResult {
  const ImageToolResult({required this.ok, this.markdownUrl, this.error});
  final bool ok;
  final String? markdownUrl;
  final String? error;
}

class WorkspaceSite {
  const WorkspaceSite({
    required this.id,
    required this.name,
    required this.kind,
    this.url,
    this.active = false,
  });

  final String id;
  final String name;
  final String kind;
  final String? url;
  final bool active;

  factory WorkspaceSite.fromJson(Map<Object?, Object?> value) => WorkspaceSite(
        id: value['id'] as String? ?? '',
        name: value['name'] as String? ?? value['id'] as String? ?? '',
        kind: value['kind'] as String? ?? 'unknown',
        url: value['url'] as String?,
        active: value['active'] == true,
      );
}

class WorkspaceOperationResult {
  const WorkspaceOperationResult({required this.ok, this.message, this.data});

  final bool ok;
  final String? message;
  final Object? data;
}

class WorkspaceAiResult {
  const WorkspaceAiResult({required this.ok, this.text = '', this.message});

  final bool ok;
  final String text;
  final String? message;
}

abstract interface class WorkspaceRemotePort {
  Future<List<WorkspaceSite>> listSites();

  Future<WorkspaceOperationResult> publishArticle({
    required Article article,
    required List<String> siteIds,
    required bool confirm,
  });

  Future<WorkspaceOperationResult> buildSite(String siteId);

  Future<WorkspaceOperationResult> provisionSite({
    required String provider,
    required String owner,
    required String repository,
    required String framework,
    required String mode,
    required String welcomePost,
  });

  Future<WorkspaceAiResult> quickWrite({
    required String action,
    required String text,
    String? instruction,
  });
}

class UnavailableWorkspaceRemote implements WorkspaceRemotePort {
  const UnavailableWorkspaceRemote(this.platform);

  final String platform;

  @override
  Future<List<WorkspaceSite>> listSites() => Future<List<WorkspaceSite>>.error(
        PlatformCapabilityException('Site service', platform),
      );

  @override
  Future<WorkspaceOperationResult> publishArticle({
    required Article article,
    required List<String> siteIds,
    required bool confirm,
  }) =>
      Future<WorkspaceOperationResult>.error(
        PlatformCapabilityException('Publish service', platform),
      );

  @override
  Future<WorkspaceOperationResult> buildSite(String siteId) =>
      Future<WorkspaceOperationResult>.error(
        PlatformCapabilityException('Site build', platform),
      );

  @override
  Future<WorkspaceOperationResult> provisionSite({
    required String provider,
    required String owner,
    required String repository,
    required String framework,
    required String mode,
    required String welcomePost,
  }) =>
      Future<WorkspaceOperationResult>.error(
        PlatformCapabilityException('Site provisioning', platform),
      );

  @override
  Future<WorkspaceAiResult> quickWrite({
    required String action,
    required String text,
    String? instruction,
  }) =>
      Future<WorkspaceAiResult>.error(
        PlatformCapabilityException('AI quick writing', platform),
      );
}

abstract interface class RemoteToolsPort {
  Future<List<RssToolItem>> refreshRss(String url);
  Future<LinkToolReport> checkLinks(String markdown);
  Future<ImageToolResult> uploadImage(
      {required String siteId,
      required PickedFile image,
      required String mimeType});
}

class UnavailableRemoteTools implements RemoteToolsPort {
  const UnavailableRemoteTools(this.platform);

  final String platform;

  @override
  Future<List<RssToolItem>> refreshRss(String url) =>
      Future<List<RssToolItem>>.error(
        PlatformCapabilityException('RSS service', platform),
      );

  @override
  Future<LinkToolReport> checkLinks(String markdown) =>
      Future<LinkToolReport>.error(
        PlatformCapabilityException('Link checker', platform),
      );

  @override
  Future<ImageToolResult> uploadImage({
    required String siteId,
    required PickedFile image,
    required String mimeType,
  }) =>
      Future<ImageToolResult>.error(
        PlatformCapabilityException('Image host', platform),
      );
}

abstract interface class WindowPort {
  Future<void> setTitle(String title);
  Future<void> setSize({required double width, required double height});
}

abstract interface class QuickNotePort {
  Future<void> openQuickNote();

  Future<void> initialize(QuickNoteHandler handler) async {}

  void dispose() {}
}

typedef QuickNoteHandler = Future<void> Function();

abstract interface class PreviewPort {
  Future<void> show(String markdown);
}

class PlatformPorts {
  const PlatformPorts({
    required this.filePicker,
    required this.window,
    required this.quickNote,
    required this.preview,
    required this.remoteTools,
    required this.workspace,
    this.fileDrop = const UnavailableFileDrop('platform'),
    this.recentFiles = const UnavailableRecentFiles('platform'),
  });

  final FilePickerPort filePicker;
  final WindowPort window;
  final QuickNotePort quickNote;
  final PreviewPort preview;
  final RemoteToolsPort remoteTools;
  final WorkspaceRemotePort workspace;
  final FileDropPort fileDrop;
  final RecentFilesPort recentFiles;
}

class PlatformCapabilityException implements Exception {
  const PlatformCapabilityException(this.operation, this.platform);
  final String operation;
  final String platform;

  @override
  String toString() => '$operation is unavailable on $platform';
}

class PlatformCapabilities {
  const PlatformCapabilities(
      {required this.supportsStdio,
      required this.supportsNativePaths,
      required this.supportsQuickNote,
      required this.supportsFilePicker,
      required this.supportsWindow,
      required this.supportsPreview});
  final bool supportsStdio;
  final bool supportsNativePaths;
  final bool supportsQuickNote;
  final bool supportsFilePicker;
  final bool supportsWindow;
  final bool supportsPreview;
}
