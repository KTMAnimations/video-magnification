# VMAG - Video Magnification Laboratory

A unified webapp integrating 5 video-processing backends for motion amplification, color amplification, heart-rate extraction, real-time vitals monitoring, and audio recovery from visual vibrations.

**Stack:** FastAPI (Python) + React 19 / TypeScript / Vite 7 / Tailwind CSS v4 + Recharts

---

## Architecture Overview

```
Browser (React SPA)
    |
    | Vite dev-server proxy (/magnify, /vitals, /audio, /health, /files)
    v
FastAPI  (port 8000)
    |--- /magnify/motion   --> STB-VMM service    (PyTorch, Swin Transformer)
    |--- /magnify/color    --> EVM service         (eulerian-magnification pip package)
    |--- /vitals/heartrate --> rPPG service        (unsupervised rPPG: POS, CHROM, GREEN, ICA, LGI, PBV)
    |--- /vitals/realtime  --> pyVHR service       (pyVHR Pipeline + HRV metrics)
    |--- /vitals/ws/vitals --> pyVHR WebSocket     (binary JPEG frames in, JSON vitals out)
    |--- /audio/recover    --> Visual-Mic service  (DTCWT wavelet-based audio extraction)
    |--- /health           --> backend status      (per-backend availability check)
    |--- /files/*          --> StaticFiles          (serves data/ directory, supports Range/206)
```

---

## Quick Start

### 1. Clone & Install Backends

```bash
cd /Users/kaivaid/video-magnification

# Clone all 5 backend repos
bash scripts/setup_backends.sh

# Download STB-VMM neural network checkpoint (~149 MB)
bash scripts/download_weights.sh
```

**Backend repositories:**

