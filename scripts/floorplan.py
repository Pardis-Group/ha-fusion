#!/usr/bin/env python3
"""
Generates data/floorplan.svg: a 2.5D top-down plan of the apartment.

Layout (from the hand sketch / PDF):
  Bedroom      | Kitchen | WC     | Balcony
  Wohnzimmer   | Floor (hall)     | entrance corridor -> door
               | Arbeitszimmer    | stairwell (outside)

Run:  python3 scripts/floorplan.py > data/floorplan.svg
Edit the numbers below and re-run; pins in floorplan.yaml are percentages
of the 1400x1000 canvas.
"""

W, H = 1400, 1000

# ---- grid (px). ~105 px per metre -------------------------------------------
X0, X1, X2, X3, X4 = 120, 514, 746, 932, 1280
Y0, YK, YB, YC, YF, Y4 = 90, 279, 434, 484, 582, 910
OUT, IN = 14, 10          # wall thickness
EXT = 11                  # wall "height" (extrusion downwards)

out = []
def add(s): out.append(s)

# ---- palette ----------------------------------------------------------------
WALL_TOP = "#ebe7df"
WALL_SIDE = "#b9b3a8"
TILE = "#d8d5cf"          # light grey tiles seen in the photos
TILE_DARK = "#c9c5be"
KITCHEN = "#d2d0ca"
WC_TILE = "#dfe2e3"
DECK = "#8f7a62"
OUTSIDE = "#2d2e32"

# ---- helpers ----------------------------------------------------------------
def rect(x, y, w, h, fill, rx=0, extra=""):
    add(f'<rect x="{x}" y="{y}" width="{w}" height="{h}" rx="{rx}" fill="{fill}" {extra}/>')

def circle(cx, cy, r, fill, extra=""):
    add(f'<circle cx="{cx}" cy="{cy}" r="{r}" fill="{fill}" {extra}/>')

def label(x, y, text, size=15):
    add(f'<text x="{x}" y="{y}" font-family="Inter, system-ui, sans-serif" font-size="{size}" '
        f'letter-spacing="2.5" fill="rgba(60,55,50,0.55)" font-weight="500">{text}</text>')

walls = []   # (x, y, w, h)
def wall(x, y, w, h): walls.append((x, y, w, h))

def hwall(x1, x2, y, t, gaps=()):
    """horizontal wall from x1..x2 centred on y, with door gaps [(gx1,gx2)]"""
    cuts = sorted(gaps)
    cur = x1
    for g1, g2 in cuts:
        wall(cur, y - t / 2, g1 - cur, t)
        cur = g2
    wall(cur, y - t / 2, x2 - cur, t)

def vwall(y1, y2, x, t, gaps=()):
    cuts = sorted(gaps)
    cur = y1
    for g1, g2 in cuts:
        wall(x - t / 2, cur, t, g1 - cur)
        cur = g2
    wall(x - t / 2, cur, t, y2 - cur)

def door_h(x1, x2, y, swing=1):
    """door in a horizontal wall; leaf drawn open into +y (swing=1) or -y"""
    w = x2 - x1
    add(f'<path d="M{x1} {y} A{w} {w} 0 0 {1 if swing > 0 else 0} {x1 + (w if swing > 0 else w)} {y + swing * w}" '
        f'fill="none" stroke="#8a6a4a" stroke-width="2" opacity="0.7"/>')
    add(f'<line x1="{x1}" y1="{y}" x2="{x1}" y2="{y + swing * w}" stroke="#7a4f30" stroke-width="5" stroke-linecap="round"/>')

def door_v(y1, y2, x, swing=1):
    w = y2 - y1
    add(f'<path d="M{x} {y1} A{w} {w} 0 0 {0 if swing > 0 else 1} {x + swing * w} {y1 + w}" '
        f'fill="none" stroke="#8a6a4a" stroke-width="2" opacity="0.7"/>')
    add(f'<line x1="{x}" y1="{y1}" x2="{x + swing * w}" y2="{y1}" stroke="#7a4f30" stroke-width="5" stroke-linecap="round"/>')

def window_h(x1, x2, y):
    rect(x1, y - 4, x2 - x1, 8, "#9fc3d9", extra='opacity="0.9"')
    add(f'<line x1="{x1}" y1="{y}" x2="{x2}" y2="{y}" stroke="#ffffff" stroke-width="1.5" opacity="0.8"/>')

