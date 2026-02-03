"""Service registry — lazy singletons for each backend."""

from typing import Dict, Any

_instances: Dict[str, Any] = {}


def _get_service(name: str):
    """Get or create a singleton service instance."""
    if name not in _instances:
        if name == "evm":
            from api.services.evm import EVMService
            _instances[name] = EVMService()
        elif name == "factorizephys":
            from api.services.factorizephys import FactorizePhysService
            _instances[name] = FactorizePhysService()
        elif name == "fd4mm":
            from api.services.fd4mm import FD4MMService
            _instances[name] = FD4MMService()
        elif name == "flowmag":
            from api.services.flowmag import FlowMagService
            _instances[name] = FlowMagService()
        elif name == "facerecog":
            from api.services.facerecog import FaceRecogService
            _instances[name] = FaceRecogService()
        elif name == "pyvhr":
            from api.services.pyvhr import PyVHRService
            _instances[name] = PyVHRService()
        elif name == "rppg":
            from api.services.rppg import RPPGService
            _instances[name] = RPPGService()
        elif name == "rhythm_mamba":
            from api.services.rhythm_mamba import RhythmMambaService
            _instances[name] = RhythmMambaService()
        elif name == "stbvmm":
            from api.services.stbvmm import STBVMMService
            _instances[name] = STBVMMService()
        elif name == "visualmic":
            from api.services.visualmic import VisualMicService
            _instances[name] = VisualMicService()
        else:
            raise ValueError(f"Unknown service: {name}")
    return _instances[name]


def get_evm():
    return _get_service("evm")


def get_factorizephys():
    return _get_service("factorizephys")


def get_fd4mm():
    return _get_service("fd4mm")


def get_flowmag():
    return _get_service("flowmag")


def get_facerecog():
    return _get_service("facerecog")


def get_pyvhr():
    return _get_service("pyvhr")


def get_rppg():
    return _get_service("rppg")


def get_rhythm_mamba():
    return _get_service("rhythm_mamba")


def get_stbvmm():
    return _get_service("stbvmm")


def get_visualmic():
    return _get_service("visualmic")


def get_backend_status() -> Dict[str, Dict[str, Any]]:
    """Check availability of all backends."""
    status = {}
    services = {
        "motion": ("Motion Magnification (Any)", None),
        "evm": ("EVM (Eulerian)", get_evm),
        "fd4mm": ("FD4MM (Motion Magnification)", get_fd4mm),
        "flowmag": ("FlowMag (Motion Magnification)", get_flowmag),
        "heartrate": ("Heart Rate (Any)", None),
        "factorizephys": ("FactorizePhys (Heart Rate)", get_factorizephys),
        "pyvhr": ("pyVHR (Real-time Vitals)", get_pyvhr),
        "rppg": ("rPPG-Toolbox (Heart Rate)", get_rppg),
        "rhythm_mamba": ("RhythmMamba (Heart Rate)", get_rhythm_mamba),
        "stbvmm": ("STB-VMM (Motion Magnification)", get_stbvmm),
        "visualmic": ("Visual-Mic (Audio Recovery)", get_visualmic),
    }
    fallback_map = {
        # These engines may run via a different backend if their native deps/weights are missing.
        "fd4mm": "stbvmm",
        "rhythm_mamba": "rppg",
    }
    for key, (label, getter) in services.items():
        if getter is None:
            status[key] = {
                "label": label,
                "available": False,
                "usable": False,
                "using_fallback": False,
                "fallback": None,
                "error": None,
            }
            continue
        try:
            svc = getter()
            usable = bool(svc.is_available())
            native_available = usable
            native_fn = getattr(svc, "_native_is_available", None)
            if callable(native_fn):
                native_available = bool(native_fn())
            using_fallback = bool(usable and not native_available)
            err = getattr(svc, "_last_error", None)
            status[key] = {
                "label": label,
                # "available" means the named backend is actually usable as itself.
                "available": native_available,
                # "usable" means the endpoint can still run (possibly via fallback).
                "usable": usable,
                "using_fallback": using_fallback,
                "fallback": (fallback_map.get(key) if using_fallback else None),
                # Preserve the native availability error even when a fallback exists,
                # so the UI can explain why an engine is disabled.
                "error": (err if (not native_available and err) else None),
            }
        except Exception as e:
            status[key] = {
                "label": label,
                "available": False,
                "usable": False,
                "using_fallback": False,
                "fallback": None,
                "error": str(e),
            }

    motion_keys = ("stbvmm", "fd4mm", "flowmag")
    hr_keys = ("rppg", "rhythm_mamba", "factorizephys")

    status["motion"]["available"] = any(status.get(k, {}).get("available") for k in motion_keys)
    status["motion"]["usable"] = any(status.get(k, {}).get("usable") for k in motion_keys)

    status["heartrate"]["available"] = any(status.get(k, {}).get("available") for k in hr_keys)
    status["heartrate"]["usable"] = any(status.get(k, {}).get("usable") for k in hr_keys)
    return status
