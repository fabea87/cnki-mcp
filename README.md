# cnki-mcp

自维护的中国知网（CNKI）MCP 服务器。**纯 TypeScript、纯 HTTP**，不需要 Playwright、不需要 Python、不需要钉死任何 SDK 版本。

## 做了什么

| 能力 | 说明 |
|---|---|
| 检索 | `POST /kns8s/brief/grid`，返回题名/作者/来源刊/时间/被引/下载量/详情 URL，支持 6 种检索项、排序、本地资源类型与年份过滤、翻页 |
| 摘要元数据 | 详情页解析：摘要、关键词、基金、DOI、分类号、专辑专题、在线公开时间、刊名/年/卷/期/页 |
| 引文 | **本地拼装** GB/T 7714-2015 / APA 7 / BibTeX / RIS（不依赖知网自身常常为空的引文接口） |
| 会话 | 拼图滑块**在进程内自动求解**（PNG 解码 + NCC 模板匹配 + AES-128-ECB 提交），cookie 落盘复用 |
| 节流 | 全局串行、最小间隔 2s、每日配额、24h 查询缓存 —— 避免触发知网风控与 IP 封禁 |

## 为什么不用浏览器

实测结论：

1. 检索与详情都是普通 HTTP（表单 POST + HTML），不需要 JS 运行时。
2. 全新会话访问 `kns8s/search` 会被 **无条件** 302 到 `/verify/home?captchaType=blockPuzzle` —— 滑块是**会话准入门槛**，与请求频率无关。
3. 验证页是 anji-plus 风格的固定接口：`/verify-api/get`（拿图 + `secretKey` + `token`）→ `/verify-api/web/check`（提交 AES 加密的 `{x,y}`）→ 302 回原地址并发 cookie。

所以浏览器只在“点滑块”这一步有用，而这一步可以用 40 行图像匹配 + `node:crypto` 完成。

## 安装

```bash
git clone https://github.com/fabea87/cnki-mcp.git
cd cnki-mcp
npm install
npm run build

# 自检网络出口（先看这个，见下文「网络与出口 IP」）
node dist/scripts/net-check.js

# 冒烟测试：解一次滑块、落盘会话、跑通检索 + 详情 + 引文
node dist/scripts/smoke.js 语料库语言学
```

可选全局安装（得到一个 `cnki-mcp` 可执行文件，下面所有客户端配置都可直接用 `"command": "cnki-mcp"`）：

```bash
npm install -g .
which cnki-mcp
```

会话、缓存、配额默认写在 `~/.pi/agent/state/cnki-mcp/`，与客户端无关；想换目录设 `CNKI_STATE_DIR`。

## 接入 MCP 客户端

本服务是标准 **stdio** MCP 服务器，任何支持 stdio 的客户端都能用。两种写法等价：

```jsonc
// A. 直接用 node（免全局安装，路径换成你自己的 clone 位置）
{ "command": "node", "args": ["/abs/path/to/cnki-mcp/dist/src/index.js"] }

// B. 全局安装过就用 bin
{ "command": "cnki-mcp" }
```

### Claude Code

```bash
claude mcp add cnki -- node /abs/path/to/cnki-mcp/dist/src/index.js
# 或全局安装后：
claude mcp add cnki -- cnki-mcp
claude mcp list
```

### Claude Desktop

`~/Library/Application Support/Claude/claude_desktop_config.json`（macOS）
`%APPDATA%\Claude\claude_desktop_config.json`（Windows）

```json
{
  "mcpServers": {
    "cnki": {
      "command": "node",
      "args": ["/abs/path/to/cnki-mcp/dist/src/index.js"],
      "env": { "CNKI_MIN_GAP_MS": "2000" }
    }
  }
}
```

### Cursor

`~/.cursor/mcp.json`（全局）或项目内 `.cursor/mcp.json`，格式同上。

### VS Code (GitHub Copilot)

`.vscode/mcp.json`：

```json
{
  "servers": {
    "cnki": { "type": "stdio", "command": "node", "args": ["/abs/path/to/cnki-mcp/dist/src/index.js"] }
  }
}
```

### Codex CLI

`~/.codex/config.toml`：

