"""FastAPI application entry point."""

import asyncio
import time
from contextlib import asynccontextmanager

from fastapi import FastAPI, Request
from fastapi.exception_handlers import http_exception_handler
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import FileResponse
from fastapi.staticfiles import StaticFiles
from pathlib import Path
from starlette.exceptions import HTTPException as StarletteHTTPException

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
    allow_origin_regex=r"^https?://(localhost|127\.0\.0\.1)(:\d+)?$",
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

# Ensure data directories exist
for d in ["data/uploads", "data/processed", "data/temp", "data/audio"]:
    Path(d).mkdir(parents=True, exist_ok=True)

# Serve processed files
app.mount("/files", StaticFiles(directory="data"), name="files")

# Optional: expose bundled test videos (MIT EVM samples) for reproducible UI testing.
TEST_VIDEOS_DIR = Path(__file__).resolve().parent.parent / "test-videos"
if TEST_VIDEOS_DIR.exists():
    app.mount("/test-videos", StaticFiles(directory=str(TEST_VIDEOS_DIR)), name="test-videos")


@app.get("/health", response_model=HealthResponse)
def health_check():
    return HealthResponse(status="ok", backends=get_backend_status())


# Import and include routers
from api.routers import magnify, vitals, audio, progress, preview  # noqa: E402

app.include_router(magnify.router, prefix="/magnify", tags=["magnify"])
app.include_router(vitals.router, prefix="/vitals", tags=["vitals"])
app.include_router(audio.router, prefix="/audio", tags=["audio"])
app.include_router(progress.router, prefix="/progress", tags=["progress"])
app.include_router(preview.router, prefix="/preview", tags=["preview"])


# Optional: serve the built frontend from this same FastAPI process.
# This makes the app usable without the Vite dev-server proxy and avoids CORS issues.
FRONTEND_DIST = Path(__file__).resolve().parent.parent / "frontend" / "dist"
if FRONTEND_DIST.exists():
    app.mount("/", StaticFiles(directory=str(FRONTEND_DIST), html=True), name="frontend")

    @app.exception_handler(StarletteHTTPException)
    async def _spa_fallback(request: Request, exc: StarletteHTTPException):
        if exc.status_code != 404 or request.method != "GET":
            return await http_exception_handler(request, exc)

        path = request.url.path
        excluded_prefixes = (
            "/audio",
            "/docs",
            "/files",
            "/health",
            "/magnify",
            "/openapi.json",
            "/preview",
            "/redoc",
            "/test-videos",
            "/vitals",
        )
        if path.startswith(excluded_prefixes):
            return await http_exception_handler(request, exc)

        # Don't rewrite missing static assets (e.g. *.js/*.css/*.png).
        if "." in Path(path).name:
            return await http_exception_handler(request, exc)

        index = FRONTEND_DIST / "index.html"
        if index.exists():
            return FileResponse(index)
        return await http_exception_handler(request, exc)
