# 拓墨重构与全功能复现实施文档

> 基线：`main` / `25261b8`（2026-09-11 检查）。本文以仓库中可执行代码为准；界面文案或历史说明与实现冲突时，以实现和自动化测试为准。

## 1. 目标、边界与结论

本项目的产品名称是“拓墨”（包名暂为 `hexo`）。它不是单纯的 Hexo 客户端，而是一个跨 Android、iOS、Web、Windows、Linux、macOS 的个人写作与多站点发布工作台：本地 Markdown 写作是核心，静态博客仓库、动态 CMS、AI Agent、同步、建站和桌面写作体验是可插拔能力。

本次重构的目标是：在不丢失现有已实现用户能力的前提下，建立一套可测试、可迁移、可逐端复用的实现。最终任何开发者只需按本文的领域模型、接口、流程、验收标准和迁移规则，即可重建全部能力，而无需依赖当前两个巨大 UI Shell 的隐式状态。

### 1.1 重构原则

1. **先锁定行为，再替换实现。** 先写黑盒验收和迁移测试；新模块通过后才替换旧入口。
2. **离线写作优先。** 保存草稿不能依赖网络、AI、站点或当前页面；网络失败不得丢失编辑内容。
3. **站点类型显式化。** 静态仓库与动态 CMS 共用文章语义，但它们的读写协议、冲突语义和发布路径必须分开实现。
4. **UI 不编排业务。** Flutter Widget 只呈现状态和派发意图；发布、同步、AI 工具执行、建站由 application/use-case 层编排。
5. **秘密不入通用 JSON。** Token、CMS 密码、MCP Header、Cloudflare Key 必须迁移到系统安全存储；普通设置仅保存秘密引用。
6. **逐步替换，不做“停机式重写”。** 每次只替换一个用例，旧实现可回退，数据格式保持可读。

### 1.2 当前实现的主要问题（重构必须解决）

| 问题 | 证据 | 处理决定 |
|---|---|---|
| 移动端和桌面端重复业务编排 | `lib/main.dart` 约 1,566 行，`lib/desktop/desktop_shell.dart` 约 11,730 行；两者分别实现保存、发布、同步、AI、设置和路由 | 提取共用 use case、状态仓库和 presenter；平台层仅保留 UI 与原生能力 |
| 单一 Shell 知道所有服务 | Shell 直接创建 Storage、GitHub、AI、CMS、同步、回收站、快照等服务 | 使用 composition root + 显式依赖注入；禁止静态全局回调注入 |
| `BlogRepository` 抽象不诚实 | `StaticBlogRepository` 的 create/update/delete/upload 抛 `UnimplementedError`，调用方又绕回 `GitHubService` | 拆成只读查询、文章写入、媒体写入三个 capability 接口；由类型系统表达能力 |
| Front Matter 有多套手写解析/生成 | `Article`、`FrontMatterData`、`FrontMatterService` 都处理 YAML/模板 | 保留一个 `FrontMatterCodec`；支持框架策略与未知字段无损保留 |
| 凭据可落在设置 JSON / 仓库 JSON | `AppSettings`、`RepoConfig`、`BlogSiteConfig`、AI Profile 均含 token/password/key 字段 | 迁移为 `SecretRef`；提供一次性迁移、失败提示和撤销策略 |
| LAN P2P 使用明文 HTTP + 共享 token | `P2PSyncService` 的 HTTP `/sync`、`X-Sync-Token` | 第一阶段保留兼容模式但标红；目标改为短期配对、TLS/Noise 加密、设备指纹确认 |
| CI 把静态检查降级为成功 | `build.yml` 中格式化和 `flutter analyze` 均以 `|| true` 结束 | 重构分支起取消忽略；质量门禁必须阻止合并 |
| 功能入口过多但层级不清 | 约 40 个导航入口，标准/简易模式与隐藏功能并存 | 按“写作、发布、站点、自动化、数据、安全”重新分层；保留所有入口的 deep-link 映射 |

### 1.3 保留、改造与下线的判定

本次不应以“功能看起来多”为由直接删除功能。下表是默认产品决策；任何改动需要在 PR 中标注对应能力编号。

| 处理 | 能力 | 原因 |
|---|---|---|
| 保留为核心 | 本地 Markdown、草稿、阅读预览、Front Matter、模板、图片、导入导出、版本快照、回收站 | 这是离线写作的基本闭环 |
| 保留并接口化 | 静态仓库发布、多框架渲染、多 Git 提供商、镜像推送、CMS 适配器 | 是产品差异化能力，但不应绑死 GitHub 或 UI |
| 保留并收敛 | 云同步、WebDAV、P2P、冲突处理、备份恢复 | 统一到一份同步领域模型和冲突策略 |
| 保留并隔离高风险 | AI 对话、Agent、内置工具、Skill、MCP、AI 建站/主题迁移 | 必须增加权限、审计、取消、预算和 tool allow-list |
| 改为插件/实验室功能 | P2P、主题商店、主题迁移、站点运维、批处理、编码修复、MCP stdio | 仍可复现，但不再占据基础写作路径 |
| 删除旧实现，不删除产品能力 | 重复 Shell 业务代码、`RemoteCmsTools.siteManager` 静态注入、`StaticBlogRepository` 的空写接口、`editor_screen.dart.bak` 与 `_archive/` 的运行依赖 | 以新的单一实现替代；归档仅保留 Git 历史 |

## 2. 产品能力全景（现状行为合同）

以下编号是重构后的“行为合同”。验收测试、迁移计划、导航注册表和发布说明均应使用这些编号。

### 2.1 写作与本地内容（W）

