// Процедурные текстуры на canvas: окна стен, фасады соседей, разметка зоны, мягкое пятно для пыли.
import * as THREE from 'three';

function canvas(w, h) {
  const c = document.createElement('canvas');
  c.width = w;
  c.height = h;
  return [c, c.getContext('2d')];
}

function texture(c, repeat = [1, 1]) {
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  t.wrapS = t.wrapT = THREE.RepeatWrapping;
  t.repeat.set(...repeat);
  t.anisotropy = 4;
  return t;
}

// Панель стены с одним окном
export function wallTexture(color) {
  const [c, g] = canvas(256, 256);
  g.fillStyle = color;
  g.fillRect(0, 0, 256, 256);
  // лёгкая фактура штукатурки
  for (let i = 0; i < 900; i++) {
    g.fillStyle = `rgba(0,0,0,${Math.random() * 0.05})`;
    g.fillRect(Math.random() * 256, Math.random() * 256, 2, 2);
  }
  g.fillStyle = 'rgba(0,0,0,0.18)';
  g.fillRect(58, 58, 140, 120);
  g.fillStyle = '#f4efe6';
  g.fillRect(62, 62, 132, 112);
  const glass = g.createLinearGradient(0, 66, 0, 170);
  glass.addColorStop(0, '#6f8fae');
  glass.addColorStop(1, '#2d4460');
  g.fillStyle = glass;
  g.fillRect(70, 70, 116, 96);
  g.fillStyle = '#f4efe6';
  g.fillRect(125, 70, 6, 96);
  g.fillStyle = 'rgba(255,255,255,0.25)';
  g.beginPath();
  g.moveTo(76, 76);
  g.lineTo(110, 76);
  g.lineTo(80, 130);
  g.fill();
  g.fillStyle = 'rgba(0,0,0,0.25)';
  g.fillRect(56, 178, 144, 8);
  return texture(c);
}

// Фасад соседнего дома: сетка окон, повтор по размерам дома
export function facadeTexture(color, repeat) {
  const [c, g] = canvas(128, 128);
  g.fillStyle = color;
  g.fillRect(0, 0, 128, 128);
  g.fillStyle = 'rgba(0,0,0,0.12)';
  g.fillRect(0, 124, 128, 4);
  const lit = Math.random() < 0.3;
  g.fillStyle = lit ? '#f3d98b' : '#3b536d';
  g.fillRect(28, 30, 72, 64);
  g.fillStyle = 'rgba(255,255,255,0.22)';
  g.fillRect(32, 34, 20, 56);
  return texture(c, repeat);
}

// Зона сноса: жёлто-чёрные полосы
export function zoneTexture(repeat) {
  const [c, g] = canvas(128, 128);
  g.fillStyle = '#f2c230';
  g.fillRect(0, 0, 128, 128);
  g.fillStyle = '#2b2b2b';
  for (let i = -128; i < 256; i += 64) {
    g.beginPath();
    g.moveTo(i, 0);
    g.lineTo(i + 32, 0);
    g.lineTo(i + 32 + 128, 128);
    g.lineTo(i + 128, 128);
    g.fill();
  }
  return texture(c, repeat);
}

// Земля: трава с пятнами
export function grassTexture() {
  const [c, g] = canvas(256, 256);
  g.fillStyle = '#86a860';
  g.fillRect(0, 0, 256, 256);
  for (let i = 0; i < 2500; i++) {
    const l = 30 + Math.random() * 20;
    g.fillStyle = `hsla(${85 + Math.random() * 20}, 35%, ${l}%, 0.35)`;
    g.fillRect(Math.random() * 256, Math.random() * 256, 3, 3);
  }
  return texture(c, [60, 60]);
}

export function dirtTexture() {
  const [c, g] = canvas(256, 256);
  g.fillStyle = '#b09572';
  g.fillRect(0, 0, 256, 256);
  for (let i = 0; i < 3000; i++) {
    g.fillStyle = `rgba(${60 + Math.random() * 60},${50 + Math.random() * 40},30,${Math.random() * 0.25})`;
    g.fillRect(Math.random() * 256, Math.random() * 256, 2 + Math.random() * 3, 2 + Math.random() * 3);
  }
  return texture(c);
}

export function softDot() {
  const [c, g] = canvas(64, 64);
  const r = g.createRadialGradient(32, 32, 0, 32, 32, 32);
  r.addColorStop(0, 'rgba(255,255,255,1)');
  r.addColorStop(0.5, 'rgba(255,255,255,0.5)');
  r.addColorStop(1, 'rgba(255,255,255,0)');
  g.fillStyle = r;
  g.fillRect(0, 0, 64, 64);
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  return t;
}

// Подпись над зарядом
export function labelTexture(text) {
  const [c, g] = canvas(128, 64);
  g.fillStyle = 'rgba(20,20,20,0.85)';
  g.beginPath();
  g.roundRect(4, 8, 120, 48, 14);
  g.fill();
  g.fillStyle = '#ffd54a';
  g.font = 'bold 30px system-ui, sans-serif';
  g.textAlign = 'center';
  g.textBaseline = 'middle';
  g.fillText(text, 64, 33);
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  return t;
}
