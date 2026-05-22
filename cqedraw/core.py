"""Pure output-generation logic for cQEDraw."""

from __future__ import annotations

import json
from dataclasses import dataclass
from typing import Dict, Iterable, Mapping, Optional, Tuple

import sympy as sp
from sympy.printing.pycode import PythonCodePrinter


GROUND_NODE_ID = -1
MatrixEntries = Dict[Tuple[int, int], sp.Expr]
BranchKey = Tuple[int, Optional[int]]
MatrixBranches = list[Tuple[int, Optional[int], sp.Expr]]
ProjectNodes = Tuple[int, int]
MatrixNodes = Tuple[int, Optional[int]]
MatrixNodeRecords = list["MatrixNodeData"]


@dataclass(frozen=True)
class CircuitEdgeData:
    nodes: Tuple[int, int]
    capacitance_expr: Optional[sp.Expr]
    l_inverse_expr: Optional[sp.Expr]
    identifier: Optional[int] = None
    josephson_inductance_expr: Optional[sp.Expr] = None
    josephson_phase_sign: int = 1


@dataclass(frozen=True)
class JosephsonBranchData:
    edge_identifier: Optional[int]
    project_nodes: ProjectNodes
    matrix_nodes: MatrixNodes
    phase_positive_index: Optional[int]
    phase_negative_index: Optional[int]
    phase_sign: int
    inductance_expr: sp.Expr


@dataclass(frozen=True)
class MatrixNodeData:
    project_node_id: int
    matrix_index: int
    name: Optional[str] = None


JosephsonBranches = list[JosephsonBranchData]


def matrix_node_records(
    node_ids: Iterable[int], node_names: Optional[Mapping[int, str]] = None
) -> MatrixNodeRecords:
    names = node_names or {}
    return [
        MatrixNodeData(
            project_node_id=node_id,
            matrix_index=index,
            name=names.get(node_id),
        )
        for index, node_id in enumerate(sorted(node_ids))
    ]


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


def accumulate_matrix_branch(
    branches: Dict[BranchKey, sp.Expr], first: int, second: Optional[int], value: sp.Expr
) -> None:
    key = (first, second) if second is None or first <= second else (second, first)
    existing = branches.get(key)
    branches[key] = value if existing is None else existing + value


def finalize_matrix_branches(branches: Dict[BranchKey, sp.Expr]) -> MatrixBranches:
    finalized: MatrixBranches = []
    def sort_key(item: Tuple[BranchKey, sp.Expr]) -> Tuple[int, int]:
        first, second = item[0]
        return first, -1 if second is None else second

    for (first, second), value in sorted(branches.items(), key=sort_key):
        simplified = sp.simplify(value)
        if simplified != 0:
            finalized.append((first, second, simplified))
    return finalized


def edge_l_inverse_expr(edge: CircuitEdgeData) -> Optional[sp.Expr]:
    terms: list[sp.Expr] = []
    if edge.l_inverse_expr is not None:
        terms.append(edge.l_inverse_expr)
    if edge.josephson_inductance_expr is not None:
        terms.append(sp.Integer(1) / edge.josephson_inductance_expr)
    if not terms:
        return None
    return sp.simplify(sum(terms, sp.Integer(0)))


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
            l_inverse_expr = edge_l_inverse_expr(edge)
            if l_inverse_expr is not None:
                accumulate_matrix_entry(l_inv_entries, i, i, l_inverse_expr)
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
        l_inverse_expr = edge_l_inverse_expr(edge)
        if l_inverse_expr is not None:
            value = l_inverse_expr
            accumulate_matrix_entry(l_inv_entries, i, i, value)
            accumulate_matrix_entry(l_inv_entries, j, j, value)
            accumulate_matrix_entry(l_inv_entries, i, j, -value)
            accumulate_matrix_entry(l_inv_entries, j, i, -value)
    return (
        size,
        finalize_matrix_entries(c_entries),
        finalize_matrix_entries(l_inv_entries),
    )


