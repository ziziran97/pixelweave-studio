"""Independently verify downloaded benchmark PNGs using Pillow and Python zlib CRC.

Usage: python tests/verify-mask-png.py <directory-containing-*-gray.png-and-*-rgba.png>
Requires Pillow; does not import any frontend encoder implementation.
"""
import hashlib
import json
from pathlib import Path
import struct
import sys
import zlib
from PIL import Image, ImageChops


def inspect(path):
    data = path.read_bytes()
    assert data[:8] == b"\x89PNG\r\n\x1a\n"
    offset, chunks = 8, []
    while offset < len(data):
        length = struct.unpack_from(">I", data, offset)[0]
        kind = data[offset + 4:offset + 8]
        payload = data[offset + 8:offset + 8 + length]
        crc = struct.unpack_from(">I", data, offset + 8 + length)[0]
        assert zlib.crc32(kind + payload) == crc, f"CRC mismatch: {path} {kind}"
        chunks.append(kind.decode("ascii"))
        offset += length + 12
    assert offset == len(data)
    width, height, depth, color, compression, filtering, interlace = struct.unpack_from(">IIBBBBB", data, 16)
    assert (depth, color, compression, filtering, interlace) == (8, 0, 0, 0, 0)
    assert chunks == ["IHDR", "IDAT", "IEND"]
    with Image.open(path) as image, Image.open(path.with_name(path.name.replace("-gray", "-rgba"))) as old:
        image.load(); old.load()
        assert image.mode == "L" and "transparency" not in image.info
        assert old.mode == "RGBA" and old.getchannel("A").getextrema() == (255, 255)
        assert image.size == old.size == (width, height)
        assert sum(image.histogram()[1:255]) == 0
        for channel in ("R", "G", "B"):
            assert ImageChops.difference(image, old.getchannel(channel)).getbbox() is None
        return {"file": path.name, "sha256": hashlib.sha256(data).hexdigest(), "bytes": len(data),
                "size": image.size, "mode": image.mode, "bitDepth": depth, "colorType": color,
                "chunks": chunks, "nonBinaryPixels": 0, "mismatchedPixels": 0}


paths = sorted(Path(sys.argv[1]).glob("*-gray.png"))
assert paths, "No grayscale PNG fixtures found"
print(json.dumps({"decoder": "Pillow", "files": [inspect(path) for path in paths]}, indent=2))
