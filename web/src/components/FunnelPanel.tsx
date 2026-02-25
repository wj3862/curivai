import { useState, useEffect } from 'react';
import { ChevronDown, ChevronRight, TrendingDown } from 'lucide-react';
import { api, type FunnelStats } from '@/lib/api';

interface Props {
  persona: string;
}

function fmt(n: number, decimals = 0) {
  return n.toLocaleString('zh-CN', { maximumFractionDigits: decimals });
}

function fmtCost(usd: number) {
  if (usd < 0.001) return `$${(usd * 1000).toFixed(3)}m`;
  return `$${usd.toFixed(4)}`;
}

function FunnelStep({
  label,
  count,
  sub,
  cost,
  dim,
}: {
  label: string;
  count: number | null;
  sub?: string;
  cost?: string;
  dim?: boolean;
}) {
  return (
    <div className={`flex flex-col items-center ${dim ? 'opacity-40' : ''}`}>
      <div className="text-xs text-muted-foreground mb-0.5">{label}</div>
      <div className="text-lg font-bold tabular-nums">
        {count === null ? '—' : fmt(count)}
        <span className="text-xs font-normal text-muted-foreground ml-0.5">篇</span>
      </div>
      {sub && <div className="text-xs text-muted-foreground">{sub}</div>}
      {cost && <div className="text-xs text-blue-600">{cost}</div>}
    </div>
  );
}

function Arrow() {
  return (
    <div className="flex items-center text-muted-foreground/40 pt-4">
      <TrendingDown className="h-4 w-4 rotate-[-90deg]" />
    </div>
  );
}

export function FunnelPanel({ persona }: Props) {
  const [open, setOpen] = useState(false);
  const [data, setData] = useState<FunnelStats | null>(null);
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    setData(null);
  }, [persona]);

  useEffect(() => {
    if (!open || !persona) return;
    setLoading(true);
    api.system.getFunnel(persona)
      .then(setData)
      .catch(() => setData(null))
      .finally(() => setLoading(false));
  }, [open, persona]);

  return (
    <div className="border rounded-lg bg-card mb-3">
      <button
        className="flex items-center gap-2 w-full px-4 py-2.5 text-sm font-medium hover:bg-accent/50 transition-colors rounded-lg"
        onClick={() => setOpen(v => !v)}
      >
        {open ? <ChevronDown className="h-4 w-4" /> : <ChevronRight className="h-4 w-4" />}
        漏斗分析
        {data && !loading && (
          <span className="ml-auto text-xs text-muted-foreground font-normal">
            总成本 {fmtCost(data.tokens.estimated_cost_usd)}
            {data.efficiency.cost_per_actionable !== null && (
              <> · 每篇可写 {fmtCost(data.efficiency.cost_per_actionable)}</>
            )}
          </span>
        )}
      </button>

      {open && (
        <div className="px-4 pb-4 space-y-3">
          {loading && (
            <div className="text-xs text-muted-foreground text-center py-3">加载中…</div>
          )}

          {!loading && data && (
            <>
              {/* Funnel steps */}
              <div className="flex items-start justify-center gap-3 pt-1 overflow-x-auto">
                <FunnelStep
                  label="全部文章"
                  count={data.funnel.total_items}
                  sub="DB全量"
                />
                <Arrow />
                <FunnelStep
                  label="CheapFilter"
                  count={data.funnel.cheap_evaluated}
                  sub={`≥阈值 ${data.funnel.cheap_above_threshold}篇`}
                  cost="免费"
                />
                <Arrow />
                <FunnelStep
                  label="AI评分(Lite)"
                  count={data.funnel.lite_scored}
                  sub={`${data.tokens.lite_total > 0 ? fmt(data.tokens.lite_total) + ' tokens' : '尚未运行'}`}
                  cost={data.tokens.lite_total > 0 ? fmtCost(data.tokens.lite_cost_usd) : undefined}
                  dim={data.funnel.lite_scored === 0}
                />
                <Arrow />
                <FunnelStep
                  label="全量升级"
                  count={data.funnel.full_upgraded}
                  sub={`${data.tokens.full_total > 0 ? fmt(data.tokens.full_total) + ' tokens' : '尚未运行'}`}
                  cost={data.tokens.full_total > 0 ? fmtCost(data.tokens.full_cost_usd) : undefined}
                  dim={data.funnel.full_upgraded === 0}
                />
              </div>

              {/* Action breakdown */}
              {data.funnel.lite_scored > 0 && (
                <div className="flex items-center gap-4 text-xs text-center border-t pt-3">
                  <span className="text-muted-foreground shrink-0">评分分布:</span>
                  {(['可写', '可提', '可转', '跳过'] as const).map(action => {
                    const count = data.action_breakdown[action] ?? 0;
                    const colorMap: Record<string, string> = {
                      可写: 'text-green-600',
                      可提: 'text-yellow-600',
                      可转: 'text-orange-500',
                      跳过: 'text-gray-400',
                    };
                    return (
                      <span key={action} className={colorMap[action]}>
                        {action} <strong>{count}</strong>
                      </span>
                    );
                  })}
                  {data.efficiency.actionable_rate !== null && (
                    <span className="ml-auto text-muted-foreground">
                      可用率 {(data.efficiency.actionable_rate * 100).toFixed(0)}%
                    </span>
                  )}
                </div>
              )}
            </>
          )}

          {!loading && !data && (
            <div className="text-xs text-muted-foreground text-center py-2">
              暂无数据（运行评分后显示）
            </div>
          )}
        </div>
      )}
    </div>
  );
}
