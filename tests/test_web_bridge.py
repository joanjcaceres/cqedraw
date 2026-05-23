import json
import sys
import types

import numpy as np

from cqedraw.web_bridge import (
    analyze_modal,
    analyze_modal_json,
    generate_output,
    generate_output_json,
    normalize_project,
)


def _web_project() -> dict:
    return {
        "version": 1,
        "state": {
            "node_counter": 16,
            "edge_counter": 8,
            "view_scale": 1.0,
            "nodes": [
                {"identifier": 15, "name": "N3", "x": 240.0, "y": 140.0},
                {"identifier": 10, "name": "N1", "x": 80.0, "y": 140.0},
                {"identifier": 11, "name": "N2", "x": 160.0, "y": 140.0},
            ],
            "edges": [
                {
                    "identifier": 1,
                    "nodes": [10, 11],
                    "capacitance_text": "C_beta",
                    "inductance_text": "1/L_beta_inv",
                    "is_ground": False,
                },
                {
                    "identifier": 2,
                    "nodes": [11, 10],
                    "capacitance_text": "C_alpha",
                    "inductance_text": "1/L_alpha_inv",
                    "is_ground": False,
                },
                {
                    "identifier": 3,
                    "nodes": [11, 15],
                    "capacitance_text": "C_cancel",
                    "inductance_text": None,
                    "is_ground": False,
                },
                {
                    "identifier": 4,
                    "nodes": [11, 15],
                    "capacitance_text": "-C_cancel",
                    "inductance_text": None,
                    "is_ground": False,
                },
                {
                    "identifier": 5,
                    "nodes": [15, -1],
                    "capacitance_text": "C_ground",
                    "inductance_text": "1/L_ground_inv",
                    "is_ground": True,
                    "ground_offset_x": 0.0,
                    "ground_offset_y": 104.0,
                },
            ],
        },
    }


def test_generate_output_returns_json_safe_core_results():
    result = generate_output(_web_project())

    assert result["size"] == 3
    assert result["c_entries"] == [
        {"row": 0, "col": 0, "expr": "C_alpha + C_beta"},
        {"row": 0, "col": 1, "expr": "-C_alpha - C_beta"},
        {"row": 1, "col": 0, "expr": "-C_alpha - C_beta"},
        {"row": 1, "col": 1, "expr": "C_alpha + C_beta"},
        {"row": 2, "col": 2, "expr": "C_ground"},
    ]
    assert result["l_inv_entries"] == [
        {"row": 0, "col": 0, "expr": "L_alpha_inv + L_beta_inv"},
        {"row": 0, "col": 1, "expr": "-L_alpha_inv - L_beta_inv"},
        {"row": 1, "col": 0, "expr": "-L_alpha_inv - L_beta_inv"},
        {"row": 1, "col": 1, "expr": "L_alpha_inv + L_beta_inv"},
        {"row": 2, "col": 2, "expr": "L_ground_inv"},
    ]
    assert result["c_parameters"] == ["C_alpha", "C_beta", "C_ground"]
    assert result["l_inv_parameters"] == [
        "L_alpha_inv",
        "L_beta_inv",
        "L_ground_inv",
    ]
    assert result["parameters"] == [
        "C_alpha",
        "C_beta",
        "C_ground",
        "L_alpha_inv",
        "L_beta_inv",
        "L_ground_inv",
    ]
    assert result["josephson_parameters"] == []
    assert result["josephson_branches"] == []
    assert result["matrix_nodes"] == [
        {"project_node_id": 10, "matrix_index": 0, "name": "N1"},
        {"project_node_id": 11, "matrix_index": 1, "name": "N2"},
        {"project_node_id": 15, "matrix_index": 2, "name": "N3"},
    ]
    assert "def circuit_matrices" in result["snippet"]
    assert "def capacitance_matrix" in result["snippet"]
    assert "def inverse_inductance_matrix" in result["snippet"]
    assert "def josephson_branches" in result["snippet"]
    assert "NODE_INDEX_MAP" in result["snippet"]
    assert "_func" not in result["snippet"]


def test_generate_output_json_reports_parse_errors():
    result = json.loads(generate_output_json('{"state": {"nodes": [], "edges": [}'))

    assert "error" in result


def test_normalize_project_preserves_desktop_compatible_shape():
    result = normalize_project(_web_project())

    assert result["version"] == 2
    state = result["state"]
    assert state["node_counter"] == 16
    assert state["edge_counter"] == 8
    assert state["selected_nodes"] == []
    assert state["focus_node"] is None
    assert state["edges"][0]["capacitance_expr"] == "C_beta"
    assert state["edges"][0]["capacitance_text"] == "C_beta"
    assert state["edges"][0]["josephson_inductance_expr"] is None
    assert state["edges"][0]["josephson_inductance_text"] is None
    assert state["edges"][0]["josephson_phase_sign"] == 1
    assert state["edges"][4]["is_ground"] is True