def compute_matrix_branches(
    node_ids: Iterable[int], edges: Iterable[CircuitEdgeData]
) -> Tuple[int, MatrixBranches, MatrixBranches]:
    sorted_node_ids = sorted(node_ids)
    index_map = {node_id: idx for idx, node_id in enumerate(sorted_node_ids)}
    size = len(sorted_node_ids)
    c_branches: Dict[BranchKey, sp.Expr] = {}
    l_inv_branches: Dict[BranchKey, sp.Expr] = {}
    for edge in edges:
        first_node, second_node = edge.nodes
        if first_node not in index_map:
            continue
        i = index_map[first_node]

        if second_node == GROUND_NODE_ID:
            j: Optional[int] = None
        else:
            if second_node not in index_map:
                continue
            j = index_map[second_node]

        if edge.capacitance_expr is not None:
            accumulate_matrix_branch(c_branches, i, j, edge.capacitance_expr)
        l_inverse_expr = edge_l_inverse_expr(edge)
        if l_inverse_expr is not None:
            accumulate_matrix_branch(l_inv_branches, i, j, l_inverse_expr)

    return (
        size,
        finalize_matrix_branches(c_branches),
        finalize_matrix_branches(l_inv_branches),
    )


def compute_josephson_branches(
    node_ids: Iterable[int], edges: Iterable[CircuitEdgeData]
) -> JosephsonBranches:
    sorted_node_ids = sorted(node_ids)
    index_map = {node_id: idx for idx, node_id in enumerate(sorted_node_ids)}
    branches: JosephsonBranches = []
    for edge in edges:
        if edge.josephson_inductance_expr is None:
            continue

        first_node, second_node = edge.nodes
        if first_node not in index_map:
            continue
        first_index = index_map[first_node]

        if second_node == GROUND_NODE_ID:
            second_index: Optional[int] = None
        else:
            if second_node not in index_map:
                continue
            second_index = index_map[second_node]

        phase_sign = -1 if edge.josephson_phase_sign == -1 else 1
        if second_index is None:
            if phase_sign == 1:
                phase_positive_index: Optional[int] = first_index
                phase_negative_index: Optional[int] = None
            else:
                phase_positive_index = None
                phase_negative_index = first_index
        elif phase_sign == 1:
            phase_positive_index = second_index
            phase_negative_index = first_index
        else:
            phase_positive_index = first_index
            phase_negative_index = second_index

        branches.append(
            JosephsonBranchData(
                edge_identifier=edge.identifier,
                project_nodes=(first_node, second_node),
                matrix_nodes=(first_index, second_index),
                phase_positive_index=phase_positive_index,
                phase_negative_index=phase_negative_index,
                phase_sign=phase_sign,
                inductance_expr=edge.josephson_inductance_expr,
            )
        )
    return branches


def compute_matrices(
    node_ids: Iterable[int], edges: Iterable[CircuitEdgeData]
) -> Tuple[sp.Matrix, sp.Matrix]:
    size, c_entries, l_inv_entries = compute_matrix_entries(node_ids, edges)
    return (
        sp.SparseMatrix(size, size, c_entries),
        sp.SparseMatrix(size, size, l_inv_entries),
    )


class _ParamMappingCodePrinter(PythonCodePrinter):
    def _print_Symbol(self, expr: sp.Symbol) -> str:
        return f"params[{json.dumps(expr.name)}]"


_PARAM_MAPPING_CODE_PRINTER = _ParamMappingCodePrinter()


def matrix_parameter_names(entries: MatrixEntries) -> list[str]:
    sorted_entries = sorted(entries.items())
    symbols = sorted(
        {symbol for _, expr in sorted_entries for symbol in expr.free_symbols},
        key=lambda sym: sym.name,
    )
    return [symbol.name for symbol in symbols]


def matrix_branch_parameter_names(branches: MatrixBranches) -> list[str]:
    symbols = sorted(
        {symbol for _, _, expr in branches for symbol in expr.free_symbols},
        key=lambda sym: sym.name,
    )
    return [symbol.name for symbol in symbols]


def josephson_parameter_names(branches: JosephsonBranches) -> list[str]:
    symbols = sorted(
        {symbol for branch in branches for symbol in branch.inductance_expr.free_symbols},
        key=lambda sym: sym.name,
    )
    return [symbol.name for symbol in symbols]


def _tuple_literal(values: Iterable[str]) -> str:
    items = tuple(values)
    if not items:
        return "()"

    one_line = "(" + ", ".join(json.dumps(item) for item in items)
    one_line += "," if len(items) == 1 else ""
    one_line += ")"
    if len(one_line) <= 88:
        return one_line

    lines = ["("]
    lines.extend(f"    {json.dumps(item)}," for item in items)
    lines.append(")")
    return "\n".join(lines)


def _param_expr_code(expr: sp.Expr) -> str:
    return _PARAM_MAPPING_CODE_PRINTER.doprint(expr)


def _branch_pairs_literal(branches: list[Tuple[int, Optional[int]]], level: int) -> list[str]:
    indent = " " * 4
    lines = [f"{indent*level}["]
    for first, second in branches:
        lines.append(f"{indent*(level + 1)}({first}, {second}),")
    lines.append(f"{indent*level}]")
    return lines


