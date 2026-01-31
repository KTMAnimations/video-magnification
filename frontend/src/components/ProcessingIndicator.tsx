import { useState, useEffect } from 'react';

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
    <div className="flex flex-col items-center justify-center py-16 gap-6">
      {/* Radar sweep */}
      <div className="relative w-32 h-32">
        <div className="absolute inset-0 rounded-full border border-[var(--color-border)]" />
        <div className="absolute inset-4 rounded-full border border-[var(--color-border)]" />
        <div className="absolute inset-8 rounded-full border border-[var(--color-border)]" />
        <div className="absolute inset-0 flex items-center justify-center">
          <div
            className="radar-sweep"
            style={{
              width: '50%',
              height: 2,
              background: 'linear-gradient(90deg, transparent, var(--color-accent))',
              transformOrigin: 'left center',
              position: 'absolute',
              left: '50%',
              top: '50%',
            }}
          />
        </div>
        <div className="absolute inset-0 rounded-full" style={{
          background: 'conic-gradient(from 0deg, transparent 0deg, var(--color-accent-glow) 30deg, transparent 60deg)',
          animation: 'radar-sweep 2s linear infinite',
        }} />
      </div>

      <div className="text-center">
        <div className="text-[var(--color-accent)] text-2xl font-bold tracking-widest glow-text">
          {fmt(elapsed)}
        </div>
        <div className="text-[0.65rem] text-[var(--color-text-dim)] uppercase tracking-widest mt-2 pulse-glow">
          Processing...
        </div>
      </div>
    </div>
  );
}
