import Flutter
import UIKit

class SceneDelegate: FlutterSceneDelegate {
  override func windowScene(
    _ windowScene: UIWindowScene,
    performActionFor shortcutItem: UIApplicationShortcutItem,
    completionHandler: @escaping (Bool) -> Void
  ) {
    if shortcutItem.type == "com.example.tuomo_workbench.quick-note" {
      window?.makeKeyAndVisible()
      (UIApplication.shared.delegate as? AppDelegate)?.requestQuickNote()
      completionHandler(true)
      return
    }
    completionHandler(false)
  }

  override func scene(_ scene: UIScene, openURLContexts URLContexts: Set<UIOpenURLContext>) {
    guard URLContexts.contains(where: { $0.url.scheme == "tuomo" && $0.url.host == "quick-note" }) else {
      return
    }
    window?.makeKeyAndVisible()
    (UIApplication.shared.delegate as? AppDelegate)?.requestQuickNote()
  }
}
