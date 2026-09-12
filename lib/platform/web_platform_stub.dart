import 'ports.dart';

PlatformPorts createWebPlatformPorts() => PlatformPorts(
      filePicker: _UnavailableFilePicker(),
      window: _UnavailableWindow(),
      quickNote: _UnavailableQuickNote(),
      preview: _UnavailablePreview(),
      remoteTools: _UnavailableRemoteTools(),
      workspace: const UnavailableWorkspaceRemote('web'),
      recentFiles: const UnavailableRecentFiles('web'),
    );

class _UnavailableFilePicker implements FilePickerPort {
  @override
  Future<PickedFile?> pickMarkdown() => Future<PickedFile?>.error(
      const PlatformCapabilityException('File picker', 'web'));

  @override
  Future<PickedFile?> pickImage() => Future<PickedFile?>.error(
      const PlatformCapabilityException('Image picker', 'web'));

  @override
  Future<String?> saveFile(
          {required String suggestedName, required List<int> bytes}) =>
      Future<String?>.error(
          const PlatformCapabilityException('File download', 'web'));
}

class _UnavailableRemoteTools implements RemoteToolsPort {
  @override
  Future<List<RssToolItem>> refreshRss(String url) =>
      Future<List<RssToolItem>>.error(
          const PlatformCapabilityException('RSS', 'web'));

  @override
  Future<LinkToolReport> checkLinks(String markdown) =>
      Future<LinkToolReport>.error(
          const PlatformCapabilityException('Link checker', 'web'));

  @override
  Future<ImageToolResult> uploadImage(
          {required String siteId,
          required PickedFile image,
          required String mimeType}) =>
      Future<ImageToolResult>.error(
          const PlatformCapabilityException('Image host', 'web'));
}

class _UnavailableWindow implements WindowPort {
  @override
  Future<void> setTitle(String title) => Future<void>.error(
      const PlatformCapabilityException('Window title', 'web'));

  @override
  Future<void> setSize({required double width, required double height}) =>
      Future<void>.error(
          const PlatformCapabilityException('Window size', 'web'));
}

class _UnavailableQuickNote implements QuickNotePort {
  @override
  Future<void> initialize(QuickNoteHandler handler) async {}

  @override
  void dispose() {}

  @override
  Future<void> openQuickNote() => Future<void>.error(
      const PlatformCapabilityException('Quick note', 'web'));
}

class _UnavailablePreview implements PreviewPort {
  @override
  Future<void> show(String markdown) =>
      Future<void>.error(const PlatformCapabilityException('Preview', 'web'));
}
