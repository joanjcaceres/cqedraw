import tkinter as tk
from typing import Any, Optional

import sympy as sp

from .core import GROUND_NODE_ID
from .desktop_models import Edge, EdgeParameters, Node


def add_node(
    app: Any,
    x: float,
    y: float,
    name: str,
    *,
    silent: bool = False,
    color: str = "#1976d2",
    forced_id: Optional[int] = None,
) -> int:
    if forced_id is None:
        node_id = app.node_counter
        app.node_counter += 1
    else:
        node_id = forced_id
        app.node_counter = max(app.node_counter, node_id + 1)
    tag = f"node_{node_id}"
    radius = app._current_node_radius()
    circle = app.canvas.create_oval(
        x - radius,
        y - radius,
        x + radius,
        y + radius,
        fill=color,
        outline="black",
        width=2,
        tags=("node", tag),
    )
    label = app.canvas.create_text(
        x + radius + 6,
        y,
        text=name,
        fill="#212121",
        anchor=tk.W,
        tags=("node", tag),
    )
    app.canvas.tag_bind(
        tag,
        "<ButtonPress-1>",
        lambda event, nid=node_id: app._handle_node_press(event, nid),
    )
    app.canvas.tag_bind(
        tag,
        "<B1-Motion>",
        lambda event, nid=node_id: app._handle_node_drag(event, nid),
    )
    app.canvas.tag_bind(
        tag,
        "<ButtonRelease-1>",
        lambda event, nid=node_id: app._handle_node_release(event, nid),
    )
    app.canvas.tag_bind(
        tag,
        "<Double-Button-1>",
        lambda event, nid=node_id: app._rename_node(nid),
    )

    app.nodes[node_id] = Node(node_id, name, x, y, circle, label)
    if not silent:
        app._update_status(f"Node {name} created. Press 'c' to connect.")
    app._update_scrollregion()
    return node_id


def connect_node_to_ground(app: Any, node_id: int, edge_dialog_cls: Any) -> None:
    existing = app._find_edge(node_id, GROUND_NODE_ID)
    default_cap = ""
    default_ind = ""
    if existing is not None:
        default_cap = existing.capacitance_text or (
            str(existing.capacitance_expr)
            if existing.capacitance_expr is not None
            else ""
        )
        default_ind = existing.inductance_text or (
            str(existing.inductance_expr)
            if existing.inductance_expr is not None
            else ""
        )
    node_name = app.nodes[node_id].name
    dialog = edge_dialog_cls(
        app.root, node_name, "GND", default_cap or None, default_ind or None
    )
    if dialog.value is None:
        app._update_status("Ground connection cancelled.")
        return
    changed = False
    if existing is not None:
        app._apply_edge_parameters(existing, dialog.value)
        app._update_status(f"Ground connection for {node_name} updated.")
        changed = True
    else:
        app._create_ground_edge(node_id, dialog.value)
        app._update_status(f"Node {node_name} connected to ground.")
        changed = True
    if changed:
        app._push_history()


def move_node(app: Any, node_id: int, x: float, y: float) -> None:
    node = app.nodes[node_id]
    node.x = x
    node.y = y
    radius = app._current_node_radius()
    app.canvas.coords(
        node.circle_id,
        x - radius,
        y - radius,
        x + radius,
        y + radius,
    )
    app.canvas.coords(node.label_id, x + radius + 6, y)
    for edge_id, edge in app.edges.items():
        if node_id in edge.nodes:
            app._update_edge_geometry(edge_id)
    app._update_scrollregion()


