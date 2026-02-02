import { useCallback, useEffect, useRef, useState } from 'react';
import { Card, CardContent, CardHeader, CardTitle } from './ui/card';
import { Button } from './ui/button';
import { Badge } from './ui/badge';
import { AlertTriangle, Check, Circle, RotateCcw, Square } from 'lucide-react';

interface Props {
  onRecordingComplete: (file: File) => void;
}

type RecorderPhase = 'loading' | 'ready' | 'recording' | 'preview' | 'unsupported' | 'error';

function pickMediaRecorderMimeType(): string | null {
  if (typeof MediaRecorder === 'undefined' || typeof MediaRecorder.isTypeSupported !== 'function') return null;

  const candidates = [
    'video/mp4;codecs=avc1.42E01E',
    'video/mp4',
    'video/webm;codecs=vp9',
    'video/webm;codecs=vp8',
    'video/webm',
  ];

  for (const c of candidates) {
    if (MediaRecorder.isTypeSupported(c)) return c;
  }
  return null;
}

function formatSeconds(seconds: number): string {
  const s = Math.max(0, Math.floor(seconds));
  const mm = String(Math.floor(s / 60)).padStart(2, '0');
  const ss = String(s % 60).padStart(2, '0');
  return `${mm}:${ss}`;
}

function extForMimeType(mimeType: string | null): string {
  const t = (mimeType ?? '').toLowerCase();
  if (t.includes('mp4')) return 'mp4';
  if (t.includes('webm')) return 'webm';
  return 'webm';
}

function safeFileNameNow(): string {
  // Avoid ':' which can be awkward on Windows, even though this app is browser-based.
  return new Date().toISOString().replace(/[:.]/g, '-');
}

