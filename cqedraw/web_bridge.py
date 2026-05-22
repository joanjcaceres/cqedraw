"""JSON-safe bridge used by the cQEDraw web app.

The bridge keeps the browser-facing contract small: project dictionaries come in,
the same core matrix/snippet logic used by the desktop app runs, and plain JSON
data comes back out.
"""

from __future__ import annotations

import json
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
    return {
        "size": size,
        "c_entries": _entry_records(c_entries),
        "l_inv_entries": _entry_records(l_inv_entries),
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
