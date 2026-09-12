import 'package:flutter/foundation.dart';
import 'package:flutter/services.dart';

import 'ports.dart';
import 'web_platform_stub.dart' if (dart.library.html) 'web_platform.dart'
    as web;
import 'native_platform_stub.dart'
    if (dart.library.io) 'native_platform_io.dart' as native;

enum TuomoPlatform { mobile, desktop, web }

class PlatformAdapterInfo {
  const PlatformAdapterInfo(
      {required this.platform, required this.capabilities});
  final TuomoPlatform platform;
  final PlatformCapabilities capabilities;
}

class PlatformServices {
  const PlatformServices(
      {required this.info,
      required this.filePicker,
      required this.window,
      required this.quickNote,
      required this.preview,
      required this.remoteTools,
      WorkspaceRemotePort? workspace,
      FileDropPort? fileDrop,
      RecentFilesPort? recentFiles})
      : workspace = workspace ?? const UnavailableWorkspaceRemote('platform'),
        fileDrop = fileDrop ?? const UnavailableFileDrop('platform'),
        recentFiles = recentFiles ?? const UnavailableRecentFiles('platform');
  final PlatformAdapterInfo info;
  final FilePickerPort filePicker;
  final WindowPort window;
  final QuickNotePort quickNote;
  final PreviewPort preview;
  final RemoteToolsPort remoteTools;
  final WorkspaceRemotePort workspace;
  final FileDropPort fileDrop;
  final RecentFilesPort recentFiles;
}

PlatformAdapterInfo platformInfo(TuomoPlatform platform) => PlatformAdapterInfo(
      platform: platform,
      capabilities: PlatformCapabilities(
        // The Flutter shell does not own the Node stdio process transport.
        // Desktop stdio remains an application/service adapter capability.
        supportsStdio: false,
        supportsNativePaths: platform != TuomoPlatform.web,
        supportsQuickNote: platform != TuomoPlatform.web,
        supportsFilePicker: platform == TuomoPlatform.web ||
            platform == TuomoPlatform.mobile ||
            platform == TuomoPlatform.desktop,
        supportsWindow: platform == TuomoPlatform.desktop,
        // Native runners provide a modal safe-text preview; Dart still falls
        // back to the in-app Markdown preview when a plugin is unavailable.
        supportsPreview: true,
      ),
    );

TuomoPlatform _currentPlatform() {
  if (kIsWeb) return TuomoPlatform.web;
  return switch (defaultTargetPlatform) {
    TargetPlatform.android || TargetPlatform.iOS => TuomoPlatform.mobile,
    _ => TuomoPlatform.desktop,
  };
}

PlatformServices createPlatformServices() {
  final PlatformAdapterInfo info = platformInfo(_currentPlatform());
  if (kIsWeb) {
    final PlatformPorts ports = web.createWebPlatformPorts();
    return PlatformServices(
        info: info,
        filePicker: ports.filePicker,
        window: ports.window,
        quickNote: ports.quickNote,
        preview: ports.preview,
        remoteTools: ports.remoteTools,
        workspace: ports.workspace,
        fileDrop: ports.fileDrop,
        recentFiles: ports.recentFiles);
  }
  const MethodChannel channel = MethodChannel('tuomo/platform');
  const String apiBaseUrl = String.fromEnvironment('TUOMO_API_BASE_URL');
  final MethodChannelPlatformEvents events =
      MethodChannelPlatformEvents(channel);
  final MethodChannelQuickNotePort quickNote =
      MethodChannelQuickNotePort(channel, info.platform, events: events);
  return PlatformServices(
      info: info,
      filePicker: MethodChannelFilePickerPort(channel, info.platform),
      window: MethodChannelWindowPort(channel, info.platform),
      quickNote: quickNote,
      preview: MethodChannelPreviewPort(channel, info.platform),
      remoteTools:
          native.createNativeRemoteTools(apiBaseUrl, info.platform.name),
      workspace: native.createNativeWorkspace(apiBaseUrl, info.platform.name),
      fileDrop:
          MethodChannelFileDropPort(channel, info.platform, events: events),
      recentFiles: MethodChannelRecentFilesPort(channel, info.platform));
}

class MethodChannelPlatformEvents {
  MethodChannelPlatformEvents(this.channel);

  final MethodChannel channel;
  FileDropHandler? fileDropHandler;
  QuickNoteHandler? quickNoteHandler;
  bool _started = false;

