import json

import numpy as np
import sympy as sp
from scipy import sparse

import cqedraw.app as app_module
from cqedraw.app import CircuitGraphApp, Edge, GROUND_NODE_ID, Node
from cqedraw.core import (
    CircuitEdgeData,
    build_snippet,
    compute_matrix_branches,
    compute_matrices,
    compute_matrix_entries,
    matrix_node_records,
)


def _make_app() -> CircuitGraphApp:
    app = CircuitGraphApp.__new__(CircuitGraphApp)
    app.nodes = {
        10: Node(10, "N1", 0.0, 0.0, 0, 0),
        11: Node(11, "N2", 0.0, 0.0, 0, 0),
        15: Node(15, "N3", 0.0, 0.0, 0, 0),
    }

    c1 = sp.Symbol("C1")
    c2 = sp.Symbol("C2")
    cg = sp.Symbol("Cg")
    l1_inv = sp.Symbol("L1_inv")
    lg_inv = sp.Symbol("Lg_inv")

    app.edges = {
        0: Edge(
            0,
            (10, 11),
            0,
            None,
            0,
            c1,
            "C1",
            None,
            None,
            l1_inv,
        ),
        1: Edge(
            1,
            (11, 10),
            0,
            None,
            0,
            c2,
            "C2",
            None,
            None,
            None,
        ),
        2: Edge(
            2,
            (15, GROUND_NODE_ID),
            0,
            None,
            0,
            cg,
            "Cg",
            None,
            None,
            lg_inv,
            is_ground=True,
        ),
    }
    return app


class _DummyRoot:
    def __init__(self) -> None:
        self.destroyed = False

    def destroy(self) -> None:
        self.destroyed = True


class _DummyStatusVar:
    def __init__(self) -> None:
        self.value = ""

    def set(self, value: str) -> None:
        self.value = value


def _make_empty_project_app() -> CircuitGraphApp:
    app = CircuitGraphApp.__new__(CircuitGraphApp)
    app.nodes = {}
    app.edges = {}
    app.node_counter = 0
    app.edge_counter = 0
    app.view_scale = 1.0
    app.selected_nodes = set()
    app.focus_node = None
    app.selected_node = None
    app.mode = None
    app.history = []
    app._history_suspended = False
    app._clean_project_snapshot = None
    app._project_dirty = False
    app.root = _DummyRoot()
    app.status_var = _DummyStatusVar()
    return app


def _add_project_node(app: CircuitGraphApp) -> None:
    app.nodes[1] = Node(1, "N1", 10.0, 20.0, 0, 0)
    app.node_counter = 2


def test_dirty_state_tracks_project_content_not_empty_ui_state():
    app = _make_empty_project_app()
    app._mark_project_clean()

    app.view_scale = 2.0
    app.node_counter = 5
    app.edge_counter = 3
    assert not app._has_unsaved_changes()

    _add_project_node(app)
    assert app._has_unsaved_changes()

    app._mark_project_clean()
    assert not app._has_unsaved_changes()

    app.nodes[1].x = 24.0
    assert app._has_unsaved_changes()


def test_save_project_marks_current_content_clean(tmp_path, monkeypatch):
    app = _make_empty_project_app()
    app._mark_project_clean()
    _add_project_node(app)
    save_path = tmp_path / "project.json"
    monkeypatch.setattr(
        app_module.filedialog,
        "asksaveasfilename",
        lambda **_kwargs: str(save_path),
    )

    assert app._save_project() is True
    assert not app._has_unsaved_changes()
    assert json.loads(save_path.read_text())["state"]["nodes"][0]["name"] == "N1"

    app.nodes[1].y = 32.0
    assert app._has_unsaved_changes()


def test_cancelled_save_keeps_project_dirty(monkeypatch):
    app = _make_empty_project_app()
    app._mark_project_clean()
    _add_project_node(app)
    monkeypatch.setattr(
        app_module.filedialog,
        "asksaveasfilename",
        lambda **_kwargs: "",
    )

    assert app._save_project() is False
    assert app._has_unsaved_changes()


