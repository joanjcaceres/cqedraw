"""Standalone BBQ circuit designer application."""

__version__ = "0.1.0"

__all__ = [
    "CircuitGraphApp",
    "Edge",
    "EdgeDialog",
    "EdgeParameters",
    "Node",
    "__version__",
]


def __getattr__(name: str):
    if name in {"CircuitGraphApp", "Edge", "EdgeDialog", "EdgeParameters", "Node"}:
        from . import app

        return getattr(app, name)
    raise AttributeError(f"module {__name__!r} has no attribute {name!r}")
