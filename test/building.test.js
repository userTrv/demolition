import { test } from 'node:test';
import assert from 'node:assert/strict';
import { generateFrame } from '../public/game/building.js';

test('состав каркаса: колонны, плиты и стены периметра', () => {
  const blocks = generateFrame({ bays: [3, 2], floors: 5 });
  const count = (kind) => blocks.filter((b) => b.kind === kind).length;
  assert.equal(count('column'), 4 * 3 * 5);
  assert.equal(count('slab'), 3 * 2 * 5);
  assert.equal(count('wall'), 2 * (3 + 2) * 5);
});

test('опоры: первый этаж на земле, плите нужно три колонны из четырёх', () => {
  const blocks = generateFrame({ bays: [2, 1], floors: 2 });
  const byId = new Map(blocks.map((b) => [b.id, b]));
  for (const b of blocks.filter((x) => x.floor === 0 && x.kind !== 'slab')) assert.equal(b.grounded, true);
  for (const s of blocks.filter((x) => x.kind === 'slab')) {
    assert.equal(s.supports.length, 4);
    assert.equal(s.need, 3);
    for (const id of s.supports) assert.equal(byId.get(id).kind, 'column');
  }
  const upper = blocks.find((b) => b.kind === 'column' && b.floor === 1);
  assert.ok(upper.supports.length >= 1);
  assert.ok(upper.supports.every((id) => byId.get(id).kind === 'slab' && byId.get(id).floor === 0));
});

test('связи симметричны и ведут к существующим блокам', () => {
  const blocks = generateFrame({ bays: [3, 2], floors: 3 });
  const byId = new Map(blocks.map((b) => [b.id, b]));
  for (const b of blocks) {
    for (const id of b.links) {
      assert.ok(byId.has(id), id);
      assert.ok(byId.get(id).links.includes(b.id));
    }
  }
});

test('блоки не пересекаются: колонна кончается там, где начинается плита', () => {
  const blocks = generateFrame({ bays: [1, 1], floors: 2, storey: 3 });
  const col = blocks.find((b) => b.kind === 'column' && b.floor === 0);
  const slab = blocks.find((b) => b.kind === 'slab' && b.floor === 0);
  const colTop = col.pos[1] + col.size[1] / 2;
  const slabBottom = slab.pos[1] - slab.size[1] / 2;
  assert.ok(Math.abs(colTop - slabBottom) < 1e-9);
});