| 编号 | 能力 | 当前处理逻辑与必须复现的结果 |
|---|---|---|
| W01 | 新建文章/页面 | 创建带 UUID（当前为时间戳）的 `Article`；默认 `post`，可改为 `page`；选择当前站点和该站默认模板。 |
| W02 | 编辑器 | 编辑标题、正文、标签、分类、封面、文章类型、模板、卷宗、计划发布时间；支持 Markdown 标题、列表、引用、代码、表格、链接、TOC、查找替换、格式化。 |
| W03 | 多标签与会话 | 桌面端每个标签独立保存正文、元数据、仓库、模板、分栏模式、未保存基线；切换标签不得串内容。应用恢复时回到首页、阅读页或编辑页。 |
| W04 | 自动保存 | 文本变化按文章独立防抖；定时保存、页面切换、应用转后台/窗口关闭均冲刷待保存内容。标题变化同样影响“未保存”状态。 |
| W05 | 本地草稿 | 保存到草稿索引并导出 Markdown；按 `updatedAt` 倒序。动态 CMS 当前还会另存 SQLite 草稿记录。 |
| W06 | 阅读与预览 | 阅读页与编辑页分离；支持实时 Markdown 预览、代码高亮、KaTeX、Mermaid（WebView 可用端）、HTML/PDF/PNG 长图预览或导出。 |
| W07 | 内容资产 | 支持片段库、文章模板、标签/分类建议、卷宗分组、写作字数统计、拼写检查、全文搜索。 |
| W08 | 版本与删除保护 | 删除草稿先尝试移入回收站；快照可浏览、恢复、删除和定期清理。 |
| W09 | 导入导出 | 导入 `.md`、HTML→Markdown、DOCX 文本；导出 Markdown、HTML、PDF、DOCX、EPUB、PNG 长图；支持文件区暂存和外部 SAF 目录。 |
| W10 | 移动/桌面体验 | 移动端有速记入口、小部件文件打开和横竖屏状态保持；桌面端有多栏、专注模式、打字机滚动、命令面板、拖放、最近文件、窗口/托盘。 |

### 2.2 站点与发布（P）

| 编号 | 能力 | 当前处理逻辑与必须复现的结果 |
|---|---|---|
| P01 | 静态站点配置 | 一个 `RepoConfig` 定义 provider、owner/repo、branch、文章/页面目录、框架、文件名规则、时区、镜像、部署 Hook、默认模板和站点 URL。 |
| P02 | 框架渲染 | 内置 Hexo、Hugo、Jekyll、VuePress、Gatsby、Next.js、Astro、Pelican、11ty；按框架生成目录、Front Matter、日期格式和文件名。Jekyll 或设置了日期前缀的站点须生成 `YYYY-MM-DD-slug.md`。 |
| P03 | 单站静态发布 | 发布前检查空正文、外链图片、无标题、正文少于 20 字；确认后用目标站点模板渲染，读取远程 SHA，调用 Git provider 更新/创建文件；成功更新本地远程路径/SHA，并触发镜像与部署 Hook。 |
| P04 | 批量静态发布 | 可选择所有或指定静态站点；预览阶段并发（上限 4）验证 token、读取远端旧文件、计算逐行 diff；确认阶段重新读取 SHA 后逐站写入，给出逐站成功/失败结果。 |
| P05 | 静态文章管理 | 递归列出文章目录中 Markdown，拉取内容并解析；支持搜索、打开、删除、批量删除、提交历史和单文件回滚；有基于远程 fingerprint 的快照缓存。 |
| P06 | 动态 CMS | 支持 WordPress、Ghost、Typecho（Secure API、FastAPI、RESTful 三种适配器）；统一列表、详情、创建、更新、删除、媒体上传、连通性测试。 |
| P07 | 多站点聚合 | 静态站点和 CMS 文章可按站点/类型筛选、聚合显示；编辑器根据激活站点选择静态发布或 CMS Create/Update。 |
| P08 | 发布到多个 CMS | 当前激活动态站点发布时可选择一次发布到所有动态 CMS；逐站独立调用适配器并收集结果。 |
| P09 | 一键建站 | 两种模式：GitHub/GitLab Pages（建仓→骨架/CI→启 Pages→欢迎文→轮询构建），Cloudflare Pages（建仓→骨架→用户控制台绑定→探测项目/Hook→首文→触发 Hook）；失败逆序回滚。 |
| P10 | 站点生命周期 | 站点统一管理、切换、编辑、删除、默认站点、批量连通性检测；健康检查聚合 CI、HTTP、页面非空、最后提交时间，支持触发 CI。 |

### 2.3 同步、备份与安全（S）

| 编号 | 能力 | 当前处理逻辑与必须复现的结果 |
|---|---|
| S01 | WebDAV 草稿同步 | 可上传缺失的本地 Markdown，也可列出远端目录并下载本地不存在的草稿；当前是存在性合并，不是完整双向冲突算法。 |
| S02 | 云端全量同步 | GitHub 私有同步仓库或 WebDAV 后端可存草稿、设置、同步映射、模板、片段；有设备密钥加密、定时推送、启动拉取和全量 push/pull。模板/片段以 ID 合并，远端同 ID 覆盖本地。 |
| S03 | 文章—远端映射同步 | `SyncService` 对比本地 Article 与 CMS `BlogPost`，列出待推、待拉、冲突，支持用户选择解决结果。 |
| S04 | LAN P2P | UDP 发现设备、HTTP 建连、共享同步 token、发送 `P2PFileEntry`；另有 SHA-256 的增量文件同步与本地/远程/较新版本冲突策略。 |
| S05 | 本地安全 | 草稿可启用 AES-256-GCM（PBKDF2）；密码只留内存、元数据保存盐与校验哈希；旧明文/密文保留 `.bak` 以防迁移失败。 |
| S06 | 数据恢复 | 单 JSON/Base64 归档导出 settings、repos、drafts、templates、snippets、统计、站点任务和设备密钥；恢复时拒绝绝对路径、盘符、`..` 路径。 |
| S07 | 可观察性 | 操作日志记录保存/发布/删除等；同步 UI 显示状态、日志、冲突；更新检查读取根目录 `release.json`。 |

