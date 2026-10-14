# Open-Source ArtCAM Successor — Plan v0.1

> Goal: a free, open-source **relief-carving CAD/CAM** app that replaces discontinued Autodesk ArtCAM: design vectors → build 3D reliefs → generate toolpaths → simulate → G-code for CNC routers. Web app first, desktop second.

**Working title:** `ARTSCAM` is a placeholder only. Rename before any public release (see §2). Candidate: **Naqsh** (Urdu: carving / engraved pattern). Check availability.

**Defaults assumed (change in §15 if wrong):** wood carving + signs first, jewelry later · GRBL hobby routers first, Mach3 / LinuxCNC posts next · web first, then desktop · built by one developer with Claude Code, task by task.

---

## 1. Reality check

| Fact | Implication |
|---|---|
| Autodesk discontinued ArtCAM in 2018; licence files (PAF) expire and cannot be renewed | Existing users lose access over time; they need somewhere to go |
| Carveco is the paid successor, built on the ArtCAM codebase | The commercial path exists; the free path doesn't |
| AlternativeTo lists 12 alternatives, all paid and proprietary (Vectric Aspire, Carveco, ARTCLIP-3D, …) | **No open-source ArtCAM equivalent found** |
| Free fragments exist: image-to-relief tools, FreeCAD CAM, Kiri:Moto (browser CAM), OpenCAMLib | Building blocks exist; nobody has assembled the full vector → relief → CAM workflow |

**Gap:** CorelDRAW has Inkscape. ArtCAM has nothing.

## 2. Positioning and naming

**Users:** hobby and small-shop CNC owners (wood carving, signs, furniture panels, mosques/calligraphy panels, gifts), ex-ArtCAM users, students.

**Why us:** free · runs in a browser (no install, works on weak PCs) · Urdu/Arabic calligraphy-friendly text tools · works with cheap GRBL routers · open file formats.

**Naming / legal rules**
- Do **not** use "ArtCAM", "Carveco", or their logos, icons or screenshots. Describe compatibility in plain words ("imports legacy ArtCAM relief files" only if and when true).
- "ARTSCAM" reads as "art scam" and is close to a trademark. Rename before launch.
- Match **workflows and tool concepts** (they are not protected); design your own UI.

## 3. What ArtCAM users actually need

| ArtCAM workflow | Our equivalent |
|---|---|
| Draw / import vectors, text, nodes | Vector editor (layer 1) |
| Shape Editor: vector → dome / flat / angle / round relief | Relief-from-vector ops |
| Extrude, Spin, Turn, Two-rail sweep | Relief sweep ops |
| Combine reliefs (add / subtract / merge high / merge low) | Relief boolean ops |
| Sculpt (smooth, carve, deposit, erase) | Brush-based heightmap sculpting |
| Bitmap → relief, textures | Image-to-relief + texture tiling |
| Profile, pocket, V-carve, drill toolpaths | 2D CAM |
| 3D roughing + finishing | 3D CAM |
| Simulation | Stock heightmap simulation |
| Save toolpaths for machine | Post-processors (GRBL, Mach3, LinuxCNC, generic) |

## 4. Capability map

**P1** = v1 (usable for signs and simple reliefs) · **P2** = after first users · **P3** = advanced · **R** = research first.

