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
from collections import deque
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
# The source image has a slight white matte at the outside edge.
# Overscan crops it out without changing the central circuit artwork.
ICON_OVERSCAN = 1.06
EDGE_SOLID_BACKGROUND_THRESHOLD = 235
EDGE_ANTIALIAS_BACKGROUND_THRESHOLD = 175
EDGE_ANTIALIAS_ALPHA_THRESHOLD = 245
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
        source = image.convert("RGBA")
        return _remove_edge_background(_apply_overscan(source))


def _apply_overscan(image: Image.Image) -> Image.Image:
    if ICON_OVERSCAN <= 1:
        return image

    width, height = image.size
    crop_width = round(width / ICON_OVERSCAN)
    crop_height = round(height / ICON_OVERSCAN)
    left = (width - crop_width) // 2
    top = (height - crop_height) // 2
    return image.crop((left, top, left + crop_width, top + crop_height))


def _is_edge_background(pixel: tuple[int, int, int, int]) -> bool:
    red, green, blue, alpha = pixel
    if alpha == 0:
        return True

    if min(red, green, blue) >= EDGE_SOLID_BACKGROUND_THRESHOLD:
        return True

    return (
        alpha < EDGE_ANTIALIAS_ALPHA_THRESHOLD
        and min(red, green, blue) >= EDGE_ANTIALIAS_BACKGROUND_THRESHOLD
    )


def _remove_edge_background(image: Image.Image) -> Image.Image:
    pixels = image.load()
    width, height = image.size
    queue: deque[tuple[int, int]] = deque()
    seen: set[tuple[int, int]] = set()

    for x in range(width):
        queue.append((x, 0))
        queue.append((x, height - 1))
    for y in range(1, height - 1):
        queue.append((0, y))
        queue.append((width - 1, y))

    while queue:
        x, y = queue.popleft()
        if (x, y) in seen:
            continue
        seen.add((x, y))
        if not _is_edge_background(pixels[x, y]):
            continue

        pixels[x, y] = 0, 0, 0, 0

        if x > 0:
            queue.append((x - 1, y))
        if x < width - 1:
            queue.append((x + 1, y))
        if y > 0:
            queue.append((x, y - 1))
        if y < height - 1:
            queue.append((x, y + 1))

    return image


def _resize_icon(image: Image.Image, size: int) -> Image.Image:
    resized = ImageOps.fit(
        image,
        (size, size),
        method=Image.Resampling.LANCZOS,
        centering=(0.5, 0.5),
    )
    return _remove_edge_background(resized)


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
