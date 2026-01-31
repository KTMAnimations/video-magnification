import type { Mode, ProcessingResponse } from '../types';
import { BVPChart } from './charts/BVPChart';
import { BPMTimeChart } from './charts/BPMTimeChart';
import { HRVFrequencyChart } from './charts/HRVFrequencyChart';
import { AudioWaveform } from './charts/AudioWaveform';

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
        <div className="panel max-w-xl mx-auto">
          <div className="panel-header">
            <span className="text-[var(--color-danger)]">&#10005;</span>
            Error
          </div>
          <div className="p-4">
            <div className="text-[0.75rem] text-[var(--color-danger)] mb-3">{result.error}</div>
            <button onClick={onReset} className="btn-secondary">
              &#8592; Try Again
            </button>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="p-4 space-y-4">
      {/* Warnings */}
      {result.warnings.length > 0 && (
        <div className="max-w-4xl mx-auto">
          {result.warnings.map((w, i) => (
            <div key={i} className="text-[0.7rem] text-[var(--color-warning)] p-2 border border-[var(--color-warning)] border-opacity-30 rounded bg-[var(--color-warning)] bg-opacity-5 mb-2">
              <span className="mr-1">&#9888;</span> {w}
            </div>
          ))}
        </div>
      )}

      {/* Processing time */}
      <div className="max-w-4xl mx-auto text-right text-[0.6rem] text-[var(--color-text-dim)]">
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
        <button onClick={onReset} className="btn-secondary">
          &#8592; Process Another
        </button>
      </div>
    </div>
  );
}

function VideoComparisonResult({ result, originalFile }: { result: ProcessingResponse; originalFile?: File }) {
  const originalUrl = originalFile ? URL.createObjectURL(originalFile) : null;
  const processedUrl = result.output_url;

  return (
    <div className="max-w-4xl mx-auto">
      <div className="panel">
        <div className="panel-header">
          <span className="text-[var(--color-accent)]">&#9654;</span>
          Video Comparison
        </div>
        <div className="p-4 grid grid-cols-2 gap-4">
          {/* Original */}
          <div>
            <div className="text-[0.6rem] text-[var(--color-text-dim)] uppercase mb-1">Original</div>
            {originalUrl ? (
              <video src={originalUrl} controls className="w-full rounded border border-[var(--color-border)]" />
            ) : (
              <div className="aspect-video bg-[var(--color-bg-secondary)] rounded flex items-center justify-center text-[var(--color-text-dim)] text-[0.7rem]">
                No original
              </div>
            )}
          </div>
          {/* Processed */}
          <div>
            <div className="text-[0.6rem] text-[var(--color-text-dim)] uppercase mb-1">Magnified</div>
            {processedUrl ? (
              <video src={processedUrl} controls className="w-full rounded border border-[var(--color-accent)] border-opacity-30" />
            ) : (
              <div className="aspect-video bg-[var(--color-bg-secondary)] rounded flex items-center justify-center text-[var(--color-text-dim)] text-[0.7rem]">
                No output
              </div>
            )}
          </div>
        </div>
        {processedUrl && (
          <div className="px-4 pb-3">
            <a
              href={processedUrl}
              download
              className="btn-secondary inline-flex items-center gap-1 text-[0.65rem]"
            >
              &#8615; Download Magnified Video
            </a>
          </div>
        )}
      </div>
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
      <div className="panel">
        <div className="panel-header">
          <span style={{ color: 'var(--color-heart)' }}>&#9829;</span>
          Heart Rate
          {method && <span className="ml-auto text-[var(--color-text-dim)]">{method}</span>}
        </div>
        <div className="p-6 flex items-center justify-center gap-6">
          <div className="text-center">
            <div className="text-5xl font-bold" style={{ color: 'var(--color-heart)' }}>
              {Math.round(singleBpm)}
            </div>
            <div className="text-[0.6rem] text-[var(--color-text-dim)] uppercase mt-1">BPM</div>
          </div>
          {confidence !== undefined && (
            <div className="text-center">
              <div className="text-2xl font-bold text-[var(--color-text-secondary)]">
                {(confidence * 100).toFixed(0)}%
              </div>
              <div className="text-[0.6rem] text-[var(--color-text-dim)] uppercase mt-1">Confidence</div>
            </div>
          )}
          {fps !== undefined && (
            <div className="text-center">
              <div className="text-lg text-[var(--color-text-secondary)]">{fps.toFixed(0)}</div>
              <div className="text-[0.6rem] text-[var(--color-text-dim)] uppercase mt-1">FPS</div>
            </div>
          )}
          {nFrames !== undefined && (
            <div className="text-center">
              <div className="text-lg text-[var(--color-text-secondary)]">{nFrames}</div>
              <div className="text-[0.6rem] text-[var(--color-text-dim)] uppercase mt-1">Frames</div>
            </div>
          )}
        </div>
      </div>

      {/* HRV metrics (from pyVHR) */}
      {hrvSdnn !== undefined && hrvRmssd !== undefined && hrvLfPower !== undefined && hrvLfHfRatio !== undefined && (
        <div className="panel">
          <div className="panel-header">
            <span className="text-[var(--color-accent)]">&#9632;</span>
            HRV Metrics
          </div>
          <div className="p-4 grid grid-cols-4 gap-4 text-center">
            <div>
              <div className="text-xl font-bold text-[var(--color-accent)]">{hrvSdnn.toFixed(1)}</div>
              <div className="text-[0.6rem] text-[var(--color-text-dim)] uppercase">SDNN (ms)</div>
            </div>
            <div>
              <div className="text-xl font-bold text-[var(--color-accent)]">{hrvRmssd.toFixed(1)}</div>
              <div className="text-[0.6rem] text-[var(--color-text-dim)] uppercase">RMSSD (ms)</div>
            </div>
            <div>
              <div className="text-xl font-bold text-[var(--color-accent)]">{hrvLfPower.toFixed(1)}</div>
              <div className="text-[0.6rem] text-[var(--color-text-dim)] uppercase">LF Power</div>
            </div>
            <div>
              <div className="text-xl font-bold text-[var(--color-accent)]">{hrvLfHfRatio.toFixed(2)}</div>
              <div className="text-[0.6rem] text-[var(--color-text-dim)] uppercase">LF/HF Ratio</div>
            </div>
          </div>
        </div>
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

  return (
    <div className="max-w-4xl mx-auto space-y-4">
      {/* Audio player */}
      {result.output_url && (
        <div className="panel">
          <div className="panel-header">
            <span style={{ color: 'var(--color-audio)' }}>&#8767;</span>
            Recovered Audio
          </div>
          <div className="p-4">
            <audio controls src={result.output_url} className="w-full" />
            <div className="flex gap-4 mt-3 text-[0.65rem] text-[var(--color-text-dim)]">
              {fps !== undefined && <span>Source FPS: {fps.toFixed(0)}</span>}
              {nFrames !== undefined && <span>Frames: {nFrames}</span>}
              {durationSeconds !== undefined && <span>Duration: {durationSeconds.toFixed(1)}s</span>}
              {maxRecoverable !== undefined && <span>Max freq: {maxRecoverable.toFixed(1)} Hz</span>}
            </div>
            <a
              href={result.output_url}
              download
              className="btn-secondary inline-flex items-center gap-1 text-[0.65rem] mt-2"
            >
              &#8615; Download Audio
            </a>
          </div>
        </div>
      )}

      {/* Waveform chart */}
      {waveform.length > 0 && (
        <AudioWaveform waveform={waveform} durationSeconds={durationSeconds} />
      )}
    </div>
  );
}