### 2.4 AI、工具与自动化（A）

| 编号 | 能力 | 当前处理逻辑与必须复现的结果 |
|---|---|
| A01 | 快捷写作 AI | 润色、续写、摘要、大纲、代码生成、选区改写；请求可流式输出，取消后旧请求不得写回 UI。 |
| A02 | 多 Provider/模型 | 兼容 OpenAI Chat、OpenAI Responses、Anthropic；内置 OpenAI、DeepSeek、SiliconFlow、Moonshot、Ollama、Azure、混元、百炼、火山、Gemini 等预设，也允许自定义 endpoint。 |
| A03 | 模型调度 | 模型按 group、优先级、健康统计、超时和失败计数选择；支持备用 key 池轮转、自动切换、模型检查、上下文上限与增量摘要。 |
| A04 | Agent 工作台 | 管理任务目标、附件、工作区、工具执行时间线、文件变更、任务状态和恢复；每站点拥有独立 dispatcher/对话上下文。 |
| A05 | 工具系统 | 内置网页搜索/抓取、仓库读写删列、Git 快照/回滚、配置、模板、技能、建站、部署与校验工具；工具有 source、scope、enabled、riskLevel、siteId。 |
| A06 | Skill/MCP | 用户可创建/编辑/删除技能；MCP 支持 HTTP、SSE、桌面 stdio，执行 JSON-RPC `initialize` 握手和连接复用。 |
| A07 | AI 建站与主题 | Agent 可以按步骤调用建站工具，主题商店可安装精选主题；AI 可分析主题、生成跨框架迁移方案、预览后写入。 |
| A08 | 审计与治理 | 调度器回传模型切换和工具执行；高风险工具目前可由设置决定是否确认。重构后必须默认确认外部写、删除、部署、创建仓库和执行本地进程。 |

### 2.5 辅助工具与系统（U）

| 编号 | 能力 |
|---|---|
| U01 | RSS 订阅与刷新、远程文章浏览、提交历史和文件回滚。 |
| U02 | 图床：选图/多选、按配置压缩、上传 GitHub 图床、插入 Markdown；失败保留字节并写入可重试标记。 |
| U03 | 文件夹批量上传：Git Data API 批量提交 → Contents API 逐文件 → 桌面 git CLI 依次降级。 |
| U04 | 链接检测/批量替换、批处理（导出/格式化/发布）、编码修复、缓存清理、代理、夜间护眼和语言设置。 |
| U05 | 简易/标准模式、功能 Hub、侧边栏显隐与置顶、主题色/设计参数/编辑器主题和壁纸。 |

## 3. 关键端到端处理逻辑

这一节是复现的核心。实现可以变化，但输入、状态转移、外部调用顺序、成功结果和失败保护不可变化。

### 3.1 启动与恢复

```text
main / desktop_main
  → 初始化平台能力（桌面 SQLite FFI、窗口、托盘；移动 MethodChannel）
  → 组合根创建 Service/Repository/UseCase/Store
  → StorageRootResolver 选择存储根目录并创建分类目录
  → 读取 settings, repos, drafts, templates, snippets
  → 迁移旧 GitHub token、空仓库默认配置、旧数据格式
  → 初始化 SiteRegistry，并绑定当前 activeSite
  → 加载草稿加密元数据；若锁定则只显示解锁/恢复路径
  → 初始化日志、快照、回收站、统计、工具库、同步后端
  → 若允许，恢复 SessionState（首页/阅读/编辑）；启动自动保存、自动同步、更新检查
```

必须保证：任一步非致命初始化失败只降级对应功能并记录诊断，不能使编辑器无法打开；启动过程中不把空配置写回覆盖已有数据；所有异步回调检查对象仍存活/请求 generation。

### 3.2 编辑与本地持久化

```text
用户输入
  → EditorSession 更新纯内存 DocumentDraft
  → DirtyTracker 比较内容与标题/元数据基线
  → 按 documentId 替换原有 debounce 任务
  → debounce 到期 / 周期 timer / 切换标签 / 生命周期 pause / close
  → SaveDraftUseCase
       1. 验证最小结构，写临时文件
       2. 原子替换 drafts 索引
       3. 导出可读 Markdown（若用户开启）
       4. 创建版本快照（按策略）
       5. 记录字数“增量”与审计日志
       6. 更新已保存 revision，不覆盖后来输入
  → UI 显示 saved / failed / retry
```

重构时以 revision（单调递增整数或 content hash）代替当前散落的 `_lastSavedContentMap`、`_lastSavedTitleMap` 和多个 Timer。保存任务必须带 revision；旧 revision 写完后不得将新 revision 标为已保存。

### 3.3 静态博客的渲染和发布

