import numpy as np
import sympy as sp
from scipy import sparse

from cqedraw.core import (
    GROUND_NODE_ID,
    CircuitEdgeData,
    build_snippet,
    compute_matrix_branches,
    compute_matrices,
    compute_matrix_entries,
    matrix_branch_parameter_names,
    matrix_parameter_names,
)


def _regression_edges() -> list[CircuitEdgeData]:
    c_alpha = sp.Symbol("C_alpha")
    c_beta = sp.Symbol("C_beta")
    c_cancel = sp.Symbol("C_cancel")
    c_ground = sp.Symbol("C_ground")
    l_alpha_inv = sp.Symbol("L_alpha_inv")
    l_beta_inv = sp.Symbol("L_beta_inv")
    l_ground_inv = sp.Symbol("L_ground_inv")

    return [
        CircuitEdgeData((10, 11), c_beta, l_beta_inv),
        CircuitEdgeData((11, 10), c_alpha, l_alpha_inv),
        CircuitEdgeData((11, 15), c_cancel, None),
        CircuitEdgeData((11, 15), -c_cancel, None),
        CircuitEdgeData((15, GROUND_NODE_ID), c_ground, l_ground_inv),
        CircuitEdgeData((10, 15), None, None),
        CircuitEdgeData((99, 10), sp.Symbol("C_ignored"), None),
        CircuitEdgeData((10, 99), sp.Symbol("C_ignored"), None),
    ]


def test_compute_matrix_entries_preserves_current_sparse_output_behavior():
    size, c_entries, l_inv_entries = compute_matrix_entries(
        [15, 10, 11], _regression_edges()
    )

    c_total = sp.Symbol("C_alpha") + sp.Symbol("C_beta")
    l_total = sp.Symbol("L_alpha_inv") + sp.Symbol("L_beta_inv")

    assert size == 3
    assert c_entries == {
        (0, 0): c_total,
        (0, 1): -c_total,
        (1, 0): -c_total,
        (1, 1): c_total,
        (2, 2): sp.Symbol("C_ground"),
    }
    assert l_inv_entries == {
        (0, 0): l_total,
        (0, 1): -l_total,
        (1, 0): -l_total,
        (1, 1): l_total,
        (2, 2): sp.Symbol("L_ground_inv"),
    }


def test_compute_matrices_matches_sparse_entries():
    c_matrix, l_inv_matrix = compute_matrices([15, 10, 11], _regression_edges())

    c_total = sp.Symbol("C_alpha") + sp.Symbol("C_beta")
    l_total = sp.Symbol("L_alpha_inv") + sp.Symbol("L_beta_inv")

    assert c_matrix == sp.SparseMatrix(
        3,
        3,
        {
            (0, 0): c_total,
            (0, 1): -c_total,
            (1, 0): -c_total,
            (1, 1): c_total,
            (2, 2): sp.Symbol("C_ground"),
        },
    )
    assert l_inv_matrix == sp.SparseMatrix(
        3,
        3,
        {
            (0, 0): l_total,
            (0, 1): -l_total,
            (1, 0): -l_total,
            (1, 1): l_total,
            (2, 2): sp.Symbol("L_ground_inv"),
        },
    )


def test_compute_matrix_entries_handles_empty_values_without_entries():
    size, c_entries, l_inv_entries = compute_matrix_entries(
        [20, 10],
        [
            CircuitEdgeData((10, 20), None, None),
            CircuitEdgeData((10, GROUND_NODE_ID), None, None),
        ],
    )

    assert size == 2
    assert c_entries == {}
    assert l_inv_entries == {}


def test_matrix_parameter_names_are_sorted_by_symbol_name():
    _, c_entries, _ = compute_matrix_entries([15, 10, 11], _regression_edges())

    assert matrix_parameter_names(c_entries) == ["C_alpha", "C_beta", "C_ground"]


def test_compute_matrix_branches_combines_parallel_edges_and_cancellations():
    size, c_branches, l_inv_branches = compute_matrix_branches(
        [15, 10, 11], _regression_edges()
    )

    c_total = sp.Symbol("C_alpha") + sp.Symbol("C_beta")
    l_total = sp.Symbol("L_alpha_inv") + sp.Symbol("L_beta_inv")

    assert size == 3
    assert c_branches == [
        (0, 1, c_total),
        (2, None, sp.Symbol("C_ground")),
    ]
    assert l_inv_branches == [
        (0, 1, l_total),
        (2, None, sp.Symbol("L_ground_inv")),
    ]
    assert matrix_branch_parameter_names(c_branches) == [
        "C_alpha",
        "C_beta",
        "C_ground",
    ]


