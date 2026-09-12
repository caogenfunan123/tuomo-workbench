# 数据迁移

`LegacyMigrationUseCase` 支持读取以下旧文件：`settings.json`、`repos.json`、`drafts.json`、`drafts.json.enc`、`templates.json`、`snippets.json`、`writing_stats.json`、`.device_key` 及其旁边的 `sites/` 数据。

迁移流程：

1. 递归统计源目录并检查目标文件系统可用空间（按源数据的保守倍数预留），再创建目标目录和带时间戳的只读备份目录；包含秘密的旧文件备份使用 AES-256-GCM 加密，密钥仅保存到 SecretStore 引用。
2. 对 JSON 中名称包含 token/password/secret/api-key/authorization/cookie 的字符串提取 `SecretRef`，公共 JSON 只保存引用。
3. 将设置写入 `settings/public.json`，旧草稿写入 `articles/<id>.json` 与 `articles/index.json`；`templates.json`、`snippets.json`、`writing_stats.json` 分别转换到 `writing/library.json`，`repos.json` 转换到 `sites/registry.json`。加密草稿 envelope 原样保留到 `legacy-import/drafts.json.enc`，其余旧对象写入 `legacy-import/`，不覆盖现有目标文件；`.device_key` 转换为 `legacy.device-key` SecretRef，不复制明文密钥。原始输入仍保留在 `legacy-import/`，便于审计和重试。
4. 写入 `meta/schema.json` 和审计事件；迁移可重复执行，旧文件保留到用户明确清理。

每个备份写入后都会重新读取并校验 SHA-256；加密备份会先通过 AES-GCM 认证解密再校验。重复迁移会复用已有备份密钥引用，不能在无法取得旧密钥时静默覆盖或生成不可恢复的备份。

目标布局：

```text
meta/schema.json
settings/public.json
settings/preferences.json   # Flutter UI preferences only; no secrets
secrets/                 # 只放引用/加密信封，不放明文凭据
articles/index.json
articles/<id>.json
exports/markdown/
snapshots/<id>/
trash/
sites/
  <siteId>/agent/sessions.json
  <siteId>/agent/tasks.json
writing/library.json        # templates, snippets, volumes, writing stats
ai/skills.json              # user skills only; built-ins remain code-owned
themes/themes.json          # user themes with safe relative files
sync/manifest.json
logs/audit.jsonl
cache/
```

Flutter 壳已通过 `FlutterSecureSecretStore` 接入 `flutter_secure_storage`，由平台实现 Android Keystore、iOS Keychain 或桌面凭据存储；Web 端必须运行在安全上下文（HTTPS 或 localhost）中。Node 参考宿主仍应将 `MemorySecretStore` 替换为宿主平台的 credential vault。`EncryptedFileSecretStore` 只接受调用方在内存中提供的 32 字节密钥，不能把密钥硬编码或写回普通设置。

工作区备份通过 `createWorkspaceBackup` / `readWorkspaceBackup` 统一归档 settings、repos、drafts、templates、snippets、写作资产、Skill/主题、Agent 会话/任务、同步清单、统计和 sites；新增对象采用可选条目以兼容旧归档。设备密钥只有在启用 AES-256-GCM 时才允许进入归档，恢复默认先生成差异计划，不覆盖现有文件。
