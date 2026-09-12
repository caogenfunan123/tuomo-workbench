import '../application/editor_session.dart';
import 'session_recovery_browser.dart';

Future<SessionRecoveryStore> createSessionRecoveryStore() async =>
    BrowserSessionRecoveryStore();
