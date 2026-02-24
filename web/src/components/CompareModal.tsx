import { useState, useEffect } from 'react';
import { Loader2, Zap } from 'lucide-react';
import {
  Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription,
} from './ui/dialog';
import { Button } from './ui/button';
import { Badge } from './ui/badge';
import { api, type CompareResult } from '@/lib/api';
import { toast } from '@/hooks/use-toast';
import { cn } from '@/lib/utils';

interface Props {
  itemId: string | null;
  onClose: () => void;
}

function actionVariant(action: string | null): 'green' | 'yellow' | 'gray' | 'red' {
  if (action === '可写') return 'green';
  if (action === '可提') return 'yellow';
  if (action === '可转') return 'yellow';
  return 'gray';
}

export function CompareModal({ itemId, onClose }: Props) {
  const [data, setData] = useState<CompareResult | null>(null);
  const [loading, setLoading] = useState(false);
  const [computing, setComputing] = useState<string | null>(null);

  useEffect(() => {
    if (!itemId) { setData(null); return; }
    setLoading(true);
    api.compare.get(itemId)
      .then(setData)
      .catch(e => toast({ title: '加载失败', description: e.message, variant: 'destructive' }))
      .finally(() => setLoading(false));
  }, [itemId]);

  async function computeScore(persona: string) {
    if (!itemId) return;
    setComputing(persona);
    try {
      await api.feed.score(persona, 1);
      const fresh = await api.compare.get(itemId);
      setData(fresh);
      toast({ title: '评分完成' });
    } catch (e: unknown) {
      toast({ title: '评分失败', description: (e as Error).message, variant: 'destructive' });
    } finally {
      setComputing(null);
    }
  }

  return (
    <Dialog open={!!itemId} onOpenChange={open => !open && onClose()}>
      <DialogContent className="max-w-xl">
        <DialogHeader>
          <DialogTitle className="text-base leading-snug">
            {data?.item.title ?? '多视角对比'}
          </DialogTitle>
          {data && (
            <DialogDescription>
              {data.item.site_domain} · <a href={data.item.url} target="_blank" rel="noreferrer" className="hover:underline text-primary">{data.item.url.slice(0, 50)}…</a>
            </DialogDescription>
          )}
        </DialogHeader>

        {loading && (
          <div className="flex justify-center py-8">
            <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
          </div>
        )}

        {data && (
          <div className="space-y-3 mt-2">
            {data.scores.map(s => (
              <div
                key={s.persona}
                className={cn(
                  'rounded-lg border p-4 space-y-1',
                  s.cached ? 'bg-card' : 'bg-muted/30 opacity-70'
                )}
              >
                <div className="flex items-center justify-between">
                  <span className="font-medium text-sm">
                    {s.icon} {s.display_name}
                  </span>
                  {s.cached ? (
                    <div className="flex items-center gap-2">
                      <span className="text-2xl font-bold tabular-nums">{s.score}</span>
                      <Badge variant={actionVariant(s.action)}>{s.action}</Badge>
                    </div>
                  ) : (
                    <Button
                      size="sm"
                      variant="outline"
                      disabled={computing === s.persona}
                      onClick={() => computeScore(s.persona)}
                    >
                      {computing === s.persona
                        ? <Loader2 className="h-3 w-3 animate-spin" />
                        : <Zap className="h-3 w-3" />}
                      计算此视角
                    </Button>
                  )}
                </div>
                {s.angle_suggestion && (
                  <p className="text-xs text-muted-foreground">
                    💡 {s.angle_suggestion}
                  </p>
                )}
                {!s.cached && (
                  <p className="text-xs text-muted-foreground italic">未评分</p>
                )}
              </div>
            ))}
          </div>
        )}
      </DialogContent>
    </Dialog>
  );
}
