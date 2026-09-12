# 安全模型

## 秘密

公共设置只保存 `SecretRef`，且 Web 站点接口会校验引用的 `id/kind/label` 结构。迁移、审计和同步 payload 均不得包含 token、密码、Bearer、cookie 或 MCP header 明文；敏感旧文件备份使用 AES-256-GCM，设备密钥只迁移为 SecretRef。CLI 一键建站的 GitHub/GitLab/Cloudflare 凭据只从 `TUOMO_SECRET_*` 环境变量读取，Cloudflare deployment hook 强制 HTTPS，不写入站点 JSON。审计日志通过结构化字段脱敏；错误分类使用 `DomainError.kind`，UI 不应按错误字符串分支。

## 路径和文件

`SafeRelativePath` 拒绝盘符、绝对路径、`..`、`.`、空段和 NUL。恢复、P2P、MCP 文件工具、Git 文件操作必须共享这一校验器。外部 HTML 预览接入平台时必须使用净化器和 sandbox iframe/WebView；当前 Node Web 预览统一走核心 `markdownToHtml` 安全渲染器，HTML 标签和 URL 均经过转义/协议校验，平台 WebView 接入仍需按平台增加 sandbox/净化器契约测试。

## AI 和工具

读取工具默认允许；外部写、删除、部署、建仓和本地进程默认拒绝，必须逐次或按会话授权。工具执行前校验 schema、enabled 状态和 site scope，执行后记录脱敏审计。模型文本不能直接拼进 shell、路径或 URL。

## 同步与发布

同步以 revision/hash 比较，双端修改创建 conflict；WebDAV 的“导入缺失”不能冒充完整双向同步。静态发布采用乐观并发控制，预览后远端 revision 变化就失败并保留本地草稿。

## 仍需平台实现的门槛

Flutter 壳已通过 `FlutterSecureSecretStore` 使用 `flutter_secure_storage` 保存秘密；Node 的文件/内存存储仍是明确的参考宿主实现，不能当作生产 vault。P2P 生产模式要求 TLS 证书选项并拒绝 `http://` endpoint，但真实证书轮换、Noise 会话和 Git provider/CMS 账号仍需部署适配。接入这些能力前必须补齐超时、取消、request ID、429/5xx 退避、证书策略和契约测试；秘密存储还必须完成 Android/iOS/桌面设备运行时验证。
