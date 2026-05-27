import copy
from typing import Optional

import sympy as sp

from .core import GROUND_NODE_ID


def sum_optional_expressions(
    expressions: list[Optional[sp.Expr]],
) -> Optional[sp.Expr]:
    terms = [expr for expr in expressions if expr is not None]
    if not terms:
        return None

    total = sp.Integer(0)
    for expr in terms:
        total += expr
    total = sp.simplify(total)
    return None if total == 0 else total


def inverse_inductance_expr(
    inductance_expr: Optional[sp.Expr],
) -> Optional[sp.Expr]:
    if inductance_expr is None:
        return None
    return sp.simplify(sp.Integer(1) / inductance_expr)


def combine_ground_edges_in_snapshot(ground_edges: list[dict]) -> Optional[dict]:
    if not ground_edges:
        return None

    combined = copy.deepcopy(ground_edges[0])
    capacitance_expr = sum_optional_expressions(
        [edge.get("capacitance_expr") for edge in ground_edges]
    )
    l_inverse_expr = sum_optional_expressions(
        [
            edge.get("l_inverse_expr")
            or inverse_inductance_expr(edge.get("inductance_expr"))
            for edge in ground_edges
        ]
    )
    josephson_l_inverse_expr = sum_optional_expressions(
        [
            inverse_inductance_expr(edge.get("josephson_inductance_expr"))
            for edge in ground_edges
        ]
    )
    inductance_expr = (
        sp.simplify(sp.Integer(1) / l_inverse_expr)
        if l_inverse_expr is not None
        else None
    )
    josephson_inductance_expr = (
        sp.simplify(sp.Integer(1) / josephson_l_inverse_expr)
        if josephson_l_inverse_expr is not None
        else None
    )

    if (
        capacitance_expr is None
        and inductance_expr is None
        and josephson_inductance_expr is None
    ):
        return None

    combined["capacitance_expr"] = capacitance_expr
    combined["capacitance_text"] = None
    combined["inductance_expr"] = inductance_expr
    combined["inductance_text"] = None
    combined["l_inverse_expr"] = l_inverse_expr
    combined["josephson_inductance_expr"] = josephson_inductance_expr
    combined["josephson_inductance_text"] = None
    return combined


def merge_nodes_in_snapshot(
    snapshot: dict, survivor_id: int, selected_nodes: set[int]
) -> tuple[dict, dict[str, int]]:
    merged_snapshot = copy.deepcopy(snapshot)
    existing_node_ids = {
        node["identifier"] for node in merged_snapshot.get("nodes", [])
    }
    merged_node_ids = {
        node_id
        for node_id in selected_nodes
        if node_id in existing_node_ids and node_id != survivor_id
    }
    if survivor_id not in existing_node_ids or not merged_node_ids:
        return (
            merged_snapshot,
            {
                "merged_nodes": 0,
                "rewired_edges": 0,
                "removed_self_loops": 0,
                "combined_ground_edges": 0,
            },
        )

    merged_snapshot["nodes"] = [
        node
        for node in merged_snapshot.get("nodes", [])
        if node["identifier"] not in merged_node_ids
    ]

    rewired_edges = 0
    removed_self_loops = 0
    edges_out: list[dict] = []
    survivor_ground_edges: list[dict] = []

    for edge in merged_snapshot.get("edges", []):
        original_nodes = list(edge["nodes"])
        if edge.get("is_ground"):
            source_id = original_nodes[0]
            if source_id in merged_node_ids:
                edge["nodes"] = [survivor_id, GROUND_NODE_ID]
                rewired_edges += 1
            if edge["nodes"][0] == survivor_id:
                if source_id == survivor_id:
                    survivor_ground_edges.insert(0, edge)
                else:
                    survivor_ground_edges.append(edge)
            else:
                edges_out.append(edge)
            continue

        first = (
            survivor_id if original_nodes[0] in merged_node_ids else original_nodes[0]
        )
        second = (
            survivor_id if original_nodes[1] in merged_node_ids else original_nodes[1]
        )
        if [first, second] != original_nodes:
            rewired_edges += 1
        if first == second:
            removed_self_loops += 1
            continue
        edge["nodes"] = [first, second]
        edges_out.append(edge)

    combined_ground_edges = 0
    if survivor_ground_edges:
        if len(survivor_ground_edges) == 1:
            edges_out.append(survivor_ground_edges[0])
        else:
            combined_ground_edges = len(survivor_ground_edges) - 1
            combined_ground_edge = combine_ground_edges_in_snapshot(
                survivor_ground_edges
            )
            if combined_ground_edge is not None:
                edges_out.append(combined_ground_edge)

    merged_snapshot["edges"] = sorted(edges_out, key=lambda edge: edge["identifier"])
    merged_snapshot["selected_nodes"] = [survivor_id]
    merged_snapshot["focus_node"] = survivor_id
    merged_snapshot["selected_node"] = None
    return (
        merged_snapshot,
        {
            "merged_nodes": len(merged_node_ids),
            "rewired_edges": rewired_edges,
            "removed_self_loops": removed_self_loops,
            "combined_ground_edges": combined_ground_edges,
        },
    )
