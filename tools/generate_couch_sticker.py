"""Build the couch sticker with Pillow. Run with tools/.venv/bin/python tools/generate_couch_sticker.py."""

from math import ceil, cos, exp, floor, radians, sin
from pathlib import Path

from PIL import Image, ImageChops, ImageDraw, ImageFilter

ROOT = Path(__file__).resolve().parents[1]
SOURCES = ROOT / ".local/images"
OUTPUT = ROOT / "images/raw/flat-girl-couch-sticker.png"

# Each row locates a horizontal section of the original on a 760 px couch
# guide: (source y, source center x, destination x and y, width scale, roll).
# Neighboring sections guide the existing artwork around the cushion edges.
TORSO = [
    (162, 224, 601, 130, .81, 13), (203, 224, 599, 160, .80, 11),
    (248, 224, 596, 190, .77, 9), (267, 224, 593, 202, .76, 8),
    (292, 224, 592, 209, .76, 6), (343, 224, 592, 229, .75, 5),
    (372, 224, 592, 240, .74, 4),
]
FREE_ARM = [
    (163, 122, 526, 112, .80, 13), (188, 105, 509, 135, .80, 0),
    (216, 89, 493, 159, .78, -7), (232, 77, 489, 172, .75, -26),
    (249, 69, 493, 183, .74, -51), (281, 51, 514, 200, .74, -69),
    (306, 48, 531, 208, .75, -49), (329, 44, 544, 216, .75, -46),
    (366, 32, 560, 235, .75, -46),
]
REST_ARM = [
    (163, 315, 665, 140, .78, 12), (198, 339, 687, 151, .76, -14),
    (222, 362, 705, 157, .75, -23), (251, 384, 721, 173, .74, -16),
    (285, 402, 730, 194, .75, 10), (315, 408, 731, 214, .76, 15),
    (363, 425, 736, 245, .76, 18),
]
FREE_LEG = [
    (372, 168, 551, 237, .74, 5), (401, 166, 548, 247, .72, 9),
    (438, 156, 536, 258, .72, 12), (456, 151, 534, 267, .72, 10),
    (493, 146, 535, 288, .72, 6), (553, 127, 536, 324, .73, 0),
    (601, 107, 535, 353, .74, -7), (680, 82, 532, 402, .75, -7),
]
REST_LEG = [
    (372, 289, 642, 243, .75, 4), (407, 290, 643, 253, .74, 0),
    (444, 300, 645, 265, .73, -2), (460, 304, 646, 273, .73, 0),
    (491, 310, 646, 294, .74, 8), (554, 332, 645, 334, .75, 21),
    (603, 349, 641, 364, .75, 26), (680, 373, 637, 414, .75, 29),
]


def blend(a, b, t):
    return tuple(v + t * (w - v) for v, w in zip(a, b))


def transition(value, start, end):
    t = max(0, min(1, (value - start) / (end - start)))
    return t * t * (3 - 2 * t)


def section_point(rows, x, y):
    index = next((i for i in range(1, len(rows)) if rows[i][0] > y), len(rows) - 1)
    first, last = rows[index - 1], rows[index]
    span = last[0] - first[0]
    t = (y - first[0]) / span
    if 0 <= t <= 1:
        # Match tangents on both sides of each elbow, knee, and wrist.
        prev, after = rows[max(0, index - 2)], rows[min(len(rows) - 1, index + 1)]
        values = []
        for i in range(1, len(first)):
            m0 = (last[i] - prev[i]) * span / (last[0] - prev[0])
            m1 = (after[i] - first[i]) * span / (after[0] - first[0])
            values.append((1 - t) ** 2 * ((1 + 2 * t) * first[i] + t * m0)
                          + t ** 2 * ((3 - 2 * t) * last[i] + (t - 1) * m1))
    else:
        values = blend(first[1:], last[1:], t)
    center, u, v, scale, angle = values
    offset = (x - center) * scale
    return u + offset * cos(radians(angle)), v + offset * sin(radians(angle))


