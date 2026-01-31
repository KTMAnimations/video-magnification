import { useState, useCallback } from 'react';
import type { Mode, Stage, ProcessingResponse, ROI } from './types';
import { MODE_CONFIGS } from './types';
import { processMotion, processColor, processHeartRate, processRealtime, recoverAudio } from './api';
import { useBackendHealth } from './hooks/useBackendHealth';
import { Header } from './components/Header';
import { Sidebar } from './components/Sidebar';
import { StatusBar } from './components/StatusBar';
import { VideoUploader } from './components/VideoUploader';
import { ConfigPanel } from './components/ConfigPanel';
import { ProcessingIndicator } from './components/ProcessingIndicator';
import { ResultsViewer } from './components/ResultsViewer';
import { WebcamPanel } from './components/WebcamPanel';
import { ROISelector } from './components/ROISelector';
import { ToastContainer } from './components/Toast';
import { showToast } from './toast';
import './App.css';

function App() {
  const { health, loading } = useBackendHealth();
  const [mode, setMode] = useState<Mode>('motion');
  const [stage, setStage] = useState<Stage>('upload');
  const [file, setFile] = useState<File | null>(null);
  const [result, setResult] = useState<ProcessingResponse | null>(null);
  const [cameraActive, setCameraActive] = useState(false);
  const [roi, setRoi] = useState<ROI | undefined>(undefined);
  const [showROI, setShowROI] = useState(false);

  const handleModeChange = useCallback((m: Mode) => {
    setMode(m);
    setStage('upload');
    setFile(null);
    setResult(null);
    setCameraActive(false);
    setRoi(undefined);
    setShowROI(false);
  }, []);

  const handleFileSelect = useCallback(
    (f: File) => {
      setFile(f);
      const config = MODE_CONFIGS[mode];
      if (config.needsROI) {
        setShowROI(true);
      } else {
        setStage('configure');
      }
    },
    [mode],
  );

  const handleROISelect = useCallback((r: ROI) => {
    setRoi(r);
    setShowROI(false);
    setStage('configure');
  }, []);

  const handleROISkip = useCallback(() => {
    setRoi(undefined);
    setShowROI(false);
    setStage('configure');
  }, []);

  const handleCameraToggle = useCallback(() => {
    setCameraActive((prev) => !prev);
  }, []);

  const handleProcess = useCallback(
    async (params: Record<string, unknown>) => {
      if (!file) return;
      setStage('processing');

      try {
        let res: ProcessingResponse;
        switch (mode) {
          case 'motion':
            res = await processMotion(
              file,
              typeof params.magnification === 'number' ? params.magnification : Number(params.magnification),
              typeof params.mode === 'string' ? params.mode : 'static',
            );
            break;
          case 'color':
            res = await processColor(
              file,
              typeof params.freqMin === 'number' ? params.freqMin : Number(params.freqMin),
              typeof params.freqMax === 'number' ? params.freqMax : Number(params.freqMax),
              typeof params.amplification === 'number' ? params.amplification : Number(params.amplification),
              typeof params.pyramidLevels === 'number' ? params.pyramidLevels : Number(params.pyramidLevels),
              roi,
            );
            break;
          case 'heartrate':
            res = await processHeartRate(file, typeof params.method === 'string' ? params.method : 'POS_WANG');
            break;
          case 'realtime':
            res = await processRealtime(
              file,
              typeof params.method === 'string' ? params.method : 'cpu_POS',
              typeof params.winsize === 'number' ? params.winsize : Number(params.winsize),
            );
            break;
          case 'audio':
            res = await recoverAudio(file, roi);
            break;
          default:
            res = { success: false, error: 'Unknown mode', warnings: [], processing_time_seconds: 0 };
        }
        setResult(res);
        setStage('results');
        if (!res.success) {
          showToast(res.error || 'Processing failed', 'error');
        } else if (res.warnings.length > 0) {
          res.warnings.forEach((w) => showToast(w, 'warning'));
        }
      } catch (err: unknown) {
        const errMsg = err instanceof Error ? err.message : 'Processing request failed';
        setResult({
          success: false,
          error: errMsg,
          warnings: [],
          processing_time_seconds: 0,
        });
        setStage('results');
        showToast(errMsg, 'error');
      }
    },
    [file, mode, roi],
  );

  const handleReset = useCallback(() => {
    setStage('upload');
    setFile(null);
    setResult(null);
    setRoi(undefined);
    setShowROI(false);
  }, []);

  const renderMain = () => {
    // Webcam mode takes over the main panel
    if (cameraActive && mode === 'realtime') {
      return <WebcamPanel onStop={() => setCameraActive(false)} />;
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
        return <ConfigPanel mode={mode} onSubmit={handleProcess} fileName={file?.name} />;
      case 'processing':
        return <ProcessingIndicator />;
      case 'results':
        return result ? (
          <ResultsViewer mode={mode} result={result} originalFile={file || undefined} onReset={handleReset} />
        ) : null;
    }
  };

  return (
    <div className="h-screen flex flex-col">
      <Header health={health} />
      <div className="flex flex-1 overflow-hidden">
        <Sidebar activeMode={mode} onModeChange={handleModeChange} health={health} />
        <main className="flex-1 overflow-y-auto bg-[var(--color-bg-primary)]">
          {renderMain()}
        </main>
      </div>
      <StatusBar health={health} loading={loading} />
      <ToastContainer />
    </div>
  );
}

export default App;
