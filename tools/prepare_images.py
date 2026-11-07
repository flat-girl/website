"""Prepare local web images; never publish raw sources."""

import argparse
import hashlib
import io
import json
import re
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


def image_transforms(source, recipes):
    recipe = source.get("recipe", "default")
    if recipe not in {"default", "favicon"}:
        raise ValueError(f"Unknown image recipe: {recipe}")
    settings = recipes if recipe == "default" else recipes.get("favicon", {})
    widths = settings.get("widths")
    if not widths or any(type(w) is not int or w <= 0 for w in widths):
        raise ValueError("Recipe widths must be positive integers")
    if recipe == "favicon":
        if settings.get("format") != "png":
            raise ValueError("Favicon recipe format must be png")
        if source["width"] != source["height"] or source["width"] < max(widths):
            raise ValueError("Favicon raw input must be square and at least as large as every output")
        return [dict(width=w, height=w, format="png", resample="lanczos") for w in sorted(set(widths))]
    if any(type(settings.get(k)) is not int or not 1 <= settings[k] <= 100 for k in ("quality", "fullQuality")):
        raise ValueError("Invalid WebP quality")
    return [dict(width=w, height=max(1, round(source["height"] * w / source["width"])),
                 quality=settings["fullQuality"] if w == source["width"] else settings["quality"],
                 format="webp", method=6, resample="lanczos")
            for w in sorted({min(w, source["width"]) for w in widths} | {source["width"]})]


def save_variant(image, path, transform):
    resized = image.resize((transform["width"], transform["height"]), Image.Resampling.LANCZOS)
    options = {"quality": transform["quality"], "method": transform["method"]} if transform["format"] == "webp" else {}
    temporary = path.with_suffix(".tmp")
    resized.save(temporary, format=transform["format"].upper(), **options)
    temporary.replace(path)


def prepare_favicon(image, path, check=False):
    output = io.BytesIO()
    image.save(output, format="ICO", sizes=[(16, 16), (32, 32), (48, 48)], bitmap_format="bmp")
    data = output.getvalue()
    if path.is_file() and path.read_bytes() == data:
        return
    if check:
        raise ValueError("Missing or stale favicon.ico. Run make images-prepare.")
    path.parent.mkdir(parents=True, exist_ok=True)
    temporary = path.with_suffix(".tmp")
    temporary.write_bytes(data)
    temporary.replace(path)


def prepare(root=ROOT, check=False, refresh=False):
    manifest_path = root / "images/manifest.json"
    manifest = json.loads(manifest_path.read_text()) if manifest_path.exists() or not refresh else {"images": []}
    if refresh:
        files = {asset["file"] for asset in manifest["images"]}
        ids = {asset["id"] for asset in manifest["images"]}
        for path in sorted((root / "images/raw").iterdir()):
            if (not path.is_file() or path.is_symlink() or path.name.startswith('.') or
                    path.suffix.lower() not in {'.png', '.jpg', '.jpeg', '.webp'} or path.name in files):
                continue
            base = re.sub(r'[^a-z0-9]+', '-', path.stem.lower()).strip('-') or 'image'
            identifier, suffix = base, 2
            while identifier in ids:
                identifier = f'{base}-{suffix}'
                suffix += 1
            ids.add(identifier)
            manifest["images"].append({"id": identifier, "file": path.name,
                                       "alt": re.sub(r'[_-]+', ' ', path.stem).strip()})
    recipes = json.loads((root / "images/recipes.json").read_text())
    widths = recipes["widths"]
    if not widths or any(type(w) is not int or w <= 0 for w in widths):
        raise ValueError("Recipe widths must be positive integers")
    processed = root / "images/processed"
    metadata_path = processed / "metadata.json"
    old = json.loads(metadata_path.read_text()) if metadata_path.exists() else {"images": []}
    previous = {v["key"]: v for img in old["images"] for v in img["variants"]}
    if sum(asset.get("recipe") == "favicon" for asset in manifest["images"]) > 1:
        raise ValueError("Only one favicon source can produce web/public/favicon.ico")
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
            raise ValueError(f"Source changed: {asset['file']}. Run make images-prepare for intentional changes.")
        with Image.open(source_path) as source:
            image = ImageOps.exif_transpose(source).convert("RGBA")
            # Rebuild pixels without carrying EXIF/ICC metadata into outputs.
            image = Image.frombytes("RGBA", image.size, image.tobytes())
            variants = []
            for transform in image_transforms({**asset, **actual}, recipes):
                width, height = transform["width"], transform["height"]
                fingerprint = sha256(json.dumps({"source": actual["sha256"],
                    "transform": transform, "renderer": RENDERER}, sort_keys=True).encode())
                key = f"variants/{fingerprint}/{asset['id']}-{width}.{transform['format']}"
                output = processed / key
                prior = previous.get(key, {})
                valid = output.is_file() and sha256(output.read_bytes()) == prior.get("sha256")
                if valid:
                    reused += 1
                elif check:
                    raise ValueError(f"Missing or corrupt processed image: {key}. Run images:prepare.")
                else:
                    output.parent.mkdir(parents=True, exist_ok=True)
                    save_variant(image, output, transform)
                    rendered += 1
                variants.append({"key": key, "width": width, "height": height,
                                 "sha256": sha256(output.read_bytes())})
            if asset.get("recipe") == "favicon":
                prepare_favicon(image, root / "web/public/favicon.ico", check=check)
            images.append({"id": asset["id"], "alt": asset["alt"],
                           "recipe": asset.get("recipe", "default"),
                           "variants": variants, "full": variants[-1],
                           "display": variants if asset.get("recipe") == "favicon" else
                           [v for v in variants if v["width"] in {min(w, image.width) for w in widths}]})
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
    mode.add_argument("--refresh-manifest", action="store_true", help="Discover new raw images and accept intentional source replacements")
    args = parser.parse_args()
    try:
        prepare(check=args.check, refresh=args.refresh_manifest)
    except (ValueError, OSError) as error:
        parser.exit(1, f"Image preparation failed: {error}\n")
