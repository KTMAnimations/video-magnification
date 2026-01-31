"""File upload utility."""

import uuid
from pathlib import Path

from fastapi import UploadFile

UPLOAD_DIR = Path("data/uploads")
UPLOAD_DIR.mkdir(parents=True, exist_ok=True)


async def save_upload(file: UploadFile) -> Path:
    """Save an uploaded file to data/uploads/{uuid}{ext}, return the path."""
    ext = Path(file.filename).suffix if file.filename else ".mp4"
    filename = f"{uuid.uuid4().hex}{ext}"
    dest = UPLOAD_DIR / filename
    with dest.open("wb") as f:
        while True:
            chunk = await file.read(1024 * 1024)  # 1MB
            if not chunk:
                break
            f.write(chunk)
    return dest
