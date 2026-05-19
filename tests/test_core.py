import inspect

import numpy as np
import sympy as sp
from scipy import sparse

from cqedraw.core import (
    GROUND_NODE_ID,
    CircuitEdgeData,
    build_snippet,
    compute_matrices,
    compute_matrix_entries,
    matrix_function_snippet,
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


def test_matrix_function_snippet_parameters_are_sorted_by_symbol_name():
    _, c_entries, _ = compute_matrix_entries([15, 10, 11], _regression_edges())

    _, params = matrix_function_snippet(
        "C_matrix_entries",
        "C_matrix_triplets",
        "C_matrix_sparse",
        "C_matrix_func",
        3,
        c_entries,
    )

    assert params == ["C_alpha", "C_beta", "C_ground"]


def test_build_snippet_materializes_exact_dense_sparse_and_triplet_outputs():
    size, c_entries, l_inv_entries = compute_matrix_entries(
        [15, 10, 11], _regression_edges()
    )
    namespace: dict[str, object] = {}

    exec(build_snippet(size, c_entries, l_inv_entries), namespace)

    c_kwargs = {"C_alpha": 1.0, "C_beta": 2.0, "C_ground": 3.0}
    l_kwargs = {"L_alpha_inv": 4.0, "L_beta_inv": 5.0, "L_ground_inv": 6.0}

    c_entries_result = namespace["C_matrix_entries"](**c_kwargs)
    c_rows, c_cols, c_data, c_shape = namespace["C_matrix_triplets"](**c_kwargs)
    c_sparse = namespace["C_matrix_sparse"](**c_kwargs)
    c_dense = namespace["C_matrix_func"](**c_kwargs)

    l_entries_result = namespace["L_inv_matrix_entries"](**l_kwargs)
    l_rows, l_cols, l_data, l_shape = namespace["L_inv_matrix_triplets"](**l_kwargs)
    l_sparse = namespace["L_inv_matrix_sparse"](**l_kwargs)
    l_dense = namespace["L_inv_matrix_func"](**l_kwargs)

    assert (
        inspect.signature(namespace["C_matrix_func"]).parameters.keys()
        == c_kwargs.keys()
    )
    assert (
        inspect.signature(namespace["L_inv_matrix_func"]).parameters.keys()
        == l_kwargs.keys()
    )

    assert c_entries_result == [
        (0, 0, 3.0),
        (0, 1, -3.0),
        (1, 0, -3.0),
        (1, 1, 3.0),
        (2, 2, 3.0),
    ]
    assert l_entries_result == [
        (0, 0, 9.0),
        (0, 1, -9.0),
        (1, 0, -9.0),
        (1, 1, 9.0),
        (2, 2, 6.0),
    ]

    assert c_shape == (3, 3)
    assert l_shape == (3, 3)
    assert np.array_equal(c_rows, np.array([0, 0, 1, 1, 2]))
    assert np.array_equal(c_cols, np.array([0, 1, 0, 1, 2]))
    assert np.allclose(c_data, np.array([3.0, -3.0, -3.0, 3.0, 3.0]))
    assert np.array_equal(l_rows, np.array([0, 0, 1, 1, 2]))
    assert np.array_equal(l_cols, np.array([0, 1, 0, 1, 2]))
    assert np.allclose(l_data, np.array([9.0, -9.0, -9.0, 9.0, 6.0]))

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
    assert sparse.isspmatrix_csr(c_sparse)
    assert sparse.isspmatrix_csr(l_sparse)
    assert np.allclose(c_sparse.toarray(), c_expected)
    assert np.allclose(c_dense, c_expected)
    assert np.allclose(l_sparse.toarray(), l_expected)
    assert np.allclose(l_dense, l_expected)
