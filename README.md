# CurivAI

**你的 AI 信息管家 — 自己选源，AI 帮你筛，跨语言阅读，一键出稿。**

CurivAI 是一个开源 AI 工作台，帮助中文内容创作者将海外英文信息源（HN、TechCrunch、a16z 等）转化为微信公众号 / 小红书 / 抖音可用的内容草稿。

```
海外英文信息源 → CheapFilter 预筛 → AI 评分 → 多视角对比 → 生成草稿 → 导出发布
```

---

## 核心功能

### Persona 系统
用"创作者视角"驱动筛选，而不是关键词过滤。同一篇文章在不同 Persona 下会得到截然不同的评分和创作角度：

| Persona | 关注方向 | 默认平台 |
|---------|---------|---------|
| 🚀 AI 创业情报官 | AI 产品发布、融资、创业机会 | 微信公众号 |
| 🏦 科技投资观察 | 投融资信号、赛道格局、市场数据 | 微信公众号 |
| 🛠 技术前沿翻译官 | 开发者工具、开源项目、技术趋势 | 微信公众号 |

### 两级评分引擎
1. **CheapFilter** — 零 LLM 调用的启发式预筛，毫秒级完成，输出 Token 漏斗统计
2. **ScorePack Lite / Full** — LLM 深度评分，输出中文摘要、维度评分、行动建议（可写 / 可提 / 可转 / 跳过）、创作角度

### Studio 创作工作流
收藏文章 → 素材篮（自动触发 Full 评分）→ 填写个人观点 → 生成草稿 → 导出微信 / 小红书 / 抖音脚本

### 版权合规内置
Export Linter 强制要求来源标注，禁止全文翻译，硬拦截不合规导出。

---

## 快速开始

### 方式一：Windows 安装包（推荐）

