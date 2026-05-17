"""Generate platform icon assets from ``assets/icon-source.png``.

The source image should be a square, high-resolution PNG. A 1024x1024 image is
ideal, but larger square images are fine. The generated files are:

- assets/icon.png  canonical 1024x1024 PNG
- assets/icon.ico  Windows executable icon
- assets/icon.icns macOS app bundle icon
"""

from __future__ import annotations

from io import BytesIO
from pathlib import Path
import struct

try:
    from PIL import Image, ImageOps
except ImportError as exc:  # pragma: no cover - only reached outside dev envs.
    raise SystemExit('Pillow is required. Install with: python -m pip install -e ".[dev]"') from exc


ROOT = Path(__file__).resolve().parents[1]
ASSET_DIR = ROOT / "assets"
SOURCE_PATH = ASSET_DIR / "icon-source.png"
PNG_PATH = ASSET_DIR / "icon.png"
ICO_PATH = ASSET_DIR / "icon.ico"
ICNS_PATH = ASSET_DIR / "icon.icns"

PNG_SIZE = 1024
ICO_SIZES = (16, 32, 48, 64, 128, 256)
ICNS_ENTRIES = (
    ("icp4", 16),
    ("icp5", 32),
    ("icp6", 64),
    ("ic07", 128),
    ("ic08", 256),
    ("ic09", 512),
    ("ic10", 1024),
    ("ic11", 32),
    ("ic12", 64),
    ("ic13", 256),
    ("ic14", 512),
)


def _load_source(path: Path) -> Image.Image:
    if not path.exists():
        raise FileNotFoundError(f"Missing source icon: {path}")

    with Image.open(path) as image:
        return image.convert("RGBA")


def _resize_icon(image: Image.Image, size: int) -> Image.Image:
    return ImageOps.fit(
        image,
        (size, size),
        method=Image.Resampling.LANCZOS,
        centering=(0.5, 0.5),
    )


def _png_bytes(image: Image.Image) -> bytes:
    buffer = BytesIO()
    image.save(buffer, format="PNG")
    return buffer.getvalue()


def _write_ico(path: Path, source: Image.Image) -> None:
    icon = _resize_icon(source, max(ICO_SIZES))
    icon.save(path, format="ICO", sizes=[(size, size) for size in ICO_SIZES])


def _write_icns(path: Path, source: Image.Image) -> None:
    body = bytearray()
    for kind, size in ICNS_ENTRIES:
        data = _png_bytes(_resize_icon(source, size))
        body.extend(kind.encode("ascii"))
        body.extend(struct.pack(">I", len(data) + 8))
        body.extend(data)

    path.write_bytes(b"icns" + struct.pack(">I", len(body) + 8) + body)


def main() -> None:
    ASSET_DIR.mkdir(exist_ok=True)
    source = _load_source(SOURCE_PATH)

    _resize_icon(source, PNG_SIZE).save(PNG_PATH, format="PNG")
    _write_ico(ICO_PATH, source)
    _write_icns(ICNS_PATH, source)


if __name__ == "__main__":
    main()
