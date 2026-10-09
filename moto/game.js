/* =====================================================================
   FMX KING – Motocross Freestyle
   Reines HTML5-Canvas-Spiel, keine Abhängigkeiten.
   ===================================================================== */
(() => {
'use strict';

// ===================================================================
// Konstanten
// ===================================================================
const GRAV = 450;            // px/s²
const WB = 84;               // Radstand
const RW = 20;               // Radradius
const STEP = 8;              // Terrain-Auflösung (px)
const LIVES = 3;
const FIXED_DT = 1 / 120;
const STORE_KEY = 'fmxking.v1';
const TAU = Math.PI * 2;
const CRASH_ANGLE = 0.95;    // rad Abweichung zur Landeschräge => Crash
const PERFECT_ANGLE = 0.30;
const SLOPPY_ANGLE = 0.62;

const TRICKS = {
  cancan:   { name: 'Can-Can',     pts: 150 },
  superman: { name: 'Superman',    pts: 250 },
  nacnac:   { name: 'Nac-Nac',     pts: 350 },
  cliff:    { name: 'Cliffhanger', pts: 500 },
};
const TRICK_KEYS = Object.keys(TRICKS);

function flipInfo(n, dir) {
  const back = dir < 0;
  const table = back ? [0, 600, 2000, 5000] : [0, 800, 2600, 6000];
  const pts = n < table.length ? table[n] : table[3] + (n - 3) * 3000;
  const names = ['', '', 'Double ', 'Triple '];
  const pre = n < 4 ? names[n] : n + 'x ';
  return { name: pre + (back ? 'Backflip' : 'Frontflip'), pts };
}

// ===================================================================
// Helfer
// ===================================================================
const $ = (id) => document.getElementById(id);
const clamp = (v, a, b) => Math.max(a, Math.min(b, v));
const lerp = (a, b, t) => a + (b - a) * t;
const rand = (a, b) => a + Math.random() * (b - a);
function normAngle(a) {
  a %= TAU;
  if (a > Math.PI) a -= TAU;
  if (a < -Math.PI) a += TAU;
  return a;
}
function hash(n) {
  const s = Math.sin(n * 127.1 + 311.7) * 43758.5453;
  return s - Math.floor(s);
}
const fmt = (n) => Math.round(n).toLocaleString('de-DE');
const rgb = (c, a = 1) => `rgba(${c[0] | 0},${c[1] | 0},${c[2] | 0},${a})`;
const mixc = (a, b, t) => [lerp(a[0], b[0], t), lerp(a[1], b[1], t), lerp(a[2], b[2], t)];

// ===================================================================
// Speicher (Highscores)
// ===================================================================
const store = {
  data: { tracks: {}, muted: false, name: 'Fahrer', seenHint: false, lastTrack: 'arena' },
  load() {
    try {
      const d = JSON.parse(localStorage.getItem(STORE_KEY));
      if (d && typeof d === 'object') Object.assign(this.data, d);
    } catch (e) { /* ignore */ }
  },
  save() {
    try { localStorage.setItem(STORE_KEY, JSON.stringify(this.data)); } catch (e) { /* ignore */ }
  },
};
store.trackRec = function (id) {
  if (!this.data.tracks[id]) this.data.tracks[id] = { best: 0, scores: [] };
  return this.data.tracks[id];
};
store.load();

// ===================================================================
// Audio (WebAudio, alles synthetisch)
// ===================================================================
const sfx = (() => {
  let ac = null, master = null, eng = null, noiseBuf = null;
  let muted = store.data.muted;

  function init() {
    if (ac) { if (ac.state === 'suspended') ac.resume(); return; }
    try {
      ac = new (window.AudioContext || window.webkitAudioContext)();
    } catch (e) { return; }
    master = ac.createGain();
    master.gain.value = muted ? 0 : 0.55;
    master.connect(ac.destination);
    // Noise-Puffer
    noiseBuf = ac.createBuffer(1, ac.sampleRate, ac.sampleRate);
    const d = noiseBuf.getChannelData(0);
    for (let i = 0; i < d.length; i++) d[i] = Math.random() * 2 - 1;
    // Motor
    const o1 = ac.createOscillator(); o1.type = 'sawtooth';
    const o2 = ac.createOscillator(); o2.type = 'square';
    const lp = ac.createBiquadFilter(); lp.type = 'lowpass'; lp.frequency.value = 600; lp.Q.value = 2;
    const g = ac.createGain(); g.gain.value = 0;
    o1.connect(lp); o2.connect(lp); lp.connect(g); g.connect(master);
    o1.start(); o2.start();
    eng = { o1, o2, lp, g };
  }
  function setMuted(m) {
    muted = m; store.data.muted = m; store.save();
    if (master) master.gain.value = m ? 0 : 0.55;
  }
  function engine(rpm, on) {
    if (!eng) return;
    const t = ac.currentTime;
    const f = 42 + rpm * 120;
    eng.o1.frequency.setTargetAtTime(f, t, 0.05);
    eng.o2.frequency.setTargetAtTime(f * 0.5, t, 0.05);
    eng.lp.frequency.setTargetAtTime(350 + rpm * 1500, t, 0.05);
    eng.g.gain.setTargetAtTime(on ? 0.05 + rpm * 0.04 : 0, t, 0.08);
  }
  function tone(freq, dur, type = 'sine', vol = 0.2, slide = 0, delay = 0) {
    if (!ac) return;
    const t = ac.currentTime + delay;
    const o = ac.createOscillator(); o.type = type;
    const g = ac.createGain();
    o.frequency.setValueAtTime(freq, t);
    if (slide) o.frequency.exponentialRampToValueAtTime(Math.max(20, freq + slide), t + dur);
    g.gain.setValueAtTime(0.0001, t);
    g.gain.exponentialRampToValueAtTime(vol, t + 0.01);
    g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
    o.connect(g); g.connect(master);
    o.start(t); o.stop(t + dur + 0.05);
  }
  function noise(dur, vol = 0.3, cutoff = 800, delay = 0) {
    if (!ac) return;
    const t = ac.currentTime + delay;
    const s = ac.createBufferSource(); s.buffer = noiseBuf; s.loop = true;
    const f = ac.createBiquadFilter(); f.type = 'lowpass'; f.frequency.value = cutoff;
    const g = ac.createGain();
    g.gain.setValueAtTime(vol, t);
    g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
    s.connect(f); f.connect(g); g.connect(master);
    s.start(t); s.stop(t + dur + 0.05);
  }
  return {
    init, setMuted, engine,
    get muted() { return muted; },
    click() { tone(620, 0.06, 'square', 0.1); },
    land(impact) {
      const v = clamp(impact / 600, 0.15, 1);
      noise(0.14, 0.25 * v + 0.1, 700);
      tone(110, 0.16, 'sine', 0.25 * v + 0.1, -60);
    },
    perfect() { tone(880, 0.12, 'triangle', 0.2); tone(1320, 0.2, 'triangle', 0.2, 0, 0.09); },
    score(level) {
      const base = [523, 659, 784, 1047, 1319];
      const n = clamp(level + 2, 2, 5);
      for (let i = 0; i < n; i++) tone(base[i], 0.14, 'square', 0.09, 0, i * 0.06);
    },
    trick() { tone(760, 0.06, 'square', 0.06); },
    crash() {
      noise(0.7, 0.6, 900);
      tone(90, 0.5, 'sawtooth', 0.3, -60);
      tone(60, 0.7, 'sine', 0.3, -30, 0.05);
    },
    over() { [392, 330, 262, 196].forEach((f, i) => tone(f, 0.28, 'triangle', 0.2, 0, i * 0.2)); },
    crowd() { noise(0.9, 0.16, 1800); noise(0.5, 0.1, 3200, 0.1); },
    record() { [523, 659, 784, 1047, 784, 1047, 1319].forEach((f, i) => tone(f, 0.14, 'square', 0.1, 0, i * 0.09)); },
  };
})();

// ===================================================================
// Paletten / Biome
// ===================================================================
const BIOMES = [
  { name: 'Abend-Arena', skyTop: [40, 22, 96], skyMid: [222, 70, 120], skyBot: [255, 176, 72], sun: [255, 226, 130], sunY: 0.5, stars: 0,
    m1: [140, 58, 130], m2: [98, 40, 110], m3: [62, 28, 84], edge: [255, 184, 80], dirtTop: [190, 104, 54], dirtBot: [80, 38, 38], cloud: [255, 160, 150], tree: [60, 30, 70] },
  { name: 'Tages-Arena', skyTop: [34, 124, 232], skyMid: [110, 180, 250], skyBot: [206, 232, 255], sun: [255, 252, 214], sunY: 0.2, stars: 0,
    m1: [214, 170, 140], m2: [186, 134, 104], m3: [152, 100, 80], edge: [246, 216, 134], dirtTop: [220, 154, 88], dirtBot: [132, 82, 50], cloud: [255, 255, 255], tree: [70, 130, 70] },
  { name: 'Nacht-Stadion', skyTop: [6, 6, 30], skyMid: [30, 16, 80], skyBot: [118, 36, 134], sun: [225, 232, 255], sunY: 0.24, stars: 1,
    m1: [52, 38, 106], m2: [34, 26, 78], m3: [20, 16, 54], edge: [0, 236, 206], dirtTop: [76, 50, 106], dirtBot: [26, 16, 46], cloud: [90, 70, 150], tree: [14, 10, 36] },
  { name: 'Jungle Dawn', skyTop: [24, 90, 120], skyMid: [140, 190, 170], skyBot: [255, 226, 160], sun: [255, 240, 190], sunY: 0.44, stars: 0,
    m1: [84, 150, 126], m2: [48, 116, 96], m3: [26, 82, 66], edge: [120, 214, 90], dirtTop: [132, 86, 52], dirtBot: [58, 34, 28], cloud: [255, 246, 220], tree: [28, 100, 56] },
];
const pal = { idx: 0 };

// Jede Strecke hat ein festes Stadion-Thema (kein Überblenden mehr)
function updatePalette() {
  const idx = T.def ? T.def.theme : 1;
  const th = BIOMES[idx];
  for (const k in th) if (k !== 'name') pal[k] = th[k];
  pal.idx = idx;
  pal.name = th.name;
}

// ===================================================================
// Strecken (Stadien) – jede Strecke ist fest und endet im Ziel
// ===================================================================
const START_X = 1000;   // Ende der Startgerade
// Medaillen als Anteil am Profi-Richtwert `ref` (Punkte, die der Test-Bot mit Tricks+Flips erreicht;
// neu messen mit `node moto/tools/calibrate.js`, wenn sich Strecke oder Physik ändern)
const MEDAL_FRAC = { bronze: 0.25, silver: 0.55, gold: 0.9 };
const TRACKS = [
  { id: 'arena', name: 'Warm-up Arena', blurb: 'Weite, freundliche Rampen – zum Einfahren und Tricks üben.',
    theme: 1, seed: 7, jumps: 14, h0: 90, h1: 170, mega: 240, v0: 480, v1: 540, doubleP: 0.15, rollerP: 0.3, stars: 1, ref: 27000 },
  { id: 'sunset', name: 'Sunset Stadium', blurb: 'Höhere Sprünge, Doubles und Whoops im Abendlicht.',
    theme: 0, seed: 21, jumps: 18, h0: 120, h1: 230, mega: 320, v0: 520, v1: 600, doubleP: 0.3, rollerP: 0.3, stars: 2, ref: 110000 },
  { id: 'dome', name: 'Night Dome', blurb: 'Riesen-Rampen unter Flutlicht. Nur für echte Könige.',
    theme: 2, seed: 99, jumps: 24, h0: 150, h1: 300, mega: 420, v0: 560, v1: 660, doubleP: 0.4, rollerP: 0.25, stars: 3, ref: 180000 },
];

function mulberry32(a) {
  return () => {
    a |= 0; a = (a + 0x6D2B79F5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

const T = { h: [0], jumps: [], def: null, finishX: 1e9, par: 0, medals: { bronze: 0, silver: 0, gold: 0 } };
const speedTarget = (x) => {
  if (!T.def) return 500;
  return lerp(T.def.v0, T.def.v1, clamp((x - START_X) / Math.max(1, T.finishX - START_X), 0, 1));
};

function pushY(y) { T.h.push(y); }
function pushFlat(len) {
  const n = Math.round(len / STEP);
  for (let k = 0; k < n; k++) pushY(0);
}
function pushRollers(count, amp, wl) {
  const n = Math.round(wl / STEP);
  for (let c = 0; c < count; c++) {
    for (let k = 1; k <= n; k++) pushY(-amp * (0.5 - 0.5 * Math.cos(TAU * k / n)));
  }
}
function pushJump(H, ang, v) {
  const p = 1.7;
  const startX = (T.h.length - 1) * STEP;
  const Lu = H * p / Math.tan(ang);
  const n = Math.max(4, Math.round(Lu / STEP));
  for (let k = 1; k <= n; k++) pushY(-H * Math.pow(k / n, p));
  const lipX = (T.h.length - 1) * STEP;
  const vx = v * Math.cos(ang), vy = v * Math.sin(ang);
  const f = 0.6;
  const drop = 0.5 - 0.5 * Math.cos(Math.PI * f);
  const tAir = (vy + Math.sqrt(vy * vy + 2 * GRAV * H * drop)) / GRAV;
  const downLen = clamp(vx * tAir / f, 280, 1500);
  const m = Math.round(downLen / STEP);
  for (let k = 1; k <= m; k++) pushY(-H * (1 - (0.5 - 0.5 * Math.cos(Math.PI * k / m))));
  T.jumps.push({ x: lipX, y: -H, h: H, start: startX, air: tAir, v });
}

function buildTrack(def) {
  const rng = mulberry32(def.seed);
  const r = (a, b) => a + rng() * (b - a);
  T.h = [0]; T.jumps = []; T.def = def; T.finishX = 1e9;
  pushFlat(START_X);
  for (let i = 0; i < def.jumps; i++) {
    const f = def.jumps > 1 ? i / (def.jumps - 1) : 0;
    const v = lerp(def.v0, def.v1, f);
    if (i > 0 && rng() < def.rollerP) {
      pushRollers(Math.floor(r(3, 6)), r(9, 20), r(100, 150));
      pushFlat(r(260, 360));
    }
    const last = i === def.jumps - 1;
    const H = last ? def.mega : lerp(def.h0, def.h1, f) * r(0.9, 1.1);
    pushJump(H, last ? 0.9 : r(0.72, 0.86), v);
    if (!last && rng() < def.doubleP) {
      pushFlat(r(210, 270));
      pushJump(H * r(0.85, 1), r(0.72, 0.86), v);
    }
    pushFlat(r(320, 460));
  }
  pushFlat(500);
  T.finishX = (T.h.length - 1) * STEP;
  pushFlat(1000);   // Auslauf hinter dem Ziel
  T.par = def.ref;
  T.medals = {
    bronze: Math.round(def.ref * MEDAL_FRAC.bronze / 50) * 50,
    silver: Math.round(def.ref * MEDAL_FRAC.silver / 50) * 50,
    gold: Math.round(def.ref * MEDAL_FRAC.gold / 50) * 50,
  };
}
function trackById(id) { return TRACKS.find((t) => t.id === id) || TRACKS[0]; }
// Medaillen-Schwellen auch für Strecken, die gerade nicht geladen sind (Strecken-Auswahl)
const trackCache = {};
function trackInfo(def) {
  if (!trackCache[def.id]) {
    const keep = { h: T.h, jumps: T.jumps, def: T.def, finishX: T.finishX, par: T.par, medals: T.medals };
    buildTrack(def);
    trackCache[def.id] = { par: T.par, medals: T.medals, jumps: T.jumps.length, length: T.finishX };
    Object.assign(T, keep);
  }
  return trackCache[def.id];
}
function medalFor(score, def) {
  const m = trackInfo(def).medals;
  return score >= m.gold ? 3 : score >= m.silver ? 2 : score >= m.bronze ? 1 : 0;
}

function terrainY(x) {
  if (x <= 0) return 0;
  const f = x / STEP, i = f | 0;
  if (i + 1 >= T.h.length) return 0;
  const t = f - i;
  return T.h[i] * (1 - t) + T.h[i + 1] * t;
}
function slopeAt(x) { return (terrainY(x + 3) - terrainY(x - 3)) / 6; }

// ===================================================================
// Spielzustand
// ===================================================================
const input = { back: false, fwd: false, cancan: false, superman: false, nacnac: false, cliff: false };
const ai = { back: false, fwd: false, cancan: false, superman: false, nacnac: false, cliff: false, plan: null };
let trickOrder = [];

const game = {
  state: 'menu',      // menu | play | paused | over
  demo: true,
  score: 0, dispScore: 0, lives: LIVES, streak: 0,
  time: 0, timeScale: 1, slowT: 0,
  stats: null,
  shake: 0, flash: 0,
  newRecord: false,
  runEntry: null,
  trackId: 'arena', demoIdx: 0,
  finishing: false, finishT: 0, finishBonus: 0, cheer: 0,
};
const IDLE = { back: false, fwd: false, cancan: false, superman: false, nacnac: false, cliff: false };

const bike = {};
function newStats() {
  return { bestCombo: 0, maxAir: 0, flips: 0, tricks: 0, jumps: 0, perfect: 0, wheelie: 0, dist: 0 };
}

function placeBike(x) {
  Object.assign(bike, {
    mode: 'ground', px: x, x, y: 0, vx: 0, vy: 0, a: 0, w: 0,
    s: speedTarget(x) * 0.8, pitch: 0, pitchVel: 0, gAngle: 0, holdBack: 0,
    rot: 0, airT: 0, takeoffA: 0, wheelRot: 0, wheelW: 0, sus: 0, susVel: 0,
    groundT: 0.3, wheelieT: 0, dustT: 0, lean: 0, lipA: 0,
    tw: { cancan: 0, superman: 0, nacnac: 0, cliff: 0 },
    th: { cancan: 0, superman: 0, nacnac: 0, cliff: 0 },
    pred: { t: 0, x, slope: 0 }, crash: null, crashT: 0, flicker: 0,
  });
  solveGround(bike);
  const ang = Math.atan(slopeAt(bike.px));
  bike.vx = Math.cos(ang) * bike.s;
  bike.vy = Math.sin(ang) * bike.s;
  bike.mvx = bike.vx; bike.mvy = bike.vy;
}

function findSafeSpot(fromX) {
  for (let x = Math.max(fromX, 200); x < fromX + 6000; x += 24) {
    let ok = true;
    for (let k = -4; k <= 4; k++) {
      if (Math.abs(terrainY(x + k * 30)) > 1.5 || Math.abs(slopeAt(x + k * 30)) > 0.02) { ok = false; break; }
    }
    if (ok) return x;
  }
  return fromX;
}

// ----------------------------------------------------------------------
// Geometrie am Boden
// ----------------------------------------------------------------------
function wheelCenter(xw) {
  const sl = slopeAt(xw);
  return { x: xw, y: terrainY(xw) - RW * Math.sqrt(1 + sl * sl) };
}
function solveGround(b) {
  let a = b.gAngle || 0, cr, cf;
  for (let i = 0; i < 3; i++) {
    const c = Math.cos(a) * WB / 2;
    cr = wheelCenter(b.px - c);
    cf = wheelCenter(b.px + c);
    a = Math.atan2(cf.y - cr.y, cf.x - cr.x);
  }
  b.gAngle = a;
  const ang = a + b.pitch;
  if (b.pitch < 0) {
    b.x = cr.x + Math.cos(ang) * WB / 2;
    b.y = cr.y + Math.sin(ang) * WB / 2;
  } else {
    b.x = (cr.x + cf.x) / 2;
    b.y = (cr.y + cf.y) / 2;
  }
  b.a = ang;
}

function predictLanding(b) {
  let x = b.x, y = b.y, vy = b.vy;
  const vx = b.vx, dt = 0.03;
  for (let t = 0; t < 3.5; t += dt) {
    vy += GRAV * dt; x += vx * dt; y += vy * dt;
    if (y + RW * 1.1 >= terrainY(x)) return { t: t + dt, x, slope: slopeAt(x) };
  }
  return { t: 3.5, x, slope: slopeAt(x) };
}

// ===================================================================
// Partikel, Popups
// ===================================================================
const parts = [];
const popups = [];
function emit(o) {
  parts.push(Object.assign({ life: 1, max: 1, size: 3, g: 0, drag: 0, type: 'dot', rot: 0, vr: 0, color: '#fff', vx: 0, vy: 0 }, o));
  if (parts.length > 700) parts.shift();
}
function emitDirt(x, y, vx, vy, n, big) {
  for (let i = 0; i < n; i++) {
    const dirt = Math.random() < 0.6;
    emit({
      type: dirt ? 'dirt' : 'dust',
      x: x + rand(-6, 6), y: y + rand(-3, 1),
      vx: vx * rand(0.05, 0.3) + rand(-60, 60) * (big ? 2 : 1),
      vy: vy - rand(60, big ? 380 : 220),
      g: dirt ? 900 : -20, drag: dirt ? 0.4 : 1.8,
      life: rand(0.35, big ? 1 : 0.7), max: 1, size: dirt ? rand(1.5, 3.8) : rand(6, big ? 22 : 14),
      color: dirt ? rgb(mixc(pal.dirtTop, pal.dirtBot, Math.random() * 0.6)) : rgb(mixc(pal.dirtTop, [255, 255, 255], 0.45), 1),
    });
  }
}
function emitConfetti(x, y, n) {
  const cols = ['#ff2e93', '#ffd23f', '#19e3ff', '#9dff3a', '#ff6a00', '#ffffff'];
  for (let i = 0; i < n; i++) {
    emit({
      type: 'confetti', x, y, vx: rand(-260, 260), vy: -rand(150, 520), g: 520, drag: 0.8,
      life: rand(1, 1.8), max: 1.8, size: rand(3, 6), rot: rand(0, TAU), vr: rand(-12, 12), color: cols[i % cols.length],
    });
  }
}
function emitSparks(x, y, n) {
  for (let i = 0; i < n; i++) {
    const a = rand(0, TAU), v = rand(120, 480);
    emit({ type: 'spark', x, y, vx: Math.cos(a) * v, vy: Math.sin(a) * v - 120, g: 800, drag: 0.5, life: rand(0.25, 0.7), max: 0.7, size: rand(1.5, 2.6), color: Math.random() < 0.5 ? '#ffd23f' : '#ff7a1a' });
  }
}
function popup(text, color, size, x, y, delay = 0) {
  popups.push({ text, color, size, x, y, life: 1.6 + delay, max: 1.6, delay, vy: -46 });
}
function updateParticles(dt) {
  for (let i = parts.length - 1; i >= 0; i--) {
    const p = parts[i];
    p.life -= dt;
    if (p.life <= 0) { parts[i] = parts[parts.length - 1]; parts.pop(); continue; }
    p.vy += p.g * dt;
    const d = Math.max(0, 1 - p.drag * dt);
    p.vx *= d; p.vy *= (p.type === 'dust' ? d : 1);
    p.x += p.vx * dt; p.y += p.vy * dt;
    p.rot += p.vr * dt;
    if (p.type === 'dirt' || p.type === 'confetti') {
      const gy = terrainY(p.x);
      if (p.y > gy) { p.y = gy; p.vy *= -0.3; p.vx *= 0.6; p.vr *= 0.5; }
    }
  }
  for (let i = popups.length - 1; i >= 0; i--) {
    const p = popups[i];
    if (p.delay > 0) { p.delay -= dt; continue; }
    p.life -= dt; p.y += p.vy * dt; p.vy *= 0.97;
    if (p.life <= 0) popups.splice(i, 1);
  }
}

// ===================================================================
// Pose / Fahrer
// ===================================================================
const POSE_KEYS = ['hipx', 'hipy', 'shx', 'shy', 'hnx', 'hny', 'hfx', 'hfy', 'fnx', 'fny', 'ffx', 'ffy', 'knx', 'kny', 'enx', 'eny'];
const mkPose = (a) => Object.fromEntries(POSE_KEYS.map((k, i) => [k, a[i]]));
const POSES = {
  neutral:  mkPose([-15, -38,  -3, -67,   17, -56,   17, -56,   -2, -10,   -3, -10,   1, 0,   0, -1]),
  superman: mkPose([-42, -46, -10, -62,   17, -56,   17, -56,  -96, -54,  -94, -48,   0, 1,   0, -1]),
  cancan:   mkPose([-15, -38,   0, -66,   17, -56,   17, -56,   16, -66,   -3, -10,   0.4, -1,   0, -1]),
  nacnac:   mkPose([-13, -38,   2, -65,   17, -56,   17, -56,  -62, -58,   -3, -10,   -0.3, -1,   0, -1]),
  cliff:    mkPose([-24, -36, -12, -66,   17, -56,   17, -56,   18, -62,   20, -57,   1, -0.3,   0, -1]),
};
function computePose(tw, lean) {
  let sum = 0;
  for (const k of TRICK_KEYS) sum += tw[k];
  sum = Math.min(1, sum);
  const P = {};
  for (const k of POSE_KEYS) {
    let v = POSES.neutral[k] * (1 - sum);
    if (sum > 0) {
      const tot = TRICK_KEYS.reduce((s, t) => s + tw[t], 0);
      for (const t of TRICK_KEYS) v += POSES[t][k] * (tw[t] / tot) * sum;
    }
    P[k] = v;
  }
  P.shx += lean * 6; P.hipx += lean * 3;
  return P;
}
function ik(ax, ay, tx, ty, l1, l2, hx, hy) {
  let dx = tx - ax, dy = ty - ay;
  let d = Math.hypot(dx, dy) || 0.001;
  const maxd = l1 + l2 - 0.6;
  let ex = tx, ey = ty;
  if (d > maxd) { const k = maxd / d; dx *= k; dy *= k; ex = ax + dx; ey = ay + dy; d = maxd; }
  const a = (l1 * l1 - l2 * l2 + d * d) / (2 * d);
  const h = Math.sqrt(Math.max(0, l1 * l1 - a * a));
  const ux = dx / d, uy = dy / d;
  const mx = ax + ux * a, my = ay + uy * a;
  const side = (-uy * hx + ux * hy) >= 0 ? 1 : -1;
  return { k: [mx - uy * h * side, my + ux * h * side], e: [ex, ey] };
}
function solvePose(P, sy) {
  const hip = [P.hipx, P.hipy + sy], sh = [P.shx, P.shy + sy];
  const tl = Math.hypot(sh[0] - hip[0], sh[1] - hip[1]) || 1;
  const tx = (sh[0] - hip[0]) / tl, ty = (sh[1] - hip[1]) / tl;
  // Arm-Ansatz etwas unterhalb des Torso-Endes, damit der Helm den Arm nicht verdeckt
  const root = [sh[0] - tx * 6, sh[1] - ty * 6];
  const legN = ik(hip[0], hip[1], P.fnx, P.fny + sy * 0.5, 24, 26, P.knx, P.kny);
  const legF = ik(hip[0], hip[1], P.ffx, P.ffy + sy * 0.5, 24, 26, P.knx, P.kny);
  const armN = ik(root[0], root[1], P.hnx, P.hny + sy, 17, 18, P.enx, P.eny);
  const armF = ik(root[0], root[1], P.hfx, P.hfy + sy, 17, 18, P.enx, P.eny);
  const head = [sh[0] + tx * 15 + 4, sh[1] + ty * 15 - 1];
  return { hip, sh, root, head, legN, legF, armN, armF, tilt: Math.atan2(tx, -ty) };
}

const COL = {
  bike: '#ff6a00', bikeDark: '#c24300', black: '#14141c', metal: '#c8ccd6', gold: '#e0ac3a',
  jersey: '#2a7bff', jerseyDark: '#1a4fbd', pants: '#17171f', boot: '#eceef4', glove: '#ffd23f',
  helmet: '#ffffff', stripe: '#ff2e93', outline: '#0b0b14',
};

function limb(c, pts, w, color, outline) {
  c.lineCap = 'round'; c.lineJoin = 'round';
  c.beginPath(); c.moveTo(pts[0][0], pts[0][1]);
  for (let i = 1; i < pts.length; i++) c.lineTo(pts[i][0], pts[i][1]);
  c.strokeStyle = COL.outline; c.lineWidth = w + 4; c.stroke();
  c.strokeStyle = color; c.lineWidth = w; c.stroke();
}
function drawLeg(c, hip, leg, far) {
  const pts = [hip, leg.k, leg.e];
  limb(c, pts, 11, far ? '#0e0e14' : COL.pants);
  // Stiefel
  const dx = leg.e[0] - leg.k[0], dy = leg.e[1] - leg.k[1];
  const l = Math.hypot(dx, dy) || 1;
  const bx = leg.e[0] - dx / l * 9, by = leg.e[1] - dy / l * 9;
  limb(c, [[bx, by], [leg.e[0], leg.e[1]]], 10, far ? '#9a9ca8' : COL.boot);
  limb(c, [[leg.e[0], leg.e[1] + 1], [leg.e[0] + 8, leg.e[1] + 3]], 8, far ? '#9a9ca8' : COL.boot);
  if (!far) { // Knieschützer
    c.fillStyle = '#2b2b38'; c.beginPath(); c.arc(leg.k[0], leg.k[1], 5.5, 0, TAU); c.fill();
  }
}
function drawArm(c, sh, arm, far) {
  const up = far ? '#1b46a8' : COL.jersey, fo = far ? '#16358a' : '#1c5fe0';
  c.lineCap = 'round'; c.lineJoin = 'round';
  // Kontur beider Segmente zuerst, damit sich am Ellbogen keine Linien kreuzen
  c.strokeStyle = COL.outline;
  c.lineWidth = 14; c.beginPath(); c.moveTo(sh[0], sh[1]); c.lineTo(arm.k[0], arm.k[1]); c.stroke();
  c.lineWidth = 12.5; c.beginPath(); c.moveTo(arm.k[0], arm.k[1]); c.lineTo(arm.e[0], arm.e[1]); c.stroke();
  c.strokeStyle = up; c.lineWidth = 10;
  c.beginPath(); c.moveTo(sh[0], sh[1]); c.lineTo(arm.k[0], arm.k[1]); c.stroke();
  c.strokeStyle = fo; c.lineWidth = 8.5;
  c.beginPath(); c.moveTo(arm.k[0], arm.k[1]); c.lineTo(arm.e[0], arm.e[1]); c.stroke();
  if (!far) { // helle Naht am Oberarm + Ellbogenschuetzer
    c.strokeStyle = 'rgba(255,255,255,.55)'; c.lineWidth = 2;
    c.beginPath(); c.moveTo(sh[0], sh[1]); c.lineTo((sh[0] + arm.k[0]) / 2, (sh[1] + arm.k[1]) / 2); c.stroke();
  }
  c.fillStyle = far ? '#14141c' : '#262633';
  c.beginPath(); c.arc(arm.k[0], arm.k[1], 4.8, 0, TAU); c.fill();
  // Handschuh: Manschette + Faust um den Griff
  const ang = Math.atan2(arm.e[1] - arm.k[1], arm.e[0] - arm.k[0]);
  c.save(); c.translate(arm.e[0], arm.e[1]); c.rotate(ang);
  c.fillStyle = COL.outline; c.beginPath(); c.ellipse(1, 0, 8, 6.4, 0, 0, TAU); c.fill();
  c.fillStyle = far ? '#c9a52a' : COL.glove; c.beginPath(); c.ellipse(1.5, 0, 6.6, 5, 0, 0, TAU); c.fill();
  c.fillStyle = '#ffffff'; c.fillRect(-6, -4.6, 3, 9.2); // Manschette
  c.restore();
}
function drawTorso(c, J) {
  limb(c, [J.hip, J.sh], 15, COL.jersey);
  // Streifen
  c.lineCap = 'round';
  c.strokeStyle = '#ffffff'; c.lineWidth = 3;
  const mx = (J.hip[0] + J.sh[0]) / 2, my = (J.hip[1] + J.sh[1]) / 2;
  const ux = J.sh[0] - J.hip[0], uy = J.sh[1] - J.hip[1], ul = Math.hypot(ux, uy) || 1;
  c.beginPath();
  c.moveTo(mx - uy / ul * 5, my + ux / ul * 5); c.lineTo(mx + uy / ul * 5, my - ux / ul * 5);
  c.stroke();
  // Hüfte + Schulter
  c.fillStyle = COL.pants; c.beginPath(); c.arc(J.hip[0], J.hip[1], 8, 0, TAU); c.fill();
  c.fillStyle = COL.jersey; c.beginPath(); c.arc(J.sh[0], J.sh[1], 7.5, 0, TAU); c.fill();
}
function drawHelmet(c, J) {
  c.save();
  c.translate(J.head[0], J.head[1]);
  c.rotate(clamp(J.tilt * 0.35, -0.5, 0.6));
  // Schale
  c.fillStyle = COL.outline; c.beginPath(); c.arc(0, 0, 12.8, 0, TAU); c.fill();
  c.fillStyle = COL.helmet; c.beginPath(); c.arc(0, 0, 11, 0, TAU); c.fill();
  // Streifen
  c.strokeStyle = COL.stripe; c.lineWidth = 3.4;
  c.beginPath(); c.arc(0, 0, 8.4, Math.PI * 1.05, Math.PI * 1.75); c.stroke();
  // Kinnbügel
  c.fillStyle = COL.outline;
  c.beginPath(); c.moveTo(3, 3); c.lineTo(14.5, 3.5); c.quadraticCurveTo(16, 9, 8, 10); c.lineTo(2, 8); c.closePath(); c.fill();
  c.fillStyle = '#e8e8f0';
  c.beginPath(); c.moveTo(4, 4); c.lineTo(13, 4.5); c.quadraticCurveTo(14, 8, 8, 8.5); c.lineTo(3.5, 7); c.closePath(); c.fill();
  // Brille
  c.fillStyle = COL.outline;
  c.beginPath(); c.roundRect ? c.roundRect(1.5, -6.5, 13, 9.5, 3) : c.rect(1.5, -6.5, 13, 9.5); c.fill();
  const g = c.createLinearGradient(0, -5, 0, 1.5);
  g.addColorStop(0, '#7df4ff'); g.addColorStop(1, '#1b8cff');
  c.fillStyle = g;
  c.beginPath(); c.roundRect ? c.roundRect(3, -5, 10, 6.4, 2) : c.rect(3, -5, 10, 6.4); c.fill();
  c.fillStyle = 'rgba(255,255,255,.7)'; c.fillRect(4.5, -4.2, 3.5, 1.4);
  // Schirm
  c.fillStyle = COL.bike;
  c.beginPath(); c.moveTo(-2, -10.5); c.lineTo(15, -9); c.quadraticCurveTo(18, -8, 16, -6); c.lineTo(0, -7.5); c.closePath(); c.fill();
  c.restore();
}

function drawWheel(c, x, y, rot) {
  c.save();
  c.translate(x, y);
  c.fillStyle = '#0d0d12'; c.beginPath(); c.arc(0, 0, RW, 0, TAU); c.fill();
  c.save(); c.rotate(rot); c.fillStyle = '#2a2a36';
  for (let i = 0; i < 20; i++) { c.rotate(TAU / 20); c.fillRect(RW - 3.4, -2.3, 4.4, 4.6); }
  c.restore();
  c.strokeStyle = '#3a3a4a'; c.lineWidth = 1.5; c.beginPath(); c.arc(0, 0, RW - 5, 0, TAU); c.stroke();
  c.strokeStyle = COL.gold; c.lineWidth = 3; c.beginPath(); c.arc(0, 0, RW - 8.5, 0, TAU); c.stroke();
  c.save(); c.rotate(rot); c.strokeStyle = '#d6d8e2'; c.lineWidth = 1;
  c.beginPath();
  for (let i = 0; i < 8; i++) { const a = i * TAU / 8; c.moveTo(Math.cos(a) * 3, Math.sin(a) * 3); c.lineTo(Math.cos(a) * (RW - 9), Math.sin(a) * (RW - 9)); }
  c.stroke(); c.restore();
  c.fillStyle = '#e4e6ee'; c.beginPath(); c.arc(0, 0, 3.6, 0, TAU); c.fill();
  c.restore();
}

function poly(c, pts, fill, stroke, lw) {
  c.beginPath(); c.moveTo(pts[0][0], pts[0][1]);
  for (let i = 1; i < pts.length; i++) c.lineTo(pts[i][0], pts[i][1]);
  c.closePath();
  if (fill) { c.fillStyle = fill; c.fill(); }
  if (stroke) { c.strokeStyle = stroke; c.lineWidth = lw || 2; c.lineJoin = 'round'; c.stroke(); }
}

function drawBikeBody(c, b) {
  const s = b.sus;
  const hx = WB / 2;
  // Schwinge
  limb(c, [[-hx, 0], [-12, -10 + s * 0.5]], 5, '#555a68');
  // Auspuff
  c.lineCap = 'round';
  c.beginPath(); c.moveTo(6, -14 + s); c.bezierCurveTo(-12, -12 + s, -30, -14 + s, -50, -22 + s * 0.6);
  c.strokeStyle = COL.outline; c.lineWidth = 8; c.stroke();
  c.strokeStyle = COL.metal; c.lineWidth = 5; c.stroke();
  c.fillStyle = '#6a6e7c'; c.beginPath(); c.arc(-50, -22 + s * 0.6, 3.4, 0, TAU); c.fill();
  // Motor
  poly(c, [[-16, -26 + s], [10, -28 + s], [18, -8 + s * 0.5], [-10, -4 + s * 0.4]], '#2b2c38', COL.outline, 2);
  poly(c, [[-2, -34 + s], [10, -36 + s], [12, -26 + s], [-2, -25 + s]], COL.metal, COL.outline, 1.5);
  c.fillStyle = '#4a4d5c'; c.beginPath(); c.arc(0, -14 + s * 0.6, 6, 0, TAU); c.fill();
  c.fillStyle = '#7b7f90'; c.beginPath(); c.arc(0, -14 + s * 0.6, 2.6, 0, TAU); c.fill();
  // Heck
  poly(c, [[-56, -33 + s], [-36, -39 + s], [-14, -38 + s], [-4, -31 + s], [-8, -22 + s], [-36, -24 + s], [-54, -27 + s]], COL.bike, COL.outline, 2);
  poly(c, [[-36, -39 + s], [-12, -39 + s], [-5, -34 + s], [-36, -34 + s]], '#1b1b25', null);
  c.strokeStyle = 'rgba(255,255,255,.75)'; c.lineWidth = 2;
  c.beginPath(); c.moveTo(-50, -30 + s); c.lineTo(-20, -30 + s); c.stroke();
  // Tank
  poly(c, [[-6, -34 + s], [4, -43 + s], [22, -43 + s], [31, -33 + s], [18, -26 + s], [-4, -26 + s]], COL.bike, COL.outline, 2);
  poly(c, [[6, -41 + s], [20, -41 + s], [24, -36 + s], [8, -36 + s]], 'rgba(255,255,255,.28)', null);
  // Gabel
  const head = [27, -42 + s];
  limb(c, [[hx, 0], head], 5, COL.metal);
  limb(c, [[hx - 1, -2], [head[0] - 2, head[1] + 14]], 7, COL.gold);
  // Kotflügel vorn
  c.strokeStyle = COL.outline; c.lineWidth = 7; c.lineCap = 'round';
  c.beginPath(); c.arc(hx, 0, RW + 4, Math.PI * 1.1, Math.PI * 1.62); c.stroke();
  c.strokeStyle = COL.bike; c.lineWidth = 4;
  c.beginPath(); c.arc(hx, 0, RW + 4, Math.PI * 1.1, Math.PI * 1.62); c.stroke();
  // Startnummer-Tafel
  c.save(); c.translate(32, -47 + s); c.rotate(0.18);
  poly(c, [[-8, -9], [8, -10], [10, 7], [-8, 8]], '#ffffff', COL.outline, 2);
  c.fillStyle = '#111'; c.font = '900 14px Arial Black, Arial, sans-serif'; c.textAlign = 'center'; c.textBaseline = 'middle';
  c.fillText('7', 1, 0);
  c.restore();
  // Lenker
  limb(c, [[22, -45 + s], [16, -57 + s]], 3.4, '#22222c');
  c.fillStyle = '#111'; c.beginPath(); c.arc(16, -57 + s, 3, 0, TAU); c.fill();
  // Fußraste
  c.fillStyle = '#444858'; c.fillRect(-6, -10 + s * 0.5, 9, 3);
}

function drawMoto(c, b) {
  const P = computePose(b.tw, b.lean);
  const J = solvePose(P, b.sus);
  drawWheel(c, -WB / 2, 0, b.wheelRot);
  drawWheel(c, WB / 2, 0, b.wheelRot);
  drawLeg(c, J.hip, J.legF, true);
  drawArm(c, J.root, J.armF, true);
  drawBikeBody(c, b);
  drawTorso(c, J);
  drawLeg(c, J.hip, J.legN, false);
  drawArm(c, J.root, J.armN, false);
  drawHelmet(c, J);
}
function drawRagdollRider(c, t, spin) {
  const P = computePose({ cancan: 0, superman: 0, nacnac: 0, cliff: 0 }, 0);
  P.fnx += Math.sin(t * 11) * 16; P.fny += Math.cos(t * 9) * 12 - 10;
  P.ffx += Math.cos(t * 10) * 16; P.ffy += Math.sin(t * 12) * 12 - 10;
  P.hnx += Math.sin(t * 13) * 14; P.hny += Math.cos(t * 11) * 10 - 8;
  P.hfx += Math.cos(t * 12) * 14; P.hfy += Math.sin(t * 10) * 10 - 8;
  const J = solvePose(P, 0);
  drawLeg(c, J.hip, J.legF, true);
  drawArm(c, J.root, J.armF, true);
  drawTorso(c, J);
  drawLeg(c, J.hip, J.legN, false);
  drawArm(c, J.root, J.armN, false);
  drawHelmet(c, J);
}
function drawCrashedBike(c, t) {
  const b = { sus: 0, wheelRot: t * 6 };
  drawWheel(c, -WB / 2, 0, b.wheelRot);
  drawWheel(c, WB / 2, 0, b.wheelRot);
  drawBikeBody(c, b);
}

// ===================================================================
// Physik / Spiel-Logik
// ===================================================================
function activeTrick(I) {
  for (let i = trickOrder.length - 1; i >= 0; i--) if (I[trickOrder[i]]) return trickOrder[i];
  return null;
}
function poseWeight(b) {
  let s = 0;
  for (const k of TRICK_KEYS) s += b.tw[k];
  return s;
}
function flipTurns(b, slopeAng) {
  return (b.takeoffA + b.rot - slopeAng) / TAU;
}
function flipCount(b, slopeAng) {
  const t = flipTurns(b, slopeAng);
  return Math.sign(t) * Math.floor(Math.abs(t) + 0.18);
}
function comboItems(b, slopeAng) {
  const items = [];
  for (const k of TRICK_KEYS) if (b.th[k] >= 0.3) items.push({ name: TRICKS[k].name, pts: TRICKS[k].pts, key: k });
  const n = flipCount(b, slopeAng);
  if (n !== 0) { const f = flipInfo(Math.abs(n), n); items.push({ name: f.name, pts: f.pts, flip: n }); }
  return items;
}
const comboMult = (n) => (n <= 1 ? 1 : 1 + 0.5 * (n - 1));
const streakMult = () => 1 + 0.1 * Math.min(game.streak, 10);

function takeoff(b, xBall, yBall) {
  b.mode = 'air';
  b.x = xBall; b.y = yBall;
  b.vy += GRAV * FIXED_DT;
  b.w = b.pitchVel;
  b.airT = 0; b.rot = 0; b.takeoffA = b.a;
  b.th = { cancan: 0, superman: 0, nacnac: 0, cliff: 0 };
  b.maxH = 0;
  ai.plan = null;
  if (b.wheelieT >= 1 && !game.demo) {
    const pts = Math.round(b.wheelieT * 30);
    popup('WHEELIE ' + b.wheelieT.toFixed(1) + 's  +' + pts, '#ffd23f', 22, b.x, b.y - 90);
  }
  b.wheelieT = 0;
  if (!game.demo) { if (b.vy < -150) emitDirt(b.x - 40, terrainY(b.x - 40), b.vx, 0, 8, true); }
}

function crash(b, reason) {
  if (b.mode === 'crash') return;
  const demo = game.demo;
  const vx = b.vx, vy = b.vy;
  b.mode = 'crash'; b.crashT = 0;
  b.crash = {
    bike: { x: b.x, y: b.y, vx: vx * 0.9, vy: vy * 0.9 - 80, a: b.a, w: rand(-6, 6) },
    rider: { x: b.x - 6, y: b.y - 40, vx: vx * 1.1 + rand(-60, 120), vy: vy - rand(150, 380), a: b.a, w: rand(-10, 10) },
    reason,
  };
  for (const k of TRICK_KEYS) b.tw[k] = 0;
  if (!demo) {
    game.lives--;
    game.streak = 0;
    game.shake = 1; game.slowT = 0.9;
    game.flash = 0.5;
    popup(reason, '#ff3b3b', 34, b.x, b.y - 100);
    sfx.crash();
    if (navigator.vibrate) navigator.vibrate([60, 40, 120]);
    emitSparks(b.x, b.y, 24);
    emitDirt(b.x, terrainY(b.x), vx, 0, 26, true);
    updateHud(true);
  }
}

function land(b) {
  const sl = slopeAt(b.x);
  const gA = Math.atan(sl);
  const d = normAngle(b.a - gA);
  const poseW = poseWeight(b);
  const sq = Math.sqrt(1 + sl * sl);
  const tx = 1 / sq, ty = sl / sq;
  const nx = sl / sq, ny = -1 / sq;
  const vt = b.vx * tx + b.vy * ty;
  const impact = -(b.vx * nx + b.vy * ny);

  if (Math.abs(d) > CRASH_ANGLE) return crash(b, 'BAD LANDING!');
  if (poseW > 0.55) return crash(b, 'TRICK NICHT BEENDET!');

  // sauber gelandet -> Auswertung
  const flips = flipCount(b, gA);
  const items = [];
  for (const k of TRICK_KEYS) if (b.th[k] >= 0.3) items.push({ name: TRICKS[k].name, pts: TRICKS[k].pts });
  if (flips !== 0) { const f = flipInfo(Math.abs(flips), flips); items.push({ name: f.name, pts: f.pts }); }

  const perfect = Math.abs(d) < PERFECT_ANGLE;
  const sloppy = Math.abs(d) > SLOPPY_ANGLE;
  const airT = b.airT;
  const px = b.x, py = b.y;

  b.mode = 'ground';
  b.px = b.x;
  b.s = Math.max(vt * (1 - 0.2 * clamp(Math.abs(d) / 0.9, 0, 1)), 220);
  b.pitch = clamp(d, -0.9, 0.9);
  b.pitchVel = 0;
  b.gAngle = gA;
  b.groundT = 0;
  b.susVel += clamp(impact * 0.18, 0, 160);
  b.holdBack = 0;
  solveGround(b);
  b.vx = b.s * Math.cos(gA); b.vy = b.s * Math.sin(gA);
  b.mvx = b.vx; b.mvy = b.vy;

  game.lastLand = { d, flips, n: items.length, perfect, sloppy, airT, impact };
  const demo = game.demo;
  if (!demo) {
    sfx.land(impact);
    if (navigator.vibrate) navigator.vibrate(impact > 400 ? 30 : 12);
    game.shake = Math.max(game.shake, clamp(impact / 700, 0.15, 0.8));
    if (airT > 0.55) game.stats.jumps++;
    game.stats.maxAir = Math.max(game.stats.maxAir, airT);
  }
  emitDirt(px, terrainY(px), b.vx, 0, demo ? 6 : clamp(Math.round(impact / 25), 6, 22), impact > 350);

  if (items.length) {
    game.cheer = Math.min(1.6, game.cheer + 0.6);
    if (!game.demo) sfx.crowd();
    const mult = comboMult(items.length);
    let base = 0;
    for (const it of items) base += it.pts;
    let total = base * mult;
    const air = airT > 0.7 ? Math.round(airT * 60) : 0;
    total += air;
    if (perfect) total *= 1.25;
    else if (sloppy) total *= 0.85;
    if (perfect) game.streak++; else if (sloppy) game.streak = 0;
    total *= streakMult();
    total = Math.round(total / 10) * 10;
    if (!demo) {
      game.score += total;
      game.stats.bestCombo = Math.max(game.stats.bestCombo, total);
      game.stats.tricks += items.length;
      game.stats.flips += Math.abs(flips);
      if (perfect) game.stats.perfect++;
      items.forEach((it, i) => popup(it.name.toUpperCase() + '  +' + it.pts, i % 2 ? '#19e3ff' : '#ffd23f', 20, px - 20, py - 70 - i * 26, i * 0.08));
      if (items.length > 1) popup('COMBO ×' + mult.toFixed(1), '#9dff3a', 24, px, py - 70 - items.length * 26 - 8, items.length * 0.08);
      popup('+' + fmt(total), '#ffffff', 40 + Math.min(16, total / 400), px, py - 70 - items.length * 26 - 44, items.length * 0.08 + 0.1);
      if (perfect) popup('PERFECT LANDING!', '#ff2e93', 22, px, py - 40, 0.1);
      if (sloppy) popup('wacklig…', '#ff9f5a', 16, px, py - 40, 0.1);
      emitConfetti(px, py - 30, perfect ? 46 : 22);
      if (perfect) { sfx.perfect(); game.flash = 0.25; }
      sfx.score(items.length + (flips ? 2 : 0));
      popScore();
    }
  }
  ai.plan = null;
  updateHud(true);
}

function stepGround(b, dt, I) {
  b.groundT += dt;
  const sl = slopeAt(b.px), ang = Math.atan(sl);
  const done = game.finishing && !game.demo;
  const target = done ? 0 : speedTarget(b.px);
  b.s += (-GRAV * Math.sin(ang) * 0.3 + (target - b.s) * (done ? 1.2 : 1.8)) * dt;
  b.s = clamp(b.s, done ? 0 : 150, 1000);

  // Wheelie-Steuerung
  if (I.back) b.holdBack += dt; else b.holdBack = Math.max(0, b.holdBack - dt * 2);
  let tp = 0;
  if (I.back) tp = -0.5 - 0.2 * b.holdBack;
  else if (I.fwd) tp = 0.06;
  b.pitchVel += ((tp - b.pitch) * 70 - b.pitchVel * 12) * dt;
  b.pitch += b.pitchVel * dt;
  if (b.pitch > 0.35) b.pitch = 0.35;
  if (b.pitch < -1.32) { crash(b, 'ÜBERSCHLAG!'); return; }
  if (b.pitch < -0.3 && I.back) {
    b.wheelieT += dt;
    if (!game.demo) { game.score += 30 * dt; game.stats.wheelie += dt; }
  } else if (b.wheelieT > 0) {
    if (b.wheelieT >= 1 && !game.demo) popup('WHEELIE ' + b.wheelieT.toFixed(1) + 's  +' + Math.round(b.wheelieT * 30), '#ffd23f', 22, b.x, b.y - 90);
    b.wheelieT = 0;
  }

  const ox = b.x, oy = b.y, ovx = b.mvx, ovy = b.mvy;
  b.px += b.s * Math.cos(ang) * dt;
  solveGround(b);
  const a2 = Math.atan(slopeAt(b.px));
  b.vx = b.s * Math.cos(a2); b.vy = b.s * Math.sin(a2);
  b.mvx = (b.x - ox) / dt; b.mvy = (b.y - oy) / dt;
  b.wheelRot += (b.s / RW) * dt;

  // Absprung? (Bodenbahn kruemmt sich staerker weg als die Wurfparabel)
  const yBall = oy + ovy * dt + 0.5 * GRAV * dt * dt;
  const xBall = ox + ovx * dt;
  // Steilste Steigung, die das Vorderrad gerade verlassen hat (bestimmt die Absprungrichtung)
  const sf = Math.atan(slopeAt(b.x + Math.cos(b.a) * WB / 2));
  b.lipA = Math.min(sf, (b.lipA || 0) + 4 * dt);
  if (b.groundT > 0.05 && yBall < b.y - 0.6) {
    // Absprung entlang der Rampenkante (nicht entlang der gemittelten Radmitten-Bahn)
    const mAng = Math.atan2(ovy, ovx);
    const la = Math.min(mAng, b.lipA * 0.92);
    const spd = Math.max(b.s, Math.hypot(ovx, ovy)) * 0.99;
    b.vx = spd * Math.cos(la); b.vy = spd * Math.sin(la);
    takeoff(b, xBall, yBall);
    return;
  }

  // Staub
  b.dustT -= dt;
  if (b.dustT <= 0 && b.s > 200) {
    b.dustT = 0.02;
    const rx = b.x - Math.cos(b.a) * WB / 2, ry = terrainY(rx);
    emitDirt(rx, ry, -b.s, 0, 1, false);
  }
}

function stepAir(b, dt, I) {
  b.airT += dt;
  b.vy += GRAV * dt;
  b.x += b.vx * dt;
  b.y += b.vy * dt;
  b.wheelRot += (b.s / RW) * dt;
  b.s *= 1 - 0.25 * dt;
  b.maxH = Math.max(b.maxH, terrainY(b.x) - b.y);

  const inp = (I.fwd ? 1 : 0) - (I.back ? 1 : 0);
  if (inp !== 0) {
    const tw = inp * 7.6;
    b.w += (tw - b.w) * Math.min(1, dt * 7);
  } else {
    const slope = b.pred.slope;
    const tgt = Math.atan2(b.vy, b.vx) * 0.6 + Math.atan(slope) * 0.4;
    const diff = normAngle(tgt - b.a);
    if (Math.abs(diff) < 1.3) b.w += (14 * diff - 5.5 * b.w) * dt;
    else b.w *= 1 - 0.4 * dt;
  }
  b.a += b.w * dt;
  b.rot += b.w * dt;

  // Tricks
  const act = activeTrick(I);
  for (const k of TRICK_KEYS) {
    const target = (act === k && b.airT > 0.1) ? 1 : 0;
    b.tw[k] += (target - b.tw[k]) * Math.min(1, dt * 12);
    if (act === k && b.tw[k] > 0.7) b.th[k] += dt;
  }

  // Landung?
  if (b.airT > 0.06) {
    const c = Math.cos(b.a), s = Math.sin(b.a), h = WB / 2;
    const rx = b.x - c * h, ry = b.y - s * h, fx = b.x + c * h, fy = b.y + s * h;
    const slR = slopeAt(rx), slF = slopeAt(fx);
    const penR = ry + RW * Math.sqrt(1 + slR * slR) - terrainY(rx);
    const penF = fy + RW * Math.sqrt(1 + slF * slF) - terrainY(fx);
    // Kopf trifft Boden -> Crash
    const headX = b.x - 2 * c + 80 * s, headY = b.y - 2 * s - 80 * c;
    if (headY > terrainY(headX) - 4) return crash(b, 'KOPF VORAN!');
    if (penR >= 0 || penF >= 0) {
      // Rad berührt den Boden: nur "landen", wenn wir uns auf den Boden zubewegen.
      // Beim Absprung (Rad dreht sich in die Rampe) schieben wir das Bike nur nach oben.
      const useR = penR >= penF;
      const sl = useR ? slR : slF;
      const sq = Math.sqrt(1 + sl * sl);
      const approach = -(b.vx * sl / sq - b.vy / sq);
      if (b.airT > 0.06 && approach > 25) land(b);
      else b.y -= Math.max(penR, penF);
    }
  }
}

function stepCrash(b, dt) {
  b.crashT += dt;
  const C = b.crash;
  for (const part of [C.bike, C.rider]) {
    part.vy += GRAV * 1.3 * dt;
    part.x += part.vx * dt; part.y += part.vy * dt;
    part.a += part.w * dt;
    const r = part === C.bike ? 22 : 18;
    const gy = terrainY(part.x);
    if (part.y + r > gy) {
      part.y = gy - r;
      if (part.vy > 70) {
        part.vy *= -0.35; part.vx *= 0.72; part.w *= 0.7;
        emitDirt(part.x, gy, part.vx, 0, 4, false);
      } else part.vy = 0;
      part.vx *= 1 - 2.2 * dt;
      part.w *= 1 - 3 * dt;
    }
  }
  b.x = C.rider.x; b.y = C.rider.y;
  b.vx = C.rider.vx; b.vy = C.rider.vy;
  if (b.crashT > 1.7) {
    const spot = findSafeSpot(Math.max(C.bike.x, C.rider.x) + 200);
    if (game.demo) { if (spot > T.finishX - 150) startDemo(); else placeBike(spot); return; }
    if (game.lives > 0) {
      if (spot > T.finishX - 200) { endGame('finish'); return; }   // Rest der Strecke übersprungen -> ins Ziel gerollt
      placeBike(spot);
      bike.flicker = 1.6;
      game.streak = 0;
      updateHud(true);
    } else endGame('out');
  }
}

function step(dt) {
  const b = bike;
  game.time += dt;
  const I = game.demo ? ai : (game.finishing ? IDLE : input);
  if (game.demo) aiUpdate(b, dt);

  if (b.mode === 'ground') {
    stepGround(b, dt, I);
    if (b.mode === 'ground') {
      for (const k of TRICK_KEYS) b.tw[k] += (0 - b.tw[k]) * Math.min(1, dt * 12);
    }
  } else if (b.mode === 'air') stepAir(b, dt, I);
  else stepCrash(b, dt);

  if (b.mode !== 'crash') {
    // Federung
    b.susVel += (-300 * b.sus - 15 * b.susVel) * dt;
    b.sus = clamp(b.sus + b.susVel * dt, -10, 10);
    const targetLean = (I.fwd ? 1 : 0) - (I.back ? 1 : 0);
    b.lean += (targetLean - b.lean) * Math.min(1, dt * 10);
    if (b.flicker > 0) b.flicker -= dt;
    if (!game.demo) game.stats.dist = Math.max(game.stats.dist, b.px / 20);
  }

  // Ziel
  if (game.demo) {
    if (b.px > T.finishX - 60) startDemo();
  } else if (game.state === 'play') {
    if (!game.finishing && b.mode !== 'crash' && b.px >= T.finishX) onFinish();
    if (game.finishing) {
      game.finishT += dt;
      if (game.finishT > (b.mode === 'air' ? 5 : 2.6)) endGame('finish');
    }
  }
}

function onFinish() {
  game.finishing = true; game.finishT = 0;
  el.banner.textContent = 'ZIEL!';
  el.banner.classList.remove('hidden');
  emitConfetti(bike.x + 260, bike.y - 120, 100);
  game.flash = 0.35; game.cheer = 1.6;
  sfx.record(); sfx.crowd();
}

// ===================================================================
// Autopilot (Menü-Demo + Tests)
// ===================================================================
function aiUpdate(b, dt) {
  for (const k of ['back', 'fwd', ...TRICK_KEYS]) ai[k] = false;
  trickOrder.length = 0;
  if (b.mode !== 'air') return;
  if (!ai.plan) {
    const flipOK = b.pred.t > 1.05;
    ai.plan = {
      trick: Math.random() < 0.8 ? TRICK_KEYS[(Math.random() * 4) | 0] : null,
      flip: flipOK && Math.random() < 0.45 ? (Math.random() < 0.6 ? -1 : 1) : 0,
      holdFrom: rand(0.12, 0.3),
    };
  }
  const p = ai.plan;
  const turns = flipTurns(b, Math.atan(b.pred.slope));
  if (p.flip < 0 && turns > -0.8 && b.airT > 0.05) ai.back = true;
  if (p.flip > 0 && turns < 0.8 && b.airT > 0.05) ai.fwd = true;
  if (p.trick && b.airT > p.holdFrom && b.pred.t > 0.55) { ai[p.trick] = true; trickOrder.push(p.trick); }
}

// ===================================================================
// Kamera / Rendering
// ===================================================================
const cv = $('game');
const ctx = cv.getContext('2d');
const view = { W: 0, H: 0, dpr: 1, scale: 1, zoom: 1, camX: 0, camY: 0, vignette: null };

function resize() {
  const dpr = Math.min(window.devicePixelRatio || 1, 2);
  view.dpr = dpr;
  view.W = window.innerWidth; view.H = window.innerHeight;
  cv.width = Math.round(view.W * dpr);
  cv.height = Math.round(view.H * dpr);
  view.scale = Math.min(view.W / 680, view.H / 360);
  // Vignette
  const vg = document.createElement('canvas');
  vg.width = 256; vg.height = 256;
  const g = vg.getContext('2d');
  const grad = g.createRadialGradient(128, 128, 60, 128, 128, 190);
  grad.addColorStop(0, 'rgba(0,0,0,0)');
  grad.addColorStop(1, 'rgba(8,0,24,.55)');
  g.fillStyle = grad; g.fillRect(0, 0, 256, 256);
  view.vignette = vg;
}
window.addEventListener('resize', resize);
window.addEventListener('orientationchange', () => setTimeout(resize, 120));

function snapCamera() {
  const Z = view.scale * view.zoom;
  const vw = view.W / Z, vh = view.H / Z;
  view.camX = bike.x - vw * 0.3;
  view.camY = bike.y - vh * 0.62;
}
function updateCamera(dt) {
  const b = bike;
  const gy = terrainY(b.x);
  const hAbove = clamp(gy - b.y, 0, 600);
  const zt = 1 - (hAbove / 600) * 0.3;
  view.zoom += (zt - view.zoom) * Math.min(1, dt * 2.2);
  const Z = view.scale * view.zoom;
  const vw = view.W / Z, vh = view.H / Z;
  const tx = b.x - vw * 0.3 + clamp(b.vx, 0, 900) * 0.16;
  const ty = (b.y * 0.7 + gy * 0.3) - vh * 0.64;
  view.camX += (tx - view.camX) * Math.min(1, dt * 7);
  view.camY += (ty - view.camY) * Math.min(1, dt * 3.6);
}

// ---------- Hintergrund ----------
function drawSky(c, W, H) {
  const g = c.createLinearGradient(0, 0, 0, H);
  g.addColorStop(0, rgb(pal.skyTop));
  g.addColorStop(0.55, rgb(pal.skyMid));
  g.addColorStop(1, rgb(pal.skyBot));
  c.fillStyle = g; c.fillRect(0, 0, W, H);

  // Sterne
  if (pal.stars > 0.02) {
    c.fillStyle = '#fff';
    for (let i = 0; i < 80; i++) {
      const x = hash(i * 1.7) * W, y = hash(i * 3.1 + 5) * H * 0.55;
      const tw = 0.5 + 0.5 * Math.sin(game.time * (1 + hash(i) * 2) + i);
      c.globalAlpha = pal.stars * (0.3 + 0.7 * tw) * (1 - y / (H * 0.6));
      c.fillRect(x, y, 1.6 + hash(i * 9) * 1.2, 1.6 + hash(i * 9) * 1.2);
    }
    c.globalAlpha = 1;
  }
  // Sonne / Mond
  const sx = W * 0.72 - ((view.camX * 0.01) % W), sy = H * pal.sunY;
  const sr = Math.min(W, H) * 0.11;
  const glow = c.createRadialGradient(sx, sy, sr * 0.4, sx, sy, sr * 4.2);
  glow.addColorStop(0, rgb(pal.sun, 0.55));
  glow.addColorStop(1, rgb(pal.sun, 0));
  c.fillStyle = glow; c.fillRect(sx - sr * 5, sy - sr * 5, sr * 10, sr * 10);
  c.fillStyle = rgb(pal.sun); c.beginPath(); c.arc(sx, sy, sr, 0, TAU); c.fill();
  if (pal.stars > 0.5) { // Mondkrater
    c.fillStyle = 'rgba(120,130,170,.35)';
    c.beginPath(); c.arc(sx - sr * 0.3, sy - sr * 0.2, sr * 0.22, 0, TAU); c.fill();
    c.beginPath(); c.arc(sx + sr * 0.35, sy + sr * 0.25, sr * 0.3, 0, TAU); c.fill();
    c.beginPath(); c.arc(sx + sr * 0.1, sy - sr * 0.5, sr * 0.14, 0, TAU); c.fill();
  }
}
function drawClouds(c, W, H) {
  c.fillStyle = rgb(pal.cloud, 0.55);
  const span = W + 400;
  for (let i = 0; i < 7; i++) {
    let x = (i * 330 - view.camX * 0.05 + hash(i) * 200) % span;
    if (x < 0) x += span;
    x -= 200;
    const y = H * (0.08 + 0.32 * hash(i * 2.3));
    const s = 0.7 + hash(i * 5) * 0.8;
    c.beginPath();
    for (const [dx, dy, rx, ry] of [[0, 0, 60, 16], [-34, 4, 34, 12], [40, 5, 38, 11], [6, -10, 34, 14]]) {
      c.moveTo(x + dx * s + rx * s, y + dy * s);
      c.ellipse(x + dx * s, y + dy * s, rx * s, ry * s, 0, 0, TAU);
    }
    c.fill();
  }
}
// ---------- Welt ----------
function drawTerrain(c, x0, x1, yTop, yBot) {
  const i0 = Math.floor(x0 / STEP) * STEP;
  const g = c.createLinearGradient(0, -300, 0, 800);
  g.addColorStop(0, rgb(pal.dirtTop));
  g.addColorStop(1, rgb(pal.dirtBot));
  c.beginPath();
  c.moveTo(i0, yBot);
  for (let x = i0; x <= x1 + STEP; x += STEP) c.lineTo(x, terrainY(x));
  c.lineTo(x1 + STEP, yBot);
  c.closePath();
  c.fillStyle = g; c.fill();

  // Erdschichten / Steine
  c.save(); c.clip();
  for (let x = Math.floor(x0 / 40) * 40; x < x1 + 40; x += 40) {
    const h1 = hash(x * 0.31), h2 = hash(x * 0.77 + 3);
    const gy = terrainY(x);
    c.fillStyle = `rgba(0,0,0,${0.08 + h1 * 0.1})`;
    c.beginPath(); c.ellipse(x + h2 * 30, gy + 26 + h1 * 160, 5 + h2 * 9, 2.5 + h1 * 3, 0, 0, TAU); c.fill();
    c.fillStyle = `rgba(255,255,255,${0.04 + h2 * 0.05})`;
    c.beginPath(); c.ellipse(x + h1 * 30, gy + 14 + h2 * 120, 3 + h1 * 5, 1.5 + h2 * 2, 0, 0, TAU); c.fill();
  }
  c.restore();

  // Oberkante: Rand + Highlight
  c.lineJoin = 'round'; c.lineCap = 'round';
  c.beginPath();
  for (let x = i0; x <= x1 + STEP; x += STEP) { const y = terrainY(x); if (x === i0) c.moveTo(x, y); else c.lineTo(x, y); }
  c.strokeStyle = 'rgba(30,10,10,.55)'; c.lineWidth = 12; c.stroke();
  c.strokeStyle = rgb(pal.edge); c.lineWidth = 8; c.stroke();
  c.strokeStyle = rgb(mixc(pal.edge, [255, 255, 255], 0.5), 0.7); c.lineWidth = 2;
  c.beginPath();
  for (let x = i0; x <= x1 + STEP; x += STEP) { const y = terrainY(x) - 2.5; if (x === i0) c.moveTo(x, y); else c.lineTo(x, y); }
  c.stroke();
}

function drawProp(c, type, x, y, sc) {
  c.save(); c.translate(x, y); c.scale(sc, sc);
  const night = pal.stars;
  if (type === 0) { // Reifenstapel
    for (let i = 0; i < 3; i++) {
      c.fillStyle = '#16161e'; c.beginPath(); c.ellipse(0, -8 - i * 14, 22, 8, 0, 0, TAU); c.fill();
      c.fillStyle = i % 2 ? '#e8e8f0' : '#ff3b3b';
      c.fillRect(-22, -8 - i * 14, 44, 10); c.fillStyle = '#16161e';
      c.beginPath(); c.ellipse(0, 2 - i * 14, 22, 8, 0, 0, Math.PI); c.fill();
      c.fillStyle = i % 2 ? '#e8e8f0' : '#ff3b3b';
      c.beginPath(); c.ellipse(0, 2 - i * 14, 22, 8, 0, 0, Math.PI); c.fill();
      c.fillStyle = '#16161e'; c.beginPath(); c.ellipse(0, -8 - i * 14, 14, 4.5, 0, 0, TAU); c.fill();
    }
  } else if (type === 1) { // Heuballen
    c.fillStyle = '#d8b255'; c.fillRect(-26, -30, 52, 30);
    c.strokeStyle = '#8a6a22'; c.lineWidth = 2;
    for (let i = -18; i <= 18; i += 12) { c.beginPath(); c.moveTo(i, -30); c.lineTo(i, 0); c.stroke(); }
    c.strokeRect(-26, -30, 52, 30);
  } else if (type === 2) { // Baum je Biom
    const b = pal.idx;
    const col = rgb(pal.tree);
    if (b === 1) { // Kaktus
      c.fillStyle = col; c.strokeStyle = 'rgba(0,0,0,.35)'; c.lineWidth = 2;
      c.beginPath(); c.roundRect ? c.roundRect(-6, -64, 12, 64, 6) : c.rect(-6, -64, 12, 64); c.fill(); c.stroke();
      c.beginPath(); c.roundRect ? c.roundRect(-22, -44, 10, 6, 3) : c.rect(-22, -44, 10, 6); c.fill();
      c.beginPath(); c.roundRect ? c.roundRect(-22, -58, 8, 22, 4) : c.rect(-22, -58, 8, 22); c.fill();
      c.beginPath(); c.roundRect ? c.roundRect(12, -36, 10, 6, 3) : c.rect(12, -36, 10, 6); c.fill();
      c.beginPath(); c.roundRect ? c.roundRect(14, -50, 8, 20, 4) : c.rect(14, -50, 8, 20); c.fill();
    } else if (b === 3) { // Palme
      c.strokeStyle = '#5a3a22'; c.lineWidth = 6; c.lineCap = 'round';
      c.beginPath(); c.moveTo(0, 0); c.quadraticCurveTo(10, -40, 4, -76); c.stroke();
      c.strokeStyle = col; c.lineWidth = 5;
      for (let i = 0; i < 6; i++) {
        const a = -Math.PI / 2 + (i - 2.5) * 0.55;
        c.beginPath(); c.moveTo(4, -76); c.quadraticCurveTo(4 + Math.cos(a) * 24, -76 + Math.sin(a) * 24 - 8, 4 + Math.cos(a) * 42, -76 + Math.sin(a) * 36 + 12); c.stroke();
      }
    } else { // Kiefer
      c.fillStyle = '#3a2418'; c.fillRect(-3, -14, 6, 14);
      c.fillStyle = col;
      for (let i = 0; i < 3; i++) { c.beginPath(); c.moveTo(0, -78 + i * 18); c.lineTo(18 + i * 6, -42 + i * 18); c.lineTo(-18 - i * 6, -42 + i * 18); c.closePath(); c.fill(); }
    }
  } else if (type === 3) { // Flutlicht / Laterne
    c.fillStyle = '#2a2a36'; c.fillRect(-2.5, -90, 5, 90);
    c.fillStyle = '#2a2a36'; c.fillRect(-12, -96, 24, 7);
    const lit = 0.25 + night * 0.75;
    c.fillStyle = `rgba(255,240,170,${lit})`; c.fillRect(-11, -90, 22, 4);
    if (night > 0.1) {
      const g = c.createRadialGradient(0, -86, 2, 0, -86, 90);
      g.addColorStop(0, `rgba(255,236,160,${0.5 * night})`); g.addColorStop(1, 'rgba(255,236,160,0)');
      c.fillStyle = g; c.fillRect(-100, -180, 200, 200);
    }
  } else { // Fahnen
    c.strokeStyle = '#ccc'; c.lineWidth = 3; c.beginPath(); c.moveTo(0, 0); c.lineTo(0, -70); c.stroke();
    const w = Math.sin(game.time * 5 + x * 0.1) * 4;
    c.fillStyle = '#ff2e93'; c.beginPath(); c.moveTo(0, -70); c.lineTo(28, -62 + w); c.lineTo(0, -52); c.closePath(); c.fill();
  }
  c.restore();
}

function drawWorldProps(c, x0, x1) {
  const CELL = 260;
  for (let cell = Math.floor(x0 / CELL) - 1; cell <= Math.floor(x1 / CELL) + 1; cell++) {
    if (hash(cell * 1.37 + 7) > 0.62) continue;
    const px = cell * CELL + hash(cell * 3.1) * 200;
    if (px < 700) continue;
    const sl = Math.abs(slopeAt(px));
    if (sl > 0.06 || Math.abs(slopeAt(px - 30)) > 0.08 || Math.abs(slopeAt(px + 30)) > 0.08) continue;
    if (px > T.finishX - 300) continue;
    const type = [0, 1, 4][Math.floor(hash(cell * 9.3) * 3)];
    drawProp(c, type, px, terrainY(px) + 2, 0.9 + hash(cell * 4.4) * 0.5);
  }
  drawGate(c, 640, 'FMX KING · START', x0, x1);
  drawGate(c, T.finishX, 'ZIEL', x0, x1, true);
  // Entfernungsschilder alle 100 m
  for (let m = Math.max(1, Math.floor(x0 / 2000)); m * 2000 < x1 + 100 && m * 2000 < T.finishX - 400; m++) {
    const x = m * 2000, y = terrainY(x);
    c.fillStyle = '#e8e8f0'; c.fillRect(x - 2, y - 56, 4, 56);
    c.fillStyle = '#ffd23f'; c.fillRect(x - 26, y - 70, 52, 24);
    c.strokeStyle = '#17171f'; c.lineWidth = 2; c.strokeRect(x - 26, y - 70, 52, 24);
    c.fillStyle = '#17171f'; c.font = '900 14px Arial Black, Arial, sans-serif'; c.textAlign = 'center'; c.textBaseline = 'middle';
    c.fillText(m * 100 + ' m', x, y - 58);
  }
  // Sprung-Markierungen
  for (const j of T.jumps) {
    if (j.x < x0 - 100 || j.start > x1 + 100) continue;
    // Chevrons auf der Rampe
    c.fillStyle = 'rgba(255,214,60,.9)';
    const len = j.x - j.start;
    for (let k = 1; k <= 3; k++) {
      const x = j.start + len * (k / 4.2);
      const y = terrainY(x), sl = slopeAt(x);
      c.save(); c.translate(x, y); c.rotate(Math.atan(sl));
      c.beginPath(); c.moveTo(-8, -3); c.lineTo(2, -3); c.lineTo(8, -7); c.lineTo(8, -1); c.lineTo(2, 2); c.lineTo(-8, 2); c.closePath(); c.globalAlpha = 0.85; c.fill();
      c.restore();
    }
    // Fahne an der Kante
    const fy = j.y;
    c.strokeStyle = '#eee'; c.lineWidth = 3; c.beginPath(); c.moveTo(j.x - 4, fy + 2); c.lineTo(j.x - 4, fy - 62); c.stroke();
    const w = Math.sin(game.time * 6 + j.x) * 4;
    c.fillStyle = '#ffd23f'; c.beginPath(); c.moveTo(j.x - 4, fy - 62); c.lineTo(j.x - 4 + 26, fy - 55 + w); c.lineTo(j.x - 4, fy - 46); c.closePath(); c.fill();
  }
}


// ---------- Stadion ----------
let crowdTile = null;
function makeCrowdTile() {
  const t = document.createElement('canvas');
  t.width = 512; t.height = 128;
  const g = t.getContext('2d');
  const cols = ['#ff2e93', '#ffd23f', '#19e3ff', '#9dff3a', '#ff6a00', '#ffffff', '#7a5cff', '#ff5a5a'];
  const skin = ['#f1c8a0', '#c68a5e', '#8d5a3a', '#ffe0c0'];
  for (let r = 0; r < 8; r++) {
    const y = 16 * r + 14;
    g.fillStyle = 'rgba(0,0,0,.4)'; g.fillRect(0, 16 * r + 14, 512, 2);
    for (let x = 0; x < 512; x += 8) {
      if (hash(r * 91 + x * 0.37) < 0.08) continue;
      const ox = x + (r % 2) * 4 + hash(x + r * 7) * 2;
      g.fillStyle = cols[(hash(x * 1.7 + r * 13) * cols.length) | 0];
      g.beginPath(); g.roundRect ? g.roundRect(ox, y - 2, 6.4, 8, 2) : g.rect(ox, y - 2, 6.4, 8); g.fill();
      g.fillStyle = skin[(hash(x * 3.3 + r) * skin.length) | 0];
      g.beginPath(); g.arc(ox + 3.2, y - 5.5, 2.7, 0, TAU); g.fill();
      if (hash(x * 5.1 + r * 3) < 0.18) { // Arme hoch
        g.strokeStyle = skin[0]; g.lineWidth = 1.2;
        g.beginPath(); g.moveTo(ox + 1, y); g.lineTo(ox - 1, y - 8); g.moveTo(ox + 5.4, y); g.lineTo(ox + 7.4, y - 8); g.stroke();
      }
    }
  }
  crowdTile = t;
}

function drawStand(c, W, H, groundSy, u, f, hU, offU, scrollF) {
  const yb = lerp(H * 0.7, groundSy, f) + offU * u;
  const th = hU * u, top = yb - th;
  const g = c.createLinearGradient(0, top, 0, yb);
  g.addColorStop(0, rgb(mixc(pal.m2, [0, 0, 0], 0.4)));
  g.addColorStop(1, rgb(mixc(pal.m3, [0, 0, 0], 0.25)));
  c.fillStyle = g; c.fillRect(0, top, W, th);
  // Publikum (4 Bänder, die beim Jubeln hüpfen)
  const sc = th / 128, tw = 512 * sc;
  const shift = (view.camX * scrollF * u) % tw;
  const amp = (0.25 + game.cheer * 2.2) * u;
  for (let band = 0; band < 4; band++) {
    const bob = Math.sin(game.time * 5.5 + band * 1.9) * amp;
    for (let x = -shift - tw; x < W; x += tw) {
      c.drawImage(crowdTile, 0, band * 32, 512, 32, x, top + band * 32 * sc + bob, tw + 1, 32 * sc);
    }
  }
  // Abdunklung je nach Tageszeit
  const night = pal.stars;
  c.fillStyle = rgb(pal.skyTop, lerp(0.1, 0.55, night) + (pal.idx === 0 ? 0.14 : 0));
  c.fillRect(0, top, W, th);
  // Kamerablitze
  c.globalCompositeOperation = 'lighter';
  for (let k = 0; k < 14; k++) {
    const ph = game.time * (1.2 + hash(k) * 1.6) + k * 3.1;
    if (ph % 1 > 0.12 + game.cheer * 0.08) continue;
    const fx = hash(k * 7.7 + Math.floor(ph)) * W, fy = top + hash(k * 3.3 + Math.floor(ph)) * th;
    c.fillStyle = 'rgba(255,255,255,.9)'; c.fillRect(fx - 1, fy - 1, 3, 3);
    c.fillStyle = 'rgba(255,255,255,.25)'; c.fillRect(fx - 4, fy, 9, 1); c.fillRect(fx, fy - 4, 1, 9);
  }
  c.globalCompositeOperation = 'source-over';
  // Brüstung
  c.fillStyle = rgb(mixc(pal.m1, [0, 0, 0], 0.3)); c.fillRect(0, yb - 3 * u, W, 3 * u);
  c.fillStyle = rgb(pal.edge, 0.55); c.fillRect(0, top, W, 1.6 * u);
  return top;
}

function drawStadium(c, W, H, groundSy, u) {
  if (!crowdTile) makeCrowdTile();
  const night = pal.stars;
  const span = 640 * u;
  drawStand(c, W, H, groundSy, u, 0.92, 74, -2, 0.55);
  const topUp = drawStand(c, W, H, groundSy, u, 0.7, 82, -78, 0.35);
  // Dach
  const roofY = topUp - 16 * u;
  c.fillStyle = rgb(mixc(pal.m3, [0, 0, 0], 0.55)); c.fillRect(0, roofY, W, 16 * u);
  c.fillStyle = rgb(pal.edge, 0.7); c.fillRect(0, roofY + 14 * u, W, 2 * u);
  c.strokeStyle = 'rgba(0,0,0,.45)'; c.lineWidth = Math.max(1, u);
  c.beginPath();
  for (let x = -((view.camX * 0.3 * u) % (40 * u)); x < W; x += 40 * u) { c.moveTo(x, roofY); c.lineTo(x + 20 * u, roofY + 14 * u); c.lineTo(x + 40 * u, roofY); }
  c.stroke();
  // Dachlichter
  c.fillStyle = `rgba(255,240,190,${0.35 + 0.6 * night})`;
  for (let x = -((view.camX * 0.3 * u) % (30 * u)); x < W; x += 30 * u) c.fillRect(x, roofY + 11 * u, 6 * u, 2.5 * u);
  // Flutlichter + Anzeigetafel auf dem Dach
  const camP = view.camX * 0.3 * u;
  const period = span * Math.ceil(W / span + 2);
  for (let i = 0; i < Math.ceil(W / span) + 2; i++) {
    const mx = (((i * span - camP) % period) + period) % period - span;
    c.fillStyle = rgb(mixc(pal.m3, [0, 0, 0], 0.6));
    c.fillRect(mx - 2 * u, roofY - 34 * u, 4 * u, 34 * u);
    c.fillRect(mx - 22 * u, roofY - 52 * u, 44 * u, 20 * u);
    c.fillStyle = `rgba(255,248,210,${0.5 + 0.5 * night})`;
    for (let a = 0; a < 4; a++) for (let b = 0; b < 2; b++) c.fillRect(mx - 20 * u + a * 10.5 * u, roofY - 50 * u + b * 9 * u, 8.5 * u, 7 * u);
    if (night > 0.05) {
      const gl = c.createRadialGradient(mx, roofY - 42 * u, 2 * u, mx, roofY - 42 * u, 110 * u);
      gl.addColorStop(0, `rgba(255,244,200,${0.55 * night})`); gl.addColorStop(1, 'rgba(255,244,200,0)');
      c.fillStyle = gl; c.fillRect(mx - 120 * u, roofY - 160 * u, 240 * u, 240 * u);
    }
  }
  // Anzeigetafel
  const P = 1700 * u;
  const jx = ((((900 * u - view.camX * 0.35 * u) % P) + P) % P) - 260 * u;
  const jy = topUp + 12 * u, jw = 170 * u, jh = 62 * u;
  c.fillStyle = '#0a0a14'; c.fillRect(jx - 4 * u, jy - 4 * u, jw + 8 * u, jh + 8 * u);
  const sg = c.createLinearGradient(jx, jy, jx + jw, jy + jh);
  const ph = (Math.sin(game.time * 1.4) + 1) / 2;
  sg.addColorStop(0, rgb(mixc([25, 227, 255], [255, 46, 147], ph))); sg.addColorStop(1, rgb(mixc([255, 46, 147], [255, 210, 63], ph)));
  c.fillStyle = sg; c.fillRect(jx, jy, jw, jh);
  c.fillStyle = 'rgba(0,0,0,.35)';
  for (let y = jy; y < jy + jh; y += 3 * u) c.fillRect(jx, y, jw, 1);
  c.fillStyle = '#fff'; c.textAlign = 'center'; c.textBaseline = 'middle';
  c.font = `900 italic ${Math.round(26 * u)}px "Arial Black", Impact, sans-serif`;
  c.fillText('FMX KING', jx + jw / 2, jy + jh * 0.38);
  c.font = `900 ${Math.round(10 * u)}px "Arial Black", Arial, sans-serif`;
  const msgs = ['BIGGEST AIR', 'SUPERMAN!', 'NEW RECORD?', 'BACKFLIP!'];
  c.fillText(msgs[Math.floor(game.time / 2) % msgs.length], jx + jw / 2, jy + jh * 0.78);
}

const AD_TEXT = ['TURBO MX', 'NITRO', 'DIRT KING', 'MOTO MAX', 'AIR TIME', 'MEGA JUMP', 'SPEED ZONE', 'FMX KING'];
const AD_COL = ['#e8272f', '#1e6fe8', '#f2b705', '#16a34a', '#d946ef', '#f97316', '#0ea5b7', '#111827'];
function drawBoards(c, x0, x1) {
  const BW = 150;
  for (let i = Math.floor(x0 / BW); i * BW < x1; i++) {
    const x = i * BW, k = ((i % 8) + 8) % 8;
    c.fillStyle = '#12121a'; c.fillRect(x, -40, BW, 40);
    c.fillStyle = AD_COL[k]; c.fillRect(x + 2, -38, BW - 4, 34);
    c.fillStyle = 'rgba(255,255,255,.18)'; c.fillRect(x + 2, -38, BW - 4, 8);
    c.fillStyle = k === 2 ? '#111' : '#fff';
    c.font = '900 italic 18px "Arial Black", Impact, sans-serif'; c.textAlign = 'center'; c.textBaseline = 'middle';
    c.fillText(AD_TEXT[k], x + BW / 2, -21);
  }
}

function drawGate(c, gx, label, x0, x1, finish) {
  if (gx < x0 - 200 || gx > x1 + 200) return;
  const y = terrainY(gx);
  const w = 150;
  c.fillStyle = '#23232f'; c.fillRect(gx - w, y - 170, 12, 170); c.fillRect(gx + w - 12, y - 170, 12, 170);
  c.fillStyle = finish ? '#ffffff' : '#ff2e93'; c.fillRect(gx - w, y - 170, w * 2, 50);
  if (finish) {
    c.fillStyle = '#111';
    for (let i = 0; i < 30; i++) for (let j = 0; j < 5; j++) if ((i + j) % 2 === 0) c.fillRect(gx - w + i * 10, y - 170 + j * 10, 10, 10);
  }
  c.fillStyle = '#ffd23f'; c.fillRect(gx - w, y - 120, w * 2, 22);
  c.fillStyle = '#17171f'; c.font = '900 italic 17px "Arial Black", Arial, sans-serif'; c.textAlign = 'center'; c.textBaseline = 'middle';
  c.fillText(label, gx, y - 109);
  if (finish) { // Zielband am Boden
    for (let j = 0; j < 8; j++) { c.fillStyle = j % 2 ? '#111' : '#fff'; c.fillRect(gx - 5, y - 14 - j * 0, 10, 0); }
    c.fillStyle = '#fff'; c.fillRect(gx - 6, y - 6, 12, 6);
    c.fillStyle = '#111'; c.fillRect(gx - 6, y - 6, 6, 3); c.fillRect(gx, y - 3, 6, 3);
  }
}

function drawBikeShadow(c, b) {
  if (b.mode === 'crash') return;
  const gy = terrainY(b.x);
  const h = Math.max(0, gy - b.y);
  const a = clamp(0.38 - h / 900, 0.06, 0.38);
  c.save();
  c.translate(b.x, gy + 3);
  c.rotate(Math.atan(slopeAt(b.x)));
  c.fillStyle = `rgba(0,0,0,${a})`;
  c.beginPath(); c.ellipse(0, 0, 52 - Math.min(18, h / 14), 6, 0, 0, TAU); c.fill();
  c.restore();
}

function drawParticles(c) {
  for (const p of parts) {
    const k = clamp(p.life / p.max, 0, 1);
    if (p.type === 'dirt') {
      c.fillStyle = p.color; c.globalAlpha = Math.min(1, k * 2);
      c.beginPath(); c.arc(p.x, p.y, p.size, 0, TAU); c.fill();
    } else if (p.type === 'dust') {
      c.fillStyle = p.color; c.globalAlpha = k * 0.35;
      c.beginPath(); c.arc(p.x, p.y, p.size * (1.6 - k * 0.6), 0, TAU); c.fill();
    } else if (p.type === 'spark') {
      c.globalCompositeOperation = 'lighter';
      c.strokeStyle = p.color; c.globalAlpha = k; c.lineWidth = p.size; c.lineCap = 'round';
      c.beginPath(); c.moveTo(p.x, p.y); c.lineTo(p.x - p.vx * 0.035, p.y - p.vy * 0.035); c.stroke();
      c.globalCompositeOperation = 'source-over';
    } else if (p.type === 'confetti') {
      c.save(); c.translate(p.x, p.y); c.rotate(p.rot); c.fillStyle = p.color; c.globalAlpha = Math.min(1, k * 3);
      c.fillRect(-p.size, -p.size * 0.5, p.size * 2, p.size); c.restore();
    }
  }
  c.globalAlpha = 1;
}

function drawPopups(c) {
  c.textAlign = 'center'; c.textBaseline = 'middle'; c.lineJoin = 'round';
  for (const p of popups) {
    if (p.delay > 0) continue;
    const k = clamp(p.life / p.max, 0, 1);
    const pop = 1 + Math.max(0, (k - 0.85) * 5);
    c.globalAlpha = Math.min(1, k * 2.2);
    c.font = `900 italic ${Math.round(p.size * pop)}px "Arial Black", Impact, sans-serif`;
    c.lineWidth = Math.max(4, p.size * 0.22);
    const half = c.measureText(p.text).width / 2 + 8;
    const px = clamp(p.x, view.camX + half, view.camX + view.W / (view.scale * view.zoom) - half);
    c.strokeStyle = 'rgba(10,0,30,.9)'; c.strokeText(p.text, px, p.y);
    c.fillStyle = p.color; c.fillText(p.text, px, p.y);
  }
  c.globalAlpha = 1;
}

function drawBike(c, b) {
  if (b.mode === 'crash') {
    const C = b.crash;
    c.save(); c.translate(C.bike.x, C.bike.y); c.rotate(C.bike.a); drawCrashedBike(c, b.crashT); c.restore();
    c.save(); c.translate(C.rider.x, C.rider.y); c.rotate(C.rider.a); drawRagdollRider(c, b.crashT, C.rider.a); c.restore();
    return;
  }
  if (b.flicker > 0 && Math.floor(b.flicker * 14) % 2 === 0) c.globalAlpha = 0.35;
  c.save();
  c.translate(b.x, b.y); c.rotate(b.a);
  if (pal.stars > 0.3) { // Neon-Unterboden
    const g = c.createRadialGradient(0, 8, 4, 0, 8, 70);
    g.addColorStop(0, `rgba(25,227,255,${0.35 * pal.stars})`); g.addColorStop(1, 'rgba(25,227,255,0)');
    c.fillStyle = g; c.fillRect(-80, -50, 160, 120);
  }
  drawMoto(c, b);
  c.restore();
  c.globalAlpha = 1;
}

function render(dt) {
  const c = ctx;
  const { W, H, dpr } = view;
  updatePalette();

  c.setTransform(dpr, 0, 0, dpr, 0, 0);
  const Z = view.scale * view.zoom;
  const vw = W / Z, vh = H / Z;
  const shk = game.shake * 7;
  const ox = shk ? rand(-shk, shk) : 0, oy = shk ? rand(-shk, shk) : 0;
  const groundSy = (0 - view.camY) * Z;

  drawSky(c, W, H);
  drawClouds(c, W, H);
  drawStadium(c, W, H, groundSy, Z);

  c.setTransform(Z * dpr, 0, 0, Z * dpr, (-view.camX * Z + ox) * dpr, (-view.camY * Z + oy) * dpr);
  const x0 = view.camX - 10, x1 = view.camX + vw + 10;
  drawBoards(c, x0, x1);
  drawTerrain(c, x0, x1, view.camY, view.camY + vh + 60);
  drawWorldProps(c, x0, x1);
  drawBikeShadow(c, bike);
  drawParticles(c);
  drawBike(c, bike);
  drawPopups(c);

  // Screen-Space-Effekte
  c.setTransform(dpr, 0, 0, dpr, 0, 0);
  const sp = bike.mode === 'crash' ? 0 : Math.hypot(bike.vx, bike.vy);
  const lineA = clamp((sp - 520) / 300, 0, 1) * 0.3 + (bike.mode === 'air' ? 0.08 : 0);
  if (lineA > 0.02) {
    c.strokeStyle = `rgba(255,255,255,${lineA})`; c.lineWidth = 1.4;
    c.beginPath();
    for (let i = 0; i < 14; i++) {
      const y = hash(i * 7.3 + Math.floor(game.time * 18)) * H;
      const x = hash(i * 3.9 + Math.floor(game.time * 18) * 1.7) * W;
      c.moveTo(x, y); c.lineTo(x + 60 + hash(i) * 120, y);
    }
    c.stroke();
  }
  c.drawImage(view.vignette, 0, 0, W, H);
  if (game.flash > 0.01) { c.fillStyle = `rgba(255,255,255,${game.flash * 0.5})`; c.fillRect(0, 0, W, H); }
}

// ===================================================================
// HUD / UI
// ===================================================================
const el = {
  hud: $('hud'), score: $('hud-score'), best: $('hud-best'), goal: $('hud-goal'), dist: $('hud-dist'), bar: $('hud-bar'),
  streak: $('hud-streak'), lives: $('hud-lives'), combo: $('combo'), warn: $('warn'), banner: $('banner'), hint: $('hint'), controls: $('controls'),
};
let lastHud = {};
function popScore() {
  el.score.classList.add('pop');
  setTimeout(() => el.score.classList.remove('pop'), 140);
}
const MEDAL_ICON = ['', '🥉', '🥈', '🥇'];
function updateHud(force) {
  if (game.demo) return;
  const L = lastHud;
  const def = T.def;
  const s = Math.round(game.dispScore);
  if (force || L.score !== s) { el.score.textContent = fmt(s); L.score = s; }
  const rec = store.trackRec(def.id);
  const best = Math.max(rec.best, Math.floor(game.score));
  if (force || L.best !== best) { el.best.textContent = fmt(best); L.best = best; }
  // nächstes Medaillen-Ziel
  const m = trackInfo(def).medals;
  const cur = Math.floor(game.score);
  const goal = cur < m.bronze ? [1, m.bronze] : cur < m.silver ? [2, m.silver] : cur < m.gold ? [3, m.gold] : null;
  const gtxt = goal ? 'ZIEL ' + MEDAL_ICON[goal[0]] + ' ' + fmt(goal[1]) : '🥇 GOLD GEHOLT!';
  if (force || L.goal !== gtxt) { el.goal.textContent = gtxt; L.goal = gtxt; }
  const pr = clamp(bike.px / T.finishX, 0, 1);
  const pc = Math.floor(pr * 100);
  if (force || L.pc !== pc) {
    el.dist.textContent = def.name + ' · ' + pc + ' %';
    el.bar.style.width = pc + '%';
    L.pc = pc;
  }
  const st = game.streak > 0 ? '🔥 STREAK ×' + streakMult().toFixed(1) : '';
  if (force || L.streak !== st) { el.streak.textContent = st; L.streak = st; }
  const lv = game.lives;
  if (force || L.lives !== lv) {
    let h = '';
    for (let i = 0; i < LIVES; i++) h += '<span class="' + (i < lv ? '' : 'lost') + '">❤️</span>';
    el.lives.innerHTML = h; L.lives = lv;
  }
}
function updateCombo() {
  const b = bike;
  let key = '', html = '';
  let warn = false;
  if (b.mode === 'air' && !game.demo) {
    const items = comboItems(b, Math.atan(b.pred.slope));
    for (const it of items) html += '<span class="chip">' + it.name + ' +' + it.pts + '</span>';
    if (items.length > 1) html += '<span class="chip mult">COMBO ×' + comboMult(items.length).toFixed(1) + '</span>';
    if (b.airT > 0.5) html += '<span class="chip air">⏱ ' + b.airT.toFixed(1) + ' s</span>';
    key = html;
    warn = poseWeight(b) > 0.3 && b.pred.t < 0.5;
  }
  if (key !== lastHud.combo) {
    lastHud.combo = key;
    el.combo.innerHTML = html;
    el.combo.classList.toggle('hidden', !html);
  }
  el.warn.classList.toggle('hidden', !warn);
}

// ---------- Screens ----------
const screens = ['menu', 'tracks', 'howto', 'scores', 'pause', 'over'];
function showScreen(name) {
  for (const s of screens) $('screen-' + s).classList.toggle('active', s === name);
}
function setPlayUI(on) {
  el.hud.classList.toggle('hidden', !on);
  el.controls.classList.toggle('hidden', !on);
  if (!on) { el.banner.classList.add('hidden'); el.combo.classList.add('hidden'); el.warn.classList.add('hidden'); el.hint.classList.add('hidden'); }
}
function escapeHtml(s) { return String(s).replace(/[&<>"']/g, (m) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[m])); }
const medalsHtml = (n) => [1, 2, 3].map((i) => '<span class="mdl' + (i <= n ? ' got' : '') + '">' + MEDAL_ICON[i] + '</span>').join('');

function renderTracks() {
  let h = '';
  for (const def of TRACKS) {
    const info = trackInfo(def);
    const rec = store.trackRec(def.id);
    const th = BIOMES[def.theme];
    h += '<button class="track-card" data-track="' + def.id + '">' +
      '<div class="tc-sky" style="background:linear-gradient(' + rgb(th.skyTop) + ',' + rgb(th.skyMid) + ' 60%,' + rgb(th.skyBot) + ')"></div>' +
      '<div class="tc-top"><span class="tc-name">' + def.name + '</span><span class="tc-stars">' + '★'.repeat(def.stars) + '☆'.repeat(3 - def.stars) + '</span></div>' +
      '<div class="tc-blurb">' + def.blurb + '</div>' +
      '<div class="tc-meta">' + info.jumps + ' Sprünge · ' + Math.round(info.length / 20) + ' m</div>' +
      '<div class="tc-best">Best <b>' + fmt(rec.best) + '</b> ' + medalsHtml(medalFor(rec.best, def)) + '</div>' +
      '<div class="tc-goal">🥇 ab ' + fmt(info.medals.gold) + ' · Profi ≈ ' + fmt(info.par) + '</div>' +
      '</button>';
  }
  $('track-list').innerHTML = h;
  $('track-list').querySelectorAll('.track-card').forEach((b) => b.addEventListener('click', () => { sfx.init(); sfx.click(); startGame(b.dataset.track); }));
}
function totalMedals() {
  return TRACKS.reduce((n, d) => n + medalFor(store.trackRec(d.id).best, d), 0);
}
function updateMenuInfo() { $('menu-best').textContent = totalMedals() + ' / ' + TRACKS.length * 3; }

let scoreTab = 'arena';
function renderScoreTabs() {
  $('score-tabs').innerHTML = TRACKS.map((d) => '<button class="tab' + (d.id === scoreTab ? ' on' : '') + '" data-track="' + d.id + '">' + d.name + '</button>').join('');
  $('score-tabs').querySelectorAll('.tab').forEach((b) => b.addEventListener('click', () => { sfx.click(); scoreTab = b.dataset.track; renderScoreTabs(); }));
  renderScores($('scores-list'), scoreTab);
}
function renderScores(target, trackId, opts = {}) {
  const rec = store.trackRec(trackId);
  const list = rec.scores.slice(0, opts.limit || 10);
  if (!list.length) { target.innerHTML = '<div class="empty">Noch keine Einträge – fahr los!</div>'; return; }
  let h = '<table>';
  list.forEach((e, i) => {
    const me = opts.highlight && e.id === opts.highlight;
    const name = me
      ? '<input class="name-input" id="name-input" maxlength="12" value="' + escapeHtml(e.name) + '" />'
      : escapeHtml(e.name);
    h += '<tr class="' + (me ? 'me' : '') + '"><td class="rank">' + (i + 1) + '.</td><td>' + name + '</td><td class="sc">' + fmt(e.score) + '</td><td class="dt">' + new Date(e.id).toLocaleDateString('de-DE') + '</td></tr>';
  });
  target.innerHTML = h + '</table>';
  if (opts.highlight) {
    const inp = target.querySelector('#name-input');
    if (inp) inp.addEventListener('input', () => {
      const entry = rec.scores.find((x) => x.id === opts.highlight);
      if (entry) { entry.name = inp.value.slice(0, 12) || 'Fahrer'; store.data.name = entry.name; store.save(); }
    });
  }
}

// ===================================================================
// Spielablauf
// ===================================================================
function startDemo() {
  game.demo = true;
  buildTrack(TRACKS[game.demoIdx++ % TRACKS.length]);
  updatePalette();
  placeBike(findSafeSpot(900));
  view.zoom = 1; snapCamera();
  parts.length = 0; popups.length = 0;
}

function startGame(trackId) {
  sfx.init();
  const def = trackById(trackId || game.trackId);
  game.trackId = def.id;
  store.data.lastTrack = def.id; store.save();
  input.back = input.fwd = false; TRICK_KEYS.forEach((k) => (input[k] = false)); trickOrder = [];
  document.querySelectorAll('.ctl').forEach((b) => b.classList.remove('active'));
  game.demo = false;
  game.state = 'play';
  game.score = 0; game.dispScore = 0; game.lives = LIVES; game.streak = 0;
  game.time = 0; game.timeScale = 1; game.slowT = 0; game.shake = 0; game.flash = 0; game.cheer = 0;
  game.finishing = false; game.finishT = 0; game.finishBonus = 0;
  el.banner.classList.add('hidden');
  game.stats = newStats(); game.newRecord = false; game.runEntry = null;
  buildTrack(def);
  updatePalette();
  placeBike(250);
  parts.length = 0; popups.length = 0;
  view.zoom = 1; snapCamera();
  lastHud = {};
  showScreen(null);
  setPlayUI(true);
  updateHud(true);
  if (!store.data.seenHint) {
    el.hint.innerHTML = '← Links: <b>neigen / Wheelie</b> &nbsp;·&nbsp; Rechts: <b>Tricks halten</b>, vor der Landung <b>loslassen</b>!';
    el.hint.classList.remove('hidden');
    setTimeout(() => el.hint.classList.add('hidden'), 7000);
    store.data.seenHint = true; store.save();
  }
}

function endGame(reason) {
  if (game.state === 'over') return;
  game.state = 'over';
  setPlayUI(false);
  const def = T.def;
  const finished = reason === 'finish';
  game.finishBonus = finished ? game.lives * 250 : 0;
  game.score += game.finishBonus;
  const sc = Math.floor(game.score);
  const rec = store.trackRec(def.id);
  const prevBest = rec.best;
  const prevMedal = medalFor(prevBest, def);
  game.newRecord = sc > prevBest && sc > 0;
  let id = null;
  if (sc > 0) {
    id = Date.now();
    rec.scores.push({ id, score: sc, name: store.data.name || 'Fahrer' });
    rec.scores.sort((a, b) => b.score - a.score);
    rec.scores = rec.scores.slice(0, 10);
    if (!rec.scores.some((e) => e.id === id)) id = null;
  }
  if (sc > prevBest) rec.best = sc;
  store.save();
  const S = game.stats;
  const info = trackInfo(def);
  const medal = medalFor(sc, def);
  $('over-title').textContent = finished ? '🏁 Ziel erreicht!' : 'Ausgeschieden';
  $('over-track').textContent = def.name;
  $('over-score').textContent = fmt(sc);
  $('over-badge').classList.toggle('hidden', !game.newRecord);
  $('over-badge').textContent = medal > prevMedal ? '🏅 NEUE MEDAILLE!' : '🏆 NEUER REKORD!';
  const m = info.medals;
  $('over-medals').innerHTML =
    [[1, m.bronze], [2, m.silver], [3, m.gold]].map(([i, v]) => '<span class="mdl-chip' + (medal >= i ? ' got' : '') + '">' + MEDAL_ICON[i] + ' ' + fmt(v) + '</span>').join('') +
    '<div class="par">Profi-Richtwert: ≈ ' + fmt(info.par) + '</div>';
  $('over-stats').innerHTML =
    '<span>Sprünge <b>' + S.jumps + ' / ' + info.jumps + '</b></span>' +
    '<span>Beste Combo <b>' + fmt(S.bestCombo) + '</b></span>' +
    '<span>Flips <b>' + S.flips + '</b></span>' +
    '<span>Längste Luft <b>' + S.maxAir.toFixed(1) + ' s</b></span>' +
    '<span>Perfekte Landungen <b>' + S.perfect + '</b></span>' +
    (game.finishBonus ? '<span>Ziel-Bonus <b>+' + fmt(game.finishBonus) + '</b></span>' : '');
  renderScores($('over-table'), def.id, { limit: 5, highlight: id });
  const idx = TRACKS.indexOf(trackById(def.id));
  const next = TRACKS[idx + 1];
  $('btn-next').classList.toggle('hidden', !next);
  $('btn-next').dataset.track = next ? next.id : '';
  game.demo = true;
  placeBike(findSafeSpot(bike.px + 300));
  snapCamera();
  showScreen('over');
  if (game.newRecord) sfx.record(); else sfx.over();
  updateMenuInfo();
}

function pauseGame() {
  if (game.state !== 'play') return;
  game.state = 'paused';
  sfx.engine(0, false);
  showScreen('pause');
}
function resumeGame() {
  if (game.state !== 'paused') return;
  game.state = 'play';
  showScreen(null);
  last = performance.now();
}
function toMenu() {
  game.state = 'menu';
  setPlayUI(false);
  startDemo();
  updateMenuInfo();
  showScreen('menu');
}
function openTracks() {
  renderTracks();
  showScreen('tracks');
}

// ===================================================================
// Eingabe
// ===================================================================
const ACTIONS = ['back', 'fwd', ...TRICK_KEYS];
function setAct(act, down) {
  if (game.state !== 'play') down = false;
  if (input[act] === down) return;
  input[act] = down;
  if (down) el.hint.classList.add('hidden');
  if (TRICK_KEYS.includes(act)) {
    trickOrder = trickOrder.filter((k) => k !== act);
    if (down) { trickOrder.push(act); if (bike.mode === 'air') sfx.trick(); }
  }
  const btn = document.querySelector('.ctl[data-act="' + act + '"]');
  if (btn) btn.classList.toggle('active', down);
}
function releaseAll() { ACTIONS.forEach((a) => setAct(a, false)); }

document.querySelectorAll('.ctl').forEach((btn) => {
  const act = btn.dataset.act;
  btn.addEventListener('pointerdown', (e) => {
    e.preventDefault();
    sfx.init();
    try { btn.setPointerCapture(e.pointerId); } catch (err) { /* ignore */ }
    setAct(act, true);
  });
  const up = (e) => { e.preventDefault(); setAct(act, false); };
  btn.addEventListener('pointerup', up);
  btn.addEventListener('pointercancel', up);
  btn.addEventListener('lostpointercapture', () => setAct(act, false));
  btn.addEventListener('contextmenu', (e) => e.preventDefault());
});

const KEYMAP = {
  ArrowLeft: 'back', a: 'back', A: 'back',
  ArrowRight: 'fwd', d: 'fwd', D: 'fwd',
  z: 'cancan', Z: 'cancan', y: 'cancan', Y: 'cancan',
  x: 'superman', X: 'superman', ArrowUp: 'superman',
  c: 'nacnac', C: 'nacnac',
  v: 'cliff', V: 'cliff', ArrowDown: 'cliff',
};
window.addEventListener('keydown', (e) => {
  if (e.target && e.target.tagName === 'INPUT') return;
  sfx.init();
  if (e.key === 'p' || e.key === 'P' || e.key === 'Escape') {
    if (game.state === 'play') pauseGame(); else if (game.state === 'paused') resumeGame();
    return;
  }
  if (e.key === 'Enter' || e.key === ' ') {
    if (game.state === 'over') { e.preventDefault(); startGame(); return; }
    if (game.state === 'menu' && $('screen-menu').classList.contains('active')) { e.preventDefault(); openTracks(); return; }
    if (game.state === 'paused') { resumeGame(); return; }
  }
  const act = KEYMAP[e.key];
  if (act) { e.preventDefault(); if (!e.repeat) setAct(act, true); }
});
window.addEventListener('keyup', (e) => {
  const act = KEYMAP[e.key];
  if (act) setAct(act, false);
});
window.addEventListener('blur', () => { releaseAll(); pauseGame(); });
document.addEventListener('visibilitychange', () => { if (document.hidden) { releaseAll(); pauseGame(); } });
document.addEventListener('contextmenu', (e) => e.preventDefault());

function updateSoundBtn() { $('btn-sound').textContent = sfx.muted ? '🔇 Sound aus' : '🔊 Sound an'; }
$('btn-start').addEventListener('click', () => { sfx.init(); sfx.click(); openTracks(); });
$('btn-howto').addEventListener('click', () => { sfx.init(); sfx.click(); showScreen('howto'); });
$('btn-scores').addEventListener('click', () => { sfx.init(); sfx.click(); scoreTab = store.data.lastTrack || 'arena'; renderScoreTabs(); showScreen('scores'); });
$('btn-sound').addEventListener('click', () => { sfx.init(); sfx.setMuted(!sfx.muted); updateSoundBtn(); sfx.click(); });
document.querySelectorAll('[data-goto]').forEach((b) => b.addEventListener('click', () => { sfx.click(); showScreen(b.dataset.goto); }));
$('btn-pause').addEventListener('click', () => { releaseAll(); pauseGame(); });
$('btn-resume').addEventListener('click', () => { sfx.click(); resumeGame(); });
$('btn-restart').addEventListener('click', () => { sfx.click(); startGame(game.trackId); });
$('btn-quit').addEventListener('click', () => { sfx.click(); toMenu(); });
$('btn-retry').addEventListener('click', () => { sfx.click(); startGame(game.trackId); });
$('btn-menu').addEventListener('click', () => { sfx.click(); toMenu(); });
$('btn-tracks').addEventListener('click', () => { sfx.click(); game.state = 'menu'; startDemo(); openTracks(); });
$('btn-next').addEventListener('click', () => { sfx.click(); startGame($('btn-next').dataset.track); });

// ===================================================================
// Hauptschleife
// ===================================================================
let last = performance.now();
let acc = 0;
let predTimer = 0;

function frame(now) {
  requestAnimationFrame(frame);
  let dt = (now - last) / 1000;
  last = now;
  dt = Math.min(dt, 0.05);
  const running = game.state === 'play' || game.state === 'menu' || game.state === 'over';

  if (running) {
    // Slow-Motion
    if (game.slowT > 0) { game.slowT -= dt; game.timeScale += (0.35 - game.timeScale) * Math.min(1, dt * 12); }
    else game.timeScale += (1 - game.timeScale) * Math.min(1, dt * 6);

    predTimer -= dt;
    if (bike.mode === 'air' && predTimer <= 0) { bike.pred = predictLanding(bike); predTimer = 0.03; }

    acc += dt * game.timeScale;
    let n = 0;
    while (acc >= FIXED_DT && n < 8) { step(FIXED_DT); acc -= FIXED_DT; n++; }
    if (n === 8) acc = 0;

    updateParticles(dt * game.timeScale);
    game.shake = Math.max(0, game.shake - dt * 2.4);
    game.cheer = Math.max(0, game.cheer - dt * 0.5);
    game.flash = Math.max(0, game.flash - dt * 2.5);
    updateCamera(dt);

    if (!game.demo) {
      game.dispScore += (game.score - game.dispScore) * Math.min(1, dt * 8);
      if (Math.abs(game.score - game.dispScore) < 1) game.dispScore = game.score;
      updateHud(false);
      updateCombo();
    }
    // Motor-Sound
    const b = bike;
    if (game.state === 'play' && b.mode !== 'crash') {
      const rpm = b.mode === 'air' ? 0.9 + 0.08 * Math.sin(game.time * 40) : clamp(b.s / 900, 0.15, 1) + (input.back ? 0.1 : 0);
      sfx.engine(rpm, true);
    } else sfx.engine(0, false);
  }
  try { render(dt); } catch (err) { if (!frame.warned) { frame.warned = true; console.error(err); } }
}

// ===================================================================
// Start
// ===================================================================
resize();
updateSoundBtn();
updateMenuInfo();
startDemo();
requestAnimationFrame(frame);

if ('serviceWorker' in navigator && location.protocol.startsWith('http')) {
  window.addEventListener('load', () => navigator.serviceWorker.register('sw.js').catch(() => {}));
}

// Debug / Tests
window.FMX = { game, bike, input, ai, T, TRACKS, buildTrack, trackInfo, medalFor, endGame, step, predictLanding, startGame, terrainY, slopeAt, setAct, store, view, pal, get parts() { return parts; } };
})();
