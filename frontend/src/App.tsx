import { useState, useCallback } from 'react';
import type { JobProgressResponse, Mode, Stage, ProcessingResponse, ROI } from './types';
import { MODE_CONFIGS } from './types';
import { getJobProgress, processMotion, processColor, processHeartRate, processRealtime, recoverAudio } from './api';
import { useBackendHealth } from './hooks/useBackendHealth';
import { Header } from './components/Header';
import { StepIndicator } from './components/StepIndicator';
import { VideoUploader } from './components/VideoUploader';
import { ConfigPanel } from './components/ConfigPanel';
import { ProcessingIndicator } from './components/ProcessingIndicator';
import { ResultsViewer } from './components/ResultsViewer';
import { WebcamPanel } from './components/WebcamPanel';
import { ROISelector } from './components/ROISelector';
import { ToastContainer } from './components/Toast';
import { showToast } from './toast';
import { Tabs, TabsList, TabsTrigger } from './components/ui/tabs';
import { Move, Palette, HeartPulse, Radio, AudioLines } from 'lucide-react';

const ICON_MAP: Record<string, React.ReactNode> = {
  Move: <Move className="h-4 w-4" />,
  Palette: <Palette className="h-4 w-4" />,
  HeartPulse: <HeartPulse className="h-4 w-4" />,
  Radio: <Radio className="h-4 w-4" />,
  AudioLines: <AudioLines className="h-4 w-4" />,
};

const MODES: Mode[] = ['motion', 'color', 'heartrate', 'realtime', 'audio'];

type ProcessingProgressState = {
  jobId: string;
  uploadPercent: number;
  backend: JobProgressResponse | null;
};

type ModeState = {
  stage: Stage;
  file: File | null;
  result: ProcessingResponse | null;
  processingProgress: ProcessingProgressState | null;
  cameraActive: boolean;
  roi: ROI | undefined;
  showROI: boolean;
};

