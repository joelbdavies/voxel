# Repository Guidelines

## Game Overview
Voxel Craft is a lightweight, browser‑based voxel sandbox rendered with WebGL. It features first‑person movement (WASD + mouse look), AABB collisions, block raycast place/break, and a stylized sky with environment‑locked sun and two cloud layers. A simple Music Lab provides chiptune‑style playback and track switching while you explore.

## Current Features
- Movement & Physics: Walk, sprint, jump; collision and gravity with smooth stepping; fly mode (double Space to start, Space/Ctrl to move up/down, double Ctrl to exit).
- Blocks & World: Small voxel world, face‑culled mesh, atlas‑textured tiles; place/break via raycast; safe under‑foot placement; prevent placing inside player; export/import world via copy/paste code.
- Persistence: Auto‑save world, player (pos/yaw/pitch/selection), time‑of‑day phase, and settings (clouds, time mode, torch, FXAA, music, track, fly) to `localStorage`.
- Rendering & Post: Gradient sky with environment‑locked sun and two cloud layers; day/night cycle with Auto/Day/Night toggle; trilinear mipmaps + anisotropic filtering; FXAA‑like post‑process; distance fog tuned to sky.
- Lighting & Weather: Camera‑anchored torch spotlight with flicker and warm color; periodic rain effect (screen‑space overlay) with matching ambient rain SFX.
- HUD & UI: Crosshair, selected block label, music label, cloud mode label, torch label, FPS counter; clear pointer‑lock instructions.
- Audio & Music Lab: Chiptune playback with multiple tracks and track switching; Music Lab with 16 slots, live preview, simple piano‑roll (lead/bass) and hat/kick grids, import/export JSON.

## Project Structure & Module Organization
- `public/`: Browser code and assets
  - `index.html`: Entry HTML; mounts the canvas and HUD.
  - `main.js`: Game logic (world gen, input, renderer, sky/cloud shaders).
  - `style.css`: HUD and Music Lab styling.
- `server.js`: Lightweight static dev server (Node ESM).
- `scripts/bundle-single-html.cjs`: Builds a single–file bundle into `dist/`.
- `dist/`: Build artifacts (e.g., `voxelcraft-single.html`).

## Build, Test, and Development Commands
- `npm run dev` (or `npm start`): Start dev server on `http://localhost:5173`.
- `npm run build:single`: Produce `dist/voxelcraft-single.html` for easy sharing.
- Manual test: Open the dev URL, verify movement (WASD, Space, Shift), fly mode (double Space to start, double Ctrl to exit), block place/break (B/C), block cycling ([/], Q/E), music controls (M, ,/. , 1–6), cloud modes (K), time toggle (T), torch (F), world export/import (P/O), rain appears occasionally, and FPS is stable.

## Coding Style & Naming Conventions
- JavaScript: ES modules on server; browser code is plain JS.
- Indentation: 2 spaces; include semicolons; trailing commas avoided.
- Naming: `camelCase` for variables/functions, `UPPER_SNAKE_CASE` for constants (e.g., `EYE_HEIGHT`), PascalCase for enums-like objects (e.g., `BLOCK`).
- Keep changes minimal and localized; match existing patterns (e.g., WebGL utility helpers, shader strings near usage).

## Testing Guidelines
- No formal test framework in this repo. Use manual smoke tests in the browser.
- Validate: collisions, raycast interactions, FPS stability, and visuals (sky rotation, cloud modes, sun position).
- For shader edits, check: no screen-space seams, horizon fade, and correct left/right camera behavior.

## Commit & Pull Request Guidelines
- Commits: Concise, imperative subject; describe scope and why (e.g., “Sky: environment-lock and two-layer clouds; add K toggle”).
- PRs: Include summary, before/after screenshots or short GIFs for visual changes, steps to reproduce/verify, and any config notes.
- Keep diffs focused; update documentation (`AGENTS.md`, HUD hints) when user-facing controls change.

## Agent-Specific Tips
- Prefer small, surgical patches (`apply_patch`), and reuse existing helpers.
- When touching shaders in `main.js`, group related uniforms and set them in one render-pass block to avoid state bugs.
- Test with pointer lock engaged; verify HUD updates and keybind conflicts (Music Lab vs. gameplay).