def update_edge_geometry(app: Any, edge_id: int) -> None:
    edge = app.edges[edge_id]
    if edge.is_ground:
        primary_id = edge.nodes[0]
        if primary_id not in app.nodes:
            return
        node = app.nodes[primary_id]
        x = node.x
        y = node.y
        end_x = node.x + edge.ground_offset_x
        end_y = node.y + edge.ground_offset_y
        app.canvas.coords(edge.line_id, x, y, end_x, end_y)
        mid_x = (x + end_x) / 2
        mid_y = (y + end_y) / 2
        radius = app._current_edge_center_radius()
        if edge.center_circle_id is not None:
            app.canvas.coords(
                edge.center_circle_id,
                mid_x - radius,
                mid_y - radius,
                mid_x + radius,
                mid_y + radius,
            )
            app.canvas.tag_raise(edge.label_id, edge.center_circle_id)
        if edge.ground_marker_id is not None:
            triangle_points = [
                end_x - app.GROUND_TRIANGLE_WIDTH / 2,
                end_y,
                end_x + app.GROUND_TRIANGLE_WIDTH / 2,
                end_y,
                end_x,
                end_y + app.GROUND_TRIANGLE_HEIGHT,
            ]
            app.canvas.coords(edge.ground_marker_id, *triangle_points)
        app.canvas.coords(edge.label_id, mid_x, mid_y)
        return

    node_a = app.nodes[edge.nodes[0]]
    node_b = app.nodes[edge.nodes[1]]
    app.canvas.coords(edge.line_id, node_a.x, node_a.y, node_b.x, node_b.y)
    center_x = (node_a.x + node_b.x) / 2
    center_y = (node_a.y + node_b.y) / 2
    radius = app._current_edge_center_radius()
    if edge.center_circle_id is not None:
        app.canvas.coords(
            edge.center_circle_id,
            center_x - radius,
            center_y - radius,
            center_x + radius,
            center_y + radius,
        )
        app.canvas.tag_raise(edge.label_id, edge.center_circle_id)
    app.canvas.coords(edge.label_id, center_x, center_y)


def edit_edge(app: Any, edge_id: int, edge_dialog_cls: Any) -> None:
    edge = app.edges[edge_id]
    first_node = app.nodes[edge.nodes[0]]
    first_name = first_node.name

    if edge.is_ground:
        second_name = "GND"
    else:
        try:
            second_name = app.nodes[edge.nodes[1]].name
        except KeyError:
            second_name = f"Node {edge.nodes[1]}"

    default_cap = edge.capacitance_text or (
        str(edge.capacitance_expr) if edge.capacitance_expr is not None else ""
    )
    default_ind = edge.inductance_text or (
        str(edge.inductance_expr) if edge.inductance_expr is not None else ""
    )
    dialog = edge_dialog_cls(app.root, first_name, second_name, default_cap, default_ind)
    if dialog.value is None:
        app._update_status("Connection edit cancelled.")
        return

    if edge.is_ground and (
        dialog.value.capacitance_expr is None
        and dialog.value.inductance_expr is None
        and edge.josephson_inductance_expr is None
    ):
        app._remove_edge(edge_id)
        app._set_focus_node(None)
        app._refresh_all_node_appearances()
        app._push_history()
        app._update_status(f"Ground connection removed from {first_name}.")
        return

    params = EdgeParameters(
        capacitance_expr=dialog.value.capacitance_expr,
        capacitance_text=dialog.value.capacitance_text,
        inductance_expr=dialog.value.inductance_expr,
        inductance_text=dialog.value.inductance_text,
        josephson_inductance_expr=edge.josephson_inductance_expr,
        josephson_inductance_text=edge.josephson_inductance_text,
        josephson_phase_sign=edge.josephson_phase_sign,
    )
    app._apply_edge_parameters(edge, params)
    app._update_status("Connection updated.")
    app._push_history()


def remove_node(app: Any, node_id: int) -> None:
    node = app.nodes.pop(node_id, None)
    if node is None:
        return
    app.selected_nodes.discard(node_id)
    app.canvas.delete(node.circle_id)
    app.canvas.delete(node.label_id)
    edges_to_remove = [
        edge_id for edge_id, edge in app.edges.items() if node_id in edge.nodes
    ]
    for edge_id in edges_to_remove:
        app._remove_edge(edge_id)
    app._update_scrollregion()
    app._refresh_all_node_appearances()