def test_build_snippet_materializes_exact_sparse_outputs():
    size, c_branches, l_inv_branches = compute_matrix_branches(
        [15, 10, 11], _regression_edges()
    )
    snippet = build_snippet(size, c_branches, l_inv_branches)
    namespace: dict[str, object] = {}

    exec(snippet, namespace)

    params = {
        "C_alpha": 1.0,
        "C_beta": 2.0,
        "C_ground": 3.0,
        "L_alpha_inv": 4.0,
        "L_beta_inv": 5.0,
        "L_ground_inv": 6.0,
    }

    c_expected = np.array(
        [
            [3.0, -3.0, 0.0],
            [-3.0, 3.0, 0.0],
            [0.0, 0.0, 3.0],
        ]
    )
    l_expected = np.array(
        [
            [9.0, -9.0, 0.0],
            [-9.0, 9.0, 0.0],
            [0.0, 0.0, 6.0],
        ]
    )

    assert namespace["MATRIX_SHAPE"] == (3, 3)
    assert namespace["PARAMETER_NAMES"] == (
        "C_alpha",
        "C_beta",
        "C_ground",
        "L_alpha_inv",
        "L_beta_inv",
        "L_ground_inv",
    )
    assert namespace["C_PARAMETER_NAMES"] == ("C_alpha", "C_beta", "C_ground")
    assert namespace["L_INV_PARAMETER_NAMES"] == (
        "L_alpha_inv",
        "L_beta_inv",
        "L_ground_inv",
    )

    c_sparse, l_sparse = namespace["circuit_matrices"](params)
    c_only = namespace["C_matrix"](params)
    l_only = namespace["L_inv_matrix"](params)

    assert sparse.isspmatrix_csr(c_sparse)
    assert sparse.isspmatrix_csr(l_sparse)
    assert np.allclose(c_sparse.toarray(), c_expected)
    assert np.allclose(l_sparse.toarray(), l_expected)
    assert np.allclose(c_only.toarray(), c_expected)
    assert np.allclose(l_only.toarray(), l_expected)

    assert "np.zeros" not in snippet
    assert "def C_matrix_func" not in snippet
    assert "def L_inv_matrix_func" not in snippet
    assert "def C_matrix_triplets" not in snippet
    assert "def L_inv_matrix_triplets" not in snippet


def test_build_snippet_reports_missing_parameter_names():
    size, c_branches, l_inv_branches = compute_matrix_branches(
        [15, 10, 11], _regression_edges()
    )
    namespace: dict[str, object] = {}

    exec(build_snippet(size, c_branches, l_inv_branches), namespace)

    try:
        namespace["circuit_matrices"]({"C_alpha": 1.0})
    except KeyError as exc:
        message = str(exc)
    else:
        raise AssertionError("Expected missing parameters to raise KeyError.")

    assert "Missing parameter values" in message
    assert "C_beta" in message
    assert "C_ground" in message
    assert "L_alpha_inv" in message
    assert "L_beta_inv" in message
    assert "L_ground_inv" in message


def test_build_snippet_scales_with_sparse_chain_entries():
    node_count = 250
    edges = [
        CircuitEdgeData(
            (node_id, node_id + 1),
            sp.Symbol(f"C{node_id}"),
            sp.Symbol(f"L{node_id}_inv"),
        )
        for node_id in range(node_count - 1)
    ]
    size, c_branches, l_inv_branches = compute_matrix_branches(range(node_count), edges)
    snippet = build_snippet(size, c_branches, l_inv_branches)
    namespace: dict[str, object] = {}

    exec(snippet, namespace)
    params = {name: 1.0 for name in namespace["PARAMETER_NAMES"]}
    c_sparse, l_sparse = namespace["circuit_matrices"](params)
    expected_nnz = node_count + 2 * (node_count - 1)

    assert c_sparse.shape == (node_count, node_count)
    assert l_sparse.shape == (node_count, node_count)
    assert sparse.isspmatrix_csr(c_sparse)
    assert sparse.isspmatrix_csr(l_sparse)
    assert c_sparse.nnz == expected_nnz
    assert l_sparse.nnz == expected_nnz
    assert c_sparse.nnz < node_count * node_count // 10
    assert "np.zeros" not in snippet


def test_build_snippet_groups_repeated_branch_expressions():
    node_count = 250
    edges = [
        CircuitEdgeData(
            (node_id, node_id + 1),
            sp.Symbol("C"),
            1 / sp.Symbol("L"),
        )
        for node_id in range(node_count - 1)
    ]
    size, c_branches, l_inv_branches = compute_matrix_branches(range(node_count), edges)
    snippet = build_snippet(size, c_branches, l_inv_branches)
    namespace: dict[str, object] = {}

    exec(snippet, namespace)
    c_sparse, l_sparse = namespace["circuit_matrices"]({"C": 2.0, "L": 4.0})
    expanded_entry_lines = 2 * (node_count + 2 * (node_count - 1))

    assert c_sparse.shape == (node_count, node_count)
    assert l_sparse.shape == (node_count, node_count)
    assert c_sparse.nnz == node_count + 2 * (node_count - 1)
    assert l_sparse.nnz == node_count + 2 * (node_count - 1)
    assert snippet.count('params["C"]') == 1
    assert snippet.count('1/params["L"]') == 1
    assert len(snippet.splitlines()) < expanded_entry_lines
