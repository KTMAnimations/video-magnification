"""Audio recovery service — robust baseline implementation.

The original Visual-Mic approach uses DTCWT; in practice that stack is brittle
across NumPy versions. This service implements a lightweight fallback that
extracts a motion proxy signal via frame differencing and writes it as WAV.
"""

import uuid
import traceback
from pathlib import Path
from typing import Optional, Tuple

import cv2
import numpy as np

from api.services.base import BaseService, ProcessingResult
from api.progress import ProgressSink

AUDIO_DIR = Path("data/audio")
AUDIO_DIR.mkdir(parents=True, exist_ok=True)


class VisualMicService(BaseService):
    _last_error: str | None = None

    def is_available(self) -> bool:
        try:
            import soundfile  # noqa: F401
            self._last_error = None
            return True
        except Exception as e:
            self._last_error = f"{type(e).__name__}: {e}"
            return False

    def process(
        self,
        video_path: str,
        roi: Optional[Tuple[int, int, int, int]] = None,
        progress: ProgressSink | None = None,
    ) -> ProcessingResult:
        warnings = []
        try:
            cap = cv2.VideoCapture(video_path)
            fps = cap.get(cv2.CAP_PROP_FPS) or 30.0
            total_frames = int(cap.get(cv2.CAP_PROP_FRAME_COUNT) or 0)

            if fps < 100:
                warnings.append(
                    f"Video FPS is {fps:.0f}. Visual-Mic works best with >1000fps. "
                    "Standard 30fps video will only recover very low frequencies. "
                    "Results are educational/demonstrative."
                )

            frames_gray: list[np.ndarray] = []
            w = h = None
            read_count = 0
            while True:
                ret, frame = cap.read()
                if not ret:
                    break
                if w is None or h is None:
                    h, w = frame.shape[:2]
                gray = cv2.cvtColor(frame, cv2.COLOR_BGR2GRAY).astype(np.float32)
                if roi and w is not None and h is not None:
                    x, y, rw, rh = roi
                    x0 = max(0, int(x))
                    y0 = max(0, int(y))
                    x1 = min(w, x0 + max(1, int(rw)))
                    y1 = min(h, y0 + max(1, int(rh)))
                    if x1 > x0 and y1 > y0:
                        gray = gray[y0:y1, x0:x1]
                frames_gray.append(gray)
                read_count += 1
                if progress:
                    if total_frames > 0:
                        overall = (read_count / total_frames) * 50.0
                        progress.update(
                            stage="read_frames",
                            message="Reading video frames",
                            current=read_count,
                            total=total_frames,
                            percent=overall,
                        )
                    else:
                        progress.update(stage="read_frames", message="Reading video frames", current=read_count, total=None, percent=None)
            cap.release()

            if len(frames_gray) < 2:
                return ProcessingResult(success=False, error="Video too short.")

            # Frame-difference motion proxy (fallback that works across NumPy versions)
            motion = []
            prev = frames_gray[0]
            total_motion = max(0, len(frames_gray) - 1)
            for idx, cur in enumerate(frames_gray[1:], start=1):
                diff = cur - prev
                motion.append(float(np.mean(np.abs(diff))))
                prev = cur
                if progress and total_motion > 0:
                    overall = 50.0 + (idx / total_motion) * 40.0
                    progress.update(
                        stage="compute_motion",
                        message="Computing motion signal",
                        current=idx,
                        total=total_motion,
                        percent=overall,
                    )

            audio = np.array(motion, dtype=np.float32)
            audio = audio - float(audio.mean())

            # Interpolate to a more standard audio sample rate while preserving duration.
            duration_seconds = len(frames_gray) / float(fps)
            sample_rate = 8000
            n_samples = max(1, int(round(duration_seconds * sample_rate)))
            t_in = np.linspace(0.0, duration_seconds, num=len(audio), endpoint=False, dtype=np.float32)
            t_out = np.linspace(0.0, duration_seconds, num=n_samples, endpoint=False, dtype=np.float32)
            audio = np.interp(t_out, t_in, audio).astype(np.float32) if len(audio) > 1 else np.zeros(n_samples, dtype=np.float32)

            out_name = f"{uuid.uuid4().hex}.wav"
            out_path = AUDIO_DIR / out_name
            import soundfile as sf
            if progress:
                progress.update(stage="write_audio", message="Writing audio output", percent=95.0, force=True)
            sf.write(str(out_path), audio, sample_rate)
            if progress:
                progress.update(stage="write_audio", message="Writing audio output", percent=100.0, force=True)

            # Waveform data for frontend
            audio_normalized = audio / (np.abs(audio).max() + 1e-10)
            # Downsample for chart (max 2000 points)
            step = max(1, len(audio_normalized) // 2000)
            waveform = audio_normalized[::step].tolist()

            return ProcessingResult(
                success=True,
                output_path=out_name,
                data={
                    "fps": float(fps),
                    "n_frames": len(frames_gray),
                    "duration_seconds": duration_seconds,
                    "audio_sample_rate_hz": sample_rate,
                    "waveform": waveform,
                    "max_recoverable_freq_hz": fps / 2,
                },
                warnings=warnings,
            )
        except Exception as e:
            return ProcessingResult(
                success=False,
                error=f"Visual-Mic processing failed: {e}\n{traceback.format_exc()}",
                warnings=warnings,
            )
