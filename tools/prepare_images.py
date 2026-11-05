"""Prepare local web images; never publish raw sources."""

import argparse
import hashlib
import json
import shutil
from pathlib import Path

from PIL import Image, ImageOps, __version__ as pillow_version, features

ROOT = Path(__file__).resolve().parents[1]
RENDERER = {"revision": 1, "pillow": pillow_version, "webp": features.version("webp")}


def sha256(data):
    return hashlib.sha256(data).hexdigest()


def write_json(path, value):
    content = json.dumps(value, indent=2) + "\n"
    if path.exists() and path.read_text() == content:
        return
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(content)


def source_info(path):
    with Image.open(path) as source:
        image = ImageOps.exif_transpose(source)
        return {"sha256": sha256(path.read_bytes()), "bytes": path.stat().st_size,
                "width": image.width, "height": image.height}


def prepare(root=ROOT, check=False, refresh=False):
    manifest_path = root / "images/manifest.json"
    manifest = json.loads(manifest_path.read_text())
    recipes = json.loads((root / "images/recipes.json").read_text())
    widths = recipes["widths"]
    if not widths or any(type(w) is not int or w <= 0 for w in widths):
        raise ValueError("Recipe widths must be positive integers")
    processed = root / "images/processed"
    metadata_path = processed / "metadata.json"
    old = json.loads(metadata_path.read_text()) if metadata_path.exists() else {"images": []}
    previous = {v["key"]: v for img in old["images"] for v in img["variants"]}
    images = []
    rendered = reused = 0
    for asset in manifest["images"]:
        source_path = root / "images/raw" / asset["file"]
        if not source_path.is_file():
            raise ValueError(f"Missing raw image: {source_path}. Restore the supplied original.")
        actual = source_info(source_path)
        if refresh:
            asset.update(actual)
        elif any(asset.get(key) != value for key, value in actual.items()):
            raise ValueError(f"Source changed: {asset['file']}. Use --refresh-manifest for intentional changes.")
        with Image.open(source_path) as source:
            image = ImageOps.exif_transpose(source).convert("RGBA")
            # Rebuild pixels without carrying EXIF/ICC metadata into the WebP.
            image = Image.frombytes("RGBA", image.size, image.tobytes())
            variants = []
            for width in sorted({min(w, image.width) for w in widths} | {image.width}):
                quality = recipes["fullQuality"] if width == image.width else recipes["quality"]
                height = max(1, round(image.height * width / image.width))
                transform = {"width": width, "height": height, "quality": quality,
                             "format": "webp", "method": 6, "resample": "lanczos"}
                fingerprint = sha256(json.dumps({"source": actual["sha256"],
                    "transform": transform, "renderer": RENDERER}, sort_keys=True).encode())
                key = f"variants/{fingerprint}/{asset['id']}-{width}.webp"
                output = processed / key
                prior = previous.get(key, {})
                valid = output.is_file() and sha256(output.read_bytes()) == prior.get("sha256")
                if valid:
                    reused += 1
                elif check:
                    raise ValueError(f"Missing or corrupt processed image: {key}. Run images:prepare.")
                else:
                    output.parent.mkdir(parents=True, exist_ok=True)
                    resized = image.resize((width, height), Image.Resampling.LANCZOS)
                    temporary = output.with_suffix(".tmp")
                    resized.save(temporary, format="WEBP", quality=quality, method=6)
                    temporary.replace(output)
                    rendered += 1
                variants.append({"key": key, "width": width, "height": height,
                                 "sha256": sha256(output.read_bytes())})
            images.append({"id": asset["id"], "alt": asset["alt"],
                           "variants": variants, "full": variants[-1],
                           "display": [v for v in variants if v["width"] in {min(w, image.width) for w in widths}]})
    metadata = {"images": images}
    public = root / "web/public"
    generated = root / "web/app/generated/images.json"
    if check:
        if metadata != old or not generated.exists() or json.loads(generated.read_text()) != metadata:
            raise ValueError("Image metadata is stale. Run images:prepare.")
    else:
        if refresh:
            write_json(manifest_path, manifest)
        write_json(metadata_path, metadata)
        write_json(generated, metadata)
    for img in images:
        for variant in img["variants"]:
            target = public / variant["key"]
            valid = target.is_file() and sha256(target.read_bytes()) == variant["sha256"]
            if not valid:
                if check:
                    raise ValueError(f"Missing or corrupt staged image: {target}")
                target.parent.mkdir(parents=True, exist_ok=True)
                shutil.copyfile(processed / variant["key"], target)
    print(f"Images: {rendered} rendered, {reused} reused; {len(images)} sources.")
    return metadata


if __name__ == "__main__":
    parser = argparse.ArgumentParser(description=__doc__)
    mode = parser.add_mutually_exclusive_group()
    mode.add_argument("--check", action="store_true", help="Verify outputs without writes")
    mode.add_argument("--refresh-manifest", action="store_true", help="Accept intentional source replacements")
    args = parser.parse_args()
    try:
        prepare(check=args.check, refresh=args.refresh_manifest)
    except (ValueError, OSError) as error:
        parser.exit(1, f"Image preparation failed: {error}\n")
