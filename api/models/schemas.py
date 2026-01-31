"""Pydantic schemas for API requests and responses."""

from typing import Any, Dict, List, Optional
from pydantic import BaseModel, Field


class ProcessingResponse(BaseModel):
    success: bool
    output_url: Optional[str] = None
    data: Optional[Dict[str, Any]] = None
    error: Optional[str] = None
    warnings: List[str] = Field(default_factory=list)
    processing_time_seconds: float = 0.0


class HealthResponse(BaseModel):
    status: str
    backends: Dict[str, Dict[str, Any]]


class JobProgressResponse(BaseModel):
    job_id: str
    status: str  # not_found | running | complete | error
    stage: Optional[str] = None
    message: Optional[str] = None
    current: Optional[int] = None
    total: Optional[int] = None
    percent: Optional[float] = None
    error: Optional[str] = None
    started_at: Optional[float] = None
    updated_at: Optional[float] = None
