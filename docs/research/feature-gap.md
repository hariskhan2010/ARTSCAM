# Feature gap: relief CAD/CAM tools vs Naqsh

Research, 2026-10-15. Which tools ArtCAM-style relief CAD/CAM programs have, and which Naqsh
still lacks. Sources: Carveco's product comparison (Carveco is ArtCAM's direct successor, so its
tool list is the closest record of what ArtCAM users expect) and Vectric Aspire's feature list.
Workflows and tool concepts are not protected; names, icons and screenshots are (plan.md §2).

Legend: **✅ have** · **🟡 partial** · **❌ missing**. Priority: **P1** next (common in sign,
panel and calligraphy work), **P2** later, **P3** niche. Effort: S (days), M (1–2 weeks), L (more).

## Summary

| Area | Have | Partial | Missing |
|---|---|---|---|
| Vector and text tools | 15 | 2 | 11 |
| Bitmap tools | 1 | 0 | 3 |
| Relief (3D design) tools | 11 | 4 | 21 |
| 2D toolpaths | 7 | 2 | 17 |
| 3D toolpaths | 4 | 1 | 11 |
| Simulation, files, machines | 3 | 2 | 6 |
| **Total** | **41** | **11** | **69** |

Counts are table rows; one row can group several related tools.

The core workflow (draw → relief → rough/finish → checked G-code) is complete. The biggest gaps
for ex-ArtCAM users: **relief layers**, **relief clipart / paste relief and STL import**, **text
on a curve**, **vector arcs, fillets and arrays**, **bitmap tracing**, **more finishing strategies
(spiral, offset, rest machining)** and the **decorative 2D toolpaths (inlay, fluting, bevel)**.

## Vector and text tools

| Tool | Status | Notes | Priority | Effort |
|---|---|---|---|---|
| Rectangle, ellipse, polygon, star, line | ✅ | | | |
| Pen (Bezier curves) | ✅ | | | |
| Node editing (move, add, delete) | ✅ | | | |
| Weld / trim / intersect | ✅ | | | |
| Offset (outward / inward) | 🟡 | Basic offset only; no "advanced" (sharp/rounded/chamfered corners per side) | P2 | S |
| Mirror, flip, rotate, centre, duplicate | ✅ | | | |
| Layers (show, lock) | ✅ | | | |
| Snapping, rulers, typed size/position | ✅ | | | |
| SVG and DXF import, SVG and DXF export | ✅ | | | |
| Text (Urdu, Arabic, Latin; own fonts; editable) | ✅ | | | |
| Arc tool | ✅ | Three clicks (T6.7) | | |
| Fillet / chamfer corners | ✅ | T6.7 | | |
| Block copy / array (grid and circular) | ✅ | T6.7 | | |
| Align and distribute | ✅ | T6.7 | | |
| Join / close open vectors, "vector doctor" (fix gaps, overlaps, duplicates) | ✅ | Join + Repair (T6.7); overlapping shapes are not detected yet | | |
| Text on a curve | ✅ | T6.8: start/middle/end, level on closed shapes, offset, flip; editable | | |
| Single-stroke (engraving) fonts | ❌ | For engraving and V-carved small text | P2 | M |
| Guide lines | ❌ | | P2 | S |
| Measure tool (distance, angle) | ❌ | | P2 | S |
| Envelope distortion (bend text/art into a shape) | ❌ | Arched sign text | P2 | M |
| Smooth / simplify / fit curves to polylines | ❌ | Cleans traced and imported art | P2 | M |
| Vector library (saved shapes) | ❌ | | P2 | S |
| Vector shadow | ❌ | | P3 | S |
| Guilloche patterns | ❌ | | P3 | M |
| Nesting (true shape) | ❌ | Batch parts on a sheet | P2 | L |
| Sheets (multi-sheet jobs) | ❌ | Placeholder in Project tree | P2 | M |
| PDF / AI / EPS import | ❌ | | P2 | M |
| Eraser and fill tools | 🟡 | Placeholders only | P3 | S |

## Bitmap tools

| Tool | Status | Notes | Priority | Effort |
|---|---|---|---|---|
| Image → relief (grayscale) | ✅ | | | |
| Bitmap to vector (trace) | ❌ | Turn a logo or scanned calligraphy into vectors | P1 | M |
| Bitmap editing (paint colours to drive reliefs) | ❌ | ArtCAM's colour-to-relief workflow | P3 | L |
| Bitmap layers, resolution, deskew | ❌ | | P3 | M |

## Relief (3D design) tools

