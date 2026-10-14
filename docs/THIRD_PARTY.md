# Third-party dependencies

Every third-party package is listed here with its licence before it is used.
Licences were read from each package's `package.json` after install.

## Runtime (shipped in the app bundle)

| Package | Licence | Used by | Added in |
|---|---|---|---|
| react | MIT | app | T0.1 |
| react-dom | MIT | app | T0.1 |
| zod | MIT | core: project schema validation | T0.2 |
| fflate | MIT | core: project .zip read/write | T0.2 |
| lucide-react | ISC | app: icons (1.44.0, pinned) | UI pass |
| harfbuzzjs | MIT (HarfBuzz: Old MIT) | core: text shaping (Arabic/Urdu joining, ligatures, marks) and glyph outlines, WASM | T3.1 |
| @fontsource/noto-naskh-arabic, @fontsource/noto-nastaliq-urdu | OFL-1.1 (fonts) | app: bundled Naskh and Nastaliq fonts; core tests | T3.1 |
| three | MIT | app: 3D relief view (0.186.1) | T4.4 |
| clipper2-ts | BSL-1.0 | core: polygon offsets and booleans (Clipper2 port). `clipper2-js` 1.2.4 was tried first and rejected: it returns wrong offsets and unions | T1.3 |

## Development only (not shipped)

| Package | Licence | Purpose | Added in |
|---|---|---|---|
| typescript | Apache-2.0 | Type checking (pinned ~6.0 for typescript-eslint) | T0.1 |
| vite | MIT | App dev server and bundler | T0.1 |
| @vitejs/plugin-react | MIT | React support for Vite | T0.1 |
| vitest | MIT | Unit tests | T0.1 |
| eslint | MIT | Linting | T0.1 |
| @eslint/js | MIT | ESLint base rules | T0.1 |
| typescript-eslint | MIT | TypeScript lint rules | T0.1 |
| eslint-plugin-react-hooks | MIT | React hooks lint rules | T0.1 |
| globals | MIT | ESLint global definitions | T0.1 |
| prettier | MIT | Formatting | T0.1 |
| @types/three | MIT | Three.js type definitions | T4.4 |
| @playwright/test | Apache-2.0 | UI smoke tests (uses installed Chrome) | T1.4 |
| @types/node, @types/react, @types/react-dom | MIT | Type definitions | T0.1 |