def window_v(y1, y2, x):
    rect(x - 4, y1, 8, y2 - y1, "#9fc3d9", extra='opacity="0.9"')
    add(f'<line x1="{x}" y1="{y1}" x2="{x}" y2="{y2}" stroke="#ffffff" stroke-width="1.5" opacity="0.8"/>')

# ---- header -----------------------------------------------------------------
add(f'<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 {W} {H}" width="{W}" height="{H}">')
add('''<defs>
  <pattern id="tiles" width="64" height="64" patternUnits="userSpaceOnUse">
    <rect width="64" height="64" fill="transparent"/>
    <path d="M0 0H64V64" fill="none" stroke="rgba(0,0,0,0.07)" stroke-width="1.2"/>
  </pattern>
  <pattern id="smalltiles" width="22" height="22" patternUnits="userSpaceOnUse">
    <path d="M0 0H22V22" fill="none" stroke="rgba(0,0,0,0.08)" stroke-width="1"/>
  </pattern>
  <pattern id="deck" width="14" height="80" patternUnits="userSpaceOnUse">
    <rect width="14" height="80" fill="transparent"/>
    <line x1="14" y1="0" x2="14" y2="80" stroke="rgba(0,0,0,0.18)" stroke-width="1.5"/>
    <line x1="0" y1="40" x2="14" y2="40" stroke="rgba(0,0,0,0.12)" stroke-width="1"/>
  </pattern>
  <pattern id="rug" width="18" height="18" patternUnits="userSpaceOnUse">
    <circle cx="9" cy="9" r="5" fill="rgba(120,100,80,0.10)"/>
  </pattern>
  <radialGradient id="vig" cx="0.5" cy="0.5" r="0.75">
    <stop offset="0.55" stop-color="#000" stop-opacity="0"/>
    <stop offset="1" stop-color="#000" stop-opacity="0.22"/>
  </radialGradient>
  <linearGradient id="steel" x1="0" y1="0" x2="1" y2="1">
    <stop offset="0" stop-color="#c9ccd0"/><stop offset="1" stop-color="#8e9298"/>
  </linearGradient>
  <linearGradient id="oak" x1="0" y1="0" x2="1" y2="1">
    <stop offset="0" stop-color="#d4b283"/><stop offset="1" stop-color="#b3905f"/>
  </linearGradient>
  <linearGradient id="darkwood" x1="0" y1="0" x2="1" y2="1">
    <stop offset="0" stop-color="#6d4a32"/><stop offset="1" stop-color="#4a3122"/>
  </linearGradient>
  <linearGradient id="sofa" x1="0" y1="0" x2="0" y2="1">
    <stop offset="0" stop-color="#5a5c62"/><stop offset="1" stop-color="#3f4146"/>
  </linearGradient>
  <linearGradient id="glass" x1="0" y1="0" x2="1" y2="1">
    <stop offset="0" stop-color="#cfe6ee" stop-opacity="0.85"/><stop offset="1" stop-color="#9fc3d9" stop-opacity="0.6"/>
  </linearGradient>
  <filter id="building" x="-10%" y="-10%" width="130%" height="135%">
    <feDropShadow dx="14" dy="26" stdDeviation="18" flood-color="#000" flood-opacity="0.6"/>
  </filter>
  <filter id="f" x="-30%" y="-30%" width="160%" height="180%">
    <feDropShadow dx="2" dy="5" stdDeviation="3" flood-color="#000" flood-opacity="0.38"/>
  </filter>
  <filter id="soft" x="-30%" y="-30%" width="160%" height="180%">
    <feDropShadow dx="1" dy="2" stdDeviation="1.5" flood-color="#000" flood-opacity="0.3"/>
  </filter>
</defs>''')

# ---- building slab + shadow --------------------------------------------------
add(f'<g filter="url(#building)"><rect x="{X0 - OUT/2}" y="{Y0 - OUT/2}" width="{X4 - X0 + OUT}" height="{Y4 - Y0 + OUT + EXT}" rx="4" fill="#3a3733"/></g>')

# ---- floors ----------------------------------------------------------------
def floor(x1, y1, x2, y2, fill, pattern="tiles"):
    rect(x1, y1, x2 - x1, y2 - y1, fill)
    if pattern:
        rect(x1, y1, x2 - x1, y2 - y1, f"url(#{pattern})")

