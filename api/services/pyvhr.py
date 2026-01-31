"""Real-time vitals service.

Primary implementation uses `pyVHR` when it can be imported cleanly.

In practice, pyVHR commonly breaks due to mediapipe/tensorflow/numpy version
conflicts. When that happens, we fall back to a lightweight rPPG implementation
using the rPPG-Toolbox unsupervised methods on face ROI frames.
"""

import tempfile
import traceback
from pathlib import Path
from typing import List
import sys

import cv2
import numpy as np

from api.services.base import BaseService, ProcessingResult
from api.progress import ProgressSink
from api.services.rppg import RPPGService

BACKENDS_DIR = Path("backends/pyVHR")


class PyVHRService(BaseService):
    _last_error: str | None = None
    _pyvhr_checked: bool = False
    _pyvhr_pipeline = None

    def is_available(self) -> bool:
        # Consider the service available if either:
        # - pyVHR imports successfully, OR
        # - we can run the fallback rPPG pipeline.
        if self._try_import_pyvhr() is not None:
            return True
        if self._fallback_available():
            return True
        return False

    def _try_import_pyvhr(self):
        if self._pyvhr_checked:
            return self._pyvhr_pipeline

        self._pyvhr_checked = True
        try:
            if str(BACKENDS_DIR) not in sys.path:
                sys.path.insert(0, str(BACKENDS_DIR))
            from pyVHR.analysis.pipeline import Pipeline  # noqa: F401
            self._pyvhr_pipeline = Pipeline
            self._last_error = None
            return Pipeline
        except Exception as e:
            self._pyvhr_pipeline = None
            self._last_error = f"{type(e).__name__}: {e}"
            return None

    def _fallback_available(self) -> bool:
        rppg = RPPGService()
        ok = rppg.is_available()
        if not ok:
            err = getattr(rppg, "_last_error", None)
            self._last_error = err or "rPPG-Toolbox unavailable; cannot run fallback realtime vitals."
        else:
            if self._last_error:
                self._last_error = f"pyVHR unavailable; using fallback rPPG engine ({self._last_error})"
        return ok

    def process(
        self,
        video_path: str,
        method: str = "cpu_POS",
        winsize: int = 5,
        progress: ProgressSink | None = None,
    ) -> ProcessingResult:
        Pipeline = self._try_import_pyvhr()

        if Pipeline is not None:
            try:
                if progress:
                    progress.update(stage="pyvhr", message="Running pyVHR pipeline", percent=None, force=True)
                cap = cv2.VideoCapture(video_path)
                fps = float(cap.get(cv2.CAP_PROP_FPS) or 30.0)
                cap.release()

                pipe = Pipeline()
                bvps_win, timesES, bpmES = pipe.run_on_video(
                    video_path,
                    winsize=winsize,
                    roi_approach="holistic",
                    method=method,
                    cuda=False,
                    verb=False,
                )

                # Normalize pyVHR outputs into JSON-friendly primitives.
                bpm_values: list[float] = []
                for bpm_win in bpmES:
                    try:
                        bpm_arr = np.array(bpm_win, dtype=np.float32).reshape(-1)
                        if bpm_arr.size:
                            bpm_values.append(float(np.nanmedian(bpm_arr)))
                    except Exception:
                        continue

                bvp_segment: np.ndarray = np.array([], dtype=np.float32)
                if isinstance(bvps_win, list) and len(bvps_win) > 0:
                    last_win = bvps_win[-1]
                    try:
                        last_arr = np.array(last_win, dtype=np.float32)
                        if last_arr.ndim == 2 and last_arr.shape[0] > 0:
                            bvp_segment = np.nanmedian(last_arr, axis=0).astype(np.float32)
                    except Exception:
                        bvp_segment = np.array([], dtype=np.float32)

                times_bpm = timesES.tolist() if hasattr(timesES, "tolist") else list(timesES)
                bpm_mean = float(np.nanmean(bpm_values)) if bpm_values else None

                # Optional confidence/PSD using the same estimator used elsewhere in the app.
                confidence = None
                psd_freqs = []
                psd_power = []
                bpm_from_psd = None
                if bvp_segment.size > 0:
                    rppg = RPPGService()
                    bpm_psd, conf, pf, pp = rppg._bvp_to_bpm(bvp_segment, fps)  # noqa: SLF001
                    bpm_from_psd = float(bpm_psd)
                    confidence = float(conf)
                    psd_freqs = pf
                    psd_power = pp

                # Compute HRV metrics from the returned BVP segment.
                times_samples = (np.arange(bvp_segment.size, dtype=np.float32) / fps).tolist() if bvp_segment.size else []
                hrv_data = self._compute_hrv([bvp_segment], times_samples) if bvp_segment.size else {}

                # Basic sanity check: if pyVHR returns an out-of-range BPM, fall back.
                if bpm_mean is not None and (bpm_mean < 40.0 or bpm_mean > 200.0):
                    fallback = self._process_fallback(video_path=video_path, method=method, winsize=winsize, progress=progress)
                    if fallback.success:
                        fallback.warnings = (fallback.warnings or []) + [
                            f"pyVHR returned out-of-range BPM ({bpm_mean:.1f}); using fallback rPPG engine instead."
                        ]
                        return fallback

                return ProcessingResult(
                    success=True,
                    data={
                        "bpm": bpm_values,
                        "bpm_mean": bpm_mean,
                        "times": times_bpm,
                        "bvp": bvp_segment.tolist() if bvp_segment.size else [],
                        "hrv": hrv_data,
                        "method": method,
                        "confidence": confidence,
                        "psd_freqs": psd_freqs,
                        "psd_power": psd_power,
                        "bpm_psd": bpm_from_psd,
                    },
                )
            except Exception as e:
                # If pyVHR fails on a particular input (no face, low quality, etc),
                # fall back to the rPPG-Toolbox path instead of failing the endpoint.
                pyvhr_error = f"{type(e).__name__}: {e}"
                pyvhr_tb = traceback.format_exc()

                fallback = self._process_fallback(video_path=video_path, method=method, winsize=winsize, progress=progress)
                if fallback.success:
                    fallback.warnings = (fallback.warnings or []) + [
                        f"pyVHR failed for this input; using fallback rPPG engine ({pyvhr_error})"
                    ]
                    return fallback

                return ProcessingResult(
                    success=False,
                    error=(
                        f"pyVHR processing failed: {pyvhr_error}\n{pyvhr_tb}\n"
                        f"Fallback processing also failed: {fallback.error}"
                    ),
                )

        # Fallback implementation (no pyVHR)
        return self._process_fallback(video_path=video_path, method=method, winsize=winsize, progress=progress)

    def process_frames(self, jpeg_frames: List[bytes], fps: float) -> ProcessingResult:
        """Process a buffer of JPEG frames (from webcam WebSocket)."""
        try:
            # Decode frames and write to temp video
            decoded = []
            for buf in jpeg_frames:
                arr = np.frombuffer(buf, dtype=np.uint8)
                frame = cv2.imdecode(arr, cv2.IMREAD_COLOR)
                if frame is not None:
                    decoded.append(frame)

            if len(decoded) < 60:
                return ProcessingResult(success=False, error="Not enough valid frames")

            # If pyVHR is usable, go through the existing video-based path.
            if self._try_import_pyvhr() is not None:
                h, w = decoded[0].shape[:2]
                tmp = tempfile.NamedTemporaryFile(suffix=".avi", delete=False)
                fourcc = cv2.VideoWriter_fourcc(*"MJPG")
                writer = cv2.VideoWriter(tmp.name, fourcc, fps, (w, h))
                for f in decoded:
                    writer.write(f)
                writer.release()

                result = self.process(tmp.name, method="cpu_POS", winsize=5)
                Path(tmp.name).unlink(missing_ok=True)
                return result

            # Otherwise use the fallback directly on decoded frames.
            return self._process_fallback_frames(frames_bgr=decoded, fps=fps, method="cpu_POS", winsize=5)

        except Exception as e:
            return ProcessingResult(
                success=False, error=f"Frame processing failed: {e}"
            )

    def _map_method_to_rppg(self, method: str) -> tuple[str, list[str]]:
        """Map pyVHR-style method names to rPPG-Toolbox unsupervised methods."""
        warnings: list[str] = []
        mapping = {
            "cpu_POS": "POS_WANG",
            "cpu_CHROM": "CHROME_DEHAAN",
            "cpu_GREEN": "GREEN",
            "cpu_ICA": "ICA_POH",
            "cpu_LGI": "LGI",
            "cpu_PBV": "PBV",
            "cpu_OMIT": "OMIT",
        }
        if method in mapping:
            return mapping[method], warnings

        # Default fallback
        warnings.append(f"Method '{method}' not supported in fallback mode; using cpu_POS.")
        return "POS_WANG", warnings

    def _process_fallback(self, video_path: str, method: str, winsize: int, progress: ProgressSink | None = None) -> ProcessingResult:
        cap = cv2.VideoCapture(video_path)
        fps = cap.get(cv2.CAP_PROP_FPS) or 30.0
        total_frames = int(cap.get(cv2.CAP_PROP_FRAME_COUNT) or 0)
        frames = []
        read_count = 0
        while True:
            ret, frame = cap.read()
            if not ret:
                break
            frames.append(frame)
            read_count += 1
            if progress:
                if total_frames > 0:
                    overall = (read_count / total_frames) * 35.0
                    progress.update(stage="read_frames", message="Reading video frames", current=read_count, total=total_frames, percent=overall)
                else:
                    progress.update(stage="read_frames", message="Reading video frames", current=read_count, total=None, percent=None)
        cap.release()

        return self._process_fallback_frames(frames_bgr=frames, fps=float(fps), method=method, winsize=winsize, progress=progress)

    def _process_fallback_frames(self, frames_bgr: list[np.ndarray], fps: float, method: str, winsize: int, progress: ProgressSink | None = None) -> ProcessingResult:
        rppg_method, warnings = self._map_method_to_rppg(method)
        rppg = RPPGService()
        frames_rgb = rppg.extract_face_frames_from_bgr_frames(frames_bgr, progress=progress)
        if frames_rgb is None:
            return ProcessingResult(success=False, error="No face detected in frames.", warnings=warnings)

        if progress:
            progress.update(stage="rppg_method", message=f"Running {rppg_method}", percent=75.0, force=True)
        bvp = rppg._run_method(rppg_method, frames_rgb, fps)  # noqa: SLF001
        if bvp is None:
            return ProcessingResult(success=False, error=f"Method {rppg_method} failed.", warnings=warnings)

        # Sliding-window BPM estimates
        win_frames = max(10, int(max(2, winsize) * fps))
        step_frames = max(1, win_frames // 2)
        bpm_values: list[float] = []
        bpm_times: list[float] = []
        conf_values: list[float] = []

        total_windows = max(0, (len(bvp) - win_frames) // step_frames + 1) if len(bvp) >= win_frames else 0
        for win_idx, start in enumerate(range(0, len(bvp) - win_frames + 1, step_frames), start=1):
            segment = bvp[start : start + win_frames]
            bpm, conf, _, _ = rppg._bvp_to_bpm(segment, fps)  # noqa: SLF001
            bpm_values.append(float(bpm))
            conf_values.append(float(conf))
            bpm_times.append((start + win_frames / 2) / fps)
            if progress and total_windows > 0:
                overall = 75.0 + (win_idx / total_windows) * 20.0
                progress.update(stage="estimate_bpm", message="Estimating BPM", current=win_idx, total=total_windows, percent=overall)

        if bpm_values:
            bpm_mean = float(np.nanmean(bpm_values))
            confidence = float(np.nanmean(conf_values))
        else:
            if progress:
                progress.update(stage="estimate_bpm", message="Estimating BPM", percent=95.0, force=True)
            bpm_full, confidence, _, _ = rppg._bvp_to_bpm(bvp, fps)  # noqa: SLF001
            bpm_mean = float(bpm_full)

        times_es = (np.arange(len(bvp), dtype=np.float32) / float(fps)).tolist()
        hrv_data = self._compute_hrv([bvp], times_es)
        if progress:
            progress.update(stage="analyze", message="Computing HRV metrics", percent=100.0, force=True)

        return ProcessingResult(
            success=True,
            data={
                "bpm": bpm_values,
                "bpm_mean": bpm_mean,
                "times": bpm_times,
                "bvp": bvp.tolist(),
                "hrv": hrv_data,
                "method": method,
                "confidence": confidence,
            },
            warnings=warnings,
        )

    def _compute_hrv(self, bvps, timesES) -> dict:
        """Compute basic HRV metrics from BVP signal."""
        try:
            from scipy.signal import find_peaks
            from scipy.fft import fft, fftfreq

            if len(bvps) == 0 or len(bvps[0]) < 10:
                return {}

            bvp = np.array(bvps[0])
            dt = float(timesES[-1] - timesES[0]) / len(bvp) if len(timesES) > 1 else 1 / 30
            fs = 1.0 / dt if dt > 0 else 30.0

            peaks, _ = find_peaks(bvp, distance=int(fs * 0.4))
            if len(peaks) < 3:
                return {}

            rr_intervals = np.diff(peaks) / fs * 1000  # in ms
            sdnn = float(np.std(rr_intervals))
            rmssd = float(np.sqrt(np.mean(np.diff(rr_intervals) ** 2)))

            # PSD for LF/HF
            N = len(bvp)
            yf = np.abs(fft(bvp))[:N // 2]
            xf = fftfreq(N, dt)[:N // 2]

            lf_mask = (xf >= 0.04) & (xf <= 0.15)
            hf_mask = (xf >= 0.15) & (xf <= 0.4)
            lf_power = float(np.trapz(yf[lf_mask] ** 2, xf[lf_mask])) if lf_mask.any() else 0
            hf_power = float(np.trapz(yf[hf_mask] ** 2, xf[hf_mask])) if hf_mask.any() else 0
            lf_hf_ratio = lf_power / hf_power if hf_power > 0 else 0

            # PSD data for chart
            psd_freqs = xf[(xf >= 0.01) & (xf <= 0.5)].tolist()
            psd_power = (yf[(xf >= 0.01) & (xf <= 0.5)] ** 2).tolist()

            return {
                "sdnn": sdnn,
                "rmssd": rmssd,
                "lf_power": lf_power,
                "hf_power": hf_power,
                "lf_hf_ratio": lf_hf_ratio,
                "psd_freqs": psd_freqs,
                "psd_power": psd_power,
            }
        except Exception:
            return {}
