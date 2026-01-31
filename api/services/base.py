"""Base service classes and result types."""

from abc import ABC, abstractmethod
from dataclasses import dataclass, field
from typing import Any, Dict, List, Optional


@dataclass
class ProcessingResult:
    success: bool
    output_path: Optional[str] = None
    data: Optional[Dict[str, Any]] = None
    error: Optional[str] = None
    warnings: List[str] = field(default_factory=list)
    processing_time_seconds: float = 0.0


class BaseService(ABC):
    """Abstract base for all video processing services."""

    @abstractmethod
    def is_available(self) -> bool:
        """Check if this backend's dependencies are installed and working."""
        ...