```toml
[mcp_servers.cnki]
command = "node"
args = ["/abs/path/to/cnki-mcp/dist/src/index.js"]
```

### pi

`~/.pi/agent/mcp.json`。pi 独有的 `exposure` / `toolExposure` 只是控制工具怎么暴露给模型，其他客户端忽略或删掉即可：

```json
{
  "mcpServers": {
    "cnki": {
      "command": "node",
      "args": ["/abs/path/to/cnki-mcp/dist/src/index.js"],
      "timeout": 180,
      "exposure": "codemode",
      "toolExposure": {
        "cnki_search": "direct",
        "cnki_get_paper_detail": "direct",
        "cnki_status": "direct"
      }
    }
  }
}
```

### 只支持远程（HTTP/SSE）的客户端

本服务只提供 stdio，没有 HTTP 端点。这类客户端用 `mcp-remote` 桥一层：

```bash
npx -y mcp-remote@latest --transport stdio -- node /abs/path/to/cnki-mcp/dist/src/index.js
```

### 改完配置

重启客户端。pi 里用 `/reload` 或 `/mcp reconnect cnki`，然后：

```
cnki_status            # 看会话、配额、缓存
cnki_search("二语写作 反馈", resource=["期刊"], year_from=2020)
```

## 网络与出口 IP（必读）

知网有两道和网络强相关的门，装完先跑一次自检：

```bash
node dist/scripts/net-check.js     # 或 npm run netcheck
```

它打印四件事：Node 版本与代理环境变量、**当前出口 IP**、`kns8s/search` 的响应（开放 / 需要验证码 / 失败）、以及针对你这台机器的建议。

### 规则一：出口必须在境内

知网官方 FAQ 写明：国内版（`www.cnki.net` / `kns.cnki.net`）**仅为境内用户提供服务，不再支持跨境访问**，境外用户需走 `oversea.cnki.net`（另一套平台、另一套接口，本服务不支持）。

后果：出口在境外或机房 IP 时，滑块几乎每次必现，严重时直接拒绝服务。

**最佳配置**：让知网直连，不要过代理。

```yaml
# Clash / Mihomo 规则（放在规则列表靠前处）
rules:
  - DOMAIN-SUFFIX,cnki.net,DIRECT
  - DOMAIN-SUFFIX,cnki.com.cn,DIRECT
  - DOMAIN-SUFFIX,kns.cnki.net,DIRECT
```

这一步效果显著：本机加规则前后，出口从境外代理变回境内家宽/移动，滑块从"每次都来"降到"只在会话冷启动时来一次"。

### 规则二：Node 的 fetch 默认不走环境变量代理

这点最容易踩。`HTTP_PROXY` / `HTTPS_PROXY` 对 **curl 有效，对 Node 内置 fetch 无效**——undici 不读这些变量，除非显式开启：

```bash
# Node ≥ 24 支持
NODE_USE_ENV_PROXY=1 HTTP_PROXY=http://127.0.0.1:7890 HTTPS_PROXY=http://127.0.0.1:7890 \
  node dist/src/index.js
```

同理，客户端配置里若设置了 `env`，要让代理生效必须带上 `NODE_USE_ENV_PROXY=1`：

```json
{
  "mcpServers": {
    "cnki": {
      "command": "node",
      "args": ["/abs/path/to/cnki-mcp/dist/src/index.js"],
      "env": {
        "NODE_USE_ENV_PROXY": "1",
        "HTTPS_PROXY": "http://127.0.0.1:7890",
        "NO_PROXY": "kns.cnki.net,www.cnki.net"
      }
    }
  }
}
```

注意 `NO_PROXY` 里放知网域名：**代理开着但知网直连**才是想要的组合。

如果你用的是系统级 TUN / 透明代理（如 Clash TUN、Surge 增强模式），流量在网络层就被接管，Node 不需要任何代理变量——此时 `net-check` 显示 `DISABLED → requests go out directly` 且出口是境内 IP，就是正确状态。

### 规则三：出口调不动时，换机器而不是换参数

如果所在网络没有境内出口（海外、机房、企业统一出口），**不要**尝试用参数绕过，直接把服务跑在境内机器上（家里宽带 / 移动网络 / 境内轻量云），再用 `mcp-remote` 桥给本地客户端：