def test_load_project_marks_loaded_content_clean(tmp_path, monkeypatch):
    app = _make_empty_project_app()
    app._mark_project_clean()
    _add_project_node(app)
    load_path = tmp_path / "loaded.json"
    loaded_state = {
        "node_counter": 8,
        "edge_counter": 0,
        "view_scale": 1.0,
        "nodes": [{"identifier": 7, "name": "Loaded", "x": 1.0, "y": 2.0}],
        "edges": [],
        "selected_nodes": [],
        "focus_node": None,
        "selected_node": None,
        "mode": None,
    }
    load_path.write_text(json.dumps({"version": 1, "state": loaded_state}))
    monkeypatch.setattr(
        app_module.filedialog,
        "askopenfilename",
        lambda **_kwargs: str(load_path),
    )

    def restore_state(state: dict) -> None:
        app.nodes = {
            node["identifier"]: Node(
                node["identifier"],
                node["name"],
                node["x"],
                node["y"],
                0,
                0,
            )
            for node in state["nodes"]
        }
        app.edges = {}
        app.node_counter = state["node_counter"]
        app.edge_counter = state["edge_counter"]
        app.view_scale = state["view_scale"]
        app.selected_nodes = set(state["selected_nodes"])
        app.focus_node = state["focus_node"]
        app.selected_node = state["selected_node"]
        app.mode = state["mode"]

    app._restore_state = restore_state

    app._load_project()

    assert not app._has_unsaved_changes()
    app.nodes[7].name = "Changed"
    assert app._has_unsaved_changes()


def test_close_handler_destroys_clean_window_without_prompt():
    app = _make_empty_project_app()
    app._mark_project_clean()

    def fail_prompt() -> str:
        raise AssertionError("clean projects should not prompt on close")

    app._ask_save_before_close = fail_prompt

    app._on_close_requested()

    assert app.root.destroyed


def test_close_handler_cancel_keeps_dirty_window_open():
    app = _make_empty_project_app()
    app._mark_project_clean()
    _add_project_node(app)
    app._ask_save_before_close = lambda: "cancel"
    app._save_project = lambda: True

    app._on_close_requested()

    assert not app.root.destroyed


def test_close_handler_discard_destroys_dirty_window_without_save():
    app = _make_empty_project_app()
    app._mark_project_clean()
    _add_project_node(app)
    saves = []
    app._ask_save_before_close = lambda: "discard"
    app._save_project = lambda: saves.append(True) or True

    app._on_close_requested()

    assert app.root.destroyed
    assert saves == []


def test_close_handler_save_success_destroys_dirty_window():
    app = _make_empty_project_app()
    app._mark_project_clean()
    _add_project_node(app)
    saves = []
    app._ask_save_before_close = lambda: "save"
    app._save_project = lambda: saves.append(True) or True

    app._on_close_requested()

    assert app.root.destroyed
    assert saves == [True]


def test_close_handler_cancelled_save_keeps_dirty_window_open():
    app = _make_empty_project_app()
    app._mark_project_clean()
    _add_project_node(app)
    saves = []
    app._ask_save_before_close = lambda: "save"
    app._save_project = lambda: saves.append(True) or False

    app._on_close_requested()

    assert not app.root.destroyed
    assert saves == [True]


def test_compute_matrix_entries_accumulates_sparse_contributions():
    app = _make_app()

    size, c_entries, l_inv_entries = app._compute_matrix_entries()

    c_total = sp.Symbol("C1") + sp.Symbol("C2")
    assert size == 3
    assert sp.simplify(c_entries[(0, 0)] - c_total) == 0
    assert sp.simplify(c_entries[(1, 1)] - c_total) == 0
    assert sp.simplify(c_entries[(0, 1)] + c_total) == 0
    assert sp.simplify(c_entries[(1, 0)] + c_total) == 0
    assert sp.simplify(c_entries[(2, 2)] - sp.Symbol("Cg")) == 0

    assert sp.simplify(l_inv_entries[(0, 0)] - sp.Symbol("L1_inv")) == 0
    assert sp.simplify(l_inv_entries[(1, 1)] - sp.Symbol("L1_inv")) == 0
    assert sp.simplify(l_inv_entries[(0, 1)] + sp.Symbol("L1_inv")) == 0
    assert sp.simplify(l_inv_entries[(1, 0)] + sp.Symbol("L1_inv")) == 0
    assert sp.simplify(l_inv_entries[(2, 2)] - sp.Symbol("Lg_inv")) == 0


def test_app_matrix_wrappers_delegate_to_core_output_logic():
    app = _make_app()
    core_edges = [
        CircuitEdgeData(
            nodes=edge.nodes,
            capacitance_expr=edge.capacitance_expr,
            l_inverse_expr=edge.l_inverse_expr,
        )
        for edge in app.edges.values()
    ]
    size, c_entries, l_inv_entries = compute_matrix_entries(
        app.nodes.keys(), core_edges
    )
    branch_size, c_branches, l_inv_branches = compute_matrix_branches(
        app.nodes.keys(), core_edges
    )

    assert app._compute_matrix_entries() == (size, c_entries, l_inv_entries)
    assert app._compute_matrix_branches() == (
        branch_size,
        c_branches,
        l_inv_branches,
    )
    assert app._compute_matrices() == compute_matrices(app.nodes.keys(), core_edges)
    matrix_nodes = matrix_node_records(
        app.nodes.keys(),
        {node_id: node.name for node_id, node in app.nodes.items()},
    )
    assert app._build_snippet() == build_snippet(
        branch_size, c_branches, l_inv_branches, matrix_nodes=matrix_nodes
    )


