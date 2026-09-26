// Итог сноса: сколько массы легло в зону, сколько осталось стоять, задеты ли соседи, и звёзды.
export const NEIGHBOR_HIT = 3e5; // Н, суммарный удар, после которого сосед считается задетым

export function inZone(zone, x, z) {
  return x >= zone.x[0] && x <= zone.x[1] && z >= zone.z[0] && z <= zone.z[1];
}

// blocks: [{ mass, state: 'static' | 'dynamic' | 'destroyed', pos: { x, y, z } }]
// У разрушенного блока pos — где он рассыпался: там лежат его обломки.
// neighbors: [{ id, damage }]
export function evaluate({ blocks, neighbors = [] }, zone) {
  let total = 0;
  let zoned = 0;
  let standing = 0;
  for (const b of blocks) {
    if (!b.pos) continue;
    total += b.mass;
    if (b.state === 'static') standing += b.mass;
    else if (inZone(zone, b.pos.x, b.pos.z)) zoned += b.mass;
  }
  const hit = neighbors.filter((n) => n.damage > NEIGHBOR_HIT).map((n) => n.id);
  const inZonePct = total ? zoned / total : 0;
  const standingPct = total ? standing / total : 0;
  let stars = inZonePct >= 0.95 ? 3 : inZonePct >= 0.85 ? 2 : inZonePct >= 0.7 ? 1 : 0;
  if (hit.length) stars = Math.min(stars, 1);
  if (standingPct > 0.1) stars = 0;
  return { stars, inZonePct, standingPct, hit };
}

// Снимок симуляции для evaluate
export function snapshot(sim) {
  const blocks = [];
  for (const rec of sim.byId.values()) {
    blocks.push({
      mass: rec.mass,
      state: rec.state,
      pos: rec.state === 'destroyed' ? rec.lastPos : rec.collider.translation(),
    });
  }
  return { blocks, neighbors: [...sim.neighbors.values()] };
}
