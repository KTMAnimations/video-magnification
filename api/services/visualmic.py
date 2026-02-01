"""Audio recovery service — Complex Steerable Pyramid implementation.

Implements the Visual Microphone algorithm from:
  Davis, Rubinstein, Wadhwa, Buyukozturk, Durand & Freeman,
  "The Visual Microphone: Passive Recovery of Sound from Video", SIGGRAPH 2014.

Uses pyrtools' complex steerable pyramid to decompose each frame, extract
inter-frame phase differences as a motion proxy, and reconstruct an audio
signal via amplitude-weighted averaging and cross-correlation alignment.
"""

import os
import re
import uuid
import traceback
from pathlib import Path
from typing import Optional, Tuple

import cv2
import numpy as np

from api.services.base import BaseService, ProcessingResult
from api.progress import ProgressSink
from api.utils.video import get_total_frames

AUDIO_DIR = Path("data/audio")
AUDIO_DIR.mkdir(parents=True, exist_ok=True)

# ---------- configurable algorithm parameters (env vars) ----------
_NSCALES = int(os.environ.get("VMAG_AUDIO_NSCALES", "4"))
_NORIENTATIONS = int(os.environ.get("VMAG_AUDIO_NORIENTATIONS", "2"))
_DOWNSAMPLE = float(os.environ.get("VMAG_AUDIO_DOWNSAMPLE", "0.5"))
_DOWNSAMPLE = max(0.1, min(1.0, _DOWNSAMPLE))


