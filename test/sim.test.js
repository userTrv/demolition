// Сквозные проверки физики сноса на настоящем Rapier (он детерминирован, результаты стабильны).
import { test, before } from 'node:test';
import assert from 'node:assert/strict';
import { initPhysics, createSim, detonate, step, isSettled, settle, disposeSim } from '../public/game/sim.js';
import { LEVELS, buildLevel } from '../public/game/levels.js';
import { evaluate, snapshot } from '../public/game/score.js';

before(() => initPhysics());

function play(levelId, pick, maxSeconds = 15) {
  const level = buildLevel(LEVELS.find((l) => l.id === levelId));
  const sim = createSim(level);
  detonate(sim, level.blocks.filter(pick).map((b) => ({ id: b.id, delay: b.delay ?? 0 })));
  for (let i = 0; i < maxSeconds * 60 && !isSettled(sim); i++) step(sim);
  const result = evaluate(snapshot(sim), level.zone);
  let maxY = 0;
  for (const rec of sim.byId.values()) if (rec.state !== 'destroyed') maxY = Math.max(maxY, rec.collider.translation().y);
  disposeSim(sim);
  return { ...result, maxY };
}

const groundColumns = (b) => b.kind === 'column' && b.floor === 0;

test('без зарядов здание стоит', () => {
  const level = buildLevel(LEVELS[1]);
  const sim = createSim(level);
  assert.equal(settle(sim).length, 0);
  for (let i = 0; i < 120; i++) step(sim);
  for (const rec of sim.byId.values()) assert.equal(rec.state, 'static');
  disposeSim(sim);
});

test('одна колонна не роняет пятиэтажку', () => {
  const r = play('khrushchyovka', (b) => b.id === 'khrushchyovka:c0.1.1', 4);
  assert.ok(r.standingPct > 0.9, `стоит ${r.standingPct}`);
  assert.equal(r.stars, 0);
});

// Известное решение каждого уровня укладывается в лимит зарядов и даёт три звезды
const SOLUTIONS = {
  garage: ['c0.0.0', 'c0.1.0', 'c0.2.0', 'c0.0.1', 'c0.1.1', 'c0.2.1'],
  khrushchyovka: ['c0.0.1', 'c0.1.1', 'c0.2.1', 'c0.3.1'],
  tower: ['c0.0.0', 'c0.0.1'],
};

for (const level of LEVELS) {
  test(`${level.name}: решение в пределах ${level.charges} зарядов даёт три звезды`, () => {
    const ids = SOLUTIONS[level.id].map((k) => `${level.id}:${k}`);
    assert.ok(ids.length <= level.charges);
    const r = play(level.id, (b) => ids.includes(b.id));
    assert.equal(r.stars, 3, JSON.stringify(r));
  });
}

test('пятиэтажка складывается внутрь себя и не задевает соседей', () => {
  const r = play('khrushchyovka', groundColumns);
  assert.equal(r.standingPct, 0);
  assert.ok(r.maxY < 6, `куча высотой ${r.maxY}`);
  assert.deepEqual(r.hit, []);
});

test('пятиэтажка: подрыв половины оставляет вторую половину стоять', () => {
  const r = play('khrushchyovka', (b) => groundColumns(b) && b.pos[0] < 0);
  assert.ok(r.standingPct > 0.2, `стоит ${r.standingPct}`);
  assert.equal(r.stars, 0);
});

test('башня падает туда, где убраны опоры', () => {
  const left = play('tower', (b) => groundColumns(b) && b.pos[0] < 0);
  assert.equal(left.standingPct, 0);
  assert.ok(left.maxY < 4, `остаток высотой ${left.maxY}`);
  assert.deepEqual(left.hit, [], 'справа офис, его задевать нельзя');

  const right = play('tower', (b) => groundColumns(b) && b.pos[0] > 0);
  assert.ok(right.hit.includes('office'), 'вправо башня ложится на офис');
  assert.ok(right.stars <= 1);

  const back = play('tower', (b) => groundColumns(b) && b.pos[2] > 0);
  assert.ok(back.hit.includes('shop'), 'назад башня ложится на магазин');
});
