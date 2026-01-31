import type { Mode, HealthData } from '../types';
import { MODE_CONFIGS } from '../types';

interface Props {
  activeMode: Mode;
  onModeChange: (mode: Mode) => void;
  health: HealthData | null;
}

const MODES: Mode[] = ['motion', 'color', 'heartrate', 'realtime', 'audio'];

export function Sidebar({ activeMode, onModeChange, health }: Props) {
  return (
    <nav className="w-48 border-r border-[var(--color-border)] bg-[var(--color-bg-secondary)] flex flex-col">
      <div className="px-3 py-2 text-[0.6rem] uppercase tracking-widest text-[var(--color-text-dim)] border-b border-[var(--color-border)]">
        Processing Mode
      </div>
      {MODES.map((mode) => {
        const config = MODE_CONFIGS[mode];
        const backend = health?.backends?.[config.backendKey];
        const available = backend?.available ?? false;
        const isActive = activeMode === mode;

        return (
          <button
            key={mode}
            onClick={() => available && onModeChange(mode)}
            disabled={!available}
            title={!available ? `${config.label} backend not installed or failed to load` : undefined}
            className={`text-left px-3 py-2.5 border-b border-[var(--color-border)] transition-all text-[0.72rem] ${
              !available
                ? 'opacity-35 cursor-not-allowed border-l-2 border-l-transparent text-[var(--color-text-dim)]'
                : isActive
                  ? 'bg-[var(--color-bg-hover)] text-[var(--color-accent)] border-l-2 border-l-[var(--color-accent)]'
                  : 'text-[var(--color-text-secondary)] hover:bg-[var(--color-bg-hover)] border-l-2 border-l-transparent'
            }`}
          >
            <div className="flex items-center gap-2">
              <span className="text-sm">{config.icon}</span>
              <span>{config.label}</span>
              {!available && (
                <span className="status-led offline ml-auto" title="Backend unavailable" />
              )}
            </div>
            <div className="text-[0.58rem] text-[var(--color-text-dim)] mt-0.5 leading-tight">
              {!available ? 'Backend not available' : config.description}
            </div>
          </button>
        );
      })}
    </nav>
  );
}
