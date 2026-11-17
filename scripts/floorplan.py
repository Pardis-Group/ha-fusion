#!/usr/bin/env python3
"""
Generates data/floorplan.svg: an axonometric ("isometric") 3D view of the flat,
with walls cut at a low height like a dollhouse, so every room is visible.

World coordinates are in centimetres. x grows to the east, y to the south.

          x=0        400        590        750                     1110
    y=0   +----------+----------+----------+
          |          |   Balkon (loggia)    |   (neighbour)
    110   |  Schlaf- +----------+----------+
          |  zimmer  |  Küche   |    WC    |
    420   |          +----------+----------+-----------------------+
          |          |                     |   corridor -> Eingang | (entrance on the east wall)
    520   +----------+        Flur         +-----------------------+ 600
          |          |                     |
    700   |  Wohn-   +---------------------+
          |  zimmer  |    Arbeitszimmer    |   (stairwell, outside)
   1000   +----------+---------------------+

Usage:
  python3 scripts/floorplan.py > data/floorplan.svg            # just the image
  python3 scripts/floorplan.py --yaml data/floorplan.yaml > data/floorplan.svg
        # also rewrites floorplan.yaml with pins/rooms at the right spots
        # (this resets pins you moved by hand in "Edit layout")
"""
import math, sys

# ---- view --------------------------------------------------------------------
THETA = 20   # rotation around the vertical axis, degrees (0 = straight from the south)
PHI = 48     # elevation of the camera above the floor, degrees (90 = top-down)
WH = 52      # wall height (cut), cm
MARGIN = 40

CT, ST = math.cos(math.radians(THETA)), math.sin(math.radians(THETA))
SP, CP = math.sin(math.radians(PHI)), math.cos(math.radians(PHI))
OX = OY = 0.0

def P(x, y, z=0.0):
    return (OX + x * CT - y * ST, OY + (x * ST + y * CT) * SP - z * CP)

# ---- plan grid ---------------------------------------------------------------
X0, X1, X2, X3, X4 = 0, 400, 590, 750, 1110
XS = 660          # west wall of the small storage room in the hall
Y0, YBAL, YK, YB, YC, YF, Y4 = 0, 110, 420, 520, 560, 700, 1000
OUT, IN = 14, 9

OUTLINE = [(X0, Y0), (X3, Y0), (X3, YK), (X4, YK), (X4, YC), (X3, YC), (X3, Y4), (X0, Y4)]

# ---- colours (sampled from the photos) ----------------------------------------
def hex2rgb(h): return tuple(int(h[i:i + 2], 16) for i in (1, 3, 5))
def rgb2hex(c): return "#%02x%02x%02x" % tuple(max(0, min(255, int(v))) for v in c)
def shade(h, f): return rgb2hex(tuple(v * f for v in hex2rgb(h)))

WALL = "#efece6"
GLASS = "#a8cbe0"
FRAME = "#6a3a20"       # dark mahogany door frames
DOOR = "#8a4f2c"        # mahogany doors
TILE = "#d6d5d1"        # light grey floor tiles
TILE_HALL = "#cfcdc8"
LAMINATE = "#8b6a4c"    # kitchen wood laminate
WC_TILE = "#eceeee"
BALCONY = "#a7a29a"
SOFA = "#4b4d53"
SOFA_DARK = "#3c3e43"
OAK = "#c9a26e"
BLACK = "#1d1e21"
STEEL = "#b9bdc3"
WHITE = "#f4f3ef"

# ---- primitives --------------------------------------------------------------
flat = []     # floor layer, drawn in plan coordinates under an affine transform
boxes = []    # 3D boxes / cylinders, depth sorted

def frect(x, y, w, h, fill, rx=0, extra=""):
    flat.append(f'<rect x="{x}" y="{y}" width="{w}" height="{h}" rx="{rx}" fill="{fill}" {extra}/>')

def label(x, y, text, size=15, color="rgba(55,50,45,0.5)"):
    flat.append(f'<text x="{x}" y="{y}" font-family="Inter, system-ui, sans-serif" font-size="{size}" '
                f'letter-spacing="3" font-weight="600" fill="{color}">{text}</text>')

class Box:
    def __init__(self, x, y, w, d, h, color, z0=0.0, kind="box", opacity=1.0, shadow=True, south=None, east=None):
        self.x, self.y, self.w, self.d, self.h, self.z0 = x, y, w, d, h, z0
        self.color, self.kind, self.opacity, self.shadow = color, kind, opacity, shadow
        self.south, self.east = south, east   # explicit face fills, e.g. "url(#mirror)"

def box(x, y, w, d, h, color, z0=0.0, opacity=1.0, shadow=True, south=None, east=None):
    boxes.append(Box(x, y, w, d, h, color, z0, "box", opacity, shadow, south, east))

def cyl(cx, cy, r, h, color, z0=0.0, shadow=True):
    boxes.append(Box(cx - r, cy - r, 2 * r, 2 * r, h, color, z0, "cyl", 1.0, shadow))

def pts(points):
    return " ".join(f"{px:.1f},{py:.1f}" for px, py in points)

