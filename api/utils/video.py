"""Video helpers.

OpenCV's `CAP_PROP_FRAME_COUNT` is not reliable for all codecs/containers.
When it's missing/zero, we fall back to counting frames via `VideoCapture.grab()`,
which avoids decoding while still walking the stream.
"""

from __future__ import annotations

from typing import Optional

import cv2


def get_total_frames(video_path: str, *, max_frames: int | None = None) -> Optional[int]:
    """Best-effort total frame count.

    Returns `None` when the total cannot be determined.

    Note: If `max_frames` is provided (>0), the returned total is capped at that
    value (since callers may only process a preview).
    """
    max_frames = int(max_frames) if max_frames and max_frames > 0 else None

    cap = cv2.VideoCapture(video_path)
    total = int(cap.get(cv2.CAP_PROP_FRAME_COUNT) or 0)
    cap.release()

    if total > 0:
        return min(total, max_frames) if max_frames else total

    if max_frames:
        # Even if we can't read metadata, the caller won't process more than this.
        return max_frames

    # Fall back to counting frames without decoding.
    cap = cv2.VideoCapture(video_path)
    count = 0
    while True:
        ok = cap.grab()
        if not ok:
            break
        count += 1
        # Safety guard: avoid pathological/infinite streams.
        if count > 10_000_000:
            cap.release()
            return None
    cap.release()

    return count if count > 0 else None

