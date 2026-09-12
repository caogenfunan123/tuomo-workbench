import Cocoa
import FlutterMacOS

class MainFlutterWindow: NSWindow {
  private var statusItem: NSStatusItem?
  private var platformChannel: FlutterMethodChannel?

  override func awakeFromNib() {
    let flutterViewController = FlutterViewController()
    let windowFrame = self.frame
    self.contentViewController = flutterViewController
    self.setFrame(windowFrame, display: true)

    RegisterGeneratedPlugins(registry: flutterViewController)
    let channel = FlutterMethodChannel(
      name: "tuomo/platform",
      binaryMessenger: flutterViewController.engine.binaryMessenger
    )
    platformChannel = channel
    channel.setMethodCallHandler { [weak self] call, result in
      self?.handle(call: call, result: result)
    }
    registerForDraggedTypes([.fileURL])
    installStatusItem()

    super.awakeFromNib()
  }

  override func draggingEntered(_ sender: NSDraggingInfo) -> NSDragOperation {
    return firstDroppedURL(from: sender) == nil ? [] : .copy
  }

  override func performDragOperation(_ sender: NSDraggingInfo) -> Bool {
    guard let url = firstDroppedURL(from: sender),
          let data = try? Data(contentsOf: url) else {
      return false
    }
    platformChannel?.invokeMethod("fileDropped", arguments: [
      "name": url.lastPathComponent,
      "bytes": FlutterStandardTypedData(bytes: data),
    ])
    return true
  }

  private func firstDroppedURL(from sender: NSDraggingInfo) -> URL? {
    guard let value = sender.draggingPasteboard.propertyList(forType: .fileURL) as? String,
          let url = URL(string: value),
          ["md", "markdown", "html", "htm", "docx", "txt"].contains(url.pathExtension.lowercased()) else {
      return nil
    }
    return url
  }

  deinit {
    if let statusItem {
      NSStatusBar.system.removeStatusItem(statusItem)
    }
  }

  private func installStatusItem() {
    let item = NSStatusBar.system.statusItem(withLength: NSStatusItem.variableLength)
    item.button?.image = NSImage(systemSymbolName: "square.and.pencil", accessibilityDescription: "拓墨")
    item.button?.toolTip = "拓墨"
    let menu = NSMenu()
    let open = NSMenuItem(title: "打开拓墨", action: #selector(showFromStatusItem), keyEquivalent: "")
    open.target = self
    menu.addItem(open)
    menu.addItem(.separator())
    let quit = NSMenuItem(title: "退出拓墨", action: #selector(quitFromStatusItem), keyEquivalent: "q")
    quit.target = self
    menu.addItem(quit)
    item.menu = menu
    statusItem = item
  }

  @objc private func showFromStatusItem() {
    NSApp.activate(ignoringOtherApps: true)
    makeKeyAndOrderFront(nil)
  }

  @objc private func quitFromStatusItem() {
    NSApp.terminate(nil)
  }

  private func handle(call: FlutterMethodCall, result: @escaping FlutterResult) {
    switch call.method {
    case "pickMarkdown":
      pickFile(allowedFileTypes: ["md", "markdown", "html", "htm", "docx", "txt"], result: result)
    case "pickImage":
      pickFile(allowedFileTypes: ["png", "jpg", "jpeg", "gif", "webp", "heic", "heif"], result: result)
    case "saveFile":
      let arguments = call.arguments as? [String: Any]
      let panel = NSSavePanel()
      panel.nameFieldStringValue = arguments?["suggestedName"] as? String ?? "untitled.md"
      guard panel.runModal() == .OK, let url = panel.url else {
        result(nil)
        return
      }
      let bytes = (arguments?["bytes"] as? FlutterStandardTypedData)?.data ?? Data()
      do {
        try bytes.write(to: url, options: .atomic)
        result(url.absoluteString)
      } catch {
        result(FlutterError(code: "save_failed", message: error.localizedDescription, details: nil))
      }
    case "setWindowTitle":
      title = (call.arguments as? [String: Any])?["title"] as? String ?? title
      result(nil)
    case "setWindowSize":
      let arguments = call.arguments as? [String: Any]
      let width = arguments?["width"] as? CGFloat ?? frame.width
      let height = arguments?["height"] as? CGFloat ?? frame.height
      setContentSize(NSSize(width: width, height: height))
      result(nil)
    case "openQuickNote":
      makeKeyAndOrderFront(nil)
      result(nil)
    case "recordRecentFile":
      if let path = (call.arguments as? [String: Any])?["path"] as? String {
        let url = URL(string: path) ?? URL(fileURLWithPath: path)
        NSDocumentController.shared.noteNewRecentDocumentURL(url)
      }
      result(nil)
    case "platformEventsReady":
      result(nil)
    case "showPreview":
      let arguments = call.arguments as? [String: Any]
      let markdown = arguments?["markdown"] as? String ?? ""
      let alert = NSAlert()
      alert.messageText = "拓墨预览"
      alert.informativeText = markdown
      alert.addButton(withTitle: "关闭")
      alert.beginSheetModal(for: self) { _ in }
      result(nil)
    default:
      result(FlutterMethodNotImplemented)
    }
  }

  private func pickFile(allowedFileTypes: [String], result: @escaping FlutterResult) {
    let panel = NSOpenPanel()
    panel.canChooseFiles = true
    panel.canChooseDirectories = false
    panel.allowsMultipleSelection = false
    panel.allowedFileTypes = allowedFileTypes
    guard panel.runModal() == .OK, let url = panel.url else {
      result(nil)
      return
    }
    do {
      let data = try Data(contentsOf: url)
      result(["name": url.lastPathComponent, "bytes": FlutterStandardTypedData(bytes: data), "path": url.path])
    } catch {
      result(FlutterError(code: "pick_failed", message: error.localizedDescription, details: nil))
    }
  }
}
