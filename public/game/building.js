// Каркасное здание из блоков: колонны по сетке, плита на каждый пролёт каждого этажа, стены по периметру.
// У каждого блока есть опоры (supports) и сколько их должно уцелеть (need), чтобы блок остался стоять,
// и связи (links) с соседями: ими склеиваются блоки, рухнувшие одной волной.
// Координаты в метрах, y вверх, pos — центр блока, size — полные размеры.

export const COL = 0.5;
export const SLAB = 0.3;
export const WALL = 0.2;

export function generateFrame({
  id = 'b',
  origin = [0, 0],
  bays = [2, 1],
  bay = 4,
  floors = 3,
  storey = 3,
  walls = true,
}) {
  const [nx, nz] = bays;
  const [ox, oz] = origin;
  // origin — центр здания на земле
  const x0 = ox - (nx * bay) / 2;
  const z0 = oz - (nz * bay) / 2;
  const colH = storey - SLAB;
  const blocks = [];
  const byKey = new Map();
  const add = (key, block) => {
    block.id = `${id}:${key}`;
    block.key = key;
    block.supports = [];
    block.links = [];
    blocks.push(block);
    byKey.set(key, block);
    return block;
  };
  const get = (key) => byKey.get(key);
  const link = (a, b) => {
    if (!a || !b) return;
    a.links.push(b.id);
    b.links.push(a.id);
  };

  for (let f = 0; f < floors; f++) {
    const base = f * storey;
    for (let i = 0; i <= nx; i++) {
      for (let k = 0; k <= nz; k++) {
        add(`c${f}.${i}.${k}`, {
          kind: 'column',
          floor: f,
          pos: [x0 + i * bay, base + colH / 2, z0 + k * bay],
          size: [COL, colH, COL],
        });
      }
    }
    for (let i = 0; i < nx; i++) {
      for (let k = 0; k < nz; k++) {
        add(`s${f}.${i}.${k}`, {
          kind: 'slab',
          floor: f,
          pos: [x0 + (i + 0.5) * bay, base + storey - SLAB / 2, z0 + (k + 0.5) * bay],
          size: [bay, SLAB, bay],
        });
      }
    }
    if (walls) {
      // стены вдоль x на краях z = 0 и z = nz, вдоль z на краях x = 0 и x = nx
      for (let i = 0; i < nx; i++) {
        for (const k of [0, nz]) {
          add(`wx${f}.${i}.${k}`, {
            kind: 'wall',
            floor: f,
            edge: { axis: 'x', i, k, bay: [i, Math.min(k, nz - 1)] },
            pos: [x0 + (i + 0.5) * bay, base + colH / 2, z0 + k * bay],
            size: [bay - COL, colH, WALL],
          });
        }
      }
      for (let k = 0; k < nz; k++) {
        for (const i of [0, nx]) {
          add(`wz${f}.${i}.${k}`, {
            kind: 'wall',
            floor: f,
            edge: { axis: 'z', i, k, bay: [Math.min(i, nx - 1), k] },
            pos: [x0 + i * bay, base + colH / 2, z0 + (k + 0.5) * bay],
            size: [WALL, colH, bay - COL],
          });
        }
      }
    }
  }

  // Опоры и связи
  for (const b of blocks) {
    const idx = b.key.slice(1).split('.').map(Number);
    if (b.kind === 'column') {
      const [f, i, k] = idx;
      if (f === 0) {
        b.grounded = true;
        b.need = 0;
      } else {
        // колонна стоит на углах соседних плит этажа ниже, хватает одной
        for (const [bi, bk] of [[i - 1, k - 1], [i, k - 1], [i - 1, k], [i, k]]) {
          const s = get(`s${f - 1}.${bi}.${bk}`);
          if (s) {
            b.supports.push(s.id);
            link(b, s);
          }
        }
        b.need = 1;
      }
    } else if (b.kind === 'slab') {
      const [f, i, k] = idx;
      // плита держится на угловых колоннах своего этажа, ей нужно три из четырёх
      for (const [ci, ck] of [[i, k], [i + 1, k], [i, k + 1], [i + 1, k + 1]]) {
        const c = get(`c${f}.${ci}.${ck}`);
        b.supports.push(c.id);
        link(b, c);
      }
      b.need = 3;
      link(b, get(`s${f}.${i + 1}.${k}`));
      link(b, get(`s${f}.${i}.${k + 1}`));
    } else if (b.kind === 'wall') {
      const { axis, i, k, bay: [bi, bk] } = b.edge;
      const f = b.floor;
      if (f === 0) {
        b.grounded = true;
        b.need = 0;
      } else {
        b.supports.push(get(`s${f - 1}.${bi}.${bk}`).id);
        b.need = 1;
      }
      // стена висит между двумя колоннами и под плитой своего пролёта
      const ends = axis === 'x' ? [[i, k], [i + 1, k]] : [[i, k], [i, k + 1]];
      for (const [ci, ck] of ends) link(b, get(`c${f}.${ci}.${ck}`));
      link(b, get(`s${f}.${bi}.${bk}`));
      if (f > 0) link(b, get(`s${f - 1}.${bi}.${bk}`));
      delete b.edge;
    }
  }
  return blocks;
}

export function blockVolume(b) {
  return b.size[0] * b.size[1] * b.size[2];
}