def remove_edge(app: Any, edge_id: int) -> None:
    edge = app.edges.pop(edge_id, None)
    if edge is None:
        return
    if app.dragging_ground_edge == edge_id:
        app.dragging_ground_edge = None
    app.canvas.delete(edge.line_id)
    if edge.center_circle_id is not None:
        app.canvas.delete(edge.center_circle_id)
    if edge.ground_marker_id is not None:
        app.canvas.delete(edge.ground_marker_id)
    app.canvas.delete(edge.label_id)
    app._update_scrollregion()


def apply_edge_parameters(app: Any, edge: Edge, params: EdgeParameters) -> None:
    edge.capacitance_expr = params.capacitance_expr
    edge.capacitance_text = params.capacitance_text
    edge.inductance_expr = params.inductance_expr
    edge.inductance_text = params.inductance_text
    edge.l_inverse_expr = (
        sp.simplify(sp.Integer(1) / edge.inductance_expr)
        if edge.inductance_expr is not None
        else None
    )
    edge.josephson_inductance_expr = params.josephson_inductance_expr
    edge.josephson_inductance_text = params.josephson_inductance_text
    edge.josephson_phase_sign = -1 if params.josephson_phase_sign == -1 else 1
    app.canvas.itemconfigure(
        edge.label_id,
        text=app._edge_label(
            edge.capacitance_expr,
            edge.capacitance_text,
            edge.inductance_expr,
            edge.inductance_text,
            edge.josephson_inductance_expr,
            edge.josephson_inductance_text,
        ),
    )
    app._update_edge_geometry(edge.identifier)


def rename_node(app: Any, node_id: int, simpledialog_module: Any) -> None:
    node = app.nodes[node_id]
    new_name = simpledialog_module.askstring(
        "Renombrar nodo",
        "Nuevo nombre:",
        initialvalue=node.name,
        parent=app.root,
    )
    if not new_name:
        return
    new_name = new_name.strip()
    if not new_name or new_name == node.name:
        return
    node.name = new_name
    app.canvas.itemconfigure(node.label_id, text=new_name)
    app._update_status(f"Node renamed to {new_name}.")
    app._push_history()


def instantiate_edge(
    app: Any,
    first: int,
    second: int,
    params: EdgeParameters,
    *,
    forced_id: Optional[int] = None,
) -> int:
    capacitance_expr = params.capacitance_expr
    capacitance_text = params.capacitance_text
    inductance_expr = params.inductance_expr
    inductance_text = params.inductance_text
    josephson_inductance_expr = params.josephson_inductance_expr
    josephson_inductance_text = params.josephson_inductance_text
    josephson_phase_sign = -1 if params.josephson_phase_sign == -1 else 1
    l_inverse_expr: Optional[sp.Expr] = None
    if inductance_expr is not None:
        l_inverse_expr = sp.simplify(sp.Integer(1) / inductance_expr)
    if forced_id is None:
        edge_id = app.edge_counter
        app.edge_counter += 1
    else:
        edge_id = forced_id
        app.edge_counter = max(app.edge_counter, edge_id + 1)
    tag = f"edge_{edge_id}"
    x1, y1 = app.nodes[first].x, app.nodes[first].y
    x2, y2 = app.nodes[second].x, app.nodes[second].y
    line = app.canvas.create_line(
        x1, y1, x2, y2, width=2, fill="#424242", tags=("edge", tag)
    )
    radius = app._current_edge_center_radius()
    center_x = (x1 + x2) / 2
    center_y = (y1 + y2) / 2
    circle = app.canvas.create_oval(
        center_x - radius,
        center_y - radius,
        center_x + radius,
        center_y + radius,
        fill="#f5f5f5",
        outline="#424242",
        width=2,
        tags=("edge", tag),
    )
    label = app.canvas.create_text(
        center_x,
        center_y,
        text="",
        fill="#212121",
        justify=tk.CENTER,
        tags=("edge", tag),
    )
    if circle is not None:
        app.canvas.tag_raise(label, circle)
    app.edges[edge_id] = Edge(
        identifier=edge_id,
        nodes=(first, second),
        line_id=line,
        center_circle_id=circle,
        label_id=label,
        capacitance_expr=capacitance_expr,
        capacitance_text=capacitance_text,
        inductance_expr=inductance_expr,
        inductance_text=inductance_text,
        l_inverse_expr=l_inverse_expr,
        josephson_inductance_expr=josephson_inductance_expr,
        josephson_inductance_text=josephson_inductance_text,
        josephson_phase_sign=josephson_phase_sign,
    )
    app.canvas.tag_bind(
        tag,
        "<Double-Button-1>",
        lambda event, eid=edge_id: app._edit_edge(eid),
    )
    app._apply_edge_parameters(app.edges[edge_id], params)
    app._update_scrollregion()
    return edge_id


