import { useEffect, useState } from 'react';
import type { HealthData, Mode } from '../types';
import { Card, CardHeader, CardTitle, CardContent } from './ui/card';
import { Button } from './ui/button';
import { Badge } from './ui/badge';
import { Slider } from './ui/slider';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from './ui/select';
import { AlertTriangle, Settings } from 'lucide-react';

interface Props {
  mode: Mode;
  onSubmit: (params: Record<string, unknown>) => void;
  fileName?: string;
  health?: HealthData | null;
}

const FREQUENCY_PRESETS = [
  { label: 'Breathing', min: 0.1, max: 0.5 },
  { label: 'Heart Rate', min: 0.75, max: 3.0 },
  { label: 'Tremor', min: 3.0, max: 12.0 },
];

const RPPG_METHODS = ['POS_WANG', 'CHROME_DEHAAN', 'ICA_POH', 'GREEN', 'LGI', 'PBV', 'OMIT', 'ALL'];
const PYVHR_METHODS = ['cpu_POS', 'cpu_CHROM', 'cpu_GREEN', 'cpu_ICA', 'cpu_PCA', 'cpu_LGI', 'cpu_PBV', 'cpu_OMIT', 'cpu_SSR'];

export function ConfigPanel({ mode, onSubmit, fileName, health }: Props) {
  // Motion params
  const [motionEngine, setMotionEngine] = useState('stbvmm');
  const [magnification, setMagnification] = useState(20);
  const [motionMode, setMotionMode] = useState('static');
  const [motionFastPreview, setMotionFastPreview] = useState(false);
  const [motionHighDetail, setMotionHighDetail] = useState(false);

  // Color params
  const [freqMin, setFreqMin] = useState(0.75);
  const [freqMax, setFreqMax] = useState(3.0);
  const [amplification, setAmplification] = useState(50);
  const [pyramidLevels, setPyramidLevels] = useState(4);

  // Vitals params
  const [heartrateEngine, setHeartrateEngine] = useState('rppg');
  const [rppgMethod, setRppgMethod] = useState('ALL');
  const [pyvhrMethod, setPyvhrMethod] = useState('cpu_POS');
  const [winsize, setWinsize] = useState(5);

  const isBackendAvailable = (key: string): boolean => {
    if (!health) return true;
    return !!health.backends?.[key]?.available;
  };

  // Auto-switch to the first available engine when health arrives/changes.
  useEffect(() => {
    if (!health) return;

    if (mode === 'motion' && !isBackendAvailable(motionEngine)) {
      const first = ['stbvmm', 'fd4mm', 'flowmag'].find(isBackendAvailable);
      if (first) setMotionEngine(first);
    }

    if (mode === 'heartrate' && !isBackendAvailable(heartrateEngine)) {
      const first = ['rppg', 'rhythm_mamba', 'factorizephys'].find(isBackendAvailable);
      if (first) setHeartrateEngine(first);
    }
  }, [health, mode, motionEngine, heartrateEngine]);

  const handleSubmit = () => {
    switch (mode) {
      case 'motion':
        onSubmit({
          engine: motionEngine,
          magnification,
          mode: motionMode,
          maxFrames: motionFastPreview ? 120 : 0,
          maxSide: motionHighDetail ? 640 : 0,
        });
        break;
      case 'color':
        onSubmit({ freqMin, freqMax, amplification, pyramidLevels });
        break;
      case 'heartrate':
        onSubmit({ engine: heartrateEngine, method: rppgMethod });
        break;
      case 'realtime':
        onSubmit({ method: pyvhrMethod, winsize });
        break;
      case 'audio':
        onSubmit({});
        break;
    }
  };

  return (
    <div className="max-w-xl mx-auto p-4">
      <Card>
        <CardHeader className="pb-3">
          <div className="flex items-center justify-between">
            <CardTitle className="text-sm flex items-center gap-2">
              <Settings className="h-4 w-4" />
              Parameters
            </CardTitle>
            {fileName && (
              <Badge variant="secondary" className="text-xs font-normal">
                {fileName}
              </Badge>
            )}
          </div>
        </CardHeader>
        <CardContent className="space-y-5">
          {mode === 'motion' && (
            <>
              <div>
                <label className="block text-xs font-medium text-muted-foreground mb-2">
                  Model
                </label>
                <Select value={motionEngine} onValueChange={setMotionEngine}>
                  <SelectTrigger className="w-full">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="stbvmm" disabled={!!health && !isBackendAvailable('stbvmm')}>STB-VMM</SelectItem>
                    <SelectItem value="fd4mm" disabled={!!health && !isBackendAvailable('fd4mm')}>FD4MM</SelectItem>
                    <SelectItem value="flowmag" disabled={!!health && !isBackendAvailable('flowmag')}>FlowMag</SelectItem>
                  </SelectContent>
                </Select>
              </div>
              <div>
                <label className="block text-xs font-medium text-muted-foreground mb-2">
                  Magnification Factor: <Badge variant="secondary">{magnification}x</Badge>
                </label>
                <Slider
                  min={1}
                  max={100}
                  step={1}
                  value={[magnification]}
                  onValueChange={([v]) => setMagnification(v)}
                />
              </div>
              <div>
                <label className="block text-xs font-medium text-muted-foreground mb-2">
                  Mode
                </label>
                <Select value={motionMode} onValueChange={setMotionMode}>
                  <SelectTrigger className="w-full">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="static">Static</SelectItem>
                    <SelectItem value="dynamic">Dynamic</SelectItem>
                  </SelectContent>
                </Select>
              </div>
              <label className="flex items-center gap-2 text-xs text-muted-foreground">
                <input
                  type="checkbox"
                  className="accent-primary"
                  checked={motionFastPreview}
                  onChange={(e) => setMotionFastPreview(e.target.checked)}
                />
                Fast preview (first 120 frames, ~4s @ 30fps)
              </label>
              <label className="flex items-center gap-2 text-xs text-muted-foreground">
                <input
                  type="checkbox"
                  className="accent-primary"
                  checked={motionHighDetail}
                  onChange={(e) => setMotionHighDetail(e.target.checked)}
                />
                High detail (slower, preserves fine features)
              </label>
            </>
          )}

          {mode === 'color' && (
            <>
              <div>
                <label className="block text-xs font-medium text-muted-foreground mb-2">
                  Frequency Range: <Badge variant="secondary">{freqMin.toFixed(2)} – {freqMax.toFixed(2)} Hz</Badge>
                </label>
                <div className="space-y-3">
                  <div>
                    <span className="text-xs text-muted-foreground">Min</span>
                    <Slider
                      min={0.01}
                      max={15}
                      step={0.01}
                      value={[freqMin]}
                      onValueChange={([v]) => setFreqMin(v)}
                    />
                  </div>
                  <div>
                    <span className="text-xs text-muted-foreground">Max</span>
                    <Slider
                      min={0.01}
                      max={15}
                      step={0.01}
                      value={[freqMax]}
                      onValueChange={([v]) => setFreqMax(v)}
                    />
                  </div>
                </div>
                <div className="flex gap-2 mt-3">
                  {FREQUENCY_PRESETS.map((p) => (
                    <Button
                      key={p.label}
                      variant="outline"
                      size="sm"
                      onClick={() => {
                        setFreqMin(p.min);
                        setFreqMax(p.max);
                      }}
                      className="text-xs"
                    >
                      {p.label}
                    </Button>
                  ))}
                </div>
              </div>
              <div>
                <label className="block text-xs font-medium text-muted-foreground mb-2">
                  Amplification: <Badge variant="secondary">{amplification}x</Badge>
                </label>
                <Slider
                  min={1}
                  max={200}
                  step={1}
                  value={[amplification]}
                  onValueChange={([v]) => setAmplification(v)}
                />
              </div>
              <div>
                <label className="block text-xs font-medium text-muted-foreground mb-2">
                  Pyramid Levels: <Badge variant="secondary">{pyramidLevels}</Badge>
                </label>
                <Slider
                  min={1}
                  max={8}
                  step={1}
                  value={[pyramidLevels]}
                  onValueChange={([v]) => setPyramidLevels(v)}
                />
              </div>
            </>
          )}

          {mode === 'heartrate' && (
            <>
              <div>
                <label className="block text-xs font-medium text-muted-foreground mb-2">
                  Model
                </label>
                <Select value={heartrateEngine} onValueChange={setHeartrateEngine}>
                  <SelectTrigger className="w-full">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="rppg" disabled={!!health && !isBackendAvailable('rppg')}>rPPG-Toolbox (Unsupervised)</SelectItem>
                    <SelectItem value="rhythm_mamba" disabled={!!health && !isBackendAvailable('rhythm_mamba')}>RhythmMamba</SelectItem>
                    <SelectItem value="factorizephys" disabled={!!health && !isBackendAvailable('factorizephys')}>FactorizePhys</SelectItem>
                  </SelectContent>
                </Select>
              </div>
              {heartrateEngine === 'rppg' && (
                <div>
                  <label className="block text-xs font-medium text-muted-foreground mb-2">
                    rPPG Method
                  </label>
                  <Select value={rppgMethod} onValueChange={setRppgMethod}>
                    <SelectTrigger className="w-full">
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      {RPPG_METHODS.map((m) => (
                        <SelectItem key={m} value={m}>{m === 'ALL' ? 'ALL (Compare)' : m}</SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>
              )}
            </>
          )}

          {mode === 'realtime' && (
            <>
              <div>
                <label className="block text-xs font-medium text-muted-foreground mb-2">
                  pyVHR Method
                </label>
                <Select value={pyvhrMethod} onValueChange={setPyvhrMethod}>
                  <SelectTrigger className="w-full">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    {PYVHR_METHODS.map((m) => (
                      <SelectItem key={m} value={m}>{m}</SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
              <div>
                <label className="block text-xs font-medium text-muted-foreground mb-2">
                  Window Size: <Badge variant="secondary">{winsize}s</Badge>
                </label>
                <Slider
                  min={2}
                  max={15}
                  step={1}
                  value={[winsize]}
                  onValueChange={([v]) => setWinsize(v)}
                />
              </div>
            </>
          )}

          {mode === 'audio' && (
            <Card className="border-amber-200 bg-amber-50">
              <CardContent className="flex items-start gap-2 py-3 text-xs text-amber-800">
                <AlertTriangle className="h-4 w-4 text-amber-500 shrink-0 mt-0.5" />
                <span>
                  Visual-Mic works best with high-speed video (&gt;1000fps). Standard 30fps video will only recover very low frequencies. Results are educational/demonstrative.
                </span>
              </CardContent>
            </Card>
          )}

          <Button onClick={handleSubmit} className="w-full">
            Process
          </Button>
        </CardContent>
      </Card>
    </div>
  );
}
