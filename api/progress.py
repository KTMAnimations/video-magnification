"""In-memory progress tracking for long-running jobs.

This module is intentionally lightweight: a per-process dictionary guarded by a
threading lock. It's used to surface progress to the frontend while video
processing runs in a worker thread.
"""

from __future__ import annotations

import time
from dataclasses import dataclass
from threading import Lock
from typing import Optional


@dataclass
class JobProgress:
    job_id: str
    status: str = "running"  # running | complete | error
    stage: Optional[str] = None
    message: Optional[str] = None
    current: Optional[int] = None
    total: Optional[int] = None
    percent: Optional[float] = None
    error: Optional[str] = None
    started_at: float = 0.0
    updated_at: float = 0.0


_lock = Lock()
_jobs: dict[str, JobProgress] = {}

# Keep job progress entries for 30 minutes after last update.
_TTL_SECONDS = 30 * 60

_UNSET = object()


def _now() -> float:
    return time.time()


def _clamp_percent(value: Optional[float]) -> Optional[float]:
    if value is None:
        return None
    if value != value:  # NaN
        return None
    if value < 0:
        return 0.0
    if value > 100:
        return 100.0
    return float(value)


def _maybe_compute_percent(
    *,
    current: Optional[int],
    total: Optional[int],
    percent: Optional[float],
) -> Optional[float]:
    if percent is not None:
        return _clamp_percent(percent)
    if current is None or total is None or total <= 0:
        return None
    return _clamp_percent((float(current) / float(total)) * 100.0)


def _gc_locked(now: float) -> None:
    expired = [k for k, v in _jobs.items() if (now - v.updated_at) > _TTL_SECONDS]
    for k in expired:
        _jobs.pop(k, None)


def start_job(job_id: str, *, stage: str | None = None, message: str | None = None) -> None:
    now = _now()
    with _lock:
        _gc_locked(now)
        _jobs[job_id] = JobProgress(
            job_id=job_id,
            status="running",
            stage=stage,
            message=message,
            started_at=now,
            updated_at=now,
        )


def update_job(
    job_id: str,
    *,
    status: str | None = None,
    stage: str | None = None,
    message: str | None = None,
    current: int | None | object = _UNSET,
    total: int | None | object = _UNSET,
    percent: float | None | object = _UNSET,
    error: str | None = None,
) -> None:
    now = _now()
    with _lock:
        _gc_locked(now)
        job = _jobs.get(job_id)
        if job is None:
            job = JobProgress(job_id=job_id, started_at=now)
            _jobs[job_id] = job

        if status is not None:
            job.status = status
        if stage is not None:
            job.stage = stage
        if message is not None:
            job.message = message
        if current is not _UNSET:
            job.current = int(current) if current is not None else None
        if total is not _UNSET:
            job.total = int(total) if total is not None else None

        if percent is _UNSET:
            job.percent = _maybe_compute_percent(current=job.current, total=job.total, percent=None)
        elif percent is None:
            job.percent = None
        else:
            job.percent = _clamp_percent(percent)

        if error is not None:
            job.error = error
            job.status = "error"

        job.updated_at = now


def complete_job(job_id: str, *, message: str | None = None) -> None:
    update_job(job_id, status="complete", message=message, percent=100.0)


def error_job(job_id: str, error: str) -> None:
    update_job(job_id, error=error)


def get_job(job_id: str) -> JobProgress | None:
    now = _now()
    with _lock:
        _gc_locked(now)
        job = _jobs.get(job_id)
        if job is None:
            return None
        # Return a copy so callers can't mutate shared state.
        return JobProgress(**job.__dict__)


class ProgressSink:
    """Small helper passed into processing code to update job progress."""

    def __init__(self, job_id: str, *, min_interval_seconds: float = 0.1, min_percent_delta: float = 0.5):
        self.job_id = job_id
        self._min_interval = float(min_interval_seconds)
        self._min_delta = float(min_percent_delta)
        self._last_emit_at = 0.0
        self._last_percent: float | None = None
        self._last_stage: str | None = None

    def update(
        self,
        *,
        stage: str | None = None,
        message: str | None = None,
        current: int | None | object = _UNSET,
        total: int | None | object = _UNSET,
        percent: float | None | object = _UNSET,
        force: bool = False,
    ) -> None:
        now = time.monotonic()
        stage_changed = stage is not None and stage != self._last_stage
        if stage_changed:
            self._last_stage = stage

        cur_for_compute = None if current is _UNSET else current
        tot_for_compute = None if total is _UNSET else total
        if percent is _UNSET:
            computed = _maybe_compute_percent(current=cur_for_compute, total=tot_for_compute, percent=None)
        elif percent is None:
            computed = None
        else:
            computed = _clamp_percent(percent)
        percent_changed = (
            computed is not None
            and (self._last_percent is None or abs(computed - self._last_percent) >= self._min_delta)
        )

        if not force and not stage_changed and not percent_changed and (now - self._last_emit_at) < self._min_interval:
            return

        update_job(
            self.job_id,
            stage=stage,
            message=message,
            current=current,
            total=total,
            percent=percent,
        )

        self._last_emit_at = now
        if computed is not None:
            self._last_percent = computed
