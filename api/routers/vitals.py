"""Vitals endpoints — heart rate (rPPG) and real-time (pyVHR) + WebSocket."""

import asyncio
import os
import time
from typing import List

from fastapi import APIRouter, File, Form, UploadFile, WebSocket, WebSocketDisconnect

from api.models.schemas import ProcessingResponse
from api.upload import save_upload
from api.services import get_rppg, get_pyvhr

router = APIRouter()


@router.post("/heartrate", response_model=ProcessingResponse)
async def extract_heartrate(
    video: UploadFile = File(...),
    method: str = Form("POS_WANG"),
):
    """Heart rate extraction using rPPG-Toolbox unsupervised methods."""
    t0 = time.time()
    path = await save_upload(video)
    svc = get_rppg()
    if not svc.is_available():
        return ProcessingResponse(
            success=False, error="rPPG-Toolbox backend is not available."
        )
    result = svc.process(str(path), method=method)
    result.processing_time_seconds = time.time() - t0
    return ProcessingResponse(
        success=result.success,
        data=result.data,
        error=result.error,
        warnings=result.warnings,
        processing_time_seconds=result.processing_time_seconds,
    )


@router.post("/realtime", response_model=ProcessingResponse)
async def extract_vitals_realtime(
    video: UploadFile = File(...),
    method: str = Form("cpu_POS"),
    winsize: int = Form(5),
):
    """Vitals extraction using pyVHR."""
    t0 = time.time()
    path = await save_upload(video)
    svc = get_pyvhr()
    if not svc.is_available():
        return ProcessingResponse(
            success=False, error="pyVHR backend is not available."
        )
    result = svc.process(str(path), method=method, winsize=winsize)
    result.processing_time_seconds = time.time() - t0
    return ProcessingResponse(
        success=result.success,
        data=result.data,
        error=result.error,
        warnings=result.warnings,
        processing_time_seconds=result.processing_time_seconds,
    )


@router.websocket("/ws/vitals")
async def vitals_websocket(websocket: WebSocket):
    """WebSocket for real-time vitals from webcam frames.

    Accepts binary JPEG frames, accumulates buffer, processes via pyVHR.
    Returns JSON: {bpm, confidence, bvp, timestamp}
    """
    await websocket.accept()
    svc = get_pyvhr()
    if not svc.is_available():
        await websocket.send_json({"error": "pyVHR backend is not available"})
        await websocket.close()
        return

    frame_buffer: List[bytes] = []
    MIN_FRAMES = int(os.environ.get("VMAG_VITALS_MIN_FRAMES", "180"))  # ~6s at 30fps
    PROGRESS_EVERY = int(os.environ.get("VMAG_VITALS_PROGRESS_EVERY_FRAMES", "30"))  # ~1s at 30fps

    try:
        while True:
            data = await websocket.receive_bytes()
            frame_buffer.append(data)

            if len(frame_buffer) < MIN_FRAMES and PROGRESS_EVERY > 0 and (len(frame_buffer) % PROGRESS_EVERY == 0):
                await websocket.send_json(
                    {
                        "status": "collecting",
                        "frames_collected": len(frame_buffer),
                        "frames_needed": MIN_FRAMES,
                    }
                )

            if len(frame_buffer) >= MIN_FRAMES:
                loop = asyncio.get_event_loop()
                result = await loop.run_in_executor(
                    None, svc.process_frames, frame_buffer, 30.0
                )
                if result.success and result.data:
                    await websocket.send_json(result.data)
                elif result.error:
                    await websocket.send_json({"error": result.error})

                # Sliding window: keep last 80%
                keep = int(len(frame_buffer) * 0.8)
                frame_buffer = frame_buffer[-keep:]
    except WebSocketDisconnect:
        pass
