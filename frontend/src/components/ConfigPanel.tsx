import { useState } from 'react';
import type { Mode } from '../types';

interface Props {
  mode: Mode;
  onSubmit: (params: Record<string, unknown>) => void;
  fileName?: string;
}

const FREQUENCY_PRESETS = [
  { label: 'Breathing', min: 0.1, max: 0.5 },
  { label: 'Heart Rate', min: 0.75, max: 3.0 },
  { label: 'Tremor', min: 3.0, max: 12.0 },
];

const RPPG_METHODS = ['POS_WANG', 'CHROME_DEHAAN', 'ICA_POH', 'GREEN', 'LGI', 'PBV', 'OMIT'];
const PYVHR_METHODS = ['cpu_POS', 'cpu_CHROM', 'cpu_GREEN', 'cpu_ICA', 'cpu_PCA', 'cpu_LGI', 'cpu_PBV', 'cpu_OMIT', 'cpu_SSR'];

export function ConfigPanel({ mode, onSubmit, fileName }: Props) {
  // Motion params
  const [magnification, setMagnification] = useState(20);
  const [motionMode, setMotionMode] = useState('static');

  // Color params
  const [freqMin, setFreqMin] = useState(0.75);
  const [freqMax, setFreqMax] = useState(3.0);
  const [amplification, setAmplification] = useState(50);
  const [pyramidLevels, setPyramidLevels] = useState(4);

  // Vitals params
  const [rppgMethod, setRppgMethod] = useState('POS_WANG');
  const [pyvhrMethod, setPyvhrMethod] = useState('cpu_POS');
  const [winsize, setWinsize] = useState(5);

  const handleSubmit = () => {
    switch (mode) {
      case 'motion':
        onSubmit({ magnification, mode: motionMode });
        break;
      case 'color':
        onSubmit({ freqMin, freqMax, amplification, pyramidLevels });
        break;
      case 'heartrate':
        onSubmit({ method: rppgMethod });
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
      <div className="panel">
        <div className="panel-header">
          &#9881; Parameters
          {fileName && <span className="ml-auto text-[var(--color-text-dim)]">{fileName}</span>}
        </div>
        <div className="p-4 space-y-4">
          {mode === 'motion' && (
            <>
              <div>
                <label className="block text-[0.65rem] text-[var(--color-text-secondary)] uppercase mb-1">
                  Magnification Factor: {magnification}x
                </label>
                <input
                  type="range"
                  min={1}
                  max={100}
                  value={magnification}
                  onChange={(e) => setMagnification(+e.target.value)}
                  className="w-full accent-[var(--color-accent)]"
                />
              </div>
              <div>
                <label className="block text-[0.65rem] text-[var(--color-text-secondary)] uppercase mb-1">
                  Mode
                </label>
                <div className="flex gap-2">
                  {['static', 'dynamic'].map((m) => (
                    <button
                      key={m}
                      onClick={() => setMotionMode(m)}
                      className={`btn-secondary ${motionMode === m ? '!border-[var(--color-accent)] !text-[var(--color-accent)]' : ''}`}
                    >
                      {m}
                    </button>
                  ))}
                </div>
              </div>
            </>
          )}

          {mode === 'color' && (
            <>
              <div>
                <label className="block text-[0.65rem] text-[var(--color-text-secondary)] uppercase mb-1">
                  Frequency Range: {freqMin.toFixed(2)} - {freqMax.toFixed(2)} Hz
                </label>
                <div className="flex gap-2 items-center">
                  <input
                    type="range"
                    min={0.01}
                    max={15}
                    step={0.01}
                    value={freqMin}
                    onChange={(e) => setFreqMin(+e.target.value)}
                    className="flex-1 accent-[var(--color-accent)]"
                  />
                  <input
                    type="range"
                    min={0.01}
                    max={15}
                    step={0.01}
                    value={freqMax}
                    onChange={(e) => setFreqMax(+e.target.value)}
                    className="flex-1 accent-[var(--color-accent)]"
                  />
                </div>
                <div className="flex gap-2 mt-2">
                  {FREQUENCY_PRESETS.map((p) => (
                    <button
                      key={p.label}
                      onClick={() => {
                        setFreqMin(p.min);
                        setFreqMax(p.max);
                      }}
                      className="btn-secondary text-[0.6rem]"
                    >
                      {p.label}
                    </button>
                  ))}
                </div>
              </div>
              <div>
                <label className="block text-[0.65rem] text-[var(--color-text-secondary)] uppercase mb-1">
                  Amplification: {amplification}x
                </label>
                <input
                  type="range"
                  min={1}
                  max={200}
                  value={amplification}
                  onChange={(e) => setAmplification(+e.target.value)}
                  className="w-full accent-[var(--color-accent)]"
                />
              </div>
              <div>
                <label className="block text-[0.65rem] text-[var(--color-text-secondary)] uppercase mb-1">
                  Pyramid Levels: {pyramidLevels}
                </label>
                <input
                  type="range"
                  min={1}
                  max={8}
                  value={pyramidLevels}
                  onChange={(e) => setPyramidLevels(+e.target.value)}
                  className="w-full accent-[var(--color-accent)]"
                />
              </div>
            </>
          )}

          {mode === 'heartrate' && (
            <div>
              <label className="block text-[0.65rem] text-[var(--color-text-secondary)] uppercase mb-1">
                rPPG Method
              </label>
              <div className="flex flex-wrap gap-2">
                {RPPG_METHODS.map((m) => (
                  <button
                    key={m}
                    onClick={() => setRppgMethod(m)}
                    className={`btn-secondary text-[0.6rem] ${rppgMethod === m ? '!border-[var(--color-accent)] !text-[var(--color-accent)]' : ''}`}
                  >
                    {m}
                  </button>
                ))}
              </div>
            </div>
          )}

          {mode === 'realtime' && (
            <>
              <div>
                <label className="block text-[0.65rem] text-[var(--color-text-secondary)] uppercase mb-1">
                  pyVHR Method
                </label>
                <div className="flex flex-wrap gap-2">
                  {PYVHR_METHODS.map((m) => (
                    <button
                      key={m}
                      onClick={() => setPyvhrMethod(m)}
                      className={`btn-secondary text-[0.6rem] ${pyvhrMethod === m ? '!border-[var(--color-accent)] !text-[var(--color-accent)]' : ''}`}
                    >
                      {m}
                    </button>
                  ))}
                </div>
              </div>
              <div>
                <label className="block text-[0.65rem] text-[var(--color-text-secondary)] uppercase mb-1">
                  Window Size: {winsize}s
                </label>
                <input
                  type="range"
                  min={2}
                  max={15}
                  value={winsize}
                  onChange={(e) => setWinsize(+e.target.value)}
                  className="w-full accent-[var(--color-accent)]"
                />
              </div>
            </>
          )}

          {mode === 'audio' && (
            <div className="text-[0.7rem] text-[var(--color-text-secondary)] p-3 border border-[var(--color-warning)] border-opacity-30 rounded bg-[var(--color-warning)] bg-opacity-5">
              <span className="text-[var(--color-warning)]">&#9888;</span> Visual-Mic works best with high-speed video (&gt;1000fps). Standard 30fps video will only recover very low frequencies. Results are educational/demonstrative.
            </div>
          )}

          <button onClick={handleSubmit} className="btn-primary w-full mt-4">
            Process
          </button>
        </div>
      </div>
    </div>
  );
}
