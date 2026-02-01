"""rPPG service wrapper — unsupervised methods via rPPG-Toolbox.

Note: rPPG-Toolbox "unsupervised_methods" functions expect a sequence/array of
frames (N, H, W, 3), not a pre-aggregated RGB time-series.
"""

import sys
import traceback
from pathlib import Path

import cv2
import numpy as np

from api.services.base import BaseService, ProcessingResult
from api.progress import ProgressSink
from api.utils.video import get_total_frames

BACKENDS_DIR = Path("backends/rPPG-Toolbox")
SUPPORTED_METHODS = ["POS_WANG", "CHROME_DEHAAN", "ICA_POH", "GREEN", "LGI", "PBV", "OMIT"]


class RPPGService(BaseService):
    _last_error: str | None = None

    def is_available(self) -> bool:
        if not BACKENDS_DIR.exists():
            return False
        try:
            if str(BACKENDS_DIR) not in sys.path:
                sys.path.insert(0, str(BACKENDS_DIR))
            from unsupervised_methods.methods.POS_WANG import POS_WANG  # noqa: F401
            self._last_error = None
            return True
        except Exception as e:
            self._last_error = f"{type(e).__name__}: {e}"
            return False

    def process(self, video_path: str, method: str = "ALL", progress: ProgressSink | None = None) -> ProcessingResult:
        try:
            if str(BACKENDS_DIR) not in sys.path:
                sys.path.insert(0, str(BACKENDS_DIR))

            # Extract face ROI frames
            frames_rgb = self._extract_face_frames(video_path, progress=progress)
            if frames_rgb is None:
                return ProcessingResult(
                    success=False,
                    error="No face detected in video.",
                )

            cap = cv2.VideoCapture(video_path)
            fps = cap.get(cv2.CAP_PROP_FPS) or 30.0
            cap.release()

            # Run one method or compare all methods.
            if method == "ALL":
                return self._process_all(frames_rgb=frames_rgb, fps=float(fps), progress=progress)

            if method not in SUPPORTED_METHODS:
                return ProcessingResult(success=False, error=f"Unknown method: {method}")

            if progress:
                progress.update(stage="rppg_method", message=f"Running {method}", percent=75.0, force=True)
            bvp = self._run_method(method, frames_rgb, float(fps))
            if bvp is None:
                return ProcessingResult(success=False, error=f"Method {method} failed.")

            if progress:
                progress.update(stage="analyze", message="Estimating BPM", percent=90.0, force=True)
            bpm, bpm_confidence, psd_freqs, psd_power = self._bvp_to_bpm(bvp, float(fps))
            if progress:
                progress.update(stage="analyze", message="Estimating BPM", percent=100.0, force=True)

            return ProcessingResult(
                success=True,
                data={
                    "bpm": float(bpm),
                    "confidence": float(bpm_confidence),
                    "bvp": bvp.tolist(),
                    "method": method,
                    "fps": float(fps),
                    "n_frames": int(frames_rgb.shape[0]),
                    "psd_freqs": psd_freqs,
                    "psd_power": psd_power,
                },
            )
        except Exception as e:
            return ProcessingResult(
                success=False,
                error=f"rPPG processing failed: {e}\n{traceback.format_exc()}",
            )

    def _process_all(self, frames_rgb: np.ndarray, fps: float, progress: ProgressSink | None = None) -> ProcessingResult:
        """Run all supported methods and pick the highest-confidence result.

        Returns the best method's waveforms/PSD in the top-level fields, plus a
        `compare` array with per-method BPM/confidence summaries.
        """
        compare: list[dict] = []
        best_method: str | None = None
        best_bvp: np.ndarray | None = None
        best_bpm: float = 0.0
        best_conf: float = -1.0
        best_psd_freqs: list[float] = []
        best_psd_power: list[float] = []

        total = len(SUPPORTED_METHODS)
        for idx, m in enumerate(SUPPORTED_METHODS, start=1):
            if progress:
                percent = 75.0 + (idx / max(1, total)) * 10.0
                progress.update(stage="rppg_method", message=f"Running {m} ({idx}/{total})", percent=percent, force=True)

            bvp = self._run_method(m, frames_rgb, fps)
            if bvp is None:
                compare.append({"method": m, "ok": False, "error": "method failed or returned no signal"})
                continue

            bvp = np.asarray(bvp, dtype=np.float32).reshape(-1)
            if bvp.size < 2:
                compare.append({"method": m, "ok": False, "error": "method returned no signal"})
                continue

            try:
                bpm, conf, psd_freqs, psd_power = self._bvp_to_bpm(bvp, fps)
            except Exception as e:
                compare.append({"method": m, "ok": False, "error": f"analysis failed: {type(e).__name__}: {e}"})
                continue
            compare.append(
                {
                    "method": m,
                    "ok": True,
                    "bpm": float(bpm),
                    "confidence": float(conf),
                }
            )

            # Highest confidence wins; ties break by stable method order.
            if float(conf) > best_conf:
                best_conf = float(conf)
                best_method = m
                best_bvp = bvp
                best_bpm = float(bpm)
                best_psd_freqs = psd_freqs
                best_psd_power = psd_power

        if best_method is None or best_bvp is None:
            return ProcessingResult(success=False, error="All rPPG methods failed.", data={"compare": compare})

        if progress:
            progress.update(stage="analyze", message="Selecting best method", percent=90.0, force=True)
            progress.update(stage="analyze", message="Done", percent=100.0, force=True)

        return ProcessingResult(
            success=True,
            data={
                "bpm": float(best_bpm),
                "confidence": float(best_conf),
                "bvp": best_bvp.tolist(),
                "method": best_method,
                "method_requested": "ALL",
                "fps": float(fps),
                "n_frames": int(frames_rgb.shape[0]),
                "psd_freqs": best_psd_freqs,
                "psd_power": best_psd_power,
                "compare": compare,
            },
        )

    def _extract_face_frames(self, video_path: str, progress: ProgressSink | None = None) -> np.ndarray | None:
        """Extract a sequence of face ROI frames (RGB) from a video.

        Returns: np.ndarray shape (N, H, W, 3) dtype float32 in [0, 255].
        """
        cap = cv2.VideoCapture(video_path)
        total_frames = int(cap.get(cv2.CAP_PROP_FRAME_COUNT) or 0)
        if total_frames <= 0 and progress:
            total_frames = int(get_total_frames(video_path) or 0)
        frames_bgr = []
        read_count = 0
        while True:
            ret, frame = cap.read()
            if not ret:
                break
            frames_bgr.append(frame)
            read_count += 1
            if progress:
                if total_frames > 0:
                    overall = (read_count / total_frames) * 35.0
                    progress.update(
                        stage="read_frames",
                        message="Reading video frames",
                        current=read_count,
                        total=total_frames,
                        percent=overall,
                    )
                else:
                    progress.update(stage="read_frames", message="Reading video frames", current=read_count, total=None, percent=None)
        cap.release()

        return self.extract_face_frames_from_bgr_frames(frames_bgr, progress=progress)

    @staticmethod
    def extract_face_frames_from_bgr_frames(frames_bgr: list[np.ndarray], progress: ProgressSink | None = None) -> np.ndarray | None:
        """Extract face ROI frames (RGB) from an in-memory list of BGR frames."""
        if len(frames_bgr) < 2:
            return None

        face_cascade = cv2.CascadeClassifier(
            cv2.data.haarcascades + "haarcascade_frontalface_default.xml"
        )

        frames_rgb: list[np.ndarray] = []
        last_face = None

        total = len(frames_bgr)
        for idx, frame in enumerate(frames_bgr, start=1):
            gray = cv2.cvtColor(frame, cv2.COLOR_BGR2GRAY)
            faces = face_cascade.detectMultiScale(gray, 1.1, 5, minSize=(60, 60))

            if len(faces) > 0:
                last_face = faces[0]

            if progress and total > 0:
                overall = 35.0 + (idx / total) * 40.0
                progress.update(stage="detect_face", message="Detecting face ROI", current=idx, total=total, percent=overall)

            if last_face is None:
                continue

            x, y, w, h = last_face
            x0 = max(0, x)
            y0 = max(0, y)
            x1 = min(frame.shape[1], x + w)
            y1 = min(frame.shape[0], y + h)
            if x1 <= x0 or y1 <= y0:
                continue

            roi = frame[y0:y1, x0:x1]
            if roi.size == 0:
                continue

            roi_rgb = cv2.cvtColor(roi, cv2.COLOR_BGR2RGB)
            roi_rgb = cv2.resize(roi_rgb, (128, 128), interpolation=cv2.INTER_AREA)
            frames_rgb.append(roi_rgb.astype(np.float32))

        if len(frames_rgb) < 2:
            return None

        return np.stack(frames_rgb, axis=0)

    def _run_method(self, method: str, frames_rgb: np.ndarray, fps: float) -> np.ndarray | None:
        """Run an unsupervised rPPG method on ROI frames."""
        method_map = {
            "POS_WANG": "unsupervised_methods.methods.POS_WANG",
            "CHROME_DEHAAN": "unsupervised_methods.methods.CHROME_DEHAAN",
            "ICA_POH": "unsupervised_methods.methods.ICA_POH",
            "GREEN": "unsupervised_methods.methods.GREEN",
            "LGI": "unsupervised_methods.methods.LGI",
            "PBV": "unsupervised_methods.methods.PBV",
            "OMIT": "unsupervised_methods.methods.OMIT",
        }

        if method not in method_map:
            return None

        try:
            # rPPG-Toolbox uses `np.mat`, which was removed in NumPy 2.x. Provide a
            # small compatibility shim so the upstream code keeps working.
            if not hasattr(np, "mat"):
                setattr(np, "mat", np.asmatrix)

            import inspect
            import importlib

            mod = importlib.import_module(method_map[method])
            method_fn = getattr(mod, method)
            params = list(inspect.signature(method_fn).parameters.values())
            if len(params) == 2:
                bvp = method_fn(frames_rgb, fps)
            else:
                bvp = method_fn(frames_rgb)
            bvp_arr = np.asarray(bvp, dtype=np.float32).reshape(-1)
            # Some upstream methods return empty/degenerate outputs on too-short clips.
            if bvp_arr.size < 2:
                return None
            return bvp_arr
        except Exception:
            return None

    def _bvp_to_bpm(self, bvp: np.ndarray, fps: float):
        """Convert BVP signal to BPM via FFT."""
        from scipy.fft import fft, fftfreq

        bvp_arr = np.asarray(bvp, dtype=np.float32).reshape(-1)
        N = int(bvp_arr.size)
        if N < 2 or fps <= 0:
            return 0.0, 0.0, [], []

        yf = np.abs(fft(bvp_arr))[:N // 2]
        xf = fftfreq(N, 1.0 / fps)[:N // 2]

        # Search in HR range (40-200 BPM = 0.67-3.33 Hz)
        hr_mask = (xf >= 0.67) & (xf <= 3.33)
        if not hr_mask.any():
            return 0.0, 0.0, [], []

        hr_freqs = xf[hr_mask]
        hr_power = yf[hr_mask]
        peak_idx = np.argmax(hr_power)
        peak_freq = hr_freqs[peak_idx]
        bpm = peak_freq * 60.0

        # Confidence: ratio of peak to total power
        confidence = float(hr_power[peak_idx] / (hr_power.sum() + 1e-10))

        # PSD for chart
        psd_mask = (xf >= 0.5) & (xf <= 4.0)
        psd_freqs = xf[psd_mask].tolist()
        psd_power = (yf[psd_mask] ** 2).tolist()

        return bpm, confidence, psd_freqs, psd_power
