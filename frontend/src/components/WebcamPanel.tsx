import { useRef, useEffect, useState, useCallback } from 'react';
import { useVitalsWebSocket } from '../hooks/useWebSocket';
import { BVPChart } from './charts/BVPChart';
import { BPMTimeChart } from './charts/BPMTimeChart';
import { Card, CardHeader, CardTitle, CardContent } from './ui/card';
import { Button } from './ui/button';
import { Badge } from './ui/badge';
import { Slider } from './ui/slider';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from './ui/select';
import { Progress } from './ui/progress';

type LiveInputSource = 'camera' | 'mit';

const MIT_TEST_VIDEOS: { label: string; path: string }[] = [
  { label: 'face.mp4 (pulse)', path: '/test-videos/mit-evm/source/face.mp4' },
  { label: 'face2.mp4 (pulse)', path: '/test-videos/mit-evm/source/face2.mp4' },
  { label: 'wrist.mp4 (pulse)', path: '/test-videos/mit-evm/source/wrist.mp4' },
  { label: 'baby.mp4 (breathing)', path: '/test-videos/mit-evm/source/baby.mp4' },
  { label: 'baby2.mp4 (color change)', path: '/test-videos/mit-evm/source/baby2.mp4' },
  { label: 'guitar.mp4 (vibration)', path: '/test-videos/mit-evm/source/guitar.mp4' },
  { label: 'subway.mp4 (vibration)', path: '/test-videos/mit-evm/source/subway.mp4' },
  { label: 'shadow.mp4 (motion)', path: '/test-videos/mit-evm/source/shadow.mp4' },
  { label: 'camera.mp4 (high freq)', path: '/test-videos/mit-evm/source/camera.mp4' },
];

const MIT_REFERENCE_OVERLAY: Partial<Record<string, string>> = {
  '/test-videos/mit-evm/source/face.mp4':
    '/test-videos/mit-evm/processed/face-ideal-from-0.83333-to-1-alpha-50-level-4-chromAtn-1.mp4',
  '/test-videos/mit-evm/source/face2.mp4':
    '/test-videos/mit-evm/processed/face2-ideal-from-0.83333-to-1-alpha-50-level-6-chromAtn-1.mp4',
  '/test-videos/mit-evm/source/wrist.mp4':
    '/test-videos/mit-evm/processed/wrist-iir-r1-0.4-r2-0.05-alpha-10-lambda_c-16-chromAtn-0.1.mp4',
};

interface Props {
  onStop: () => void;
}

