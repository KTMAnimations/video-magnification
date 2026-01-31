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
