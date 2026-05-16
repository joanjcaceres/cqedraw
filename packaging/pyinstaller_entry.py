"""PyInstaller entry point.

Keeping this as a tiny script avoids packaging the package ``__main__`` module
as a standalone script, where relative imports can be awkward.
"""

from bbq_circuit_designer.cli import main


if __name__ == "__main__":
    main()
