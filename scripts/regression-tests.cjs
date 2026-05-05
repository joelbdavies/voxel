const assert = require('assert');
const fs = require('fs');
const path = require('path');

const root = path.resolve(__dirname, '..');
const mainPath = path.join(root, 'public', 'main.js');
const source = fs.readFileSync(mainPath, 'utf8');

function between(start, end){
  const i = source.indexOf(start);
  assert.notStrictEqual(i, -1, `Missing start marker: ${start}`);
  const j = source.indexOf(end, i);
  assert.notStrictEqual(j, -1, `Missing end marker after ${start}: ${end}`);
  return source.slice(i, j);
}

function functionBody(name){
  return between(`function ${name}`, '\n}\n\n');
}

function assertBefore(body, earlier, later, message){
  assert.notStrictEqual(body.indexOf(earlier), -1, `Missing expected code: ${earlier}`);
  assert.notStrictEqual(body.indexOf(later), -1, `Missing expected code: ${later}`);
  assert(body.indexOf(earlier) < body.indexOf(later), message);
}

// Legacy V2 delta world codes must decode against the pre-Survival Builder base,
// while newly exported V3 delta codes use the current resource/tree base.
assert(source.includes('const headerV3 = new Uint8Array([86,87,51'), 'World exports should use VW3 after changing the delta base');
assert(source.includes('function buildLegacyBaseWorldArray()'), 'Legacy terrain base should be available for old delta imports');
assert(source.includes('const base = ver === 50 ? buildLegacyBaseWorldArray() : buildBaseWorldArray();'), 'V2 delta imports should use the legacy base');

// Chest transfers must not mutate the source stack when the destination stack is full.
const transferToChest = functionBody('transferToChest');
assert(transferToChest.indexOf('chestItemCount(openChestKey, itemId) >= MAX_STACK') < transferToChest.indexOf('removeItem(itemId, 1, false)'), 'Store should check chest capacity before removing inventory');
const transferFromChest = functionBody('transferFromChest');
assert(transferFromChest.indexOf('getItemCount(itemId) >= MAX_STACK') < transferFromChest.indexOf('setChestItemCount(openChestKey, itemId'), 'Take should check inventory capacity before removing chest item');

function simulateStore({ inventoryCount, chestCount }){
  const MAX_STACK = 99;
  if (inventoryCount <= 0) return { ok: false, inventoryCount, chestCount };
  if (chestCount >= MAX_STACK) return { ok: false, inventoryCount, chestCount };
  return { ok: true, inventoryCount: inventoryCount - 1, chestCount: Math.min(MAX_STACK, chestCount + 1) };
}

function simulateTake({ inventoryCount, chestCount }){
  const MAX_STACK = 99;
  if (chestCount <= 0) return { ok: false, inventoryCount, chestCount };
  if (inventoryCount >= MAX_STACK) return { ok: false, inventoryCount, chestCount };
  return { ok: true, inventoryCount: Math.min(MAX_STACK, inventoryCount + 1), chestCount: chestCount - 1 };
}

assert.deepStrictEqual(simulateStore({ inventoryCount: 4, chestCount: 99 }), { ok: false, inventoryCount: 4, chestCount: 99 });
assert.deepStrictEqual(simulateTake({ inventoryCount: 99, chestCount: 4 }), { ok: false, inventoryCount: 99, chestCount: 4 });
assert.deepStrictEqual(simulateStore({ inventoryCount: 4, chestCount: 98 }), { ok: true, inventoryCount: 3, chestCount: 99 });
assert.deepStrictEqual(simulateTake({ inventoryCount: 98, chestCount: 4 }), { ok: true, inventoryCount: 99, chestCount: 3 });

// Modal hotkeys should not act on the world behind the chest panel.
const keyBHandler = between("if (e.code==='KeyB')", "placeSelectedBlockOnce();");
assert(keyBHandler.includes('isInventoryOpen() || isChestOpen()'), 'B/place hotkey should be disabled while chest UI is open');
const keyCHandler = between("if (e.code==='KeyC')", "breakBlockOnce();");
assert(keyCHandler.includes('isInventoryOpen() || isChestOpen()'), 'C/break hotkey should be disabled while chest UI is open');

// Placement must reject out-of-bounds coordinates before consuming inventory.
const doPlaceAt = functionBody('doPlaceAt');
assert(doPlaceAt.indexOf('if (!inBounds(x,y,z)) return false;') < doPlaceAt.indexOf('removeItem(opt.item, 1, false)'), 'Placement should validate bounds before consuming inventory');

// Fresh starts should not skip the first progression step by seeding Wood.
const loadInventory = functionBody('loadInventory');
assert(!loadInventory.includes('addItem(blockItemId(BLOCK.WOOD)'), 'Fresh inventory should not seed Wood before the Collect Wood objective');
assert(loadInventory.includes('addItem(blockItemId(BLOCK.DIRT), 12, false)'), 'Fresh inventory should still seed safe building material');

