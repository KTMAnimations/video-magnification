import { useState, useRef, useCallback, useEffect } from 'react';

interface VitalsData {
  bpm?: number;
  bpm_mean?: number;
  bvp?: number[];
  confidence?: number;
  error?: string;
}

export function useVitalsWebSocket() {
  const wsRef = useRef<WebSocket | null>(null);
  const [connected, setConnected] = useState(false);
  const [latestData, setLatestData] = useState<VitalsData | null>(null);
  const [bpmHistory, setBpmHistory] = useState<{ time: number; bpm: number }[]>([]);

  const connect = useCallback(() => {
    if (wsRef.current?.readyState === WebSocket.OPEN) return;

    const protocol = window.location.protocol === 'https:' ? 'wss:' : 'ws:';
    const ws = new WebSocket(`${protocol}//${window.location.host}/vitals/ws/vitals`);

    ws.onopen = () => setConnected(true);
    ws.onclose = () => setConnected(false);
    ws.onmessage = (ev) => {
      try {
        const data: VitalsData = JSON.parse(ev.data);
        setLatestData(data);
        if (data.bpm_mean) {
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
  }, []);

  const disconnect = useCallback(() => {
    wsRef.current?.close();
    wsRef.current = null;
    setConnected(false);
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

  return { connected, connect, disconnect, sendFrame, latestData, bpmHistory };
}
