import { Star, LayoutGrid, ExternalLink } from 'lucide-react';
import { Badge } from './ui/badge';
import { Button } from './ui/button';
import type { FeedItem } from '@/lib/api';
import { cn } from '@/lib/utils';

interface Props {
  item: FeedItem;
  isPicked: boolean;
  onPick: (item: FeedItem) => void;
  onCompare: (itemId: string) => void;
}

function actionBadge(action: FeedItem['action']) {
  const map: Record<FeedItem['action'], { variant: 'green' | 'yellow' | 'gray'; dot: string }> = {
    可写: { variant: 'green', dot: 'bg-green-500' },
    可提: { variant: 'yellow', dot: 'bg-yellow-500' },
    可转: { variant: 'yellow', dot: 'bg-orange-400' },
    跳过: { variant: 'gray', dot: 'bg-gray-400' },
  };
  return map[action] ?? { variant: 'gray', dot: 'bg-gray-400' };
}

function scoreColor(score: number) {
  if (score >= 80) return 'text-green-600';
  if (score >= 60) return 'text-yellow-600';
  return 'text-gray-400';
}

export function ScoreCard({ item, isPicked, onPick, onCompare }: Props) {
  const { variant, dot } = actionBadge(item.action);

  return (
    <div className={cn(
      'rounded-lg border bg-card p-4 space-y-2 transition-shadow hover:shadow-md',
      isPicked && 'ring-2 ring-primary/40'
    )}>
      {/* Header row */}
      <div className="flex items-start justify-between gap-2">
        <div className="flex items-center gap-2 min-w-0">
          <span className={cn('text-2xl font-bold tabular-nums shrink-0', scoreColor(item.score_overall))}>
            {item.score_overall}
          </span>
          <div className="flex items-center gap-1.5">
            <span className={cn('h-2 w-2 rounded-full shrink-0', dot)} />
            <Badge variant={variant}>{item.action}</Badge>
          </div>
        </div>
        <div className="flex items-center gap-1 shrink-0">
          <Button
            size="icon"
            variant={isPicked ? 'default' : 'ghost'}
            className="h-7 w-7"
            title={isPicked ? '已加入素材篮' : '加入素材篮'}
            onClick={() => onPick(item)}
          >
            <Star className={cn('h-4 w-4', isPicked && 'fill-current')} />
          </Button>
          <Button
            size="icon"
            variant="ghost"
            className="h-7 w-7"
            title="多视角对比"
            onClick={() => onCompare(item.item_id)}
          >
            <LayoutGrid className="h-4 w-4" />
          </Button>
        </div>
      </div>

      {/* Title */}
      <div className="space-y-0.5">
        <a
          href={item.url}
          target="_blank"
          rel="noreferrer"
          className="font-medium text-sm leading-snug hover:underline flex items-start gap-1 group"
        >
          {item.title}
          <ExternalLink className="h-3 w-3 mt-0.5 opacity-0 group-hover:opacity-50 shrink-0" />
        </a>
        {item.cn_title && item.cn_title !== item.title && (
          <p className="text-sm text-muted-foreground leading-snug">→ {item.cn_title}</p>
        )}
      </div>

      {/* Summary */}
      {item.cn_summary_short && (
        <p className="text-xs text-muted-foreground leading-relaxed line-clamp-3">
          {item.cn_summary_short}
        </p>
      )}

      {/* Angle */}
      {item.angle_suggestion && (
        <p className="text-xs text-primary/80 bg-primary/5 rounded px-2 py-1">
          💡 {item.angle_suggestion}
        </p>
      )}

      {/* Footer */}
      <div className="flex items-center gap-2 text-xs text-muted-foreground pt-1 border-t">
        <span>{item.source_domain}</span>
        <span>·</span>
        <span>{item.word_count ? `${item.word_count}字` : ''}</span>
        <span>·</span>
        <span>{item.lang?.toUpperCase()}</span>
        {item.published_at && (
          <>
            <span>·</span>
            <span>{new Date(item.published_at).toLocaleDateString('zh-CN')}</span>
          </>
        )}
      </div>
    </div>
  );
}
