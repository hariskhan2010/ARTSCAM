# Naqsh (working title)

Open-source, browser-first relief-carving CAD/CAM: vectors → 3D reliefs → toolpaths → simulation → G-code.
See `plan.md` for the full spec and `CLAUDE.md` for working rules.

## Status

| Milestone | State |
|---|---|
| M0 Foundation: schema, units, undo/redo, G-code parser + safety checker | Done |
| M1 Vector editor: shapes, pen, node edit, offset, weld/trim/intersect, SVG/DXF import, SVG export | Done |
| M2 2D CAM: tool library, profile (tabs, ramps), pocket (offset/raster, islands), drill/peck, GRBL post, simulation, time estimate, checked export | Done (software); first real cut still to do |
| M3+ Text/V-carve, relief engine, 3D CAM, … | Not started |

## Using it

1. **Design tab**: draw with the tools on the left (V select, N nodes, P pen, R rectangle, E ellipse, G polygon, S star, L line, H pan), or **Import** an SVG/DXF. Set the stock size and units.
2. **Toolpaths tab**: add a tool from the presets, select vectors, then **+ Profile**, **+ Pocket** or **+ Drill**. Adjust depth, tabs, ramp and so on.
3. **Simulate**, check the time estimate and checker result, then **Export .nc**. Export stays disabled until the current settings have been simulated and the G-code checker finds no errors.

Before cutting real material, air-cut first (Z raised), then foam or soft wood (plan.md §13).

## Develop

```sh
pnpm install
pnpm dev        # app dev server at http://localhost:5173
pnpm test       # Vitest in every package
pnpm test:e2e   # Playwright UI smoke tests (uses installed Chrome; PW_CHANNEL='' for bundled Chromium)
pnpm lint       # ESLint + Prettier check
pnpm run ci     # lint, typecheck, test, build
```

Packages: `packages/core` (UI-free model, geometry, CAM, G-code checker) and `packages/app` (React PWA).
Golden files: `fixtures/vector/clip-golden.json` and `fixtures/gcode/golden/*.nc`. After an intended
output change, regenerate them with `UPDATE_GOLDEN=1 pnpm --filter @naqsh/core test`, then review the diff.
