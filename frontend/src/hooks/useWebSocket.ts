import { useState, useRef, useCallback, useEffect } from 'react';

interface VitalsData {
  bpm?: number;
  bpm_mean?: number;
  bvp?: number[];
  confidence?: number;
  error?: string;
  status?: string;
  frames_collected?: number;
  frames_needed?: number;
}

export function useVitalsWebSocket() {
  const wsRef = useRef<WebSocket | null>(null);
  const connectAttemptRef = useRef<number>(0);
  const [connected, setConnected] = useState(false);
  const [connectionError, setConnectionError] = useState<string | null>(null);
  const [latestData, setLatestData] = useState<VitalsData | null>(null);
  const [bpmHistory, setBpmHistory] = useState<{ time: number; bpm: number }[]>([]);
  const [collecting, setCollecting] = useState<{ collected: number; needed: number } | null>(null);

  const wsCandidates = useCallback((): string[] => {
    const envOrigin = (import.meta.env.VITE_BACKEND_ORIGIN as string | undefined) ?? '';
    if (envOrigin) {
      const u = new URL(envOrigin);
      const wsProto = u.protocol === 'https:' ? 'wss:' : 'ws:';
      return [`${wsProto}//${u.host}/vitals/ws/vitals`];
    }

    const wsProto = window.location.protocol === 'https:' ? 'wss:' : 'ws:';
    const primary = `${wsProto}//${window.location.host}/vitals/ws/vitals`;
    if (import.meta.env.DEV) return [primary];

    const fallbacks = [`${wsProto}//localhost:8000/vitals/ws/vitals`, `${wsProto}//127.0.0.1:8000/vitals/ws/vitals`];
    return [primary, ...fallbacks].filter((v, i, arr) => arr.indexOf(v) === i);
  }, []);

  const connect = useCallback(() => {
    if (wsRef.current?.readyState === WebSocket.OPEN || wsRef.current?.readyState === WebSocket.CONNECTING) return;

    const candidates = wsCandidates();
    const attemptId = Date.now();
    connectAttemptRef.current = attemptId;
    setConnectionError(null);
    let idx = 0;

    const tryConnect = () => {
      if (connectAttemptRef.current !== attemptId) return;
      const url = candidates[idx];
      const ws = new WebSocket(url);
      let opened = false;

      ws.onopen = () => {
        if (connectAttemptRef.current !== attemptId) return;
        opened = true;
        setConnected(true);
        setConnectionError(null);
      };

      ws.onerror = () => {
        if (connectAttemptRef.current !== attemptId) return;
        setConnectionError(`WebSocket error while connecting to ${url}`);
      };

      ws.onclose = () => {
        if (connectAttemptRef.current !== attemptId) return;
        setConnected(false);
        if (wsRef.current === ws) wsRef.current = null;

        if (!opened && idx < candidates.length - 1) {
          idx += 1;
          tryConnect();
          return;
        }

        if (!opened) {
          setConnectionError(`Unable to connect to ${url}. Is the backend running?`);
        }
      };

      ws.onmessage = (ev) => {
        try {
          const data: VitalsData = JSON.parse(ev.data);

          if (data.status === 'collecting' && typeof data.frames_collected === 'number' && typeof data.frames_needed === 'number') {
            setCollecting({ collected: data.frames_collected, needed: data.frames_needed });
            return;
          }

          setCollecting(null);
          setLatestData(data);
          if (typeof data.error === 'string' && data.error) setConnectionError(data.error);
          if (typeof data.bpm_mean === 'number' && Number.isFinite(data.bpm_mean)) {
            setBpmHistory((prev) => [
              ...prev.slice(-59),
              { time: Date.now(), bpm: data.bpm_mean! },
            ]);
          }
        } catch {
          // Ignore non-JSON frames.
        }
      };

      wsRef.current = ws;
    };

    tryConnect();
  }, [wsCandidates]);

  const disconnect = useCallback(() => {
    connectAttemptRef.current = 0;
    wsRef.current?.close();
    wsRef.current = null;
    setConnected(false);
    setCollecting(null);
    setConnectionError(null);
  }, []);

  const sendFrame = useCallback((jpeg: Blob) => {
    if (wsRef.current?.readyState === WebSocket.OPEN) {
      jpeg.arrayBuffer().then((buf) => wsRef.current?.send(buf));
    }
  }, []);

  useEffect(() => {
    return () => {
      wsRef.current?.close();
    };
  }, []);

  return { connected, connectionError, connect, disconnect, sendFrame, latestData, bpmHistory, collecting };
}
