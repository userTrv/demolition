// Физика сноса на Rapier. Без three.js, чтобы гонять в тестах под Node.
//
// Целое здание — неподвижные тела: это устойчиво и почти ничего не стоит. После подрыва модель опор
// ищет блоки, которые больше не держатся (колонне нужна опора снизу, плите — три колонны из четырёх),
// и отпускает их каскадом. Связанные блоки одной волны становятся одним составным телом и падают
// куском. Кусок раскалывается от удара (колонны и стены при этом сминаются, плиты падают отдельно)
// и ломается на блоки, когда сильно накренится. Удар по неподвижной колонне тоже её отпускает,
// а стены хрупкие и рассыпаются под упавшей на них нагрузкой.
import RAPIER from '../vendor/rapier.mjs';

export const STEP = 1 / 60;
const DENSITY = 2400; // бетон, кг/м³
const SHATTER_DV = 5; // м/с за шаг: такой удар раскалывает кусок и сминает колонну или стену
const CRUSH_G = 25; // неподвижную колонну сминает удар сильнее N её весов
const WALL_CRUSH_G = 1.5; // стены хрупкие: под упавшей на них нагрузкой рассыпаются
const CRUSH_BAND = 3; // м: при ударе куска сминается пояс высотой в этаж над его нижней точкой
const SPLIT_GRACE = 0.4; // с после разлома куска, пока обломки не сминаются
const IMPACT_SPEED = 2.5; // м/с, медленнее — это нагрузка, а не удар
const BEND_MIN = (30 * Math.PI) / 180; // падающий кусок ломается на блоки на наклоне 30–50°
const BEND_SPREAD = (20 * Math.PI) / 180;
const BLAST_RADIUS = 3.5;
const BLAST_SPEED = 3; // м/с, скорость, которую взрыв придаёт обломку в упор
const EVENT_THRESHOLD = 5000; // Н, мельче удары не интересны

let ready = null;
export function initPhysics() {
  ready ??= RAPIER.init();
  return ready;
}

function colliderDesc(block) {
  return RAPIER.ColliderDesc.cuboid(block.size[0] / 2, block.size[1] / 2, block.size[2] / 2)
    .setDensity(DENSITY)
    .setFriction(0.8)
    .setRestitution(0.05)
    .setActiveEvents(RAPIER.ActiveEvents.CONTACT_FORCE_EVENTS)
    .setContactForceEventThreshold(EVENT_THRESHOLD);
}

// level: { blocks, neighbors: [{ id, pos, size }] }
export function createSim(level) {
  const world = new RAPIER.World({ x: 0, y: -9.81, z: 0 });
  world.timestep = STEP;

  const ground = world.createRigidBody(RAPIER.RigidBodyDesc.fixed());
  world.createCollider(RAPIER.ColliderDesc.cuboid(200, 1, 200).setTranslation(0, -1, 0).setFriction(0.9), ground);

  const sim = {
    world,
    queue: new RAPIER.EventQueue(true),
    t: 0,
    byId: new Map(),
    byCollider: new Map(),
    chunks: new Set(), // составные тела: { body, recs: Set, bend, v }
    neighbors: new Map(),
    pending: [], // заряды, ждущие своей задержки
    events: [], // для вида и звука: { type: 'blast' | 'shatter' | 'impact' | 'release' | 'neighbor', ... }
    lastActivity: 0,
    started: false,
  };

  for (const b of level.blocks) {
    const body = world.createRigidBody(RAPIER.RigidBodyDesc.fixed().setTranslation(...b.pos));
    const collider = world.createCollider(colliderDesc(b), body);
    const mass = DENSITY * b.size[0] * b.size[1] * b.size[2];
    const rec = { block: b, body, collider, chunk: null, state: 'static', mass };
    sim.byId.set(b.id, rec);
    sim.byCollider.set(collider.handle, rec);
  }

  for (const n of level.neighbors ?? []) {
    const body = world.createRigidBody(RAPIER.RigidBodyDesc.fixed().setTranslation(...n.pos));
    const collider = world.createCollider(
      RAPIER.ColliderDesc.cuboid(n.size[0] / 2, n.size[1] / 2, n.size[2] / 2)
        .setActiveEvents(RAPIER.ActiveEvents.CONTACT_FORCE_EVENTS)
        .setContactForceEventThreshold(EVENT_THRESHOLD),
      body,
    );
    sim.neighbors.set(collider.handle, { id: n.id, damage: 0 });
  }
  return sim;
}

