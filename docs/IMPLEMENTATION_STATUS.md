# 实施审计

本项目从空目录开始，没有历史源码或真实站点凭据。当前交付同时提供 Node.js 22 可运行参考宿主和 Flutter/Dart 壳；本机使用 Flutter 3.47.3 / Dart 3.13.3 已完成 `flutter analyze`、`flutter test` 和 `flutter build web` 验收。

已由自动化测试证明的闭环：

- 文章 revision CAS、独立编辑会话、快照、回收站、Front Matter 和九框架渲染；Node Web API 与 Web 页面已接入 Markdown/HTML/DOCX 导入、六种导出和快照恢复/删除接口；
- Git 风格远端文件读取/写入/冲突保护、远端文章递归查询和历史；站点注册表、active site 和文章远程 binding 已有原子 JSON 持久化；Web 入口支持站点 CRUD、健康检查、静态发布预览/确认和 CMS 批量发布用例注入；
- WordPress/Ghost/Typecho HTTP CRUD 与媒体上传映射，多站点内容聚合；
- 静态/CMS 批量发布、CMS 删除生命周期、CMS 连通性探测、CAS 冲突选择/合并、站点健康汇总和建站事务回滚；
- WebDAV/Git manifest、持久化离线 outbox、P2P X25519/AES-GCM 配对、UDP 发现和加密 HTTP push/pull；
- PBKDF2/AES-256-GCM 草稿、加密备份恢复、非法路径拒绝、旧数据秘密迁移；工作区备份已覆盖写作资产、Skill/主题、Agent 会话/任务和同步清单并兼容旧归档；敏感迁移备份加密，`.device_key` 只落 SecretRef；
- OpenAI Chat/Responses/Anthropic 请求协议、取消、模型路由、工具循环和带 TTL/撤销的高风险授权；
- CLI `serve` 已接入基于 `SecretRef` 的环境凭据桥接、静态 Git HTTP gateway、WordPress/Ghost/三种 Typecho CMS 路由，以及带 HTTPS 护栏的镜像/部署 Hook gateway；凭据不进入站点 JSON；P09 建站 gateway 已支持 GitHub/GitLab 仓库创建、文件写入、Pages/Cloudflare 构建触发和轮询，成功后由 application 用例登记静态站点；P10 Web 站点面板支持触发配置的部署 Hook；
- 模型上下文裁剪、持久化 Agent 会话、API key 池轮转和失败冷却；
- AI 会话与 Agent 任务已有原子 JSON 恢复存储；模板、片段、卷宗、写作统计、用户 Skill 和主题也有持久化注册表，并由 Node Web “内容资产”面板及 CLI 工作区接入；旧迁移器会把草稿、模板、片段、统计和仓库配置转换到规范存储，同时保留加密/只读备份；Flutter 设置页已将简易/标准模式、主题、专注模式、打字机滚动、编辑器字号和侧边栏显隐/固定接入 Web localStorage/原生 JSON 偏好存储，命令面板可从所有模式打开全量入口，并支持 Ctrl/Cmd+K；首页保留最近编辑文章入口；
- RSS、链接检查、GitHub 图床安全上传与重试、Git Data→Contents→CLI 批量上传 fallback、拼写检查、卷宗分组、格式导入导出、统一 Markdown 富预览/目录/格式化/查找替换 API、缓存清理、语言/代理偏好、站点建站回滚、可取消批处理和导航矩阵；Node Web 已提供 RSS、链接检查、图床上传/Markdown 插入、文件夹批量上传、图片重试和缓存清理工具面板，并通过公共 HTTP URL 校验拦截明显 SSRF 目标；Flutter Web 已通过 `RemoteToolsPort` 调用同源 RSS/链接/图床 API，并通过 `WorkspaceRemotePort` 接入站点读取、建站、构建触发、发布预览/确认和 AI 快速写作，具备图片选择和 Markdown 插入入口；Flutter 仍使用浏览器持久化、Markdown/HTML/DOCX 字节导入、回收站、版本快照、脏会话 localStorage 恢复、响应式导航、编辑器块级 Markdown 预览、辅助工具页的统计/格式化/查找替换/目录、多格式文档（Markdown/HTML/PDF/DOCX/EPUB/PNG）导出、浏览器下载/预览 adapter，Android/iOS/Linux/macOS/Windows runner 通过 MethodChannel 接入文件/图片选择、保存、窗口和安全文本预览能力；内置工具目录已覆盖 repo/config/Git/template/skill/site/deploy 风险入口。

