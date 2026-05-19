import json

from cqedraw.web_bridge import generate_output, generate_output_json, normalize_project


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
    assert "def C_matrix_func" in result["snippet"]
    assert "def L_inv_matrix_func" in result["snippet"]


def test_generate_output_json_reports_parse_errors():
    result = json.loads(generate_output_json('{"state": {"nodes": [], "edges": [}'))

    assert "error" in result


def test_normalize_project_preserves_desktop_compatible_shape():
    result = normalize_project(_web_project())

    assert result["version"] == 1
    state = result["state"]
    assert state["node_counter"] == 16
    assert state["edge_counter"] == 8
    assert state["selected_nodes"] == []
    assert state["focus_node"] is None
    assert state["edges"][0]["capacitance_expr"] == "C_beta"
    assert state["edges"][0]["capacitance_text"] == "C_beta"
    assert state["edges"][4]["is_ground"] is True