export function WebcamPanel({ onStop }: Props) {
  const videoRef = useRef<HTMLVideoElement>(null);
  const overlayVideoRef = useRef<HTMLVideoElement>(null);
  const captureCanvasRef = useRef<HTMLCanvasElement>(null);
  const previewCanvasRef = useRef<HTMLCanvasElement>(null);
  const intervalRef = useRef<number | null>(null);
  const [streaming, setStreaming] = useState(false);
  const [inputSource, setInputSource] = useState<LiveInputSource>('camera');
  const [mitVideoPath, setMitVideoPath] = useState(MIT_TEST_VIDEOS[0]?.path ?? '');
  const [mirrorPreview, setMirrorPreview] = useState(true);
  const [pulseOverlay, setPulseOverlay] = useState(true);
  const [useMitReferenceOverlay, setUseMitReferenceOverlay] = useState(true);
  const [overlayAmplification, setOverlayAmplification] = useState(50);
  const { connected, connectionError, connect, disconnect, sendFrame, latestData, bpmHistory, collecting } = useVitalsWebSocket();
  const evmStateRef = useRef<{
    i1: Float32Array;
    i2: Float32Array;
    q1: Float32Array;
    q2: Float32Array;
    lastTime: number | null;
    out: ImageData;
    initialized: boolean;
  } | null>(null);
  const [magnifiedReady, setMagnifiedReady] = useState(false);

  const resetEvmState = useCallback(() => {
    evmStateRef.current = null;
    setMagnifiedReady(false);
  }, []);

  const activeMitReferenceOverlay =
    inputSource === 'mit' && useMitReferenceOverlay ? (MIT_REFERENCE_OVERLAY[mitVideoPath] ?? null) : null;

  const stopVideoElement = useCallback(() => {
    const video = videoRef.current;
    if (!video) return;

    const stream = video.srcObject as MediaStream | null;
    if (stream) stream.getTracks().forEach((t) => t.stop());
    video.srcObject = null;

    if (video.src) {
      video.pause();
      video.removeAttribute('src');
      video.load();
    }
  }, []);

  const stopOverlayVideoElement = useCallback(() => {
    const video = overlayVideoRef.current;
    if (!video) return;

    if (video.src) {
      video.pause();
      video.removeAttribute('src');
      video.load();
    }
  }, []);

  const startInput = useCallback(async () => {
    const video = videoRef.current;
    if (!video) return;

    stopVideoElement();
    stopOverlayVideoElement();

    if (inputSource === 'camera') {
      try {
        const stream = await navigator.mediaDevices.getUserMedia({
          video: { facingMode: 'user', width: 640, height: 480 },
        });
        video.srcObject = stream;
        await video.play();
      } catch (err) {
        console.error('Camera access failed:', err);
      }
      return;
    }

    if (!mitVideoPath) return;
    video.loop = true;
    video.src = mitVideoPath;
    try {
      await video.play();
    } catch (err) {
      // Some browsers require a user gesture; leave the video paused.
      console.debug('Autoplay blocked:', err);
    }
  }, [inputSource, mitVideoPath, stopOverlayVideoElement, stopVideoElement]);

  const stopLiveFeed = useCallback(() => {
    stopVideoElement();
    stopOverlayVideoElement();
    if (intervalRef.current) {
      clearInterval(intervalRef.current);
      intervalRef.current = null;
    }
    disconnect();
    setStreaming(false);
    onStop();
  }, [disconnect, onStop, stopOverlayVideoElement, stopVideoElement]);

  // Track streaming state via media events (avoid setState inside effects)
  useEffect(() => {
    const video = videoRef.current;
    if (!video) return;

    const handlePlaying = () => setStreaming(true);
    const handleStopped = () => setStreaming(false);

    video.addEventListener('playing', handlePlaying);
    video.addEventListener('pause', handleStopped);
    video.addEventListener('ended', handleStopped);

    return () => {
      video.removeEventListener('playing', handlePlaying);
      video.removeEventListener('pause', handleStopped);
      video.removeEventListener('ended', handleStopped);
    };
  }, []);

  useEffect(() => {
    startInput();
    return () => {
      stopVideoElement();
      if (intervalRef.current) clearInterval(intervalRef.current);
    };
  }, [startInput, stopVideoElement]);

  // Start sending frames when connected
  useEffect(() => {
    if (!streaming || !connected) return;

    const captureCanvas = captureCanvasRef.current;
    const video = videoRef.current;
    if (!captureCanvas || !video) return;

    const captureCtx = captureCanvas.getContext('2d', { willReadFrequently: true });
    if (!captureCtx) return;

    const W = 320;
    const H = 240;
    captureCanvas.width = W;
    captureCanvas.height = H;

    const previewCanvas = previewCanvasRef.current;
    const previewCtx = previewCanvas?.getContext('2d', { willReadFrequently: true }) ?? null;
    if (previewCanvas) {
      previewCanvas.width = W;
      previewCanvas.height = H;
    }

    const drawCropped = () => {
      const srcW = video.videoWidth || W;
      const srcH = video.videoHeight || H;
      const srcAspect = srcW / srcH;
      const dstAspect = W / H;

      let sx = 0;
      let sy = 0;
      let sWidth = srcW;
      let sHeight = srcH;

      if (srcAspect > dstAspect) {
        sWidth = Math.round(srcH * dstAspect);
        sx = Math.round((srcW - sWidth) / 2);
      } else if (srcAspect < dstAspect) {
        sHeight = Math.round(srcW / dstAspect);
        sy = Math.round((srcH - sHeight) / 2);
      }

      captureCtx.drawImage(video, sx, sy, sWidth, sHeight, 0, 0, W, H);
    };

    const ensureEvmState = (): NonNullable<typeof evmStateRef.current> | null => {
      if (!previewCtx) return null;
      if (evmStateRef.current) return evmStateRef.current;
      const n = W * H;
      const out = previewCtx.createImageData(W, H);
      evmStateRef.current = {
        i1: new Float32Array(n),
        i2: new Float32Array(n),
        q1: new Float32Array(n),
        q2: new Float32Array(n),
        lastTime: null,
        out,
        initialized: false,
      };
      return evmStateRef.current;
    };

    const clamp255 = (v: number) => (v < 0 ? 0 : v > 255 ? 255 : v);

    // MIT pulse example uses ~0.83–1.0 Hz.
    const evmFreqMinHz = 0.83;
    const evmFreqMaxHz = 1.0;
    const fps = 30.0;
    const rHigh = Math.exp((-2 * Math.PI * evmFreqMaxHz) / fps);
    const rLow = Math.exp((-2 * Math.PI * evmFreqMinHz) / fps);

    intervalRef.current = window.setInterval(() => {
      drawCropped();

      captureCanvas.toBlob(
        (blob) => {
          if (blob) sendFrame(blob);
        },
        'image/jpeg',
        0.7,
      );

      // When using MIT source videos, optionally show the ground-truth magnified overlay video
      // from the MIT EVM dataset (matches the paper visuals exactly for those clips).
      if (pulseOverlay && activeMitReferenceOverlay) {
        const overlayVideo = overlayVideoRef.current;
        if (overlayVideo) {
          if (!overlayVideo.src || !overlayVideo.src.endsWith(activeMitReferenceOverlay)) {
            overlayVideo.loop = true;
            overlayVideo.muted = true;
            overlayVideo.playsInline = true;
            overlayVideo.src = activeMitReferenceOverlay;
            overlayVideo.currentTime = video.currentTime;
            overlayVideo.play().catch(() => {});
          }

          if (!video.paused && overlayVideo.paused) overlayVideo.play().catch(() => {});
          if (video.paused && !overlayVideo.paused) overlayVideo.pause();

          const drift = Math.abs((overlayVideo.currentTime || 0) - (video.currentTime || 0));
          if (drift > 0.08 && overlayVideo.readyState >= 2) {
            overlayVideo.currentTime = video.currentTime;
          }
        }
        return;
      }

      if (!pulseOverlay) return;

      const state = ensureEvmState();
      if (!state || !previewCtx) return;
      const t = video.currentTime;
      if (state.lastTime !== null && t + 0.05 < state.lastTime) {
        // Looped/restarted: reset filter history.
        state.initialized = false;
      }
      state.lastTime = t;

      const src = captureCtx.getImageData(0, 0, W, H).data;
      const dst = state.out.data;

      // Eulerian-style IIR bandpass on chrominance (YIQ).
      for (let p = 0, i = 0; i < src.length; i += 4, p += 1) {
        const r = src[i];
        const g = src[i + 1];
        const b = src[i + 2];

        const y = 0.299 * r + 0.587 * g + 0.114 * b;
        const ii = 0.596 * r - 0.274 * g - 0.322 * b;
        const q = 0.211 * r - 0.523 * g + 0.312 * b;

        if (!state.initialized) {
          state.i1[p] = ii;
          state.i2[p] = ii;
          state.q1[p] = q;
          state.q2[p] = q;
        } else {
          state.i1[p] = (1 - rHigh) * ii + rHigh * state.i1[p];
          state.i2[p] = (1 - rLow) * ii + rLow * state.i2[p];
          state.q1[p] = (1 - rHigh) * q + rHigh * state.q1[p];
          state.q2[p] = (1 - rLow) * q + rLow * state.q2[p];
        }

        const iBand = state.i1[p] - state.i2[p];
        const qBand = state.q1[p] - state.q2[p];

        const iOut = ii + overlayAmplification * iBand;
        const qOut = q + overlayAmplification * qBand;

        const rr = y + 0.956 * iOut + 0.621 * qOut;
        const gg = y - 0.272 * iOut - 0.647 * qOut;
        const bb = y - 1.105 * iOut + 1.702 * qOut;

        dst[i] = clamp255(rr);
        dst[i + 1] = clamp255(gg);
        dst[i + 2] = clamp255(bb);
        dst[i + 3] = 255;
      }

      previewCtx.putImageData(state.out, 0, 0);
      if (!state.initialized) state.initialized = true;
      setMagnifiedReady(true);
    }, 1000 / 30); // 30fps

    return () => {
      if (intervalRef.current) clearInterval(intervalRef.current);
    };
  }, [streaming, connected, sendFrame, pulseOverlay, activeMitReferenceOverlay, overlayAmplification]);

  const bpmValue = latestData?.bpm_mean ?? latestData?.bpm;
  const bpmDisplay = typeof bpmValue === 'number' ? Math.round(bpmValue) : '--';

  return (
    <div className="p-4 space-y-4 max-w-4xl mx-auto">
      {/* Video + BPM overlay */}
      <Card>
        <CardHeader className="pb-2">
          <div className="flex items-center justify-between">
            <CardTitle className="text-sm flex items-center gap-2">
              <Badge variant={streaming ? 'default' : 'destructive'} className="text-xs">
                {streaming ? 'Live' : 'Off'}
              </Badge>
              Live Feed
            </CardTitle>
            <Badge variant={connected ? 'default' : 'secondary'} className="text-xs">
              {connected
                ? collecting
                  ? `Collecting ${collecting.collected}/${collecting.needed}`
                  : 'WS Connected'
                : connectionError
                  ? 'WS Error'
                  : 'WS Disconnected'}
            </Badge>
          </div>
        </CardHeader>
        <CardContent className="space-y-3">
          {collecting && collecting.needed > 0 && (
            <div className="space-y-2">
              <div className="flex items-center justify-between text-xs text-muted-foreground">
                <span>Buffering frames</span>
                <span className="tabular-nums">{collecting.collected}/{collecting.needed}</span>
              </div>
              <Progress value={(collecting.collected / collecting.needed) * 100} />
            </div>
          )}

          <div className="flex flex-wrap items-end gap-3">
            <div className="space-y-1">
              <div className="text-xs text-muted-foreground">Input</div>
              <Select
                value={inputSource}
                onValueChange={(v) => {
                  setInputSource(v as LiveInputSource);
                  resetEvmState();
                }}
              >
                <SelectTrigger size="sm" className="w-44">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="camera">Camera</SelectItem>
                  <SelectItem value="mit">MIT test video</SelectItem>
                </SelectContent>
              </Select>
            </div>

            {inputSource === 'mit' && (
              <div className="space-y-1">
                <div className="text-xs text-muted-foreground">Test video</div>
                <Select
                  value={mitVideoPath}
                  onValueChange={(v) => {
                    setMitVideoPath(v);
                    resetEvmState();
                  }}
                >
                  <SelectTrigger size="sm" className="w-64">
                    <SelectValue placeholder="Select a test video" />
                  </SelectTrigger>
                  <SelectContent>
                    {MIT_TEST_VIDEOS.map((v) => (
                      <SelectItem key={v.path} value={v.path}>
                        {v.label}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
            )}
          </div>

          <div className="dark-panel-deep p-2">
            <div className="relative w-full max-w-lg mx-auto">
              <video
                ref={videoRef}
                className="w-full rounded"
                muted
                playsInline
                autoPlay
                style={{ objectFit: 'contain', ...(mirrorPreview ? { transform: 'scaleX(-1)' } : undefined) }}
              />

              {connected && pulseOverlay && activeMitReferenceOverlay && (
                <video
                  ref={overlayVideoRef}
                  className="absolute inset-0 w-full h-full rounded pointer-events-none"
                  muted
                  playsInline
                  autoPlay
                  loop
                  style={{ objectFit: 'contain', ...(mirrorPreview ? { transform: 'scaleX(-1)' } : undefined) }}
                />
              )}

              {/* MIT-style pulse magnification preview (Eulerian IIR on chrominance) */}
              {connected && pulseOverlay && !activeMitReferenceOverlay && (
                <canvas
                  ref={previewCanvasRef}
                  className={`absolute inset-0 w-full h-full rounded pointer-events-none ${magnifiedReady ? 'opacity-100' : 'opacity-0'}`}
                  style={mirrorPreview ? { transform: 'scaleX(-1)' } : undefined}
                />
              )}

              {/* BPM overlay */}
              <div className="absolute top-3 right-3 text-right pointer-events-none">
                <div className="text-4xl font-bold text-rose-500">
                  {bpmDisplay}
                </div>
                <div className="text-xs text-slate-400">BPM</div>
              </div>
            </div>
          </div>

          <div className="flex flex-wrap gap-4 text-xs text-muted-foreground items-center">
            <label className="flex items-center gap-2">
              <input
                type="checkbox"
                className="accent-primary"
                checked={mirrorPreview}
                onChange={(e) => setMirrorPreview(e.target.checked)}
              />
              Mirror preview
            </label>
            <label className="flex items-center gap-2">
              <input
                type="checkbox"
                className="accent-primary"
                checked={pulseOverlay}
                onChange={(e) => {
                  setPulseOverlay(e.target.checked);
                  resetEvmState();
                }}
              />
              Pulse overlay
            </label>
            {inputSource === 'mit' && MIT_REFERENCE_OVERLAY[mitVideoPath] && (
              <label className="flex items-center gap-2">
                <input
                  type="checkbox"
                  className="accent-primary"
                  checked={useMitReferenceOverlay}
                  onChange={(e) => {
                    setUseMitReferenceOverlay(e.target.checked);
                    resetEvmState();
                  }}
                />
                MIT reference overlay
              </label>
            )}
            {pulseOverlay && (
              <label className="flex items-center gap-2 w-40">
                <span>Amplification</span>
                <Slider
                  min={0}
                  max={150}
                  step={1}
                  value={[overlayAmplification]}
                  onValueChange={([v]) => setOverlayAmplification(v)}
                  disabled={!!activeMitReferenceOverlay}
                />
              </label>
            )}
          </div>

          <canvas ref={captureCanvasRef} className="hidden" />

          {!connected && connectionError && (
            <div className="text-xs text-destructive">
              {connectionError}
            </div>
          )}

          <div className="flex gap-2">
            {!connected && (
              <Button onClick={connect} disabled={inputSource === 'camera' && !streaming}>
                Start Monitoring
              </Button>
            )}
            {connected && (
              <Button variant="outline" onClick={disconnect}>
                Stop Monitoring
              </Button>
            )}
            <Button variant="outline" onClick={stopLiveFeed}>
              Exit Live Feed
            </Button>
          </div>
        </CardContent>
      </Card>

      {/* Live charts */}
      {latestData?.bvp && latestData.bvp.length > 0 && (
        <BVPChart bvp={latestData.bvp} label="Live BVP Signal" />
      )}
      {bpmHistory.length > 1 && (
        <BPMTimeChart bpmValues={bpmHistory.map((h) => h.bpm)} />
      )}
    </div>
  );
}
