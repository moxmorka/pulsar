// App.jsx
import React from "react";
import {
  RotateCcw,
  Download,
  Play,
  Square,
  Palette,
  Moon,
  Sun,
  Layers,
} from "lucide-react";

/* =======================
   Utilities
======================= */
const clamp = (v, a, b) => Math.max(a, Math.min(b, v));

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
function hslToRgb(h, s, l) {
  // h:0..1 s:0..1 l:0..1
  const hue2rgb = (p, q, t) => {
    if (t < 0) t += 1;
    if (t > 1) t -= 1;
    if (t < 1 / 6) return p + (q - p) * 6 * t;
    if (t < 1 / 2) return q;
    if (t < 2 / 3) return p + (q - p) * (2 / 3 - t) * 6;
    return p;
  };
  let r, g, b;
  if (s === 0) r = g = b = l;
  else {
    const q = l < 0.5 ? l * (1 + s) : l + s - l * s;
    const p = 2 * l - q;
    r = hue2rgb(p, q, h + 1 / 3);
    g = hue2rgb(p, q, h);
    b = hue2rgb(p, q, h - 1 / 3);
  }
  return { r: Math.round(r * 255), g: Math.round(g * 255), b: Math.round(b * 255) };
}
function rgbToHex({ r, g, b }) {
  const to2 = (n) => n.toString(16).padStart(2, "0");
  return `#${to2(r)}${to2(g)}${to2(b)}`;
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

/* =======================
   Sound engine w/ FX
   (stable graph, no hum, no stuck sound)
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

/* ===== Melody voice: continuous osc, gated by envelope ===== */
function makeMelVoice(ac) {
  const osc = ac.createOscillator();
  const filter = ac.createBiquadFilter();
  const gain = ac.createGain();

  osc.type = "sawtooth";
  filter.type = "lowpass";
  filter.Q.value = 0.65;

  // extremely low idle to avoid "hum"
  gain.gain.value = 0.000001;

  osc.connect(filter);
  filter.connect(gain);

  osc.start();
  return { osc, filter, gain };
}

function triggerMelVoice(ac, voice, { freq, vel, cutoffHz, attack, decaySec, release }) {
  const now = ac.currentTime;
  const v = clamp(vel, 0.00005, 1);

  voice.osc.frequency.setValueAtTime(freq, now);

  voice.filter.frequency.cancelScheduledValues(now);
  voice.filter.frequency.setValueAtTime(clamp(cutoffHz, 80, 16000), now);

  const g = voice.gain.gain;
  g.cancelScheduledValues(now);
  g.setValueAtTime(0.000001, now);
  g.exponentialRampToValueAtTime(Math.max(0.00001, v), now + clamp(attack, 0.001, 0.2));
  g.exponentialRampToValueAtTime(
    0.000001,
    now + clamp(attack, 0.001, 0.2) + clamp(decaySec, 0.02, 2.5) + clamp(release, 0.02, 2.8)
  );
}

/* ===== Perc hit: one-shot (noise + body osc) through resonator ===== */
function makeNoiseBuffer(ac) {
  const len = Math.floor(ac.sampleRate * 0.35);
  const buf = ac.createBuffer(1, len, ac.sampleRate);
  const d = buf.getChannelData(0);
  for (let i = 0; i < len; i++) {
    // simple "pink-ish" tilt by decaying amplitude
    const t = i / len;
    d[i] = (Math.random() * 2 - 1) * Math.pow(1 - t, 1.7);
  }
  return buf;
}

function triggerPercHit(ac, outNode, noiseBuf, params) {
  const now = ac.currentTime;

  const vel = clamp(params.vel ?? 0.7, 0.02, 1);
  const f0 = clamp(params.freq ?? 80, 20, 1200);

  const attack = clamp(params.attack ?? 0.002, 0.001, 0.06);
  const decay = clamp(params.decay ?? 0.18, 0.02, 3.0);
  const tone = clamp(params.tone ?? 0.55, 0, 1);
  const damp = clamp(params.damp ?? 0.55, 0, 1);
  const punch = clamp(params.punch ?? 0.6, 0, 1);
  const noiseMix = clamp(params.noiseMix ?? 0.35, 0, 1);
  const bodyMix = clamp(params.bodyMix ?? 0.75, 0, 1);

  // sources
  const noise = ac.createBufferSource();
  noise.buffer = noiseBuf;

  const body = ac.createOscillator();
  body.type = "sine";

  // fast pitch drop ("taiko-ish" thump) – controllable
  const drop = clamp(params.pitchDrop ?? 0.55, 0, 1);
  const fStart = f0 * (1 + drop * 2.2);
  body.frequency.setValueAtTime(fStart, now);
  body.frequency.exponentialRampToValueAtTime(f0, now + clamp(0.02 + (1 - punch) * 0.06, 0.01, 0.12));

  // resonator
  const reson = ac.createBiquadFilter();
  reson.type = "bandpass";
  reson.frequency.setValueAtTime(f0, now);
  // Q higher = more ringing
  reson.Q.setValueAtTime(0.8 + (1 - damp) * 12.0, now);

  // tone shaping
  const lp = ac.createBiquadFilter();
  lp.type = "lowpass";
  // tone controls brightness of the hit
  const lpHz = 300 + tone * 12000;
  lp.frequency.setValueAtTime(lpHz, now);

  // mix
  const nGain = ac.createGain();
  const bGain = ac.createGain();
  nGain.gain.setValueAtTime(noiseMix * vel, now);
  bGain.gain.setValueAtTime(bodyMix * vel, now);

  // envelope at the end (so everything decays together)
  const amp = ac.createGain();
  amp.gain.setValueAtTime(0.000001, now);
  amp.gain.exponentialRampToValueAtTime(Math.max(0.00001, vel), now + attack);
  amp.gain.exponentialRampToValueAtTime(0.000001, now + attack + decay);

  // connect
  noise.connect(nGain);
  body.connect(bGain);

  nGain.connect(reson);
  bGain.connect(reson);

  reson.connect(lp);
  lp.connect(amp);
  amp.connect(outNode);

  // start/stop
  noise.start(now);
  noise.stop(now + attack + decay + 0.05);

  body.start(now);
  body.stop(now + attack + decay + 0.05);
}

/* =======================
   Main App
======================= */
export default function App() {
  const canvasRef = React.useRef(null);
  const rafRef = React.useRef(null);

  // ====== Layers: melody + percussion ======
  const [cellsMel, setCellsMel] = React.useState([]);
  const [cellsPerc, setCellsPerc] = React.useState([]);

  const cellsMelRef = React.useRef([]);
  const cellsPercRef = React.useRef([]);
  React.useEffect(() => {
    cellsMelRef.current = cellsMel;
  }, [cellsMel]);
  React.useEffect(() => {
    cellsPercRef.current = cellsPerc;
  }, [cellsPerc]);

  const [panelOpen, setPanelOpen] = React.useState(false);

  // painting
  const [paint, setPaint] = React.useState({
    mode: "color", // color | none
    color: "#111111",
    useSeq: true,
    layer: "mel", // mel | perc
  });
  const [drawing, setDrawing] = React.useState(false);

  // ===== settings =====
  const [s, setS] = React.useState({
    darkMode: false,

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

    // variable density (applies to both swiss + char-grid)
    varColsOn: false,
    colFocus: 0.5,
    colStrength: 6,
    colSigma: 0.18,

    varRowsOn: false,
    rowFocus: 0.5,
    rowStrength: 6,
    rowSigma: 0.18,

    // color string (animated when painting with seq)
    colorSeq: ["#111111", "#ff0055", "#00c2ff", "#00ff88", "#ffe600"],
    colorSeqSpeed: 1.0,
    colorSeqBehave: "same", // same | cycle | wave | random

    // view layers
    viewLayer: "both", // both | mel | perc
    ghost: 0.45, // overlay alpha for non-active layer

    // ======= MELODY SYNTH (always in key) =======
    soundOn: true,
    bpm: 120,
    maxNotesPerStep: 10,

    keyRoot: 0,
    scaleName: "naturalMinor",
    baseMidi: 36,
    octaveSpan: 4,
    chordType: "7",
    prog: [0, 5, 3, 6],
    progRate: 4,

    laneMode: "hue", // column | hue
    velFrom: "luma", // luma | fixed
    cutoffBase: 400,
    cutoffSpan: 7200,

    // envelope bases
    atkBase: 0.008,
    atkSpan: 0.09,
    decBase: 0.08,
    decSpan: 0.65,
    relBase: 0.06,
    relSpan: 0.85,

    voices: 14,

    // FX
    master: 0.85,
    reverbOn: true,
    reverbMix: 0.22,
    reverbTime: 2.2,
    delayOn: true,
    delayMix: 0.18,
    delayTime: 0.28,
    delayFeedback: 0.35,
    driveOn: true,
    drive: 0.45, // default less overdriven

    // ======= PERCUSSION (tuned, physical-ish) =======
    percOn: true,
    percMaxHitsPerStep: 6,

    // percussion pitch always in key too:
    percBaseMidi: 24, // deeper default
    percOctaveSpan: 2,

    percAttack: 0.002,
    percDecayBase: 0.18,
    percDecaySpan: 0.95,

    percTone: 0.45,
    percDamp: 0.55,
    percPunch: 0.7,
    percNoiseMix: 0.28,
    percBodyMix: 0.85,
    percPitchDrop: 0.65,

    percGain: 0.9,

    // ======= MIDI =======
    midiOn: true,
    midiDraw: true,
    midiThru: true,
    midiChannel: -1,
    midiLo: 36,
    midiHi: 84,
    midiFadeMin: 0.25,
    midiFadeMax: 2.5,
    midiTargetLayer: "mel", // mel | perc
  });

  const sRef = React.useRef(s);
  React.useEffect(() => {
    sRef.current = s;
  }, [s]);

  // palette (5)
  const palette = React.useMemo(() => {
    const arr = Array.isArray(s.colorSeq) ? s.colorSeq : [];
    const fixed = arr.map((x) => (isHexColor(x) ? x : "#111111"));
    const five = fixed.slice(0, 5);
    while (five.length < 5) five.push("#111111");
    return five;
  }, [s.colorSeq]);

  const colorSeqIndex = React.useCallback(
    (t, r, c, len) => {
      if (len <= 1) return 0;
      const beh = s.colorSeqBehave === "same" ? "wave" : s.colorSeqBehave;
      const tt = t * (s.colorSeqSpeed || 1);
      if (beh === "cycle") return (Math.floor(tt * 3) + r + c) % len;
      if (beh === "wave") {
        const wv = Math.sin((c * 0.5 + r * 0.33 + tt) * 0.8);
        return Math.floor((wv + 1) * 0.5 * len) % len;
      }
      const sd = r * 1000 + c + Math.floor(tt * 2);
      return Math.floor((Math.sin(sd) * 0.5 + 0.5) * len) % len;
    },
    [s.colorSeqBehave, s.colorSeqSpeed]
  );

  /* =======================
     Grid geometry helpers
======================= */
  const colEdgesSwiss = React.useMemo(() => {
    if (s.pat !== "swiss-grid") return null;
    return s.varColsOn
      ? buildVariableEdges(s.cols, s.colFocus, s.colStrength, s.colSigma)
      : Array.from({ length: s.cols + 1 }, (_, i) => i / s.cols);
  }, [s.pat, s.cols, s.varColsOn, s.colFocus, s.colStrength, s.colSigma]);

  const rowEdgesSwiss = React.useMemo(() => {
    if (s.pat !== "swiss-grid") return null;
    return s.varRowsOn
      ? buildVariableEdges(s.rows, s.rowFocus, s.rowStrength, s.rowSigma)
      : Array.from({ length: s.rows + 1 }, (_, i) => i / s.rows);
  }, [s.pat, s.rows, s.varRowsOn, s.rowFocus, s.rowStrength, s.rowSigma]);

  function swissCellGeom(r, c, w, h) {
    const ce = colEdgesSwiss || Array.from({ length: s.cols + 1 }, (_, i) => i / s.cols);
    const re = rowEdgesSwiss || Array.from({ length: s.rows + 1 }, (_, i) => i / s.rows);
    const x0 = ce[c] * w;
    const x1 = ce[c + 1] * w;
    const y0 = re[r] * h;
    const y1 = re[r + 1] * h;
    return { x: x0, y: y0, w: x1 - x0, h: y1 - y0, cx: (x0 + x1) / 2, cy: (y0 + y1) / 2 };
  }

  const pointerToCanvas = (e) => {
    const cv = canvasRef.current;
    const r = cv.getBoundingClientRect();
    const x = (e.clientX - r.left) * (cv.width / r.width);
    const y = (e.clientY - r.top) * (cv.height / r.height);
    return { x, y };
  };

  const getCharDims = React.useCallback(() => {
    const cv = canvasRef.current;
    if (!cv) return { cols: 16, rows: 12 };
    return {
      cols: Math.max(1, Math.floor(cv.width / s.space)),
      rows: Math.max(1, Math.floor(cv.height / s.space)),
    };
  }, [s.space]);

  const getSwissIdx = React.useCallback(
    (cx, cy) => {
      const cv = canvasRef.current;
      if (!cv) return null;
      const x01 = cx / cv.width;
      const y01 = cy / cv.height;
      const ce = colEdgesSwiss || Array.from({ length: s.cols + 1 }, (_, i) => i / s.cols);
      const re = rowEdgesSwiss || Array.from({ length: s.rows + 1 }, (_, i) => i / s.rows);
      const col = findIndexFromEdges(ce, x01);
      const row = findIndexFromEdges(re, y01);
      if (col < 0 || row < 0 || col >= s.cols || row >= s.rows) return null;
      return row * s.cols + col;
    },
    [s.cols, s.rows, colEdgesSwiss, rowEdgesSwiss]
  );

  const getCharIdx = React.useCallback(
    (cx, cy) => {
      const cv = canvasRef.current;
      if (!cv) return null;
      const { cols, rows } = getCharDims();
      const col = Math.floor(cx / s.space);
      const row = Math.floor(cy / s.space);
      if (col < 0 || row < 0 || col >= cols || row >= rows) return null;
      return row * cols + col;
    },
    [s.space, getCharDims]
  );

  const getIdx = React.useCallback(
    (cx, cy) => {
      if (s.pat === "swiss-grid") return getSwissIdx(cx, cy);
      if (s.pat === "char-grid") return getCharIdx(cx, cy);
      return null;
    },
    [s.pat, getSwissIdx, getCharIdx]
  );

  /* =======================
     Layer cell ops
======================= */
  const upsertCell = React.useCallback((layer, idx, patch) => {
    const setFn = layer === "perc" ? setCellsPerc : setCellsMel;
    setFn((prev) => {
      const ex = prev.findIndex((c) => c.idx === idx);
      const next = [...prev];
      if (ex >= 0) next[ex] = { ...next[ex], ...patch };
      else next.push({ idx, ...patch });
      return next;
    });
  }, []);

  const removeCell = React.useCallback((layer, idx) => {
    const setFn = layer === "perc" ? setCellsPerc : setCellsMel;
    setFn((prev) => prev.filter((c) => c.idx !== idx));
  }, []);

  // animated color-string: store as mode "seq" and compute color at render/scheduler time
  const applyPaintToIdx = (layer, idx, r, c, t) => {
    if (idx == null) return;
    if (paint.mode === "none") {
      removeCell(layer, idx);
      return;
    }

    if (paint.useSeq) {
      upsertCell(layer, idx, { paint: { mode: "seq" }, expiresAt: undefined });
    } else {
      upsertCell(layer, idx, { paint: { mode: "color", color: paint.color }, expiresAt: undefined });
    }
  };

  // compute current cell color (handles seq animation)
  const getCellColor = React.useCallback(
    (cell, r, c, t) => {
      if (!cell?.paint) return null;
      if (cell.paint.mode === "color") return cell.paint.color || null;
      if (cell.paint.mode === "seq") {
        const len = palette.length;
        const ci = colorSeqIndex(t, r, c, len);
        return palette[ci];
      }
      return cell.paint.color || null;
    },
    [palette, colorSeqIndex]
  );

  /* =======================
     AUDIO GRAPH (stable)
======================= */
  const audioRef = React.useRef({
    ac: null,

    // master chain
    master: null,
    hp: null,

    // FX busses (melody only)
    dry: null,
    wetRev: null,
    wetDel: null,
    convolver: null,
    delay: null,
    feedback: null,
    drive: null,

    // melody voices
    melVoices: [],
    melPtr: 0,

    // percussion out
    percBus: null,
    noiseBuf: null,

    // scheduler
    running: false,
    step: 0,
    timer: null,
  });

  function ensureAudio() {
    const A = audioRef.current;
    if (!A.ac) {
      const ac = new (window.AudioContext || window.webkitAudioContext)();

      // master
      const master = ac.createGain();
      master.gain.value = 0.85;

      // highpass to kill rumble/DC (helps “hum” feel)
      const hp = ac.createBiquadFilter();
      hp.type = "highpass";
      hp.frequency.value = 18;
      hp.Q.value = 0.7;

      // drive (melody only)
      const drive = ac.createWaveShaper();
      drive.oversample = "2x";

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

      // percussion bus (no drive by default, keeps it clean + deep)
      const percBus = ac.createGain();
      percBus.gain.value = 1.0;

      // routing:
      // melody voices -> drive -> split (dry + fx) -> master
      // percussion -> master (pre-fx)  (you can always route it later if you want)
      drive.connect(dry);
      drive.connect(convolver);
      drive.connect(delay);

      convolver.connect(wetRev);
      delay.connect(wetDel);

      dry.connect(master);
      wetRev.connect(master);
      wetDel.connect(master);

      percBus.connect(master);

      // master -> hp -> destination
      master.connect(hp);
      hp.connect(ac.destination);

      // init drive curve
      const makeDriveCurve = (amount) => {
        const k = clamp(amount ?? 0.45, 0, 1) * 40;
        const n = 2048;
        const curve = new Float32Array(n);
        for (let i = 0; i < n; i++) {
          const x = (i * 2) / (n - 1) - 1;
          curve[i] = Math.tanh(x * (1 + k));
        }
        return curve;
      };
      drive.curve = makeDriveCurve(sRef.current.drive);

      A.ac = ac;
      A.master = master;
      A.hp = hp;

      A.drive = drive;
      A.dry = dry;
      A.wetRev = wetRev;
      A.wetDel = wetDel;
      A.convolver = convolver;
      A.delay = delay;
      A.feedback = feedback;

      A.percBus = percBus;
      A.noiseBuf = makeNoiseBuffer(ac);

      A.melVoices = [];
      A.melPtr = 0;

      A.running = false;
      A.step = 0;
      A.timer = null;
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

    // drive (melody)
    if (st.driveOn) {
      const k = clamp(st.drive ?? 0.45, 0, 1) * 40;
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

    // reverb/delay
    A.wetRev.gain.setTargetAtTime(st.reverbOn ? clamp(st.reverbMix, 0, 1) : 0, A.ac.currentTime, 0.02);
    if (A._revTime == null) A._revTime = st.reverbTime;
    if (Math.abs(st.reverbTime - A._revTime) > 0.12) {
      A._revTime = st.reverbTime;
      A.convolver.buffer = createReverbImpulse(A.ac, clamp(st.reverbTime, 0.3, 6), 2.0);
    }

    A.wetDel.gain.setTargetAtTime(st.delayOn ? clamp(st.delayMix, 0, 1) : 0, A.ac.currentTime, 0.02);
    A.delay.delayTime.setTargetAtTime(clamp(st.delayTime, 0.01, 1.5), A.ac.currentTime, 0.02);
    A.feedback.gain.setTargetAtTime(clamp(st.delayFeedback, 0, 0.95), A.ac.currentTime, 0.02);

    // percussion gain
    if (A.percBus) A.percBus.gain.setTargetAtTime(clamp(st.percGain ?? 0.9, 0, 2), A.ac.currentTime, 0.02);
  }

  function ensureMelVoices() {
    const A = ensureAudio();
    const ac = A.ac;
    const want = clamp(sRef.current.voices ?? 14, 1, 32);
    if (A.melVoices.length !== want) {
      const newPool = Array.from({ length: want }, () => {
        const v = makeMelVoice(ac);
        v.gain.connect(A.drive);
        return v;
      });
      A.melVoices = newPool;
      A.melPtr = 0;
    }
  }

  // if you clear/stop, force all voice gains super low (prevents “stuck”)
  function hardSilenceMelody() {
    const A = audioRef.current;
    if (!A.ac) return;
    const now = A.ac.currentTime;
    for (const v of A.melVoices) {
      try {
        v.gain.gain.cancelScheduledValues(now);
        v.gain.gain.setValueAtTime(0.000001, now);
      } catch {}
    }
  }

  React.useEffect(() => {
    if (audioRef.current.ac) {
      ensureMelVoices();
      updateAudioParamsRealtime();
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [s]);

  /* =======================
     Scheduler (stable)
     - uses BOTH layers
     - varCols affects rhythm (stepSec)
     - varRows affects envelope/tails (both swiss+char)
     - NO top-row bias; bottom triggers properly
======================= */
  function computeDimsAndEdges(st) {
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

    // edges: swiss uses memoized; char builds on the fly (so density works in char-grid too)
    const colEdges = isSwiss
      ? colEdgesSwiss || Array.from({ length: cols + 1 }, (_, i) => i / cols)
      : st.varColsOn
        ? buildVariableEdges(cols, st.colFocus, st.colStrength, st.colSigma)
        : Array.from({ length: cols + 1 }, (_, i) => i / cols);

    const rowEdges = isSwiss
      ? rowEdgesSwiss || Array.from({ length: rows + 1 }, (_, i) => i / rows)
      : st.varRowsOn
        ? buildVariableEdges(rows, st.rowFocus, st.rowStrength, st.rowSigma)
        : Array.from({ length: rows + 1 }, (_, i) => i / rows);

    return { cols, rows, colEdges, rowEdges, isSwiss };
  }

  function startScheduler() {
    const A = ensureAudio();
    const ac = A.ac;
    if (ac.state === "suspended") ac.resume?.();
    A.running = true;

    const tick = () => {
      if (!audioRef.current.running) return;

      const st = sRef.current;

      // keep graph fresh
      ensureMelVoices();
      updateAudioParamsRealtime();

      const nowT = performance.now() * 0.001;

      // dims + density edges for current pattern
      const { cols, rows, colEdges, rowEdges } = computeDimsAndEdges(st);

      // base step
      const bpm = clamp(st.bpm ?? 120, 30, 260);
      const baseStepSec = 60 / bpm / 2; // 8th grid
      let stepSec = baseStepSec;

      // columns => rhythm
      if (st.varColsOn && colEdges) {
        const curCol = audioRef.current.step % cols;
        const w = colEdges[curCol + 1] - colEdges[curCol];
        const avg = 1 / cols;
        const ratio = clamp(w / avg, 0.35, 2.4);
        stepSec = baseStepSec * ratio;
      }

      const col = audioRef.current.step % cols;

      // ===== Harmony for melody =====
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

      // ===== Perc scale (also in key) =====
      const percDegreesCount = 7 * clamp(st.percOctaveSpan ?? 2, 1, 6);
      const percScaleMidi = buildScaleMidi({
        rootPc: clamp(st.keyRoot ?? 0, 0, 11),
        scaleName: st.scaleName,
        baseMidi: clamp(st.percBaseMidi ?? 24, 0, 84),
        degreesCount: percDegreesCount,
      });

      // map cells into quick maps
      const melMap = new Map();
      for (const c of cellsMelRef.current) melMap.set(c.idx, c);
      const percMap = new Map();
      for (const c of cellsPercRef.current) percMap.set(c.idx, c);

      // average row height (for tails)
      const avgRowH = 1 / rows;

      // ===== Collect Melody hits from current column =====
      const melHits = [];
      if (st.soundOn) {
        const maxNotes = clamp(st.maxNotesPerStep ?? 10, 1, 32);

        for (let r = 0; r < rows; r++) {
          const idx = r * cols + col;
          const cell = melMap.get(idx);
          if (!cell?.paint) continue;

          // expiry (MIDI)
          if (typeof cell.expiresAt === "number" && cell.expiresAt <= nowT) continue;

          // animated / current color
          const colNow = getCellColor(cell, r, col, nowT);
          const rgb = hexToRgb(colNow);
          if (!rgb) continue;

          const lum = luminance01(rgb);
          const h = hue01(rgb);

          // lane selection
          let lane = 0;
          if (st.laneMode === "hue") {
            const lanes = chordTones.length;
            lane = clamp(Math.floor(h * lanes), 0, lanes - 1);
          } else {
            lane = col % chordTones.length;
          }

          // row -> scale degree index (top=high)
          const rowNorm = rows <= 1 ? 0.5 : 1 - r / (rows - 1);
          const degFloat = rowNorm * (degreesCount - 1);
          const degIdx = clamp(Math.round(degFloat), 0, degreesCount - 1);

          // choose chord tone near row degree
          const rowMidi = scaleMidi[degIdx];
          let target = chordTones[lane];
          while (target < rowMidi - 6) target += 12;
          while (target > rowMidi + 6) target -= 12;

          const freq = midiToFreq(target);

          const vel = st.velFrom === "fixed" ? 0.55 : clamp(0.08 + 0.92 * lum, 0.05, 1);

          // brightness -> cutoff
          const cutoff = (st.cutoffBase ?? 400) + (st.cutoffSpan ?? 7200) * clamp(0.15 + 0.85 * lum, 0, 1);

          // envelope controlled by row position
          let attack = (st.atkBase ?? 0.008) + (st.atkSpan ?? 0.09) * clamp(1 - rowNorm, 0, 1);
          let decay = (st.decBase ?? 0.08) + (st.decSpan ?? 0.65) * clamp(lum, 0, 1);
          let release = (st.relBase ?? 0.06) + (st.relSpan ?? 0.85) * clamp(rowNorm, 0, 1);

          // variable ROW density affects tails (swiss+char)
          if (st.varRowsOn && rowEdges) {
            const rh = rowEdges[r + 1] - rowEdges[r];
            const ratio = clamp(rh / avgRowH, 0.35, 2.4);
            // taller row => longer decay+release; denser => shorter
            const tailMul = clamp(ratio, 0.55, 1.9);
            decay *= tailMul;
            release *= tailMul;
            // attack opposite slightly
            attack *= clamp(1.25 - (tailMul - 1) * 0.4, 0.5, 1.4);
          }

          // IMPORTANT: make columns influence envelope too (narrow col = snappier)
          if (st.varColsOn && colEdges) {
            const cw = colEdges[col + 1] - colEdges[col];
            const avg = 1 / cols;
            const ratio = clamp(cw / avg, 0.35, 2.4);
            // narrow => shorter tails, wider => longer
            const colTail = clamp(ratio, 0.6, 1.7);
            decay *= colTail;
            release *= colTail;
            attack *= clamp(1.3 - (colTail - 1) * 0.35, 0.55, 1.5);
          }

          attack = clamp(attack, 0.002, 0.2);
          decay = clamp(decay, 0.03, 2.0);
          release = clamp(release, 0.03, 2.6);

          melHits.push({ freq, vel, cutoff, attack, decay, release, score: vel });
        }

        melHits.sort((a, b) => b.score - a.score);
        const chosen = melHits.slice(0, Math.min(maxNotes, melHits.length));

        // trigger melody
        const pool = audioRef.current.melVoices;
        for (const h of chosen) {
          const v = pool[audioRef.current.melPtr % pool.length];
          audioRef.current.melPtr++;
          triggerMelVoice(ac, v, {
            freq: h.freq,
            vel: h.vel,
            cutoffHz: h.cutoff,
            attack: h.attack,
            decaySec: h.decay,
            release: h.release,
          });
        }
      }

      // ===== Collect Perc hits from current column =====
      if (st.percOn) {
        const maxHits = clamp(st.percMaxHitsPerStep ?? 6, 1, 24);

        const percHits = [];
        for (let r = 0; r < rows; r++) {
          const idx = r * cols + col;
          const cell = percMap.get(idx);
          if (!cell?.paint) continue;

          if (typeof cell.expiresAt === "number" && cell.expiresAt <= nowT) continue;

          const colNow = getCellColor(cell, r, col, nowT);
          const rgb = hexToRgb(colNow);
          if (!rgb) continue;

          const lum = luminance01(rgb); // use intensity
          const h = hue01(rgb);

          // row maps pitch (top higher, bottom lower) in-key
          const rowNorm = rows <= 1 ? 0.5 : 1 - r / (rows - 1);
          const degFloat = rowNorm * (percDegreesCount - 1);
          const degIdx = clamp(Math.round(degFloat), 0, percDegreesCount - 1);
          const midi = percScaleMidi[degIdx];
          const freq = midiToFreq(midi);

          // velocity from luminance, plus a little from hue variation
          const vel = clamp(0.12 + 0.88 * lum, 0.05, 1);

          // tails: bottom rows ring longer
          let decay = (st.percDecayBase ?? 0.18) + (st.percDecaySpan ?? 0.95) * clamp(rowNorm, 0, 1);
          // density affects perc tails too
          if (st.varRowsOn && rowEdges) {
            const rh = rowEdges[r + 1] - rowEdges[r];
            const ratio = clamp(rh / avgRowH, 0.35, 2.4);
            decay *= clamp(ratio, 0.6, 1.9);
          }
          if (st.varColsOn && colEdges) {
            const cw = colEdges[col + 1] - colEdges[col];
            const avg = 1 / cols;
            const ratio = clamp(cw / avg, 0.35, 2.4);
            decay *= clamp(ratio, 0.7, 1.6);
          }
          decay = clamp(decay, 0.03, 3.0);

          // slight timbre change by hue
          const tone = clamp((st.percTone ?? 0.45) * 0.75 + h * 0.25, 0, 1);

          percHits.push({
            freq,
            vel,
            decay,
            tone,
            score: vel,
          });
        }

        percHits.sort((a, b) => b.score - a.score);
        const chosen = percHits.slice(0, Math.min(maxHits, percHits.length));

        for (const h of chosen) {
          triggerPercHit(ac, audioRef.current.percBus, audioRef.current.noiseBuf, {
            freq: h.freq,
            vel: h.vel,
            attack: st.percAttack,
            decay: h.decay,
            tone: h.tone,
            damp: st.percDamp,
            punch: st.percPunch,
            noiseMix: st.percNoiseMix,
            bodyMix: st.percBodyMix,
            pitchDrop: st.percPitchDrop,
          });
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
    hardSilenceMelody();
  }

  React.useEffect(() => {
    startScheduler();
    return () => stopScheduler();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  /* =======================
     MIDI (Web MIDI API)
======================= */
  const [midiSupported, setMidiSupported] = React.useState(false);
  const [midiInputs, setMidiInputs] = React.useState([]);
  const [midiInputId, setMidiInputId] = React.useState("");
  const midiAccessRef = React.useRef(null);
  const midiActiveRef = React.useRef(new Map()); // key: note:ch => { t0, vel01, note, ch, idx, row, col, layer }

  const midiToColor = React.useCallback((note, vel01, durSec) => {
    const h = clamp(note / 127, 0, 1);
    const s = clamp(0.25 + vel01 * 0.7, 0, 1);
    const l = clamp(0.18 + vel01 * 0.55 + clamp(durSec / 2.5, 0, 1) * 0.12, 0, 1);
    return rgbToHex(hslToRgb(h, s, l));
  }, []);

  const getGridDims = React.useCallback(() => {
    const st = sRef.current;
    if (st.pat === "swiss-grid") return { cols: Math.max(1, st.cols | 0), rows: Math.max(1, st.rows | 0) };
    const cv = canvasRef.current;
    if (cv) return { cols: Math.max(1, Math.floor(cv.width / st.space)), rows: Math.max(1, Math.floor(cv.height / st.space)) };
    return { cols: 16, rows: 12 };
  }, []);

  // Spread MIDI across the WHOLE grid (not single column):
  // - pitch -> row
  // - time -> column (advances with internal step)
  // - poly chords spread horizontally (lane offset)
  const midiNoteToCell = React.useCallback((note, chordSlot = 0) => {
    const st = sRef.current;
    const { cols, rows } = getGridDims();
    const lo = clamp(st.midiLo ?? 36, 0, 127);
    const hi = clamp(st.midiHi ?? 84, 0, 127);
    const span = Math.max(1, hi - lo);

    const t = clamp((note - lo) / span, 0, 1);
    const row = clamp(Math.round((1 - t) * (rows - 1)), 0, rows - 1);

    // distribute columns by step + chordSlot (spreads chords)
    const base = (audioRef.current.step || 0) % cols;
    const col = (base + chordSlot) % cols;

    const idx = row * cols + col;
    return { row, col, idx, cols, rows };
  }, [getGridDims]);

  const paintFromMidiOn = React.useCallback((note, vel, ch) => {
    const st = sRef.current;
    if (!st.midiOn || !st.midiDraw) return;

    const layer = st.midiTargetLayer === "perc" ? "perc" : "mel";

    const nowS = performance.now() * 0.001;
    const vel01 = clamp(vel / 127, 0, 1);

    // chord spreading: use number of currently-held notes on this channel as slot
    const held = Array.from(midiActiveRef.current.values()).filter((x) => x.ch === ch).length;
    const chordSlot = clamp(held, 0, 12);

    const { row, col, idx } = midiNoteToCell(note, chordSlot);

    const color = midiToColor(note, vel01, 0);
    const expiresAt = nowS + clamp(st.midiFadeMin ?? 0.25, 0.05, 6);

    upsertCell(layer, idx, {
      paint: { mode: "color", color },
      midi: { note, vel: vel01, ch, t0: nowS, dur: 0 },
      expiresAt,
    });

    midiActiveRef.current.set(`${note}:${ch}`, { t0: nowS, vel01, note, ch, idx, row, col, layer });
  }, [midiNoteToCell, midiToColor, upsertCell]);

  const paintFromMidiOff = React.useCallback((note, ch) => {
    const st = sRef.current;
    if (!st.midiOn || !st.midiDraw) return;

    const key = `${note}:${ch}`;
    const entry = midiActiveRef.current.get(key);
    if (!entry) return;

    const nowS = performance.now() * 0.001;
    const dur = clamp(nowS - entry.t0, 0, 10);

    const color = midiToColor(note, entry.vel01, dur);

    const minF = clamp(st.midiFadeMin ?? 0.25, 0.05, 8);
    const maxF = clamp(st.midiFadeMax ?? 2.5, minF, 10);
    const fade = clamp(minF + (maxF - minF) * clamp(dur / 2.0, 0, 1), 0.05, 10);

    const expiresAt = nowS + fade;

    upsertCell(entry.layer, entry.idx, {
      paint: { mode: "color", color },
      midi: { note, vel: entry.vel01, ch, t0: entry.t0, dur },
      expiresAt,
    });

    midiActiveRef.current.delete(key);
  }, [midiToColor, upsertCell]);

  const midiThruPlay = React.useCallback((note, vel) => {
    const st = sRef.current;
    if (!st.midiOn || !st.midiThru) return;

    const A = ensureAudio();
    const ac = A.ac;
    if (!A.ac) return;
    if (ac.state === "suspended") return; // needs user click

    ensureMelVoices();
    updateAudioParamsRealtime();

    const vel01 = clamp(vel / 127, 0.05, 1);

    // Thru targets melody synth (always in key? we quantize MIDI to current scale)
    const degreesCount = 7 * clamp(st.octaveSpan ?? 4, 1, 7);
    const scaleMidi = buildScaleMidi({
      rootPc: clamp(st.keyRoot ?? 0, 0, 11),
      scaleName: st.scaleName,
      baseMidi: clamp(st.baseMidi ?? 36, 12, 72),
      degreesCount,
    });

    // quantize incoming MIDI to nearest scale degree (keeps always-in-key)
    let best = scaleMidi[0];
    let bestDist = 999;
    for (const m of scaleMidi) {
      const d = Math.abs(m - note);
      if (d < bestDist) {
        bestDist = d;
        best = m;
      }
    }

    const freq = midiToFreq(best);

    const attack = 0.004 + (1 - vel01) * 0.02;
    const decay = 0.08 + vel01 * 0.35;
    const release = 0.12 + (1 - vel01) * 0.35;
    const cutoff = (st.cutoffBase ?? 400) + (st.cutoffSpan ?? 7200) * clamp(0.25 + vel01 * 0.75, 0, 1);

    const v = A.melVoices[A.melPtr % A.melVoices.length];
    A.melPtr++;
    triggerMelVoice(ac, v, { freq, vel: vel01, cutoffHz: cutoff, attack, decaySec: decay, release });
  }, []);

  React.useEffect(() => {
    const ok = typeof navigator !== "undefined" && !!navigator.requestMIDIAccess;
    setMidiSupported(ok);
    if (!ok) return;

    let cancelled = false;

    const refreshInputs = (access) => {
      const inputs = Array.from(access.inputs.values()).map((i) => ({
        id: i.id,
        name: i.name || "MIDI Input",
        manufacturer: i.manufacturer || "",
      }));
      setMidiInputs(inputs);
      setMidiInputId((cur) => (cur && inputs.some((x) => x.id === cur) ? cur : inputs[0]?.id || ""));
    };

    navigator
      .requestMIDIAccess({ sysex: false })
      .then((access) => {
        if (cancelled) return;
        midiAccessRef.current = access;
        refreshInputs(access);
        access.onstatechange = () => refreshInputs(access);
      })
      .catch(() => setMidiSupported(false));

    return () => {
      cancelled = true;
      const access = midiAccessRef.current;
      if (access) access.onstatechange = null;
    };
  }, []);

  React.useEffect(() => {
    const access = midiAccessRef.current;
    if (!access) return;

    for (const inp of access.inputs.values()) inp.onmidimessage = null;

    const inp = Array.from(access.inputs.values()).find((i) => i.id === midiInputId);
    if (!inp) return;

    inp.onmidimessage = (e) => {
      const st = sRef.current;
      if (!st.midiOn) return;

      const data = e.data;
      if (!data || data.length < 2) return;

      const status = data[0] & 0xf0;
      const ch = data[0] & 0x0f;

      if (st.midiChannel >= 0 && ch !== st.midiChannel) return;

      const note = data[1] & 0x7f;
      const vel = (data[2] ?? 0) & 0x7f;

      if (status === 0x90 && vel > 0) {
        paintFromMidiOn(note, vel, ch);
        midiThruPlay(note, vel);
        return;
      }
      if (status === 0x80 || (status === 0x90 && vel === 0)) {
        paintFromMidiOff(note, ch);
      }
    };

    return () => {
      if (inp) inp.onmidimessage = null;
    };
  }, [midiInputId, paintFromMidiOn, paintFromMidiOff, midiThruPlay]);

  /* =======================
     Pointer drawing
======================= */
  const onPointerDown = async (e) => {
    await unlockAudio();
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

    const layer = paint.layer; // mel/perc
    if (s.pat === "swiss-grid") {
      const col = idx % s.cols;
      const row = Math.floor(idx / s.cols);
      const t = performance.now() * 0.001;
      applyPaintToIdx(layer, idx, row, col, t);
    } else {
      const { cols } = getCharDims();
      const col = Math.floor(x / s.space);
      const row = Math.floor(y / s.space);
      const t = performance.now() * 0.001;
      applyPaintToIdx(layer, idx, row, col, t);
    }
  };

  const onPointerMove = (e) => {
    if (!drawing) return;
    const cv = canvasRef.current;
    if (!cv) return;
    const { x, y } = pointerToCanvas(e);
    const idx = getIdx(x, y);
    if (idx == null) return;

    const layer = paint.layer;
    if (s.pat === "swiss-grid") {
      const col = idx % s.cols;
      const row = Math.floor(idx / s.cols);
      const t = performance.now() * 0.001;
      applyPaintToIdx(layer, idx, row, col, t);
    } else {
      const col = Math.floor(x / s.space);
      const row = Math.floor(y / s.space);
      const t = performance.now() * 0.001;
      applyPaintToIdx(layer, idx, row, col, t);
    }
  };

  const onPointerUp = () => setDrawing(false);

  // refresh button: forces repaint
  const gen = () => {
    setCellsMel((p) => [...p]);
    setCellsPerc((p) => [...p]);
  };

  const clearPaint = () => {
    setCellsMel([]);
    setCellsPerc([]);
    hardSilenceMelody();
  };

  /* =======================
     Render loop
======================= */
  const getFontFamily = () => `"Inter", system-ui, -apple-system, Segoe UI, Roboto, sans-serif`;

  const render = (tm) => {
    const cv = canvasRef.current;
    if (!cv) return;
    const ctx = cv.getContext("2d");
    const w = cv.width,
      h = cv.height;

    const t = tm * 0.001;
    const nowS = performance.now() * 0.001;

    // theme
    const bg = s.darkMode ? "#0B0B0C" : "#FAFAFA";
    const gridStroke = s.darkMode ? "#1D1D1F" : "#E6E6E6";
    const txtOff = s.darkMode ? "#EDEDED" : "#111111";
    const txtOn = s.darkMode ? "#0A0A0A" : "#0A0A0A";

    ctx.clearRect(0, 0, w, h);
    ctx.fillStyle = bg;
    ctx.fillRect(0, 0, w, h);

    // lookup maps
    const melMap = new Map();
    for (const c of cellsMel) melMap.set(c.idx, c);
    const percMap = new Map();
    for (const c of cellsPerc) percMap.set(c.idx, c);

    const drawLayerCell = (layerName, idx, r, c, rect) => {
      const entry = layerName === "perc" ? percMap.get(idx) : melMap.get(idx);
      if (!entry?.paint) return;

      // expiry fade
      let a = 1;
      if (entry?.expiresAt != null) {
        const rem = entry.expiresAt - nowS;
        if (rem <= 0) return;
        a = clamp(rem / 0.35, 0, 1);
      }

      const colNow = getCellColor(entry, r, c, t);
      if (!colNow) return;

      // layer alpha controls
      let layerAlpha = 1;
      if (s.viewLayer === "mel" && layerName === "perc") return;
      if (s.viewLayer === "perc" && layerName === "mel") return;

      if (s.viewLayer === "both") {
        // ghost non-active layer lightly if user wants
        const active = paint.layer;
        if (active === "mel" && layerName === "perc") layerAlpha = clamp(s.ghost ?? 0.45, 0, 1);
        if (active === "perc" && layerName === "mel") layerAlpha = clamp(s.ghost ?? 0.45, 0, 1);
      }

      ctx.save();
      ctx.fillStyle = colNow;
      ctx.globalAlpha = 0.92 * a * layerAlpha;
      // IMPORTANT: no extra border/frame; plain fill
      ctx.fillRect(rect.x, rect.y, rect.w, rect.h);
      ctx.restore();
    };

    ctx.textAlign = "center";
    ctx.textBaseline = "middle";

    // char-grid
    if (s.pat === "char-grid") {
      const cols = Math.max(1, Math.floor(w / s.space));
      const rows = Math.max(1, Math.floor(h / s.space));

      if (s.gridLines) {
        ctx.save();
        ctx.strokeStyle = gridStroke;
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

          // draw both layers (order: mel under, perc over)
          drawLayerCell("mel", idx, r, c, { x: x0, y: y0, w: s.space, h: s.space });
          drawLayerCell("perc", idx, r, c, { x: x0, y: y0, w: s.space, h: s.space });

          const hasCol =
            (melMap.get(idx)?.paint && !(melMap.get(idx)?.expiresAt != null && melMap.get(idx).expiresAt <= nowS)) ||
            (percMap.get(idx)?.paint && !(percMap.get(idx)?.expiresAt != null && percMap.get(idx).expiresAt <= nowS));

          const gi = chs.length ? Math.floor((t * spd + r * 0.07 + c * 0.05) * 3) % chs.length : 0;
          ctx.save();
          ctx.font = `${s.charSz}px ${getFontFamily()}`;
          ctx.fillStyle = hasCol ? txtOn : txtOff;
          ctx.globalAlpha = hasCol ? 1 : 0.9;
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
        const ce = colEdgesSwiss || Array.from({ length: cols + 1 }, (_, i) => i / cols);
        const re = rowEdgesSwiss || Array.from({ length: rows + 1 }, (_, i) => i / rows);

        ctx.save();
        ctx.strokeStyle = gridStroke;
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

          drawLayerCell("mel", idx, r, c, g);
          drawLayerCell("perc", idx, r, c, g);

          const hasCol =
            (melMap.get(idx)?.paint && !(melMap.get(idx)?.expiresAt != null && melMap.get(idx).expiresAt <= nowS)) ||
            (percMap.get(idx)?.paint && !(percMap.get(idx)?.expiresAt != null && percMap.get(idx).expiresAt <= nowS));

          const gi = chs.length ? Math.floor((t * spd + r * 0.09 + c * 0.05) * 3) % chs.length : 0;
          const sz = Math.max(8, Math.min(g.w, g.h) * 0.55 * (s.swissCharScale ?? 1));

          ctx.save();
          ctx.font = `${Math.floor(sz)}px ${getFontFamily()}`;
          ctx.fillStyle = hasCol ? txtOn : txtOff;
          ctx.globalAlpha = hasCol ? 1 : 0.9;
          ctx.fillText(chs[gi] ?? "0", g.cx, g.cy);
          ctx.restore();
        }
      }
      return;
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
  }, [s, cellsMel, cellsPerc, colEdgesSwiss, rowEdgesSwiss, getCellColor]);

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
     UI
======================= */
  const keyName = NOTE_NAMES[s.keyRoot] ?? "C";

  const uiBg = s.darkMode ? "bg-neutral-950" : "bg-white";
  const panelBg = s.darkMode ? "bg-neutral-950 border-neutral-800" : "bg-neutral-50 border-neutral-200";
  const panelText = s.darkMode ? "text-neutral-100" : "text-neutral-900";
  const inputBg = s.darkMode ? "bg-neutral-900 border-neutral-700 text-neutral-100" : "bg-white border-neutral-300";
  const buttonPrimary = s.darkMode ? "bg-white text-black hover:bg-neutral-200" : "bg-black text-white hover:bg-neutral-800";
  const buttonDark = s.darkMode ? "bg-white text-black hover:bg-neutral-200" : "bg-neutral-900 text-white hover:bg-black";
  const buttonSoft = s.darkMode ? "bg-neutral-800 text-neutral-100" : "bg-neutral-200 text-neutral-700";

  return (
    <div className={`w-full h-[100svh] ${uiBg} flex flex-col md:flex-row overflow-hidden`}>
      {panelOpen && (
        <div className="fixed inset-0 bg-black/40 z-30 md:hidden" onClick={() => setPanelOpen(false)} />
      )}

      {/* Controls */}
      <div
        className={
          "fixed md:static z-40 md:z-auto inset-y-0 left-0 w-80 max-w-[90vw] border-r p-4 md:p-5 overflow-y-auto space-y-4 text-sm transform transition-transform duration-200 md:transform-none " +
          panelBg +
          " " +
          panelText +
          " " +
          (panelOpen ? "translate-x-0" : "-translate-x-full md:translate-x-0")
        }
      >
        <div className="flex gap-2">
          <button
            onClick={gen}
            className={`flex-1 flex justify-center px-4 py-2.5 rounded-lg font-medium min-h-[44px] ${buttonPrimary}`}
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
            className={`flex-1 flex justify-center px-4 py-2.5 rounded-lg font-medium min-h-[44px] ${buttonPrimary}`}
            title="Download PNG"
          >
            <Download size={16} />
          </button>
        </div>

        <div className="flex gap-2">
          <button
            onClick={unlockAudio}
            className={`flex-1 px-4 py-2.5 rounded-lg font-medium min-h-[44px] ${buttonDark}`}
          >
            Enable Audio (click once)
          </button>
          <button
            onClick={() => setS((p) => ({ ...p, darkMode: !p.darkMode }))}
            className={`px-3 py-2.5 rounded-lg font-semibold min-h-[44px] ${buttonSoft}`}
            title="Dark/Light"
          >
            {s.darkMode ? <Sun size={16} /> : <Moon size={16} />}
          </button>
        </div>

        {/* Pattern */}
        <div className="space-y-2">
          <label className="block text-xs font-semibold uppercase tracking-wider">Pattern</label>
          <select
            value={s.pat}
            onChange={(e) => setS((p) => ({ ...p, pat: e.target.value }))}
            className={`w-full px-3 py-2 rounded-lg border ${inputBg}`}
          >
            <option value="swiss-grid">Swiss Grid</option>
            <option value="char-grid">Character Grid</option>
          </select>
        </div>

        {/* Layers */}
        <div className="space-y-2">
          <label className="block text-xs font-semibold uppercase tracking-wider flex items-center gap-2">
            <Layers size={14} /> Layers
          </label>

          <div className="grid grid-cols-2 gap-2">
            <button
              onClick={() => setPaint((p) => ({ ...p, layer: "mel" }))}
              className={`px-3 py-2 rounded-lg border text-xs font-semibold min-h-[44px] ${
                paint.layer === "mel" ? buttonPrimary : inputBg
              }`}
            >
              Paint Melody
            </button>
            <button
              onClick={() => setPaint((p) => ({ ...p, layer: "perc" }))}
              className={`px-3 py-2 rounded-lg border text-xs font-semibold min-h-[44px] ${
                paint.layer === "perc" ? buttonPrimary : inputBg
              }`}
            >
              Paint Perc
            </button>
          </div>

          <div className="space-y-1">
            <div className="text-xs opacity-80">View</div>
            <select
              value={s.viewLayer}
              onChange={(e) => setS((p) => ({ ...p, viewLayer: e.target.value }))}
              className={`w-full px-3 py-2 rounded-lg border ${inputBg}`}
            >
              <option value="both">Both</option>
              <option value="mel">Melody only</option>
              <option value="perc">Perc only</option>
            </select>
          </div>

          {s.viewLayer === "both" && (
            <div className="space-y-1">
              <div className="text-xs opacity-80">Ghosting (non-active layer)</div>
              <input
                type="range"
                min="0"
                max="1"
                step="0.01"
                value={s.ghost}
                onChange={(e) => setS((p) => ({ ...p, ghost: parseFloat(e.target.value) }))}
                className="w-full"
              />
            </div>
          )}
        </div>

        {/* Paint */}
        <div className="space-y-2">
          <label className="block text-xs font-semibold uppercase tracking-wider">Paint</label>

          <div className="flex items-center justify-between gap-2">
            <input
              type="color"
              value={paint.color}
              onChange={(e) => setPaint((p) => ({ ...p, color: e.target.value, useSeq: false }))}
              className={`h-10 w-14 rounded-md border ${s.darkMode ? "border-neutral-700 bg-neutral-900" : "border-neutral-300 bg-white"}`}
              title="Pick color"
            />

            <button
              onClick={() => setPaint((p) => ({ ...p, useSeq: !p.useSeq, mode: "color" }))}
              className={`flex-1 px-3 py-2 rounded-lg border text-xs font-semibold flex items-center justify-center gap-2 min-h-[44px] ${
                paint.useSeq ? buttonPrimary : inputBg
              }`}
            >
              <Palette size={14} />
              {paint.useSeq ? "Color String ON" : "Color String OFF"}
            </button>

            <button
              onClick={() => setPaint((p) => ({ ...p, mode: p.mode === "none" ? "color" : "none" }))}
              className={`px-3 py-2 rounded-lg text-xs font-semibold min-h-[44px] ${
                paint.mode === "none" ? buttonPrimary : buttonSoft
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
                className={`h-9 w-full rounded-md border ${s.darkMode ? "border-neutral-700 bg-neutral-900" : "border-neutral-300 bg-white"}`}
                title={`Color String ${i + 1}`}
              />
            ))}
          </div>

          <div className="grid grid-cols-2 gap-2">
            <div className="space-y-1">
              <div className="text-xs opacity-80">Color motion</div>
              <select
                value={s.colorSeqBehave}
                onChange={(e) => setS((p) => ({ ...p, colorSeqBehave: e.target.value }))}
                className={`w-full px-2 py-2 rounded-lg border text-xs ${inputBg}`}
              >
                <option value="same">Same (musical)</option>
                <option value="cycle">Cycle</option>
                <option value="wave">Wave</option>
                <option value="random">Random</option>
              </select>
            </div>
            <div className="space-y-1">
              <div className="text-xs opacity-80">Speed</div>
              <input
                type="range"
                min="0"
                max="4"
                step="0.05"
                value={s.colorSeqSpeed}
                onChange={(e) => setS((p) => ({ ...p, colorSeqSpeed: parseFloat(e.target.value) }))}
                className="w-full"
              />
            </div>
          </div>

          <button
            onClick={clearPaint}
            className={`w-full px-4 py-2.5 rounded-lg font-medium min-h-[44px] ${buttonDark}`}
          >
            Clear Painted Cells
          </button>
        </div>

        {/* Grid controls */}
        <div className="space-y-2">
          <label className="block text-xs font-semibold uppercase tracking-wider">
            Grid / Density
          </label>

          {s.pat === "swiss-grid" && (
            <>
              <div className="text-xs opacity-80">
                Swiss Grid {s.cols} × {s.rows}
              </div>
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
            </>
          )}

          {s.pat === "char-grid" && (
            <>
              <div className="text-xs opacity-80">
                Character Grid (spacing affects dims)
              </div>
              <label className="block text-xs font-semibold uppercase tracking-wider">Spacing: {s.space}px</label>
              <input
                type="range"
                min="12"
                max="120"
                value={s.space}
                onChange={(e) => setS((p) => ({ ...p, space: parseInt(e.target.value, 10) }))}
                className="w-full"
              />
              <label className="block text-xs font-semibold uppercase tracking-wider">Char Size: {s.charSz}px</label>
              <input
                type="range"
                min="8"
                max="80"
                value={s.charSz}
                onChange={(e) => setS((p) => ({ ...p, charSz: parseInt(e.target.value, 10) }))}
                className="w-full"
              />
              <label className="block text-xs font-semibold uppercase tracking-wider">
                Char Speed: {s.charSpd.toFixed(2)}×
              </label>
              <input
                type="range"
                min="0"
                max="10"
                step="0.1"
                value={s.charSpd}
                onChange={(e) => setS((p) => ({ ...p, charSpd: parseFloat(e.target.value) }))}
                className="w-full"
              />
              <label className="block text-xs font-semibold uppercase tracking-wider">Characters</label>
              <input
                type="text"
                value={s.chars}
                onChange={(e) => setS((p) => ({ ...p, chars: e.target.value }))}
                className={`w-full px-3 py-2 rounded-lg border font-mono ${inputBg}`}
              />
            </>
          )}

          <div className="flex items-center justify-between">
            <label className="text-xs font-semibold uppercase tracking-wider">Grid Lines</label>
            <button
              onClick={() => setS((p) => ({ ...p, gridLines: !p.gridLines }))}
              className={`p-1.5 rounded ${s.gridLines ? buttonPrimary : buttonSoft}`}
            >
              {s.gridLines ? <Play size={14} fill={s.darkMode ? "black" : "white"} /> : <Square size={14} />}
            </button>
          </div>

          <div className={`rounded-lg border p-3 space-y-2 ${s.darkMode ? "border-neutral-800 bg-neutral-900" : "border-neutral-200 bg-white"}`}>
            <div className="flex items-center justify-between">
              <div className="text-xs font-semibold uppercase tracking-wider">Columns (rhythm)</div>
              <button
                onClick={() => setS((p) => ({ ...p, varColsOn: !p.varColsOn }))}
                className={`p-1.5 rounded ${s.varColsOn ? buttonPrimary : buttonSoft}`}
              >
                {s.varColsOn ? <Play size={14} fill={s.darkMode ? "black" : "white"} /> : <Square size={14} />}
              </button>
            </div>
            {s.varColsOn && (
              <>
                <label className="block text-xs font-semibold uppercase tracking-wider">
                  Focus X: {s.colFocus.toFixed(2)}
                </label>
                <input
                  type="range"
                  min="0"
                  max="1"
                  step="0.01"
                  value={s.colFocus}
                  onChange={(e) => setS((p) => ({ ...p, colFocus: parseFloat(e.target.value) }))}
                  className="w-full"
                />
                <label className="block text-xs font-semibold uppercase tracking-wider">
                  Strength: {s.colStrength.toFixed(1)}
                </label>
                <input
                  type="range"
                  min="0"
                  max="20"
                  step="0.1"
                  value={s.colStrength}
                  onChange={(e) => setS((p) => ({ ...p, colStrength: parseFloat(e.target.value) }))}
                  className="w-full"
                />
                <label className="block text-xs font-semibold uppercase tracking-wider">
                  Band Width: {s.colSigma.toFixed(2)}
                </label>
                <input
                  type="range"
                  min="0.05"
                  max="0.5"
                  step="0.01"
                  value={s.colSigma}
                  onChange={(e) => setS((p) => ({ ...p, colSigma: parseFloat(e.target.value) }))}
                  className="w-full"
                />
                <div className="text-[11px] opacity-80">
                  Columns affect <b>step speed</b> and also <b>tails/snappiness</b>.
                </div>
              </>
            )}
          </div>

          <div className={`rounded-lg border p-3 space-y-2 ${s.darkMode ? "border-neutral-800 bg-neutral-900" : "border-neutral-200 bg-white"}`}>
            <div className="flex items-center justify-between">
              <div className="text-xs font-semibold uppercase tracking-wider">Rows (tails)</div>
              <button
                onClick={() => setS((p) => ({ ...p, varRowsOn: !p.varRowsOn }))}
                className={`p-1.5 rounded ${s.varRowsOn ? buttonPrimary : buttonSoft}`}
              >
                {s.varRowsOn ? <Play size={14} fill={s.darkMode ? "black" : "white"} /> : <Square size={14} />}
              </button>
            </div>
            {s.varRowsOn && (
              <>
                <label className="block text-xs font-semibold uppercase tracking-wider">
                  Focus Y: {s.rowFocus.toFixed(2)}
                </label>
                <input
                  type="range"
                  min="0"
                  max="1"
                  step="0.01"
                  value={s.rowFocus}
                  onChange={(e) => setS((p) => ({ ...p, rowFocus: parseFloat(e.target.value) }))}
                  className="w-full"
                />
                <label className="block text-xs font-semibold uppercase tracking-wider">
                  Strength: {s.rowStrength.toFixed(1)}
                </label>
                <input
                  type="range"
                  min="0"
                  max="20"
                  step="0.1"
                  value={s.rowStrength}
                  onChange={(e) => setS((p) => ({ ...p, rowStrength: parseFloat(e.target.value) }))}
                  className="w-full"
                />
                <label className="block text-xs font-semibold uppercase tracking-wider">
                  Band Width: {s.rowSigma.toFixed(2)}
                </label>
                <input
                  type="range"
                  min="0.05"
                  max="0.5"
                  step="0.01"
                  value={s.rowSigma}
                  onChange={(e) => setS((p) => ({ ...p, rowSigma: parseFloat(e.target.value) }))}
                  className="w-full"
                />
                <div className="text-[11px] opacity-80">
                  Rows affect <b>attack/decay/release</b> and also percussion <b>ring length</b>.
                </div>
              </>
            )}
          </div>
        </div>

        {/* Sound: melody */}
        <div className="space-y-2">
          <div className="flex items-center justify-between">
            <label className="text-xs font-semibold uppercase tracking-wider">Melody Synth</label>
            <button
              onClick={() => setS((p) => ({ ...p, soundOn: !p.soundOn }))}
              className={`p-1.5 rounded ${s.soundOn ? buttonPrimary : buttonSoft}`}
              title="Melody on/off"
            >
              {s.soundOn ? <Play size={14} fill={s.darkMode ? "black" : "white"} /> : <Square size={14} />}
            </button>
          </div>

          <label className="block text-xs font-semibold uppercase tracking-wider">BPM: {s.bpm}</label>
          <input
            type="range"
            min="40"
            max="220"
            value={s.bpm}
            onChange={(e) => setS((p) => ({ ...p, bpm: parseInt(e.target.value, 10) }))}
            className="w-full"
          />

          <label className="block text-xs font-semibold uppercase tracking-wider">
            Max notes / step: {s.maxNotesPerStep}
          </label>
          <input
            type="range"
            min="1"
            max="24"
            value={s.maxNotesPerStep}
            onChange={(e) => setS((p) => ({ ...p, maxNotesPerStep: parseInt(e.target.value, 10) }))}
            className="w-full"
          />

          <div className="grid grid-cols-2 gap-2">
            <div className="space-y-1">
              <div className="text-xs opacity-80">Key</div>
              <select
                value={s.keyRoot}
                onChange={(e) => setS((p) => ({ ...p, keyRoot: parseInt(e.target.value, 10) }))}
                className={`w-full px-2 py-2 rounded-lg border text-xs ${inputBg}`}
              >
                {NOTE_NAMES.map((n, i) => (
                  <option key={n} value={i}>
                    {n}
                  </option>
                ))}
              </select>
            </div>
            <div className="space-y-1">
              <div className="text-xs opacity-80">Scale</div>
              <select
                value={s.scaleName}
                onChange={(e) => setS((p) => ({ ...p, scaleName: e.target.value }))}
                className={`w-full px-2 py-2 rounded-lg border text-xs ${inputBg}`}
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
              <div className="text-xs opacity-80">Chord</div>
              <select
                value={s.chordType}
                onChange={(e) => setS((p) => ({ ...p, chordType: e.target.value }))}
                className={`w-full px-2 py-2 rounded-lg border text-xs ${inputBg}`}
              >
                <option value="7">7th</option>
                <option value="triad">Triad</option>
              </select>
            </div>
            <div className="space-y-1">
              <div className="text-xs opacity-80">Lane mapping</div>
              <select
                value={s.laneMode}
                onChange={(e) => setS((p) => ({ ...p, laneMode: e.target.value }))}
                className={`w-full px-2 py-2 rounded-lg border text-xs ${inputBg}`}
              >
                <option value="column">By Column</option>
                <option value="hue">By Hue (color)</option>
              </select>
            </div>
          </div>

          <div className="text-[11px] opacity-80">
            <b>Always in tune:</b> melody + drums quantized to {keyName} {s.scaleName}.<br />
            <b>Vertical pitch:</b> top is higher, bottom is lower (melody + drums).
          </div>

          <label className="block text-xs font-semibold uppercase tracking-wider">Voices: {s.voices}</label>
          <input
            type="range"
            min="1"
            max="24"
            value={s.voices}
            onChange={(e) => setS((p) => ({ ...p, voices: parseInt(e.target.value, 10) }))}
            className="w-full"
          />

          <label className="block text-xs font-semibold uppercase tracking-wider">
            Master: {s.master.toFixed(2)}
          </label>
          <input
            type="range"
            min="0"
            max="1.2"
            step="0.01"
            value={s.master}
            onChange={(e) => setS((p) => ({ ...p, master: parseFloat(e.target.value) }))}
            className="w-full"
          />
        </div>

        {/* Percussion */}
        <div className="space-y-2">
          <div className="flex items-center justify-between">
            <label className="text-xs font-semibold uppercase tracking-wider">Percussion Layer</label>
            <button
              onClick={() => setS((p) => ({ ...p, percOn: !p.percOn }))}
              className={`p-1.5 rounded ${s.percOn ? buttonPrimary : buttonSoft}`}
              title="Perc on/off"
            >
              {s.percOn ? <Play size={14} fill={s.darkMode ? "black" : "white"} /> : <Square size={14} />}
            </button>
          </div>

          <label className="block text-xs font-semibold uppercase tracking-wider">
            Perc gain: {s.percGain.toFixed(2)}
          </label>
          <input
            type="range"
            min="0"
            max="2"
            step="0.01"
            value={s.percGain}
            onChange={(e) => setS((p) => ({ ...p, percGain: parseFloat(e.target.value) }))}
            className="w-full"
          />

          <label className="block text-xs font-semibold uppercase tracking-wider">
            Max hits / step: {s.percMaxHitsPerStep}
          </label>
          <input
            type="range"
            min="1"
            max="24"
            value={s.percMaxHitsPerStep}
            onChange={(e) => setS((p) => ({ ...p, percMaxHitsPerStep: parseInt(e.target.value, 10) }))}
            className="w-full"
          />

          <div className="grid grid-cols-2 gap-2">
            <div className="space-y-1">
              <div className="text-xs opacity-80">Base (MIDI)</div>
              <input
                type="number"
                min="0"
                max="127"
                value={s.percBaseMidi}
                onChange={(e) => setS((p) => ({ ...p, percBaseMidi: parseInt(e.target.value || "24", 10) }))}
                className={`w-full px-2 py-2 rounded-lg border text-xs ${inputBg}`}
              />
            </div>
            <div className="space-y-1">
              <div className="text-xs opacity-80">Oct span</div>
              <input
                type="number"
                min="1"
                max="6"
                value={s.percOctaveSpan}
                onChange={(e) => setS((p) => ({ ...p, percOctaveSpan: parseInt(e.target.value || "2", 10) }))}
                className={`w-full px-2 py-2 rounded-lg border text-xs ${inputBg}`}
              />
            </div>
          </div>

          <div className="grid grid-cols-2 gap-2">
            <div className="space-y-1">
              <div className="text-xs opacity-80">Tone</div>
              <input
                type="range"
                min="0"
                max="1"
                step="0.01"
                value={s.percTone}
                onChange={(e) => setS((p) => ({ ...p, percTone: parseFloat(e.target.value) }))}
                className="w-full"
              />
            </div>
            <div className="space-y-1">
              <div className="text-xs opacity-80">Damp (ring)</div>
              <input
                type="range"
                min="0"
                max="1"
                step="0.01"
                value={s.percDamp}
                onChange={(e) => setS((p) => ({ ...p, percDamp: parseFloat(e.target.value) }))}
                className="w-full"
              />
            </div>
          </div>

          <div className="grid grid-cols-2 gap-2">
            <div className="space-y-1">
              <div className="text-xs opacity-80">Punch</div>
              <input
                type="range"
                min="0"
                max="1"
                step="0.01"
                value={s.percPunch}
                onChange={(e) => setS((p) => ({ ...p, percPunch: parseFloat(e.target.value) }))}
                className="w-full"
              />
            </div>
            <div className="space-y-1">
              <div className="text-xs opacity-80">Pitch drop</div>
              <input
                type="range"
                min="0"
                max="1"
                step="0.01"
                value={s.percPitchDrop}
                onChange={(e) => setS((p) => ({ ...p, percPitchDrop: parseFloat(e.target.value) }))}
                className="w-full"
              />
            </div>
          </div>

          <div className="grid grid-cols-2 gap-2">
            <div className="space-y-1">
              <div className="text-xs opacity-80">Noise mix</div>
              <input
                type="range"
                min="0"
                max="1"
                step="0.01"
                value={s.percNoiseMix}
                onChange={(e) => setS((p) => ({ ...p, percNoiseMix: parseFloat(e.target.value) }))}
                className="w-full"
              />
            </div>
            <div className="space-y-1">
              <div className="text-xs opacity-80">Body mix</div>
              <input
                type="range"
                min="0"
                max="1"
                step="0.01"
                value={s.percBodyMix}
                onChange={(e) => setS((p) => ({ ...p, percBodyMix: parseFloat(e.target.value) }))}
                className="w-full"
              />
            </div>
          </div>

          <div className="text-[11px] opacity-80">
            Want it <b>deeper</b>? Lower <b>Base (MIDI)</b> (try 18–28) and increase <b>Damp</b> a bit.
          </div>
        </div>

        {/* MIDI */}
        <div className="space-y-2">
          <div className="flex items-center justify-between">
            <label className="text-xs font-semibold uppercase tracking-wider">MIDI</label>
            <button
              onClick={() => setS((p) => ({ ...p, midiOn: !p.midiOn }))}
              className={`p-1.5 rounded ${s.midiOn ? buttonPrimary : buttonSoft}`}
              title="MIDI on/off"
              disabled={!midiSupported}
            >
              {s.midiOn ? <Play size={14} fill={s.darkMode ? "black" : "white"} /> : <Square size={14} />}
            </button>
          </div>

          {!midiSupported ? (
            <div className="text-[11px] opacity-80">This browser/device doesn’t support Web MIDI.</div>
          ) : (
            <>
              <div className="space-y-1">
                <div className="text-xs opacity-80">Input</div>
                <select
                  value={midiInputId}
                  onChange={(e) => setMidiInputId(e.target.value)}
                  className={`w-full px-2 py-2 rounded-lg border text-xs ${inputBg}`}
                >
                  {midiInputs.map((i) => (
                    <option key={i.id} value={i.id}>
                      {i.name}
                      {i.manufacturer ? ` (${i.manufacturer})` : ""}
                    </option>
                  ))}
                </select>
              </div>

              <div className="grid grid-cols-2 gap-2">
                <button
                  onClick={() => setS((p) => ({ ...p, midiDraw: !p.midiDraw }))}
                  className={`px-3 py-2 rounded-lg border text-xs font-semibold min-h-[44px] ${
                    s.midiDraw ? buttonPrimary : inputBg
                  }`}
                >
                  MIDI draws
                </button>
                <button
                  onClick={() => setS((p) => ({ ...p, midiThru: !p.midiThru }))}
                  className={`px-3 py-2 rounded-lg border text-xs font-semibold min-h-[44px] ${
                    s.midiThru ? buttonPrimary : inputBg
                  }`}
                >
                  MIDI thru
                </button>
              </div>

              <div className="space-y-1">
                <div className="text-xs opacity-80">Target layer</div>
                <select
                  value={s.midiTargetLayer}
                  onChange={(e) => setS((p) => ({ ...p, midiTargetLayer: e.target.value }))}
                  className={`w-full px-2 py-2 rounded-lg border text-xs ${inputBg}`}
                >
                  <option value="mel">Melody</option>
                  <option value="perc">Percussion</option>
                </select>
              </div>

              <div className="space-y-1">
                <div className="text-xs opacity-80">Channel</div>
                <select
                  value={s.midiChannel}
                  onChange={(e) => setS((p) => ({ ...p, midiChannel: parseInt(e.target.value, 10) }))}
                  className={`w-full px-2 py-2 rounded-lg border text-xs ${inputBg}`}
                >
                  <option value={-1}>Omni</option>
                  {Array.from({ length: 16 }, (_, i) => (
                    <option key={i} value={i}>
                      {i + 1}
                    </option>
                  ))}
                </select>
              </div>

              <div className="grid grid-cols-2 gap-2">
                <div className="space-y-1">
                  <div className="text-xs opacity-80">Note low</div>
                  <input
                    type="number"
                    min="0"
                    max="127"
                    value={s.midiLo}
                    onChange={(e) => setS((p) => ({ ...p, midiLo: parseInt(e.target.value || "0", 10) }))}
                    className={`w-full px-2 py-2 rounded-lg border text-xs ${inputBg}`}
                  />
                </div>
                <div className="space-y-1">
                  <div className="text-xs opacity-80">Note high</div>
                  <input
                    type="number"
                    min="0"
                    max="127"
                    value={s.midiHi}
                    onChange={(e) => setS((p) => ({ ...p, midiHi: parseInt(e.target.value || "127", 10) }))}
                    className={`w-full px-2 py-2 rounded-lg border text-xs ${inputBg}`}
                  />
                </div>
              </div>

              <div className="text-[11px] opacity-80">
                MIDI draws across the grid: <b>pitch → row</b>, chords spread <b>horizontally</b>, and it follows the rhythm.
              </div>
            </>
          )}
        </div>

        {/* FX */}
        <div className="space-y-2">
          <label className="block text-xs font-semibold uppercase tracking-wider">FX (Melody)</label>

          <div className={`rounded-lg border p-3 space-y-2 ${s.darkMode ? "border-neutral-800 bg-neutral-900" : "border-neutral-200 bg-white"}`}>
            <div className="flex items-center justify-between">
              <div className="text-xs font-semibold uppercase tracking-wider">Reverb</div>
              <button
                onClick={() => setS((p) => ({ ...p, reverbOn: !p.reverbOn }))}
                className={`p-1.5 rounded ${s.reverbOn ? buttonPrimary : buttonSoft}`}
              >
                {s.reverbOn ? <Play size={14} fill={s.darkMode ? "black" : "white"} /> : <Square size={14} />}
              </button>
            </div>
            <label className="block text-xs font-semibold uppercase tracking-wider">Mix: {s.reverbMix.toFixed(2)}</label>
            <input
              type="range"
              min="0"
              max="0.8"
              step="0.01"
              value={s.reverbMix}
              onChange={(e) => setS((p) => ({ ...p, reverbMix: parseFloat(e.target.value) }))}
              className="w-full"
            />
            <label className="block text-xs font-semibold uppercase tracking-wider">Time: {s.reverbTime.toFixed(1)}s</label>
            <input
              type="range"
              min="0.5"
              max="6"
              step="0.1"
              value={s.reverbTime}
              onChange={(e) => setS((p) => ({ ...p, reverbTime: parseFloat(e.target.value) }))}
              className="w-full"
            />
          </div>

          <div className={`rounded-lg border p-3 space-y-2 ${s.darkMode ? "border-neutral-800 bg-neutral-900" : "border-neutral-200 bg-white"}`}>
            <div className="flex items-center justify-between">
              <div className="text-xs font-semibold uppercase tracking-wider">Delay</div>
              <button
                onClick={() => setS((p) => ({ ...p, delayOn: !p.delayOn }))}
                className={`p-1.5 rounded ${s.delayOn ? buttonPrimary : buttonSoft}`}
              >
                {s.delayOn ? <Play size={14} fill={s.darkMode ? "black" : "white"} /> : <Square size={14} />}
              </button>
            </div>

            <label className="block text-xs font-semibold uppercase tracking-wider">Mix: {s.delayMix.toFixed(2)}</label>
            <input
              type="range"
              min="0"
              max="0.8"
              step="0.01"
              value={s.delayMix}
              onChange={(e) => setS((p) => ({ ...p, delayMix: parseFloat(e.target.value) }))}
              className="w-full"
            />

            <label className="block text-xs font-semibold uppercase tracking-wider">Time: {s.delayTime.toFixed(2)}s</label>
            <input
              type="range"
              min="0.05"
              max="0.9"
              step="0.01"
              value={s.delayTime}
              onChange={(e) => setS((p) => ({ ...p, delayTime: parseFloat(e.target.value) }))}
              className="w-full"
            />

            <label className="block text-xs font-semibold uppercase tracking-wider">Feedback: {s.delayFeedback.toFixed(2)}</label>
            <input
              type="range"
              min="0"
              max="0.85"
              step="0.01"
              value={s.delayFeedback}
              onChange={(e) => setS((p) => ({ ...p, delayFeedback: parseFloat(e.target.value) }))}
              className="w-full"
            />
          </div>

          <div className={`rounded-lg border p-3 space-y-2 ${s.darkMode ? "border-neutral-800 bg-neutral-900" : "border-neutral-200 bg-white"}`}>
            <div className="flex items-center justify-between">
              <div className="text-xs font-semibold uppercase tracking-wider">Drive</div>
              <button
                onClick={() => setS((p) => ({ ...p, driveOn: !p.driveOn }))}
                className={`p-1.5 rounded ${s.driveOn ? buttonPrimary : buttonSoft}`}
              >
                {s.driveOn ? <Play size={14} fill={s.darkMode ? "black" : "white"} /> : <Square size={14} />}
              </button>
            </div>
            <label className="block text-xs font-semibold uppercase tracking-wider">Amount: {s.drive.toFixed(2)}</label>
            <input
              type="range"
              min="0"
              max="1"
              step="0.01"
              value={s.drive}
              onChange={(e) => setS((p) => ({ ...p, drive: parseFloat(e.target.value) }))}
              className="w-full"
            />
          </div>
        </div>

        <div className="text-[11px] opacity-70">
          If MIDI draws but you hear nothing: press <b>Enable Audio</b> once (browser rule).
        </div>
      </div>

      {/* Canvas */}
      <div className={`flex-1 min-h-0 p-2 md:p-8 ${s.darkMode ? "bg-neutral-950" : "bg-white"} relative overflow-hidden`}>
        <button
          onClick={() => setPanelOpen((v) => !v)}
          className={`md:hidden absolute top-3 left-3 z-20 px-3 py-2 rounded-lg text-xs font-semibold shadow ${
            s.darkMode ? "bg-white text-black" : "bg-black text-white"
          }`}
        >
          {panelOpen ? "Hide controls" : "Show controls"}
        </button>

        <canvas
          ref={canvasRef}
          className={`w-full h-full rounded-lg shadow-sm touch-none select-none ${s.darkMode ? "shadow-black/40" : ""}`}
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