| Area | Capability | Phase | How |
|---|---|---|---|
| **Document** | Units (mm/inch), stock size, thickness, XY origin, Z zero (top/bed) | P1 | Project model |
| | Layers, undo/redo, autosave | P1 | Command pattern + IndexedDB |
| **Vectors** | Rectangle, ellipse, polygon, star, line, Bezier pen | P1 | Own vector model |
| | Node editing, join, close, offset, fillet | P1 | Clipper2 for offsets/booleans |
| | Boolean weld / trim / intersect | P1 | Clipper2 |
| | Text from fonts (incl. Urdu/Arabic shaping), text on curve | P1 / P2 | opentype.js + HarfBuzz (WASM) |
| | Import SVG, DXF; export SVG, DXF | P1 | |
| | Trace bitmap → vectors | P2 | Potrace-style tracing |
| | Mirror, array, nesting | P2 | |
| **Relief** | Heightmap relief at chosen resolution | P1 | Float32 grid |
| | Vector → relief: flat, dome, angle, round (with height limit, scale) | P1 | Distance-field profiles |
| | Combine: add, subtract, merge high, merge low, zero | P1 | Per-pixel ops |
| | Smooth, scale height, offset, invert, fade | P1 | |
| | Image → relief (grayscale, invert, blur, contrast) | P1 | |
| | Extrude along rail, spin, turn, two-rail sweep | P2 | |
| | Sculpt brushes (smooth, carve, deposit, erase) | P2 | GPU brush on heightmap |
| | Textures (tiled pattern relief) | P2 | |
| | Import STL/OBJ as relief (Z-projection) | P2 | Rasterize mesh to heightmap |
| | AI depth-map image → relief | P3 | Optional model, local or cloud |
| | Wrap relief on cylinder (rings, rotary) | P3 | |
| **Tools** | Tool library: flat end mill, ball nose, V-bit, tapered ball | P1 | Diameter, angle, flutes, step-down, step-over, feeds, speeds |
| **2D CAM** | Profile inside/outside/on, multi-pass, tabs, lead-in, ramp | P1 | Clipper2 offsets |
| | Pocket (offset + raster), island handling | P1 | |
| | Drilling / peck drilling | P1 | |
| | V-carve (flat-bottom optional) | P2 | Medial axis / straight skeleton |
| | Inlay (male/female V-carve) | P3 | |
| **3D CAM** | Z-level roughing | P2 | Slice relief by depth bands |
| | Raster finishing (X, Y, XY) with ball nose | P2 | Drop-cutter on heightmap |
| | Rest machining, boundary limits | P3 | |
| **Simulation** | 2D toolpath preview | P1 | |
| | Material removal simulation on stock heightmap | P1 (2D) / P2 (3D) | GPU or WASM dexel/heightmap |
| | Estimated cutting time | P1 | From feeds + path length |
| **Output** | Post-processors: GRBL | P1 | Template-based posts |
| | Mach3, LinuxCNC, generic | P2 | |
| | Machine limits check (travel, feed, Z) | P1 | **Mandatory, blocks export** |
| | Send to GRBL machine from browser (Web Serial) | P3 | Chromium only; jog, home, run |
| **Files** | Open project format (.zip: JSON + binary reliefs) | P1 | |
| | Legacy ArtCAM `.art` / `.rlf` import | R | Undocumented format; legal review first |
| **Platform** | Web (PWA, offline) | P1 | |
| | Desktop (Tauri) with native file and serial access | P3 | |

## 5. Architecture

```
┌──────────────────────────── Browser (PWA) ────────────────────────────┐
│ UI (React)                                                             │
│  2D canvas (vectors, toolpaths)   3D view (relief, sim)   Panels       │
│        │                                │                              │
│ ┌──────▼──────────────── Document store (single source of truth) ──┐   │
│ │ project.json: units · stock · layers · vectors · reliefs(refs) ·  │   │
│ │ tools · toolpaths(params) · machine     + command history (undo)  │   │
│ └──────┬───────────────────────────────────────────────────────────┘   │
│        │ commands                                                      │
│ ┌──────▼──────────── Geometry & CAM core (TS + WASM, Web Workers) ──┐  │
│ │ vector ops (Clipper2) · text (opentype/HarfBuzz) · relief engine  │  │
│ │ toolpath generators · simulator · post-processors · limit checks  │  │
│ └───────────────────────────────────────────────────────────────────┘  │
│ Storage: IndexedDB autosave · File System Access API · .zip project    │
└────────────────────────────────────────────────────────────────────────┘
```

**Rules**
1. The **core is UI-free**: pure functions on the document model, unit-testable in Node, reusable by the desktop app.
2. Heavy work (relief ops, toolpaths, simulation) runs in **Web Workers**; the UI never freezes.
3. **Toolpaths are derived data:** store parameters; regenerate when inputs change.
4. **Every G-code file passes the safety checker** before export (§7).
5. Internal units are **mm, float64**; convert only at the UI and post-processor edges.