| Tool | Status | Notes | Priority | Effort |
|---|---|---|---|---|
| Shape → relief (flat, dome, angle, round; base height) | ✅ | Called "Shape Editor" elsewhere | | |
| Combine: add, subtract, merge high, merge low, zero | ✅ | | | |
| Smooth, scale, offset, invert | ✅ | | | |
| Relief from grayscale image | ✅ | | | |
| Extrude (rail + start/end section) | ✅ | | | |
| Spin | ✅ | | | |
| Two-rail sweep | ✅ | | | |
| Textures (procedural) | ✅ | Lines, dimples, hammered, weave | | |
| Sculpt: raise (deposit), lower (carve), smooth | ✅ | | | |
| Back relief (two-sided) | ✅ | | | |
| 3D view, STL export | ✅ | | | |
| Scale relief inside a shape only | 🟡 | Scale is whole-relief only | P1 | S |
| Texture from an image tile / along a vector (texture flow) | 🟡 | Procedural patterns only | P2 | M |
| Sculpt: erase (back to a lower layer) | 🟡 | Needs relief layers | P2 | S |
| **Relief layers** (stack, blend modes, show/hide) | ❌ | The core ArtCAM-era workflow; today one relief per side | P1 | L |
| **Relief clipart library + paste relief** (move, scale, rotate a saved relief) | ❌ | Placeholder in tool strip | P1 | M |
| **Import STL / OBJ as a relief** | ❌ | Needed for clipart and purchased models | P1 | M |
| Turn tool (lathe profile around a centre line) | ❌ | Menu placeholder | P2 | S |
| Fade relief (fade height along a line / radius) | ❌ | | P1 | S |
| Add draft (angled side walls) | ❌ | Helps moulding and plaques machine cleanly | P2 | S |
| Angled plane (tilt a relief) | ❌ | | P2 | S |
| Relief cookie cutter / trim to vector | ❌ | Zero outside a shape exists via "zero" combine; no trim tool | P1 | S |
| Zero in / out of a vector | 🟡 | "Zero" combine only zeroes inside | P1 | S |
| Weave wizard (over/under from vectors) | ❌ | Basket-weave texture exists, not vector weaves | P2 | M |
| Relief mirror-merge | ❌ | | P2 | S |
| Contour blend / 3D blend between shapes | ❌ | | P2 | M |
| Constant height lettering | ❌ | Raised text with a flat top on a curved relief | P2 | M |
| Paste relief onto a vector (along a path) | ❌ | | P2 | M |
| Envelope distortion of a relief | ❌ | | P3 | M |
| Remove small holes, magic wand selection | ❌ | | P3 | S |
| Slice relief, create cross section | ❌ | | P3 | S |
| Greyscale from relief (export height map image) | ❌ | | P2 | S |
| Surface area, scale to volume, relief analysis | ❌ | Material / gold estimates (jewelry) | P3 | S |
| Vector shadow onto relief, silhouette, latent imaging | ❌ | | P3 | M |
| Create ring (jewelry) | ❌ | M9 | P3 | L |
| AI text/photo to relief | ❌ | Out of scope for now | P3 | L |

## 2D toolpaths

