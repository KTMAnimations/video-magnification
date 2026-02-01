export type Mode = 'motion' | 'color' | 'heartrate' | 'realtime' | 'audio';
export type Stage = 'upload' | 'configure' | 'processing' | 'results';

export interface BackendInfo {
  label: string;
  available: boolean;
  error: string | null;
}

export interface HealthData {
  status: string;
  backends: Record<string, BackendInfo>;
}

export interface ProcessingResponse {
  success: boolean;
  output_url?: string;
  data?: Record<string, unknown>;
  error?: string;
  warnings: string[];
  processing_time_seconds: number;
}

export interface JobProgressResponse {
  job_id: string;
  status: 'not_found' | 'running' | 'complete' | 'error';
  stage?: string | null;
  message?: string | null;
  current?: number | null;
  total?: number | null;
  percent?: number | null;
  error?: string | null;
  started_at?: number | null;
  updated_at?: number | null;
}

export interface ROI {
  x: number;
  y: number;
  w: number;
  h: number;
}

export interface ModeConfig {
  label: string;
  description: string;
  backendKey: string;
  needsROI: boolean;
  icon: string;
}

export const MODE_CONFIGS: Record<Mode, ModeConfig> = {
  motion: {
    label: 'Motion',
    description: 'Amplify subtle motions (select a model)',
    backendKey: 'motion',
    needsROI: false,
    icon: 'Move',
  },
  color: {
    label: 'Color',
    description: 'Eulerian color magnification to reveal blood flow, vibrations',
    backendKey: 'evm',
    needsROI: true,
    icon: 'Palette',
  },
  heartrate: {
    label: 'Heart Rate',
    description: 'Extract pulse from face video (select a model)',
    backendKey: 'heartrate',
    needsROI: false,
    icon: 'HeartPulse',
  },
  realtime: {
    label: 'Real-time',
    description: 'Live vitals monitoring using pyVHR with webcam',
    backendKey: 'pyvhr',
    needsROI: false,
    icon: 'Radio',
  },
  audio: {
    label: 'Audio',
    description: 'Recover sound from subtle visual vibrations',
    backendKey: 'visualmic',
    needsROI: true,
    icon: 'AudioLines',
  },
};
