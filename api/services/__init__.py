"""Service registry — lazy singletons for each backend."""

from typing import Dict, Any

_instances: Dict[str, Any] = {}


def _get_service(name: str):
    """Get or create a singleton service instance."""
    if name not in _instances:
        if name == "evm":
            from api.services.evm import EVMService
            _instances[name] = EVMService()
        elif name == "pyvhr":
            from api.services.pyvhr import PyVHRService
            _instances[name] = PyVHRService()
        elif name == "rppg":
            from api.services.rppg import RPPGService
            _instances[name] = RPPGService()
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


def get_pyvhr():
    return _get_service("pyvhr")


def get_rppg():
    return _get_service("rppg")


def get_stbvmm():
    return _get_service("stbvmm")


def get_visualmic():
    return _get_service("visualmic")


def get_backend_status() -> Dict[str, Dict[str, Any]]:
    """Check availability of all backends."""
    status = {}
    services = {
        "evm": ("EVM (Eulerian)", get_evm),
        "pyvhr": ("pyVHR (Real-time Vitals)", get_pyvhr),
        "rppg": ("rPPG-Toolbox (Heart Rate)", get_rppg),
        "stbvmm": ("STB-VMM (Motion Magnification)", get_stbvmm),
        "visualmic": ("Visual-Mic (Audio Recovery)", get_visualmic),
    }
    for key, (label, getter) in services.items():
        try:
            svc = getter()
            available = svc.is_available()
            err = getattr(svc, "_last_error", None)
            status[key] = {"label": label, "available": available, "error": err if err else None}
        except Exception as e:
            status[key] = {"label": label, "available": False, "error": str(e)}
    return status
