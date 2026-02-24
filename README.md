# CurivAI

**你的 AI 信息管家 — 自己选源，AI 帮你筛，跨语言阅读，一键出稿。**

CurivAI 是一个开源 AI 工作台，帮助中文内容创作者将海外英文信息源（HN、TechCrunch、a16z 等）转化为微信/小红书/抖音可用的内容草稿。

```
海外英文信息源 → AI 筛选评分 → 多视角对比 → 一键生成草稿 → 导出发布
```

---

## 核心功能

**Persona 系统** — 用"视角"驱动筛选，而不是关键词过滤

每个 Persona 代表一种创作者身份（AI 创业情报官、科技投资观察、技术前沿翻译官），定义了评分维度和偏好信号。同一篇文章在不同 Persona 下可能得到截然不同的分数和创作角度。

**两级评分**

1. **CheapFilter** — 零 LLM 调用的启发式预筛，每次运行只花毫秒
2. **ScorePack Lite/Full** — LLM 深度评分，输出中文摘要、评分、行动建议、创作角度

**Studio 工作流** — 从素材到草稿

选文章 → 加入素材篮（自动触发 Full 评分）→ 填写自己的观点 → 一键生成草稿 → 导出公众号/小红书/抖音格式

**版权合规内置** — Export Linter 强制要求来源标注，禁止全文翻译

---

## 快速开始

### 本地运行

```bash
# 克隆项目
git clone https://github.com/yourname/curivai
cd curivai

# 安装依赖
pnpm install

# 配置 LLM（任意 OpenAI 兼容接口）
export CURIVAI_LLM_API_KEY=sk-...
export CURIVAI_LLM_MODEL=gpt-4.1-mini   # 或 deepseek-chat、qwen2.5 等

# 初始化（创建 DB、复制 Persona、生成默认 config）
pnpm dev init

# 安装内置源包（HN、TechCrunch、a16z 等）
pnpm dev source install-pack tech_overseas
pnpm dev source install-pack ai_frontier

# 抓取文章
pnpm dev ingest --limit 200

# AI 评分（以 AI 创业情报官视角）
pnpm dev score --persona ai_entrepreneur --budget 30

# 查看推荐
pnpm dev feed --persona ai_entrepreneur --top 10

# 启动 Web 界面
pnpm dev server
# → http://localhost:3891
```

### Docker（推荐生产部署）

```bash
# 复制环境变量
cp .env.example .env
# 编辑 .env，填入 CURIVAI_LLM_API_KEY

# 构建并启动
docker compose up -d

# → http://localhost:3891
```

---

## Web 界面

启动 `curivai server` 后访问 `http://localhost:3891`。

```
┌──────────────────────────────────────────────────────────────┐
│ 🚀 AI创业情报官  │  🏦 科技投资观察  │  🛠 技术前沿翻译官     │
├──────────────────────────────────────────────────────────────┤
│  发现                创作               管理                 │
└──────────────────────────────────────────────────────────────┘
```

**发现页** — 按评分排列的文章卡片，含中文摘要和创作角度建议
- ⭐ 加入素材篮（自动触发 Full 评分升级）
- 📐 多视角对比——同一篇文章在所有 Persona 下的评分对比

**创作页** — 三栏布局
- 左：素材篮（已收藏文章）+ 合并策略 + 你的观点
- 中：AI 生成的 Markdown 草稿
- 右：公众号 / 小红书 / 抖音脚本预览 + 一键复制

**管理页** — 订阅源管理、OPML 导入、安装源包、立即抓取

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
curivai compare <itemId>          # 多视角对比（仅缓存，不触发新调用）

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
curivai doctor          # 检查 DB、LLM、源、Persona
curivai stats           # 使用量统计
curivai server          # 启动 API + Web UI
```

---

## LLM 提供商

任意 OpenAI 兼容接口均可，无需修改代码：

| 提供商 | `CURIVAI_LLM_BASE_URL` | 推荐模型 |
|--------|------------------------|---------|
| OpenAI | （留空） | `gpt-4.1-mini` |
| DeepSeek | `https://api.deepseek.com` | `deepseek-chat` |
| SiliconFlow | `https://api.siliconflow.cn/v1` | `Qwen/Qwen2.5-72B-Instruct` |
| Ollama | `http://localhost:11434/v1` | `qwen2.5:14b` |