```text
PublishArticleCommand(articleId, targetSiteIds)
  → 读取当前草稿的不可变快照
  → Preflight：空内容、标题、短文、外链图、站点/凭据/路径/模板校验
  → 对每个静态站点：
       TemplateResolver(文章显式模板 > 站点默认模板 > 框架预设)
       FrameworkRenderer(Article, RepoConfig) → RenderedFile(path, content)
       RemoteFileGateway.get(path) → current sha/content
       diff(old, new)（预览模式）
  → 用户确认预览
  → 对每站重新读取 sha（乐观并发控制）
  → put(path, content, expectedSha)
  → 可选镜像推送、部署 Hook，逐项收集结果
  → 保存 remotePath/remoteSha/published 状态；写审计事件
```

框架渲染规则必须显式由策略承载：

- **日期**：使用站点 `publishTimeZoneOffsetMinutes`（默认 +08:00）；非计划发布时，未来创建时间钳制为当前时间；计划发布保留未来时间。
- **文件名**：清洗 `\\ / : * ? \" < > | # %` 和空白；空 slug 使用 `untitled`；Jekyll 与日期前缀规则要求日期前缀。
- **非 ASCII slug**：当前逻辑使用 `post-<timestamp>`，以避免 URL 编码问题。新实现应提供可选拼音策略，但兼容模式必须产出同等安全名称。
- **Front Matter**：文章自定义模板优先；无 cover 时删除整行占位符；无值 Pelican 标签/分类整行删除；未知占位符所在行删除并报告警告。
- **并发冲突**：远端 SHA 与预览时变化时不得静默覆盖。重新拉取、计算新 diff，要求用户“覆盖、合并、取消”。

### 3.4 CMS 发布与同步

```text
activeSite 为 DynamicCms
  → 将 Article 映射为 CanonicalPost（标题、Markdown、slug、tag/category、status、日期）
  → 若已有 remoteId：adapter.update；否则 adapter.create
  → adapter 在边界执行 CMS 方言转换（认证、HTML/Markdown、日期、状态）
  → 成功后写 RemoteBinding(siteId, localId, remoteId, remoteRevision, syncedAt)
  → 失败仅记录错误，不删除本地草稿

Sync compare
  → 读取本地修订与远端修订/更新时间/content hash
  → 分类：inSync / pushRequired / pullRequired / conflict / missing
  → 对 conflict 生成三方输入 (base, local, remote)
  → 用户选择本地、远端、手工合并；成功后更新 binding
```

不得再令静态仓库伪装成能 `createPost` 的 CMS 适配器。静态发布走 `StaticPublishGateway`；动态 CMS 走 `CmsPostGateway`。列表查询可由共同的 `PostQueryGateway` 统一。

### 3.5 云同步、WebDAV 与 P2P

```text
Cloud Push
  → 写入 manifests/<deviceId>.json（对象 revision/hash）
  → 上传 drafts/settings/mappings/templates/snippets 的带版本对象
  → 成功后写本地同步游标；失败保留 outbox，可重试

Cloud Pull
  → 下载 remote manifest
  → 与 local manifest 比较 revision/vector clock
  → 无冲突对象直接合并；同对象双端修改进入 Conflict record
  → settings 只合并允许同步的字段；秘密只同步 SecretRef，绝不上传明文

P2P Pair
  → 两端显示短验证码/二维码并确认设备指纹
  → 建立加密会话，交换 manifest，而非直接信任任意 UDP 广播
  → 仅传变更对象；逐对象 hash 校验；同样进入统一 Conflict record
```

当前 WebDAV 行为只上传/下载“本地不存在”的草稿；重构不得把它描述为真正双向同步。正式实现必须通过统一 manifest/revision 模型补足更新和冲突检测。为兼容旧用户，可保留“导入缺失草稿”按钮，但名称必须准确。

### 3.6 AI 对话、模型调度和工具循环

```text
ChatCommand(message, sessionId, siteId)
  → 加载 SiteScopedConversation（system prompt + 历史 + 摘要）
  → 从 ToolRegistry 筛选 enabled 且 scope 允许的工具
  → 根据模型组/优先级/健康度选择候选模型
  → 发流式请求；请求 generation 绑定 cancellation token
  → 若模型返回 tool calls：
       校验 schema、站点 capability、路径、风险与用户授权
       执行工具并记录 ToolExecution（输入摘要、输出摘要、耗时、结果）
       将 tool result 写回模型；最大循环次数/预算受限
  → 若可恢复失败或超时：保留全量上下文，切换候选模型并通知 UI
  → 定期将较早历史增量摘要，写入持久化会话
```

默认权限策略：读取低风险可直接执行；写仓库、删文件、回滚、部署、建仓、调用外部 URL、启动 MCP stdio 必须逐次或按会话授权；不得以“AI 全权”作为默认。工具只接收结构化参数，禁止把模型输出直接拼进 shell 命令、文件路径或 URL。

### 3.7 一键建站

```text
Validate scopes and plan
  → create remote repository
  → initialize default branch
  → write framework skeleton + CI workflow
  → Mode 1: enable GitHub/GitLab Pages
  → Mode 2: wait for user to attach Cloudflare Pages project + fetch deploy hook
  → write welcome post
  → poll build/deployment with cancellation and upper timeout
  → persist RepoConfig only after a usable result is assembled
  → on failure execute idempotent rollback plan; report resources left behind
```

AI 的分步工具可以调用相同 use case 的 step API；不能另写一套“AI 专用建站逻辑”。每个远程副作用都要有 idempotency key、审计记录和可回滚的 `CreatedResource`。

## 4. 统一领域模型与数据格式

### 4.1 建议的模块边界

