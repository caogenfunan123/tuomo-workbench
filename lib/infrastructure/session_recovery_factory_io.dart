import 'dart:io';

import 'package:path_provider/path_provider.dart';

import '../application/editor_session.dart';
import 'session_recovery_json.dart';

Future<SessionRecoveryStore> createSessionRecoveryStore() async {
  final Directory root = await getApplicationSupportDirectory();
  return JsonFileSessionRecoveryStore(
      Directory('${root.path}${Platform.pathSeparator}sessions'));
}
