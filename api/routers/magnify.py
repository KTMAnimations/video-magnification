"""Magnification endpoints — motion (STB-VMM) and color (EVM)."""

import time
from fastapi import APIRouter, File, Form, UploadFile

from api.models.schemas import ProcessingResponse
from api.upload import save_upload
from api.services import get_evm, get_stbvmm

router = APIRouter()


@router.post("/motion", response_model=ProcessingResponse)
async def magnify_motion(
    video: UploadFile = File(...),
    magnification: float = Form(20.0),
    mode: str = Form("static"),
):
    """Motion magnification using STB-VMM."""
    t0 = time.time()
    path = await save_upload(video)
    svc = get_stbvmm()
    if not svc.is_available():
        return ProcessingResponse(
            success=False, error="STB-VMM backend is not available."
        )
    result = svc.process(str(path), magnification=magnification, mode=mode)
    result.processing_time_seconds = time.time() - t0
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
):
    """Color magnification using Eulerian Video Magnification."""
    t0 = time.time()
    path = await save_upload(video)
    svc = get_evm()
    if not svc.is_available():
        return ProcessingResponse(
            success=False, error="EVM backend is not available."
        )
    roi = None
    if roi_w > 0 and roi_h > 0:
        roi = (roi_x, roi_y, roi_w, roi_h)
    result = svc.process(
        str(path),
        freq_min=freq_min,
        freq_max=freq_max,
        amplification=amplification,
        pyramid_levels=pyramid_levels,
        roi=roi,
    )
    result.processing_time_seconds = time.time() - t0
    return ProcessingResponse(
        success=result.success,
        output_url=f"/files/processed/{result.output_path}" if result.output_path else None,
        data=result.data,
        error=result.error,
        warnings=result.warnings,
        processing_time_seconds=result.processing_time_seconds,
    )
