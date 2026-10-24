"""Draw the Luminor icon (blue rounded square with a white target) as a Windows .ico.

Same design as static/favicon.svg, rendered with Pillow at every size Windows uses.
Usage: python make_icon.py   ->   assets/luminor.ico
"""
from pathlib import Path

from PIL import Image, ImageDraw

SIZE = 1024
SIZES = [16, 20, 24, 32, 40, 48, 64, 96, 128, 256]
OUT = Path(__file__).resolve().parent / "assets" / "luminor.ico"


def draw(size: int = SIZE) -> Image.Image:
    s = size / 64  # favicon.svg is drawn on a 64x64 grid
    # Diagonal gradient #5AC8FA -> #0A84FF
    grad = Image.new("RGBA", (size, size))
    top, bottom = (0x5A, 0xC8, 0xFA), (0x0A, 0x84, 0xFF)
    px = grad.load()
    for y in range(size):
        for x in range(size):
            t = (x + y) / (2 * (size - 1))
            px[x, y] = tuple(round(a + (b - a) * t) for a, b in zip(top, bottom)) + (255,)
    mask = Image.new("L", (size, size), 0)
    ImageDraw.Draw(mask).rounded_rectangle([0, 0, size - 1, size - 1], radius=14 * s, fill=255)
    icon = Image.new("RGBA", (size, size), (0, 0, 0, 0))
    icon.paste(grad, (0, 0), mask)

    d = ImageDraw.Draw(icon)
    white = (255, 255, 255, 255)
    c, w = 32 * s, 3.5 * s
    d.ellipse([c - 17 * s, c - 17 * s, c + 17 * s, c + 17 * s], outline=white, width=round(w))
    d.ellipse([c - 7 * s, c - 7 * s, c + 7 * s, c + 7 * s], fill=white)
    for x0, y0, x1, y1 in [(32, 8, 32, 16), (32, 48, 32, 56), (8, 32, 16, 32), (48, 32, 56, 32)]:
        d.line([x0 * s, y0 * s, x1 * s, y1 * s], fill=white, width=round(w))
        for x, y in ((x0, y0), (x1, y1)):  # round caps
            d.ellipse([x * s - w / 2, y * s - w / 2, x * s + w / 2, y * s + w / 2], fill=white)
    return icon


if __name__ == "__main__":
    OUT.parent.mkdir(parents=True, exist_ok=True)
    big = draw()
    big.save(OUT, format="ICO", sizes=[(n, n) for n in SIZES])
    big.resize((256, 256), Image.LANCZOS).save(OUT.with_suffix(".png"))
    print(f"wrote {OUT}")