def _matrix_branch_groups_literal(branches: MatrixBranches) -> list[str]:
    indent = " " * 4
    if not branches:
        return [f"{indent}return _branch_matrix([])"]

    grouped: dict[str, list[Tuple[int, Optional[int]]]] = {}
    for first, second, expr in branches:
        grouped.setdefault(_param_expr_code(expr), []).append((first, second))

    lines = [f"{indent}return _branch_matrix(["]
    for expr_code, branch_pairs in sorted(grouped.items()):
        if len(branch_pairs) == 1:
            first, second = branch_pairs[0]
            lines.append(f"{indent*2}({expr_code}, [({first}, {second})]),")
            continue
        lines.append(f"{indent*2}(")
        lines.append(f"{indent*3}{expr_code},")
        lines.extend(_branch_pairs_literal(branch_pairs, 3))
        lines.append(f"{indent*2}),")
    lines.append(f"{indent}])")
    return lines


def _python_tuple_literal(values: tuple[object, ...]) -> str:
    if len(values) == 1:
        return f"({values[0]!r},)"
    return repr(values)


def _josephson_branches_literal(branches: JosephsonBranches) -> list[str]:
    if not branches:
        return ["JOSEPHSON_BRANCHES = ()"]

    indent = " " * 4
    lines = ["JOSEPHSON_BRANCHES = ("]
    for branch in branches:
        lines.append(f"{indent}{{")
        lines.append(f"{indent*2}\"edge_id\": {branch.edge_identifier!r},")
        lines.append(
            f"{indent*2}\"project_nodes\": "
            f"{_python_tuple_literal(branch.project_nodes)},"
        )
        lines.append(
            f"{indent*2}\"matrix_nodes\": "
            f"{_python_tuple_literal(branch.matrix_nodes)},"
        )
        lines.append(
            f"{indent*2}\"phase_positive_index\": "
            f"{branch.phase_positive_index!r},"
        )
        lines.append(
            f"{indent*2}\"phase_negative_index\": "
            f"{branch.phase_negative_index!r},"
        )
        lines.append(f"{indent*2}\"phase_sign\": {branch.phase_sign!r},")
        lines.append(
            f"{indent*2}\"inductance_expr\": "
            f"{json.dumps(str(branch.inductance_expr))},"
        )
        lines.append(f"{indent}}},")
    lines.append(")")
    return lines


def _matrix_nodes_literal(records: MatrixNodeRecords) -> list[str]:
    if not records:
        return [
            "MATRIX_NODES = ()",
            "NODE_INDEX_MAP = {}",
            "NODE_NAME_MAP = {}",
        ]

    indent = " " * 4
    lines = ["MATRIX_NODES = ("]
    for record in records:
        lines.append(f"{indent}{{")
        lines.append(f"{indent*2}\"project_node_id\": {record.project_node_id!r},")
        lines.append(f"{indent*2}\"matrix_index\": {record.matrix_index!r},")
        lines.append(f"{indent*2}\"name\": {json.dumps(record.name)},")
        lines.append(f"{indent}}},")
    lines.extend(
        [
            ")",
            (
                "NODE_INDEX_MAP = "
                "{node[\"project_node_id\"]: node[\"matrix_index\"] for node in MATRIX_NODES}"
            ),
            (
                "NODE_NAME_MAP = "
                "{node[\"project_node_id\"]: node[\"name\"] for node in MATRIX_NODES}"
            ),
        ]
    )
    return lines


def _josephson_branch_records_literal(branches: JosephsonBranches) -> list[str]:
    indent = " " * 4
    if not branches:
        return [f"{indent}return []"]

    lines = [
        f"{indent}_validate_params(params, JOSEPHSON_PARAMETER_NAMES)",
        f"{indent}branches = []",
    ]
    for index, branch in enumerate(branches):
        lines.append(f"{indent}L_j = {_param_expr_code(branch.inductance_expr)}")
        lines.append(f"{indent}branches.append({{")
        lines.append(f"{indent*2}**JOSEPHSON_BRANCHES[{index}],")
        lines.append(f"{indent*2}\"L_j\": L_j,")
        lines.append(f"{indent*2}\"E_j_GHz\": _josephson_energy_GHz(L_j),")
        lines.append(f"{indent}}})")
    lines.append(f"{indent}return branches")
    return lines