function newJobId(): string {
  if (typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function') return crypto.randomUUID();
  return `${Date.now()}-${Math.random().toString(16).slice(2)}`;
}

function App() {
  const { health } = useBackendHealth();
  const [mode, setMode] = useState<Mode>('motion');
  const [modeStates, setModeStates] = useState<Record<Mode, ModeState>>(() => {
    const initialState = (): ModeState => ({
      stage: 'upload',
      file: null,
      result: null,
      processingProgress: null,
      cameraActive: false,
      roi: undefined,
      showROI: false,
    });
    return {
      motion: initialState(),
      color: initialState(),
      heartrate: initialState(),
      realtime: initialState(),
      audio: initialState(),
    };
  });

  const currentState = modeStates[mode];
  const stage = currentState.stage;
  const file = currentState.file;
  const result = currentState.result;
  const processingProgress = currentState.processingProgress;
  const cameraActive = currentState.cameraActive;
  const showROI = currentState.showROI;

  const handleModeChange = useCallback((m: Mode) => {
    setMode(m);
  }, []);

  const handleFileSelect = useCallback(
    (f: File) => {
      const config = MODE_CONFIGS[mode];
      setModeStates((prev) => {
        const state = prev[mode];
        return {
          ...prev,
          [mode]: {
            ...state,
            stage: config.needsROI ? 'upload' : 'configure',
            file: f,
            result: null,
            processingProgress: null,
            cameraActive: false,
            roi: undefined,
            showROI: config.needsROI,
          },
        };
      });
    },
    [mode],
  );

  const handleROISelect = useCallback((r: ROI) => {
    setModeStates((prev) => {
      const state = prev[mode];
      return {
        ...prev,
        [mode]: { ...state, roi: r, showROI: false, stage: 'configure' },
      };
    });
  }, [mode]);

  const handleROISkip = useCallback(() => {
    setModeStates((prev) => {
      const state = prev[mode];
      return {
        ...prev,
        [mode]: { ...state, roi: undefined, showROI: false, stage: 'configure' },
      };
    });
  }, [mode]);

  const handleCameraToggle = useCallback(() => {
    setModeStates((prev) => {
      const state = prev[mode];
      return {
        ...prev,
        [mode]: { ...state, cameraActive: !state.cameraActive },
      };
    });
  }, [mode]);

  const handleProcess = useCallback(
    async (params: Record<string, unknown>) => {
      const jobMode = mode;
      const jobFile = modeStates[jobMode].file;
      const jobRoi = modeStates[jobMode].roi;
      if (!jobFile) return;

      const jobId = newJobId();
      setModeStates((prev) => {
        const state = prev[jobMode];
        return {
          ...prev,
          [jobMode]: {
            ...state,
            stage: 'processing',
            result: null,
            processingProgress: { jobId, uploadPercent: 0, backend: null },
          },
        };
      });

      const updateJobProgress = (updater: (prev: ProcessingProgressState) => ProcessingProgressState) => {
        setModeStates((prev) => {
          const state = prev[jobMode];
          const currentProgress = state.processingProgress;
          if (!currentProgress || currentProgress.jobId !== jobId) return prev;
          return {
            ...prev,
            [jobMode]: {
              ...state,
              processingProgress: updater(currentProgress),
            },
          };
        });
      };

      let stopped = false;
      let inFlight = false;
      const poll = async () => {
        if (stopped || inFlight) return;
        inFlight = true;
        try {
          const p = await getJobProgress(jobId);
          updateJobProgress((prev) => ({ ...prev, backend: p }));
        } catch {
          // Ignore transient polling errors.
        } finally {
          inFlight = false;
        }
      };

      poll();
      const pollId = window.setInterval(poll, 400);

      try {
        let res: ProcessingResponse;
        switch (jobMode) {
          case 'motion':
            res = await processMotion(
              jobFile,
              typeof params.engine === 'string' ? params.engine : 'stbvmm',
              typeof params.magnification === 'number' ? params.magnification : Number(params.magnification),
              typeof params.mode === 'string' ? params.mode : 'static',
              typeof params.maxFrames === 'number' ? params.maxFrames : (params.maxFrames ? Number(params.maxFrames) : undefined),
              typeof params.maxSide === 'number' ? params.maxSide : (params.maxSide ? Number(params.maxSide) : undefined),
              {
                jobId,
                onUploadProgress: (p) => {
                  if (typeof p.percent === 'number') {
                    const percent = p.percent;
                    updateJobProgress((prev) => ({
                      ...prev,
                      uploadPercent: Math.min(100, Math.max(0, percent)),
                    }));
                  }
                },
              },
            );
            break;
          case 'color':
            res = await processColor(
              jobFile,
              typeof params.freqMin === 'number' ? params.freqMin : Number(params.freqMin),
              typeof params.freqMax === 'number' ? params.freqMax : Number(params.freqMax),
              typeof params.amplification === 'number' ? params.amplification : Number(params.amplification),
              typeof params.pyramidLevels === 'number' ? params.pyramidLevels : Number(params.pyramidLevels),
              jobRoi,
              {
                jobId,
                onUploadProgress: (p) => {
                  if (typeof p.percent === 'number') {
                    const percent = p.percent;
                    updateJobProgress((prev) => ({
                      ...prev,
                      uploadPercent: Math.min(100, Math.max(0, percent)),
                    }));
                  }
                },
              },
            );
            break;
          case 'heartrate':
            res = await processHeartRate(jobFile, typeof params.engine === 'string' ? params.engine : 'rppg', typeof params.method === 'string' ? params.method : 'ALL', {
              jobId,
              onUploadProgress: (p) => {
                if (typeof p.percent === 'number') {
                  const percent = p.percent;
                  updateJobProgress((prev) => ({
                    ...prev,
                    uploadPercent: Math.min(100, Math.max(0, percent)),
                  }));
                }
              },
            });
            break;
          case 'realtime':
            res = await processRealtime(
              jobFile,
              typeof params.method === 'string' ? params.method : 'cpu_POS',
              typeof params.winsize === 'number' ? params.winsize : Number(params.winsize),
              {
                jobId,
                onUploadProgress: (p) => {
                  if (typeof p.percent === 'number') {
                    const percent = p.percent;
                    updateJobProgress((prev) => ({
                      ...prev,
                      uploadPercent: Math.min(100, Math.max(0, percent)),
                    }));
                  }
                },
              },
            );
            break;
          case 'audio':
            res = await recoverAudio(jobFile, jobRoi, {
              jobId,
              onUploadProgress: (p) => {
                if (typeof p.percent === 'number') {
                  const percent = p.percent;
                  updateJobProgress((prev) => ({
                    ...prev,
                    uploadPercent: Math.min(100, Math.max(0, percent)),
                  }));
                }
              },
            });
            break;
          default:
            res = { success: false, error: 'Unknown mode', warnings: [], processing_time_seconds: 0 };
        }

        stopped = true;
        clearInterval(pollId);
        setModeStates((prev) => {
          const state = prev[jobMode];
          const currentProgress = state.processingProgress;
          if (!currentProgress || currentProgress.jobId !== jobId) return prev;
          return {
            ...prev,
            [jobMode]: {
              ...state,
              stage: 'results',
              result: res,
              processingProgress: { ...currentProgress, uploadPercent: 100 },
            },
          };
        });
        if (!res.success) {
          showToast(res.error || 'Processing failed', 'error');
        } else if (res.warnings.length > 0) {
          res.warnings.forEach((w) => showToast(w, 'warning'));
        }
      } catch (err: unknown) {
        stopped = true;
        clearInterval(pollId);
        const errMsg = err instanceof Error ? err.message : 'Processing request failed';
        const failure: ProcessingResponse = {
          success: false,
          error: errMsg,
          warnings: [],
          processing_time_seconds: 0,
        };
        setModeStates((prev) => {
          const state = prev[jobMode];
          const currentProgress = state.processingProgress;
          if (!currentProgress || currentProgress.jobId !== jobId) return prev;
          return {
            ...prev,
            [jobMode]: {
              ...state,
              stage: 'results',
              result: failure,
              processingProgress: { ...currentProgress, uploadPercent: 100 },
            },
          };
        });
        showToast(errMsg, 'error');
      }
    },
    [mode, modeStates],
  );

  const handleReset = useCallback(() => {
    setModeStates((prev) => {
      const state = prev[mode];
      return {
        ...prev,
        [mode]: {
          ...state,
          stage: 'upload',
          file: null,
          result: null,
          processingProgress: null,
          cameraActive: false,
          roi: undefined,
          showROI: false,
        },
      };
    });
  }, [mode]);

  const renderMain = () => {
    // Webcam mode takes over the main panel
    if (cameraActive && mode === 'realtime') {
      return (
        <WebcamPanel
          onStop={() =>
            setModeStates((prev) => ({
              ...prev,
              realtime: { ...prev.realtime, cameraActive: false },
            }))
          }
        />
      );
    }

    if (showROI && file) {
      return <ROISelector videoFile={file} onROISelect={handleROISelect} onSkip={handleROISkip} />;
    }

    switch (stage) {
      case 'upload':
        return (
          <VideoUploader
            onFileSelect={handleFileSelect}
            onCameraToggle={handleCameraToggle}
            cameraActive={cameraActive}
            showCameraButton={mode === 'realtime'}
          />
        );
      case 'configure':
        return <ConfigPanel mode={mode} onSubmit={handleProcess} fileName={file?.name} health={health} />;
      case 'processing':
        return <ProcessingIndicator progress={processingProgress} />;
      case 'results':
        return result ? (
          <ResultsViewer mode={mode} result={result} originalFile={file || undefined} onReset={handleReset} />
        ) : null;
    }
  };

  return (
    <div className="h-screen flex flex-col bg-background">
      <Header health={health} />

      {/* Mode tabs */}
      <div className="bg-card border-b px-4">
        <Tabs value={mode} onValueChange={(v) => handleModeChange(v as Mode)}>
          <TabsList className="h-10 bg-transparent gap-1 p-0">
            {MODES.map((m) => {
              const config = MODE_CONFIGS[m];
              const backend = health?.backends?.[config.backendKey];
              const usable = backend ? (backend.usable ?? backend.available) : false;
              const title =
                !usable && health
                  ? (backend?.error ? `${config.label} unavailable: ${backend.error}` : `${config.label} backend unavailable`)
                  : config.description;

              return (
                <TabsTrigger
                  key={m}
                  value={m}
                  disabled={!usable && !!health}
                  className="data-[state=active]:bg-primary/10 data-[state=active]:text-primary gap-1.5 text-xs px-3"
                  title={title}
                >
                  {ICON_MAP[config.icon]}
                  {config.label}
                </TabsTrigger>
              );
            })}
          </TabsList>
        </Tabs>
      </div>

      <StepIndicator currentStage={stage} />

      <main className="flex-1 overflow-y-auto">
        {renderMain()}
      </main>

      <ToastContainer />
    </div>
  );
}

export default App;
