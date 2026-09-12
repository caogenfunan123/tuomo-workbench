# 架构

## 边界

拓墨采用四层结构：

```text
presentation → application → domain
                    ↑
             infrastructure ports
```

- `domain` 只包含实体、值对象、策略和可分类错误，不依赖 Node、Flutter、HTTP 或具体厂商。
- `application` 编排用例：保存、发布、同步、迁移、工具执行、建站事务、批量发布、多站点聚合和媒体上传；它只依赖 port。迁移器将旧草稿、模板、片段、统计和站点配置转换到规范存储，并保留加密/只读备份。
- `infrastructure` 提供 JSON 原子存储、站点注册表、远程 binding、快照/持久化 outbox、AI 会话/Agent 任务、模板/片段/卷宗/写作统计、Skill/主题注册表、审计、加密秘密存储、Git/CMS HTTP gateway、GitHub/GitLab/Cloudflare 建站 gateway 和开发用内存网关；Flutter 壳另提供 `FlutterSecureSecretStore`，通过 `flutter_secure_storage` 绑定平台安全存储。真实 Git/CMS/Node 宿主 vault 适配器必须实现同一 port。
- `presentation` 只有 CLI 和最小 Web 参考入口。它不直接操作文件或凭据。
- `lib` 是 Flutter/Dart 共享壳：`lib/domain` 和 `lib/application` 保持纯 Dart，`lib/infrastructure` 提供 JSON 文件仓库，`lib/platform` 只暴露移动/桌面/Web 能力矩阵；文件选择、文档拖放、窗口、速记和预览通过独立 port 接入。编辑器的打字机滚动是共享偏好和编辑 presenter 行为，不复制到平台壳。

## 关键不变量

1. 文章保存使用 `localRevision` CAS；旧保存任务不能覆盖新 revision。
2. 静态发布先渲染/预览，再重新读取远端 revision；变化时返回 `conflict`，不能静默覆盖。
3. 静态站点使用 `StaticPublishGateway`，CMS 使用 `CmsPostGateway`，不存在伪装成 CMS 的静态仓库写接口。
4. 路径统一经过 `SafeRelativePath`；恢复、工具和远端文件适配器不得绕过它。
5. UI 只能发送意图；外部写、删除、部署、创建仓库、本地进程必须经过 `ToolExecutor` 授权和审计。

## 启动顺序

当前 CLI 组合根初始化 JSON repository、audit store 和 use cases。正式平台壳应沿用相同顺序：解析存储根 → 读取 schema → 执行可重入迁移 → 初始化文章索引 → 初始化站点/秘密/同步/工具注册表 → 恢复会话。任何非致命基础设施错误只能禁用对应能力，不得阻止本地编辑器打开。

## 平台扩展

Flutter/mobile/desktop/web 只需要替换 presentation 和 platform adapters。`FilePickerPort`、`FileDropPort`、`WindowPort`、`QuickNotePort`、`PreviewPort`、`SecretStore`、Git provider、CMS adapter 和 MCP transport 不应把平台细节带入 domain；Flutter 入口已注入 `FlutterSecureSecretStore`，Node 入口仍按宿主环境注入秘密存储。