```text
lib/
  app/                 组合根、路由、依赖注入、平台启动
  domain/              无 Flutter/IO：实体、值对象、策略、领域事件
    article/ site/ sync/ ai/ tool/ backup/
  application/         用例、命令、查询、事务编排、权限策略
  infrastructure/      JSON/SQLite/Keychain、Git Provider、CMS、HTTP、MCP、文件系统
  presentation/        mobile/ desktop/ shared-ui/，只依赖 application 的状态与命令
  platform/            MethodChannel、窗口、托盘、SAF、小部件、文件打开
```

依赖只能从外向内：`presentation → application → domain`；`infrastructure` 实现 application/domain 定义的端口。`domain` 不得导入 Flutter、`dart:io`、HTTP 或第三方 provider SDK。

### 4.2 必要实体

| 实体 | 关键字段 | 不变量 |
|---|---|---|
| `Article` | id、title、body、metadata、localRevision、createdAt、updatedAt、volume、scheduleAt | id 不变；每次可见修改递增 localRevision；正文使用 UTF-8 Markdown |
| `ArticleMetadata` | tags、categories、cover、kind(post/page)、templateId、extraFrontMatter | extra 字段无损保存；标签/分类去重且维持顺序 |
| `Site` | id、name、kind(static/cms)、isDefault、url、credentialRef | 当前激活 site 必须存在，或显式为 null |
| `StaticSiteConfig` | provider、repo、branch、postPath、pagePath、framework、filenameRule、timezone、mirrors、hooks | path 必须是相对安全路径；分支不能为空 |
| `CmsSiteConfig` | cmsKind、baseUrl、authRef、ignoreSsl、adapterOptions | 生产环境默认 HTTPS；不安全 SSL 必须用户显式确认 |
| `RemoteBinding` | siteId、articleId、remoteId/path、remoteRevision/SHA、baseContentHash、syncedAt | 一个 article/site 最多一条活跃绑定 |
| `Template` | id、name、frameworkId、kind、frontMatter、isBuiltin、version | 内置模板不可原地覆写；用户覆盖创建新版本 |
| `SyncObject` | objectType、objectId、revision、hash、modifiedAt、originDeviceId | revision/hash 用于冲突判断，不能只比较存在性 |
| `ToolDefinition` | id、kind、scope、siteId、params、risk、enabled、secretRefs | schema 通过后才可注册；scope 校验在执行时再次进行 |
| `AgentSession` | id、siteId、history、summary、toolAudit、budget、state | 站点间不共享对话上下文，除非用户显式导出/导入 |

### 4.3 存储布局与迁移目标

```text
<root>/
  meta/schema.json                 # 当前 schemaVersion、迁移日志
  settings/public.json             # 非秘密设置
  secrets/                         # 仅保存 SecretRef 元数据；秘密在 Keychain/Keystore
  articles/index.json              # 或 SQLite 索引
  articles/<articleId>.json        # 文章 + 元数据 + revision
  exports/markdown/                # 用户可见 MD
  snapshots/<articleId>/            # 版本快照
  trash/                            # 回收站索引与内容
  templates/                        # 模板版本
  sites/<siteId>/                   # 站点私有设置、任务、缓存
  sync/manifest.json                # 统一同步游标和对象索引
  logs/audit.jsonl                  # 脱敏审计日志
  cache/                            # 可安全清除的远端列表、预览和搜索索引
```

兼容导入器必须读取现有 `settings.json`、`repos.json`、`drafts.json` / `drafts.json.enc`、`templates.json`、`snippets.json`、`writing_stats.json`、`.device_key` 和 `sites/`。导入须先备份原文件；迁移完成后保留只读备份，直到用户明确清理。

### 4.4 接口草案

```dart
abstract interface class ArticleRepository {
  Future<Article?> get(ArticleId id);
  Future<List<ArticleSummary>> list(ArticleQuery query);
  Future<void> put(Article article, {required int expectedRevision});
  Future<void> moveToTrash(ArticleId id);
}

abstract interface class StaticPublishGateway {
  Future<RemoteFile?> getFile(StaticSite site, RepoPath path);
  Future<PutFileResult> putFile(
    StaticSite site,
    RenderedFile file, {
    required RemoteRevision? expectedRevision,
  });
  Future<void> deleteFile(StaticSite site, RepoPath path,
      {required RemoteRevision expectedRevision});
}

abstract interface class CmsPostGateway {
  Future<CmsPostPage> list(CmsSite site, PostQuery query);
  Future<CmsPost> create(CmsSite site, CanonicalPost post);
  Future<CmsPost> update(CmsSite site, RemoteId id, CanonicalPost post,
      {RemoteRevision? expectedRevision});
  Future<void> delete(CmsSite site, RemoteId id);
}

abstract interface class SecretStore {
  Future<SecretRef> put(SecretValue value);
  Future<SecretValue?> get(SecretRef ref);
  Future<void> delete(SecretRef ref);
}
```

所有 gateway 返回可分类错误（unauthorized、notFound、conflict、rateLimited、network、validation、unsupported），不得让 UI 靠字符串匹配异常决定流程。

## 5. 前端复现规格

### 5.1 统一导航信息架构

默认工作区只展示高频入口：**首页、写作、草稿、发布/同步中心、站点、AI、图床、设置**。其余能力全部保留在“全部功能”，并可被用户置顶。标准/简易模式只影响可见性，不得影响路由、权限或底层数据。

