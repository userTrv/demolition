// Оболочка игры: меню уровней, расстановка зарядов, обратный отсчёт, снос, итог.
import { initPhysics, createSim, detonate, step, isSettled, drainEvents, disposeSim, STEP } from './game/sim.js';
import { LEVELS, buildLevel } from './game/levels.js';
import { evaluate, snapshot } from './game/score.js';
import { createView } from './render/view.js';
import { sfx, unlockAudio, setMuted, isMuted } from './sfx.js';

const $ = (id) => document.getElementById(id);
const PROGRESS_KEY = 'demolition-progress';
const DELAYS = [0, 0.25, 0.5, 1];
const MAX_BLAST_TIME = 25; // с после старта: дольше не ждём, подводим итог

const view = createView($('scene'));
const game = {
  mode: 'loading', // menu | plan | countdown | blast | result
  levelIndex: 0,
  level: null,
  sim: null,
  charges: new Map(), // id колонны → задержка
  selected: null,
  delay: 0,
  acc: 0,
  blastAt: 0,
  countdownLeft: 0,
};

// для отладки из консоли
window.demolition = { game, view };

// ---------- прогресс ----------

function loadProgress() {
  try {
    return JSON.parse(localStorage.getItem(PROGRESS_KEY)) ?? {};
  } catch {
    return {};
  }
}

function saveStars(levelId, stars) {
  const p = loadProgress();
  if ((p[levelId] ?? 0) >= stars) return;
  p[levelId] = stars;
  try {
    localStorage.setItem(PROGRESS_KEY, JSON.stringify(p));
  } catch {
    // без localStorage прогресс просто не сохранится
  }
}

const unlocked = (i) => i === 0 || (loadProgress()[LEVELS[i - 1].id] ?? 0) > 0;

// ---------- экраны ----------

function show(id, on) {
  $(id).classList.toggle('hidden', !on);
}

function openMenu() {
  game.mode = 'menu';
  const progress = loadProgress();
  const list = $('levels');
  list.replaceChildren();
  LEVELS.forEach((lvl, i) => {
    const b = document.createElement('button');
    const open = unlocked(i);
    const stars = progress[lvl.id] ?? 0;
    b.className = open ? '' : 'locked';
    b.disabled = !open;
    b.innerHTML = `<span class="num">Уровень ${i + 1}</span><span class="name">${lvl.name}</span>
      <span class="st">${open ? '★'.repeat(stars) + '☆'.repeat(3 - stars) : 'закрыт'}</span>`;
    b.onclick = () => startLevel(i);
    list.append(b);
  });
  show('menu', true);
  show('hud', false);
  show('result', false);
}

function startLevel(i) {
  unlockAudio();
  game.levelIndex = i;
  game.level = buildLevel(LEVELS[i]);
  game.charges = new Map();
  game.selected = null;
  resetSim();
  view.build(game.level);
  view.frame(game.level);
  $('level-name').textContent = `${i + 1}. ${game.level.name}`;
  $('hint').textContent = game.level.hint;
  enterPlan();
}

function resetSim() {
  if (game.sim) disposeSim(game.sim);
  game.sim = createSim(game.level);
}

function enterPlan() {
  game.mode = 'plan';
  show('menu', false);
  show('result', false);
  show('hud', true);
  show('countdown', false);
  $('btn-fire').disabled = false;
  $('btn-reset').disabled = false;
  view.setPlanMode(true);
  view.armMarkers(false);
  refreshHud();
}

// Вернуться к расстановке с теми же зарядами: здание заново целое
function retry() {
  const charges = game.charges;
  const selected = game.selected;
  startLevel(game.levelIndex);
  game.charges = charges;
  game.selected = selected;
  refreshHud();
}

