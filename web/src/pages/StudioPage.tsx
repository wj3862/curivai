import { useState, useEffect, useCallback } from 'react';
import { Loader2, Trash2, Wand2, Copy, Download, CheckCircle2, AlertCircle } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Textarea } from '@/components/ui/textarea';
import { Badge } from '@/components/ui/badge';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { api, type PickedItem, type Draft } from '@/lib/api';
import { toast } from '@/hooks/use-toast';
import { cn } from '@/lib/utils';

interface Props {
  persona: string;
  pickedIds?: Set<string>;
  onPickedChange: (ids: Set<string>) => void;
}

type ExportFormat = 'wechat' | 'xhs' | 'douyin';

const FORMAT_LABELS: Record<ExportFormat, string> = {
  wechat: '公众号',
  xhs: '小红书',
  douyin: '抖音脚本',
};

const STRATEGY_LABELS: Record<string, string> = {
  roundup: '周报合集',
  brief: '聚焦简报',
  compare: '对比分析',
};

export function StudioPage({ persona, onPickedChange }: Props) {
  const [picked, setPicked] = useState<PickedItem[]>([]);
  const [draft, setDraft] = useState<Draft | null>(null);
  const [commentary, setCommentary] = useState('');
  const [strategy, setStrategy] = useState<string>('roundup');
  const [draftType, setDraftType] = useState<ExportFormat>('wechat');
  const [exportFormat, setExportFormat] = useState<ExportFormat>('wechat');
  const [exportContent, setExportContent] = useState<string>('');
  const [lintPassed, setLintPassed] = useState<boolean | null>(null);
  const [lintErrors, setLintErrors] = useState<string[]>([]);
  const [composing, setComposing] = useState(false);
  const [exporting, setExporting] = useState(false);
  const [loadingPicked, setLoadingPicked] = useState(false);

  const loadPicked = useCallback(async () => {
    if (!persona) return;
    setLoadingPicked(true);
    try {
      const data = await api.picked.list(persona);
      setPicked(data);
      onPickedChange(new Set(data.map(p => p.item_id)));
    } catch (e: unknown) {
      toast({ title: '加载素材篮失败', description: (e as Error).message, variant: 'destructive' });
    } finally {
      setLoadingPicked(false);
    }
  }, [persona, onPickedChange]);

  useEffect(() => { void loadPicked(); }, [loadPicked]);

  async function removePicked(itemId: string) {
    try {
      await api.picked.remove(persona, itemId);
      await loadPicked();
      toast({ title: '已从素材篮移除' });
    } catch (e: unknown) {
      toast({ title: '操作失败', description: (e as Error).message, variant: 'destructive' });
    }
  }

  async function handleCompose() {
    if (picked.length === 0) {
      toast({ title: '素材篮为空', description: '请先从 Feed 页添加素材', variant: 'destructive' });
      return;
    }
    setComposing(true);
    setExportContent('');
    setLintPassed(null);
    try {
      // Create or reuse draft
      let d = draft;
      if (!d) {
        d = await api.drafts.create({
          persona_name: persona,
          draft_type: draftType,
          merge_strategy: strategy,
        });
      } else {
        // update strategy/type in case changed
        d = await api.drafts.update(d.id, {});
      }
      // Save commentary
      if (commentary.trim()) {
        d = await api.drafts.update(d.id, { user_commentary: commentary });
      }
      // Compose
      d = await api.drafts.compose(d.id);
      setDraft(d);
      toast({ title: '草稿生成完成' });
    } catch (e: unknown) {
      toast({ title: '生成失败', description: (e as Error).message, variant: 'destructive' });
    } finally {
      setComposing(false);
    }
  }

  async function handleExport() {
    if (!draft) return;
    setExporting(true);
    try {
      const result = await api.drafts.export(draft.id, exportFormat);
      setExportContent(result.content);
      setLintPassed(result.lint_passed);
      setLintErrors(result.errors ?? []);
      if (!result.lint_passed) {
        toast({ title: '内容检查未通过', description: result.errors.join('；'), variant: 'destructive' });
      }
    } catch (e: unknown) {
      toast({ title: '导出失败', description: (e as Error).message, variant: 'destructive' });
    } finally {
      setExporting(false);
    }
  }

  function copyToClipboard() {
    if (!exportContent) return;
    navigator.clipboard.writeText(exportContent).then(() => {
      toast({ title: '已复制到剪贴板' });
    });
  }

  function downloadMd() {
    if (!exportContent) return;
    const blob = new Blob([exportContent], { type: 'text/plain' });
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = `draft_${exportFormat}_${Date.now()}.md`;
    a.click();
  }

  return (
    <div className="flex h-full gap-0">
      {/* LEFT: Picked Basket */}
      <div className="w-64 shrink-0 border-r flex flex-col">
        <div className="px-4 py-3 border-b">
          <h2 className="font-semibold text-sm">素材篮</h2>
          <p className="text-xs text-muted-foreground">{picked.length} 篇</p>
        </div>

        <div className="flex-1 overflow-auto p-2 space-y-2">
          {loadingPicked && <Loader2 className="h-4 w-4 animate-spin mx-auto mt-4 text-muted-foreground" />}
          {!loadingPicked && picked.length === 0 && (
            <p className="text-xs text-muted-foreground text-center mt-8 px-2">
              从 Feed 页点击 ⭐ 添加素材
            </p>
          )}
          {picked.map(p => (
            <div key={p.id} className="rounded-md border bg-card p-2 group relative">
              <div className="flex items-start justify-between gap-1">
                <div className="min-w-0">
                  <p className="text-xs font-medium leading-snug line-clamp-2">
                    {p.cn_title || p.original_title}
                  </p>
                  <div className="flex items-center gap-1 mt-1">
                    <span className="text-xs font-bold text-primary">{p.score_overall}</span>
                    <Badge variant="outline" className="text-[10px] px-1 py-0">{p.action}</Badge>
                    {p.pack_level === 'full' && (
                      <Badge variant="secondary" className="text-[10px] px-1 py-0">Full</Badge>
                    )}
                  </div>
                </div>
                <Button
                  size="icon"
                  variant="ghost"
                  className="h-6 w-6 opacity-0 group-hover:opacity-100 shrink-0"
                  onClick={() => removePicked(p.item_id)}
                >
                  <Trash2 className="h-3 w-3" />
                </Button>
              </div>
            </div>
          ))}
        </div>

        {/* Compose Controls */}
        <div className="border-t p-3 space-y-2">
          <div className="grid grid-cols-2 gap-1.5">
            <div>
              <label className="text-xs text-muted-foreground mb-1 block">策略</label>
              <Select value={strategy} onValueChange={setStrategy}>
                <SelectTrigger className="h-7 text-xs">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {Object.entries(STRATEGY_LABELS).map(([v, l]) => (
                    <SelectItem key={v} value={v}>{l}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div>
              <label className="text-xs text-muted-foreground mb-1 block">格式</label>
              <Select value={draftType} onValueChange={v => setDraftType(v as ExportFormat)}>
                <SelectTrigger className="h-7 text-xs">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {(Object.keys(FORMAT_LABELS) as ExportFormat[]).map(v => (
                    <SelectItem key={v} value={v}>{FORMAT_LABELS[v]}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
          </div>

          <Textarea
            placeholder="我的观点..."
            value={commentary}
            onChange={e => setCommentary(e.target.value)}
            className="text-xs min-h-[60px] resize-none"
          />

          <Button className="w-full h-8 text-xs" onClick={handleCompose} disabled={composing || picked.length === 0}>
            {composing ? <Loader2 className="h-3 w-3 animate-spin mr-1" /> : <Wand2 className="h-3 w-3 mr-1" />}
            生成草稿
          </Button>
        </div>
      </div>

      {/* CENTER: Draft Editor */}
      <div className="flex-1 flex flex-col min-w-0">
        <div className="px-4 py-3 border-b flex items-center justify-between">
          <h2 className="font-semibold text-sm">草稿编辑</h2>
          {draft && (
            <span className="text-xs text-muted-foreground">
              更新于 {new Date(draft.updated_at).toLocaleTimeString('zh-CN')}
            </span>
          )}
        </div>

        <div className="flex-1 overflow-auto p-4">
          {composing && (
            <div className="flex flex-col items-center justify-center h-full gap-3 text-muted-foreground">
              <Loader2 className="h-8 w-8 animate-spin" />
              <p className="text-sm">AI 正在生成草稿…</p>
            </div>
          )}
          {!composing && !draft && (
            <div className="flex items-center justify-center h-full text-muted-foreground">
              <p className="text-sm">添加素材后点击「生成草稿」</p>
            </div>
          )}
          {!composing && draft?.content_md && (
            <pre className="text-sm leading-relaxed whitespace-pre-wrap font-sans">{draft.content_md}</pre>
          )}
        </div>
      </div>

      {/* RIGHT: Export Preview */}
      <div className="w-72 shrink-0 border-l flex flex-col">
        <div className="px-4 py-3 border-b">
          <h2 className="font-semibold text-sm">导出预览</h2>
        </div>

        {/* Format Tabs */}
        <div className="flex border-b">
          {(Object.keys(FORMAT_LABELS) as ExportFormat[]).map(fmt => (
            <button
              key={fmt}
              onClick={() => setExportFormat(fmt)}
              className={cn(
                'flex-1 py-2 text-xs font-medium transition-colors',
                exportFormat === fmt
                  ? 'border-b-2 border-primary text-primary'
                  : 'text-muted-foreground hover:text-foreground'
              )}
            >
              {FORMAT_LABELS[fmt]}
            </button>
          ))}
        </div>

        <div className="flex-1 overflow-auto p-3">
          {!exportContent && (
            <div className="flex items-center justify-center h-full text-muted-foreground">
              <p className="text-xs text-center">生成草稿后点击导出</p>
            </div>
          )}
          {exportContent && (
            <div className="space-y-2">
              {/* Lint status */}
              {lintPassed !== null && (
                <div className={cn(
                  'flex items-center gap-1.5 rounded p-2 text-xs',
                  lintPassed ? 'bg-green-50 text-green-700' : 'bg-red-50 text-red-700'
                )}>
                  {lintPassed
                    ? <CheckCircle2 className="h-3.5 w-3.5" />
                    : <AlertCircle className="h-3.5 w-3.5" />}
                  {lintPassed ? '内容检查通过' : lintErrors[0] ?? '内容检查未通过'}
                </div>
              )}
              <pre className="text-xs leading-relaxed whitespace-pre-wrap font-sans bg-muted/30 rounded p-2">
                {exportContent}
              </pre>
            </div>
          )}
        </div>

        <div className="border-t p-3 space-y-2">
          <Button
            className="w-full h-8 text-xs"
            variant="outline"
            onClick={handleExport}
            disabled={!draft || exporting}
          >
            {exporting ? <Loader2 className="h-3 w-3 animate-spin mr-1" /> : null}
            导出 {FORMAT_LABELS[exportFormat]}
          </Button>
          {exportContent && (
            <div className="grid grid-cols-2 gap-1.5">
              <Button size="sm" variant="secondary" className="text-xs h-7" onClick={copyToClipboard}>
                <Copy className="h-3 w-3 mr-1" /> 复制
              </Button>
              <Button size="sm" variant="secondary" className="text-xs h-7" onClick={downloadMd}>
                <Download className="h-3 w-3 mr-1" /> 下载
              </Button>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
