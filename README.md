# VMAG — Video Magnification Laboratory

Unified webapp for:
- Motion magnification (STB‑VMM, Swin Transformer)
- Color magnification (Eulerian Video Magnification)
- Heart rate extraction (rPPG‑Toolbox)
- Real‑time vitals (pyVHR, with rPPG fallback)
- “Visual microphone” style audio recovery from video vibrations

## Quick start

```bash
# 1) Backends are vendored; download model weights
bash scripts/download_weights.sh

# 2) Python deps (recommended: venv)
python -m venv .venv
source .venv/bin/activate
pip install -r requirements.txt

# 3) Frontend deps
cd frontend && npm install

# 4) Run
uvicorn api.main:app --reload --port 8001
# (new terminal)
cd frontend && npm run dev
```

For the original blueprint / architecture notes, see `video-magnification-webapp-plan.md`.
