import copy
import json
from pathlib import Path
from typing import Any, Optional

import sympy as sp

from .desktop_models import EdgeParameters


def snapshot_state(app: Any) -> dict:
    nodes_snapshot = [
        {
            "identifier": node_id,
            "name": node.name,
            "x": node.x,
            "y": node.y,
        }
        for node_id, node in sorted(app.nodes.items())
    ]
    edges_snapshot = [
        {
            "identifier": edge_id,
            "nodes": list(edge.nodes),
            "capacitance_expr": edge.capacitance_expr,
            "capacitance_text": edge.capacitance_text,
            "inductance_expr": edge.inductance_expr,
            "inductance_text": edge.inductance_text,
            "l_inverse_expr": edge.l_inverse_expr,
            "josephson_inductance_expr": edge.josephson_inductance_expr,
            "josephson_inductance_text": edge.josephson_inductance_text,
            "josephson_phase_sign": edge.josephson_phase_sign,
            "is_ground": edge.is_ground,
            "ground_offset_x": edge.ground_offset_x,
            "ground_offset_y": edge.ground_offset_y,
        }
        for edge_id, edge in sorted(app.edges.items())
    ]
    return {
        "node_counter": app.node_counter,
        "edge_counter": app.edge_counter,
        "view_scale": app.view_scale,
        "nodes": nodes_snapshot,
        "edges": edges_snapshot,
        "selected_nodes": sorted(app.selected_nodes),
        "focus_node": app.focus_node,
        "selected_node": app.selected_node,
        "mode": app.mode,
    }


def project_content_snapshot(app: Any, snapshot: Optional[dict] = None) -> dict:
    if snapshot is None:
        snapshot = app._snapshot_state()
    return {
        "nodes": copy.deepcopy(snapshot.get("nodes", [])),
        "edges": copy.deepcopy(snapshot.get("edges", [])),
    }


def mark_project_clean(app: Any) -> None:
    app._clean_project_snapshot = app._project_content_snapshot()
    app._project_dirty = False


def update_dirty_state(app: Any, snapshot: Optional[dict] = None) -> None:
    current = app._project_content_snapshot(snapshot)
    clean = getattr(app, "_clean_project_snapshot", None)
    if clean is None:
        app._project_dirty = bool(current["nodes"] or current["edges"])
        return
    app._project_dirty = current != clean


def has_unsaved_changes(app: Any) -> bool:
    app._update_dirty_state()
    return app._project_dirty


def restore_state(app: Any, snapshot: dict) -> None:
    app._history_suspended = True
    try:
        app.canvas.delete("all")
        app.nodes.clear()
        app.edges.clear()
        app.node_counter = 0
        app.edge_counter = 0
        app.view_scale = snapshot.get("view_scale", 1.0)
        app.mode = snapshot.get("mode")
        app.selected_node = snapshot.get("selected_node")
        app.dragging_node = None
        app.dragging_ground_edge = None
        app._node_drag_moved = False
        app._ground_drag_moved = False

        for node_data in snapshot.get("nodes", []):
            app._add_node(
                node_data["x"],
                node_data["y"],
                node_data["name"],
                silent=True,
                forced_id=node_data["identifier"],
            )

        app.node_counter = snapshot.get("node_counter", app.node_counter)

        for edge_data in snapshot.get("edges", []):
            params = EdgeParameters(
                capacitance_expr=edge_data["capacitance_expr"],
                capacitance_text=edge_data["capacitance_text"],
                inductance_expr=edge_data["inductance_expr"],
                inductance_text=edge_data["inductance_text"],
                josephson_inductance_expr=edge_data.get(
                    "josephson_inductance_expr"
                ),
                josephson_inductance_text=edge_data.get(
                    "josephson_inductance_text"
                ),
                josephson_phase_sign=(
                    -1 if edge_data.get("josephson_phase_sign", 1) == -1 else 1
                ),
            )
            if edge_data.get("is_ground"):
                app._instantiate_ground_edge(
                    edge_data["nodes"][0],
                    params,
                    offset_x=edge_data.get("ground_offset_x", 0.0),
                    offset_y=edge_data.get(
                        "ground_offset_y", app.GROUND_LINE_LENGTH
                    ),
                    forced_id=edge_data["identifier"],
                )
            else:
                app._instantiate_edge(
                    edge_data["nodes"][0],
                    edge_data["nodes"][1],
                    params,
                    forced_id=edge_data["identifier"],
                )

        app.edge_counter = snapshot.get("edge_counter", app.edge_counter)
        app.selected_nodes = set(snapshot.get("selected_nodes", []))
        app.focus_node = snapshot.get("focus_node")
        app._refresh_all_node_appearances()
        app._update_scrollregion()
    finally:
        app._history_suspended = False
    app._update_dirty_state()


