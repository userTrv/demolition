// Звуки синтезом WebAudio: без файлов. Контекст создаётся по первому жесту игрока.
let ctx = null;
let master = null;
let muted = false;
let lastRumble = 0;

export function unlockAudio() {
  if (ctx) {
    if (ctx.state === 'suspended') ctx.resume();
    return;
  }
  const AC = window.AudioContext || window.webkitAudioContext;
  if (!AC) return;
  ctx = new AC();
  master = ctx.createGain();
  master.gain.value = 0.7;
  const comp = ctx.createDynamicsCompressor();
  master.connect(comp).connect(ctx.destination);
}

export function setMuted(on) {
  muted = on;
  if (master) master.gain.value = on ? 0 : 0.7;
}

export const isMuted = () => muted;

function noiseBuffer(seconds) {
  const len = Math.floor(ctx.sampleRate * seconds);
  const buf = ctx.createBuffer(1, len, ctx.sampleRate);
  const data = buf.getChannelData(0);
  let last = 0;
  for (let i = 0; i < len; i++) {
    // коричневатый шум: гуще и ниже белого
    last = (last + 0.04 * (Math.random() * 2 - 1)) / 1.04;
    data[i] = last * 3.5;
  }
  return buf;
}

function noise({ dur, freq, freqEnd = freq, gain, attack = 0.005, q = 0.7, when = 0 }) {
  if (!ctx || muted) return;
  const t = ctx.currentTime + when;
  const src = ctx.createBufferSource();
  src.buffer = noiseBuffer(dur);
  const f = ctx.createBiquadFilter();
  f.type = 'lowpass';
  f.Q.value = q;
  f.frequency.setValueAtTime(freq, t);
  f.frequency.exponentialRampToValueAtTime(Math.max(20, freqEnd), t + dur);
  const g = ctx.createGain();
  g.gain.setValueAtTime(0.0001, t);
  g.gain.exponentialRampToValueAtTime(gain, t + attack);
  g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
  src.connect(f).connect(g).connect(master);
  src.start(t);
}

function tone({ freq, dur, type = 'sine', gain = 0.2, when = 0 }) {
  if (!ctx || muted) return;
  const t = ctx.currentTime + when;
  const o = ctx.createOscillator();
  o.type = type;
  o.frequency.value = freq;
  const g = ctx.createGain();
  g.gain.setValueAtTime(0.0001, t);
  g.gain.exponentialRampToValueAtTime(gain, t + 0.01);
  g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
  o.connect(g).connect(master);
  o.start(t);
  o.stop(t + dur + 0.05);
}

export const sfx = {
  place: () => tone({ freq: 660, dur: 0.08, type: 'square', gain: 0.08 }),
  remove: () => tone({ freq: 330, dur: 0.1, type: 'square', gain: 0.07 }),
  beep: (last) => tone({ freq: last ? 1320 : 880, dur: last ? 0.35 : 0.15, type: 'square', gain: 0.1 }),
  blast: () => {
    noise({ dur: 1.6, freq: 1800, freqEnd: 60, gain: 0.9, attack: 0.003 });
    noise({ dur: 0.25, freq: 6000, freqEnd: 800, gain: 0.35, attack: 0.002 });
    tone({ freq: 48, dur: 0.8, gain: 0.5 });
  },
  shatter: () => noise({ dur: 0.35, freq: 2500, freqEnd: 400, gain: 0.12 }),
  rumble: (k) => {
    if (!ctx || ctx.currentTime - lastRumble < 0.12) return;
    lastRumble = ctx.currentTime;
    noise({ dur: 1.2 + k, freq: 400 + 400 * k, freqEnd: 50, gain: 0.15 + 0.4 * k, attack: 0.02 });
  },
  win: (stars) => {
    [523, 659, 784, 1046].slice(0, stars + 1).forEach((f, i) => tone({ freq: f, dur: 0.3, type: 'triangle', gain: 0.15, when: i * 0.12 }));
  },
  fail: () => [392, 330, 262].forEach((f, i) => tone({ freq: f, dur: 0.3, type: 'triangle', gain: 0.12, when: i * 0.15 })),
};