| 分区 | 路由/功能 | 行为 |
|---|---|---|
| 写作 | 首页、草稿、编辑器、阅读、模板、片段、全文搜索、写作统计 | 进入编辑器前恢复文章快照；离开前请求保存而非丢弃 |
| 发布 | 静态文章、远程文章、批量发布、提交历史、预览 | 写操作统一经过发布预览/确认；只读浏览不触发 token 校验 |
| 站点 | 站点管理、CMS 配置、一键建站、站点运维 | 站点切换先 flush 当前文章，再重建 site-scoped session |
| 数据 | 云同步、WebDAV、P2P、版本、回收站、备份恢复、文件区 | 明确展示方向、对象数、冲突、可恢复操作和最后成功时间 |
| AI | 快捷动作、文章对话、Agent、模型、工具库、MCP、主题迁移 | 每次工具副作用有权限卡片和可展开审计 |
| 系统 | 设置、代理、日志、更新、帮助、外观与侧边栏 | 删除/清缓存/恢复要展示影响范围和二次确认 |

### 5.2 平台差异

| 能力 | Mobile | Desktop | Web |
|---|---|---|---|
| 编辑 | 单页、底部工具条、速记/小部件、SAF | 多标签、三栏、拖放、命令面板、快捷键 | 响应式布局、浏览器下载/存储 |
| 文件 | MethodChannel、SAF、系统选择器 | 原生路径、工作区文件夹、系统托盘 | 虚拟存储/浏览器 File API，禁止假定 `dart:io` |
| MCP stdio | 不支持 | 支持且须明确授权 | 不支持 |
| 预览 | WebView 或 Flutter renderer | Flutter renderer / 本地资源服务 | 浏览器 iframe/renderer |

禁止把业务分成 `main.dart` 与 `desktop_shell.dart` 两个分支实现；平台差异只能通过 `FilePickerPort`、`WindowPort`、`QuickNotePort`、`PreviewPort` 等 adapter 体现。

## 6. 分阶段实施计划

### Phase 0：冻结行为与建立安全护栏（1 周）

1. 为 W01–W09、P01–P06、S01–S06、A01–A06 建立行为测试清单。
2. 记录样例库：每个静态框架至少一篇 post/page、中文标题、未来日期、空 tag/cover、覆盖远端文件、冲突文件；每种 CMS 至少有 mock server 契约。
3. CI 移除 `dart format`、`flutter analyze` 的 `|| true`；执行 `flutter test`、域层测试、golden/集成测试；把发布 job 权限收窄到仅 release job。
4. 增加日志脱敏器：token、Bearer、password、cookie、MCP header 一律以 `***` 输出。

验收：旧应用与测试夹具在关键流程的外部副作用（写入内容、路径、提交消息、状态）一致；任何 lint/analyze error 阻止合并。

### Phase 1：基础内核与数据迁移（1–2 周）

1. 创建 `domain`、`application`、`infrastructure`、`presentation` 目录并启用依赖边界检查。
2. 实现 `Article`、`Site`、`Template`、`RemoteBinding`、`SyncObject`、`SecretRef` 和错误模型。
3. 实现新 ArticleRepository（先 JSON，接口预留 SQLite），原子写入、revision CAS、回收站和快照。
4. 写 `LegacyMigrationUseCase`：预检查空间→备份→迁移→校验 hash→写 schema version；必须可重入。
5. 引入 SecretStore；将旧设置中的秘密提取成 SecretRef；失败时保留旧文件并引导用户重新输入。

验收：至少三份真实脱敏导出数据可迁移、可回滚、可再次运行；草稿锁定、解锁、导入、导出均不丢数据。

### Phase 2：写作垂直切片（1–2 周）

1. 完成新编辑状态机：DocumentSession、DirtyTracker、SaveScheduler、SessionRecovery。
2. 完成一套 `FrontMatterCodec` 与框架策略；旧解析器只留为兼容导入器。
3. 迁移模板、片段、卷宗、字数、搜索、快照、回收站、导入导出。
4. 在 mobile 与 desktop 同时接入新的 `EditArticleUseCase`，不改变视觉布局。

验收：同一文章开 3 个桌面标签并交替编辑，切换/自动保存/关闭恢复均正确；断网、异常退出、延迟写入不丢最后确认文本。

### Phase 3：静态发布垂直切片（1–2 周）

1. 抽象 Git provider，保留 GitHub/GitLab/Gitee/Bitbucket 实现；统一 provider capability。
2. 实现 Render、Preview、Optimistic Put、Delete、Rollback、Mirror、Hook 的独立 use case。
3. 迁移文章列表递归获取、缓存 fingerprint、批量上传三段降级链。
4. 用本地 mock Git API 测试创建、更新、SHA 冲突、限流、镜像部分失败、Hook 部分失败。

验收：九个框架的 golden Markdown 与当前兼容渲染一致；预览后远端变更不会被静默覆盖；失败仍保留本地草稿和可重试命令。

### Phase 4：CMS 与统一站点层（1–2 周）

1. 为 WordPress、Ghost、三种 Typecho 定义契约测试并逐个迁移。
2. 分离 `PostQueryGateway`、`CmsPostGateway`、`MediaGateway`；清理静态仓库的空写实现。
3. 完成统一远端文章筛选、打开、删除、CMS 草稿和本地/远端映射。
4. 完成双向同步比较、三方合并与冲突决策持久化。

验收：六个 adapter 契约全部通过；在同一 UI 中切换静态/CMS 不会复用错误 token、上下文或缓存。

### Phase 5：同步、备份与安全（1–2 周）

1. 用 manifest + revision/hash 重写 GitHub/WebDAV 全量同步；outbox 支持离线重试。
2. 将 WebDAV“导入缺失”单独保留为兼容工具，主同步走统一对象模型。
3. P2P 增加配对、会话加密、设备许可和速率/体积限制；未完成前标为实验功能。
4. 备份归档改为流式压缩、可选用户密码加密、校验 manifest，恢复默认不覆盖而是预览差异。

