"""JSON-safe bridge used by the cQEDraw web app.

The bridge keeps the browser-facing contract small: project dictionaries come in,
the same core matrix/snippet logic used by the desktop app runs, and plain JSON
data comes back out.
"""

from __future__ import annotations

import json
import math
from typing import Any, Optional

import sympy as sp

from .core import (
    GROUND_NODE_ID,
    CircuitEdgeData,
    MatrixEntries,
    build_snippet,
    compute_josephson_branches,
    compute_matrix_branches,
    compute_matrix_entries,
    josephson_parameter_names,
    matrix_parameter_names,
    matrix_node_records,
)

_CACHED_MODAL_PROJECT_JSON: str | None = None
_CACHED_MODAL_PROBLEM: dict[str, Any] | None = None


def _project_state(project: dict[str, Any]) -> dict[str, Any]:
    return project.get("state", project)


def _expression_text(edge: dict[str, Any], key: str) -> Optional[str]:
    text = edge.get(f"{key}_text")
    if text not in (None, ""):
        return str(text)

    expr = edge.get(f"{key}_expr")
    if expr in (None, ""):
        return None
    return str(expr)


def _parse_expr(text: Optional[str]) -> Optional[sp.Expr]:
    if text in (None, ""):
        return None
    return sp.sympify(text, evaluate=False)


def _phase_sign(value: Any) -> int:
    try:
        return -1 if int(value) == -1 else 1
    except (TypeError, ValueError):
        return 1


def _node_ids(state: dict[str, Any]) -> list[int]:
    return [int(node["identifier"]) for node in state.get("nodes", [])]


def _node_names(state: dict[str, Any]) -> dict[int, str]:
    return {
        int(node["identifier"]): str(node.get("name") or f"N{node['identifier']}")
        for node in state.get("nodes", [])
    }


def _edge_data(state: dict[str, Any]) -> list[CircuitEdgeData]:
    edges: list[CircuitEdgeData] = []
    for edge in state.get("edges", []):
        nodes = edge.get("nodes", [])
        if len(nodes) != 2:
            continue

        capacitance_expr = _parse_expr(_expression_text(edge, "capacitance"))
        inductance_expr = _parse_expr(_expression_text(edge, "inductance"))
        josephson_inductance_expr = _parse_expr(
            _expression_text(edge, "josephson_inductance")
        )
        l_inverse_expr = (
            sp.Integer(1) / inductance_expr
            if inductance_expr is not None
            else None
        )

        edges.append(
            CircuitEdgeData(
                nodes=(int(nodes[0]), int(nodes[1])),
                capacitance_expr=capacitance_expr,
                l_inverse_expr=l_inverse_expr,
                identifier=(
                    int(edge["identifier"])
                    if edge.get("identifier") is not None
                    else None
                ),
                josephson_inductance_expr=josephson_inductance_expr,
                josephson_phase_sign=_phase_sign(
                    edge.get("josephson_phase_sign", 1)
                ),
            )
        )
    return edges


def _entry_records(entries: MatrixEntries) -> list[dict[str, Any]]:
    return [
        {"row": row, "col": col, "expr": str(expr)}
        for (row, col), expr in sorted(entries.items())
    ]


def _josephson_branch_records(branches: list[Any]) -> list[dict[str, Any]]:
    return [
        {
            "edge_id": branch.edge_identifier,
            "project_nodes": list(branch.project_nodes),
            "matrix_nodes": list(branch.matrix_nodes),
            "phase_positive_index": branch.phase_positive_index,
            "phase_negative_index": branch.phase_negative_index,
            "phase_sign": branch.phase_sign,
            "inductance_expr": str(branch.inductance_expr),
        }
        for branch in branches
    ]


def _matrix_node_records(records: list[Any]) -> list[dict[str, Any]]:
    return [
        {
            "project_node_id": record.project_node_id,
            "matrix_index": record.matrix_index,
            "name": record.name,
        }
        for record in records
    ]


