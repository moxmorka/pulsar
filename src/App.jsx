// App.jsx
import React from "react";
import { RotateCcw, Download, Play, Square, Palette, Layers, Moon, Sun } from "lucide-react";

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
   - KEEP your synth sound
   - ADD percussion layer
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

// ====== Synth voice (unchanged character) ======
function makeVoice(ac) {
  const osc = ac.createOscillator();
  const filter = ac.createBiquadFilter();
  const gain = ac.createGain();

  osc.type = "sawtooth";
  filter.type = "lowpass";
  filter.Q.value = 0.65;

  gain.gain.value = 0.0001;

  osc.connect(filter);
  filter.connect(gain);

  osc.start();
  return { osc, filter, gain };
}
function triggerVoice(ac, voice, { freq, vel, cutoffHz, attack, decaySec, release }) {
  const now = ac.currentTime;
  const v = clamp(vel, 0.0001, 1);

  voice.osc.frequency.setValueAtTime(freq, now);

  voice.filter.frequency.cancelScheduledValues(now);
  voice.filter.frequency.setValueAtTime(clamp(cutoffHz, 80, 16000), now);

  const g = voice.gain.gain;
  g.cancelScheduledValues(now);
  g.setValueAtTime(0.0001, now);
  g.exponentialRampToValueAtTime(Math.max(0.00012, v), now + clamp(attack, 0.001, 0.2));
  g.exponentialRampToValueAtTime(
    0.0001,
    now + clamp(attack, 0.001, 0.2) + clamp(decaySec, 0.02, 2.5) + clamp(release, 0.02, 2.5)
  );
}

// ====== Percussion "physical-ish" one-shot ======
// (noise burst + resonator; type chosen by hue)
function triggerPerc(ac, busGain, {
  type,        // "kick" | "snare" | "hat" | "tom"
  vel,         // 0..1
  toneHz,      // base resonant freq
  decay,       // 0.02..2
  noiseAmt,    // 0..1
  clickAmt,    // 0..1
  driveAmt     // 0..1 (local)
}) {
  const now = ac.currentTime;
  const v = clamp(vel, 0.0001, 1);

  // local gain (per hit)
  const out = ac.createGain();
  out.gain.value = 0.0001;
  out.connect(busGain);

  // small click (transient)
  if (clickAmt > 0.001) {
    const clickOsc = ac.createOscillator();
    const clickGain = ac.createGain();
    clickOsc.type = "square";
    clickOsc.frequency.setValueAtTime(clamp(toneHz * 4, 80, 8000), now);
    clickGain.gain.setValueAtTime(0.0001, now);
    clickGain.gain.exponentialRampToValueAtTime(0.2 * v * clickAmt + 0.00012, now + 0.002);
    clickGain.gain.exponentialRampToValueAtTime(0.0001, now + 0.018);
    clickOsc.connect(clickGain);
    clickGain.connect(out);
    clickOsc.start(now);
    clickOsc.stop(now + 0.03);
  }

  // noise source
  const noiseBufLen = Math.max(1, Math.floor(ac.sampleRate * 0.25));
  const noiseBuf = ac.createBuffer(1, noiseBufLen, ac.sampleRate);
  const noiseData = noiseBuf.getChannelData(0);
  for (let i = 0; i < noiseBufLen; i++) noiseData[i] = (Math.random() * 2 - 1);
  const noise = ac.createBufferSource();
  noise.buffer = noiseBuf;

  const noiseFilter = ac.createBiquadFilter();
  const noiseGain = ac.createGain();

  // resonator
  const resFilter = ac.createBiquadFilter();
  const resGain = ac.createGain();

  // mild local saturation
  const shaper = ac.createWaveShaper();
  shaper.oversample = "2x";
  const n = 1024;
  const curve = new Float32Array(n);
  const k = clamp(driveAmt ?? 0, 0, 1) * 25;
  for (let i = 0; i < n; i++) {
    const x = (i * 2) / (n - 1) - 1;
    curve[i] = Math.tanh(x * (1 + k));
  }
  shaper.curve = curve;

  // type shaping
  if (type === "kick") {
    noiseFilter.type = "lowpass";
    noiseFilter.frequency.setValueAtTime(250, now);
    resFilter.type = "lowpass";
    resFilter.frequency.setValueAtTime(clamp(toneHz, 35, 140), now);
    resFilter.Q.setValueAtTime(0.7, now);
  } else if (type === "snare") {
    noiseFilter.type = "bandpass";
    noiseFilter.frequency.setValueAtTime(1700, now);
    noiseFilter.Q.setValueAtTime(0.6, now);
    resFilter.type = "bandpass";
    resFilter.frequency.setValueAtTime(clamp(toneHz, 120, 400), now);
    resFilter.Q.setValueAtTime(2.0, now);
  } else if (type === "hat") {
    noiseFilter.type = "highpass";
    noiseFilter.frequency.setValueAtTime(5200, now);
    resFilter.type = "highpass";
    resFilter.frequency.setValueAtTime(6000, now);
    resFilter.Q.setValueAtTime(0.5, now);
  } else { // tom
    noiseFilter.type = "bandpass";
    noiseFilter.frequency.setValueAtTime(900, now);
    noiseFilter.Q.setValueAtTime(0.5, now);
    resFilter.type = "bandpass";
    resFilter.frequency.setValueAtTime(clamp(toneHz, 70, 520), now);
    resFilter.Q.setValueAtTime(4.0, now);
  }

  // envelopes
  const tEnd = now + clamp(decay, 0.02, 3.0);

  // noise envelope
  noiseGain.gain.setValueAtTime(0.0001, now);
  const noiseLevel = (type === "kick" ? 0.08 : type === "hat" ? 0.35 : 0.22) * v * clamp(noiseAmt, 0, 1);
  noiseGain.gain.exponentialRampToValueAtTime(Math.max(0.00012, noiseLevel), now + 0.003);
  noiseGain.gain.exponentialRampToValueAtTime(0.0001, tEnd);

  // resonator envelope
  resGain.gain.setValueAtTime(0.0001, now);
  const resLevel = (type === "hat" ? 0.12 : 0.32) * v;
  resGain.gain.exponentialRampToValueAtTime(Math.max(0.00012, resLevel), now + 0.004);
  resGain.gain.exponentialRampToValueAtTime(0.0001, tEnd);

  // master hit envelope
  out.gain.setValueAtTime(0.0001, now);
  out.gain.exponentialRampToValueAtTime(Math.max(0.00012, 0.9 * v), now + 0.003);
  out.gain.exponentialRampToValueAtTime(0.0001, tEnd);

  // connect
  noise.connect(noiseFilter);
  noiseFilter.connect(noiseGain);
  noiseGain.connect(shaper);

  // for kick/tom, also feed resonator with noise a bit
  shaper.connect(resFilter);
  resFilter.connect(resGain);
  resGain.connect(out);

  // also a direct noisy path for snare/hat
  if (type === "snare" || type === "hat") {
    shaper.connect(out);
  }

  // schedule stop
  noise.start(now);
  noise.stop(tEnd + 0.05);

  // cleanup nodes later (GC ok)
}

