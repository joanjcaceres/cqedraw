"""Generate first-pass application icons from a simple circuit motif.

The script uses only the Python standard library so icon regeneration works in
minimal CI environments. It writes:

- assets/icon.svg  source artwork
- assets/icon.ico  Windows executable icon
- assets/icon.icns macOS app bundle icon
"""

from __future__ import annotations

import math
import struct
import zlib
from pathlib import Path


ROOT = Path(__file__).resolve().parents[1]
ASSET_DIR = ROOT / "assets"


SVG = """<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 1024 1024">
  <defs>
    <linearGradient id="bg" x1="128" y1="128" x2="896" y2="896" gradientUnits="userSpaceOnUse">
      <stop stop-color="#14213D"/>
      <stop offset="1" stop-color="#0F766E"/>
    </linearGradient>
  </defs>
  <rect x="64" y="64" width="896" height="896" rx="196" fill="url(#bg)"/>
  <path d="M328 356h184l184 246" fill="none" stroke="#F8FAFC" stroke-width="58" stroke-linecap="round" stroke-linejoin="round"/>
  <path d="M328 668h184l184-246" fill="none" stroke="#F8FAFC" stroke-width="58" stroke-linecap="round" stroke-linejoin="round"/>
  <circle cx="328" cy="356" r="74" fill="#F59E0B" stroke="#F8FAFC" stroke-width="30"/>
  <circle cx="328" cy="668" r="74" fill="#F59E0B" stroke="#F8FAFC" stroke-width="30"/>
  <circle cx="512" cy="512" r="84" fill="#38BDF8" stroke="#F8FAFC" stroke-width="30"/>
  <circle cx="696" cy="422" r="74" fill="#F59E0B" stroke="#F8FAFC" stroke-width="30"/>
  <path d="M696 496v106" fill="none" stroke="#F8FAFC" stroke-width="52" stroke-linecap="round"/>
  <path d="M616 636h160l-80 108z" fill="#F8FAFC"/>
</svg>
"""


def _clamp(value: float) -> int:
    return max(0, min(255, round(value)))


def _lerp(first: float, second: float, t: float) -> float:
    return first + (second - first) * t


def _blend(dst: tuple[int, int, int, int], src: tuple[int, int, int, int]) -> tuple[int, int, int, int]:
    sr, sg, sb, sa = src
    dr, dg, db, da = dst
    alpha = sa / 255
    out_alpha = alpha + (da / 255) * (1 - alpha)
    if out_alpha == 0:
        return 0, 0, 0, 0
    return (
        _clamp((sr * alpha + dr * (da / 255) * (1 - alpha)) / out_alpha),
        _clamp((sg * alpha + dg * (da / 255) * (1 - alpha)) / out_alpha),
        _clamp((sb * alpha + db * (da / 255) * (1 - alpha)) / out_alpha),
        _clamp(out_alpha * 255),
    )


def _rounded_rect_alpha(x: float, y: float, size: int) -> float:
    radius = size * 0.19140625
    margin = size * 0.0625
    left, top = margin, margin
    right, bottom = size - margin, size - margin
    inner_left, inner_top = left + radius, top + radius
    inner_right, inner_bottom = right - radius, bottom - radius

    if inner_left <= x <= inner_right and top <= y <= bottom:
        return 1.0
    if left <= x <= right and inner_top <= y <= inner_bottom:
        return 1.0

    cx = inner_left if x < inner_left else inner_right
    cy = inner_top if y < inner_top else inner_bottom
    distance = math.hypot(x - cx, y - cy)
    return max(0.0, min(1.0, radius + 0.5 - distance))


def _distance_to_segment(
    px: float, py: float, ax: float, ay: float, bx: float, by: float
) -> float:
    dx = bx - ax
    dy = by - ay
    if dx == 0 and dy == 0:
        return math.hypot(px - ax, py - ay)
    t = max(0.0, min(1.0, ((px - ax) * dx + (py - ay) * dy) / (dx * dx + dy * dy)))
    return math.hypot(px - (ax + t * dx), py - (ay + t * dy))


def _stroke_alpha(distance: float, width: float) -> float:
    return max(0.0, min(1.0, width / 2 + 0.5 - distance))


def _circle_alpha(x: float, y: float, cx: float, cy: float, radius: float) -> float:
    return max(0.0, min(1.0, radius + 0.5 - math.hypot(x - cx, y - cy)))


def _triangle_alpha(x: float, y: float, points: tuple[tuple[float, float], ...]) -> float:
    (x1, y1), (x2, y2), (x3, y3) = points
    denominator = (y2 - y3) * (x1 - x3) + (x3 - x2) * (y1 - y3)
    if denominator == 0:
        return 0.0
    a = ((y2 - y3) * (x - x3) + (x3 - x2) * (y - y3)) / denominator
    b = ((y3 - y1) * (x - x3) + (x1 - x3) * (y - y3)) / denominator
    c = 1 - a - b
    return 1.0 if a >= 0 and b >= 0 and c >= 0 else 0.0


