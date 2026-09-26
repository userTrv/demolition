// Сцена three.js: земля, зона сноса, соседи, деревья, блоки здания, маркеры зарядов, камера.
// Блоки только отображают физику: положение каждый кадр берётся из коллайдера Rapier.
import * as THREE from 'three';
import { OrbitControls } from 'three/addons/OrbitControls.js';
import { createFx } from './fx.js';
import { wallTexture, facadeTexture, zoneTexture, grassTexture, dirtTexture, labelTexture } from './textures.js';

const SKY = '#bcd6ee';

export function createView(canvas) {
  const renderer = new THREE.WebGLRenderer({ canvas, antialias: true, powerPreference: 'high-performance' });
  renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
  renderer.shadowMap.enabled = true;
  renderer.shadowMap.type = THREE.PCFShadowMap;
  renderer.toneMapping = THREE.ACESFilmicToneMapping;
  renderer.toneMappingExposure = 1.05;

  const scene = new THREE.Scene();
  scene.background = new THREE.Color(SKY);
  scene.fog = new THREE.Fog(SKY, 120, 320);

  const camera = new THREE.PerspectiveCamera(45, 1, 0.5, 600);
  const controls = new OrbitControls(camera, canvas);
  controls.enableDamping = true;
  controls.maxPolarAngle = Math.PI * 0.48;
  controls.minDistance = 8;
  controls.maxDistance = 160;

  scene.add(new THREE.HemisphereLight('#dcebff', '#7a6a4f', 1.3));
  const sun = new THREE.DirectionalLight('#fff0d8', 2.6);
  sun.position.set(40, 70, 30);
  sun.castShadow = true;
  sun.shadow.mapSize.set(2048, 2048);
  sun.shadow.bias = -0.0004;
  sun.shadow.normalBias = 0.03;
  Object.assign(sun.shadow.camera, { left: -60, right: 60, top: 60, bottom: -60, near: 1, far: 220 });
  scene.add(sun, sun.target);

  const ground = new THREE.Mesh(
    new THREE.PlaneGeometry(600, 600),
    new THREE.MeshStandardMaterial({ map: grassTexture(), roughness: 1 }),
  );
  ground.rotation.x = -Math.PI / 2;
  ground.receiveShadow = true;
  scene.add(ground);

  const fx = createFx(scene);
  const levelGroup = new THREE.Group();
  scene.add(levelGroup);

  const view = {
    renderer,
    scene,
    camera,
    controls,
    fx,
    meshes: new Map(), // id блока → меш
    markers: new Map(), // id блока → маркер заряда
    planMode: true,
    levelGroup,
  };

  view.resize = () => {
    const w = canvas.clientWidth;
    const h = canvas.clientHeight;
    renderer.setSize(w, h, false);
    camera.aspect = w / h;
    camera.updateProjectionMatrix();
  };

  view.build = (level) => {
    disposeGroup(levelGroup);
    view.meshes.clear();
    view.markers.clear();
    fx.clear();

    const [zx0, zx1] = level.zone.x;
    const [zz0, zz1] = level.zone.z;

    // площадка под снос и полосатая зона
    const lot = new THREE.Mesh(
      new THREE.PlaneGeometry(zx1 - zx0 + 8, zz1 - zz0 + 8),
      new THREE.MeshStandardMaterial({ map: dirtTexture(), roughness: 1 }),
    );
    lot.rotation.x = -Math.PI / 2;
    lot.position.set((zx0 + zx1) / 2, 0.01, (zz0 + zz1) / 2);
    lot.receiveShadow = true;
    levelGroup.add(lot);
    addZoneFrame(levelGroup, level.zone);

    for (const n of level.neighbors) levelGroup.add(neighborMesh(n));
    addTrees(levelGroup, level);

    const pal = level.palette;
    const mats = {
      column: new THREE.MeshStandardMaterial({ color: pal.column, roughness: 0.85 }),
      slab: new THREE.MeshStandardMaterial({ color: pal.slab, roughness: 0.9 }),
      wall: new THREE.MeshStandardMaterial({ map: wallTexture(pal.wall), roughness: 0.85, transparent: true }),
    };
    view.tints = { column: pal.column, slab: pal.slab, wall: pal.wall };
    const geoms = new Map();
    for (const b of level.blocks) {
      const key = b.size.join('x');
      if (!geoms.has(key)) geoms.set(key, new THREE.BoxGeometry(...b.size));
      const mesh = new THREE.Mesh(geoms.get(key), mats[b.kind]);
      mesh.position.set(...b.pos);
      mesh.castShadow = true;
      mesh.receiveShadow = true;
      mesh.userData.block = b;
      levelGroup.add(mesh);
      view.meshes.set(b.id, mesh);
    }
    view.wallMaterial = mats.wall;
    view.columnMaterial = mats.column;
    view.columnHl = mats.column.clone();
    view.columnHl.emissive.set('#ff9d3b');
    view.columnHl.emissiveIntensity = 0.45;
    levelGroup.userData.extra = [view.columnHl];
    view.setPlanMode(true);
    view.frame(level);
  };

  // Камера так, чтобы были видны здание и зона
  view.frame = (level) => {
    const height = level.building.floors * (level.building.storey ?? 3);
    const cx = (level.zone.x[0] + level.zone.x[1]) / 2;
    const cz = (level.zone.z[0] + level.zone.z[1]) / 2;
    const span = Math.max(level.zone.x[1] - level.zone.x[0], level.zone.z[1] - level.zone.z[0], height * 1.2);
    const target = new THREE.Vector3(cx * 0.6, height * 0.35, cz * 0.6);
    controls.target.copy(target);
    // направление на камеру: у уровня может быть своё, чтобы соседи не загораживали здание
    const dir = new THREE.Vector3(...(level.camera ?? [0.45, 0.45, 0.8])).normalize();
    // на узком портретном экране по горизонтали видно меньше — отодвигаемся
    const narrow = camera.aspect < 1 ? Math.min(2.2, 0.85 / camera.aspect) : 1;
    camera.position.copy(target).addScaledVector(dir, (span * 1.25 + 10) * narrow);
    sun.target.position.copy(target);
    sun.position.set(target.x + 40, 70, target.z + 30);
    controls.update();
  };

  // В режиме расстановки стены полупрозрачные, чтобы были видны колонны
  view.setPlanMode = (on) => {
    view.planMode = on;
    view.wallMaterial.opacity = on ? 0.28 : 1;
    view.wallMaterial.depthWrite = !on;
    view.wallMaterial.needsUpdate = true;
  };

  view.setCharges = (charges, selected) => {
    for (const [id, marker] of view.markers) {
      if (!charges.has(id)) {
        levelGroup.remove(marker);
        marker.userData.label.material.map.dispose();
        view.markers.delete(id);
      }
    }
    for (const [id, delay] of charges) {
      let marker = view.markers.get(id);
      if (!marker) {
        marker = chargeMarker(view.meshes.get(id).userData.block);
        levelGroup.add(marker);
        view.markers.set(id, marker);
      }
      if (marker.userData.delay !== delay) {
        marker.userData.delay = delay;
        const old = marker.userData.label.material.map;
        marker.userData.label.material.map = labelTexture(`${String(delay).replace('.', ',')} с`);
        old?.dispose();
      }
      marker.userData.ring.visible = id === selected;
    }
  };

  view.hideMarker = (id) => {
    const marker = view.markers.get(id);
    if (marker) marker.visible = false;
  };

  view.pickColumn = (x, y) => {
    const ray = new THREE.Raycaster();
    ray.setFromCamera(new THREE.Vector2(x, y), camera);
    const targets = [...view.meshes.values()].filter((m) => m.userData.block.kind === 'column' && m.visible);
    for (const marker of view.markers.values()) targets.push(marker.userData.body);
    const hit = ray.intersectObjects(targets, false)[0];
    if (!hit) return null;
    return hit.object.userData.block?.id ?? hit.object.userData.blockId;
  };

  view.highlight = (id) => {
    for (const [bid, mesh] of view.meshes) {
      if (mesh.userData.block.kind === 'column') mesh.material = bid === id ? view.columnHl : view.columnMaterial;
    }
  };

  // Перенос положения блоков из физики
  view.sync = (sim) => {
    for (const rec of sim.byId.values()) {
      if (rec.state === 'static') continue;
      const mesh = view.meshes.get(rec.block.id);
      if (rec.state === 'destroyed') {
        mesh.visible = false;
        continue;
      }
      const p = rec.collider.translation();
      const q = rec.collider.rotation();
      mesh.position.set(p.x, p.y, p.z);
      mesh.quaternion.set(q.x, q.y, q.z, q.w);
    }
  };

  const shakeOffset = new THREE.Vector3();
  view.render = (dt, time) => {
    fx.update(dt);
    for (const marker of view.markers.values()) {
      marker.userData.light.material.emissiveIntensity = 0.6 + 0.6 * Math.sin(time * (marker.userData.armed ? 18 : 4));
    }
    controls.update();
    shakeOffset.set((Math.random() - 0.5), (Math.random() - 0.5), (Math.random() - 0.5)).multiplyScalar(fx.shake);
    camera.position.add(shakeOffset);
    renderer.render(scene, camera);
    camera.position.sub(shakeOffset);
  };

  view.armMarkers = (on) => {
    for (const marker of view.markers.values()) marker.userData.armed = on;
  };

  return view;
}

