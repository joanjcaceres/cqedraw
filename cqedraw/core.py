"""Pure output-generation logic for cQEDraw."""

from __future__ import annotations

from dataclasses import dataclass
from typing import Dict, Iterable, Optional, Tuple

import sympy as sp
from sympy.printing.pycode import pycode


GROUND_NODE_ID = -1
MatrixEntries = Dict[Tuple[int, int], sp.Expr]


@dataclass(frozen=True)
class CircuitEdgeData:
    nodes: Tuple[int, int]
    capacitance_expr: Optional[sp.Expr]
    l_inverse_expr: Optional[sp.Expr]


def accumulate_matrix_entry(
    entries: MatrixEntries, row: int, col: int, value: sp.Expr
) -> None:
    key = (row, col)
    existing = entries.get(key)
    entries[key] = value if existing is None else existing + value


def finalize_matrix_entries(entries: MatrixEntries) -> MatrixEntries:
    finalized: MatrixEntries = {}
    for key, value in entries.items():
        simplified = sp.simplify(value)
        if simplified != 0:
            finalized[key] = simplified
    return finalized


def compute_matrix_entries(
    node_ids: Iterable[int], edges: Iterable[CircuitEdgeData]
) -> Tuple[int, MatrixEntries, MatrixEntries]:
    sorted_node_ids = sorted(node_ids)
    index_map = {node_id: idx for idx, node_id in enumerate(sorted_node_ids)}
    size = len(sorted_node_ids)
    c_entries: MatrixEntries = {}
    l_inv_entries: MatrixEntries = {}
    for edge in edges:
        first_node, second_node = edge.nodes
        if first_node not in index_map:
            continue
        i = index_map[first_node]

        if second_node == GROUND_NODE_ID:
            if edge.capacitance_expr is not None:
                accumulate_matrix_entry(c_entries, i, i, edge.capacitance_expr)
            if edge.l_inverse_expr is not None:
                accumulate_matrix_entry(l_inv_entries, i, i, edge.l_inverse_expr)
            continue

        if second_node not in index_map:
            continue
        j = index_map[second_node]
        if edge.capacitance_expr is not None:
            value = edge.capacitance_expr
            accumulate_matrix_entry(c_entries, i, i, value)
            accumulate_matrix_entry(c_entries, j, j, value)
            accumulate_matrix_entry(c_entries, i, j, -value)
            accumulate_matrix_entry(c_entries, j, i, -value)
        if edge.l_inverse_expr is not None:
            value = edge.l_inverse_expr
            accumulate_matrix_entry(l_inv_entries, i, i, value)
            accumulate_matrix_entry(l_inv_entries, j, j, value)
            accumulate_matrix_entry(l_inv_entries, i, j, -value)
            accumulate_matrix_entry(l_inv_entries, j, i, -value)
    return (
        size,
        finalize_matrix_entries(c_entries),
        finalize_matrix_entries(l_inv_entries),
    )


def compute_matrices(
    node_ids: Iterable[int], edges: Iterable[CircuitEdgeData]
) -> Tuple[sp.Matrix, sp.Matrix]:
    size, c_entries, l_inv_entries = compute_matrix_entries(node_ids, edges)
    return (
        sp.SparseMatrix(size, size, c_entries),
        sp.SparseMatrix(size, size, l_inv_entries),
    )


def matrix_snippet_support_functions() -> list[str]:
    indent = " " * 4
    return [
        "def _matrix_triplets_from_entries(entries):",
        f"{indent}if not entries:",
        f"{indent*2}return (",
        f"{indent*3}np.array([], dtype=int),",
        f"{indent*3}np.array([], dtype=int),",
        f"{indent*3}np.array([], dtype=float),",
        f"{indent*2})",
        f"{indent}rows, cols, data = zip(*entries)",
        f"{indent}return (",
        f"{indent*2}np.array(rows, dtype=int),",
        f"{indent*2}np.array(cols, dtype=int),",
        f"{indent*2}np.array(data, dtype=float),",
        f"{indent})",
        "",
        "def _sparse_matrix_from_entries(entries, shape):",
        f"{indent}matrix = sparse.csr_matrix(shape, dtype=float)",
        f"{indent}if not entries:",
        f"{indent*2}return matrix",
        f"{indent}rows, cols, data = _matrix_triplets_from_entries(entries)",
        f"{indent}return matrix + sparse.coo_matrix(",
        f"{indent*2}(data, (rows, cols)),",
        f"{indent*2}shape=shape,",
        f"{indent}).tocsr()",
        "",
        "def _dense_matrix_from_entries(entries, shape):",
        f"{indent}matrix = np.zeros(shape, dtype=float)",
        f"{indent}if not entries:",
        f"{indent*2}return matrix",
        f"{indent}rows, cols, data = _matrix_triplets_from_entries(entries)",
        f"{indent}np.add.at(matrix, (rows, cols), data)",
        f"{indent}return matrix",
    ]