def poly(points, fill, extra=""):
    return f'<polygon points="{pts(points)}" fill="{fill}" {extra}/>'

def render(b):
    x, y, w, d, z0, z1 = b.x, b.y, b.w, b.d, b.z0, b.z0 + b.h
    op = f'opacity="{b.opacity}"' if b.opacity < 1 else ""
    if b.kind == "cyl":
        r = b.w / 2
        cx, cy = x + r, y + r
        rx, ry = r, r * SP
        tx, ty = P(cx, cy, z1)
        bx, by = P(cx, cy, z0)
        side = shade(b.color, 0.74)
        return (f'<path d="M{tx - rx:.1f} {ty:.1f} L{bx - rx:.1f} {by:.1f} A{rx:.1f} {ry:.1f} 0 0 0 {bx + rx:.1f} {by:.1f} '
                f'L{tx + rx:.1f} {ty:.1f} Z" fill="{side}" {op}/>\n'
                f'<ellipse cx="{tx:.1f}" cy="{ty:.1f}" rx="{rx:.1f}" ry="{ry:.1f}" fill="{b.color}" {op}/>')
    top = [P(x, y, z1), P(x + w, y, z1), P(x + w, y + d, z1), P(x, y + d, z1)]
    south = [P(x, y + d, z0), P(x + w, y + d, z0), P(x + w, y + d, z1), P(x, y + d, z1)]
    east = [P(x + w, y, z0), P(x + w, y + d, z0), P(x + w, y + d, z1), P(x + w, y, z1)]
    return "\n".join([poly(south, b.south or shade(b.color, 0.82), op), poly(east, b.east or shade(b.color, 0.66), op),
                      poly(top, b.color, op)])

# ---- depth sort (painter's algorithm; the camera looks from +x, +y, +z) --------
def sbox(b):
    corners = [P(b.x + dx, b.y + dy, b.z0 + dz) for dx in (0, b.w) for dy in (0, b.d) for dz in (0, b.h)]
    xs, ys = [c[0] for c in corners], [c[1] for c in corners]
    return min(xs), min(ys), max(xs), max(ys)

def depth_sort(items):
    n, eps = len(items), 0.01
    bb = [sbox(b) for b in items]
    nxt, indeg = [[] for _ in range(n)], [0] * n
    for i in range(n):
        a = items[i]
        for j in range(i + 1, n):
            b = items[j]
            if bb[i][2] <= bb[j][0] or bb[j][2] <= bb[i][0] or bb[i][3] <= bb[j][1] or bb[j][3] <= bb[i][1]:
                continue
            a_back = a.x + a.w <= b.x + eps or a.y + a.d <= b.y + eps or a.z0 + a.h <= b.z0 + eps
            b_back = b.x + b.w <= a.x + eps or b.y + b.d <= a.y + eps or b.z0 + b.h <= a.z0 + eps
            if a_back and not b_back:
                nxt[i].append(j); indeg[j] += 1
            elif b_back and not a_back:
                nxt[j].append(i); indeg[i] += 1
    key = lambda k: (items[k].x + items[k].y, items[k].z0)
    ready = sorted((i for i in range(n) if indeg[i] == 0), key=key)
    done, order = [False] * n, []
    while len(order) < n:
        if not ready:
            ready = [min((i for i in range(n) if not done[i]), key=key)]
        i = ready.pop(0)
        if done[i]:
            continue
        done[i] = True
        order.append(i)
        for j in nxt[i]:
            indeg[j] -= 1
            if indeg[j] <= 0 and not done[j]:
                ready.append(j)
        ready.sort(key=key)
    return [items[i] for i in order]

# ---- walls, doors, windows ----------------------------------------------------
def _run(a1, a2, items, make):
    """split a wall run at door gaps / windows"""
    cur = a1
    for (g1, g2, kind) in sorted(items):
        if g1 > cur:
            make(cur, g1, "wall")
        make(g1, g2, kind)
        cur = g2
    if a2 > cur:
        make(cur, a2, "wall")

def _segment(horizontal, fixed, t):
    def make(a, b, kind):
        L = b - a
        def B(off, length, h, color, z0=0, thick=t, opacity=1.0):
            if horizontal:
                box(a + off, fixed - thick / 2, length, thick, h, color, z0, opacity, shadow=False)
            else:
                box(fixed - thick / 2, a + off, thick, length, h, color, z0, opacity, shadow=False)
        if kind == "wall":
            B(0, L, WH, WALL)
        elif kind == "door":
            B(0, 4, WH, FRAME); B(L - 4, 4, WH, FRAME)                         # jambs
            B(4, L - 8, 2, "#b7aa98")                                           # threshold
        elif kind == "window":
            B(0, L, 20, WALL)                                                   # wall under the window
            B(0, L, 2, "#dcdad5", z0=20, thick=t + 8)                           # sill
            B(0, 3, WH - 22, WHITE, z0=22); B(L - 3, 3, WH - 22, WHITE, z0=22)  # white frame
            B(3, L - 6, WH - 22, GLASS, z0=22, thick=4, opacity=0.6)            # pane
        elif kind == "glassdoor":
            B(0, 4, WH, WHITE); B(L - 4, 4, WH, WHITE)
            B(4, L - 8, WH, GLASS, thick=4, opacity=0.55)
    return make

