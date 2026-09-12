# 拓墨（Tuomo）

这是一个从空目录重新搭建的离线优先写作与多站点发布工作台核心实现。实现遵循 `REFACTOR_REIMPLEMENTATION_GUIDE.md` 的领域边界：业务规则不依赖 UI、网络 SDK 或平台 API，所有外部能力通过 port/gateway 接入。

当前运行时使用 Node.js 22+ 的内置 TypeScript 类型擦除，因此无需安装 npm 依赖即可运行核心测试；Flutter/Dart 共享壳已接入，可运行 Web，并已生成 Android、iOS、Windows、Linux、macOS 官方 runner 目录。本仓库同时提供 Web/CLI 参考入口。

## 快速开始

```powershell
npm test
npm start -- init --root .tuomo
npm start -- doctor --root .tuomo
npm start -- migrate --from .legacy-tuomo --root .tuomo
npm start -- create --root .tuomo --title "第一篇文章" --body "离线优先。"
npm start -- list --root .tuomo
npm start -- serve --root .tuomo --port 3210
npm run platform:check
npm run release:check -- --skip-flutter
```

执行迁移前设置一次性工作区密钥：`$key = [Security.Cryptography.RandomNumberGenerator]::GetBytes(32); $env:TUOMO_MIGRATION_KEY = [Convert]::ToBase64String($key)`。迁移器会将秘密写入加密 vault，不会写入普通 JSON；旧草稿、模板、片段、统计和仓库配置会转换到规范存储，原始文件及加密草稿仍保留在 `legacy-import/` 以便审计和重试。

打开 `http://localhost:3210` 可使用 Node Web 工作区创建、搜索、编辑、导入 Markdown/HTML/DOCX、实时预览表格/代码/数学块/Mermaid、目录、格式化、查找替换、导出 Markdown/HTML/PDF/DOCX/EPUB/PNG、管理快照/回收站、维护静态/CMS 站点、检查站点健康、触发部署 Hook、执行发布预览/确认、注入式一键建站、刷新 RSS、检查链接、上传 GitHub 图床并插入 Markdown、选择文件夹批量上传、清理缓存，以及在“内容资产”面板管理模板、片段、卷宗和写作统计；这些数据分别持久化到文章、站点、缓存和 `writing/library.json`。Flutter Web 入口同样提供编辑器块级 Markdown 预览、打字机滚动偏好，并使用浏览器 localStorage 与 Markdown/HTML/DOCX 文件导入、Markdown/HTML/PDF/DOCX/EPUB/PNG 导出，保存副作用仍由 application/use-case 统一编排。

## 目录

- `src/domain`：文章、站点、Front Matter、渲染、同步和工具权限等纯领域规则。
- `src/application`：保存、发布、同步、迁移、AI 工具执行和建站事务用例。
- `src/infrastructure`：JSON 原子存储、秘密存储、审计日志、静态/CMS 内存网关。
- `src/presentation`：CLI 与最小 Web 参考入口；不编排业务细节。
- `lib`：Flutter/Dart 壳与纯 Dart Article/Front Matter/编辑会话核心，可接入 Android、iOS、Web、Windows、Linux、macOS。
- `test`：覆盖 CAS 保存、迁移脱敏、九框架渲染、发布冲突、同步冲突、工具权限和 GitHub/GitLab/Cloudflare 建站 gateway。
- `docs`：架构、数据迁移、安全模型和功能矩阵。
- [平台适配器契约](<C:\code\vibecoding\docs\PLATFORM_ADAPTERS.md>)：Web、移动和桌面 MethodChannel 能力边界。

外部 Git/CMS/MCP 能力均定义为接口，Flutter Web 已有浏览器下载/预览、同源 RSS/链接/图床 `RemoteToolsPort` 和站点/发布/AI `WorkspaceRemotePort` adapter，五个原生 runner 已接入文件/图片/窗口 MethodChannel，Android 已加入桌面速记 widget，iOS 已加入 WidgetKit extension target 与 `tuomo://quick-note` 回跳，macOS/Windows/Linux 已加入源码级系统托盘和文档拖放，原生端可通过 `--dart-define=TUOMO_API_BASE_URL=https://...` 复用同一 HTTP adapter；生产 MCP、系统最近文件集成和设备级运行时验收仍需对应平台工具链；Flutter 壳已通过 `flutter_secure_storage` 接入平台安全存储，Node 参考宿主仍需按部署环境注入 credential vault；内存网关只用于离线测试和开发，不会伪装成已连接的真实服务。

当前实现审计见 [docs/IMPLEMENTATION_STATUS.md](<C:\code\vibecoding\docs\IMPLEMENTATION_STATUS.md>)；版本更新清单见 [`release.json`](<C:\code\vibecoding\release.json>)。

## 真实站点运行时

`serve` 会根据站点配置自动组合真实 HTTP gateway。站点 JSON 只保存 `credentialRef`/`authRef`，凭据通过同名环境变量提供：`TUOMO_SECRET_<REF_ID>`（引用 ID 会转为大写）。一键建站还读取 `TUOMO_SECRET_GITHUB`、`TUOMO_SECRET_GITLAB`、`TUOMO_SECRET_CLOUDFLARE`、`TUOMO_CLOUDFLARE_ACCOUNT_ID`，可选 `TUOMO_GITHUB_OWNER_TYPE=org`、`TUOMO_GITLAB_NAMESPACE_ID` 和 `TUOMO_GIT_CLI_ROOT`（批量上传的本地 Git CLI fallback）；成功后自动登记生成的静态站点。AI 快速写作通过 `TUOMO_SECRET_AI`、`TUOMO_AI_PROVIDER`、`TUOMO_AI_ENDPOINT`、`TUOMO_AI_MODEL` 注入模型配置。CMS 站点可在公开的 `adapterOptions.authScheme` 中指定 `Bearer`、`Basic` 或其它认证方案；镜像和部署 Hook 默认要求 HTTPS。仅本地开发时可显式设置 `TUOMO_ALLOW_INSECURE_HOOKS=1` 放行 HTTP Hook，生产环境不应设置。

Flutter 环境可执行：

```powershell
flutter pub get
dart format --output=none --set-exit-if-changed .
flutter analyze
flutter test
flutter test --coverage
flutter build web
flutter run -d chrome
```

完整发布预检（包含 Node 测试、平台源码契约、Flutter analyze/test、Web 构建、原生 HTTP smoke 和迁移 doctor）：

```powershell
npm run release:check
```