验收：模拟双端同时编辑同一文章必生成冲突；无冲突对象可离线 push 后恢复网络自动重试；错误凭据不泄露到日志/备份。

### Phase 6：AI、工具与建站（2–3 周）

1. 将模型协议 adapter、选择策略、会话、上下文摘要、预算拆开；建立 provider mock/录制测试。
2. 统一 ToolRegistry、PolicyEngine、ToolExecutor、AuditStore；接入 schema 校验、路径限制、授权 UI。
3. Skill 与 MCP 改为受限插件：HTTP allow-list、stdio 命令白名单/用户确认、可关停连接。
4. 让 SiteWizardService、主题安装/迁移只通过用例与事务日志执行；AI 与表单使用同一实现。

验收：取消、故障切换、工具循环上限、敏感操作确认、工具审计和站点隔离均有自动化测试；模型不能越权访问其他站点。

### Phase 7：平台 UI 收敛与清理（1–2 周）

1. 以共享 presenter/view model 替换 mobile RootShell 与 DesktopShell 的业务状态。
2. 逐屏迁移到 feature folder；保留桌面壳（窗口/托盘/快捷键）和移动壳（深链/小部件），删除业务重复。
3. 迁移标准/简易导航注册表，添加 deep-link compatibility test。
4. 删除 `.bak`、不再引用的 archive 代码、样例 TODO 页面；只在迁移完成后移除旧路径。

验收：两个平台调用同一 use case；桌面 Shell 不超过 2,500 行，任一 feature 文件不超过 600 行（超出必须拆分）；导航矩阵覆盖全部 U/W/P/S/A 编号。

### Phase 8：发布与长期治理（持续）

1. 更新 release 工具，使版本仅来自 `pubspec.yaml`，发布前执行测试、迁移检查、SBOM/依赖审计。
2. 将 Android 签名获取移到受保护 release 环境，删除 `if: always()` 的密钥拉取。
3. 定义数据库/schema 兼容期、弃用策略和数据导出承诺。

## 7. 功能验收矩阵

以下最低验收项覆盖“按本文复现全部功能”的定义；每项应实现为自动化测试、集成测试或可重复的手工测试脚本。

| 编号 | 场景 | 通过条件 |
|---|---|---|
| AC-W01 | 新建、编辑、切标签、杀进程恢复 | 3 篇文章互不串数据；最后已保存 revision 恢复正确 |
| AC-W02 | 中文/英文/特殊字符标题、tags/categories、cover、page | 生成/解析后语义一致，未知 Front Matter 不丢失 |
| AC-W03 | MD、HTML、DOCX 导入；MD/HTML/PDF/DOCX/EPUB/PNG 导出 | 文本可读、文件名安全、失败有明确错误且不破坏源稿 |
| AC-P01 | 九种框架渲染 | 目录、日期、Front Matter、文件名与 golden 文件一致 |
| AC-P02 | 静态新建、更新、SHA 冲突、删除、回滚 | 更新携带 revision；冲突不覆盖；删除/回滚可审计 |
| AC-P03 | 多静态站点预览与发布 | 预览只读；最多 4 路并发；逐站结果准确；重新探测 SHA |
| AC-P04 | WordPress/Ghost/Typecho 适配器 | mock server 的认证、列表、CRUD、媒体、错误映射全部通过 |
| AC-P05 | 一键建站 | 正常、取消、构建超时、部分失败/回滚均留下可解释结果 |
| AC-S01 | 云同步双端修改 | 同内容去重；一端修改自动合并；双端修改创建冲突，不丢任一版本 |
| AC-S02 | WebDAV / P2P / 备份恢复 | 断网重试；非法路径拒绝；备份完整性可验证；P2P 未配对不能写入 |
| AC-S03 | 密钥迁移与日志 | 旧凭据可迁移到安全存储；JSON/日志/备份中不出现明文 token/password |
| AC-A01 | 三种 AI 协议、取消、fallback | 历史连续；取消后没有旧响应写回；故障切换记录原因 |
| AC-A02 | 工具权限 | 读工具成功；写/删/部署/stdio 均需要授权；越站/路径穿越/schema 错误被拒绝 |
| AC-U01 | 图床与批量上传 | 压缩/上传/插入成功；失败可重试；Git Data→Contents→CLI 降级可观测 |
| AC-UI | 简易/标准模式、Desktop/Mobile | 所有注册入口均可打开；隐藏只是 UI 状态而非权限；平台差异不改变业务结果 |

## 8. 质量、安全和性能门槛

### 8.1 质量门槛

- `dart format --output=none .`、`flutter analyze`、单元测试必须零错误；不允许 `|| true` 掩盖错误。
- Domain/application 测试覆盖率不低于 80%；发布、同步、AI 权限、迁移、加密、路径校验为 100% 分支覆盖目标。
- 所有 HTTP 都须有超时、取消、错误分类、指数退避（针对 429/5xx）和 request ID。
- 远端批量操作必须有并发上限、进度、可取消性、局部成功结果和重试入口。
- 用户可见写操作记录脱敏审计日志；所有删除需回收站/可恢复策略或明确不可逆确认。

### 8.2 安全门槛

- SecretStore 使用 Android Keystore、iOS Keychain、桌面 OS credential vault；没有可用安全存储时提示用户风险，不能静默降级到明文。
- 草稿加密继续使用 AES-256-GCM；密码校验改为标准 PBKDF2/Argon2 派生验证，不自行循环 SHA-256。
- 路径统一通过 `SafeRelativePath`；拒绝绝对路径、`..`、NUL、符号链接逃逸；恢复、P2P、MCP 文件操作都调用同一校验器。
- HTML 预览、HTML 导出、外部抓取内容必须净化或在 sandbox webview/iframe 中显示。
- AI/MCP 权限采用最小授权，授权有会话过期和撤销；工具输出不含秘密。

