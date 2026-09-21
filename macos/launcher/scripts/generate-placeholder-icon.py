#!/usr/bin/env python3
"""Create a neutral macOS placeholder app icon: rounded gray square, no logo."""

from __future__ import annotations

import os
import struct
import sys
import zlib


def write_png(path: str, width: int, height: int, rgba: bytes) -> None:
    def chunk(tag: bytes, data: bytes) -> bytes:
        return struct.pack(">I", len(data)) + tag + data + struct.pack(">I", zlib.crc32(tag + data) & 0xFFFFFFFF)

    raw = b"".join(b"\x00" + rgba[y * width * 4 : (y + 1) * width * 4] for y in range(height))
    ihdr = struct.pack(">IIBBBBB", width, height, 8, 6, 0, 0, 0)
    payload = b"\x89PNG\r\n\x1a\n" + chunk(b"IHDR", ihdr) + chunk(b"IDAT", zlib.compress(raw, 9)) + chunk(b"IEND", b"")
    with open(path, "wb") as handle:
        handle.write(payload)


def rounded_square(size: int) -> bytes:
    pixels = bytearray(size * size * 4)
    radius = max(1, int(size * 0.22))
    fill = (88, 88, 90, 255)
    inner = (78, 78, 80, 255)
    for y in range(size):
        for x in range(size):
            dx0, dy0 = x - radius, y - radius
            dx1, dy1 = x - (size - 1 - radius), y - (size - 1 - radius)
            inside = True
            if x < radius and y < radius:
                inside = dx0 * dx0 + dy0 * dy0 <= radius * radius
            elif x > size - 1 - radius and y < radius:
                inside = dx1 * dx1 + dy0 * dy0 <= radius * radius
            elif x < radius and y > size - 1 - radius:
                inside = dx0 * dx0 + dy1 * dy1 <= radius * radius
            elif x > size - 1 - radius and y > size - 1 - radius:
                inside = dx1 * dx1 + dy1 * dy1 <= radius * radius
            if not inside:
                continue
            edge = x < 2 or y < 2 or x > size - 3 or y > size - 3
            color = inner if edge else fill
            index = (y * size + x) * 4
            pixels[index : index + 4] = bytes(color)
    return bytes(pixels)


def main() -> int:
    if len(sys.argv) != 2:
        print("usage: generate-placeholder-icon.py <iconset-dir>", file=sys.stderr)
        return 2
    iconset = sys.argv[1]
    os.makedirs(iconset, exist_ok=True)
    master = os.path.join(iconset, "icon_512x512@2x.png")
    write_png(master, 1024, 1024, rounded_square(1024))
    print(master)
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
