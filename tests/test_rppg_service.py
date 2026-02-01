import numpy as np

from api.services.rppg import RPPGService


def test_rppg_bvp_to_bpm_empty_returns_zero():
    svc = RPPGService()
    bpm, conf, psd_freqs, psd_power = svc._bvp_to_bpm(np.array([], dtype=np.float32), 30.0)
    assert float(bpm) == 0.0
    assert float(conf) == 0.0
    assert psd_freqs == []
    assert psd_power == []


def test_rppg_process_all_skips_empty_bvp(monkeypatch):
    svc = RPPGService()
    frames_rgb = np.zeros((10, 128, 128, 3), dtype=np.float32)

    def fake_run_method(method: str, _frames_rgb: np.ndarray, _fps: float):
        if method == "POS_WANG":
            return np.array([], dtype=np.float32)
        if method == "CHROME_DEHAAN":
            return np.linspace(0, 1, 100, dtype=np.float32)
        return None

    def fake_bvp_to_bpm(bvp: np.ndarray, _fps: float):
        assert isinstance(bvp, np.ndarray)
        assert bvp.size > 0
        return 72.0, 0.9, [], []

    monkeypatch.setattr(svc, "_run_method", fake_run_method)
    monkeypatch.setattr(svc, "_bvp_to_bpm", fake_bvp_to_bpm)

    result = svc._process_all(frames_rgb=frames_rgb, fps=30.0, progress=None)
    assert result.success is True
    assert (result.data or {})["method"] == "CHROME_DEHAAN"

    compare = (result.data or {})["compare"]
    pos_row = next(row for row in compare if row.get("method") == "POS_WANG")
    assert pos_row.get("ok") is False
    assert "no signal" in (pos_row.get("error") or "").lower()

    chrome_row = next(row for row in compare if row.get("method") == "CHROME_DEHAAN")
    assert chrome_row.get("ok") is True
    assert float(chrome_row.get("bpm")) == 72.0
    assert float(chrome_row.get("confidence")) == 0.9

