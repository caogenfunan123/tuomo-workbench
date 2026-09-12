import { access, readFile } from 'node:fs/promises';
import { constants } from 'node:fs';
import { join, resolve } from 'node:path';

const root = resolve(new URL('..', import.meta.url).pathname.replace(/^\/(?:[A-Za-z]:)/, (value) => value.slice(1)));

async function read(path) {
  return readFile(join(root, path), 'utf8');
}

async function requireFile(path) {
  try {
    await access(join(root, path), constants.F_OK);
  } catch {
    throw new Error(`Missing platform source: ${path}`);
  }
}

function requireText(text, path, pattern, description) {
  if (!pattern.test(text)) throw new Error(`Missing ${description} in ${path}`);
}

const requiredFiles = [
  'android/app/src/main/kotlin/com/example/tuomo_workbench/QuickNoteWidget.kt',
  'android/app/src/main/res/xml/quick_note_widget_info.xml',
  'ios/QuickNoteWidget/QuickNoteWidget.swift',
  'ios/QuickNoteWidget/Info.plist',
  'ios/Runner.xcodeproj/project.pbxproj',
  'macos/Runner/MainFlutterWindow.swift',
  'windows/runner/flutter_window.cpp',
  'linux/runner/my_application.cc',
  'lib/platform/ports.dart',
  'lib/platform/web_platform.dart',
];
for (const path of requiredFiles) await requireFile(path);

const pbx = await read('ios/Runner.xcodeproj/project.pbxproj');
requireText(pbx, 'ios/Runner.xcodeproj/project.pbxproj', /QuickNoteWidget/, 'WidgetKit target');
requireText(pbx, 'ios/Runner.xcodeproj/project.pbxproj', /com\.apple\.product-type\.app-extension/, 'WidgetKit app extension product');
requireText(pbx, 'ios/Runner.xcodeproj/project.pbxproj', /Embed App Extensions/, 'WidgetKit embed phase');
requireText(await read('ios/Runner/Info.plist'), 'ios/Runner/Info.plist', /<string>tuomo<\/string>/, 'tuomo URL scheme');
requireText(await read('ios/Runner/SceneDelegate.swift'), 'ios/Runner/SceneDelegate.swift', /tuomo.*quick-note/, 'WidgetKit URL callback');
requireText(await read('android/app/src/main/AndroidManifest.xml'), 'android/app/src/main/AndroidManifest.xml', /QuickNoteWidget/, 'Android widget receiver');
requireText(await read('android/app/src/main/kotlin/com/example/tuomo_workbench/MainActivity.kt'), 'android/app/src/main/kotlin/com/example/tuomo_workbench/MainActivity.kt', /quickNoteRequested/, 'Android quick-note event');
requireText(await read('ios/Runner/AppDelegate.swift'), 'ios/Runner/AppDelegate.swift', /requestQuickNote/, 'iOS quick-note event');
requireText(await read('lib/platform/ports.dart'), 'lib/platform/ports.dart', /QuickNoteHandler/, 'shared quick-note event port');
requireText(await read('lib/platform/capabilities.dart'), 'lib/platform/capabilities.dart', /platformEventsReady/, 'platform event handshake');
requireText(await read('macos/Runner/MainFlutterWindow.swift'), 'macos/Runner/MainFlutterWindow.swift', /NSStatusBar\.system/, 'macOS status item');
requireText(await read('windows/runner/flutter_window.cpp'), 'windows/runner/flutter_window.cpp', /Shell_NotifyIconW/, 'Windows tray');
requireText(await read('windows/runner/flutter_window.cpp'), 'windows/runner/flutter_window.cpp', /WM_DROPFILES/, 'Windows document drop');
requireText(await read('windows/runner/flutter_window.cpp'), 'windows/runner/flutter_window.cpp', /recordRecentFile/, 'Windows recent files');
requireText(await read('linux/runner/my_application.cc'), 'linux/runner/my_application.cc', /GtkStatusIcon/, 'Linux tray');
requireText(await read('linux/runner/my_application.cc'), 'linux/runner/my_application.cc', /fileDropped/, 'Linux document drop');
requireText(await read('linux/runner/my_application.cc'), 'linux/runner/my_application.cc', /recordRecentFile/, 'Linux recent files');
requireText(await read('macos/Runner/MainFlutterWindow.swift'), 'macos/Runner/MainFlutterWindow.swift', /noteNewRecentDocumentURL/, 'macOS recent files');
requireText(await read('ios/Runner/AppDelegate.swift'), 'ios/Runner/AppDelegate.swift', /recordRecentFile/, 'iOS recent-file fallback');
requireText(await read('android/app/src/main/kotlin/com/example/tuomo_workbench/MainActivity.kt'), 'android/app/src/main/kotlin/com/example/tuomo_workbench/MainActivity.kt', /recordRecentFile/, 'Android recent-file fallback');
requireText(await read('lib/platform/ports.dart'), 'lib/platform/ports.dart', /abstract interface class FileDropPort/, 'shared file drop port');
requireText(await read('lib/platform/ports.dart'), 'lib/platform/ports.dart', /abstract interface class RecentFilesPort/, 'shared recent files port');
requireText(await read('lib/platform/web_platform.dart'), 'lib/platform/web_platform.dart', /class _BrowserFileDrop/, 'Web file drop adapter');

console.log(`Platform source contracts passed for ${requiredFiles.length} files`);
