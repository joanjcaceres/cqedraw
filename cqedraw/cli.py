"""Command-line entry point for cQEDraw."""

from __future__ import annotations

import argparse
from collections.abc import Sequence

from . import __version__


def main(argv: Sequence[str] | None = None) -> None:
    parser = argparse.ArgumentParser(
        prog="cqedraw",
        description="Open the cQEDraw GUI.",
    )
    parser.add_argument(
        "--version",
        action="store_true",
        help="Print the installed version and exit.",
    )
    parser.add_argument(
        "--check-gui-import",
        action="store_true",
        help=argparse.SUPPRESS,
    )
    args = parser.parse_args(argv)

    if args.version:
        print(f"cqedraw {__version__}")
        return

    if args.check_gui_import:
        from . import app as _app

        print("cqedraw gui import ok")
        return

    from .app import main as launch_app

    launch_app()
