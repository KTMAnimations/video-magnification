import { useRef, useState, useCallback, useEffect } from 'react';
import type { ROI } from '../types';

interface Props {
  videoFile: File;
  onROISelect: (roi: ROI) => void;
  onSkip: () => void;
}

export function ROISelector({ videoFile, onROISelect, onSkip }: Props) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const videoRef = useRef<HTMLVideoElement>(null);
  const [drawing, setDrawing] = useState(false);
  const [start, setStart] = useState({ x: 0, y: 0 });
  const [current, setCurrent] = useState({ x: 0, y: 0 });
  const [roi, setRoi] = useState<ROI | null>(null);

  const drawFrame = useCallback(() => {
    const canvas = canvasRef.current;
    const video = videoRef.current;
    if (!canvas || !video) return;
    canvas.width = video.videoWidth;
    canvas.height = video.videoHeight;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;
    ctx.drawImage(video, 0, 0);
  }, []);

  // Load video frame
  useEffect(() => {
    const video = videoRef.current;
    if (!video) return;
    const url = URL.createObjectURL(videoFile);
    video.src = url;
    video.onloadeddata = drawFrame;
    return () => URL.revokeObjectURL(url);
  }, [videoFile, drawFrame]);

  const getCanvasCoords = useCallback(
    (e: React.MouseEvent<HTMLCanvasElement>) => {
      const canvas = canvasRef.current;
      if (!canvas) return { x: 0, y: 0 };
      const rect = canvas.getBoundingClientRect();
      const scaleX = canvas.width / rect.width;
      const scaleY = canvas.height / rect.height;
      return {
        x: Math.round((e.clientX - rect.left) * scaleX),
        y: Math.round((e.clientY - rect.top) * scaleY),
      };
    },
    [],
  );

  const handleMouseDown = useCallback(
    (e: React.MouseEvent<HTMLCanvasElement>) => {
      const coords = getCanvasCoords(e);
      setStart(coords);
      setCurrent(coords);
      setDrawing(true);
      setRoi(null);
    },
    [getCanvasCoords],
  );

  const handleMouseMove = useCallback(
    (e: React.MouseEvent<HTMLCanvasElement>) => {
      if (!drawing) return;
      const coords = getCanvasCoords(e);
      setCurrent(coords);

      // Redraw frame + rectangle
      const canvas = canvasRef.current;
      const video = videoRef.current;
      if (!canvas || !video) return;
      const ctx = canvas.getContext('2d');
      if (!ctx) return;
      ctx.drawImage(video, 0, 0);
      ctx.strokeStyle = '#00ff88';
      ctx.lineWidth = 2;
      ctx.setLineDash([5, 5]);
      ctx.strokeRect(start.x, start.y, coords.x - start.x, coords.y - start.y);
      ctx.setLineDash([]);
    },
    [drawing, start, getCanvasCoords],
  );

  const handleMouseUp = useCallback(() => {
    if (!drawing) return;
    setDrawing(false);
    const x = Math.min(start.x, current.x);
    const y = Math.min(start.y, current.y);
    const w = Math.abs(current.x - start.x);
    const h = Math.abs(current.y - start.y);
    if (w > 5 && h > 5) {
      setRoi({ x, y, w, h });
    }
  }, [drawing, start, current]);

  return (
    <div className="max-w-xl mx-auto p-4">
      <div className="panel">
        <div className="panel-header">
          <span className="text-[var(--color-accent)]">&#9635;</span>
          Select Region of Interest
        </div>
        <div className="p-4">
          <div className="text-[0.7rem] text-[var(--color-text-secondary)] mb-3">
            Click and drag to select the region to analyze. For color magnification, select the skin area. For audio recovery, select the vibrating object.
          </div>
          <div className="relative">
            <video ref={videoRef} className="hidden" muted preload="auto" />
            <canvas
              ref={canvasRef}
              onMouseDown={handleMouseDown}
              onMouseMove={handleMouseMove}
              onMouseUp={handleMouseUp}
              className="w-full cursor-crosshair rounded border border-[var(--color-border)]"
            />
          </div>
          {roi && (
            <div className="mt-2 text-[0.6rem] text-[var(--color-text-dim)] font-mono">
              ROI: x={roi.x} y={roi.y} w={roi.w} h={roi.h}
            </div>
          )}
          <div className="flex gap-2 mt-3">
            <button
              onClick={() => roi && onROISelect(roi)}
              disabled={!roi}
              className="btn-primary"
            >
              Confirm ROI
            </button>
            <button onClick={onSkip} className="btn-secondary">
              Skip (Full Frame)
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
