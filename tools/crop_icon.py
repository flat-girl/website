"""Crop Sarah's front-view head into images/raw/sarah-icon.png, overwriting it."""

import json

from PIL import Image, ImageOps

from prepare_images import ROOT

# Crop coordinates in original-image pixels. Increase SIZE to include more hair.
LEFT = 658
TOP = 32
SIZE = 380


def crop_icon():
    left, top, size = LEFT, TOP, SIZE
    if any(type(value) is not int for value in (left, top, size)):
        raise ValueError("left, top, and size must be integers in source-image pixels")
    if left < 0 or top < 0 or size <= 0:
        raise ValueError("left/top must be nonnegative and size must be positive")

    manifest = json.loads((ROOT / "images/manifest.json").read_text())
    source = next((asset for asset in manifest["images"] if asset["id"] == "sarah-front"), None)
    if source is None:
        raise ValueError("Missing sarah-front entry in images/manifest.json")
    source_path = ROOT / "images/raw" / source["file"]
    output = ROOT / "images/raw/sarah-icon.png"
    if source_path.resolve() == output.resolve():
        raise ValueError("The icon output must not overwrite the sarah-front source")

    with Image.open(source_path) as original:
        image = ImageOps.exif_transpose(original)
        if left + size > image.width or top + size > image.height:
            raise ValueError(f"Crop exceeds the {image.width} × {image.height} source image")
        cropped = image.crop((left, top, left + size, top + size)).convert("RGBA")
        # Preserve transparency and native pixels, without source metadata.
        cropped = Image.frombytes("RGBA", cropped.size, cropped.tobytes())
        temporary = output.with_suffix(".tmp")
        cropped.save(temporary, format="PNG")
        temporary.replace(output)

    print(f"Wrote {output.relative_to(ROOT)}: {size} × {size}, left={left}, top={top}")
    print("Run make images-prepare to refresh the manifest and web variants.")


if __name__ == "__main__":
    try:
        crop_icon()
    except (ValueError, OSError, KeyError) as error:
        raise SystemExit(f"Icon crop failed: {error}") from error
