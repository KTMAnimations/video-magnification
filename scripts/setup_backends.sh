#!/bin/bash
set -e

echo "=== Cloning backend repos ==="
mkdir -p backends

# STB-VMM
if [ ! -d "backends/STB-VMM" ]; then
    echo "Cloning STB-VMM..."
    git clone https://github.com/RLado/STB-VMM.git backends/STB-VMM
else
    echo "STB-VMM already cloned."
fi

# Eulerian Magnification (pip-installed, but clone for reference)
if [ ! -d "backends/eulerian-magnification" ]; then
    echo "Cloning eulerian-magnification..."
    git clone https://github.com/brycedrennan/eulerian-magnification.git backends/eulerian-magnification
else
    echo "eulerian-magnification already cloned."
fi

# rPPG-Toolbox
if [ ! -d "backends/rPPG-Toolbox" ]; then
    echo "Cloning rPPG-Toolbox..."
    git clone https://github.com/ubicomplab/rPPG-Toolbox.git backends/rPPG-Toolbox
else
    echo "rPPG-Toolbox already cloned."
fi

# pyVHR
if [ ! -d "backends/pyVHR" ]; then
    echo "Cloning pyVHR..."
    git clone https://github.com/phuselab/pyVHR.git backends/pyVHR
else
    echo "pyVHR already cloned."
fi

# Patch pyVHR to be importable in a lightweight server environment (optional deps).
if [ -d "backends/pyVHR/.git" ] && [ -f "scripts/pyvhr.patch" ]; then
    echo "Patching pyVHR (server-friendly imports)..."
    if git -C backends/pyVHR apply --check "../../scripts/pyvhr.patch" >/dev/null 2>&1; then
        git -C backends/pyVHR apply "../../scripts/pyvhr.patch"
        echo "pyVHR patch applied."
    else
        echo "pyVHR patch not applied (already patched or upstream has diverged)."
    fi
fi

# Visual-Mic
if [ ! -d "backends/Visual-Mic" ]; then
    echo "Cloning Visual-Mic..."
    git clone https://github.com/joeljose/Visual-Mic.git backends/Visual-Mic
else
    echo "Visual-Mic already cloned."
fi

echo "=== All repos cloned ==="
