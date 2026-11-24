"""Write SVG masters and print PNGs to images/raw and prepare their web variants.

Run: uv run --project tools tools/generate_iou.py
After editing an SVG directly, add --rasterize-only to render the saved masters.
Requires rsvg-convert (librsvg) and, to rebuild the masters, hb-vector (HarfBuzz).
"""

import argparse
import base64
import math
import shutil
import subprocess
import xml.etree.ElementTree as ET
from dataclasses import dataclass
from functools import cache
from io import BytesIO
from pathlib import Path
from tempfile import TemporaryDirectory

from PIL import Image, ImageChops, ImageDraw, ImageFont, ImageOps

from prepare_images import ROOT, prepare


# Print settings and artwork
RAW = ROOT / "images/raw"
FRONT_ART = RAW / "sarah_artwork_front_no.png"
BACK_ART = RAW / "sarah_artwork_back.png"
FRONT_FILE = RAW / "iou_front.svg"
BACK_FILE = RAW / "iou_back.svg"
WIDTH, HEIGHT = 1860, 792
DPI = 300  # 1860 × 792 pixels prints at 6.20 × 2.64 inches.
PORTRAIT_FRACTION = 0.43  # Fraction of the figure's height, measured from the crown.

PAPER = "#f4f0dc"
GREEN = "#305c44"
PALE = "#acb39b"
ENGRAVED = ("Academy Engraved LET Fonts.ttf", "Georgia Bold.ttf", "DejaVuSerif-Bold.ttf")
SERIF = ("Georgia.ttf", "DejaVuSerif.ttf")
BOLD = ("Georgia Bold.ttf", "DejaVuSerif-Bold.ttf")
ITALIC = ("Georgia Italic.ttf", "LiberationSerif-Italic.ttf")
MONO = ("Courier New Bold.ttf", "DejaVuSansMono.ttf")


@dataclass(frozen=True)
class Lettering:
    """Centered text. x, y, width and font size are in design pixels."""

    words: str
    x: int
    y: int
    width: int
    size: int
    face: tuple[str, ...] = SERIF
    color: str = GREEN
    halo: int = 0


# All printed words live here. Add a Lettering entry to either side to add copy.
# Use \n inside a string for a line break. Lines shrink to fit the given width.
DENOMINATION = "1"
ISSUER = "The Bank of Your Mother"
SERIES = "SERIES 2026"
SERIAL = "F 06742069 G"
MONOGRAM = "FG"
VALUE_WORD = "ONE"
FRONT_TEXT = (
    Lettering("FLAT GIRL RESERVE NOTE", 930, 66, 755, 34, BOLD, PAPER),
    Lettering(ISSUER, 930, 144, 1170, 92, BOLD),
    Lettering("THIS NOTE IS GOOD FOR ONE", 438, 245, 455, 25, BOLD),
    Lettering("BORING FLAT GIRL PLUSH BLANKET", 438, 286, 525, 35, ITALIC),
    Lettering(MONOGRAM, 435, 447, 115, 72, ENGRAVED),
    Lettering(SERIAL, 431, 611, 430, 48, MONO, GREEN),
    Lettering(SERIAL, 1430, 258, 430, 48, MONO, GREEN),
    Lettering("IOU", 1430, 444, 410, 109, ENGRAVED, GREEN, 3),
    Lettering(SERIES, 1430, 611, 415, 28, SERIF),
    Lettering("FLAT GIRL", 930, 638, 167, 24, BOLD, PAPER),
    Lettering("ONE FLAT DOLLAR", 930, 694, 755, 62, BOLD, PAPER),
)
BACK_TEXT = (
    Lettering("THE BANK OF YOUR MOTHER", 930, 113, 1100, 82, ENGRAVED, GREEN),
    Lettering("ONE PLUSH BLANKET", 930, 682, 880, 65, BOLD, GREEN),
    Lettering(MONOGRAM, 1460, 382, 268, 144, ENGRAVED, GREEN),
    Lettering("FLAT GIRL RESERVE", 1460, 466, 256, 24, BOLD, GREEN),
)


SVG_NS = "http://www.w3.org/2000/svg"
XLINK_NS = "http://www.w3.org/1999/xlink"
ET.register_namespace("", SVG_NS)
ET.register_namespace("xlink", XLINK_NS)


def element(parent, tag, **attributes):
    return ET.SubElement(parent, f"{{{SVG_NS}}}{tag}", {k: str(v) for k, v in attributes.items()})


def coordinates(points):
    return " ".join(f"{x:.2f},{y:.2f}" for x, y in points)


