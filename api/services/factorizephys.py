"""FactorizePhys service wrapper — NeurIPS 2024 supervised rPPG (FSAM)."""

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

BACKENDS_DIR = Path("backends/FactorizePhys")


def _checkpoint_path() -> Path:
    return Path(
        os.environ.get(
            "VMAG_FACTORIZEPHYS_CHECKPOINT",
            "backends/FactorizePhys/final_model_release/PURE_FactorizePhys_FSAM_Res.pth",
        )
    )


def _strip_module_prefix(state_dict: dict) -> dict:
    if not state_dict:
        return state_dict
    if not any(k.startswith("module.") for k in state_dict.keys()):
        return state_dict
    return {k.removeprefix("module."): v for k, v in state_dict.items()}


class FactorizePhysService(BaseService):
    _model = None
    _device = None
    _last_error: str | None = None

    def is_available(self) -> bool:
        try:
            import torch  # noqa: F401

            if not BACKENDS_DIR.exists():
                self._last_error = f"FactorizePhys repo not found at {BACKENDS_DIR} (run scripts/setup_backends.sh)"
                return False
            if not _checkpoint_path().exists():
                self._last_error = f"Missing checkpoint: {_checkpoint_path()} (run scripts/download_weights.sh)"
                return False

            if str(BACKENDS_DIR) not in sys.path:
                sys.path.insert(0, str(BACKENDS_DIR))
            from neural_methods.model.FactorizePhys.FactorizePhys import FactorizePhys  # noqa: F401

            self._last_error = None
            return True
        except Exception as e:
            self._last_error = f"{type(e).__name__}: {e}"
            return False

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

        from neural_methods.model.FactorizePhys.FactorizePhys import FactorizePhys  # type: ignore

        md_config = {
            "MD_FSAM": True,
            "MD_TYPE": "NMF",
            "MD_TRANSFORM": "T_KAB",
            "MD_R": 1,
            "MD_S": 1,
            "MD_STEPS": 4,
            "MD_INFERENCE": True,
            "MD_RESIDUAL": True,
        }

        model = FactorizePhys(frames=160, md_config=md_config, in_channels=3, dropout=0.1, device=self._device)
        ckpt_obj = torch.load(str(_checkpoint_path()), map_location="cpu", weights_only=False)
        if not isinstance(ckpt_obj, dict):
            raise ValueError("FactorizePhys checkpoint must be a state_dict dict.")
        ckpt_obj = _strip_module_prefix(ckpt_obj)
        model.load_state_dict(ckpt_obj, strict=False)
        model = model.to(self._device)
        model.eval()
        self._model = model

    def process(self, video_path: str, progress: ProgressSink | None = None) -> ProcessingResult:
        cap = None
        try:
            import torch

            os.environ.setdefault("PYTORCH_ENABLE_MPS_FALLBACK", "1")
            if progress:
                progress.update(stage="load_model", message="Loading FactorizePhys model", percent=0.0, force=True)
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

            # FactorizePhys configs typically use 72x72.
            frames_72 = np.stack(
                [cv2.resize(f.astype(np.float32), (72, 72), interpolation=cv2.INTER_AREA) for f in frames_rgb],
                axis=0,
            )

            # (N,H,W,3) -> (1,3,N,H,W)
            x = (frames_72 / 255.0).astype(np.float32)
            x_t = torch.from_numpy(x).permute(3, 0, 1, 2).unsqueeze(0).contiguous().to(self._device)

            if progress:
                progress.update(stage="infer", message="Running FactorizePhys inference", percent=75.0, force=True)
            with torch.no_grad():
                out = self._model(x_t)

            # Model may return (rPPG, voxel_embeddings, ...) depending on md_config.
            rppg = out[0] if isinstance(out, (tuple, list)) else out
            bvp = rppg.detach().cpu().numpy().reshape(-1)

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
                    "engine": "factorizephys",
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
                error=f"FactorizePhys processing failed: {e}\n{traceback.format_exc()}",
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