| Directory | Repository | Purpose |
|-----------|-----------|---------|
| `backends/STB-VMM/` | [RLado/STB-VMM](https://github.com/RLado/STB-VMM) | Swin Transformer motion magnification |
| `backends/eulerian-magnification/` | [brycedrennan/eulerian-magnification](https://github.com/brycedrennan/eulerian-magnification) | Classical Eulerian Video Magnification |
| `backends/rPPG-Toolbox/` | [ubicomplab/rPPG-Toolbox](https://github.com/ubicomplab/rPPG-Toolbox) | 15+ unsupervised rPPG algorithms |
| `backends/pyVHR/` | [phuselab/pyVHR](https://github.com/phuselab/pyVHR) | Real-time vitals + HRV from video |
| `backends/Visual-Mic/` | [joeljose/Visual-Mic](https://github.com/joeljose/Visual-Mic) | Audio recovery from visual vibrations |

### 2. Install Python Dependencies

```bash
pip install -r requirements.txt
```

Key packages: `torch`, `torchvision`, `opencv-contrib-python`, `mediapipe` (pinned), `numpy<2`, `scipy`, `fastapi`, `uvicorn`, `eulerian-magnification`, `soundfile`, `pydantic`, `numba`.

PyTorch auto-detects Apple Silicon MPS, CUDA, or falls back to CPU.

### 3. Install Frontend Dependencies

```bash
cd frontend
npm install
```

### 4. Run

```bash
# Terminal 1: Backend (from project root)
uvicorn api.main:app --reload --port 8000

# Terminal 2: Frontend (from frontend/)
cd frontend && npm run dev
```

Open `http://localhost:5173` (or whichever port Vite assigns).

---

## Processing Modes

### Motion Magnification (`/magnify/motion`)
**Backend:** STB-VMM (Swin Transformer Based Video Motion Magnification)

Amplifies subtle motions invisible to the naked eye. Uses a pre-trained Swin Transformer that takes pairs of frames (reference + current) and a magnification factor, outputting the magnified frame directly.

| Parameter | Type | Default | Description |
|-----------|------|---------|-------------|
| `video` | File | required | Video file (any OpenCV-supported format) |
| `magnification` | float | 20.0 | Amplification factor |
| `mode` | string | "static" | `static` (first frame as reference) or `dynamic` (consecutive pairs) |

**Technical details:**
- Model: `STBVMM(img_size=384, in_chans=3, embed_dim=192, depths=[6,6,6,6,6,6], window_size=8)`
- Checkpoint: `backends/STB-VMM/ckpt_e49.pth.tar` (~149 MB, downloaded from HuggingFace)
- Input frames resized to nearest multiple of 64 (capped at 384) for processing, then resized back
- Forward pass: `model(frame_a, frame_b, mag_factor)` returns `(y_hat, res_a, res_b, _)`
- Normalization: pixel / 127.5 - 1.0 (maps [0,255] to [-1,1])
- Device auto-detection: MPS > CUDA > CPU

### Color Magnification (`/magnify/color`)
**Backend:** eulerian-magnification (pip package)

Classical Eulerian Video Magnification that amplifies color changes in a specific frequency band. Useful for visualizing blood flow (pulse), breathing, and subtle vibrations.

| Parameter | Type | Default | Description |
|-----------|------|---------|-------------|
| `video` | File | required | Video file |
| `freq_min` | float | 0.75 | Low cutoff frequency (Hz) |
| `freq_max` | float | 3.0 | High cutoff frequency (Hz) |
| `amplification` | float | 50.0 | Color amplification factor |
| `pyramid_levels` | int | 4 | Gaussian/Laplacian pyramid levels |

**Frontend provides frequency presets:** Pulse (0.75-3 Hz), Breathing (0.1-0.5 Hz), Vibration (1-30 Hz).

### Heart Rate Extraction (`/vitals/heartrate`)
**Backend:** rPPG-Toolbox (unsupervised methods, no deep learning required)

Extracts heart rate from face video using remote photoplethysmography (rPPG). Uses Haar cascade face detection, extracts mean RGB signal from face ROI, applies selected algorithm, then FFT to find dominant frequency in 0.75-3.33 Hz range (45-200 BPM).

| Parameter | Type | Default | Description |
|-----------|------|---------|-------------|
| `video` | File | required | Video containing a face |
| `method` | string | "ALL" | Algorithm: `ALL` (compare), `POS_WANG`, `CHROM_DEHAAN`, `GREEN`, `ICA_POH`, `LGI`, `PBV` |

**Response data includes:** `bpm`, `bvp` (blood volume pulse array), `psd_freqs`, `psd_power`, `confidence`, `fps`, `n_frames`, `method`.

### Real-time Vitals (`/vitals/realtime` + `/vitals/ws/vitals`)
**Backend:** pyVHR Pipeline

Batch processing via POST or live webcam via WebSocket. Extracts BPM with HRV metrics (SDNN, RMSSD, LF power, HF power, LF/HF ratio, PSD).

| Parameter | Type | Default | Description |
|-----------|------|---------|-------------|
| `video` | File | required | Video file (POST endpoint) |
| `method` | string | "cpu_POS" | pyVHR method name |
| `winsize` | int | 5 | Window size in seconds |

**WebSocket protocol:**
- Client sends binary JPEG frames (e.g., from webcam at 30fps)
- Server accumulates 300 frames minimum (~10s at 30fps)
- Server processes via `pyVHR.process_frames()` and returns JSON: `{bpm, confidence, bvp, timestamp}`
- Sliding window: keeps last 80% of buffer after each processing cycle

**Known issue:** pyVHR currently unavailable due to `mediapipe` -> `tensorflow` -> `numpy` version conflicts. Requires isolated environment or numpy downgrade to resolve.
**Note:** pyVHR is now runnable in a clean environment by pinning `mediapipe==0.10.21` and `numpy<2`, and by treating deep-model dependencies (TensorFlow) as optional. If your global Python has a broken TensorFlow install, use a virtualenv (e.g. `scripts/setup_venv.sh`) or uninstall TensorFlow in that env.

### Audio Recovery (`/audio/recover`)
**Backend:** Visual-Mic (DTCWT-based)

Recovers audio from subtle visual vibrations in video. Works best with high-FPS video (>1000 fps); standard 30fps video can only recover very low frequencies.

| Parameter | Type | Default | Description |
|-----------|------|---------|-------------|
| `video` | File | required | Video file |
| `roi_x`, `roi_y`, `roi_w`, `roi_h` | int | 0 | Optional region of interest |

**Processing pipeline:**
1. Converts frames to grayscale, optionally crops to ROI
2. Computes a robust motion proxy via frame differencing (temporal intensity change)
3. Treats the proxy as an audio waveform, normalizes, and outputs WAV + waveform data for visualization

**Response data includes:** `fps`, `n_frames`, `duration_seconds`, `waveform` (downsampled to max 2000 points), `max_recoverable_freq_hz` (Nyquist = fps/2).

---

## API Reference

### Health Check
```
GET /health
```
Returns status of all backends:
```json
{
  "status": "ok",
  "backends": {
    "evm":       { "label": "EVM (Eulerian)",              "available": true,  "error": null },
    "pyvhr":     { "label": "pyVHR (Real-time Vitals)",    "available": false, "error": null },
    "rppg":      { "label": "rPPG-Toolbox (Heart Rate)",   "available": true,  "error": null },
    "stbvmm":    { "label": "STB-VMM (Motion Magnification)", "available": true, "error": null },
    "visualmic": { "label": "Visual-Mic (Audio Recovery)", "available": true,  "error": null }
  }
}
```

### Standard Response Format
All processing endpoints return `ProcessingResponse`:
```json
{
  "success": true,
  "output_url": "/files/processed/abc123.mp4",
  "data": { ... },
  "error": null,
  "warnings": ["..."],
  "processing_time_seconds": 12.3
}
```

### Processed File Access
```
GET /files/processed/{filename}   -- magnified videos (mp4)
GET /files/audio/{filename}       -- recovered audio (wav)
GET /files/uploads/{filename}     -- uploaded originals
```
Supports HTTP Range requests (206 Partial Content) for video seeking.

---

## Project Structure

```
video-magnification/
├── api/
│   ├── __init__.py
│   ├── main.py                  # FastAPI app, CORS, lifespan (file cleanup), static mount
│   ├── upload.py                # save_upload() -> data/uploads/{uuid}{ext}
│   ├── models/
│   │   ├── __init__.py
│   │   └── schemas.py           # ProcessingResponse, HealthResponse (Pydantic)
│   ├── routers/
│   │   ├── __init__.py
│   │   ├── magnify.py           # POST /magnify/motion, POST /magnify/color
│   │   ├── vitals.py            # POST /vitals/heartrate, POST /vitals/realtime, WS /vitals/ws/vitals
│   │   └── audio.py             # POST /audio/recover
│   └── services/
│       ├── __init__.py          # Service registry (lazy singletons), get_backend_status()
│       ├── base.py              # ProcessingResult dataclass, BaseService ABC
│       ├── evm.py               # EVMService — Eulerian Video Magnification
│       ├── pyvhr.py             # PyVHRService — pyVHR Pipeline + HRV
│       ├── rppg.py              # RPPGService — rPPG unsupervised methods
│       ├── stbvmm.py            # STBVMMService — Swin Transformer motion magnification
│       └── visualmic.py         # VisualMicService — DTCWT audio recovery
├── frontend/
│   ├── index.html
│   ├── package.json             # React 19, Tailwind v4, Recharts 3, Vite 7
│   ├── vite.config.ts           # React + Tailwind plugins, proxy to :8000
│   ├── tsconfig.json
│   └── src/
│       ├── main.tsx
│       ├── App.tsx              # Central state machine (upload→configure→processing→results)
│       ├── App.css
│       ├── index.css            # Tailwind @theme with CSS vars, dark lab aesthetic, animations
│       ├── types.ts             # Mode, Stage, ProcessingResponse, ROI, MODE_CONFIGS
│       ├── api.ts               # API client (processMotion, processColor, etc., connectVitalsWebSocket)
│       ├── hooks/
│       │   ├── useBackendHealth.ts   # Polls /health every 10s
│       │   └── useWebSocket.ts       # WebSocket lifecycle for webcam vitals
│       └── components/
│           ├── Header.tsx            # VMAG branding + per-backend status LEDs
│           ├── Sidebar.tsx           # Mode selector (grays out unavailable modes)
│           ├── VideoUploader.tsx      # Drag-drop + camera button
│           ├── ConfigPanel.tsx        # Mode-specific controls (sliders, presets, method selectors)
│           ├── ROISelector.tsx        # Canvas overlay click-drag rectangle selection
│           ├── ProcessingIndicator.tsx # Radar sweep animation + elapsed timer
│           ├── ResultsViewer.tsx      # VideoComparison / VitalsResult / AudioResult sub-components
│           ├── WebcamPanel.tsx        # Live webcam + BPM overlay, 30fps frame sending
│           ├── StatusBar.tsx          # API status + backend count
│           ├── Toast.tsx              # Slide-in toast notifications for warnings/errors
│           └── charts/
│               ├── BVPChart.tsx       # Green line — blood volume pulse
│               ├── BPMTimeChart.tsx   # Heart-colored — BPM over time with mean line
│               ├── HRVFrequencyChart.tsx # Area chart — PSD with LF/HF bands
│               └── AudioWaveform.tsx  # Purple waveform — recovered audio
├── backends/                    # .gitignored — cloned repos
│   ├── STB-VMM/                 # + ckpt_e49.pth.tar checkpoint
│   ├── eulerian-magnification/
│   ├── rPPG-Toolbox/
│   ├── pyVHR/
│   └── Visual-Mic/
├── data/                        # .gitignored — runtime data
│   ├── uploads/                 # Uploaded videos
│   ├── processed/               # Magnified output videos (mp4)
│   ├── audio/                   # Recovered audio (wav)
│   └── temp/
├── scripts/
│   ├── setup_backends.sh        # Clones all 5 repos into backends/
│   └── download_weights.sh      # Downloads STB-VMM checkpoint from HuggingFace
├── requirements.txt             # Python dependencies
├── .gitignore
└── video-magnification-webapp-plan.md  # This file
```

---

## Frontend Design

### Visual Aesthetic
Dark lab instrument panel inspired by oscilloscopes, medical monitors, and mission control interfaces.

- **Background:** `#060a10` (near-black) with CRT scanline overlay (repeating green gradient at 0.015 opacity)
- **Panels:** `#0f1728` with `#1a2744` borders
- **Accent:** `#00ff88` (green glow, used for active elements, status LEDs)
- **Heart rate:** `#ff3366`
- **Audio waveform:** `#aa66ff` (purple)
- **Font:** JetBrains Mono / SF Mono / Fira Code (monospace stack)
- **All text:** Uppercase labels with letter-spacing, 0.6-0.75rem sizes

### UI Flow (State Machine)
```
upload  →  [ROI selector if mode.needsROI]  →  configure  →  processing  →  results
                                                                              ↓
                                                                        [Process Another]
                                                                              ↓
                                                                           upload
```

For **Real-time** mode, "Use Camera" button activates `WebcamPanel` (bypasses the upload→configure flow).

### Key Components

| Component | Role |
|-----------|------|
| `Header` | VMAG branding + 5 backend status LEDs (green/red dots) |
| `Sidebar` | 5 mode tabs with icon, label, description. Unavailable modes grayed out (opacity 35%, disabled) |
| `VideoUploader` | Dashed-border drop zone + camera toggle |
| `ROISelector` | Canvas overlay on video preview; click-drag to draw rectangle; skip button |
| `ConfigPanel` | Mode-specific: magnification slider, frequency range + presets, rPPG method dropdown, etc. |
| `ProcessingIndicator` | Centered radar-sweep animation with elapsed time counter |
| `ResultsViewer` | Delegates to `VideoComparisonResult` (motion/color), `VitalsResult` (heartrate/realtime), or `AudioResult` (audio) |
| `WebcamPanel` | getUserMedia stream, draws to canvas at 30fps, sends binary JPEG via WebSocket, shows BPM overlay |
| `Toast` | Global notification system — slide-in toasts for errors (red) and warnings (amber) |

### Charts (Recharts)
- **BVPChart:** Green `LineChart` for blood volume pulse signal
- **BPMTimeChart:** Heart-colored `LineChart` with `ReferenceLine` at mean BPM
- **HRVFrequencyChart:** `AreaChart` of power spectral density with LF/HF band reference areas
- **AudioWaveform:** Purple `AreaChart` of recovered audio signal

---

## Backend Service Details

### Service Registry Pattern
`api/services/__init__.py` implements lazy singletons. Each `get_*()` function instantiates the service on first call and caches it. `get_backend_status()` iterates all services and calls `is_available()`.

### BaseService
```python
class BaseService(ABC):
    @abstractmethod
    def is_available(self) -> bool: ...
```

### ProcessingResult
```python
@dataclass
class ProcessingResult:
    success: bool
    output_path: Optional[str] = None
    data: Optional[Dict[str, Any]] = None
    error: Optional[str] = None
    warnings: List[str] = field(default_factory=list)
    processing_time_seconds: float = 0.0
```

### STBVMMService (stbvmm.py)
- Loads model once (singleton), caches on `self._model` and `self._device`
- Auto-detects MPS/CUDA/CPU via PyTorch
- Resizes input frames to nearest multiple of 64 (capped at 384x384) for the Swin Transformer windowed attention
- Processes frame-by-frame: `model(frame_a, frame_b, mag_factor)` with `torch.no_grad()`
- Writes output via `cv2.VideoWriter` with `mp4v` codec
- `PYTORCH_ENABLE_MPS_FALLBACK=1` for ops not yet on MPS

### EVMService (evm.py)
- Delegates to `eulerian_magnification` pip package
- Reads all frames into numpy array `(n_frames, h, w, 3)`
- Clips float output to [0, 255] and resizes if needed

### RPPGService (rppg.py)
- Bypasses rPPG-Toolbox config system entirely
- Uses Haar cascade face detection (`haarcascade_frontalface_default.xml`)
- Extracts mean RGB from face bounding box per frame
- Applies selected unsupervised method (POS_WANG, CHROM_DEHAAN, GREEN, ICA_POH, LGI, PBV)
- FFT on resulting BVP signal to find dominant frequency in [0.75, 3.33] Hz
- Returns BPM, BVP waveform, PSD, confidence score

### PyVHRService (pyvhr.py)
- Uses `pyVHR.analysis.pipeline.Pipeline` for batch processing
- `process_frames()` method for WebSocket: decodes JPEG bytes, processes via Pipeline
- Computes HRV metrics from BVP peaks: SDNN, RMSSD, LF power, HF power, LF/HF ratio
- **Currently unavailable** due to mediapipe->tensorflow->numpy version conflict

### VisualMicService (visualmic.py)
- Primary path: imports `visualmic.soundfromvid` and `npTowav` from the cloned repo
- Fallback path: manual DTCWT extraction using `dtcwt.Transform2d()` — forward wavelet per frame, sum high-pass coefficient magnitudes as motion proxy
- Warns when FPS < 100 (standard 30fps only recovers very low frequencies)
- Outputs WAV via `soundfile.write()` (fallback) or `npTowav()` (primary)
- Returns normalized waveform downsampled to max 2000 points for chart display

---

## Automatic File Cleanup

The FastAPI app runs a background task (`lifespan`) that:
- Checks `data/uploads/`, `data/processed/`, `data/audio/` every hour
- Removes any file older than 24 hours
- Logs removals to stdout

---

## Known Issues & Limitations

1. **pyVHR unavailable:** `mediapipe` requires `tensorflow`, which conflicts with `numpy>=2.0`. Workaround: use a separate conda environment with `numpy<2`, or wait for updated mediapipe.

2. **STB-VMM processing speed:** Frame-by-frame inference on CPU is slow (~45s for a short clip). GPU (CUDA/MPS) significantly faster.

3. **Visual-Mic low-FPS limitation:** The algorithm was designed for >1000fps high-speed camera footage. Standard 30fps video can only recover frequencies below 15 Hz (Nyquist limit), which is below human hearing. Results are educational/demonstrative.

4. **Video codec compatibility:** Output uses `mp4v` codec which may not play in all browsers. Safari prefers H.264. Consider adding `ffmpeg` transcoding for production use.

5. **Large file uploads:** No file size limit is enforced. Very large videos will consume significant memory during processing (all frames loaded at once).

---

## Development Notes

### Frontend Build
```bash
cd frontend
npm run build    # tsc -b && vite build -> dist/
npm run dev      # Vite dev server with HMR
```

Production build output: `frontend/dist/` (~590 KB JS + 15 KB CSS gzipped).

### Adding a New Backend
1. Create `api/services/newbackend.py` extending `BaseService`
2. Register in `api/services/__init__.py` (add to `_get_service()` and `get_backend_status()`)
3. Create router in `api/routers/newrouter.py`
4. Include router in `api/main.py`
5. Add mode to `frontend/src/types.ts` (`MODE_CONFIGS`)
6. Add API function to `frontend/src/api.ts`
7. Handle in `App.tsx` process switch and `ConfigPanel`

### Environment Variables
- `PYTORCH_ENABLE_MPS_FALLBACK=1` — Set automatically by STB-VMM service for Apple Silicon compatibility
