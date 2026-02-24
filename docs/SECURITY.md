# CurivAI Security

## Threat Model

CurivAI processes untrusted content from the internet (RSS feeds, article HTML) and passes summaries to LLMs. The primary threats are:

1. **Prompt injection** via malicious article content
2. **API key leakage** through logs or error messages
3. **Runaway LLM spend** from unconstrained automated runs
4. **Data integrity** issues from broken sources or parsers

## Defences

### 1. Prompt Injection

**Risk:** A malicious article could contain text like `"Ignore previous instructions and..."`.

**Controls:**
- System prompt explicitly labels article content as `UNTRUSTED DATA` and instructs the model to never follow embedded instructions.
- Article content truncated to `config.ingest.content_excerpt_chars` (default 3000) before sending to LLM.
- All LLM output is parsed through strict Zod schemas. Any response that doesn't conform to the expected JSON structure fails closed (`llm_status = 'failed'`), the item is skipped, and the pipeline continues.
- Retry-repair flow: one retry with the parse error — not a general "try again", so injected "repair" attempts have no attack surface.

### 2. API Key Safety

- API keys are never logged. `pino` redaction is configured to strip `llm.api_key` and `smtp_pass` from all log output.
- `GET /api/doctor` returns `"configured"` or `"unconfigured"` — never the actual key value.
- `.env.example` contains placeholder values, not real credentials.
- `CURIVAI_LLM_API_KEY` env var is the recommended way to pass credentials (avoids writing keys to disk).

### 3. Cost Control

- **Budget guard** in Autopilot: estimates total LLM calls + cost before execution. Aborts if limits exceeded (`config.budget.max_llm_calls_per_run`, `config.budget.max_cost_usd_per_run`). Requires `--force` or `--yes` to override.
- **CheapFilter** runs before every ScorePack batch — most items are filtered without any LLM calls.
- **Caching**: items already scored with the same persona + prompt version are skipped. Re-running is always safe and cheap.
- **LLM concurrency cap**: `config.llm.max_concurrent` (default 3) prevents accidental parallel overload.

### 4. Source Isolation

- Each source fetch runs in an isolated `try/catch`. One broken or malicious feed never crashes the pipeline.
- HTTP fetches use `undici` with configurable timeout (`config.ingest.fetch_timeout_ms`, default 15s).
- Content extraction via `@mozilla/readability` + `jsdom` runs on fetched HTML — no `eval`, no code execution.

### 5. Idempotency

- Ingest deduplicates by `dedup_key` (guid / url / hash). Re-running ingest is always safe.
- Scoring deduplicates by `(item_id, persona_name)`. Re-running score is always safe and cheap (cache hits).

### 6. Export Attribution (Copyright)

- Export Linter hard-blocks content missing source attribution. This is non-negotiable: there is no `--no-attribution` flag.
- Quote limits enforced in prompts and validated by the linter (`max_quote_words_en`, `max_quotes`).
- Compose prompt explicitly instructs: "Summarize in your own words. Do NOT translate verbatim."

## Known Limitations (v1)

- No authentication on the API server. CurivAI is designed for local/single-user use. Do not expose port 3891 to the internet without adding an auth layer (e.g. Nginx basic auth, Cloudflare Access).
- SQLite has no row-level access control. All users of the server share the same data.
- MJML/nodemailer email is sent over SMTP — use TLS-enabled SMTP (port 587 STARTTLS or port 465 SSL).

## Reporting Vulnerabilities

Please open a GitHub issue with the `security` label. Do not include exploit details in public issues — use the private security advisory feature if available.
