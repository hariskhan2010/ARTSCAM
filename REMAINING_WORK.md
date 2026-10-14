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
- Checks: `pnpm run ci` (lint, typecheck, 320 unit tests, build), `pnpm test:e2e` and `pnpm --filter @naqsh/app test:e2e:prod` (13 browser tests each).

## Blocked: needs you

1. **Push to GitHub.** The repo https://github.com/hariskhan2010/ARTSCAM exists but is empty. The push is rejected because the token lacks the `workflow` scope (`.github/workflows/ci.yml`). Set `GITHUB_TOKEN` to a token with `workflow` scope, then run `git push -u origin main`.
2. **First real cut (M2 acceptance).** Export a profile with tabs, air-cut with Z raised, then cut foam or soft wood. Check sizes (±0.2 mm).
3. **Real calligraphy carve (M3 acceptance).** V-carve Nastaliq text in wood with a 60° or 90° V-bit.
4. **Time estimate check (T2.6).** Compare the app's estimate with a GRBL simulator or a real run (target ±15%). Not yet verified.
5. **G-code sender check (T2.5).** Load an exported `.nc` file into a sender's simulator (e.g. UGS, CNCjs).
6. **Try Mach3/LinuxCNC output on a real controller.** It passes the checker, but hasn't run on real hardware.
7. **Open decisions (plan.md §15):** final name (replace "ARTSCAM"/"Naqsh"), licence (GPL vs MIT), and which controllers come after GRBL.

## Known gaps in finished milestones

- **Text** becomes a shape when added, so it can't be edited afterwards (delete and retype). Bidi is simplified (fine for signs). WOFF2 fonts aren't supported. There is no text on a curve (P2).
- **V-carve:** flat bottoms are cut with the V-bit itself; there is no separate flat clearing tool. A 70 mm word takes about 18 min. It could be faster with a true medial-axis path or fewer depth passes.
- **Not started from plan §4 P1:** PWA offline mode (installable app that works without internet).
- **Other §4 gaps:** trace bitmap, mirror/array/nesting (P2).
- The dev server is started by hand with `pnpm dev`.

## Next milestones (plan.md §10), none started

| # | Deliverable | Done when |
|---|---|---|
| M4 | Relief engine: vector → dome/flat/angle/round, combine (add/subtract/merge), smooth, image → relief, 3D view (Three.js), STL export | Relief panel from a photo + vectors |
| M5 | 3D CAM: Z-level roughing, raster finishing (drop-cutter), 3D material-removal simulation | First carved relief on real wood |
| M6 | Sweeps (extrude, spin, two-rail), sculpt brushes, textures, Mach3/LinuxCNC posts | Ex-ArtCAM user can rebuild a typical panel |
| M7 | Public beta: docs, sample projects, 10 pilot users | Pilot users cut real jobs |
| M8 | Desktop app (Tauri) + Web Serial machine control | Send, jog, run from app |
| M9 | Jewelry / rotary: wrap on cylinder, ring tools | Ring relief generated and simulated |
| R | Legacy ArtCAM file import research | Legal + technical go/no-go |

Suggested M4 breakdown before starting: relief grid model and its storage (`reliefs/*.f32` already in the file format), vector → relief profiles via distance field (reuse `vector/clip` offsets), combine ops, image → relief, Three.js view, STL export. Each needs golden tests, as in M1–M3.

## How to resume

- Rules: `CLAUDE.md` (loaded automatically by Claude Code).
- One task at a time, and keep `pnpm run ci` plus both e2e suites green.
- Golden files: `UPDATE_GOLDEN=1 pnpm --filter @naqsh/core test`, then review the diff.
- Safety rules (plan.md §7) are never weakened. Export stays blocked on any checker error.
