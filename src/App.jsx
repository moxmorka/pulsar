// App.jsx
import React from "react";
import { RotateCcw, Download, Play, Square, Palette, Moon, Sun } from "lucide-react";

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
  const s2 = sigma * sigma || 1e-6;
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
   Sound engine w/ FX (melody)
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

/* =======================
   Percussion (tunable resonator)
   - Noise burst excites a resonant filter + sine body
   - Always in key via quantized midi
======================= */
function makePercVoice(ac) {
  // excitation
  const noiseBufLen = Math.max(1, Math.floor(ac.sampleRate * 0.25));
  const noiseBuf = ac.createBuffer(1, noiseBufLen, ac.sampleRate);
  {
    const d = noiseBuf.getChannelData(0);
    for (let i = 0; i < d.length; i++) {
      // slightly pink-ish by cumulative
      d[i] = (Math.random() * 2 - 1) * Math.pow(1 - i / d.length, 0.25);
    }
  }
  const noise = ac.createBufferSource();
  noise.buffer = noiseBuf;
  noise.loop = true;

  const noiseHP = ac.createBiquadFilter();
  noiseHP.type = "highpass";
  noiseHP.frequency.value = 90;

  const noiseGain = ac.createGain();
  noiseGain.gain.value = 0.0001;

  // resonator
  const res = ac.createBiquadFilter();
  res.type = "bandpass";
  res.frequency.value = 180;
  res.Q.value = 10;

  const bodyOsc = ac.createOscillator();
  bodyOsc.type = "sine";
  bodyOsc.frequency.value = 180;

  const bodyGain = ac.createGain();
  bodyGain.gain.value = 0.0001;

  const out = ac.createGain();
  out.gain.value = 1;

  noise.connect(noiseHP);
  noiseHP.connect(noiseGain);
  noiseGain.connect(res);
  res.connect(out);

  bodyOsc.connect(bodyGain);
  bodyGain.connect(out);

  noise.start();
  bodyOsc.start();

  return { noise, noiseHP, noiseGain, res, bodyOsc, bodyGain, out };
}

function triggerPerc(ac, voice, params) {
  const {
    freq,
    vel,
    noiseAmt,
    bodyAmt,
    q,
    hit,
    decay,
    tone,
    pitchMod = 0,
  } = params;

  const now = ac.currentTime;
  const v = clamp(vel, 0.0001, 1);

  // resonator freq
  const f = clamp(freq * (1 + clamp(pitchMod, -0.25, 0.25)), 30, 5000);

  voice.res.frequency.cancelScheduledValues(now);
  voice.res.frequency.setValueAtTime(f, now);
  voice.res.Q.setValueAtTime(clamp(q, 0.5, 30), now);

  // body osc tracks the resonator a bit (tom-like)
  voice.bodyOsc.frequency.cancelScheduledValues(now);
  voice.bodyOsc.frequency.setValueAtTime(f * clamp(tone, 0.6, 1.8), now);

  // envelopes
  const nG = voice.noiseGain.gain;
  const bG = voice.bodyGain.gain;

  const atk = 0.0015 + (1 - v) * 0.004;
  const dec = clamp(decay, 0.03, 2.8);

  const noisePeak = clamp(noiseAmt, 0, 1) * (0.10 + 0.90 * v) * 0.75;
  const bodyPeak = clamp(bodyAmt, 0, 1) * (0.06 + 0.94 * v) * 0.9;

  nG.cancelScheduledValues(now);
  nG.setValueAtTime(0.0001, now);
  nG.exponentialRampToValueAtTime(Math.max(0.00012, noisePeak * (0.35 + 0.65 * hit)), now + atk);
  nG.exponentialRampToValueAtTime(0.0001, now + atk + dec);

  bG.cancelScheduledValues(now);
  bG.setValueAtTime(0.0001, now);
  bG.exponentialRampToValueAtTime(Math.max(0.00012, bodyPeak * (0.35 + 0.65 * hit)), now + atk);
  bG.exponentialRampToValueAtTime(0.0001, now + atk + dec * 1.05);
}

