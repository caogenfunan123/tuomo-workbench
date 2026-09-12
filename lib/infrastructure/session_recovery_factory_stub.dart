import '../application/editor_session.dart';

Future<SessionRecoveryStore> createSessionRecoveryStore() async =>
    MemorySessionRecoveryStore();
