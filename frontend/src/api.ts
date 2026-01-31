import type { HealthData, JobProgressResponse, ProcessingResponse } from './types';

type BackendOrigin = string | null;

function normalizeOrigin(origin: string): string {
  return origin.replace(/\/+$/, '');
}

function isAbsoluteUrl(url: string): boolean {
  return /^https?:\/\//i.test(url);
}

const ENV_BACKEND_ORIGIN = (() => {
  const raw = (import.meta.env.VITE_BACKEND_ORIGIN as string | undefined) ?? '';
  return raw ? normalizeOrigin(raw) : null;
})();

let resolvedBackendOrigin: BackendOrigin | undefined = undefined;

function buildUrl(origin: BackendOrigin, path: string): string {
  const normalizedPath = path.startsWith('/') ? path : `/${path}`;
  if (!origin) return normalizedPath;
  return `${origin}${normalizedPath}`;
}

function candidateOrigins(): BackendOrigin[] {
  if (ENV_BACKEND_ORIGIN) return [ENV_BACKEND_ORIGIN];
  if (import.meta.env.DEV) return [null]; // rely on Vite proxy
  return [normalizeOrigin(window.location.origin), 'http://localhost:8001', 'http://127.0.0.1:8001'];
}

function shouldTryNextOrigin(origin: BackendOrigin, res: Response): boolean {
  if (res.status !== 404) return false;
  if (ENV_BACKEND_ORIGIN) return false;
  if (import.meta.env.DEV) return false;
  return origin === normalizeOrigin(window.location.origin);
}

async function apiFetch(path: string, init?: RequestInit): Promise<Response> {
  const candidates = resolvedBackendOrigin !== undefined ? [resolvedBackendOrigin] : candidateOrigins();
  let lastError: unknown = null;

  for (const origin of candidates) {
    const url = buildUrl(origin, path);
    try {
      const res = await fetch(url, init);

      if (shouldTryNextOrigin(origin, res)) {
        lastError = new Error(`Backend not found at ${url}`);
        continue;
      }

      // Cache the first origin that looks like the backend.
      if (resolvedBackendOrigin === undefined) resolvedBackendOrigin = origin;
      return res;
    } catch (err) {
      lastError = err;
      // If we already had a cached origin and it failed, clear and fall back.
      if (resolvedBackendOrigin !== undefined) {
        resolvedBackendOrigin = undefined;
        return apiFetch(path, init);
      }
    }
  }

  throw lastError instanceof Error ? lastError : new Error('Request failed');
}

export interface UploadProgress {
  loadedBytes: number;
  totalBytes: number | null;
  percent: number | null;
}

export type UploadProgressCallback = (progress: UploadProgress) => void;

interface UploadOptions {
  jobId?: string;
  onUploadProgress?: UploadProgressCallback;
}

function shouldTryNextOriginStatus(origin: BackendOrigin, status: number): boolean {
  if (status !== 404) return false;
  if (ENV_BACKEND_ORIGIN) return false;
  if (import.meta.env.DEV) return false;
  return origin === normalizeOrigin(window.location.origin);
}

function xhrPostForm(
  url: string,
  form: FormData,
  onUploadProgress?: UploadProgressCallback,
): Promise<{ status: number; responseText: string }> {
  return new Promise((resolve, reject) => {
    const xhr = new XMLHttpRequest();
    xhr.open('POST', url);
    xhr.responseType = 'text';

    if (onUploadProgress) {
      xhr.upload.onprogress = (ev) => {
        if (ev.lengthComputable && ev.total > 0) {
          onUploadProgress({
            loadedBytes: ev.loaded,
            totalBytes: ev.total,
            percent: (ev.loaded / ev.total) * 100,
          });
        } else {
          onUploadProgress({ loadedBytes: ev.loaded, totalBytes: null, percent: null });
        }
      };
    }

    xhr.onload = () => resolve({ status: xhr.status, responseText: xhr.responseText });
    class XhrNetworkError extends Error {
      constructor() {
        super(`Network error while uploading to ${url}`);
        this.name = 'XhrNetworkError';
      }
    }

    xhr.onerror = () => reject(new XhrNetworkError());
    xhr.send(form);
  });
}

async function apiUploadJson(path: string, form: FormData, opts?: UploadOptions): Promise<unknown> {
  const candidates = resolvedBackendOrigin !== undefined ? [resolvedBackendOrigin] : candidateOrigins();
  let lastError: unknown = null;

  for (const origin of candidates) {
    const url = buildUrl(origin, path);
    try {
      const { status, responseText } = await xhrPostForm(url, form, opts?.onUploadProgress);

      if (shouldTryNextOriginStatus(origin, status)) {
        lastError = new Error(`Backend not found at ${url}`);
        continue;
      }

      // Cache the first origin that looks like the backend.
      if (resolvedBackendOrigin === undefined) resolvedBackendOrigin = origin;

      try {
        return JSON.parse(responseText) as unknown;
      } catch {
        throw new Error(`Invalid JSON response (${status}) from ${url}`);
      }
    } catch (err) {
      lastError = err;
      // If we already had a cached origin and it failed at the network layer, clear and fall back.
      if (resolvedBackendOrigin !== undefined && err instanceof Error && err.name === 'XhrNetworkError') {
        resolvedBackendOrigin = undefined;
        return apiUploadJson(path, form, opts);
      }
    }
  }

  throw lastError instanceof Error ? lastError : new Error('Request failed');
}

