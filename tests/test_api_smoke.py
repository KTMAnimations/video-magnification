import io
import json
import math
import os
import re
import tempfile
import uuid
from pathlib import Path

import cv2
import numpy as np
from fastapi.testclient import TestClient

from api.main import app


MIT_EVM_SOURCE_DIR = Path("test-videos/mit-evm/source")


def _make_cartoon_face_frame(width: int = 320, height: int = 240) -> np.ndarray:
    frame = np.zeros((height, width, 3), dtype=np.uint8)
    cv2.ellipse(frame, (width // 2, height // 2), (80, 100), 0, 0, 360, (200, 200, 200), -1)
    cv2.circle(frame, (width // 2 - 30, height // 2 - 30), 12, (0, 0, 0), -1)
    cv2.circle(frame, (width // 2 + 30, height // 2 - 30), 12, (0, 0, 0), -1)
    cv2.ellipse(frame, (width // 2, height // 2 + 30), (40, 30), 0, 0, 180, (0, 0, 0), 5)
    return frame


def _make_pulse_frames(
    n_frames: int,
    fps: int = 30,
    bpm: float = 72.0,
    amp: float = 12.0,
    width: int = 320,
    height: int = 240,
) -> list[np.ndarray]:
    base = _make_cartoon_face_frame(width=width, height=height).astype(np.float32)
    freq_hz = bpm / 60.0
    frames: list[np.ndarray] = []
    for i in range(n_frames):
        t = i / float(fps)
        delta = amp * math.sin(2 * math.pi * freq_hz * t)
        frame = base.copy()
        frame[:, :, 1] = np.clip(frame[:, :, 1] + delta, 0, 255)
        frames.append(frame.astype(np.uint8))
    return frames


def _write_mp4(frames_bgr: list[np.ndarray], fps: int) -> Path:
    h, w = frames_bgr[0].shape[:2]
    tmpdir = Path(tempfile.mkdtemp(prefix="vmag-tests-"))
    out_path = tmpdir / "input.mp4"
    fourcc = cv2.VideoWriter_fourcc(*"mp4v")
    writer = cv2.VideoWriter(str(out_path), fourcc, fps, (w, h))
    for f in frames_bgr:
        writer.write(f)
    writer.release()
    return out_path


def _read_file_bytes(path: Path) -> bytes:
    return path.read_bytes()


def _local_path_from_files_url(url: str) -> Path:
    # /files/<subpath> maps to ./data/<subpath>
    assert url.startswith("/files/")
    return Path("data") / url.removeprefix("/files/")


def test_health_smoke():
    client = TestClient(app)
    res = client.get("/health")
    assert res.status_code == 200
    payload = res.json()
    assert payload["status"] == "ok"
    assert set(payload["backends"].keys()) == {"evm", "pyvhr", "rppg", "stbvmm", "visualmic"}
    for info in payload["backends"].values():
        assert "label" in info
        assert "available" in info
        assert "error" in info


def test_progress_endpoint_not_found():
    client = TestClient(app)
    res = client.get("/progress/does-not-exist")
    assert res.status_code == 200
    payload = res.json()
    assert payload["status"] == "not_found"


def test_color_magnify_with_roi():
    frames = _make_pulse_frames(n_frames=60, fps=30)
    mp4 = _write_mp4(frames, fps=30)
    client = TestClient(app)

    res = client.post(
        "/magnify/color",
        files={"video": ("input.mp4", io.BytesIO(_read_file_bytes(mp4)), "video/mp4")},
        data={
            "freq_min": "0.75",
            "freq_max": "3.0",
            "amplification": "30",
            "pyramid_levels": "4",
            "roi_x": "40",
            "roi_y": "40",
            "roi_w": "100",
            "roi_h": "100",
        },
    )
    assert res.status_code == 200
    payload = res.json()
    assert payload["success"] is True
    assert payload["output_url"]
    out_path = _local_path_from_files_url(payload["output_url"])
    assert out_path.exists()
    assert out_path.stat().st_size > 0


def test_color_magnify_invalid_freq_range():
    frames = _make_pulse_frames(n_frames=30, fps=30)
    mp4 = _write_mp4(frames, fps=30)
    client = TestClient(app)

    res = client.post(
        "/magnify/color",
        files={"video": ("input.mp4", io.BytesIO(_read_file_bytes(mp4)), "video/mp4")},
        data={
            "freq_min": "3.0",
            "freq_max": "0.75",
            "amplification": "30",
            "pyramid_levels": "4",
        },
    )
    assert res.status_code == 200
    payload = res.json()
    assert payload["success"] is False
    assert "freq_min must be < freq_max" in (payload.get("error") or "")


def test_audio_recover_smoke():
    frames = _make_pulse_frames(n_frames=60, fps=30)
    mp4 = _write_mp4(frames, fps=30)
    client = TestClient(app)
    job_id = uuid.uuid4().hex

    res = client.post(
        "/audio/recover",
        files={"video": ("input.mp4", io.BytesIO(_read_file_bytes(mp4)), "video/mp4")},
        data={"roi_x": "30", "roi_y": "30", "roi_w": "120", "roi_h": "120", "job_id": job_id},
    )
    assert res.status_code == 200
    payload = res.json()
    assert payload["success"] is True
    assert payload["output_url"]
    out_path = _local_path_from_files_url(payload["output_url"])
    assert out_path.exists()
    assert out_path.stat().st_size > 0
    assert payload["data"]
    assert "waveform" in payload["data"]
    assert len(payload["data"]["waveform"]) > 10

    prog = client.get(f"/progress/{job_id}")
    assert prog.status_code == 200
    p = prog.json()
    assert p["status"] == "complete"
    assert float(p.get("percent", 0.0)) >= 99.0


def test_heartrate_pos_wang_cartoon_face():
    frames = _make_pulse_frames(n_frames=300, fps=30, bpm=72.0)
    mp4 = _write_mp4(frames, fps=30)
    client = TestClient(app)

    res = client.post(
        "/vitals/heartrate",
        files={"video": ("input.mp4", io.BytesIO(_read_file_bytes(mp4)), "video/mp4")},
        data={"method": "POS_WANG"},
    )
    assert res.status_code == 200
    payload = res.json()
    assert payload["success"] is True
    bpm = float(payload["data"]["bpm"])
    assert abs(bpm - 72.0) <= 5.0


def test_heartrate_all_compare_returns_confidence():
    frames = _make_pulse_frames(n_frames=300, fps=30, bpm=72.0)
    mp4 = _write_mp4(frames, fps=30)
    client = TestClient(app)

    res = client.post(
        "/vitals/heartrate",
        files={"video": ("input.mp4", io.BytesIO(_read_file_bytes(mp4)), "video/mp4")},
        data={"method": "ALL"},
    )
    assert res.status_code == 200
    payload = res.json()
    assert payload["success"] is True
    assert payload["data"]["method_requested"] == "ALL"

    compare = payload["data"]["compare"]
    assert isinstance(compare, list)
    assert len(compare) >= 3
    assert {"POS_WANG", "CHROME_DEHAAN", "ICA_POH"}.issubset({row.get("method") for row in compare})

    default_method = payload["data"]["method"]
    assert isinstance(default_method, str) and default_method

    default_row = next(row for row in compare if row.get("method") == default_method and row.get("ok") is True)
    bpm = float(default_row["bpm"])
    assert abs(bpm - 72.0) <= 5.0
    conf = float(default_row["confidence"])
    assert 0.0 <= conf <= 1.0


def test_realtime_vitals_fallback_batch():
    frames = _make_pulse_frames(n_frames=300, fps=30, bpm=72.0)
    mp4 = _write_mp4(frames, fps=30)
    client = TestClient(app)

    res = client.post(
        "/vitals/realtime",
        files={"video": ("input.mp4", io.BytesIO(_read_file_bytes(mp4)), "video/mp4")},
        data={"method": "cpu_POS", "winsize": "5"},
    )
    assert res.status_code == 200
    payload = res.json()
    assert payload["success"] is True
    bpm_mean = float(payload["data"]["bpm_mean"])
    assert abs(bpm_mean - 72.0) <= 5.0


def test_realtime_vitals_websocket_smoke():
    os.environ["VMAG_VITALS_MIN_FRAMES"] = "180"
    src = MIT_EVM_SOURCE_DIR / "face.mp4"
    assert src.exists(), f"Missing MIT test video: {src}"

    cap = cv2.VideoCapture(str(src))
    jpeg_frames: list[bytes] = []
    for _ in range(180):
        ret, frame = cap.read()
        assert ret, "Not enough frames in test video"
        ok, buf = cv2.imencode(".jpg", frame, [int(cv2.IMWRITE_JPEG_QUALITY), 70])
        assert ok
        jpeg_frames.append(buf.tobytes())
    cap.release()

    client = TestClient(app)
    with client.websocket_connect("/vitals/ws/vitals") as ws:
        # Send enough frames to trigger processing once
        for jf in jpeg_frames:
            ws.send_bytes(jf)

        data = None
        for _ in range(20):
            msg = ws.receive_text()
            data = json.loads(msg)
            if "bpm_mean" in data or "bpm" in data:
                break

        assert data is not None
        assert "bpm_mean" in data or "bpm" in data
        bpm_mean = float(data.get("bpm_mean", data.get("bpm", 0)))
        assert 40.0 <= bpm_mean <= 180.0


def test_mit_color_magnify_face_smoke():
    src = MIT_EVM_SOURCE_DIR / "face.mp4"
    assert src.exists(), f"Missing MIT test video: {src}"
    client = TestClient(app)
    res = client.post(
        "/magnify/color",
        files={"video": ("face.mp4", io.BytesIO(_read_file_bytes(src)), "video/mp4")},
        data={"freq_min": "0.83", "freq_max": "1.0", "amplification": "50", "pyramid_levels": "4"},
    )
    assert res.status_code == 200
    payload = res.json()
    assert payload["success"] is True
    assert payload["output_url"]
    out_path = _local_path_from_files_url(payload["output_url"])
    assert out_path.exists()
    assert out_path.stat().st_size > 0


def test_mit_heartrate_face_smoke():
    src = MIT_EVM_SOURCE_DIR / "face.mp4"
    assert src.exists(), f"Missing MIT test video: {src}"
    client = TestClient(app)
    res = client.post(
        "/vitals/heartrate",
        files={"video": ("face.mp4", io.BytesIO(_read_file_bytes(src)), "video/mp4")},
        data={"method": "POS_WANG"},
    )
    assert res.status_code == 200
    payload = res.json()
    assert payload["success"] is True
    bpm = float(payload["data"]["bpm"])
    assert 40.0 <= bpm <= 180.0
    assert float(payload["data"].get("confidence", 0.0)) >= 0.0


def test_mit_realtime_batch_face_smoke():
    src = MIT_EVM_SOURCE_DIR / "face.mp4"
    assert src.exists(), f"Missing MIT test video: {src}"
    client = TestClient(app)
    res = client.post(
        "/vitals/realtime",
        files={"video": ("face.mp4", io.BytesIO(_read_file_bytes(src)), "video/mp4")},
        data={"method": "cpu_POS", "winsize": "5"},
    )
    assert res.status_code == 200
    payload = res.json()
    assert payload["success"] is True
    bpm_mean = float(payload["data"]["bpm_mean"])
    assert 40.0 <= bpm_mean <= 180.0


def test_mit_audio_recover_guitar_smoke():
    src = MIT_EVM_SOURCE_DIR / "guitar.mp4"
    assert src.exists(), f"Missing MIT test video: {src}"
    client = TestClient(app)
    res = client.post(
        "/audio/recover",
        files={"video": ("guitar.mp4", io.BytesIO(_read_file_bytes(src)), "video/mp4")},
    )
    assert res.status_code == 200
    payload = res.json()
    assert payload["success"] is True
    assert payload["output_url"]
    out_path = _local_path_from_files_url(payload["output_url"])
    assert out_path.exists()
    assert out_path.stat().st_size > 0
    assert payload["data"]
    assert "waveform" in payload["data"]
    assert len(payload["data"]["waveform"]) > 10


def test_mit_motion_magnify_baby_fast_preview_smoke():
    src = MIT_EVM_SOURCE_DIR / "baby.mp4"
    assert src.exists(), f"Missing MIT test video: {src}"
    client = TestClient(app)
    res = client.post(
        "/magnify/motion",
        files={"video": ("baby.mp4", io.BytesIO(_read_file_bytes(src)), "video/mp4")},
        data={"magnification": "10", "mode": "static", "max_frames": "30"},
    )
    assert res.status_code == 200
    payload = res.json()
    assert payload["success"] is True
    assert payload["output_url"]
    out_path = _local_path_from_files_url(payload["output_url"])
    assert out_path.exists()
    assert out_path.stat().st_size > 0
