# Naqsh (working title)

Open-source, browser-first relief-carving CAD/CAM: vectors → 3D reliefs → toolpaths → simulation → G-code.
See `plan.md` for the full spec and `CLAUDE.md` for working rules.

## Develop

```sh
pnpm install
pnpm dev        # app dev server at http://localhost:5173
pnpm test       # Vitest in every package
pnpm lint       # ESLint + Prettier check
pnpm run ci     # lint, typecheck, test, build
```

Packages: `packages/core` (UI-free model, geometry, CAM, G-code checker) and `packages/app` (React PWA).
