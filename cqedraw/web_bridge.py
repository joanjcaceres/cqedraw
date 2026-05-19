"""JSON-safe bridge used by the cQEDraw web app.

The bridge keeps the browser-facing contract small: project dictionaries come in,
the same core matrix/snippet logic used by the desktop app runs, and plain JSON
data comes back out.
"""

from __future__ import annotations

import json
from typing import Any, Iterable, Optional

import sympy as sp

from .core import (
    GROUND_NODE_ID,
    CircuitEdgeData,
    MatrixEntries,
    build_snippet,
    compute_matrix_entries,
    matrix_function_snippet,
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


def _node_ids(state: dict[str, Any]) -> list[int]:
    return [int(node["identifier"]) for node in state.get("nodes", [])]


def _edge_data(state: dict[str, Any]) -> list[CircuitEdgeData]:
    edges: list[CircuitEdgeData] = []
    for edge in state.get("edges", []):
        nodes = edge.get("nodes", [])
        if len(nodes) != 2:
            continue

        capacitance_expr = _parse_expr(_expression_text(edge, "capacitance"))
        inductance_expr = _parse_expr(_expression_text(edge, "inductance"))
        l_inverse_expr = (
            sp.simplify(sp.Integer(1) / inductance_expr)
            if inductance_expr is not None
            else None
        )

        edges.append(
            CircuitEdgeData(
                nodes=(int(nodes[0]), int(nodes[1])),
                capacitance_expr=capacitance_expr,
                l_inverse_expr=l_inverse_expr,
            )
        )
    return edges


def _entry_records(entries: MatrixEntries) -> list[dict[str, Any]]:
    return [
        {"row": row, "col": col, "expr": str(expr)}
        for (row, col), expr in sorted(entries.items())
    ]


def _parameter_names(size: int, entries: MatrixEntries, prefix: str) -> list[str]:
    _, params = matrix_function_snippet(
        f"{prefix}_entries",
        f"{prefix}_triplets",
        f"{prefix}_sparse",
        f"{prefix}_func",
        size,
        entries,
    )
    return params


def generate_output(project: dict[str, Any]) -> dict[str, Any]:
    state = _project_state(project)
    size, c_entries, l_inv_entries = compute_matrix_entries(
        _node_ids(state), _edge_data(state)
    )
    return {
        "size": size,
        "c_entries": _entry_records(c_entries),
        "l_inv_entries": _entry_records(l_inv_entries),
        "c_parameters": _parameter_names(size, c_entries, "C_matrix"),
        "l_inv_parameters": _parameter_names(size, l_inv_entries, "L_inv_matrix"),
        "snippet": build_snippet(size, c_entries, l_inv_entries),
    }


def generate_output_json(project_json: str) -> str:
    try:
        project = json.loads(project_json)
        result = generate_output(project)
    except Exception as exc:  # type: ignore[catching-non-exception]
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
        normalized_edges.append(
            {
                "identifier": int(edge["identifier"]),
                "nodes": [int(nodes[0]), int(nodes[1])],
                "capacitance_expr": cap_text,
                "capacitance_text": cap_text,
                "inductance_expr": ind_text,
                "inductance_text": ind_text,
                "l_inverse_expr": None,
                "is_ground": bool(edge.get("is_ground", nodes[1] == GROUND_NODE_ID)),
                "ground_offset_x": float(edge.get("ground_offset_x", 0.0)),
                "ground_offset_y": float(edge.get("ground_offset_y", 104.0)),
            }
        )

    return {
        "version": int(project.get("version", 1)),
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
    except Exception as exc:  # type: ignore[catching-non-exception]
        result = {"error": str(exc)}
    return json.dumps(result)