def build_snippet(
    size: int,
    c_branches: MatrixBranches,
    l_inv_branches: MatrixBranches,
    josephson_branches: Optional[JosephsonBranches] = None,
    matrix_nodes: Optional[MatrixNodeRecords] = None,
) -> str:
    if josephson_branches is None:
        josephson_branches = []
    if matrix_nodes is None:
        matrix_nodes = []
    c_params = matrix_branch_parameter_names(c_branches)
    l_params = matrix_branch_parameter_names(l_inv_branches)
    josephson_params = josephson_parameter_names(josephson_branches)
    all_params = sorted(set(c_params) | set(l_params) | set(josephson_params))
    indent = " " * 4
    snippet_lines = [
        "import math",
        "from scipy import sparse",
        "",
        f"MATRIX_SHAPE = ({size}, {size})",
        f"PARAMETER_NAMES = {_tuple_literal(all_params)}",
        f"C_PARAMETER_NAMES = {_tuple_literal(c_params)}",
        f"L_INV_PARAMETER_NAMES = {_tuple_literal(l_params)}",
        f"JOSEPHSON_PARAMETER_NAMES = {_tuple_literal(josephson_params)}",
        "PLANCK_CONSTANT = 6.62607015e-34",
        "ELEMENTARY_CHARGE = 1.602176634e-19",
        "REDUCED_FLUX_QUANTUM = PLANCK_CONSTANT / (4 * math.pi * ELEMENTARY_CHARGE)",
    ]
    snippet_lines.extend(_matrix_nodes_literal(matrix_nodes))
    snippet_lines.extend(_josephson_branches_literal(josephson_branches))
    snippet_lines.extend(
        [
            "",
            "def _josephson_energy_GHz(L_j):",
            f"{indent}if L_j <= 0:",
            f"{indent*2}raise ValueError(\"Josephson inductance must be positive.\")",
            f"{indent}return REDUCED_FLUX_QUANTUM**2 / (L_j * PLANCK_CONSTANT * 1e9)",
            "",
            "def josephson_branches(params):",
        ]
    )
    snippet_lines.extend(_josephson_branch_records_literal(josephson_branches))
    snippet_lines.extend([
        "",
        "def _validate_params(params, parameter_names):",
        f"{indent}missing = [name for name in parameter_names if name not in params]",
        f"{indent}if missing:",
        f"{indent*2}raise KeyError(",
        f"{indent*3}\"Missing parameter values: \" + \", \".join(missing)",
        f"{indent*2})",
        "",
        "def _branch_matrix(branch_groups):",
        f"{indent}if not branch_groups:",
        f"{indent*2}return sparse.csr_matrix(MATRIX_SHAPE, dtype=float)",
        f"{indent}rows = []",
        f"{indent}cols = []",
        f"{indent}data = []",
        f"{indent}for value, branches in branch_groups:",
        f"{indent*2}for first, second in branches:",
        f"{indent*3}rows.append(first)",
        f"{indent*3}cols.append(first)",
        f"{indent*3}data.append(value)",
        f"{indent*3}if second is not None:",
        f"{indent*4}rows.extend((second, first, second))",
        f"{indent*4}cols.extend((second, second, first))",
        f"{indent*4}data.extend((value, -value, -value))",
        f"{indent}matrix = sparse.coo_matrix(",
        f"{indent*2}(data, (rows, cols)),",
        f"{indent*2}shape=MATRIX_SHAPE,",
        f"{indent*2}dtype=float,",
        f"{indent}).tocsr()",
        f"{indent}matrix.eliminate_zeros()",
        f"{indent}return matrix",
        "",
        "def _C_matrix_unchecked(params):",
    ])
    snippet_lines.extend(_matrix_branch_groups_literal(c_branches))
    snippet_lines.append("")
    snippet_lines.append("def _L_inv_matrix_unchecked(params):")
    snippet_lines.extend(_matrix_branch_groups_literal(l_inv_branches))
    snippet_lines.append("")
    snippet_lines.extend(
        [
            "def C_matrix(params):",
            f"{indent}_validate_params(params, C_PARAMETER_NAMES)",
            f"{indent}return _C_matrix_unchecked(params)",
            "",
            "def L_inv_matrix(params):",
            f"{indent}_validate_params(params, L_INV_PARAMETER_NAMES)",
            f"{indent}return _L_inv_matrix_unchecked(params)",
            "",
            "def circuit_matrices(params):",
            f"{indent}_validate_params(params, PARAMETER_NAMES)",
            f"{indent}return _C_matrix_unchecked(params), _L_inv_matrix_unchecked(params)",
        ]
    )
    return "\n".join(snippet_lines)
