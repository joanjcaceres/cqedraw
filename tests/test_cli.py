import subprocess
import sys


def test_module_version_exits_without_opening_gui():
    result = subprocess.run(
        [sys.executable, "-m", "cqedraw", "--version"],
        check=True,
        capture_output=True,
        text=True,
    )

    assert result.stdout.strip() == "cqedraw 0.2.0"
    assert result.stderr == ""


def test_module_gui_import_check_exits_without_opening_gui():
    result = subprocess.run(
        [sys.executable, "-m", "cqedraw", "--check-gui-import"],
        check=True,
        capture_output=True,
        text=True,
    )

    assert result.stdout.strip() == "cqedraw gui import ok"
    assert result.stderr == ""