export function VideoRecorder({ onRecordingComplete }: Props) {
  const liveVideoRef = useRef<HTMLVideoElement>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const recorderRef = useRef<MediaRecorder | null>(null);
  const chunksRef = useRef<Blob[]>([]);
  const recordedBlobRef = useRef<Blob | null>(null);
  const timerRef = useRef<number | null>(null);
  const recordedUrlRef = useRef<string | null>(null);
  const disposedRef = useRef(false);

  const supported =
    typeof navigator !== 'undefined' &&
    !!navigator.mediaDevices?.getUserMedia &&
    typeof MediaRecorder !== 'undefined';

  const [phase, setPhase] = useState<RecorderPhase>(() => (supported ? 'ready' : 'unsupported'));
  const [error, setError] = useState<string | null>(null);
  const [recordedUrl, setRecordedUrl] = useState<string | null>(null);
  const [recordingSeconds, setRecordingSeconds] = useState(0);
  const [mimeType, setMimeType] = useState<string | null>(null);

  const stopTimer = useCallback(() => {
    if (timerRef.current) {
      window.clearInterval(timerRef.current);
      timerRef.current = null;
    }
  }, []);

  const stopStream = useCallback(() => {
    const stream = streamRef.current;
    if (stream) stream.getTracks().forEach((t) => t.stop());
    streamRef.current = null;

    const video = liveVideoRef.current;
    if (video) video.srcObject = null;
  }, []);

  const stopRecorder = useCallback(() => {
    const r = recorderRef.current;
    if (!r) return;
    if (r.state !== 'inactive') {
      try {
        r.stop();
      } catch {
        // Ignore.
      }
    }
    recorderRef.current = null;
  }, []);

  const cleanupRecordedUrl = useCallback(() => {
    const url = recordedUrlRef.current;
    if (url) URL.revokeObjectURL(url);
    recordedUrlRef.current = null;
  }, []);

  const startCamera = useCallback(async () => {
    if (!supported) return;

    stopStream();
    setError(null);

    try {
      const stream = await navigator.mediaDevices.getUserMedia({
        video: { facingMode: 'user' },
        audio: false,
      });
      streamRef.current = stream;
      const video = liveVideoRef.current;
      if (video) {
        video.srcObject = stream;
        try {
          await video.play();
        } catch {
          // Some browsers require a user gesture; keep the live preview paused.
        }
      }
      setPhase('ready');
    } catch (e: unknown) {
      const msg = e instanceof Error ? e.message : 'Camera permission denied or unavailable.';
      setError(msg);
      setPhase('error');
    }
  }, [stopStream, supported]);

  const startRecording = useCallback(async () => {
    setError(null);
    cleanupRecordedUrl();
    setRecordedUrl(null);
    recordedBlobRef.current = null;
    chunksRef.current = [];
    setPhase('loading');

    if (!streamRef.current) {
      await startCamera();
    }
    const stream = streamRef.current;
    if (!stream) return;

    const preferredMimeType = pickMediaRecorderMimeType();
    let recorder: MediaRecorder;
    try {
      recorder = preferredMimeType ? new MediaRecorder(stream, { mimeType: preferredMimeType }) : new MediaRecorder(stream);
    } catch (e: unknown) {
      const msg = e instanceof Error ? e.message : 'Failed to start recorder.';
      setError(msg);
      setPhase('error');
      return;
    }

    recorderRef.current = recorder;
    setMimeType(recorder.mimeType || preferredMimeType || null);
    setRecordingSeconds(0);
    setPhase('recording');

    recorder.addEventListener('dataavailable', (evt) => {
      if (evt.data && evt.data.size > 0) chunksRef.current.push(evt.data);
    });

    recorder.addEventListener('stop', () => {
      stopTimer();
      if (disposedRef.current) {
        chunksRef.current = [];
        recordedBlobRef.current = null;
        recorderRef.current = null;
        stopStream();
        return;
      }
      const blob = new Blob(chunksRef.current, { type: recorder.mimeType || preferredMimeType || undefined });
      chunksRef.current = [];
      recordedBlobRef.current = blob;
      const url = URL.createObjectURL(blob);
      recordedUrlRef.current = url;
      setRecordedUrl(url);
      setPhase('preview');
      // Privacy: release the camera once we have a clip.
      stopStream();
      recorderRef.current = null;
    });

    recorder.addEventListener('error', (evt: Event) => {
      stopTimer();
      if (!disposedRef.current) {
        setError((evt as unknown as { message?: string })?.message ?? 'Recording error.');
        setPhase('error');
      }
      stopRecorder();
      stopStream();
    });

    try {
      recorder.start(250);
    } catch (e: unknown) {
      const msg = e instanceof Error ? e.message : 'Failed to start recording.';
      setError(msg);
      setPhase('error');
      stopRecorder();
      stopStream();
      return;
    }

    timerRef.current = window.setInterval(() => {
      setRecordingSeconds((s) => s + 1);
    }, 1000);
  }, [cleanupRecordedUrl, startCamera, stopRecorder, stopStream, stopTimer]);

  const finishRecording = useCallback(() => {
    stopRecorder();
  }, [stopRecorder]);

  const recordAgain = useCallback(() => {
    stopTimer();
    stopRecorder();
    stopStream();
    cleanupRecordedUrl();
    setRecordedUrl(null);
    recordedBlobRef.current = null;
    chunksRef.current = [];
    setRecordingSeconds(0);
    void startCamera();
  }, [cleanupRecordedUrl, startCamera, stopRecorder, stopStream, stopTimer]);

  const useClip = useCallback(() => {
    const blob = recordedBlobRef.current;
    if (!blob) return;
    const ext = extForMimeType(blob.type || mimeType);
    const file = new File([blob], `recording-${safeFileNameNow()}.${ext}`, { type: blob.type || mimeType || 'video/webm' });
    onRecordingComplete(file);
  }, [mimeType, onRecordingComplete]);

  useEffect(() => {
    if (!supported) return;

    // Reset on (re-)mount so React 18 StrictMode double-mount doesn't
    // leave disposedRef stuck at true, which blocks the stop handler.
    disposedRef.current = false;

    const onBeforeUnload = () => {
      disposedRef.current = true;
      stopTimer();
      stopRecorder();
      stopStream();
      cleanupRecordedUrl();
    };
    window.addEventListener('beforeunload', onBeforeUnload);

    return () => {
      disposedRef.current = true;
      window.removeEventListener('beforeunload', onBeforeUnload);
      stopTimer();
      stopRecorder();
      stopStream();
      cleanupRecordedUrl();
    };
  }, [cleanupRecordedUrl, startCamera, stopRecorder, stopStream, stopTimer, supported]);

  useEffect(() => {
    return () => {
      if (recordedUrl) URL.revokeObjectURL(recordedUrl);
    };
  }, [recordedUrl]);

  if (phase === 'unsupported') {
    return (
      <Card className="w-full max-w-xl">
        <CardHeader className="pb-3">
          <CardTitle className="text-sm">Record a Clip</CardTitle>
        </CardHeader>
        <CardContent className="text-sm text-muted-foreground">
          This browser doesn’t support in-page recording. Please upload a video file instead.
        </CardContent>
      </Card>
    );
  }

  return (
    <Card className="w-full max-w-xl">
      <CardHeader className="pb-3">
        <div className="flex items-center justify-between gap-3">
          <CardTitle className="text-sm">Record a Clip</CardTitle>
          <div className="flex items-center gap-2">
            {mimeType && <Badge variant="secondary" className="text-[11px]">{mimeType}</Badge>}
            <Badge variant="outline" className="text-[11px]">Not saved on reload</Badge>
          </div>
        </div>
      </CardHeader>
      <CardContent className="space-y-3">
        {error && (
          <div className="flex items-start gap-2 text-xs text-destructive bg-destructive/10 border border-destructive/20 rounded-md p-2">
            <AlertTriangle className="h-4 w-4 shrink-0 mt-0.5" />
            <div className="min-w-0">{error}</div>
          </div>
        )}

        {phase !== 'preview' ? (
          <div className="dark-panel-deep p-2">
            <video ref={liveVideoRef} className="w-full rounded aspect-video bg-black" style={{ transform: 'scaleX(-1)' }} playsInline muted />
          </div>
        ) : (
          <div className="dark-panel-deep p-2">
            {recordedUrl ? (
              <video src={recordedUrl} className="w-full rounded aspect-video bg-black" playsInline controls />
            ) : (
              <div className="aspect-video rounded bg-black/40 flex items-center justify-center text-xs text-muted-foreground">
                No recording
              </div>
            )}
          </div>
        )}

        <div className="flex items-center justify-between gap-3">
          <div className="text-xs text-muted-foreground">
            {phase === 'recording' ? (
              <span className="inline-flex items-center gap-2">
                <span className="inline-flex items-center gap-1.5 text-rose-500">
                  <Circle className="h-3.5 w-3.5 fill-current" />
                  REC
                </span>
                {formatSeconds(recordingSeconds)}
              </span>
            ) : (
              <span>Recorded clips stay in memory only.</span>
            )}
          </div>

          <div className="flex items-center gap-2">
            {phase === 'recording' ? (
              <Button variant="destructive" size="sm" onClick={finishRecording} className="gap-1.5">
                <Square className="h-3.5 w-3.5" />
                Stop
              </Button>
            ) : phase === 'preview' ? (
              <>
                <Button variant="outline" size="sm" onClick={recordAgain} className="gap-1.5">
                  <RotateCcw className="h-3.5 w-3.5" />
                  Retake
                </Button>
                <Button size="sm" onClick={useClip} className="gap-1.5" disabled={!recordedUrl}>
                  <Check className="h-3.5 w-3.5" />
                  Use Clip
                </Button>
              </>
            ) : (
              <Button size="sm" onClick={startRecording} className="gap-1.5" disabled={phase === 'loading'}>
                <Circle className="h-3.5 w-3.5" />
                Start Recording
              </Button>
            )}
          </div>
        </div>
      </CardContent>
    </Card>
  );
}
