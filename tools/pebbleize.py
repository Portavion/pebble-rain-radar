#!/usr/bin/env python3
"""Convert a radar PNG to a Pebble-ready 8-bit indexed PNG.

Phone-side pipeline sketch. Palettize to the 64-color RGB cube Pebble Time uses.
"""

from __future__ import annotations

import struct
import zlib
from pathlib import Path

PEBBLE_LEVELS = (0x00, 0x55, 0xAA, 0xFF)


def pebble_channel(v: int) -> int:
    return min(PEBBLE_LEVELS, key=lambda c: abs(c - v))


def pebble_rgb(r: int, g: int, b: int) -> tuple[int, int, int]:
    return pebble_channel(r), pebble_channel(g), pebble_channel(b)


def _paeth(a: int, b: int, c: int) -> int:
    p = a + b - c
    pa, pb, pc = abs(p - a), abs(p - b), abs(p - c)
    if pa <= pb and pa <= pc:
        return a
    if pb <= pc:
        return b
    return c


def _read_png(data: bytes) -> tuple[int, int, int, bytes]:
    assert data[:8] == b"\x89PNG\r\n\x1a\n"
    off = 8
    width = height = bit = color = 0
    idat = b""
    plte = b""
    while off < len(data):
        ln = struct.unpack(">I", data[off : off + 4])[0]
        typ = data[off + 4 : off + 8]
        chunk = data[off + 8 : off + 8 + ln]
        if typ == b"IHDR":
            width, height, bit, color, comp, filt, inter = struct.unpack(">IIBBBBB", chunk)
            if (bit, comp, filt, inter) != (8, 0, 0, 0):
                raise ValueError("unsupported PNG")
        elif typ == b"PLTE":
            plte = chunk
        elif typ == b"IDAT":
            idat += chunk
        elif typ == b"IEND":
            break
        off += 12 + ln
    raw = zlib.decompress(idat)
    if color == 2:
        bpp = 3
    elif color == 6:
        bpp = 4
    elif color == 3:
        bpp = 1
    else:
        raise ValueError(f"color type {color}")
    stride = width * bpp
    rows: list[bytearray] = []
    i = 0
    prev = bytearray(stride)
    for _ in range(height):
        filt = raw[i]
        scan = bytearray(raw[i + 1 : i + 1 + stride])
        i += 1 + stride
        if filt == 1:
            for x in range(stride):
                left = scan[x - bpp] if x >= bpp else 0
                scan[x] = (scan[x] + left) & 255
        elif filt == 2:
            for x in range(stride):
                scan[x] = (scan[x] + prev[x]) & 255
        elif filt == 3:
            for x in range(stride):
                left = scan[x - bpp] if x >= bpp else 0
                scan[x] = (scan[x] + ((left + prev[x]) // 2)) & 255
        elif filt == 4:
            for x in range(stride):
                left = scan[x - bpp] if x >= bpp else 0
                up_left = prev[x - bpp] if x >= bpp else 0
                scan[x] = (scan[x] + _paeth(left, prev[x], up_left)) & 255
        elif filt != 0:
            raise ValueError(f"filter {filt}")
        rows.append(scan)
        prev = scan
    rgba = bytearray(width * height * 4)
    for y, row in enumerate(rows):
        for x in range(width):
            o = (y * width + x) * 4
            if color == 6:
                rgba[o : o + 4] = row[x * 4 : x * 4 + 4]
            elif color == 2:
                rgba[o : o + 3] = row[x * 3 : x * 3 + 3]
                rgba[o + 3] = 255
            else:
                pal = row[x] * 3
                rgba[o : o + 3] = plte[pal : pal + 3]
                rgba[o + 3] = 255
    return width, height, color, bytes(rgba)


def _scale_nearest(rgba: bytes, w: int, h: int, nw: int, nh: int) -> bytes:
    out = bytearray(nw * nh * 4)
    for y in range(nh):
        sy = y * h // nh
        for x in range(nw):
            sx = x * w // nw
            o = (y * nw + x) * 4
            s = (sy * w + sx) * 4
            out[o : o + 4] = rgba[s : s + 4]
    return bytes(out)


def _palette() -> bytes:
    colors = []
    for r in PEBBLE_LEVELS:
        for g in PEBBLE_LEVELS:
            for b in PEBBLE_LEVELS:
                colors.extend((r, g, b))
    return bytes(colors)


PALETTE = _palette()
INDEX = {(PALETTE[i], PALETTE[i + 1], PALETTE[i + 2]): i // 3 for i in range(0, len(PALETTE), 3)}


def _index_rgb(r: int, g: int, b: int, a: int) -> int:
    if a < 16:
        return INDEX[(0, 0, 0)]
    return INDEX[pebble_rgb(r, g, b)]


def to_indexed(rgba: bytes, w: int, h: int) -> bytes:
    out = bytearray(w * h)
    for i in range(w * h):
        o = i * 4
        out[i] = _index_rgb(rgba[o], rgba[o + 1], rgba[o + 2], rgba[o + 3])
    return bytes(out)


def _chunk(typ: bytes, data: bytes) -> bytes:
    crc = zlib.crc32(typ + data) & 0xFFFFFFFF
    return struct.pack(">I", len(data)) + typ + data + struct.pack(">I", crc)


def write_indexed_png(path: Path, indices: bytes, w: int, h: int) -> None:
    raw = bytearray()
    for y in range(h):
        raw.append(0)
        raw.extend(indices[y * w : (y + 1) * w])
    ihdr = struct.pack(">IIBBBBB", w, h, 8, 3, 0, 0, 0)
    png = (
        b"\x89PNG\r\n\x1a\n"
        + _chunk(b"IHDR", ihdr)
        + _chunk(b"PLTE", PALETTE)
        + _chunk(b"IDAT", zlib.compress(bytes(raw), 9))
        + _chunk(b"IEND", b"")
    )
    path.write_bytes(png)


def convert(src: Path, dest: Path, nw: int = 200, nh: int = 200) -> dict:
    w, h, color, rgba = _read_png(src.read_bytes())
    scaled = _scale_nearest(rgba, w, h, nw, nh)
    idx = to_indexed(scaled, nw, nh)
    write_indexed_png(dest, idx, nw, nh)
    return {
        "src_bytes": src.stat().st_size,
        "dest_bytes": dest.stat().st_size,
        "src_color": color,
        "size": (nw, nh),
        "nonzero": sum(1 for p in idx if p),
    }


SLOTS = (-60, -45, -30, -15, 0, 15, 30, 45, 60)


def nearest_frame(target_unix: int, frames: list[int], origin: int | None = None) -> int:
    # On a 10-min grid a 15-min slot ties two frames. Prefer the one closer to now.
    origin = target_unix if origin is None else origin
    return min(frames, key=lambda t: (abs(t - target_unix), abs(t - origin)))


def slot_target(now: int, offset_min: int) -> int:
    return now + offset_min * 60


if __name__ == "__main__":
    frames = [
        1788935400,
        1788936000,
        1788936600,
        1788937200,
        1788937800,
        1788938400,
        1788939000,
        1788939600,
        1788940200,
        1788940800,
        1788941400,
        1788942000,
        1788942600,
        1788943200,
        1788943800,
        1788944400,
        1788945000,
        1788945600,
    ]
    now = 1788942000
    assert nearest_frame(slot_target(now, 0), frames, now) == 1788942000
    assert nearest_frame(slot_target(now, -15), frames, now) == 1788941400
    assert nearest_frame(slot_target(now, 15), frames, now) == 1788942600
    assert nearest_frame(slot_target(now, 60), frames, now) == 1788945600
    here = Path(__file__).resolve().parent
    src = here / "fixtures" / "ukz5.png"
    dest = here / "fixtures" / "ukz5-pebble.png"
    info = convert(src, dest)
    print(info)
    assert dest.read_bytes()[:8] == b"\x89PNG\r\n\x1a\n"
    _, _, color, _ = _read_png(dest.read_bytes())
    assert color == 3, color
    print("ok", dest, dest.stat().st_size)
