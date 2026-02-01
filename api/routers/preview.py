"""Preview helpers for the frontend (thumbnails / ROI selection)."""

from __future__ import annotations

import asyncio
import base64
from dataclasses import dataclass

import cv2
from fastapi import APIRouter, File, Form, UploadFile

from api.models.schemas import PreviewFrameResponse
from api.upload import save_upload

router = APIRouter()


@dataclass(frozen=True)
class _PreviewFrame:
    frame_width: int
    frame_height: int
    preview_width: int
    preview_height: int
    preview_data_url: str


def _extract_preview_frame(video_path: str, *, max_side: int) -> _PreviewFrame:
    cap = cv2.VideoCapture(video_path)
    ok, frame = cap.read()
    cap.release()

    if not ok or frame is None:
        raise ValueError("Could not decode the first frame of the video.")

    frame_height, frame_width = frame.shape[:2]

    max_side = int(max_side)
    max_side = 960 if max_side <= 0 else max_side
    max_side = max(64, min(4096, max_side))

    scale = min(1.0, max_side / float(max(frame_width, frame_height)))
    preview_width = max(1, int(round(frame_width * scale)))
    preview_height = max(1, int(round(frame_height * scale)))

    if scale < 1.0:
        frame = cv2.resize(frame, (preview_width, preview_height), interpolation=cv2.INTER_AREA)

    ok, buf = cv2.imencode(".jpg", frame, [int(cv2.IMWRITE_JPEG_QUALITY), 85])
    if not ok:
        raise ValueError("Failed to encode preview frame as JPEG.")

    b64 = base64.b64encode(buf.tobytes()).decode("ascii")
    return _PreviewFrame(
        frame_width=frame_width,
        frame_height=frame_height,
        preview_width=preview_width,
        preview_height=preview_height,
        preview_data_url=f"data:image/jpeg;base64,{b64}",
    )


@router.post("/frame", response_model=PreviewFrameResponse)
async def preview_frame(
    video: UploadFile = File(...),
    max_side: int = Form(960),
):
    """Return a JPEG data URL for the first frame of a video.

    This exists to support ROI selection for formats that browsers can't decode
    (e.g. AVI from high-speed cameras), while the backend can via OpenCV/FFmpeg.
    """
    path = await save_upload(video)
    try:
        preview = await asyncio.to_thread(_extract_preview_frame, str(path), max_side=max_side)
        return PreviewFrameResponse(
            success=True,
            frame_width=preview.frame_width,
            frame_height=preview.frame_height,
            preview_width=preview.preview_width,
            preview_height=preview.preview_height,
            preview_data_url=preview.preview_data_url,
        )
    except Exception as e:
        return PreviewFrameResponse(success=False, error=f"{type(e).__name__}: {e}")
    finally:
        path.unlink(missing_ok=True)

