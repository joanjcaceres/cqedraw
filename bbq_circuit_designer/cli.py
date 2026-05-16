"""Command-line entry point for BBQ Circuit Designer."""

from __future__ import annotations

import argparse
from collections.abc import Sequence

from . import __version__


def main(argv: Sequence[str] | None = None) -> None:
    parser = argparse.ArgumentParser(
        prog="bbq-circuit-designer",
        description="Open the BBQ Circuit Designer GUI.",
    )
    parser.add_argument(
        "--version",
        action="store_true",
        help="Print the installed version and exit.",
    )
    args = parser.parse_args(argv)

    if args.version:
        print(f"bbq-circuit-designer {__version__}")
        return

    from .app import main as launch_app

    launch_app()
