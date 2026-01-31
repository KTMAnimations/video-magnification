"""STB-VMM service wrapper — Swin Transformer Based Video Motion Magnification."""

import os
import sys
import uuid
import traceback
from pathlib import Path

import cv2
import numpy as np

from api.services.base import BaseService, ProcessingResult

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
    ) -> ProcessingResult:
        try:
            import torch

            os.environ.setdefault("PYTORCH_ENABLE_MPS_FALLBACK", "1")
            self._load_model()

            cap = cv2.VideoCapture(video_path)
            fps = cap.get(cv2.CAP_PROP_FPS) or 30.0
            width = int(cap.get(cv2.CAP_PROP_FRAME_WIDTH))
            height = int(cap.get(cv2.CAP_PROP_FRAME_HEIGHT))

            frames = []
            while True:
                ret, frame = cap.read()
                if not ret:
                    break
                frames.append(frame)
            cap.release()

            if len(frames) < 2:
                return ProcessingResult(success=False, error="Video too short (need at least 2 frames).")

            # Model requires dimensions divisible by 64 (8x conv stride × 8 window size).
            # Resize to nearest multiples of 64, process, then resize output back.
            proc_h = ((height + 63) // 64) * 64
            proc_w = ((width + 63) // 64) * 64
            # Cap at reasonable size to avoid OOM
            proc_h = min(proc_h, 384)
            proc_w = min(proc_w, 384)

            out_name = f"{uuid.uuid4().hex}.mp4"
            out_path = PROCESSED_DIR / out_name
            fourcc = cv2.VideoWriter_fourcc(*"mp4v")
            writer = cv2.VideoWriter(str(out_path), fourcc, fps, (width, height))

            # Magnification factor as tensor
            mag_factor = torch.tensor(magnification).float()
            mag_factor = mag_factor.unsqueeze(0).unsqueeze(0).unsqueeze(0).unsqueeze(0)
            mag_factor = mag_factor.to(self._device)

            ref_frame = frames[0]  # reference for static mode

            with torch.no_grad():
                for i in range(1, len(frames)):
                    if mode == "static":
                        frame_a = ref_frame
                    else:  # dynamic
                        frame_a = frames[i - 1]
                    frame_b = frames[i]

                    # Preprocess: BGR→RGB, resize, normalize to [-1, 1]
                    a_t = self._preprocess(frame_a, proc_h, proc_w).to(self._device)
                    b_t = self._preprocess(frame_b, proc_h, proc_w).to(self._device)

                    # Model takes (frame_a, frame_b, mag_factor) separately
                    y_hat, _, _, _ = self._model(a_t, b_t, mag_factor)

                    # Denormalize and resize back to original dims
                    result_frame = self._postprocess(y_hat, height, width)
                    writer.write(result_frame)

            writer.release()
            return ProcessingResult(success=True, output_path=out_name)

        except Exception as e:
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
