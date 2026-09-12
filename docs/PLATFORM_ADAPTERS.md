# 平台适配器契约

Flutter 业务层只依赖 `lib/platform/ports.dart` 中的文件、窗口、速记、预览、远程工具和工作区远程端口；原生能力统一使用 `tuomo/platform` MethodChannel，同源 Web 工作区使用 HTTP adapter。打字机滚动属于共享编辑器偏好，不在平台 runner 中复制业务逻辑。

| 方法 | 参数/返回 | Web | Android/iOS/macOS | Windows/Linux |
|---|---|---|---|---|
| `pickMarkdown` | 无；返回 `{name, bytes, path?}` 或 `null`；当前可选 Markdown/HTML/DOCX，HTML/DOCX 在 application 层转 Markdown | 浏览器文件选择器并读取 Markdown/HTML/DOCX 字节 | 系统文档选择器并读取 Markdown/HTML/DOCX 字节 | Windows Win32 对话框；Linux GTK 文件选择器并读取字节 |
| `pickImage` | 无；返回 `{name, bytes}` 或 `null` | 浏览器图片选择器 | MethodChannel 图片选择器（Android/iOS/macOS） | MethodChannel 图片选择器（Windows/Linux） |
| `saveFile` | `suggestedName`、`bytes`；返回 URI/文件名或 `null` | 浏览器下载 | 系统文档创建器/导出面板 | Windows Win32 对话框；Linux GTK 文件选择器 |
| `recordRecentFile` | `path`、可选 `title`；无返回值 | 安全无操作，保留应用内最近文档 | 安全无操作或系统文档历史 | Windows Shell、macOS `NSDocumentController`、Linux GTK recent manager |
| `fileDropped` | 原生/浏览器拖入文档后回调 `{name, bytes}` | `dart:html` document drop 事件 | 移动端不注册桌面拖放 | macOS/Windows/Linux runner 将文档字节转发到 Flutter |
| `setWindowTitle` | `title` | 修改页面标题 | 无操作 | Windows/Linux/macOS 设置窗口标题 |
| `setWindowSize` | `width`、`height` | 浏览器禁止调整宿主窗口，安全无操作 | 无操作 | Windows/Linux/macOS 调整窗口 |
| `openQuickNote` | 无 | 明确抛出能力不可用，并回退到应用内新建文章 | MethodChannel 拉起/聚焦应用；Android 桌面速记 widget/ iOS 快捷入口触发应用 | MethodChannel 拉起/聚焦窗口 |
| `showPreview` | `markdown` | 新窗口显示安全文本预览 | 应用内安全 Markdown 预览；Web 端另开预览窗口 | 原生 runner 显示模态安全文本预览；通道不可用时回退到 Flutter 应用内预览 |
| `RemoteToolsPort.refreshRss` | `url`；返回 RSS 条目 | 同源调用 `/api/tools/rss` | 配置 `TUOMO_API_BASE_URL` 后调用 `/api/tools/rss` | 配置 `TUOMO_API_BASE_URL` 后调用 `/api/tools/rss` |
| `RemoteToolsPort.checkLinks` | `markdown`；返回逐链接状态 | 同源调用 `/api/tools/links` | 配置 `TUOMO_API_BASE_URL` 后调用 `/api/tools/links` | 配置 `TUOMO_API_BASE_URL` 后调用 `/api/tools/links` |
| `RemoteToolsPort.uploadImage` | 站点 ID、图片字节和 MIME；返回 Markdown URL | 同源调用 `/api/tools/image` | 配置 `TUOMO_API_BASE_URL` 后调用 `/api/tools/image` | 配置 `TUOMO_API_BASE_URL` 后调用 `/api/tools/image` |
| `WorkspaceRemotePort.listSites` | 返回站点注册表 | `/api/sites` | 配置 `TUOMO_API_BASE_URL` 后调用 | 配置 `TUOMO_API_BASE_URL` 后调用 |
| `WorkspaceRemotePort.publishArticle` | 文章快照、站点 ID、预览/确认 | `/api/articles` + `/publish/preview|confirm` | 配置 `TUOMO_API_BASE_URL` 后调用 | 配置 `TUOMO_API_BASE_URL` 后调用 |
| `WorkspaceRemotePort.buildSite` / `provisionSite` | 站点构建或建站参数 | `/api/sites/:id/build`、`/api/sites/provision` | 配置 `TUOMO_API_BASE_URL` 后调用 | 配置 `TUOMO_API_BASE_URL` 后调用 |
| `WorkspaceRemotePort.quickWrite` | AI 动作、正文、指令 | `/api/ai/quick` | 配置 `TUOMO_API_BASE_URL` 后调用 | 配置 `TUOMO_API_BASE_URL` 后调用 |

## 验证边界

- Web 分支已由 `flutter build web` 实际编译，浏览器导入会读取 Markdown/HTML/DOCX 字节并在 application 层转换，下载/预览使用 `dart:html` adapter。
- Flutter Web 的 RSS/链接/图床端口要求与 Node Web API 同源部署；独立静态托管时会显示能力不可用，不会伪造上传成功。
- Flutter Web 的工作区端口同样要求与 Node Web API 同源部署；原生端通过 `--dart-define=TUOMO_API_BASE_URL=https://...` 使用同一组带凭据/授权的服务端口，未配置时保留明确的不可用结果。
- Android/iOS/macOS 的文件/图片选择、保存、窗口、快速笔记和预览 MethodChannel 源码已接入；原生远程端口由共享 `dart:io` adapter 注入，但本机没有对应 SDK/Xcode，尚未完成设备构建和运行时验收。
- Windows/Linux 的窗口、快速笔记通道、Markdown/图片文件对话框和文档拖放回调源码已接入；Flutter 壳提供最近编辑列表、打字机滚动和 Ctrl/Cmd+K 命令面板；macOS/Windows/Linux runner 已加入系统托盘和系统最近文件源码，原生远程端口同样使用共享 HTTP adapter，仍需对应平台工具链验证与真实设备运行时验证。
- Android 桌面速记 widget 已通过 `QuickNoteWidget`、AppWidget provider XML 和 manifest receiver 接入；iOS 已通过 `QuickNoteWidget` extension target、WidgetKit 静态卡片和 `tuomo://quick-note` URL 回跳接入；仍需要 Android/iOS SDK 与真实设备验证。
- 编辑中的脏会话通过 `SessionRecoveryStore` 保存：原生端写入应用支持目录下的 `sessions/`，Web 端写入 `localStorage`；成功 CAS 保存后清理恢复记录。
- 编辑器的“打开预览”动作优先调用平台预览；当平台能力不可用时回退到 Flutter 应用内的安全 Markdown 预览。缺失插件时其它 Dart adapter 仍抛出 `PlatformCapabilityException`，不会静默写入普通设置或伪造成功。
