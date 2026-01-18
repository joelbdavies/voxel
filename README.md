# Voxel Craft

Voxel Craft is a lightweight, browser‑based voxel sandbox rendered with WebGL. Explore a small block world with smooth first‑person movement, AABB collisions, block place/break via raycast, a stylized sky with an environment‑locked sun, two cloud layers, and a simple chiptune Music Lab.

## Quick Start

- Install Node.js, then install deps (none external) and run the dev server:
  - `npm run dev` (or `npm start`)
  - Open `http://localhost:5173`

## Build (Single HTML)

- `npm run build:single` → outputs `dist/voxelcraft-single.html`
  - A portable, self‑contained file you can share or open directly.

## Controls (Basics)

- Move: WASD, Jump: Space, Sprint: Shift
- Fly: Double Space to start; Space/Ctrl up/down; Double Ctrl to exit
- Break/Place: C / B (safe under‑foot placement; prevents placing inside player)
- Cycle Block: `[` and `]` or Q/E
- Clouds: K (None/Wispy/Both/Puffy)
- Time: T (Auto/Day/Night)
- Torch: F (camera‑anchored spotlight)
- Music: M toggle; , and . to switch; 1–6 pick track
- World: P export (copy), O import (paste)
- Debug: F3 overlay; Respawn: R; Unlock mouse: Esc

## Notes

- Game state (world, player position/yaw/pitch/selection, time phase, and settings like clouds/time/torch/FXAA/music/track/fly) auto‑saves to `localStorage`.
- Rendering includes distance fog tuned to the sky, basic post‑processing, and anisotropic‑filtered mipmaps.
- Occasional rain appears with matching ambient SFX.
- The included dev server is intended for local development only; it is not hardened for production hosting.

## Project Structure

- `public/` — browser code and assets (`index.html`, `main.js`, `style.css`)
- `server.js` — lightweight static dev server (Node ESM)
- `scripts/bundle-single-html.cjs` — builds single‑file bundle into `dist/`
- `dist/` — build artifacts (e.g., `voxelcraft-single.html`)

For more detail, see `AGENTS.md`.
