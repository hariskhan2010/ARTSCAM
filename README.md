# Naqsh (working title)

Open-source, browser-first relief-carving CAD/CAM: vectors → 3D reliefs → toolpaths → simulation → G-code.
See `plan.md` for the full spec and `CLAUDE.md` for working rules.

## Status

| Milestone | State |
|---|---|
| M0 Foundation: schema, units, undo/redo, G-code parser + safety checker | Done |
| M1 Vector editor: shapes, pen, node edit, offset, weld/trim/intersect, SVG/DXF import, SVG export | Done |
| M2 2D CAM: tool library, profile (tabs, ramps), pocket (offset/raster, islands), drill/peck, GRBL post, simulation, time estimate, checked export | Done (software); first real cut still to do |
| M3 Text (Urdu/Arabic/Latin via HarfBuzz, Naskh + Nastaliq bundled, own fonts) + V-carve | Done (software); a real calligraphy carve still to do |
| M4 Relief engine: shape → flat/dome/angle/round, combine, smooth/scale/offset/invert, image → relief, 3D view, STL export | Done |
| M5 3D CAM: Z-level roughing, raster finishing (drop-cutter), 3D simulation, checked export | Done (software); first carved relief still to do |
| M6+ Sweeps, sculpting, textures, … | Not started |

## Using it

The window is laid out where ex-ArtCAM users expect things (with our own icons and colours): a menu bar
(File, Edit, View, Model, Vector, Bitmap, Relief, Toolpath, 3D Printing, Window, Help); two toolbar rows
(file, clipboard, undo, vector editing; then zoom, relief and toolpath tools); the drawing tools on the
left; **2D View / 3D View** tabs with a zoom bar and rulers above the canvas; the **Project** tree
(Vectors, Bitmaps, Front Relief, Toolpaths) with the picked item's settings below it and **Model
Information** at the bottom right; and X, Y, Z (relief height) and selection W × H in the status bar.
Menu items for features that aren't built yet are greyed out ("Coming later").

1. **Design**: draw with the tools on the left (V select, N points, P pen, L line, T text, R rectangle, E ellipse, G polygon, S star, H pan), or **Import** an SVG/DXF. Text takes Urdu, Arabic and English; pick Naskh or Nastaliq, or load your own font. Set the material size and units.
2. **Relief**: create a relief, pick a profile (flat, dome, angle, round) and height, then add the selected shapes, or add a grayscale image. Combine, smooth, scale or invert it; view it in 3D and export STL.
3. **Toolpaths**: add a tool from the presets, select shapes, then pick **Profile**, **Pocket**, **V-carve** (needs a V-bit), **Drill**, **3D rough** (flat end mill) or **3D finish** (ball nose, on the relief). Adjust depth, tabs, ramp and so on.
4. **Simulate**, check the time estimate and safety check, then **Export G-code**. Export stays disabled until the current settings have been simulated and the G-code checker finds no errors.

The built app works offline after the first visit and can be installed from the browser.

Before cutting real material, air-cut first (Z raised), then foam or soft wood (plan.md §13).

## Develop

```sh
pnpm install
pnpm dev        # app dev server at http://localhost:5173
pnpm test       # Vitest in every package
pnpm test:e2e   # Playwright UI tests on the dev server (installed Chrome; PW_CHANNEL='' for bundled Chromium)
pnpm --filter @naqsh/app test:e2e:prod   # the same tests on the production build
pnpm lint       # ESLint + Prettier check
pnpm run ci     # lint, typecheck, test, build
```

Packages: `packages/core` (UI-free model, geometry, CAM, G-code checker) and `packages/app` (React PWA).
Golden files: `fixtures/vector/clip-golden.json` and `fixtures/gcode/golden/*.nc`. After an intended
output change, regenerate them with `UPDATE_GOLDEN=1 pnpm --filter @naqsh/core test`, then review the diff.