function refreshHud() {
  const left = game.level.charges - game.charges.size;
  $('charges-left').textContent = `Осталось зарядов: ${left} из ${game.level.charges}`;
  const current = game.selected ? game.charges.get(game.selected) : game.delay;
  for (const b of $('delays').querySelectorAll('button')) b.classList.toggle('on', Number(b.dataset.delay) === current);
  $('btn-fire').disabled = game.mode !== 'plan' || game.charges.size === 0;
  view.setCharges(game.charges, game.selected);
}

// ---------- расстановка ----------

function toggleCharge(id) {
  if (game.charges.has(id)) {
    if (game.selected === id) {
      game.charges.delete(id);
      game.selected = null;
      sfx.remove();
    } else {
      game.selected = id;
      game.delay = game.charges.get(id);
    }
  } else if (game.charges.size < game.level.charges) {
    game.charges.set(id, game.delay);
    game.selected = id;
    sfx.place();
  } else {
    flashHint('Зарядов больше нет. Нажми на заряд ещё раз, чтобы снять его.');
    return;
  }
  refreshHud();
}

let hintTimer = 0;
function flashHint(text) {
  $('hint').textContent = text;
  clearTimeout(hintTimer);
  hintTimer = setTimeout(() => ($('hint').textContent = game.level.hint), 2500);
}

function setDelay(d) {
  game.delay = d;
  if (game.selected) game.charges.set(game.selected, d);
  refreshHud();
}

// ---------- подрыв ----------

function fire() {
  if (game.mode !== 'plan' || game.charges.size === 0) return;
  unlockAudio();
  game.mode = 'countdown';
  game.countdownLeft = 3;
  game.selected = null;
  refreshHud();
  view.highlight(null);
  view.armMarkers(true);
  $('btn-fire').disabled = true;
  $('btn-reset').disabled = true;
  show('countdown', true);
  $('countdown').textContent = '3';
  sfx.beep(false);
}

function startBlast() {
  game.mode = 'blast';
  show('countdown', false);
  view.setPlanMode(false);
  game.acc = 0;
  game.blastAt = game.sim.t;
  detonate(game.sim, [...game.charges].map(([id, delay]) => ({ id, delay })));
}

function finish() {
  game.mode = 'result';
  const r = evaluate(snapshot(game.sim), game.level.zone);
  saveStars(game.level.id, r.stars);
  const starsEl = $('stars');
  starsEl.innerHTML = [0, 1, 2].map((i) => `<span class="${i < r.stars ? 'on' : ''}">★</span>`).join('');
  $('result-title').textContent =
    r.standingPct > 0.1 ? 'Здание устояло' : r.hit.length ? 'Задели соседей' : r.stars === 3 ? 'Чистая работа!' : r.stars ? 'Снесено' : 'Мимо зоны';
  const pct = (x) => `${Math.round(x * 100)} %`;
  $('result-stats').innerHTML = `
    <li><span>Обломков в зоне</span><b>${pct(r.inZonePct)}</b></li>
    <li><span>Осталось стоять</span><b>${pct(r.standingPct)}</b></li>
    <li><span>Соседи</span><b>${r.hit.length ? 'задеты' : 'целы'}</b></li>
    <li><span>Заряды</span><b>${game.charges.size} из ${game.level.charges}</b></li>`;
  const hasNext = game.levelIndex + 1 < LEVELS.length;
  $('btn-next').textContent = hasNext ? 'Дальше' : 'К уровням';
  $('btn-next').disabled = hasNext && r.stars === 0;
  show('result', true);
  if (r.stars) sfx.win(r.stars);
  else sfx.fail();
}

// ---------- ввод ----------

const canvas = $('scene');
let down = null;
canvas.addEventListener('pointerdown', (e) => {
  unlockAudio();
  down = { x: e.clientX, y: e.clientY, button: e.button };
});
canvas.addEventListener('pointerup', (e) => {
  if (!down || game.mode !== 'plan' || down.button !== 0) return;
  const moved = Math.hypot(e.clientX - down.x, e.clientY - down.y);
  down = null;
  if (moved > 8) return;
  const id = pick(e);
  if (id) toggleCharge(id);
});
canvas.addEventListener('pointermove', (e) => {
  if (game.mode !== 'plan' || e.pointerType !== 'mouse') return;
  view.highlight(pick(e));
});

