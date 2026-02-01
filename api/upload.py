"""File upload utility."""

import os
import uuid
from pathlib import Path

from fastapi import UploadFile

DEFAULT_UPLOAD_DIR = Path("data/temp/uploads")

def cleanup_upload(path: Path) -> None:
    """Best-effort cleanup for an uploaded temp file."""
    try:
        path.unlink(missing_ok=True)
    except Exception:
        # Cleanup should never break a successful response; the periodic
        # cleanup loop in api.main is a secondary safety net.
        pass


async def save_upload(file: UploadFile) -> Path:
    """Save an uploaded file to a temporary path, return the path.

    Callers should delete the returned file when they are done with it.
    """
    upload_dir = Path(os.environ.get("VMAG_UPLOAD_DIR", str(DEFAULT_UPLOAD_DIR)))
    upload_dir.mkdir(parents=True, exist_ok=True)
    ext = Path(file.filename).suffix if file.filename else ".mp4"
    filename = f"{uuid.uuid4().hex}{ext}"
    dest = upload_dir / filename
    with dest.open("wb") as f:
        while True:
            chunk = await file.read(1024 * 1024)  # 1MB
            if not chunk:
                break
            f.write(chunk)
    await file.close()
    return dest