def _draw_pixel(x: int, y: int, size: int) -> tuple[int, int, int, int]:
    # Work in the SVG coordinate system.
    ux = (x + 0.5) * 1024 / size
    uy = (y + 0.5) * 1024 / size

    bg_alpha = _rounded_rect_alpha(ux, uy, 1024)
    pixel = (0, 0, 0, 0)
    if bg_alpha:
        t = (ux + uy - 256) / 1536
        bg = (
            _clamp(_lerp(0x14, 0x0F, t)),
            _clamp(_lerp(0x21, 0x76, t)),
            _clamp(_lerp(0x3D, 0x6E, t)),
            _clamp(bg_alpha * 255),
        )
        pixel = _blend(pixel, bg)

    white = (248, 250, 252, 255)
    blue = (56, 189, 248, 255)
    amber = (245, 158, 11, 255)

    strokes = [
        ((328, 356), (512, 356)),
        ((512, 356), (696, 602)),
        ((328, 668), (512, 668)),
        ((512, 668), (696, 422)),
        ((696, 496), (696, 602)),
    ]
    for (ax, ay), (bx, by) in strokes:
        alpha = _stroke_alpha(_distance_to_segment(ux, uy, ax, ay, bx, by), 58)
        if alpha:
            pixel = _blend(pixel, (*white[:3], _clamp(alpha * 255)))

    for cx, cy, radius, fill in [
        (328, 356, 74, amber),
        (328, 668, 74, amber),
        (512, 512, 84, blue),
        (696, 422, 74, amber),
    ]:
        outline_alpha = _circle_alpha(ux, uy, cx, cy, radius + 15)
        fill_alpha = _circle_alpha(ux, uy, cx, cy, radius)
        if outline_alpha:
            pixel = _blend(pixel, (*white[:3], _clamp(outline_alpha * 255)))
        if fill_alpha:
            pixel = _blend(pixel, (*fill[:3], _clamp(fill_alpha * 255)))

    triangle = ((616, 636), (776, 636), (696, 744))
    if _triangle_alpha(ux, uy, triangle):
        pixel = _blend(pixel, white)
    return pixel


def _png_bytes(size: int) -> bytes:
    rows = []
    for y in range(size):
        row = bytearray([0])
        for x in range(size):
            row.extend(_draw_pixel(x, y, size))
        rows.append(bytes(row))
    raw = b"".join(rows)

    def chunk(name: bytes, data: bytes) -> bytes:
        return (
            struct.pack(">I", len(data))
            + name
            + data
            + struct.pack(">I", zlib.crc32(name + data) & 0xFFFFFFFF)
        )

    return (
        b"\x89PNG\r\n\x1a\n"
        + chunk(b"IHDR", struct.pack(">IIBBBBB", size, size, 8, 6, 0, 0, 0))
        + chunk(b"IDAT", zlib.compress(raw, 9))
        + chunk(b"IEND", b"")
    )


def _write_ico(path: Path, images: dict[int, bytes]) -> None:
    entries = []
    image_data = bytearray()
    offset = 6 + 16 * len(images)
    for size, data in images.items():
        width = 0 if size == 256 else size
        entries.append(
            struct.pack(
                "<BBBBHHII",
                width,
                width,
                0,
                0,
                1,
                32,
                len(data),
                offset + len(image_data),
            )
        )
        image_data.extend(data)
    path.write_bytes(struct.pack("<HHH", 0, 1, len(images)) + b"".join(entries) + image_data)


def _write_icns(path: Path, images: dict[str, bytes]) -> None:
    body = bytearray()
    for kind, data in images.items():
        encoded_kind = kind.encode("ascii")
        body.extend(encoded_kind)
        body.extend(struct.pack(">I", len(data) + 8))
        body.extend(data)
    path.write_bytes(b"icns" + struct.pack(">I", len(body) + 8) + body)


def main() -> None:
    ASSET_DIR.mkdir(exist_ok=True)
    (ASSET_DIR / "icon.svg").write_text(SVG, encoding="utf-8")

    pngs = {size: _png_bytes(size) for size in [16, 32, 48, 64, 128, 256, 512, 1024]}
    (ASSET_DIR / "icon.png").write_bytes(pngs[1024])
    _write_ico(ASSET_DIR / "icon.ico", {size: pngs[size] for size in [16, 32, 48, 64, 128, 256]})
    _write_icns(
        ASSET_DIR / "icon.icns",
        {
            "icp4": pngs[16],
            "icp5": pngs[32],
            "icp6": pngs[64],
            "ic07": pngs[128],
            "ic08": pngs[256],
            "ic09": pngs[512],
            "ic10": pngs[1024],
        },
    )


if __name__ == "__main__":
    main()