class SvgFace:
    """Draw the note in its original 1860 × 792 design coordinate system."""

    def __init__(self):
        self.root = ET.Element(f"{{{SVG_NS}}}svg", {
            "width": f"{WIDTH / DPI:g}in", "height": f"{HEIGHT / DPI:g}in",
            "viewBox": f"0 0 {WIDTH} {HEIGHT}",
        })
        self.defs = element(self.root, "defs")
        self.rectangle((0, 0, WIDTH, HEIGHT), fill=PAPER)

    def rectangle(self, box, fill="none", outline="none"):
        x, y, right, bottom = box
        element(self.root, "rect", x=x, y=y, width=right-x, height=bottom-y,
                fill=fill, stroke=outline)

    def ellipse(self, box, fill="none", outline="none", width=1):
        x, y, right, bottom = box
        element(self.root, "ellipse", cx=(x+right)/2, cy=(y+bottom)/2,
                rx=(right-x)/2, ry=(bottom-y)/2, fill=fill, stroke=outline,
                **{"stroke-width": width})

    def polygon(self, points, fill, outline="none", width=1):
        element(self.root, "polygon", points=coordinates(points), fill=fill,
                stroke=outline, **{"stroke-width": width})

    def line(self, points, fill, width=1):
        element(self.root, "polyline", points=coordinates(points), fill="none",
                stroke=fill, **{"stroke-width": width})


def wave_points(cx, cy, rx, ry, lobes, amplitude, phase):
    """One closed guilloché curve in an elliptical ring."""
    points = []
    for step in range(721):
        angle = step * math.tau / 720
        radius = 1 + amplitude * math.cos(lobes * angle + phase)
        points.append((cx + rx * radius * math.cos(angle), cy + ry * radius * math.sin(angle)))
    return points


def rosette(draw, cx, cy, rx, ry, lobes, amplitude, color, passes=7):
    for index in range(passes):
        points = wave_points(cx, cy, rx, ry, lobes, amplitude, math.tau * index / passes)
        draw.line(points, fill=color, width=1)


@cache
def font_path(face):
    for filename in face:
        try:
            return ImageFont.truetype(filename, 12).path
        except OSError:
            continue
    raise SystemExit(f"Install a lettering font from {face} or edit the font constants.")


@cache
def outlined_line(face, size, words):
    """Get shaped glyph paths and their ink bounds, independent of viewer fonts."""
    result = subprocess.run(
        ["hb-vector", "--ink", "--margin=0", "--background=none", f"--font-size={size}",
         f"--font-file={font_path(face)}", f"--text={words}"],
        check=True, capture_output=True,
    )
    svg = ET.fromstring(result.stdout)
    bounds = tuple(map(float, svg.attrib["viewBox"].split()))
    return bounds, [path.attrib["d"] for path in svg.iter(f"{{{SVG_NS}}}path")]


def lettering(draw, item):
    # hb-vector emits glyph paths in a y-up coordinate system. Place each line
    # on a common baseline grid before flipping its outlines into SVG space.
    leading = ImageFont.truetype(font_path(item.face), item.size).getbbox("A")[3] + 4
    lines = [(i * leading, *outlined_line(item.face, item.size, words))
             for i, words in enumerate(item.words.splitlines()) if words.strip()]
    if not lines:
        return
    scale = min(1, item.width / max(bounds[2] for _, bounds, _ in lines))
    top = min(baseline + bounds[1] for baseline, bounds, _ in lines)
    bottom = max(baseline + bounds[1] + bounds[3] for baseline, bounds, _ in lines)
    group = element(draw.root, "g", fill=item.color,
                    transform=f"translate({item.x} {item.y}) scale({scale})")
    element(group, "title").text = item.words
    if item.halo:
        group.attrib.update({"stroke": PAPER, "stroke-width": str(2 * item.halo / scale),
                             "stroke-linejoin": "round", "paint-order": "stroke fill"})
    for baseline, (left, _, width, _), paths in lines:
        x, y = -left - width / 2, baseline - (top + bottom) / 2
        row = element(group, "g", transform=f"translate({x} {y}) scale(1 -1)")
        for path in paths:
            element(row, "path", d=path)


def frame(draw, color):
    # Pale interlocking ovals cut through the solid ink band like engine turning.
    draw.rectangle((30, 25, 1830, 767), fill=color)
    draw.rectangle((78, 73, 1782, 719), fill=PAPER)
    for inset in (5, 11, 43):
        draw.rectangle((30 + inset, 25 + inset, 1830 - inset, 767 - inset), outline=PAPER)
    for x in range(75, 1787, 13):
        for y in (52, 740):
            draw.ellipse((x-24, y-12, x+24, y+12), outline=PAPER)
    for y in range(73, 722, 13):
        for x in (56, 1804):
            draw.ellipse((x-12, y-24, x+12, y+24), outline=PAPER)


