#!/usr/bin/env python3
"""Build the legendary monsters' sheets from assets/legendary.png. Run from the repo root: python3 tools/build-legendary.py [preview.png]

legendary.png is a 2 x 2 grid of framed panels on black: Aurelyon on the
left, Noctyrax on the right, front views above and back views below. This
script keys out the black, shrinks each view to a 32 x 32 sprite and a
16 x 14 avatar, synthesises the animation frames and writes:

  assets/monster-legendary.png   32 x 32 cells, one row per (monster, side):
                                 col 0 base, 1-4 shine, 5-10 attack, 11-14 focus
  assets/legendary-avatar.png    16 x 14 cells: col 0 front, col 1 back; one row per monster
"""
import sys
from collections import deque

import numpy as np
from PIL import Image, ImageFilter

SRC = 'assets/legendary.png'
SHEET = 'assets/monster-legendary.png'
AVATARS = 'assets/legendary-avatar.png'
PREVIEW = sys.argv[1] if len(sys.argv) > 1 else None

# The panels, inset a few px to drop the grey frame lines: x0, y0, x1, y1.
PANELS = {
    ('aur', 'front'): (454, 25, 882, 439),
    ('aur', 'back'): (454, 448, 882, 862),
    ('noc', 'front'): (893, 25, 1324, 439),
    ('noc', 'back'): (893, 448, 1324, 862),
}
MONS = ['aur', 'noc']
SIDES = ['front', 'back']
# Glow colours: the outer aura, the bright core and the sparkle for each monster.
GLOW = {
    'aur': {'aura': (255, 196, 64), 'core': (255, 246, 214), 'spark': (255, 255, 255), 'ring': (255, 160, 40)},
    'noc': {'aura': (214, 40, 150), 'core': (255, 214, 240), 'spark': (255, 230, 250), 'ring': (120, 20, 110)},
}
# Where the beam charge forms, per (monster, side), in sprite pixels, and which way the beam
# leaves the cell: the front views face the viewer (down), the back views face away (up).
MOUTH = {
    ('aur', 'front'): ((28, 13), (0, 1)),
    ('aur', 'back'): ((16, 5), (0, -1)),
    ('noc', 'front'): ((29, 13), (0, 1)),
    ('noc', 'back'): ((16, 5), (0, -1)),
}

OUTLINE = {'aur': (176, 112, 48), 'noc': (36, 10, 44)}

# The avatars, 16 x 14 like the hero and the walking sprites, drawn by hand: one
# letter per pixel, from the palette below, a dot for nothing.
AV_PAL = {
    'G': (244, 193, 93), 'W': (255, 246, 230), 'B': (143, 184, 255), 'E': (72, 112, 200), 'S': (255, 255, 255), 'K': (176, 112, 48),
    'N': (10, 2, 14), 'M': (224, 48, 154), 'P': (120, 44, 150), 'D': (46, 20, 56), 'R': (255, 74, 58), 'C': (216, 200, 168), 'L': (255, 122, 208),
}
AVATAR_ART = {
    ('aur', 'front'): [
        '......GGGG......',
        '.....G.SS.G.....',
        '.....GWWWWG.....',
        '.G...WWWWWW...G.',
        '.GG..WEWWEW..GG.',
        '.GWG.WWWWWW.GWG.',
        'GWWWGKWWWWKGWWWG',
        'GWBWWKWWWWKWWBWG',
        '.GWWWWWWWWWWWWG.',
        '..GGGWWWWWWGGG..',
        '.GGG.KWWWWK.....',
        'GWWBG.WWWW......',
        '.GGG.WWK.KWW....',
        '.....WW...WW....',
    ],
    ('aur', 'back'): [
        '......GGGG......',
        '.....G.SS.G.....',
        '.....GWWWWG.....',
        '.G...WWWWWW...G.',
        '.GG..WWWWWW..GG.',
        '.GWG.WWWWWW.GWG.',
        'GWWWGWWWWWWGWWWG',
        'GWBWWWWWWWWWWBWG',
        '.GWWWWWWWWWWWWG.',
        '..GGGWWWWWWGGG..',
        '..GG..WWWW..GG..',
        '.GWWGWWWWWWGWWG.',
        '.GWBG.WW.W.GBWG.',
        '..GG..WW..W.GG..',
    ],
    ('noc', 'front'): [
        '......NNNN......',
        '.....MNNNNM.....',
        'M....C.MM.C....M',
        'MM...DDDDDD...MM',
        'MDM..DRDDRD..MDM',
        'MDDM.DDDDDD.MDDM',
        'MDDDMPDDDDPMDDDM',
        'MPDDPPDDDDPPDDPM',
        '.MPPPDDMDDDPPPM.',
        '..MMMDDMDDDMMM..',
        '.MMM.PDDDDP.....',
        'MDDPM.DDDD......',
        '.MMM.DDC.CDD....',
        '.....CC...CC....',
    ],
    ('noc', 'back'): [
        '......NNNN......',
        '.....MNNNNM.....',
        'M....C.MM.C....M',
        'MM...DDDDDD...MM',
        'MDM..DDDDDD..MDM',
        'MDDM.DDDDDD.MDDM',
        'MDDDMDDDDDDMDDDM',
        'MPDDPDDMMDDPDDPM',
        '.MPPPDDMMDDPPPM.',
        '..MMMDDMMDDMMM..',
        '..MM..DDDD..MM..',
        '.MDDMDDDDDDMDDM.',
        '.MPM.DDD.D.MPM..',
        '..MM.CC..C..MM..',
    ],
}