def hwall(x1, x2, y, t, doors=(), windows=(), glassdoors=()):
    items = [(a, b, "door") for a, b in doors] + [(a, b, "window") for a, b in windows] + [(a, b, "glassdoor") for a, b in glassdoors]
    _run(x1, x2, items, _segment(True, y, t))

def vwall(y1, y2, x, t, doors=(), windows=(), glassdoors=()):
    items = [(a, b, "door") for a, b in doors] + [(a, b, "window") for a, b in windows] + [(a, b, "glassdoor") for a, b in glassdoors]
    _run(y1, y2, items, _segment(False, x, t))

def swing_h(x1, x2, y, into, hinge="left"):
    """open door leaf in a horizontal wall; into=+1 opens to the south, -1 to the north"""
    L = x2 - x1 - 8
    hx = x1 + 4 if hinge == "left" else x2 - 4
    tip_closed = x2 - 4 if hinge == "left" else x1 + 4
    box(hx - (0 if hinge == "left" else 4), y if into > 0 else y - L, 4, L, WH - 8, DOOR, shadow=False)
    sweep = (1 if into > 0 else 0) if hinge == "left" else (0 if into > 0 else 1)
    flat.append(f'<path d="M{tip_closed} {y} A{L} {L} 0 0 {sweep} {hx} {y + into * L}" fill="none" '
                f'stroke="rgba(90,55,30,0.4)" stroke-width="1.5" stroke-dasharray="5 4"/>')

def swing_v(y1, y2, x, into, hinge="top"):
    """open door leaf in a vertical wall; into=+1 opens to the east, -1 to the west"""
    L = y2 - y1 - 8
    hy = y1 + 4 if hinge == "top" else y2 - 4
    tip_closed = y2 - 4 if hinge == "top" else y1 + 4
    box(x if into > 0 else x - L, hy - (0 if hinge == "top" else 4), L, 4, WH - 8, DOOR, shadow=False)
    sweep = (0 if into > 0 else 1) if hinge == "top" else (1 if into > 0 else 0)
    flat.append(f'<path d="M{x} {tip_closed} A{L} {L} 0 0 {sweep} {x + into * L} {hy}" fill="none" '
                f'stroke="rgba(90,55,30,0.4)" stroke-width="1.5" stroke-dasharray="5 4"/>')

# ---- floors ------------------------------------------------------------------
def floor(x1, y1, x2, y2, fill, pattern=None):
    frect(x1, y1, x2 - x1, y2 - y1, fill)
    if pattern:
        frect(x1, y1, x2 - x1, y2 - y1, f"url(#{pattern})")
    frect(x1, y1, x2 - x1, y2 - y1, "url(#vig)")

floor(X0, Y0, X1, YB, TILE, "tiles")                 # Schlafzimmer
floor(X0, YB, X1, Y4, TILE, "tiles")                 # Wohnzimmer
floor(X1, Y0, X3, YBAL, BALCONY, "bigtiles")         # Balkon
floor(X1, YBAL, X2, YK, LAMINATE, "planks")          # Küche
floor(X2, YBAL, X3, YK, WC_TILE, "smalltiles")       # WC
floor(X1, YK, X3, YF, TILE_HALL, "tiles")            # Flur
floor(XS, YC, X3, YF, "#c9c6c0", "tiles")            # Abstellraum
floor(X3, YK, X4, YC, TILE_HALL, "tiles")            # corridor
floor(X1, YF, X3, Y4, TILE, "tiles")                 # Arbeitszimmer

# rugs and mats (flat)
def rug(x, y, w, h, fill, rx=8):
    frect(x, y, w, h, fill, rx); frect(x, y, w, h, "url(#rug)", rx)
rug(110, 705, 210, 180, "#e2d9cc")                   # living room, under the coffee table
rug(470, 452, 170, 196, "#cdbfab")                   # hall
rug(780, 470, 200, 60, "#cdbfab", 6)                 # corridor runner
rug(236, 176, 90, 130, "#cfc6bb", 10)                # bedroom, at the foot of the bed
frect(690, 200, 52, 64, "#c8b6a2", 26)               # fluffy WC mat
frect(1030, 470, 60, 30, "#4a3f36", 4)               # door mat

# ---- furniture: Schlafzimmer ---------------------------------------------------------
box(14, 150, 12, 180, 40, "#2a2c31")                        # tall upholstered headboard
box(26, 156, 214, 168, 18, "#3f4147")                       # bed frame
box(30, 160, 206, 160, 8, "#55585f", z0=18)                 # mattress
box(100, 166, 132, 148, 5, "#eeece7", z0=26)                # duvet
box(36, 168, 46, 66, 7, "#f4f3ef", z0=26)                   # pillows
box(36, 246, 46, 66, 7, "#2f3035", z0=26)
box(100, 14, 54, 44, 40, WHITE)                             # white nightstand by the window
cyl(126, 34, 9, 4, "#a59a88", z0=40)                        # lamp
cyl(126, 34, 14, 14, "#8c8276", z0=44)
box(176, 10, 140, 8, 26, "#f7f7f7")                         # radiator under the window
# big white wardrobe with full mirror doors, to the right of the bed
box(14, 344, 60, 168, 60, WHITE)
box(12, 342, 64, 172, 3, "#e4e1da", z0=60)                  # top moulding
for yy in (346, 402, 458):
    box(74, yy, 2, 52, 54, "#e6eef2", z0=3, east="url(#mirror)", shadow=False)