/* =======================
   Main App
======================= */
export default function App() {
  const canvasRef = React.useRef(null);
  const rafRef = React.useRef(null);

  // TWO LAYERS of cells
  const [cellsSynth, setCellsSynth] = React.useState([]);
  const [cellsPerc, setCellsPerc] = React.useState([]);

  const cellsSynthRef = React.useRef([]);
  const cellsPercRef = React.useRef([]);
  React.useEffect(() => { cellsSynthRef.current = cellsSynth; }, [cellsSynth]);
  React.useEffect(() => { cellsPercRef.current = cellsPerc; }, [cellsPerc]);

  const [panelOpen, setPanelOpen] = React.useState(false);

  // layer view / paint target
  const [layerUI, setLayerUI] = React.useState({
    paintLayer: "synth",     // "synth" | "perc"
    view: "both",            // "synth" | "perc" | "both"
    ghost: true,
    ghostOpacity: 0.35,
  });

  // painting
  const [paint, setPaint] = React.useState({
    mode: "color",
    color: "#111111",
    useSeq: true,
  });
  const [drawing, setDrawing] = React.useState(false);

  // settings (visual + sound + midi)
  const [s, setS] = React.useState({
    // theme
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

    // color string
    colorSeqOn: true,
    colorSeq: ["#111111", "#ff0055", "#00c2ff", "#00ff88", "#ffe600"],
    colorSeqSpeed: 1.0,
    colorSeqBehave: "same", // same | cycle | wave | random

    // ======= SYNTH (keep) =======
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

    // FX (shared)
    master: 0.85,
    reverbOn: true,
    reverbMix: 0.22,
    reverbTime: 2.2,
    delayOn: true,
    delayMix: 0.18,
    delayTime: 0.28,
    delayFeedback: 0.35,
    driveOn: true,
    drive: 0.6,

    // ======= PERCUSSION LAYER =======
    percOn: true,
    percMaxHitsPerStep: 6,
    percMix: 0.9,          // level into master (pre-fx)
    percTone: 0.55,        // global tone multiplier
    percDecay: 0.55,       // global decay multiplier
    percNoise: 0.55,       // global noise amount
    percClick: 0.35,       // global click amount
    percDrive: 0.35,       // per-hit local drive

    // ======= MIDI =======
    midiOn: true,
    midiDraw: true,
    midiThru: true,
    midiChannel: -1,
    midiLo: 36,
    midiHi: 84,
    midiFadeMin: 0.25,
    midiFadeMax: 2.5,
    midiTargetLayer: "synth", // "synth" | "perc"
  });

  // settings ref for scheduler
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

  // variable edges
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

  // upsert/remove for a specific layer
  const upsertCellIn = React.useCallback((layer, idx, patch) => {
    const setter = layer === "perc" ? setCellsPerc : setCellsSynth;
    setter((prev) => {
      const ex = prev.findIndex((c) => c.idx === idx);
      const next = [...prev];
      if (ex >= 0) next[ex] = { ...next[ex], ...patch };
      else next.push({ idx, ...patch });
      return next;
    });
  }, []);
  const removeCellIn = React.useCallback((layer, idx) => {
    const setter = layer === "perc" ? setCellsPerc : setCellsSynth;
    setter((prev) => prev.filter((c) => c.idx !== idx));
  }, []);

  const applyPaintToIdx = (layer, idx, r, c, t) => {
    if (idx == null) return;

    if (paint.mode === "none") {
      removeCellIn(layer, idx);
      return;
    }

    if (paint.useSeq) {
      const len = palette.length;
      const ci = colorSeqIndex(t, r, c, len);
      upsertCellIn(layer, idx, { paint: { mode: "color", color: palette[ci] } });
    } else {
      upsertCellIn(layer, idx, { paint: { mode: "color", color: paint.color } });
    }
  };

  /* =======================
     AUDIO GRAPH (stable)
     - shared FX + master
     - synth voices connect to shared drive
     - perc bus connects to shared drive (so it actually makes sound)
======================= */
  const audioRef = React.useRef({
    ac: null,
    master: null,
    dry: null,
    wetRev: null,
    wetDel: null,
    convolver: null,
    delay: null,
    feedback: null,
    drive: null,

    // synth voices
    voices: [],
    voicePtr: 0,

    // perc bus
    percBus: null,
    percGain: null,

    // scheduler
    running: false,
    step: 0,
    timer: null,
  });

  function ensureAudio() {
    const A = audioRef.current;
    if (!A.ac) {
      const ac = new (window.AudioContext || window.webkitAudioContext)();
      const master = ac.createGain();
      master.gain.value = 0.85;

      const drive = ac.createWaveShaper();
      drive.oversample = "2x";
      const n = 2048;
      const curve = new Float32Array(n);
      const k = clamp(sRef.current.drive ?? 0.6, 0, 1) * 50;
      for (let i = 0; i < n; i++) {
        const x = (i * 2) / (n - 1) - 1;
        curve[i] = Math.tanh(x * (1 + k));
      }
      drive.curve = curve;

      const dry = ac.createGain();
      const wetRev = ac.createGain();
      const wetDel = ac.createGain();

      const convolver = ac.createConvolver();
      convolver.buffer = createReverbImpulse(ac, sRef.current.reverbTime, 2.0);

      const delay = ac.createDelay(2.0);
      const feedback = ac.createGain();
      feedback.gain.value = clamp(sRef.current.delayFeedback, 0, 0.95);
      delay.delayTime.value = clamp(sRef.current.delayTime, 0.01, 1.5);
      delay.connect(feedback);
      feedback.connect(delay);

      // shared routing:
      // sources -> drive -> (dry + fx) -> master -> destination
      drive.connect(dry);
      drive.connect(convolver);
      drive.connect(delay);

      convolver.connect(wetRev);
      delay.connect(wetDel);

      dry.connect(master);
      wetRev.connect(master);
      wetDel.connect(master);

      master.connect(ac.destination);

      // percussion bus (pre-drive) + level
      const percBus = ac.createGain();
      const percGain = ac.createGain();
      percBus.connect(percGain);
      percGain.connect(drive);

      A.ac = ac;
      A.master = master;
      A.drive = drive;
      A.dry = dry;
      A.wetRev = wetRev;
      A.wetDel = wetDel;
      A.convolver = convolver;
      A.delay = delay;
      A.feedback = feedback;

      A.percBus = percBus;
      A.percGain = percGain;

      A.voices = [];
      A.voicePtr = 0;
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

    // drive
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
    if (Math.abs(st.reverbTime - A._revTime) > 0.12) {
      A._revTime = st.reverbTime;
      A.convolver.buffer = createReverbImpulse(A.ac, clamp(st.reverbTime, 0.3, 6), 2.0);
    }

    // delay
    A.wetDel.gain.setTargetAtTime(st.delayOn ? clamp(st.delayMix, 0, 1) : 0, A.ac.currentTime, 0.02);
    A.delay.delayTime.setTargetAtTime(clamp(st.delayTime, 0.01, 1.5), A.ac.currentTime, 0.02);
    A.feedback.gain.setTargetAtTime(clamp(st.delayFeedback, 0, 0.95), A.ac.currentTime, 0.02);

    // percussion level (THIS is what makes perc actually audible)
    if (A.percGain) {
      const g = st.percOn ? clamp(st.percMix ?? 0.9, 0, 1.5) : 0;
      A.percGain.gain.setTargetAtTime(g, A.ac.currentTime, 0.02);
    }
  }

  function ensureVoices() {
    const A = ensureAudio();
    const ac = A.ac;
    const want = clamp(sRef.current.voices ?? 12, 1, 32);
    if (A.voices.length !== want) {
      const newPool = Array.from({ length: want }, () => {
        const v = makeVoice(ac);
        v.gain.connect(A.drive);
        return v;
      });
      A.voices = newPool;
      A.voicePtr = 0;
    }
  }

  React.useEffect(() => {
    if (audioRef.current.ac) {
      ensureVoices();
      updateAudioParamsRealtime();
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [s]);

  /* =======================
     Scheduler (stable)
     - Synth: reads cellsSynth
     - Perc: reads cellsPerc
======================= */
  function startScheduler() {
    const A = ensureAudio();
    const ac = A.ac;
    if (ac.state === "suspended") ac.resume?.();
    A.running = true;

    const tick = () => {
      if (!audioRef.current.running) return;

      const st = sRef.current;

      ensureVoices();
      updateAudioParamsRealtime();

      const synthNow = cellsSynthRef.current;
      const percNow = cellsPercRef.current;

      const synthMap = new Map();
      for (const c of synthNow) synthMap.set(c.idx, c);
      const percMap = new Map();
      for (const c of percNow) percMap.set(c.idx, c);

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

      // base step
      const bpm = clamp(st.bpm ?? 120, 30, 260);
      const baseStepSec = 60 / bpm / 2; // 8th grid
      let stepSec = baseStepSec;

      // COLUMNS => rhythm (variable step time)
      if (isSwiss && st.varColsOn) {
        const ce = colEdges || Array.from({ length: cols + 1 }, (_, i) => i / cols);
        const curCol = audioRef.current.step % cols;
        const w = ce[curCol + 1] - ce[curCol];
        const avg = 1 / cols;
        const ratio = clamp(w / avg, 0.35, 2.4);
        stepSec = baseStepSec * ratio;
      }

      const col = audioRef.current.step % cols;

      // harmony (synth)
      const prog = Array.isArray(st.prog) && st.prog.length ? st.prog : [0, 5, 3, 6];
      const progRate = Math.max(1, st.progRate | 0);
      const chordIndex = Math.floor(col / progRate) % prog.length;
      const chordDegree = ((prog[chordIndex] | 0) % 7 + 7) % 7;

      const degreesCount = 7 * clamp(st.octaveSpan ?? 4, 1, 7);
      const scaleMidi = buildScaleMidi({
        rootPc: clamp(st.keyRoot ?? 0, 0, 11),
        scaleName: st.scaleName,
        baseMidi: clamp(st.baseMidi ?? 36, 12, 60),
        degreesCount,
      });
      const chordTones = degreeToChordTones(scaleMidi, chordDegree, st.chordType === "triad" ? "triad" : "7");
      const maxNotes = clamp(st.maxNotesPerStep ?? 10, 1, 32);

      // ROWS => envelope + tails
      const re = isSwiss ? rowEdges || Array.from({ length: rows + 1 }, (_, i) => i / rows) : null;
      const avgRowH = isSwiss ? 1 / rows : 1;

      const nowS = performance.now() * 0.001;

      // -------- SYNTH HITS --------
      const synthHits = [];
      if (st.soundOn) {
        for (let r = 0; r < rows; r++) {
          const idx = r * cols + col;
          const cell = synthMap.get(idx);
          const paintObj = cell?.paint;
          if (!paintObj?.color) continue;

          if (typeof cell.expiresAt === "number" && cell.expiresAt <= nowS) continue;

          const rgb = hexToRgb(paintObj.color);
          if (!rgb) continue;

          const lum = luminance01(rgb);
          const h = hue01(rgb);

          let lane = 0;
          if (st.laneMode === "hue") {
            const lanes = chordTones.length;
            lane = clamp(Math.floor(h * lanes), 0, lanes - 1);
          } else {
            lane = col % chordTones.length;
          }

          const rowNorm = rows <= 1 ? 0.5 : 1 - r / (rows - 1); // top=1
          const degFloat = rowNorm * (degreesCount - 1);
          const degIdx = clamp(Math.round(degFloat), 0, degreesCount - 1);

          const rowMidi = scaleMidi[degIdx];
          let target = chordTones[lane];
          while (target < rowMidi - 6) target += 12;
          while (target > rowMidi + 6) target -= 12;
          const freq = midiToFreq(target);

          const vel = st.velFrom === "fixed" ? 0.55 : clamp(0.08 + 0.92 * lum, 0.05, 1);

          const cutoff =
            (st.cutoffBase ?? 400) + (st.cutoffSpan ?? 7200) * clamp(0.15 + 0.85 * lum, 0, 1);

          let attack = (st.atkBase ?? 0.008) + (st.atkSpan ?? 0.09) * clamp(1 - rowNorm, 0, 1);
          let decay = (st.decBase ?? 0.08) + (st.decSpan ?? 0.65) * clamp(lum, 0, 1);
          let release = (st.relBase ?? 0.06) + (st.relSpan ?? 0.85) * clamp(rowNorm, 0, 1);

          if (isSwiss && st.varRowsOn && re) {
            const rh = re[r + 1] - re[r];
            const ratio = clamp(rh / avgRowH, 0.35, 2.4);
            const tailMul = clamp(ratio, 0.55, 1.9);
            decay *= tailMul;
            release *= tailMul;
            attack *= clamp(1.25 - (tailMul - 1) * 0.4, 0.5, 1.4);
          }

          attack = clamp(attack, 0.002, 0.2);
          decay = clamp(decay, 0.03, 2.0);
          release = clamp(release, 0.03, 2.6);

          synthHits.push({ freq, vel, cutoff, attack, decay, release, score: vel });
        }

        synthHits.sort((a, b) => b.score - a.score);
        const chosen = synthHits.slice(0, Math.min(maxNotes, synthHits.length));
        const pool = audioRef.current.voices;

        for (const h of chosen) {
          const v = pool[audioRef.current.voicePtr % pool.length];
          audioRef.current.voicePtr++;
          triggerVoice(ac, v, {
            freq: h.freq,
            vel: h.vel,
            cutoffHz: h.cutoff,
            attack: h.attack,
            decaySec: h.decay,
            release: h.release,
          });
        }
      }

      // -------- PERC HITS --------
      if (st.percOn && audioRef.current.percBus) {
        const maxPerc = clamp(st.percMaxHitsPerStep ?? 6, 1, 24);
        const percHits = [];

        // read the *same* current column, but from perc layer cells
        for (let r = 0; r < rows; r++) {
          const idx = r * cols + col;
          const cell = percMap.get(idx);
          const paintObj = cell?.paint;
          if (!paintObj?.color) continue;

          if (typeof cell.expiresAt === "number" && cell.expiresAt <= nowS) continue;

          const rgb = hexToRgb(paintObj.color);
          if (!rgb) continue;

          const lum = luminance01(rgb);
          const h = hue01(rgb);

          // map hue -> drum type (4 zones)
          const zone = Math.floor(clamp(h, 0, 0.9999) * 4);
          const type = zone === 0 ? "kick" : zone === 1 ? "snare" : zone === 2 ? "tom" : "hat";

          // rows shape: top = tighter/shorter, bottom = longer/deeper
          const rowNorm = rows <= 1 ? 0.5 : 1 - r / (rows - 1); // top=1
          const depth = clamp(1 - rowNorm, 0, 1); // bottom=1

          const vel = clamp(0.15 + 0.85 * lum, 0.05, 1);

          // tone/decay mapping feels “Taiko-ish”: deeper + longer down low
          const baseTone =
            type === "kick" ? 55 :
            type === "snare" ? 220 :
            type === "tom" ? 140 :
            6200;

          // for tom/snare, allow pitch bend by row
          const toneHz =
            type === "hat"
              ? baseTone
              : clamp(baseTone * (1 + (0.65 - depth) * 0.9) * (0.6 + 0.9 * (st.percTone ?? 0.55)), 35, 1200);

          // decay: longer on bottom, shorter on top (and affected by variable row heights)
          let decay =
            (0.05 + depth * 0.55) *
            (0.35 + 1.6 * (st.percDecay ?? 0.55));

          if (isSwiss && st.varRowsOn && re) {
            const rh = re[r + 1] - re[r];
            const ratio = clamp(rh / avgRowH, 0.35, 2.4);
            decay *= clamp(ratio, 0.6, 1.8);
          }

          decay = clamp(decay, 0.03, 2.4);

          const noiseAmt = clamp((st.percNoise ?? 0.55) * (type === "kick" ? 0.35 : type === "tom" ? 0.55 : 1.0), 0, 1);
          const clickAmt = clamp((st.percClick ?? 0.35) * (type === "hat" ? 0.75 : 1.0), 0, 1);
          const driveAmt = clamp(st.percDrive ?? 0.35, 0, 1);

          const score = vel;

          percHits.push({ type, vel, toneHz, decay, noiseAmt, clickAmt, driveAmt, score });
        }

        percHits.sort((a, b) => b.score - a.score);
        const chosenPerc = percHits.slice(0, Math.min(maxPerc, percHits.length));

        for (const h of chosenPerc) {
          triggerPerc(ac, audioRef.current.percBus, {
            type: h.type,
            vel: h.vel,
            toneHz: h.toneHz,
            decay: h.decay,
            noiseAmt: h.noiseAmt,
            clickAmt: h.clickAmt,
            driveAmt: h.driveAmt,
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
  }

  React.useEffect(() => {
    startScheduler();
    return () => stopScheduler();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  /* =======================
     MIDI (Web MIDI API)
     - MIDI paints the selected target layer
     - optional MIDI-thru: plays synth immediately
======================= */
  const [midiSupported, setMidiSupported] = React.useState(false);
  const [midiInputs, setMidiInputs] = React.useState([]);
  const [midiInputId, setMidiInputId] = React.useState("");
  const midiAccessRef = React.useRef(null);
  const midiActiveRef = React.useRef(new Map()); // key: note+ch => { t0, vel01, note, ch, idx }

  const midiToColor = React.useCallback((note, vel01, durSec) => {
    const h = clamp(note / 127, 0, 1);
    const s = clamp(0.25 + vel01 * 0.7, 0, 1);
    const l = clamp(0.18 + vel01 * 0.55 + clamp(durSec / 2.5, 0, 1) * 0.12, 0, 1);
    return rgbToHex(hslToRgb(h, s, l));
  }, []);

  const getGridDims = React.useCallback(() => {
    const st = sRef.current;
    if (st.pat === "swiss-grid") {
      return { cols: Math.max(1, st.cols | 0), rows: Math.max(1, st.rows | 0) };
    }
    const cv = canvasRef.current;
    if (cv) {
      return {
        cols: Math.max(1, Math.floor(cv.width / st.space)),
        rows: Math.max(1, Math.floor(cv.height / st.space)),
      };
    }
    return { cols: 16, rows: 12 };
  }, []);

  // improved MIDI mapping so it uses more of the grid:
  // - row from pitch (like before)
  // - col from "note class + time" to scatter across columns even if you hold one note
  const midiNoteToCell = React.useCallback((note) => {
    const st = sRef.current;
    const { cols, rows } = getGridDims();
    const lo = clamp(st.midiLo ?? 36, 0, 127);
    const hi = clamp(st.midiHi ?? 84, 0, 127);
    const span = Math.max(1, hi - lo);

    const t = clamp((note - lo) / span, 0, 1);
    const row = clamp(Math.round((1 - t) * (rows - 1)), 0, rows - 1);

    // scatter across columns:
    // - lock partly to scheduler (rhythm)
    // - add pitch class so it doesn’t stack in one column
    const step = audioRef.current.step || 0;
    const pc = note % 12;
    const col = (step + pc * 3) % cols;

    const idx = row * cols + col;
    return { row, col, idx, cols, rows };
  }, [getGridDims]);

  const paintFromMidiOn = React.useCallback(
    (note, vel, ch) => {
      const st = sRef.current;
      if (!st.midiOn || !st.midiDraw) return;

      const layer = st.midiTargetLayer === "perc" ? "perc" : "synth";

      const nowS = performance.now() * 0.001;
      const vel01 = clamp(vel / 127, 0, 1);

      const { idx, row, col } = midiNoteToCell(note);

      const color = midiToColor(note, vel01, 0);
      const expiresAt = nowS + clamp(st.midiFadeMin ?? 0.25, 0.05, 6);

      upsertCellIn(layer, idx, {
        paint: { mode: "color", color },
        midi: { note, vel: vel01, ch, t0: nowS, dur: 0, row, col },
        expiresAt,
      });

      midiActiveRef.current.set(`${note}:${ch}:${layer}`, { t0: nowS, vel01, note, ch, idx, layer });
    },
    [midiNoteToCell, midiToColor, upsertCellIn]
  );

  const paintFromMidiOff = React.useCallback(
    (note, ch) => {
      const st = sRef.current;
      if (!st.midiOn || !st.midiDraw) return;

      const layer = st.midiTargetLayer === "perc" ? "perc" : "synth";
      const key = `${note}:${ch}:${layer}`;
      const entry = midiActiveRef.current.get(key);
      if (!entry) return;

      const nowS = performance.now() * 0.001;
      const dur = clamp(nowS - entry.t0, 0, 10);

      const color = midiToColor(note, entry.vel01, dur);
      const fade = clamp(
        (st.midiFadeMin ?? 0.25) +
          ((st.midiFadeMax ?? 2.5) - (st.midiFadeMin ?? 0.25)) * clamp(dur / 2.0, 0, 1),
        0.05,
        8
      );
      const expiresAt = nowS + fade;

      upsertCellIn(layer, entry.idx, {
        paint: { mode: "color", color },
        midi: { note, vel: entry.vel01, ch, t0: entry.t0, dur },
        expiresAt,
      });

      midiActiveRef.current.delete(key);
    },
    [midiToColor, upsertCellIn]
  );

  const midiThruPlay = React.useCallback((note, vel) => {
    const st = sRef.current;
    if (!st.midiOn || !st.midiThru) return;

    const A = ensureAudio();
    const ac = A.ac;
    if (!A.ac) return;

    if (ac.state === "suspended") return;

    ensureVoices();
    updateAudioParamsRealtime();

    const vel01 = clamp(vel / 127, 0.05, 1);
    const freq = midiToFreq(note);

    const attack = 0.004 + (1 - vel01) * 0.02;
    const decay = 0.08 + vel01 * 0.35;
    const release = 0.12 + (1 - vel01) * 0.35;
    const cutoff = (st.cutoffBase ?? 400) + (st.cutoffSpan ?? 7200) * clamp(0.25 + vel01 * 0.75, 0, 1);

    const v = A.voices[A.voicePtr % A.voices.length];
    A.voicePtr++;
    triggerVoice(ac, v, { freq, vel: vel01, cutoffHz: cutoff, attack, decaySec: decay, release });
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
      .catch(() => {
        setMidiSupported(false);
      });

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

    const layer = layerUI.paintLayer;

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

  const onPointerMove = (e) => {
    if (!drawing) return;
    const cv = canvasRef.current;
    if (!cv) return;
    const { x, y } = pointerToCanvas(e);
    const idx = getIdx(x, y);
    if (idx == null) return;

    const layer = layerUI.paintLayer;

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

  // refresh button (no-op but keeps UI)
  const gen = () => {
    setCellsSynth((p) => [...p]);
    setCellsPerc((p) => [...p]);
  };

  const clearPaint = () => {
    setCellsSynth([]);
    setCellsPerc([]);
  };

  const clearActiveLayer = () => {
    if (layerUI.paintLayer === "perc") setCellsPerc([]);
    else setCellsSynth([]);
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

    const dark = s.theme === "dark";

    const bg = dark ? "#0B0C10" : "#FAFAFA";
    const panelBg = dark ? "#0F1117" : "#FAFAFA";
    const gridStroke = dark ? "rgba(255,255,255,0.08)" : "#E6E6E6";
    const gridStrokeChar = dark ? "rgba(255,255,255,0.08)" : "#EAEAEA";
    const textIdle = dark ? "rgba(255,255,255,0.85)" : "#111111";
    const textOnPaint = dark ? "#0A0A0A" : "#0A0A0A"; // keep readable on colored fill

    ctx.clearRect(0, 0, w, h);
    ctx.fillStyle = bg;
    ctx.fillRect(0, 0, w, h);

    // maps
    const mapSynth = new Map();
    for (const c of cellsSynth) mapSynth.set(c.idx, c);

    const mapPerc = new Map();
    for (const c of cellsPerc) mapPerc.set(c.idx, c);

    const showSynth = layerUI.view === "synth" || layerUI.view === "both";
    const showPerc = layerUI.view === "perc" || layerUI.view === "both";
    const ghost = layerUI.view === "both" && layerUI.ghost;
    const ghostA = clamp(layerUI.ghostOpacity ?? 0.35, 0, 1);

    ctx.textAlign = "center";
    ctx.textBaseline = "middle";

    const drawCell = (idx, x, y, ww, hh, r, c, baseAlpha, fromPerc) => {
      const map = fromPerc ? mapPerc : mapSynth;
      const entry = map.get(idx);
      const col = entry?.paint?.color;

      let a = baseAlpha;
      if (entry?.expiresAt != null) {
        const rem = entry.expiresAt - nowS;
        if (rem <= 0) return;
        a *= clamp(rem / 0.35, 0, 1);
      }

      if (col) {
        ctx.save();
        ctx.fillStyle = col;
        ctx.globalAlpha = 0.92 * a;
        ctx.fillRect(x, y, ww, hh);
        ctx.restore();
      }

      // character
      const chs = (s.chars || "01").split("");
      const spd = (s.charSpd ?? 2) * (s.pat === "char-grid" ? 0.9 : 0.85);
      const gi = chs.length ? Math.floor((t * spd + r * 0.09 + c * 0.05) * 3) % chs.length : 0;

      ctx.save();
      const sz = s.pat === "char-grid" ? s.charSz : Math.max(8, Math.min(ww, hh) * 0.55 * (s.swissCharScale ?? 1));
      ctx.font = `${Math.floor(sz)}px ${getFontFamily()}`;
      ctx.fillStyle = col ? textOnPaint : textIdle;
      ctx.globalAlpha = col ? 1 : dark ? 0.9 : 0.95;
      ctx.fillText(chs[gi] ?? "0", x + ww / 2, y + hh / 2);
      ctx.restore();
    };

    if (s.pat === "char-grid") {
      const cols = Math.max(1, Math.floor(w / s.space));
      const rows = Math.max(1, Math.floor(h / s.space));

      if (s.gridLines) {
        ctx.save();
        ctx.strokeStyle = gridStrokeChar;
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

      for (let r = 0; r < rows; r++) {
        for (let c = 0; c < cols; c++) {
          const idx = r * cols + c;
          const x0 = c * s.space;
          const y0 = r * s.space;

          // draw order: main layer first, ghost second (or vice versa)
          if (showSynth && showPerc) {
            if (layerUI.paintLayer === "perc") {
              // perc is "active": draw perc solid, synth ghost
              if (showPerc) drawCell(idx, x0, y0, s.space, s.space, r, c, 1, true);
              if (ghost && showSynth) drawCell(idx, x0, y0, s.space, s.space, r, c, ghostA, false);
            } else {
              // synth is active: draw synth solid, perc ghost
              if (showSynth) drawCell(idx, x0, y0, s.space, s.space, r, c, 1, false);
              if (ghost && showPerc) drawCell(idx, x0, y0, s.space, s.space, r, c, ghostA, true);
            }
          } else {
            if (showSynth) drawCell(idx, x0, y0, s.space, s.space, r, c, 1, false);
            if (showPerc) drawCell(idx, x0, y0, s.space, s.space, r, c, 1, true);
          }
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

      for (let r = 0; r < rows; r++) {
        for (let c = 0; c < cols; c++) {
          const idx = r * cols + c;
          const g = swissCellGeom(r, c, w, h);

          if (showSynth && showPerc) {
            if (layerUI.paintLayer === "perc") {
              if (showPerc) drawCell(idx, g.x, g.y, g.w, g.h, r, c, 1, true);
              if (ghost && showSynth) drawCell(idx, g.x, g.y, g.w, g.h, r, c, ghostA, false);
            } else {
              if (showSynth) drawCell(idx, g.x, g.y, g.w, g.h, r, c, 1, false);
              if (ghost && showPerc) drawCell(idx, g.x, g.y, g.w, g.h, r, c, ghostA, true);
            }
          } else {
            if (showSynth) drawCell(idx, g.x, g.y, g.w, g.h, r, c, 1, false);
            if (showPerc) drawCell(idx, g.x, g.y, g.w, g.h, r, c, 1, true);
          }
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
  }, [s, cellsSynth, cellsPerc, colEdges, rowEdges, layerUI]);

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
  const dark = s.theme === "dark";

  const panelBg = dark ? "bg-[#0F1117] border-[#1C2030]" : "bg-neutral-50 border-neutral-200";
  const panelText = dark ? "text-neutral-100" : "text-neutral-900";
  const inputBg = dark ? "bg-[#0B0C10] border-[#2A2F44] text-neutral-100" : "bg-white border-neutral-300";
  const mutedText = dark ? "text-neutral-300" : "text-neutral-600";
  const divider = dark ? "border-[#1C2030]" : "border-neutral-200";

  const pillOn = dark ? "bg-white text-black border-white" : "bg-black text-white border-black";
  const pillOff = dark ? "bg-[#0B0C10] text-neutral-100 border-[#2A2F44]" : "bg-white border-neutral-300";

  return (
    <div className={`w-full h-[100svh] flex flex-col md:flex-row overflow-hidden ${dark ? "bg-[#0B0C10]" : "bg-white"}`}>
      {panelOpen && (
        <div className="fixed inset-0 bg-black/40 z-30 md:hidden" onClick={() => setPanelOpen(false)} />
      )}

      {/* Controls */}
      <div
        className={
          "fixed md:static z-40 md:z-auto inset-y-0 left-0 w-80 max-w-[90vw] border-r p-4 md:p-5 overflow-y-auto space-y-4 text-sm transform transition-transform duration-200 md:transform-none " +
          (panelOpen ? "translate-x-0" : "-translate-x-full md:translate-x-0") +
          " " +
          panelBg +
          " " +
          panelText
        }
      >
        <div className="flex gap-2">
          <button
            onClick={gen}
            className={`flex-1 flex justify-center px-4 py-2.5 rounded-lg font-medium min-h-[44px] ${dark ? "bg-white text-black hover:bg-neutral-200" : "bg-black text-white hover:bg-neutral-800"}`}
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
            className={`flex-1 flex justify-center px-4 py-2.5 rounded-lg font-medium min-h-[44px] ${dark ? "bg-white text-black hover:bg-neutral-200" : "bg-black text-white hover:bg-neutral-800"}`}
            title="Download PNG"
          >
            <Download size={16} />
          </button>
        </div>

        <div className="flex gap-2">
          <button
            onClick={unlockAudio}
            className={`flex-1 px-4 py-2.5 rounded-lg font-medium min-h-[44px] ${dark ? "bg-white text-black hover:bg-neutral-200" : "bg-neutral-900 text-white hover:bg-black"}`}
          >
            Enable Audio (click once)
          </button>
          <button
            onClick={() => setS((p) => ({ ...p, theme: p.theme === "dark" ? "light" : "dark" }))}
            className={`w-[52px] flex items-center justify-center px-3 py-2.5 rounded-lg border min-h-[44px] ${dark ? "bg-[#0B0C10] border-[#2A2F44] hover:bg-[#121524]" : "bg-white border-neutral-300 hover:bg-neutral-50"}`}
            title="Toggle dark mode"
          >
            {dark ? <Sun size={16} /> : <Moon size={16} />}
          </button>
        </div>

        {/* Layers */}
        <div className={`rounded-lg border p-3 space-y-2 ${dark ? "border-[#1C2030] bg-[#0B0C10]" : "border-neutral-200 bg-white"}`}>
          <div className="flex items-center justify-between">
            <div className="text-xs font-semibold uppercase tracking-wider flex items-center gap-2">
              <Layers size={14} />
              Layers
            </div>
            <button
              onClick={clearActiveLayer}
              className={`px-3 py-1.5 rounded-lg border text-xs font-semibold ${dark ? "border-[#2A2F44] hover:bg-[#121524]" : "border-neutral-300 hover:bg-neutral-50"}`}
              title="Clear active layer"
            >
              Clear {layerUI.paintLayer === "perc" ? "Perc" : "Synth"}
            </button>
          </div>

          <div className="grid grid-cols-2 gap-2">
            <button
              onClick={() => setLayerUI((p) => ({ ...p, paintLayer: "synth" }))}
              className={`px-3 py-2 rounded-lg border text-xs font-semibold min-h-[40px] ${layerUI.paintLayer === "synth" ? pillOn : pillOff}`}
            >
              Paint: Synth
            </button>
            <button
              onClick={() => setLayerUI((p) => ({ ...p, paintLayer: "perc" }))}
              className={`px-3 py-2 rounded-lg border text-xs font-semibold min-h-[40px] ${layerUI.paintLayer === "perc" ? pillOn : pillOff}`}
            >
              Paint: Perc
            </button>
          </div>

          <div className="grid grid-cols-3 gap-2">
            <button
              onClick={() => setLayerUI((p) => ({ ...p, view: "synth" }))}
              className={`px-3 py-2 rounded-lg border text-xs font-semibold min-h-[40px] ${layerUI.view === "synth" ? pillOn : pillOff}`}
            >
              View Synth
            </button>
            <button
              onClick={() => setLayerUI((p) => ({ ...p, view: "both" }))}
              className={`px-3 py-2 rounded-lg border text-xs font-semibold min-h-[40px] ${layerUI.view === "both" ? pillOn : pillOff}`}
            >
              Both
            </button>
            <button
              onClick={() => setLayerUI((p) => ({ ...p, view: "perc" }))}
              className={`px-3 py-2 rounded-lg border text-xs font-semibold min-h-[40px] ${layerUI.view === "perc" ? pillOn : pillOff}`}
            >
              View Perc
            </button>
          </div>

          {layerUI.view === "both" && (
            <>
              <div className="flex items-center justify-between">
                <div className={`text-xs ${mutedText}`}>Ghost</div>
                <button
                  onClick={() => setLayerUI((p) => ({ ...p, ghost: !p.ghost }))}
                  className={`p-1.5 rounded ${layerUI.ghost ? (dark ? "bg-white text-black" : "bg-black text-white") : (dark ? "bg-[#121524] text-white" : "bg-neutral-200 text-neutral-700")}`}
                >
                  {layerUI.ghost ? <Play size={14} fill={dark ? "black" : "white"} /> : <Square size={14} />}
                </button>
              </div>
              {layerUI.ghost && (
                <>
                  <div className={`text-xs ${mutedText}`}>Ghost opacity: {layerUI.ghostOpacity.toFixed(2)}</div>
                  <input
                    type="range"
                    min="0.05"
                    max="0.9"
                    step="0.01"
                    value={layerUI.ghostOpacity}
                    onChange={(e) => setLayerUI((p) => ({ ...p, ghostOpacity: parseFloat(e.target.value) }))}
                    className="w-full"
                  />
                </>
              )}
            </>
          )}

          <div className={`text-[11px] ${mutedText}`}>
            Perc layer: hue picks drum type (kick/snare/tom/hat). Rows change pitch/decay.
          </div>
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

        {/* Paint */}
        <div className="space-y-2">
          <label className="block text-xs font-semibold uppercase tracking-wider">Paint</label>

          <div className="flex items-center justify-between gap-2">
            <input
              type="color"
              value={paint.color}
              onChange={(e) => setPaint((p) => ({ ...p, color: e.target.value, useSeq: false }))}
              className={`h-10 w-14 rounded-md border ${dark ? "border-[#2A2F44] bg-[#0B0C10]" : "border-neutral-300 bg-white"}`}
              title="Pick color"
            />

            <button
              onClick={() => setPaint((p) => ({ ...p, useSeq: !p.useSeq, mode: "color" }))}
              className={`flex-1 px-3 py-2 rounded-lg border text-xs font-semibold flex items-center justify-center gap-2 min-h-[44px] ${
                paint.useSeq ? (dark ? "bg-white text-black border-white" : "bg-black text-white border-black") : `${pillOff}`
              }`}
            >
              <Palette size={14} />
              {paint.useSeq ? "Color String ON" : "Color String OFF"}
            </button>

            <button
              onClick={() => setPaint((p) => ({ ...p, mode: p.mode === "none" ? "color" : "none" }))}
              className={`px-3 py-2 rounded-lg text-xs font-semibold min-h-[44px] ${
                paint.mode === "none"
                  ? (dark ? "bg-white text-black" : "bg-black text-white")
                  : (dark ? "bg-[#121524] text-white" : "bg-neutral-200 text-neutral-700")
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
                className={`h-9 w-full rounded-md border ${dark ? "border-[#2A2F44] bg-[#0B0C10]" : "border-neutral-300 bg-white"}`}
                title={`Color String ${i + 1}`}
              />
            ))}
          </div>

          <div className="grid grid-cols-2 gap-2">
            <div className="space-y-1">
              <div className={`text-xs ${mutedText}`}>Color motion</div>
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
              <div className={`text-xs ${mutedText}`}>Speed</div>
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
            className={`w-full px-4 py-2.5 rounded-lg font-medium min-h-[44px] ${dark ? "bg-white text-black hover:bg-neutral-200" : "bg-neutral-900 text-white hover:bg-black"}`}
          >
            Clear ALL Cells (Synth + Perc)
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
                className={`p-1.5 rounded ${s.gridLines ? (dark ? "bg-white text-black" : "bg-black text-white") : (dark ? "bg-[#121524]" : "bg-neutral-200")}`}
              >
                {s.gridLines ? <Play size={14} fill={dark ? "black" : "white"} /> : <Square size={14} />}
              </button>
            </div>

            <label className="block text-xs font-semibold uppercase tracking-wider">Variable Grid Density</label>

            <div className={`rounded-lg border p-3 space-y-2 ${dark ? "border-[#1C2030] bg-[#0B0C10]" : "border-neutral-200 bg-white"}`}>
              <div className="flex items-center justify-between">
                <div className="text-xs font-semibold uppercase tracking-wider">Columns (rhythm)</div>
                <button
                  onClick={() => setS((p) => ({ ...p, varColsOn: !p.varColsOn }))}
                  className={`p-1.5 rounded ${s.varColsOn ? (dark ? "bg-white text-black" : "bg-black text-white") : (dark ? "bg-[#121524]" : "bg-neutral-200")}`}
                >
                  {s.varColsOn ? <Play size={14} fill={dark ? "black" : "white"} /> : <Square size={14} />}
                </button>
              </div>
              {s.varColsOn && (
                <>
                  <label className="block text-xs font-semibold uppercase tracking-wider">Focus X: {s.colFocus.toFixed(2)}</label>
                  <input
                    type="range"
                    min="0"
                    max="1"
                    step="0.01"
                    value={s.colFocus}
                    onChange={(e) => setS((p) => ({ ...p, colFocus: parseFloat(e.target.value) }))}
                    className="w-full"
                  />
                  <label className="block text-xs font-semibold uppercase tracking-wider">Strength: {s.colStrength.toFixed(1)}</label>
                  <input
                    type="range"
                    min="0"
                    max="20"
                    step="0.1"
                    value={s.colStrength}
                    onChange={(e) => setS((p) => ({ ...p, colStrength: parseFloat(e.target.value) }))}
                    className="w-full"
                  />
                  <label className="block text-xs font-semibold uppercase tracking-wider">Band Width: {s.colSigma.toFixed(2)}</label>
                  <input
                    type="range"
                    min="0.05"
                    max="0.5"
                    step="0.01"
                    value={s.colSigma}
                    onChange={(e) => setS((p) => ({ ...p, colSigma: parseFloat(e.target.value) }))}
                    className="w-full"
                  />
                  <div className={`text-[11px] ${mutedText}`}>
                    Columns affect <b>step speed</b> (narrow = faster, wide = slower).
                  </div>
                </>
              )}
            </div>

            <div className={`rounded-lg border p-3 space-y-2 ${dark ? "border-[#1C2030] bg-[#0B0C10]" : "border-neutral-200 bg-white"}`}>
              <div className="flex items-center justify-between">
                <div className="text-xs font-semibold uppercase tracking-wider">Rows (tails)</div>
                <button
                  onClick={() => setS((p) => ({ ...p, varRowsOn: !p.varRowsOn }))}
                  className={`p-1.5 rounded ${s.varRowsOn ? (dark ? "bg-white text-black" : "bg-black text-white") : (dark ? "bg-[#121524]" : "bg-neutral-200")}`}
                >
                  {s.varRowsOn ? <Play size={14} fill={dark ? "black" : "white"} /> : <Square size={14} />}
                </button>
              </div>
              {s.varRowsOn && (
                <>
                  <label className="block text-xs font-semibold uppercase tracking-wider">Focus Y: {s.rowFocus.toFixed(2)}</label>
                  <input
                    type="range"
                    min="0"
                    max="1"
                    step="0.01"
                    value={s.rowFocus}
                    onChange={(e) => setS((p) => ({ ...p, rowFocus: parseFloat(e.target.value) }))}
                    className="w-full"
                  />
                  <label className="block text-xs font-semibold uppercase tracking-wider">Strength: {s.rowStrength.toFixed(1)}</label>
                  <input
                    type="range"
                    min="0"
                    max="20"
                    step="0.1"
                    value={s.rowStrength}
                    onChange={(e) => setS((p) => ({ ...p, rowStrength: parseFloat(e.target.value) }))}
                    className="w-full"
                  />
                  <label className="block text-xs font-semibold uppercase tracking-wider">Band Width: {s.rowSigma.toFixed(2)}</label>
                  <input
                    type="range"
                    min="0.05"
                    max="0.5"
                    step="0.01"
                    value={s.rowSigma}
                    onChange={(e) => setS((p) => ({ ...p, rowSigma: parseFloat(e.target.value) }))}
                    className="w-full"
                  />
                  <div className={`text-[11px] ${mutedText}`}>
                    Rows affect <b>envelope</b> + <b>tails</b> (and row-height changes it more).
                  </div>
                </>
              )}
            </div>
          </div>
        )}

        {s.pat === "char-grid" && (
          <div className="space-y-2">
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
            <label className="block text-xs font-semibold uppercase tracking-wider">Char Speed: {s.charSpd.toFixed(2)}×</label>
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
            <div className="flex items-center justify-between">
              <label className="text-xs font-semibold uppercase tracking-wider">Grid Lines</label>
              <button
                onClick={() => setS((p) => ({ ...p, gridLines: !p.gridLines }))}
                className={`p-1.5 rounded ${s.gridLines ? (dark ? "bg-white text-black" : "bg-black text-white") : (dark ? "bg-[#121524]" : "bg-neutral-200")}`}
              >
                {s.gridLines ? <Play size={14} fill={dark ? "black" : "white"} /> : <Square size={14} />}
              </button>
            </div>
          </div>
        )}

        {/* SYNTH */}
        <div className={`pt-2 border-t ${divider} space-y-2`}>
          <div className="flex items-center justify-between">
            <label className="text-xs font-semibold uppercase tracking-wider">Synth</label>
            <button
              onClick={() => setS((p) => ({ ...p, soundOn: !p.soundOn }))}
              className={`p-1.5 rounded ${s.soundOn ? (dark ? "bg-white text-black" : "bg-black text-white") : (dark ? "bg-[#121524]" : "bg-neutral-200")}`}
              title="Synth on/off"
            >
              {s.soundOn ? <Play size={14} fill={dark ? "black" : "white"} /> : <Square size={14} />}
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

          <label className="block text-xs font-semibold uppercase tracking-wider">Max notes / step: {s.maxNotesPerStep}</label>
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
              <div className={`text-xs ${mutedText}`}>Key</div>
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
              <div className={`text-xs ${mutedText}`}>Scale</div>
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

          <div className={`text-[11px] ${mutedText}`}>
            <b>Always in tune:</b> pitches are quantized to {keyName} {s.scaleName}. <br />
            <b>Layers:</b> paint Synth + Perc independently, view both with ghosting.
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

          <label className="block text-xs font-semibold uppercase tracking-wider">Master: {s.master.toFixed(2)}</label>
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

        {/* PERC */}
        <div className={`pt-2 border-t ${divider} space-y-2`}>
          <div className="flex items-center justify-between">
            <label className="text-xs font-semibold uppercase tracking-wider">Percussion</label>
            <button
              onClick={() => setS((p) => ({ ...p, percOn: !p.percOn }))}
              className={`p-1.5 rounded ${s.percOn ? (dark ? "bg-white text-black" : "bg-black text-white") : (dark ? "bg-[#121524]" : "bg-neutral-200")}`}
              title="Perc on/off"
            >
              {s.percOn ? <Play size={14} fill={dark ? "black" : "white"} /> : <Square size={14} />}
            </button>
          </div>

          <label className="block text-xs font-semibold uppercase tracking-wider">Max hits / step: {s.percMaxHitsPerStep}</label>
          <input
            type="range"
            min="1"
            max="24"
            value={s.percMaxHitsPerStep}
            onChange={(e) => setS((p) => ({ ...p, percMaxHitsPerStep: parseInt(e.target.value, 10) }))}
            className="w-full"
          />

          <label className="block text-xs font-semibold uppercase tracking-wider">Level: {s.percMix.toFixed(2)}</label>
          <input
            type="range"
            min="0"
            max="1.5"
            step="0.01"
            value={s.percMix}
            onChange={(e) => setS((p) => ({ ...p, percMix: parseFloat(e.target.value) }))}
            className="w-full"
          />

          <label className="block text-xs font-semibold uppercase tracking-wider">Tone: {s.percTone.toFixed(2)}</label>
          <input
            type="range"
            min="0"
            max="1"
            step="0.01"
            value={s.percTone}
            onChange={(e) => setS((p) => ({ ...p, percTone: parseFloat(e.target.value) }))}
            className="w-full"
          />

          <label className="block text-xs font-semibold uppercase tracking-wider">Decay: {s.percDecay.toFixed(2)}</label>
          <input
            type="range"
            min="0"
            max="1"
            step="0.01"
            value={s.percDecay}
            onChange={(e) => setS((p) => ({ ...p, percDecay: parseFloat(e.target.value) }))}
            className="w-full"
          />

          <label className="block text-xs font-semibold uppercase tracking-wider">Noise: {s.percNoise.toFixed(2)}</label>
          <input
            type="range"
            min="0"
            max="1"
            step="0.01"
            value={s.percNoise}
            onChange={(e) => setS((p) => ({ ...p, percNoise: parseFloat(e.target.value) }))}
            className="w-full"
          />

          <label className="block text-xs font-semibold uppercase tracking-wider">Click: {s.percClick.toFixed(2)}</label>
          <input
            type="range"
            min="0"
            max="1"
            step="0.01"
            value={s.percClick}
            onChange={(e) => setS((p) => ({ ...p, percClick: parseFloat(e.target.value) }))}
            className="w-full"
          />

          <label className="block text-xs font-semibold uppercase tracking-wider">Perc Drive: {s.percDrive.toFixed(2)}</label>
          <input
            type="range"
            min="0"
            max="1"
            step="0.01"
            value={s.percDrive}
            onChange={(e) => setS((p) => ({ ...p, percDrive: parseFloat(e.target.value) }))}
            className="w-full"
          />

          <div className={`text-[11px] ${mutedText}`}>
            Paint Perc layer to hear drums. If you hear nothing, press <b>Enable Audio</b> once.
          </div>
        </div>

        {/* MIDI */}
        <div className={`pt-2 border-t ${divider} space-y-2`}>
          <div className="flex items-center justify-between">
            <label className="text-xs font-semibold uppercase tracking-wider">MIDI</label>
            <button
              onClick={() => setS((p) => ({ ...p, midiOn: !p.midiOn }))}
              className={`p-1.5 rounded ${s.midiOn ? (dark ? "bg-white text-black" : "bg-black text-white") : (dark ? "bg-[#121524]" : "bg-neutral-200")}`}
              title="MIDI on/off"
              disabled={!midiSupported}
            >
              {s.midiOn ? <Play size={14} fill={dark ? "black" : "white"} /> : <Square size={14} />}
            </button>
          </div>

          {!midiSupported ? (
            <div className={`text-[11px] ${mutedText}`}>This browser/device doesn’t support Web MIDI.</div>
          ) : (
            <>
              <div className="space-y-1">
                <div className={`text-xs ${mutedText}`}>Input</div>
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
                  className={`px-3 py-2 rounded-lg border text-xs font-semibold min-h-[44px] ${s.midiDraw ? pillOn : pillOff}`}
                >
                  MIDI draws
                </button>
                <button
                  onClick={() => setS((p) => ({ ...p, midiThru: !p.midiThru }))}
                  className={`px-3 py-2 rounded-lg border text-xs font-semibold min-h-[44px] ${s.midiThru ? pillOn : pillOff}`}
                >
                  MIDI thru
                </button>
              </div>

              <div className="space-y-1">
                <div className={`text-xs ${mutedText}`}>Draw target</div>
                <select
                  value={s.midiTargetLayer}
                  onChange={(e) => setS((p) => ({ ...p, midiTargetLayer: e.target.value }))}
                  className={`w-full px-2 py-2 rounded-lg border text-xs ${inputBg}`}
                >
                  <option value="synth">Synth layer</option>
                  <option value="perc">Perc layer</option>
                </select>
              </div>

              <div className="space-y-1">
                <div className={`text-xs ${mutedText}`}>Channel</div>
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
                  <div className={`text-xs ${mutedText}`}>Note low</div>
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
                  <div className={`text-xs ${mutedText}`}>Note high</div>
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

              <div className={`text-[11px] ${mutedText}`}>
                MIDI now <b>scatters across columns</b> (so it won’t stack in one column). Velocity → color intensity, duration → persistence.
              </div>
            </>
          )}
        </div>

        {/* FX */}
        <div className={`pt-2 border-t ${divider} space-y-2`}>
          <label className="block text-xs font-semibold uppercase tracking-wider">FX</label>

          <div className={`rounded-lg border p-3 space-y-2 ${dark ? "border-[#1C2030] bg-[#0B0C10]" : "border-neutral-200 bg-white"}`}>
            <div className="flex items-center justify-between">
              <div className="text-xs font-semibold uppercase tracking-wider">Reverb</div>
              <button
                onClick={() => setS((p) => ({ ...p, reverbOn: !p.reverbOn }))}
                className={`p-1.5 rounded ${s.reverbOn ? (dark ? "bg-white text-black" : "bg-black text-white") : (dark ? "bg-[#121524]" : "bg-neutral-200")}`}
              >
                {s.reverbOn ? <Play size={14} fill={dark ? "black" : "white"} /> : <Square size={14} />}
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

          <div className={`rounded-lg border p-3 space-y-2 ${dark ? "border-[#1C2030] bg-[#0B0C10]" : "border-neutral-200 bg-white"}`}>
            <div className="flex items-center justify-between">
              <div className="text-xs font-semibold uppercase tracking-wider">Delay</div>
              <button
                onClick={() => setS((p) => ({ ...p, delayOn: !p.delayOn }))}
                className={`p-1.5 rounded ${s.delayOn ? (dark ? "bg-white text-black" : "bg-black text-white") : (dark ? "bg-[#121524]" : "bg-neutral-200")}`}
              >
                {s.delayOn ? <Play size={14} fill={dark ? "black" : "white"} /> : <Square size={14} />}
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

          <div className={`rounded-lg border p-3 space-y-2 ${dark ? "border-[#1C2030] bg-[#0B0C10]" : "border-neutral-200 bg-white"}`}>
            <div className="flex items-center justify-between">
              <div className="text-xs font-semibold uppercase tracking-wider">Drive</div>
              <button
                onClick={() => setS((p) => ({ ...p, driveOn: !p.driveOn }))}
                className={`p-1.5 rounded ${s.driveOn ? (dark ? "bg-white text-black" : "bg-black text-white") : (dark ? "bg-[#121524]" : "bg-neutral-200")}`}
              >
                {s.driveOn ? <Play size={14} fill={dark ? "black" : "white"} /> : <Square size={14} />}
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

        <div className={`text-[11px] ${mutedText}`}>
          If MIDI draws but audio is silent: press <b>Enable Audio</b> once (browser rule).
        </div>
      </div>

      {/* Canvas */}
      <div className={`flex-1 min-h-0 p-2 md:p-8 relative overflow-hidden ${dark ? "bg-[#0B0C10]" : "bg-white"}`}>
        <button
          onClick={() => setPanelOpen((v) => !v)}
          className={`md:hidden absolute top-3 left-3 z-20 px-3 py-2 rounded-lg text-xs font-semibold shadow ${
            dark ? "bg-white text-black" : "bg-black text-white"
          }`}
        >
          {panelOpen ? "Hide controls" : "Show controls"}
        </button>

        <canvas
          ref={canvasRef}
          className={`w-full h-full rounded-lg shadow-sm touch-none select-none ${dark ? "shadow-black/30" : ""}`}
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