// Положение блока в мире (у блока внутри куска оно берётся из коллайдера)
export function blockPose(rec) {
  return { pos: rec.collider.translation(), rot: rec.collider.rotation() };
}

// ---------- модель опор ----------

function supported(sim, rec) {
  const b = rec.block;
  if (b.grounded) return true;
  let alive = 0;
  for (const id of b.supports) if (sim.byId.get(id).state === 'static') alive++;
  return alive >= b.need;
}

// Отпускает всё, что больше не держится. Возвращает отпущенные блоки.
export function settle(sim) {
  const wave = [];
  let changed = true;
  while (changed) {
    changed = false;
    for (const rec of sim.byId.values()) {
      if (rec.state === 'static' && !supported(sim, rec)) {
        rec.state = 'dynamic';
        wave.push(rec);
        changed = true;
      }
    }
  }
  if (wave.length) {
    makeDynamic(sim, wave);
    sim.lastActivity = sim.t;
    sim.events.push({ type: 'release', count: wave.length });
  }
  return wave;
}

// Связанные блоки волны — одно составное тело, одиночки — просто динамические тела.
function makeDynamic(sim, recs) {
  const left = new Set(recs);
  for (const start of recs) {
    if (!left.has(start)) continue;
    const group = [];
    const stack = [start];
    left.delete(start);
    while (stack.length) {
      const r = stack.pop();
      group.push(r);
      for (const id of r.block.links) {
        const n = sim.byId.get(id);
        if (left.has(n)) {
          left.delete(n);
          stack.push(n);
        }
      }
    }
    for (const r of group) r.state = 'dynamic';
    if (group.length === 1) {
      group[0].body.setBodyType(RAPIER.RigidBodyType.Dynamic, true);
      group[0].body.recomputeMassPropertiesFromColliders();
    } else {
      buildChunk(sim, group);
    }
  }
}

function buildChunk(sim, group) {
  let m = 0;
  const c = { x: 0, y: 0, z: 0 };
  for (const r of group) {
    const p = r.collider.translation();
    c.x += p.x * r.mass;
    c.y += p.y * r.mass;
    c.z += p.z * r.mass;
    m += r.mass;
  }
  c.x /= m;
  c.y /= m;
  c.z /= m;
  const body = sim.world.createRigidBody(RAPIER.RigidBodyDesc.dynamic().setTranslation(c.x, c.y, c.z));
  const chunk = { body, recs: new Set(group), bend: BEND_MIN + BEND_SPREAD * hash(group[0].block.id), v: null };
  for (const r of group) {
    // блоки волны ещё не сдвинулись и не повёрнуты
    const p = r.collider.translation();
    detach(sim, r);
    r.collider = sim.world.createCollider(colliderDesc(r.block).setTranslation(p.x - c.x, p.y - c.y, p.z - c.z), body);
    sim.byCollider.set(r.collider.handle, r);
    r.body = body;
    r.chunk = chunk;
  }
  sim.chunks.add(chunk);
}

// Убирает блок из физики: коллайдер из куска или собственное тело
function detach(sim, r) {
  sim.byCollider.delete(r.collider.handle);
  if (r.chunk) sim.world.removeCollider(r.collider, false);
  else sim.world.removeRigidBody(r.body);
}