def tablet(draw, x, y, w, h, ink, field):
    """Clipped ends and a double keyline around a denomination or heading."""
    for inset, fill in ((0, ink), (4, field), (7, ink)):
        a, b = w - inset, h - inset
        draw.polygon([(x-a, y), (x-a+30, y-b), (x+a-30, y-b), (x+a, y),
                      (x+a-30, y+b), (x-a+30, y+b)], fill=fill)


def seal(draw, x, y, radius, ink, field):
    outline = wave_points(x, y, radius, radius, 45, .045, 0)
    draw.polygon(outline, fill=ink)
    for fraction, color in ((.93, field), (.90, ink), (.77, field), (.74, ink), (.70, field)):
        r = radius * fraction
        draw.ellipse((x-r, y-r, x+r, y+r), fill=color)
    rosette(draw, x, y, radius*.83, radius*.83, 24, .06, field, passes=3)


def portrait(draw, source, x, y, width, height, ink):
    rx, ry = width // 2, height // 2
    draw.ellipse((x-rx-23, y-ry-22, x+rx+23, y+ry+22), fill=ink)
    rosette(draw, x, y, rx+12, ry+11, 48, .036, PAPER, passes=5)
    box = (x - width/2, y - height/2, x + width/2, y + height/2)
    tile = Image.new("RGB", (width, height), PALE)
    hatch = ImageDraw.Draw(tile)
    for offset in range(-tile.height, tile.width, 9):
        hatch.line((offset, 0, offset + tile.height, tile.height), fill=PAPER, width=4)

    with Image.open(source) as original:
        figure = original.convert("RGBA")
        figure = figure.crop(figure.getchannel("A").getbbox())
        bust = figure.crop((0, 0, figure.width, round(figure.height * PORTRAIT_FRACTION)))
        bust = ImageOps.fit(bust, (tile.width, tile.height - 18), centering=(0.5, 0),
                            method=Image.Resampling.LANCZOS)

    # A fine curved screen turns the original shading into two-tone engraved lines.
    tone = ImageOps.grayscale(bust)
    screen = Image.new("L", bust.size, 0)
    strokes = ImageDraw.Draw(screen)
    for row in range(-10, tile.height + 10, 6):
        strokes.line([(col, row + 4 * math.sin(col / 25 + row / 45))
                      for col in range(0, tile.width + 3, 3)], fill=37, width=2)
    engraved = ImageOps.colorize(ImageChops.subtract(tone, screen), ink, PAPER)
    tile.paste(engraved, (0, 18), mask=bust.getchannel("A"))
    clip = element(draw.defs, "clipPath", id="portrait-oval")
    element(clip, "ellipse", cx=x, cy=y, rx=width/2, ry=height/2)
    encoded = BytesIO()
    tile.save(encoded, format="PNG")
    data = base64.b64encode(encoded.getvalue()).decode("ascii")
    element(draw.root, "image", x=box[0], y=box[1], width=width, height=height,
            **{"clip-path": "url(#portrait-oval)", f"{{{XLINK_NS}}}href": f"data:image/png;base64,{data}"})
    draw.ellipse(box, outline=PAPER, width=3)


def corners(draw, ink):
    for x in (130, 1730):
        for y in (113, 679):
            outline = wave_points(x, y, 94, 84, 12, .10, 0)
            draw.polygon(outline, fill=ink, outline=PAPER, width=2)
            rosette(draw, x, y, 82, 72, 18, .15, PAPER, passes=6)
            draw.ellipse((x-57, y-57, x+57, y+57), fill=ink, outline=PAPER, width=2)
            lettering(draw, Lettering(DENOMINATION, x, y, 95, 112, ENGRAVED, PAPER))


def leaf_sprays(draw, ink):
    # Mirrored sprigs climb from the base of the portrait.
    for side in (-1, 1):
        def stem(t):
            return (930 + side * (144 + 160*t), 646 - 138*t*t)

        draw.line([stem(step/100) for step in range(101)], fill=ink, width=3)
        for n in range(1, 9):
            t = n / 10
            x, y = stem(t)
            for direction in (-1, 1):
                dx = side * (28 if direction == 1 else 5)
                dy = 10 - 38*t if direction == 1 else -35
                points = []
                for edge in (-1, 1):
                    steps = range(17) if edge == 1 else range(16, -1, -1)
                    for j in steps:
                        u = j / 16
                        bulge = edge * .17 * math.sin(math.pi*u)
                        points.append((x + dx*u - dy*bulge, y + dy*u + dx*bulge))
                draw.polygon(points, fill=ink)
                draw.line([(x, y), (x+dx*.85, y+dy*.85)], fill=PAPER)


