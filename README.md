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

- Python 3.11 or newer
- Tkinter support in your Python installation
- NumPy, SciPy, and SymPy, installed automatically by the package metadata

Tkinter is part of the Python standard library, but some Linux distributions
ship it separately. If the app fails with `ModuleNotFoundError: tkinter`,
install your platform's Tk package, for example `python3-tk` on Debian/Ubuntu.

## Installation

From a local checkout:

```bash
python -m pip install -e .
```

From GitHub:

```bash
python -m pip install "bbq-circuit-designer @ git+https://github.com/joanjcaceres/bbq-circuit-designer.git"
```

To install the app together with the SCCircuits package for analysis examples:

```bash
python -m pip install "bbq-circuit-designer[sccircuits] @ git+https://github.com/joanjcaceres/bbq-circuit-designer.git"
```

For development and tests:

```bash
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

Run the test suite with:

```bash
pytest
```

The tests cover matrix assembly, generated snippet behavior, and node merge
logic without opening the Tkinter window.
