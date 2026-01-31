import type { HealthData } from '../types';

interface Props {
  health: HealthData | null;
  loading: boolean;
}

export function StatusBar({ health, loading }: Props) {
  const availableCount = health
    ? Object.values(health.backends).filter((b) => b.available).length
    : 0;
  const totalCount = health ? Object.keys(health.backends).length : 0;

  return (
    <footer className="flex items-center justify-between px-4 py-1.5 border-t border-[var(--color-border)] bg-[var(--color-bg-secondary)] text-[0.6rem]">
      <div className="flex items-center gap-3">
        <span className={`status-led ${health ? 'online' : loading ? 'unknown' : 'offline'}`} />
        <span className="text-[var(--color-text-dim)] uppercase">
          {health ? `API Online` : loading ? 'Connecting...' : 'API Offline'}
        </span>
        {health && (
          <span className="text-[var(--color-text-dim)]">
            {availableCount}/{totalCount} backends ready
          </span>
        )}
      </div>
      <div className="text-[var(--color-text-dim)]">
        VMAG v0.1.0
      </div>
    </footer>
  );
}