def _all_parameter_names(
    c_entries: MatrixEntries,
    l_inv_entries: MatrixEntries,
    josephson_branches: list[Any],
) -> list[str]:
    return sorted(
        set(matrix_parameter_names(c_entries))
        | set(matrix_parameter_names(l_inv_entries))
        | set(josephson_parameter_names(josephson_branches))
    )


def generate_output(project: dict[str, Any]) -> dict[str, Any]:
    state = _project_state(project)
    node_ids = _node_ids(state)
    matrix_nodes = matrix_node_records(node_ids, _node_names(state))
    edges = _edge_data(state)
    size, c_entries, l_inv_entries = compute_matrix_entries(
        node_ids, edges
    )
    snippet_size, c_branches, l_inv_branches = compute_matrix_branches(node_ids, edges)
    josephson_branches = compute_josephson_branches(node_ids, edges)
    parameter_names = _all_parameter_names(
        c_entries,
        l_inv_entries,
        josephson_branches,
    )
    return {
        "size": size,
        "c_entries": _entry_records(c_entries),
        "l_inv_entries": _entry_records(l_inv_entries),
        "parameters": parameter_names,
        "c_parameters": matrix_parameter_names(c_entries),
        "l_inv_parameters": matrix_parameter_names(l_inv_entries),
        "josephson_parameters": josephson_parameter_names(josephson_branches),
        "josephson_branches": _josephson_branch_records(josephson_branches),
        "matrix_nodes": _matrix_node_records(matrix_nodes),
        "snippet": build_snippet(
            snippet_size,
            c_branches,
            l_inv_branches,
            josephson_branches,
            matrix_nodes,
        ),
    }


def generate_output_json(project_json: str) -> str:
    try:
        project = json.loads(project_json)
        result = generate_output(project)
    except Exception as exc:
        result = {"error": str(exc)}
    return json.dumps(result)


def _numeric_parameter_values(
    raw_params: dict[str, Any],
    parameter_names: list[str],
) -> dict[str, float]:
    missing = [
        name
        for name in parameter_names
        if name not in raw_params or raw_params[name] in (None, "")
    ]
    if missing:
        raise ValueError("Missing parameter values: " + ", ".join(missing))

    values: dict[str, float] = {}
    for name in parameter_names:
        raw_value = raw_params[name]
        try:
            value = sp.N(sp.sympify(raw_value, evaluate=False))
            if value.free_symbols:
                raise ValueError
            values[name] = float(value)
        except Exception as exc:
            raise ValueError(f"Parameter {name} must be a finite number.") from exc
        if not math.isfinite(values[name]):
            raise ValueError(f"Parameter {name} must be a finite number.")
    return values


def _numeric_expr(expr: sp.Expr, params: dict[str, float]) -> float:
    substitutions = {sp.Symbol(name): value for name, value in params.items()}
    value = sp.N(expr.subs(substitutions))
    if value.free_symbols:
        missing = sorted(symbol.name for symbol in value.free_symbols)
        raise ValueError("Missing parameter values: " + ", ".join(missing))
    numeric_value = float(value)
    if not math.isfinite(numeric_value):
        raise ValueError("Matrix expressions must evaluate to finite numbers.")
    return numeric_value


def _dense_numeric_matrix(
    size: int,
    entries: MatrixEntries,
    params: dict[str, float],
) -> Any:
    import numpy as np

    matrix = np.zeros((size, size), dtype=float)
    for (row, col), expr in entries.items():
        matrix[row, col] = _numeric_expr(expr, params)
    return matrix


def _josephson_energy_ghz(josephson_inductance: float) -> float:
    if josephson_inductance <= 0:
        raise ValueError("Josephson inductance must be positive.")
    planck_constant = 6.62607015e-34
    elementary_charge = 1.602176634e-19
    reduced_flux_quantum = planck_constant / (4 * math.pi * elementary_charge)
    return reduced_flux_quantum**2 / (josephson_inductance * planck_constant * 1e9)


