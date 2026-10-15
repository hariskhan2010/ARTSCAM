# Remaining work

Status on 2026-10-14. See `plan.md` for the full spec and `README.md` for how to run the app.

## Done (in software, all tests green)

- **M0** Foundation: schema, units, undo/redo, G-code parser and safety checker.
- **M1** Vector editor: shapes, pen, point editing, offset, weld/trim/intersect, SVG/DXF import, SVG export.
- **M2** 2D CAM: tool library, profile (tabs, ramps), pocket (offset/raster, islands), drill/peck, GRBL post, stock simulation, time estimate, export blocked until simulated and checked.
- **M3** Text (Urdu/Arabic/Latin via HarfBuzz; Naskh and Nastaliq bundled; own fonts) and V-carve.
- UI redesign: icons, tool hints, clearer panels.
- ArtCAM-style layout (positions and order only; own icons, colours and name): menu bar, two toolbar rows, left tool strip, 2D/3D View tabs with a zoom bar, rulers (mm/inch), Project tree with the item's panel below, Model Information, status bar with X Y Z and W H. Cut/copy/paste, zoom previous and zoom to selection added. Placeholders (array, eraser, fill, arc, clipart, sheets, turn…) are disabled with "Coming later".
- Mach3, LinuxCNC and generic G-code output (same safe subset as GRBL, plus a G40 G49 G80 safety line; LinuxCNC files wrapped in %).
- DXF export, autosave in the browser (restored on reload), and `CLAUDE.md` renamed so Claude Code loads it.
- Offline mode (PWA): installable; after one visit the whole app, including fonts and text shaping, works with no server. Tested by shutting the server down.
- **M4** Relief engine: relief grid covering the material; shape → flat/dome/angle/round with base height; combine add/subtract/merge high/merge low/zero; smooth, scale, offset, invert; image → relief (placement, height, invert, blur), images stored in the project zip; watertight binary STL export; Relief panel, canvas shading and a Three.js 3D view.
- **M5** 3D CAM: relief placed with its top at the top of the material; drop-cutter for flat, ball, V and tapered tools (fast row-skipping scan, same result as a full scan); raster finishing (X, Y, X then Y) with a ball nose; Z-level roughing with an allowance; both in the Toolpaths panel with simulation, time estimate and checked export. Both can be limited to closed boundary shapes (tool centre stays inside; finishing links lines along the surface inside a shape and lifts between shapes).
- **M6** Sweeps, textures, sculpting (plan.md T6.1–T6.6): cross-sections are open shapes drawn at true size (ends on the base); extrude along a rail (open or closed, optional end section), spin around the section's left end, two-rail sweep (optionally scaling height with width); textures (lines, dimples, hammered, weave) with spacing, height and angle, over the relief or inside a shape; sculpt brush (raise, lower, smooth) on the canvas, each stroke one undoable step. All in the Relief panel and the Relief menu. Mach3/LinuxCNC posts were already done.
- **Time estimate (T2.6) checked against grbl-sim:** all 10 golden files within ±10% (most within ±5%); a unit test keeps it there. First moves from an unknown start are now timed from the work origin.
- **Sender check (T2.5):** all 10 golden files stream to grbl-sim with no error, pass GRBL's own `gvalidate`, and load in CNCjs's G-code loader (`gcode-toolpath`) with correct size and units.
- Checks: `pnpm run ci` (lint, typecheck, 375 unit tests, build), `pnpm test:e2e` and `pnpm --filter @naqsh/app test:e2e:prod` (22 browser tests on dev; 23 on the production build, including offline).

## Blocked: needs you

1. **First real cut (M2 acceptance).** Export a profile with tabs, air-cut with Z raised, then cut foam or soft wood. Check sizes (±0.2 mm).
2. **Real calligraphy carve (M3 acceptance).** V-carve Nastaliq text in wood with a 60° or 90° V-bit.
3. **Time estimate on a real machine (optional).** Simulator check is done (see below); a stopwatch on one real job would confirm it.
4. **Try Mach3/LinuxCNC output on a real controller.** It passes the checker, but hasn't run on real hardware.
5. **First carved relief (M5 acceptance).** Rough with a flat end mill, then finish with a ball nose (air-cut first), on soft wood.
6. **Open decisions (plan.md §15):** final name (replace "ARTSCAM"/"Naqsh") and which controllers come after GRBL. Licence is decided: MIT (`LICENSE`).

## Known gaps in finished milestones

- **Text** stays editable (Selection › Edit text) after moving, rotating or scaling; node edits, offsets and booleans turn it into a plain shape. Bidi is simplified (fine for signs). WOFF2 fonts aren't supported. There is no text on a curve (P2).
- **V-carve:** flat bottoms are cut with the V-bit itself; there is no separate flat clearing tool. Roughing passes now space out the rings that sit on the pass floor (the final pass is unchanged), roughly halving the time of deep carves (a 70 mm Nastaliq word at 6 mm: 7.7 → 3.7 min with a 60° bit). A true medial-axis path could cut it further.
- **Other §4 gaps:** trace bitmap, mirror/array/nesting (P2).
- **M6 acceptance (needs you):** an ex-ArtCAM user rebuilding one of their typical panels. Not built: Turn (lathe-style), relief clipart library, sculpt brush preview circle, editing a sweep's settings after adding it (remove the step and add it again).
- The dev server is started by hand with `pnpm dev`.
- **Relief:** front and back relief (Project tree). The back is designed seen from the front and machined mirrored left to right, with a flip note in the G-code, and a warning when front and back together are deeper than the material.
- **3D CAM:** no rest machining (P3). Finishing a 300 × 200 mm relief at 0.25 mm takes a few seconds per run.

## Next milestones (plan.md §10)

| # | Deliverable | Done when |
|---|---|---|
| M7 | Public beta: docs, sample projects, 10 pilot users | Pilot users cut real jobs |
| M8 | Desktop app (Tauri) + Web Serial machine control | Send, jog, run from app |
| M9 | Jewelry / rotary: wrap on cylinder, ring tools | Ring relief generated and simulated |
| R | Legacy ArtCAM file import research | Legal + technical go/no-go |


## How to resume

- Rules: `CLAUDE.md` (loaded automatically by Claude Code).
- One task at a time, and keep `pnpm run ci` plus both e2e suites green.
- Golden files: `UPDATE_GOLDEN=1 pnpm --filter @naqsh/core test`, then review the diff.
- Safety rules (plan.md §7) are never weakened. Export stays blocked on any checker error.
