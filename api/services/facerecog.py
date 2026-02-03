"""Face recognition utilities for real-time webcam view.

This is intentionally optional: if `face_recognition` or the dataset files
aren't available, the rest of the app should continue to work.
"""

from __future__ import annotations

import os
from dataclasses import dataclass
from pathlib import Path

import numpy as np

from api.services.base import BaseService


@dataclass(frozen=True)
class FaceMatch:
    name: str
    distance: float
    top: int
    right: int
    bottom: int
    left: int

    def to_json(self) -> dict[str, object]:
        return {
            "name": self.name,
            "distance": float(self.distance),
            "box": {
                "top": int(self.top),
                "right": int(self.right),
                "bottom": int(self.bottom),
                "left": int(self.left),
            },
        }


def _float_env(name: str, default: float) -> float:
    raw = (os.environ.get(name) or "").strip()
    if not raw:
        return default
    try:
        return float(raw)
    except Exception:
        return default


def _int_env(name: str, default: int) -> int:
    raw = (os.environ.get(name) or "").strip()
    if not raw:
        return default
    try:
        return int(raw)
    except Exception:
        return default


class FaceRecogService(BaseService):
    _last_error: str | None = None

    def __init__(self) -> None:
        self._checked = False
        self._available = False
        self._known_encodings: np.ndarray | None = None
        self._known_names: np.ndarray | None = None

    def is_available(self) -> bool:
        if self._checked:
            return self._available

        self._checked = True

        try:
            import face_recognition  # noqa: F401
        except Exception as e:
            self._available = False
            self._last_error = f"face_recognition unavailable: {type(e).__name__}: {e}"
            return False

        enc_path = Path(os.environ.get("VMAG_FACE_ENCODINGS", "data/face_recog/encodings26.npy"))
        names_path = Path(os.environ.get("VMAG_FACE_NAMES", "data/face_recog/names26.npy"))

        if not enc_path.exists():
            self._available = False
            self._last_error = f"Missing face encodings file: {enc_path}"
            return False
        if not names_path.exists():
            self._available = False
            self._last_error = f"Missing face names file: {names_path}"
            return False

        try:
            enc = np.load(str(enc_path))
            names = np.load(str(names_path), allow_pickle=True)
        except Exception as e:
            self._available = False
            self._last_error = f"Failed to load face DB: {type(e).__name__}: {e}"
            return False

        if enc.ndim != 2 or enc.shape[1] != 128:
            self._available = False
            self._last_error = f"Unexpected encodings shape: {tuple(enc.shape)}"
            return False
        if names.ndim != 1 or names.shape[0] != enc.shape[0]:
            self._available = False
            self._last_error = f"Unexpected names shape: {tuple(names.shape)} (enc={tuple(enc.shape)})"
            return False

        self._known_encodings = enc.astype(np.float32, copy=False)
        self._known_names = names
        self._available = True
        self._last_error = None
        return True

    def recognize_rgb_frame(self, rgb_frame: np.ndarray) -> list[FaceMatch]:
        """Recognize faces in an RGB frame.

        Returns an empty list on any error.
        """
        if not self.is_available():
            return []
        if rgb_frame.ndim != 3:
            return []

        # Local import: allow the app to run without face_recognition installed.
        import cv2
        import face_recognition

        known_encodings = self._known_encodings
        known_names = self._known_names
        if known_encodings is None or known_names is None:
            return []

        detection_model = (os.environ.get("VMAG_FACE_DETECTION_MODEL") or "hog").strip().lower()
        if detection_model not in {"hog", "cnn"}:
            detection_model = "hog"

        frame_scale = _float_env("VMAG_FACE_FRAME_SCALE", 0.5)
        frame_scale = max(0.05, min(1.0, frame_scale))
        tolerance = _float_env("VMAG_FACE_TOLERANCE", 0.6)
        encode_on_fullres = bool(_int_env("VMAG_FACE_ENCODE_ON_FULLRES", 0))

        if frame_scale == 1.0:
            rgb_small = rgb_frame
            scale_back = 1.0
        else:
            rgb_small = cv2.resize(rgb_frame, (0, 0), fx=frame_scale, fy=frame_scale)
            scale_back = 1.0 / frame_scale

        face_locations_small = face_recognition.face_locations(rgb_small, model=detection_model)
        if not face_locations_small:
            return []

        if encode_on_fullres and frame_scale != 1.0:
            face_locations_full = [
                (
                    int(top * scale_back),
                    int(right * scale_back),
                    int(bottom * scale_back),
                    int(left * scale_back),
                )
                for (top, right, bottom, left) in face_locations_small
            ]
            face_encodings = face_recognition.face_encodings(rgb_frame, known_face_locations=face_locations_full)
            locations_full = face_locations_full
        else:
            face_encodings = face_recognition.face_encodings(rgb_small, face_locations_small)
            locations_full = [
                (
                    int(top * scale_back),
                    int(right * scale_back),
                    int(bottom * scale_back),
                    int(left * scale_back),
                )
                for (top, right, bottom, left) in face_locations_small
            ]

        matches: list[FaceMatch] = []
        for (top, right, bottom, left), fe in zip(locations_full, face_encodings):
            if known_encodings.size == 0:
                matches.append(FaceMatch(name="Unknown", distance=1.0, top=top, right=right, bottom=bottom, left=left))
                continue
            distances = face_recognition.face_distance(known_encodings, fe)
            best_idx = int(np.argmin(distances))
            best_dist = float(distances[best_idx])
            name = str(known_names[best_idx]) if best_dist <= tolerance else "Unknown"
            matches.append(FaceMatch(name=name, distance=best_dist, top=top, right=right, bottom=bottom, left=left))

        return matches
