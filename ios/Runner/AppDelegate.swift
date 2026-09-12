import Flutter
import UIKit
import UniformTypeIdentifiers

@main
@objc class AppDelegate: FlutterAppDelegate, FlutterImplicitEngineDelegate, UIDocumentPickerDelegate {
  private var pendingResult: FlutterResult?
  private var temporaryExportURL: URL?
  private var platformChannel: FlutterMethodChannel?
  private var pendingQuickNote = false
  private var platformEventsReady = false

  override func application(
    _ application: UIApplication,
    didFinishLaunchingWithOptions launchOptions: [UIApplication.LaunchOptionsKey: Any]?
  ) -> Bool {
    return super.application(application, didFinishLaunchingWithOptions: launchOptions)
  }

  func didInitializeImplicitFlutterEngine(_ engineBridge: FlutterImplicitEngineBridge) {
    GeneratedPluginRegistrant.register(with: engineBridge.pluginRegistry)
    let channel = FlutterMethodChannel(
      name: "tuomo/platform",
      binaryMessenger: engineBridge.engine.binaryMessenger
    )
    platformChannel = channel
    channel.setMethodCallHandler { [weak self] call, result in
      self?.handle(call: call, result: result)
    }
  }

  func requestQuickNote() {
    if platformEventsReady, let channel = platformChannel {
      channel.invokeMethod("quickNoteRequested", arguments: nil)
    } else {
      pendingQuickNote = true
    }
  }

  private func handle(call: FlutterMethodCall, result: @escaping FlutterResult) {
    switch call.method {
    case "pickMarkdown":
      presentPicker(result: result, contentTypes: [UTType.data])
    case "pickImage":
      presentPicker(result: result, contentTypes: [UTType.image])
    case "saveFile":
      let arguments = call.arguments as? [String: Any]
      let name = arguments?["suggestedName"] as? String ?? "untitled.md"
      let bytes = (arguments?["bytes"] as? FlutterStandardTypedData)?.data ?? Data()
      presentExport(name: name, bytes: bytes, result: result)
    case "setWindowTitle", "setWindowSize":
      result(nil)
    case "openQuickNote":
      presenterViewController()?.view.window?.makeKeyAndVisible()
      result(nil)
    case "recordRecentFile":
      // iOS does not expose a general-purpose recent-document list to apps.
      result(nil)
    case "platformEventsReady":
      platformEventsReady = true
      result(nil)
      if pendingQuickNote {
        pendingQuickNote = false
        requestQuickNote()
      }
    case "showPreview":
      let arguments = call.arguments as? [String: Any]
      let markdown = arguments?["markdown"] as? String ?? ""
      let alert = UIAlertController(title: "拓墨预览", message: markdown, preferredStyle: .alert)
      alert.addAction(UIAlertAction(title: "关闭", style: .default))
      presenterViewController()?.present(alert, animated: true)
      result(nil)
    default:
      result(FlutterMethodNotImplemented)
    }
  }

  private func presentPicker(result: @escaping FlutterResult, contentTypes: [UTType]) {
    guard pendingResult == nil, let presenter = presenterViewController() else {
      result(FlutterError(code: "busy", message: "Another document operation is active", details: nil))
      return
    }
    pendingResult = result
    let picker = UIDocumentPickerViewController(forOpeningContentTypes: contentTypes, asCopy: true)
    picker.delegate = self
    presenter.present(picker, animated: true)
  }

  private func presentExport(name: String, bytes: Data, result: @escaping FlutterResult) {
    guard pendingResult == nil, let presenter = presenterViewController() else {
      result(FlutterError(code: "busy", message: "Another document operation is active", details: nil))
      return
    }
    let url = FileManager.default.temporaryDirectory.appendingPathComponent(name)
    do {
      try bytes.write(to: url, options: .atomic)
    } catch {
      result(FlutterError(code: "save_failed", message: error.localizedDescription, details: nil))
      return
    }
    pendingResult = result
    temporaryExportURL = url
    let picker = UIDocumentPickerViewController(forExporting: [url], asCopy: true)
    picker.delegate = self
    presenter.present(picker, animated: true)
  }

  func documentPicker(_ controller: UIDocumentPickerViewController, didPickDocumentsAt urls: [URL]) {
    let result = pendingResult
    pendingResult = nil
    let exportURL = temporaryExportURL
    exportURL.map { try? FileManager.default.removeItem(at: $0) }
    temporaryExportURL = nil
    guard let url = urls.first else {
      result?(nil)
      return
    }
    if exportURL != nil {
      result?(url.absoluteString)
      return
    }
    let scoped = url.startAccessingSecurityScopedResource()
    defer { if scoped { url.stopAccessingSecurityScopedResource() } }
    do {
      let data = try Data(contentsOf: url)
      result?(["name": url.lastPathComponent, "bytes": FlutterStandardTypedData(bytes: data), "path": url.path])
    } catch {
      result?(FlutterError(code: "pick_failed", message: error.localizedDescription, details: nil))
    }
  }

  func documentPickerWasCancelled(_ controller: UIDocumentPickerViewController) {
    let result = pendingResult
    pendingResult = nil
    temporaryExportURL.map { try? FileManager.default.removeItem(at: $0) }
    temporaryExportURL = nil
    result?(nil)
  }

  private func presenterViewController() -> UIViewController? {
    if let root = window?.rootViewController {
      return root
    }
    return UIApplication.shared.connectedScenes
      .compactMap { $0 as? UIWindowScene }
      .flatMap { $0.windows }
      .first(where: { $0.isKeyWindow })?.rootViewController
  }
}
