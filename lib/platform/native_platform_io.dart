import 'dart:async';
import 'dart:convert';
import 'dart:io';

import '../domain/article.dart';
import 'ports.dart';

RemoteToolsPort createNativeRemoteTools(String baseUrl, String platform) {
  if (baseUrl.trim().isEmpty) return UnavailableRemoteTools(platform);
  return _NativeRemoteTools(_NativeApi(baseUrl));
}

WorkspaceRemotePort createNativeWorkspace(String baseUrl, String platform) {
  if (baseUrl.trim().isEmpty) return UnavailableWorkspaceRemote(platform);
  return _NativeWorkspace(_NativeApi(baseUrl));
}

class _NativeApi {
  _NativeApi(String baseUrl) : base = _normalizeBase(baseUrl);

  final Uri base;
  final HttpClient client = HttpClient()
    ..connectionTimeout = const Duration(seconds: 15);

  Future<Object?> request(
    String path, {
    String method = 'GET',
    Map<String, Object?>? body,
  }) async {
    final Uri uri =
        base.resolve(path.startsWith('/') ? path.substring(1) : path);
    final HttpClientRequest request = await client.openUrl(method, uri);
    request.headers.set(HttpHeaders.acceptHeader, 'application/json');
    if (body != null) {
      request.headers.contentType = ContentType.json;
      request.add(utf8.encode(jsonEncode(body)));
    }
    final HttpClientResponse response = await request.close().timeout(
          const Duration(seconds: 30),
        );
    final String text = await response.transform(utf8.decoder).join();
    if (response.statusCode < 200 || response.statusCode >= 300) {
      throw StateError(text.isEmpty ? 'HTTP ${response.statusCode}' : text);
    }
    return text.isEmpty ? null : jsonDecode(text);
  }

  void close() => client.close(force: true);
}

Uri _normalizeBase(String value) {
  final Uri uri = Uri.parse(value.trim());
  if (!['http', 'https'].contains(uri.scheme)) {
    throw ArgumentError.value(value, 'baseUrl', 'Must use HTTP(S)');
  }
  final String path = uri.path.endsWith('/') ? uri.path : '${uri.path}/';
  return uri.replace(path: path);
}

class _NativeRemoteTools implements RemoteToolsPort {
  const _NativeRemoteTools(this.api);

  final _NativeApi api;

  @override
  Future<List<RssToolItem>> refreshRss(String url) async {
    final Object? value = await api.request(
      '/api/tools/rss?url=${Uri.encodeQueryComponent(url)}',
    );
    if (value is! List) throw const FormatException('Invalid RSS response');
    return value
        .whereType<Map<Object?, Object?>>()
        .map(
          (Map<Object?, Object?> item) => RssToolItem(
            title: item['title'] as String? ?? '',
            link: item['link'] as String?,
            publishedAt: item['publishedAt'] as String?,
          ),
        )
        .toList();
  }

  @override
  Future<LinkToolReport> checkLinks(String markdown) async {
    final Object? value = await api.request(
      '/api/tools/links',
      method: 'POST',
      body: <String, Object?>{'markdown': markdown},
    );
    if (value is! Map<Object?, Object?>) {
      throw const FormatException('Invalid link response');
    }
    final Object? rawResults = value['results'];
    return LinkToolReport(
      results: rawResults is List
          ? rawResults
              .whereType<Map<Object?, Object?>>()
              .map(
                (Map<Object?, Object?> item) => LinkToolResult(
                  url: item['url'] as String? ?? '',
                  ok: item['ok'] == true,
                  status: item['status'] as int?,
                  error: item['error'] as String?,
                ),
              )
              .toList()
          : <LinkToolResult>[],
      cancelled: value['cancelled'] == true,
    );
  }

  @override
  Future<ImageToolResult> uploadImage({
    required String siteId,
    required PickedFile image,
    required String mimeType,
  }) async {
    final Object? value = await api.request(
      '/api/tools/image',
      method: 'POST',
      body: <String, Object?>{
        'siteId': siteId,
        'filename': image.name,
        'mimeType': mimeType,
        'bytesBase64': base64Encode(image.bytes),
      },
    );
    if (value is! Map<Object?, Object?>) {
      throw const FormatException('Invalid image response');
    }
    final Object? rawResult = value['result'];
    return ImageToolResult(
      ok: value['ok'] == true,
      markdownUrl: rawResult is Map<Object?, Object?>
          ? rawResult['markdownUrl'] as String?
          : null,
      error: value['error'] as String?,
    );
  }
}

class _NativeWorkspace implements WorkspaceRemotePort {
  const _NativeWorkspace(this.api);

  final _NativeApi api;

  @override
  Future<List<WorkspaceSite>> listSites() async {
    final Object? value = await api.request('/api/sites');
    if (value is! Map<Object?, Object?>) {
      throw const FormatException('Invalid sites response');
    }
    final Object? rawSites = value['sites'];
    return rawSites is List
        ? rawSites
            .whereType<Map<Object?, Object?>>()
            .map((Map<Object?, Object?> item) => WorkspaceSite.fromJson(item))
            .toList()
        : <WorkspaceSite>[];
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
    final Object? created = await api.request(
      '/api/articles',
      method: 'POST',
      body: <String, Object?>{
        'title': article.title,
        'body': article.body,
        'volume': article.volume,
        'scheduleAt': article.scheduleAt?.toIso8601String(),
        'published': article.published,
        'metadata': article.metadata.toJson(),
      },
    );
    if (created is! Map<Object?, Object?> || created['id'] is! String) {
      return const WorkspaceOperationResult(ok: false, message: '远端文章创建未返回 ID');
    }
    final String id = created['id'] as String;
    final Object? data = await api.request(
      '/api/articles/${Uri.encodeComponent(id)}/publish/${confirm ? 'confirm' : 'preview'}',
      method: 'POST',
      body: <String, Object?>{
        'kind': 'static',
        'siteIds': siteIds,
        if (confirm) 'confirmed': true,
      },
    );
    return WorkspaceOperationResult(ok: true, data: data);
  }

  @override
  Future<WorkspaceOperationResult> buildSite(String siteId) async {
    final Object? data = await api.request(
      '/api/sites/${Uri.encodeComponent(siteId)}/build',
      method: 'POST',
      body: <String, Object?>{},
    );
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
    final Object? data = await api.request(
      '/api/sites/provision',
      method: 'POST',
      body: <String, Object?>{
        'provider': provider,
        'owner': owner,
        'repository': repository,
        'framework': framework,
        'mode': mode,
        'welcomePost': welcomePost,
      },
    );
    return WorkspaceOperationResult(ok: true, data: data);
  }

  @override
  Future<WorkspaceAiResult> quickWrite({
    required String action,
    required String text,
    String? instruction,
  }) async {
    final Object? value = await api.request(
      '/api/ai/quick',
      method: 'POST',
      body: <String, Object?>{
        'action': action,
        'text': text,
        'instruction': instruction,
      },
    );
    if (value is! Map<Object?, Object?>) {
      throw const FormatException('Invalid AI response');
    }
    return WorkspaceAiResult(
      ok: value['ok'] == true,
      text: value['text'] as String? ?? '',
      message: value['error'] as String? ?? value['message'] as String?,
    );
  }
}
