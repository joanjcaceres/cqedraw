from dataclasses import dataclass
from typing import Optional, Tuple

import sympy as sp


@dataclass
class Node:
    identifier: int
    name: str
    x: float
    y: float
    circle_id: int
    label_id: int


@dataclass
class Edge:
    identifier: int
    nodes: Tuple[int, int]
    line_id: int
    center_circle_id: Optional[int]
    label_id: int
    capacitance_expr: Optional[sp.Expr]
    capacitance_text: Optional[str]
    inductance_expr: Optional[sp.Expr]
    inductance_text: Optional[str]
    l_inverse_expr: Optional[sp.Expr]
    josephson_inductance_expr: Optional[sp.Expr] = None
    josephson_inductance_text: Optional[str] = None
    josephson_phase_sign: int = 1
    is_ground: bool = False
    ground_marker_id: Optional[int] = None
    ground_offset_x: float = 0.0
    ground_offset_y: float = 0.0


@dataclass
class EdgeParameters:
    capacitance_expr: Optional[sp.Expr]
    capacitance_text: Optional[str]
    inductance_expr: Optional[sp.Expr]
    inductance_text: Optional[str]
    josephson_inductance_expr: Optional[sp.Expr] = None
    josephson_inductance_text: Optional[str] = None
    josephson_phase_sign: int = 1