function chargeMarker(block) {
  const group = new THREE.Group();
  group.position.set(block.pos[0], block.pos[1] - block.size[1] * 0.15, block.pos[2]);
  const body = new THREE.Mesh(
    new THREE.BoxGeometry(block.size[0] + 0.16, 0.5, block.size[2] + 0.16),
    new THREE.MeshStandardMaterial({ color: '#c8382a', roughness: 0.6 }),
  );
  body.userData.blockId = block.id;
  body.castShadow = true;
  const light = new THREE.Mesh(
    new THREE.SphereGeometry(0.09, 10, 8),
    new THREE.MeshStandardMaterial({ color: '#ff3b2f', emissive: '#ff3b2f', emissiveIntensity: 1 }),
  );
  light.position.set(0, 0.3, 0);
  const wire = new THREE.Mesh(
    new THREE.TorusGeometry(0.42, 0.03, 6, 20),
    new THREE.MeshStandardMaterial({ color: '#2a2a2a' }),
  );
  wire.rotation.x = Math.PI / 2;
  const ring = new THREE.Mesh(
    new THREE.RingGeometry(0.75, 0.95, 32),
    new THREE.MeshBasicMaterial({ color: '#ffd54a', side: THREE.DoubleSide, transparent: true, opacity: 0.9, depthTest: false }),
  );
  ring.rotation.x = -Math.PI / 2;
  ring.position.y = -0.3;
  ring.renderOrder = 10;
  const label = new THREE.Sprite(new THREE.SpriteMaterial({ depthTest: false, transparent: true }));
  label.scale.set(1.6, 0.8, 1);
  label.position.y = 1.6;
  label.renderOrder = 11;
  group.add(body, light, wire, ring, label);
  group.userData = { body, light, ring, label, delay: null, armed: false };
  return group;
}

