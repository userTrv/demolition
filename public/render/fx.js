// Эффекты: пыль, вспышки взрывов, мелкие обломки рассыпавшихся стен и колонн, тряска камеры.
// Обломки — без физики Rapier: летят по баллистике и ложатся на землю, так дёшево и на телефоне.
import * as THREE from 'three';
import { softDot } from './textures.js';

const MAX_DEBRIS = 900;
const MAX_DUST = 260;

export function createFx(scene) {
  const dotTex = softDot();

  const debrisMesh = new THREE.InstancedMesh(
    new THREE.BoxGeometry(1, 1, 1),
    new THREE.MeshStandardMaterial({ color: '#ffffff', roughness: 0.95 }),
    MAX_DEBRIS,
  );
  debrisMesh.castShadow = true;
  debrisMesh.receiveShadow = true;
  debrisMesh.count = 0;
  debrisMesh.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
  scene.add(debrisMesh);
  const debris = [];

  const dust = [];
  const dustGroup = new THREE.Group();
  scene.add(dustGroup);

  const flash = new THREE.PointLight('#ffb35c', 0, 40, 1.5);
  scene.add(flash);

  const fx = { shake: 0 };
  const m = new THREE.Matrix4();
  const q = new THREE.Quaternion();
  const e = new THREE.Euler();
  const s = new THREE.Vector3();
  const color = new THREE.Color();

  function addDebris(pos, vel, size, tint) {
    let d;
    if (debris.length < MAX_DEBRIS) {
      d = { pos: new THREE.Vector3(), vel: new THREE.Vector3(), rot: new THREE.Vector3(), spin: new THREE.Vector3() };
      debris.push(d);
    } else {
      // переиспользуем самый старый лежащий обломок
      d = debris.find((x) => x.rest) ?? debris[0];
    }
    d.pos.copy(pos);
    d.vel.copy(vel);
    d.rot.set(Math.random() * 6, Math.random() * 6, Math.random() * 6);
    d.spin.set(Math.random() - 0.5, Math.random() - 0.5, Math.random() - 0.5).multiplyScalar(12);
    d.size = size;
    d.rest = false;
    const i = debris.indexOf(d);
    color.set(tint).offsetHSL(0, 0, (Math.random() - 0.5) * 0.12);
    debrisMesh.setColorAt(i, color);
    debrisMesh.count = debris.length;
    if (debrisMesh.instanceColor) debrisMesh.instanceColor.needsUpdate = true;
  }

  function addDust(pos, { count = 6, spread = 1.5, size = 3, up = 1.5, life = 3, tint = '#cdbfa8' } = {}) {
    for (let i = 0; i < count; i++) {
      let p = dust.find((x) => x.life <= 0);
      if (!p) {
        if (dust.length >= MAX_DUST) return;
        const sprite = new THREE.Sprite(
          new THREE.SpriteMaterial({ map: dotTex, transparent: true, depthWrite: false, color: tint }),
        );
        p = { sprite, vel: new THREE.Vector3(), life: 0 };
        dust.push(p);
        dustGroup.add(sprite);
      }
      p.sprite.material.color.set(tint).offsetHSL(0, 0, (Math.random() - 0.5) * 0.1);
      p.sprite.position.set(
        pos.x + (Math.random() - 0.5) * spread,
        Math.max(0.3, pos.y + (Math.random() - 0.5) * spread * 0.5),
        pos.z + (Math.random() - 0.5) * spread,
      );
      p.vel.set((Math.random() - 0.5) * spread, Math.random() * up, (Math.random() - 0.5) * spread);
      p.maxLife = p.life = life * (0.7 + Math.random() * 0.6);
      p.size0 = size * (0.5 + Math.random() * 0.4);
      p.size1 = size * (1.6 + Math.random());
      p.sprite.visible = true;
    }
  }

  fx.blast = (pos) => {
    flash.position.set(pos.x, pos.y + 0.5, pos.z);
    flash.intensity = 900;
    addDust(pos, { count: 14, spread: 2.5, size: 2.2, up: 3, life: 2.5, tint: '#d8cbb4' });
    addDust(pos, { count: 4, spread: 0.6, size: 1.6, up: 0.5, life: 0.35, tint: '#ffcf6b' });
    const p = new THREE.Vector3(pos.x, pos.y, pos.z);
    for (let i = 0; i < 12; i++) {
      addDebris(p, new THREE.Vector3((Math.random() - 0.5) * 12, Math.random() * 7, (Math.random() - 0.5) * 12), 0.08 + Math.random() * 0.15, '#9a948a');
    }
    fx.shake = Math.max(fx.shake, 0.35);
  };

  // Рассыпавшийся блок: горсть обломков в его объёме и облако пыли
  fx.shatter = (ev, tint) => {
    const [w, h, d] = ev.size;
    const n = Math.min(16, Math.max(5, Math.round(w * h * d * 3)));
    const center = new THREE.Vector3(ev.pos.x, ev.pos.y, ev.pos.z);
    const rot = new THREE.Quaternion(ev.rot.x, ev.rot.y, ev.rot.z, ev.rot.w);
    const local = new THREE.Vector3();
    for (let i = 0; i < n; i++) {
      local.set((Math.random() - 0.5) * w, (Math.random() - 0.5) * h, (Math.random() - 0.5) * d).applyQuaternion(rot);
      const p = center.clone().add(local);
      addDebris(p, new THREE.Vector3((Math.random() - 0.5) * 3, Math.random() * 2, (Math.random() - 0.5) * 3), 0.15 + Math.random() * 0.3, tint);
    }
    addDust(center, { count: 3, spread: Math.max(w, d), size: 2.5, up: 1, life: 3.5 });
  };

  fx.impact = (pos, force) => {
    const k = Math.min(1, force / 3e6);
    addDust(pos, { count: 2 + Math.round(k * 4), spread: 2, size: 2.5 + k * 3, up: 1, life: 3 + k * 2 });
    fx.shake = Math.max(fx.shake, 0.1 + k * 0.25);
  };

  fx.update = (dt) => {
    flash.intensity *= Math.exp(-dt * 12);
    fx.shake *= Math.exp(-dt * 4);

    for (let i = 0; i < debris.length; i++) {
      const d = debris[i];
      if (!d.rest) {
        d.vel.y -= 9.81 * dt;
        d.pos.addScaledVector(d.vel, dt);
        d.rot.addScaledVector(d.spin, dt);
        const floor = d.size / 2;
        if (d.pos.y < floor) {
          d.pos.y = floor;
          d.vel.y *= -0.25;
          d.vel.x *= 0.5;
          d.vel.z *= 0.5;
          d.spin.multiplyScalar(0.5);
          if (Math.abs(d.vel.y) < 0.6) {
            d.rest = true;
            d.rot.x = Math.round(d.rot.x / (Math.PI / 2)) * (Math.PI / 2);
            d.rot.z = Math.round(d.rot.z / (Math.PI / 2)) * (Math.PI / 2);
          }
        }
      }
      q.setFromEuler(e.set(d.rot.x, d.rot.y, d.rot.z));
      s.setScalar(d.size);
      m.compose(d.pos, q, s);
      debrisMesh.setMatrixAt(i, m);
    }
    debrisMesh.instanceMatrix.needsUpdate = true;

    for (const p of dust) {
      if (p.life <= 0) continue;
      p.life -= dt;
      if (p.life <= 0) {
        p.sprite.visible = false;
        continue;
      }
      const k = 1 - p.life / p.maxLife;
      p.vel.multiplyScalar(Math.exp(-dt * 1.5));
      p.sprite.position.addScaledVector(p.vel, dt);
      const size = p.size0 + (p.size1 - p.size0) * Math.sqrt(k);
      p.sprite.scale.set(size, size, 1);
      p.sprite.material.opacity = 0.55 * (1 - k) ** 1.4;
    }
  };

  fx.clear = () => {
    debris.length = 0;
    debrisMesh.count = 0;
    for (const p of dust) {
      p.life = 0;
      p.sprite.visible = false;
    }
    flash.intensity = 0;
    fx.shake = 0;
  };

  return fx;
}