## 6. Data model (v0)

```json
{
  "format": "naqsh-project", "version": "0.1",
  "units": "mm",
  "stock": {"width": 300, "height": 200, "thickness": 18, "origin": "bottom-left", "zZero": "top"},
  "layers": [{"id": "L1", "name": "Design", "visible": true, "locked": false}],
  "vectors": [
    {"id": "v1", "layer": "L1", "closed": true,
     "segments": [{"type": "move", "p": [10, 10]}, {"type": "line", "p": [110, 10]},
                  {"type": "cubic", "c1": [120, 40], "c2": [120, 60], "p": [110, 90]}, {"type": "close"}]}
  ],
  "reliefs": [
    {"id": "r1", "resolution": 0.2, "cols": 1500, "rows": 1000, "data": "reliefs/r1.f32",
     "ops": [{"op": "fromVector", "vector": "v1", "profile": "dome", "height": 6, "mode": "add"}]}
  ],
  "tools": [
    {"id": "t1", "type": "vbit", "diameter": 12.7, "angle": 90,
     "stepDown": 2, "stepOver": 0.4, "feed": 1200, "plunge": 300, "rpm": 18000}
  ],
  "toolpaths": [
    {"id": "tp1", "type": "profile", "tool": "t1", "vectors": ["v1"],
     "params": {"side": "outside", "depth": 6, "tabs": {"count": 4, "width": 6, "height": 2}}}
  ],
  "machine": {"post": "grbl", "travel": [800, 800, 100], "maxFeed": 5000, "safeZ": 5}
}
```

Project file = `.zip` containing `project.json` + `reliefs/*.f32` (+ thumbnails). Validate with a JSON schema (Zod) on load and save.

## 7. CNC safety (non-negotiable)

Bad G-code breaks bits, damages machines and can injure people.

| Check | Rule |
|---|---|
| Envelope | Every move inside machine travel and inside stock + clearance |
| Depth | No cut below stock bottom (or below spoilboard allowance) |
| Rapids | `G0` only at or above safe Z, except a final plunge approach |
| Feeds | Feed and plunge ≤ machine max; spindle on before cutting moves |
| Units/modal | Explicit `G21`/`G20`, `G90`, work-coordinate setup in header |
| Tool | Tool geometry consistent with toolpath type (e.g. V-carve needs V-bit) |
| Preview | Export blocked until the toolpath has been simulated once |

Implemented as an independent **G-code parser + checker** that reads the *output text*, not the internal model, so post-processor bugs are caught too. Every release: run all golden G-code tests.

## 8. Tech stack

| Layer | Choice |
|---|---|
| Language | TypeScript (strict) |
| App | React + Vite, PWA (offline) |
| 2D canvas | Canvas2D / own renderer (pan, zoom, snapping) |
| 3D view | Three.js (relief mesh from heightmap, toolpath lines, sim) |
| Offsets / booleans | Clipper2 (JS/WASM port) |
| Fonts / shaping | opentype.js; HarfBuzz WASM for Urdu/Arabic |
| Heavy compute | Web Workers; Rust → WASM where TS is too slow (sim, drop-cutter) |
| State | Zustand + command pattern for undo |
| Validation | Zod |
| Tests | Vitest (core), Playwright (UI smoke) |
| Desktop (P3) | Tauri |
| Reference / reuse | OpenCAMLib, FreeCAD CAM, Kiri:Moto: **check each licence before copying code** |

## 9. Repo layout

```
naqsh/
├── CLAUDE.md
├── plan.md
├── package.json            # pnpm workspaces
├── packages/
│   ├── core/               # UI-free: model, schema, units, commands
│   │   ├── model/          # project schema (Zod), ids, units
│   │   ├── vector/         # path ops, offset, boolean, text
│   │   ├── relief/         # heightmap, profiles, combine, image→relief
│   │   ├── cam/            # profile, pocket, drill, vcarve, 3d rough/finish
│   │   ├── sim/            # stock simulation
│   │   ├── post/           # grbl, mach3, linuxcnc templates
│   │   └── gcode/          # parser + safety checker
│   ├── wasm/               # Rust crates for hot paths (later)
│   └── app/                # React PWA: canvas, 3D view, panels, workers
├── fixtures/               # sample SVG/DXF/images, golden .nc files
└── docs/
```

