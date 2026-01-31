#!/bin/bash
set -e

CKPT_PATH="backends/STB-VMM/ckpt_e49.pth.tar"

if [ -f "$CKPT_PATH" ]; then
    echo "Checkpoint already exists at $CKPT_PATH"
    exit 0
fi

echo "Downloading STB-VMM checkpoint from HuggingFace..."
mkdir -p backends/STB-VMM

# Try huggingface-cli first, then curl
if command -v huggingface-cli &> /dev/null; then
    huggingface-cli download raoulritter/STB-VMM-Simplification ckpt_e49.pth.tar --local-dir backends/STB-VMM
else
    curl -L "https://huggingface.co/raoulritter/STB-VMM-Simplification/resolve/main/ckpt_e49.pth.tar" \
        -o "$CKPT_PATH"
fi

echo "Checkpoint downloaded to $CKPT_PATH"
