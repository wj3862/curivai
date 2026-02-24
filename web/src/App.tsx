import { useState, useEffect, useCallback } from 'react';
import { Rss, BookOpen, Layers, Activity } from 'lucide-react';
import { PersonaSwitcher } from './components/PersonaSwitcher';
import { CompareModal } from './components/CompareModal';
import { FeedPage } from './pages/FeedPage';
import { StudioPage } from './pages/StudioPage';
import { SourcesPage } from './pages/SourcesPage';
import { Toaster } from './components/ui/toaster';
import { api, type Persona } from './lib/api';
import { toast } from './hooks/use-toast';
import { cn } from './lib/utils';

type Page = 'feed' | 'studio' | 'sources';

const NAV: { id: Page; label: string; icon: React.ReactNode }[] = [
  { id: 'feed', label: '发现', icon: <Rss className="h-4 w-4" /> },
  { id: 'studio', label: '创作', icon: <BookOpen className="h-4 w-4" /> },
  { id: 'sources', label: '管理', icon: <Layers className="h-4 w-4" /> },
];

export default function App() {
  const [personas, setPersonas] = useState<Persona[]>([]);
  const [activePersona, setActivePersona] = useState<string>('');
  const [page, setPage] = useState<Page>('feed');
  const [compareItemId, setCompareItemId] = useState<string | null>(null);
  const [pickedIds, setPickedIds] = useState<Set<string>>(new Set());
  const [status, setStatus] = useState<string>('');

  useEffect(() => {
    api.personas.list()
      .then(list => {
        setPersonas(list);
        if (list.length > 0) setActivePersona(list[0].name);
      })
      .catch(e => toast({ title: '加载 Persona 失败', description: (e as Error).message, variant: 'destructive' }));
  }, []);

  // Reset picked when persona changes
  useEffect(() => {
    setPickedIds(new Set());
  }, [activePersona]);

  async function handlePickItem(itemId: string) {
    if (pickedIds.has(itemId)) return;
    const prev = new Set(pickedIds);
    setPickedIds(new Set([...pickedIds, itemId]));
    setStatus('正在升级为全量评分…');
    try {
      await api.picked.add(activePersona, itemId);
      setStatus('');
      toast({ title: '已加入素材篮', description: '全量评分升级完成' });
    } catch (e: unknown) {
      setPickedIds(prev);
      setStatus('');
      toast({ title: '加入失败', description: (e as Error).message, variant: 'destructive' });
    }
  }

  const handlePickedChange = useCallback((ids: Set<string>) => {
    setPickedIds(ids);
  }, []);

  return (
    <div className="h-screen flex flex-col bg-background text-foreground">
      {/* Top bar */}
      <header className="flex items-center border-b shrink-0">
        {/* Logo */}
        <div className="flex items-center gap-2 px-4 py-3 border-r shrink-0">
          <span className="text-lg font-bold tracking-tight">CurivAI</span>
        </div>

        {/* Persona Switcher */}
        {personas.length > 0 && (
          <div className="flex-1 min-w-0">
            <PersonaSwitcher
              personas={personas}
              active={activePersona}
              onChange={name => {
                setActivePersona(name);
                setPage('feed');
              }}
            />
          </div>
        )}

        {/* Status indicator */}
        {status && (
          <div className="flex items-center gap-1.5 px-4 text-xs text-muted-foreground shrink-0">
            <Activity className="h-3 w-3 animate-pulse" />
            {status}
          </div>
        )}
      </header>

      {/* Nav + Content */}
      <div className="flex flex-1 min-h-0">
        {/* Left Nav */}
        <nav className="w-14 border-r flex flex-col items-center pt-4 gap-1 shrink-0">
          {NAV.map(n => (
            <button
              key={n.id}
              onClick={() => setPage(n.id)}
              title={n.label}
              className={cn(
                'flex flex-col items-center gap-1 w-10 h-10 rounded-md transition-colors',
                page === n.id
                  ? 'bg-primary text-primary-foreground'
                  : 'text-muted-foreground hover:bg-accent hover:text-accent-foreground'
              )}
            >
              {n.icon}
            </button>
          ))}
        </nav>

        {/* Main Content */}
        <main className="flex-1 min-w-0 overflow-hidden">
          {page === 'feed' && activePersona && (
            <FeedPage
              persona={activePersona}
              pickedIds={pickedIds}
              onPick={handlePickItem}
              onCompare={setCompareItemId}
            />
          )}
          {page === 'studio' && activePersona && (
            <StudioPage
              persona={activePersona}
              pickedIds={pickedIds}
              onPickedChange={handlePickedChange}
            />
          )}
          {page === 'sources' && <SourcesPage />}

          {!activePersona && (
            <div className="flex items-center justify-center h-full text-muted-foreground">
              <p>正在加载…</p>
            </div>
          )}
        </main>
      </div>

      {/* Compare Modal */}
      <CompareModal itemId={compareItemId} onClose={() => setCompareItemId(null)} />

      {/* Toast */}
      <Toaster />
    </div>
  );
}
