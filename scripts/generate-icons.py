#!/usr/bin/env python3
"""Resize the supplied apiman artwork into extension icons (requires Pillow)."""

import argparse
from pathlib import Path

from PIL import Image, ImageOps


ROOT = Path(__file__).resolve().parents[1]
SIZES = (16, 32, 48, 64, 96, 128, 256, 512)


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument(
        "source", nargs="?", type=Path, default=ROOT / "assets" / "apiman.jpeg"
    )
    args = parser.parse_args()

    with Image.open(args.source.expanduser()) as source:
        artwork = ImageOps.exif_transpose(source).convert("RGB")
        if artwork.width != artwork.height or artwork.width < max(SIZES):
            parser.error("Source artwork must be square and at least 512 x 512 pixels.")

        output = ROOT / "public"
        output.mkdir(parents=True, exist_ok=True)
        for size in SIZES:
            icon = artwork.resize((size, size), Image.Resampling.LANCZOS)
            icon.info.clear()
            destination = output / f"icon-{size}.png"
            icon.save(destination, format="PNG", optimize=True)
            print(f"{destination.relative_to(ROOT)} ({size} x {size})")


if __name__ == "__main__":
    main()