def posed_point(x, y):
    angle = radians(13)
    dx, dy = .81 * (x - 215), .81 * (y - 120)
    head = (607 + dx * cos(angle) - dy * sin(angle), 80 + dx * sin(angle) + dy * cos(angle))
    point = head
    if y > 122:
        body = section_point(TORSO, x, y)
        # The transitions cross the sleeve above each armpit and follow the
        # transparent space between arm and torso below it.
        split = transition(y, 204, 335)
        left = 142 - 51 * split
        right = 301 + 65 * split
        arm_blend = 9 + 24 * (1 - transition(y, 195, 241))
        upper = blend(section_point(FREE_ARM, x, y), body,
                      transition(x, left - arm_blend, left + arm_blend))
        upper = blend(upper, section_point(REST_ARM, x, y),
                      transition(x, right - arm_blend, right + arm_blend))
        legs = blend(section_point(FREE_LEG, x, y), section_point(REST_LEG, x, y),
                     transition(x, 213, 241))
        # Keep the hands on their own paths all the way through the fingertips.
        hip_weight = transition(y, 340, 378) * transition(x, 79, 99) * (1 - transition(x, 353, 379))
        lower = blend(upper, legs, max(hip_weight, transition(y, 370, 384)))
        point = blend(head, lower, transition(y, 122, 178))
    return point


def paint_triangle(canvas, source, dst, src):
    # Invert this triangle's affine map and sample from the full-size original.
    (ax, ay), (bx, by), (cx, cy) = dst
    det = (bx - ax) * (cy - ay) - (cx - ax) * (by - ay)
    if abs(det) < .01:
        return
    left, top = floor(min(ax, bx, cx)), floor(min(ay, by, cy))
    right, bottom = ceil(max(ax, bx, cx)) + 1, ceil(max(ay, by, cy)) + 1
    size = (right - left, bottom - top)
    affine = []
    for a, b, c in zip(*src):
        du = ((b - a) * (cy - ay) - (c - a) * (by - ay)) / det
        dv = ((c - a) * (bx - ax) - (b - a) * (cx - ax)) / det
        affine.extend((du, dv, a + (left - ax) * du + (top - ay) * dv))
    patch = source.transform(size, Image.Transform.AFFINE, affine, Image.Resampling.BICUBIC)
    coverage = Image.new("L", size)
    ImageDraw.Draw(coverage).polygon([(round(x - left), round(y - top)) for x, y in dst], fill=255)
    coverage = ImageChops.darker(coverage, patch.getchannel("a").point(lambda a: 255 if a else 0))
    canvas.paste(patch, (left, top), coverage)


def pose(sarah, size, padding):
    scale = 2 * size[0] / 760
    canvas = Image.new("RGBa", (size[0] * 2, size[1] * 2 + 2 * padding))
    source = sarah.convert("RGBa")
    alpha = source.getchannel("a")
    src, dst = {}, {}
    for y in range(0, 681, 8):
        for x in range(0, 457, 8):
            src[x, y] = (x * source.width / 456, y * source.height / 680)
            u, v = posed_point(x, y)
            dst[x, y] = (u * scale, v * scale + 2 * padding)
    sleeve = []
    for y in range(0, 680, 8):
        for x in range(0, 456, 8):
            corners = [(x, y), (x + 8, y), (x + 8, y + 8), (x, y + 8)]
            if not alpha.crop((*src[corners[0]], *src[corners[2]])).getbbox():
                continue
            for indices in ((0, 1, 2), (0, 2, 3)):
                keys = [corners[i] for i in indices]
                triangle = [dst[k] for k in keys], [src[k] for k in keys]
                # The free forearm and hand rest on top of the shorts.
                if 216 <= y < 368 and x < 142 - 51 * transition(y, 204, 335):
                    sleeve.append(triangle)
                    if y == 216:
                        paint_triangle(canvas, source, *triangle)
                else:
                    paint_triangle(canvas, source, *triangle)
    arm_canvas = Image.new("RGBa", canvas.size)
    for triangle in sleeve:
        paint_triangle(arm_canvas, source, *triangle)
    # Composite at working resolution so the two sides of the elbow share
    # the same antialiasing pass. Limit the hand shadow to contact with the lap.
    hand_shadow = ImageChops.offset(arm_canvas.getchannel("a"), 2, 10).filter(ImageFilter.GaussianBlur(6))
    contact = Image.new("L", (1, canvas.height))
    contact.putdata([round(92 * transition((y / 2 - padding) * 760 / size[0], 187, 206))
                     for y in range(canvas.height)])
    body = shade(canvas.convert("RGBA"), (54, 39, 29), ImageChops.multiply(hand_shadow, contact.resize(canvas.size)))
    combined = Image.alpha_composite(body, arm_canvas.convert("RGBA"))
    return combined.resize((size[0], size[1] + padding), Image.Resampling.LANCZOS)