/* =======================
   Main App
======================= */
export default function App() {
  const canvasRef = React.useRef(null);
  const rafRef = React.useRef(null);

  // ====== LAYERS ======
  // melody layer (original)
  const [cellsA, setCellsA] = React.useState([]);
  const cellsARef = React.useRef([]);
  React.useEffect(() => {
    cellsARef.current = cellsA;
  }, [cellsA]);

  // percussion layer (new)
  const [cellsB, setCellsB] = React.useState([]);
  const cellsBRef = React.useRef([]);
  React.useEffect(() => {
    cellsBRef.current = cellsB;
  }, [cellsB]);

  const [panelOpen, setPanelOpen] = React.useState(false);

  // painting
  const [paint, setPaint] = React.useState({
    mode: "color",
    color: "#111111",
    useSeq: true,
  });
  const [drawing, setDrawing] = React.useState(false);

  const [layer, setLayer] = React.useState("melody"); // "melody" | "perc"
  const [ghost, setGhost] = React.useState({
    show: true,
    opacity: 0.25,
    mode: "ghost", // ghost | both
  });

  // settings (visual + sound + midi)
  const [s, setS] = React.useState({
    // theme
    dark: false,

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

    // variable density (KEEP EXACTLY AS ORIGINAL: swiss-only)
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

    // ======= MELODY (original) =======
    soundOn: true,
    bpm: 120,
    maxNotesPerStep: 10,

    keyRoot: 0, // 0=C
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

    atkBase: 0.008,
    atkSpan: 0.09,
    decBase: 0.08,
    decSpan: 0.65,
    relBase: 0.06,
    relSpan: 0.85,

    voices: 14,

    // FX (original)
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

    // ======= PERCUSSION (new) =======
    percOn: true,
    percMaster: 0.7, // separate volume
    percMaxHitsPerStep: 8,
    percTuneBaseMidi: 36, // deep base (C2)
    percTuneSpanOct: 3.0, // how much the grid spans upward
    percQ: 12,
    percDecayBase: 0.08,
    percDecaySpan: 0.95,
    percNoise: 0.75,
    percBody: 0.85,
    percHit: 0.95, // transient snap
    percTone: 1.0, // body ratio
    percPitchMod: 0.0, // subtle “bend” for character (-0.15..0.15)

    // ======= MIDI (original + target layer) =======
    midiOn: true,
    midiDraw: true,
    midiThru: true,
    midiChannel: -1,
    midiLo: 36,
    midiHi: 84,
    midiFadeMin: 0.25,
    midiFadeMax: 2.5,
    midiTarget: "melody", // "melody" | "perc"
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

  // variable edges (unchanged)
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

  // upsert / remove per-layer
  const upsertCellLayer = React.useCallback((which, idx, patch) => {
    const setter = which === "perc" ? setCellsB : setCellsA;
    setter((prev) => {
      const ex = prev.findIndex((c) => c.idx === idx);
      const next = [...prev];
      if (ex >= 0) next[ex] = { ...next[ex], ...patch };
      else next.push({ idx, ...patch });
      return next;
    });
  }, []);
  const removeCellLayer = React.useCallback((which, idx) => {
    const setter = which === "perc" ? setCellsB : setCellsA;
    setter((prev) => prev.filter((c) => c.idx !== idx));
  }, []);

  const applyPaintToIdx = (idx, r, c, t) => {
    if (idx == null) return;
    const which = layer === "perc" ? "perc" : "melody";
    if (paint.mode === "none") {
      removeCellLayer(which, idx);
      return;
    }
    if (paint.useSeq) {
      const len = palette.length;
      const ci = colorSeqIndex(t, r, c, len);
      upsertCellLayer(which, idx, { paint: { mode: "color", color: palette[ci] } });
    } else {
      upsertCellLayer(which, idx, { paint: { mode: "color", color: paint.color } });
    }
  };

  /* =======================
     AUDIO GRAPH (original + percussion bus)
======================= */
  const audioRef = React.useRef({
    ac: null,
    master: null, // overall master (original)
    dry: null,
    wetRev: null,
    wetDel: null,
    convolver: null,
    delay: null,
    feedback: null,
    drive: null,

    // melody voice pool (original)
    voices: [],
    voicePtr: 0,

    // percussion bus + voices
    percGain: null,
    percVoices: [],
    percPtr: 0,

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

      // NEW: percussion gain before drive/fx
      const percGain = ac.createGain();
      percGain.gain.value = clamp(sRef.current.percMaster ?? 0.7, 0, 1.2);

      // Route: melody voices + percGain -> drive -> dry + fx -> master
      // melody voices connect to drive directly (same as before)
      // percussion voices connect to percGain, then into drive (so it lives in the same space)
      percGain.connect(drive);

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

      A.percGain = percGain;
      A.percVoices = [];
      A.percPtr = 0;

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
    if (A.percGain) A.percGain.gain.setTargetAtTime(clamp(st.percMaster ?? 0.7, 0, 1.2), A.ac.currentTime, 0.02);

    // drive (original)
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

    // reverb (original)
    A.wetRev.gain.setTargetAtTime(st.reverbOn ? clamp(st.reverbMix, 0, 1) : 0, A.ac.currentTime, 0.02);
    if (A._revTime == null) A._revTime = st.reverbTime;
    if (Math.abs(st.reverbTime - A._revTime) > 0.12) {
      A._revTime = st.reverbTime;
      A.convolver.buffer = createReverbImpulse(A.ac, clamp(st.reverbTime, 0.3, 6), 2.0);
    }

    // delay (original)
    A.wetDel.gain.setTargetAtTime(st.delayOn ? clamp(st.delayMix, 0, 1) : 0, A.ac.currentTime, 0.02);
    A.delay.delayTime.setTargetAtTime(clamp(st.delayTime, 0.01, 1.5), A.ac.currentTime, 0.02);
    A.feedback.gain.setTargetAtTime(clamp(st.delayFeedback, 0, 0.95), A.ac.currentTime, 0.02);
  }

  function ensureVoices() {
    const A = ensureAudio();
    const ac = A.ac;

    // melody pool (original)
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

    // percussion pool
    const wantPerc = clamp(sRef.current.percMaxHitsPerStep ?? 8, 2, 24);
    if (A.percVoices.length !== wantPerc) {
      const newPerc = Array.from({ length: wantPerc }, () => {
        const pv = makePercVoice(ac);
        pv.out.connect(A.percGain);
        return pv;
      });
      A.percVoices = newPerc;
      A.percPtr = 0;
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
     Scheduler (original + percussion layer)
     - columns affect step speed (rhythm) (swiss only, unchanged)
     - rows affect envelope (tails) (melody) (unchanged)
     - percussion is also row-pitched (top high, bottom low)
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

      const cv = canvasRef.current;

      // grid dims (unchanged logic)
      let cols = 1,
        rows = 1;
      const isSwiss = st.pat === "swiss-grid";

      if (isSwiss) {
        cols = Math.max(1, st.cols | 0);
        rows = Math.max(1, st.rows | 0);
      } else {
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

      // COLUMNS => rhythm (variable step time) (swiss only, unchanged)
      if (isSwiss && st.varColsOn) {
        const ce = colEdges || Array.from({ length: cols + 1 }, (_, i) => i / cols);
        const curCol = audioRef.current.step % cols;
        const w = ce[curCol + 1] - ce[curCol];
        const avg = 1 / cols;
        const ratio = clamp(w / avg, 0.35, 2.4);
        stepSec = baseStepSec * ratio;
      }

      const col = audioRef.current.step % cols;

      // ===== Melody (original) =====
      if (st.soundOn) {
        const cellsNow = cellsARef.current;
        const map = new Map();
        for (const c of cellsNow) map.set(c.idx, c);

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

        // rows -> tails (unchanged)
        const re = isSwiss ? rowEdges || Array.from({ length: rows + 1 }, (_, i) => i / rows) : null;
        const avgRowH = isSwiss ? 1 / rows : 1;

        const hits = [];
        const nowS = performance.now() * 0.001;

        for (let r = 0; r < rows; r++) {
          const idx = r * cols + col;
          const cell = map.get(idx);
          const paintObj = cell?.paint;
          if (!paintObj?.color) continue;

          if (typeof cell.expiresAt === "number") {
            if (cell.expiresAt <= nowS) continue;
          }

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

          // row -> scale degree index (top high, bottom low) (unchanged)
          const rowNorm = rows <= 1 ? 0.5 : 1 - r / (rows - 1);
          const degFloat = rowNorm * (degreesCount - 1);
          const degIdx = clamp(Math.round(degFloat), 0, degreesCount - 1);

          const rowMidi = scaleMidi[degIdx];
          let target = chordTones[lane];
          while (target < rowMidi - 6) target += 12;
          while (target > rowMidi + 6) target -= 12;
          const freq = midiToFreq(target);

          const vel = st.velFrom === "fixed" ? 0.55 : clamp(0.08 + 0.92 * lum, 0.05, 1);
          const cutoff = (st.cutoffBase ?? 400) + (st.cutoffSpan ?? 7200) * clamp(0.15 + 0.85 * lum, 0, 1);

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

          hits.push({ freq, vel, cutoff, attack, decay, release, score: vel });
        }

        hits.sort((a, b) => b.score - a.score);
        const chosen = hits.slice(0, Math.min(maxNotes, hits.length));

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

      // ===== Percussion (new) =====
      if (st.percOn) {
        const cellsNowB = cellsBRef.current;
        const mapB = new Map();
        for (const c of cellsNowB) mapB.set(c.idx, c);

        // percussion is also quantized to key/scale, but uses its own pitch span
        const degreesCountPerc = 7 * clamp(st.octaveSpan ?? 4, 1, 7); // reuse scale length
        const scaleMidiPerc = buildScaleMidi({
          rootPc: clamp(st.keyRoot ?? 0, 0, 11),
          scaleName: st.scaleName,
          baseMidi: clamp(st.percTuneBaseMidi ?? 36, 12, 72),
          degreesCount: degreesCountPerc,
        });

        const maxHits = clamp(st.percMaxHitsPerStep ?? 8, 1, 24);
        const nowS = performance.now() * 0.001;

        const hitsB = [];
        for (let r = 0; r < rows; r++) {
          const idx = r * cols + col;
          const cell = mapB.get(idx);
          const paintObj = cell?.paint;
          if (!paintObj?.color) continue;

          if (typeof cell.expiresAt === "number") {
            if (cell.expiresAt <= nowS) continue;
          }

          const rgb = hexToRgb(paintObj.color);
          if (!rgb) continue;

          const lum = luminance01(rgb);
          const h = hue01(rgb);

          // row -> pitch (top high, bottom low)
          const rowNorm = rows <= 1 ? 0.5 : 1 - r / (rows - 1);

          // map to a limited pitch span inside the scale
          // span in scale degrees:
          const spanOct = clamp(st.percTuneSpanOct ?? 3.0, 0.5, 6.0);
          const maxDeg = Math.max(1, Math.floor(spanOct * 7));
          const deg = clamp(Math.round(rowNorm * maxDeg), 0, Math.min(maxDeg, degreesCountPerc - 1));
          const midi = scaleMidiPerc[deg] ?? scaleMidiPerc[scaleMidiPerc.length - 1];
          const freq = midiToFreq(midi);

          // dynamics from luminance
          const vel = clamp(0.12 + 0.88 * lum, 0.05, 1);

          // a little color->character
          const noiseAmt = clamp((st.percNoise ?? 0.75) * (0.55 + 0.45 * (1 - h)), 0, 1);
          const bodyAmt = clamp((st.percBody ?? 0.85) * (0.55 + 0.45 * h), 0, 1);

          // decay grows toward bottom (deep booms)
          const decay = clamp((st.percDecayBase ?? 0.08) + (st.percDecaySpan ?? 0.95) * clamp(1 - rowNorm, 0, 1), 0.03, 2.8);

          hitsB.push({
            freq,
            vel,
            decay,
            noiseAmt,
            bodyAmt,
            q: st.percQ ?? 12,
            hit: st.percHit ?? 0.95,
            tone: st.percTone ?? 1.0,
            pitchMod: st.percPitchMod ?? 0.0,
            score: vel,
          });
        }

        hitsB.sort((a, b) => b.score - a.score);
        const chosenB = hitsB.slice(0, Math.min(maxHits, hitsB.length));

        const poolB = audioRef.current.percVoices;
        for (const hb of chosenB) {
          const pv = poolB[audioRef.current.percPtr % poolB.length];
          audioRef.current.percPtr++;
          triggerPerc(audioRef.current.ac, pv, hb);
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
     - MIDI paints selected target layer
     - optional MIDI-thru: plays melody synth OR percussion depending on target
======================= */
  const [midiSupported, setMidiSupported] = React.useState(false);
  const [midiInputs, setMidiInputs] = React.useState([]);
  const [midiInputId, setMidiInputId] = React.useState("");
  const midiAccessRef = React.useRef(null);
  const midiActiveRef = React.useRef(new Map()); // key: note+ch => { t0, vel, idx, note, ch, target }

  const midiToColor = React.useCallback((note, vel01, durSec) => {
    const h = clamp(note / 127, 0, 1);
    const s2 = clamp(0.25 + vel01 * 0.7, 0, 1);
    const l2 = clamp(0.18 + vel01 * 0.55 + clamp(durSec / 2.5, 0, 1) * 0.12, 0, 1);
    return rgbToHex(hslToRgb(h, s2, l2));
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

  const midiNoteToCell = React.useCallback(
    (note) => {
      const st = sRef.current;
      const { cols, rows } = getGridDims();
      const lo = clamp(st.midiLo ?? 36, 0, 127);
      const hi = clamp(st.midiHi ?? 84, 0, 127);
      const span = Math.max(1, hi - lo);

      const t = clamp((note - lo) / span, 0, 1);
      const row = clamp(Math.round((1 - t) * (rows - 1)), 0, rows - 1);

      const col = (audioRef.current.step || 0) % cols;
      const idx = row * cols + col;

      return { row, col, idx, cols, rows };
    },
    [getGridDims]
  );

  const paintFromMidiOn = React.useCallback(
    (note, vel, ch) => {
      const st = sRef.current;
      if (!st.midiOn || !st.midiDraw) return;

      const nowS = performance.now() * 0.001;
      const vel01 = clamp(vel / 127, 0, 1);

      const { row, col, idx } = midiNoteToCell(note);
      const color = midiToColor(note, vel01, 0);
      const expiresAt = nowS + clamp(st.midiFadeMin ?? 0.25, 0.05, 6);

      const target = st.midiTarget === "perc" ? "perc" : "melody";
      upsertCellLayer(target, idx, {
        paint: { mode: "color", color },
        midi: { note, vel: vel01, ch, t0: nowS, dur: 0 },
        expiresAt,
      });

      midiActiveRef.current.set(`${note}:${ch}`, { t0: nowS, vel01, note, ch, idx, row, col, target });
    },
    [midiNoteToCell, midiToColor, upsertCellLayer]
  );

  const paintFromMidiOff = React.useCallback(
    (note, ch) => {
      const st = sRef.current;
      if (!st.midiOn || !st.midiDraw) return;

      const key = `${note}:${ch}`;
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

      upsertCellLayer(entry.target, entry.idx, {
        paint: { mode: "color", color },
        midi: { note, vel: entry.vel01, ch, t0: entry.t0, dur },
        expiresAt,
      });

      midiActiveRef.current.delete(key);
    },
    [midiToColor, upsertCellLayer]
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

    // If MIDI target is percussion, play a perc hit; else play melody note
    if (st.midiTarget === "perc") {
      // quantize note into current key/scale around perc base
      const degreesCountPerc = 7 * clamp(st.octaveSpan ?? 4, 1, 7);
      const scaleMidiPerc = buildScaleMidi({
        rootPc: clamp(st.keyRoot ?? 0, 0, 11),
        scaleName: st.scaleName,
        baseMidi: clamp(st.percTuneBaseMidi ?? 36, 12, 72),
        degreesCount: degreesCountPerc,
      });

      // map incoming midi note to a scale degree (relative)
      const rel = clamp(note - (st.midiLo ?? 36), 0, 48);
      const deg = clamp(Math.round((rel / 48) * (Math.min(degreesCountPerc - 1, 21))), 0, degreesCountPerc - 1);
      const qMidi = scaleMidiPerc[deg] ?? scaleMidiPerc[0];
      const freq = midiToFreq(qMidi);

      const pv = A.percVoices[A.percPtr % A.percVoices.length];
      A.percPtr++;

      const decay = clamp((st.percDecayBase ?? 0.08) + (st.percDecaySpan ?? 0.95) * (0.25 + 0.75 * (1 - vel01)), 0.03, 2.8);

      triggerPerc(ac, pv, {
        freq,
        vel: vel01,
        decay,
        noiseAmt: clamp(st.percNoise ?? 0.75, 0, 1),
        bodyAmt: clamp(st.percBody ?? 0.85, 0, 1),
        q: st.percQ ?? 12,
        hit: st.percHit ?? 0.95,
        tone: st.percTone ?? 1.0,
        pitchMod: st.percPitchMod ?? 0.0,
      });
      return;
    }

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

    if (s.pat === "swiss-grid") {
      const col = idx % s.cols;
      const row = Math.floor(idx / s.cols);
      const t = performance.now() * 0.001;
      applyPaintToIdx(idx, row, col, t);
    } else {
      const col = Math.floor(x / s.space);
      const row = Math.floor(y / s.space);
      const t = performance.now() * 0.001;
      applyPaintToIdx(idx, row, col, t);
    }
  };

  const onPointerMove = (e) => {
    if (!drawing) return;
    const cv = canvasRef.current;
    if (!cv) return;
    const { x, y } = pointerToCanvas(e);
    const idx = getIdx(x, y);
    if (idx == null) return;

    if (s.pat === "swiss-grid") {
      const col = idx % s.cols;
      const row = Math.floor(idx / s.cols);
      const t = performance.now() * 0.001;
      applyPaintToIdx(idx, row, col, t);
    } else {
      const col = Math.floor(x / s.space);
      const row = Math.floor(y / s.space);
      const t = performance.now() * 0.001;
      applyPaintToIdx(idx, row, col, t);
    }
  };

  const onPointerUp = () => setDrawing(false);

  // refresh button (no-op but keeps UI)
  const gen = () => {
    // force redraw (both)
    setCellsA((p) => [...p]);
    setCellsB((p) => [...p]);
  };

  const clearPaint = () => {
    if (layer === "perc") setCellsB([]);
    else setCellsA([]);
  };

  /* =======================
     Render loop (active + ghost)
======================= */
  const getFontFamily = () => `"Inter", system-ui, -apple-system, Segoe UI, Roboto, sans-serif`;

  const theme = React.useMemo(() => {
    if (!s.dark) {
      return {
        appBg: "bg-white",
        panelBg: "bg-neutral-50",
        panelBorder: "border-neutral-200",
        text: "text-neutral-900",
        subText: "text-neutral-600",
        canvasWrap: "bg-white",
        canvasFill: "#FAFAFA",
        gridLine: "#E6E6E6",
        gridLineChar: "#EAEAEA",
        btnPrimary: "bg-black text-white hover:bg-neutral-800",
        btnSecondary: "bg-neutral-900 text-white hover:bg-black",
        btnGhost: "bg-white border-neutral-300 text-neutral-900",
        btnMuted: "bg-neutral-200 text-neutral-700",
        selectBg: "bg-white border-neutral-300 text-neutral-900",
        overlay: "bg-black/30",
      };
    }
    return {
      appBg: "bg-neutral-950",
      panelBg: "bg-neutral-900",
      panelBorder: "border-neutral-800",
      text: "text-neutral-50",
      subText: "text-neutral-400",
      canvasWrap: "bg-neutral-950",
      canvasFill: "#070707",
      gridLine: "#232323",
      gridLineChar: "#242424",
      btnPrimary: "bg-white text-black hover:bg-neutral-200",
      btnSecondary: "bg-neutral-100 text-black hover:bg-white",
      btnGhost: "bg-neutral-900 border-neutral-700 text-neutral-100",
      btnMuted: "bg-neutral-800 text-neutral-200",
      selectBg: "bg-neutral-900 border-neutral-700 text-neutral-100",
      overlay: "bg-black/50",
    };
  }, [s.dark]);

  const render = (tm) => {
    const cv = canvasRef.current;
    if (!cv) return;
    const ctx = cv.getContext("2d");
    const w = cv.width,
      h = cv.height;

    ctx.clearRect(0, 0, w, h);
    ctx.fillStyle = theme.canvasFill;
    ctx.fillRect(0, 0, w, h);

    const t = tm * 0.001;
    const nowS = performance.now() * 0.001;

    // maps
    const mapA = new Map();
    for (const c of cellsA) mapA.set(c.idx, c);
    const mapB = new Map();
    for (const c of cellsB) mapB.set(c.idx, c);

    const activeIsPerc = layer === "perc";
    const activeMap = activeIsPerc ? mapB : mapA;
    const otherMap = activeIsPerc ? mapA : mapB;

    ctx.textAlign = "center";
    ctx.textBaseline = "middle";

    const drawCellFill = (rect, color, alpha) => {
      if (!color) return;
      ctx.save();
      ctx.fillStyle = color;
      ctx.globalAlpha = clamp(alpha, 0, 1);
      ctx.fillRect(rect.x, rect.y, rect.w, rect.h);
      ctx.restore();
    };

    const drawGridLinesChar = (cols, rows) => {
      if (!s.gridLines) return;
      ctx.save();
      ctx.strokeStyle = theme.gridLineChar;
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
    };

    const drawGridLinesSwiss = (cols, rows) => {
      if (!s.gridLines) return;
      const ce = colEdges || Array.from({ length: cols + 1 }, (_, i) => i / cols);
      const re = rowEdges || Array.from({ length: rows + 1 }, (_, i) => i / rows);

      ctx.save();
      ctx.strokeStyle = theme.gridLine;
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
    };

    const getAlphaForEntry = (entry) => {
      let a = 1;
      if (entry?.expiresAt != null) {
        const rem = entry.expiresAt - nowS;
        if (rem <= 0) return 0;
        a = clamp(rem / 0.35, 0, 1);
      }
      return a;
    };

    if (s.pat === "char-grid") {
      const cols = Math.max(1, Math.floor(w / s.space));
      const rows = Math.max(1, Math.floor(h / s.space));
      drawGridLinesChar(cols, rows);

      const chs = (s.chars || "01").split("");
      const spd = (s.charSpd ?? 2) * 0.9;

      for (let r = 0; r < rows; r++) {
        for (let c = 0; c < cols; c++) {
          const idx = r * cols + c;
          const x0 = c * s.space;
          const y0 = r * s.space;
          const cx = x0 + s.space / 2;
          const cy = y0 + s.space / 2;

          const rect = { x: x0, y: y0, w: s.space, h: s.space };

          const active = activeMap.get(idx);
          const other = otherMap.get(idx);

          // paint fills
          if (ghost.show && ghost.mode !== "activeOnly" && other?.paint?.color) {
            const oa = getAlphaForEntry(other) * clamp(ghost.opacity, 0, 1) * 0.92;
            if (oa > 0) drawCellFill(rect, other.paint.color, oa);
          }
          if (active?.paint?.color) {
            const aa = getAlphaForEntry(active) * 0.92;
            if (aa > 0) drawCellFill(rect, active.paint.color, aa);
          }

          const gi = chs.length ? Math.floor((t * spd + r * 0.07 + c * 0.05) * 3) % chs.length : 0;

          ctx.save();
          ctx.font = `${s.charSz}px ${getFontFamily()}`;
          ctx.fillStyle = s.dark ? "#EDEDED" : "#111111";
          ctx.globalAlpha = 0.95;
          ctx.fillText(chs[gi] ?? "0", cx, cy);
          ctx.restore();
        }
      }
      return;
    }

    if (s.pat === "swiss-grid") {
      const cols = Math.max(1, s.cols | 0);
      const rows = Math.max(1, s.rows | 0);
      drawGridLinesSwiss(cols, rows);

      const chs = (s.chars || "01").split("");
      const spd = (s.charSpd ?? 2) * 0.85;

      for (let r = 0; r < rows; r++) {
        for (let c = 0; c < cols; c++) {
          const idx = r * cols + c;
          const g = swissCellGeom(r, c, w, h);

          const active = activeMap.get(idx);
          const other = otherMap.get(idx);

          if (ghost.show && ghost.mode !== "activeOnly" && other?.paint?.color) {
            const oa = getAlphaForEntry(other) * clamp(ghost.opacity, 0, 1) * 0.92;
            if (oa > 0) drawCellFill(g, other.paint.color, oa);
          }
          if (active?.paint?.color) {
            const aa = getAlphaForEntry(active) * 0.92;
            if (aa > 0) drawCellFill(g, active.paint.color, aa);
          }

          const gi = chs.length ? Math.floor((t * spd + r * 0.09 + c * 0.05) * 3) % chs.length : 0;
          const sz = Math.max(8, Math.min(g.w, g.h) * 0.55 * (s.swissCharScale ?? 1));

          ctx.save();
          ctx.font = `${Math.floor(sz)}px ${getFontFamily()}`;
          ctx.fillStyle = s.dark ? "#EDEDED" : "#111111";
          ctx.globalAlpha = 0.95;
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
  }, [s, cellsA, cellsB, layer, ghost, colEdges, rowEdges, theme]);

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
  const activeLabel = layer === "perc" ? "Percussion" : "Melody";
  const otherLabel = layer === "perc" ? "Melody" : "Percussion";

  const pill = (on) =>
    `px-3 py-2 rounded-lg border text-xs font-semibold min-h-[44px] ${
      on ? theme.btnPrimary + " border-transparent" : theme.btnGhost + " border"
    }`;

  return (
    <div className={`w-full h-[100svh] ${theme.appBg} ${theme.text} flex flex-col md:flex-row overflow-hidden`}>
      {panelOpen && <div className={`fixed inset-0 ${theme.overlay} z-30 md:hidden`} onClick={() => setPanelOpen(false)} />}

      {/* Controls */}
      <div
        className={
          `fixed md:static z-40 md:z-auto inset-y-0 left-0 w-80 max-w-[90vw] ${theme.panelBg} border-r ${theme.panelBorder} p-4 md:p-5 overflow-y-auto space-y-4 text-sm transform transition-transform duration-200 md:transform-none ` +
          (panelOpen ? "translate-x-0" : "-translate-x-full md:translate-x-0")
        }
      >
        {/* top row */}
        <div className="flex gap-2">
          <button
            onClick={gen}
            className={`flex-1 flex justify-center items-center px-4 py-2.5 rounded-lg font-medium min-h-[44px] ${theme.btnPrimary}`}
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
            className={`flex-1 flex justify-center items-center px-4 py-2.5 rounded-lg font-medium min-h-[44px] ${theme.btnPrimary}`}
            title="Download PNG"
          >
            <Download size={16} />
          </button>
          <button
            onClick={() => setS((p) => ({ ...p, dark: !p.dark }))}
            className={`w-[44px] flex justify-center items-center px-3 py-2.5 rounded-lg font-medium min-h-[44px] ${theme.btnPrimary}`}
            title="Toggle dark mode"
          >
            {s.dark ? <Sun size={16} /> : <Moon size={16} />}
          </button>
        </div>

        <button onClick={unlockAudio} className={`w-full px-4 py-2.5 rounded-lg font-medium min-h-[44px] ${theme.btnSecondary}`}>
          Enable Audio (click once)
        </button>

        {/* Layer */}
        <div className="space-y-2">
          <label className="block text-xs font-semibold uppercase tracking-wider">Layer</label>
          <div className="grid grid-cols-2 gap-2">
            <button onClick={() => setLayer("melody")} className={pill(layer === "melody")}>
              Melody
            </button>
            <button onClick={() => setLayer("perc")} className={pill(layer === "perc")}>
              Percussion
            </button>
          </div>

          <div className="rounded-lg border p-3 space-y-2" style={{ borderColor: s.dark ? "#2a2a2a" : "#e5e5e5" }}>
            <div className="flex items-center justify-between">
              <div className={`text-xs font-semibold uppercase tracking-wider ${theme.subText}`}>Ghost overlay</div>
              <button
                onClick={() => setGhost((g) => ({ ...g, show: !g.show }))}
                className={`p-1.5 rounded ${ghost.show ? theme.btnPrimary : theme.btnMuted}`}
                title="Toggle ghost overlay"
              >
                {ghost.show ? <Play size={14} /> : <Square size={14} />}
              </button>
            </div>
            {ghost.show && (
              <>
                <div className="grid grid-cols-2 gap-2">
                  <button
                    onClick={() => setGhost((g) => ({ ...g, mode: "ghost" }))}
                    className={pill(ghost.mode === "ghost")}
                  >
                    Ghost {otherLabel}
                  </button>
                  <button
                    onClick={() => setGhost((g) => ({ ...g, mode: "both" }))}
                    className={pill(ghost.mode === "both")}
                  >
                    Both visible
                  </button>
                </div>
                <div className="space-y-1">
                  <div className={`text-xs ${theme.subText}`}>Opacity: {ghost.opacity.toFixed(2)}</div>
                  <input
                    type="range"
                    min="0.05"
                    max="0.6"
                    step="0.01"
                    value={ghost.opacity}
                    onChange={(e) => setGhost((g) => ({ ...g, opacity: parseFloat(e.target.value) }))}
                    className="w-full"
                  />
                </div>
              </>
            )}
            <div className={`text-[11px] ${theme.subText}`}>
              Active: <b>{activeLabel}</b>. Ghost shows the other layer while you paint.
            </div>
          </div>
        </div>

        {/* Pattern */}
        <div className="space-y-2">
          <label className="block text-xs font-semibold uppercase tracking-wider">Pattern</label>
          <select
            value={s.pat}
            onChange={(e) => setS((p) => ({ ...p, pat: e.target.value }))}
            className={`w-full px-3 py-2 rounded-lg border ${theme.selectBg}`}
          >
            <option value="swiss-grid">Swiss Grid</option>
            <option value="char-grid">Character Grid</option>
          </select>
        </div>

        {/* Paint */}
        <div className="space-y-2">
          <label className="block text-xs font-semibold uppercase tracking-wider">Paint ({activeLabel})</label>

          <div className="flex items-center justify-between gap-2">
            <input
              type="color"
              value={paint.color}
              onChange={(e) => setPaint((p) => ({ ...p, color: e.target.value, useSeq: false }))}
              className={`h-10 w-14 rounded-md border ${s.dark ? "border-neutral-700 bg-neutral-900" : "border-neutral-300 bg-white"}`}
              title="Pick color"
            />

            <button
              onClick={() => setPaint((p) => ({ ...p, useSeq: !p.useSeq, mode: "color" }))}
              className={`flex-1 px-3 py-2 rounded-lg border text-xs font-semibold flex items-center justify-center gap-2 min-h-[44px] ${
                paint.useSeq ? theme.btnPrimary : theme.btnGhost
              }`}
            >
              <Palette size={14} />
              {paint.useSeq ? "Color String ON" : "Color String OFF"}
            </button>

            <button
              onClick={() => setPaint((p) => ({ ...p, mode: p.mode === "none" ? "color" : "none" }))}
              className={`px-3 py-2 rounded-lg text-xs font-semibold min-h-[44px] ${
                paint.mode === "none" ? theme.btnPrimary : theme.btnMuted
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
                className={`h-9 w-full rounded-md border ${s.dark ? "border-neutral-700 bg-neutral-900" : "border-neutral-300 bg-white"}`}
                title={`Color String ${i + 1}`}
              />
            ))}
          </div>

          <div className="grid grid-cols-2 gap-2">
            <div className="space-y-1">
              <div className={`text-xs ${theme.subText}`}>Color motion</div>
              <select
                value={s.colorSeqBehave}
                onChange={(e) => setS((p) => ({ ...p, colorSeqBehave: e.target.value }))}
                className={`w-full px-2 py-2 rounded-lg border text-xs ${theme.selectBg}`}
              >
                <option value="same">Same (musical)</option>
                <option value="cycle">Cycle</option>
                <option value="wave">Wave</option>
                <option value="random">Random</option>
              </select>
            </div>
            <div className="space-y-1">
              <div className={`text-xs ${theme.subText}`}>Speed</div>
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

          <button onClick={clearPaint} className={`w-full px-4 py-2.5 rounded-lg font-medium min-h-[44px] ${theme.btnSecondary}`}>
            Clear {activeLabel} Cells
          </button>
        </div>

        {/* Grid controls (UNCHANGED: swiss-only density controls) */}
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
                className={`p-1.5 rounded ${s.gridLines ? theme.btnPrimary : theme.btnMuted}`}
              >
                {s.gridLines ? <Play size={14} /> : <Square size={14} />}
              </button>
            </div>

            <label className="block text-xs font-semibold uppercase tracking-wider">Variable Grid Density</label>

            <div className="rounded-lg border p-3 space-y-2" style={{ borderColor: s.dark ? "#2a2a2a" : "#e5e5e5" }}>
              <div className="flex items-center justify-between">
                <div className={`text-xs font-semibold uppercase tracking-wider ${theme.subText}`}>Columns (rhythm)</div>
                <button
                  onClick={() => setS((p) => ({ ...p, varColsOn: !p.varColsOn }))}
                  className={`p-1.5 rounded ${s.varColsOn ? theme.btnPrimary : theme.btnMuted}`}
                >
                  {s.varColsOn ? <Play size={14} /> : <Square size={14} />}
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
                  <div className={`text-[11px] ${theme.subText}`}>
                    Columns affect <b>step speed</b> (narrow = faster, wide = slower).
                  </div>
                </>
              )}
            </div>

            <div className="rounded-lg border p-3 space-y-2" style={{ borderColor: s.dark ? "#2a2a2a" : "#e5e5e5" }}>
              <div className="flex items-center justify-between">
                <div className={`text-xs font-semibold uppercase tracking-wider ${theme.subText}`}>Rows (tails)</div>
                <button
                  onClick={() => setS((p) => ({ ...p, varRowsOn: !p.varRowsOn }))}
                  className={`p-1.5 rounded ${s.varRowsOn ? theme.btnPrimary : theme.btnMuted}`}
                >
                  {s.varRowsOn ? <Play size={14} /> : <Square size={14} />}
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
                  <div className={`text-[11px] ${theme.subText}`}>
                    Rows affect <b>melody envelope</b> and <b>tails</b> (and row-height changes it more).
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
              className={`w-full px-3 py-2 rounded-lg border font-mono ${theme.selectBg}`}
            />
            <div className="flex items-center justify-between">
              <label className="text-xs font-semibold uppercase tracking-wider">Grid Lines</label>
              <button
                onClick={() => setS((p) => ({ ...p, gridLines: !p.gridLines }))}
                className={`p-1.5 rounded ${s.gridLines ? theme.btnPrimary : theme.btnMuted}`}
              >
                {s.gridLines ? <Play size={14} /> : <Square size={14} />}
              </button>
            </div>

            <div className={`text-[11px] ${theme.subText}`}>
              Columns/rows density controls are intentionally <b>Swiss-grid only</b> (kept exactly like your original).
            </div>
          </div>
        )}

        {/* Melody Sound (original) */}
        <div className="space-y-2">
          <div className="flex items-center justify-between">
            <label className="text-xs font-semibold uppercase tracking-wider">Melody</label>
            <button
              onClick={() => setS((p) => ({ ...p, soundOn: !p.soundOn }))}
              className={`p-1.5 rounded ${s.soundOn ? theme.btnPrimary : theme.btnMuted}`}
              title="Melody on/off"
            >
              {s.soundOn ? <Play size={14} /> : <Square size={14} />}
            </button>
          </div>

          <label className="block text-xs font-semibold uppercase tracking-wider">BPM: {s.bpm}</label>
          <input type="range" min="40" max="220" value={s.bpm} onChange={(e) => setS((p) => ({ ...p, bpm: parseInt(e.target.value, 10) }))} className="w-full" />

          <label className="block text-xs font-semibold uppercase tracking-wider">Max notes / step: {s.maxNotesPerStep}</label>
          <input type="range" min="1" max="24" value={s.maxNotesPerStep} onChange={(e) => setS((p) => ({ ...p, maxNotesPerStep: parseInt(e.target.value, 10) }))} className="w-full" />

          <div className="grid grid-cols-2 gap-2">
            <div className="space-y-1">
              <div className={`text-xs ${theme.subText}`}>Key</div>
              <select value={s.keyRoot} onChange={(e) => setS((p) => ({ ...p, keyRoot: parseInt(e.target.value, 10) }))} className={`w-full px-2 py-2 rounded-lg border text-xs ${theme.selectBg}`}>
                {NOTE_NAMES.map((n, i) => (
                  <option key={n} value={i}>
                    {n}
                  </option>
                ))}
              </select>
            </div>
            <div className="space-y-1">
              <div className={`text-xs ${theme.subText}`}>Scale</div>
              <select value={s.scaleName} onChange={(e) => setS((p) => ({ ...p, scaleName: e.target.value }))} className={`w-full px-2 py-2 rounded-lg border text-xs ${theme.selectBg}`}>
                {Object.keys(SCALES).map((name) => (
                  <option key={name} value={name}>
                    {name}
                  </option>
                ))}
              </select>
            </div>
          </div>

          <div className={`text-[11px] ${theme.subText}`}>
            <b>Always in tune:</b> everything quantizes to {keyName} {s.scaleName}.<br />
            Top rows are higher, bottom rows are lower (both melody + percussion).
          </div>

          <label className="block text-xs font-semibold uppercase tracking-wider">Voices: {s.voices}</label>
          <input type="range" min="1" max="24" value={s.voices} onChange={(e) => setS((p) => ({ ...p, voices: parseInt(e.target.value, 10) }))} className="w-full" />

          <label className="block text-xs font-semibold uppercase tracking-wider">Master: {s.master.toFixed(2)}</label>
          <input type="range" min="0" max="1.2" step="0.01" value={s.master} onChange={(e) => setS((p) => ({ ...p, master: parseFloat(e.target.value) }))} className="w-full" />
        </div>

        {/* Percussion (new controls) */}
        <div className="space-y-2">
          <div className="flex items-center justify-between">
            <label className="text-xs font-semibold uppercase tracking-wider">Percussion</label>
            <button
              onClick={() => setS((p) => ({ ...p, percOn: !p.percOn }))}
              className={`p-1.5 rounded ${s.percOn ? theme.btnPrimary : theme.btnMuted}`}
              title="Percussion on/off"
            >
              {s.percOn ? <Play size={14} /> : <Square size={14} />}
            </button>
          </div>

          <label className="block text-xs font-semibold uppercase tracking-wider">Perc Volume: {s.percMaster.toFixed(2)}</label>
          <input type="range" min="0" max="1.2" step="0.01" value={s.percMaster} onChange={(e) => setS((p) => ({ ...p, percMaster: parseFloat(e.target.value) }))} className="w-full" />

          <label className="block text-xs font-semibold uppercase tracking-wider">Max hits / step: {s.percMaxHitsPerStep}</label>
          <input type="range" min="1" max="24" value={s.percMaxHitsPerStep} onChange={(e) => setS((p) => ({ ...p, percMaxHitsPerStep: parseInt(e.target.value, 10) }))} className="w-full" />

          <label className="block text-xs font-semibold uppercase tracking-wider">Tune Base (MIDI): {s.percTuneBaseMidi}</label>
          <input type="range" min="12" max="72" value={s.percTuneBaseMidi} onChange={(e) => setS((p) => ({ ...p, percTuneBaseMidi: parseInt(e.target.value, 10) }))} className="w-full" />

          <label className="block text-xs font-semibold uppercase tracking-wider">Tune Span (oct): {s.percTuneSpanOct.toFixed(2)}</label>
          <input type="range" min="0.5" max="6" step="0.05" value={s.percTuneSpanOct} onChange={(e) => setS((p) => ({ ...p, percTuneSpanOct: parseFloat(e.target.value) }))} className="w-full" />

          <div className="grid grid-cols-2 gap-2">
            <div className="space-y-1">
              <div className={`text-xs ${theme.subText}`}>Q (ring)</div>
              <input type="range" min="1" max="30" step="0.5" value={s.percQ} onChange={(e) => setS((p) => ({ ...p, percQ: parseFloat(e.target.value) }))} className="w-full" />
            </div>
            <div className="space-y-1">
              <div className={`text-xs ${theme.subText}`}>Tone</div>
              <input type="range" min="0.6" max="1.8" step="0.01" value={s.percTone} onChange={(e) => setS((p) => ({ ...p, percTone: parseFloat(e.target.value) }))} className="w-full" />
            </div>
          </div>

          <div className="grid grid-cols-2 gap-2">
            <div className="space-y-1">
              <div className={`text-xs ${theme.subText}`}>Decay base</div>
              <input type="range" min="0.03" max="0.6" step="0.01" value={s.percDecayBase} onChange={(e) => setS((p) => ({ ...p, percDecayBase: parseFloat(e.target.value) }))} className="w-full" />
            </div>
            <div className="space-y-1">
              <div className={`text-xs ${theme.subText}`}>Decay span</div>
              <input type="range" min="0.1" max="2.5" step="0.01" value={s.percDecaySpan} onChange={(e) => setS((p) => ({ ...p, percDecaySpan: parseFloat(e.target.value) }))} className="w-full" />
            </div>
          </div>

          <div className="grid grid-cols-2 gap-2">
            <div className="space-y-1">
              <div className={`text-xs ${theme.subText}`}>Noise</div>
              <input type="range" min="0" max="1" step="0.01" value={s.percNoise} onChange={(e) => setS((p) => ({ ...p, percNoise: parseFloat(e.target.value) }))} className="w-full" />
            </div>
            <div className="space-y-1">
              <div className={`text-xs ${theme.subText}`}>Body</div>
              <input type="range" min="0" max="1" step="0.01" value={s.percBody} onChange={(e) => setS((p) => ({ ...p, percBody: parseFloat(e.target.value) }))} className="w-full" />
            </div>
          </div>

          <label className="block text-xs font-semibold uppercase tracking-wider">Hit (transient): {s.percHit.toFixed(2)}</label>
          <input type="range" min="0" max="1" step="0.01" value={s.percHit} onChange={(e) => setS((p) => ({ ...p, percHit: parseFloat(e.target.value) }))} className="w-full" />
        </div>

        {/* MIDI */}
        <div className="space-y-2">
          <div className="flex items-center justify-between">
            <label className="text-xs font-semibold uppercase tracking-wider">MIDI</label>
            <button
              onClick={() => setS((p) => ({ ...p, midiOn: !p.midiOn }))}
              className={`p-1.5 rounded ${s.midiOn ? theme.btnPrimary : theme.btnMuted}`}
              title="MIDI on/off"
              disabled={!midiSupported}
            >
              {s.midiOn ? <Play size={14} /> : <Square size={14} />}
            </button>
          </div>

          {!midiSupported ? (
            <div className={`text-[11px] ${theme.subText}`}>This browser/device doesn’t support Web MIDI.</div>
          ) : (
            <>
              <div className="space-y-1">
                <div className={`text-xs ${theme.subText}`}>Input</div>
                <select
                  value={midiInputId}
                  onChange={(e) => setMidiInputId(e.target.value)}
                  className={`w-full px-2 py-2 rounded-lg border text-xs ${theme.selectBg}`}
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
                <button onClick={() => setS((p) => ({ ...p, midiDraw: !p.midiDraw }))} className={pill(s.midiDraw)}>
                  MIDI draws
                </button>
                <button onClick={() => setS((p) => ({ ...p, midiThru: !p.midiThru }))} className={pill(s.midiThru)}>
                  MIDI thru
                </button>
              </div>

              <div className="grid grid-cols-2 gap-2">
                <button onClick={() => setS((p) => ({ ...p, midiTarget: "melody" }))} className={pill(s.midiTarget === "melody")}>
                  Target: Melody
                </button>
                <button onClick={() => setS((p) => ({ ...p, midiTarget: "perc" }))} className={pill(s.midiTarget === "perc")}>
                  Target: Perc
                </button>
              </div>

              <div className="space-y-1">
                <div className={`text-xs ${theme.subText}`}>Channel</div>
                <select
                  value={s.midiChannel}
                  onChange={(e) => setS((p) => ({ ...p, midiChannel: parseInt(e.target.value, 10) }))}
                  className={`w-full px-2 py-2 rounded-lg border text-xs ${theme.selectBg}`}
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
                  <div className={`text-xs ${theme.subText}`}>Note low</div>
                  <input
                    type="number"
                    min="0"
                    max="127"
                    value={s.midiLo}
                    onChange={(e) => setS((p) => ({ ...p, midiLo: parseInt(e.target.value || "0", 10) }))}
                    className={`w-full px-2 py-2 rounded-lg border text-xs ${theme.selectBg}`}
                  />
                </div>
                <div className="space-y-1">
                  <div className={`text-xs ${theme.subText}`}>Note high</div>
                  <input
                    type="number"
                    min="0"
                    max="127"
                    value={s.midiHi}
                    onChange={(e) => setS((p) => ({ ...p, midiHi: parseInt(e.target.value || "127", 10) }))}
                    className={`w-full px-2 py-2 rounded-lg border text-xs ${theme.selectBg}`}
                  />
                </div>
              </div>

              <div className={`text-[11px] ${theme.subText}`}>
                MIDI paints the <b>Target</b> layer: velocity → color intensity, duration → how long it stays.
              </div>
            </>
          )}
        </div>

        {/* FX (original) */}
        <div className="space-y-2">
          <label className="block text-xs font-semibold uppercase tracking-wider">FX</label>

          <div className="rounded-lg border p-3 space-y-2" style={{ borderColor: s.dark ? "#2a2a2a" : "#e5e5e5" }}>
            <div className="flex items-center justify-between">
              <div className={`text-xs font-semibold uppercase tracking-wider ${theme.subText}`}>Reverb</div>
              <button onClick={() => setS((p) => ({ ...p, reverbOn: !p.reverbOn }))} className={`p-1.5 rounded ${s.reverbOn ? theme.btnPrimary : theme.btnMuted}`}>
                {s.reverbOn ? <Play size={14} /> : <Square size={14} />}
              </button>
            </div>
            <label className="block text-xs font-semibold uppercase tracking-wider">Mix: {s.reverbMix.toFixed(2)}</label>
            <input type="range" min="0" max="0.8" step="0.01" value={s.reverbMix} onChange={(e) => setS((p) => ({ ...p, reverbMix: parseFloat(e.target.value) }))} className="w-full" />
            <label className="block text-xs font-semibold uppercase tracking-wider">Time: {s.reverbTime.toFixed(1)}s</label>
            <input type="range" min="0.5" max="6" step="0.1" value={s.reverbTime} onChange={(e) => setS((p) => ({ ...p, reverbTime: parseFloat(e.target.value) }))} className="w-full" />
          </div>

          <div className="rounded-lg border p-3 space-y-2" style={{ borderColor: s.dark ? "#2a2a2a" : "#e5e5e5" }}>
            <div className="flex items-center justify-between">
              <div className={`text-xs font-semibold uppercase tracking-wider ${theme.subText}`}>Delay</div>
              <button onClick={() => setS((p) => ({ ...p, delayOn: !p.delayOn }))} className={`p-1.5 rounded ${s.delayOn ? theme.btnPrimary : theme.btnMuted}`}>
                {s.delayOn ? <Play size={14} /> : <Square size={14} />}
              </button>
            </div>

            <label className="block text-xs font-semibold uppercase tracking-wider">Mix: {s.delayMix.toFixed(2)}</label>
            <input type="range" min="0" max="0.8" step="0.01" value={s.delayMix} onChange={(e) => setS((p) => ({ ...p, delayMix: parseFloat(e.target.value) }))} className="w-full" />

            <label className="block text-xs font-semibold uppercase tracking-wider">Time: {s.delayTime.toFixed(2)}s</label>
            <input type="range" min="0.05" max="0.9" step="0.01" value={s.delayTime} onChange={(e) => setS((p) => ({ ...p, delayTime: parseFloat(e.target.value) }))} className="w-full" />

            <label className="block text-xs font-semibold uppercase tracking-wider">Feedback: {s.delayFeedback.toFixed(2)}</label>
            <input type="range" min="0" max="0.85" step="0.01" value={s.delayFeedback} onChange={(e) => setS((p) => ({ ...p, delayFeedback: parseFloat(e.target.value) }))} className="w-full" />
          </div>

          <div className="rounded-lg border p-3 space-y-2" style={{ borderColor: s.dark ? "#2a2a2a" : "#e5e5e5" }}>
            <div className="flex items-center justify-between">
              <div className={`text-xs font-semibold uppercase tracking-wider ${theme.subText}`}>Drive</div>
              <button onClick={() => setS((p) => ({ ...p, driveOn: !p.driveOn }))} className={`p-1.5 rounded ${s.driveOn ? theme.btnPrimary : theme.btnMuted}`}>
                {s.driveOn ? <Play size={14} /> : <Square size={14} />}
              </button>
            </div>
            <label className="block text-xs font-semibold uppercase tracking-wider">Amount: {s.drive.toFixed(2)}</label>
            <input type="range" min="0" max="1" step="0.01" value={s.drive} onChange={(e) => setS((p) => ({ ...p, drive: parseFloat(e.target.value) }))} className="w-full" />
          </div>
        </div>

        <div className={`text-[11px] ${theme.subText}`}>
          If you hear nothing: press <b>Enable Audio</b> once (browser rule).
        </div>
      </div>

      {/* Canvas */}
      <div className={`flex-1 min-h-0 p-2 md:p-8 ${theme.canvasWrap} relative overflow-hidden`}>
        <button
          onClick={() => setPanelOpen((v) => !v)}
          className={`md:hidden absolute top-3 left-3 z-20 px-3 py-2 rounded-lg text-xs font-semibold shadow ${theme.btnPrimary}`}
        >
          {panelOpen ? "Hide controls" : "Show controls"}
        </button>

        <canvas
          ref={canvasRef}
          className={`w-full h-full rounded-lg shadow-sm touch-none select-none ${s.dark ? "shadow-none" : ""}`}
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
