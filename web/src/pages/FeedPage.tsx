import { useState, useEffect, useCallback } from 'react';
import { RefreshCw, Loader2, Zap } from 'lucide-react';
import { ScoreCard } from '@/components/ScoreCard';
import { Button } from '@/components/ui/button';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { api, type FeedItem } from '@/lib/api';
import { toast } from '@/hooks/use-toast';

interface Props {
  persona: string;
  pickedIds: Set<string>;
  onPick: (itemId: string) => void;
  onCompare: (itemId: string) => void;
}

export function FeedPage({ persona, pickedIds, onPick, onCompare }: Props) {
  const [items, setItems] = useState<FeedItem[]>([]);
  const [loading, setLoading] = useState(false);
  const [scoring, setScoring] = useState(false);
  const [days, setDays] = useState('3');
  const [top, setTop] = useState('30');

  const loadFeed = useCallback(async () => {
    if (!persona) return;
    setLoading(true);
    try {
      const data = await api.feed.get(persona, parseInt(top), parseInt(days));
      setItems(data);
    } catch (e: unknown) {
      toast({ title: '加载失败', description: (e as Error).message, variant: 'destructive' });
    } finally {
      setLoading(false);
    }
  }, [persona, top, days]);

  useEffect(() => { void loadFeed(); }, [loadFeed]);

  async function handleScore() {
    setScoring(true);
    try {
      const result = await api.feed.score(persona, 30, parseInt(days));
      toast({ title: `评分完成`, description: `新增 ${result.scored} 篇，${result.cached} 篇已缓存` });
      await loadFeed();
    } catch (e: unknown) {
      toast({ title: '评分失败', description: (e as Error).message, variant: 'destructive' });
    } finally {
      setScoring(false);
    }
  }

  const actionGroups = {
    可写: items.filter(i => i.action === '可写'),
    可提: items.filter(i => i.action === '可提'),
    可转: items.filter(i => i.action === '可转'),
    跳过: items.filter(i => i.action === '跳过'),
  };

  return (
    <div className="flex flex-col h-full">
      {/* Toolbar */}
      <div className="flex items-center gap-2 px-4 py-3 border-b bg-background/95 backdrop-blur sticky top-0 z-10">
        <Select value={days} onValueChange={setDays}>
          <SelectTrigger className="w-28 h-8">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="1">今天</SelectItem>
            <SelectItem value="3">近3天</SelectItem>
            <SelectItem value="7">近7天</SelectItem>
            <SelectItem value="14">近14天</SelectItem>
          </SelectContent>
        </Select>

        <Select value={top} onValueChange={setTop}>
          <SelectTrigger className="w-24 h-8">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="20">Top 20</SelectItem>
            <SelectItem value="30">Top 30</SelectItem>
            <SelectItem value="50">Top 50</SelectItem>
          </SelectContent>
        </Select>

        <div className="ml-auto flex items-center gap-2">
          <Button size="sm" variant="outline" onClick={loadFeed} disabled={loading}>
            <RefreshCw className={`h-4 w-4 ${loading ? 'animate-spin' : ''}`} />
          </Button>
          <Button size="sm" onClick={handleScore} disabled={scoring || loading}>
            {scoring ? <Loader2 className="h-4 w-4 animate-spin mr-1" /> : <Zap className="h-4 w-4 mr-1" />}
            AI 评分
          </Button>
        </div>
      </div>

      {/* Content */}
      <div className="flex-1 overflow-auto p-4">
        {loading && items.length === 0 && (
          <div className="flex justify-center py-16">
            <Loader2 className="h-8 w-8 animate-spin text-muted-foreground" />
          </div>
        )}

        {!loading && items.length === 0 && (
          <div className="text-center py-16 text-muted-foreground space-y-2">
            <p className="text-lg">暂无评分结果</p>
            <p className="text-sm">点击「AI 评分」获取内容推荐</p>
          </div>
        )}

        {items.length > 0 && (
          <div className="space-y-6">
            {(Object.entries(actionGroups) as [string, FeedItem[]][])
              .filter(([, list]) => list.length > 0)
              .map(([action, list]) => (
                <div key={action}>
                  <h3 className="text-xs font-semibold text-muted-foreground uppercase tracking-wider mb-3 flex items-center gap-2">
                    {action}
                    <span className="bg-muted rounded-full px-1.5 py-0.5 text-xs">{list.length}</span>
                  </h3>
                  <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-3">
                    {list.map(item => (
                      <ScoreCard
                        key={item.item_id}
                        item={item}
                        isPicked={pickedIds.has(item.item_id)}
                        onPick={i => onPick(i.item_id)}
                        onCompare={onCompare}
                      />
                    ))}
                  </div>
                </div>
              ))}
          </div>
        )}
      </div>
    </div>
  );
}