def expr_to_string(expr: Optional[sp.Expr]) -> Optional[str]:
    if expr is None:
        return None
    return sp.srepr(expr)


def expr_from_string(
    text: Optional[str], *, parent: Any, messagebox_module: Any
) -> Optional[sp.Expr]:
    if text in (None, ""):
        return None
    try:
        return sp.sympify(text, evaluate=False)
    except Exception as exc:  # type: ignore[catching-non-exception]
        messagebox_module.showerror(
            "Load project",
            f"Failed to parse expression '{text}':\n{exc}",
            parent=parent,
        )
        return None


def push_history(app: Any) -> None:
    if app._history_suspended:
        return
    snapshot = app._snapshot_state()
    if app.history and snapshot == app.history[-1]:
        app._update_dirty_state(snapshot)
        return
    app.history.append(copy.deepcopy(snapshot))
    if len(app.history) > 100:
        app.history = app.history[-100:]
    app._update_dirty_state(snapshot)


def undo(app: Any) -> None:
    if len(app.history) <= 1:
        app._update_status("No actions to undo.")
        return
    app.history.pop()
    snapshot = copy.deepcopy(app.history[-1])
    app._restore_state(snapshot)
    app._refresh_all_node_appearances()
    app._update_dirty_state(snapshot)
    app._update_status("Action undone.")


def save_project(app: Any, filedialog_module: Any, messagebox_module: Any) -> bool:
    filename = filedialog_module.asksaveasfilename(
        title="Save project",
        defaultextension=".json",
        filetypes=[("Circuit project", "*.json"), ("All files", "*.*")],
        parent=app.root,
    )
    if not filename:
        return False

    snapshot = copy.deepcopy(app._snapshot_state())
    for edge in snapshot.get("edges", []):
        edge["capacitance_expr"] = app._expr_to_string(
            edge.get("capacitance_expr")
        )
        edge["inductance_expr"] = app._expr_to_string(edge.get("inductance_expr"))
        edge["l_inverse_expr"] = app._expr_to_string(edge.get("l_inverse_expr"))
        edge["josephson_inductance_expr"] = app._expr_to_string(
            edge.get("josephson_inductance_expr")
        )

    data = {"version": 2, "state": snapshot}
    try:
        Path(filename).write_text(json.dumps(data, indent=2))
    except OSError as exc:
        messagebox_module.showerror(
            "Save project", f"Could not save file:\n{exc}", parent=app.root
        )
        return False

    app._mark_project_clean()
    app._update_status(f"Project saved to {Path(filename).name}.")
    return True


def load_project(app: Any, filedialog_module: Any, messagebox_module: Any) -> None:
    filename = filedialog_module.askopenfilename(
        title="Load project",
        defaultextension=".json",
        filetypes=[("Circuit project", "*.json"), ("All files", "*.*")],
        parent=app.root,
    )
    if not filename:
        return

    try:
        data = json.loads(Path(filename).read_text())
    except (OSError, json.JSONDecodeError) as exc:
        messagebox_module.showerror(
            "Load project", f"Could not load file:\n{exc}", parent=app.root
        )
        return

    state = data.get("state", data)
    state.setdefault("selected_nodes", [])
    for edge in state.get("edges", []):
        edge["capacitance_expr"] = app._expr_from_string(
            edge.get("capacitance_expr")
        )
        edge["inductance_expr"] = app._expr_from_string(
            edge.get("inductance_expr")
        )
        edge["l_inverse_expr"] = app._expr_from_string(edge.get("l_inverse_expr"))
        edge["josephson_inductance_expr"] = app._expr_from_string(
            edge.get("josephson_inductance_expr")
        )
        edge["josephson_inductance_text"] = edge.get("josephson_inductance_text")
        edge["josephson_phase_sign"] = (
            -1 if edge.get("josephson_phase_sign", 1) == -1 else 1
        )

    current_snapshot = copy.deepcopy(app._snapshot_state())
    app._restore_state(state)
    new_snapshot = copy.deepcopy(app._snapshot_state())
    app.history = [current_snapshot, new_snapshot]
    app._mark_project_clean()
    app._update_status(f"Project loaded from {Path(filename).name}.")
