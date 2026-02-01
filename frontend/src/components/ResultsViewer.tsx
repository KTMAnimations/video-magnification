import { useEffect, useMemo } from 'react';
import type { Mode, ProcessingResponse } from '../types';
import { resolveBackendUrl } from '../api';
import { BVPChart } from './charts/BVPChart';
import { BPMTimeChart } from './charts/BPMTimeChart';
import { HRVFrequencyChart } from './charts/HRVFrequencyChart';
import { AudioWaveform } from './charts/AudioWaveform';
import { Card, CardHeader, CardTitle, CardContent } from './ui/card';
import { Button } from './ui/button';
import { Badge } from './ui/badge';
import { AlertTriangle, ArrowLeft, Download, XCircle, Play } from 'lucide-react';

function isNumber(v: unknown): v is number {
  return typeof v === 'number' && Number.isFinite(v);
}

function asRecord(v: unknown): Record<string, unknown> {
  if (v && typeof v === 'object' && !Array.isArray(v)) return v as Record<string, unknown>;
  return {};
}

interface Props {
  mode: Mode;
  result: ProcessingResponse;
  originalFile?: File;
  onReset: () => void;
}

export function ResultsViewer({ mode, result, originalFile, onReset }: Props) {
  if (!result.success) {
    return (
      <div className="p-6">
        <Card className="max-w-xl mx-auto border-destructive/30">
          <CardHeader>
            <CardTitle className="text-sm flex items-center gap-2 text-destructive">
              <XCircle className="h-4 w-4" />
              Error
            </CardTitle>
          </CardHeader>
          <CardContent>
            <div className="text-sm text-destructive mb-4">{result.error}</div>
            <Button variant="outline" size="sm" onClick={onReset}>
              <ArrowLeft className="h-3.5 w-3.5 mr-1.5" />
              Try Again
            </Button>
          </CardContent>
        </Card>
      </div>
    );
  }

  return (
    <div className="p-4 space-y-4">
      {/* Warnings */}
      {result.warnings.length > 0 && (
        <div className="max-w-4xl mx-auto space-y-2">
          {result.warnings.map((w, i) => (
            <Card key={i} className="border-amber-200 bg-amber-50">
              <CardContent className="flex items-start gap-2 py-3 text-xs text-amber-800">
                <AlertTriangle className="h-4 w-4 text-amber-500 shrink-0 mt-0.5" />
                <span>{w}</span>
              </CardContent>
            </Card>
          ))}
        </div>
      )}

      {/* Processing time */}
      <div className="max-w-4xl mx-auto text-right text-xs text-muted-foreground">
        Processed in {result.processing_time_seconds.toFixed(1)}s
      </div>

      {/* Mode-specific results */}
      {(mode === 'motion' || mode === 'color') && (
        <VideoComparisonResult result={result} originalFile={originalFile} />
      )}

      {(mode === 'heartrate' || mode === 'realtime') && (
        <VitalsResult result={result} mode={mode} />
      )}

      {mode === 'audio' && <AudioResult result={result} />}

      {/* Back button */}
      <div className="max-w-4xl mx-auto pt-2">
        <Button variant="outline" size="sm" onClick={onReset}>
          <ArrowLeft className="h-3.5 w-3.5 mr-1.5" />
          Process Another
        </Button>
      </div>
    </div>
  );
}

function VideoComparisonResult({ result, originalFile }: { result: ProcessingResponse; originalFile?: File }) {
  const originalUrl = useMemo(() => (originalFile ? URL.createObjectURL(originalFile) : null), [originalFile]);
  const processedUrl = result.output_url ? resolveBackendUrl(result.output_url) : undefined;

  useEffect(() => {
    return () => {
      if (originalUrl) URL.revokeObjectURL(originalUrl);
    };
  }, [originalUrl]);

  return (
    <div className="max-w-4xl mx-auto">
      <Card>
        <CardHeader className="pb-3">
          <CardTitle className="text-sm flex items-center gap-2">
            <Play className="h-4 w-4 text-primary" />
            Video Comparison
          </CardTitle>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="grid grid-cols-2 gap-4">
            {/* Original */}
            <div>
              <div className="text-xs text-muted-foreground mb-1.5">Original</div>
              <div className="dark-panel-deep p-1">
                {originalUrl ? (
                  <video src={originalUrl} controls className="w-full rounded" />
                ) : (
                  <div className="aspect-video rounded flex items-center justify-center text-slate-400 text-xs">
                    No original
                  </div>
                )}
              </div>
            </div>
            {/* Processed */}
            <div>
              <div className="text-xs text-muted-foreground mb-1.5">Magnified</div>
              <div className="dark-panel-deep p-1">
                {processedUrl ? (
                  <video src={processedUrl} controls className="w-full rounded" />
                ) : (
                  <div className="aspect-video rounded flex items-center justify-center text-slate-400 text-xs">
                    No output
                  </div>
                )}
              </div>
            </div>
          </div>
          {processedUrl && (
            <Button variant="outline" size="sm" asChild>
              <a href={processedUrl} download className="gap-1.5">
                <Download className="h-3.5 w-3.5" />
                Download Magnified Video
              </a>
            </Button>
          )}
        </CardContent>
      </Card>
    </div>
  );
}