// Раскалывает кусок на отдельные блоки, сохраняя их движение.
// crush — удар: колонны и стены нижнего пояса куска (там, где он ударился) сминаются.
function splitChunk(sim, chunk, crush) {
  const { body } = chunk;
  const com = body.translation();
  const v = body.linvel();
  const w = body.angvel();
  let minY = Infinity;
  if (crush) for (const r of chunk.recs) minY = Math.min(minY, r.collider.translation().y);
  for (const r of chunk.recs) {
    const p = r.collider.translation();
    const q = r.collider.rotation();
    sim.byCollider.delete(r.collider.handle);
    r.chunk = null;
    if (crush && r.block.kind !== 'slab' && p.y - minY < CRUSH_BAND) {
      r.body = null;
      markDestroyed(sim, r, p, q, 'shatter');
      continue;
    }
    // скорость точки твёрдого тела: v + ω × r
    const d = { x: p.x - com.x, y: p.y - com.y, z: p.z - com.z };
    const own = sim.world.createRigidBody(
      RAPIER.RigidBodyDesc.dynamic()
        .setTranslation(p.x, p.y, p.z)
        .setRotation(q)
        .setLinvel(v.x + w.y * d.z - w.z * d.y, v.y + w.z * d.x - w.x * d.z, v.z + w.x * d.y - w.y * d.x)
        .setAngvel(w),
    );
    r.collider = sim.world.createCollider(colliderDesc(r.block), own);
    sim.byCollider.set(r.collider.handle, r);
    r.body = own;
    // соседние обломки в первые мгновения толкаются друг о друга, это не удар
    r.graceUntil = sim.t + SPLIT_GRACE;
  }
  sim.chunks.delete(chunk);
  sim.world.removeRigidBody(body);
}

function markDestroyed(sim, r, p, q, type) {
  r.state = 'destroyed';
  r.lastPos = { x: p.x, y: p.y, z: p.z };
  sim.events.push({ type, id: r.block.id, pos: r.lastPos, rot: { x: q.x, y: q.y, z: q.z, w: q.w }, size: r.block.size });
}

// Подрыв или смятие одного блока
function destroy(sim, r, type) {
  if (r.state === 'destroyed') return;
  if (r.chunk) splitChunk(sim, r.chunk, false);
  const p = r.collider.translation();
  const q = r.collider.rotation();
  detach(sim, r);
  r.body = null;
  markDestroyed(sim, r, p, q, type);
}

// ---------- заряды ----------

// charges: [{ id, delay }] — id блока и задержка подрыва в секундах от старта
export function detonate(sim, charges) {
  sim.pending = charges.map((c) => ({ ...c, at: sim.t + c.delay })).sort((x, y) => x.at - y.at);
  sim.started = true;
  sim.lastActivity = sim.t;
}

function blast(sim, rec) {
  if (rec.state === 'destroyed') return;
  const center = { ...rec.collider.translation() };
  destroy(sim, rec, 'blast');
  settle(sim);
  // заряд режет колонну, а не двигает дом: толкаем только отдельные обломки
  for (const other of sim.byId.values()) {
    if (other.state !== 'dynamic' || other.chunk) continue;
    const p = other.body.translation();
    const d = { x: p.x - center.x, y: p.y - center.y, z: p.z - center.z };
    const dist = Math.hypot(d.x, d.y, d.z);
    if (dist > BLAST_RADIUS || dist < 1e-3) continue;
    const k = (other.mass * BLAST_SPEED * (1 - dist / BLAST_RADIUS)) / dist;
    other.body.applyImpulse({ x: d.x * k, y: d.y * k + other.mass * 0.5, z: d.z * k }, true);
  }
  sim.lastActivity = sim.t;
}

// ---------- шаг ----------

// Всё, что движется: куски и отдельные динамические блоки
function movers(sim) {
  const out = new Set();
  for (const r of sim.byId.values()) if (r.state === 'dynamic') out.add(r.chunk ?? r);
  return out;
}

