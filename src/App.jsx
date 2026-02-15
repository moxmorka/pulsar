// App.jsx
import React from "react";
import { RotateCcw, Download, Play, Square, Palette, Moon, Sun, Usb } from "lucide-react";

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
  let h = hex.replace("#", "");
  if (h.length === 3) h = h.split("").map((c) => c + c).join("");
  if (h.length !== 6) return null;
  const n = parseInt(h, 16);
  return { r: (n >> 16) & 255, g: (n >> 8) & 255, b: n & 255 };
}
function rgbToHex({ r, g, b }) {
  const to2 = (n) => n.toString(16).padStart(2, "0");
  return `#${to2(clamp(r | 0, 0, 255))}${to2(clamp(g | 0, 0, 255))}${to2(clamp(b | 0, 0, 255))}`;
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
function smoothstep01(x) {
  const t = clamp(x, 0, 1);
  return t * t * (3 - 2 * t);
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
    const wi = 1 / (1 + st * g); // smaller => denser
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

function nearestInArray(arr, x) {
  let best = arr[0];
  let bestD = Math.abs(best - x);
  for (let i = 1; i < arr.length; i++) {
    const d = Math.abs(arr[i] - x);
    if (d < bestD) {
      bestD = d;
      best = arr[i];
    }
  }
  return best;
}

/* =======================
   Color helpers for MIDI
======================= */
function velToColorHex(vel01, theme = "light") {
  // velocity -> vivid gradient that stays tasteful
  // low vel = deep cool, high vel = warm bright
  const v = clamp(vel01, 0, 1);
  const t = smoothstep01(v);

  // base gradient (teal -> magenta -> amber)
  const a = { r: 0, g: 194, b: 255 };
  const b = { r: 255, g: 0, b: 140 };
  const c = { r: 255, g: 230, b: 0 };

  let rgb;
  if (t < 0.6) {
    const u = t / 0.6;
    rgb = { r: lerp(a.r, b.r, u), g: lerp(a.g, b.g, u), b: lerp(a.b, b.b, u) };
  } else {
    const u = (t - 0.6) / 0.4;
    rgb = { r: lerp(b.r, c.r, u), g: lerp(b.g, c.g, u), b: lerp(b.b, c.b, u) };
  }

  // theme compensation so colors look good on dark
  if (theme === "dark") {
    rgb = { r: lerp(rgb.r, 255, 0.08), g: lerp(rgb.g, 255, 0.08), b: lerp(rgb.b, 255, 0.08) };
  } else {
    rgb = { r: lerp(rgb.r, 0, 0.03), g: lerp(rgb.g, 0, 0.03), b: lerp(rgb.b, 0, 0.03) };
  }
  return rgbToHex(rgb);
}

/* =======================
   Sound engine w/ FX
   - single AudioContext
   - stable graph
   - realtime param updates via AudioParams
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

function makeSynthVoice(ac) {
  const osc = ac.createOscillator();
  const sub = ac.createOscillator();
  const mix = ac.createGain();
  const filter = ac.createBiquadFilter();
  const gain = ac.createGain();

  osc.type = "sawtooth";
  sub.type = "triangle";
  mix.gain.value = 0.8;

  filter.type = "lowpass";
  filter.Q.value = 0.7;

  gain.gain.value = 0.0001;

  osc.connect(mix);
  sub.connect(mix);
  mix.connect(filter);
  filter.connect(gain);

  osc.start();
  sub.start();

  return { kind: "synth", osc, sub, mix, filter, gain };
}

function triggerSynth(ac, voice, { freq, vel, cutoffHz, attack, decaySec, release, detune = 0.6 }) {
  const now = ac.currentTime;
  const v = clamp(vel, 0.0001, 1);

  voice.osc.frequency.setValueAtTime(freq, now);
  voice.sub.frequency.setValueAtTime(freq * 0.5, now);

  voice.osc.detune.setValueAtTime(-detune * 100, now);
  voice.sub.detune.setValueAtTime(detune * 100, now);

  voice.filter.frequency.cancelScheduledValues(now);
  voice.filter.frequency.setValueAtTime(clamp(cutoffHz, 80, 16000), now);

  const g = voice.gain.gain;
  g.cancelScheduledValues(now);
  g.setValueAtTime(0.0001, now);

  const a = clamp(attack, 0.001, 0.25);
  const d = clamp(decaySec, 0.01, 2.0);
  const r = clamp(release, 0.01, 3.0);

  // ADSR-ish (simple)
  g.exponentialRampToValueAtTime(v, now + a);
  g.exponentialRampToValueAtTime(Math.max(0.00012, v * 0.42), now + a + d);
  g.exponentialRampToValueAtTime(0.0001, now + a + d + r);
}

function makePercVoice(ac) {
  // Noise burst -> bandpass -> amp
  const noiseBuf = ac.createBuffer(1, ac.sampleRate * 0.25, ac.sampleRate);
  {
    const data = noiseBuf.getChannelData(0);
    for (let i = 0; i < data.length; i++) data[i] = (Math.random() * 2 - 1) * (1 - i / data.length);
  }

  const src = ac.createBufferSource();
  src.buffer = noiseBuf;
  src.loop = true;

  const bp = ac.createBiquadFilter();
  bp.type = "bandpass";
  bp.Q.value = 9;

  const lp = ac.createBiquadFilter();
  lp.type = "lowpass";
  lp.Q.value = 0.7;

  const gain = ac.createGain();
  gain.gain.value = 0.0001;

  src.connect(bp);
  bp.connect(lp);
  lp.connect(gain);

  src.start();
  return { kind: "perc", src, bp, lp, gain };
}

function triggerPerc(ac, voice, { freq, vel, attack, decaySec, release }) {
  const now = ac.currentTime;
  const v = clamp(vel, 0.0001, 1);

  // bandpass center ~ "tone"
  voice.bp.frequency.cancelScheduledValues(now);
  voice.bp.frequency.setValueAtTime(clamp(freq, 80, 4000), now);

  voice.lp.frequency.cancelScheduledValues(now);
  voice.lp.frequency.setValueAtTime(clamp(freq * 2.2, 150, 8000), now);

  const g = voice.gain.gain;
  g.cancelScheduledValues(now);
  g.setValueAtTime(0.0001, now);

  const a = clamp(attack, 0.001, 0.08);
  const d = clamp(decaySec, 0.02, 1.2);
  const r = clamp(release, 0.02, 1.2);

  g.exponentialRampToValueAtTime(v, now + a);
  g.exponentialRampToValueAtTime(Math.max(0.00012, v * 0.22), now + a + d);
  g.exponentialRampToValueAtTime(0.0001, now + a + d + r);
}

/* =======================
   Main App
======================= */
export default function App() {
  const canvasRef = React.useRef(null);
  const rafRef = React.useRef(null);

  // Cells: store in state for UI; mirror into ref for scheduler.
  // cell = { idx, paint: { mode:'fixed'|'seq', color?, seed?, source? }, born, ttl, vel01 }
  const [cells, setCells] = React.useState([]);
  const cellsRef = React.useRef([]);
  React.useEffect(() => {
    cellsRef.current = cells;
  }, [cells]);

  const [panelOpen, setPanelOpen] = React.useState(false);

  // Painting
  const [paint, setPaint] = React.useState({
    mode: "color", // color | none
    color: "#111111",
    useSeq: true, // when true: store paint.mode='seq' so it animates forever
  });
  const [drawing, setDrawing] = React.useState(false);

  // Settings
  const [s, setS] = React.useState({
    theme: "light", // light | dark

    pat: "swiss-grid", // swiss-grid | char-grid

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

    // color string (animated)
    colorSeq: ["#111111", "#ff0055", "#00c2ff", "#00ff88", "#ffe600"],
    colorSeqSpeed: 1.0,
    colorSeqBehave: "wave", // cycle | wave | random

    // SOUND
    soundOn: true,

    bpm: 120,
    maxNotesPerStep: 10,

    keyRoot: 0,
    scaleName: "naturalMinor",
    baseMidi: 36,
    octaveSpan: 5,
    chordType: "7",
    prog: [0, 5, 3, 6],
    progRate: 4,

    laneMode: "hue", // column | hue

    // mapping / tone
    velFrom: "luma",
    cutoffBase: 350,
    cutoffSpan: 8200,

    // envelope base
    envAttackMin: 0.004,
    envAttackMax: 0.12,
    envDecayBase: 0.08,
    envDecaySpan: 0.75,
    envReleaseMin: 0.06,
    envReleaseMax: 0.95,

    // density influence amounts
    colRhythmDepth: 1.0, // 0..2
    rowTailDepth: 1.0, // 0..2

    // voices
    voices: 14,

    // perc layer
    percOn: true,
    percMix: 0.55,

    // FX
    master: 0.9,

    reverbOn: true,
    reverbMix: 0.24,
    reverbTime: 2.2,

    delayOn: true,
    delayMix: 0.18,
    delayTime: 0.28,
    delayFeedback: 0.35,

    driveOn: true,
    drive: 0.6,

    // MIDI
    midiOn: true,
    midiPaintDecay: 2.5, // seconds base decay if noteOff missing
    midiSpread: "roundRobin", // roundRobin | channel
  });

  const sRef = React.useRef(s);
  React.useEffect(() => {
    sRef.current = s;
  }, [s]);

  // Palette sanitized
  const palette = React.useMemo(() => {
    const arr = Array.isArray(s.colorSeq) ? s.colorSeq : [];
    const fixed = arr.map((x) => (isHexColor(x) ? x : "#111111")).slice(0, 5);
    while (fixed.length < 5) fixed.push("#111111");
    return fixed;
  }, [s.colorSeq]);

  const colorSeqIndex = React.useCallback(
    (t, r, c, len) => {
      if (len <= 1) return 0;
      const beh = s.colorSeqBehave;
      const tt = t * (s.colorSeqSpeed || 1);

      if (beh === "cycle") return (Math.floor(tt * 3) + r + c) % len;

      if (beh === "wave") {
        const wv = Math.sin((c * 0.55 + r * 0.33 + tt) * 0.9);
        return Math.floor((wv + 1) * 0.5 * len) % len;
      }

      // random-ish but deterministic
      const sd = r * 1000 + c * 17 + Math.floor(tt * 2);
      return Math.floor((Math.sin(sd) * 0.5 + 0.5) * len) % len;
    },
    [s.colorSeqBehave, s.colorSeqSpeed]
  );

  // Variable edges (swiss-grid only)
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

  // Pointer to canvas coords
  const pointerToCanvas = (e) => {
    const cv = canvasRef.current;
    const r = cv.getBoundingClientRect();
    const x = (e.clientX - r.left) * (cv.width / r.width);
    const y = (e.clientY - r.top) * (cv.height / r.height);
    return { x, y };
  };

  // Index lookup
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
      return row * s.cols + col;
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
      return row * cols + col;
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

  // Get grid dims (current)
  function currentGridDims() {
    const st = sRef.current;
    if (st.pat === "swiss-grid") {
      return { cols: Math.max(1, st.cols | 0), rows: Math.max(1, st.rows | 0) };
    }
    const cv = canvasRef.current;
    if (!cv) return { cols: 16, rows: 12 };
    return { cols: Math.max(1, Math.floor(cv.width / st.space)), rows: Math.max(1, Math.floor(cv.height / st.space)) };
  }

  // Upsert cell
  const upsertCell = React.useCallback((idx, patch) => {
    setCells((prev) => {
      const ex = prev.findIndex((c) => c.idx === idx);
      const next = [...prev];
      if (ex >= 0) next[ex] = { ...next[ex], ...patch };
      else next.push({ idx, ...patch });
      return next;
    });
  }, []);

  const removeCell = React.useCallback((idx) => {
    setCells((prev) => prev.filter((c) => c.idx !== idx));
  }, []);

  // Paint meaning:
  // - fixed: color stored
  // - seq: compute animated color at render/scheduler time using r,c + seed
  function computeCellColor(cell, r, c, t) {
    if (!cell?.paint) return null;
    const p = cell.paint;
    if (p.mode === "seq") {
      const len = palette.length;
      const seed = p.seed ?? 0;
      // seed offsets the phase so different sources don't sync too hard
      const ci = colorSeqIndex(t + seed * 0.13, r, c, len);
      return palette[ci] ?? palette[0];
    }
    return p.color || null;
  }

  function cellAlpha(cell, tNow) {
    if (!cell) return 0;
    const ttl = cell.ttl ?? Infinity;
    if (!isFinite(ttl)) return 1;
    const born = cell.born ?? tNow;
    const age = Math.max(0, tNow - born);
    const a = 1 - age / Math.max(0.001, ttl);
    return clamp(a, 0, 1);
  }

  const applyPaintToIdx = React.useCallback(
    (idx, r, c) => {
      if (idx == null) return;
      const t = nowSec();

      if (paint.mode === "none") {
        removeCell(idx);
        return;
      }

      if (paint.useSeq) {
        upsertCell(idx, {
          paint: { mode: "seq", seed: (r * 928371 + c * 193) % 997, source: "hand" },
          born: t,
          ttl: Infinity,
          vel01: 0.7,
        });
      } else {
        upsertCell(idx, {
          paint: { mode: "fixed", color: paint.color, source: "hand" },
          born: t,
          ttl: Infinity,
          vel01: 0.7,
        });
      }
    },
    [paint.mode, paint.useSeq, paint.color, upsertCell, removeCell]
  );

  // ===== Audio Graph (stable) =====
  const audioRef = React.useRef({
    ac: null,
    master: null,

    // FX
    dry: null,
    wetRev: null,
    wetDel: null,

    convolver: null,
    delay: null,
    feedback: null,

    drive: null,

    // voices
    synthVoices: [],
    percVoices: [],
    synthPtr: 0,
    percPtr: 0,

    // scheduler
    running: false,
    step: 0,
    timer: null,

    // MIDI note tracking
    midiOK: false,
    midiAccess: null,
    midiInputs: [],
    activeNotes: new Map(), // key: `${ch}:${note}` => { idx, startSec, vel01, row, col }
    midiColPtr: 0,
  });

  function ensureAudio() {
    const A = audioRef.current;
    if (!A.ac) {
      const ac = new (window.AudioContext || window.webkitAudioContext)();
      const master = ac.createGain();
      master.gain.value = 0.9;

      // saturation
      const drive = ac.createWaveShaper();
      drive.oversample = "2x";
      const makeCurve = (amount) => {
        const k = clamp(amount ?? 0.6, 0, 1) * 50;
        const n = 2048;
        const curve = new Float32Array(n);
        for (let i = 0; i < n; i++) {
          const x = (i * 2) / (n - 1) - 1;
          curve[i] = Math.tanh(x * (1 + k));
        }
        return curve;
      };
      drive.curve = makeCurve(sRef.current.drive);

      // dry/wet
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

      // routing:
      // voices -> drive -> split to dry + fx -> master -> destination
      drive.connect(dry);
      drive.connect(convolver);
      drive.connect(delay);

      convolver.connect(wetRev);
      delay.connect(wetDel);

      dry.connect(master);
      wetRev.connect(master);
      wetDel.connect(master);

      master.connect(ac.destination);

      A.ac = ac;
      A.master = master;
      A.drive = drive;
      A.dry = dry;
      A.wetRev = wetRev;
      A.wetDel = wetDel;
      A.convolver = convolver;
      A.delay = delay;
      A.feedback = feedback;
      A.synthVoices = [];
      A.percVoices = [];
      A.synthPtr = 0;
      A.percPtr = 0;
      A.running = false;
      A.step = 0;
      A.timer = null;
      A.activeNotes = new Map();
      A.midiColPtr = 0;
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

  function updateAudioParamsRealtime() {
    const A = audioRef.current;
    if (!A.ac) return;
    const st = sRef.current;

    A.master.gain.setTargetAtTime(clamp(st.master, 0, 1.2), A.ac.currentTime, 0.02);

    // drive curve
    if (st.driveOn) {
      const k = clamp(st.drive ?? 0.6, 0, 1) * 50;
      const n = 2048;
      const curve = new Float32Array(n);
      for (let i = 0; i < n; i++) {
        const x = (i * 2) / (n - 1) - 1;
        curve[i] = Math.tanh(x * (1 + k));
      }
      A.drive.curve = curve;
    } else {
      const n = 2048;
      const curve = new Float32Array(n);
      for (let i = 0; i < n; i++) curve[i] = (i * 2) / (n - 1) - 1;
      A.drive.curve = curve;
    }

    // reverb
    A.wetRev.gain.setTargetAtTime(st.reverbOn ? clamp(st.reverbMix, 0, 1) : 0, A.ac.currentTime, 0.02);
    if (A._revTime == null) A._revTime = st.reverbTime;
    if (Math.abs(st.reverbTime - A._revTime) > 0.1) {
      A._revTime = st.reverbTime;
      A.convolver.buffer = createReverbImpulse(A.ac, clamp(st.reverbTime, 0.3, 6), 2.0);
    }

    // delay
    A.wetDel.gain.setTargetAtTime(st.delayOn ? clamp(st.delayMix, 0, 1) : 0, A.ac.currentTime, 0.02);
    A.delay.delayTime.setTargetAtTime(clamp(st.delayTime, 0.01, 1.5), A.ac.currentTime, 0.02);
    A.feedback.gain.setTargetAtTime(clamp(st.delayFeedback, 0, 0.95), A.ac.currentTime, 0.02);
  }

  function ensureVoices() {
    const A = ensureAudio();
    const ac = A.ac;
    const st = sRef.current;

    const wantSynth = clamp(st.voices ?? 14, 1, 32);
    if (A.synthVoices.length !== wantSynth) {
      const newPool = Array.from({ length: wantSynth }, () => {
        const v = makeSynthVoice(ac);
        v.gain.connect(A.drive);
        return v;
      });
      A.synthVoices = newPool;
      A.synthPtr = 0;
    }

    const wantPerc = clamp(Math.round((st.voices ?? 14) * 0.6), 1, 24);
    if (A.percVoices.length !== wantPerc) {
      const newPool = Array.from({ length: wantPerc }, () => {
        const v = makePercVoice(ac);
        v.gain.connect(A.drive);
        return v;
      });
      A.percVoices = newPool;
      A.percPtr = 0;
    }
  }

  // Keep audio params hot while UI changes (but don't auto-create audio until first user gesture)
  React.useEffect(() => {
    if (audioRef.current.ac) {
      ensureVoices();
      updateAudioParamsRealtime();
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [s]);

  // ===== MIDI (WebMIDI) =====
  const [midiStatus, setMidiStatus] = React.useState({ ok: false, msg: "MIDI not enabled" });

  async function enableMIDI() {
    await unlockAudio();
    const A = ensureAudio();

    if (!navigator.requestMIDIAccess) {
      setMidiStatus({ ok: false, msg: "WebMIDI not supported in this browser" });
      return;
    }

    try {
      const access = await navigator.requestMIDIAccess({ sysex: false });
      A.midiAccess = access;

      const refreshInputs = () => {
        const inputs = [];
        access.inputs.forEach((input) => inputs.push(input));
        A.midiInputs = inputs;

        for (const input of inputs) {
          input.onmidimessage = (e) => onMIDIMessage(e);
        }

        setMidiStatus({
          ok: inputs.length > 0,
          msg: inputs.length > 0 ? `MIDI ready (${inputs.length} input${inputs.length === 1 ? "" : "s"})` : "No MIDI inputs found",
        });
      };

      access.onstatechange = () => refreshInputs();
      refreshInputs();
      A.midiOK = true;
    } catch (err) {
      setMidiStatus({ ok: false, msg: "MIDI access blocked / denied" });
      A.midiOK = false;
    }
  }

  function mapMidiNoteToGrid(note, vel01) {
    // Use your musical scale range and map across FULL grid:
    // - pitch -> row (quantized to scale degrees across octaves)
    // - col -> spread (round-robin) so it fills whole width, not one column

    const st = sRef.current;
    const { cols, rows } = currentGridDims();

    const degreesCount = 7 * clamp(st.octaveSpan ?? 5, 1, 8);
    const scaleMidi = buildScaleMidi({
      rootPc: clamp(st.keyRoot ?? 0, 0, 11),
      scaleName: st.scaleName,
      baseMidi: clamp(st.baseMidi ?? 36, 12, 72),
      degreesCount,
    });

    const snapped = nearestInArray(scaleMidi, note);

    // map snapped scale index -> row (top = higher)
    const idx = clamp(scaleMidi.indexOf(snapped), 0, scaleMidi.length - 1);
    const row01 = idx / Math.max(1, scaleMidi.length - 1);
    const row = clamp(Math.round((1 - row01) * (rows - 1)), 0, rows - 1);

    // column spread
    const A = audioRef.current;
    let col = 0;
    if (st.midiSpread === "channel") {
      // channel-based spread done in handler; fallback:
      col = (note + Math.floor(vel01 * 12)) % cols;
    } else {
      col = A.midiColPtr % cols;
      A.midiColPtr = (A.midiColPtr + 1) % cols;
    }

    return { row, col, cols, rows, snappedMidi: snapped };
  }

  function onMIDIMessage(e) {
    const st = sRef.current;
    if (!st.midiOn) return;

    const data = e.data;
    if (!data || data.length < 2) return;

    const status = data[0] & 0xf0;
    const ch = data[0] & 0x0f;
    const note = data[1];
    const vel = data[2] ?? 0;

    const isNoteOn = status === 0x90 && vel > 0;
    const isNoteOff = status === 0x80 || (status === 0x90 && vel === 0);

    const key = `${ch}:${note}`;
    const t = nowSec();

    if (isNoteOn) {
      const vel01 = clamp(vel / 127, 0, 1);
      const { row, col, cols } = mapMidiNoteToGrid(note, vel01);
      const idx = row * cols + col;

      // paint cell from velocity; keep it "alive" until noteOff
      const color = velToColorHex(vel01, st.theme);
      upsertCell(idx, {
        paint: { mode: "fixed", color, source: "midi" },
        born: t,
        ttl: Infinity,
        vel01,
      });

      audioRef.current.activeNotes.set(key, { idx, startSec: t, vel01, row, col });

      // also trigger synth immediately so MIDI never "cancels" audio.
      // This is additive: sequencer still runs.
      if (st.soundOn && audioRef.current.ac) {
        const A = audioRef.current;
        const ac = A.ac;
        ensureVoices();
        updateAudioParamsRealtime();

        const freq = midiToFreq(note);

        // envelope from velocity
        const attack = lerp(st.envAttackMax, st.envAttackMin, vel01);
        const decaySec = lerp(0.25, 0.08, vel01);
        const release = lerp(0.45, 0.18, vel01);
        const cutoff = (st.cutoffBase ?? 350) + (st.cutoffSpan ?? 8200) * clamp(0.2 + 0.8 * vel01, 0, 1);

        const v = A.synthVoices[A.synthPtr % A.synthVoices.length];
        A.synthPtr++;
        triggerSynth(ac, v, { freq, vel: 0.2 + 0.8 * vel01, cutoffHz: cutoff, attack, decaySec, release });

        // optional perc for low notes
        if (st.percOn && A.percVoices.length) {
          const pv = A.percVoices[A.percPtr % A.percVoices.length];
          A.percPtr++;
          triggerPerc(ac, pv, {
            freq: clamp(freq * 0.6, 90, 2400),
            vel: (0.08 + vel01 * 0.35) * clamp(st.percMix, 0, 1),
            attack: 0.0015,
            decaySec: 0.08 + 0.12 * (1 - vel01),
            release: 0.12,
          });
        }
      }
    }

    if (isNoteOff) {
      const n = audioRef.current.activeNotes.get(key);
      audioRef.current.activeNotes.delete(key);

      // If we know what cell it was: set ttl from note length so it fades out (visual tail)
      if (n) {
        const dur = clamp(t - n.startSec, 0.04, 6);
        const ttl = clamp(dur * 0.85, 0.2, 6);
        upsertCell(n.idx, (prev) => prev); // no-op for TS; keep structure
        setCells((prev) => {
          const ex = prev.findIndex((c) => c.idx === n.idx);
          if (ex < 0) return prev;
          const next = [...prev];
          next[ex] = { ...next[ex], born: t, ttl, vel01: next[ex].vel01 ?? n.vel01 };
          return next;
        });
      }
    }
  }

  // Periodic cleanup: remove expired MIDI cells so grid doesn't clog
  React.useEffect(() => {
    const id = setInterval(() => {
      const t = nowSec();
      setCells((prev) => prev.filter((c) => !(isFinite(c.ttl) && t - (c.born ?? t) > (c.ttl ?? 0))));
    }, 300);
    return () => clearInterval(id);
  }, []);

  // ===== Scheduler (stable) =====
  function startScheduler() {
    const A = ensureAudio();
    const ac = A.ac;

    A.running = true;

    const tick = () => {
      if (!audioRef.current.running) return;

      const st = sRef.current;

      // keep clock alive even if muted
      if (!st.soundOn) {
        audioRef.current.timer = setTimeout(tick, 50);
        return;
      }

      ensureVoices();
      updateAudioParamsRealtime();

      const tNow = nowSec();
      const cellsNow = cellsRef.current;

      // Determine grid dims
      const { cols, rows } = currentGridDims();
      const isSwiss = st.pat === "swiss-grid";

      // base step duration from BPM
      const bpm = clamp(st.bpm ?? 120, 30, 260);
      const baseStepSec = 60 / bpm / 2; // 8th feel
      let stepSec = baseStepSec;

      // Column rhythm influence (variable density)
      if (isSwiss && st.varColsOn && colEdges) {
        const col = audioRef.current.step % cols;
        const w = colEdges[col + 1] - colEdges[col];
        const avg = 1 / cols;
        const ratio = clamp(w / avg, 0.35, 2.6);
        const depth = clamp(st.colRhythmDepth ?? 1.0, 0, 2);
        // depth 0 => no effect, depth 1 => full, depth 2 => stronger
        stepSec = baseStepSec * lerp(1, ratio, clamp(depth, 0, 1)) * lerp(1, ratio, clamp(depth - 1, 0, 1) * 0.5);
      }

      // current column
      const col = audioRef.current.step % cols;

      // chord progression
      const prog = Array.isArray(st.prog) && st.prog.length ? st.prog : [0, 5, 3, 6];
      const progRate = Math.max(1, st.progRate | 0);
      const chordIndex = Math.floor(col / progRate) % prog.length;
      const chordDegree = ((prog[chordIndex] | 0) % 7 + 7) % 7;

      // scale across rows
      const degreesCount = 7 * clamp(st.octaveSpan ?? 5, 1, 8);
      const scaleMidi = buildScaleMidi({
        rootPc: clamp(st.keyRoot ?? 0, 0, 11),
        scaleName: st.scaleName,
        baseMidi: clamp(st.baseMidi ?? 36, 12, 72),
        degreesCount,
      });

      const chordTones = degreeToChordTones(scaleMidi, chordDegree, st.chordType === "triad" ? "triad" : "7");
      const maxNotes = clamp(st.maxNotesPerStep ?? 10, 1, 32);

      // Build map for quick access
      const map = new Map();
      for (const c of cellsNow) map.set(c.idx, c);

      const hits = [];

      for (let r = 0; r < rows; r++) {
        const idx = r * cols + col;
        const cell = map.get(idx);
        if (!cell?.paint) continue;

        const alpha = cellAlpha(cell, tNow);
        if (alpha <= 0.001) continue;

        // compute current animated color if seq-mode
        const colHex = computeCellColor(cell, r, col, tNow);
        if (!colHex) continue;

        const rgb = hexToRgb(colHex);
        if (!rgb) continue;

        const lum = luminance01(rgb);
        const h = hue01(rgb);

        const rowNorm = rows <= 1 ? 0.5 : 1 - r / (rows - 1);

        // lane / chord tone selection
        let lane = 0;
        if (st.laneMode === "hue") {
          const lanes = chordTones.length;
          lane = clamp(Math.floor(h * lanes), 0, lanes - 1);
        } else {
          lane = col % chordTones.length;
        }

        // row -> scale degree index
        const degFloat = rowNorm * (degreesCount - 1);
        const degIdx = clamp(Math.round(degFloat), 0, degreesCount - 1);

        const rowMidi = scaleMidi[degIdx];
        let target = chordTones[lane];

        // bring chord tone near rowMidi
        while (target < rowMidi - 6) target += 12;
        while (target > rowMidi + 6) target -= 12;

        const freq = midiToFreq(target);

        // velocity from luminance + cell alpha (so MIDI tails also soften sound)
        const vel = st.velFrom === "fixed" ? 0.55 : clamp((0.08 + 0.92 * lum) * lerp(0.35, 1.0, alpha), 0.03, 1);

        // cutoff from luminance + row
        const cutoffLum = clamp(0.18 + 0.82 * lum, 0, 1);
        const cutoffRow = clamp(0.25 + 0.75 * rowNorm, 0, 1);
        const cutoffMix = lerp(cutoffLum, cutoffRow, 0.45);
        const cutoff = (st.cutoffBase ?? 350) + (st.cutoffSpan ?? 8200) * clamp(cutoffMix, 0, 1);

        // ===== ROW tail / envelope control (this is where rows MUST affect sound) =====
        // rowNorm top=1 bottom=0:
        // - top: faster attack, shorter release (tight)
        // - bottom: slower attack, longer release (lush)
        const depth = clamp(st.rowTailDepth ?? 1.0, 0, 2);

        const aMin = clamp(st.envAttackMin ?? 0.004, 0.001, 0.1);
        const aMax = clamp(st.envAttackMax ?? 0.12, 0.02, 0.35);
        const attackBase = lerp(aMax, aMin, rowNorm); // top short
        const attack = lerp(attackBase, lerp(attackBase, attackBase * 1.35, 1 - rowNorm), clamp(depth - 1, 0, 1) * 0.6);

        let decay = (st.envDecayBase ?? 0.08) + (st.envDecaySpan ?? 0.75) * clamp(lum, 0, 1);
        let release = lerp(st.envReleaseMax ?? 0.95, st.envReleaseMin ?? 0.06, rowNorm); // bottom long

        // Variable row density influences tail length too (Swiss rows)
        if (isSwiss && st.varRowsOn && rowEdges) {
          const rh = rowEdges[r + 1] - rowEdges[r];
          const avg = 1 / rows;
          const ratio = clamp(rh / avg, 0.35, 2.6);
          // taller row => longer decay/release; denser (short) => shorter
          const tailScale = lerp(1, ratio, clamp(depth, 0, 1));
          decay *= clamp(tailScale, 0.6, 1.8);
          release *= clamp(tailScale, 0.7, 2.0);
        } else {
          // even without varRowsOn: row position itself changes tail
          const tailByRow = lerp(0.75, 1.25, 1 - rowNorm);
          decay *= lerp(1, tailByRow, clamp(depth, 0, 1));
          release *= lerp(1, tailByRow, clamp(depth, 0, 1));
        }

        decay = clamp(decay, 0.02, 1.8);
        release = clamp(release, 0.03, 2.8);

        // priority: stronger + slightly bias top for clarity
        const score = vel + rowNorm * 0.06 + alpha * 0.05;

        hits.push({ freq, vel, cutoff, attack, decay, release, rowNorm, lum, score });
      }

      hits.sort((a, b) => b.score - a.score);
      const chosen = hits.slice(0, maxNotes);

      // Trigger synth + optional perc
      const pool = audioRef.current.synthVoices;
      const percs = audioRef.current.percVoices;

      for (const h of chosen) {
        const v = pool[audioRef.current.synthPtr % pool.length];
        audioRef.current.synthPtr++;

        triggerSynth(ac, v, {
          freq: h.freq,
          vel: h.vel,
          cutoffHz: h.cutoff,
          attack: h.attack,
          decaySec: h.decay,
          release: h.release,
          detune: 0.6,
        });

        // Perc: bias to lower rows and darker luma (physical hits)
        if (st.percOn && percs.length) {
          const hitChance = clamp((1 - h.rowNorm) * 0.85 + (1 - h.lum) * 0.15, 0, 1);
          if (Math.random() < hitChance * 0.55) {
            const pv = percs[audioRef.current.percPtr % percs.length];
            audioRef.current.percPtr++;

            const pVel = (0.06 + h.vel * 0.22) * clamp(st.percMix, 0, 1);
            triggerPerc(ac, pv, {
              freq: clamp(h.freq * 0.55, 90, 2600),
              vel: pVel,
              attack: 0.0015,
              decaySec: clamp(0.06 + (1 - h.rowNorm) * 0.18, 0.04, 0.35),
              release: clamp(0.08 + (1 - h.rowNorm) * 0.22, 0.06, 0.6),
            });
          }
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
    // Start scheduler immediately; audio will remain silent until unlocked by gesture
    startScheduler();
    return () => stopScheduler();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // ===== Rendering =====
  const getFontFamily = () => `"Inter", system-ui, -apple-system, Segoe UI, Roboto, sans-serif`;

  function themeColors() {
    const dark = s.theme === "dark";
    return {
      bg: dark ? "#0B0B0D" : "#FAFAFA",
      panel: dark ? "#0F0F12" : "#F5F5F5",
      border: dark ? "#24242A" : "#E5E5E5",
      grid: dark ? "#202028" : "#E6E6E6",
      text: dark ? "#F2F2F4" : "#111111",
      text2: dark ? "#B8B8C2" : "#5A5A5A",
      cellText: dark ? "#0B0B0D" : "#0A0A0A",
      idleText: dark ? "#EDEDF2" : "#111111",
    };
  }

  const render = (tm) => {
    const cv = canvasRef.current;
    if (!cv) return;
    const ctx = cv.getContext("2d");
    const w = cv.width,
      h = cv.height;

    const t = tm * 0.001;
    const C = themeColors();

    ctx.clearRect(0, 0, w, h);
    ctx.fillStyle = C.bg;
    ctx.fillRect(0, 0, w, h);

    // paint lookup
    const map = new Map();
    for (const c of cells) map.set(c.idx, c);

    ctx.textAlign = "center";
    ctx.textBaseline = "middle";

    // helpful dims
    const dims = currentGridDims();

    if (s.pat === "char-grid") {
      const cols = Math.max(1, Math.floor(w / s.space));
      const rows = Math.max(1, Math.floor(h / s.space));

      if (s.gridLines) {
        ctx.save();
        ctx.strokeStyle = C.grid;
        ctx.lineWidth = 1;
        for (let c = 0; c <= cols; c++) {
          const x = c * s.space;
          ctx.beginPath();
          ctx.moveTo(x, 0);
          ctx.lineTo(x, h);
          ctx.stroke();
        }
        for (let r = 0; r <= rows; r++) {
          const y = r * s.space;
          ctx.beginPath();
          ctx.moveTo(0, y);
          ctx.lineTo(w, y);
          ctx.stroke();
        }
        ctx.restore();
      }

      const chs = (s.chars || "01").split("");
      const spd = (s.charSpd ?? 2) * 0.9;

      for (let r = 0; r < rows; r++) {
        for (let c = 0; c < cols; c++) {
          const idx = r * cols + c;
          const x0 = c * s.space;
          const y0 = r * s.space;
          const cx = x0 + s.space / 2;
          const cy = y0 + s.space / 2;

          const cell = map.get(idx);
          const alpha = cellAlpha(cell, t);
          const colHex = cell ? computeCellColor(cell, r, c, t) : null;

          if (colHex && alpha > 0) {
            ctx.save();
            ctx.fillStyle = colHex;
            ctx.globalAlpha = 0.92 * alpha;
            ctx.fillRect(x0, y0, s.space, s.space);
            ctx.restore();
          }

          const gi = chs.length ? (Math.floor((t * spd + r * 0.07 + c * 0.05) * 3) % chs.length) : 0;
          ctx.save();
          ctx.font = `${s.charSz}px ${getFontFamily()}`;
          ctx.fillStyle = colHex ? C.cellText : C.text;
          ctx.globalAlpha = colHex ? 0.9 : 0.8;
          ctx.fillText(chs[gi] ?? "0", cx, cy);
          ctx.restore();
        }
      }
      return;
    }

    // swiss-grid
    if (s.pat === "swiss-grid") {
      const cols = Math.max(1, s.cols | 0);
      const rows = Math.max(1, s.rows | 0);

      if (s.gridLines) {
        const ce = colEdges || Array.from({ length: cols + 1 }, (_, i) => i / cols);
        const re = rowEdges || Array.from({ length: rows + 1 }, (_, i) => i / rows);

        ctx.save();
        ctx.strokeStyle = C.grid;
        ctx.lineWidth = 1;
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
        ctx.restore();
      }

      const chs = (s.chars || "01").split("");
      const spd = (s.charSpd ?? 2) * 0.85;

      for (let r = 0; r < rows; r++) {
        for (let c = 0; c < cols; c++) {
          const idx = r * cols + c;
          const g = swissCellGeom(r, c, w, h);

          const cell = map.get(idx);
          const alpha = cellAlpha(cell, t);
          const colHex = cell ? computeCellColor(cell, r, c, t) : null;

          if (colHex && alpha > 0) {
            ctx.save();
            ctx.fillStyle = colHex;
            ctx.globalAlpha = 0.92 * alpha;
            ctx.fillRect(g.x, g.y, g.w, g.h);
            ctx.restore();
          }

          const gi = chs.length ? (Math.floor((t * spd + r * 0.09 + c * 0.05) * 3) % chs.length) : 0;
          const sz = Math.max(8, Math.min(g.w, g.h) * 0.55 * (s.swissCharScale ?? 1));

          ctx.save();
          ctx.font = `${Math.floor(sz)}px ${getFontFamily()}`;
          ctx.fillStyle = colHex ? C.cellText : C.text;
          ctx.globalAlpha = colHex ? 0.92 : 0.75;
          ctx.fillText(chs[gi] ?? "0", g.cx, g.cy);
          ctx.restore();
        }
      }

      // tiny HUD so you know grid dims even when dense
      ctx.save();
      ctx.font = `12px ${getFontFamily()}`;
      ctx.fillStyle = C.text2;
      ctx.globalAlpha = 0.75;
      ctx.textAlign = "left";
      ctx.textBaseline = "top";
      ctx.fillText(`${dims.cols}×${dims.rows}`, 10, 10);
      ctx.restore();
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
  }, [s, cells, colEdges, rowEdges, palette]);

  // Resize canvas
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

  // Load Inter font
  React.useEffect(() => {
    const link = document.createElement("link");
    link.href = "https://fonts.googleapis.com/css2?family=Inter:wght@400;600;700&display=swap";
    link.rel = "stylesheet";
    document.head.appendChild(link);
    return () => document.head.removeChild(link);
  }, []);

  // ===== Input handlers =====
  const onPointerDown = async (e) => {
    await unlockAudio();
    if (!audioRef.current.ac) ensureAudio();
    if (audioRef.current.ac?.state === "suspended") audioRef.current.ac.resume?.();

    e.preventDefault?.();
    try {
      e.currentTarget?.setPointerCapture?.(e.pointerId);
    } catch {}
    setDrawing(true);

    const cv = canvasRef.current;
    if (!cv) return;
    const { x, y } = pointerToCanvas(e);
    const idx = getIdx(x, y);
    if (idx == null) return;

    const st = sRef.current;
    if (st.pat === "swiss-grid") {
      const col = idx % st.cols;
      const row = Math.floor(idx / st.cols);
      applyPaintToIdx(idx, row, col);
    } else {
      const col = Math.floor(x / st.space);
      const row = Math.floor(y / st.space);
      applyPaintToIdx(idx, row, col);
    }
  };

  const onPointerMove = (e) => {
    if (!drawing) return;
    const cv = canvasRef.current;
    if (!cv) return;
    const { x, y } = pointerToCanvas(e);
    const idx = getIdx(x, y);
    if (idx == null) return;

    const st = sRef.current;
    if (st.pat === "swiss-grid") {
      const col = idx % st.cols;
      const row = Math.floor(idx / st.cols);
      applyPaintToIdx(idx, row, col);
    } else {
      const col = Math.floor(x / st.space);
      const row = Math.floor(y / st.space);
      applyPaintToIdx(idx, row, col);
    }
  };

  const onPointerUp = () => setDrawing(false);

  const clearPaint = () => setCells([]);

  const gen = () => {
    // keep UI; no destructive randomize
    setCells((p) => [...p]);
  };

  const C = themeColors();
  const keyName = NOTE_NAMES[s.keyRoot] ?? "C";

  return (
    <div
      className="w-full h-[100svh] flex flex-col md:flex-row overflow-hidden"
      style={{ background: C.bg, color: C.text }}
    >
      {panelOpen && <div className="fixed inset-0 bg-black/30 z-30 md:hidden" onClick={() => setPanelOpen(false)} />}

      {/* Controls */}
      <div
        className={
          "fixed md:static z-40 md:z-auto inset-y-0 left-0 w-80 max-w-[90vw] p-4 md:p-5 overflow-y-auto space-y-4 text-sm transform transition-transform duration-200 md:transform-none " +
          (panelOpen ? "translate-x-0" : "-translate-x-full md:translate-x-0")
        }
        style={{ background: C.panel, borderRight: `1px solid ${C.border}` }}
      >
        <div className="flex gap-2">
          <button
            onClick={gen}
            className="flex-1 flex justify-center px-4 py-2.5 rounded-lg font-medium min-h-[44px]"
            style={{ background: C.text, color: C.bg }}
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
            className="flex-1 flex justify-center px-4 py-2.5 rounded-lg font-medium min-h-[44px]"
            style={{ background: C.text, color: C.bg }}
            title="Download PNG"
          >
            <Download size={16} />
          </button>

          <button
            onClick={() => setS((p) => ({ ...p, theme: p.theme === "dark" ? "light" : "dark" }))}
            className="px-3 py-2.5 rounded-lg font-medium min-h-[44px]"
            style={{ background: "transparent", border: `1px solid ${C.border}`, color: C.text }}
            title="Dark / Light"
          >
            {s.theme === "dark" ? <Sun size={16} /> : <Moon size={16} />}
          </button>
        </div>

        {/* MIDI */}
        <div className="space-y-2">
          <div className="flex items-center justify-between gap-2">
            <label className="block text-xs font-semibold uppercase tracking-wider">MIDI</label>
            <button
              onClick={enableMIDI}
              className="px-3 py-2 rounded-lg text-xs font-semibold flex items-center gap-2 min-h-[36px]"
              style={{ background: C.text, color: C.bg }}
              title="Enable MIDI"
            >
              <Usb size={14} />
              Enable
            </button>
          </div>

          <div
            className="text-[11px] rounded-lg px-3 py-2"
            style={{
              background: s.theme === "dark" ? "#0A0A0C" : "#FFFFFF",
              border: `1px solid ${C.border}`,
              color: midiStatus.ok ? (s.theme === "dark" ? "#9FF7C1" : "#0B7A36") : C.text2,
            }}
          >
            {midiStatus.msg}
          </div>

          <div className="flex items-center justify-between">
            <div className="text-xs font-semibold uppercase tracking-wider">MIDI Paint</div>
            <button
              onClick={() => setS((p) => ({ ...p, midiOn: !p.midiOn }))}
              className={`p-1.5 rounded`}
              style={{ background: s.midiOn ? C.text : "transparent", border: `1px solid ${C.border}`, color: s.midiOn ? C.bg : C.text }}
              title="MIDI paint on/off"
            >
              {s.midiOn ? <Play size={14} fill={C.bg} /> : <Square size={14} />}
            </button>
          </div>

          <div className="grid grid-cols-2 gap-2">
            <div className="space-y-1">
              <div className="text-xs" style={{ color: C.text2 }}>
                Spread
              </div>
              <select
                value={s.midiSpread}
                onChange={(e) => setS((p) => ({ ...p, midiSpread: e.target.value }))}
                className="w-full px-2 py-2 rounded-lg text-xs"
                style={{ background: s.theme === "dark" ? "#0A0A0C" : "#FFFFFF", border: `1px solid ${C.border}`, color: C.text }}
              >
                <option value="roundRobin">Round-robin columns</option>
                <option value="channel">By channel</option>
              </select>
            </div>

            <div className="space-y-1">
              <div className="text-xs" style={{ color: C.text2 }}>
                Note tail (fallback)
              </div>
              <input
                type="range"
                min="0.2"
                max="6"
                step="0.1"
                value={s.midiPaintDecay}
                onChange={(e) => setS((p) => ({ ...p, midiPaintDecay: parseFloat(e.target.value) }))}
                className="w-full"
              />
            </div>
          </div>
        </div>

        {/* Pattern */}
        <div className="space-y-2">
          <label className="block text-xs font-semibold uppercase tracking-wider">Pattern</label>
          <select
            value={s.pat}
            onChange={(e) => setS((p) => ({ ...p, pat: e.target.value }))}
            className="w-full px-3 py-2 rounded-lg"
            style={{ background: s.theme === "dark" ? "#0A0A0C" : "#FFFFFF", border: `1px solid ${C.border}`, color: C.text }}
          >
            <option value="swiss-grid">Swiss Grid</option>
            <option value="char-grid">Character Grid</option>
          </select>
        </div>

        {/* Paint */}
        <div className="space-y-2">
          <label className="block text-xs font-semibold uppercase tracking-wider">Paint</label>

          <div className="flex items-center justify-between gap-2">
            <input
              type="color"
              value={paint.color}
              onChange={(e) => setPaint((p) => ({ ...p, color: e.target.value, useSeq: false }))}
              className="h-10 w-14 rounded-md border bg-white"
              style={{ borderColor: C.border }}
              title="Pick color"
            />

            <button
              onClick={() => setPaint((p) => ({ ...p, useSeq: !p.useSeq, mode: "color" }))}
              className="flex-1 px-3 py-2 rounded-lg border text-xs font-semibold flex items-center justify-center gap-2 min-h-[44px]"
              style={{
                background: paint.useSeq ? C.text : "transparent",
                color: paint.useSeq ? C.bg : C.text,
                borderColor: C.border,
              }}
            >
              <Palette size={14} />
              {paint.useSeq ? "Color String ON" : "Color String OFF"}
            </button>

            <button
              onClick={() => setPaint((p) => ({ ...p, mode: p.mode === "none" ? "color" : "none" }))}
              className="px-3 py-2 rounded-lg text-xs font-semibold min-h-[44px]"
              style={{
                background: paint.mode === "none" ? C.text : "transparent",
                color: paint.mode === "none" ? C.bg : C.text,
                border: `1px solid ${C.border}`,
              }}
              title="Erase / Draw"
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
                className="h-9 w-full rounded-md border bg-white"
                style={{ borderColor: C.border }}
                title={`Color String ${i + 1}`}
              />
            ))}
          </div>

          <div className="grid grid-cols-2 gap-2">
            <div className="space-y-1">
              <div className="text-xs" style={{ color: C.text2 }}>
                Motion
              </div>
              <select
                value={s.colorSeqBehave}
                onChange={(e) => setS((p) => ({ ...p, colorSeqBehave: e.target.value }))}
                className="w-full px-2 py-2 rounded-lg text-xs"
                style={{ background: s.theme === "dark" ? "#0A0A0C" : "#FFFFFF", border: `1px solid ${C.border}`, color: C.text }}
              >
                <option value="cycle">Cycle</option>
                <option value="wave">Wave</option>
                <option value="random">Random</option>
              </select>
            </div>
            <div className="space-y-1">
              <div className="text-xs" style={{ color: C.text2 }}>
                Speed (affects painted seq!)
              </div>
              <input
                type="range"
                min="0"
                max="6"
                step="0.05"
                value={s.colorSeqSpeed}
                onChange={(e) => setS((p) => ({ ...p, colorSeqSpeed: parseFloat(e.target.value) }))}
                className="w-full"
              />
            </div>
          </div>

          <button
            onClick={clearPaint}
            className="w-full px-4 py-2.5 rounded-lg font-medium min-h-[44px]"
            style={{ background: C.text, color: C.bg }}
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
            <input type="range" min="4" max="52" value={s.cols} onChange={(e) => setS((p) => ({ ...p, cols: parseInt(e.target.value, 10) }))} className="w-full" />
            <input type="range" min="4" max="52" value={s.rows} onChange={(e) => setS((p) => ({ ...p, rows: parseInt(e.target.value, 10) }))} className="w-full" />

            <div className="flex items-center justify-between">
              <label className="text-xs font-semibold uppercase tracking-wider">Grid Lines</label>
              <button
                onClick={() => setS((p) => ({ ...p, gridLines: !p.gridLines }))}
                className="p-1.5 rounded"
                style={{ background: s.gridLines ? C.text : "transparent", border: `1px solid ${C.border}`, color: s.gridLines ? C.bg : C.text }}
              >
                {s.gridLines ? <Play size={14} fill={C.bg} /> : <Square size={14} />}
              </button>
            </div>

            <label className="block text-xs font-semibold uppercase tracking-wider">Variable Grid Density</label>

            <div className="rounded-lg p-3 space-y-2" style={{ border: `1px solid ${C.border}`, background: s.theme === "dark" ? "#0A0A0C" : "#FFFFFF" }}>
              <div className="flex items-center justify-between">
                <div className="text-xs font-semibold uppercase tracking-wider">Columns (rhythm)</div>
                <button
                  onClick={() => setS((p) => ({ ...p, varColsOn: !p.varColsOn }))}
                  className="p-1.5 rounded"
                  style={{ background: s.varColsOn ? C.text : "transparent", border: `1px solid ${C.border}`, color: s.varColsOn ? C.bg : C.text }}
                >
                  {s.varColsOn ? <Play size={14} fill={C.bg} /> : <Square size={14} />}
                </button>
              </div>

              {s.varColsOn && (
                <>
                  <div className="text-[11px]" style={{ color: C.text2 }}>
                    This changes step timing (audible rhythm).
                  </div>

                  <label className="block text-xs font-semibold uppercase tracking-wider">Focus X: {s.colFocus.toFixed(2)}</label>
                  <input type="range" min="0" max="1" step="0.01" value={s.colFocus} onChange={(e) => setS((p) => ({ ...p, colFocus: parseFloat(e.target.value) }))} className="w-full" />

                  <label className="block text-xs font-semibold uppercase tracking-wider">Strength: {s.colStrength.toFixed(1)}</label>
                  <input type="range" min="0" max="24" step="0.1" value={s.colStrength} onChange={(e) => setS((p) => ({ ...p, colStrength: parseFloat(e.target.value) }))} className="w-full" />

                  <label className="block text-xs font-semibold uppercase tracking-wider">Band Width: {s.colSigma.toFixed(2)}</label>
                  <input type="range" min="0.05" max="0.5" step="0.01" value={s.colSigma} onChange={(e) => setS((p) => ({ ...p, colSigma: parseFloat(e.target.value) }))} className="w-full" />

                  <label className="block text-xs font-semibold uppercase tracking-wider">Rhythm depth: {s.colRhythmDepth.toFixed(2)}</label>
                  <input type="range" min="0" max="2" step="0.05" value={s.colRhythmDepth} onChange={(e) => setS((p) => ({ ...p, colRhythmDepth: parseFloat(e.target.value) }))} className="w-full" />
                </>
              )}
            </div>

            <div className="rounded-lg p-3 space-y-2" style={{ border: `1px solid ${C.border}`, background: s.theme === "dark" ? "#0A0A0C" : "#FFFFFF" }}>
              <div className="flex items-center justify-between">
                <div className="text-xs font-semibold uppercase tracking-wider">Rows (tails)</div>
                <button
                  onClick={() => setS((p) => ({ ...p, varRowsOn: !p.varRowsOn }))}
                  className="p-1.5 rounded"
                  style={{ background: s.varRowsOn ? C.text : "transparent", border: `1px solid ${C.border}`, color: s.varRowsOn ? C.bg : C.text }}
                >
                  {s.varRowsOn ? <Play size={14} fill={C.bg} /> : <Square size={14} />}
                </button>
              </div>

              <div className="text-[11px]" style={{ color: C.text2 }}>
                Rows change envelope (attack/decay/release). Variable row density also scales tails.
              </div>

              <label className="block text-xs font-semibold uppercase tracking-wider">Tail depth: {s.rowTailDepth.toFixed(2)}</label>
              <input type="range" min="0" max="2" step="0.05" value={s.rowTailDepth} onChange={(e) => setS((p) => ({ ...p, rowTailDepth: parseFloat(e.target.value) }))} className="w-full" />

              {s.varRowsOn && (
                <>
                  <label className="block text-xs font-semibold uppercase tracking-wider">Focus Y: {s.rowFocus.toFixed(2)}</label>
                  <input type="range" min="0" max="1" step="0.01" value={s.rowFocus} onChange={(e) => setS((p) => ({ ...p, rowFocus: parseFloat(e.target.value) }))} className="w-full" />

                  <label className="block text-xs font-semibold uppercase tracking-wider">Strength: {s.rowStrength.toFixed(1)}</label>
                  <input type="range" min="0" max="24" step="0.1" value={s.rowStrength} onChange={(e) => setS((p) => ({ ...p, rowStrength: parseFloat(e.target.value) }))} className="w-full" />

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
            <input type="range" min="12" max="140" value={s.space} onChange={(e) => setS((p) => ({ ...p, space: parseInt(e.target.value, 10) }))} className="w-full" />

            <label className="block text-xs font-semibold uppercase tracking-wider">Char Size: {s.charSz}px</label>
            <input type="range" min="8" max="90" value={s.charSz} onChange={(e) => setS((p) => ({ ...p, charSz: parseInt(e.target.value, 10) }))} className="w-full" />

            <label className="block text-xs font-semibold uppercase tracking-wider">Char Speed: {s.charSpd.toFixed(2)}×</label>
            <input type="range" min="0" max="12" step="0.1" value={s.charSpd} onChange={(e) => setS((p) => ({ ...p, charSpd: parseFloat(e.target.value) }))} className="w-full" />

            <label className="block text-xs font-semibold uppercase tracking-wider">Characters</label>
            <input
              type="text"
              value={s.chars}
              onChange={(e) => setS((p) => ({ ...p, chars: e.target.value }))}
              className="w-full px-3 py-2 rounded-lg font-mono"
              style={{ background: s.theme === "dark" ? "#0A0A0C" : "#FFFFFF", border: `1px solid ${C.border}`, color: C.text }}
            />

            <div className="flex items-center justify-between">
              <label className="text-xs font-semibold uppercase tracking-wider">Grid Lines</label>
              <button
                onClick={() => setS((p) => ({ ...p, gridLines: !p.gridLines }))}
                className="p-1.5 rounded"
                style={{ background: s.gridLines ? C.text : "transparent", border: `1px solid ${C.border}`, color: s.gridLines ? C.bg : C.text }}
              >
                {s.gridLines ? <Play size={14} fill={C.bg} /> : <Square size={14} />}
              </button>
            </div>
          </div>
        )}

        {/* Sound */}
        <div className="space-y-2">
          <div className="flex items-center justify-between">
            <label className="text-xs font-semibold uppercase tracking-wider">Sound</label>
            <button
              onClick={async () => {
                await unlockAudio();
                if (!audioRef.current.ac) ensureAudio();
                setS((p) => ({ ...p, soundOn: !p.soundOn }));
              }}
              className="p-1.5 rounded"
              style={{ background: s.soundOn ? C.text : "transparent", border: `1px solid ${C.border}`, color: s.soundOn ? C.bg : C.text }}
              title="Sound on/off"
            >
              {s.soundOn ? <Play size={14} fill={C.bg} /> : <Square size={14} />}
            </button>
          </div>

          <label className="block text-xs font-semibold uppercase tracking-wider">BPM: {s.bpm}</label>
          <input type="range" min="40" max="220" value={s.bpm} onChange={(e) => setS((p) => ({ ...p, bpm: parseInt(e.target.value, 10) }))} className="w-full" />

          <label className="block text-xs font-semibold uppercase tracking-wider">Max notes / step: {s.maxNotesPerStep}</label>
          <input type="range" min="1" max="18" value={s.maxNotesPerStep} onChange={(e) => setS((p) => ({ ...p, maxNotesPerStep: parseInt(e.target.value, 10) }))} className="w-full" />

          <div className="grid grid-cols-2 gap-2">
            <div className="space-y-1">
              <div className="text-xs" style={{ color: C.text2 }}>
                Key
              </div>
              <select
                value={s.keyRoot}
                onChange={(e) => setS((p) => ({ ...p, keyRoot: parseInt(e.target.value, 10) }))}
                className="w-full px-2 py-2 rounded-lg text-xs"
                style={{ background: s.theme === "dark" ? "#0A0A0C" : "#FFFFFF", border: `1px solid ${C.border}`, color: C.text }}
              >
                {NOTE_NAMES.map((n, i) => (
                  <option key={n} value={i}>
                    {n}
                  </option>
                ))}
              </select>
            </div>
            <div className="space-y-1">
              <div className="text-xs" style={{ color: C.text2 }}>
                Scale
              </div>
              <select
                value={s.scaleName}
                onChange={(e) => setS((p) => ({ ...p, scaleName: e.target.value }))}
                className="w-full px-2 py-2 rounded-lg text-xs"
                style={{ background: s.theme === "dark" ? "#0A0A0C" : "#FFFFFF", border: `1px solid ${C.border}`, color: C.text }}
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
              <div className="text-xs" style={{ color: C.text2 }}>
                Chord
              </div>
              <select
                value={s.chordType}
                onChange={(e) => setS((p) => ({ ...p, chordType: e.target.value }))}
                className="w-full px-2 py-2 rounded-lg text-xs"
                style={{ background: s.theme === "dark" ? "#0A0A0C" : "#FFFFFF", border: `1px solid ${C.border}`, color: C.text }}
              >
                <option value="7">7th</option>
                <option value="triad">Triad</option>
              </select>
            </div>
            <div className="space-y-1">
              <div className="text-xs" style={{ color: C.text2 }}>
                Lane mapping
              </div>
              <select
                value={s.laneMode}
                onChange={(e) => setS((p) => ({ ...p, laneMode: e.target.value }))}
                className="w-full px-2 py-2 rounded-lg text-xs"
                style={{ background: s.theme === "dark" ? "#0A0A0C" : "#FFFFFF", border: `1px solid ${C.border}`, color: C.text }}
              >
                <option value="column">By Column</option>
                <option value="hue">By Hue (color)</option>
              </select>
            </div>
          </div>

          <div className="text-[11px]" style={{ color: C.text2 }}>
            <b>Always in tune:</b> pitches are quantized to {keyName} {s.scaleName}.<br />
            <b>Rows:</b> envelope changes (attack/decay/release).<br />
            <b>Columns:</b> rhythm speed changes (when variable columns enabled).
          </div>

          <label className="block text-xs font-semibold uppercase tracking-wider">Voices: {s.voices}</label>
          <input type="range" min="1" max="28" value={s.voices} onChange={(e) => setS((p) => ({ ...p, voices: parseInt(e.target.value, 10) }))} className="w-full" />

          <div className="flex items-center justify-between">
            <div className="text-xs font-semibold uppercase tracking-wider">Perc layer</div>
            <button
              onClick={() => setS((p) => ({ ...p, percOn: !p.percOn }))}
              className="p-1.5 rounded"
              style={{ background: s.percOn ? C.text : "transparent", border: `1px solid ${C.border}`, color: s.percOn ? C.bg : C.text }}
            >
              {s.percOn ? <Play size={14} fill={C.bg} /> : <Square size={14} />}
            </button>
          </div>
          <label className="block text-xs font-semibold uppercase tracking-wider">Perc Mix: {s.percMix.toFixed(2)}</label>
          <input type="range" min="0" max="1" step="0.01" value={s.percMix} onChange={(e) => setS((p) => ({ ...p, percMix: parseFloat(e.target.value) }))} className="w-full" />

          <label className="block text-xs font-semibold uppercase tracking-wider">Master: {s.master.toFixed(2)}</label>
          <input type="range" min="0" max="1.2" step="0.01" value={s.master} onChange={(e) => setS((p) => ({ ...p, master: parseFloat(e.target.value) }))} className="w-full" />
        </div>

        {/* FX */}
        <div className="space-y-2">
          <label className="block text-xs font-semibold uppercase tracking-wider">FX</label>

          <div className="rounded-lg p-3 space-y-2" style={{ border: `1px solid ${C.border}`, background: s.theme === "dark" ? "#0A0A0C" : "#FFFFFF" }}>
            <div className="flex items-center justify-between">
              <div className="text-xs font-semibold uppercase tracking-wider">Reverb</div>
              <button
                onClick={() => setS((p) => ({ ...p, reverbOn: !p.reverbOn }))}
                className="p-1.5 rounded"
                style={{ background: s.reverbOn ? C.text : "transparent", border: `1px solid ${C.border}`, color: s.reverbOn ? C.bg : C.text }}
              >
                {s.reverbOn ? <Play size={14} fill={C.bg} /> : <Square size={14} />}
              </button>
            </div>
            <label className="block text-xs font-semibold uppercase tracking-wider">Mix: {s.reverbMix.toFixed(2)}</label>
            <input type="range" min="0" max="0.8" step="0.01" value={s.reverbMix} onChange={(e) => setS((p) => ({ ...p, reverbMix: parseFloat(e.target.value) }))} className="w-full" />
            <label className="block text-xs font-semibold uppercase tracking-wider">Time: {s.reverbTime.toFixed(1)}s</label>
            <input type="range" min="0.5" max="6" step="0.1" value={s.reverbTime} onChange={(e) => setS((p) => ({ ...p, reverbTime: parseFloat(e.target.value) }))} className="w-full" />
          </div>

          <div className="rounded-lg p-3 space-y-2" style={{ border: `1px solid ${C.border}`, background: s.theme === "dark" ? "#0A0A0C" : "#FFFFFF" }}>
            <div className="flex items-center justify-between">
              <div className="text-xs font-semibold uppercase tracking-wider">Delay</div>
              <button
                onClick={() => setS((p) => ({ ...p, delayOn: !p.delayOn }))}
                className="p-1.5 rounded"
                style={{ background: s.delayOn ? C.text : "transparent", border: `1px solid ${C.border}`, color: s.delayOn ? C.bg : C.text }}
              >
                {s.delayOn ? <Play size={14} fill={C.bg} /> : <Square size={14} />}
              </button>
            </div>
            <label className="block text-xs font-semibold uppercase tracking-wider">Mix: {s.delayMix.toFixed(2)}</label>
            <input type="range" min="0" max="0.8" step="0.01" value={s.delayMix} onChange={(e) => setS((p) => ({ ...p, delayMix: parseFloat(e.target.value) }))} className="w-full" />
            <label className="block text-xs font-semibold uppercase tracking-wider">Time: {s.delayTime.toFixed(2)}s</label>
            <input type="range" min="0.05" max="0.9" step="0.01" value={s.delayTime} onChange={(e) => setS((p) => ({ ...p, delayTime: parseFloat(e.target.value) }))} className="w-full" />
            <label className="block text-xs font-semibold uppercase tracking-wider">Feedback: {s.delayFeedback.toFixed(2)}</label>
            <input type="range" min="0" max="0.85" step="0.01" value={s.delayFeedback} onChange={(e) => setS((p) => ({ ...p, delayFeedback: parseFloat(e.target.value) }))} className="w-full" />
          </div>

          <div className="rounded-lg p-3 space-y-2" style={{ border: `1px solid ${C.border}`, background: s.theme === "dark" ? "#0A0A0C" : "#FFFFFF" }}>
            <div className="flex items-center justify-between">
              <div className="text-xs font-semibold uppercase tracking-wider">Drive</div>
              <button
                onClick={() => setS((p) => ({ ...p, driveOn: !p.driveOn }))}
                className="p-1.5 rounded"
                style={{ background: s.driveOn ? C.text : "transparent", border: `1px solid ${C.border}`, color: s.driveOn ? C.bg : C.text }}
              >
                {s.driveOn ? <Play size={14} fill={C.bg} /> : <Square size={14} />}
              </button>
            </div>
            <label className="block text-xs font-semibold uppercase tracking-wider">Amount: {s.drive.toFixed(2)}</label>
            <input type="range" min="0" max="1" step="0.01" value={s.drive} onChange={(e) => setS((p) => ({ ...p, drive: parseFloat(e.target.value) }))} className="w-full" />
          </div>
        </div>

        <div className="text-[11px]" style={{ color: C.text2 }}>
          Audio starts after a click/touch. MIDI does not disable the sequencer — it adds to it.
        </div>
      </div>

      {/* Canvas */}
      <div className="flex-1 min-h-0 p-2 md:p-8 relative overflow-hidden" style={{ background: C.bg }}>
        <button
          onClick={() => setPanelOpen((v) => !v)}
          className="md:hidden absolute top-3 left-3 z-20 px-3 py-2 rounded-lg text-xs font-semibold shadow"
          style={{ background: C.text, color: C.bg }}
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
          style={{ touchAction: "none", border: `1px solid ${C.border}` }}
        />
      </div>
    </div>
  );
}