function pick(e) {
  const r = canvas.getBoundingClientRect();
  return view.pickColumn(((e.clientX - r.left) / r.width) * 2 - 1, -((e.clientY - r.top) / r.height) * 2 + 1);
}

$('delays').addEventListener('click', (e) => {
  const d = e.target.closest('button')?.dataset.delay;
  if (d !== undefined && game.mode === 'plan') setDelay(Number(d));
});
$('btn-fire').onclick = fire;
$('btn-reset').onclick = () => {
  game.charges.clear();
  game.selected = null;
  refreshHud();
};
$('btn-menu').onclick = openMenu;
$('btn-retry').onclick = retry;
$('btn-next').onclick = () => (game.levelIndex + 1 < LEVELS.length ? startLevel(game.levelIndex + 1) : openMenu());
$('btn-sound').onclick = () => {
  setMuted(!isMuted());
  $('btn-sound').textContent = isMuted() ? '🔇' : '🔊';
};

window.addEventListener('keydown', (e) => {
  if (e.code === 'Space' && game.mode === 'plan') {
    e.preventDefault();
    fire();
  } else if (e.code === 'Escape' && game.mode !== 'loading') openMenu();
  else if (e.code === 'KeyR' && game.mode === 'result') retry();
  else if (game.mode === 'plan' && e.key >= '1' && e.key <= '4') setDelay(DELAYS[Number(e.key) - 1]);
});

window.addEventListener('resize', view.resize);

// ---------- цикл ----------

let last = performance.now();
function frame(now) {
  const dt = Math.min(0.1, (now - last) / 1000);
  last = now;

  if (game.mode === 'countdown') {
    const before = Math.ceil(game.countdownLeft);
    game.countdownLeft -= dt;
    const after = Math.ceil(game.countdownLeft);
    if (game.countdownLeft <= 0) startBlast();
    else if (after !== before) {
      $('countdown').textContent = String(after);
      sfx.beep(after === 1);
    }
  }

  if (game.mode === 'blast' || game.mode === 'result') {
    game.acc += dt;
    let steps = 0;
    while (game.acc >= STEP && steps < 4) {
      step(game.sim);
      game.acc -= STEP;
      steps++;
    }
    if (steps === 4) game.acc = 0;
    handleEvents(drainEvents(game.sim));
    view.sync(game.sim);
    if (game.mode === 'blast' && (isSettled(game.sim) || game.sim.t - game.blastAt > MAX_BLAST_TIME)) finish();
  }

  view.render(dt, now / 1000);
  requestAnimationFrame(frame);
}

function handleEvents(events) {
  let shatters = 0;
  for (const e of events) {
    if (e.type === 'blast') {
      view.fx.blast(e.pos);
      view.hideMarker(e.id);
      sfx.blast();
    } else if (e.type === 'shatter') {
      const kind = e.id.split(':')[1][0];
      view.fx.shatter(e, view.tints[kind === 'c' ? 'column' : kind === 's' ? 'slab' : 'wall']);
      shatters++;
    } else if (e.type === 'impact') {
      view.fx.impact(e.pos, e.force);
      sfx.rumble(Math.min(1, e.force / 3e6));
    }
  }
  if (shatters) sfx.shatter();
}

// ---------- старт ----------

view.resize();
requestAnimationFrame(frame);
try {
  await initPhysics();
  show('loading', false);
  // фон меню: первый уровень
  game.level = buildLevel(LEVELS[0]);
  view.build(game.level);
  openMenu();
} catch (err) {
  $('loading').querySelector('p').textContent = `Не удалось запустить физику: ${err.message}`;
  throw err;
}