def _numeric_matrix(
    sympy_matrix: sp.Matrix, substitutions: dict[sp.Symbol, float]
) -> np.ndarray:
    return np.array(sympy_matrix.subs(substitutions).tolist(), dtype=float)


def test_build_snippet_matches_computed_c_and_l_inverse_matrices():
    app = _make_app()
    c_matrix, l_inv_matrix = app._compute_matrices()
    snippet = app._build_snippet()

    assert "from scipy import sparse" in snippet
    assert "def circuit_matrices" in snippet
    assert "def capacitance_matrix" in snippet
    assert "def inverse_inductance_matrix" in snippet
    assert "NODE_INDEX_MAP" in snippet
    assert "np.zeros" not in snippet
    assert "_func" not in snippet

    namespace: dict[str, object] = {}
    exec(snippet, namespace)

    assert namespace["NODE_INDEX_MAP"] == {10: 0, 11: 1, 15: 2}
    assert namespace["NODE_NAME_MAP"] == {10: "N1", 11: "N2", 15: "N3"}

    params = {"C1": 1.0, "C2": 2.0, "Cg": 3.0, "L1_inv": 4.0, "Lg_inv": 5.0}

    c_expected = _numeric_matrix(
        c_matrix,
        {
            sp.Symbol("C1"): params["C1"],
            sp.Symbol("C2"): params["C2"],
            sp.Symbol("Cg"): params["Cg"],
        },
    )
    l_expected = _numeric_matrix(
        l_inv_matrix,
        {
            sp.Symbol("L1_inv"): params["L1_inv"],
            sp.Symbol("Lg_inv"): params["Lg_inv"],
        },
    )

    c_sparse, l_sparse = namespace["circuit_matrices"](params)
    c_only = namespace["capacitance_matrix"](params)
    l_only = namespace["inverse_inductance_matrix"](params)

    assert sparse.isspmatrix_csr(c_sparse)
    assert sparse.isspmatrix_csr(l_sparse)
    assert np.allclose(c_sparse.toarray(), c_expected)
    assert np.allclose(l_sparse.toarray(), l_expected)
    assert np.allclose(c_only.toarray(), c_expected)
    assert np.allclose(l_only.toarray(), l_expected)


