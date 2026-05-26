"""Report large source files as an advisory maintainability check."""

from __future__ import annotations

import argparse
from dataclasses import dataclass
from pathlib import Path


DEFAULT_INCLUDED_SUFFIXES = {
    ".css",
    ".html",
    ".js",
    ".json",
    ".md",
    ".py",
    ".toml",
    ".ts",
    ".tsx",
    ".yaml",
    ".yml",
}
DEFAULT_EXCLUDED_DIRS = {
    ".git",
    ".mypy_cache",
    ".pytest_cache",
    ".ruff_cache",
    ".venv",
    ".vite",
    "__pycache__",
    "build",
    "dist",
    "node_modules",
    "playwright-report",
    "test-results",
}
DEFAULT_EXCLUDED_FILENAMES = {
    "AGENTS.md",
    "package-lock.json",
}


@dataclass(frozen=True)
class SourceFileSize:
    path: Path
    line_count: int


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser(
        description=(
            "List the largest source files. This is advisory by default; pass "
            "--fail-over-soft-cap to use it as a gate."
        )
    )
    parser.add_argument(
        "--root",
        default=".",
        type=Path,
        help="Repository root to scan. Defaults to the current directory.",
    )
    parser.add_argument(
        "--limit",
        default=25,
        type=int,
        help="Number of files to print. Use 0 to print every matched file.",
    )
    parser.add_argument(
        "--soft-cap",
        default=1000,
        type=int,
        help="Line count threshold to mark as over the advisory cap.",
    )
    parser.add_argument(
        "--all",
        action="store_true",
        help="Include every readable file except ignored directories and lock files.",
    )
    parser.add_argument(
        "--fail-over-soft-cap",
        action="store_true",
        help="Exit non-zero when any scanned file is over the soft cap.",
    )
    return parser.parse_args()


def should_scan(path: Path, root: Path, include_all: bool) -> bool:
    relative_parts = path.relative_to(root).parts
    if any(part in DEFAULT_EXCLUDED_DIRS for part in relative_parts):
        return False
    if path.name in DEFAULT_EXCLUDED_FILENAMES:
        return False
    return include_all or path.suffix in DEFAULT_INCLUDED_SUFFIXES


def count_lines(path: Path) -> int | None:
    try:
        with path.open("r", encoding="utf-8") as handle:
            return sum(1 for _line in handle)
    except UnicodeDecodeError:
        return None


def source_sizes(root: Path, include_all: bool) -> list[SourceFileSize]:
    files: list[SourceFileSize] = []
    for path in root.rglob("*"):
        if not path.is_file() or not should_scan(path, root, include_all):
            continue
        line_count = count_lines(path)
        if line_count is None:
            continue
        files.append(SourceFileSize(path.relative_to(root), line_count))
    return sorted(files, key=lambda item: (-item.line_count, str(item.path)))


def main() -> int:
    args = parse_args()
    root = args.root.resolve()
    sizes = source_sizes(root, args.all)
    visible_sizes = sizes if args.limit == 0 else sizes[: args.limit]
    over_cap = [item for item in sizes if item.line_count > args.soft_cap]

    print(f"Source size report for {root}")
    print(f"Soft cap: {args.soft_cap} lines")
    print("")
    print(f"{'lines':>7}  {'status':<8}  path")
    print(f"{'-' * 7}  {'-' * 8}  {'-' * 4}")
    for item in visible_sizes:
        status = "over" if item.line_count > args.soft_cap else "ok"
        print(f"{item.line_count:>7}  {status:<8}  {item.path}")

    if over_cap:
        print("")
        print(f"{len(over_cap)} file(s) are over the advisory soft cap.")
    if over_cap and args.fail_over_soft_cap:
        return 1
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
