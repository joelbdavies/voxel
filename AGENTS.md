# Repository Guidelines

## Game Overview
Voxel Craft is a lightweight, browser‑based voxel sandbox rendered with WebGL. It features first‑person movement (WASD + mouse look), AABB collisions, block raycast place/break, and a stylized sky with environment‑locked sun and two cloud layers. A simple Music Lab provides chiptune‑style playback and track switching while you explore.

## Current Features
- Movement & Physics: Walk, sprint, jump; collision and gravity with smooth stepping.
- Blocks & World: Small voxel world, face‑culled mesh, atlas‑textured tiles; place/break via raycast.
- Sky & Lighting: Gradient sky, world‑anchored sun disk/glow, correct camera rotation.
- Clouds: Two layers — wispy FBM and cartoon puffy — horizon fade; toggle with `K` (None/Wispy/Both/Puffy).
- HUD: Crosshair, selected block label, music label, cloud mode label.
- Audio: Toggle music (`M`), choose tracks (`,`, `.`, `1–6`).

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
- Manual test: Open the dev URL, verify movement (WASD, Space, Shift), block place/break (B/C/V), music controls (M, ,/. , 1–6), and cloud modes (K).

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
