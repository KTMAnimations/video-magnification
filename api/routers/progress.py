"""Progress endpoints for long-running processing jobs."""

from fastapi import APIRouter

from api.models.schemas import JobProgressResponse
from api.progress import get_job

router = APIRouter()


@router.get("/{job_id}", response_model=JobProgressResponse)
def get_job_progress(job_id: str):
    job = get_job(job_id)
    if job is None:
        return JobProgressResponse(job_id=job_id, status="not_found")

    return JobProgressResponse(
        job_id=job.job_id,
        status=job.status,
        stage=job.stage,
        message=job.message,
        current=job.current,
        total=job.total,
        percent=job.percent,
        error=job.error,
        started_at=job.started_at,
        updated_at=job.updated_at,
    )
