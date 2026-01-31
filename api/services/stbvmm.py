"""STB-VMM service wrapper — Swin Transformer Based Video Motion Magnification."""

import os
import sys
import uuid
import traceback
from pathlib import Path

import cv2
import numpy as np

from api.services.base import BaseService, ProcessingResult
from api.progress import ProgressSink

BACKENDS_DIR = Path("backends/STB-VMM")
PROCESSED_DIR = Path("data/processed")
PROCESSED_DIR.mkdir(parents=True, exist_ok=True)

CHECKPOINT_PATH = Path("backends/STB-VMM/ckpt_e49.pth.tar")


class STBVMMService(BaseService):
    _model = None
    _device = None
    _last_error: str | None = None

    def is_available(self) -> bool:
        try:
            import torch  # noqa: F401
            if not BACKENDS_DIR.exists():
                return False
            if not CHECKPOINT_PATH.exists():
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

        # Auto-detect device
        if torch.backends.mps.is_available():
            self._device = torch.device("mps")
        elif torch.cuda.is_available():
            self._device = torch.device("cuda")
        else:
            self._device = torch.device("cpu")

        # Add STB-VMM to path
        if str(BACKENDS_DIR) not in sys.path:
            sys.path.insert(0, str(BACKENDS_DIR))

        from models.model import STBVMM

        self._model = STBVMM(
            img_size=384,
            patch_size=1,
            in_chans=3,
            embed_dim=192,
            depths=[6, 6, 6, 6, 6, 6],
            num_heads=[6, 6, 6, 6, 6, 6],
            window_size=8,
            mlp_ratio=2.0,
            qkv_bias=True,
            qk_scale=None,
            drop_rate=0.0,
            attn_drop_rate=0.0,
            drop_path_rate=0.1,
            norm_layer=torch.nn.LayerNorm,
            ape=False,
            patch_norm=True,
            use_checkpoint=False,
            img_range=1.0,
            resi_connection="1conv",
            manipulator_num_resblk=1,
        )

        ckpt = torch.load(str(CHECKPOINT_PATH), map_location="cpu", weights_only=False)
        if "state_dict" in ckpt:
            self._model.load_state_dict(ckpt["state_dict"])
        else:
            self._model.load_state_dict(ckpt)

        self._model = self._model.to(self._device)
        self._model.eval()

    def process(
        self,
        video_path: str,
        magnification: float = 20.0,
        mode: str = "static",
        max_frames: int = 0,
        progress: ProgressSink | None = None,
    ) -> ProcessingResult:
        cap = None
        writer = None
        try:
            import torch

            os.environ.setdefault("PYTORCH_ENABLE_MPS_FALLBACK", "1")
            if progress:
                progress.update(stage="load_model", message="Loading STB-VMM model", percent=0.0, force=True)
            self._load_model()

            cap = cv2.VideoCapture(video_path)
            total_frames = int(cap.get(cv2.CAP_PROP_FRAME_COUNT) or 0)

            fps = cap.get(cv2.CAP_PROP_FPS) or 30.0
            ret, first_frame = cap.read()
            if not ret or first_frame is None:
                cap.release()
                return ProcessingResult(success=False, error="Could not read video frames.")

            height, width = first_frame.shape[:2]

            # Model requires dimensions divisible by 64 (8x conv stride × 8 window size).
            # Resize to nearest multiples of 64, process, then resize output back.
            proc_h = ((height + 63) // 64) * 64
            proc_w = ((width + 63) // 64) * 64
            # Cap at reasonable size to avoid OOM / very slow inference on CPU.
            max_side = int(os.environ.get("VMAG_STBVMM_MAX_SIDE", "192"))
            if max_side < 64:
                max_side = 64
            max_side = max(64, (max_side // 64) * 64)
            proc_h = min(proc_h, max_side)
            proc_w = min(proc_w, max_side)

            warnings = []
            if proc_h < height or proc_w < width:
                warnings.append(
                    f"Downscaled to {proc_w}x{proc_h} for faster processing "
                    f"(set VMAG_STBVMM_MAX_SIDE to adjust)."
                )

            if max_frames > 0 and max_frames < 2:
                cap.release()
                return ProcessingResult(success=False, error="Video too short (need at least 2 frames).")

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
                progress.update(stage="infer", message="Running STB-VMM inference", percent=5.0, force=True)

            out_name = f"{uuid.uuid4().hex}.mp4"
            out_path = PROCESSED_DIR / out_name
            # Prefer H.264 (avc1) for in-browser playback (Chrome often can't decode mp4v).
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

            ref_frame = first_frame  # reference for static mode
            batch_size = int(os.environ.get("VMAG_STBVMM_BATCH_SIZE", "8"))
            if batch_size < 1:
                batch_size = 1

            ref_t = None
            if mode == "static":
                ref_t = self._preprocess(ref_frame, proc_h, proc_w)

            hit_frame_limit = False
            prev_frame = first_frame
            a_tensors = []
            b_tensors = []

            with torch.no_grad():
                def flush_batch():
                    nonlocal a_tensors, b_tensors
                    nonlocal out_frames
                    bs = len(b_tensors)
                    if bs <= 0:
                        return

                    if mode == "static" and ref_t is not None:
                        a_batch = ref_t.expand(bs, -1, -1, -1).contiguous().to(self._device)
                    else:
                        a_batch = torch.cat(a_tensors, dim=0).to(self._device)

                    b_batch = torch.cat(b_tensors, dim=0).to(self._device)
                    mag_batch = torch.full((bs, 1, 1, 1), float(magnification), device=self._device, dtype=torch.float32)
                    y_hat, _, _, _ = self._model(a_batch, b_batch, mag_batch)

                    for j in range(bs):
                        result_frame = self._postprocess(y_hat[j : j + 1], height, width)
                        writer.write(result_frame)
                        out_frames += 1
                        if progress:
                            if expected_out and expected_out > 0:
                                overall = 5.0 + (out_frames / expected_out) * 95.0
                                progress.update(
                                    stage="infer",
                                    message="Running STB-VMM inference",
                                    current=out_frames,
                                    total=expected_out,
                                    percent=overall,
                                )
                            else:
                                progress.update(
                                    stage="infer",
                                    message="Running STB-VMM inference",
                                    current=out_frames,
                                    total=None,
                                    percent=None,
                                )

                    a_tensors = []
                    b_tensors = []

                # Seed the first pair (frame0 -> frame1)
                if mode == "static":
                    b_tensors.append(self._preprocess(second_frame, proc_h, proc_w))
                else:
                    a_tensors.append(self._preprocess(prev_frame, proc_h, proc_w))
                    b_tensors.append(self._preprocess(second_frame, proc_h, proc_w))
                    prev_frame = second_frame

                while True:
                    if len(b_tensors) >= batch_size:
                        flush_batch()

                    if max_frames > 0 and read_frames >= max_frames:
                        hit_frame_limit = True
                        break

                    ret, frame = cap.read()
                    if not ret or frame is None:
                        break
                    read_frames += 1

                    if mode == "static":
                        b_tensors.append(self._preprocess(frame, proc_h, proc_w))
                    else:
                        a_tensors.append(self._preprocess(prev_frame, proc_h, proc_w))
                        b_tensors.append(self._preprocess(frame, proc_h, proc_w))
                        prev_frame = frame

                flush_batch()

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
                error=f"STB-VMM processing failed: {e}\n{traceback.format_exc()}",
            )

    def _preprocess(self, frame: np.ndarray, proc_h: int, proc_w: int):
        """BGR frame → resized, normalized [-1, 1] tensor (N, C, H, W)."""
        import torch

        rgb = cv2.cvtColor(frame, cv2.COLOR_BGR2RGB)
        if rgb.shape[0] != proc_h or rgb.shape[1] != proc_w:
            rgb = cv2.resize(rgb, (proc_w, proc_h), interpolation=cv2.INTER_AREA)
        rgb = rgb.astype(np.float32) / 127.5 - 1.0
        tensor = torch.from_numpy(rgb).permute(2, 0, 1).unsqueeze(0)
        return tensor

    def _postprocess(self, tensor, orig_h: int, orig_w: int) -> np.ndarray:
        """Model output tensor → BGR uint8 frame, resized to original dims."""
        arr = tensor.squeeze(0).permute(1, 2, 0).cpu().numpy()
        arr = np.clip(arr, -1.0, 1.0)
        arr = ((arr + 1.0) * 127.5).astype(np.uint8)
        bgr = cv2.cvtColor(arr, cv2.COLOR_RGB2BGR)
        if bgr.shape[0] != orig_h or bgr.shape[1] != orig_w:
            bgr = cv2.resize(bgr, (orig_w, orig_h), interpolation=cv2.INTER_LINEAR)
        return bgr
