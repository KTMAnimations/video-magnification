"""Audio recovery endpoint — Visual-Mic."""

import time
from fastapi import APIRouter, File, Form, UploadFile

from api.models.schemas import ProcessingResponse
from api.upload import save_upload
from api.services import get_visualmic

router = APIRouter()


@router.post("/recover", response_model=ProcessingResponse)
async def recover_audio(
    video: UploadFile = File(...),
    roi_x: int = Form(0),
    roi_y: int = Form(0),
    roi_w: int = Form(0),
    roi_h: int = Form(0),
):
    """Audio recovery from video using Visual-Mic."""
    t0 = time.time()
    path = await save_upload(video)
    svc = get_visualmic()
    if not svc.is_available():
        return ProcessingResponse(
            success=False, error="Visual-Mic backend is not available."
        )
    roi = None
    if roi_w > 0 and roi_h > 0:
        roi = (roi_x, roi_y, roi_w, roi_h)
    result = svc.process(str(path), roi=roi)
    result.processing_time_seconds = time.time() - t0
    return ProcessingResponse(
        success=result.success,
        output_url=f"/files/audio/{result.output_path}" if result.output_path else None,
        data=result.data,
        error=result.error,
        warnings=result.warnings,
        processing_time_seconds=result.processing_time_seconds,
    )
