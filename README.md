# BBQ Circuit Designer

BBQ Circuit Designer is a standalone Tkinter application for drawing
superconducting circuit graphs and generating sparse/dense capacitance and
inverse-inductance matrix snippets for Black Box Quantization workflows.

It is the companion GUI matrix-builder for
[`sccircuits`](https://github.com/joanjcaceres/sccircuits): use the app to draw
the linear circuit, then paste the generated matrices into a Python analysis
that constructs `sccircuits.BBQ` objects. The app remains installable on its
own because it is a launched desktop-style tool, not an imported library API.

## Requirements

The native macOS and Windows beta downloads include Python and the required
runtime dependencies.

For the Python install path:

- Python 3.11 or newer
- Tkinter support in your Python installation
- NumPy, SciPy, and SymPy, installed automatically by the package metadata

Tkinter is part of the Python standard library, but some Linux distributions
ship it separately. If the app fails with `ModuleNotFoundError: tkinter`,
install your platform's Tk package, for example `python3-tk` on Debian/Ubuntu.

## Installation

### Option 1: Native Desktop Download

For macOS and Windows users who do not want to manage Python environments,
download the latest beta build from
[GitHub Releases](https://github.com/joanjcaceres/bbq-circuit-designer/releases).

- macOS: download `BBQ-Circuit-Designer-macOS.zip`, unzip it, and double-click
  `BBQ Circuit Designer.app`.
- Windows: download `BBQ-Circuit-Designer-Windows.zip`, unzip it, and
  double-click `BBQ Circuit Designer.exe`.

These first desktop builds are unsigned beta artifacts. macOS and Windows may
show security warnings until code signing/notarization is added in a later
release.

Linux users should use the Python install path for now; a native Linux bundle
can be added after the macOS and Windows release flow is stable.

### Option 2: Python Tool Install

After the first PyPI release, the recommended terminal install is:

```bash
pipx install bbq-circuit-designer
bbq-circuit-designer
```

Before the PyPI release is available, run directly from GitHub:

```bash
pipx run --spec git+https://github.com/joanjcaceres/bbq-circuit-designer.git bbq-circuit-designer
```

If you prefer `pip`:

```bash
python -m pip install "bbq-circuit-designer @ git+https://github.com/joanjcaceres/bbq-circuit-designer.git"
bbq-circuit-designer
```

To install the app together with the SCCircuits package for analysis examples:

```bash
python -m pip install "bbq-circuit-designer[sccircuits] @ git+https://github.com/joanjcaceres/bbq-circuit-designer.git"
```

### Option 3: Local Development

```bash
git clone https://github.com/joanjcaceres/bbq-circuit-designer.git
cd bbq-circuit-designer
python -m pip install -e ".[dev]"
pytest
```

## Launching

After installation, run:

```bash
bbq-circuit-designer
```

You can also launch it as a module:

```bash
python -m bbq_circuit_designer
```

To verify an install without opening the GUI:

```bash
bbq-circuit-designer --version
```

## Basic Workflow

Use the toolbar or keyboard shortcuts to create nodes, edges, and ground
connections. Edge dialogs accept numeric values or SymPy-compatible symbolic
expressions for capacitance and inductance.

Projects can be saved and loaded as JSON files from the GUI. Use the `Snippet`
button to copy generated Python code for the current capacitance matrix and
inverse-inductance matrix. The generated snippet includes helpers for dense
NumPy arrays, sparse SciPy matrices, and raw matrix triplets.

## Using With SCCircuits

The copied snippet defines functions such as `C_matrix_func` and
`L_inv_matrix_func`. Paste that snippet into your analysis script or notebook,
then pass the generated matrices into `sccircuits.BBQ`:

```python
from sccircuits import BBQ

# Paste the snippet copied from BBQ Circuit Designer above this line.
# Replace these keyword names and values with the symbols used in your drawing.
C_matrix = C_matrix_func(Cj=40e-15, Cg=2e-15)
L_inv_matrix = L_inv_matrix_func(Lj=1.23e-9)

bbq = BBQ(C_matrix, L_inv_matrix, non_linear_nodes=(-1, 0))

print("Linear mode frequencies (GHz):", bbq.linear_modes_GHz)
print("Phase ZPF:", bbq.phase_zpf_list)
```

If you only need to draw circuits and copy matrix snippets, `sccircuits` is not
required. Install the optional `sccircuits` extra when you want the analysis
package available in the same environment.

## Development

```bash
python -m pip install -e ".[dev]"
pytest
```

Regenerate icon assets after editing `scripts/generate_icons.py`:

```bash
python scripts/generate_icons.py
```

Build local Python distributions:

```bash
python -m build
```

Create a release by pushing a version tag:

```bash
git tag v0.1.0
git push origin v0.1.0
```

The release workflow builds Python distributions, macOS and Windows unsigned
beta artifacts, and uploads them to GitHub Releases. It also publishes to PyPI
through Trusted Publishing after the PyPI project is configured with this
repository and the `release.yml` workflow.

The tests cover matrix assembly, generated snippet behavior, CLI version
handling, and node merge logic without opening the Tkinter window.