# white dresser in front of the bed with the TV and Alexa on it
box(340, 160, 52, 150, 32, WHITE)
box(340, 160, 52, 2, 32, "#dcd9d2")                         # drawer line
box(364, 186, 6, 104, 36, BLACK, z0=34)                     # TV
box(360, 226, 14, 24, 2, "#2a2b2e", z0=32)                  # TV foot
cyl(372, 296, 7, 5, "#2b2d31", z0=32)                       # Alexa (Echo)
cyl(372, 296, 7, 1, "#38b6ff", z0=37)                       # its blue light ring
box(350, 168, 3, 18, 24, "#2b2c30", z0=32)                  # tablet on a stand

# ---- furniture: Wohnzimmer (door on the east wall, window on the south wall) ----------
box(14, 640, 52, 230, 40, OAK)                              # TV stand opposite the door
box(28, 670, 8, 170, 30, BLACK, z0=40)                      # TV
box(24, 740, 16, 30, 2, "#2a2b2e", z0=40)
box(40, 860, 12, 6, 8, "#d9c7a8", z0=40)                    # picture frame on the stand
cyl(46, 650, 6, 10, "#9aa59a", z0=40)                       # small decor
cyl(34, 612, 10, 50, "#8b5a35")                             # guitar next to the TV stand
cyl(34, 612, 4, 30, "#5d3a20", z0=50)
cyl(40, 952, 22, 36, "#d8c48f")                             # gold side table in the corner
cyl(40, 952, 22, 3, "#f3f2ee", z0=36)
cyl(40, 952, 7, 18, "#e8e3da", z0=39)                       # vase with dried flowers
cyl(40, 952, 3, 14, "#c7a27a", z0=57)
box(84, 924, 186, 66, 30, SOFA)                             # 2-seater under the window
box(84, 970, 186, 20, 24, SOFA_DARK, z0=30)
box(84, 924, 18, 66, 14, SOFA_DARK, z0=30)
box(252, 924, 18, 66, 14, SOFA_DARK, z0=30)
box(106, 930, 70, 38, 6, "#5a5c63", z0=30)
box(178, 930, 70, 38, 6, "#5a5c63", z0=30)
box(196, 936, 34, 26, 10, "#5b5f66", z0=36)                 # cushion
box(316, 690, 70, 240, 30, SOFA)                            # 3-seater along the east wall
box(366, 690, 20, 240, 24, SOFA_DARK, z0=30)
box(316, 690, 70, 18, 14, SOFA_DARK, z0=30)
box(316, 912, 70, 18, 14, SOFA_DARK, z0=30)
for yy in (712, 778, 844):
    box(322, yy, 42, 62, 6, "#5a5c63", z0=30)
box(330, 720, 30, 40, 9, "#d9cfc4", z0=36)                  # patterned pillows
box(330, 870, 30, 40, 9, "#d9cfc4", z0=36)
box(150, 750, 120, 72, 24, OAK)                             # coffee table
box(146, 746, 128, 80, 3, "#d4e7ee", z0=24, opacity=0.8)    # glass top
cyl(196, 780, 5, 22, "#4a1f24", z0=27)                      # wine bottle and glasses
cyl(214, 776, 4, 14, "#e9eef0", z0=27)
cyl(226, 790, 4, 14, "#e9eef0", z0=27)
box(166, 796, 26, 18, 2, "#1e2a44", z0=27)                  # book
box(236, 800, 22, 10, 2, "#202124", z0=27)                  # remote
box(130, 570, 150, 78, 36, "#b8a183")                       # dining table by the bedroom wall
for cx in (150, 205, 260):
    for cy, back in ((548, -1), (668, 1)):
        box(cx - 16, cy - 14, 32, 28, 22, "#3b3c41")
        box(cx - 16, cy + (10 if back > 0 else -14), 32, 4, 22, "#a8adb3", z0=22)
cyl(205, 609, 12, 12, "#e9e4da", z0=36)                     # fruit bowl
cyl(370, 545, 14, 22, "#7a5b45")                            # plant in the corner
cyl(370, 545, 16, 26, "#5f8a4a", z0=22)

# ---- furniture: Küche (galley; counter on the east side, balcony door at the end) --------
box(528, 116, 56, 298, 40, "#e9e6df")                       # white base cabinets
box(526, 114, 60, 302, 3, "#3a3c40", z0=40)                 # dark stone worktop
box(582, 116, 4, 298, 12, "#55575c", z0=43)                 # grey brick backsplash
box(532, 140, 46, 56, 1, "#141517", z0=43)                  # induction hob
for (cx, cy) in [(544, 154), (566, 154), (544, 182), (566, 182)]:
    cyl(cx, cy, 6, 0.5, "#2c2d31", z0=44)