前往 [Releases](https://github.com/wj3862/curivai/releases) 下载 `CurivAI-Setup.exe`，双击安装。

安装后桌面会生成快捷方式，双击即可启动——自动完成首次初始化并在浏览器打开 `http://localhost:3891`。

### 方式二：本地运行（开发 / 命令行）

**环境要求：** Node.js 20+、pnpm

```bash
# 克隆项目
git clone https://github.com/wj3862/curivai
cd curivai
pnpm install

# 配置 LLM（任意 OpenAI 兼容接口）
cp .env.example .env
# 编辑 .env，填入 CURIVAI_LLM_API_KEY 和 CURIVAI_LLM_MODEL

# 初始化（创建 DB、复制 Persona、生成默认配置）
pnpm dev init

# 安装内置源包
pnpm dev source install-pack tech_overseas
pnpm dev source install-pack ai_frontier

# 抓取文章
pnpm dev ingest --limit 200

# AI 评分
pnpm dev score --persona ai_entrepreneur --budget 30

# 启动 Web 界面
pnpm server
# → http://localhost:3891
```

### 方式三：Docker

```bash
cp .env.example .env   # 填入 CURIVAI_LLM_API_KEY
docker compose up -d   # → http://localhost:3891
```

---

## Web 界面

```
┌──────────────────────────────────────────────────────────────┐
│  🚀 AI创业情报官  │  🏦 科技投资观察  │  🛠 技术前沿翻译官  │+│
├──────────────────────────────────────────────────────────────┤
│   发现       │      创作        │      管理      │    设置    │
└──────────────────────────────────────────────────────────────┘
```

**发现页**
- 评分结果视图：按分数排列的文章卡片，含中文摘要和创作角度
- 候选文章视图：CheapFilter 预筛后的完整候选列表（LLM 评分前预览），支持批量选中直接触发评分
- Token 漏斗统计：展示「总量 → CheapFilter → LLM 评分 → 可创作」各环节的转化率和 Token 消耗
- 关键词搜索：在已评分文章中实时过滤
- ⭐ 收藏到素材篮（自动触发 Full 评分升级）
- 📐 多视角对比（同一篇文章在所有 Persona 下的评分对比，仅读缓存不触发新调用）

**创作页**
- 左栏：素材篮 + 合并策略（周报 / 简报 / 对比）+ 个人观点输入
- 中栏：AI 生成的 Markdown 草稿，可直接编辑
- 右栏：公众号 / 小红书 / 抖音脚本实时预览，一键复制

**管理页** — 订阅源管理、OPML 导入、安装源包、立即抓取

**设置页** — 界面内直接修改 LLM 参数、评分阈值、预算限额、采集配置、邮件推送，热更新生效无需重启

---

## LLM 提供商

任意 OpenAI 兼容接口均可：

| 提供商 | `CURIVAI_LLM_BASE_URL` | 推荐模型 |
|--------|------------------------|---------|
| OpenAI | （留空） | `gpt-4.1-mini` |
| DeepSeek | `https://api.deepseek.com` | `deepseek-chat` |
| SiliconFlow | `https://api.siliconflow.cn/v1` | `Qwen/Qwen2.5-72B-Instruct` |
| Ollama | `http://localhost:11434/v1` | `qwen2.5:14b` |

**估算成本（gpt-4.1-mini）：**

| 操作 | 单次成本 | 月均成本 |
|------|---------|---------|
| Lite 评分（每篇） | ~$0.001 | — |
| Full 评分（每篇） | ~$0.003 | — |
| Compose 草稿 | ~$0.005 | — |
| 日常使用（30 Lite + 5 Full + 1 Compose/天） | ~$0.05/天 | **~$1.5** |
| DeepSeek | — | **~$0.3** |
| Ollama 本地 | — | **$0** |

---

## CLI 命令

```bash
# 初始化
curivai init

# 订阅管理
curivai source add <url>
curivai source install-pack tech_overseas
curivai source import-opml feeds.opml
curivai source list

# 数据获取
curivai ingest [--limit 200]

# 评分与浏览
curivai score --persona ai_entrepreneur [--budget 30] [--days 3]
curivai feed  --persona ai_entrepreneur [--top 20]
curivai compare <itemId>              # 多视角对比（仅缓存）

# 创作工作流
curivai pick add <id1> <id2> <id3> --persona ai_entrepreneur
curivai draft create --persona ai_entrepreneur --type wechat
curivai draft merge  --draft <id> --strategy roundup
curivai draft comment --draft <id> --text "我的看法..."
curivai draft export --draft <id> --format wechat --out article.md

# 一键自动化
curivai autopilot --persona ai_entrepreneur --type wechat --out draft.md --yes
curivai preset run weekly_ai_brief --out weekly.md --yes

# 系统
curivai doctor          # 检查 DB / LLM / 源 / Persona
curivai stats           # 使用量统计
curivai server          # 启动 API + Web UI（支持 --open 自动打开浏览器）
```

---

## 内置源包

| 源包 | 包含来源 |
|------|---------|
| `tech_overseas` | Hacker News、TechCrunch、The Verge、a16z Blog、Simon Willison、Stratechery、OpenAI Blog、Changelog |
| `ai_frontier` | Hugging Face Blog、Lilian Weng、Interconnects、Latent Space、Anthropic Blog |

---

## 邮件推送

在设置页或 `~/.curivai/config.yaml` 中配置：

```yaml
delivery:
  email:
    enabled: true
    smtp_host: smtp.gmail.com
    smtp_port: 587
    smtp_user: you@gmail.com
    smtp_pass: your-app-password
    to:
      - you@gmail.com

schedule:
  ingest_cron: "0 */4 * * *"   # 每 4 小时抓取
  digest_cron:  "0 8 * * *"    # 每天 8 点发送摘要邮件
```

手动触发：`curl -X POST http://localhost:3891/api/digest/send`

---

## 项目结构

```
curivai/
├── src/
│   ├── cli/          # CLI 命令（commander）
│   ├── api/          # REST API（Hono）
│   │   └── routes/   # sources / ingest / score / studio / personas / system …
│   ├── engine/       # 核心引擎（cheapFilter、scorePack、compose、autopilot、preset）
│   ├── studio/       # 创作工作流（picked、drafts、export、lint）
│   ├── source/       # 数据管道（RSS adapter、readability 提取、dedup、ingest）
│   ├── persona/      # Persona schema（Zod）+ loader
│   ├── llm/          # LLM client + prompts + parse + retry
│   ├── push/         # Email sender（MJML）+ node-cron scheduler
│   └── db/           # SQLite（better-sqlite3）+ migrations
├── web/              # React 18 + Vite + Tailwind CSS + shadcn/ui
│   └── src/
│       ├── pages/    # FeedPage / StudioPage / SourcesPage / SettingsPage
│       └── components/ # PersonaSwitcher / ScoreCard / CompareModal / FunnelPanel / CandidatesPanel
├── installer/        # Windows Inno Setup 安装脚本
├── personas/         # 内置 Persona YAML（3 个）
├── radar_packs/      # 内置源包（2 个）
├── presets/          # 工作流预设（weekly_ai_brief、daily_tech_scan）
├── templates/        # 导出模板（wechat / xhs / douyin）
└── docs/             # ARCHITECTURE.md / SECURITY.md / PROMPTS.md
```

---

## 技术栈

| 层 | 技术 |
|----|------|
| Runtime | Node.js 20+ / TypeScript (ESM) / pnpm |
| API | Hono |
| DB | SQLite（better-sqlite3） |
| Web | React 18 + Vite + Tailwind CSS + shadcn/ui |
| LLM | OpenAI SDK（兼容任意 OpenAI-compatible 提供商） |
| Schema | Zod（所有数据形状的唯一事实来源） |
| Email | nodemailer + MJML |
| Scheduler | node-cron |
| Tests | Vitest（174/174 通过） |
| Packaging | @yao-pkg/pkg + Inno Setup（Windows 安装包） |

---

## 文档

- [架构设计](docs/ARCHITECTURE.md)
- [安全说明](docs/SECURITY.md)
- [Prompt 参考](docs/PROMPTS.md)

## License

[Apache-2.0](LICENSE)
