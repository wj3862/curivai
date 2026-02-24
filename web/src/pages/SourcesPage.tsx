import { useState, useEffect, useRef } from 'react';
import { Plus, Trash2, Loader2, RefreshCw, Package, ToggleLeft, ToggleRight } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Badge } from '@/components/ui/badge';
import {
  Dialog, DialogContent, DialogHeader, DialogTitle,
} from '@/components/ui/dialog';
import { api, type Source, type RadarPack } from '@/lib/api';
import { toast } from '@/hooks/use-toast';
import { cn } from '@/lib/utils';

export function SourcesPage() {
  const [sources, setSources] = useState<Source[]>([]);
  const [packs, setPacks] = useState<RadarPack[]>([]);
  const [loading, setLoading] = useState(false);
  const [ingesting, setIngesting] = useState(false);
  const [showAdd, setShowAdd] = useState(false);
  const [showPacks, setShowPacks] = useState(false);
  const [newUrl, setNewUrl] = useState('');
  const [newTitle, setNewTitle] = useState('');
  const [adding, setAdding] = useState(false);
  const fileRef = useRef<HTMLInputElement>(null);

  async function loadSources() {
    setLoading(true);
    try {
      const [s, p] = await Promise.all([api.sources.list(), api.sources.listPacks()]);
      setSources(s);
      setPacks(p);
    } catch (e: unknown) {
      toast({ title: '加载失败', description: (e as Error).message, variant: 'destructive' });
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => { void loadSources(); }, []);

  async function addSource() {
    if (!newUrl.trim()) return;
    setAdding(true);
    try {
      await api.sources.add(newUrl.trim(), newTitle.trim() || undefined);
      toast({ title: '源添加成功' });
      setNewUrl('');
      setNewTitle('');
      setShowAdd(false);
      await loadSources();
    } catch (e: unknown) {
      toast({ title: '添加失败', description: (e as Error).message, variant: 'destructive' });
    } finally {
      setAdding(false);
    }
  }

  async function removeSource(id: string) {
    try {
      await api.sources.remove(id);
      await loadSources();
      toast({ title: '已删除' });
    } catch (e: unknown) {
      toast({ title: '删除失败', description: (e as Error).message, variant: 'destructive' });
    }
  }

  async function toggleSource(s: Source) {
    try {
      await api.sources.toggle(s.id, s.is_active === 0);
      await loadSources();
    } catch (e: unknown) {
      toast({ title: '操作失败', description: (e as Error).message, variant: 'destructive' });
    }
  }

  async function installPack(name: string) {
    try {
      const r = await api.sources.installPack(name);
      toast({ title: `源包安装成功`, description: `添加了 ${r.added} 个源` });
      await loadSources();
    } catch (e: unknown) {
      toast({ title: '安装失败', description: (e as Error).message, variant: 'destructive' });
    }
  }

  async function handleOpml(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    if (!file) return;
    const formData = new FormData();
    formData.append('file', file);
    try {
      const r = await api.sources.importOpml(formData) as { added: number };
      toast({ title: `OPML 导入成功`, description: `添加了 ${r.added} 个源` });
      await loadSources();
    } catch (e: unknown) {
      toast({ title: 'OPML 导入失败', description: (e as Error).message, variant: 'destructive' });
    } finally {
      if (fileRef.current) fileRef.current.value = '';
    }
  }

  async function handleIngest() {
    setIngesting(true);
    try {
      const r = await api.ingest.run(200);
      toast({ title: `抓取完成`, description: `新增 ${r.ingested} 篇，跳过 ${r.skipped} 篇` });
    } catch (e: unknown) {
      toast({ title: '抓取失败', description: (e as Error).message, variant: 'destructive' });
    } finally {
      setIngesting(false);
    }
  }

  const activeCount = sources.filter(s => s.is_active).length;

  return (
    <div className="flex flex-col h-full">
      {/* Toolbar */}
      <div className="flex items-center gap-2 px-4 py-3 border-b">
        <span className="text-sm text-muted-foreground">{activeCount}/{sources.length} 个源已启用</span>
        <div className="ml-auto flex items-center gap-2">
          <Button size="sm" variant="outline" onClick={() => setShowPacks(true)}>
            <Package className="h-4 w-4 mr-1" /> 安装源包
          </Button>
          <Button
            size="sm"
            variant="outline"
            onClick={() => fileRef.current?.click()}
          >
            导入 OPML
          </Button>
          <input ref={fileRef} type="file" accept=".opml,.xml" className="hidden" onChange={handleOpml} />
          <Button size="sm" variant="outline" onClick={() => setShowAdd(true)}>
            <Plus className="h-4 w-4 mr-1" /> 添加源
          </Button>
          <Button size="sm" onClick={handleIngest} disabled={ingesting}>
            {ingesting ? <Loader2 className="h-4 w-4 animate-spin mr-1" /> : <RefreshCw className="h-4 w-4 mr-1" />}
            立即抓取
          </Button>
        </div>
      </div>

      {/* Source List */}
      <div className="flex-1 overflow-auto p-4">
        {loading && (
          <div className="flex justify-center py-16">
            <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
          </div>
        )}

        {!loading && sources.length === 0 && (
          <div className="text-center py-16 text-muted-foreground space-y-2">
            <p className="text-lg">暂无订阅源</p>
            <p className="text-sm">点击「安装源包」快速开始</p>
          </div>
        )}

        {sources.length > 0 && (
          <div className="rounded-lg border overflow-hidden">
            <table className="w-full text-sm">
              <thead className="bg-muted/50">
                <tr>
                  <th className="text-left px-4 py-2 text-xs font-medium text-muted-foreground">名称</th>
                  <th className="text-left px-4 py-2 text-xs font-medium text-muted-foreground">域名</th>
                  <th className="text-left px-4 py-2 text-xs font-medium text-muted-foreground">源包</th>
                  <th className="text-left px-4 py-2 text-xs font-medium text-muted-foreground">最后抓取</th>
                  <th className="text-left px-4 py-2 text-xs font-medium text-muted-foreground">状态</th>
                  <th className="px-4 py-2" />
                </tr>
              </thead>
              <tbody className="divide-y">
                {sources.map(s => (
                  <tr key={s.id} className={cn('hover:bg-muted/30 transition-colors', !s.is_active && 'opacity-50')}>
                    <td className="px-4 py-2.5">
                      <div className="font-medium truncate max-w-[200px]">{s.title ?? s.url}</div>
                      <div className="text-xs text-muted-foreground truncate max-w-[200px]">{s.url}</div>
                    </td>
                    <td className="px-4 py-2.5 text-xs text-muted-foreground">{s.site_domain ?? '—'}</td>
                    <td className="px-4 py-2.5">
                      {s.pack_name && <Badge variant="secondary" className="text-xs">{s.pack_name}</Badge>}
                    </td>
                    <td className="px-4 py-2.5 text-xs text-muted-foreground">
                      {s.last_fetched_at ? new Date(s.last_fetched_at).toLocaleString('zh-CN') : '从未'}
                    </td>
                    <td className="px-4 py-2.5">
                      <button onClick={() => toggleSource(s)} className="text-muted-foreground hover:text-foreground transition-colors">
                        {s.is_active
                          ? <ToggleRight className="h-5 w-5 text-primary" />
                          : <ToggleLeft className="h-5 w-5" />}
                      </button>
                    </td>
                    <td className="px-4 py-2.5">
                      <Button
                        size="icon"
                        variant="ghost"
                        className="h-7 w-7 text-destructive hover:text-destructive"
                        onClick={() => removeSource(s.id)}
                      >
                        <Trash2 className="h-3.5 w-3.5" />
                      </Button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>

      {/* Add Source Dialog */}
      <Dialog open={showAdd} onOpenChange={setShowAdd}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>添加 RSS 源</DialogTitle>
          </DialogHeader>
          <div className="space-y-3">
            <Input
              placeholder="https://example.com/feed.xml"
              value={newUrl}
              onChange={e => setNewUrl(e.target.value)}
              onKeyDown={e => e.key === 'Enter' && addSource()}
            />
            <Input
              placeholder="显示名称（可选）"
              value={newTitle}
              onChange={e => setNewTitle(e.target.value)}
              onKeyDown={e => e.key === 'Enter' && addSource()}
            />
            <Button className="w-full" onClick={addSource} disabled={adding || !newUrl.trim()}>
              {adding ? <Loader2 className="h-4 w-4 animate-spin mr-1" /> : null}
              添加
            </Button>
          </div>
        </DialogContent>
      </Dialog>

      {/* Radar Packs Dialog */}
      <Dialog open={showPacks} onOpenChange={setShowPacks}>
        <DialogContent className="max-w-lg">
          <DialogHeader>
            <DialogTitle>安装源包</DialogTitle>
          </DialogHeader>
          <div className="space-y-3">
            {packs.map(p => (
              <div key={p.name} className="flex items-center justify-between rounded-lg border p-3">
                <div>
                  <p className="font-medium text-sm">{p.display_name}</p>
                  <p className="text-xs text-muted-foreground">{p.description}</p>
                  <p className="text-xs text-muted-foreground">{p.source_count} 个源</p>
                </div>
                <Button
                  size="sm"
                  variant={p.installed ? 'secondary' : 'default'}
                  onClick={() => !p.installed && installPack(p.name)}
                  disabled={p.installed}
                >
                  {p.installed ? '已安装' : '安装'}
                </Button>
              </div>
            ))}
          </div>
        </DialogContent>
      </Dialog>
    </div>
  );
}
