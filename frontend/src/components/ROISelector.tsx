import { useRef, useState, useCallback, useEffect } from 'react';
import type { ROI } from '../types';
import { previewFirstFrame } from '../api';
import { Card, CardHeader, CardTitle, CardContent } from './ui/card';
import { Button } from './ui/button';
import { Crosshair, AlertTriangle } from 'lucide-react';

const PREVIEW_MAX_SIDE = 960;

function clamp(n: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, n));
}

function fitWithin(w: number, h: number, maxSide: number): { w: number; h: number } {
  const maxDim = Math.max(w, h);
  if (maxDim <= 0) return { w: 1, h: 1 };
  const scale = Math.min(1, maxSide / maxDim);
  return { w: Math.max(1, Math.round(w * scale)), h: Math.max(1, Math.round(h * scale)) };
}

function isLikelyUnsupportedByBrowser(file: File): boolean {
  const ext = file.name.split('.').pop()?.toLowerCase() ?? '';
  // Common high-speed / scientific camera containers most browsers won't decode.
  return ['avi', 'mkv', 'wmv', 'flv', 'mts', 'm2ts', 'ts', 'mxf'].includes(ext);
}

interface Props {
  videoFile: File;
  onROISelect: (roi: ROI) => void;
  onSkip: () => void;
}