function addZoneFrame(group, zone) {
  const [x0, x1] = zone.x;
  const [z0, z1] = zone.z;
  const w = x1 - x0;
  const d = z1 - z0;
  const inner = new THREE.Mesh(
    new THREE.PlaneGeometry(w, d),
    new THREE.MeshBasicMaterial({ color: '#f2c230', transparent: true, opacity: 0.12, depthWrite: false }),
  );
  inner.rotation.x = -Math.PI / 2;
  inner.position.set((x0 + x1) / 2, 0.03, (z0 + z1) / 2);
  group.add(inner);
  const t = 0.5;
  const mat = new THREE.MeshStandardMaterial({ map: zoneTexture([w / 2, 1]), roughness: 0.8 });
  const matZ = new THREE.MeshStandardMaterial({ map: zoneTexture([d / 2, 1]), roughness: 0.8 });
  const strips = [
    [w + t, t, (x0 + x1) / 2, z0, 0, mat],
    [w + t, t, (x0 + x1) / 2, z1, 0, mat],
    [d + t, t, x0, (z0 + z1) / 2, Math.PI / 2, matZ],
    [d + t, t, x1, (z0 + z1) / 2, Math.PI / 2, matZ],
  ];
  for (const [len, width, x, z, rot, material] of strips) {
    const strip = new THREE.Mesh(new THREE.PlaneGeometry(len, width), material);
    strip.rotation.set(-Math.PI / 2, 0, rot);
    strip.position.set(x, 0.04, z);
    strip.receiveShadow = true;
    group.add(strip);
  }
}