box(534, 214, 40, 52, 2, "#aab2b8", z0=43)                  # steel sink
box(540, 220, 28, 22, 1, "#cfd6db", z0=45)
cyl(574, 246, 3, 16, "#c9cdd2", z0=43)                      # tap
box(548, 196, 30, 14, 1, "#6ac3c7", z0=43)                  # drying mat
cyl(574, 204, 6, 14, "#5f8a4a", z0=43)                      # little plant
box(576, 262, 6, 22, 16, "#b0875a", z0=43)                  # cutting boards
cyl(556, 300, 12, 18, "#1c1c1e", z0=43)                     # air fryer
cyl(556, 334, 7, 22, "#2a2b2f", z0=43)                      # blender
box(546, 352, 22, 20, 18, "#202124", z0=43)                 # coffee machine
cyl(560, 392, 9, 10, "#1f1f22", z0=43)                      # rice cooker
box(406, 220, 7, 110, 30, "#f7f7f7")                        # radiator on the west wall
box(406, 124, 44, 44, 30, "#b98a5c")                        # wooden box/stool by the balcony door
box(408, 126, 40, 40, 5, "#2d2e33", z0=30)
box(406, 330, 30, 70, 3, WHITE, z0=46)                      # wall shelf
cyl(420, 350, 7, 5, BLACK, z0=49)                           # kettle
cyl(420, 372, 5, 5, "#3a3c40", z0=49)                       # tea tin
cyl(410, 392, 7, 2, "#9aa1a8", z0=36)                       # colander on a hook
cyl(410, 408, 6, 2, "#58b0c4", z0=32)                       # pan on a hook

# ---- furniture: WC (long and narrow; bath along the west wall, toilet at the end) -------
box(596, 120, 74, 176, 26, "#f5f5f3")                       # bathtub
box(602, 126, 62, 164, 1, "#e3ecef", z0=26)
box(666, 160, 3, 136, 26, GLASS, z0=26, opacity=0.5)        # glass shower screen
box(596, 292, 74, 3, 26, GLASS, z0=26, opacity=0.5)
cyl(604, 140, 4, 10, "#78c06a", z0=26)                      # shampoo bottles
cyl(612, 140, 4, 12, "#e04a7a", z0=26)
box(596, 330, 50, 56, 32, WHITE)                            # washbasin
cyl(620, 358, 15, 2, "#e6edf0", z0=32)
box(594, 326, 4, 64, 18, "#d7e3e8", z0=36, east="url(#mirror)")  # mirror cabinet
box(742, 330, 5, 60, 26, "#2c3e57", z0=8)                   # dark blue towel on the rail
box(696, 114, 44, 20, 30, "#f6f6f4")                        # cistern
cyl(718, 156, 17, 26, "#f8f8f6")                            # toilet
cyl(718, 156, 12, 1, "#e3e8ea", z0=26)
box(742, 200, 5, 70, 28, "#f7f7f7")                         # radiator
cyl(700, 290, 5, 16, BLACK)                                 # toilet brush
box(724, 284, 16, 16, 18, "#c7c7c4")                        # bin
cyl(746, 186, 6, 8, "#f5f5f5", z0=20)                       # toilet roll
cyl(724, 118, 6, 14, "#5f8a4a", z0=34)                      # plant on the window sill

# ---- furniture: Balkon ----------------------------------------------------------------
box(X1, 0, X3 - X1, 4, 30, "#62676c", shadow=False)        # railing
for xx in range(X1 + 12, X3 - 6, 26):
    box(xx, 0, 3, 4, 30, "#70757a", shadow=False)
cyl(430, 34, 18, 22, "#7a5b45")                             # plant pots
cyl(430, 34, 14, 22, "#5f8a4a", z0=22)
cyl(716, 34, 16, 20, "#7a5b45")
cyl(716, 34, 12, 18, "#6f9a55", z0=20)
box(520, 30, 44, 44, 24, "#4c4f54")                         # chairs
box(520, 30, 44, 8, 22, "#4c4f54", z0=24)
box(620, 30, 44, 44, 24, "#4c4f54")
box(620, 30, 44, 8, 22, "#4c4f54", z0=24)
cyl(592, 60, 22, 34, "#d9d6cf")                             # small round table

# ---- furniture: Flur, corridor, storage --------------------------------------------------
# glass vitrine with dishes, standing in the middle between the bedroom and living room doors
VX, VY = 404, 506
box(VX, VY, 4, 60, 62, "#5a3822")                           # back
box(VX, VY, 46, 3, 62, "#5a3822")                           # sides
box(VX, VY + 57, 4, 3, 62, "#5a3822")                       # front-left post
box(VX + 42, VY + 57, 4, 3, 62, "#5a3822")                  # front-right post
box(VX + 4, VY + 58, 38, 2, 56, GLASS, z0=6, opacity=0.3)   # glass side
box(VX + 4, VY + 3, 42, 54, 6, "#5a3822")                   # base
for zz in (24, 42):
    box(VX + 4, VY + 3, 40, 54, 1.5, "#4a2c18", z0=zz)      # shelves
