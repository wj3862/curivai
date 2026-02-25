// API client — thin fetch wrapper for Hono backend

const BASE = '/api';

async function request<T>(path: string, options?: RequestInit): Promise<T> {
  const res = await fetch(`${BASE}${path}`, {
    headers: { 'Content-Type': 'application/json', ...options?.headers },
    ...options,
  });
  if (!res.ok) {
    const text = await res.text().catch(() => res.statusText);
    let msg = text;
    try { msg = JSON.parse(text).error ?? text; } catch { /* ignore */ }
    throw new Error(`API ${res.status}: ${msg}`);
  }
  return res.json() as Promise<T>;
}

// ─── Types ────────────────────────────────────────────────────────────────────

export interface Persona {
  name: string;
  display_name: string;
  description: string | null;
  icon: string | null;
  is_builtin: number;
}

export interface FeedItem {
  item_id: string;
  title: string;           // original_title from API
  url: string;
  source_domain: string | null;
  source_title: string | null;
  published_at: string | null;
  word_count: number | null;
  lang: string | null;
  // ScorePack fields
  cn_title: string;
  cn_summary_short: string;
  score_overall: number;
  action: '可写' | '可提' | '可转' | '跳过';
  reasons: string[];
  angle_suggestion: string | null;
  topic: string | null;
  pack_level: 'lite' | 'full';
}

export interface CompareScore {
  persona: string;
  display_name: string;
  icon: string | null;
  score: number | null;
  action: string | null;
  cn_title: string | null;
  angle_suggestion: string | null;
  cached: boolean;
}

export interface CompareResult {
  item: { id: string; title: string; url: string; site_domain: string | null };
  scores: CompareScore[];
}

export interface Source {
  id: string;
  type: string;
  url: string;
  title: string | null;
  site_domain: string | null;
  pack_name: string | null;
  is_active: number;
  last_fetched_at: string | null;
  item_count?: number;
}

export interface PickedItem {
  id: string;           // pick row id
  persona_name: string;
  item_id: string;
  sort_order: number;
  created_at: string;
  // joined item fields
  original_title: string;
  url: string;
  published_at: string | null;
  site_domain: string | null;
  // joined scorepack fields
  cn_title: string | null;
  cn_summary_short: string | null;
  cn_summary_long: string | null;
  key_points_json: string | null;
  score_overall: number | null;
  action: string | null;
  angle_suggestion: string | null;
  pack_level: string | null;
}

export interface Draft {
  id: string;
  persona_name: string;
  draft_type: string;
  title: string | null;
  selected_item_ids: string[];
  merge_strategy: string | null;
  user_commentary: string | null;
  content_md: string | null;
  created_at: string;
  updated_at: string;
}

export interface RadarPack {
  name: string;
  display_name: string;
  description: string;
  source_count: number;
  installed: boolean;
}

export interface AppConfig {
  llm: {
    base_url: string;
    api_key: string;   // '***' when masked
    model: string;
    max_tokens: number;
    temperature: number;
    timeout_ms: number;
    max_concurrent: number;
  };
  ingest: {
    default_concurrency: number;
    content_excerpt_chars: number;
    fetch_timeout_ms: number;
  };
  scoring: {
    cheap_threshold: number;
    default_budget: number;
    default_days: number;
    cheap_weights: {
      freshness: number;
      keyword_match: number;
      source_trust: number;
      language_match: number;
      length_sanity: number;
      duplicate_penalty: number;
    };
    topic_dedup: {
      lookback_days: number;
      exact_penalty: number;
      fuzzy_threshold: number;
      fuzzy_penalty: number;
    };
  };
  budget: {
    max_llm_calls_per_run: number;
    max_cost_usd_per_run: number;
    cost_per_call_estimate: number;
  };
  schedule: {
    ingest_cron: string;
    digest_cron: string;
  };
  delivery: {
    email: {
      enabled: boolean;
      smtp_host: string;
      smtp_port: number;
      smtp_user: string;
      smtp_pass: string;
      from: string;
      to: string[];
    };
  };
}

export interface FunnelStats {
  funnel: {
    total_items: number;
    cheap_evaluated: number;
    cheap_above_threshold: number;
    lite_scored: number;
    full_upgraded: number;
  };
  action_breakdown: { 可写: number; 可提: number; 可转: number; 跳过: number };
  tokens: {
    lite_total: number;
    full_total: number;
    lite_cost_usd: number;
    full_cost_usd: number;
    estimated_cost_usd: number;
  };
  efficiency: {
    cost_per_actionable: number | null;
    actionable_rate: number | null;
  };
}

export interface CandidateItem {
  item_id: string;
  original_title: string;
  url: string;
  published_at: string | null;
  word_count: number | null;
  lang: string | null;
  source_title: string | null;
  site_domain: string | null;
  cheap_score: number;
  cn_title: string | null;
  score_overall: number | null;
  action: string | null;
  pack_level: string | null;
  is_llm_scored: boolean;
}

export interface CandidatesResult {
  persona: string;
  days: number;
  q: string;
  count: number;
  items: CandidateItem[];
}

// ─── API ──────────────────────────────────────────────────────────────────────

