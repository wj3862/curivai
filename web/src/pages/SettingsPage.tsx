import { useState, useEffect } from 'react';
import { Loader2, Save, CheckCircle } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { api, type AppConfig } from '@/lib/api';
import { toast } from '@/hooks/use-toast';

// ─── helpers ──────────────────────────────────────────────────────────────────

function Field({
  label,
  hint,
  children,
}: {
  label: string;
  hint?: string;
  children: React.ReactNode;
}) {
  return (
    <div className="flex items-start justify-between gap-4 py-3 border-b last:border-0">
      <div className="flex-1 min-w-0">
        <div className="text-sm font-medium">{label}</div>
        {hint && <div className="text-xs text-muted-foreground mt-0.5">{hint}</div>}
      </div>
      <div className="shrink-0">{children}</div>
    </div>
  );
}

function TextInput({
  value,
  onChange,
  type = 'text',
  placeholder,
  wide,
}: {
  value: string;
  onChange: (v: string) => void;
  type?: string;
  placeholder?: string;
  wide?: boolean;
}) {
  return (
    <input
      type={type}
      value={value}
      onChange={e => onChange(e.target.value)}
      placeholder={placeholder}
      className={`h-8 px-3 rounded-md border bg-background text-sm focus:outline-none focus:ring-1 focus:ring-ring ${wide ? 'w-72' : 'w-44'}`}
    />
  );
}

function NumInput({
  value,
  onChange,
  min,
  max,
  step = 1,
}: {
  value: number;
  onChange: (v: number) => void;
  min?: number;
  max?: number;
  step?: number;
}) {
  return (
    <input
      type="number"
      value={value}
      min={min}
      max={max}
      step={step}
      onChange={e => {
        const n = parseFloat(e.target.value);
        if (!isNaN(n)) onChange(n);
      }}
      className="w-24 h-8 px-3 rounded-md border bg-background text-sm text-right focus:outline-none focus:ring-1 focus:ring-ring"
    />
  );
}

function SectionCard({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div className="rounded-lg border bg-card p-5">
      <h3 className="text-sm font-semibold mb-3 text-foreground/80">{title}</h3>
      {children}
    </div>
  );
}

// ─── component ────────────────────────────────────────────────────────────────

