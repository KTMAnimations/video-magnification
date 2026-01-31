"""Audio recovery endpoint — Visual-Mic."""

import asyncio
import time
from fastapi import APIRouter, File, Form, UploadFile

from api.models.schemas import ProcessingResponse
from api.progress import ProgressSink, complete_job, error_job, start_job
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
    job_id: str = Form(""),
):
    """Audio recovery from video using Visual-Mic."""
    t0 = time.time()
    job_id = (job_id or "").strip()
    sink = ProgressSink(job_id) if job_id else None
    if job_id:
        start_job(job_id, stage="upload", message="Starting upload")

    if sink:
        sink.update(stage="upload", message="Saving upload", percent=0, force=True)
    path = await save_upload(video)
    if sink:
        sink.update(stage="process", message="Processing video", percent=0, force=True)
    svc = get_visualmic()
    if not svc.is_available():
        if job_id:
            error_job(job_id, "Visual-Mic backend is not available.")
        return ProcessingResponse(
            success=False, error="Visual-Mic backend is not available."
        )
    roi = None
    if roi_w > 0 and roi_h > 0:
        roi = (roi_x, roi_y, roi_w, roi_h)
    try:
        result = await asyncio.to_thread(svc.process, str(path), roi=roi, progress=sink)
    except Exception as e:
        if job_id:
            error_job(job_id, f"{type(e).__name__}: {e}")
        raise
    result.processing_time_seconds = time.time() - t0
    if job_id:
        if result.success:
            complete_job(job_id, message="Done")
        else:
            error_job(job_id, result.error or "Processing failed")
    return ProcessingResponse(
        success=result.success,
        output_url=f"/files/audio/{result.output_path}" if result.output_path else None,
        data=result.data,
        error=result.error,
        warnings=result.warnings,
        processing_time_seconds=result.processing_time_seconds,
    )