### 8.3 性能门槛

- 启动先展示本地文章索引，网络刷新在后台；列表缓存使用版本指纹/ETag。
- 大 Markdown 的解析、全文搜索、图片压缩、批量 diff 放 isolate；UI 每帧不做全文重新解析。
- 编辑保存只写发生变化的文章，不整表序列化；云同步只上传 hash 变化对象。
- 远端递归列表与提交日期补全必须有限制并发和分页，不可一次加载无限目录。

## 9. 现有代码到新模块的映射

| 现有位置 | 迁移去向 | 说明 |
|---|---|---|
| `lib/main.dart` + `lib/mixins/*` | `presentation/mobile` + application use cases | 先替换保存、发布、同步，最终只留移动启动/导航壳 |
| `lib/desktop/desktop_shell.dart` | `presentation/desktop` + 同一 application use cases | 保留窗口、托盘、快捷键、拖放；禁止复制业务流程 |
| `lib/controllers/*` | presentation state + domain value objects | `DocumentController`/`EditorController` 可演化为 session presenter；不要让 controller 落盘 |
| `lib/models/article.dart` | `domain/article` + `FrontMatterCodec` | 文章与渲染策略解耦，保留 JSON 导入兼容 |
| `lib/services/storage_service.dart` | infrastructure/local storage | 分开 Settings、Article、Export、SAF、Migration repository |
| `lib/services/github_service.dart` + `git_providers.dart` | infrastructure/git | provider REST、批量 Git Data、CLI fallback 均在此处 |
| `lib/core/repository/*_adapter.dart` | infrastructure/cms | 先写契约测试，再迁移逐个 adapter |
| `lib/core/site_manager.dart` | application/site registry | 无全局静态注入；站点切换为事件 |
| `lib/services/cloud_sync_service.dart`、`sync_service.dart`、P2P | domain sync + infrastructure sync transports | 一份 manifest、冲突和策略模型 |
| `lib/services/ai_service.dart`、`core/ai/*` | application/ai + infrastructure/llm | 协议 adapter、调度、会话、工具权限分别建模 |
| `lib/core/tools/*` | domain tool + application executor + infrastructure MCP | 传输层不参与权限判断 |
| `lib/services/site_wizard_service.dart` + scaffold | application/site provisioning | AI 与表单共享相同可回滚步骤 |

## 10. 不可忽略的现状差异与兼容说明

1. README 提到“完整测试覆盖”，但仓库当前只有少量测试文件；实施时应以本文件 AC 矩阵补齐测试，不应把历史说明当作覆盖率事实。
2. 静态站点读取适配器的 CRUD 方法目前明确未实现；用户实际发布路径绕过了它。因此新架构应保留用户能力，但不能保留该错误抽象。
3. 当前 Cloud Sync 的对象加密/兼容逻辑与草稿 AES 加密不同；迁移时须为每种历史格式建立解码器，写入统一的新信封格式。
4. 当前 P2P 与 WebDAV 的“同步”语义并不完全一致；重构后统一为显式的 push、pull、merge、import-missing 四个命令，避免误导用户。
5. 本项目有 Android 原生速记/小部件实现、桌面窗口功能和 Web 降级路径。它们属于平台 adapter，必须在各端能力不可用时隐藏或给出替代路径，而不是抛运行时错误。

## 11. 交付物定义

每个阶段完成时应交付：

1. 可运行的功能切片与迁移开关；
2. 对应能力编号的测试和测试夹具；
3. 数据/秘密/权限变化说明；
4. 性能与错误处理验证记录；
5. `docs/ARCHITECTURE.md`、`docs/DATA_MIGRATION.md`、`docs/SECURITY_MODEL.md`、`docs/FEATURE_MATRIX.md` 的同步更新。

当 W01–W10、P01–P10、S01–S07、A01–A08、U01–U05 的验收矩阵全部通过，且旧 Shell 已不再拥有业务编排，才可宣布重构完成。任何“先砍功能、以后补回”的做法都不满足本文件的全功能复现目标。

## 附录：主要证据文件

- 应用与移动端编排：`lib/main.dart`、`lib/mixins/`
- 桌面编排：`lib/desktop/desktop_main.dart`、`lib/desktop/desktop_shell.dart`
- 导航能力表：`lib/desktop/feature_entries.dart`、`lib/desktop/nav_entries_meta.dart`
- 文章/框架/站点配置：`lib/models/article.dart`、`lib/models/blog_framework.dart`、`lib/models/repo_config.dart`、`lib/models/blog_site_config.dart`
- 发布与 Git：`lib/services/github_service.dart`、`lib/services/static_blog_batch_publish_service.dart`、`lib/services/git_providers.dart`
- CMS：`lib/core/repository/blog_repository.dart` 及 `*_adapter.dart`
- 同步与安全：`lib/services/cloud_sync_service.dart`、`lib/services/sync_service.dart`、`lib/services/p2p_sync_service.dart`、`lib/services/draft_encryption_service.dart`
- AI 与工具：`lib/services/ai_service.dart`、`lib/core/ai/ai_request_dispatcher.dart`、`lib/core/tools/builtin_tools.dart`、`lib/core/tools/mcp_transport.dart`
- 建站与运维：`lib/services/site_wizard_service.dart`、`lib/services/site_scaffold_builder.dart`、`lib/services/site_health_monitor.dart`
- 构建与质量：`.github/workflows/build.yml`、`test/`
