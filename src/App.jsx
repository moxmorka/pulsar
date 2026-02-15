// App.jsx
import React from "react";
import { RotateCcw, Download, Play, Square, Palette } from "lucide-react";

/* =======================
   Utilities
======================= */
const clamp = (v, a, b) => Math.max(a, Math.min(b, v));
const lerp = (a, b, t) => a + (b - a) * t;

function isHexColor(s) {
  return /^#([0-9a-fA-F]{3}|[0-9a-fA-F]{6})$/.test(s);
}
function hexToRgb(hex) {
  if (!hex) return null;
  let h = String(hex).replace("#", "");
  if (h.length === 3) h = h.split("").map((c) => c + c).join("");
  if (h.length !== 6) return null;
  const n = parseInt(h, 16);
  return { r: (n >> 16) & 255, g: (n >> 8) & 255, b: n & 255 };
}
function rgbToHex({ r, g, b }) {
  const to2 = (n) => clamp(Math.round(n), 0, 255).toString(16).padStart(2, "0");
  return `#${to2(r)}${to2(g)}${to2(b)}`;
}
function luminance01({ r, g, b }) {
  return clamp((0.2126 * r + 0.7152 * g + 0.0722 * b) / 255, 0, 1);
}
function hue01({ r, g, b }) {
  const rr = r / 255,
    gg = g / 255,
    bb = b / 255;
  const mx = Math.max(rr, gg, bb);
  const mn = Math.min(rr, gg, bb);
  const d = mx - mn;
  if (d === 0) return 0;
  let h = 0;
  if (mx === rr) h = ((gg - bb) / d) % 6;
  else if (mx === gg) h = (bb - rr) / d + 2;
  else h = (rr - gg) / d + 4;
  h /= 6;
  if (h < 0) h += 1;
  return h;
}
function midiToFreq(m) {
  return 440 * Math.pow(2, (m - 69) / 12);
}
function nowSec() {
  return performance.now() * 0.001;
}

/* =======================
   Variable grid density
======================= */
const gaussian = (x, sigma) => {
  const s2 = (sigma * sigma) || 1e-6;
  return Math.exp(-(x * x) / (2 * s2));
};
function buildVariableEdges(count, focus, strength, sigma) {
  const n = Math.max(1, count);
  const f = clamp(focus ?? 0.5, 0, 1);
  const st = Math.max(0, strength ?? 0);
  const sg = clamp(sigma ?? 0.18, 0.03, 0.6);

  const w = new Array(n);
  let sum = 0;
  for (let i = 0; i < n; i++) {
    const u = (i + 0.5) / n;
    const g = gaussian(u - f, sg);
    const wi = 1 / (1 + st * g);
    w[i] = wi;
    sum += wi;
  }
  if (sum <= 0) return Array.from({ length: n + 1 }, (_, i) => i / n);

  const edges = new Array(n + 1);
  edges[0] = 0;
  let acc = 0;
  for (let i = 0; i < n; i++) {
    acc += w[i] / sum;
    edges[i + 1] = acc;
  }
  edges[n] = 1;
  return edges;
}
function findIndexFromEdges(edges, v01) {
  const v = clamp(v01, 0, 1);
  let lo = 0;
  let hi = edges.length - 2;
  while (lo <= hi) {
    const mid = (lo + hi) >> 1;
    if (v < edges[mid]) hi = mid - 1;
    else if (v >= edges[mid + 1]) lo = mid + 1;
    else return mid;
  }
  return clamp(lo, 0, edges.length - 2);
}

/* =======================
   Music: always in key
======================= */
const NOTE_NAMES = ["C", "C#", "D", "D#", "E", "F", "F#", "G", "G#", "A", "A#", "B"];

const SCALES = {
  major: [0, 2, 4, 5, 7, 9, 11],
  naturalMinor: [0, 2, 3, 5, 7, 8, 10],
  harmonicMinor: [0, 2, 3, 5, 7, 8, 11],
  dorian: [0, 2, 3, 5, 7, 9, 10],
  phrygian: [0, 1, 3, 5, 7, 8, 10],
  lydian: [0, 2, 4, 6, 7, 9, 11],
  mixolydian: [0, 2, 4, 5, 7, 9, 10],
  locrian: [0, 1, 3, 5, 6, 8, 10],
};

function buildScaleMidi({ rootPc, scaleName, baseMidi, degreesCount }) {
  const ints = SCALES[scaleName] ?? SCALES.major;
  const out = [];
  for (let i = 0; i < degreesCount; i++) {
    const oct = Math.floor(i / ints.length);
    const deg = i % ints.length;
    out.push(baseMidi + rootPc + ints[deg] + 12 * oct);
  }
  return out;
}

function degreeToChordTones(scaleMidi, degreeIndex, chordType = "7") {
  const steps = chordType === "triad" ? [0, 2, 4] : [0, 2, 4, 6];
  const tones = [];
  for (const st of steps) {
    const idx = degreeIndex + st;
    tones.push(scaleMidi[idx] ?? scaleMidi[scaleMidi.length - 1]);
  }
  return tones;
}

// snap midi note to current key+scale (nearest)
function quantizeMidiToScale(m, rootPc, scaleName) {
  const ints = SCALES[scaleName] ?? SCALES.major;
  const pc = ((m % 12) + 12) % 12;
  // allowed pcs for this key
  const allowed = ints.map((x) => (x + rootPc) % 12);
  let best = m;
  let bestDist = 1e9;
  for (let delta = -12; delta <= 12; delta++) {
    const mm = m + delta;
    const p = ((mm % 12) + 12) % 12;
    if (!allowed.includes(p)) continue;
    const d = Math.abs(delta);
    if (d < bestDist) {
      bestDist = d;
      best = mm;
    }
  }
  return best;
}

/* =======================
   Color String (animated)
======================= */
function stableRand01(seed) {
  // deterministic pseudo random 0..1
  const x = Math.sin(seed * 999.123 + seed * seed * 0.017) * 43758.5453;
  return x - Math.floor(x);
}
function colorSeqIndexAtTime({ t, r, c, seed, len, behave, speed }) {
  if (len <= 1) return 0;
  const tt = t * (speed || 1);
  const mode = behave === "same" ? "wave" : behave;

  if (mode === "cycle") return (Math.floor(tt * 3) + r + c) % len;

  if (mode === "wave") {
    const wv = Math.sin((c * 0.5 + r * 0.33 + tt + seed * 0.5) * 0.8);
    return clamp(Math.floor((wv + 1) * 0.5 * len), 0, len - 1);
  }

  // random-ish but stable
  const sd = r * 1000 + c * 7 + Math.floor(tt * 2) + Math.floor(seed * 100);
  return clamp(Math.floor((Math.sin(sd) * 0.5 + 0.5) * len), 0, len - 1);
}

/* =======================
   Sound engines
   - One AudioContext
   - Two layers: melodic + percussion
======================= */
function createReverbImpulse(ac, seconds = 2.2, decay = 2.0) {
  const rate = ac.sampleRate;
  const len = Math.max(1, Math.floor(seconds * rate));
  const impulse = ac.createBuffer(2, len, rate);
  for (let ch = 0; ch < 2; ch++) {
    const data = impulse.getChannelData(ch);
    for (let i = 0; i < len; i++) {
      const t = i / len;
      data[i] = (Math.random() * 2 - 1) * Math.pow(1 - t, decay);
    }
  }
  return impulse;
}

/* ===== Melodic voice (Plaits-ish feel) ===== */
function makeMelodicVoice(ac) {
  const osc = ac.createOscillator();
  const sub = ac.createOscillator();
  const shaper = ac.createWaveShaper();
  const filter = ac.createBiquadFilter();
  const amp = ac.createGain();

  osc.type = "sawtooth";
  sub.type = "triangle";

  // gentle waveshaper
  shaper.oversample = "2x";
  const mkCurve = (amt) => {
    const k = clamp(amt ?? 0.35, 0, 1) * 35;
    const n = 2048;
    const curve = new Float32Array(n);
    for (let i = 0; i < n; i++) {
      const x = (i * 2) / (n - 1) - 1;
      curve[i] = Math.tanh(x * (1 + k));
    }
    return curve;
  };
  shaper.curve = mkCurve(0.35);

  filter.type = "lowpass";
  filter.Q.value = 0.7;

  amp.gain.value = 0.0001;

  // mix osc + sub
  const mix = ac.createGain();
  mix.gain.value = 1.0;

  osc.connect(mix);
  sub.connect(mix);

  mix.connect(shaper);
  shaper.connect(filter);
  filter.connect(amp);

  osc.start();
  sub.start();

  return { osc, sub, shaper, filter, amp, mkCurve };
}

function triggerMelodicVoice(ac, voice, p) {
  const now = ac.currentTime;

  const freq = clamp(p.freq ?? 220, 20, 20000);
  const vel = clamp(p.vel ?? 0.5, 0.0001, 1);
  const cutoffHz = clamp(p.cutoffHz ?? 2000, 80, 18000);

  const attack = clamp(p.attack ?? 0.008, 0.001, 0.25);
  const decay = clamp(p.decay ?? 0.18, 0.01, 2.5);
  const release = clamp(p.release ?? 0.12, 0.01, 3.0);

  const subAmt = clamp(p.subAmt ?? 0.25, 0, 0.8);
  const drive = clamp(p.drive ?? 0.35, 0, 1);

  // pitch + subtle detune feel by modding sub ratio
  voice.osc.frequency.setValueAtTime(freq, now);
  voice.sub.frequency.setValueAtTime(freq * 0.5, now);
  voice.sub.detune.setValueAtTime(lerp(-6, 6, subAmt), now);

  // drive
  voice.shaper.curve = voice.mkCurve(drive);

  // filter
  voice.filter.frequency.cancelScheduledValues(now);
  voice.filter.frequency.setValueAtTime(cutoffHz, now);

  // amp envelope
  const g = voice.amp.gain;
  g.cancelScheduledValues(now);
  g.setValueAtTime(0.0001, now);
  g.exponentialRampToValueAtTime(vel, now + attack);
  g.exponentialRampToValueAtTime(Math.max(0.00012, vel * 0.55), now + attack + decay);
  g.exponentialRampToValueAtTime(0.0001, now + attack + decay + release);
}