function VitalsResult({ result }: { result: ProcessingResponse; mode: Mode }) {
  const data = asRecord(result.data);
  const bpmVal = data.bpm;
  const bvp = Array.isArray(data.bvp) ? data.bvp.filter(isNumber) : [];
  const hrv = asRecord(data.hrv);
  const times = Array.isArray(data.times) ? data.times.filter(isNumber) : [];
  const bpmArray = Array.isArray(bpmVal) ? bpmVal.filter(isNumber) : [];
  const singleBpm = isNumber(bpmVal) ? bpmVal : (isNumber(data.bpm_mean) ? data.bpm_mean : 0);
  const confidence = isNumber(data.confidence) ? data.confidence : undefined;
  const fps = isNumber(data.fps) ? data.fps : undefined;
  const nFrames = isNumber(data.n_frames) ? data.n_frames : undefined;
  const method = typeof data.method === 'string' ? data.method : undefined;
  const compareRows = Array.isArray(data.compare)
    ? data.compare
        .map(asRecord)
        .map((r, i) => ({
          idx: i,
          method: typeof r.method === 'string' ? r.method : '',
          bpm: isNumber(r.bpm) ? r.bpm : undefined,
          confidence: isNumber(r.confidence) ? r.confidence : undefined,
          ok: typeof r.ok === 'boolean' ? r.ok : true,
          error: typeof r.error === 'string' ? r.error : undefined,
        }))
        .filter((r) => r.method.length > 0)
        .sort((a, b) => {
          const ac = a.confidence ?? -1;
          const bc = b.confidence ?? -1;
          if (bc !== ac) return bc - ac;
          return a.idx - b.idx;
        })
    : [];
  const hrvSdnn = isNumber(hrv.sdnn) ? hrv.sdnn : undefined;
  const hrvRmssd = isNumber(hrv.rmssd) ? hrv.rmssd : undefined;
  const hrvLfPower = isNumber(hrv.lf_power) ? hrv.lf_power : undefined;
  const hrvHfPower = isNumber(hrv.hf_power) ? hrv.hf_power : undefined;
  const hrvLfHfRatio = isNumber(hrv.lf_hf_ratio) ? hrv.lf_hf_ratio : undefined;
  const hrvPsdFreqs = Array.isArray(hrv.psd_freqs) ? hrv.psd_freqs.filter(isNumber) : [];
  const hrvPsdPower = Array.isArray(hrv.psd_power) ? hrv.psd_power.filter(isNumber) : [];
  const psdFreqs = Array.isArray(data.psd_freqs) ? data.psd_freqs.filter(isNumber) : [];
  const psdPower = Array.isArray(data.psd_power) ? data.psd_power.filter(isNumber) : [];

  return (
    <div className="max-w-4xl mx-auto space-y-4">
      {/* Big BPM readout */}
      <Card>
        <CardHeader className="pb-2">
          <div className="flex items-center justify-between">
            <CardTitle className="text-sm flex items-center gap-2">
              <span className="text-rose-500">&#9829;</span>
              Heart Rate
            </CardTitle>
            <div className="flex items-center gap-2">
              {compareRows.length > 0 && (
                <Badge variant="outline" className="text-xs">Compare</Badge>
              )}
              {method && (
                <Badge variant="secondary" className="text-xs">{method}</Badge>
              )}
            </div>
          </div>
        </CardHeader>
        <CardContent>
          <div className="flex items-center justify-center gap-8 py-4">
            <div className="text-center">
              <div className="text-5xl font-bold text-rose-500">
                {Math.round(singleBpm)}
              </div>
              <div className="text-xs text-muted-foreground mt-1">BPM</div>
            </div>
            {confidence !== undefined && (
              <div className="text-center">
                <div className="text-2xl font-semibold text-foreground">
                  {(confidence * 100).toFixed(0)}%
                </div>
                <div className="text-xs text-muted-foreground mt-1">Confidence</div>
              </div>
            )}
            {fps !== undefined && (
              <div className="text-center">
                <div className="text-lg text-foreground">{fps.toFixed(0)}</div>
                <div className="text-xs text-muted-foreground mt-1">FPS</div>
              </div>
            )}
            {nFrames !== undefined && (
              <div className="text-center">
                <div className="text-lg text-foreground">{nFrames}</div>
                <div className="text-xs text-muted-foreground mt-1">Frames</div>
              </div>
            )}
          </div>
        </CardContent>
      </Card>

      {/* Method comparison */}
      {compareRows.length > 0 && (
        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-sm flex items-center gap-2">
              <span className="text-slate-500">&#8801;</span>
              Method Comparison
            </CardTitle>
          </CardHeader>
          <CardContent className="space-y-2">
            <div className="grid grid-cols-3 gap-2 text-xs font-medium text-muted-foreground border-b pb-1 px-2">
              <div>Method</div>
              <div className="text-right">BPM</div>
              <div className="text-right">Confidence</div>
            </div>
            <div className="space-y-1">
              {compareRows.map((r) => {
                const isBest = method !== undefined && r.method === method;
                return (
                  <div
                    key={r.method}
                    className={`grid grid-cols-3 gap-2 py-1 text-xs items-center px-2 rounded ${isBest ? 'bg-emerald-50/60 dark:bg-emerald-900/20' : ''}`}
                  >
                    <div className="flex items-center gap-2 min-w-0">
                      {isBest && <Badge variant="secondary" className="text-[10px]">Best</Badge>}
                      <span className="font-mono truncate">{r.method}</span>
                      {!r.ok && (
                        <span className="text-destructive truncate">
                          {r.error ?? 'failed'}
                        </span>
                      )}
                    </div>
                    <div className="text-right tabular-nums">
                      {r.bpm !== undefined ? r.bpm.toFixed(1) : '—'}
                    </div>
                    <div className="text-right tabular-nums">
                      {r.confidence !== undefined ? `${(r.confidence * 100).toFixed(0)}%` : '—'}
                    </div>
                  </div>
                );
              })}
            </div>
          </CardContent>
        </Card>
      )}

      {/* HRV metrics */}
      {hrvSdnn !== undefined && hrvRmssd !== undefined && hrvLfPower !== undefined && hrvLfHfRatio !== undefined && (
        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-sm flex items-center gap-2">
              <span className="text-teal-500">&#9632;</span>
              HRV Metrics
            </CardTitle>
          </CardHeader>
          <CardContent>
            <div className="grid grid-cols-4 gap-4 text-center py-2">
              <div>
                <div className="text-xl font-bold text-teal-600">{hrvSdnn.toFixed(1)}</div>
                <div className="text-xs text-muted-foreground">SDNN (ms)</div>
              </div>
              <div>
                <div className="text-xl font-bold text-teal-600">{hrvRmssd.toFixed(1)}</div>
                <div className="text-xs text-muted-foreground">RMSSD (ms)</div>
              </div>
              <div>
                <div className="text-xl font-bold text-teal-600">{hrvLfPower.toFixed(1)}</div>
                <div className="text-xs text-muted-foreground">LF Power</div>
              </div>
              <div>
                <div className="text-xl font-bold text-teal-600">{hrvLfHfRatio.toFixed(2)}</div>
                <div className="text-xs text-muted-foreground">LF/HF Ratio</div>
              </div>
            </div>
          </CardContent>
        </Card>
      )}

      {/* Charts */}
      {bvp.length > 0 && <BVPChart bvp={bvp} />}
      {bpmArray.length > 0 && <BPMTimeChart bpmValues={bpmArray} times={times.length > 0 ? times : undefined} />}
      {hrvPsdFreqs.length > 0 && hrvPsdPower.length > 0 && (
        <HRVFrequencyChart freqs={hrvPsdFreqs} power={hrvPsdPower} lfPower={hrvLfPower} hfPower={hrvHfPower} />
      )}
      {psdFreqs.length > 0 && psdPower.length > 0 && hrvPsdFreqs.length === 0 && (
        <HRVFrequencyChart freqs={psdFreqs} power={psdPower} />
      )}
    </div>
  );
}