| Tool | Status | Notes | Priority | Effort |
|---|---|---|---|---|
| Profile (inside, outside, on; tabs; ramp) | ✅ | | | |
| Pocket (offset, raster, islands) | ✅ | | | |
| Drill / peck drill | ✅ | | | |
| V-carve (flat bottom, depth passes) | ✅ | | | |
| Climb / conventional; leave allowance | ✅ | | | |
| Time estimate (acceleration aware) | ✅ | | | |
| Checked export (safety checker) | ✅ | | | |
| Lead-in / lead-out arcs | 🟡 | Ramp only | P2 | S |
| **Inlay (male plug + female pocket)** | ❌ | Very popular with hobby users | P1 | M |
| **Fluting** (tapered grooves, ramp in/out) | ❌ | Furniture and panels | P1 | S |
| **Bevel / prism carving** (raised letters with a V-bit) | ❌ | Classic sign look | P1 | M |
| Chamfer toolpath (edge with a V-bit) | ❌ | | P1 | S |
| Moulding (constant profile along a rail) | ❌ | Our extrude covers the shape; not the dedicated path | P2 | M |
| Texture toolpath (random cuts with the tool's shape) | ❌ | | P2 | M |
| Engrave along a vector (single line) | 🟡 | Profile "on the line" does it; no V-depth control | P2 | S |
| Pocket rest machining (smaller tool clears corners) | ❌ | Multi-tool pockets | P1 | M |
| Toolpath templates (save/apply strategies) | ❌ | | P2 | M |
| Toolpath order, merge, copy, transform | ❌ | | P2 | M |
| Tiling / panelling (big jobs on a small machine) | ❌ | | P2 | M |
| Keep-out zones (clamps) | ❌ | Safety value | P2 | M |
| Job setup sheet (printable) | ❌ | | P2 | S |
| Batch calculate / export all | ❌ | | P2 | S |
| Final pass / separate last pass | ❌ | | P2 | S |
| Form cutters (custom tool shapes) | ❌ | | P3 | M |
| Drill banks, guillotine cuts | ❌ | | P3 | M |
| Laser support | ❌ | | P3 | M |

## 3D toolpaths

| Tool | Status | Notes | Priority | Effort |
|---|---|---|---|---|
| Raster finishing (X, Y, X then Y) | ✅ | | | |
| Z-level roughing with allowance | ✅ | | | |
| Boundary shapes | ✅ | | | |
| Drop-cutter for flat, ball, V, tapered | ✅ | | | |
| Flip (two-sided) machining | 🟡 | Back relief only; no registration pins / flip setup | P2 | M |
| **Spiral finishing** (and spiral in a box) | ❌ | Round work, rosettes | P1 | S |
| **3D offset finishing** (follow the boundary inward) | ❌ | Better on raised panels | P1 | M |
| **3D rest machining** (smaller tool after a big one) | ❌ | Detail after roughing | P1 | M |
| Constant Z (waterline) finishing | ❌ | Steep walls | P2 | M |
| Raster angle (any angle) | ❌ | X or Y only | P2 | S |
| 3D cutout (profile around the relief) | ❌ | | P2 | S |
| Feature machining (pencil, edges) | ❌ | | P3 | M |
| Project a 2D toolpath onto the relief | ❌ | V-carve on a curved surface | P2 | L |
| Surface links / smarter links | ❌ | | P3 | M |
| Rotary (wrapped) machining | ❌ | M9 | P2 | L |
| Ring machining | ❌ | M9 | P3 | L |

## Simulation, files and machines

| Tool | Status | Notes | Priority | Effort |
|---|---|---|---|---|
| Material simulation (2D and 3D) | ✅ | | | |
| GRBL, Mach3, LinuxCNC, generic posts | ✅ | | | |
| Project file (zip), autosave, offline app | ✅ | | | |
| Material colour / shading options | 🟡 | One wood colour | P3 | S |
| Two-sided simulation | 🟡 | Each side separately | P2 | M |
| More posts (ShopBot, DSP/Richauto-style, Centroid, laser) | ❌ | Cheap DSP controllers are common in Pakistan and India | P1 | S each |
| Machine control (send, jog, run) | ❌ | M8 | | |
| Import relief formats (STL, OBJ) | ❌ | See relief table | P1 | M |
| Import legacy relief/project files | ❌ | Research task R | | |
| Feed optimisation (Optifeed-style) | ❌ | | P3 | M |
| Rotary simulation | ❌ | M9 | | |

## Recommended next batch (proposed M6.5)

Ordered by value for ex-ArtCAM sign and panel makers against effort:

1. **Vector basics**: arc tool, fillet/chamfer, array (grid and circular), align/distribute, join/close and vector doctor.
2. **Text on a curve.**
3. **Relief editing**: fade relief, trim relief to a shape (cookie cutter), zero in/out, scale inside a shape.
4. **Relief clipart**: paste relief (place, scale, rotate) and STL/OBJ import, plus a small starter library of our own.
5. **Relief layers** (the largest single item; it also enables sculpt erase).
6. **2D toolpaths**: fluting, chamfer, bevel/prism carving, inlay, pocket rest machining.
7. **3D toolpaths**: spiral and 3D offset finishing, 3D rest machining, raster at any angle.
8. **Bitmap trace** (image to vectors).
9. **Posts for common DSP controllers** (needs a sample file from a pilot user's controller).

Items 1–4 are small and could ship in the beta for pilot users; 5–7 are the bigger engine work.

## Sources

- [Carveco: Maker vs Maker Plus vs Pro, full feature comparison](https://carveco.com/carveco-software-range/product-comparison/)
- [Carveco: 3D relief modelling and design tools](https://carveco.com/carveco-software-range/carveco/3d-design-tools/)
- [Carveco Maker Plus](https://carveco.com/carveco-software-range/carveco-maker-plus/)
- [Carveco support: Fade Relief](https://support.carveco.com/hc/en-gb/articles/19599910668956-3D-Design-Fade-Relief)
- [Carveco support: Envelope Distortion](https://support.carveco.com/hc/en-gb/articles/19600282603548-3D-Design-Envelope-Distortion)
- [Carveco support: Sculpting](https://support.carveco.com/hc/en-gb/articles/19604848552988-3D-Design-Sculpting)
- [Vectric: What's new in Aspire 12.0](https://docs.vectric.com/docs/V12.0/Aspire/ENU/Help/page/whats-new)
- [Vectric: What's new in Aspire 12.5](https://docs.vectric.com/docs/V12.5/Aspire/ENU/Help/page/whats-new/index.html)
- [Aspire feature list (ToolsToday reseller)](https://global.toolstoday.com/aspire-v10-cnc-software-1.html)
- [ArtCAM toolpath handout (University of Virginia)](https://web.arch.virginia.edu/arch549/handouts/artcam-toolpaths.html)
