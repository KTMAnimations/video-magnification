import type { HealthData } from '../types';
import { Badge } from './ui/badge';
import { Activity } from 'lucide-react';

interface Props {
  health: HealthData | null;
}

export function Header({ health }: Props) {
  const availableCount = health
    ? Object.values(health.backends).filter((b) => b.available).length
    : 0;
  const totalCount = health ? Object.keys(health.backends).length : 0;

  return (
    <header className="flex items-center justify-between px-4 py-2 bg-card border-b">
      <div className="flex items-center gap-2.5">
        <Activity className="h-5 w-5 text-primary" />
        <span className="font-semibold text-sm tracking-tight">VMAG</span>
        <span className="text-xs text-muted-foreground hidden sm:inline">Video Magnification</span>
      </div>
      <div>
        {health ? (
          <Badge variant={availableCount > 0 ? 'default' : 'destructive'} className="text-xs">
            {availableCount}/{totalCount} backends
          </Badge>
        ) : (
          <Badge variant="destructive" className="text-xs">Offline</Badge>
        )}
      </div>
    </header>
  );
}