floor(X0, Y0, X1, YB, TILE)              # bedroom
floor(X0, YB, X1, Y4, TILE)              # wohnzimmer
floor(X1, Y0, X2, YK, KITCHEN)           # kitchen
floor(X2, Y0, X3, YK, WC_TILE, "smalltiles")  # wc
floor(X3, Y0, X4, YK, DECK, "deck")      # balcony
floor(X1, YK, X3, YF, TILE_DARK)         # floor / hall
floor(X3, YK, X4, YC, TILE_DARK)         # entrance corridor
floor(X1, YF, X3, Y4, TILE)              # office
floor(X3, YC, X4, Y4, OUTSIDE, None)     # stairwell

# stairs in stairwell
for i in range(7):
    rect(X3 + 40, YC + 60 + i * 44, 130, 36, "#36373c")
    rect(X3 + 40, YC + 60 + i * 44, 130, 6, "#45464b")
label(X3 + 190, YC + 230, "TREPPENHAUS", 13)

# vignette per room for depth
for (x1, y1, x2, y2) in [(X0, Y0, X1, YB), (X0, YB, X1, Y4), (X1, Y0, X2, YK), (X2, Y0, X3, YK),
                         (X1, YK, X3, YF), (X3, YK, X4, YC), (X1, YF, X3, Y4), (X3, Y0, X4, YK)]:
    rect(x1, y1, x2 - x1, y2 - y1, "url(#vig)")

# ---- furniture ---------------------------------------------------------------
add('<g filter="url(#f)">')

# Bedroom
rect(X0 + 14, 185, 12, 175, "#2f3136", 3)                       # headboard
rect(X0 + 26, 190, 215, 165, "#46484e", 8)                      # bed frame
rect(X0 + 32, 196, 203, 153, "#55585f", 6)                      # mattress
rect(X0 + 90, 200, 140, 145, "#eceae4", 10)                     # duvet
rect(X0 + 36, 205, 44, 60, "#f2f1ec", 6)                        # pillow
rect(X0 + 36, 275, 44, 60, "#f2f1ec", 6)                        # pillow
rect(X0 + 262, 118, 50, 50, "#f3f1ec", 4)                       # nightstand
circle(X0 + 287, 143, 12, "#d9cfb8")                            # lamp
rect(X0 + 14, 355, 170, 62, "#f1efea", 3)                       # wardrobe
add(f'<line x1="{X0 + 99}" y1="358" x2="{X0 + 99}" y2="414" stroke="#cfccc5" stroke-width="2"/>')
rect(250, Y0 + 10, 150, 9, "#f4f4f4", 2)                        # radiator
for i in range(12):
    add(f'<line x1="{256 + i * 12}" y1="{Y0 + 11}" x2="{256 + i * 12}" y2="{Y0 + 18}" stroke="#d8d8d8" stroke-width="1"/>')

# Wohnzimmer
rect(X0 + 60, 560, 250, 170, "#e7dfd3", 6)                      # rug
rect(X0 + 60, 560, 250, 170, "url(#rug)", 6)
rect(X0 + 14, 505, 68, 190, "url(#sofa)", 10)                   # sofa along window wall
rect(X0 + 14, 505, 18, 190, "#34363b", 10)
rect(X0 + 100, 452, 170, 72, "url(#sofa)", 10)                  # sofa along top wall
rect(X0 + 100, 452, 170, 18, "#34363b", 10)
rect(X0 + 110, 474, 70, 44, "#4b4d53", 6)                       # cushions
rect(X0 + 190, 474, 70, 44, "#4b4d53", 6)
rect(X0 + 120, 600, 125, 72, "url(#oak)", 4)                    # coffee table legs/base
rect(X0 + 116, 596, 133, 80, "url(#glass)", 4)                  # glass top
circle(X0 + 360, 470, 22, "#f3f1ec")                            # side table
rect(X0 + 110, 845, 215, 52, "url(#oak)", 4)                    # tv stand
for i in range(4):
    rect(X0 + 118 + i * 52, 850, 44, 18, "#c7a26d", 2)
