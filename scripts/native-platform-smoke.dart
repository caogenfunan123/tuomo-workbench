import 'dart:convert';
import 'dart:io';

import '../lib/platform/native_platform_io.dart';
import '../lib/platform/ports.dart';

Future<void> main() async {
  final HttpServer server =
      await HttpServer.bind(InternetAddress.loopbackIPv4, 0);
  server.listen((HttpRequest request) async {
    request.response.headers.contentType = ContentType.json;
    final Object value = switch (request.uri.path) {
      '/api/tools/rss' => <Map<String, Object?>>[
          <String, Object?>{
            'title': 'Feed item',
            'link': 'https://example.test',
          }
        ],
      '/api/sites' => <String, Object?>{
          'sites': <Map<String, Object?>>[
            <String, Object?>{
              'id': 'site-1',
              'name': 'Demo',
              'kind': 'static',
            }
          ]
        },
      '/api/ai/quick' => <String, Object?>{
          'ok': true,
          'text': 'rewritten',
        },
      _ => <String, Object?>{},
    };
    request.response.write(jsonEncode(value));
    await request.response.close();
  });

  try {
    final String baseUrl = 'http://127.0.0.1:${server.port}';
    final RemoteToolsPort tools = createNativeRemoteTools(baseUrl, 'desktop');
    if ((await tools.refreshRss('https://feed.test')).single.title !=
        'Feed item') {
      throw StateError('RSS adapter contract failed');
    }
    final WorkspaceRemotePort workspace =
        createNativeWorkspace(baseUrl, 'desktop');
    if ((await workspace.listSites()).single.id != 'site-1') {
      throw StateError('Workspace site adapter contract failed');
    }
    final WorkspaceAiResult result =
        await workspace.quickWrite(action: 'rewrite', text: 'draft');
    if (result.text != 'rewritten') {
      throw StateError('Workspace AI adapter contract failed');
    }
    stdout.writeln('native platform smoke passed');
  } finally {
    await server.close(force: true);
  }
}
