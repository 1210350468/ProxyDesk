# ProxyDesk

Windows 桌面 AI 工具控制台，提供 AGY CLI 账号切换、项目会话启动、Gemini 账号管理、模型接口管理和多角色科研工作流程。使用 Electron 开发，界面以中文为主。

## 功能

- **AGY CLI**：随安装包内置 AntiGravity Switch 4.10.18 的账号管理界面和 CLI，导入账号后点击按钮切换后续 AGY CLI 会话使用的账号。
- **一键启动 AGY**：选择工作目录，开始新会话、继续最近会话或通过会话 ID 恢复历史会话。AGY 终端的 `/resume` 命令可浏览历史对话。
- **Gemini 多账号**：连接本机 CLIProxyAPI，管理 Google OAuth 授权、订阅等级和模型额度。
- **模型 API**：查看已配置的代理服务、API 地址和可用模型；支持本地搜索 HTTP/MCP 接口。
- **朋友 API**：在用户配置自己的 HTTPS 访问地址后，创建独立密钥和账号路由。
- **科研工作台**：Quick、Swarm、Expert Council、研究记录及 AsterBridge 集成。

AGY CLI 的**手动账号切换**已接入 ProxyDesk。自动额度监控与账号切换策略由内置 AntiGravity Switch 桌面管理器管理。需要自动切换时，在「添加或导入账号」打开的管理器中启用智能切换，保持管理器的后台调度运行。CPA 接口的自动分配是另一套独立功能。

## Windows 安装

1. 从 [Releases](../../releases) 下载 `ProxyDesk-1.15.0-portable.exe` 并运行，或使用源码执行 `npm ci`、`npm start`。
2. 打开「Gemini 账号」页面，在「一键切换 AGY 账号」区域导入自己的 Google 账号。账号管理器随 ProxyDesk 自带，首次使用无需单独安装 AntiGravity Switch。
3. 选择账号，设置工作目录与对话方式，点击「启动 AGY」。首次使用时，ProxyDesk 会通过 Google 官方安装程序自动下载安装 AGY CLI，随后在 Windows Terminal 中启动会话。

AGY 账号授权存放在当前用户的本地目录。软件不预置 Google 登录凭据，用户使用各自账号登录。

### 第三方组件许可证

安装包自带的 AntiGravity Switch 4.10.18 属于第三方软件，遵循 **CC BY-NC-SA 4.0**，包括非商业性使用条款；上游项目与发行说明见 [组件署名与许可证](vendor/agy-switch/NOTICE.md)。ProxyDesk 自有源码使用 MIT 许可证。Google 官方 AGY CLI 通过 Google 的安装程序下载。

## 外部服务配置

AGY CLI 相关功能可以独立使用。Gemini API、网页代理、AsterBridge 和朋友 API 功能需要分别安装相应服务。

默认查找便携版执行文件所在目录的同级目录：

```text
Apps/
  ProxyDesk/
    ProxyDesk-1.15.0-portable.exe
  AntigravityProxy/
  GeminiWebProxy/
```

也可以在启动 ProxyDesk 前设置环境变量：

| 环境变量 | 用途 |
| --- | --- |
| `PROXYDESK_SERVICES_ROOT` | `AntigravityProxy`、`GeminiWebProxy` 的共同上级目录 |
| `PROXYDESK_CPA_ROOT` | 单独指定 CLIProxyAPI / AntigravityProxy 目录 |
| `PROXYDESK_WEB_ROOT` | 单独指定 GeminiWebProxy 目录 |
| `PROXYDESK_PUBLIC_BASE_URL` | 自己的 HTTPS 朋友 API 地址，格式如 `https://设备域名/api/v1` |

例如在 PowerShell 中启动：

```powershell
$env:PROXYDESK_SERVICES_ROOT = 'D:\Apps'
& 'D:\Apps\ProxyDesk\ProxyDesk-1.15.0-portable.exe'
```

使用朋友 API 时，还需要为自己的域名配置 HTTPS 反向代理，将 `/api` 转发至本机的 `127.0.0.1:8338`。访问密钥必须由当前设备中的 ProxyDesk 单独生成。

## 从源码运行与构建

要求：Windows x64、Node.js、npm；AGY 终端启动使用 Windows Terminal，账号管理桌面界面使用 WebView2。

```powershell
npm ci
npm start
```

生成 Windows 便携版：

```powershell
npm run dist
```

本机有 AGY CLI 与 AntiGravity Switch 时，可执行真实启动检查：

```powershell
npm run check:agy-launch
```

该命令会启动一个测试 AGY 会话，验证终端窗口，并关闭测试创建的 AGY 进程。其他需要实际模型 API 的脚本将使用当前设备的授权和网络环境。

## 数据与安全

个人 Google 登录状态、代理授权、API Key、运行日志和研究记录存放在用户设备中。GitHub 仓库只包含公开源码、图标、说明文档和开发脚本。请勿提交个人凭据、`.env`、本地代理配置或运行数据。

更多连接说明见 [API 管理文档](docs/API-MANAGEMENT.md)。

## 许可证

[MIT](LICENSE)