// addItem must refuse overflow instead of clamping and reporting success.
const addItem = functionBody('addItem');
assertBefore(addItem, 'if (!canAddItem(itemId, amount)) return false;', 'setItemCount(itemId, getItemCount(itemId) + amount);', 'addItem should reject full stacks before mutation');

function simulateAdd({ current, amount }){
  const MAX_STACK = 99;
  if (amount <= 0 || current + amount > MAX_STACK) return { ok: false, count: current };
  return { ok: true, count: current + amount };
}

assert.deepStrictEqual(simulateAdd({ current: 99, amount: 1 }), { ok: false, count: 99 });
assert.deepStrictEqual(simulateAdd({ current: 98, amount: 1 }), { ok: true, count: 99 });

// Harvesting must check capacity before removing the block from the world.
const harvestBlockAt = functionBody('harvestBlockAt');
assertBefore(harvestBlockAt, 'if (!canAddItem(rule.item, rule.amount || 1))', 'setBlock(x, y, z, BLOCK.AIR);', 'Harvest should reject full output stacks before removing the block');
assertBefore(harvestBlockAt, 'if (!canAddItem(rule.item, rule.amount || 1))', 'harvestTarget.progress += harvestPowerForBlock(blockId, tier);', 'Harvest should reject full output stacks before adding break progress');

// Crafting must check output capacity before consuming inputs, and recipe buttons
// should be disabled when outputs cannot fit.
const craftRecipe = functionBody('craftRecipe');
assertBefore(craftRecipe, 'if (!canFitOutputs(recipe.out))', 'if (!consumeIngredients(recipe.in))', 'Crafting should reject full output stacks before consuming inputs');
const renderInventoryPanel = functionBody('renderInventoryPanel');
assert(renderInventoryPanel.includes('hasIngredients(recipe.in) && canFitOutputs(recipe.out)'), 'Recipe buttons should require both ingredients and output capacity');

function simulateCraft({ inputs, outputs, inventory }){
  const MAX_STACK = 99;
  for (const [itemId, count] of Object.entries(outputs)){
    if ((inventory[itemId] || 0) + count > MAX_STACK) return { ok: false, inventory: { ...inventory } };
  }
  for (const [itemId, count] of Object.entries(inputs)){
    if ((inventory[itemId] || 0) < count) return { ok: false, inventory: { ...inventory } };
  }
  const next = { ...inventory };
  for (const [itemId, count] of Object.entries(inputs)) next[itemId] -= count;
  for (const [itemId, count] of Object.entries(outputs)) next[itemId] = (next[itemId] || 0) + count;
  return { ok: true, inventory: next };
}

assert.deepStrictEqual(
  simulateCraft({ inputs: { 'block:8': 1 }, outputs: { plank: 4 }, inventory: { 'block:8': 2, plank: 98 } }),
  { ok: false, inventory: { 'block:8': 2, plank: 98 } },
  'Wood -> Planks should not consume Wood when Planks cannot fit'
);
assert.deepStrictEqual(
  simulateCraft({ inputs: { 'block:8': 1 }, outputs: { plank: 4 }, inventory: { 'block:8': 2, plank: 95 } }),
  { ok: true, inventory: { 'block:8': 1, plank: 99 } },
  'Wood -> Planks should craft when the output stack exactly fits'
);

// Progression/building coverage: required Survival Builder milestones must be
// present in the objective chain and supported by concrete mechanics.
const objectivesBlock = between('const OBJECTIVES = [', '];\n\nfunction inBounds');
for (const text of [
  'Collect Wood',
  'Craft A Wooden Pickaxe',
  'Harvest Stone',
  'Craft A Stone Pickaxe',
  'Harvest Rock Or Ore',
  'Craft A Lamp',
  'Craft A Chest',
  'Place The Chest',
  'Light The Chest',
  'Build A Simple Shelter',
]){
  assert(objectivesBlock.includes(text), `Missing progression objective: ${text}`);
}
assert(source.includes("wood_pickaxe: { name: 'Wooden Pickaxe'"), 'Wooden Pickaxe item should exist');
assert(source.includes("stone_pickaxe: { name: 'Stone Pickaxe'"), 'Stone Pickaxe item should exist');
assert(source.includes('function lampNearChestExists()'), 'Lamp-near-chest objective should have a detector');
assert(source.includes('function shelterExists()'), 'Shelter objective should have a detector');
assert(source.includes('function createChestAt'), 'Chest placement should create persistent storage');
assert(source.includes('function transferToChest'), 'Chest UI should support storing items');
assert(source.includes('function transferFromChest'), 'Chest UI should support taking items');

console.log('Regression tests passed');
