import { cn } from '@/lib/utils';
import type { Persona } from '@/lib/api';

interface Props {
  personas: Persona[];
  active: string;
  onChange: (name: string) => void;
}

export function PersonaSwitcher({ personas, active, onChange }: Props) {
  return (
    <div className="flex items-center border-b border-border bg-card px-4">
      {personas.map(p => (
        <button
          key={p.name}
          onClick={() => onChange(p.name)}
          className={cn(
            'flex items-center gap-1.5 px-4 py-3 text-sm font-medium border-b-2 transition-colors whitespace-nowrap',
            active === p.name
              ? 'border-primary text-primary'
              : 'border-transparent text-muted-foreground hover:text-foreground hover:border-border'
          )}
        >
          {p.icon && <span>{p.icon}</span>}
          <span>{p.display_name}</span>
        </button>
      ))}
    </div>
  );
}