def test_merge_nodes_in_snapshot_rewires_edges_and_combines_ground_connections():
    c12 = sp.Symbol("C12")
    c13 = sp.Symbol("C13")
    c23 = sp.Symbol("C23")
    cg1 = sp.Symbol("Cg1")
    cg2 = sp.Symbol("Cg2")
    l1 = sp.Symbol("L1")
    l2 = sp.Symbol("L2")
    l1_inv = sp.simplify(1 / l1)
    l2_inv = sp.simplify(1 / l2)

    snapshot = {
        "node_counter": 4,
        "edge_counter": 15,
        "view_scale": 1.0,
        "nodes": [
            {"identifier": 1, "name": "N1", "x": 0.0, "y": 0.0},
            {"identifier": 2, "name": "N2", "x": 10.0, "y": 0.0},
            {"identifier": 3, "name": "N3", "x": 20.0, "y": 0.0},
        ],
        "edges": [
            {
                "identifier": 10,
                "nodes": [1, 2],
                "capacitance_expr": c12,
                "capacitance_text": "C12",
                "inductance_expr": None,
                "inductance_text": None,
                "l_inverse_expr": None,
                "is_ground": False,
                "ground_offset_x": 0.0,
                "ground_offset_y": 0.0,
            },
            {
                "identifier": 11,
                "nodes": [2, 3],
                "capacitance_expr": c23,
                "capacitance_text": "C23",
                "inductance_expr": None,
                "inductance_text": None,
                "l_inverse_expr": None,
                "is_ground": False,
                "ground_offset_x": 0.0,
                "ground_offset_y": 0.0,
            },
            {
                "identifier": 12,
                "nodes": [1, 3],
                "capacitance_expr": c13,
                "capacitance_text": "C13",
                "inductance_expr": None,
                "inductance_text": None,
                "l_inverse_expr": None,
                "is_ground": False,
                "ground_offset_x": 0.0,
                "ground_offset_y": 0.0,
            },
            {
                "identifier": 13,
                "nodes": [1, GROUND_NODE_ID],
                "capacitance_expr": cg1,
                "capacitance_text": "Cg1",
                "inductance_expr": l1,
                "inductance_text": "L1",
                "l_inverse_expr": l1_inv,
                "is_ground": True,
                "ground_offset_x": 0.0,
                "ground_offset_y": 104.0,
            },
            {
                "identifier": 14,
                "nodes": [2, GROUND_NODE_ID],
                "capacitance_expr": cg2,
                "capacitance_text": "Cg2",
                "inductance_expr": l2,
                "inductance_text": "L2",
                "l_inverse_expr": l2_inv,
                "is_ground": True,
                "ground_offset_x": 20.0,
                "ground_offset_y": 104.0,
            },
        ],
        "selected_nodes": [1, 2],
        "focus_node": 1,
        "selected_node": None,
        "mode": None,
    }

    merged_snapshot, summary = CircuitGraphApp._merge_nodes_in_snapshot(
        snapshot, 1, {1, 2}
    )

    assert {node["identifier"] for node in merged_snapshot["nodes"]} == {1, 3}
    assert merged_snapshot["selected_nodes"] == [1]
    assert merged_snapshot["focus_node"] == 1
    assert merged_snapshot["selected_node"] is None

    non_ground_edges = [
        edge for edge in merged_snapshot["edges"] if not edge.get("is_ground")
    ]
    ground_edges = [edge for edge in merged_snapshot["edges"] if edge.get("is_ground")]

    assert len(non_ground_edges) == 2
    assert sorted(tuple(edge["nodes"]) for edge in non_ground_edges) == [(1, 3), (1, 3)]

    assert len(ground_edges) == 1
    ground_edge = ground_edges[0]
    assert ground_edge["identifier"] == 13
    assert ground_edge["nodes"] == [1, GROUND_NODE_ID]
    assert sp.simplify(ground_edge["capacitance_expr"] - (cg1 + cg2)) == 0
    assert sp.simplify(ground_edge["l_inverse_expr"] - (l1_inv + l2_inv)) == 0
    assert (
        sp.simplify(ground_edge["inductance_expr"] - sp.simplify(1 / (l1_inv + l2_inv)))
        == 0
    )

    assert summary == {
        "merged_nodes": 1,
        "rewired_edges": 3,
        "removed_self_loops": 1,
        "combined_ground_edges": 1,
    }


def test_merge_nodes_in_snapshot_keeps_parallel_non_ground_edges():
    c13 = sp.Symbol("C13")
    c23 = sp.Symbol("C23")

    snapshot = {
        "node_counter": 4,
        "edge_counter": 13,
        "view_scale": 1.0,
        "nodes": [
            {"identifier": 1, "name": "N1", "x": 0.0, "y": 0.0},
            {"identifier": 2, "name": "N2", "x": 10.0, "y": 0.0},
            {"identifier": 3, "name": "N3", "x": 20.0, "y": 0.0},
        ],
        "edges": [
            {
                "identifier": 11,
                "nodes": [2, 3],
                "capacitance_expr": c23,
                "capacitance_text": "C23",
                "inductance_expr": None,
                "inductance_text": None,
                "l_inverse_expr": None,
                "is_ground": False,
                "ground_offset_x": 0.0,
                "ground_offset_y": 0.0,
            },
            {
                "identifier": 12,
                "nodes": [1, 3],
                "capacitance_expr": c13,
                "capacitance_text": "C13",
                "inductance_expr": None,
                "inductance_text": None,
                "l_inverse_expr": None,
                "is_ground": False,
                "ground_offset_x": 0.0,
                "ground_offset_y": 0.0,
            },
        ],
        "selected_nodes": [1, 2],
        "focus_node": 1,
        "selected_node": None,
        "mode": None,
    }

    merged_snapshot, summary = CircuitGraphApp._merge_nodes_in_snapshot(
        snapshot, 1, {1, 2}
    )

    non_ground_edges = [
        edge for edge in merged_snapshot["edges"] if not edge.get("is_ground")
    ]
    assert len(non_ground_edges) == 2
    assert sorted(edge["identifier"] for edge in non_ground_edges) == [11, 12]
    assert sorted(tuple(edge["nodes"]) for edge in non_ground_edges) == [(1, 3), (1, 3)]
    assert summary["combined_ground_edges"] == 0