export function resolveBackendUrl(urlOrPath: string): string {
  if (!urlOrPath) return urlOrPath;
  if (isAbsoluteUrl(urlOrPath)) return urlOrPath;

  const origin =
    resolvedBackendOrigin !== undefined ? resolvedBackendOrigin : ENV_BACKEND_ORIGIN || (import.meta.env.DEV ? null : normalizeOrigin(window.location.origin));
  return buildUrl(origin, urlOrPath);
}

export async function checkHealth(): Promise<HealthData> {
  const res = await apiFetch('/health');
  if (!res.ok) throw new Error(`Health check failed: ${res.status}`);
  return res.json();
}

export async function processMotion(
  file: File,
  magnification: number,
  mode: string,
  maxFrames?: number,
  opts?: UploadOptions,
): Promise<ProcessingResponse> {
  const form = new FormData();
  form.append('video', file);
  form.append('magnification', magnification.toString());
  form.append('mode', mode);
  if (opts?.jobId) form.append('job_id', opts.jobId);
  if (typeof maxFrames === 'number' && Number.isFinite(maxFrames) && maxFrames > 0) {
    form.append('max_frames', Math.round(maxFrames).toString());
  }
  const payload = (await apiUploadJson('/magnify/motion', form, opts)) as ProcessingResponse;
  return payload;
}

export async function processColor(
  file: File,
  freqMin: number,
  freqMax: number,
  amplification: number,
  pyramidLevels: number,
  roi?: { x: number; y: number; w: number; h: number },
  opts?: UploadOptions,
): Promise<ProcessingResponse> {
  const form = new FormData();
  form.append('video', file);
  form.append('freq_min', freqMin.toString());
  form.append('freq_max', freqMax.toString());
  form.append('amplification', amplification.toString());
  form.append('pyramid_levels', pyramidLevels.toString());
  if (opts?.jobId) form.append('job_id', opts.jobId);
  if (roi) {
    form.append('roi_x', roi.x.toString());
    form.append('roi_y', roi.y.toString());
    form.append('roi_w', roi.w.toString());
    form.append('roi_h', roi.h.toString());
  }
  const payload = (await apiUploadJson('/magnify/color', form, opts)) as ProcessingResponse;
  return payload;
}

export async function processHeartRate(
  file: File,
  method: string,
  opts?: UploadOptions,
): Promise<ProcessingResponse> {
  const form = new FormData();
  form.append('video', file);
  form.append('method', method);
  if (opts?.jobId) form.append('job_id', opts.jobId);
  const payload = (await apiUploadJson('/vitals/heartrate', form, opts)) as ProcessingResponse;
  return payload;
}

export async function processRealtime(
  file: File,
  method: string,
  winsize: number,
  opts?: UploadOptions,
): Promise<ProcessingResponse> {
  const form = new FormData();
  form.append('video', file);
  form.append('method', method);
  form.append('winsize', winsize.toString());
  if (opts?.jobId) form.append('job_id', opts.jobId);
  const payload = (await apiUploadJson('/vitals/realtime', form, opts)) as ProcessingResponse;
  return payload;
}

export async function recoverAudio(
  file: File,
  roi?: { x: number; y: number; w: number; h: number },
  opts?: UploadOptions,
): Promise<ProcessingResponse> {
  const form = new FormData();
  form.append('video', file);
  if (opts?.jobId) form.append('job_id', opts.jobId);
  if (roi) {
    form.append('roi_x', roi.x.toString());
    form.append('roi_y', roi.y.toString());
    form.append('roi_w', roi.w.toString());
    form.append('roi_h', roi.h.toString());
  }
  const payload = (await apiUploadJson('/audio/recover', form, opts)) as ProcessingResponse;
  return payload;
}

export async function getJobProgress(jobId: string): Promise<JobProgressResponse> {
  const res = await apiFetch(`/progress/${encodeURIComponent(jobId)}`);
  if (!res.ok) throw new Error(`Progress fetch failed: ${res.status}`);
  return res.json();
}

export function connectVitalsWebSocket(
  onMessage: (data: unknown) => void,
  onError?: (err: Event) => void,
): WebSocket {
  const origin =
    resolvedBackendOrigin !== undefined ? resolvedBackendOrigin : ENV_BACKEND_ORIGIN || (import.meta.env.DEV ? null : normalizeOrigin(window.location.origin));
  const httpBase = origin ? origin : window.location.origin;
  const u = new URL(httpBase);
  const wsProtocol = u.protocol === 'https:' ? 'wss:' : 'ws:';
  const ws = new WebSocket(`${wsProtocol}//${u.host}/vitals/ws/vitals`);
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
