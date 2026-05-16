# BBQ Circuit Designer

BBQ Circuit Designer is a standalone Tkinter application for drawing
superconducting circuit graphs and generating sparse/dense capacitance and
inverse-inductance matrix snippets for Black Box Quantization workflows.

This project was split out from `sccircuits` so the GUI can be installed and
used independently from the scientific library.

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

## Development

Run the test suite with:

```bash
pytest
```

The tests cover matrix assembly, generated snippet behavior, and node merge
logic without opening the Tkinter window.