/* ===== Percussion voice (Taiko-ish / physical-ish) ===== */
function makePercVoice(ac) {
  // noise burst
  const noiseBuf = ac.createBuffer(1, ac.sampleRate * 0.5, ac.sampleRate);
  {
    const data = noiseBuf.getChannelData(0);
    for (let i = 0; i < data.length; i++) data[i] = (Math.random() * 2 - 1) * 0.8;
  }
  const noise = ac.createBufferSource();
  noise.buffer = noiseBuf;
  noise.loop = true;

  // resonator
  const bp = ac.createBiquadFilter();
  bp.type = "bandpass";
  bp.Q.value = 12;

  const lp = ac.createBiquadFilter();
  lp.type = "lowpass";
  lp.frequency.value = 8000;

  // waveguide-ish feedback delay
  const dly = ac.createDelay(0.25);
  const fb = ac.createGain();
  fb.gain.value = 0.25;
  dly.connect(fb);
  fb.connect(dly);

  // amp
  const amp = ac.createGain();
  amp.gain.value = 0.0001;

  // routing: noise -> bp -> lp -> (dry + waveguide) -> amp
  noise.connect(bp);
  bp.connect(lp);

  const dry = ac.createGain();
  dry.gain.value = 1.0;

  lp.connect(dry);
  lp.connect(dly);

  const mix = ac.createGain();
  mix.gain.value = 1.0;

  dry.connect(mix);
  dly.connect(mix);

  mix.connect(amp);

  noise.start();

  return { noise, bp, lp, dly, fb, amp };
}

function triggerPercVoice(ac, voice, p) {
  const now = ac.currentTime;

  const vel = clamp(p.vel ?? 0.7, 0.0001, 1);
  const freq = clamp(p.freq ?? 180, 30, 2000);
  const tone = clamp(p.tone ?? 0.6, 0, 1);
  const body = clamp(p.body ?? 0.6, 0, 1);

  const attack = clamp(p.attack ?? 0.0015, 0.0005, 0.05);
  const decay = clamp(p.decay ?? 0.12, 0.02, 2.0);
  const release = clamp(p.release ?? 0.08, 0.01, 2.0);

  // resonator tuning + damping
  voice.bp.frequency.setValueAtTime(freq, now);
  voice.bp.Q.setValueAtTime(lerp(6, 22, body), now);

  voice.lp.frequency.setValueAtTime(lerp(1500, 12000, tone), now);

  // waveguide settings
  voice.dly.delayTime.setValueAtTime(clamp(1 / (freq * 0.8), 0.004, 0.22), now);
  voice.fb.gain.setValueAtTime(clamp(lerp(0.12, 0.62, body) * (0.7 + tone * 0.3), 0, 0.92), now);

  // envelope
  const g = voice.amp.gain;
  g.cancelScheduledValues(now);
  g.setValueAtTime(0.0001, now);
  g.exponentialRampToValueAtTime(vel, now + attack);
  g.exponentialRampToValueAtTime(0.0001, now + attack + decay + release);
}