function AudioResult({ result }: { result: ProcessingResponse }) {
  const data = asRecord(result.data);
  const waveform = Array.isArray(data.waveform) ? data.waveform.filter(isNumber) : [];
  const fps = isNumber(data.fps) ? data.fps : undefined;
  const nFrames = isNumber(data.n_frames) ? data.n_frames : undefined;
  const durationSeconds = isNumber(data.duration_seconds) ? data.duration_seconds : undefined;
  const maxRecoverable = isNumber(data.max_recoverable_freq_hz) ? data.max_recoverable_freq_hz : undefined;
  const audioUrl = result.output_url ? resolveBackendUrl(result.output_url) : undefined;

  return (
    <div className="max-w-4xl mx-auto space-y-4">
      {result.output_url && (
        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-sm flex items-center gap-2">
              <span className="text-purple-500">&#8767;</span>
              Recovered Audio
            </CardTitle>
          </CardHeader>
          <CardContent className="space-y-3">
            <div className="dark-panel p-3">
              <audio controls src={audioUrl} className="w-full" />
            </div>
            <div className="flex flex-wrap gap-2">
              {fps !== undefined && <Badge variant="secondary">FPS: {fps.toFixed(0)}</Badge>}
              {nFrames !== undefined && <Badge variant="secondary">Frames: {nFrames}</Badge>}
              {durationSeconds !== undefined && <Badge variant="secondary">Duration: {durationSeconds.toFixed(1)}s</Badge>}
              {maxRecoverable !== undefined && <Badge variant="secondary">Max freq: {maxRecoverable.toFixed(1)} Hz</Badge>}
            </div>
            <Button variant="outline" size="sm" asChild>
              <a href={audioUrl} download className="gap-1.5">
                <Download className="h-3.5 w-3.5" />
                Download Audio
              </a>
            </Button>
          </CardContent>
        </Card>
      )}

      {waveform.length > 0 && (
        <AudioWaveform waveform={waveform} durationSeconds={durationSeconds} />
      )}
    </div>
  );
}
