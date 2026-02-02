"""Real-time vitals service.

Primary implementation uses `pyVHR` when it can be imported cleanly.

In practice, pyVHR commonly breaks due to mediapipe/tensorflow/numpy version
conflicts. When that happens, we fall back to a lightweight rPPG implementation
using the rPPG-Toolbox unsupervised methods on face ROI frames.
"""

import tempfile
import traceback
import uuid
from bisect import bisect_right
from pathlib import Path
from typing import List
import sys
from threading import local

import cv2
import numpy as np

from api.services.base import BaseService, ProcessingResult
from api.progress import ProgressSink
from api.services.rppg import RPPGService
from api.utils.video import get_total_frames

BACKENDS_DIR = Path("backends/pyVHR")
PROCESSED_DIR = Path("data/processed")
PROCESSED_DIR.mkdir(parents=True, exist_ok=True)

_pyvhr_thread_ctx = local()
_pyvhr_frame_hook_installed = False


def _pick_bpm_at_time(t: float, times_s: list[float], bpms: list[float]) -> float | None:
    if not times_s or not bpms or len(times_s) != len(bpms):
        return None
    idx = bisect_right(times_s, t) - 1
    idx = max(0, min(idx, len(bpms) - 1))
    try:
        v = float(bpms[idx])
    except Exception:
        return None
    return v if np.isfinite(v) else None


def _draw_text_block(frame: np.ndarray, lines: list[str]) -> None:
    if not lines:
        return

    font = cv2.FONT_HERSHEY_SIMPLEX
    font_scale = 0.6
    thickness = 2
    line_gap = 6
    pad = 6
    x = 10
    y = 28

    for line in lines:
        (w, h), baseline = cv2.getTextSize(line, font, font_scale, thickness)
        x0 = max(0, x - pad)
        y0 = max(0, y - h - pad)
        x1 = min(frame.shape[1], x + w + pad)
        y1 = min(frame.shape[0], y + baseline + pad)
        cv2.rectangle(frame, (x0, y0), (x1, y1), (0, 0, 0), -1)
        cv2.putText(frame, line, (x, y), font, font_scale, (255, 255, 255), thickness, cv2.LINE_AA)
        y += h + baseline + line_gap


