import type { HealthData, ProcessingResponse } from './types';

const API_BASE = '';  // Uses Vite proxy

export async function checkHealth(): Promise<HealthData> {
  const res = await fetch(`${API_BASE}/health`);
  if (!res.ok) throw new Error(`Health check failed: ${res.status}`);
  return res.json();
}

export async function processMotion(
  file: File,
  magnification: number,
  mode: string,
): Promise<ProcessingResponse> {
  const form = new FormData();
  form.append('video', file);
  form.append('magnification', magnification.toString());
  form.append('mode', mode);
  const res = await fetch(`${API_BASE}/magnify/motion`, { method: 'POST', body: form });
  return res.json();
}

export async function processColor(
  file: File,
  freqMin: number,
  freqMax: number,
  amplification: number,
  pyramidLevels: number,
  roi?: { x: number; y: number; w: number; h: number },
): Promise<ProcessingResponse> {
  const form = new FormData();
  form.append('video', file);
  form.append('freq_min', freqMin.toString());
  form.append('freq_max', freqMax.toString());
  form.append('amplification', amplification.toString());
  form.append('pyramid_levels', pyramidLevels.toString());
  if (roi) {
    form.append('roi_x', roi.x.toString());
    form.append('roi_y', roi.y.toString());
    form.append('roi_w', roi.w.toString());
    form.append('roi_h', roi.h.toString());
  }
  const res = await fetch(`${API_BASE}/magnify/color`, { method: 'POST', body: form });
  return res.json();
}

export async function processHeartRate(
  file: File,
  method: string,
): Promise<ProcessingResponse> {
  const form = new FormData();
  form.append('video', file);
  form.append('method', method);
  const res = await fetch(`${API_BASE}/vitals/heartrate`, { method: 'POST', body: form });
  return res.json();
}

export async function processRealtime(
  file: File,
  method: string,
  winsize: number,
): Promise<ProcessingResponse> {
  const form = new FormData();
  form.append('video', file);
  form.append('method', method);
  form.append('winsize', winsize.toString());
  const res = await fetch(`${API_BASE}/vitals/realtime`, { method: 'POST', body: form });
  return res.json();
}

export async function recoverAudio(
  file: File,
  roi?: { x: number; y: number; w: number; h: number },
): Promise<ProcessingResponse> {
  const form = new FormData();
  form.append('video', file);
  if (roi) {
    form.append('roi_x', roi.x.toString());
    form.append('roi_y', roi.y.toString());
    form.append('roi_w', roi.w.toString());
    form.append('roi_h', roi.h.toString());
  }
  const res = await fetch(`${API_BASE}/audio/recover`, { method: 'POST', body: form });
  return res.json();
}

export function connectVitalsWebSocket(
  onMessage: (data: unknown) => void,
  onError?: (err: Event) => void,
): WebSocket {
  const protocol = window.location.protocol === 'https:' ? 'wss:' : 'ws:';
  const ws = new WebSocket(`${protocol}//${window.location.host}/vitals/ws/vitals`);
  ws.onmessage = (ev) => {
    try {
      const data = JSON.parse(ev.data);
      onMessage(data);
    } catch {
      // Ignore non-JSON frames.
    }
  };
  if (onError) ws.onerror = onError;
  return ws;
}