  Future<void> start() async {
    if (_started) return;
    _started = true;
    channel.setMethodCallHandler((MethodCall call) async {
      if (call.method == 'fileDropped') {
        final PickedFile? file = _decodeFile(call.arguments);
        if (file != null) await fileDropHandler?.call(file);
      } else if (call.method == 'quickNoteRequested') {
        await quickNoteHandler?.call();
      }
      return null;
    });
    channel.invokeMethod<void>('platformEventsReady').catchError((Object _) {
      // Partial runner builds may not expose a native event handshake.
    });
  }

  void removeFileDropHandler() {
    fileDropHandler = null;
  }

  void removeQuickNoteHandler() {
    quickNoteHandler = null;
  }

  static PickedFile? _decodeFile(Object? value) {
    if (value is! Map) return null;
    final Object? name = value['name'];
    final Object? bytes = value['bytes'];
    if (name is! String) return null;
    final String? path = value['path'] as String?;
    if (bytes is Uint8List) {
      return PickedFile(name: name, bytes: bytes, path: path);
    }
    if (bytes is List) {
      return PickedFile(
          name: name, bytes: Uint8List.fromList(bytes.cast<int>()), path: path);
    }
    return null;
  }
}

class MethodChannelFilePickerPort implements FilePickerPort {
  const MethodChannelFilePickerPort(this.channel, this.platform);
  final MethodChannel channel;
  final TuomoPlatform platform;

  @override
  Future<PickedFile?> pickMarkdown() async {
    return _pick('pickMarkdown', 'Markdown file picker');
  }

  @override
  Future<PickedFile?> pickImage() async {
    return _pick('pickImage', 'Image picker');
  }

  Future<PickedFile?> _pick(String method, String operation) async {
    try {
      final Object? value = await channel.invokeMethod<Object?>(method);
      if (value == null) return null;
      if (value is Map) {
        final Object? name = value['name'];
        final Object? bytes = value['bytes'];
        if (name is String) {
          if (bytes is Uint8List) {
            return PickedFile(
                name: name, bytes: bytes, path: value['path'] as String?);
          }
          if (bytes is List) {
            return PickedFile(
                name: name,
                bytes: Uint8List.fromList(bytes.cast<int>()),
                path: value['path'] as String?);
          }
        }
      }
      throw const FormatException('Invalid platform file picker response');
    } on MissingPluginException {
      throw PlatformCapabilityException(operation, platform.name);
    }
  }

  @override
  Future<String?> saveFile(
      {required String suggestedName, required List<int> bytes}) async {
    try {
      return await channel.invokeMethod<String>('saveFile', <String, Object?>{
        'suggestedName': suggestedName,
        'bytes': Uint8List.fromList(bytes),
      });
    } on MissingPluginException {
      throw PlatformCapabilityException('File save dialog', platform.name);
    }
  }
}

class MethodChannelFileDropPort implements FileDropPort {
  MethodChannelFileDropPort(this.channel, this.platform, {this.events});

  final MethodChannel channel;
  final TuomoPlatform platform;
  final MethodChannelPlatformEvents? events;
  FileDropHandler? _handler;

  @override
  Future<void> initialize(FileDropHandler handler) async {
    _handler = handler;
    if (events != null) {
      events!.fileDropHandler = handler;
      await events!.start();
      return;
    }
    channel.setMethodCallHandler((MethodCall call) async {
      if (call.method != 'fileDropped') return null;
      final PickedFile? file = _decode(call.arguments);
      if (file != null) await _handler?.call(file);
      return null;
    });
  }

  @override
  void dispose() {
    _handler = null;
    if (events != null) {
      events!.removeFileDropHandler();
      return;
    }
    channel.setMethodCallHandler(null);
  }

  PickedFile? _decode(Object? value) {
    if (value is! Map) return null;
    final Object? name = value['name'];
    final Object? bytes = value['bytes'];
    if (name is! String) return null;
    final String? path = value['path'] as String?;
    if (bytes is Uint8List) {
      return PickedFile(name: name, bytes: bytes, path: path);
    }
    if (bytes is List) {
      return PickedFile(
          name: name, bytes: Uint8List.fromList(bytes.cast<int>()), path: path);
    }
    return null;
  }
}

class MethodChannelRemoteToolsPort implements RemoteToolsPort {
  const MethodChannelRemoteToolsPort(this.channel, this.platform);
  final MethodChannel channel;
  final TuomoPlatform platform;

  @override
  Future<List<RssToolItem>> refreshRss(String url) async {
    final Object? value =
        await _invoke('refreshRss', <String, Object?>{'url': url});
    if (value is! List) throw const FormatException('Invalid RSS response');
    return value
        .whereType<Map<Object?, Object?>>()
        .map((Map<Object?, Object?> item) => RssToolItem(
            title: item['title'] as String? ?? '',
            link: item['link'] as String?,
            publishedAt: item['publishedAt'] as String?))
        .toList();
  }