def avatar(key):
    rows = AVATAR_ART[key]
    out = np.zeros((14, 16, 4), np.uint8)
    for y, row in enumerate(rows):
        assert len(row) == 16, (key, y, row)
        for x, ch in enumerate(row):
            if ch in AV_PAL:
                out[y, x] = (*AV_PAL[ch], 255)
    return out


N_SHINE, N_ATTACK, N_FOCUS = 4, 6, 4
COLS = 1 + N_SHINE + N_ATTACK + N_FOCUS


def key_black(rgb, mon):
    """RGBA with the background cleared: all near-black for Aurelyon (it has no black
    of its own, and the halo and tail curls enclose pockets of background), only the
    black joined to the border for Noctyrax, whose body is nearly black."""
    a = np.asarray(rgb).astype(int)
    h, w, _ = a.shape
    s = a.sum(axis=2)
    if mon == 'aur':
        bg = s < 48
    else:
        dark = s < 36
        bg = np.zeros((h, w), bool)
        q = deque()
        for x in range(w):
            for y in (0, h - 1):
                if dark[y, x]:
                    bg[y, x] = True
                    q.append((y, x))
        for y in range(h):
            for x in (0, w - 1):
                if dark[y, x] and not bg[y, x]:
                    bg[y, x] = True
                    q.append((y, x))
        while q:
            y, x = q.popleft()
            for ny, nx in ((y - 1, x), (y + 1, x), (y, x - 1), (y, x + 1)):
                if 0 <= ny < h and 0 <= nx < w and dark[ny, nx] and not bg[ny, nx]:
                    bg[ny, nx] = True
                    q.append((ny, nx))
    alpha = np.where(bg, 0, 255).astype(np.uint8)
    return Image.fromarray(np.dstack([a.astype(np.uint8), alpha]), 'RGBA')


def shrink(img, w, h, colors, alpha_cut=128, smooth=5, outline=None):
    """Fit `img` into w x h (less a 1 px border when an outline colour is given): a
    median filter first, so thin wisps of flame do not turn into noise, then a
    premultiplied Lanczos downsample, crisp alpha and a small palette, so it reads
    as pixel art; `outline` draws a 1 px line of that colour round the result."""
    img = img.crop(img.getbbox())
    if smooth:
        rgb = img.convert('RGB').filter(ImageFilter.MedianFilter(smooth))
        al = img.getchannel('A').filter(ImageFilter.MedianFilter(smooth))
        img = Image.merge('RGBA', (*rgb.split(), al))
    bw, bh = (w - 2, h - 2) if outline else (w, h)
    sw, sh = img.size
    k = min(bw / sw, bh / sh)
    tw, th = max(1, round(sw * k)), max(1, round(sh * k))
    a = np.asarray(img).astype(float) / 255
    pre = a[..., :3] * a[..., 3:4]
    pre_img = Image.fromarray((pre * 255).astype(np.uint8), 'RGB').resize((tw, th), Image.LANCZOS)
    al_img = Image.fromarray((a[..., 3] * 255).astype(np.uint8), 'L').resize((tw, th), Image.LANCZOS)
    pre = np.asarray(pre_img).astype(float) / 255
    al = np.asarray(al_img).astype(float) / 255
    rgb = np.clip(pre / np.maximum(al[..., None], 1e-3), 0, 1)
    rgb_img = Image.fromarray((rgb * 255).astype(np.uint8), 'RGB')
    pal = rgb_img.quantize(colors=colors, method=0, dither=0).convert('RGB')
    mask = (al * 255 >= alpha_cut)
    out = np.zeros((h, w, 4), np.uint8)
    ox, oy = (w - tw) // 2, (h - th) // 2
    cell = out[oy:oy + th, ox:ox + tw]
    cell[..., :3] = np.asarray(pal)
    cell[..., 3] = np.where(mask, 255, 0)
    if outline:
        edge = silhouette(out, 1) & ~(out[..., 3] > 0)
        out[edge] = (*outline, 255)
    return out