def _evaluated_josephson_branch_records(
    branches: list[Any],
    params: dict[str, float],
) -> list[dict[str, Any]]:
    records: list[dict[str, Any]] = []
    for index, record in enumerate(_josephson_branch_records(branches)):
        josephson_inductance = _numeric_expr(
            branches[index].inductance_expr,
            params,
        )
        record["L_j"] = josephson_inductance
        record["E_j_GHz"] = _josephson_energy_ghz(josephson_inductance)
        records.append(record)
    return records


def _float_list(values: Any) -> list[float]:
    return [float(value) for value in values]


def _float_rows(values: Any) -> list[list[float]]:
    return [[float(value) for value in row] for row in values]


def _phase_zpf_column_name(branch: dict[str, Any], index: int) -> str:
    edge_id = branch.get("edge_id")
    if edge_id is None:
        return f"phase_zpf_junction_{index}"
    return f"phase_zpf_edge_{edge_id}"


def _analysis_results_export(modal_analysis: Any) -> dict[str, Any]:
    if not isinstance(modal_analysis, dict) or not modal_analysis.get("available"):
        raise ValueError("Run Analyze modes before exporting analysis JSON.")

    frequencies = _float_list(modal_analysis.get("frequencies_ghz", []))
    zpf_rows_by_junction = _float_rows(modal_analysis.get("branch_phase_zpfs", []))
    zpf_columns: list[list[float]] = []
    columns = ["frequency_ghz"]
    units = {"frequency_ghz": "GHz"}
    junctions = []

    for index, branch in enumerate(modal_analysis.get("branches", [])):
        if not isinstance(branch, dict):
            continue
        column_name = _phase_zpf_column_name(branch, index)
        phase_zpf = (
            _float_list(branch["phase_zpf"])
            if "phase_zpf" in branch
            else zpf_rows_by_junction[index]
        )
        if len(phase_zpf) != len(frequencies):
            raise ValueError(
                "Analysis result shape mismatch: every junction ZPF row must "
                "match the number of mode frequencies."
            )

        columns.append(column_name)
        units[column_name] = "dimensionless"
        zpf_columns.append(phase_zpf)
        junctions.append(
            {
                "column": column_name,
                "edge_id": branch.get("edge_id"),
                "project_nodes": list(branch.get("project_nodes", [])),
                "phase_nodes": list(branch.get("phase_nodes", [])),
                "phase_sign": int(branch.get("phase_sign", 1)),
            }
        )

    rows = [
        [frequency, *[zpf_column[mode_index] for zpf_column in zpf_columns]]
        for mode_index, frequency in enumerate(frequencies)
    ]

    result: dict[str, Any] = {
        "format": "cqedraw.analysis_table",
        "schema_version": 1,
        "columns": columns,
        "units": units,
        "rows": rows,
        "junctions": junctions,
    }

    return result


def export_analysis_results(
    project: dict[str, Any],
    raw_params: dict[str, Any],
    modal_analysis: Optional[dict[str, Any]] = None,
) -> dict[str, Any]:
    state = _project_state(project)
    node_ids = _node_ids(state)
    edges = _edge_data(state)
    _size, c_entries, l_inv_entries = compute_matrix_entries(node_ids, edges)
    josephson_branches = compute_josephson_branches(node_ids, edges)
    parameter_names = _all_parameter_names(
        c_entries,
        l_inv_entries,
        josephson_branches,
    )
    _numeric_parameter_values(raw_params, parameter_names)
    return _analysis_results_export(modal_analysis)


def export_analysis_results_json(
    project_json: str,
    params_json: str,
    modal_analysis_json: str = "null",
) -> str:
    try:
        project = json.loads(project_json)
        params = json.loads(params_json)
        modal_analysis = json.loads(modal_analysis_json)
        result = export_analysis_results(project, params, modal_analysis)
    except Exception as exc:
        result = {"error": str(exc)}
    return json.dumps(result)


