import tkinter as tk
from types import SimpleNamespace
from typing import Any, Optional

from .desktop_models import EdgeParameters


def refresh_node_appearance(app: Any, node_id: int) -> None:
    node = app.nodes.get(node_id)
    if node is None:
        return
    if node_id == app.focus_node:
        color = "#d32f2f"
    elif node_id in app.selected_nodes:
        color = "#ff9800"
    else:
        color = "#1976d2"
    app.canvas.itemconfigure(node.circle_id, fill=color)


def refresh_all_node_appearances(app: Any) -> None:
    for node_id in app.nodes:
        app._refresh_node_appearance(node_id)


def clear_selection(app: Any) -> None:
    if not app.selected_nodes:
        return
    for node_id in list(app.selected_nodes):
        app.selected_nodes.discard(node_id)
        app._refresh_node_appearance(node_id)


def toggle_selection(app: Any, node_id: int) -> None:
    if node_id in app.selected_nodes:
        app.selected_nodes.remove(node_id)
    else:
        app.selected_nodes.add(node_id)
    app._refresh_node_appearance(node_id)


def ensure_selected(app: Any, node_id: int) -> None:
    if node_id not in app.selected_nodes or len(app.selected_nodes) > 1:
        app._clear_selection()
        app.selected_nodes.add(node_id)
        app._refresh_node_appearance(node_id)


def copy_selection(app: Any) -> None:
    if not app.selected_nodes:
        app._update_status("Nothing selected to copy.")
        return
    nodes = sorted(app.selected_nodes)
    min_x = min(app.nodes[nid].x for nid in nodes)
    min_y = min(app.nodes[nid].y for nid in nodes)
    clipboard_nodes = []
    for nid in nodes:
        node = app.nodes[nid]
        clipboard_nodes.append(
            {
                "id": nid,
                "name": node.name,
                "dx": node.x - min_x,
                "dy": node.y - min_y,
            }
        )

    clipboard_edges = []
    for edge in app.edges.values():
        if edge.is_ground:
            if edge.nodes[0] in app.selected_nodes:
                clipboard_edges.append(
                    {
                        "nodes": list(edge.nodes),
                        "capacitance_expr": app._expr_to_string(
                            edge.capacitance_expr
                        ),
                        "capacitance_text": edge.capacitance_text,
                        "inductance_expr": app._expr_to_string(edge.inductance_expr),
                        "inductance_text": edge.inductance_text,
                        "josephson_inductance_expr": app._expr_to_string(
                            edge.josephson_inductance_expr
                        ),
                        "josephson_inductance_text": edge.josephson_inductance_text,
                        "josephson_phase_sign": edge.josephson_phase_sign,
                        "is_ground": True,
                        "ground_offset_x": edge.ground_offset_x,
                        "ground_offset_y": edge.ground_offset_y,
                    }
                )
        else:
            if (
                edge.nodes[0] in app.selected_nodes
                and edge.nodes[1] in app.selected_nodes
            ):
                clipboard_edges.append(
                    {
                        "nodes": list(edge.nodes),
                        "capacitance_expr": app._expr_to_string(
                            edge.capacitance_expr
                        ),
                        "capacitance_text": edge.capacitance_text,
                        "inductance_expr": app._expr_to_string(edge.inductance_expr),
                        "inductance_text": edge.inductance_text,
                        "josephson_inductance_expr": app._expr_to_string(
                            edge.josephson_inductance_expr
                        ),
                        "josephson_inductance_text": edge.josephson_inductance_text,
                        "josephson_phase_sign": edge.josephson_phase_sign,
                        "is_ground": False,
                    }
                )

    app.clipboard_data = {
        "nodes": clipboard_nodes,
        "edges": clipboard_edges,
        "origin": (min_x, min_y),
    }
    app._update_status(f"Copied {len(nodes)} node(s) to clipboard.")


def set_focus_node(app: Any, node_id: Optional[int]) -> None:
    previous = app.focus_node
    app.focus_node = node_id
    if previous is not None:
        app._refresh_node_appearance(previous)
    if node_id is not None:
        app._refresh_node_appearance(node_id)


def start_marquee(app: Any, x: float, y: float) -> None:
    app._clear_selection()
    app._marquee_start = (x, y)
    if app._marquee_rect_id is not None:
        app.canvas.delete(app._marquee_rect_id)
    app._marquee_rect_id = app.canvas.create_rectangle(
        x,
        y,
        x,
        y,
        outline="#1976d2",
        dash=(4, 2),
        width=1,
    )


def update_marquee(app: Any, x: float, y: float) -> None:
    if app._marquee_rect_id is None or app._marquee_start is None:
        return
    x0, y0 = app._marquee_start
    app.canvas.coords(app._marquee_rect_id, x0, y0, x, y)


