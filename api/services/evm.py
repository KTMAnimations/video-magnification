"""Eulerian Video Magnification service wrapper."""

import uuid
import traceback
from pathlib import Path

import cv2
import numpy as np

from api.services.base import BaseService, ProcessingResult

PROCESSED_DIR = Path("data/processed")
PROCESSED_DIR.mkdir(parents=True, exist_ok=True)


class EVMService(BaseService):
    _last_error: str | None = None

    def is_available(self) -> bool:
        try:
            import eulerian_magnification  # noqa: F401
            self._last_error = None
            return True
        except Exception as e:
            self._last_error = f"{type(e).__name__}: {e}"
            return False

    def process(
        self,
        video_path: str,
        freq_min: float = 0.75,
        freq_max: float = 3.0,
        amplification: float = 50.0,
        pyramid_levels: int = 4,
        roi: tuple[int, int, int, int] | None = None,
    ) -> ProcessingResult:
        try:
            from eulerian_magnification import eulerian_magnification as evm_fn

            if freq_min <= 0 or freq_max <= 0:
                return ProcessingResult(success=False, error="Frequencies must be > 0.")
            if freq_min >= freq_max:
                return ProcessingResult(success=False, error="freq_min must be < freq_max.")
            if amplification <= 0:
                return ProcessingResult(success=False, error="amplification must be > 0.")
            if pyramid_levels < 1:
                return ProcessingResult(success=False, error="pyramid_levels must be >= 1.")

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

            if not frames:
                return ProcessingResult(success=False, error="Could not read video frames.")

            x0 = y0 = x1 = y1 = None
            if roi is not None:
                rx, ry, rw, rh = roi
                x0 = max(0, int(rx))
                y0 = max(0, int(ry))
                x1 = min(width, x0 + max(1, int(rw)))
                y1 = min(height, y0 + max(1, int(rh)))
                if x1 <= x0 or y1 <= y0:
                    roi = None
                else:
                    # OpenCV pyramid ops can change dimensions when downsampling odd sizes.
                    # Keep ROI dimensions divisible by 2^(levels-1) to avoid shape mismatches.
                    factor = 2 ** max(0, pyramid_levels - 1)
                    roi_w = x1 - x0
                    roi_h = y1 - y0
                    roi_w = roi_w - (roi_w % factor)
                    roi_h = roi_h - (roi_h % factor)
                    if roi_w < factor or roi_h < factor:
                        roi = None
                    else:
                        x1 = min(width, x0 + roi_w)
                        y1 = min(height, y0 + roi_h)

            if roi is None:
                # EVM expects numpy array with shape (n_frames, h, w, 3)
                vid_data = np.array(frames)
                result_frames = evm_fn(
                    vid_data, fps, freq_min, freq_max, amplification, pyramid_levels
                )
            else:
                roi_frames = [f[y0:y1, x0:x1] for f in frames]
                roi_vid_data = np.array(roi_frames)
                roi_result_frames = evm_fn(
                    roi_vid_data, fps, freq_min, freq_max, amplification, pyramid_levels
                )
                # Composite ROI back onto full frames
                result_frames = []
                for orig, roi_frame in zip(frames, roi_result_frames, strict=False):
                    out = orig.copy()
                    if roi_frame.dtype != np.uint8:
                        roi_frame = np.clip(roi_frame, 0, 255).astype(np.uint8)
                    if roi_frame.shape[0] != (y1 - y0) or roi_frame.shape[1] != (x1 - x0):
                        roi_frame = cv2.resize(roi_frame, (x1 - x0, y1 - y0))
                    out[y0:y1, x0:x1] = roi_frame
                    result_frames.append(out)

            # Write output
            out_name = f"{uuid.uuid4().hex}.mp4"
            out_path = PROCESSED_DIR / out_name
            fourcc = cv2.VideoWriter_fourcc(*"mp4v")
            writer = cv2.VideoWriter(str(out_path), fourcc, fps, (width, height))

            for frame in result_frames:
                # Clip float frames to [0, 255]
                if frame.dtype != np.uint8:
                    frame = np.clip(frame, 0, 255).astype(np.uint8)
                if frame.shape[:2] != (height, width):
                    frame = cv2.resize(frame, (width, height))
                writer.write(frame)
            writer.release()

            return ProcessingResult(success=True, output_path=out_name)

        except Exception as e:
            return ProcessingResult(success=False, error=f"EVM processing failed: {e}\n{traceback.format_exc()}")
