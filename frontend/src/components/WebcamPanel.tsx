import { useRef, useEffect, useState, useCallback } from 'react';
import { useVitalsWebSocket } from '../hooks/useWebSocket';
import { BVPChart } from './charts/BVPChart';
import { BPMTimeChart } from './charts/BPMTimeChart';

interface Props {
  onStop: () => void;
}

export function WebcamPanel({ onStop }: Props) {
  const videoRef = useRef<HTMLVideoElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const intervalRef = useRef<number | null>(null);
  const [streaming, setStreaming] = useState(false);
  const { connected, connect, disconnect, sendFrame, latestData, bpmHistory } = useVitalsWebSocket();

  const startCamera = useCallback(async () => {
    try {
      const stream = await navigator.mediaDevices.getUserMedia({
        video: { facingMode: 'user', width: 640, height: 480 },
      });
      if (videoRef.current) {
        videoRef.current.srcObject = stream;
        await videoRef.current.play();
      }
    } catch (err) {
      console.error('Camera access failed:', err);
    }
  }, []);

  const stopCamera = useCallback(() => {
    if (videoRef.current?.srcObject) {
      (videoRef.current.srcObject as MediaStream).getTracks().forEach((t) => t.stop());
      videoRef.current.srcObject = null;
    }
    if (intervalRef.current) {
      clearInterval(intervalRef.current);
      intervalRef.current = null;
    }
    disconnect();
    setStreaming(false);
    onStop();
  }, [disconnect, onStop]);

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

  // Start camera on mount
  useEffect(() => {
    const video = videoRef.current;
    startCamera();
    return () => {
      const stream = video?.srcObject as MediaStream | null;
      if (stream) stream.getTracks().forEach((t) => t.stop());
      if (intervalRef.current) clearInterval(intervalRef.current);
    };
  }, [startCamera]);

  // Start sending frames when connected
  useEffect(() => {
    if (!streaming || !connected) return;

    const canvas = canvasRef.current;
    const video = videoRef.current;
    if (!canvas || !video) return;

    const ctx = canvas.getContext('2d');
    if (!ctx) return;

    canvas.width = 320;
    canvas.height = 240;

    intervalRef.current = window.setInterval(() => {
      ctx.drawImage(video, 0, 0, 320, 240);
      canvas.toBlob(
        (blob) => {
          if (blob) sendFrame(blob);
        },
        'image/jpeg',
        0.7,
      );
    }, 1000 / 30); // 30fps

    return () => {
      if (intervalRef.current) clearInterval(intervalRef.current);
    };
  }, [streaming, connected, sendFrame]);

  const bpmValue = latestData?.bpm_mean ?? latestData?.bpm;
  const bpmDisplay = typeof bpmValue === 'number' ? Math.round(bpmValue) : '--';

  return (
    <div className="p-4 space-y-4 max-w-4xl mx-auto">
      {/* Video + BPM overlay */}
      <div className="panel">
        <div className="panel-header">
          <span className={`status-led ${streaming ? 'online' : 'offline'}`} />
          Live Feed
          <span className="ml-auto text-[var(--color-text-dim)]">
            {connected ? 'WS Connected' : 'WS Disconnected'}
          </span>
        </div>
        <div className="p-4 relative">
          <video
            ref={videoRef}
            className="w-full max-w-lg mx-auto rounded border border-[var(--color-border)]"
            muted
            playsInline
          />
          {/* BPM overlay */}
          <div className="absolute top-6 right-6 text-right">
            <div className="text-4xl font-bold" style={{ color: 'var(--color-heart)', textShadow: '0 0 20px rgba(255,51,102,0.5)' }}>
              {bpmDisplay}
            </div>
            <div className="text-[0.6rem] text-[var(--color-text-dim)] uppercase">BPM</div>
          </div>
          <canvas ref={canvasRef} className="hidden" />
        </div>
        <div className="px-4 pb-3 flex gap-2">
          {!connected && streaming && (
            <button onClick={connect} className="btn-primary">
              Start Monitoring
            </button>
          )}
          {connected && (
            <button onClick={disconnect} className="btn-secondary">
              Stop Monitoring
            </button>
          )}
          <button onClick={stopCamera} className="btn-secondary">
            Stop Camera
          </button>
        </div>
      </div>

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