def finish_marquee(app: Any, x: float, y: float) -> None:
    if app._marquee_start is None or app._marquee_rect_id is None:
        return
    x0, y0 = app._marquee_start
    app.canvas.delete(app._marquee_rect_id)
    app._marquee_rect_id = None
    app._marquee_start = None

    left = min(x0, x)
    right = max(x0, x)
    top = min(y0, y)
    bottom = max(y0, y)

    selected = []
    for node_id, node in app.nodes.items():
        radius = app._current_node_radius()
        if left <= node.x <= right and top <= node.y <= bottom:
            selected.append(node_id)

    app.selected_nodes = set(selected)
    if selected:
        app._set_focus_node(selected[-1])
        app._update_status(f"Selected {len(selected)} node(s).")
    else:
        app._set_focus_node(None)
        app._update_status("Selection cleared.")
    app._refresh_all_node_appearances()


def start_paste_preview_fake(app: Any) -> None:
    if app.clipboard_data is None:
        app._update_status("Clipboard is empty.")
        return
    app.root.update_idletasks()
    width = app.canvas.winfo_width() or 600
    height = app.canvas.winfo_height() or 400
    event = SimpleNamespace(x=width / 2, y=height / 2)
    app._start_paste_preview(event)


def start_paste_preview(app: Any, event: Any) -> None:
    if app.clipboard_data is None:
        app._update_status("Clipboard is empty.")
        return

    if app._pasting_active:
        app._cancel_paste_preview()

    canvas_x = app.canvas.canvasx(event.x)
    canvas_y = app.canvas.canvasy(event.y)

    nodes = app.clipboard_data["nodes"]
    edges = app.clipboard_data["edges"]

    ghost_nodes = []
    for node in nodes:
        x = canvas_x + node["dx"]
        y = canvas_y + node["dy"]
        radius = app._current_node_radius()
        oval = app.canvas.create_oval(
            x - radius,
            y - radius,
            x + radius,
            y + radius,
            outline="#ff9800",
            dash=(3, 2),
            width=2,
            fill="",
        )
        label = app.canvas.create_text(
            x + radius + 6,
            y,
            text=node["name"],
            fill="#ff9800",
            anchor=tk.W,
        )
        ghost_nodes.append(
            {
                "id": node["id"],
                "oval": oval,
                "label": label,
                "dx": node["dx"],
                "dy": node["dy"],
            }
        )

    ghost_edges = []
    for edge in edges:
        if edge.get("is_ground"):
            source = next(
                (gn for gn in ghost_nodes if gn["id"] == edge["nodes"][0]), None
            )
            if source is None:
                continue
            x = canvas_x + source["dx"]
            y = canvas_y + source["dy"]
            line = app.canvas.create_line(
                x,
                y,
                x + edge.get("ground_offset_x", 0.0),
                y + edge.get("ground_offset_y", app.GROUND_LINE_LENGTH),
                fill="#ff9800",
                dash=(3, 2),
                width=2,
            )
            ghost_edges.append(
                {
                    "is_ground": True,
                    "line": line,
                    "source_id": edge["nodes"][0],
                    "offset_x": edge.get("ground_offset_x", 0.0),
                    "offset_y": edge.get(
                        "ground_offset_y", app.GROUND_LINE_LENGTH
                    ),
                }
            )
        else:
            source = next(
                (gn for gn in ghost_nodes if gn["id"] == edge["nodes"][0]), None
            )
            target = next(
                (gn for gn in ghost_nodes if gn["id"] == edge["nodes"][1]), None
            )
            if source is None or target is None:
                continue
            line = app.canvas.create_line(
                canvas_x + source["dx"],
                canvas_y + source["dy"],
                canvas_x + target["dx"],
                canvas_y + target["dy"],
                fill="#ff9800",
                dash=(3, 2),
                width=2,
            )
            ghost_edges.append(
                {
                    "is_ground": False,
                    "line": line,
                    "source_id": edge["nodes"][0],
                    "target_id": edge["nodes"][1],
                }
            )

    app._paste_preview = {
        "ghost_nodes": ghost_nodes,
        "ghost_edges": ghost_edges,
        "anchor": (canvas_x, canvas_y),
    }
    app._pasting_active = True
    app.canvas.bind("<Motion>", app._update_paste_preview, add="+")
    app.root.bind("<Escape>", app._cancel_paste_preview_event, add="+")
    app._update_status(
        "Move the mouse to place the copied selection, click to confirm or press Esc to cancel."
    )