def shade(art, color, amount):
    result = Image.composite(Image.new("RGBA", art.size, color), art, amount)
    result.putalpha(art.getchannel("A"))
    return result


def finish_figure(sarah, width, padding):
    # A little reflected olive light and the shadow at the bend of the seat
    # carry the upholstery color through the original illustrated figure.
    values = []
    for y in range(sarah.height):
        v = (y - padding) * 760 / width
        crease = exp(-((v - 203) / 9) ** 2)
        values.append(round(6 + 21 * crease))
    light = Image.new("L", (1, sarah.height))
    light.putdata(values)
    sarah = shade(sarah, (101, 96, 65), light.resize(sarah.size))
    # Use the brown from the couch seams as a finer contour around the fabric.
    alpha = sarah.getchannel("A")
    ink = Image.new("RGBA", sarah.size, (62, 43, 35))
    ink.putalpha(alpha.filter(ImageFilter.MaxFilter(9)).point(lambda n: round(n * .92)))
    return Image.alpha_composite(ink, sarah)


def couch_cutout(couch):
    # The JPEG has a black matte around a continuous white keyline. Flood only
    # the exterior and recover fractional coverage at the antialiased white rim.
    gray = couch.convert("L")
    outside = gray.point(lambda n: 255 if n < 224 else 0)
    ImageDraw.floodfill(outside, (0, 0), 128)
    outside = outside.point(lambda n: 255 if n == 128 else 0)
    rim = outside.filter(ImageFilter.MinFilter(5))
    alpha = Image.composite(gray, Image.new("L", couch.size, 255), outside)
    alpha.paste(0, mask=rim)
    alpha = alpha.point(lambda n: 0 if n <= 5 else n)
    result = couch.convert("RGBA")
    result.paste("white", mask=outside)
    result.putalpha(alpha)
    return result


def main():
    with Image.open(SOURCES / "couch.jpg") as original:
        couch = couch_cutout(original)
    with Image.open(SOURCES / "sarah_front_no_outline_v3.9.2.png") as original:
        padding = 96
        sarah = finish_figure(pose(original, couch.size, padding), couch.width, padding)
        profile = original.info.get("icc_profile")

    # Two contact-shadow scales give broad soft contact on the upholstery and
    # a narrow lip under the blanket. Both stop at the edge of the couch.
    padded = Image.new("RGBA", sarah.size)
    padded.paste(couch, (0, padding))
    couch = padded
    mask = sarah.getchannel("A")
    for offset, blur, opacity in [((4, 9), 8, 66), ((1, 3), 2, 51)]:
        shadow = ImageChops.offset(mask, *offset).filter(ImageFilter.GaussianBlur(blur))
        shadow = ImageChops.multiply(shadow, couch.getchannel("A"))
        layer = Image.new("RGBA", couch.size, (42, 31, 22))
        layer.putalpha(shadow.point(lambda n: round(n * opacity / 255)))
        couch = Image.alpha_composite(couch, layer)
    # Continue the couch's white edge around hair or shoes outside the sofa.
    silhouette = mask.point(lambda a: 255 if a >= 128 else 0)
    outline = ImageChops.subtract(silhouette, silhouette.filter(ImageFilter.MinFilter(3)))
    rim = silhouette.copy()
    draw = ImageDraw.Draw(rim)
    radius = round(couch.width * 9 / 760)
    x0, y0, x1, y1 = outline.getbbox()
    for y in range(y0, y1):
        for x in range(x0, x1):
            if outline.getpixel((x, y)):
                draw.ellipse((x - radius, y - radius, x + radius, y + radius), fill=255)
    white = Image.new("RGBA", couch.size, "white")
    white.putalpha(rim.filter(ImageFilter.GaussianBlur(.6)))
    sticker = Image.alpha_composite(Image.alpha_composite(white, couch), sarah)
    sticker = sticker.crop(sticker.getbbox())
    OUTPUT.parent.mkdir(parents=True, exist_ok=True)
    sticker.save(OUTPUT, dpi=(300, 300), icc_profile=profile)
    print(f"{OUTPUT} ({sticker.width} × {sticker.height})")


if __name__ == "__main__":
    main()
