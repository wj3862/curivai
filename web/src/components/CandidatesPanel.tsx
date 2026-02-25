import { useState, useEffect, useRef } from 'react';
import { Loader2, Zap, ExternalLink } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { api, type CandidateItem } from '@/lib/api';
import { toast } from '@/hooks/use-toast';
import { cn } from '@/lib/utils';

interface Props {
  persona: string;
  days: string;
  onScoringDone: () => void;
}

function cheapColor(score: number) {
  if (score >= 75) return 'text-green-600';
  if (score >= 55) return 'text-yellow-600';
  return 'text-gray-400';
}

export function CandidatesPanel({ persona, days, onScoringDone }: Props) {
  const [items, setItems] = useState<CandidateItem[]>([]);
  const [loading, setLoading] = useState(false);
  const [scoring, setScoring] = useState(false);
  const [q, setQ] = useState('');
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [budget, setBudget] = useState(20);
  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const fetchCandidates = (query: string) => {
    if (!persona) return;
    setLoading(true);
    api.candidates.get(persona, parseInt(days), query)
      .then(res => setItems(res.items))
      .catch(e => toast({ title: '加载候选失败', description: (e as Error).message, variant: 'destructive' }))
      .finally(() => setLoading(false));
  };

  // Reload when persona or days changes
  useEffect(() => {
    setSelected(new Set());
    setQ('');
    fetchCandidates('');
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [persona, days]);

  function handleQueryChange(value: string) {
    setQ(value);
    if (debounceRef.current) clearTimeout(debounceRef.current);
    debounceRef.current = setTimeout(() => fetchCandidates(value), 300);
  }

  function toggleSelect(itemId: string) {
    setSelected(prev => {
      const next = new Set(prev);
      if (next.has(itemId)) next.delete(itemId);
      else next.add(itemId);
      return next;
    });
  }

  function toggleAll() {
    if (selected.size === items.length) {
      setSelected(new Set());
    } else {
      setSelected(new Set(items.map(i => i.item_id)));
    }
  }

  async function handleScoreSelected() {
    if (selected.size === 0) return;
    setScoring(true);
    try {
      const result = await api.feed.score(persona, budget, parseInt(days), [...selected]);
      toast({ title: `评分完成`, description: `新增 ${result.scored} 篇，${result.cached} 篇已缓存` });
      setSelected(new Set());
      onScoringDone();
    } catch (e: unknown) {
      toast({ title: '评分失败', description: (e as Error).message, variant: 'destructive' });
    } finally {
      setScoring(false);
    }
  }

  async function handleScoreBudget() {
    setScoring(true);
    try {
      const result = await api.feed.score(persona, budget, parseInt(days));
      toast({ title: `评分完成`, description: `新增 ${result.scored} 篇，${result.cached} 篇已缓存` });
      onScoringDone();
    } catch (e: unknown) {
      toast({ title: '评分失败', description: (e as Error).message, variant: 'destructive' });
    } finally {
      setScoring(false);
    }
  }

  return (
    <div className="flex flex-col h-full">
      {/* Search + controls */}
      <div className="flex items-center gap-2 px-4 py-2 border-b flex-wrap">
        <input
          type="text"
          placeholder="搜索标题..."
          value={q}
          onChange={e => handleQueryChange(e.target.value)}
          className="flex-1 min-w-[160px] h-8 px-3 rounded-md border bg-background text-sm focus:outline-none focus:ring-1 focus:ring-ring"
        />

        <div className="flex items-center gap-1.5 text-sm shrink-0">
          <span className="text-muted-foreground text-xs">预算</span>
          <input
            type="number"
            min={1}
            max={100}
            value={budget}
            onChange={e => setBudget(Math.max(1, parseInt(e.target.value) || 20))}
            className="w-14 h-8 px-2 rounded-md border bg-background text-sm text-center focus:outline-none focus:ring-1 focus:ring-ring"
          />
          <span className="text-muted-foreground text-xs">篇</span>
        </div>

        <Button
          size="sm"
          variant="outline"
          onClick={handleScoreSelected}
          disabled={selected.size === 0 || scoring}
        >
          {scoring ? <Loader2 className="h-3 w-3 animate-spin mr-1" /> : <Zap className="h-3 w-3 mr-1" />}
          AI评分选中({selected.size}篇)
        </Button>
        <Button
          size="sm"
          onClick={handleScoreBudget}
          disabled={scoring}
        >
          {scoring ? <Loader2 className="h-3 w-3 animate-spin mr-1" /> : <Zap className="h-3 w-3 mr-1" />}
          按预算评分({budget}篇)
        </Button>
      </div>

      {/* Count + select all */}
      <div className="flex items-center gap-3 px-4 py-1.5 text-xs text-muted-foreground border-b">
        <label className="flex items-center gap-1.5 cursor-pointer select-none">
          <input
            type="checkbox"
            checked={items.length > 0 && selected.size === items.length}
            onChange={toggleAll}
            className="accent-primary"
          />
          全选
        </label>
        <span>{items.length} 篇候选</span>
        {selected.size > 0 && (
          <span className="text-primary">已选 {selected.size} 篇</span>
        )}
      </div>

      {/* List */}
      <div className="flex-1 overflow-auto">
        {loading && (
          <div className="flex justify-center py-12">
            <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
          </div>
        )}

        {!loading && items.length === 0 && (
          <div className="text-center py-12 text-muted-foreground text-sm">
            暂无候选文章（请先抓取内容）
          </div>
        )}

        {!loading && items.map(item => (
          <label
            key={item.item_id}
            className={cn(
              'flex items-start gap-3 px-4 py-3 border-b cursor-pointer hover:bg-accent/40 transition-colors',
              selected.has(item.item_id) && 'bg-primary/5'
            )}
          >
            <input
              type="checkbox"
              checked={selected.has(item.item_id)}
              onChange={() => toggleSelect(item.item_id)}
              className="mt-0.5 accent-primary shrink-0"
            />

            <div className="flex-1 min-w-0">
              {/* Score + source row */}
              <div className="flex items-center gap-2 text-xs mb-0.5">
                <span className={cn('font-bold tabular-nums', cheapColor(item.cheap_score))}>
                  [{item.cheap_score}]
                </span>
                <span className="text-muted-foreground">{item.site_domain ?? item.source_title}</span>
                {item.word_count && (
                  <span className="text-muted-foreground">{item.word_count}字</span>
                )}
                {item.published_at && (
                  <span className="text-muted-foreground">
                    {new Date(item.published_at).toLocaleDateString('zh-CN')}
                  </span>
                )}
                {item.is_llm_scored && item.score_overall !== null && (
                  <Badge variant={item.action === '可写' ? 'green' : item.action === '跳过' ? 'gray' : 'yellow'}>
                    {item.score_overall} {item.action}
                  </Badge>
                )}
              </div>

              {/* Title */}
              <div className="flex items-start gap-1">
                <span className="text-sm leading-snug flex-1 min-w-0">
                  {item.original_title}
                </span>
                <a
                  href={item.url}
                  target="_blank"
                  rel="noreferrer"
                  onClick={e => e.stopPropagation()}
                  className="shrink-0 mt-0.5 text-muted-foreground hover:text-foreground"
                >
                  <ExternalLink className="h-3.5 w-3.5" />
                </a>
              </div>

              {/* CN title if scored */}
              {item.is_llm_scored && item.cn_title && item.cn_title !== item.original_title && (
                <p className="text-xs text-muted-foreground mt-0.5">→ {item.cn_title}</p>
              )}
            </div>
          </label>
        ))}
      </div>
    </div>
  );
}
