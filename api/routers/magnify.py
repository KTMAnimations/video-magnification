"""Magnification endpoints — motion (multiple engines) and color (EVM)."""

import asyncio
import time
from fastapi import APIRouter, File, Form, UploadFile

from api.models.schemas import ProcessingResponse
from api.progress import ProgressSink, complete_job, error_job, start_job
from api.upload import save_upload
from api.services import get_evm, get_fd4mm, get_flowmag, get_stbvmm

router = APIRouter()


@router.post("/motion", response_model=ProcessingResponse)
async def magnify_motion(
    video: UploadFile = File(...),
    engine: str = Form("stbvmm"),
    magnification: float = Form(20.0),
    mode: str = Form("static"),
    max_frames: int = Form(0),
    max_side: int = Form(0),
    job_id: str = Form(""),
):
    """Motion magnification using a selectable engine."""
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

    engine = (engine or "stbvmm").strip().lower()
    engine_map = {
        "stbvmm": get_stbvmm,
        "fd4mm": get_fd4mm,
        "flowmag": get_flowmag,
    }
    if engine not in engine_map:
        msg = f"Unknown motion engine: {engine}"
        if job_id:
            error_job(job_id, msg)
        return ProcessingResponse(success=False, error=msg)

    svc = engine_map[engine]()
    if not svc.is_available():
        if job_id:
            error_job(job_id, f"{engine} backend is not available.")
        return ProcessingResponse(
            success=False, error=f"{engine} backend is not available."
        )
    try:
        result = await asyncio.to_thread(
            svc.process,
            str(path),
            magnification=magnification,
            mode=mode,
            max_frames=max_frames,
            max_side=max_side,
            progress=sink,
        )
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
        output_url=f"/files/processed/{result.output_path}" if result.output_path else None,
        data=result.data,
        error=result.error,
        warnings=result.warnings,
        processing_time_seconds=result.processing_time_seconds,
    )


@router.post("/color", response_model=ProcessingResponse)
async def magnify_color(
    video: UploadFile = File(...),
    freq_min: float = Form(0.75),
    freq_max: float = Form(3.0),
    amplification: float = Form(50.0),
    pyramid_levels: int = Form(4),
    roi_x: int = Form(0),
    roi_y: int = Form(0),
    roi_w: int = Form(0),
    roi_h: int = Form(0),
    job_id: str = Form(""),
):
    """Color magnification using Eulerian Video Magnification."""
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
    svc = get_evm()
    if not svc.is_available():
        if job_id:
            error_job(job_id, "EVM backend is not available.")
        return ProcessingResponse(
            success=False, error="EVM backend is not available."
        )
    roi = None
    if roi_w > 0 and roi_h > 0:
        roi = (roi_x, roi_y, roi_w, roi_h)
    try:
        result = await asyncio.to_thread(
            svc.process,
            str(path),
            freq_min=freq_min,
            freq_max=freq_max,
            amplification=amplification,
            pyramid_levels=pyramid_levels,
            roi=roi,
            progress=sink,
        )
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
        output_url=f"/files/processed/{result.output_path}" if result.output_path else None,
        data=result.data,
        error=result.error,
        warnings=result.warnings,
        processing_time_seconds=result.processing_time_seconds,
    )
