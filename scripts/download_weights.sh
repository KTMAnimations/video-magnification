#!/bin/bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$ROOT_DIR"

downloaded_any=0
download_failures=0
missing_any=0

echo "=== Downloading / checking model weights ==="

if [ -d "scripts/backends" ]; then
    echo "NOTE: Found scripts/backends (likely created by running this script from ./scripts before it cd'd to repo root)."
    echo "      It is safe to delete to avoid confusion: rm -rf scripts/backends"
fi

##
## STB-VMM
##
STBVMM_CKPT_PATH="backends/STB-VMM/ckpt_e49.pth.tar"
if [ -f "$STBVMM_CKPT_PATH" ]; then
    echo "STB-VMM checkpoint already exists at $STBVMM_CKPT_PATH"
else
    echo "Downloading STB-VMM checkpoint from HuggingFace..."
    mkdir -p backends/STB-VMM
    # Try huggingface-cli first, then curl
    if command -v huggingface-cli &> /dev/null; then
        huggingface-cli download raoulritter/STB-VMM-Simplification ckpt_e49.pth.tar --local-dir backends/STB-VMM
    else
        curl -L "https://huggingface.co/raoulritter/STB-VMM-Simplification/resolve/main/ckpt_e49.pth.tar" \
            -o "$STBVMM_CKPT_PATH"
    fi
    downloaded_any=1
    echo "STB-VMM checkpoint downloaded to $STBVMM_CKPT_PATH"
fi

##
## FD4MM (weights are not bundled / may not be publicly hosted)
##
FD4MM_CKPT_PATH="backends/FD4MM/fd4mm.pth"
if [ -f "$FD4MM_CKPT_PATH" ]; then
    echo "FD4MM checkpoint found at $FD4MM_CKPT_PATH"
else
    echo "FD4MM checkpoint missing at $FD4MM_CKPT_PATH (place it there or set VMAG_FD4MM_CHECKPOINT)."
    missing_any=1
fi

##
## FlowMag
##
FLOWMAG_DIR="backends/flowmag"
FLOWMAG_RAFT_CKPT="$FLOWMAG_DIR/checkpoints/raft_chkpt_00140.pth"
if [ -f "$FLOWMAG_RAFT_CKPT" ]; then
    echo "FlowMag checkpoint already exists at $FLOWMAG_RAFT_CKPT"
else
    if [ -d "$FLOWMAG_DIR" ]; then
        echo "Downloading FlowMag checkpoints (Google Drive)..."
        flowmag_status=0
        if command -v gdown &> /dev/null; then
            # Don't abort the whole script if Google Drive denies access/quota.
            set +e
            (cd "$FLOWMAG_DIR" && bash checkpoints/download_models.sh)
            flowmag_status=$?
            set -e
        elif python -c "import gdown" &> /dev/null; then
            set +e
            (cd "$FLOWMAG_DIR" && python -m gdown 1ESSaea-Roe1feFugPFycW5Dd7QCg2ZXR -O checkpoints/raft_chkpt_00140.pth)
            flowmag_status=$?
            if [ "$flowmag_status" -eq 0 ]; then
                (cd "$FLOWMAG_DIR" && python -m gdown 1m-nE_-3AJ549W3Yemnrm4XeR28tP1sUM -O checkpoints/arflow_chkpt_00140.pth)
                flowmag_status=$?
            fi
            set -e
        else
            flowmag_status=1
            echo "FlowMag weights require gdown. Install with: pip install gdown"
        fi

        if [ -f "$FLOWMAG_RAFT_CKPT" ]; then
            downloaded_any=1
            echo "FlowMag checkpoint downloaded to $FLOWMAG_RAFT_CKPT"
        else
            download_failures=1
            missing_any=1
            if [ "$flowmag_status" -ne 0 ]; then
                echo "FlowMag weights download failed (gdown error). This is often due to Google Drive permissions/quota."
            fi
        fi
    else
        echo "FlowMag repo not found at $FLOWMAG_DIR (run scripts/setup_backends.sh first)."
        download_failures=1
        missing_any=1
    fi
fi

##
## RhythmMamba (weights live in the repo under PreTrainedModels/)
##
RHYTHM_DIR="backends/RhythmMamba"
RHYTHM_CKPT="$RHYTHM_DIR/PreTrainedModels/UBFC_cross_RhythmMamba.pth"
if [ -f "$RHYTHM_CKPT" ]; then
    echo "RhythmMamba pretrained model found at $RHYTHM_CKPT"
else
    if [ -d "$RHYTHM_DIR" ]; then
        echo "RhythmMamba repo present, but pretrained weights missing at $RHYTHM_CKPT"
        missing_any=1
    else
        echo "RhythmMamba repo not found at $RHYTHM_DIR (run scripts/setup_backends.sh first)."
        missing_any=1
    fi
fi

##
## FactorizePhys (weights are also in-repo, but we can download a known-good checkpoint directly)
##
FACTOR_DIR="backends/FactorizePhys"
FACTOR_CKPT="$FACTOR_DIR/final_model_release/PURE_FactorizePhys_FSAM_Res.pth"
if [ -f "$FACTOR_CKPT" ]; then
    echo "FactorizePhys checkpoint already exists at $FACTOR_CKPT"
else
    echo "Downloading FactorizePhys checkpoint (PURE_FactorizePhys_FSAM_Res.pth) from GitHub..."
    mkdir -p "$FACTOR_DIR/final_model_release"
    curl -L "https://raw.githubusercontent.com/PhysiologicAILab/FactorizePhys/main/final_model_release/PURE_FactorizePhys_FSAM_Res.pth" \
        -o "$FACTOR_CKPT"
    downloaded_any=1
    echo "FactorizePhys checkpoint downloaded to $FACTOR_CKPT"
fi

if [ "$downloaded_any" -eq 0 ] && [ "$missing_any" -eq 0 ]; then
    echo "All requested checkpoints already present."
elif [ "$downloaded_any" -eq 0 ]; then
    echo "No checkpoints downloaded."
fi

if [ "$download_failures" -ne 0 ]; then
    echo "WARNING: Some checkpoints could not be downloaded. See messages above."
fi

echo "=== Done ==="