export function step(sim) {
  while (sim.pending.length && sim.pending[0].at <= sim.t) blast(sim, sim.byId.get(sim.pending.shift().id));

  // скорости до шага: после шага контакт уже погасил скорость, и удар от нагрузки не отличить
  const moving = movers(sim);
  for (const m of moving) m.v = m.body.linvel();

  sim.world.step(sim.queue);
  sim.t += STEP;

  const crushed = new Set();
  sim.queue.drainContactForceEvents((e) => {
    const force = e.totalForceMagnitude();
    const h1 = e.collider1();
    const h2 = e.collider2();
    const r1 = sim.byCollider.get(h1);
    const r2 = sim.byCollider.get(h2);
    for (const [n, r] of [[sim.neighbors.get(h1), r2], [sim.neighbors.get(h2), r1]]) {
      if (n && r?.state === 'dynamic') {
        n.damage = Math.max(n.damage, force);
        sim.events.push({ type: 'neighbor', id: n.id, force });
      }
    }
    for (const [r, other] of [[r1, r2], [r2, r1]]) {
      if (r?.state !== 'static' || other?.state !== 'dynamic') continue;
      const g = force / (r.mass * 9.81);
      // стены хрупкие и под нагрузкой, колонну сминает только удар
      if (r.block.kind === 'wall' ? g > WALL_CRUSH_G : g > CRUSH_G && speed(other.body) > IMPACT_SPEED) crushed.add(r);
    }
    if (force > 2e5) {
      const src = r1?.state === 'dynamic' ? r1 : r2;
      if (src?.state === 'dynamic') sim.events.push({ type: 'impact', pos: { ...src.collider.translation() }, force });
    }
  });

  // Резкое торможение — удар: кусок раскалывается, отдельные колонны и стены сминаются.
  // Сильно накренившийся кусок ломается на блоки.
  for (const m of moving) {
    if (m.recs) {
      if (!sim.chunks.has(m)) continue;
      const dv = delta(m.body.linvel(), m.v);
      if (dv > SHATTER_DV) splitChunk(sim, m, true);
      else if (tilt(m.body) > m.bend) splitChunk(sim, m, false);
    } else if (m.state === 'dynamic' && !m.chunk && m.block.kind !== 'slab' && !(sim.t < m.graceUntil)) {
      if (delta(m.body.linvel(), m.v) > SHATTER_DV) destroy(sim, m, 'shatter');
    }
  }

  if (crushed.size) {
    for (const r of crushed) {
      if (r.state !== 'static') continue;
      if (r.block.kind === 'wall') destroy(sim, r, 'shatter');
      else makeDynamic(sim, [r]);
    }
    settle(sim);
  }

  for (const m of movers(sim)) {
    if (!m.body.isSleeping() && speed(m.body) > 0.3) {
      sim.lastActivity = sim.t;
      break;
    }
  }
}

function delta(a, b) {
  return Math.hypot(a.x - b.x, a.y - b.y, a.z - b.z);
}

function speed(body) {
  const v = body.linvel();
  return Math.hypot(v.x, v.y, v.z);
}

// Угол между осью y тела и вертикалью
function tilt(body) {
  const q = body.rotation();
  return Math.acos(Math.max(-1, Math.min(1, 1 - 2 * (q.x * q.x + q.z * q.z))));
}

// Детерминированное число 0..1 из строки
function hash(str) {
  let h = 2166136261;
  for (let i = 0; i < str.length; i++) h = Math.imul(h ^ str.charCodeAt(i), 16777619);
  return (h >>> 0) / 4294967296;
}

// Всё улеглось: давно ничего не движется и все заряды сработали.
export function isSettled(sim, quiet = 1.5) {
  return sim.started && sim.pending.length === 0 && sim.t - sim.lastActivity > quiet;
}

export function drainEvents(sim) {
  const ev = sim.events;
  sim.events = [];
  return ev;
}

export function disposeSim(sim) {
  sim.world.free();
}
