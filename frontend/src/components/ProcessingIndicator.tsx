import { useState, useEffect } from 'react';
import type { JobProgressResponse } from '../types';
import { Progress } from './ui/progress';

interface Props {
  progress: {
    uploadPercent: number;
    backend: JobProgressResponse | null;
  } | null;
}

function humanizeStage(stage: string): string {
  return stage
    .replace(/[_-]+/g, ' ')
    .trim()
    .replace(/\b\w/g, (c) => c.toUpperCase());
}

export function ProcessingIndicator({ progress }: Props) {
  const [now, setNow] = useState(() => Date.now());
  const [mountedAt] = useState(() => Date.now());

  useEffect(() => {
    const id = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(id);
  }, []);

  const fmt = (s: number) => {
    const h = Math.floor(s / 3600);
    const m = Math.floor((s % 3600) / 60);
    const sec = s % 60;
    return `${h.toString().padStart(2, '0')}:${m.toString().padStart(2, '0')}:${sec.toString().padStart(2, '0')}`;
  };

  const uploadPercent = Math.min(100, Math.max(0, progress?.uploadPercent ?? 0));
  const backend = progress?.backend ?? null;
  const backendPercentFromCounts =
    typeof backend?.current === 'number' && typeof backend?.total === 'number' && Number.isFinite(backend.current) && Number.isFinite(backend.total) && backend.total > 0
      ? Math.min(100, Math.max(0, (backend.current / backend.total) * 100))
      : null;
  const backendPercent =
    typeof backend?.percent === 'number' && Number.isFinite(backend.percent)
      ? Math.min(100, Math.max(0, backend.percent))
      : backendPercentFromCounts;
  const backendLabel = backend?.message || (backend?.stage ? humanizeStage(backend.stage) : 'Processing');
  const backendDetail =
    typeof backend?.current === 'number' && typeof backend?.total === 'number' && backend.total > 0
      ? `${backend.current}/${backend.total}`
      : backend?.status === 'not_found'
        ? 'Starting…'
        : backend?.status || '';

  const elapsedSeconds = (() => {
    const startedAt = backend?.started_at;
    const updatedAt = backend?.updated_at;
    if (typeof startedAt === 'number' && Number.isFinite(startedAt)) {
      const baseEnd = typeof updatedAt === 'number' && Number.isFinite(updatedAt) ? updatedAt : startedAt;
      const base = Math.max(0, baseEnd - startedAt);
      const sinceUpdate = typeof updatedAt === 'number' && Number.isFinite(updatedAt) ? Math.max(0, now / 1000 - updatedAt) : 0;
      return Math.floor(base + sinceUpdate);
    }
    return Math.floor(Math.max(0, (now - mountedAt) / 1000));
  })();

  const etaSeconds =
    backendPercent !== null && backendPercent >= 1 && backendPercent < 100 && elapsedSeconds > 0
      ? Math.max(0, Math.round((elapsedSeconds * (100 - backendPercent)) / backendPercent))
      : null;

  const etaLabel = etaSeconds !== null ? fmt(etaSeconds) : null;

  return (
    <div className="flex flex-col items-center justify-center py-20 gap-6 px-4">
      <div className="w-full max-w-md space-y-6">
        <div className="text-center">
          <div className="text-2xl font-semibold text-foreground tabular-nums">
            {fmt(elapsedSeconds)}
          </div>
          <div className="text-xs text-muted-foreground mt-2">
            {backendLabel}
          </div>
          {etaLabel && backend?.status !== 'complete' && backend?.status !== 'error' && (
            <div className="text-xs text-muted-foreground mt-1 tabular-nums">
              ETA {etaLabel}
            </div>
          )}
          {backend?.error && (
            <div className="text-xs text-destructive mt-2">
              {backend.error}
            </div>
          )}
        </div>

        <div className="space-y-2">
          <div className="flex items-center justify-between text-xs">
            <span className="text-muted-foreground">Upload</span>
            <span className="tabular-nums">{Math.round(uploadPercent)}%</span>
          </div>
          <Progress value={uploadPercent} />
        </div>

        <div className="space-y-2">
          <div className="flex items-center justify-between text-xs">
            <span className="text-muted-foreground">Processing</span>
            <span className="tabular-nums">
              {backendPercent !== null
                ? `${Math.round(backendPercent)}%${etaLabel ? ` • ${etaLabel}` : ''}`
                : backendDetail}
            </span>
          </div>
          <Progress value={backendPercent ?? undefined} />
        </div>
      </div>
    </div>
  );
}