def test_generate_output_includes_josephson_matrix_terms_and_metadata():
    project = {
        "version": 2,
        "state": {
            "nodes": [
                {"identifier": 0, "name": "A", "x": 0, "y": 0},
                {"identifier": 1, "name": "B", "x": 100, "y": 0},
            ],
            "edges": [
                {
                    "identifier": 7,
                    "nodes": [0, 1],
                    "capacitance_text": "Cj",
                    "inductance_text": "Lgeom",
                    "josephson_inductance_text": "Lj",
                    "josephson_phase_sign": -1,
                    "is_ground": False,
                },
                {
                    "identifier": 8,
                    "nodes": [1, -1],
                    "josephson_inductance_text": "Lground_j",
                    "is_ground": True,
                },
            ],
        },
    }

    result = generate_output(project)

    assert result["c_entries"] == [
        {"row": 0, "col": 0, "expr": "Cj"},
        {"row": 0, "col": 1, "expr": "-Cj"},
        {"row": 1, "col": 0, "expr": "-Cj"},
        {"row": 1, "col": 1, "expr": "Cj"},
    ]
    assert {
        (entry["row"], entry["col"]): entry["expr"]
        for entry in result["l_inv_entries"]
    } == {
        (0, 0): "(Lgeom + Lj)/(Lgeom*Lj)",
        (0, 1): "(-Lgeom - Lj)/(Lgeom*Lj)",
        (1, 0): "(-Lgeom - Lj)/(Lgeom*Lj)",
        (1, 1): "1/Lj + 1/Lground_j + 1/Lgeom",
    }
    assert result["l_inv_parameters"] == ["Lgeom", "Lground_j", "Lj"]
    assert result["josephson_parameters"] == ["Lground_j", "Lj"]
    assert result["josephson_branches"] == [
        {
            "edge_id": 7,
            "project_nodes": [0, 1],
            "matrix_nodes": [0, 1],
            "phase_positive_index": 0,
            "phase_negative_index": 1,
            "phase_sign": -1,
            "inductance_expr": "Lj",
        },
        {
            "edge_id": 8,
            "project_nodes": [1, -1],
            "matrix_nodes": [1, None],
            "phase_positive_index": 1,
            "phase_negative_index": None,
            "phase_sign": 1,
            "inductance_expr": "Lground_j",
        },
    ]
    assert "JOSEPHSON_BRANCHES" in result["snippet"]
    assert "def josephson_branches" in result["snippet"]


def test_analyze_modal_uses_sccircuits_bbq_and_preserves_branch_rows(monkeypatch):
    captured: dict[str, object] = {}

    class FakeBBQ:
        def __init__(self, capacitance_matrix, inverse_inductance_matrix, *, junctions):
            captured["capacitance_matrix"] = capacitance_matrix
            captured["inverse_inductance_matrix"] = inverse_inductance_matrix
            captured["junctions"] = junctions
            self.frequencies_ghz = np.array([5.1, 7.2])
            self.branch_phase_zpfs = np.array([[0.01, -0.02], [-0.03, 0.04]])
            self.josephson_energies_ghz = np.array([3.5, 4.5])
            self.branch_phase_nodes = ((0, 1), (1, None))

    fake_sccircuits = types.ModuleType("sccircuits")
    fake_sccircuits.BBQ = FakeBBQ
    monkeypatch.setitem(sys.modules, "sccircuits", fake_sccircuits)

    project = {
        "version": 2,
        "state": {
            "nodes": [
                {"identifier": 0, "name": "A", "x": 0, "y": 0},
                {"identifier": 1, "name": "B", "x": 100, "y": 0},
            ],
            "edges": [
                {
                    "identifier": 7,
                    "nodes": [0, 1],
                    "capacitance_text": "Cj",
                    "inductance_text": "Lgeom",
                    "josephson_inductance_text": "Lj",
                    "josephson_phase_sign": -1,
                    "is_ground": False,
                },
                {
                    "identifier": 8,
                    "nodes": [1, -1],
                    "josephson_inductance_text": "Lground_j",
                    "is_ground": True,
                },
            ],
        },
    }

    result = analyze_modal(
        project,
        {"Cj": "40e-15", "Lgeom": "10e-9", "Lj": "8e-9", "Lground_j": "9e-9"},
    )

    assert result["available"] is True
    assert np.allclose(
        captured["capacitance_matrix"],
        [[40e-15, -40e-15], [-40e-15, 40e-15]],
    )
    assert np.allclose(
        captured["inverse_inductance_matrix"],
        [
            [1 / 10e-9 + 1 / 8e-9, -1 / 10e-9 - 1 / 8e-9],
            [-1 / 10e-9 - 1 / 8e-9, 1 / 10e-9 + 1 / 8e-9 + 1 / 9e-9],
        ],
    )
    assert [branch["edge_id"] for branch in captured["junctions"]] == [7, 8]
    assert [branch["L_j"] for branch in captured["junctions"]] == [8e-9, 9e-9]
    assert result["frequencies_ghz"] == [5.1, 7.2]
    assert result["branches"][0]["edge_id"] == 7
    assert result["branches"][0]["phase_nodes"] == [0, 1]
    assert result["branches"][0]["phase_zpf"] == [0.01, -0.02]
    assert result["branches"][1]["edge_id"] == 8
    assert result["branches"][1]["phase_nodes"] == [1, None]
    assert result["branches"][1]["phase_zpf"] == [-0.03, 0.04]


def test_analyze_modal_json_reports_missing_sccircuits(monkeypatch):
    monkeypatch.setitem(sys.modules, "sccircuits", None)

    result = json.loads(analyze_modal_json(json.dumps(_web_project()), "{}"))

    assert result["available"] is False
    assert "sccircuits is not available" in result["error"]