def _bbq_with_optional_junctions(
    bbq_class: Any,
    capacitance_matrix: Any,
    inverse_inductance_matrix: Any,
    junction_records: list[dict[str, Any]],
) -> Any:
    try:
        return bbq_class(
            capacitance_matrix,
            inverse_inductance_matrix,
            junctions=junction_records,
        )
    except ValueError as exc:
        if junction_records or "junctions must contain at least one" not in str(exc):
            raise

    # Older sccircuits.BBQ versions require at least one branch even when the
    # caller only needs normal-mode frequencies. A single valid dummy branch
    # leaves the generalized eigenproblem unchanged; cQEDraw ignores its ZPF row.
    return bbq_class(
        capacitance_matrix,
        inverse_inductance_matrix,
        nonlinear_branches=(0,),
    )


def _sccircuits_unavailable_result(exc: Exception) -> dict[str, Any]:
    return {
        "available": False,
        "error": (
            "sccircuits is not available in this Python environment. "
            "Install cQEDraw with the sccircuits extra or run the copied "
            "snippet in an environment with sccircuits installed."
        ),
        "details": str(exc),
    }


def _modal_problem(project: dict[str, Any]) -> dict[str, Any]:
    state = _project_state(project)
    node_ids = _node_ids(state)
    edges = _edge_data(state)
    size, c_entries, l_inv_entries = compute_matrix_entries(node_ids, edges)
    josephson_branches = compute_josephson_branches(node_ids, edges)
    if size == 0:
        raise ValueError("Draw at least one node before running BBQ analysis.")

    parameter_names = _all_parameter_names(
        c_entries,
        l_inv_entries,
        josephson_branches,
    )
    return {
        "size": size,
        "c_entries": c_entries,
        "l_inv_entries": l_inv_entries,
        "josephson_branches": josephson_branches,
        "parameter_names": parameter_names,
    }


def _cached_modal_problem(project_json: str) -> dict[str, Any]:
    global _CACHED_MODAL_PROBLEM, _CACHED_MODAL_PROJECT_JSON

    if (
        _CACHED_MODAL_PROJECT_JSON == project_json
        and _CACHED_MODAL_PROBLEM is not None
    ):
        return _CACHED_MODAL_PROBLEM

    project = json.loads(project_json)
    problem = _modal_problem(project)
    _CACHED_MODAL_PROJECT_JSON = project_json
    _CACHED_MODAL_PROBLEM = problem
    return problem


def _analyze_modal_problem(
    problem: dict[str, Any],
    raw_params: dict[str, Any],
    bbq_class: Any,
) -> dict[str, Any]:
    size = int(problem["size"])
    c_entries = problem["c_entries"]
    l_inv_entries = problem["l_inv_entries"]
    josephson_branches = problem["josephson_branches"]
    parameter_names = problem["parameter_names"]

    params = _numeric_parameter_values(raw_params, parameter_names)
    capacitance_matrix = _dense_numeric_matrix(size, c_entries, params)
    inverse_inductance_matrix = _dense_numeric_matrix(size, l_inv_entries, params)
    junction_records = _evaluated_josephson_branch_records(josephson_branches, params)

    bbq = _bbq_with_optional_junctions(
        bbq_class,
        capacitance_matrix,
        inverse_inductance_matrix,
        junction_records,
    )
    if junction_records:
        branch_phase_zpfs = _float_rows(bbq.branch_phase_zpfs)
        josephson_energies = getattr(bbq, "josephson_energies_ghz", None)
        branch_phase_nodes = getattr(bbq, "branch_phase_nodes", None)
        if branch_phase_nodes is None:
            branch_phase_nodes = [
                (
                    branch["phase_positive_index"],
                    branch["phase_negative_index"],
                )
                for branch in junction_records
            ]
    else:
        branch_phase_zpfs = []
        josephson_energies = None
        branch_phase_nodes = []

    modal_branches = []
    for index, branch in enumerate(junction_records):
        modal_branches.append(
            {
                **branch,
                "phase_nodes": list(branch_phase_nodes[index]),
                "phase_zpf": branch_phase_zpfs[index],
            }
        )

    return {
        "available": True,
        "frequencies_ghz": _float_list(bbq.frequencies_ghz),
        "branch_phase_zpfs": branch_phase_zpfs,
        "josephson_energies_ghz": (
            None if josephson_energies is None else _float_list(josephson_energies)
        ),
        "branches": modal_branches,
    }