for zz in (6, 25.5, 43.5):
    for yy in (VY + 14, VY + 32, VY + 48):
        cyl(VX + 24, yy, 7, 4, "#f4f2ee", z0=zz)            # plate stacks and bowls
        cyl(VX + 24, yy, 4, 3, "#e9e6e0", z0=zz + 4)
box(VX + 44, VY + 3, 2, 54, 56, GLASS, z0=6, opacity=0.3)   # glass doors
box(VX - 2, VY - 2, 50, 64, 4, "#6b4329", z0=62)            # crown
cyl(880, 524, 16, 30, "#c9b27a")                            # gold side table, marble top
cyl(880, 524, 16, 2, "#f2f1ed", z0=30)
box(1030, 426, 70, 34, 52, "#7a5434")                       # tall shoe cabinet, opposite the entrance
for zz in (14, 28, 42):
    box(1030, 459, 70, 1, 1.5, "#5e3f25", z0=zz)
box(990, 426, 26, 6, 52, "#c7c9cc", south="url(#mirror)")   # mirror leaning on the wall
box(940, 426, 40, 4, 26, "#f2f2f0", z0=22)                  # fuse box
box(1102, 470, 4, 60, 8, "#5a5048", z0=36)                  # coat hooks
box(1092, 476, 10, 18, 26, "#6b2f2f", z0=10)                # bag on a hook
box(1036, 474, 16, 26, 6, "#1f1f22")                        # shoes on the mat
box(1056, 474, 16, 26, 6, "#1f1f22")
# Abstellraum: grey shelf unit with boxes, a vacuum cleaner
for zz in (0, 18, 36, 54):
    box(708, 566, 38, 128, 2, "#b9bcc0", z0=zz)
for yy in (566, 690):
    box(708, yy, 38, 4, 56, "#8f9398")
box(712, 572, 30, 38, 14, "#c4a57a", z0=2)                  # boxes
box(712, 616, 30, 36, 12, "#d1b48a", z0=2)
box(712, 584, 30, 44, 14, "#9db3c9", z0=20)
box(712, 640, 30, 40, 12, "#c4a57a", z0=38)
cyl(680, 676, 9, 22, "#c0392b")                             # vacuum cleaner
cyl(680, 676, 3, 26, "#2a2b2e", z0=22)
cyl(684, 600, 10, 16, "#5b7fa6")                            # bucket

# ---- furniture: Arbeitszimmer (only desk + fridge by the window, an armchair, the rack) -----
box(452, 938, 220, 56, 36, "#f2f1ec")                       # white standing desk under the window
box(470, 942, 50, 6, 26, BLACK, z0=36)                      # laptop/monitor
box(526, 940, 62, 6, 32, BLACK, z0=36)                      # main monitor
box(594, 942, 56, 6, 28, BLACK, z0=36)                      # right monitor
box(470, 966, 40, 22, 1.5, "#4a4c52", z0=36)                # laptop
box(526, 964, 80, 16, 2, "#26272b", z0=36)                  # keyboard
box(612, 966, 20, 14, 2, "#3a3c40", z0=36)                  # mouse pad
cyl(650, 976, 5, 18, "#3a1414", z0=36)                      # bottle
cyl(640, 960, 4, 8, "#e9e6e0", z0=36)                       # mug
cyl(566, 892, 24, 26, "#232427")                            # gaming chair
box(546, 906, 40, 10, 32, "#2b2c30", z0=26)
cyl(566, 892, 12, 8, "#6a6d72")
box(682, 936, 60, 58, 64, STEEL)                            # stainless fridge next to the desk
box(682, 964, 2, 28, 50, "#8d9197", z0=6)
cyl(712, 965, 8, 8, "#6d6a66", z0=64)                       # little figure on top
# single-seat armchair across from the desk, same (east) side as the fridge
box(668, 760, 74, 80, 26, "#3f4146")
box(722, 760, 20, 80, 22, "#34363a", z0=26)                 # backrest
box(668, 760, 54, 14, 12, "#34363a", z0=26)                 # arms
box(668, 826, 54, 14, 12, "#34363a", z0=26)
box(674, 776, 46, 48, 5, "#4d5057", z0=26)                  # seat cushion
# black/wood bookshelf rack on the wall shared with the Wohnzimmer
RX, RY = 406, 760
for yy in (RY, RY + 70, RY + 136):
    box(RX, yy, 30, 4, 62, BLACK)                           # posts
for zz in (2, 18, 34, 50):
    box(RX, RY, 30, 140, 2, "#7b5b3d", z0=zz)               # wooden shelves
box(RX, RY, 30, 140, 3, "#7b5b3d", z0=62)                   # top
box(RX + 4, RY + 50, 24, 36, 10, BLACK, z0=65)              # box on top
box(RX + 2, RY + 90, 26, 40, 14, "#eceae5", z0=4)           # printer
for i, c in enumerate(("#2f5d50", "#c8b88a", "#7b2d26", "#e6e1d7", "#3b4a6b")):
    box(RX + 6, RY + 80 + i * 9, 18, 7, 13, c, z0=36)       # books
cyl(RX + 15, RY + 30, 9, 5, "#6e6a64", z0=52)               # bowls
cyl(RX + 15, RY + 112, 8, 5, "#e9e6e0", z0=52)
cyl(RX + 15, RY + 30, 5, 14, BLACK, z0=20)                  # shaker bottle

