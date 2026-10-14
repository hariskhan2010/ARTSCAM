# CLAUDE.md — open-source relief CAD/CAM (working title: Naqsh)

Browser-first relief-carving CAD/CAM: vectors → 3D reliefs → toolpaths → simulation → G-code. Full spec: `plan.md`. Read §5 (architecture), §6 (data model), §7 (CNC safety), §9 (layout) and §11 (current tasks) before writing code.

## Working rules
- Work **one task (T#.#) at a time** from `plan.md` §11. Stop after its acceptance check passes and report results.
- Never start the next milestone without being told.
- If a task is ambiguous or blocked, ask; don't invent scope.
- Keep changes inside the task's package/module. No drive-by refactors.

## Architecture rules
- `packages/core` is **UI-free** (no React, no DOM). Pure functions on the document model; testable in Node.
- The project document is the single source of truth. Toolpaths and simulations are **derived**: store parameters, regenerate on change.
- All mutations go through commands (undo/redo). No direct state mutation from UI.
- Heavy work (relief ops, toolpaths, simulation) runs in Web Workers.
- Internal units are **mm, float64**. Convert only in the UI and post-processors.
- Validate the project with the Zod schema on every load and save.

## CNC safety rules (never bypass)
- Every exported G-code file must pass `packages/core/gcode` checker. Export is blocked on any error.
- The checker reads the **output G-code text**, not the internal model.
- Never weaken a safety rule to make a test pass. If a rule seems wrong, stop and ask.
- Every new toolpath type or post-processor ships with golden G-code tests and passes the unsafe fixture set.

## Code conventions
- TypeScript strict; no `any` without a comment explaining why.
- pnpm workspaces; Vitest for core, Playwright for UI smoke tests.
- ESLint + Prettier clean; `pnpm test` and `pnpm lint` green before finishing.
- No trademarked names, logos, icons or screenshots from ArtCAM, Carveco or other products.
- Third-party code only after its licence is checked and recorded in `docs/THIRD_PARTY.md`.
- Fixtures stay small (sample SVG/DXF ≤ 200 KB, images ≤ 1 MB).

## Definition of done (every task)
1. Acceptance check in `plan.md` §11 passes.
2. `pnpm test` and `pnpm lint` pass.
3. Short summary: what changed, how it was verified, any open issues.