def create_edge(
    app: Any,
    first: int,
    second: int,
    edge_dialog_cls: Any,
    messagebox_module: Any,
) -> None:
    first_name = app.nodes[first].name
    second_name = app.nodes[second].name
    existing = app._find_edge(first, second)
    if existing is not None:
        if not messagebox_module.askyesno(
            "Enlace existente",
            "A connection between these nodes already exists.\nDo you want to create another one in parallel?",
            parent=app.root,
        ):
            app._update_status("Original connection maintained.")
            return
    dialog = edge_dialog_cls(app.root, first_name, second_name)
    if dialog.value is None:
        app._update_status("Connection cancelled.")
        return
    app._instantiate_edge(first, second, dialog.value)
    app._update_status("Connection created. Press 'c' for another or Esc to exit mode.")
    app._push_history()


def instantiate_ground_edge(
    app: Any,
    node_id: int,
    params: EdgeParameters,
    *,
    offset_x: float = 0.0,
    offset_y: Optional[float] = None,
    forced_id: Optional[int] = None,
) -> int:
    capacitance_expr = params.capacitance_expr
    capacitance_text = params.capacitance_text
    inductance_expr = params.inductance_expr
    inductance_text = params.inductance_text
    josephson_inductance_expr = params.josephson_inductance_expr
    josephson_inductance_text = params.josephson_inductance_text
    josephson_phase_sign = -1 if params.josephson_phase_sign == -1 else 1
    l_inverse_expr: Optional[sp.Expr] = None
    if inductance_expr is not None:
        l_inverse_expr = sp.simplify(sp.Integer(1) / inductance_expr)
    if forced_id is None:
        edge_id = app.edge_counter
        app.edge_counter += 1
    else:
        edge_id = forced_id
        app.edge_counter = max(app.edge_counter, edge_id + 1)
    tag = f"edge_{edge_id}"
    node = app.nodes[node_id]
    start_x = node.x
    start_y = node.y
    if offset_y is None:
        offset_y = app.GROUND_LINE_LENGTH
    end_x = start_x + offset_x
    end_y = start_y + offset_y
    line = app.canvas.create_line(
        start_x,
        start_y,
        end_x,
        end_y,
        width=2,
        fill="#424242",
        tags=("edge", tag),
    )
    mid_x = (start_x + end_x) / 2
    mid_y = (start_y + end_y) / 2
    radius = app._current_edge_center_radius()
    circle = app.canvas.create_oval(
        mid_x - radius,
        mid_y - radius,
        mid_x + radius,
        mid_y + radius,
        fill="#f5f5f5",
        outline="#424242",
        width=2,
        tags=("edge", tag),
    )
    triangle_points = [
        end_x - app.GROUND_TRIANGLE_WIDTH / 2,
        end_y,
        end_x + app.GROUND_TRIANGLE_WIDTH / 2,
        end_y,
        end_x,
        end_y + app.GROUND_TRIANGLE_HEIGHT,
    ]
    triangle = app.canvas.create_polygon(
        triangle_points,
        fill="#f5f5f5",
        outline="#424242",
        width=2,
        tags=("edge", tag),
    )
    label = app.canvas.create_text(
        mid_x,
        mid_y,
        text="",
        fill="#212121",
        justify=tk.CENTER,
        anchor=tk.CENTER,
        tags=("edge", tag),
    )
    app.canvas.tag_raise(label, circle)
    app.edges[edge_id] = Edge(
        identifier=edge_id,
        nodes=(node_id, GROUND_NODE_ID),
        line_id=line,
        center_circle_id=circle,
        label_id=label,
        capacitance_expr=capacitance_expr,
        capacitance_text=capacitance_text,
        inductance_expr=inductance_expr,
        inductance_text=inductance_text,
        l_inverse_expr=l_inverse_expr,
        josephson_inductance_expr=josephson_inductance_expr,
        josephson_inductance_text=josephson_inductance_text,
        josephson_phase_sign=josephson_phase_sign,
        is_ground=True,
        ground_marker_id=triangle,
        ground_offset_x=offset_x,
        ground_offset_y=offset_y,
    )
    app.canvas.tag_bind(
        tag,
        "<Double-Button-1>",
        lambda event, eid=edge_id: app._edit_edge(eid),
    )
    for item in (line, circle, triangle, label):
        app.canvas.tag_bind(
            item,
            "<ButtonPress-1>",
            lambda event, eid=edge_id: app._handle_ground_press(event, eid),
        )
        app.canvas.tag_bind(
            item,
            "<B1-Motion>",
            lambda event, eid=edge_id: app._handle_ground_drag(event, eid),
        )
        app.canvas.tag_bind(
            item,
            "<ButtonRelease-1>",
            lambda event, eid=edge_id: app._handle_ground_release(event, eid),
        )
    app._apply_edge_parameters(app.edges[edge_id], params)
    app._update_scrollregion()
    return edge_id


