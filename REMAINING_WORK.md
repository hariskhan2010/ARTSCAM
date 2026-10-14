# Remaining work

Status on 2026-10-14. See `plan.md` for the full spec and `README.md` for how to run the app.

## Done (in software, all tests green)

- **M0** Foundation: schema, units, undo/redo, G-code parser and safety checker.
- **M1** Vector editor: shapes, pen, point editing, offset, weld/trim/intersect, SVG/DXF import, SVG export.
- **M2** 2D CAM: tool library, profile (tabs, ramps), pocket (offset/raster, islands), drill/peck, GRBL post, stock simulation, time estimate, export blocked until simulated and checked.
- **M3** Text (Urdu/Arabic/Latin via HarfBuzz; Naskh and Nastaliq bundled; own fonts) and V-carve.
- UI redesign: icons, tool hints, clearer panels.
- Mach3, LinuxCNC and generic G-code output (same safe subset as GRBL, plus a G40 G49 G80 safety line; LinuxCNC files wrapped in %).
- DXF export, autosave in the browser (restored on reload), and `CLAUDE.md` renamed so Claude Code loads it.
- Offline mode (PWA): installable; after one visit the whole app, including fonts and text shaping, works with no server. Tested by shutting the server down.
- **M4** Relief engine: relief grid covering the material; shape → flat/dome/angle/round with base height; combine add/subtract/merge high/merge low/zero; smooth, scale, offset, invert; image → relief (placement, height, invert, blur), images stored in the project zip; watertight binary STL export; Relief panel, canvas shading and a Three.js 3D view.
- **M5** 3D CAM: relief placed with its top at the top of the material; drop-cutter for flat, ball, V and tapered tools (fast row-skipping scan, same result as a full scan); raster finishing (X, Y, X then Y) with a ball nose; Z-level roughing with an allowance; both in the Toolpaths panel with simulation, time estimate and checked export.
- Checks: `pnpm run ci` (lint, typecheck, 341 unit tests, build), `pnpm test:e2e` and `pnpm --filter @naqsh/app test:e2e:prod` (15 browser tests on dev; 16 on the production build, including offline).

## Blocked: needs you

1. **First real cut (M2 acceptance).** Export a profile with tabs, air-cut with Z raised, then cut foam or soft wood. Check sizes (±0.2 mm).
2. **Real calligraphy carve (M3 acceptance).** V-carve Nastaliq text in wood with a 60° or 90° V-bit.
3. **Time estimate check (T2.6).** Compare the app's estimate with a GRBL simulator or a real run (target ±15%). Not yet verified.
4. **G-code sender check (T2.5).** Load an exported `.nc` file into a sender's simulator (e.g. UGS, CNCjs).
5. **Try Mach3/LinuxCNC output on a real controller.** It passes the checker, but hasn't run on real hardware.
6. **First carved relief (M5 acceptance).** Rough with a flat end mill, then finish with a ball nose (air-cut first), on soft wood.
7. **Open decisions (plan.md §15):** final name (replace "ARTSCAM"/"Naqsh"), licence (GPL vs MIT), and which controllers come after GRBL.

## Known gaps in finished milestones

- **Text** becomes a shape when added, so it can't be edited afterwards (delete and retype). Bidi is simplified (fine for signs). WOFF2 fonts aren't supported. There is no text on a curve (P2).
- **V-carve:** flat bottoms are cut with the V-bit itself; there is no separate flat clearing tool. A 70 mm word takes about 18 min. It could be faster with a true medial-axis path or fewer depth passes.
- **Other §4 gaps:** trace bitmap, mirror/array/nesting (P2).
- The dev server is started by hand with `pnpm dev`.
- **Relief:** one relief per project in the UI (no back relief yet).
- **3D CAM:** finishing and roughing cover the whole material (no boundary vector for finishing yet); no rest machining (P3). Finishing a 300 × 200 mm relief at 0.25 mm takes a few seconds per run.

## Next milestones (plan.md §10)

| # | Deliverable | Done when |
|---|---|---|
| M6 | Sweeps (extrude, spin, two-rail), sculpt brushes, textures, Mach3/LinuxCNC posts | Ex-ArtCAM user can rebuild a typical panel |
| M7 | Public beta: docs, sample projects, 10 pilot users | Pilot users cut real jobs |
| M8 | Desktop app (Tauri) + Web Serial machine control | Send, jog, run from app |
| M9 | Jewelry / rotary: wrap on cylinder, ring tools | Ring relief generated and simulated |
| R | Legacy ArtCAM file import research | Legal + technical go/no-go |


## How to resume

- Rules: `CLAUDE.md` (loaded automatically by Claude Code).
- One task at a time, and keep `pnpm run ci` plus both e2e suites green.
- Golden files: `UPDATE_GOLDEN=1 pnpm --filter @naqsh/core test`, then review the diff.
- Safety rules (plan.md §7) are never weakened. Export stays blocked on any checker error.