# ---------- Animation effects, all on 32 x 32 RGBA numpy cells ----------

def blend(cell, mask, color, amount):
    """Tint the opaque pixels under `mask` towards `color` by `amount` (0..1)."""
    out = cell.copy()
    m = mask & (cell[..., 3] > 0)
    rgb = out[..., :3].astype(float)
    rgb[m] = rgb[m] * (1 - amount) + np.array(color) * amount
    out[..., :3] = np.clip(rgb, 0, 255).astype(np.uint8)
    return out


def brighten(cell, amount):
    out = cell.copy()
    m = cell[..., 3] > 0
    rgb = out[..., :3].astype(float)
    rgb[m] = rgb[m] + (255 - rgb[m]) * amount
    out[..., :3] = np.clip(rgb, 0, 255).astype(np.uint8)
    return out


def dot(cell, x, y, color, alpha=255):
    h, w, _ = cell.shape
    if 0 <= x < w and 0 <= y < h:
        a = alpha / 255
        px = cell[y, x]
        if px[3] == 0:
            cell[y, x] = (*color, alpha)
        else:
            cell[y, x, :3] = np.clip(px[:3] * (1 - a) + np.array(color) * a, 0, 255).astype(np.uint8)


def disc(cell, cx, cy, r, color, alpha=255):
    for y in range(int(cy - r - 1), int(cy + r + 2)):
        for x in range(int(cx - r - 1), int(cx + r + 2)):
            if (x - cx) ** 2 + (y - cy) ** 2 <= r * r:
                dot(cell, x, y, color, alpha)


def star(cell, cx, cy, size, color):
    """A four-pointed sparkle: size 1 is a dot, 2 a plus, 3 a longer plus with a bright centre."""
    arm = size - 1
    for d in range(-arm, arm + 1):
        dot(cell, cx + d, cy, color)
        dot(cell, cx, cy + d, color)
    if size >= 3:
        dot(cell, cx, cy, (255, 255, 255))


def silhouette(cell, grow):
    """Mask of the sprite dilated by `grow` px."""
    m = cell[..., 3] > 0
    out = m.copy()
    for _ in range(grow):
        g = out.copy()
        g[1:, :] |= out[:-1, :]
        g[:-1, :] |= out[1:, :]
        g[:, 1:] |= out[:, :-1]
        g[:, :-1] |= out[:, 1:]
        out = g
    return out


def aura(cell, grow, color, alpha):
    """Paint a glow of `color` around the sprite, `grow` px wide, under it."""
    out = cell.copy()
    halo = silhouette(cell, grow) & ~(cell[..., 3] > 0)
    ys, xs = np.nonzero(halo)
    for y, x in zip(ys, xs):
        dot(out, x, y, color, alpha)
    return out


def shine_frames(base, mon, n):
    g = GLOW[mon]
    h, w, _ = base.shape
    rng = np.random.default_rng(7 if mon == 'aur' else 11)
    body = np.argwhere(silhouette(base, 1))
    spots = [tuple(body[i][::-1]) for i in rng.choice(len(body), 6, replace=False)]
    frames = []
    for k in range(n):
        ph = np.sin(np.pi * k / n)  # 0 -> 1 -> 0 across the loop
        f = brighten(base, 0.18 * ph)
        f = blend(f, np.ones((h, w), bool), g['core'], 0.12 * ph)
        for i, (sx, sy) in enumerate(spots):
            s = ((k + i * 2) % n)  # each sparkle grows and fades on its own beat
            size = [1, 2, 3, 2][s] if n == 4 else 2
            star(f, sx, sy, size, g['spark'])
        frames.append(f)
    return frames


