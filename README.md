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

## 安装与运行

```bash
cd ~/code/cnki-mcp
npm install
npm run build

# 冒烟测试（会自己解一次滑块并落盘会话）
node dist/scripts/smoke.js 语料库语言学
```

注册到 pi（`~/.pi/agent/mcp.json`）：

```json
{
  "mcpServers": {
    "cnki": {
      "command": "node",
      "args": ["/Users/fabea/code/cnki-mcp/dist/src/index.js"],
      "exposure": "codemode",
      "toolExposure": {
        "cnki_search": "direct",
        "cnki_get_paper_detail": "direct",
        "cnki_status": "direct"
      },
      "timeout": 180
    }
  }
}
```

改完 `/reload`（或重启 pi）。

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
  smoke.ts             端到端冒烟
  probe-captcha.ts     开发用：打印验证页 DOM
```

## 已知限制

- **网络首发**文献没有卷/期/页，详情页就是空的；用 `hint_journal` / `hint_date` 补刊名与年份，引文会标 `[网络首发]`。
- 翻页需要先请求第 1 页（服务端 `turnpage` token 绑定结果集），本实现自动缓存该 token。
- 排序目前只支持相关度与发表时间；被引/下载排序的字段码未验证，暂不提供。
- 参考文献 / 引证文献列表走单独的 AJAX 接口，尚未接入。
- 知网明文禁止机器抓取；默认配额与间隔是按“别把 IP 搞封”设的，调高请自负风险。
