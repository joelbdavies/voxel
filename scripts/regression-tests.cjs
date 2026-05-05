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

console.log('Regression tests passed');