尚不能在空项目和当前环境中声称已完成的外部边界：

1. Flutter Android/iOS/Windows/Linux/macOS 的设备构建和完整平台运行验收；官方 runner 目录已生成，五个原生 runner 已加入文件/图片选择、保存、窗口和安全文本预览 MethodChannel，Android 已加入桌面速记 widget 源码，iOS 已加入 WidgetKit extension target、主屏快捷入口和 `tuomo://quick-note` 回跳，macOS/Windows/Linux 已加入源码级系统托盘和文档拖放入口，原生远程工具/工作区通过共享 `dart:io` HTTP adapter 接入 `TUOMO_API_BASE_URL`，应用内快速笔记入口、最近编辑列表和 Ctrl/Cmd+K 命令面板已可用，但仍需对应平台工具链和设备验收；
2. Flutter 已接入 `flutter_secure_storage` 秘密存储适配器，可覆盖 Android/iOS/Linux/macOS/Windows/Web；对应设备上的 Keystore、Keychain、桌面凭据库运行时验证仍需真实平台工具链和凭据环境；
3. Git/CMS 云端真实账号、Cloudflare/Pages 构建轮询和生产证书/代理策略；
4. P2P 生产设备许可、真实 TLS 证书/Noise 网络会话与真实 MCP stdio 进程环境；代码层已有 UDP 发现、会话加密、生产模式 TLS 护栏和命令 allow-list，但仍需真实平台网络和进程环境验收；
5. 依赖具体平台的 WebView/KaTeX/Mermaid、PDF/PNG 高质量排版；DOCX 压缩包读取和基础 OOXML 文本导入已在 Node 核心与 Flutter `archive` 适配器实现，但完整样式/表格/图片保真仍需专用文档引擎。

这些边界已经通过接口隔离，不能用内存 fake 代替生产连接。最终宣称文档中的“跨 Android、iOS、Web、Windows、Linux、macOS 全功能复现”前，必须为上述适配器增加平台契约测试和真实环境验收。

本机验收记录：

- `npm run check`：153 项 Node 测试全部通过；`npm run test:coverage` 最新实测总行覆盖率为 95.20%（分支 74.12%，函数 89.60%）；HTTP Git/CMS/媒体/图床/远程文章/同步、健康检查、RSS/更新检查、运行时凭据、代理 fetch 和 Web 发布适配器统一支持 request ID、超时、重试和取消传播，CLI/Web 站点面板已接入健康检查，Web 编辑器已接入统一 Markdown 预览、目录、格式化和查找替换；Flutter 应用层会话已与 Flutter UI 解耦，桌面系统最近文件已通过平台 port 接入；`release:check` 会校验 `pubspec.yaml` 版本、执行门禁/迁移 doctor、原生 HTTP smoke 并可生成 CycloneDX SBOM；
- `flutter analyze`：无问题；
- `dart format --output=none --set-exit-if-changed .`：通过；
- `flutter test`：19 项 Dart/Flutter 测试全部通过（含 Dart 内容工具、Flutter 富 Markdown 预览块、原生文档拖放/快速笔记事件 port、打字机偏好和发布中心降级路径测试）；
- `flutter build web`：成功生成 `build/web/index.html`；当前可用 Edge 设备执行 `flutter run -d edge --web-port 4394`，最终编辑器拆分代码的调试服务器返回 HTTP 200，随后释放监听端口。

原生构建环境说明：当前执行机未安装 Android SDK、Chrome 或 Visual Studio，因此 Android/iOS/Windows 的设备构建与 Chrome 运行不能在此机完成；这不影响 Web 编译产物和纯 Dart 核心验收。
