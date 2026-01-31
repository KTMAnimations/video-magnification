"""FastAPI application entry point."""

import asyncio
import time
from contextlib import asynccontextmanager

from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware
from fastapi.staticfiles import StaticFiles
from pathlib import Path

from api.models.schemas import HealthResponse
from api.services import get_backend_status

MAX_FILE_AGE_SECONDS = 24 * 60 * 60  # 24 hours
CLEANUP_INTERVAL_SECONDS = 60 * 60    # Run every hour

DATA_DIRS = ["data/uploads", "data/processed", "data/audio"]


def _cleanup_old_files():
    """Remove files older than MAX_FILE_AGE_SECONDS from data directories."""
    now = time.time()
    removed = 0
    for d in DATA_DIRS:
        p = Path(d)
        if not p.exists():
            continue
        for f in p.iterdir():
            if f.is_file() and (now - f.stat().st_mtime) > MAX_FILE_AGE_SECONDS:
                f.unlink(missing_ok=True)
                removed += 1
    return removed


async def _cleanup_loop():
    """Periodic background task for file cleanup."""
    while True:
        await asyncio.sleep(CLEANUP_INTERVAL_SECONDS)
        removed = _cleanup_old_files()
        if removed > 0:
            print(f"[cleanup] Removed {removed} file(s) older than 24h")


@asynccontextmanager
async def lifespan(app: FastAPI):
    task = asyncio.create_task(_cleanup_loop())
    yield
    task.cancel()


app = FastAPI(title="Video Magnification API", version="0.1.0", lifespan=lifespan)

app.add_middleware(
    CORSMiddleware,
    allow_origins=["http://localhost:5173", "http://localhost:5174", "http://127.0.0.1:5173", "http://127.0.0.1:5174"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

# Ensure data directories exist
for d in ["data/uploads", "data/processed", "data/temp", "data/audio"]:
    Path(d).mkdir(parents=True, exist_ok=True)

# Serve processed files
app.mount("/files", StaticFiles(directory="data"), name="files")


@app.get("/health", response_model=HealthResponse)
def health_check():
    return HealthResponse(status="ok", backends=get_backend_status())


# Import and include routers
from api.routers import magnify, vitals, audio  # noqa: E402

app.include_router(magnify.router, prefix="/magnify", tags=["magnify"])
app.include_router(vitals.router, prefix="/vitals", tags=["vitals"])
app.include_router(audio.router, prefix="/audio", tags=["audio"])
