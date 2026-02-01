"""FlowMag service wrapper — NeurIPS 2023 optical-flow-supervised motion magnification."""

from __future__ import annotations

import os
import sys
import traceback
import uuid
from dataclasses import dataclass
from pathlib import Path

import cv2
import numpy as np

from api.progress import ProgressSink
from api.services.base import BaseService, ProcessingResult
from api.utils.video import get_total_frames

BACKENDS_DIR = Path("backends/flowmag")
PROCESSED_DIR = Path("data/processed")
PROCESSED_DIR.mkdir(parents=True, exist_ok=True)


def _checkpoint_path() -> Path:
    return Path(os.environ.get("VMAG_FLOWMAG_CHECKPOINT", "backends/flowmag/checkpoints/raft_chkpt_00140.pth"))


def _config_path() -> Path:
    return Path(os.environ.get("VMAG_FLOWMAG_CONFIG", "backends/flowmag/configs/alpha16.color10.yaml"))


@dataclass(frozen=True)
class _FrameTransform:
    orig_w: int
    orig_h: int
    resized_w: int
    resized_h: int


def _strip_module_prefix(state_dict: dict) -> dict:
    if not state_dict:
        return state_dict
    if not any(k.startswith("module.") for k in state_dict.keys()):
        return state_dict
    return {k.removeprefix("module."): v for k, v in state_dict.items()}


