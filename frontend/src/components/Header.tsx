import type { HealthData } from '../types';

interface Props {
  health: HealthData | null;
}

export function Header({ health }: Props) {
  return (
    <header className="flex items-center justify-between px-4 py-2 border-b border-[var(--color-border)] bg-[var(--color-bg-secondary)]">
      <div className="flex items-center gap-3">
        <div className="text-[var(--color-accent)] text-lg font-bold tracking-wider">
          &#9670; VMAG
        </div>
        <div className="text-[var(--color-text-dim)] text-[0.6rem] uppercase tracking-widest">
          Video Magnification Laboratory
        </div>
      </div>
      <div className="flex items-center gap-3">
        {health?.backends &&
          Object.entries(health.backends).map(([key, info]) => (
            <div key={key} className="flex items-center gap-1.5 text-[0.6rem]" title={info.error || info.label}>
              <span className={`status-led ${info.available ? 'online' : 'offline'}`} />
              <span className="text-[var(--color-text-dim)] uppercase">{key}</span>
            </div>
          ))}
        {!health && (
          <span className="text-[0.6rem] text-[var(--color-text-dim)]">
            <span className="status-led unknown" /> API OFFLINE
          </span>
        )}
      </div>
    </header>
  );
}