def _install_pyvhr_progress_hooks() -> None:
    """Install a thread-local progress hook into pyVHR frame extraction.

    pyVHR's SignalProcessing loops over frames via `extract_frames_yield(...)`.
    We wrap that generator so we can update our API progress tracker per-frame
    (without permanently changing behavior when no progress sink is configured).
    """
    global _pyvhr_frame_hook_installed
    if _pyvhr_frame_hook_installed:
        return

    # Ensure pyVHR is importable.
    if str(BACKENDS_DIR) not in sys.path:
        sys.path.insert(0, str(BACKENDS_DIR))

    import pyVHR.extraction.utils as pyvhr_utils
    import pyVHR.extraction.sig_processing as pyvhr_sig_processing

    orig_extract = pyvhr_utils.extract_frames_yield

    def wrapped_extract_frames_yield(videoFileName: str):
        ctx = getattr(_pyvhr_thread_ctx, "progress_ctx", None)
        if not ctx:
            yield from orig_extract(videoFileName)
            return

        progress: ProgressSink | None = ctx.get("progress")
        total_frames: int | None = ctx.get("total_frames")
        stage: str = ctx.get("stage") or "pyvhr"
        message: str = ctx.get("message") or "Processing video"
        start_percent: float = float(ctx.get("start_percent") or 0.0)
        span_percent: float = float(ctx.get("span_percent") or 75.0)

        total = int(total_frames) if isinstance(total_frames, int) and total_frames > 0 else 0

        for idx, frame in enumerate(orig_extract(videoFileName), start=1):
            if progress:
                if total > 0:
                    overall = start_percent + (idx / total) * span_percent
                    progress.update(
                        stage=stage,
                        message=message,
                        current=idx,
                        total=total,
                        percent=overall,
                    )
                else:
                    progress.update(stage=stage, message=message, current=idx, total=None, percent=None)
            yield frame

    # Patch both the canonical util and the symbol imported into sig_processing.
    pyvhr_utils.extract_frames_yield = wrapped_extract_frames_yield
    pyvhr_sig_processing.extract_frames_yield = wrapped_extract_frames_yield

    _pyvhr_frame_hook_installed = True


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
        render_video: bool = True,
    ) -> ProcessingResult:
        Pipeline = self._try_import_pyvhr()

        if Pipeline is not None:
            try:
                if progress:
                    progress.update(stage="pyvhr", message="Preparing pyVHR pipeline", percent=0.0, force=True)
                cap = cv2.VideoCapture(video_path)
                fps = float(cap.get(cv2.CAP_PROP_FPS) or 30.0)
                total_frames = int(cap.get(cv2.CAP_PROP_FRAME_COUNT) or 0)
                cap.release()
                if total_frames <= 0 and progress:
                    total_frames = int(get_total_frames(video_path) or 0)

                if progress:
                    _install_pyvhr_progress_hooks()
                    _pyvhr_thread_ctx.progress_ctx = {
                        "progress": progress,
                        "total_frames": total_frames if total_frames > 0 else None,
                        "stage": "pyvhr_roi",
                        "message": "Extracting face signal",
                        "start_percent": 0.0,
                        "span_percent": 75.0,
                    }

                pipe = Pipeline()
                bvps_win, timesES, bpmES = pipe.run_on_video(
                    video_path,
                    winsize=winsize,
                    roi_approach="holistic",
                    method=method,
                    cuda=False,
                    verb=False,
                )
                if progress:
                    _pyvhr_thread_ctx.progress_ctx = None
                    progress.update(stage="analyze", message="Computing metrics", percent=85.0, force=True)

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
                if progress:
                    progress.update(stage="analyze", message="Estimating confidence", percent=90.0, force=True)
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
                if progress:
                    progress.update(stage="analyze", message="Computing HRV metrics", percent=95.0, force=True)
                times_samples = (np.arange(bvp_segment.size, dtype=np.float32) / fps).tolist() if bvp_segment.size else []
                hrv_data = self._compute_hrv([bvp_segment], times_samples) if bvp_segment.size else {}

                # Basic sanity check: if pyVHR returns an out-of-range BPM, fall back.
                if bpm_mean is not None and (bpm_mean < 40.0 or bpm_mean > 200.0):
                    fallback = self._process_fallback(video_path=video_path, method=method, winsize=winsize, progress=progress, render_video=render_video)
                    if fallback.success:
                        fallback.warnings = (fallback.warnings or []) + [
                            f"pyVHR returned out-of-range BPM ({bpm_mean:.1f}); using fallback rPPG engine instead."
                        ]
                        return fallback

                res = ProcessingResult(
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
                        "fps": float(fps),
                        "n_frames": int(total_frames) if total_frames > 0 else None,
                    },
                )
                if render_video:
                    out_name, out_warnings = self._write_annotated_video(
                        video_path=video_path,
                        fps=float(fps),
                        times_s=times_bpm,
                        bpm_values=bpm_values,
                        bpm_mean=bpm_mean,
                        confidence=confidence,
                        method=method,
                        progress=progress,
                    )
                    res.output_path = out_name
                    if out_warnings:
                        res.warnings = (res.warnings or []) + out_warnings

                if progress:
                    progress.update(stage="analyze", message="Done", percent=100.0, force=True)
                return res
            except Exception as e:
                if progress:
                    _pyvhr_thread_ctx.progress_ctx = None
                # If pyVHR fails on a particular input (no face, low quality, etc),
                # fall back to the rPPG-Toolbox path instead of failing the endpoint.
                pyvhr_error = f"{type(e).__name__}: {e}"
                pyvhr_tb = traceback.format_exc()

                fallback = self._process_fallback(video_path=video_path, method=method, winsize=winsize, progress=progress, render_video=render_video)
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
        return self._process_fallback(video_path=video_path, method=method, winsize=winsize, progress=progress, render_video=render_video)

    def _write_annotated_video(
        self,
        *,
        video_path: str,
        fps: float,
        times_s: list[float],
        bpm_values: list[float],
        bpm_mean: float | None,
        confidence: float | None,
        method: str,
        progress: ProgressSink | None = None,
    ) -> tuple[str | None, list[str]]:
        warnings: list[str] = []
        cap = None
        writer = None
        try:
            cap = cv2.VideoCapture(video_path)
            fps = float(fps or cap.get(cv2.CAP_PROP_FPS) or 30.0)
            width = int(cap.get(cv2.CAP_PROP_FRAME_WIDTH) or 0)
            height = int(cap.get(cv2.CAP_PROP_FRAME_HEIGHT) or 0)
            total_frames = int(cap.get(cv2.CAP_PROP_FRAME_COUNT) or 0)
            if total_frames <= 0 and progress:
                total_frames = int(get_total_frames(video_path) or 0)

            if width <= 0 or height <= 0:
                warnings.append("Could not determine video dimensions; skipping output video.")
                return None, warnings

            out_name = f"{uuid.uuid4().hex}.mp4"
            out_path = PROCESSED_DIR / out_name

            if progress:
                progress.update(stage="write_output", message="Rendering output video", percent=97.0, force=True)

            # Prefer H.264 (avc1) for in-browser playback (Chrome often can't decode mp4v).
            fourcc = cv2.VideoWriter_fourcc(*"avc1")
            writer = cv2.VideoWriter(str(out_path), fourcc, fps, (width, height))
            if not writer.isOpened():
                warnings.append("H.264 encoder unavailable; falling back to mp4v (may not play in-browser).")
                fourcc = cv2.VideoWriter_fourcc(*"mp4v")
                writer = cv2.VideoWriter(str(out_path), fourcc, fps, (width, height))
            if not writer.isOpened():
                warnings.append("Failed to initialize video writer; skipping output video.")
                return None, warnings

            wrote = 0
            while True:
                ret, frame = cap.read()
                if not ret or frame is None:
                    break
                wrote += 1

                if frame.shape[:2] != (height, width):
                    frame = cv2.resize(frame, (width, height))

                t = (wrote - 1) / fps if fps > 0 else 0.0
                bpm_here = _pick_bpm_at_time(t, times_s, bpm_values)
                bpm_display = bpm_here if bpm_here is not None else bpm_mean
                lines: list[str] = [f"Method: {method}"]
                if bpm_display is not None:
                    lines.append(f"BPM: {bpm_display:.1f}")
                if bpm_mean is not None and bpm_here is not None:
                    lines.append(f"Avg: {bpm_mean:.1f}")
                if confidence is not None:
                    lines.append(f"Conf: {confidence * 100.0:.0f}%")

                _draw_text_block(frame, lines)
                writer.write(frame)

                if progress and total_frames > 0:
                    percent = 97.0 + (wrote / total_frames) * 3.0
                    progress.update(
                        stage="write_output",
                        message="Rendering output video",
                        current=wrote,
                        total=total_frames,
                        percent=min(100.0, percent),
                    )

            if wrote <= 0:
                warnings.append("Could not read video frames for output; skipping output video.")
                return None, warnings

            return out_name, warnings
        except Exception as e:
            warnings.append(f"Failed to render output video ({type(e).__name__}: {e}); skipping.")
            return None, warnings
        finally:
            try:
                if cap is not None:
                    cap.release()
            except Exception:
                pass
            try:
                if writer is not None:
                    writer.release()
            except Exception:
                pass

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

                result = self.process(tmp.name, method="cpu_POS", winsize=5, render_video=False)
                Path(tmp.name).unlink(missing_ok=True)
                return result

            # Otherwise use the fallback directly on decoded frames.
            return self._process_fallback_frames(frames_bgr=decoded, fps=fps, method="cpu_POS", winsize=5, render_video=False)

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

    def _process_fallback(self, video_path: str, method: str, winsize: int, progress: ProgressSink | None = None, render_video: bool = True) -> ProcessingResult:
        cap = cv2.VideoCapture(video_path)
        fps = cap.get(cv2.CAP_PROP_FPS) or 30.0
        total_frames = int(cap.get(cv2.CAP_PROP_FRAME_COUNT) or 0)
        if total_frames <= 0 and progress:
            total_frames = int(get_total_frames(video_path) or 0)
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

        return self._process_fallback_frames(frames_bgr=frames, fps=float(fps), method=method, winsize=winsize, progress=progress, render_video=render_video, video_path=video_path)

    def _process_fallback_frames(self, frames_bgr: list[np.ndarray], fps: float, method: str, winsize: int, progress: ProgressSink | None = None, render_video: bool = True, video_path: str | None = None) -> ProcessingResult:
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
            progress.update(stage="analyze", message="Computing HRV metrics", percent=95.0, force=True)

        res = ProcessingResult(
            success=True,
            data={
                "bpm": bpm_values,
                "bpm_mean": bpm_mean,
                "times": bpm_times,
                "bvp": bvp.tolist(),
                "hrv": hrv_data,
                "method": method,
                "confidence": confidence,
                "fps": float(fps),
                "n_frames": int(len(frames_rgb)),
            },
            warnings=warnings,
        )

        if render_video:
            if video_path:
                out_name, out_warnings = self._write_annotated_video(
                    video_path=video_path,
                    fps=float(fps),
                    times_s=bpm_times,
                    bpm_values=bpm_values,
                    bpm_mean=bpm_mean,
                    confidence=confidence,
                    method=method,
                    progress=progress,
                )
                res.output_path = out_name
                if out_warnings:
                    res.warnings = (res.warnings or []) + out_warnings
            else:
                res.warnings = (res.warnings or []) + ["Output video unavailable (missing source video path)."]

        if progress:
            progress.update(stage="analyze", message="Done", percent=100.0, force=True)

        return res

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