class FlowMagService(BaseService):
    _model = None
    _device = None
    _max_alpha: float | None = None
    _last_error: str | None = None

    def is_available(self) -> bool:
        try:
            import torch  # noqa: F401
            from omegaconf import OmegaConf  # noqa: F401

            if not BACKENDS_DIR.exists():
                return False
            if not _checkpoint_path().exists():
                return False
            if not _config_path().exists():
                self._last_error = f"Missing config: {_config_path()} (set VMAG_FLOWMAG_CONFIG or place file there)"
                return False

            self._last_error = None
            return True
        except Exception as e:
            self._last_error = f"{type(e).__name__}: {e}"
            return False

    def _load_model(self):
        if self._model is not None:
            return

        import torch
        from omegaconf import OmegaConf

        if torch.backends.mps.is_available():
            self._device = torch.device("mps")
        elif torch.cuda.is_available():
            self._device = torch.device("cuda")
        else:
            self._device = torch.device("cpu")

        if str(BACKENDS_DIR) not in sys.path:
            sys.path.insert(0, str(BACKENDS_DIR))

        config = OmegaConf.load(str(_config_path()))
        # Force inference settings
        config.train.is_training = False
        config.train.ngpus = 1
        config.data.batch_size = 1
        self._max_alpha = float(getattr(config.train, "alpha_high", 16.0))

        from model import MotionMagModel  # type: ignore

        model = MotionMagModel(config)
        ckpt_obj = torch.load(str(_checkpoint_path()), map_location="cpu", weights_only=False)
        if isinstance(ckpt_obj, dict) and "state_dict" in ckpt_obj:
            state_dict = ckpt_obj["state_dict"]
        else:
            state_dict = ckpt_obj
        if not isinstance(state_dict, dict):
            raise ValueError("FlowMag checkpoint must be a dict or contain 'state_dict'.")
        state_dict = _strip_module_prefix(state_dict)
        model.load_state_dict(state_dict, strict=False)
        model = model.to(self._device)
        model.eval()

        self._model = model

    @staticmethod
    def _alpha_plan(alpha: float, max_alpha: float) -> tuple[float, int]:
        """Return (alpha_per_pass, num_recursions) based on FlowMag's inference logic."""
        if alpha <= max_alpha:
            return alpha, 1
        root = float(alpha) ** 0.5
        if root < max_alpha:
            return root, 2
        raise ValueError(f"alpha={alpha} out of supported range (max_alpha={max_alpha})")

    def process(
        self,
        video_path: str,
        magnification: float = 20.0,
        mode: str = "static",
        max_frames: int = 0,
        max_side: int = 0,
        progress: ProgressSink | None = None,
    ) -> ProcessingResult:
        cap = None
        writer = None
        try:
            import torch

            os.environ.setdefault("PYTORCH_ENABLE_MPS_FALLBACK", "1")
            if progress:
                progress.update(stage="load_model", message="Loading FlowMag model", percent=0.0, force=True)
            self._load_model()
            assert self._max_alpha is not None

            cap = cv2.VideoCapture(video_path)
            total_frames = int(cap.get(cv2.CAP_PROP_FRAME_COUNT) or 0)
            if total_frames <= 0 and progress and (not max_frames or int(max_frames) <= 0):
                total_frames = int(get_total_frames(video_path) or 0)

            fps = cap.get(cv2.CAP_PROP_FPS) or 30.0
            ret, first_frame = cap.read()
            if not ret or first_frame is None:
                cap.release()
                return ProcessingResult(success=False, error="Could not read video frames.")

            height, width = first_frame.shape[:2]
            warnings: list[str] = []

            transform = self._compute_transform(width=width, height=height, max_side=max_side)
            if transform.resized_w < width or transform.resized_h < height:
                warnings.append(f"Downscaled to {transform.resized_w}x{transform.resized_h} for faster processing.")

            ret, second_frame = cap.read()
            if not ret or second_frame is None:
                cap.release()
                return ProcessingResult(success=False, error="Video too short (need at least 2 frames).")
            read_frames = 2

            expected_total = None
            if total_frames > 0 and max_frames > 0:
                expected_total = min(total_frames, max_frames)
            elif total_frames > 0:
                expected_total = total_frames
            elif max_frames > 0:
                expected_total = max_frames
            expected_out = (expected_total - 1) if expected_total and expected_total >= 2 else None
            out_frames = 0

            if progress:
                progress.update(stage="infer", message="Running FlowMag inference", percent=5.0, force=True)

            out_name = f"{uuid.uuid4().hex}.mp4"
            out_path = PROCESSED_DIR / out_name
            fourcc = cv2.VideoWriter_fourcc(*"avc1")
            writer = cv2.VideoWriter(str(out_path), fourcc, fps, (width, height))
            if not writer.isOpened():
                warnings.append("H.264 encoder unavailable; falling back to mp4v (may not play in-browser).")
                fourcc = cv2.VideoWriter_fourcc(*"mp4v")
                writer = cv2.VideoWriter(str(out_path), fourcc, fps, (width, height))
            if not writer.isOpened():
                cap.release()
                writer.release()
                return ProcessingResult(success=False, error="Failed to initialize video writer.", warnings=warnings)

            alpha_per_pass, recursions = self._alpha_plan(float(magnification), float(self._max_alpha))

            ref_frame_bgr = first_frame
            prev_frame_bgr = first_frame

            hit_frame_limit = False
            with torch.no_grad():
                frame_bgr = second_frame
                while True:
                    if mode == "static":
                        ref = ref_frame_bgr
                    else:
                        ref = prev_frame_bgr
                        prev_frame_bgr = frame_bgr

                    im0 = self._preprocess(ref, transform).to(self._device)
                    im1 = self._preprocess(frame_bgr, transform).to(self._device)

                    frames = torch.stack([im0, im1], dim=2)  # (1,3,2,H,W)
                    for _ in range(recursions):
                        pred = self._model(frames, alpha=alpha_per_pass)
                        # pred: (1,3,1,H,W) — feed back pred as "current"
                        frames = torch.stack([im0, pred[:, :, 0]], dim=2)

                    out_bgr = self._postprocess(pred[:, :, 0], transform, out_w=width, out_h=height)
                    writer.write(out_bgr)
                    out_frames += 1

                    if progress:
                        if expected_out and expected_out > 0:
                            overall = 5.0 + (out_frames / expected_out) * 95.0
                            progress.update(
                                stage="infer",
                                message="Running FlowMag inference",
                                current=out_frames,
                                total=expected_out,
                                percent=overall,
                            )
                        else:
                            progress.update(
                                stage="infer",
                                message="Running FlowMag inference",
                                current=out_frames,
                                total=None,
                                percent=None,
                            )

                    if max_frames > 0 and read_frames >= max_frames:
                        hit_frame_limit = True
                        break

                    ret, next_frame = cap.read()
                    if not ret or next_frame is None:
                        break
                    read_frames += 1
                    frame_bgr = next_frame

            writer.release()
            cap.release()

            if max_frames > 0 and hit_frame_limit:
                if total_frames:
                    warnings.append(f"Fast preview: processed first {max_frames} frames out of {total_frames}.")
                else:
                    warnings.append(f"Fast preview: processed first {max_frames} frames.")

            return ProcessingResult(success=True, output_path=out_name, warnings=warnings)

        except Exception as e:
            try:
                if writer is not None:
                    writer.release()
            except Exception:
                pass
            try:
                if cap is not None:
                    cap.release()
            except Exception:
                pass
            return ProcessingResult(
                success=False,
                error=f"FlowMag processing failed: {e}\n{traceback.format_exc()}",
            )

    def _compute_transform(self, width: int, height: int, max_side: int = 0) -> _FrameTransform:
        if not max_side or max_side <= 0:
            return _FrameTransform(orig_w=width, orig_h=height, resized_w=width, resized_h=height)

        requested_max_side = max(64, int(max_side))
        longest = max(width, height)
        if longest <= requested_max_side:
            return _FrameTransform(orig_w=width, orig_h=height, resized_w=width, resized_h=height)

        scale = requested_max_side / float(longest)
        resized_w = max(1, int(round(width * scale)))
        resized_h = max(1, int(round(height * scale)))
        return _FrameTransform(orig_w=width, orig_h=height, resized_w=resized_w, resized_h=resized_h)

    def _preprocess(self, frame_bgr: np.ndarray, transform: _FrameTransform):
        import torch

        frame = frame_bgr
        if transform.resized_w != transform.orig_w or transform.resized_h != transform.orig_h:
            frame = cv2.resize(frame, (transform.resized_w, transform.resized_h), interpolation=cv2.INTER_AREA)

        rgb = cv2.cvtColor(frame, cv2.COLOR_BGR2RGB).astype(np.float32) / 255.0
        return torch.from_numpy(rgb).permute(2, 0, 1).unsqueeze(0).contiguous()

    def _postprocess(self, pred_chw, transform: _FrameTransform, *, out_w: int, out_h: int) -> np.ndarray:
        # pred_chw: (1,3,H,W) in [0,1] RGB
        rgb = pred_chw.squeeze(0).detach().cpu().clamp(0.0, 1.0).permute(1, 2, 0).numpy()
        rgb_u8 = (rgb * 255.0).astype(np.uint8)

        if transform.resized_w != transform.orig_w or transform.resized_h != transform.orig_h:
            rgb_u8 = cv2.resize(rgb_u8, (transform.orig_w, transform.orig_h), interpolation=cv2.INTER_LINEAR)

        if rgb_u8.shape[1] != out_w or rgb_u8.shape[0] != out_h:
            rgb_u8 = cv2.resize(rgb_u8, (out_w, out_h), interpolation=cv2.INTER_LINEAR)

        return cv2.cvtColor(rgb_u8, cv2.COLOR_RGB2BGR)
