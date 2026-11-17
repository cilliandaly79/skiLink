"""Draws the PisteMap app icons (PNG) with no dependencies.  python tools/make_icons.py"""
import struct, zlib
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
# shapes in a 0..1 square
BACK = [(0.08, 0.86), (0.36, 0.40), (0.50, 0.58), (0.66, 0.30), (0.94, 0.86)]          # mountains
SNOW1 = [(0.36, 0.40), (0.285, 0.52), (0.33, 0.50), (0.37, 0.54), (0.42, 0.49)]
SNOW2 = [(0.66, 0.30), (0.565, 0.45), (0.62, 0.42), (0.67, 0.47), (0.72, 0.41), (0.765, 0.46)]
TRAIL = [(0.20, 0.86), (0.48, 0.66), (0.58, 0.72), (0.40, 0.86)]                      # violet route


def inside(x, y, poly):
    c, j = False, len(poly) - 1
    for i in range(len(poly)):
        xi, yi = poly[i]; xj, yj = poly[j]
        if (yi > y) != (yj > y) and x < (xj - xi) * (y - yi) / (yj - yi) + xi:
            c = not c
        j = i
    return c


def color(x, y):
    t = (x + y) / 2  # diagonal blue gradient
    bg = (int(29 + (110 - 29) * t), int(79 + (195 - 79) * t), int(156 + (245 - 156) * t))
    if inside(x, y, SNOW1) or inside(x, y, SNOW2):
        return (255, 255, 255)
    if inside(x, y, TRAIL):
        return (139, 92, 246)
    if inside(x, y, BACK):
        return (233, 243, 252)
    return bg


def render(n, ss=3):
    rows = []
    for py in range(n):
        row = bytearray([0])
        for px in range(n):
            r = g = b = 0
            for sy in range(ss):
                for sx in range(ss):
                    c = color((px + (sx + .5) / ss) / n, (py + (sy + .5) / ss) / n)
                    r += c[0]; g += c[1]; b += c[2]
            k = ss * ss
            row += bytes((r // k, g // k, b // k))
        rows.append(bytes(row))
    raw = b"".join(rows)
    chunk = lambda t, d: struct.pack(">I", len(d)) + t + d + struct.pack(">I", zlib.crc32(t + d) & 0xFFFFFFFF)
    return b"\x89PNG\r\n\x1a\n" + chunk(b"IHDR", struct.pack(">IIBBBBB", n, n, 8, 2, 0, 0, 0)) + chunk(b"IDAT", zlib.compress(raw, 9)) + chunk(b"IEND", b"")


for size in (180, 192, 512):
    (ROOT / f"icon-{size}.png").write_bytes(render(size, 3 if size < 300 else 2))
    print("wrote", f"icon-{size}.png")