```bash
# 境内机器：把 repo 跑起来，暴露一个 stdio→HTTP 的桥
npx -y supergateway --stdio "node /opt/cnki-mcp/dist/src/index.js" --port 8811

# 本地客户端：连远程
npx -y mcp-remote http://<境内机器>:8811/sse
```

### 其他网络相关参数

| 现象 | 调整 |
|---|---|
| 首包慢、详情页偶发超时 | `CNKI_TIMEOUT_MS=60000` |
| 系统代理偶发 `PROTOCOL_ERROR` | 关掉该节点的 HTTP/2 或换直连 |
| DNS 被 fake-ip 接管（`198.18.x.x`） | 正常，TUN 会按规则把流量送到正确出口，不影响 |
| 公司网关做 TLS 中间人 | 需在 Node 里信任其根证书（`NODE_EXTRA_CA_CERTS`），否则 `fetch failed` |

## 工具

| 工具 | 作用 |
|---|---|
| `cnki_search` | 检索；`keyword` `search_type` `page_size` `page_num` `sort` `resource[]` `year_from` `year_to` |
| `cnki_get_paper_detail` | 单篇完整元数据 + 三种引文；可选 `hint_journal` / `hint_date` 补全网络首发文献 |
| `cnki_cite` | 批量（≤20）只返回引文文本，可直接进 Zotero / 稿件 |
| `cnki_warm` | 重新过验证、重建会话 |
| `cnki_status` | cookie 会话状态、今日配额、缓存条数 |

## 配置（环境变量）

| 变量 | 默认 | 说明 |
|---|---|---|
| `CNKI_STATE_DIR` | `~/.pi/agent/state/cnki-mcp` | 会话、缓存、配额存放目录 |
| `CNKI_MIN_GAP_MS` | `2000` | 两次请求最小间隔 |
| `CNKI_DAILY_QUOTA` | `300` | 滚动 24h 请求上限 |
| `CNKI_CACHE_TTL_MS` | `86400000` | 查询缓存 TTL |
| `CNKI_TIMEOUT_MS` | `30000` | 单请求超时 |
| `CNKI_AUTO_WARM` | `1` | 会话失效时自动重解滑块 |
| `CNKI_UA` | 内置 Chrome UA | 自定义 User-Agent |

## 结构

```
src/
  config.ts            路径与可调参数
  index.ts             MCP 工具注册（stdio）
  cnki/http.ts         fetch 封装 + cookie 注入 + 会话失效检测
  cnki/jar.ts          cookie jar
  cnki/puzzle.ts       PNG 解码 + NCC 求缺口偏移
  cnki/warm.ts         验证码协议：get → check → 302 取 cookie
  cnki/session.ts      会话生命周期（懒加载 / 失效重解）
  cnki/search.ts       QueryJson 构造 + 结果解析
  cnki/detail.ts       摘要页解析
  cnki/cite.ts         四种引文格式
  store/cache.ts       JSON 文件缓存
  store/ratelimit.ts   串行 + 间隔 + 配额
scripts/
  smoke.ts             端到端冒烟（检索 + 详情 + 引文）
  net-check.ts         网络自检：出口 IP / 代理变量 / 验证码门状态
  paging-test.ts       翻页回归（page 1/2/3 内容必须互不重复）
  probe-captcha.ts     开发用：打印验证页 DOM
```

## 已知限制

- **网络首发**文献没有卷/期/页，详情页就是空的；用 `hint_journal` / `hint_date` 补刊名与年份，引文会标 `[网络首发]`。
- 翻页需要先请求第 1 页（服务端 `turnpage` token 绑定结果集），本实现自动缓存该 token。
- 排序目前只支持相关度与发表时间；被引/下载排序的字段码未验证，暂不提供。
- 参考文献 / 引证文献列表走单独的 AJAX 接口，尚未接入。
- 知网明文禁止机器抓取；默认配额与间隔是按“别把 IP 搞封”设的，调高请自负风险。
- 本服务只提供 stdio，没有 HTTP 端点；远程客户端请用 `mcp-remote` / `supergateway` 桥接。
