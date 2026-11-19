# ProxyDesk API 管理

## 本机接口

安装并启动相应服务后，ProxyDesk 可连接以下本机端口：

| 服务 | 地址 |
| --- | --- |
| CLIProxyAPI / AntigravityProxy | `http://127.0.0.1:8318/v1` |
| GeminiWebProxy | `http://127.0.0.1:8083/v1` |
| AsterBridge | `http://127.0.0.1:17841/v1` |
| 搜索 HTTP | `http://127.0.0.1:8321/search` |
| 搜索 MCP | `http://127.0.0.1:8321/mcp` |
| 朋友 API 网关 | `http://127.0.0.1:8338/v1` |

## HTTPS 共享

需要远程访问时，自行配置 Tailscale HTTPS Serve 或其他 HTTPS 反向代理，将外部 `/api` 路径转发到本机 `127.0.0.1:8338`。启动 ProxyDesk 前设置 `PROXYDESK_PUBLIC_BASE_URL` 为自己的 `https://.../api/v1` 地址。朋友 API 网关监听本地环回地址。

在「API 管理」页面创建客户端密钥，并分别选择自动分配或固定账号路由。创建与查看密钥必须在本机完成。远程客户端通过 `GET /v1/models` 查看当前开放的模型。

## 自动分配

CPA 模型接口支持通过可用账号集合自动选择授权；固定账号路由将调用限定到指定 Google OAuth 授权文件。AGY CLI 的登录账号由 AntiGravity Switch 单独管理，切换后对新启动的 AGY 会话生效。

## 客户端示例

在客户端机器上创建自己的 `ProxyDesk-Connection.json`，其中包含 `baseUrl`、`apiKey`、`model`，再执行仓库提供的 `scripts/Test-Client-API.ps1` 或 `scripts/Start-Client-Claude.ps1`。示例脚本中的令牌从用户本地配置读取。