function neighborMesh(n) {
  const [w, h, d] = n.size;
  const floors = Math.max(1, Math.round(h / 3));
  const side = (len) => new THREE.MeshStandardMaterial({ map: facadeTexture(n.color, [Math.max(1, Math.round(len / 3)), floors]), roughness: 0.8 });
  const roof = new THREE.MeshStandardMaterial({ color: '#6e6a66', roughness: 0.9 });
  const mesh = new THREE.Mesh(new THREE.BoxGeometry(w, h, d), [side(d), side(d), roof, roof, side(w), side(w)]);
  mesh.position.set(...n.pos);
  mesh.castShadow = true;
  mesh.receiveShadow = true;
  return mesh;
}

// Деревья вокруг, но не в зоне и не в домах
function addTrees(group, level) {
  let seed = level.id.length * 7919;
  const rnd = () => ((seed = (seed * 16807) % 2147483647) / 2147483647);
  const trunkMat = new THREE.MeshStandardMaterial({ color: '#6b4a2f', roughness: 1 });
  const leafMat = new THREE.MeshStandardMaterial({ color: '#4f7d3a', roughness: 0.9, flatShading: true });
  const trunkGeo = new THREE.CylinderGeometry(0.18, 0.25, 1.6, 6);
  const leafGeo = new THREE.IcosahedronGeometry(1.4, 0);
  const clear = (x, z) => {
    const m = 4;
    if (x > level.zone.x[0] - m && x < level.zone.x[1] + m && z > level.zone.z[0] - m && z < level.zone.z[1] + m) return false;
    return level.neighbors.every((n) => Math.abs(x - n.pos[0]) > n.size[0] / 2 + 2 || Math.abs(z - n.pos[2]) > n.size[2] / 2 + 2);
  };
  for (let i = 0; i < 70; i++) {
    const a = rnd() * Math.PI * 2;
    const r = 18 + rnd() * 70;
    const x = Math.cos(a) * r;
    const z = Math.sin(a) * r;
    if (!clear(x, z)) continue;
    const s = 0.8 + rnd() * 0.8;
    const trunk = new THREE.Mesh(trunkGeo, trunkMat);
    trunk.position.set(x, 0.8 * s, z);
    trunk.scale.setScalar(s);
    const leaves = new THREE.Mesh(leafGeo, leafMat);
    leaves.position.set(x, 2.4 * s, z);
    leaves.scale.set(s, s * 1.2, s);
    trunk.castShadow = leaves.castShadow = true;
    group.add(trunk, leaves);
  }
}

function disposeGroup(group) {
  for (const m of group.userData.extra ?? []) m.dispose();
  for (const child of [...group.children]) {
    group.remove(child);
    child.traverse((o) => {
      o.geometry?.dispose();
      for (const m of [o.material].flat()) {
        if (!m) continue;
        m.map?.dispose();
        m.dispose();
      }
    });
  }
}
