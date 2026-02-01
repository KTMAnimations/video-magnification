"""RhythmMamba service wrapper — AAAI 2025 supervised rPPG (optional dependency-heavy)."""

from __future__ import annotations

import os
import sys
import traceback
from pathlib import Path

import cv2
import numpy as np

from api.progress import ProgressSink
from api.services.base import BaseService, ProcessingResult
from api.services.rppg import RPPGService
from api.utils.video import get_total_frames

BACKENDS_DIR = Path("backends/RhythmMamba")


def _checkpoint_path() -> Path:
    return Path(os.environ.get("VMAG_RHYTHMMAMBA_CHECKPOINT", "backends/RhythmMamba/PreTrainedModels/UBFC_cross_RhythmMamba.pth"))


def _strip_module_prefix(state_dict: dict) -> dict:
    if not state_dict:
        return state_dict
    if not any(k.startswith("module.") for k in state_dict.keys()):
        return state_dict
    return {k.removeprefix("module."): v for k, v in state_dict.items()}


class RhythmMambaService(BaseService):
    _model = None
    _device = None
    _last_error: str | None = None

    def _native_is_available(self) -> bool:
        """Return True only if RhythmMamba itself is configured and importable."""
        try:
            import torch  # noqa: F401

            if not BACKENDS_DIR.exists():
                self._last_error = f"RhythmMamba repo not found at {BACKENDS_DIR} (run scripts/setup_backends.sh)"
                return False
            if not _checkpoint_path().exists():
                self._last_error = f"Missing checkpoint: {_checkpoint_path()} (set VMAG_RHYTHMMAMBA_CHECKPOINT or place file there)"
                return False

            # Import-time dependency checks (CPU-only Mac builds commonly can't install mamba_ssm).
            import timm  # noqa: F401
            import mamba_ssm  # noqa: F401

            if str(BACKENDS_DIR) in sys.path:
                sys.path.remove(str(BACKENDS_DIR))
            sys.path.insert(0, str(BACKENDS_DIR))

            from neural_methods.model.RhythmMamba import RhythmMamba  # noqa: F401

            self._last_error = None
            return True
        except Exception as e:
            self._last_error = f"{type(e).__name__}: {e}"
            return False

    def is_available(self) -> bool:
        if self._native_is_available():
            return True

        # Fallback: keep the endpoint usable by using the rPPG-Toolbox engine.
        rppg = RPPGService()
        return rppg.is_available()

    def _load_model(self):
        if self._model is not None:
            return

        import torch

        if torch.backends.mps.is_available():
            self._device = torch.device("mps")
        elif torch.cuda.is_available():
            self._device = torch.device("cuda")
        else:
            self._device = torch.device("cpu")

        if str(BACKENDS_DIR) not in sys.path:
            sys.path.insert(0, str(BACKENDS_DIR))

        from neural_methods.model.RhythmMamba import RhythmMamba  # type: ignore

        model = RhythmMamba()
        ckpt_obj = torch.load(str(_checkpoint_path()), map_location="cpu", weights_only=False)
        if not isinstance(ckpt_obj, dict):
            raise ValueError("RhythmMamba checkpoint must be a state_dict dict.")
        ckpt_obj = _strip_module_prefix(ckpt_obj)
        model.load_state_dict(ckpt_obj, strict=False)
        model = model.to(self._device)
        model.eval()
        self._model = model

    def process(self, video_path: str, progress: ProgressSink | None = None) -> ProcessingResult:
        if not self._native_is_available():
            rppg = RPPGService()
            if not rppg.is_available():
                return ProcessingResult(success=False, error="RhythmMamba backend unavailable and rPPG fallback is also unavailable.")
            result = rppg.process(video_path, method="ALL", progress=progress)
            if result.success:
                result.warnings = (result.warnings or []) + ["RhythmMamba unavailable; used rPPG-Toolbox fallback."]
            else:
                result.error = f"RhythmMamba unavailable; rPPG-Toolbox fallback failed: {result.error}"
            return result

        cap = None
        try:
            import torch

            os.environ.setdefault("PYTORCH_ENABLE_MPS_FALLBACK", "1")
            if progress:
                progress.update(stage="load_model", message="Loading RhythmMamba model", percent=0.0, force=True)
            self._load_model()

            cap = cv2.VideoCapture(video_path)
            fps = cap.get(cv2.CAP_PROP_FPS) or 30.0
            total_frames = int(cap.get(cv2.CAP_PROP_FRAME_COUNT) or 0)
            if total_frames <= 0 and progress:
                total_frames = int(get_total_frames(video_path) or 0)

            frames_bgr: list[np.ndarray] = []
            read_count = 0
            while True:
                ret, frame = cap.read()
                if not ret:
                    break
                frames_bgr.append(frame)
                read_count += 1
                if progress and total_frames > 0:
                    overall = (read_count / total_frames) * 35.0
                    progress.update(
                        stage="read_frames",
                        message="Reading video frames",
                        current=read_count,
                        total=total_frames,
                        percent=overall,
                    )
            cap.release()

            frames_rgb = RPPGService.extract_face_frames_from_bgr_frames(frames_bgr, progress=progress)
            if frames_rgb is None:
                return ProcessingResult(success=False, error="No face detected in video.")

            # RhythmMamba training uses "Standardized" data: z-score over the full clip.
            data = frames_rgb.astype(np.float32)
            data = data - float(np.mean(data))
            std = float(np.std(data))
            if std > 1e-8:
                data = data / std
            data[np.isnan(data)] = 0.0

            # (N,H,W,3) -> (1,N,3,H,W)
            x = torch.from_numpy(data).permute(0, 3, 1, 2).unsqueeze(0).contiguous().to(self._device)

            if progress:
                progress.update(stage="infer", message="Running RhythmMamba inference", percent=75.0, force=True)
            with torch.no_grad():
                pred = self._model(x)

            bvp = pred.detach().cpu().numpy().reshape(-1)
            if progress:
                progress.update(stage="analyze", message="Estimating BPM", percent=90.0, force=True)
            bpm, conf, psd_freqs, psd_power = self._bvp_to_bpm(bvp, float(fps))
            if progress:
                progress.update(stage="analyze", message="Estimating BPM", percent=100.0, force=True)

            return ProcessingResult(
                success=True,
                data={
                    "bpm": float(bpm),
                    "confidence": float(conf),
                    "bvp": bvp.tolist(),
                    "engine": "rhythm_mamba",
                    "fps": float(fps),
                    "n_frames": int(frames_rgb.shape[0]),
                    "psd_freqs": psd_freqs,
                    "psd_power": psd_power,
                },
            )
        except Exception as e:
            try:
                if cap is not None:
                    cap.release()
            except Exception:
                pass
            return ProcessingResult(
                success=False,
                error=f"RhythmMamba processing failed: {e}\n{traceback.format_exc()}",
            )

    @staticmethod
    def _bvp_to_bpm(bvp: np.ndarray, fps: float):
        from scipy.fft import fft, fftfreq

        N = int(len(bvp))
        if N < 2 or fps <= 0:
            return 0.0, 0.0, [], []

        yf = np.abs(fft(bvp))[: N // 2]
        xf = fftfreq(N, 1.0 / fps)[: N // 2]

        hr_mask = (xf >= 0.67) & (xf <= 3.33)
        if not hr_mask.any():
            return 0.0, 0.0, [], []

        hr_freqs = xf[hr_mask]
        hr_power = yf[hr_mask]
        peak_idx = int(np.argmax(hr_power))
        peak_freq = float(hr_freqs[peak_idx])
        bpm = peak_freq * 60.0

        confidence = float(hr_power[peak_idx] / (hr_power.sum() + 1e-10))

        psd_mask = (xf >= 0.5) & (xf <= 4.0)
        psd_freqs = xf[psd_mask].tolist()
        psd_power = (yf[psd_mask] ** 2).tolist()

        return bpm, confidence, psd_freqs, psd_power