def analyze_modal(
    project: dict[str, Any],
    raw_params: dict[str, Any],
) -> dict[str, Any]:
    try:
        from sccircuits import BBQ
    except Exception as exc:
        return _sccircuits_unavailable_result(exc)

    return _analyze_modal_problem(_modal_problem(project), raw_params, BBQ)


def analyze_modal_cached_json(project_json: str, params_json: str) -> str:
    try:
        try:
            from sccircuits import BBQ
        except Exception as exc:
            result = _sccircuits_unavailable_result(exc)
        else:
            params = json.loads(params_json)
            result = _analyze_modal_problem(
                _cached_modal_problem(project_json),
                params,
                BBQ,
            )
    except Exception as exc:
        result = {"available": False, "error": str(exc)}
    return json.dumps(result)


def analyze_modal_json(project_json: str, params_json: str) -> str:
    try:
        project = json.loads(project_json)
        params = json.loads(params_json)
        result = analyze_modal(project, params)
    except Exception as exc:
        result = {"available": False, "error": str(exc)}
    return json.dumps(result)


def normalize_project(project: dict[str, Any]) -> dict[str, Any]:
    state = _project_state(project)
    normalized_nodes: list[dict[str, Any]] = []
    for node in state.get("nodes", []):
        normalized_nodes.append(
            {
                "identifier": int(node["identifier"]),
                "name": str(node.get("name") or f"N{node['identifier']}"),
                "x": float(node.get("x", 0)),
                "y": float(node.get("y", 0)),
            }
        )

    normalized_edges: list[dict[str, Any]] = []
    for edge in state.get("edges", []):
        nodes = edge.get("nodes", [])
        if len(nodes) != 2:
            continue
        cap_text = _expression_text(edge, "capacitance")
        ind_text = _expression_text(edge, "inductance")
        josephson_ind_text = _expression_text(edge, "josephson_inductance")
        normalized_edges.append(
            {
                "identifier": int(edge["identifier"]),
                "nodes": [int(nodes[0]), int(nodes[1])],
                "capacitance_expr": cap_text,
                "capacitance_text": cap_text,
                "inductance_expr": ind_text,
                "inductance_text": ind_text,
                "l_inverse_expr": None,
                "josephson_inductance_expr": josephson_ind_text,
                "josephson_inductance_text": josephson_ind_text,
                "josephson_phase_sign": _phase_sign(
                    edge.get("josephson_phase_sign", 1)
                ),
                "is_ground": bool(edge.get("is_ground", nodes[1] == GROUND_NODE_ID)),
                "ground_offset_x": float(edge.get("ground_offset_x", 0.0)),
                "ground_offset_y": float(edge.get("ground_offset_y", 104.0)),
            }
        )

    return {
        "version": max(2, int(project.get("version", 2))),
        "state": {
            "node_counter": int(
                state.get(
                    "node_counter",
                    max((node["identifier"] for node in normalized_nodes), default=-1)
                    + 1,
                )
            ),
            "edge_counter": int(
                state.get(
                    "edge_counter",
                    max((edge["identifier"] for edge in normalized_edges), default=-1)
                    + 1,
                )
            ),
            "view_scale": float(state.get("view_scale", 1.0)),
            "nodes": normalized_nodes,
            "edges": normalized_edges,
            "selected_nodes": [],
            "focus_node": None,
            "selected_node": None,
            "mode": None,
        },
    }


def normalize_project_json(project_json: str) -> str:
    try:
        project = json.loads(project_json)
        result = normalize_project(project)
    except Exception as exc:
        result = {"error": str(exc)}
    return json.dumps(result)