/* =======================
   Main App
======================= */
export default function App() {
  const canvasRef = React.useRef(null);
  const rafRef = React.useRef(null);

  // layer cells: each cell stores either fixed color or "seq" (animated)
  // { idx, r, c, paint: { mode:'fixed'|'seq', color?, seed, createdAt, vel01?, len01? } }
  const [cellsA, setCellsA] = React.useState([]); // melodic layer paint
  const [cellsB, setCellsB] = React.useState([]); // perc layer paint
  const cellsARef = React.useRef([]);
  const cellsBRef = React.useRef([]);
  React.useEffect(() => void (cellsARef.current = cellsA), [cellsA]);
  React.useEffect(() => void (cellsBRef.current = cellsB), [cellsB]);

  const [panelOpen, setPanelOpen] = React.useState(false);

  // painting
  const [paint, setPaint] = React.useState({
    layer: "melodic", // melodic | perc
    mode: "color", // color | none
    color: "#111111",
    useSeq: true,
  });
  const [drawing, setDrawing] = React.useState(false);

  const [s, setS] = React.useState({
    // visual
    pat: "swiss-grid", // swiss-grid | char-grid
    view: "both", // melodic | perc | both
    ghostOther: 0.35,
    darkMode: false,

    // char-grid
    space: 42,
    charSz: 22,
    chars: "01",
    charSpd: 2.0,

    // swiss-grid
    cols: 12,
    rows: 16,
    gridLines: true,
    swissCharScale: 1.0,

    // variable density
    varColsOn: false,
    colFocus: 0.5,
    colStrength: 6,
    colSigma: 0.18,

    varRowsOn: false,
    rowFocus: 0.5,
    rowStrength: 6,
    rowSigma: 0.18,

    // color string
    colorSeq: ["#111111", "#ff0055", "#00c2ff", "#00ff88", "#ffe600"],
    colorSeqSpeed: 1.0,
    colorSeqBehave: "same", // same | cycle | wave | random

    // ======= AUDIO GLOBAL =======
    soundOn: true,
    bpm: 120,

    // master + global FX
    master: 0.85,

    reverbOn: true,
    reverbMix: 0.22,
    reverbTime: 2.2,

    delayOn: true,
    delayMix: 0.18,
    delayTime: 0.28,
    delayFeedback: 0.35,

    // ======= MELODIC (Plaits-ish) =======
    melodicOn: true,
    voicesA: 14,
    maxNotesPerStepA: 8,

    keyRoot: 0,
    scaleName: "naturalMinor",
    baseMidi: 36,
    octaveSpan: 4,
    chordType: "7",
    prog: [0, 5, 3, 6],
    progRate: 4,

    laneMode: "hue", // column | hue

    cutoffBaseA: 350,
    cutoffSpanA: 9000,
    decayBaseA: 0.07,
    decaySpanA: 0.55,
    subAmtA: 0.25,
    driveA: 0.35,

    // ======= PERCUSSION (Taiko-ish) =======
    percOn: true,
    voicesB: 10,
    maxHitsPerStepB: 6,
    percDensity: 1.0, // 0..2
    percTone: 0.65, // 0..1
    percBody: 0.65, // 0..1
    percBaseHz: 70,
    percSpanHz: 360,
    percDecayBase: 0.05,
    percDecaySpan: 0.25,

    // ======= MIDI =======
    midiOn: true,
    midiPaint: true,
    midiThruToAudio: true,
    midiChannel: "all", // all | 1..16
    midiSpread: 1.0, // how much to spread notes across columns
  });

  const sRef = React.useRef(s);
  React.useEffect(() => void (sRef.current = s), [s]);

  const palette = React.useMemo(() => {
    const arr = Array.isArray(s.colorSeq) ? s.colorSeq : [];
    const fixed = arr.map((x) => (isHexColor(x) ? x : "#111111")).slice(0, 5);
    while (fixed.length < 5) fixed.push("#111111");
    return fixed;
  }, [s.colorSeq]);

  // variable edges for swiss-grid
  const colEdges = React.useMemo(() => {
    if (s.pat !== "swiss-grid") return null;
    return s.varColsOn
      ? buildVariableEdges(s.cols, s.colFocus, s.colStrength, s.colSigma)
      : Array.from({ length: s.cols + 1 }, (_, i) => i / s.cols);
  }, [s.pat, s.cols, s.varColsOn, s.colFocus, s.colStrength, s.colSigma]);

  const rowEdges = React.useMemo(() => {
    if (s.pat !== "swiss-grid") return null;
    return s.varRowsOn
      ? buildVariableEdges(s.rows, s.rowFocus, s.rowStrength, s.rowSigma)
      : Array.from({ length: s.rows + 1 }, (_, i) => i / s.rows);
  }, [s.pat, s.rows, s.varRowsOn, s.rowFocus, s.rowStrength, s.rowSigma]);

  function swissCellGeom(r, c, w, h) {
    const ce = colEdges || Array.from({ length: s.cols + 1 }, (_, i) => i / s.cols);
    const re = rowEdges || Array.from({ length: s.rows + 1 }, (_, i) => i / s.rows);
    const x0 = ce[c] * w;
    const x1 = ce[c + 1] * w;
    const y0 = re[r] * h;
    const y1 = re[r + 1] * h;
    return { x: x0, y: y0, w: x1 - x0, h: y1 - y0, cx: (x0 + x1) / 2, cy: (y0 + y1) / 2 };
  }

  // pointer to canvas coords
  const pointerToCanvas = (e) => {
    const cv = canvasRef.current;
    const r = cv.getBoundingClientRect();
    const x = (e.clientX - r.left) * (cv.width / r.width);
    const y = (e.clientY - r.top) * (cv.height / r.height);
    return { x, y };
  };

  // index lookup
  const getSwissIdx = React.useCallback(
    (cx, cy) => {
      const cv = canvasRef.current;
      if (!cv) return null;
      const x01 = cx / cv.width;
      const y01 = cy / cv.height;
      const ce = colEdges || Array.from({ length: s.cols + 1 }, (_, i) => i / s.cols);
      const re = rowEdges || Array.from({ length: s.rows + 1 }, (_, i) => i / s.rows);
      const col = findIndexFromEdges(ce, x01);
      const row = findIndexFromEdges(re, y01);
      if (col < 0 || row < 0 || col >= s.cols || row >= s.rows) return null;
      return { idx: row * s.cols + col, row, col };
    },
    [s.cols, s.rows, colEdges, rowEdges]
  );

  const getCharGridIdx = React.useCallback(
    (cx, cy) => {
      const cv = canvasRef.current;
      if (!cv) return null;
      const cols = Math.max(1, Math.floor(cv.width / s.space));
      const rows = Math.max(1, Math.floor(cv.height / s.space));
      const col = Math.floor(cx / s.space);
      const row = Math.floor(cy / s.space);
      if (col < 0 || row < 0 || col >= cols || row >= rows) return null;
      return { idx: row * cols + col, row, col, cols, rows };
    },
    [s.space]
  );

  const getIdx = React.useCallback(
    (cx, cy) => {
      if (s.pat === "swiss-grid") return getSwissIdx(cx, cy);
      if (s.pat === "char-grid") return getCharGridIdx(cx, cy);
      return null;
    },
    [s.pat, getSwissIdx, getCharGridIdx]
  );

  function upsertCell(setter, idx, patch) {
    setter((prev) => {
      const ex = prev.findIndex((c) => c.idx === idx);
      const next = [...prev];
      if (ex >= 0) next[ex] = { ...next[ex], ...patch };
      else next.push({ idx, ...patch });
      return next;
    });
  }
  function removeCell(setter, idx) {
    setter((prev) => prev.filter((c) => c.idx !== idx));
  }

  function targetLayerSetter() {
    return paint.layer === "perc" ? setCellsB : setCellsA;
  }

  function applyPaintAt({ idx, row, col }) {
    const setter = targetLayerSetter();
    if (idx == null) return;

    if (paint.mode === "none") {
      removeCell(setter, idx);
      return;
    }

    const t = nowSec();
    if (paint.useSeq) {
      const seed = stableRand01(idx + row * 13.1 + col * 7.7);
      upsertCell(setter, idx, {
        r: row,
        c: col,
        paint: { mode: "seq", seed, createdAt: t },
      });
    } else {
      upsertCell(setter, idx, {
        r: row,
        c: col,
        paint: { mode: "fixed", color: paint.color, createdAt: t },
      });
    }
  }

  /* =======================
     AUDIO GRAPH
======================= */
  const audioRef = React.useRef({
    ac: null,
    // master + global fx
    master: null,
    dry: null,
    wetRev: null,
    wetDel: null,
    convolver: null,
    delay: null,
    feedback: null,

    // melodic bus
    busA: null,
    voicesA: [],
    voicePtrA: 0,

    // perc bus
    busB: null,
    voicesB: [],
    voicePtrB: 0,

    // scheduler
    running: false,
    step: 0,
    timer: null,

    // MIDI
    midi: null,
    midiInputs: [],
    midiInputId: "",
    midiWriteHead: 0,
    activeMidi: new Map(), // note -> {tOn, col, row, layer}
  });

  function ensureAudio() {
    const A = audioRef.current;
    if (!A.ac) {
      const ac = new (window.AudioContext || window.webkitAudioContext)();

      // master
      const master = ac.createGain();
      master.gain.value = 0.85;

      // global fx sends
      const dry = ac.createGain();
      const wetRev = ac.createGain();
      const wetDel = ac.createGain();

      // reverb
      const convolver = ac.createConvolver();
      convolver.buffer = createReverbImpulse(ac, sRef.current.reverbTime, 2.0);

      // delay
      const delay = ac.createDelay(2.0);
      const feedback = ac.createGain();
      feedback.gain.value = clamp(sRef.current.delayFeedback, 0, 0.95);
      delay.delayTime.value = clamp(sRef.current.delayTime, 0.01, 1.5);
      delay.connect(feedback);
      feedback.connect(delay);

      // layer busses
      const busA = ac.createGain();
      const busB = ac.createGain();
      busA.gain.value = 1.0;
      busB.gain.value = 1.0;

      // routing:
      // busA + busB -> (dry + fx) -> master -> destination
      busA.connect(dry);
      busA.connect(convolver);
      busA.connect(delay);

      busB.connect(dry);
      busB.connect(convolver);
      busB.connect(delay);

      convolver.connect(wetRev);
      delay.connect(wetDel);

      dry.connect(master);
      wetRev.connect(master);
      wetDel.connect(master);

      master.connect(ac.destination);

      A.ac = ac;
      A.master = master;
      A.dry = dry;
      A.wetRev = wetRev;
      A.wetDel = wetDel;
      A.convolver = convolver;
      A.delay = delay;
      A.feedback = feedback;

      A.busA = busA;
      A.busB = busB;

      A.voicesA = [];
      A.voicePtrA = 0;
      A.voicesB = [];
      A.voicePtrB = 0;

      A.running = false;
      A.step = 0;
      A.timer = null;
      A.midiWriteHead = 0;
      A.activeMidi = new Map();
    }
    return A;
  }

  async function unlockAudio() {
    const A = ensureAudio();
    if (A.ac && A.ac.state === "suspended") {
      try {
        await A.ac.resume();
      } catch {}
    }
  }

  function ensureVoices() {
    const A = ensureAudio();
    const ac = A.ac;
    const st = sRef.current;

    // melodic
    const wantA = clamp(st.voicesA ?? 14, 1, 32);
    if (A.voicesA.length !== wantA) {
      const pool = Array.from({ length: wantA }, () => {
        const v = makeMelodicVoice(ac);
        v.amp.connect(A.busA);
        return v;
      });
      A.voicesA = pool;
      A.voicePtrA = 0;
    }

    // perc
    const wantB = clamp(st.voicesB ?? 10, 1, 32);
    if (A.voicesB.length !== wantB) {
      const pool = Array.from({ length: wantB }, () => {
        const v = makePercVoice(ac);
        v.amp.connect(A.busB);
        return v;
      });
      A.voicesB = pool;
      A.voicePtrB = 0;
    }
  }

  function updateAudioParamsRealtime() {
    const A = audioRef.current;
    if (!A.ac) return;
    const ac = A.ac;
    const st = sRef.current;

    // master
    A.master.gain.setTargetAtTime(clamp(st.master, 0, 1.2), ac.currentTime, 0.02);

    // global FX
    A.wetRev.gain.setTargetAtTime(st.reverbOn ? clamp(st.reverbMix, 0, 1) : 0, ac.currentTime, 0.03);
    A.wetDel.gain.setTargetAtTime(st.delayOn ? clamp(st.delayMix, 0, 1) : 0, ac.currentTime, 0.03);

    if (A._revTime == null) A._revTime = st.reverbTime;
    if (Math.abs(st.reverbTime - A._revTime) > 0.12) {
      A._revTime = st.reverbTime;
      A.convolver.buffer = createReverbImpulse(ac, clamp(st.reverbTime, 0.3, 6), 2.0);
    }

    A.delay.delayTime.setTargetAtTime(clamp(st.delayTime, 0.01, 1.5), ac.currentTime, 0.03);
    A.feedback.gain.setTargetAtTime(clamp(st.delayFeedback, 0, 0.95), ac.currentTime, 0.03);

    // layer on/off
    A.busA.gain.setTargetAtTime(st.melodicOn ? 1 : 0, ac.currentTime, 0.02);
    A.busB.gain.setTargetAtTime(st.percOn ? 1 : 0, ac.currentTime, 0.02);
  }

  React.useEffect(() => {
    // keep params hot when sliders change (but do not auto-start audio)
    if (audioRef.current.ac) {
      ensureVoices();
      updateAudioParamsRealtime();
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [s]);

  /* =======================
     Cell color resolver (animated seq)
======================= */
  function resolveCellColor(cell, t, st) {
    const p = cell?.paint;
    if (!p) return null;
    if (p.mode === "fixed") return p.color || null;
    if (p.mode === "seq") {
      const len = palette.length;
      const idx = colorSeqIndexAtTime({
        t,
        r: cell.r ?? 0,
        c: cell.c ?? 0,
        seed: p.seed ?? 0.1,
        len,
        behave: st.colorSeqBehave,
        speed: st.colorSeqSpeed,
      });
      return palette[idx] || "#111111";
    }
    return null;
  }

  /* =======================
     Scheduler
     - uses swiss/char dims
     - columns density changes rhythm
     - rows density changes envelope tail etc.
======================= */
  function startScheduler() {
    const A = ensureAudio();
    const ac = A.ac;

    A.running = true;

    const tick = () => {
      if (!audioRef.current.running) return;

      const st = sRef.current;
      if (!st.soundOn) {
        audioRef.current.timer = setTimeout(tick, 40);
        return;
      }

      ensureVoices();
      updateAudioParamsRealtime();

      // grid dims
      let cols = 1,
        rows = 1;
      const isSwiss = st.pat === "swiss-grid";

      if (isSwiss) {
        cols = Math.max(1, st.cols | 0);
        rows = Math.max(1, st.rows | 0);
      } else {
        const cv = canvasRef.current;
        if (cv) {
          cols = Math.max(1, Math.floor(cv.width / st.space));
          rows = Math.max(1, Math.floor(cv.height / st.space));
        } else {
          cols = 16;
          rows = 12;
        }
      }

      // base step from BPM
      const bpm = clamp(st.bpm ?? 120, 30, 260);
      const baseStepSec = 60 / bpm / 2; // 8th feel
      let stepSec = baseStepSec;

      // columns density -> rhythm
      if (isSwiss && st.varColsOn) {
        const ce = colEdges || Array.from({ length: cols + 1 }, (_, i) => i / cols);
        const col = audioRef.current.step % cols;
        const w = ce[col + 1] - ce[col];
        const avg = 1 / cols;
        const ratio = clamp(w / avg, 0.35, 2.6);
        stepSec = baseStepSec * ratio;
      }

      const t = nowSec();
      const col = audioRef.current.step % cols;

      // build fast lookups
      const mapA = new Map();
      const mapB = new Map();
      for (const c of cellsARef.current) mapA.set(c.idx, c);
      for (const c of cellsBRef.current) mapB.set(c.idx, c);

      /* ===== MELODIC LAYER ===== */
      if (st.melodicOn) {
        // chord progression
        const prog = Array.isArray(st.prog) && st.prog.length ? st.prog : [0, 5, 3, 6];
        const progRate = Math.max(1, st.progRate | 0);
        const chordIndex = Math.floor(col / progRate) % prog.length;
        const chordDegree = ((prog[chordIndex] | 0) % 7 + 7) % 7;

        const degreesCount = 7 * clamp(st.octaveSpan ?? 4, 1, 7);
        const scaleMidi = buildScaleMidi({
          rootPc: clamp(st.keyRoot ?? 0, 0, 11),
          scaleName: st.scaleName,
          baseMidi: clamp(st.baseMidi ?? 36, 12, 72),
          degreesCount,
        });

        const chordTones = degreeToChordTones(scaleMidi, chordDegree, st.chordType === "triad" ? "triad" : "7");

        const hits = [];
        for (let r = 0; r < rows; r++) {
          const idx = r * cols + col;
          const cell = mapA.get(idx);
          if (!cell?.paint) continue;

          const color = resolveCellColor(cell, t, st);
          const rgb = hexToRgb(color);
          if (!rgb) continue;

          const lum = luminance01(rgb);
          const h = hue01(rgb);

          // lane from hue or column
          let lane = 0;
          if (st.laneMode === "hue") {
            lane = clamp(Math.floor(h * chordTones.length), 0, chordTones.length - 1);
          } else {
            lane = col % chordTones.length;
          }

          // row pitch mapping (top = higher)
          const rowNorm = rows <= 1 ? 0.5 : 1 - r / (rows - 1);
          const degIdx = clamp(Math.round(rowNorm * (degreesCount - 1)), 0, degreesCount - 1);
          const rowMidi = scaleMidi[degIdx];

          let target = chordTones[lane];
          while (target < rowMidi - 6) target += 12;
          while (target > rowMidi + 6) target -= 12;

          const freq = midiToFreq(target);

          // envelope: rows affect attack/release, density affects tail
          let attack = 0.004 + 0.06 * (1 - rowNorm); // top faster
          let release = 0.05 + 0.45 * rowNorm; // bottom longer

          // base decay from luminance
          let decay =
            (st.decayBaseA ?? 0.07) +
            (st.decaySpanA ?? 0.55) * clamp(0.2 + 0.8 * lum, 0, 1);

          // variable row density -> tail
          if (isSwiss && st.varRowsOn) {
            const re = rowEdges || Array.from({ length: rows + 1 }, (_, i) => i / rows);
            const rh = re[r + 1] - re[r];
            const avg = 1 / rows;
            const ratio = clamp(rh / avg, 0.35, 2.6);
            decay *= clamp(ratio, 0.55, 1.85);
            release *= clamp(ratio, 0.7, 1.6);
          }

          const vel = clamp(0.06 + 0.94 * lum, 0.05, 1);
          const cutoffHz =
            (st.cutoffBaseA ?? 350) +
            (st.cutoffSpanA ?? 9000) * clamp(0.2 + 0.8 * lum, 0, 1);

          hits.push({
            freq,
            vel,
            cutoffHz,
            attack,
            decay,
            release,
            subAmt: st.subAmtA,
            drive: st.driveA,
            score: vel + rowNorm * 0.08,
          });
        }

        hits.sort((a, b) => b.score - a.score);
        const chosen = hits.slice(0, clamp(st.maxNotesPerStepA ?? 8, 1, 32));
        const pool = audioRef.current.voicesA;

        for (const h of chosen) {
          const v = pool[audioRef.current.voicePtrA % pool.length];
          audioRef.current.voicePtrA++;
          triggerMelodicVoice(ac, v, h);
        }
      }

      /* ===== PERCUSSION LAYER ===== */
      if (st.percOn) {
        // perc uses its own selection, can be denser depending on knob
        const hits = [];
        for (let r = 0; r < rows; r++) {
          const idx = r * cols + col;
          const cell = mapB.get(idx);
          if (!cell?.paint) continue;

          const color = resolveCellColor(cell, t, st);
          const rgb = hexToRgb(color);
          if (!rgb) continue;

          const lum = luminance01(rgb);
          const rowNorm = rows <= 1 ? 0.5 : 1 - r / (rows - 1);

          // frequency range, bottom = lower drum
          const hz = (st.percBaseHz ?? 70) + (st.percSpanHz ?? 360) * clamp(rowNorm, 0, 1);

          // envelopes
          let decay = (st.percDecayBase ?? 0.05) + (st.percDecaySpan ?? 0.25) * clamp(lum, 0, 1);
          let attack = 0.001 + 0.02 * (1 - rowNorm);
          let release = 0.03 + 0.22 * rowNorm;

          // var row density -> tail on percussion too
          if (isSwiss && st.varRowsOn) {
            const re = rowEdges || Array.from({ length: rows + 1 }, (_, i) => i / rows);
            const rh = re[r + 1] - re[r];
            const avg = 1 / rows;
            const ratio = clamp(rh / avg, 0.35, 2.6);
            decay *= clamp(ratio, 0.65, 1.8);
            release *= clamp(ratio, 0.75, 1.5);
          }

          // “density” knob multiplies likelihood by luminance
          const prob = clamp((st.percDensity ?? 1.0) * (0.25 + lum * 0.9), 0, 1.8);
          const gate = stableRand01(idx + Math.floor(t * 10)) < clamp(prob, 0, 1);

          if (!gate && prob <= 1) continue; // probabilistic sparsity

          const vel = clamp(0.08 + 0.92 * lum, 0.05, 1);

          hits.push({
            freq: hz,
            vel: vel * 0.95,
            tone: st.percTone ?? 0.65,
            body: st.percBody ?? 0.65,
            attack,
            decay,
            release,
            score: vel + (1 - rowNorm) * 0.06,
          });
        }

        hits.sort((a, b) => b.score - a.score);
        const chosen = hits.slice(0, clamp(st.maxHitsPerStepB ?? 6, 1, 32));
        const pool = audioRef.current.voicesB;

        for (const h of chosen) {
          const v = pool[audioRef.current.voicePtrB % pool.length];
          audioRef.current.voicePtrB++;
          triggerPercVoice(ac, v, h);
        }
      }

      audioRef.current.step++;
      audioRef.current.timer = setTimeout(tick, Math.max(10, stepSec * 1000));
    };

    if (A.timer) clearTimeout(A.timer);
    A.timer = setTimeout(tick, 0);
  }

  function stopScheduler() {
    const A = audioRef.current;
    A.running = false;
    if (A.timer) clearTimeout(A.timer);
    A.timer = null;
  }

  React.useEffect(() => {
    startScheduler();
    return () => stopScheduler();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  /* =======================
     MIDI (WebMIDI)
     - note -> row, col spread
     - velocity -> brightness
     - duration -> saturation/contrast
======================= */
  function velToColor(vel01, len01, palette) {
    // map velocity to palette blend + brightness
    const a = palette[1] || "#ff0055";
    const b = palette[2] || "#00c2ff";
    const c = palette[3] || "#00ff88";
    const d = palette[4] || "#ffe600";

    const pick = vel01 < 0.33 ? a : vel01 < 0.66 ? b : c;
    const base = hexToRgb(pick) || { r: 120, g: 120, b: 120 };
    const hi = hexToRgb(d) || { r: 255, g: 230, b: 0 };

    const mix = lerp(0.15, 0.65, clamp(len01, 0, 1)); // longer -> more “highlight”
    const out = {
      r: lerp(base.r, hi.r, mix) * lerp(0.55, 1.1, vel01),
      g: lerp(base.g, hi.g, mix) * lerp(0.55, 1.1, vel01),
      b: lerp(base.b, hi.b, mix) * lerp(0.55, 1.1, vel01),
    };
    return rgbToHex(out);
  }

  function gridDimsForMidi(st) {
    let cols = 12,
      rows = 16;
    if (st.pat === "swiss-grid") {
      cols = Math.max(1, st.cols | 0);
      rows = Math.max(1, st.rows | 0);
    } else {
      const cv = canvasRef.current;
      if (cv) {
        cols = Math.max(1, Math.floor(cv.width / st.space));
        rows = Math.max(1, Math.floor(cv.height / st.space));
      }
    }
    return { cols, rows };
  }

  function midiNoteToRow(note, rows, st) {
    // snap to scale and then map pitch range to rows
    const q = quantizeMidiToScale(note, st.keyRoot, st.scaleName);

    // choose a musical range around baseMidi..baseMidi+octaves
    const degreesCount = 7 * clamp(st.octaveSpan ?? 4, 1, 7);
    const scaleMidi = buildScaleMidi({
      rootPc: clamp(st.keyRoot ?? 0, 0, 11),
      scaleName: st.scaleName,
      baseMidi: clamp(st.baseMidi ?? 36, 12, 72),
      degreesCount,
    });

    const lo = scaleMidi[0];
    const hi = scaleMidi[scaleMidi.length - 1];

    const qq = clamp(q, lo - 12, hi + 12);
    const t = (qq - (lo - 12)) / ((hi + 12) - (lo - 12)); // 0..1
    const row = clamp(Math.round((1 - t) * (rows - 1)), 0, rows - 1);
    return row;
  }

  function chooseMidiColumn(cols, st) {
    // spread across whole grid; advances write head every noteOn
    const A = audioRef.current;
    const spread = clamp(st.midiSpread ?? 1.0, 0.1, 3.0);
    const step = Math.max(1, Math.round(spread));
    const col = A.midiWriteHead % cols;
    A.midiWriteHead = (A.midiWriteHead + step) % (cols * 999999);
    return col;
  }

  function paintMidiCell({ layer, row, col, cols, vel01, len01 }) {
    const idx = row * cols + col;
    const t = nowSec();
    const color = velToColor(vel01, len01, palette);

    if (layer === "melodic") {
      upsertCell(setCellsA, idx, {
        r: row,
        c: col,
        paint: { mode: "fixed", color, createdAt: t, vel01, len01 },
      });
    } else {
      upsertCell(setCellsB, idx, {
        r: row,
        c: col,
        paint: { mode: "fixed", color, createdAt: t, vel01, len01 },
      });
    }
  }

  function setupMIDI() {
    const A = audioRef.current;
    if (A.midi || !navigator.requestMIDIAccess) return;

    navigator
      .requestMIDIAccess({ sysex: false })
      .then((midi) => {
        A.midi = midi;

        const refreshInputs = () => {
          const ins = [];
          midi.inputs.forEach((input) => ins.push(input));
          A.midiInputs = ins;
          if (!A.midiInputId && ins[0]) A.midiInputId = ins[0].id;
          attachHandlers();
        };

        const attachHandlers = () => {
          midi.inputs.forEach((input) => {
            input.onmidimessage = null;
          });

          const chosen = midi.inputs.get(A.midiInputId) || midi.inputs.values().next().value;
          if (!chosen) return;

          chosen.onmidimessage = (e) => {
            const st = sRef.current;
            if (!st.midiOn) return;

            const [status, d1, d2] = e.data;
            const cmd = status & 0xf0;
            const ch = (status & 0x0f) + 1;

            if (st.midiChannel !== "all" && parseInt(st.midiChannel, 10) !== ch) return;

            const { cols, rows } = gridDimsForMidi(st);

            // note on
            if (cmd === 0x90 && d2 > 0) {
              const note = d1;
              const vel01 = d2 / 127;

              const row = midiNoteToRow(note, rows, st);
              const col = chooseMidiColumn(cols, st);

              // remember note for duration
              A.activeMidi.set(note, { tOn: nowSec(), row, col, cols, layer: "melodic" });

              // paint immediately (len unknown yet -> 0)
              if (st.midiPaint) {
                paintMidiCell({ layer: "melodic", row, col, cols, vel01, len01: 0.0 });
              }

              // MIDI thru to audio (immediate note)
              if (st.midiThruToAudio) {
                unlockAudio();
                ensureAudio();
                ensureVoices();
                updateAudioParamsRealtime();

                // quantize to scale and play
                const q = quantizeMidiToScale(note, st.keyRoot, st.scaleName);
                const freq = midiToFreq(q);

                const rowNorm = rows <= 1 ? 0.5 : 1 - row / (rows - 1);
                const cutoff = (st.cutoffBaseA ?? 350) + (st.cutoffSpanA ?? 9000) * lerp(0.2, 1.0, vel01);
                const attack = 0.004 + 0.05 * (1 - rowNorm);
                const decay = (st.decayBaseA ?? 0.07) + (st.decaySpanA ?? 0.55) * vel01;
                const release = 0.06 + 0.35 * rowNorm;

                const v = A.voicesA[A.voicePtrA % A.voicesA.length];
                A.voicePtrA++;
                triggerMelodicVoice(A.ac, v, {
                  freq,
                  vel: clamp(vel01, 0.05, 1),
                  cutoffHz: cutoff,
                  attack,
                  decay,
                  release,
                  subAmt: st.subAmtA,
                  drive: st.driveA,
                });
              }
            }

            // note off
            if (cmd === 0x80 || (cmd === 0x90 && d2 === 0)) {
              const note = d1;
              const info = A.activeMidi.get(note);
              if (info) {
                const dur = clamp(nowSec() - info.tOn, 0, 6);
                const len01 = clamp(dur / 1.2, 0, 1);

                // update painted cell with length-based color shift
                if (sRef.current.midiPaint) {
                  // find last velocity (can’t recover perfectly; approximate from existing paint)
                  const vel01 = 0.7;
                  paintMidiCell({
                    layer: "melodic",
                    row: info.row,
                    col: info.col,
                    cols: info.cols,
                    vel01,
                    len01,
                  });
                }
                A.activeMidi.delete(note);
              }
            }
          };
        };

        midi.onstatechange = () => refreshInputs();
        refreshInputs();
      })
      .catch(() => {
        // ignore
      });
  }

  React.useEffect(() => {
    setupMIDI();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  /* =======================
     Pointer events (paint)
======================= */
  const onPointerDown = async (e) => {
    await unlockAudio();
    e.preventDefault?.();
    try {
      e.currentTarget?.setPointerCapture?.(e.pointerId);
    } catch {}
    setDrawing(true);

    const { x, y } = pointerToCanvas(e);
    const hit = getIdx(x, y);
    if (!hit) return;
    applyPaintAt(hit);
  };

  const onPointerMove = (e) => {
    if (!drawing) return;
    const { x, y } = pointerToCanvas(e);
    const hit = getIdx(x, y);
    if (!hit) return;
    applyPaintAt(hit);
  };

  const onPointerUp = () => setDrawing(false);

  const clearPaint = () => {
    setCellsA([]);
    setCellsB([]);
  };

  const gen = () => {
    // no-op refresh (keeps UI)
    setCellsA((p) => [...p]);
    setCellsB((p) => [...p]);
  };

  /* =======================
     Render loop
======================= */
  const getFontFamily = () => `"Inter", system-ui, -apple-system, Segoe UI, Roboto, sans-serif`;

  function drawGrid(ctx, w, h, st) {
    if (!st.gridLines) return;

    ctx.save();
    ctx.strokeStyle = st.darkMode ? "rgba(255,255,255,0.08)" : "#E6E6E6";
    ctx.lineWidth = 1;

    if (st.pat === "char-grid") {
      const cols = Math.max(1, Math.floor(w / st.space));
      const rows = Math.max(1, Math.floor(h / st.space));
      for (let c = 0; c <= cols; c++) {
        const x = c * st.space;
        ctx.beginPath();
        ctx.moveTo(x, 0);
        ctx.lineTo(x, h);
        ctx.stroke();
      }
      for (let r = 0; r <= rows; r++) {
        const y = r * st.space;
        ctx.beginPath();
        ctx.moveTo(0, y);
        ctx.lineTo(w, y);
        ctx.stroke();
      }
    } else {
      const cols = Math.max(1, st.cols | 0);
      const rows = Math.max(1, st.rows | 0);
      const ce = colEdges || Array.from({ length: cols + 1 }, (_, i) => i / cols);
      const re = rowEdges || Array.from({ length: rows + 1 }, (_, i) => i / rows);

      for (let i = 0; i < ce.length; i++) {
        const x = ce[i] * w;
        ctx.beginPath();
        ctx.moveTo(x, 0);
        ctx.lineTo(x, h);
        ctx.stroke();
      }
      for (let i = 0; i < re.length; i++) {
        const y = re[i] * h;
        ctx.beginPath();
        ctx.moveTo(0, y);
        ctx.lineTo(w, y);
        ctx.stroke();
      }
    }

    ctx.restore();
  }

  const render = (tm) => {
    const cv = canvasRef.current;
    if (!cv) return;
    const ctx = cv.getContext("2d");
    const w = cv.width,
      h = cv.height;
    const t = tm * 0.001;
    const st = sRef.current;

    // background
    ctx.clearRect(0, 0, w, h);
    ctx.fillStyle = st.darkMode ? "#0B0B0E" : "#FAFAFA";
    ctx.fillRect(0, 0, w, h);

    drawGrid(ctx, w, h, st);

    // maps
    const mapA = new Map();
    const mapB = new Map();
    for (const c of cellsARef.current) mapA.set(c.idx, c);
    for (const c of cellsBRef.current) mapB.set(c.idx, c);

    // how to show layers
    const showA = st.view === "melodic" || st.view === "both";
    const showB = st.view === "perc" || st.view === "both";
    const ghostA = st.view === "both" ? 1 : 1;
    const ghostB = st.view === "both" ? 1 : 1;

    const otherAlpha = clamp(st.ghostOther ?? 0.35, 0, 1);

    ctx.textAlign = "center";
    ctx.textBaseline = "middle";

    if (st.pat === "char-grid") {
      const cols = Math.max(1, Math.floor(w / st.space));
      const rows = Math.max(1, Math.floor(h / st.space));
      const chs = (st.chars || "01").split("");
      const spd = (st.charSpd ?? 2) * 0.9;

      for (let r = 0; r < rows; r++) {
        for (let c = 0; c < cols; c++) {
          const idx = r * cols + c;
          const x0 = c * st.space;
          const y0 = r * st.space;
          const cx = x0 + st.space / 2;
          const cy = y0 + st.space / 2;

          const cellA = mapA.get(idx);
          const cellB = mapB.get(idx);

          const colA = showA ? resolveCellColor(cellA, t, st) : null;
          const colB = showB ? resolveCellColor(cellB, t, st) : null;

          if (colA) {
            ctx.save();
            ctx.globalAlpha = st.view === "both" ? 0.92 : 0.92;
            ctx.fillStyle = colA;
            ctx.fillRect(x0, y0, st.space, st.space);
            ctx.restore();
          }
          if (colB) {
            ctx.save();
            ctx.globalAlpha = st.view === "both" ? otherAlpha : 0.92;
            ctx.fillStyle = colB;
            ctx.fillRect(x0, y0, st.space, st.space);
            ctx.restore();
          }

          // chars (keep your moving digits)
          const gi = chs.length ? (Math.floor((t * spd + r * 0.07 + c * 0.05) * 3) % chs.length) : 0;
          ctx.save();
          ctx.font = `${st.charSz}px ${getFontFamily()}`;
          ctx.fillStyle = st.darkMode ? "rgba(255,255,255,0.75)" : "#111111";
          ctx.globalAlpha = colA || colB ? (st.darkMode ? 0.85 : 0.9) : st.darkMode ? 0.65 : 0.75;
          ctx.fillText(chs[gi] ?? "0", cx, cy);
          ctx.restore();
        }
      }
      return;
    }

    // swiss-grid
    if (st.pat === "swiss-grid") {
      const cols = Math.max(1, st.cols | 0);
      const rows = Math.max(1, st.rows | 0);
      const chs = (st.chars || "01").split("");
      const spd = (st.charSpd ?? 2) * 0.85;

      for (let r = 0; r < rows; r++) {
        for (let c = 0; c < cols; c++) {
          const idx = r * cols + c;
          const g = swissCellGeom(r, c, w, h);

          const cellA = mapA.get(idx);
          const cellB = mapB.get(idx);

          const colA = showA ? resolveCellColor(cellA, t, st) : null;
          const colB = showB ? resolveCellColor(cellB, t, st) : null;

          if (colA) {
            ctx.save();
            ctx.globalAlpha = st.view === "both" ? 0.92 : 0.92;
            ctx.fillStyle = colA;
            ctx.fillRect(g.x, g.y, g.w, g.h);
            ctx.restore();
          }
          if (colB) {
            ctx.save();
            ctx.globalAlpha = st.view === "both" ? otherAlpha : 0.92;
            ctx.fillStyle = colB;
            ctx.fillRect(g.x, g.y, g.w, g.h);
            ctx.restore();
          }

          // character
          const gi = chs.length ? (Math.floor((t * spd + r * 0.09 + c * 0.05) * 3) % chs.length) : 0;
          const sz = Math.max(8, Math.min(g.w, g.h) * 0.55 * (st.swissCharScale ?? 1));
          ctx.save();
          ctx.font = `${Math.floor(sz)}px ${getFontFamily()}`;
          ctx.fillStyle = st.darkMode ? "rgba(255,255,255,0.78)" : "#111111";
          ctx.globalAlpha = colA || colB ? (st.darkMode ? 0.88 : 0.92) : st.darkMode ? 0.6 : 0.75;
          ctx.fillText(chs[gi] ?? "0", g.cx, g.cy);
          ctx.restore();
        }
      }
    }
  };

  React.useEffect(() => {
    const loop = (t) => {
      render(t);
      rafRef.current = requestAnimationFrame(loop);
    };
    rafRef.current = requestAnimationFrame(loop);
    return () => cancelAnimationFrame(rafRef.current);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [colEdges, rowEdges]);

  // resize canvas
  React.useEffect(() => {
    const rsz = () => {
      const cv = canvasRef.current;
      if (!cv) return;
      cv.width = Math.max(1, Math.floor(cv.offsetWidth));
      cv.height = Math.max(1, Math.floor(cv.offsetHeight));
    };
    rsz();
    window.addEventListener("resize", rsz);
    window.addEventListener("orientationchange", rsz);
    return () => {
      window.removeEventListener("resize", rsz);
      window.removeEventListener("orientationchange", rsz);
    };
  }, []);

  // load Inter font
  React.useEffect(() => {
    const link = document.createElement("link");
    link.href = "https://fonts.googleapis.com/css2?family=Inter:wght@400;600;700&display=swap";
    link.rel = "stylesheet";
    document.head.appendChild(link);
    return () => document.head.removeChild(link);
  }, []);

  /* =======================
     UI helpers
======================= */
  const keyName = NOTE_NAMES[s.keyRoot] ?? "C";

  const midiInputs = audioRef.current.midiInputs || [];

  return (
    <div className={`w-full h-[100svh] flex flex-col md:flex-row overflow-hidden ${s.darkMode ? "bg-black" : "bg-white"}`}>
      {panelOpen && (
        <div className="fixed inset-0 bg-black/30 z-30 md:hidden" onClick={() => setPanelOpen(false)} />
      )}

      {/* Controls */}
      <div
        className={
          "fixed md:static z-40 md:z-auto inset-y-0 left-0 w-80 max-w-[90vw] border-r p-4 md:p-5 overflow-y-auto space-y-4 text-sm transform transition-transform duration-200 md:transform-none " +
          (s.darkMode ? "bg-neutral-950 border-neutral-800 text-neutral-100" : "bg-neutral-50 border-neutral-200 text-neutral-900 ") +
          (panelOpen ? "translate-x-0" : "-translate-x-full md:translate-x-0")
        }
      >
        <div className="flex gap-2">
          <button
            onClick={gen}
            className="flex-1 flex justify-center px-4 py-2.5 bg-black text-white rounded-lg font-medium hover:bg-neutral-800 min-h-[44px]"
            title="Refresh"
          >
            <RotateCcw size={16} />
          </button>
          <button
            onClick={() => {
              const l = document.createElement("a");
              l.download = "pattern.png";
              l.href = canvasRef.current.toDataURL();
              l.click();
            }}
            className="flex-1 flex justify-center px-4 py-2.5 bg-black text-white rounded-lg font-medium hover:bg-neutral-800 min-h-[44px]"
            title="Download PNG"
          >
            <Download size={16} />
          </button>
        </div>

        {/* Theme + View */}
        <div className="space-y-2">
          <div className="flex items-center justify-between">
            <label className="block text-xs font-semibold uppercase tracking-wider">Theme</label>
            <button
              onClick={() => setS((p) => ({ ...p, darkMode: !p.darkMode }))}
              className={`px-3 py-2 rounded-lg text-xs font-semibold min-h-[44px] ${s.darkMode ? "bg-white text-black" : "bg-black text-white"}`}
            >
              {s.darkMode ? "Light" : "Dark"}
            </button>
          </div>

          <label className="block text-xs font-semibold uppercase tracking-wider">View</label>
          <select
            value={s.view}
            onChange={(e) => setS((p) => ({ ...p, view: e.target.value }))}
            className={`w-full px-3 py-2 rounded-lg border ${s.darkMode ? "bg-neutral-900 border-neutral-800" : "bg-white border-neutral-300"}`}
          >
            <option value="both">Both layers</option>
            <option value="melodic">Melodic only</option>
            <option value="perc">Percussion only</option>
          </select>

          {s.view === "both" && (
            <>
              <div className="text-xs text-neutral-500">Ghost opacity (other layer): {s.ghostOther.toFixed(2)}</div>
              <input
                type="range"
                min="0"
                max="1"
                step="0.01"
                value={s.ghostOther}
                onChange={(e) => setS((p) => ({ ...p, ghostOther: parseFloat(e.target.value) }))}
                className="w-full"
              />
            </>
          )}
        </div>

        <div className="space-y-2">
          <label className="block text-xs font-semibold uppercase tracking-wider">Pattern</label>
          <select
            value={s.pat}
            onChange={(e) => setS((p) => ({ ...p, pat: e.target.value }))}
            className={`w-full px-3 py-2 rounded-lg border ${s.darkMode ? "bg-neutral-900 border-neutral-800" : "bg-white border-neutral-300"}`}
          >
            <option value="swiss-grid">Swiss Grid</option>
            <option value="char-grid">Character Grid</option>
          </select>
        </div>

        {/* Paint */}
        <div className="space-y-2">
          <label className="block text-xs font-semibold uppercase tracking-wider">Paint</label>

          <div className="grid grid-cols-2 gap-2">
            <button
              onClick={() => setPaint((p) => ({ ...p, layer: "melodic" }))}
              className={`px-3 py-2 rounded-lg border text-xs font-semibold min-h-[44px] ${
                paint.layer === "melodic"
                  ? "bg-black text-white border-black"
                  : s.darkMode
                    ? "bg-neutral-900 border-neutral-800"
                    : "bg-white border-neutral-300"
              }`}
            >
              Melodic
            </button>
            <button
              onClick={() => setPaint((p) => ({ ...p, layer: "perc" }))}
              className={`px-3 py-2 rounded-lg border text-xs font-semibold min-h-[44px] ${
                paint.layer === "perc"
                  ? "bg-black text-white border-black"
                  : s.darkMode
                    ? "bg-neutral-900 border-neutral-800"
                    : "bg-white border-neutral-300"
              }`}
            >
              Perc
            </button>
          </div>

          <div className="flex items-center justify-between gap-2">
            <input
              type="color"
              value={paint.color}
              onChange={(e) => setPaint((p) => ({ ...p, color: e.target.value, useSeq: false }))}
              className={`h-10 w-14 rounded-md border ${s.darkMode ? "border-neutral-800 bg-neutral-900" : "border-neutral-300 bg-white"}`}
              title="Pick color"
            />

            <button
              onClick={() => setPaint((p) => ({ ...p, useSeq: !p.useSeq, mode: "color" }))}
              className={`flex-1 px-3 py-2 rounded-lg border text-xs font-semibold flex items-center justify-center gap-2 min-h-[44px] ${
                paint.useSeq ? "bg-black text-white border-black" : s.darkMode ? "bg-neutral-900 border-neutral-800" : "bg-white border-neutral-300"
              }`}
            >
              <Palette size={14} />
              {paint.useSeq ? "Color String ON" : "Color String OFF"}
            </button>

            <button
              onClick={() => setPaint((p) => ({ ...p, mode: p.mode === "none" ? "color" : "none" }))}
              className={`px-3 py-2 rounded-lg text-xs font-semibold min-h-[44px] ${
                paint.mode === "none" ? "bg-black text-white" : s.darkMode ? "bg-neutral-800 text-neutral-100" : "bg-neutral-200 text-neutral-700"
              }`}
              title="Erase mode"
            >
              {paint.mode === "none" ? "Erase" : "Draw"}
            </button>
          </div>

          <div className="grid grid-cols-5 gap-2">
            {palette.map((col, i) => (
              <input
                key={i}
                type="color"
                value={col}
                onChange={(e) =>
                  setS((p) => {
                    const next = [...p.colorSeq];
                    next[i] = e.target.value;
                    return { ...p, colorSeq: next };
                  })
                }
                className={`h-9 w-full rounded-md border ${s.darkMode ? "border-neutral-800 bg-neutral-900" : "border-neutral-300 bg-white"}`}
                title={`Color String ${i + 1}`}
              />
            ))}
          </div>

          <div className="grid grid-cols-2 gap-2">
            <div className="space-y-1">
              <div className="text-xs text-neutral-500">Color motion</div>
              <select
                value={s.colorSeqBehave}
                onChange={(e) => setS((p) => ({ ...p, colorSeqBehave: e.target.value }))}
                className={`w-full px-2 py-2 rounded-lg text-xs border ${s.darkMode ? "bg-neutral-900 border-neutral-800" : "bg-white border-neutral-300"}`}
              >
                <option value="same">Same (musical)</option>
                <option value="cycle">Cycle</option>
                <option value="wave">Wave</option>
                <option value="random">Random</option>
              </select>
            </div>
            <div className="space-y-1">
              <div className="text-xs text-neutral-500">Speed</div>
              <input
                type="range"
                min="0"
                max="4"
                step="0.01"
                value={s.colorSeqSpeed}
                onChange={(e) => setS((p) => ({ ...p, colorSeqSpeed: parseFloat(e.target.value) }))}
                className="w-full"
              />
            </div>
          </div>

          <button
            onClick={clearPaint}
            className="w-full px-4 py-2.5 bg-neutral-900 text-white rounded-lg font-medium hover:bg-black min-h-[44px]"
          >
            Clear Painted Cells
          </button>
        </div>

        {/* Grid controls */}
        {s.pat === "swiss-grid" && (
          <div className="space-y-2">
            <label className="block text-xs font-semibold uppercase tracking-wider">
              Grid {s.cols} × {s.rows}
            </label>
            <input
              type="range"
              min="4"
              max="40"
              value={s.cols}
              onChange={(e) => setS((p) => ({ ...p, cols: parseInt(e.target.value, 10) }))}
              className="w-full"
            />
            <input
              type="range"
              min="4"
              max="40"
              value={s.rows}
              onChange={(e) => setS((p) => ({ ...p, rows: parseInt(e.target.value, 10) }))}
              className="w-full"
            />

            <div className="flex items-center justify-between">
              <label className="text-xs font-semibold uppercase tracking-wider">Grid Lines</label>
              <button
                onClick={() => setS((p) => ({ ...p, gridLines: !p.gridLines }))}
                className={`p-1.5 rounded ${s.gridLines ? "bg-black text-white" : s.darkMode ? "bg-neutral-800" : "bg-neutral-200"}`}
              >
                {s.gridLines ? <Play size={14} fill="white" /> : <Square size={14} />}
              </button>
            </div>

            <label className="block text-xs font-semibold uppercase tracking-wider">Variable Grid Density</label>

            <div className={`rounded-lg border p-3 space-y-2 ${s.darkMode ? "border-neutral-800 bg-neutral-950" : "border-neutral-200 bg-white"}`}>
              <div className="flex items-center justify-between">
                <div className="text-xs font-semibold uppercase tracking-wider">Columns (rhythm)</div>
                <button
                  onClick={() => setS((p) => ({ ...p, varColsOn: !p.varColsOn }))}
                  className={`p-1.5 rounded ${s.varColsOn ? "bg-black text-white" : s.darkMode ? "bg-neutral-800" : "bg-neutral-200"}`}
                >
                  {s.varColsOn ? <Play size={14} fill="white" /> : <Square size={14} />}
                </button>
              </div>
              {s.varColsOn && (
                <>
                  <div className="text-[11px] text-neutral-500">Narrow columns = faster steps, wide = slower.</div>
                  <label className="block text-xs font-semibold uppercase tracking-wider">Focus X: {s.colFocus.toFixed(2)}</label>
                  <input type="range" min="0" max="1" step="0.01" value={s.colFocus} onChange={(e) => setS((p) => ({ ...p, colFocus: parseFloat(e.target.value) }))} className="w-full" />
                  <label className="block text-xs font-semibold uppercase tracking-wider">Strength: {s.colStrength.toFixed(1)}</label>
                  <input type="range" min="0" max="20" step="0.1" value={s.colStrength} onChange={(e) => setS((p) => ({ ...p, colStrength: parseFloat(e.target.value) }))} className="w-full" />
                  <label className="block text-xs font-semibold uppercase tracking-wider">Band Width: {s.colSigma.toFixed(2)}</label>
                  <input type="range" min="0.05" max="0.5" step="0.01" value={s.colSigma} onChange={(e) => setS((p) => ({ ...p, colSigma: parseFloat(e.target.value) }))} className="w-full" />
                </>
              )}
            </div>

            <div className={`rounded-lg border p-3 space-y-2 ${s.darkMode ? "border-neutral-800 bg-neutral-950" : "border-neutral-200 bg-white"}`}>
              <div className="flex items-center justify-between">
                <div className="text-xs font-semibold uppercase tracking-wider">Rows (tails)</div>
                <button
                  onClick={() => setS((p) => ({ ...p, varRowsOn: !p.varRowsOn }))}
                  className={`p-1.5 rounded ${s.varRowsOn ? "bg-black text-white" : s.darkMode ? "bg-neutral-800" : "bg-neutral-200"}`}
                >
                  {s.varRowsOn ? <Play size={14} fill="white" /> : <Square size={14} />}
                </button>
              </div>
              {s.varRowsOn && (
                <>
                  <div className="text-[11px] text-neutral-500">Row height now shapes decay + release in BOTH layers.</div>
                  <label className="block text-xs font-semibold uppercase tracking-wider">Focus Y: {s.rowFocus.toFixed(2)}</label>
                  <input type="range" min="0" max="1" step="0.01" value={s.rowFocus} onChange={(e) => setS((p) => ({ ...p, rowFocus: parseFloat(e.target.value) }))} className="w-full" />
                  <label className="block text-xs font-semibold uppercase tracking-wider">Strength: {s.rowStrength.toFixed(1)}</label>
                  <input type="range" min="0" max="20" step="0.1" value={s.rowStrength} onChange={(e) => setS((p) => ({ ...p, rowStrength: parseFloat(e.target.value) }))} className="w-full" />
                  <label className="block text-xs font-semibold uppercase tracking-wider">Band Width: {s.rowSigma.toFixed(2)}</label>
                  <input type="range" min="0.05" max="0.5" step="0.01" value={s.rowSigma} onChange={(e) => setS((p) => ({ ...p, rowSigma: parseFloat(e.target.value) }))} className="w-full" />
                </>
              )}
            </div>
          </div>
        )}

        {s.pat === "char-grid" && (
          <div className="space-y-2">
            <label className="block text-xs font-semibold uppercase tracking-wider">Spacing: {s.space}px</label>
            <input type="range" min="12" max="120" value={s.space} onChange={(e) => setS((p) => ({ ...p, space: parseInt(e.target.value, 10) }))} className="w-full" />
            <label className="block text-xs font-semibold uppercase tracking-wider">Char Size: {s.charSz}px</label>
            <input type="range" min="8" max="80" value={s.charSz} onChange={(e) => setS((p) => ({ ...p, charSz: parseInt(e.target.value, 10) }))} className="w-full" />
            <label className="block text-xs font-semibold uppercase tracking-wider">Char Speed: {s.charSpd.toFixed(2)}×</label>
            <input type="range" min="0" max="10" step="0.1" value={s.charSpd} onChange={(e) => setS((p) => ({ ...p, charSpd: parseFloat(e.target.value) }))} className="w-full" />
            <label className="block text-xs font-semibold uppercase tracking-wider">Characters</label>
            <input
              type="text"
              value={s.chars}
              onChange={(e) => setS((p) => ({ ...p, chars: e.target.value }))}
              className={`w-full px-3 py-2 rounded-lg font-mono border ${s.darkMode ? "bg-neutral-900 border-neutral-800" : "bg-white border-neutral-300"}`}
            />
            <div className="flex items-center justify-between">
              <label className="text-xs font-semibold uppercase tracking-wider">Grid Lines</label>
              <button
                onClick={() => setS((p) => ({ ...p, gridLines: !p.gridLines }))}
                className={`p-1.5 rounded ${s.gridLines ? "bg-black text-white" : s.darkMode ? "bg-neutral-800" : "bg-neutral-200"}`}
              >
                {s.gridLines ? <Play size={14} fill="white" /> : <Square size={14} />}
              </button>
            </div>
          </div>
        )}

        {/* SOUND GLOBAL */}
        <div className="space-y-2">
          <div className="flex items-center justify-between">
            <label className="text-xs font-semibold uppercase tracking-wider">Sound</label>
            <button
              onClick={() => setS((p) => ({ ...p, soundOn: !p.soundOn }))}
              className={`p-1.5 rounded ${s.soundOn ? "bg-black text-white" : s.darkMode ? "bg-neutral-800" : "bg-neutral-200"}`}
              title="Sound on/off"
            >
              {s.soundOn ? <Play size={14} fill="white" /> : <Square size={14} />}
            </button>
          </div>

          <label className="block text-xs font-semibold uppercase tracking-wider">BPM: {s.bpm}</label>
          <input type="range" min="40" max="220" value={s.bpm} onChange={(e) => setS((p) => ({ ...p, bpm: parseInt(e.target.value, 10) }))} className="w-full" />

          <label className="block text-xs font-semibold uppercase tracking-wider">Master: {s.master.toFixed(2)}</label>
          <input type="range" min="0" max="1.2" step="0.01" value={s.master} onChange={(e) => setS((p) => ({ ...p, master: parseFloat(e.target.value) }))} className="w-full" />
        </div>

        {/* MELODIC */}
        <div className="space-y-2">
          <div className="flex items-center justify-between">
            <label className="text-xs font-semibold uppercase tracking-wider">Melodic Layer</label>
            <button
              onClick={() => setS((p) => ({ ...p, melodicOn: !p.melodicOn }))}
              className={`p-1.5 rounded ${s.melodicOn ? "bg-black text-white" : s.darkMode ? "bg-neutral-800" : "bg-neutral-200"}`}
            >
              {s.melodicOn ? <Play size={14} fill="white" /> : <Square size={14} />}
            </button>
          </div>

          <div className="grid grid-cols-2 gap-2">
            <div className="space-y-1">
              <div className="text-xs text-neutral-500">Key</div>
              <select
                value={s.keyRoot}
                onChange={(e) => setS((p) => ({ ...p, keyRoot: parseInt(e.target.value, 10) }))}
                className={`w-full px-2 py-2 rounded-lg text-xs border ${s.darkMode ? "bg-neutral-900 border-neutral-800" : "bg-white border-neutral-300"}`}
              >
                {NOTE_NAMES.map((n, i) => (
                  <option key={n} value={i}>
                    {n}
                  </option>
                ))}
              </select>
            </div>
            <div className="space-y-1">
              <div className="text-xs text-neutral-500">Scale</div>
              <select
                value={s.scaleName}
                onChange={(e) => setS((p) => ({ ...p, scaleName: e.target.value }))}
                className={`w-full px-2 py-2 rounded-lg text-xs border ${s.darkMode ? "bg-neutral-900 border-neutral-800" : "bg-white border-neutral-300"}`}
              >
                {Object.keys(SCALES).map((name) => (
                  <option key={name} value={name}>
                    {name}
                  </option>
                ))}
              </select>
            </div>
          </div>

          <div className="grid grid-cols-2 gap-2">
            <div className="space-y-1">
              <div className="text-xs text-neutral-500">Chord</div>
              <select
                value={s.chordType}
                onChange={(e) => setS((p) => ({ ...p, chordType: e.target.value }))}
                className={`w-full px-2 py-2 rounded-lg text-xs border ${s.darkMode ? "bg-neutral-900 border-neutral-800" : "bg-white border-neutral-300"}`}
              >
                <option value="7">7th</option>
                <option value="triad">Triad</option>
              </select>
            </div>
            <div className="space-y-1">
              <div className="text-xs text-neutral-500">Lane mapping</div>
              <select
                value={s.laneMode}
                onChange={(e) => setS((p) => ({ ...p, laneMode: e.target.value }))}
                className={`w-full px-2 py-2 rounded-lg text-xs border ${s.darkMode ? "bg-neutral-900 border-neutral-800" : "bg-white border-neutral-300"}`}
              >
                <option value="hue">By Hue (color)</option>
                <option value="column">By Column</option>
              </select>
            </div>
          </div>

          <label className="block text-xs font-semibold uppercase tracking-wider">Voices: {s.voicesA}</label>
          <input type="range" min="1" max="24" value={s.voicesA} onChange={(e) => setS((p) => ({ ...p, voicesA: parseInt(e.target.value, 10) }))} className="w-full" />

          <label className="block text-xs font-semibold uppercase tracking-wider">Max notes / step: {s.maxNotesPerStepA}</label>
          <input type="range" min="1" max="16" value={s.maxNotesPerStepA} onChange={(e) => setS((p) => ({ ...p, maxNotesPerStepA: parseInt(e.target.value, 10) }))} className="w-full" />

          <label className="block text-xs font-semibold uppercase tracking-wider">Drive: {s.driveA.toFixed(2)}</label>
          <input type="range" min="0" max="1" step="0.01" value={s.driveA} onChange={(e) => setS((p) => ({ ...p, driveA: parseFloat(e.target.value) }))} className="w-full" />

          <label className="block text-xs font-semibold uppercase tracking-wider">Sub: {s.subAmtA.toFixed(2)}</label>
          <input type="range" min="0" max="0.8" step="0.01" value={s.subAmtA} onChange={(e) => setS((p) => ({ ...p, subAmtA: parseFloat(e.target.value) }))} className="w-full" />

          <div className="text-[11px] text-neutral-500">
            Always in tune: {keyName} {s.scaleName}. <br />
            Animated paint: color string is computed live, so speed changes work.
          </div>
        </div>

        {/* PERC */}
        <div className="space-y-2">
          <div className="flex items-center justify-between">
            <label className="text-xs font-semibold uppercase tracking-wider">Percussion Layer</label>
            <button
              onClick={() => setS((p) => ({ ...p, percOn: !p.percOn }))}
              className={`p-1.5 rounded ${s.percOn ? "bg-black text-white" : s.darkMode ? "bg-neutral-800" : "bg-neutral-200"}`}
            >
              {s.percOn ? <Play size={14} fill="white" /> : <Square size={14} />}
            </button>
          </div>

          <label className="block text-xs font-semibold uppercase tracking-wider">Voices: {s.voicesB}</label>
          <input type="range" min="1" max="24" value={s.voicesB} onChange={(e) => setS((p) => ({ ...p, voicesB: parseInt(e.target.value, 10) }))} className="w-full" />

          <label className="block text-xs font-semibold uppercase tracking-wider">Max hits / step: {s.maxHitsPerStepB}</label>
          <input type="range" min="1" max="16" value={s.maxHitsPerStepB} onChange={(e) => setS((p) => ({ ...p, maxHitsPerStepB: parseInt(e.target.value, 10) }))} className="w-full" />

          <label className="block text-xs font-semibold uppercase tracking-wider">Density: {s.percDensity.toFixed(2)}</label>
          <input type="range" min="0" max="2" step="0.01" value={s.percDensity} onChange={(e) => setS((p) => ({ ...p, percDensity: parseFloat(e.target.value) }))} className="w-full" />

          <label className="block text-xs font-semibold uppercase tracking-wider">Tone: {s.percTone.toFixed(2)}</label>
          <input type="range" min="0" max="1" step="0.01" value={s.percTone} onChange={(e) => setS((p) => ({ ...p, percTone: parseFloat(e.target.value) }))} className="w-full" />

          <label className="block text-xs font-semibold uppercase tracking-wider">Body: {s.percBody.toFixed(2)}</label>
          <input type="range" min="0" max="1" step="0.01" value={s.percBody} onChange={(e) => setS((p) => ({ ...p, percBody: parseFloat(e.target.value) }))} className="w-full" />
        </div>

        {/* FX */}
        <div className="space-y-2">
          <label className="block text-xs font-semibold uppercase tracking-wider">Global FX</label>

          <div className={`rounded-lg border p-3 space-y-2 ${s.darkMode ? "border-neutral-800 bg-neutral-950" : "border-neutral-200 bg-white"}`}>
            <div className="flex items-center justify-between">
              <div className="text-xs font-semibold uppercase tracking-wider">Reverb</div>
              <button onClick={() => setS((p) => ({ ...p, reverbOn: !p.reverbOn }))} className={`p-1.5 rounded ${s.reverbOn ? "bg-black text-white" : s.darkMode ? "bg-neutral-800" : "bg-neutral-200"}`}>
                {s.reverbOn ? <Play size={14} fill="white" /> : <Square size={14} />}
              </button>
            </div>
            <div className="text-xs text-neutral-500">Mix: {s.reverbMix.toFixed(2)}</div>
            <input type="range" min="0" max="0.8" step="0.01" value={s.reverbMix} onChange={(e) => setS((p) => ({ ...p, reverbMix: parseFloat(e.target.value) }))} className="w-full" />
            <div className="text-xs text-neutral-500">Time: {s.reverbTime.toFixed(1)}s</div>
            <input type="range" min="0.5" max="6" step="0.1" value={s.reverbTime} onChange={(e) => setS((p) => ({ ...p, reverbTime: parseFloat(e.target.value) }))} className="w-full" />
          </div>

          <div className={`rounded-lg border p-3 space-y-2 ${s.darkMode ? "border-neutral-800 bg-neutral-950" : "border-neutral-200 bg-white"}`}>
            <div className="flex items-center justify-between">
              <div className="text-xs font-semibold uppercase tracking-wider">Delay</div>
              <button onClick={() => setS((p) => ({ ...p, delayOn: !p.delayOn }))} className={`p-1.5 rounded ${s.delayOn ? "bg-black text-white" : s.darkMode ? "bg-neutral-800" : "bg-neutral-200"}`}>
                {s.delayOn ? <Play size={14} fill="white" /> : <Square size={14} />}
              </button>
            </div>
            <div className="text-xs text-neutral-500">Mix: {s.delayMix.toFixed(2)}</div>
            <input type="range" min="0" max="0.8" step="0.01" value={s.delayMix} onChange={(e) => setS((p) => ({ ...p, delayMix: parseFloat(e.target.value) }))} className="w-full" />
            <div className="text-xs text-neutral-500">Time: {s.delayTime.toFixed(2)}s</div>
            <input type="range" min="0.05" max="0.9" step="0.01" value={s.delayTime} onChange={(e) => setS((p) => ({ ...p, delayTime: parseFloat(e.target.value) }))} className="w-full" />
            <div className="text-xs text-neutral-500">Feedback: {s.delayFeedback.toFixed(2)}</div>
            <input type="range" min="0" max="0.85" step="0.01" value={s.delayFeedback} onChange={(e) => setS((p) => ({ ...p, delayFeedback: parseFloat(e.target.value) }))} className="w-full" />
          </div>
        </div>

        {/* MIDI */}
        <div className="space-y-2">
          <label className="block text-xs font-semibold uppercase tracking-wider">MIDI</label>

          <div className="flex items-center justify-between">
            <div className="text-xs text-neutral-500">MIDI enabled</div>
            <button onClick={() => setS((p) => ({ ...p, midiOn: !p.midiOn }))} className={`p-1.5 rounded ${s.midiOn ? "bg-black text-white" : s.darkMode ? "bg-neutral-800" : "bg-neutral-200"}`}>
              {s.midiOn ? <Play size={14} fill="white" /> : <Square size={14} />}
            </button>
          </div>

          <div className="flex items-center justify-between">
            <div className="text-xs text-neutral-500">MIDI paints grid</div>
            <button onClick={() => setS((p) => ({ ...p, midiPaint: !p.midiPaint }))} className={`p-1.5 rounded ${s.midiPaint ? "bg-black text-white" : s.darkMode ? "bg-neutral-800" : "bg-neutral-200"}`}>
              {s.midiPaint ? <Play size={14} fill="white" /> : <Square size={14} />}
            </button>
          </div>

          <div className="flex items-center justify-between">
            <div className="text-xs text-neutral-500">MIDI triggers audio</div>
            <button onClick={() => setS((p) => ({ ...p, midiThruToAudio: !p.midiThruToAudio }))} className={`p-1.5 rounded ${s.midiThruToAudio ? "bg-black text-white" : s.darkMode ? "bg-neutral-800" : "bg-neutral-200"}`}>
              {s.midiThruToAudio ? <Play size={14} fill="white" /> : <Square size={14} />}
            </button>
          </div>

          <div className="text-xs text-neutral-500">Column spread: {s.midiSpread.toFixed(2)}</div>
          <input type="range" min="0.2" max="3" step="0.01" value={s.midiSpread} onChange={(e) => setS((p) => ({ ...p, midiSpread: parseFloat(e.target.value) }))} className="w-full" />

          <div className="text-[11px] text-neutral-500">
            If MIDI still doesn’t appear, your browser must support WebMIDI (Chrome/Edge).
          </div>
        </div>

        <div className="text-[11px] text-neutral-500">
          Tip: click/touch once to unlock audio. MIDI won’t “cancel” the synth; both keep running.
        </div>
      </div>

      {/* Canvas */}
      <div className={`flex-1 min-h-0 p-2 md:p-8 relative overflow-hidden ${s.darkMode ? "bg-black" : "bg-white"}`}>
        <button
          onClick={() => setPanelOpen((v) => !v)}
          className="md:hidden absolute top-3 left-3 z-20 px-3 py-2 rounded-lg bg-black text-white text-xs font-semibold shadow"
        >
          {panelOpen ? "Hide controls" : "Show controls"}
        </button>

        <canvas
          ref={canvasRef}
          className="w-full h-full rounded-lg shadow-sm touch-none select-none"
          onPointerDown={onPointerDown}
          onPointerMove={onPointerMove}
          onPointerUp={onPointerUp}
          onPointerLeave={onPointerUp}
          onPointerCancel={onPointerUp}
          onContextMenu={(e) => e.preventDefault()}
          style={{ touchAction: "none" }}
        />
      </div>
    </div>
  );
}