rect(X0 + 140, 838, 155, 11, "#1b1b1e", 2)                      # tv
rect(X0 + 290, 640, 100, 165, "url(#oak)", 4)                   # dining table
for (cx, cy) in [(X0 + 275, 680), (X0 + 275, 765), (X0 + 405, 680), (X0 + 405, 765)]:
    rect(cx - 16, cy - 16, 32, 32, "#3a3b40", 6)                # chairs
rect(X0 + 345, 800, 14, 50, "#7a4f30", 7)                       # guitar (neck+body)
circle(X0 + 352, 865, 17, "#8b5a35")

# Kitchen
rect(X1 + 12, Y0 + 10, 150, 62, "#dcdad4", 3)                   # counter
rect(X1 + 12, Y0 + 10, 150, 10, "#c8c6c0", 3)                   # backsplash edge
rect(X1 + 30, Y0 + 24, 60, 38, "#aeb6bb", 6)                    # sink
rect(X1 + 36, Y0 + 29, 48, 28, "#cfd6da", 4)
for (cx, cy) in [(X1 + 112, Y0 + 32), (X1 + 142, Y0 + 32), (X1 + 112, Y0 + 56), (X1 + 142, Y0 + 56)]:
    circle(cx, cy, 9, "#2a2b2e")                                 # hob
    circle(cx, cy, 5, "#444")
rect(X2 - 68, Y0 + 12, 55, 70, "url(#steel)", 4)                # fridge
rect(X1 + 24, Y0 + 100, 90, 66, "#e7e4dd", 6)                   # small table
for (cx, cy) in [(X1 + 12, Y0 + 133), (X1 + 126, Y0 + 133)]:
    rect(cx - 10, cy - 14, 20, 28, "#3a3b40", 4)

# WC
add(f'<ellipse cx="{X2 + 120}" cy="{Y0 + 60}" rx="22" ry="30" fill="#f6f6f4"/>')
rect(X2 + 98, Y0 + 20, 44, 26, "#f6f6f4", 4)                    # cistern
rect(X2 + 24, Y0 + 14, 58, 36, "#f6f6f4", 6)                    # sink
circle(X2 + 53, Y0 + 32, 12, "#dfe6e8")
rect(X2 + 20, YK - 90, 90, 76, "#e4eef1", 6)                    # shower
rect(X2 + 20, YK - 90, 90, 76, "url(#smalltiles)", 6)
circle(X2 + 65, YK - 52, 7, "#b9c6cb")

# Balcony
rect(X3 + 24, Y0 + 24, 36, 36, "#4e6a3a", 18)                   # plant
circle(X3 + 42, Y0 + 42, 12, "#6b8f4e")
rect(X3 + 90, Y0 + 30, 48, 48, "#5f5a52", 8)                    # chair
rect(X3 + 150, Y0 + 30, 48, 48, "#5f5a52", 8)
rect(X3 + 100, Y0 + 100, 90, 60, "#6a6259", 6)                  # table
# railing on the outer edges
add(f'<line x1="{X3}" y1="{Y0 - OUT/2}" x2="{X4}" y2="{Y0 - OUT/2}" stroke="#7d8286" stroke-width="5"/>')
add(f'<line x1="{X4 + OUT/2 - 2}" y1="{Y0}" x2="{X4 + OUT/2 - 2}" y2="{YK}" stroke="#7d8286" stroke-width="5"/>')
for i in range(0, X4 - X3, 24):
    add(f'<line x1="{X3 + i}" y1="{Y0 - OUT/2 - 3}" x2="{X3 + i}" y2="{Y0 + 3}" stroke="#7d8286" stroke-width="2"/>')

# Floor / hall
rect(X1 + 90, YK + 85, 240, 150, "#d9cdbb", 8)                  # rug
rect(X1 + 90, YK + 85, 240, 150, "url(#rug)", 8)
circle(X1 + 45, YK + 55, 20, "#f3f1ec")                         # round side table
add(f'<circle cx="{X1 + 45}" cy="{YK + 55}" r="20" fill="none" stroke="#b9a98f" stroke-width="2"/>')
rect(X3 - 130, YF - 58, 115, 44, "url(#darkwood)", 3)           # vitrine (dishes cabinet)
add(f'<rect x="{X3 - 122}" y="{YF - 52}" width="99" height="32" fill="none" stroke="#c9b79a" stroke-width="1.5" opacity="0.7"/>')
rect(X3 + 60, YK + 14, 120, 34, "#8b5e3c", 3)                   # shoe cabinet near entrance

