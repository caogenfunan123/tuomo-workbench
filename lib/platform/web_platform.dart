// ignore_for_file: deprecated_member_use
import 'dart:async';
import 'dart:convert';
import 'dart:html' as html;
import 'dart:typed_data';

import '../domain/article.dart';
import 'ports.dart';

PlatformPorts createWebPlatformPorts() => PlatformPorts(
      filePicker: _BrowserFilePicker(),
      window: _BrowserWindow(),
      quickNote: _BrowserQuickNote(),
      preview: _BrowserPreview(),
      remoteTools: _BrowserRemoteTools(),
      workspace: _BrowserWorkspace(),
      fileDrop: _BrowserFileDrop(),
      recentFiles: _BrowserRecentFiles(),
    );

class _BrowserFilePicker implements FilePickerPort {
  @override
  Future<PickedFile?> pickMarkdown() => _pick(
      '.md,.markdown,.html,.htm,.docx,text/markdown,text/html,application/vnd.openxmlformats-officedocument.wordprocessingml.document,text/plain');

  @override
  Future<PickedFile?> pickImage() => _pick('image/*');

  Future<PickedFile?> _pick(String accept) async {
    final html.FileUploadInputElement input = html.FileUploadInputElement()
      ..accept = accept;
    final Completer<PickedFile?> result = Completer<PickedFile?>();
    input.onChange.first.then((_) {
      final List<html.File>? files = input.files;
      final html.File? file =
          files != null && files.isNotEmpty ? files.first : null;
      if (file == null) {
        result.complete(null);
        return;
      }
      final html.FileReader reader = html.FileReader();
      reader.onLoad.first.then((_) {
        if (result.isCompleted) return;
        final Object? value = reader.result;
        if (value is ByteBuffer) {
          result.complete(
              PickedFile(name: file.name, bytes: Uint8List.view(value)));
        } else {
          result.completeError(
              const FormatException('Unable to read selected Markdown file'));
        }
      });
      reader.onError.first.then((_) {
        if (!result.isCompleted) {
          result.completeError(
              const FormatException('Unable to read selected Markdown file'));
        }
      });
      reader.readAsArrayBuffer(file);
    });
    input.click();
    return result.future;
  }

  @override
  Future<String?> saveFile(
      {required String suggestedName, required List<int> bytes}) async {
    final html.Blob blob = html.Blob(
        <Object>[Uint8List.fromList(bytes)], 'application/octet-stream');
    final String url = html.Url.createObjectUrlFromBlob(blob);
    final html.AnchorElement anchor = html.AnchorElement(href: url)
      ..download = suggestedName
      ..style.display = 'none';
    html.document.body?.children.add(anchor);
    anchor.click();
    anchor.remove();
    html.Url.revokeObjectUrl(url);
    return suggestedName;
  }
}

class _BrowserFileDrop implements FileDropPort {
  StreamSubscription<html.MouseEvent>? _dragOver;
  StreamSubscription<html.MouseEvent>? _drop;
  FileDropHandler? _handler;

  @override
  Future<void> initialize(FileDropHandler handler) async {
    _handler = handler;
    _dragOver = html.document.onDragOver.listen((html.MouseEvent event) {
      event.preventDefault();
    });
    _drop = html.document.onDrop.listen((html.MouseEvent event) {
      event.preventDefault();
      final List<html.File>? files = event.dataTransfer.files;
      final html.File? file =
          files != null && files.isNotEmpty ? files.first : null;
      if (file != null && _isDocument(file.name)) {
        unawaited(_read(file));
      }
    });
  }

  @override
  void dispose() {
    _handler = null;
    _dragOver?.cancel();
    _drop?.cancel();
    _dragOver = null;
    _drop = null;
  }