export const api = {
  // ─── Personas ─────────────────────────────────────────────────────────────

  personas: {
    list: () => request<Persona[]>('/personas'),
  },

  // ─── Feed ─────────────────────────────────────────────────────────────────

  feed: {
    get: async (persona: string, top = 20, days = 3): Promise<FeedItem[]> => {
      const res = await request<{ persona: string; days: number; count: number; items: Array<Record<string, unknown>> }>(
        `/feed/${persona}?top=${top}&days=${days}`
      );
      // Normalize: API returns original_title, we map to title for consistency
      return res.items.map(item => ({
        ...item,
        title: (item['original_title'] ?? item['title'] ?? '') as string,
        source_domain: item['site_domain'] as string | null,
      })) as FeedItem[];
    },

    score: async (persona: string, budget = 30, days = 3, item_ids?: string[]) => {
      const res = await request<{
        persona: string;
        stats: { scored: number; cached: number; failed: number };
      }>(`/score/${persona}`, {
        method: 'POST',
        body: JSON.stringify({ budget, days, ...(item_ids ? { item_ids } : {}) }),
      });
      return res.stats;
    },
  },

  // ─── Candidates ───────────────────────────────────────────────────────────

  candidates: {
    get: (persona: string, days = 7, q = '') =>
      request<CandidatesResult>(`/candidates/${persona}?days=${days}&q=${encodeURIComponent(q)}`),
  },

  // ─── Compare ──────────────────────────────────────────────────────────────

  compare: {
    get: (itemId: string) => request<CompareResult>(`/compare/${itemId}`),
  },

  // ─── Studio ───────────────────────────────────────────────────────────────

  picked: {
    list: async (persona: string): Promise<PickedItem[]> => {
      const res = await request<{ persona: string; count: number; items: PickedItem[] }>(
        `/picked/${persona}`
      );
      return res.items;
    },
    add: (persona: string, item_id: string) =>
      request<{ added: boolean; item_id: string; persona: string; message: string }>(
        `/picked/${persona}`,
        { method: 'POST', body: JSON.stringify({ item_id }) }
      ),
    remove: (persona: string, itemId: string) =>
      request<void>(`/picked/${persona}/${itemId}`, { method: 'DELETE' }),
  },

  drafts: {
    list: async (persona: string): Promise<Draft[]> => {
      const res = await request<{ count: number; drafts: Draft[] }>(`/drafts?persona=${persona}`);
      return res.drafts;
    },
    get: (id: string) => request<Draft>(`/drafts/${id}`),
    create: (body: {
      persona_name: string;
      draft_type: string;
      title?: string;
      merge_strategy?: string;
    }) =>
      // API uses { persona, type, strategy } not { persona_name, draft_type }
      request<Draft>('/drafts', {
        method: 'POST',
        body: JSON.stringify({
          persona: body.persona_name,
          type: body.draft_type,
          title: body.title,
          strategy: body.merge_strategy,
        }),
      }),
    update: (id: string, body: { title?: string; user_commentary?: string }) =>
      request<Draft>(`/drafts/${id}`, { method: 'PATCH', body: JSON.stringify(body) }),
    compose: async (id: string): Promise<Draft> => {
      const res = await request<{ stats: unknown; draft: Draft }>(`/drafts/${id}/compose`, {
        method: 'POST',
      });
      return res.draft;
    },
    export: (id: string, format: string) =>
      request<{
        export_id: string;
        format: string;
        lint_passed: boolean;
        lint_warnings: string[];
        content: string;
        errors?: string[];
      }>(`/drafts/${id}/export`, {
        method: 'POST',
        body: JSON.stringify({ format }),
      }).then(r => ({
        content: r.content,
        lint_passed: r.lint_passed,
        errors: r.errors ?? [],
        warnings: r.lint_warnings ?? [],
      })),
  },

  // ─── Sources ──────────────────────────────────────────────────────────────

  sources: {
    list: () => request<Source[]>('/sources'),
    add: (url: string, title?: string) =>
      request<Source>('/sources', { method: 'POST', body: JSON.stringify({ url, title }) }),
    remove: (id: string) => request<void>(`/sources/${id}`, { method: 'DELETE' }),
    toggle: (id: string, is_active: boolean) =>
      request<Source>(`/sources/${id}`, {
        method: 'PATCH',
        body: JSON.stringify({ is_active: is_active ? 1 : 0 }),
      }),
    importOpml: async (formData: FormData) => {
      // The backend expects raw XML body, not multipart form
      const file = formData.get('file') as File;
      const text = await file.text();
      return fetch(`${BASE}/sources/import-opml`, {
        method: 'POST',
        headers: { 'Content-Type': 'text/xml' },
        body: text,
      }).then(r => r.json());
    },
    installPack: (pack_name: string) =>
      request<{ added: number; skipped: number; total: number; pack: string }>(
        '/sources/install-pack',
        { method: 'POST', body: JSON.stringify({ pack_name }) }
      ),
    listPacks: () => request<RadarPack[]>('/sources/packs'),
  },

  // ─── Ingest ───────────────────────────────────────────────────────────────

  ingest: {
    run: (limit = 200) =>
      request<{ ingested: number; skipped: number; errors: number }>(
        '/ingest',
        { method: 'POST', body: JSON.stringify({ limit }) }
      ),
    status: () =>
      request<{ last_run: string | null; total_items: number }>('/ingest/status'),
  },

  // ─── System ───────────────────────────────────────────────────────────────

  system: {
    health: () => request<{ status: string }>('/health'),
    stats: () =>
      request<{
        sources: number;
        items: number;
        items_with_content: number;
        duplicates: number;
      }>('/stats'),
    getFunnel: (persona: string) => request<FunnelStats>(`/stats/funnel/${persona}`),
    getConfig: () => request<AppConfig>('/config'),
    updateConfig: (patch: Partial<AppConfig>) =>
      request<{ saved: boolean; config: AppConfig }>('/config', {
        method: 'PATCH',
        body: JSON.stringify(patch),
      }),
  },
};