## 10. Milestones

| # | Deliverable | Done when |
|---|---|---|
| M0 | Monorepo, core model + schema, units, G-code parser/checker | Checker flags every case in the unsafe-G-code fixture set |
| M1 | Vector editor: shapes, pen, nodes, offset, booleans, SVG/DXF import/export, undo | Draw a sign layout and round-trip it through SVG |
| M2 | 2D CAM: tool library, profile (tabs/ramps), pocket, drill, GRBL post, 2D preview, time estimate | **First real cut** on a GRBL router from a browser-made file |
| M3 | Text (incl. Urdu/Arabic shaping) + V-carve | Calligraphy sign V-carved cleanly |
| M4 | Relief engine: vector → dome/flat/angle/round, combine, smooth, image → relief, 3D view, STL export | Relief panel from a photo + vectors |
| M5 | 3D CAM: Z-level roughing, raster finishing, 3D material-removal simulation | First carved relief on real wood |
| M6 | Sweeps (extrude, spin, two-rail), sculpt brushes, textures, Mach3/LinuxCNC posts | Ex-ArtCAM user can rebuild a typical panel |
| M7 | Public beta: docs, sample projects, 10 pilot users, bug triage | Pilot users cut real jobs |
| M8 | Desktop app (Tauri) + Web Serial machine control | Send, jog, run from app |
| M9 | Jewelry / rotary: wrap on cylinder, ring tools | Ring relief generated and simulated |
| R | Legacy ArtCAM file import research | Legal + technical go/no-go decision |

## 11. Build guide: M0–M2 (agent-executable)

Each task is one PR. Don't start a task until the previous one's acceptance check passes.

**M0: foundation**
| Task | Acceptance |
|---|---|
| T0.1 pnpm monorepo (`core`, `app`), TS strict, Vitest, ESLint, Prettier, CI script | `pnpm test` and `pnpm lint` green; app dev server starts |
| T0.2 Project schema (§6) in Zod + load/save `.zip` (JSON + binary) | Round-trip test: save → load → deep-equal |
| T0.3 Units module (mm/inch, precision rules) | Conversion tests incl. rounding edge cases |
| T0.4 Command pattern + undo/redo in core | 100-step undo/redo restores identical document |
| T0.5 G-code parser (G0/G1/G2/G3/G20/G21/G90/G91/M3/M5/F/S) | Parses fixture files; arcs expanded correctly |
| T0.6 Safety checker (§7 rules) + `fixtures/gcode/unsafe/*.nc` (≥ 12 cases) | Every unsafe case flagged with the right rule; safe set passes |

**M1: vectors**
| Task | Acceptance |
|---|---|
| T1.1 Path model (move/line/cubic/quad/close), bbox, length, point-at | Unit tests |
| T1.2 Flatten curves to polylines with tolerance | Max deviation ≤ tolerance |
| T1.3 Offset + booleans via Clipper2 | Results match golden fixtures |
| T1.4 Canvas: pan/zoom, select, move, scale, rotate, snapping, grid | Playwright smoke test |
| T1.5 Shape tools + pen + node edit | Draw, edit, undo in the UI |
| T1.6 SVG import/export; DXF import (LINE, ARC, LWPOLYLINE, SPLINE) | Fixtures import at correct scale |

**M2: 2D CAM**
| Task | Acceptance |
|---|---|
| T2.1 Tool library (CRUD, presets, units) | Persisted with project |
| T2.2 Profile toolpath: side, multi-pass, ramp, tabs | Golden G-code matches; checker passes |
| T2.3 Pocket: offset + raster, islands | No uncut areas > step-over in sim |
| T2.4 Drill / peck drill | Golden tests |
| T2.5 GRBL post-processor (header, footer, units, spindle) | Output passes checker; runs in a G-code sender's simulator |
| T2.6 2D preview + time estimate | Estimate within ±15% of GRBL sim time |
| T2.7 Export flow: simulate → check → download `.nc` | Export blocked on any checker error |