def attack_frames(base, mon, side, n):
    g = GLOW[mon]
    h, w, _ = base.shape
    (mx, my), (dx, dy) = MOUTH[(mon, side)]
    frames = []
    for k in range(n):
        f = base.copy()
        t = k / (n - 1)
        if k < 2:  # motes of energy drawn in towards the mouth
            r = 7 - k * 3
            for i in range(8):
                ang = i * np.pi / 4 + k * 0.4
                dot(f, int(round(mx + r * np.cos(ang))), int(round(my + r * np.sin(ang))), g['aura'])
            if k == 1:
                disc(f, mx, my, 1.2, g['core'])
        elif k < 4:  # the orb swells, lighting the face
            r = 2 + (k - 2) * 1.2
            f = blend(f, silhouette(base, 0), g['aura'], 0.12 * (k - 1))
            disc(f, mx, my, r + 1.2, g['aura'], 150)
            disc(f, mx, my, r, g['core'])
            disc(f, mx, my, r * 0.5, (255, 255, 255))
            for i in range(6):
                ang = i * np.pi / 3 + k * 0.9
                dot(f, int(round(mx + (r + 3) * np.cos(ang))), int(round(my + (r + 3) * np.sin(ang))), g['spark'])
        else:  # the beam leaves the cell
            f = brighten(f, 0.25 if k == 4 else 0.1)
            f = blend(f, silhouette(base, 0), g['aura'], 0.18)
            width = 3 if k == 4 else 2
            x, y = float(mx), float(my)
            while 0 <= x < w and 0 <= y < h:
                disc(f, x, y, width + 0.6, g['aura'], 200)
                x += dx * 0.7
                y += dy * 0.7
            x, y = float(mx), float(my)
            while 0 <= x < w and 0 <= y < h:
                disc(f, x, y, width - 1.2, g['core'])
                x += dx * 0.7
                y += dy * 0.7
            disc(f, mx, my, width + 1.5 if k == 4 else width, (255, 255, 255))
            for i in range(6):
                ang = i * np.pi / 3 + k
                dot(f, int(round(mx + 6 * np.cos(ang))), int(round(my + 6 * np.sin(ang))), g['spark'])
        frames.append(f)
    return frames


def focus_frames(base, mon, side, n):
    g = GLOW[mon]
    h, w, _ = base.shape
    rng = np.random.default_rng(3 if mon == 'aur' else 5)
    body = silhouette(base, 2)
    cols = [x for x in range(w) if body[:, x].any()]
    motes = [(int(rng.choice(cols)), int(rng.integers(0, h))) for _ in range(10)]
    frames = []
    for k in range(n):
        ph = 0.5 - 0.5 * np.cos(2 * np.pi * k / n)
        f = blend(base, np.ones((h, w), bool), g['aura'], 0.10 + 0.14 * ph)
        f = aura(f, 1, g['aura'], int(110 + 110 * ph))
        if ph > 0.6:
            f = aura(f, 2, g['ring'], int(90 * ph))
        for i, (sx, sy) in enumerate(motes):  # motes drift up along the body
            y = (sy - k * 3 - i) % h
            dot(f, sx, y, g['spark'] if i % 3 else g['core'])
            if i % 4 == 0:
                dot(f, sx, y + 1, g['aura'], 160)
        frames.append(f)
    return frames


def main():
    src = Image.open(SRC).convert('RGB')
    keyed = {key: key_black(src.crop(box), key[0]) for key, box in PANELS.items()}
    bases = {key: shrink(img, 32, 32, 24, outline=OUTLINE[key[0]]) for key, img in keyed.items()}
    avatars = {key: avatar(key) for key in PANELS}

    sheet = np.zeros((32 * len(MONS) * len(SIDES), 32 * COLS, 4), np.uint8)
    for mi, mon in enumerate(MONS):
        for si, side in enumerate(SIDES):
            row = mi * 2 + si
            base = bases[(mon, side)]
            frames = [base] + shine_frames(base, mon, N_SHINE) + attack_frames(base, mon, side, N_ATTACK) + focus_frames(base, mon, side, N_FOCUS)
            for c, f in enumerate(frames):
                sheet[row * 32:(row + 1) * 32, c * 32:(c + 1) * 32] = f
    Image.fromarray(sheet, 'RGBA').save(SHEET)

    av = np.zeros((14 * len(MONS), 16 * len(SIDES), 4), np.uint8)
    for mi, mon in enumerate(MONS):
        for si, side in enumerate(SIDES):
            av[mi * 14:(mi + 1) * 14, si * 16:(si + 1) * 16] = avatars[(mon, side)]
    Image.fromarray(av, 'RGBA').save(AVATARS)

    if PREVIEW:
        K = 5
        bg = Image.new('RGBA', (sheet.shape[1] * K, (sheet.shape[0] + 14 * 2 + 8) * K), (96, 96, 112, 255))
        bg.paste(Image.fromarray(sheet, 'RGBA').resize((sheet.shape[1] * K, sheet.shape[0] * K), Image.NEAREST), (0, 0), Image.fromarray(sheet, 'RGBA').resize((sheet.shape[1] * K, sheet.shape[0] * K), Image.NEAREST))
        avi = Image.fromarray(av, 'RGBA').resize((av.shape[1] * K, av.shape[0] * K), Image.NEAREST)
        bg.paste(avi, (0, (sheet.shape[0] + 8) * K), avi)
        bg.save(PREVIEW)
        print('preview', PREVIEW, bg.size)
    print('wrote', SHEET, sheet.shape, AVATARS, av.shape)


if __name__ == '__main__':
    main()
