import 'package:flutter/material.dart';

import 'infrastructure/flutter_secure_secret_store.dart';
import 'infrastructure/repository_factory.dart';
import 'infrastructure/session_recovery_factory.dart';
import 'presentation/app.dart';

Future<void> main() async {
  WidgetsFlutterBinding.ensureInitialized();
  final repository = await createArticleRepository();
  final recovery = await createSessionRecoveryStore();
  runApp(TuomoApp(
      controller: WorkspaceController(
          repository: repository,
          recoveryStore: recovery,
          secretStore: FlutterSecureSecretStore())));
}