def front_face():
    draw = SvgFace()
    frame(draw, GREEN)
    for x in (490, 1370):
        rosette(draw, x, 692, 244, 36, 22, .22, GREEN)
    leaf_sprays(draw, GREEN)
    portrait(draw, FRONT_ART, 930, 431, 415, 442, GREEN)
    seal(draw, 435, 447, 100, GREEN, PAPER)
    seal(draw, 1430, 444, 105, GREEN, PAPER)
    tablet(draw, 930, 638, 116, 21, GREEN, PAPER)
    tablet(draw, 930, 66, 417, 29, GREEN, PAPER)
    tablet(draw, 930, 694, 465, 44, GREEN, PAPER)
    corners(draw, GREEN)
    for item in FRONT_TEXT:
        lettering(draw, item)
    return draw


def cannabis_emblem(draw, cx, cy):
    """Seven serrated leaflets with pale veins cut into the green ink."""
    joint_y = cy + 62
    draw.polygon([(cx - 3, joint_y - 3), (cx + 4, joint_y - 3),
                  (cx - 2, joint_y + 56), (cx - 8, joint_y + 61)], fill=GREEN)

    for degrees, length, half_width in ((-105, 83, 11), (105, 83, 11),
                                        (-70, 135, 16), (70, 135, 16),
                                        (-36, 162, 20), (36, 162, 20), (0, 196, 23)):
        angle = math.radians(degrees)
        sine, cosine = math.sin(angle), math.cos(angle)

        def point(t, offset=0):
            return (cx + length*t*sine + offset*cosine,
                    joint_y - length*t*cosine + offset*sine)

        def width(t):
            return half_width * math.sin(math.pi*t)

        edges = []
        veins = []
        for side in (-1, 1):
            edge = []
            for tooth in range(1, 10):
                t = tooth / 11
                edge.extend([point(t, side * width(t) * .73),
                             point(t + .065, side * width(t))])
                if tooth % 2 == 0:
                    veins.append([point(t - .07), point(t + .045, side * width(t) * .74)])
            edges.append(edge)
        draw.polygon([point(0), *edges[0], point(1), *reversed(edges[1])], fill=GREEN)
        draw.line([point(.06), point(.91)], fill=PAPER, width=2)
        for vein in veins:
            draw.line(vein, fill=PAPER, width=1)


def back_face():
    draw = SvgFace()
    frame(draw, GREEN)
    # Undulating pale lines on a solid green field give the reverse its darker plate.
    draw.rectangle((80, 154, 1780, 637), fill=GREEN)
    for y in range(166, 627, 6):
        draw.line([(x, y + 8*math.sin(x/29 + y/46) + 3*math.cos(x/12 - y/37))
                   for x in range(82, 1780, 3)], fill=PALE)
    for x in (400, 1460):
        seal(draw, x, 398, 205, PAPER, GREEN)
        draw.ellipse((x-163, 235, x+163, 561), fill=PAPER, outline=GREEN, width=4)
    cannabis_emblem(draw, 400, 398)
    portrait(draw, BACK_ART, 930, 318, 262, 264, GREEN)
    tablet(draw, 930, 545, 315, 88, GREEN, PAPER)
    lettering(draw, Lettering(VALUE_WORD, 930, 545, 485, 182, BOLD, PAPER))
    corners(draw, GREEN)
    for item in BACK_TEXT:
        lettering(draw, item)
    return draw


def rasterize(svg, png):
    result = subprocess.run(
        ["rsvg-convert", "--width", str(WIDTH), "--height", str(HEIGHT), str(svg)],
        check=True, stdout=subprocess.PIPE,
    )
    # Set physical print density in the PNG even on renderers that omit pHYs.
    with Image.open(BytesIO(result.stdout)) as rendered:
        rendered.save(png, dpi=(DPI, DPI))


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--rasterize-only", action="store_true",
                        help="render PNGs from the existing SVG files, preserving SVG edits")
    args = parser.parse_args()
    for tool in (["rsvg-convert"] if args.rasterize_only else ["rsvg-convert", "hb-vector"]):
        if not shutil.which(tool):
            parser.exit(1, f"{tool} is required. See the dependencies at the top of this file.\n")

    RAW.mkdir(parents=True, exist_ok=True)
    with TemporaryDirectory(dir=RAW) as temporary:
        staged = []
        for master, make_face in ((FRONT_FILE, front_face), (BACK_FILE, back_face)):
            svg = master
            if not args.rasterize_only:
                svg = Path(temporary) / master.name
                root = make_face().root
                ET.indent(root)
                ET.ElementTree(root).write(svg, encoding="utf-8", xml_declaration=True)
                staged.append((svg, master))
            png = Path(temporary) / master.with_suffix(".png").name
            rasterize(svg, png)
            staged.append((png, master.with_suffix(".png")))
        for source, destination in staged:
            source.replace(destination)
            print(f"Wrote {destination}")
    prepare(refresh=True, refresh_files={master.with_suffix(".png").name for master in (FRONT_FILE, BACK_FILE)})


if __name__ == "__main__":
    main()