**M3: text + V-carve**
| Task | Acceptance |
|---|---|
| T3.1 Fonts + shaping: load TTF/OTF/WOFF, shape with HarfBuzz (WASM), glyph outlines → vectors (nonzero-clean) | Arabic/Urdu joining forms and lam-alef ligature shape correctly; RTL order; outlines are clean closed regions |
| T3.2 Text layout: height in mm, alignment, line spacing, multi-line, bidi runs, Latin fallback inside Arabic fonts | Layout tests incl. mixed Urdu + Latin line |
| T3.3 Text tool in the UI: place, type, pick font (bundled Naskh, Nastaliq, Latin; or load a font file) | Playwright: Urdu text placed at the chosen size |
| T3.4 V-carve toolpath: exact V surface from distance-to-edge, max depth with flat bottom, depth passes | Simulated surface matches the ideal V surface within tolerance; golden G-code; checker passes (V-bit enforced) |
| T3.5 V-carve in the Toolpaths panel, preview, export | Playwright: calligraphy sign → V-carve → simulate → export |

## 12. Evaluation

| Metric | How |
|---|---|
| Safety | 0 unsafe G-code files across fixtures and pilot jobs |
| Correctness | Golden G-code tests; measured real cuts vs design (±0.2 mm on 2D parts) |
| Relief quality | Side-by-side with Carveco/Aspire output on the same inputs (visual + height diff) |
| Performance | 1500×1000 relief op < 2 s; 3D finishing path < 30 s on a mid-range laptop |
| Usability | Ex-ArtCAM user completes a sign job without docs in < 30 min |
| Adoption | Pilot users completing real jobs; GitHub issues/stars |

## 13. Building with Claude Code on mobile

- One task (T#.#) per session; paste the task row + acceptance into the prompt.
- Agent must run tests before reporting done (see `CLAUDE.md`).
- Keep the core pure and well-tested: you can verify it from a phone by reading test output, without opening the UI.
- UI work needs a real screen check. Batch UI review sessions on a laptop or desktop.
- Real-machine tests only after the checker and simulator pass. Cut air first (Z raised), then foam or soft wood.

## 14. Risks

| Risk | Mitigation |
|---|---|
| Geometry/CAM is hard math | Pure core + golden tests; study OpenCAMLib/FreeCAD/Kiri:Moto algorithms (licence-checked) |
| Unsafe G-code | Independent checker on output text; export blocked on errors; air-cut first |
| Browser performance | Workers + WASM for hot paths; cap relief resolution; progressive preview |
| Trademark / trade dress | Own name, own UI, no ArtCAM assets; legal check before launch |
| Legacy file import legality | Research milestone only; skip if unclear |
| Scope creep (CorelDRAW-level vector tools) | Vector tools only as needed for CAM; defer advanced design features |
| One developer | Small tasks, tests first, community contributors after M7 |

## 15. Open decisions

1. Final name (replace "ARTSCAM").
2. Licence: GPL-3.0 (protects against closed forks) vs MIT/Apache-2.0 (easier adoption).
3. Target users: confirm wood/signs first, jewelry later.
4. Machines: confirm GRBL first; which Mach3/DSP controllers come next.
5. Which existing project is paused while this runs (video editor, Screen Firewall)?

## References

- Carveco: ArtCAM licence (PAF) expiry — https://support.carveco.com/hc/en-gb/articles/24357451740316-ArtCAM-Licence-PAF-Expiry-What-Are-My-Options
- AlternativeTo: ArtCAM alternatives — https://alternativeto.net/software/artcam/
- Onefinity forum: open-source image to 3D relief — https://forum.onefinitycnc.com/t/open-source-image-to-3d-relief-software/35010