  Future<void> _read(html.File file) async {
    final html.FileReader reader = html.FileReader();
    final Completer<Uint8List> result = Completer<Uint8List>();
    reader.onLoad.first.then((_) {
      final Object? value = reader.result;
      if (value is ByteBuffer) {
        result.complete(Uint8List.view(value));
      } else {
        result.completeError(const FormatException('无法读取拖放文件'));
      }
    });
    reader.onError.first.then((_) {
      if (!result.isCompleted)
        result.completeError(const FormatException('无法读取拖放文件'));
    });
    reader.readAsArrayBuffer(file);
    try {
      final Uint8List bytes = await result.future;
      await _handler?.call(PickedFile(name: file.name, bytes: bytes));
    } catch (_) {
      // The workspace reports import errors for files that reached the app.
    }
  }

  bool _isDocument(String name) => <String>{
        'md',
        'markdown',
        'html',
        'htm',
        'docx',
        'txt'
      }.contains(name.toLowerCase().split('.').last);
}

class _BrowserRemoteTools implements RemoteToolsPort {
  @override
  Future<List<RssToolItem>> refreshRss(String url) async {
    final List<dynamic> values =
        (await _request('/api/tools/rss?url=${Uri.encodeQueryComponent(url)}')
            as List<dynamic>);
    return values
        .map((dynamic value) => RssToolItem(
            title: value['title'] as String? ?? '',
            link: value['link'] as String?,
            publishedAt: value['publishedAt'] as String?))
        .toList();
  }

  @override
  Future<LinkToolReport> checkLinks(String markdown) async {
    final Map<String, dynamic> value = (await _request('/api/tools/links',
        method: 'POST',
        body: <String, Object?>{'markdown': markdown}) as Map<String, dynamic>);
    final List<dynamic> values =
        value['results'] as List<dynamic>? ?? <dynamic>[];
    return LinkToolReport(
        results: values
            .map((dynamic item) => LinkToolResult(
                url: item['url'] as String? ?? '',
                ok: item['ok'] == true,
                status: item['status'] as int?,
                error: item['error'] as String?))
            .toList(),
        cancelled: value['cancelled'] == true);
  }

  @override
  Future<ImageToolResult> uploadImage(
      {required String siteId,
      required PickedFile image,
      required String mimeType}) async {
    final Map<String, dynamic> value = (await _request('/api/tools/image',
        method: 'POST',
        body: <String, Object?>{
          'siteId': siteId,
          'filename': image.name,
          'mimeType': mimeType,
          'bytesBase64': base64Encode(image.bytes)
        }) as Map<String, dynamic>);
    final Map<String, dynamic>? result =
        value['result'] as Map<String, dynamic>?;
    return ImageToolResult(
        ok: value['ok'] == true,
        markdownUrl: result?['markdownUrl'] as String?,
        error: value['error'] as String?);
  }

  Future<dynamic> _request(String path,
      {String method = 'GET', Map<String, Object?>? body}) async {
    final html.HttpRequest response = await html.HttpRequest.request(path,
        method: method,
        sendData: body == null ? null : jsonEncode(body),
        requestHeaders: body == null
            ? null
            : <String, String>{'content-type': 'application/json'});
    if ((response.status ?? 500) < 200 || (response.status ?? 500) >= 300)
      throw StateError(response.responseText ?? '请求失败');
    return jsonDecode(response.responseText ?? 'null');
  }
}

class _BrowserWorkspace implements WorkspaceRemotePort {
  @override
  Future<List<WorkspaceSite>> listSites() async {
    final Map<String, dynamic> value =
        await _request('/api/sites') as Map<String, dynamic>;
    final List<dynamic> sites = value['sites'] as List<dynamic>? ?? <dynamic>[];
    return sites
        .whereType<Map<String, dynamic>>()
        .map(WorkspaceSite.fromJson)
        .toList();
  }