# ---- walls -------------------------------------------------------------------
hwall(X0, X1, Y0, OUT, windows=[(176, 316)])                                     # Schlafzimmer north
vwall(Y0, Y4, X0, OUT)                                                           # west
hwall(X0, X3, Y4, OUT, windows=[(70, 280), (470, 660)])                          # south
vwall(YC, Y4, X3, OUT)                                                           # storage + office east (stairwell)
hwall(X3, X4, YC, OUT, doors=[(1020, 1098)])                                     # corridor south + entrance door
vwall(YK, YC, X4, OUT)                                                           # corridor end
hwall(X3, X4, YK, OUT)                                                           # corridor north (neighbour)
vwall(Y0, YK, X3, OUT)                                                           # Balkon + WC east (neighbour)
hwall(X1, X3, YBAL, IN, glassdoors=[(452, 520)], windows=[(690, 740)])           # Balkon / Küche + WC
vwall(Y0, Y4, X1, IN, doors=[(428, 500), (572, 650)])                            # Schlafzimmer, Wohnzimmer doors
hwall(X0, X1, YB, IN)                                                            # Schlafzimmer / Wohnzimmer
vwall(YBAL, YK, X2, IN)                                                          # Küche / WC
hwall(X1, X3, YK, IN, doors=[(452, 532), (630, 710)])                            # Küche, WC doors
hwall(XS, X3, YC, IN)                                                            # storage north
vwall(YC, YF, XS, IN, doors=[(572, 650)])                                        # storage door, opposite the Wohnzimmer door
hwall(X1, X3, YF, IN, doors=[(452, 532)])                                        # Arbeitszimmer door, opposite the Küche door

swing_v(428, 500, X1, into=-1, hinge="bottom")     # Schlafzimmer, opens into the room
swing_v(572, 650, X1, into=-1, hinge="top")        # Wohnzimmer
swing_h(452, 532, YK, into=-1, hinge="left")       # Küche
swing_h(630, 710, YK, into=-1, hinge="right")      # WC
swing_h(452, 532, YF, into=1, hinge="left")        # Arbeitszimmer
swing_v(572, 650, XS, into=1, hinge="bottom")      # Abstellraum
swing_h(1020, 1098, YC, into=-1, hinge="right")    # entrance, opens into the corridor

# ---- labels lying on the floor -----------------------------------------------------
label(96, 448, "SCHLAFZIMMER")
label(90, 702, "WOHNZIMMER", 14)
label(432, 300, "KÜCHE", 12)
label(674, 196, "WC", 12)
label(452, 24, "BALKON", 11, "rgba(40,40,40,0.5)")
label(560, 446, "FLUR", 13)
label(780, 462, "EINGANG", 11)
label(470, 802, "ARBEITSZIMMER", 14)

# ---- layout of the image ------------------------------------------------------------
def frame_size():
    global OX, OY
    OX = OY = 0.0
    probe = [P(x, y, z) for x, y in OUTLINE + [(X4, YC + 150), (1000, YC + 150)] for z in (-16, WH + 20)]
    minx, miny = min(p[0] for p in probe), min(p[1] for p in probe)
    maxx, maxy = max(p[0] for p in probe), max(p[1] for p in probe)
    OX, OY = MARGIN - minx, MARGIN - miny
    return math.ceil(maxx - minx + 2 * MARGIN), math.ceil(maxy - miny + 2 * MARGIN + 30)

W, H = frame_size()
ISO = f"matrix({CT:.5f} {ST * SP:.5f} {-ST:.5f} {CT * SP:.5f} {OX:.2f} {OY:.2f})"

out = [f'<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 {W} {H}" width="{W}" height="{H}">']
out.append('''<defs>
  <pattern id="tiles" width="50" height="50" patternUnits="userSpaceOnUse">
    <path d="M0 0H50V50" fill="none" stroke="rgba(0,0,0,0.075)" stroke-width="1.2"/>
  </pattern>
  <pattern id="bigtiles" width="40" height="40" patternUnits="userSpaceOnUse">
    <path d="M0 0H40V40" fill="none" stroke="rgba(0,0,0,0.14)" stroke-width="1.2"/>
  </pattern>
  <pattern id="smalltiles" width="14" height="14" patternUnits="userSpaceOnUse">
    <path d="M0 0H14V14" fill="none" stroke="rgba(0,0,0,0.09)" stroke-width="0.9"/>
  </pattern>
  <pattern id="planks" width="120" height="20" patternUnits="userSpaceOnUse">
    <rect width="120" height="10" fill="rgba(255,255,255,0.05)"/>
    <line x1="0" y1="20" x2="120" y2="20" stroke="rgba(0,0,0,0.22)" stroke-width="1.4"/>
    <line x1="70" y1="0" x2="70" y2="20" stroke="rgba(0,0,0,0.14)" stroke-width="1"/>
  </pattern>
  <pattern id="rug" width="12" height="12" patternUnits="userSpaceOnUse">
    <circle cx="6" cy="6" r="3.2" fill="rgba(110,90,70,0.10)"/>
  </pattern>
  <linearGradient id="mirror" x1="0" y1="0" x2="1" y2="1">
    <stop offset="0" stop-color="#eef4f7"/><stop offset="0.45" stop-color="#b9cbd4"/>
    <stop offset="0.55" stop-color="#e4edf1"/><stop offset="1" stop-color="#9fb4bf"/>
  </linearGradient>
  <radialGradient id="vig" cx="0.5" cy="0.5" r="0.75">
    <stop offset="0.55" stop-color="#000" stop-opacity="0"/>
    <stop offset="1" stop-color="#000" stop-opacity="0.2"/>
  </radialGradient>
  <filter id="building" x="-15%" y="-15%" width="140%" height="160%">
    <feDropShadow dx="0" dy="34" stdDeviation="26" flood-color="#000" flood-opacity="0.75"/>
  </filter>
</defs>''')

