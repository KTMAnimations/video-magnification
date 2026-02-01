#!/bin/bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$ROOT_DIR"

echo "=== Backends ==="
echo "This repo vendors backend code in ./backends (not git submodules)."

missing=0
for d in \
    backends/FD4MM \
    backends/FactorizePhys \
    backends/RhythmMamba \
    backends/STB-VMM \
    backends/Visual-Mic \
    backends/eulerian-magnification \
    backends/flowmag \
    backends/pyVHR \
    backends/rPPG-Toolbox; do
    if [ ! -d "$d" ]; then
        echo "❌ Missing: $d"
        missing=1
    fi
done

if [ "$missing" -ne 0 ]; then
    echo ""
    echo "Restore the backends directory from git (e.g., via 'git checkout -- backends' or a fresh clone)."
    exit 1
fi

echo "✅ Backend folders present."