def create_ground_edge(app: Any, node_id: int, params: EdgeParameters) -> None:
    app._instantiate_ground_edge(node_id, params)


def edge_label(
    capacitance_expr: Optional[sp.Expr],
    capacitance_text: Optional[str],
    inductance_expr: Optional[sp.Expr],
    inductance_text: Optional[str],
    josephson_inductance_expr: Optional[sp.Expr] = None,
    josephson_inductance_text: Optional[str] = None,
) -> str:
    parts: list[str] = []
    cap_display = expression_to_display(capacitance_expr, capacitance_text)
    ind_display = expression_to_display(inductance_expr, inductance_text)
    josephson_display = expression_to_display(
        josephson_inductance_expr,
        josephson_inductance_text,
    )
    if cap_display is not None:
        parts.append(f"C={cap_display}")
    if ind_display is not None:
        parts.append(f"L={ind_display}")
    if josephson_display is not None:
        parts.append(f"LJ={josephson_display}")
    if not parts:
        return ""
    if len(parts) == 1:
        return parts[0]
    return "\n".join(parts)


def expression_to_display(
    expr: Optional[sp.Expr], raw_text: Optional[str]
) -> Optional[str]:
    if expr is None:
        return None
    if expr.free_symbols:
        return raw_text or str(expr)
    try:
        numerical = float(expr.evalf())
    except (TypeError, ValueError):
        return raw_text or str(expr)
    return f"{numerical:g}"


def find_edge(app: Any, first: int, second: int) -> Edge | None:
    for edge in app.edges.values():
        if edge.is_ground:
            if {first, second} == {edge.nodes[0], edge.nodes[1]}:
                return edge
        else:
            if set(edge.nodes) == {first, second}:
                return edge
    return None