# Office / Arbeitszimmer
rect(X1 + 130, Y4 - 82, 230, 62, "#f4f3ef", 4)                  # desk
for i in range(3):
    rect(X1 + 150 + i * 70, Y4 - 76, 58, 11, "#1b1b1e", 2)      # monitors
rect(X1 + 215, Y4 - 56, 70, 18, "#2a2b2e", 3)                   # keyboard
circle(X1 + 245, Y4 - 125, 26, "#232427")                       # gaming chair
circle(X1 + 245, Y4 - 125, 16, "#3a3b40")
rect(X1 + 16, Y4 - 86, 58, 66, "url(#steel)", 4)                # fridge in the corner
rect(X1 + 14, YF + 20, 68, 150, "url(#sofa)", 10)               # grey sofa
rect(X1 + 14, YF + 20, 16, 150, "#34363b", 10)
rect(X3 - 66, YF + 70, 52, 190, "url(#darkwood)", 3)            # console / sideboard
rect(X1 + 30, YF + 12, 120, 30, "#3b3d42", 3)                   # bookshelf (black metal / wood)
for i in range(4):
    rect(X1 + 36 + i * 29, YF + 16, 22, 22, "#8a6b4e", 2)

add('</g>')  # furniture

# ---- walls -------------------------------------------------------------------
# outer
hwall(X0, X4, Y0, OUT)                                           # top
hwall(X0, X4, Y4, OUT)                                           # bottom
vwall(Y0, Y4, X0, OUT)                                           # left
vwall(Y0, Y4, X4, OUT)                                           # right
# inner verticals
vwall(Y0, Y4, X1, IN, gaps=[(352, 432), (452, 532)])             # bedroom & wohnzimmer doors
vwall(Y0, YK, X2, IN)                                            # kitchen | wc
vwall(Y0, YK, X3, IN)                                            # wc | balcony
vwall(YC, Y4, X3, IN)                                            # office | stairwell
# inner horizontals
hwall(X0, X1, YB, IN)                                            # bedroom / wohnzimmer
hwall(X1, X3, YK, IN, gaps=[(655, 735), (800, 880)])             # kitchen & wc doors
hwall(X3, X4, YK, IN, gaps=[(1010, 1090)])                       # balcony door
hwall(X1, X3, YF, IN, gaps=[(680, 770)])                         # office door
hwall(X3, X4, YC, IN, gaps=[(1140, 1230)])                       # entrance door

# extruded side faces first, then tops
for (x, y, w, h) in walls:
    rect(x, y, w, h + EXT, WALL_SIDE)
for (x, y, w, h) in walls:
    rect(x, y, w, h, WALL_TOP)

# windows (in outer walls)
window_h(250, 400, Y0)                                           # bedroom
window_v(520, 670, X0)                                           # wohnzimmer
window_h(X1 + 130, X1 + 290, Y4)                                 # office (under the desk)
window_h(X1 + 60, X1 + 170, Y0)                                  # kitchen

# doors
door_v(352, 432, X1, swing=-1)                                   # bedroom (opens into bedroom)
door_v(452, 532, X1, swing=-1)                                   # wohnzimmer
door_h(655, 735, YK, swing=-1)                                   # kitchen
door_h(800, 880, YK, swing=-1)                                   # wc
door_h(1010, 1090, YK, swing=-1)                                 # balcony
door_h(680, 770, YF, swing=1)                                    # office
door_h(1140, 1230, YC, swing=-1)                                 # entrance (opens into corridor)
add(f'<text x="1128" y="{YC + 40}" font-family="Inter, system-ui, sans-serif" font-size="12" letter-spacing="2" fill="rgba(60,55,50,0.6)">EINGANG</text>')

# ---- labels -----------------------------------------------------------------
label(X0 + 24, Y0 + 44, "SCHLAFZIMMER")
label(X0 + 24, YB + 36, "WOHNZIMMER")
label(X1 + 20, YK - 14, "KÜCHE")
label(X2 + 20, YK - 14, "WC")
label(X3 + 24, YK - 14, "BALKON")
label(X1 + 20, YK + 36, "FLUR")
label(X1 + 20, Y4 - 20, "ARBEITSZIMMER")

add('</svg>')
print("\n".join(out))