  @override
  Future<WorkspaceOperationResult> publishArticle({
    required Article article,
    required List<String> siteIds,
    required bool confirm,
  }) async {
    if (siteIds.isEmpty) {
      return const WorkspaceOperationResult(ok: false, message: '至少选择一个静态站点');
    }
    final Map<String, dynamic> created =
        await _request('/api/articles', method: 'POST', body: <String, Object?>{
      'title': article.title,
      'body': article.body,
      'volume': article.volume,
      'scheduleAt': article.scheduleAt?.toIso8601String(),
      'published': article.published,
      'metadata': article.metadata.toJson(),
    }) as Map<String, dynamic>;
    final String? id = created['id'] as String?;
    if (id == null || id.isEmpty) {
      return const WorkspaceOperationResult(ok: false, message: '远端文章创建未返回 ID');
    }
    final Object data = (await _request(
        '/api/articles/${Uri.encodeComponent(id)}/publish/${confirm ? 'confirm' : 'preview'}',
        method: 'POST',
        body: <String, Object?>{
          'kind': 'static',
          'siteIds': siteIds,
          if (confirm) 'confirmed': true,
        })) as Object;
    return WorkspaceOperationResult(ok: true, data: data);
  }

  @override
  Future<WorkspaceOperationResult> buildSite(String siteId) async {
    final Object data = (await _request(
        '/api/sites/${Uri.encodeComponent(siteId)}/build',
        method: 'POST',
        body: <String, Object?>{})) as Object;
    return WorkspaceOperationResult(ok: true, data: data);
  }

  @override
  Future<WorkspaceOperationResult> provisionSite({
    required String provider,
    required String owner,
    required String repository,
    required String framework,
    required String mode,
    required String welcomePost,
  }) async {
    final Object data = (await _request('/api/sites/provision',
        method: 'POST',
        body: <String, Object?>{
          'provider': provider,
          'owner': owner,
          'repository': repository,
          'framework': framework,
          'mode': mode,
          'welcomePost': welcomePost,
        })) as Object;
    return WorkspaceOperationResult(ok: true, data: data);
  }

  @override
  Future<WorkspaceAiResult> quickWrite({
    required String action,
    required String text,
    String? instruction,
  }) async {
    final Object value = (await _request('/api/ai/quick',
        method: 'POST',
        body: <String, Object?>{
          'action': action,
          'text': text,
          if (instruction != null && instruction.trim().isNotEmpty)
            'instruction': instruction,
        })) as Object;
    if (value is! Map<String, dynamic>) {
      return const WorkspaceAiResult(ok: false, message: 'AI 返回格式无效');
    }
    return WorkspaceAiResult(
        ok: value['ok'] == true,
        text: value['text'] as String? ?? '',
        message: value['error'] as String?);
  }

  Future<dynamic> _request(String path,
      {String method = 'GET', Map<String, Object?>? body}) async {
    final html.HttpRequest response = await html.HttpRequest.request(path,
        method: method,
        sendData: body == null ? null : jsonEncode(body),
        requestHeaders: body == null
            ? null
            : <String, String>{'content-type': 'application/json'});
    if ((response.status ?? 500) < 200 || (response.status ?? 500) >= 300) {
      throw StateError(response.responseText ?? '请求失败');
    }
    return jsonDecode(response.responseText ?? 'null');
  }
}

class _BrowserWindow implements WindowPort {
  @override
  Future<void> setTitle(String title) async {
    html.document.title = title;
  }

  @override
  Future<void> setSize({required double width, required double height}) async {
    // Browsers do not allow an embedded application to resize its host window.
  }
}

class _BrowserQuickNote implements QuickNotePort {
  @override
  Future<void> initialize(QuickNoteHandler handler) async {}

  @override
  void dispose() {}

  @override
  Future<void> openQuickNote() async {
    throw const PlatformCapabilityException('Quick note', 'web');
  }
}

class _BrowserPreview implements PreviewPort {
  @override
  Future<void> show(String markdown) async {
    final String encoded = Uri.dataFromString(
      '<!doctype html><meta charset="utf-8"><title>拓墨预览</title><pre>${_escape(markdown)}</pre>',
      mimeType: 'text/html',
      encoding: utf8,
    ).toString();
    html.window.open(encoded, '_blank');
  }
}

class _BrowserRecentFiles implements RecentFilesPort {
  @override
  Future<void> record({required String path, String? title}) async {
    // Browsers own the recent-file list; the workspace keeps its portable
    // in-app recent list instead.
  }
}

String _escape(String value) => value
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;');