def matrix_function_snippet(
    entries_func_name: str,
    triplet_func_name: str,
    sparse_func_name: str,
    dense_func_name: str,
    size: int,
    entries: MatrixEntries,
) -> Tuple[list[str], list[str]]:
    sorted_entries = sorted(entries.items())
    symbols = sorted(
        {symbol for _, expr in sorted_entries for symbol in expr.free_symbols},
        key=lambda sym: sym.name,
    )
    param_names = [symbol.name for symbol in symbols]
    args = ", ".join(param_names)
    indent = " " * 4
    shape_literal = f"({size}, {size})"
    entries_signature = (
        f"def {entries_func_name}({args}):"
        if args
        else f"def {entries_func_name}():"
    )
    triplet_signature = (
        f"def {triplet_func_name}({args}):"
        if args
        else f"def {triplet_func_name}():"
    )
    sparse_signature = (
        f"def {sparse_func_name}({args}):" if args else f"def {sparse_func_name}():"
    )
    dense_signature = (
        f"def {dense_func_name}({args}):" if args else f"def {dense_func_name}():"
    )
    call_suffix = f"({args})" if args else "()"
    lines: list[str] = [entries_signature]

    if not sorted_entries:
        lines.append(f"{indent}return []")
    else:
        lines.append(f"{indent}return [")
        for (row, col), expr in sorted_entries:
            lines.append(f"{indent*2}({row}, {col}, {pycode(expr)}),")
        lines.append(f"{indent}]")

    lines.append("")
    lines.append(triplet_signature)
    lines.append(f"{indent}entries = {entries_func_name}{call_suffix}")
    lines.append(f"{indent}rows, cols, data = _matrix_triplets_from_entries(entries)")
    lines.append(f"{indent}return rows, cols, data, {shape_literal}")
    lines.append("")
    lines.append(sparse_signature)
    lines.append(f"{indent}matrix = sparse.csr_matrix({shape_literal}, dtype=float)")
    lines.append(f"{indent}entries = {entries_func_name}{call_suffix}")
    lines.append(f"{indent}if not entries:")
    lines.append(f"{indent*2}return matrix")
    lines.append(f"{indent}return _sparse_matrix_from_entries(entries, {shape_literal})")
    lines.append("")
    lines.append(dense_signature)
    lines.append(f"{indent}matrix = np.zeros({shape_literal}, dtype=float)")
    lines.append(f"{indent}entries = {entries_func_name}{call_suffix}")
    lines.append(f"{indent}if not entries:")
    lines.append(f"{indent*2}return matrix")
    lines.append(f"{indent}return _dense_matrix_from_entries(entries, {shape_literal})")
    return lines, param_names


def build_snippet(
    size: int, c_entries: MatrixEntries, l_inv_entries: MatrixEntries
) -> str:
    snippet_lines = [
        "import math",
        "import numpy as np",
        "from scipy import sparse",
        "",
        f"# Matrix size: {size} x {size}",
        "# Nonzero-entry helpers keep the representation sparse until you call",
        "# the dense wrappers below.",
        "",
    ]
    snippet_lines.extend(matrix_snippet_support_functions())
    snippet_lines.append("")

    c_func_lines, c_params = matrix_function_snippet(
        "C_matrix_entries",
        "C_matrix_triplets",
        "C_matrix_sparse",
        "C_matrix_func",
        size,
        c_entries,
    )
    l_func_lines, l_params = matrix_function_snippet(
        "L_inv_matrix_entries",
        "L_inv_matrix_triplets",
        "L_inv_matrix_sparse",
        "L_inv_matrix_func",
        size,
        l_inv_entries,
    )

    if c_params:
        snippet_lines.append(f"# C_matrix_func parameters: {', '.join(c_params)}")
    if l_params:
        snippet_lines.append(f"# L_inv_matrix_func parameters: {', '.join(l_params)}")
    if c_params or l_params:
        snippet_lines.append("")

    snippet_lines.extend(c_func_lines)
    snippet_lines.append("")
    snippet_lines.extend(l_func_lines)
    return "\n".join(snippet_lines)
