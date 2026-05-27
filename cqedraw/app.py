import tkinter as tk
from tkinter import filedialog, messagebox, simpledialog, ttk
from typing import Dict, Optional, Tuple

import sympy as sp

from .core import (
    GROUND_NODE_ID,
    CircuitEdgeData,
    MatrixBranches,
    MatrixEntries,
    accumulate_matrix_entry,
    build_snippet,
    compute_josephson_branches,
    compute_matrix_branches,
    compute_matrices,
    compute_matrix_entries,
    finalize_matrix_entries,
    matrix_node_records,
)
from .desktop_dialogs import EdgeDialog, ToolTip
from .desktop_models import Edge, EdgeParameters, Node
from . import desktop_merge, desktop_project_state, desktop_selection


class CircuitGraphApp:
    NODE_RADIUS = 6
    EDGE_CENTER_RADIUS = 16
    GROUND_LINE_LENGTH = 104
    GROUND_TRIANGLE_WIDTH = 18
    GROUND_TRIANGLE_HEIGHT = 12

    def __init__(self) -> None:
        self.root = tk.Tk()
        self.root.title("cQEDraw")

        # Set window size to be larger and screen-independent
        window_width = 1200
        window_height = 800
        self.root.geometry(f"{window_width}x{window_height}")

        # Center the window on screen
        screen_width = self.root.winfo_screenwidth()
        screen_height = self.root.winfo_screenheight()
        x = (screen_width - window_width) // 2
        y = (screen_height - window_height) // 2
        self.root.geometry(f"{window_width}x{window_height}+{x}+{y}")

        # Set minimum window size
        self.root.minsize(800, 600)

        self.nodes: Dict[int, Node] = {}
        self.edges: Dict[int, Edge] = {}
        self.node_counter = 0
        self.edge_counter = 0
        self.mode: Optional[str] = None
        self.selected_node: Optional[int] = None
        self.dragging_node: Optional[int] = None
        self.drag_offset: Tuple[float, float] = (0.0, 0.0)
        self.focus_node: Optional[int] = None
        self.dragging_ground_edge: Optional[int] = None
        self.ground_drag_offset: Tuple[float, float] = (0.0, 0.0)
        self.selected_nodes: set[int] = set()
        self.view_scale: float = 1.0
        self.history: list[dict] = []
        self._history_suspended = False
        self._clean_project_snapshot: Optional[dict] = None
        self._project_dirty = False
        self._node_drag_moved = False
        self._ground_drag_moved = False
        self.clipboard_data: Optional[dict] = None
        self._paste_preview: Optional[dict] = None
        self._marquee_start: Optional[tuple[float, float]] = None
        self._marquee_rect_id: Optional[int] = None
        self._pasting_active = False
        self.status_var = tk.StringVar(
            value="Press 'n' to create nodes, 'c' to connect."
        )

        self._build_ui()
        self._bind_shortcuts()
        self.root.protocol("WM_DELETE_WINDOW", self._on_close_requested)
        self._push_history()
        self._mark_project_clean()

    def _build_ui(self) -> None:
        self.root.columnconfigure(0, weight=1)
        self.root.rowconfigure(0, weight=0)
        self.root.rowconfigure(1, weight=1)
        self.root.rowconfigure(2, weight=0)

        toolbar = ttk.Frame(self.root, padding=(8, 6))
        toolbar.grid(row=0, column=0, sticky="ew")

        self._create_toolbar_button(
            toolbar,
            text="Node",
            command=lambda: self._set_mode("node"),
            tooltip="Node mode — click on the canvas to create nodes.",
            shortcut="N",
        )
        self._create_toolbar_button(
            toolbar,
            text="Edge",
            command=lambda: self._set_mode("edge"),
            tooltip="Edge mode — click two nodes to connect them.",
            shortcut="C",
        )
        self._create_toolbar_button(
            toolbar,
            text="Ground",
            command=lambda: self._set_mode("ground"),
            tooltip="Ground mode — select a node to add/remove ground connection.",
            shortcut="G",
        )
        self._create_toolbar_button(
            toolbar,
            text="Reset",
            command=self._reset_all,
            tooltip="Clear all nodes and connections.",
        )

        ttk.Separator(toolbar, orient=tk.VERTICAL).pack(side=tk.LEFT, fill=tk.Y, padx=6)

        self._create_toolbar_button(
            toolbar,
            text="Copy",
            command=self._copy_selection,
            tooltip="Copy selected nodes.",
            shortcut="Ctrl/Cmd+C",
        )
        self._create_toolbar_button(
            toolbar,
            text="Paste",
            command=lambda: self._start_paste_preview_fake(),
            tooltip="Paste copied nodes at cursor.",
            shortcut="Ctrl/Cmd+V",
        )
        self._create_toolbar_button(
            toolbar,
            text="Concatenate",
            command=self._duplicate_selection,
            tooltip="Repeat the selected block to the right.",
        )
        self._create_toolbar_button(
            toolbar,
            text="Merge",
            command=self._merge_selected_nodes,
            tooltip="Merge selected nodes into the focused node.",
            shortcut="M",
        )

        ttk.Separator(toolbar, orient=tk.VERTICAL).pack(side=tk.LEFT, fill=tk.Y, padx=6)

        self._create_toolbar_button(
            toolbar,
            text="Save",
            command=self._save_project,
            tooltip="Save project (Ctrl/Cmd+S).",
            shortcut="Ctrl/Cmd+S",
        )
        self._create_toolbar_button(
            toolbar,
            text="Load",
            command=self._load_project,
            tooltip="Load project (Ctrl/Cmd+O).",
            shortcut="Ctrl/Cmd+O",
        )
        self._create_toolbar_button(
            toolbar,
            text="Snippet",
            command=self._copy_snippet,
            tooltip="Copy sparse SciPy matrix snippet to clipboard.",
        )

        self.canvas = tk.Canvas(self.root, bg="white")
        self.canvas.grid(row=1, column=0, sticky="nsew")
        self.canvas.bind("<ButtonPress-1>", self._on_canvas_button_press)
        self.canvas.bind("<B1-Motion>", self._on_canvas_drag)
        self.canvas.bind("<ButtonRelease-1>", self._on_canvas_button_release)
        self.canvas.bind("<Control-MouseWheel>", self._handle_zoom)
        self.canvas.bind(
            "<Control-Button-4>", lambda event: self._handle_zoom(event, factor=1.1)
        )
        self.canvas.bind(
            "<Control-Button-5>", lambda event: self._handle_zoom(event, factor=0.9)
        )
        self.canvas.bind("<ButtonPress-2>", self._start_pan)
        self.canvas.bind("<B2-Motion>", self._perform_pan)
        self.canvas.bind("<ButtonRelease-2>", self._end_pan)

        status_bar = ttk.Frame(self.root, padding=(8, 4))
        status_bar.grid(row=2, column=0, sticky="ew")
        status_label = ttk.Label(status_bar, textvariable=self.status_var)
        status_label.pack(side=tk.LEFT)

    def _create_toolbar_button(
        self,
        parent: ttk.Frame,
        text: str,
        command,
        tooltip: str,
        shortcut: Optional[str] = None,
    ) -> ttk.Button:
        btn = ttk.Button(parent, text=text, command=command)
        btn.pack(side=tk.LEFT, padx=2)
        tip_text = f"{tooltip}{' (' + shortcut + ')' if shortcut else ''}"
        ToolTip(btn, tip_text)
        return btn

    def _current_node_radius(self) -> float:
        return self.NODE_RADIUS * self.view_scale

    def _current_edge_center_radius(self) -> float:
        return self.EDGE_CENTER_RADIUS * self.view_scale

    def _update_scrollregion(self) -> None:
        bbox = self.canvas.bbox("all")
        if bbox is not None:
            self.canvas.configure(scrollregion=bbox)

    def _bind_shortcuts(self) -> None:
        self.root.bind("n", lambda _: self._set_mode("node"))
        self.root.bind("c", lambda _: self._set_mode("edge"))
        self.root.bind("g", lambda _: self._set_mode("ground"))
        self.root.bind("m", lambda _: self._merge_selected_nodes())
        self.root.bind("<Escape>", lambda _: self._set_mode(None))
        self.root.bind("<Delete>", lambda _: self._delete_focused_node())
        self.root.bind("<BackSpace>", lambda _: self._delete_focused_node())
        self.root.bind("<Control-z>", lambda event: self._undo())
        self.root.bind("<Command-z>", lambda event: self._undo())
        self.root.bind("<Control-s>", lambda event: self._save_project())
        self.root.bind("<Command-s>", lambda event: self._save_project())
        self.root.bind("<Control-o>", lambda event: self._load_project())
        self.root.bind("<Command-o>", lambda event: self._load_project())
        self.root.bind("<Control-c>", lambda event: self._copy_selection())
        self.root.bind("<Command-c>", lambda event: self._copy_selection())
        self.root.bind("<Control-v>", lambda event: self._start_paste_preview(event))
        self.root.bind("<Command-v>", lambda event: self._start_paste_preview(event))

    def _create_node_at(self, x: float, y: float) -> None:
        self._set_focus_node(None)
        self._clear_selection()
        name = self._generate_default_node_name()
        new_node_id = self._add_node(x, y, name)
        self.selected_nodes = {new_node_id}
        self._set_focus_node(new_node_id)
        self._push_history()

    def _handle_zoom(self, event: tk.Event, factor: Optional[float] = None) -> None:
        if factor is None:
            if event.delta == 0:
                return
            factor = 1.1 if event.delta > 0 else 0.9
        new_scale = self.view_scale * factor
        min_scale, max_scale = 0.05, 6.0
        if new_scale < min_scale:
            factor = min_scale / self.view_scale
            new_scale = min_scale
        elif new_scale > max_scale:
            factor = max_scale / self.view_scale
            new_scale = max_scale

        anchor_x = self.canvas.canvasx(event.x)
        anchor_y = self.canvas.canvasy(event.y)
        self.canvas.scale("all", anchor_x, anchor_y, factor, factor)

        for node in self.nodes.values():
            node.x = anchor_x + (node.x - anchor_x) * factor
            node.y = anchor_y + (node.y - anchor_y) * factor

        for edge in self.edges.values():
            if edge.is_ground:
                edge.ground_offset_x *= factor
                edge.ground_offset_y *= factor

        self.view_scale = new_scale

        for node_id, node in self.nodes.items():
            self._move_node(node_id, node.x, node.y)

        self._refresh_all_node_appearances()
        self._update_scrollregion()
        self._push_history()

    def _start_pan(self, event: tk.Event) -> None:
        self.canvas.scan_mark(event.x, event.y)

    def _perform_pan(self, event: tk.Event) -> None:
        self.canvas.scan_dragto(event.x, event.y, gain=1)

    def _end_pan(self, event: tk.Event) -> None:
        # No additional state to update, but method kept for completeness.
        pass

    def _on_canvas_button_press(self, event: tk.Event) -> None:
        canvas_x = self.canvas.canvasx(event.x)
        canvas_y = self.canvas.canvasy(event.y)

        if self._pasting_active:
            self._complete_paste_preview(canvas_x, canvas_y)
            return

        if self.mode == "node":
            current = self.canvas.find_withtag("current")
            if current:
                tags = self.canvas.gettags(current[0])
                if "node" in tags:
                    self._update_status("Click on empty canvas to add a new node.")
                    return
            self._create_node_at(canvas_x, canvas_y)
            return

        current = self.canvas.find_withtag("current")
        if self.mode is None and (
            not current
            or (
                "node" not in self.canvas.gettags(current[0])
                and "edge" not in self.canvas.gettags(current[0])
            )
        ):
            self._start_marquee(canvas_x, canvas_y)

    def _on_canvas_drag(self, event: tk.Event) -> None:
        if self._marquee_start is not None:
            canvas_x = self.canvas.canvasx(event.x)
            canvas_y = self.canvas.canvasy(event.y)
            self._update_marquee(canvas_x, canvas_y)

    def _on_canvas_button_release(self, event: tk.Event) -> None:
        if self._marquee_start is not None:
            canvas_x = self.canvas.canvasx(event.x)
            canvas_y = self.canvas.canvasy(event.y)
            self._finish_marquee(canvas_x, canvas_y)

    def _generate_default_node_name(self) -> str:
        existing_numbers = {
            int(node.name[1:])
            for node in self.nodes.values()
            if node.name.startswith("N") and node.name[1:].isdigit()
        }
        next_index = 1
        while next_index in existing_numbers:
            next_index += 1
        return f"N{next_index}"

    def _add_node(
        self,
        x: float,
        y: float,
        name: str,
        *,
        silent: bool = False,
        color: str = "#1976d2",
        forced_id: Optional[int] = None,
    ) -> int:
        if forced_id is None:
            node_id = self.node_counter
            self.node_counter += 1
        else:
            node_id = forced_id
            self.node_counter = max(self.node_counter, node_id + 1)
        tag = f"node_{node_id}"
        radius = self._current_node_radius()
        circle = self.canvas.create_oval(
            x - radius,
            y - radius,
            x + radius,
            y + radius,
            fill=color,
            outline="black",
            width=2,
            tags=("node", tag),
        )
        label = self.canvas.create_text(
            x + radius + 6,
            y,
            text=name,
            fill="#212121",
            anchor=tk.W,
            tags=("node", tag),
        )
        self.canvas.tag_bind(
            tag,
            "<ButtonPress-1>",
            lambda event, nid=node_id: self._handle_node_press(event, nid),
        )
        self.canvas.tag_bind(
            tag,
            "<B1-Motion>",
            lambda event, nid=node_id: self._handle_node_drag(event, nid),
        )
        self.canvas.tag_bind(
            tag,
            "<ButtonRelease-1>",
            lambda event, nid=node_id: self._handle_node_release(event, nid),
        )
        self.canvas.tag_bind(
            tag,
            "<Double-Button-1>",
            lambda event, nid=node_id: self._rename_node(nid),
        )

        self.nodes[node_id] = Node(node_id, name, x, y, circle, label)
        if not silent:
            self._update_status(f"Node {name} created. Press 'c' to connect.")
        self._update_scrollregion()
        return node_id

    def _handle_node_press(self, event: tk.Event, node_id: int) -> None:
        if self.mode == "ground":
            self._connect_node_to_ground(node_id)
            return
        if self.mode == "edge":
            self._handle_edge_mode_click(node_id)
            return
        shift_held = bool(event.state & 0x0001)
        if shift_held:
            self._toggle_selection(node_id)
        else:
            self._ensure_selected(node_id)
        self._set_focus_node(node_id)
        self._node_drag_moved = False
        self.dragging_node = node_id
        canvas_x = self.canvas.canvasx(event.x)
        canvas_y = self.canvas.canvasy(event.y)
        node = self.nodes[node_id]
        self.drag_offset = (node.x - canvas_x, node.y - canvas_y)
        self.canvas.tag_raise(node.circle_id)
        self.canvas.tag_raise(node.label_id)
        self._update_status(f"Moving node {node.name}.")

    def _handle_edge_mode_click(self, node_id: int) -> None:
        if self.selected_node is None:
            self.selected_node = node_id
            self._set_focus_node(node_id)
            self._update_status("Select the second node to create the connection.")
            return
        if self.selected_node == node_id:
            self._update_status("Select a different node.")
            return
        first = self.selected_node
        second = node_id
        self._set_focus_node(None)
        self.selected_node = None
        self._create_edge(first, second)

    def _connect_node_to_ground(self, node_id: int) -> None:
        existing = self._find_edge(node_id, GROUND_NODE_ID)
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
        node_name = self.nodes[node_id].name
        dialog = EdgeDialog(
            self.root, node_name, "GND", default_cap or None, default_ind or None
        )
        if dialog.value is None:
            self._update_status("Ground connection cancelled.")
            return
        changed = False
        if existing is not None:
            self._apply_edge_parameters(existing, dialog.value)
            self._update_status(f"Ground connection for {node_name} updated.")
            changed = True
        else:
            self._create_ground_edge(node_id, dialog.value)
            self._update_status(f"Node {node_name} connected to ground.")
            changed = True
        if changed:
            self._push_history()

    def _handle_node_drag(self, event: tk.Event, node_id: int) -> None:
        if self.dragging_node != node_id or self.mode == "edge":
            return
        canvas_x = self.canvas.canvasx(event.x)
        canvas_y = self.canvas.canvasy(event.y)
        offset_x, offset_y = self.drag_offset
        new_x = canvas_x + offset_x
        new_y = canvas_y + offset_y
        self._move_node(node_id, new_x, new_y)
        self._node_drag_moved = True

    def _handle_node_release(self, event: tk.Event, node_id: int) -> None:
        if self.dragging_node != node_id:
            return
        node = self.nodes[node_id]
        self.dragging_node = None
        self._update_status(f"Node {node.name} moved.")
        if self._node_drag_moved:
            self._node_drag_moved = False
            self._push_history()

    def _handle_ground_press(self, event: tk.Event, edge_id: int) -> None:
        if self.mode in {"edge", "ground"}:
            return
        edge = self.edges.get(edge_id)
        if edge is None or not edge.is_ground:
            return
        node = self.nodes.get(edge.nodes[0])
        if node is None:
            return
        self._ground_drag_moved = False
        self._set_focus_node(edge.nodes[0])
        self.dragging_ground_edge = edge_id
        canvas_x = self.canvas.canvasx(event.x)
        canvas_y = self.canvas.canvasy(event.y)
        end_x = node.x + edge.ground_offset_x
        end_y = node.y + edge.ground_offset_y
        self.ground_drag_offset = (canvas_x - end_x, canvas_y - end_y)
        self._update_status("Moving ground connection.")

    def _handle_ground_drag(self, event: tk.Event, edge_id: int) -> None:
        if self.dragging_ground_edge != edge_id:
            return
        edge = self.edges.get(edge_id)
        if edge is None or not edge.is_ground:
            return
        node = self.nodes.get(edge.nodes[0])
        if node is None:
            return
        canvas_x = self.canvas.canvasx(event.x)
        canvas_y = self.canvas.canvasy(event.y)
        offset_x, offset_y = self.ground_drag_offset
        new_end_x = canvas_x - offset_x
        new_end_y = canvas_y - offset_y
        edge.ground_offset_x = new_end_x - node.x
        edge.ground_offset_y = new_end_y - node.y
        self._update_edge_geometry(edge_id)
        self._update_scrollregion()
        self._ground_drag_moved = True

    def _handle_ground_release(self, event: tk.Event, edge_id: int) -> None:
        if self.dragging_ground_edge != edge_id:
            return
        self.dragging_ground_edge = None
        self._update_status("Ground connection moved.")
        if self._ground_drag_moved:
            self._ground_drag_moved = False
            self._push_history()

    def _move_node(self, node_id: int, x: float, y: float) -> None:
        node = self.nodes[node_id]
        node.x = x
        node.y = y
        radius = self._current_node_radius()
        self.canvas.coords(
            node.circle_id,
            x - radius,
            y - radius,
            x + radius,
            y + radius,
        )
        self.canvas.coords(node.label_id, x + radius + 6, y)
        for edge_id, edge in self.edges.items():
            if node_id in edge.nodes:
                self._update_edge_geometry(edge_id)
        self._update_scrollregion()

    def _update_edge_geometry(self, edge_id: int) -> None:
        edge = self.edges[edge_id]
        if edge.is_ground:
            primary_id = edge.nodes[0]
            if primary_id not in self.nodes:
                return
            node = self.nodes[primary_id]
            x = node.x
            y = node.y
            end_x = node.x + edge.ground_offset_x
            end_y = node.y + edge.ground_offset_y
            self.canvas.coords(edge.line_id, x, y, end_x, end_y)
            mid_x = (x + end_x) / 2
            mid_y = (y + end_y) / 2
            radius = self._current_edge_center_radius()
            if edge.center_circle_id is not None:
                self.canvas.coords(
                    edge.center_circle_id,
                    mid_x - radius,
                    mid_y - radius,
                    mid_x + radius,
                    mid_y + radius,
                )
                self.canvas.tag_raise(edge.label_id, edge.center_circle_id)
            if edge.ground_marker_id is not None:
                triangle_points = [
                    end_x - self.GROUND_TRIANGLE_WIDTH / 2,
                    end_y,
                    end_x + self.GROUND_TRIANGLE_WIDTH / 2,
                    end_y,
                    end_x,
                    end_y + self.GROUND_TRIANGLE_HEIGHT,
                ]
                self.canvas.coords(edge.ground_marker_id, *triangle_points)
            self.canvas.coords(edge.label_id, mid_x, mid_y)
            return

        node_a = self.nodes[edge.nodes[0]]
        node_b = self.nodes[edge.nodes[1]]
        self.canvas.coords(edge.line_id, node_a.x, node_a.y, node_b.x, node_b.y)
        center_x = (node_a.x + node_b.x) / 2
        center_y = (node_a.y + node_b.y) / 2
        radius = self._current_edge_center_radius()
        if edge.center_circle_id is not None:
            self.canvas.coords(
                edge.center_circle_id,
                center_x - radius,
                center_y - radius,
                center_x + radius,
                center_y + radius,
            )
            self.canvas.tag_raise(edge.label_id, edge.center_circle_id)
        self.canvas.coords(edge.label_id, center_x, center_y)

    def _edit_edge(self, edge_id: int) -> None:
        edge = self.edges[edge_id]
        first_node = self.nodes[edge.nodes[0]]
        first_name = first_node.name

        if edge.is_ground:
            second_name = "GND"
        else:
            try:
                second_name = self.nodes[edge.nodes[1]].name
            except KeyError:
                second_name = f"Node {edge.nodes[1]}"

        default_cap = edge.capacitance_text or (
            str(edge.capacitance_expr) if edge.capacitance_expr is not None else ""
        )
        default_ind = edge.inductance_text or (
            str(edge.inductance_expr) if edge.inductance_expr is not None else ""
        )
        dialog = EdgeDialog(
            self.root, first_name, second_name, default_cap, default_ind
        )
        if dialog.value is None:
            self._update_status("Connection edit cancelled.")
            return

        if edge.is_ground and (
            dialog.value.capacitance_expr is None
            and dialog.value.inductance_expr is None
            and edge.josephson_inductance_expr is None
        ):
            self._remove_edge(edge_id)
            self._set_focus_node(None)
            self._refresh_all_node_appearances()
            self._push_history()
            self._update_status(f"Ground connection removed from {first_name}.")
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
        self._apply_edge_parameters(edge, params)
        self._update_status("Connection updated.")
        self._push_history()

    def _delete_focused_node(self) -> None:
        if self.focus_node is None:
            if self.selected_nodes:
                candidate = next(iter(self.selected_nodes))
                self._set_focus_node(candidate)
            else:
                self._update_status("Select a node and press Delete to remove it.")
                return
        node_id = self.focus_node
        node = self.nodes.get(node_id)
        if node is None:
            return
        node_name = node.name
        self._remove_node(node_id)
        self._set_focus_node(None)
        self._push_history()
        self._update_status(f"Node {node_name} removed.")

    def _merge_selected_nodes(self) -> None:
        selected_nodes = sorted(self.selected_nodes)
        if len(selected_nodes) < 2:
            self._update_status("Select at least two nodes to merge.")
            return

        survivor_id = (
            self.focus_node
            if self.focus_node is not None and self.focus_node in self.selected_nodes
            else selected_nodes[0]
        )
        merged_snapshot, summary = self._merge_nodes_in_snapshot(
            self._snapshot_state(), survivor_id, set(selected_nodes)
        )
        if summary["merged_nodes"] == 0:
            self._update_status("No nodes were merged.")
            return

        survivor_name = next(
            (
                node["name"]
                for node in merged_snapshot.get("nodes", [])
                if node["identifier"] == survivor_id
            ),
            f"Node {survivor_id}",
        )

        self._restore_state(merged_snapshot)
        self._push_history()

        details: list[str] = []
        if summary["removed_self_loops"]:
            details.append(
                f"removed {summary['removed_self_loops']} internal connection(s)"
            )
        if summary["combined_ground_edges"]:
            details.append(
                f"combined {summary['combined_ground_edges'] + 1} ground connection(s)"
            )

        detail_text = f" ({'; '.join(details)})" if details else ""
        self._update_status(
            f"Merged {len(selected_nodes)} nodes into {survivor_name}.{detail_text}"
        )

    def _remove_node(self, node_id: int) -> None:
        node = self.nodes.pop(node_id, None)
        if node is None:
            return
        self.selected_nodes.discard(node_id)
        self.canvas.delete(node.circle_id)
        self.canvas.delete(node.label_id)
        edges_to_remove = [
            edge_id for edge_id, edge in self.edges.items() if node_id in edge.nodes
        ]
        for edge_id in edges_to_remove:
            self._remove_edge(edge_id)
        self._update_scrollregion()
        self._refresh_all_node_appearances()

    def _remove_edge(self, edge_id: int) -> None:
        edge = self.edges.pop(edge_id, None)
        if edge is None:
            return
        if self.dragging_ground_edge == edge_id:
            self.dragging_ground_edge = None
        self.canvas.delete(edge.line_id)
        if edge.center_circle_id is not None:
            self.canvas.delete(edge.center_circle_id)
        if edge.ground_marker_id is not None:
            self.canvas.delete(edge.ground_marker_id)
        self.canvas.delete(edge.label_id)
        self._update_scrollregion()

    def _duplicate_selection(self) -> None:
        if not self.selected_nodes:
            messagebox.showinfo(
                "Empty selection",
                "Select at least one node to concatenate.",
                parent=self.root,
            )
            return

        selected_nodes = sorted(self.selected_nodes)

        copies = simpledialog.askinteger(
            "Concatenate selection",
            "Number of repeats:",
            initialvalue=1,
            minvalue=1,
            parent=self.root,
        )
        if copies is None:
            return

        min_x = min(self.nodes[nid].x for nid in selected_nodes)
        max_x = max(self.nodes[nid].x for nid in selected_nodes)

        block_width = max_x - min_x
        min_spacing = max(self._current_node_radius() * 4, 40.0 * self.view_scale)
        dx = (
            block_width if block_width > 0 else self._current_node_radius() * 6
        ) + min_spacing
        dy = 0.0

        original_edges = [
            edge
            for edge in self.edges.values()
            if (
                (edge.is_ground and edge.nodes[0] in selected_nodes)
                or (
                    not edge.is_ground
                    and edge.nodes[0] in selected_nodes
                    and edge.nodes[1] in selected_nodes
                )
            )
        ]

        left_nodes = sorted(
            [nid for nid in selected_nodes if abs(self.nodes[nid].x - min_x) < 1e-6],
            key=lambda nid: self.nodes[nid].y,
        )
        right_nodes = sorted(
            [nid for nid in selected_nodes if abs(self.nodes[nid].x - max_x) < 1e-6],
            key=lambda nid: self.nodes[nid].y,
        )
        pair_count = min(len(left_nodes), len(right_nodes))
        left_nodes = left_nodes[:pair_count]
        right_nodes = right_nodes[:pair_count]
        left_index_map = {node_id: idx for idx, node_id in enumerate(left_nodes)}
        current_tail_map: Dict[int, int] = {
            idx: right_nodes[idx] for idx in range(pair_count)
        }
        left_boundary_set = set(left_nodes)

        all_new_nodes: list[int] = []

        for replica_index in range(1, copies + 1):
            mapping: Dict[int, int] = {}
            shift_x = dx * replica_index
            shift_y = dy * replica_index

            for node_id in selected_nodes:
                original = self.nodes[node_id]
                idx = left_index_map.get(node_id)
                if idx is not None:
                    mapping[node_id] = current_tail_map[idx]
                else:
                    new_name = self._generate_default_node_name()
                    new_node_id = self._add_node(
                        original.x + shift_x,
                        original.y + shift_y,
                        new_name,
                        silent=True,
                    )
                    mapping[node_id] = new_node_id
                    all_new_nodes.append(new_node_id)

            for edge in original_edges:
                params = EdgeParameters(
                    capacitance_expr=edge.capacitance_expr,
                    capacitance_text=edge.capacitance_text,
                    inductance_expr=edge.inductance_expr,
                    inductance_text=edge.inductance_text,
                    josephson_inductance_expr=edge.josephson_inductance_expr,
                    josephson_inductance_text=edge.josephson_inductance_text,
                    josephson_phase_sign=edge.josephson_phase_sign,
                )
                if edge.is_ground:
                    source_idx = left_index_map.get(edge.nodes[0])
                    source_id = mapping.get(edge.nodes[0])
                    if source_id is not None and not (
                        source_idx is not None
                        and source_id == current_tail_map[source_idx]
                    ):
                        self._instantiate_ground_edge(
                            source_id,
                            params,
                            offset_x=edge.ground_offset_x,
                            offset_y=edge.ground_offset_y,
                        )
                else:
                    first_new = mapping.get(edge.nodes[0])
                    second_new = mapping.get(edge.nodes[1])
                    if first_new is not None and second_new is not None:
                        self._instantiate_edge(first_new, second_new, params)

            for idx, right_original in enumerate(right_nodes):
                tail_candidate = mapping.get(right_original)
                if tail_candidate is not None:
                    current_tail_map[idx] = tail_candidate

        self.selected_nodes = set(all_new_nodes)
        if all_new_nodes:
            self._set_focus_node(all_new_nodes[-1])
        else:
            self._set_focus_node(None)
        self._refresh_all_node_appearances()
        self._update_scrollregion()
        self._push_history()
        self._update_status("Concatenation complete.")

    def _apply_edge_parameters(self, edge: Edge, params: EdgeParameters) -> None:
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
        edge.josephson_phase_sign = (
            -1 if params.josephson_phase_sign == -1 else 1
        )
        self.canvas.itemconfigure(
            edge.label_id,
            text=self._edge_label(
                edge.capacitance_expr,
                edge.capacitance_text,
                edge.inductance_expr,
                edge.inductance_text,
                edge.josephson_inductance_expr,
                edge.josephson_inductance_text,
            ),
        )
        self._update_edge_geometry(edge.identifier)

    def _rename_node(self, node_id: int) -> None:
        node = self.nodes[node_id]
        new_name = simpledialog.askstring(
            "Renombrar nodo",
            "Nuevo nombre:",
            initialvalue=node.name,
            parent=self.root,
        )
        if not new_name:
            return
        new_name = new_name.strip()
        if not new_name or new_name == node.name:
            return
        node.name = new_name
        self.canvas.itemconfigure(node.label_id, text=new_name)
        self._update_status(f"Node renamed to {new_name}.")
        self._push_history()

    def _instantiate_edge(
        self,
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
            edge_id = self.edge_counter
            self.edge_counter += 1
        else:
            edge_id = forced_id
            self.edge_counter = max(self.edge_counter, edge_id + 1)
        tag = f"edge_{edge_id}"
        x1, y1 = self.nodes[first].x, self.nodes[first].y
        x2, y2 = self.nodes[second].x, self.nodes[second].y
        line = self.canvas.create_line(
            x1, y1, x2, y2, width=2, fill="#424242", tags=("edge", tag)
        )
        radius = self._current_edge_center_radius()
        center_x = (x1 + x2) / 2
        center_y = (y1 + y2) / 2
        circle = self.canvas.create_oval(
            center_x - radius,
            center_y - radius,
            center_x + radius,
            center_y + radius,
            fill="#f5f5f5",
            outline="#424242",
            width=2,
            tags=("edge", tag),
        )
        label = self.canvas.create_text(
            center_x,
            center_y,
            text="",
            fill="#212121",
            justify=tk.CENTER,
            tags=("edge", tag),
        )
        if circle is not None:
            self.canvas.tag_raise(label, circle)
        self.edges[edge_id] = Edge(
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
        self.canvas.tag_bind(
            tag,
            "<Double-Button-1>",
            lambda event, eid=edge_id: self._edit_edge(eid),
        )
        self._apply_edge_parameters(self.edges[edge_id], params)
        self._update_scrollregion()
        return edge_id

    def _create_edge(self, first: int, second: int) -> None:
        first_name = self.nodes[first].name
        second_name = self.nodes[second].name
        existing = self._find_edge(first, second)
        if existing is not None:
            if not messagebox.askyesno(
                "Enlace existente",
                "A connection between these nodes already exists.\nDo you want to create another one in parallel?",
                parent=self.root,
            ):
                self._update_status("Original connection maintained.")
                return
        dialog = EdgeDialog(self.root, first_name, second_name)
        if dialog.value is None:
            self._update_status("Connection cancelled.")
            return
        self._instantiate_edge(first, second, dialog.value)
        self._update_status(
            "Connection created. Press 'c' for another or Esc to exit mode."
        )
        self._push_history()

    def _instantiate_ground_edge(
        self,
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
            edge_id = self.edge_counter
            self.edge_counter += 1
        else:
            edge_id = forced_id
            self.edge_counter = max(self.edge_counter, edge_id + 1)
        tag = f"edge_{edge_id}"
        node = self.nodes[node_id]
        start_x = node.x
        start_y = node.y
        if offset_y is None:
            offset_y = self.GROUND_LINE_LENGTH
        end_x = start_x + offset_x
        end_y = start_y + offset_y
        line = self.canvas.create_line(
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
        radius = self._current_edge_center_radius()
        circle = self.canvas.create_oval(
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
            end_x - self.GROUND_TRIANGLE_WIDTH / 2,
            end_y,
            end_x + self.GROUND_TRIANGLE_WIDTH / 2,
            end_y,
            end_x,
            end_y + self.GROUND_TRIANGLE_HEIGHT,
        ]
        triangle = self.canvas.create_polygon(
            triangle_points,
            fill="#f5f5f5",
            outline="#424242",
            width=2,
            tags=("edge", tag),
        )
        label = self.canvas.create_text(
            mid_x,
            mid_y,
            text="",
            fill="#212121",
            justify=tk.CENTER,
            anchor=tk.CENTER,
            tags=("edge", tag),
        )
        self.canvas.tag_raise(label, circle)
        self.edges[edge_id] = Edge(
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
        self.canvas.tag_bind(
            tag,
            "<Double-Button-1>",
            lambda event, eid=edge_id: self._edit_edge(eid),
        )
        for item in (line, circle, triangle, label):
            self.canvas.tag_bind(
                item,
                "<ButtonPress-1>",
                lambda event, eid=edge_id: self._handle_ground_press(event, eid),
            )
            self.canvas.tag_bind(
                item,
                "<B1-Motion>",
                lambda event, eid=edge_id: self._handle_ground_drag(event, eid),
            )
            self.canvas.tag_bind(
                item,
                "<ButtonRelease-1>",
                lambda event, eid=edge_id: self._handle_ground_release(event, eid),
            )
        self._apply_edge_parameters(self.edges[edge_id], params)
        self._update_scrollregion()
        return edge_id

    def _create_ground_edge(self, node_id: int, params: EdgeParameters) -> None:
        self._instantiate_ground_edge(node_id, params)

    @staticmethod
    def _sum_optional_expressions(
        expressions: list[Optional[sp.Expr]],
    ) -> Optional[sp.Expr]:
        return desktop_merge.sum_optional_expressions(expressions)

    @staticmethod
    def _inverse_inductance_expr(
        inductance_expr: Optional[sp.Expr],
    ) -> Optional[sp.Expr]:
        return desktop_merge.inverse_inductance_expr(inductance_expr)

    @classmethod
    def _combine_ground_edges_in_snapshot(
        cls, ground_edges: list[dict]
    ) -> Optional[dict]:
        return desktop_merge.combine_ground_edges_in_snapshot(ground_edges)

    @classmethod
    def _merge_nodes_in_snapshot(
        cls, snapshot: dict, survivor_id: int, selected_nodes: set[int]
    ) -> tuple[dict, dict[str, int]]:
        return desktop_merge.merge_nodes_in_snapshot(
            snapshot, survivor_id, selected_nodes
        )

    def _snapshot_state(self) -> dict:
        return desktop_project_state.snapshot_state(self)

    def _project_content_snapshot(self, snapshot: Optional[dict] = None) -> dict:
        return desktop_project_state.project_content_snapshot(self, snapshot)

    def _mark_project_clean(self) -> None:
        desktop_project_state.mark_project_clean(self)

    def _update_dirty_state(self, snapshot: Optional[dict] = None) -> None:
        desktop_project_state.update_dirty_state(self, snapshot)

    def _has_unsaved_changes(self) -> bool:
        return desktop_project_state.has_unsaved_changes(self)

    def _restore_state(self, snapshot: dict) -> None:
        desktop_project_state.restore_state(self, snapshot)

    def _expr_to_string(self, expr: Optional[sp.Expr]) -> Optional[str]:
        return desktop_project_state.expr_to_string(expr)

    def _expr_from_string(self, text: Optional[str]) -> Optional[sp.Expr]:
        return desktop_project_state.expr_from_string(
            text, parent=self.root, messagebox_module=messagebox
        )

    def _push_history(self) -> None:
        desktop_project_state.push_history(self)

    def _undo(self) -> None:
        desktop_project_state.undo(self)

    def _save_project(self) -> bool:
        return desktop_project_state.save_project(self, filedialog, messagebox)

    def _load_project(self) -> None:
        desktop_project_state.load_project(self, filedialog, messagebox)

    def _edge_label(
        self,
        capacitance_expr: Optional[sp.Expr],
        capacitance_text: Optional[str],
        inductance_expr: Optional[sp.Expr],
        inductance_text: Optional[str],
        josephson_inductance_expr: Optional[sp.Expr] = None,
        josephson_inductance_text: Optional[str] = None,
    ) -> str:
        parts: list[str] = []
        cap_display = self._expression_to_display(capacitance_expr, capacitance_text)
        ind_display = self._expression_to_display(inductance_expr, inductance_text)
        josephson_display = self._expression_to_display(
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

    def _expression_to_display(
        self, expr: Optional[sp.Expr], raw_text: Optional[str]
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

    def _find_edge(self, first: int, second: int) -> Edge | None:
        for edge in self.edges.values():
            if edge.is_ground:
                if {first, second} == {edge.nodes[0], edge.nodes[1]}:
                    return edge
            else:
                if set(edge.nodes) == {first, second}:
                    return edge
        return None

    def _refresh_node_appearance(self, node_id: int) -> None:
        desktop_selection.refresh_node_appearance(self, node_id)

    def _refresh_all_node_appearances(self) -> None:
        desktop_selection.refresh_all_node_appearances(self)

    def _clear_selection(self) -> None:
        desktop_selection.clear_selection(self)

    def _toggle_selection(self, node_id: int) -> None:
        desktop_selection.toggle_selection(self, node_id)

    def _ensure_selected(self, node_id: int) -> None:
        desktop_selection.ensure_selected(self, node_id)

    def _copy_selection(self) -> None:
        desktop_selection.copy_selection(self)

    def _set_focus_node(self, node_id: Optional[int]) -> None:
        desktop_selection.set_focus_node(self, node_id)

    def _start_marquee(self, x: float, y: float) -> None:
        desktop_selection.start_marquee(self, x, y)

    def _update_marquee(self, x: float, y: float) -> None:
        desktop_selection.update_marquee(self, x, y)

    def _finish_marquee(self, x: float, y: float) -> None:
        desktop_selection.finish_marquee(self, x, y)

    def _start_paste_preview_fake(self) -> None:
        desktop_selection.start_paste_preview_fake(self)

    def _start_paste_preview(self, event: tk.Event) -> None:
        desktop_selection.start_paste_preview(self, event)

    def _update_paste_preview(self, event: tk.Event) -> None:
        desktop_selection.update_paste_preview(self, event)

    def _complete_paste_preview(self, canvas_x: float, canvas_y: float) -> None:
        desktop_selection.complete_paste_preview(self, canvas_x, canvas_y)

    def _cancel_paste_preview_event(self, event: tk.Event) -> None:
        desktop_selection.cancel_paste_preview_event(self, event)

    def _cancel_paste_preview(self, message: Optional[str] = None) -> None:
        desktop_selection.cancel_paste_preview(self, message)

    def _set_mode(self, mode: Optional[str]) -> None:
        if self.selected_node is not None:
            self._set_focus_node(None)
        self.selected_node = None
        self.mode = mode
        if mode == "node":
            self._update_status("Node mode: click on the canvas to create one.")
        elif mode == "edge":
            self._set_focus_node(None)
            self._update_status("Edge mode: select two existing nodes.")
        elif mode == "ground":
            self._set_focus_node(None)
            self._update_status("Ground mode: select a node to connect to ground.")
        else:
            self._update_status("Neutral mode. Press 'n', 'c' or 'g' to continue.")

    def _reset_all(self) -> None:
        if not self.nodes and not self.edges:
            return
        if not messagebox.askyesno(
            "Reset", "Delete all nodes and connections?", parent=self.root
        ):
            return
        self.canvas.delete("all")
        self.nodes.clear()
        self.edges.clear()
        self.node_counter = 0
        self.edge_counter = 0
        self._set_mode(None)
        self._update_status("Workspace cleared. Press 'n' to create nodes.")
        self._push_history()
        self._mark_project_clean()

    @staticmethod
    def _accumulate_matrix_entry(
        entries: MatrixEntries, row: int, col: int, value: sp.Expr
    ) -> None:
        accumulate_matrix_entry(entries, row, col, value)

    @staticmethod
    def _finalize_matrix_entries(entries: MatrixEntries) -> MatrixEntries:
        return finalize_matrix_entries(entries)

    def _core_edges(self) -> list[CircuitEdgeData]:
        return [
            CircuitEdgeData(
                nodes=edge.nodes,
                capacitance_expr=edge.capacitance_expr,
                l_inverse_expr=edge.l_inverse_expr,
                identifier=edge.identifier,
                josephson_inductance_expr=edge.josephson_inductance_expr,
                josephson_phase_sign=edge.josephson_phase_sign,
            )
            for edge in self.edges.values()
        ]

    def _compute_matrix_entries(self) -> Tuple[int, MatrixEntries, MatrixEntries]:
        return compute_matrix_entries(self.nodes.keys(), self._core_edges())

    def _compute_matrix_branches(self) -> Tuple[int, MatrixBranches, MatrixBranches]:
        return compute_matrix_branches(self.nodes.keys(), self._core_edges())

    def _compute_matrices(self) -> Tuple[sp.Matrix, sp.Matrix]:
        return compute_matrices(self.nodes.keys(), self._core_edges())

    def _build_snippet(self) -> str:
        size, c_branches, l_inv_branches = self._compute_matrix_branches()
        josephson_branches = compute_josephson_branches(
            self.nodes.keys(),
            self._core_edges(),
        )
        matrix_nodes = matrix_node_records(
            self.nodes.keys(),
            {node_id: node.name for node_id, node in self.nodes.items()},
        )
        return build_snippet(
            size,
            c_branches,
            l_inv_branches,
            josephson_branches,
            matrix_nodes,
        )

    def _copy_snippet(self) -> None:
        if not self.nodes:
            messagebox.showinfo(
                "No data",
                "Create at least one node to generate the matrices.",
                parent=self.root,
            )
            return
        snippet = self._build_snippet()
        self.root.clipboard_clear()
        self.root.clipboard_append(snippet)
        self._update_status("Snippet copied to clipboard.")

    def _on_close_requested(self) -> None:
        if not self._has_unsaved_changes():
            self.root.destroy()
            return

        action = self._ask_save_before_close()
        if action == "cancel":
            return
        if action == "save" and not self._save_project():
            return
        if action not in {"save", "discard"}:
            return
        self.root.destroy()

    def _ask_save_before_close(self) -> str:
        dialog = tk.Toplevel(self.root)
        dialog.title("Unsaved changes")
        dialog.transient(self.root)
        dialog.resizable(False, False)

        result = {"action": "cancel"}

        def choose(action: str) -> None:
            result["action"] = action
            dialog.destroy()

        frame = ttk.Frame(dialog, padding=16)
        frame.grid(row=0, column=0, sticky="nsew")
        ttk.Label(
            frame,
            text="Save changes before closing?",
            font=("", 12, "bold"),
        ).grid(row=0, column=0, sticky=tk.W)
        ttk.Label(
            frame,
            text="Your current drawing has unsaved changes.",
        ).grid(row=1, column=0, sticky=tk.W, pady=(6, 12))

        buttons = ttk.Frame(frame)
        buttons.grid(row=2, column=0, sticky=tk.E)
        ttk.Button(
            buttons, text="Save", command=lambda: choose("save")
        ).pack(side=tk.LEFT, padx=(0, 6))
        ttk.Button(
            buttons, text="Don't Save", command=lambda: choose("discard")
        ).pack(side=tk.LEFT, padx=(0, 6))
        cancel_button = ttk.Button(
            buttons, text="Cancel", command=lambda: choose("cancel")
        )
        cancel_button.pack(side=tk.LEFT)

        dialog.protocol("WM_DELETE_WINDOW", lambda: choose("cancel"))
        dialog.bind("<Escape>", lambda _event: choose("cancel"))
        dialog.grab_set()
        cancel_button.focus_set()
        dialog.wait_window()
        return result["action"]

    def _update_status(self, message: str) -> None:
        self.status_var.set(message)

    def run(self) -> None:
        self.root.mainloop()


def main() -> None:
    app = CircuitGraphApp()
    app.run()


if __name__ == "__main__":
    main()
