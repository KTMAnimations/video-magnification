import { useState, useEffect } from 'react';
import { Loader2 } from 'lucide-react';

export function ProcessingIndicator() {
  const [elapsed, setElapsed] = useState(0);

  useEffect(() => {
    const id = setInterval(() => setElapsed((e) => e + 1), 1000);
    return () => clearInterval(id);
  }, []);

  const fmt = (s: number) => {
    const h = Math.floor(s / 3600);
    const m = Math.floor((s % 3600) / 60);
    const sec = s % 60;
    return `${h.toString().padStart(2, '0')}:${m.toString().padStart(2, '0')}:${sec.toString().padStart(2, '0')}`;
  };

  return (
    <div className="flex flex-col items-center justify-center py-20 gap-6">
      <Loader2 className="h-12 w-12 text-primary animate-spin" />
      <div className="text-center">
        <div className="text-2xl font-semibold text-foreground tabular-nums">
          {fmt(elapsed)}
        </div>
        <div className="text-xs text-muted-foreground mt-2">
          Processing...
        </div>
      </div>
    </div>
  );
}