class VisualMicService(BaseService):
    _last_error: str | None = None

    def is_available(self) -> bool:
        try:
            import pyrtools  # noqa: F401
            import scipy  # noqa: F401
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
        import pyrtools as pt
        from scipy.signal import butter, sosfilt
        from scipy.interpolate import interp1d

        warnings: list[str] = []

        try:
            # ----------------------------------------------------------
            # Stage 1: read_frames (0-30%)
            # ----------------------------------------------------------
            cap = cv2.VideoCapture(video_path)
            fps = cap.get(cv2.CAP_PROP_FPS) or 30.0
            total_frames = int(cap.get(cv2.CAP_PROP_FRAME_COUNT) or 0)
            if total_frames <= 0:
                total_frames = int(get_total_frames(video_path) or 0)

            if fps < 100:
                warnings.append(
                    f"Video FPS is {fps:.0f}. Visual-Mic works best with >1000 fps. "
                    "Standard 30 fps video will only recover very low frequencies. "
                    "Results are educational/demonstrative."
                )

            frames: list[np.ndarray] = []
            w = h = None
            read_count = 0

            while True:
                ret, frame = cap.read()
                if not ret:
                    break

                if w is None or h is None:
                    h, w = frame.shape[:2]

                # Convert to grayscale float [0, 1]
                gray = cv2.cvtColor(frame, cv2.COLOR_BGR2GRAY).astype(np.float64) / 255.0

                # ROI crop
                if roi and w is not None and h is not None:
                    x, y, rw, rh = roi
                    x0 = max(0, int(x))
                    y0 = max(0, int(y))
                    x1 = min(w, x0 + max(1, int(rw)))
                    y1 = min(h, y0 + max(1, int(rh)))
                    if x1 > x0 and y1 > y0:
                        gray = gray[y0:y1, x0:x1]

                # Spatial downsample
                if _DOWNSAMPLE < 1.0:
                    new_h = max(1, int(gray.shape[0] * _DOWNSAMPLE))
                    new_w = max(1, int(gray.shape[1] * _DOWNSAMPLE))
                    gray = cv2.resize(gray, (new_w, new_h), interpolation=cv2.INTER_AREA)

                frames.append(gray)
                read_count += 1

                if progress:
                    if total_frames > 0:
                        pct = (read_count / total_frames) * 30.0
                        progress.update(
                            stage="read_frames",
                            message="Reading video frames",
                            current=read_count,
                            total=total_frames,
                            percent=pct,
                        )
                    else:
                        progress.update(
                            stage="read_frames",
                            message="Reading video frames",
                            current=read_count,
                            total=None,
                            percent=None,
                        )

            cap.release()

            n_frames = len(frames)
            if n_frames < 2:
                return ProcessingResult(success=False, error="Video too short (need at least 2 frames).")

            # ----------------------------------------------------------
            # Stage 2: pyramid (30-90%) — build pyramids, extract motion
            # ----------------------------------------------------------

            order = max(0, int(_NORIENTATIONS) - 1)
            requested_height = max(1, int(_NSCALES))

            # Build reference pyramid from first frame
            height = requested_height
            while True:
                try:
                    ref_pyr = pt.pyramids.SteerablePyramidFreq(
                        frames[0], height=height, order=order,
                    )
                    break
                except ValueError as e:
                    # pyrtools limits pyramid depth based on frame size; small ROI/downsampled
                    # videos can trigger: "Cannot build pyramid higher than X levels."
                    m = re.search(r"higher than\\s+(\\d+)\\s+levels", str(e))
                    max_ht = int(m.group(1)) if m else None
                    next_height = max_ht if max_ht is not None else (height - 1)
                    if next_height is None or next_height >= height:
                        next_height = height - 1
                    if next_height < 1:
                        raise
                    if height == requested_height:
                        warnings.append(
                            f"Reduced pyramid levels from {requested_height} to {next_height} "
                            f"due to small ROI/downsample size ({frames[0].shape[1]}x{frames[0].shape[0]})."
                        )
                    height = next_height

            ref_coeffs = ref_pyr.pyr_coeffs
            ref_phases: dict = {}
            ref_amplitudes: dict = {}

            # Identify sub-band keys (exclude highpass / lowpass residuals)
            band_keys = [k for k in ref_coeffs.keys() if isinstance(k, tuple) and len(k) == 2]

            for k in band_keys:
                c = ref_coeffs[k]
                ref_phases[k] = np.angle(c)
                ref_amplitudes[k] = np.abs(c)

            # Per-band temporal motion signals
            # Each entry: band_key -> list of scalar motion values per frame
            band_signals: dict = {k: [] for k in band_keys}

            for frame_idx in range(1, n_frames):
                pyr = pt.pyramids.SteerablePyramidFreq(
                    frames[frame_idx], height=height, order=order,
                )
                coeffs = pyr.pyr_coeffs

                for k in band_keys:
                    c = coeffs[k]
                    phase = np.angle(c)
                    amplitude = np.abs(c)

                    # Phase difference relative to reference (Paper Formula 2)
                    # Wrapped to [-pi, pi]
                    delta_phase = np.angle(np.exp(1j * (phase - ref_phases[k])))

                    # Amplitude-weighted spatial average (Paper Formula 3)
                    weights = ref_amplitudes[k] * amplitude
                    w_sum = weights.sum()
                    if w_sum > 0:
                        motion_val = (weights * delta_phase).sum() / w_sum
                    else:
                        motion_val = 0.0

                    band_signals[k].append(float(motion_val))

                if progress:
                    pct = 30.0 + ((frame_idx) / (n_frames - 1)) * 60.0
                    progress.update(
                        stage="pyramid",
                        message=f"Building pyramids ({frame_idx}/{n_frames - 1})",
                        current=frame_idx,
                        total=n_frames - 1,
                        percent=pct,
                    )

            # Convert to arrays
            for k in band_keys:
                band_signals[k] = np.array(band_signals[k], dtype=np.float64)

            # ----------------------------------------------------------
            # Align per-band signals via cross-correlation (Paper Formula 4)
            # and sum (Paper Formula 5)
            # ----------------------------------------------------------
            signal_len = n_frames - 1
            if signal_len == 0:
                return ProcessingResult(success=False, error="Not enough frames for audio recovery.")

            # Use the first band as reference for alignment
            ref_key = band_keys[0]
            ref_signal = band_signals[ref_key]
            aligned_sum = np.copy(ref_signal)

            for k in band_keys[1:]:
                sig = band_signals[k]
                # Cross-correlation to find best lag
                corr = np.correlate(ref_signal, sig, mode="full")
                best_lag = np.argmax(np.abs(corr)) - (len(sig) - 1)
                # Shift signal by best_lag
                shifted = np.roll(sig, best_lag)
                # Zero out wrapped-around portion
                if best_lag > 0:
                    shifted[:best_lag] = 0.0
                elif best_lag < 0:
                    shifted[best_lag:] = 0.0
                aligned_sum += shifted

            audio = aligned_sum

            # ----------------------------------------------------------
            # Stage 3: write_audio (90-100%) — filter, denoise, write WAV
            # ----------------------------------------------------------
            if progress:
                progress.update(stage="write_audio", message="Filtering and writing audio", percent=90.0, force=True)

            # 3rd-order Butterworth high-pass filter (remove DC drift)
            # Cutoff at 20 Hz / (fps/2), but guard against edge cases
            nyquist = fps / 2.0
            hp_cutoff = 20.0 / nyquist if nyquist > 20.0 else 0.01
            hp_cutoff = min(hp_cutoff, 0.99)
            sos_hp = butter(3, hp_cutoff, btype="high", output="sos")
            audio = sosfilt(sos_hp, audio)

            # Spectral subtraction denoising
            # Estimate noise from first 10% of signal (or at least 10 samples)
            noise_len = max(10, int(len(audio) * 0.1))
            noise_segment = audio[:noise_len]
            noise_spectrum = np.abs(np.fft.rfft(noise_segment))
            noise_power = np.mean(noise_spectrum ** 2)

            signal_fft = np.fft.rfft(audio)
            signal_power = np.abs(signal_fft) ** 2
            phase = np.angle(signal_fft)

            # Subtract noise floor, keep minimum at 0
            clean_power = np.maximum(signal_power - noise_power, 0.0)
            clean_magnitude = np.sqrt(clean_power)
            audio = np.fft.irfft(clean_magnitude * np.exp(1j * phase), n=len(audio))

            # Normalize to [-1, 1]
            peak = np.abs(audio).max()
            if peak > 0:
                audio = audio / peak

            # Interpolate to 8000 Hz for WAV playback
            duration_seconds = n_frames / float(fps)
            sample_rate = 8000
            n_samples = max(1, int(round(duration_seconds * sample_rate)))
            t_in = np.linspace(0.0, duration_seconds, num=len(audio), endpoint=False)
            t_out = np.linspace(0.0, duration_seconds, num=n_samples, endpoint=False)

            if len(audio) > 1:
                interpolator = interp1d(t_in, audio, kind="linear", fill_value="extrapolate")
                audio_resampled = interpolator(t_out).astype(np.float32)
            else:
                audio_resampled = np.zeros(n_samples, dtype=np.float32)

            # Write WAV
            out_name = f"{uuid.uuid4().hex}.wav"
            out_path = AUDIO_DIR / out_name

            import soundfile as sf

            if progress:
                progress.update(stage="write_audio", message="Writing WAV file", percent=95.0, force=True)

            sf.write(str(out_path), audio_resampled, sample_rate)

            if progress:
                progress.update(stage="write_audio", message="Done", percent=100.0, force=True)

            # Waveform data for frontend (max 2000 points)
            audio_normalized = audio_resampled / (np.abs(audio_resampled).max() + 1e-10)
            step = max(1, len(audio_normalized) // 2000)
            waveform = audio_normalized[::step].tolist()

            return ProcessingResult(
                success=True,
                output_path=out_name,
                data={
                    "fps": float(fps),
                    "n_frames": n_frames,
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