# building slab with a drop shadow, then its visible edges
def slab_poly(z):
    return [P(x, y, z) for x, y in OUTLINE]
out.append(f'<g filter="url(#building)"><polygon points="{pts(slab_poly(-16))}" fill="#34312d"/></g>')
for (ax, ay), (bx, by) in zip(OUTLINE, OUTLINE[1:] + OUTLINE[:1]):
    # draw only the edges facing the camera (south- or east-facing)
    nx, ny = (by - ay), -(bx - ax)    # outward normal for a clockwise outline
    if nx > 0 or ny > 0:
        f = 0.66 if nx > 0 else 0.82
        out.append(poly([P(ax, ay, -16), P(bx, by, -16), P(bx, by, 0), P(ax, ay, 0)], shade("#4a4540", f)))

# landing outside the entrance (south of the corridor) with the first steps down
out.append(poly([P(990, YC, 0), P(X4 + 20, YC, 0), P(X4 + 20, YC + 70, 0), P(990, YC + 70, 0)], "#3a3b3f"))
for i in range(3):
    y = YC + 72 + i * 24
    out.append(poly([P(1000, y, -5 * (i + 1)), P(X4 + 10, y, -5 * (i + 1)), P(X4 + 10, y + 22, -5 * (i + 1)), P(1000, y + 22, -5 * (i + 1))], "#45464b"))

out.append(f'<g transform="{ISO}">')
out.extend(flat)
for b in boxes:   # contact shadows
    if b.shadow and b.z0 == 0:
        out.append(f'<rect x="{b.x + 4}" y="{b.y + 6}" width="{b.w}" height="{b.d}" rx="5" fill="#000" opacity="0.13"/>')
out.append('</g>')
for b in depth_sort(boxes):
    out.append(render(b))
out.append('</svg>')
print("\n".join(out))

# ---- pin and room anchors -------------------------------------------------------------
def pct(x, y, z=0):
    sx, sy = P(x, y, z)
    return round(sx / W * 100, 1), round(sy / H * 100, 1)

ROOMS = {
    "Bedroom": (200, 250), "Living Room": (200, 770), "Kitchen": (470, 270), "WC": (660, 300),
    "Balcony": (575, 60), "Floor": (540, 560), "Storage": (700, 640), "Office": (575, 850),
}
PINS = [
    ("light.bedroom_schlafzimmer", "Bedroom", None, (200, 250)),
    ("media_player.living_room_firetv_85ae6a591e79459a_television", "Living Room", "Fire TV", (34, 755)),
    ("light.floor_eingang_2", "Floor", None, (540, 560)),
    ("light.office_eingang_2", "Floor", None, (990, 490)),
    ("light.office_homeoffice", "Office", None, (575, 830)),
]

if "--yaml" in sys.argv:
    import yaml
    path = sys.argv[sys.argv.index("--yaml") + 1]
    try:
        with open(path) as f:
            cfg = yaml.safe_load(f) or {}
    except FileNotFoundError:
        cfg = {}
    cfg.setdefault("image", "floorplan.svg")
    cfg.setdefault("temperature", "weather.home")
    cfg.setdefault("people", ["person.mehdi", "person.gaby"])
    cfg["rooms"] = [{"name": n, "x": pct(*xy)[0], "y": pct(*xy)[1]} for n, xy in ROOMS.items()]
    old = {p.get("entity_id"): p for p in cfg.get("pins", []) or []}
    pins = []
    for i, (eid, room, name, xy) in enumerate(PINS, 1):
        p = {"id": old.get(eid, {}).get("id", i), "entity_id": eid, "room": room, "x": pct(*xy)[0], "y": pct(*xy)[1]}
        if name:
            p["name"] = name
        pins.append(p)
    known = {p["entity_id"] for p in pins}
    pins += [p for eid, p in old.items() if eid not in known]   # keep pins added by hand
    cfg["pins"] = pins
    with open(path, "w") as f:
        f.write("# Floor plan page (/floorplan). Image and default pin spots come from scripts/floorplan.py.\n")
        f.write("# Pin x/y are percentages of the image; move them with \"Edit layout\" on the page.\n")
        yaml.safe_dump(cfg, f, sort_keys=False, allow_unicode=True)
    print(f"wrote {path}", file=sys.stderr)