  @override
  Future<LinkToolReport> checkLinks(String markdown) async {
    final Object? value =
        await _invoke('checkLinks', <String, Object?>{'markdown': markdown});
    if (value is! Map)
      throw const FormatException('Invalid link checker response');
    final Object? values = value['results'];
    return LinkToolReport(
        results: values is List<Object?>
            ? values
                .whereType<Map<Object?, Object?>>()
                .map((Map<Object?, Object?> item) => LinkToolResult(
                    url: item['url'] as String? ?? '',
                    ok: item['ok'] == true,
                    status: item['status'] as int?,
                    error: item['error'] as String?))
                .toList()
            : <LinkToolResult>[],
        cancelled: value['cancelled'] == true);
  }

  @override
  Future<ImageToolResult> uploadImage(
      {required String siteId,
      required PickedFile image,
      required String mimeType}) async {
    final Object? value = await _invoke('uploadImage', <String, Object?>{
      'siteId': siteId,
      'filename': image.name,
      'mimeType': mimeType,
      'bytes': image.bytes
    });
    if (value is! Map)
      throw const FormatException('Invalid image host response');
    final Object? result = value['result'];
    return ImageToolResult(
        ok: value['ok'] == true,
        markdownUrl: result is Map ? result['markdownUrl'] as String? : null,
        error: value['error'] as String?);
  }

  Future<Object?> _invoke(String method, Map<String, Object?> arguments) async {
    try {
      return await channel.invokeMethod<Object?>(method, arguments);
    } on MissingPluginException {
      throw PlatformCapabilityException(method, platform.name);
    }
  }
}

class MethodChannelWindowPort implements WindowPort {
  const MethodChannelWindowPort(this.channel, this.platform);
  final MethodChannel channel;
  final TuomoPlatform platform;

  @override
  Future<void> setTitle(String title) =>
      _invoke('setWindowTitle', <String, Object?>{'title': title});

  @override
  Future<void> setSize({required double width, required double height}) =>
      _invoke(
          'setWindowSize', <String, Object?>{'width': width, 'height': height});

  Future<void> _invoke(String method, Map<String, Object?> arguments) async {
    try {
      await channel.invokeMethod<void>(method, arguments);
    } on MissingPluginException {
      throw PlatformCapabilityException(method, platform.name);
    }
  }
}

class MethodChannelQuickNotePort implements QuickNotePort {
  const MethodChannelQuickNotePort(this.channel, this.platform, {this.events});
  final MethodChannel channel;
  final TuomoPlatform platform;
  final MethodChannelPlatformEvents? events;

  @override
  Future<void> initialize(QuickNoteHandler handler) async {
    if (events != null) {
      events!.quickNoteHandler = handler;
      await events!.start();
      return;
    }
    channel.setMethodCallHandler((MethodCall call) async {
      if (call.method == 'quickNoteRequested') await handler();
      return null;
    });
  }

  @override
  void dispose() {
    if (events != null) {
      events!.removeQuickNoteHandler();
    } else {
      channel.setMethodCallHandler(null);
    }
  }

  @override
  Future<void> openQuickNote() async {
    try {
      await channel.invokeMethod<void>('openQuickNote');
    } on MissingPluginException {
      throw PlatformCapabilityException('Quick note', platform.name);
    }
  }
}

class MethodChannelPreviewPort implements PreviewPort {
  const MethodChannelPreviewPort(this.channel, this.platform);
  final MethodChannel channel;
  final TuomoPlatform platform;

  @override
  Future<void> show(String markdown) async {
    try {
      await channel.invokeMethod<void>(
          'showPreview', <String, Object?>{'markdown': markdown});
    } on MissingPluginException {
      throw PlatformCapabilityException('Native preview', platform.name);
    }
  }
}

class MethodChannelRecentFilesPort implements RecentFilesPort {
  const MethodChannelRecentFilesPort(this.channel, this.platform);

  final MethodChannel channel;
  final TuomoPlatform platform;

  @override
  Future<void> record({required String path, String? title}) async {
    if (path.trim().isEmpty) return;
    try {
      await channel.invokeMethod<void>('recordRecentFile', <String, Object?>{
        'path': path,
        if (title != null && title.trim().isNotEmpty) 'title': title,
      });
    } on MissingPluginException {
      // Older/native partial runners simply do not expose OS recent files.
    }
  }
}