**估算成本（gpt-4.1-mini）：**
- 每篇 Lite 评分：~$0.001
- 每篇 Full 评分：~$0.003
- 每篇草稿 Compose：~$0.005
- 日常使用（30 Lite + 5 Full + 1 Compose）：~$0.05/天 ≈ **$1.5/月**
- 使用 DeepSeek：约 **$0.3/月**
- 使用 Ollama：**$0**

---

## 内置 Persona

| Persona | 关注方向 | 默认平台 |
|---------|---------|---------|
| 🚀 AI 创业情报官 | AI 产品发布、融资、创业机会 | 微信公众号 |
| 🏦 科技投资观察 | 投融资信号、赛道格局、市场数据 | 微信公众号 |
| 🛠 技术前沿翻译官 | 开发者工具、开源项目、技术趋势 | 微信公众号 |

自定义 Persona：在 `~/.curivai/personas/` 下创建 YAML 文件，格式参考 `personas/ai_entrepreneur.yaml`。

---

## 内置源包

| 源包 | 包含来源 |
|------|---------|
| `tech_overseas` | HN、TechCrunch、The Verge、a16z、Simon Willison、Stratechery、OpenAI Blog |
| `ai_frontier` | Hugging Face Blog、Lilian Weng、Interconnects、Latent Space、Anthropic Blog |

---

## 邮件推送

在 `~/.curivai/config.yaml` 中配置：

```yaml
delivery:
  email:
    enabled: true
    smtp_host: smtp.gmail.com
    smtp_port: 587
    smtp_user: you@gmail.com
    smtp_pass: your-app-password
    from: digest@curivai.app
    to:
      - you@gmail.com

schedule:
  ingest_cron: "0 */4 * * *"   # 每 4 小时抓取
  digest_cron:  "0 8 * * *"    # 每天 8 点发送摘要邮件
```

或手动触发：

```bash
curl -X POST http://localhost:3891/api/digest/send
```

---

## 项目结构

```
curivai/
├── src/
│   ├── cli/          # CLI 命令（commander）
│   ├── api/          # REST API（Hono）
│   ├── engine/       # 核心智能（cheapFilter、scorePack、compose、autopilot…）
│   ├── studio/       # 创作工作流（picked、drafts、export、lint）
│   ├── source/       # 数据管道（RSS adapter、extract、dedup、ingest）
│   ├── persona/      # Persona schema + loader
│   ├── llm/          # LLM client + prompts + parse
│   ├── push/         # Email sender + scheduler
│   └── db/           # SQLite + migrations
├── web/              # React 18 + Vite + Tailwind + shadcn/ui
├── personas/         # 内置 Persona YAML
├── radar_packs/      # 内置源包
├── presets/          # 工作流预设
├── docs/             # ARCHITECTURE.md / SECURITY.md / PROMPTS.md
└── samples/          # 示例输出
```

---

## 技术栈

- **Runtime**: Node.js 20+ / TypeScript (ESM)
- **API**: Hono
- **DB**: SQLite（better-sqlite3）
- **Web**: React 18 + Vite + Tailwind CSS + shadcn/ui
- **LLM**: OpenAI SDK（兼容任意提供商）
- **Email**: nodemailer + MJML
- **Scheduler**: node-cron
- **Schema**: Zod（所有数据形状的唯一事实来源）
- **Tests**: Vitest（174 个测试）

---

## 文档

- [架构设计](docs/ARCHITECTURE.md)
- [安全说明](docs/SECURITY.md)
- [Prompt 参考](docs/PROMPTS.md)

## License

Apache-2.0