export function SettingsPage() {
  const [cfg, setCfg] = useState<AppConfig | null>(null);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState(false);

  useEffect(() => {
    api.system.getConfig()
      .then(setCfg)
      .catch(e => toast({ title: '加载配置失败', description: (e as Error).message, variant: 'destructive' }))
      .finally(() => setLoading(false));
  }, []);

  function setLlm<K extends keyof AppConfig['llm']>(key: K, value: AppConfig['llm'][K]) {
    setCfg(c => c ? { ...c, llm: { ...c.llm, [key]: value } } : c);
  }
  function setScoring<K extends keyof AppConfig['scoring']>(key: K, value: AppConfig['scoring'][K]) {
    setCfg(c => c ? { ...c, scoring: { ...c.scoring, [key]: value } } : c);
  }
  function setWeight(key: keyof AppConfig['scoring']['cheap_weights'], value: number) {
    setCfg(c => c ? {
      ...c, scoring: { ...c.scoring, cheap_weights: { ...c.scoring.cheap_weights, [key]: value } }
    } : c);
  }
  function setTopicDedup<K extends keyof AppConfig['scoring']['topic_dedup']>(key: K, value: number) {
    setCfg(c => c ? {
      ...c, scoring: { ...c.scoring, topic_dedup: { ...c.scoring.topic_dedup, [key]: value } }
    } : c);
  }
  function setBudget<K extends keyof AppConfig['budget']>(key: K, value: number) {
    setCfg(c => c ? { ...c, budget: { ...c.budget, [key]: value } } : c);
  }
  function setEmail<K extends keyof AppConfig['delivery']['email']>(
    key: K, value: AppConfig['delivery']['email'][K]
  ) {
    setCfg(c => c ? { ...c, delivery: { ...c.delivery, email: { ...c.delivery.email, [key]: value } } } : c);
  }
  function setIngest<K extends keyof AppConfig['ingest']>(key: K, value: AppConfig['ingest'][K]) {
    setCfg(c => c ? { ...c, ingest: { ...c.ingest, [key]: value } } : c);
  }

  async function handleSave() {
    if (!cfg) return;
    setSaving(true);
    setSaved(false);
    try {
      await api.system.updateConfig(cfg);
      setSaved(true);
      toast({ title: '配置已保存' });
      setTimeout(() => setSaved(false), 3000);
    } catch (e: unknown) {
      toast({ title: '保存失败', description: (e as Error).message, variant: 'destructive' });
    } finally {
      setSaving(false);
    }
  }

  if (loading) {
    return (
      <div className="flex justify-center items-center h-full">
        <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
      </div>
    );
  }

  if (!cfg) return null;

  const PROVIDER_PRESETS = [
    { label: 'OpenAI', url: '', model: 'gpt-4.1-mini' },
    { label: 'DeepSeek', url: 'https://api.deepseek.com', model: 'deepseek-chat' },
    { label: 'SiliconFlow', url: 'https://api.siliconflow.cn/v1', model: 'Qwen/Qwen2.5-72B-Instruct' },
    { label: 'Ollama', url: 'http://localhost:11434/v1', model: 'qwen2.5:14b' },
  ];

  return (
    <div className="flex flex-col h-full">
      {/* Sticky header */}
      <div className="flex items-center justify-between px-6 py-4 border-b sticky top-0 bg-background/95 backdrop-blur z-10">
        <h2 className="text-base font-semibold">设置</h2>
        <Button size="sm" onClick={handleSave} disabled={saving}>
          {saving
            ? <Loader2 className="h-4 w-4 animate-spin mr-1.5" />
            : saved
              ? <CheckCircle className="h-4 w-4 mr-1.5 text-green-500" />
              : <Save className="h-4 w-4 mr-1.5" />}
          {saved ? '已保存' : '保存配置'}
        </Button>
      </div>

      {/* Scrollable content */}
      <div className="flex-1 overflow-auto p-6 space-y-5 max-w-2xl">

        {/* LLM */}
        <SectionCard title="AI 配置 (LLM)">
          {/* Provider presets */}
          <div className="flex gap-1.5 mb-4 flex-wrap">
            {PROVIDER_PRESETS.map(p => (
              <button
                key={p.label}
                onClick={() => { setLlm('base_url', p.url); setLlm('model', p.model); }}
                className="text-xs px-2.5 py-1 rounded-full border hover:bg-accent transition-colors"
              >
                {p.label}
              </button>
            ))}
          </div>
          <Field label="API Base URL" hint="留空使用 OpenAI 默认地址">
            <TextInput
              value={cfg.llm.base_url}
              onChange={v => setLlm('base_url', v)}
              placeholder="https://api.openai.com/v1"
              wide
            />
          </Field>
          <Field label="API Key" hint="已设置时显示 ***，重新输入覆盖">
            <TextInput
              type="password"
              value={cfg.llm.api_key}
              onChange={v => setLlm('api_key', v)}
              placeholder="sk-..."
              wide
            />
          </Field>
          <Field label="模型" hint="OpenAI-compatible 模型名">
            <TextInput
              value={cfg.llm.model}
              onChange={v => setLlm('model', v)}
              placeholder="gpt-4.1-mini"
              wide
            />
          </Field>
          <Field label="Temperature" hint="0.0 = 确定性，1.0 = 创意性">
            <NumInput value={cfg.llm.temperature} onChange={v => setLlm('temperature', v)} min={0} max={1} step={0.05} />
          </Field>
          <Field label="Max Tokens">
            <NumInput value={cfg.llm.max_tokens} onChange={v => setLlm('max_tokens', v)} min={256} max={8192} step={256} />
          </Field>
          <Field label="最大并发请求数">
            <NumInput value={cfg.llm.max_concurrent} onChange={v => setLlm('max_concurrent', v)} min={1} max={10} />
          </Field>
        </SectionCard>

        {/* Scoring */}
        <SectionCard title="评分参数">
          <Field label="CheapFilter 阈值" hint="低于此分数的文章不进入 LLM (0–100)">
            <NumInput value={cfg.scoring.cheap_threshold} onChange={v => setScoring('cheap_threshold', v)} min={0} max={100} />
          </Field>
          <Field label="默认评分预算" hint="每次 AI 评分最多处理几篇">
            <NumInput value={cfg.scoring.default_budget} onChange={v => setScoring('default_budget', v)} min={1} max={200} />
          </Field>
          <Field label="默认时间窗口（天）">
            <NumInput value={cfg.scoring.default_days} onChange={v => setScoring('default_days', v)} min={1} max={30} />
          </Field>
          <div className="pt-2 pb-1">
            <div className="text-xs font-medium text-muted-foreground mb-2">CheapFilter 权重（合计应为 1.0）</div>
            {(Object.entries(cfg.scoring.cheap_weights) as [keyof AppConfig['scoring']['cheap_weights'], number][])
              .map(([k, v]) => (
                <div key={k} className="flex items-center justify-between py-1.5 text-sm">
                  <span className="text-muted-foreground">{k}</span>
                  <NumInput value={v} onChange={val => setWeight(k, val)} min={0} max={1} step={0.05} />
                </div>
              ))}
          </div>
          <div className="pt-2 pb-1">
            <div className="text-xs font-medium text-muted-foreground mb-2">话题去重</div>
            <Field label="回溯天数">
              <NumInput value={cfg.scoring.topic_dedup.lookback_days} onChange={v => setTopicDedup('lookback_days', v)} min={1} max={30} />
            </Field>
            <Field label="精确匹配惩罚分">
              <NumInput value={cfg.scoring.topic_dedup.exact_penalty} onChange={v => setTopicDedup('exact_penalty', v)} min={0} max={100} />
            </Field>
          </div>
        </SectionCard>

        {/* Budget */}
        <SectionCard title="预算控制">
          <Field label="单次最大 LLM 调用数">
            <NumInput value={cfg.budget.max_llm_calls_per_run} onChange={v => setBudget('max_llm_calls_per_run', v)} min={1} max={500} />
          </Field>
          <Field label="单次最大费用（USD）">
            <NumInput value={cfg.budget.max_cost_usd_per_run} onChange={v => setBudget('max_cost_usd_per_run', v)} min={0.01} max={10} step={0.01} />
          </Field>
          <Field label="每次调用估算费用（USD）">
            <NumInput value={cfg.budget.cost_per_call_estimate} onChange={v => setBudget('cost_per_call_estimate', v)} min={0.0001} max={0.1} step={0.0001} />
          </Field>
        </SectionCard>

        {/* Ingest */}
        <SectionCard title="抓取设置">
          <Field label="默认并发数">
            <NumInput value={cfg.ingest.default_concurrency} onChange={v => setIngest('default_concurrency', v)} min={1} max={20} />
          </Field>
          <Field label="内容截取字符数" hint="发送给 LLM 的最大内容长度">
            <NumInput value={cfg.ingest.content_excerpt_chars} onChange={v => setIngest('content_excerpt_chars', v)} min={500} max={10000} step={500} />
          </Field>
          <Field label="抓取超时（ms）">
            <NumInput value={cfg.ingest.fetch_timeout_ms} onChange={v => setIngest('fetch_timeout_ms', v)} min={3000} max={60000} step={1000} />
          </Field>
        </SectionCard>

        {/* Email */}
        <SectionCard title="邮件推送">
          <Field label="启用邮件">
            <input
              type="checkbox"
              checked={cfg.delivery.email.enabled}
              onChange={e => setEmail('enabled', e.target.checked)}
              className="h-4 w-4 accent-primary"
            />
          </Field>
          <Field label="SMTP Host">
            <TextInput value={cfg.delivery.email.smtp_host} onChange={v => setEmail('smtp_host', v)} placeholder="smtp.example.com" wide />
          </Field>
          <Field label="SMTP Port">
            <NumInput value={cfg.delivery.email.smtp_port} onChange={v => setEmail('smtp_port', v)} min={1} max={65535} />
          </Field>
          <Field label="SMTP User">
            <TextInput value={cfg.delivery.email.smtp_user} onChange={v => setEmail('smtp_user', v)} wide />
          </Field>
          <Field label="SMTP Password">
            <TextInput type="password" value={cfg.delivery.email.smtp_pass} onChange={v => setEmail('smtp_pass', v)} wide />
          </Field>
          <Field label="发件人">
            <TextInput value={cfg.delivery.email.from} onChange={v => setEmail('from', v)} wide />
          </Field>
          <Field label="收件人（逗号分隔）">
            <TextInput
              value={cfg.delivery.email.to.join(', ')}
              onChange={v => setEmail('to', v.split(',').map(s => s.trim()).filter(Boolean))}
              wide
              placeholder="you@example.com"
            />
          </Field>
        </SectionCard>

      </div>
    </div>
  );
}
