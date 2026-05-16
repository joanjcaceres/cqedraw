import subprocess
import sys


def test_module_version_exits_without_opening_gui():
    result = subprocess.run(
        [sys.executable, "-m", "bbq_circuit_designer", "--version"],
        check=True,
        capture_output=True,
        text=True,
    )

    assert result.stdout.strip() == "bbq-circuit-designer 0.1.0"
    assert result.stderr == ""