export function ROISelector({ videoFile, onROISelect, onSkip }: Props) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const videoRef = useRef<HTMLVideoElement>(null);
  const imgRef = useRef<HTMLImageElement | null>(null);
  const fallbackRequestedRef = useRef(false);

  const [drawing, setDrawing] = useState(false);
  const [start, setStart] = useState({ x: 0, y: 0 });
  const [current, setCurrent] = useState({ x: 0, y: 0 });
  const [roi, setRoi] = useState<ROI | null>(null);
  const [frameReady, setFrameReady] = useState(false);
  const [frameError, setFrameError] = useState<string | null>(null);
  const [usingBackendPreview, setUsingBackendPreview] = useState(false);
  const [sourceSize, setSourceSize] = useState<{ w: number; h: number } | null>(null);

  const drawFrame = useCallback(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;

    const w = canvas.width;
    const h = canvas.height;
    if (w <= 0 || h <= 0) return;

    const img = imgRef.current;
    if (img) {
      ctx.drawImage(img, 0, 0, w, h);
      return;
    }

    const video = videoRef.current;
    if (!video) return;
    ctx.drawImage(video, 0, 0, w, h);
  }, []);

  // Load video frame
  useEffect(() => {
    fallbackRequestedRef.current = false;
    imgRef.current = null;

    setRoi(null);
    setDrawing(false);
    setFrameReady(false);
    setFrameError(null);
    setUsingBackendPreview(false);
    setSourceSize(null);

    const video = videoRef.current;
    if (!video) return;
    let disposed = false;
    const url = URL.createObjectURL(videoFile);
    video.src = url;

    const loadBackendPreview = async () => {
      if (fallbackRequestedRef.current) return;
      fallbackRequestedRef.current = true;
      setUsingBackendPreview(true);

      try {
        const res = await previewFirstFrame(videoFile, PREVIEW_MAX_SIDE);
        if (disposed) return;
        if (!res.success) {
          throw new Error(res.error || 'Backend preview failed');
        }
        if (!res.preview_data_url || !res.preview_width || !res.preview_height || !res.frame_width || !res.frame_height) {
          throw new Error('Backend preview returned an incomplete payload');
        }

        setSourceSize({ w: res.frame_width, h: res.frame_height });

        const canvas = canvasRef.current;
        if (!canvas) return;
        canvas.width = res.preview_width;
        canvas.height = res.preview_height;

        const img = new Image();
        img.onload = () => {
          imgRef.current = img;
          setFrameReady(true);
          drawFrame();
        };
        img.onerror = () => {
          setFrameError('Failed to load backend preview image.');
        };
        img.src = res.preview_data_url;
      } catch (e: unknown) {
        if (disposed) return;
        const msg = e instanceof Error ? e.message : 'Failed to generate preview.';
        setFrameError(msg);
      }
    };

    const onLoadedData = () => {
      if (fallbackRequestedRef.current) return;
      const srcW = video.videoWidth || 0;
      const srcH = video.videoHeight || 0;
      if (srcW <= 0 || srcH <= 0) {
        void loadBackendPreview();
        return;
      }

      setSourceSize({ w: srcW, h: srcH });
      const render = fitWithin(srcW, srcH, PREVIEW_MAX_SIDE);
      const canvas = canvasRef.current;
      if (!canvas) return;
      canvas.width = render.w;
      canvas.height = render.h;

      setFrameReady(true);
      drawFrame();
    };

    const onError = () => {
      void loadBackendPreview();
    };

    video.addEventListener('loadeddata', onLoadedData);
    video.addEventListener('error', onError);

    if (isLikelyUnsupportedByBrowser(videoFile)) {
      void loadBackendPreview();
    }

    return () => {
      disposed = true;
      URL.revokeObjectURL(url);
      video.removeEventListener('loadeddata', onLoadedData);
      video.removeEventListener('error', onError);
    };
  }, [videoFile, drawFrame]);

  const getCanvasCoords = useCallback(
    (e: React.PointerEvent<HTMLCanvasElement>) => {
      const canvas = canvasRef.current;
      if (!canvas) return { x: 0, y: 0 };
      const rect = canvas.getBoundingClientRect();
      const scaleX = canvas.width / rect.width;
      const scaleY = canvas.height / rect.height;
      if (!Number.isFinite(scaleX) || !Number.isFinite(scaleY) || scaleX <= 0 || scaleY <= 0) {
        return { x: 0, y: 0 };
      }
      return {
        x: clamp(Math.round((e.clientX - rect.left) * scaleX), 0, Math.max(0, canvas.width)),
        y: clamp(Math.round((e.clientY - rect.top) * scaleY), 0, Math.max(0, canvas.height)),
      };
    },
    [],
  );

  const handleMouseDown = useCallback(
    (e: React.PointerEvent<HTMLCanvasElement>) => {
      if (!frameReady) return;
      canvasRef.current?.setPointerCapture(e.pointerId);
      const coords = getCanvasCoords(e);
      setStart(coords);
      setCurrent(coords);
      setDrawing(true);
      setRoi(null);
    },
    [frameReady, getCanvasCoords],
  );

  const handleMouseMove = useCallback(
    (e: React.PointerEvent<HTMLCanvasElement>) => {
      if (!drawing) return;
      const coords = getCanvasCoords(e);
      setCurrent(coords);

      // Redraw frame + rectangle
      const canvas = canvasRef.current;
      if (!canvas) return;
      const ctx = canvas.getContext('2d');
      if (!ctx) return;
      drawFrame();
      ctx.strokeStyle = '#0ea5e9';
      ctx.lineWidth = 2;
      ctx.setLineDash([5, 5]);
      ctx.strokeRect(start.x, start.y, coords.x - start.x, coords.y - start.y);
      ctx.setLineDash([]);
    },
    [drawing, start, getCanvasCoords, drawFrame],
  );

  const handleMouseUp = useCallback(() => {
    if (!drawing) return;
    setDrawing(false);

    const src = sourceSize;
    const canvas = canvasRef.current;
    if (!src || !canvas) return;

    const x = Math.min(start.x, current.x);
    const y = Math.min(start.y, current.y);
    const w = Math.abs(current.x - start.x);
    const h = Math.abs(current.y - start.y);
    const scaleX = src.w / canvas.width;
    const scaleY = src.h / canvas.height;

    const rx = clamp(Math.round(x * scaleX), 0, Math.max(0, src.w - 1));
    const ry = clamp(Math.round(y * scaleY), 0, Math.max(0, src.h - 1));
    let rw = Math.round(w * scaleX);
    let rh = Math.round(h * scaleY);

    rw = clamp(rw, 1, src.w - rx);
    rh = clamp(rh, 1, src.h - ry);

    if (rw < 5 || rh < 5) return;
    setRoi({ x: rx, y: ry, w: rw, h: rh });
  }, [drawing, start, current, sourceSize]);

  return (
    <div className="max-w-xl mx-auto p-4">
      <Card>
        <CardHeader className="pb-3">
          <CardTitle className="text-sm flex items-center gap-2">
            <Crosshair className="h-4 w-4 text-primary" />
            Select Region of Interest
          </CardTitle>
        </CardHeader>
        <CardContent className="space-y-3">
          <p className="text-xs text-muted-foreground">
            Click and drag to select the region to analyze. For color magnification, select the skin area. For audio recovery, select the vibrating object.
          </p>
          <div className="dark-panel">
            <video ref={videoRef} className="hidden" muted preload="auto" />
            <canvas
              ref={canvasRef}
              onPointerDown={handleMouseDown}
              onPointerMove={handleMouseMove}
              onPointerUp={handleMouseUp}
              onPointerCancel={handleMouseUp}
              className="w-full cursor-crosshair rounded touch-none"
            />
          </div>
          {!frameReady && !frameError && (
            <div className="text-xs text-muted-foreground">
              Loading preview…
            </div>
          )}
          {frameError && (
            <div className="text-xs text-amber-700 bg-amber-50 border border-amber-200 rounded p-2 flex items-start gap-2">
              <AlertTriangle className="h-4 w-4 shrink-0 mt-0.5" />
              <div className="space-y-1">
                <div className="font-medium">Preview unavailable</div>
                <div className="text-amber-800/80">
                  {frameError} You can still continue with full-frame processing.
                </div>
              </div>
            </div>
          )}
          {usingBackendPreview && frameReady && (
            <div className="text-xs text-muted-foreground">
              Using backend preview (browser can’t decode this format).
            </div>
          )}
          {roi && (
            <div className="text-xs text-muted-foreground font-mono">
              ROI: x={roi.x} y={roi.y} w={roi.w} h={roi.h}
            </div>
          )}
          <div className="flex gap-2">
            <Button
              onClick={() => roi && onROISelect(roi)}
              disabled={!roi}
            >
              Confirm ROI
            </Button>
            <Button variant="outline" onClick={onSkip}>
              Skip (Full Frame)
            </Button>
          </div>
        </CardContent>
      </Card>
    </div>
  );
}
