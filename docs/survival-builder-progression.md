# Survival Builder Progression Spec

## Goal
Build a Survival Builder progression layer for Voxel Craft. A fresh player should move from basic gathering into a small, functional base with storage, lighting, and resource progression, while preserving the current lightweight browser sandbox feel.

## Player Experience
- The player starts with a simple objective chain that teaches harvesting, crafting, mining, storage, and shelter building.
- The player can discover nearby resources, craft better tools, place a chest, light the base, and store gathered materials.
- The game should remain approachable on desktop and mobile. New systems should use the existing inventory, hotbar, and objective HUD patterns.

## Core Deliverables

### 1. Generated Resource Nodes
- Add resource blocks that make mining and exploration worthwhile.
- Add at least:
  - Coal or dark rock pockets near the surface.
  - A simple underground ore block.
  - More reliable wood access, such as generated trees or log clusters.
- Resource generation must be deterministic from world coordinates so base-world rebuild and world-delta export remain stable.
- Existing saved worlds must continue to load. New resources can appear only in newly generated base terrain unless a migration is intentionally added.

### 2. Tool Tiers
- Replace the single passive pickaxe behavior with explicit tiered tools.
- Add at least:
  - Wooden Pickaxe
  - Stone Pickaxe
- Tools should be selectable or usable from inventory/hotbar in a clear way.
- Tool tier should affect harvesting speed and/or eligibility:
  - Wood/hand tools can collect soft blocks.
  - Wooden pickaxe improves stone harvesting.
  - Stone pickaxe improves rock/ore harvesting.
- Durability is optional for this milestone. If added, keep it simple and visible.

### 3. Chests And Storage
- Add a placeable chest block.
- Chest behavior:
  - Player can place a chest from inventory.
  - Interacting with a chest opens a storage UI.
  - Chest inventory persists across reloads.
  - Player can transfer items between player inventory and chest inventory.
- Chest persistence should be keyed by world position and survive normal world save/load.
- Breaking a chest should either drop stored contents or prevent breaking while non-empty. Choose the simpler safe behavior and document it in code/UI.

### 4. Shelter Objective Chain
- Extend the objective HUD into a base-building progression.
- Required objective sequence:
  - Collect wood.
  - Craft planks and sticks.
  - Craft a wooden pickaxe.
  - Mine stone.
  - Craft a stone pickaxe.
  - Mine rock or ore.
  - Craft a lamp.
  - Craft and place a chest.
  - Place a lamp near the chest.
  - Build a simple shelter around the chest area.
- Shelter detection can be approximate:
  - Detect a chest as the anchor.
  - Require nearby floor blocks, several wall blocks, and at least partial overhead cover.
  - Do not require perfect enclosure or expensive flood fill.

### 5. Objective History And Feedback
- Keep the current compact HUD objective display.
- Add a lightweight completed-objective history in the inventory/objective panel or menu.
- Show short completion messages when objectives advance.
- Persist current objective index, completion history, and relevant flags.

### 6. Mobile Support
- All new interactions must be reachable on touch devices.
- Chest opening, item transfer, crafting, and objective viewing should not require keyboard-only controls.
- Avoid tiny controls; use existing button/menu patterns.

## Save Compatibility
- Existing localStorage keys should keep loading.
- New state should use new versioned keys or backward-compatible fields.
- Existing world import/export should continue to work.
- If chest state is not included in world code export initially, explicitly note that limitation and keep local persistence correct.

## Implementation Note
- Chest contents currently persist through `localStorage` using `voxel_chests_v1`.
- World copy/paste codes continue to encode block data only. Chest block placement is included as world data, but chest contents are not included in exported world codes yet.

## Suggested Data Model
- Add new block ids for chest and resources.
- Extend item definitions for tool tiers, resources, and chest block.
- Add a chest storage map keyed by `"x,y,z"`.
- Add objective state:
  - `index`
  - `completed`
  - `flags`
- Keep recipe definitions data-driven.

## Acceptance Criteria
- A fresh player can follow objectives from starter resources to a lit base with a chest.
- Chests can be placed, opened, used for item transfer, and persist after reload.
- Resource nodes exist in newly generated worlds and can be harvested.
- Tool tier affects harvesting speed or eligibility.
- The objective chain advances through tool crafting, chest placement, lamp placement, and shelter completion.
- Desktop and mobile controls can complete the full loop.
- Existing saves still load without errors.
- `node --check public/main.js` passes.
- `npm run build:single` passes.
- Browser smoke test confirms:
  - objective HUD renders,
  - inventory and crafting still work,
  - chest UI opens,
  - chest contents persist after reload,
  - no console errors during the smoke path.

## Out Of Scope
- Enemies, health, hunger, armor, multiplayer, complex crafting grids, smelting, and procedural caves.
- Large art pipeline changes.
- Perfect shelter simulation.
- Full chest/world-code export if local chest persistence is complete and the limitation is documented.
