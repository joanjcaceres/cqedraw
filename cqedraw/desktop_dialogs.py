import tkinter as tk
from typing import Optional, Tuple

import sympy as sp
from tkinter import messagebox, ttk

from .desktop_models import EdgeParameters


class ToolTip:
    def __init__(self, widget: tk.Widget, text: str):
        self.widget = widget
        self.text = text
        self.tipwindow: Optional[tk.Toplevel] = None
        self.widget.bind("<Enter>", self._show)
        self.widget.bind("<Leave>", self._hide)

    def _show(self, _event: tk.Event) -> None:
        if self.tipwindow is not None:
            return
        if not self.text:
            return
        x = self.widget.winfo_rootx() + 20
        y = self.widget.winfo_rooty() + self.widget.winfo_height() + 5
        self.tipwindow = tw = tk.Toplevel(self.widget)
        tw.wm_overrideredirect(True)
        tw.wm_geometry(f"+{x}+{y}")
        label = ttk.Label(
            tw,
            text=self.text,
            background="#333333",
            foreground="white",
            relief=tk.SOLID,
            borderwidth=1,
            padding=(6, 2),
        )
        label.pack()

    def _hide(self, _event: tk.Event) -> None:
        if self.tipwindow is not None:
            self.tipwindow.destroy()
            self.tipwindow = None


class EdgeDialog:
    def __init__(
        self,
        parent: tk.Tk,
        first: str,
        second: str,
        default_cap: Optional[str] = None,
        default_ind: Optional[str] = None,
    ):
        self.parent = parent
        self.value: Optional[EdgeParameters] = None
        self.dialog = tk.Toplevel(parent)
        self.dialog.transient(parent)
        self.dialog.grab_set()
        self.dialog.title("Edge Values")
        ttk.Label(self.dialog, text=f"Between {first} and {second}").grid(
            row=0, column=0, columnspan=2, padx=10, pady=(10, 5)
        )

        ttk.Label(self.dialog, text="Capacitance (F)").grid(
            row=1, column=0, sticky=tk.W, padx=10
        )
        self.cap_entry = ttk.Entry(self.dialog, width=18)
        self.cap_entry.grid(row=1, column=1, padx=10, pady=2)
        if default_cap:
            self.cap_entry.insert(0, default_cap)

        ttk.Label(self.dialog, text="Inductance (H)").grid(
            row=2, column=0, sticky=tk.W, padx=10
        )
        self.ind_entry = ttk.Entry(self.dialog, width=18)
        self.ind_entry.grid(row=2, column=1, padx=10, pady=2)
        if default_ind:
            self.ind_entry.insert(0, default_ind)

        buttons = ttk.Frame(self.dialog)
        buttons.grid(row=3, column=0, columnspan=2, pady=10)
        ttk.Button(buttons, text="Cancel", command=self.dialog.destroy).pack(
            side=tk.RIGHT, padx=5
        )
        ttk.Button(buttons, text="Accept", command=self._on_accept).pack(
            side=tk.RIGHT, padx=5
        )

        self.cap_entry.focus_set()
        self.dialog.bind("<Return>", lambda _: self._on_accept())
        self.dialog.bind("<Escape>", lambda _: self.dialog.destroy())
        self.dialog.wait_window()

    def _on_accept(self) -> None:
        try:
            cap_expr, cap_text = self._parse_expression(self.cap_entry.get())
            ind_expr, ind_text = self._parse_expression(self.ind_entry.get())
        except ValueError as exc:
            messagebox.showerror("Invalid input", str(exc), parent=self.dialog)
            return
        if ind_expr is not None:
            if ind_expr.is_zero is True:
                messagebox.showerror(
                    "Invalid input",
                    "Inductance cannot be zero.",
                    parent=self.dialog,
                )
                return
            if ind_expr.is_number and float(ind_expr.evalf()) == 0.0:
                messagebox.showerror(
                    "Invalid input",
                    "Inductance cannot be zero.",
                    parent=self.dialog,
                )
                return
        self.value = EdgeParameters(
            capacitance_expr=cap_expr,
            capacitance_text=cap_text,
            inductance_expr=ind_expr,
            inductance_text=ind_text,
        )
        self.dialog.destroy()

    @staticmethod
    def _parse_expression(text: str) -> Tuple[Optional[sp.Expr], Optional[str]]:
        stripped = text.strip()
        if not stripped:
            return None, None
        try:
            expr = sp.sympify(stripped)
        except (sp.SympifyError, TypeError) as exc:
            raise ValueError("Please enter a valid number or expression.") from exc
        if expr.is_real is False:
            raise ValueError("Only real values are allowed.")
        expr = sp.simplify(expr)
        return expr, stripped