def update_paste_preview(app: Any, event: Any) -> None:
    if not app._pasting_active or app._paste_preview is None:
        return
    canvas_x = app.canvas.canvasx(event.x)
    canvas_y = app.canvas.canvasy(event.y)
    anchor_x, anchor_y = app._paste_preview["anchor"]
    dx = canvas_x - anchor_x
    dy = canvas_y - anchor_y
    app._paste_preview["anchor"] = (canvas_x, canvas_y)

    for ghost in app._paste_preview["ghost_nodes"]:
        x = canvas_x + ghost["dx"]
        y = canvas_y + ghost["dy"]
        radius = app._current_node_radius()
        app.canvas.coords(
            ghost["oval"],
            x - radius,
            y - radius,
            x + radius,
            y + radius,
        )
        app.canvas.coords(ghost["label"], x + radius + 6, y)

    for ghost in app._paste_preview["ghost_edges"]:
        if ghost["is_ground"]:
            source = next(
                (
                    n
                    for n in app._paste_preview["ghost_nodes"]
                    if n["id"] == ghost["source_id"]
                ),
                None,
            )
            if source is None:
                continue
            x = canvas_x + source["dx"]
            y = canvas_y + source["dy"]
            app.canvas.coords(
                ghost["line"],
                x,
                y,
                x + ghost["offset_x"],
                y + ghost["offset_y"],
            )
        else:
            source = next(
                (
                    n
                    for n in app._paste_preview["ghost_nodes"]
                    if n["id"] == ghost["source_id"]
                ),
                None,
            )
            target = next(
                (
                    n
                    for n in app._paste_preview["ghost_nodes"]
                    if n["id"] == ghost["target_id"]
                ),
                None,
            )
            if source is None or target is None:
                continue
            app.canvas.coords(
                ghost["line"],
                canvas_x + source["dx"],
                canvas_y + source["dy"],
                canvas_x + target["dx"],
                canvas_y + target["dy"],
            )


def complete_paste_preview(app: Any, canvas_x: float, canvas_y: float) -> None:
    if (
        not app._pasting_active
        or app._paste_preview is None
        or app.clipboard_data is None
    ):
        return

    nodes = app.clipboard_data["nodes"]
    edges = app.clipboard_data["edges"]

    mapping: dict[int, int] = {}
    new_nodes: list[int] = []

    for node in nodes:
        new_name = app._generate_default_node_name()
        new_id = app._add_node(
            canvas_x + node["dx"],
            canvas_y + node["dy"],
            new_name,
            silent=True,
        )
        mapping[node["id"]] = new_id
        new_nodes.append(new_id)

    for edge in edges:
        params = EdgeParameters(
            capacitance_expr=app._expr_from_string(edge.get("capacitance_expr")),
            capacitance_text=edge.get("capacitance_text"),
            inductance_expr=app._expr_from_string(edge.get("inductance_expr")),
            inductance_text=edge.get("inductance_text"),
            josephson_inductance_expr=app._expr_from_string(
                edge.get("josephson_inductance_expr")
            ),
            josephson_inductance_text=edge.get("josephson_inductance_text"),
            josephson_phase_sign=(
                -1 if edge.get("josephson_phase_sign", 1) == -1 else 1
            ),
        )
        if edge.get("is_ground"):
            source_id = mapping.get(edge["nodes"][0])
            if source_id is not None:
                app._instantiate_ground_edge(
                    source_id,
                    params,
                    offset_x=edge.get("ground_offset_x", 0.0),
                    offset_y=edge.get("ground_offset_y", app.GROUND_LINE_LENGTH),
                )
        else:
            first_new = mapping.get(edge["nodes"][0])
            second_new = mapping.get(edge["nodes"][1])
            if first_new is not None and second_new is not None:
                app._instantiate_edge(first_new, second_new, params)

    app.selected_nodes = set(new_nodes)
    if new_nodes:
        app._set_focus_node(new_nodes[-1])
    else:
        app._set_focus_node(None)
    app._refresh_all_node_appearances()
    app._update_scrollregion()
    app._push_history()
    app._update_status(f"Pasted {len(new_nodes)} node(s).")
    app._cancel_paste_preview()


def cancel_paste_preview_event(app: Any, event: Any) -> None:
    app._cancel_paste_preview(message="Paste cancelled.")


def cancel_paste_preview(app: Any, message: Optional[str] = None) -> None:
    if not app._pasting_active:
        return
    if app._paste_preview is not None:
        for ghost in app._paste_preview.get("ghost_nodes", []):
            app.canvas.delete(ghost["oval"])
            app.canvas.delete(ghost["label"])
        for ghost in app._paste_preview.get("ghost_edges", []):
            app.canvas.delete(ghost["line"])
    app._paste_preview = None
    app._pasting_active = False
    try:
        app.canvas.unbind("<Motion>")
    except Exception:
        pass
    if message:
        app._update_status(message)
