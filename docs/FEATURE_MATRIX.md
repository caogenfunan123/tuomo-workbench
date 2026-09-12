# 功能矩阵

| 能力 | 状态 | 实现/验收 |
|---|---|---|
| W01、W03-W08 | 已实现核心 | Article、DocumentSession、多标签、生命周期冲刷、revision CAS、自动保存端口、快照完整生命周期、回收站、Front Matter、全文查询、拼写检查、卷宗分组；Node Web“内容资产”面板与原子 JSON library store 已持久化模板/片段/卷宗/写作统计；Flutter 壳已提供快照浏览/恢复/删除和脏会话恢复 |
| W02、W09 | 已实现核心 | DocumentSession、Markdown/HTML/真实 DOCX 压缩包导入、Markdown/HTML/PDF/DOCX/EPUB/PNG 导出、目录/查找替换/格式化和模板解析；Node Web 页面/API 已统一接入核心富 Markdown 预览（表格、代码、数学块、Mermaid 和安全链接）及六种导出，Flutter 编辑器也提供安全的表格/列表/引用/代码/数学块预览、Markdown/HTML/PDF/DOCX/EPUB/PNG 导出，文件适配器支持 Markdown/HTML/DOCX 导入，DOCX 读取段落并保留实体文本 |
| W10 | Web/平台 adapter | Web 文章创建、搜索、编辑、Markdown 预览、localStorage 持久化、浏览器下载/预览、应用内快速笔记、最近编辑列表、Ctrl/Cmd+K 命令面板、打字机滚动和响应式导航；五个原生 runner 已有文件/图片选择、保存、窗口/快速笔记/安全文本预览 MethodChannel 接线，Android 已有桌面速记 widget 源码，iOS 已配置 WidgetKit extension target 与 URL 回跳，macOS/Windows/Linux 已加入源码级系统托盘和文档拖放入口，设备验证仍待完成 |
| P01-P05 | 已实现核心 | 站点模型、JSON 持久化注册表与 active site、九框架渲染、站点/文章模板解析、预览、GitHub/GitLab/Gitee/Bitbucket 风格 HTTP gateway、SHA/CAS、远端递归列表/历史/缓存；CLI `serve` 已通过环境 SecretRef 接入真实静态 Git gateway；静态/CMS 批量发布、CMS 删除/连通性、冲突选择和多站点聚合 |
| P06-P08 | HTTP 适配器已实现 | WordPress、Ghost、Typecho Secure/FastAPI/RESTful CRUD 与媒体上传；CLI `serve` 按 CMS 类型路由真实 gateway 并从 `TUOMO_SECRET_<REF_ID>` 读取凭据；真实账号和契约环境需部署验证；Web 入口支持创建 CMS 站点并批量发布 |
| P09-P10 | 用例与 Web 入口已实现 | SiteWizard 幂等步骤/逆序回滚、Pages/Cloudflare 分支、并发健康检查；CLI `serve` 已注入 HTTP 健康探测、发布副作用、Hook 构建触发和 GitHub/GitLab/Cloudflare 建站 gateway，Web 站点面板可批量检查、触发构建并展示状态，并提供 `/api/sites/provision` 一键建站入口；凭据和 Cloudflare 账号由环境注入 |
| S01-S04 | 传输已实现 | WebDAV/Git manifest-object 增量清单合并、持久化 outbox 重试、P2P X25519/AES-GCM 配对、UDP 公告发现与指纹校验、加密 HTTP push/pull；生产模式已拒绝明文 endpoint 并支持 TLS 证书选项，真实设备许可和 Noise/TLS 证书环境仍需平台网络 adapter |
| S05-S07 | 已实现核心 | PBKDF2+AES-256-GCM 草稿、加密备份、路径安全恢复、迁移、脱敏审计、设置持久化、更新检查；Flutter 已接入 `flutter_secure_storage`，设备级运行时仍需验收 |
| A01-A08 | 治理与协议已实现 | OpenAI Chat/Responses/Anthropic 请求映射、流式事件、取消、模型 fallback、API key 池、上下文摘要、ToolLoop、模型工具 schema、站点范围过滤、ToolExecutor 授权/审计和会话 TTL/撤销；AI 会话与 Agent 任务有原子 JSON 恢复存储；用户 Skill/主题有持久化注册表；内置工具覆盖文件、repo/config、web、Git、template/skill、site/deploy，并支持扩展 gateway；MCP HTTP/SSE/stdio allow-list 与取消选项；真实桌面进程仍需用户白名单 |
| U01-U05 | 核心工具已实现 | RSS、链接检测/替换、GitHub 图床安全上传与重试、Git Data→Contents→CLI 降级、编码修复、持久化缓存清理、语言/代理偏好、全部功能目录与导航矩阵；Node Web 辅助工具面板已接入 RSS 刷新、链接检查、图床上传/重试、文件夹批量上传、缓存清理并插入 Markdown，Flutter Web 通过 `RemoteToolsPort` 调用同源 API 并提供图片选择/插入入口，原生端通过 `TUOMO_API_BASE_URL` 复用同一 RemoteTools/WorkspaceRemote HTTP adapter，设置页已持久化模式、主题、专注模式和编辑器字号；Flutter 辅助工具页已接入文章统计、格式化、查找替换和目录，设备级凭据和运行时仍需注入 |

Flutter/Dart 共享壳：`lib/main.dart`、`lib/presentation/app.dart`、`lib/application/editor_session.dart`、`lib/infrastructure/json_file_article_repository.dart`；当前 Web 壳已提供首页、写作、草稿、发布、站点、AI、图床、工具、设置和“全部功能”目录，Android、iOS、Web、Windows、Linux、macOS 官方 runner 目录已生成，对应核心与 widget 测试在 `test/flutter_core_test.dart`。

验收命令：

```powershell
npm run check
```

当前 Node 自动化验收为 153 项测试全部通过，`npm run test:coverage` 最新实测总行覆盖率为 95.20%（分支 74.12%，函数 89.60%）；HTTP Git/CMS/媒体/图床/远程文章/同步、健康检查、RSS/更新检查、运行时凭据、代理 fetch 和 Web 发布适配器统一支持 request ID、超时、重试和取消传播；本机 Flutter 3.47.3 已通过全工程格式化门禁、`flutter analyze`、19 项 `flutter test`、`flutter build web`，Flutter Web 与配置 `TUOMO_API_BASE_URL` 的原生 adapter 已接入站点读取、建站、构建触发、发布预览/确认和 AI 快速写作，命令面板、深链、系统最近文件适配器和平台源码契约已有测试/门禁，未配置时保留明确降级错误。`release:check` 会校验 `pubspec.yaml` 版本、平台源码契约、原生 HTTP smoke 并可生成 CycloneDX SBOM，`release.json` 由 `ReleaseManifestStore` 校验读取。原生端使用应用支持目录持久化仓库，Web 端使用浏览器 localStorage，偏好和秘密分别通过对应存储适配器注入。所有副作用能力都保留在 port/use case 后面，因此平台适配器接入时不会复制业务编排。
