// App.jsx
import React from "react";
import {
  RotateCcw,
  Download,
  Play,
  Square,
  Palette,
  Layers,
  Moon,
  Sun,
  Volume2,
  AlertTriangle,
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
   FX + audio helpers
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
function makeDriveCurve(amount01) {
  const n = 2048;
  const curve = new Float32Array(n);
  // gentler than before (reduces constant “overdriven” feel)
  const k = clamp(amount01 ?? 0.35, 0, 1) * 24;
  for (let i = 0; i < n; i++) {
    const x = (i * 2) / (n - 1) - 1;
    curve[i] = Math.tanh(x * (1 + k));
  }
  return curve;
}

/* =======================
   Melodic voice (dual osc + macro controls)
   - still always in key; color => lane/timbre
======================= */
function makeMelodyVoice(ac) {
  const oscA = ac.createOscillator();
  const oscB = ac.createOscillator();
  const mixA = ac.createGain();
  const mixB = ac.createGain();
  const filter = ac.createBiquadFilter();
  const gain = ac.createGain();

  oscA.type = "sawtooth";
  oscB.type = "triangle";

  mixA.gain.value = 0.7;
  mixB.gain.value = 0.3;

  filter.type = "lowpass";
  filter.Q.value = 0.65;

  // keep idle basically silent (prevents faint hum through drive)
  gain.gain.value = 1e-6;

  oscA.connect(mixA);
  oscB.connect(mixB);
  mixA.connect(filter);
  mixB.connect(filter);
  filter.connect(gain);

  oscA.start();
  oscB.start();

  return { oscA, oscB, mixA, mixB, filter, gain };
}
function triggerMelodyVoice(ac, v, p) {
  const now = ac.currentTime;
  const freq = clamp(p.freq, 20, 20000);
  const vel = clamp(p.vel, 0.0001, 1);

  const timbre = clamp(p.timbre ?? 0.35, 0, 1); // 0=saw,1=tri
  v.mixA.gain.setTargetAtTime(clamp(1 - timbre, 0, 1), now, 0.01);
  v.mixB.gain.setTargetAtTime(clamp(timbre, 0, 1), now, 0.01);

  const det = clamp(p.detuneCents ?? 0, -25, 25);
  v.oscA.detune.setValueAtTime(-det, now);
  v.oscB.detune.setValueAtTime(det, now);

  v.oscA.frequency.setValueAtTime(freq, now);
  v.oscB.frequency.setValueAtTime(freq, now);

  v.filter.Q.setTargetAtTime(clamp(p.reso ?? 0.65, 0.1, 12), now, 0.02);
  v.filter.frequency.cancelScheduledValues(now);
  v.filter.frequency.setValueAtTime(clamp(p.cutoffHz, 80, 16000), now);

  const attack = clamp(p.attack, 0.001, 0.2);
  const decay = clamp(p.decaySec, 0.02, 2.5);
  const release = clamp(p.release, 0.02, 3.0);

  const g = v.gain.gain;
  g.cancelScheduledValues(now);
  g.setValueAtTime(1e-6, now);
  g.exponentialRampToValueAtTime(Math.max(1e-5, vel), now + attack);
  g.exponentialRampToValueAtTime(1e-6, now + attack + decay + release);
}

/* =======================
   Percussion (tuned “physical-ish”)
   - transient: noise burst
   - body: sine (tuned to scale)
   - resonant bandpass to make “taiko / mallet-ish”
======================= */
function triggerPerc(ac, node, opts) {
  const now = ac.currentTime;

  const vel = clamp(opts.vel ?? 0.6, 0.01, 1);
  const freq = clamp(opts.freq ?? 110, 20, 8000);
  const decay = clamp(opts.decay ?? 0.35, 0.03, 3.0);
  const tone = clamp(opts.tone ?? 0.55, 0, 1);
  const noiseMix = clamp(opts.noiseMix ?? 0.45, 0, 1);
  const bodyMix = clamp(opts.bodyMix ?? 0.65, 0, 1);

  // noise burst (one-shot buffer)
  const dur = clamp(0.08 + decay * 0.25, 0.04, 0.7);
  const len = Math.floor(ac.sampleRate * dur);
  const buf = ac.createBuffer(1, Math.max(1, len), ac.sampleRate);
  const data = buf.getChannelData(0);
  for (let i = 0; i < len; i++) {
    const t = i / len;
    // slightly filtered noise (more “skin”)
    data[i] = (Math.random() * 2 - 1) * Math.pow(1 - t, 2.6);
  }
  const noise = ac.createBufferSource();
  noise.buffer = buf;

  const nGain = ac.createGain();
  nGain.gain.setValueAtTime(1e-6, now);
  nGain.gain.exponentialRampToValueAtTime(Math.max(1e-5, vel * noiseMix), now + 0.002);
  nGain.gain.exponentialRampToValueAtTime(1e-6, now + Math.max(0.02, decay * 0.45));

  const bp = ac.createBiquadFilter();
  bp.type = "bandpass";
  // tone pushes frequency / Q
  const bpFreq = freq * clamp(0.8 + tone * 1.2, 0.4, 2.6);
  bp.frequency.setValueAtTime(clamp(bpFreq, 40, 12000), now);
  bp.Q.setValueAtTime(clamp(2.2 + tone * 10.0, 1.2, 18), now);

  // body oscillator
  const osc = ac.createOscillator();
  osc.type = "sine";
  osc.frequency.setValueAtTime(freq, now);

  const oGain = ac.createGain();
  oGain.gain.setValueAtTime(1e-6, now);
  oGain.gain.exponentialRampToValueAtTime(Math.max(1e-5, vel * bodyMix), now + 0.002);
  oGain.gain.exponentialRampToValueAtTime(1e-6, now + decay);

  // slight pitch drop for drum feel
  osc.frequency.exponentialRampToValueAtTime(freq * 0.92, now + Math.min(0.12, decay * 0.35));

  noise.connect(bp);
  bp.connect(nGain);
  nGain.connect(node);

  osc.connect(oGain);
  oGain.connect(node);

  noise.start(now);
  noise.stop(now + dur);

  osc.start(now);
  osc.stop(now + decay + 0.05);
}

/* =======================
   Main App
======================= */
export default function App() {
  const canvasRef = React.useRef(null);
  const rafRef = React.useRef(null);

  // Two layers of cells
  const [melCells, setMelCells] = React.useState([]);
  const [percCells, setPercCells] = React.useState([]);
  const melRef = React.useRef([]);
  const percRef = React.useRef([]);
  React.useEffect(() => void (melRef.current = melCells), [melCells]);
  React.useEffect(() => void (percRef.current = percCells), [percCells]);

  const [panelOpen, setPanelOpen] = React.useState(false);

  // painting
  const [paint, setPaint] = React.useState({
    mode: "color",
    color: "#111111",
    useSeq: true,
    layer: "melody", // melody | perc
  });
  const [drawing, setDrawing] = React.useState(false);

  const [s, setS] = React.useState({
    // visuals
    pat: "swiss-grid", // swiss-grid | char-grid
    darkMode: true,

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

    // variable density (AUDIO affects both modes; VISUAL edges only for swiss)
    varColsOn: false,
    colFocus: 0.5,
    colStrength: 6,
    colSigma: 0.18,

    varRowsOn: false,
    rowFocus: 0.5,
    rowStrength: 6,
    rowSigma: 0.18,

    // layer display
    viewLayer: "both", // melody | perc | both
    ghostOverlay: true, // when both shown: ghost the “other” layer

    // color string
    colorSeq: ["#111111", "#ff0055", "#00c2ff", "#00ff88", "#ffe600"],
    colorSeqSpeed: 1.0,
    colorSeqBehave: "same", // same | cycle | wave | random

    // ======= GLOBAL CLOCK =======
    bpm: 120,

    // ======= MELODY (always in key) =======
    melodyOn: true,
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

    // envelope bases
    atkBase: 0.008,
    atkSpan: 0.09,
    decBase: 0.08,
    decSpan: 0.65,
    relBase: 0.06,
    relSpan: 0.85,

    // “plaits-ish” macro controls
    timbreBase: 0.25, // osc blend base
    timbreSpan: 0.65, // hue/luma mod
    detune: 6, // cents max
    reso: 0.7,

    voices: 14,
    melodyVol: 0.9,

    // ======= PERC (tuned physical-ish) =======
    percOn: true,
    percMaxHitsPerStep: 6,
    percBaseMidi: 24, // tune down (C1 default)
    percOctaveSpan: 3,
    percDecayBase: 0.18,
    percDecaySpan: 0.85,
    percTone: 0.55,
    percNoiseMix: 0.45,
    percBodyMix: 0.65,
    percVelFrom: "luma", // luma | fixed
    percFixedVel: 0.65,
    percVol: 0.85,
    percDriveSend: 0.15, // 0..1 -> how much percussion goes into drive/fx

    // ======= MASTER + FX =======
    master: 0.9,
    reverbOn: true,
    reverbMix: 0.22,
    reverbTime: 2.2,

    delayOn: true,
    delayMix: 0.14,
    delayTime: 0.28,
    delayFeedback: 0.28, // keep safer (prevents runaway)
    driveOn: true,
    drive: 0.35,

    // ======= MIDI =======
    midiOn: true,
    midiDraw: true,
    midiThru: true,
    midiTargetLayer: "melody", // melody | perc
    midiChannel: -1,
    midiLo: 36,
    midiHi: 84,
    midiFadeMin: 0.25,
    midiFadeMax: 2.5,
  });

  const sRef = React.useRef(s);
  React.useEffect(() => void (sRef.current = s), [s]);

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

  // variable edges for swiss VISUAL
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

  // pointer to canvas coords
  const pointerToCanvas = (e) => {
    const cv = canvasRef.current;
    const r = cv.getBoundingClientRect();
    const x = (e.clientX - r.left) * (cv.width / r.width);
    const y = (e.clientY - r.top) * (cv.height / r.height);
    return { x, y };
  };

  // dims helper (for BOTH patterns)
  const getGridDims = React.useCallback(() => {
    const st = sRef.current;
    if (st.pat === "swiss-grid") return { cols: Math.max(1, st.cols | 0), rows: Math.max(1, st.rows | 0) };
    const cv = canvasRef.current;
    if (cv) {
      return {
        cols: Math.max(1, Math.floor(cv.width / st.space)),
        rows: Math.max(1, Math.floor(cv.height / st.space)),
      };
    }
    return { cols: 16, rows: 12 };
  }, []);

  // index lookup
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

  // upsert/remove helpers for a layer
  const upsert = React.useCallback((layer, idx, patch) => {
    const setter = layer === "perc" ? setPercCells : setMelCells;
    setter((prev) => {
      const ex = prev.findIndex((c) => c.idx === idx);
      const next = [...prev];
      if (ex >= 0) next[ex] = { ...next[ex], ...patch };
      else next.push({ idx, ...patch });
      return next;
    });
  }, []);
  const remove = React.useCallback((layer, idx) => {
    const setter = layer === "perc" ? setPercCells : setMelCells;
    setter((prev) => prev.filter((c) => c.idx !== idx));
  }, []);

  const applyPaintToIdx = (idx, r, c, t) => {
    if (idx == null) return;
    const layer = paint.layer === "perc" ? "perc" : "melody";

    if (paint.mode === "none") {
      remove(layer, idx);
      return;
    }

    if (paint.useSeq) {
      const len = palette.length;
      const ci = colorSeqIndex(t, r, c, len);
      upsert(layer, idx, { paint: { mode: "color", color: palette[ci] } });
    } else {
      upsert(layer, idx, { paint: { mode: "color", color: paint.color } });
    }
  };

  /* =======================
     AUDIO GRAPH (stable)
     - master
     - melodic & perc busses
     - drive -> (reverb/delay sends) -> output
     - DC blocker / highpass prevents “hum”
======================= */
  const audioRef = React.useRef({
    ac: null,
    // gains
    master: null,
    melodicBus: null,
    percBus: null,
    // processing
    drive: null,
    dcBlock: null,
    dry: null,
    wetRev: null,
    wetDel: null,
    convolver: null,
    delay: null,
    feedback: null,

    // melody voices
    voices: [],
    voicePtr: 0,

    running: false,
    step: 0,
    timer: null,
  });

  function ensureAudio() {
    const A = audioRef.current;
    if (!A.ac) {
      const ac = new (window.AudioContext || window.webkitAudioContext)();

      const melodicBus = ac.createGain();
      const percBus = ac.createGain();

      const drive = ac.createWaveShaper();
      drive.oversample = "2x";
      drive.curve = makeDriveCurve(sRef.current.drive);

      // DC blocker / rumble guard (kills “mystery hum” + low feedback)
      const dcBlock = ac.createBiquadFilter();
      dcBlock.type = "highpass";
      dcBlock.frequency.value = 20;
      dcBlock.Q.value = 0.7;

      const dry = ac.createGain();
      const wetRev = ac.createGain();
      const wetDel = ac.createGain();

      const convolver = ac.createConvolver();
      convolver.buffer = createReverbImpulse(ac, sRef.current.reverbTime, 2.0);

      const delay = ac.createDelay(2.0);
      const feedback = ac.createGain();
      feedback.gain.value = clamp(sRef.current.delayFeedback, 0, 0.92);
      delay.delayTime.value = clamp(sRef.current.delayTime, 0.01, 1.5);
      delay.connect(feedback);
      feedback.connect(delay);

      const master = ac.createGain();
      master.gain.value = clamp(sRef.current.master ?? 0.9, 0, 1.2);

      // routing
      melodicBus.connect(drive);

      // percussion optionally sends into drive; we do it by splitting:
      const percToDrive = ac.createGain();
      const percToDry = ac.createGain();
      percBus.connect(percToDrive);
      percBus.connect(percToDry);

      percToDrive.connect(drive);
      percToDry.connect(dry);

      drive.connect(dcBlock);
      dcBlock.connect(dry);
      dcBlock.connect(convolver);
      dcBlock.connect(delay);

      convolver.connect(wetRev);
      delay.connect(wetDel);

      dry.connect(master);
      wetRev.connect(master);
      wetDel.connect(master);

      master.connect(ac.destination);

      A.ac = ac;
      A.master = master;
      A.melodicBus = melodicBus;
      A.percBus = percBus;
      A._percToDrive = percToDrive;
      A._percToDry = percToDry;

      A.drive = drive;
      A.dcBlock = dcBlock;
      A.dry = dry;
      A.wetRev = wetRev;
      A.wetDel = wetDel;
      A.convolver = convolver;
      A.delay = delay;
      A.feedback = feedback;

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

  function ensureVoices() {
    const A = ensureAudio();
    const ac = A.ac;
    const want = clamp(sRef.current.voices ?? 14, 1, 32);
    if (A.voices.length !== want) {
      // drop old pool (GC handles)
      const pool = Array.from({ length: want }, () => {
        const v = makeMelodyVoice(ac);
        v.gain.connect(A.melodicBus);
        return v;
      });
      A.voices = pool;
      A.voicePtr = 0;
    }
  }

  function updateAudioParamsRealtime() {
    const A = audioRef.current;
    if (!A.ac) return;
    const st = sRef.current;

    // volumes
    A.master.gain.setTargetAtTime(clamp(st.master, 0, 1.2), A.ac.currentTime, 0.02);
    A.melodicBus.gain.setTargetAtTime(clamp(st.melodyVol ?? 0.9, 0, 1.5), A.ac.currentTime, 0.02);
    A.percBus.gain.setTargetAtTime(clamp(st.percVol ?? 0.85, 0, 1.5), A.ac.currentTime, 0.02);

    // perc send split
    const send = clamp(st.percDriveSend ?? 0.15, 0, 1);
    A._percToDrive.gain.setTargetAtTime(send, A.ac.currentTime, 0.02);
    A._percToDry.gain.setTargetAtTime(1 - send, A.ac.currentTime, 0.02);

    // drive curve
    if (st.driveOn) A.drive.curve = makeDriveCurve(st.drive ?? 0.35);
    else {
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

    // delay (safe feedback)
    A.wetDel.gain.setTargetAtTime(st.delayOn ? clamp(st.delayMix, 0, 1) : 0, A.ac.currentTime, 0.02);
    A.delay.delayTime.setTargetAtTime(clamp(st.delayTime, 0.01, 1.5), A.ac.currentTime, 0.02);
    A.feedback.gain.setTargetAtTime(clamp(st.delayFeedback, 0, 0.92), A.ac.currentTime, 0.02);
  }

  // Panic: hard kill feedback + mute quickly
  function panic() {
    const A = audioRef.current;
    if (!A.ac) return;
    const now = A.ac.currentTime;
    try {
      A.feedback.gain.cancelScheduledValues(now);
      A.feedback.gain.setTargetAtTime(0, now, 0.01);
      A.wetDel.gain.cancelScheduledValues(now);
      A.wetDel.gain.setTargetAtTime(0, now, 0.01);
      A.wetRev.gain.cancelScheduledValues(now);
      A.wetRev.gain.setTargetAtTime(0, now, 0.01);
      A.master.gain.cancelScheduledValues(now);
      A.master.gain.setTargetAtTime(0, now, 0.01);
      setTimeout(() => {
        // restore master to slider after a moment
        if (!audioRef.current.ac) return;
        const st = sRef.current;
        audioRef.current.master.gain.setTargetAtTime(clamp(st.master, 0, 1.2), audioRef.current.ac.currentTime, 0.04);
        audioRef.current.wetRev.gain.setTargetAtTime(st.reverbOn ? clamp(st.reverbMix, 0, 1) : 0, audioRef.current.ac.currentTime, 0.04);
        audioRef.current.wetDel.gain.setTargetAtTime(st.delayOn ? clamp(st.delayMix, 0, 1) : 0, audioRef.current.ac.currentTime, 0.04);
        audioRef.current.feedback.gain.setTargetAtTime(clamp(st.delayFeedback, 0, 0.92), audioRef.current.ac.currentTime, 0.06);
      }, 220);
    } catch {}
  }

  React.useEffect(() => {
    if (audioRef.current.ac) {
      ensureVoices();
      updateAudioParamsRealtime();
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [s]);

  /* =======================
     Scheduler
     - COLUMNS => rhythm (step time) in BOTH swiss + char
     - ROWS => tails/envelope in BOTH swiss + char
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

      // cleanup expired MIDI-painted cells occasionally (both layers)
      const nowS = performance.now() * 0.001;
      if ((audioRef.current.step % 8) === 0) {
        setMelCells((prev) => prev.filter((c) => (typeof c.expiresAt === "number" ? c.expiresAt > nowS : true)));
        setPercCells((prev) => prev.filter((c) => (typeof c.expiresAt === "number" ? c.expiresAt > nowS : true)));
      }

      const melNow = melRef.current;
      const percNow = percRef.current;

      const melMap = new Map();
      const percMap = new Map();
      for (const c of melNow) melMap.set(c.idx, c);
      for (const c of percNow) percMap.set(c.idx, c);

      const { cols, rows } = getGridDims();
      const isSwiss = st.pat === "swiss-grid";

      // AUDIO edges always computed (even for char grid)
      const ce = st.varColsOn
        ? buildVariableEdges(cols, st.colFocus, st.colStrength, st.colSigma)
        : Array.from({ length: cols + 1 }, (_, i) => i / cols);
      const re = st.varRowsOn
        ? buildVariableEdges(rows, st.rowFocus, st.rowStrength, st.rowSigma)
        : Array.from({ length: rows + 1 }, (_, i) => i / rows);

      const bpm = clamp(st.bpm ?? 120, 30, 260);
      const baseStepSec = 60 / bpm / 2; // 8th grid
      let stepSec = baseStepSec;

      if (st.varColsOn) {
        const curCol = audioRef.current.step % cols;
        const w = ce[curCol + 1] - ce[curCol];
        const avg = 1 / cols;
        const ratio = clamp(w / avg, 0.35, 2.4);
        stepSec = baseStepSec * ratio;
      }

      const col = audioRef.current.step % cols;

      // ===== Melody harmony =====
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
      const maxNotes = clamp(st.maxNotesPerStep ?? 10, 1, 32);

      const avgRowH = 1 / rows;

      // ===== Perc scale =====
      const percDegreesCount = 7 * clamp(st.percOctaveSpan ?? 3, 1, 6);
      const percScaleMidi = buildScaleMidi({
        rootPc: clamp(st.keyRoot ?? 0, 0, 11),
        scaleName: st.scaleName,
        baseMidi: clamp(st.percBaseMidi ?? 24, 0, 60),
        degreesCount: percDegreesCount,
      });
      const percMax = clamp(st.percMaxHitsPerStep ?? 6, 1, 24);

      // collect hits for this column
      const melHits = [];
      const percHits = [];

      for (let r = 0; r < rows; r++) {
        const idx = r * cols + col;

        // row geometry weight (tails) from variable rows
        const rh = re[r + 1] - re[r];
        const ratio = clamp(rh / avgRowH, 0.35, 2.4);

        const rowNorm = rows <= 1 ? 0.5 : 1 - r / (rows - 1); // top=1, bottom=0

        // ===== Melody cell =====
        if (st.melodyOn) {
          const cell = melMap.get(idx);
          const paintObj = cell?.paint;
          if (paintObj?.color) {
            if (typeof cell.expiresAt === "number" && cell.expiresAt <= nowS) {
              // ignore expired
            } else {
              const rgb = hexToRgb(paintObj.color);
              if (rgb) {
                const lum = luminance01(rgb);
                const h = hue01(rgb);

                let lane = 0;
                if (st.laneMode === "hue") lane = clamp(Math.floor(h * chordTones.length), 0, chordTones.length - 1);
                else lane = col % chordTones.length;

                // row -> degree
                const degFloat = rowNorm * (degreesCount - 1);
                const degIdx = clamp(Math.round(degFloat), 0, degreesCount - 1);

                const rowMidi = scaleMidi[degIdx];
                let target = chordTones[lane];
                while (target < rowMidi - 6) target += 12;
                while (target > rowMidi + 6) target -= 12;
                const freq = midiToFreq(target);

                const vel =
                  st.velFrom === "fixed" ? 0.55 : clamp(0.08 + 0.92 * lum, 0.05, 1);

                // cutoff
                const cutoff =
                  (st.cutoffBase ?? 400) + (st.cutoffSpan ?? 7200) * clamp(0.15 + 0.85 * lum, 0, 1);

                // envelope
                let attack = (st.atkBase ?? 0.008) + (st.atkSpan ?? 0.09) * clamp(1 - rowNorm, 0, 1);
                let decay = (st.decBase ?? 0.08) + (st.decSpan ?? 0.65) * clamp(lum, 0, 1);
                let release = (st.relBase ?? 0.06) + (st.relSpan ?? 0.85) * clamp(rowNorm, 0, 1);

                // variable rows exaggerate tails
                const tailMul = clamp(ratio, 0.55, 1.9);
                decay *= tailMul;
                release *= tailMul;
                attack *= clamp(1.25 - (tailMul - 1) * 0.4, 0.5, 1.4);

                // “plaits-ish” timbre mod: hue + lum
                const timbre = clamp(
                  (st.timbreBase ?? 0.25) + (st.timbreSpan ?? 0.65) * clamp(0.55 * h + 0.45 * lum, 0, 1),
                  0,
                  1
                );
                const detuneCents = clamp((st.detune ?? 6) * (h - 0.5) * 2, -25, 25);
                const reso = clamp(st.reso ?? 0.7, 0.1, 12);

                melHits.push({
                  freq,
                  vel,
                  cutoff,
                  attack: clamp(attack, 0.002, 0.2),
                  decay: clamp(decay, 0.03, 2.0),
                  release: clamp(release, 0.03, 2.8),
                  timbre,
                  detuneCents,
                  reso,
                  score: vel,
                });
              }
            }
          }
        }

        // ===== Perc cell =====
        if (st.percOn) {
          const cell = percMap.get(idx);
          const paintObj = cell?.paint;
          if (paintObj?.color) {
            if (typeof cell.expiresAt === "number" && cell.expiresAt <= nowS) {
              // ignore expired
            } else {
              const rgb = hexToRgb(paintObj.color);
              if (rgb) {
                const lum = luminance01(rgb);
                const h = hue01(rgb);

                const vel =
                  st.percVelFrom === "fixed"
                    ? clamp(st.percFixedVel ?? 0.65, 0.05, 1)
                    : clamp(0.12 + 0.88 * lum, 0.05, 1);

                // row -> tuned drum pitch (top higher, bottom lower)
                const degFloat = rowNorm * (percDegreesCount - 1);
                const degIdx = clamp(Math.round(degFloat), 0, percDegreesCount - 1);
                const midi = percScaleMidi[degIdx];

                // also hue nudges within an octave for variety but still in key
                const hueOct = Math.round((h - 0.5) * 2); // -1..1-ish
                const tunedMidi = clamp(midi + 12 * hueOct, 0, 127);
                const freq = midiToFreq(tunedMidi);

                const baseDecay = clamp(st.percDecayBase ?? 0.18, 0.03, 2.0);
                const decaySpan = clamp(st.percDecaySpan ?? 0.85, 0, 2.5);
                let decay = baseDecay + decaySpan * clamp(1 - rowNorm, 0, 1); // bottom longer
                // variable rows exaggerate decay
                decay *= clamp(ratio, 0.6, 1.8);
                decay = clamp(decay, 0.03, 3.0);

                const tone = clamp(st.percTone ?? 0.55, 0, 1);
                const noiseMix = clamp(st.percNoiseMix ?? 0.45, 0, 1);
                const bodyMix = clamp(st.percBodyMix ?? 0.65, 0, 1);

                // score: loudest hits win
                percHits.push({
                  freq,
                  vel,
                  decay,
                  tone,
                  noiseMix,
                  bodyMix,
                  score: vel,
                });
              }
            }
          }
        }
      }

      // Play melody
      if (st.melodyOn && melHits.length) {
        melHits.sort((a, b) => b.score - a.score);
        const chosen = melHits.slice(0, Math.min(maxNotes, melHits.length));
        const pool = audioRef.current.voices;
        for (const h of chosen) {
          const v = pool[audioRef.current.voicePtr % pool.length];
          audioRef.current.voicePtr++;
          triggerMelodyVoice(ac, v, {
            freq: h.freq,
            vel: h.vel,
            cutoffHz: h.cutoff,
            attack: h.attack,
            decaySec: h.decay,
            release: h.release,
            timbre: h.timbre,
            detuneCents: h.detuneCents,
            reso: h.reso,
          });
        }
      }

      // Play percussion
      if (st.percOn && percHits.length) {
        percHits.sort((a, b) => b.score - a.score);
        const chosen = percHits.slice(0, Math.min(percMax, percHits.length));
        const A2 = ensureAudio();
        for (const h of chosen) {
          triggerPerc(ac, A2.percBus, {
            freq: h.freq,
            vel: h.vel,
            decay: h.decay,
            tone: h.tone,
            noiseMix: h.noiseMix,
            bodyMix: h.bodyMix,
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
     - MIDI paints chosen layer
     - MIDI thru plays MELODY (instant)
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

  const midiNoteToCell = React.useCallback(
    (note) => {
      const st = sRef.current;
      const { cols, rows } = getGridDims();
      const lo = clamp(st.midiLo ?? 36, 0, 127);
      const hi = clamp(st.midiHi ?? 84, 0, 127);
      const span = Math.max(1, hi - lo);

      const t = clamp((note - lo) / span, 0, 1);
      const row = clamp(Math.round((1 - t) * (rows - 1)), 0, rows - 1);

      // spread across grid: column follows step, but also shifts by note (uses whole grid more)
      const col = ((audioRef.current.step || 0) + (note - lo)) % cols;
      const idx = row * cols + col;
      return { row, col, idx, cols, rows };
    },
    [getGridDims]
  );

  const paintFromMidiOn = React.useCallback(
    (note, vel, ch) => {
      const st = sRef.current;
      if (!st.midiOn || !st.midiDraw) return;

      const layer = st.midiTargetLayer === "perc" ? "perc" : "melody";
      const nowS = performance.now() * 0.001;
      const vel01 = clamp(vel / 127, 0, 1);

      const { row, col, idx } = midiNoteToCell(note);
      const color = midiToColor(note, vel01, 0);
      const expiresAt = nowS + clamp(st.midiFadeMin ?? 0.25, 0.05, 6);

      upsert(layer, idx, {
        paint: { mode: "color", color },
        midi: { note, vel: vel01, ch, t0: nowS, dur: 0 },
        expiresAt,
      });

      midiActiveRef.current.set(`${note}:${ch}:${layer}`, { t0: nowS, vel01, note, ch, idx, row, col, layer });
    },
    [midiNoteToCell, midiToColor, upsert]
  );

  const paintFromMidiOff = React.useCallback(
    (note, ch) => {
      const st = sRef.current;
      if (!st.midiOn || !st.midiDraw) return;

      // try both layers (in case target changed mid-note)
      const keys = [`${note}:${ch}:melody`, `${note}:${ch}:perc`];
      let entry = null;
      let kUsed = "";
      for (const k of keys) {
        const e = midiActiveRef.current.get(k);
        if (e) {
          entry = e;
          kUsed = k;
          break;
        }
      }
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

      upsert(entry.layer === "perc" ? "perc" : "melody", entry.idx, {
        paint: { mode: "color", color },
        midi: { note, vel: entry.vel01, ch, t0: entry.t0, dur },
        expiresAt,
      });

      midiActiveRef.current.delete(kUsed);
    },
    [midiToColor, upsert]
  );

  const midiThruPlay = React.useCallback((note, vel) => {
    const st = sRef.current;
    if (!st.midiOn || !st.midiThru) return;

    const A = ensureAudio();
    const ac = A.ac;
    if (!ac) return;
    if (ac.state === "suspended") return;

    ensureVoices();
    updateAudioParamsRealtime();

    const vel01 = clamp(vel / 127, 0.05, 1);
    const freq = midiToFreq(note);

    // quick responsive envelope
    const attack = 0.003 + (1 - vel01) * 0.015;
    const decay = 0.08 + vel01 * 0.25;
    const release = 0.12 + (1 - vel01) * 0.25;

    const cutoff = (st.cutoffBase ?? 400) + (st.cutoffSpan ?? 7200) * clamp(0.25 + vel01 * 0.75, 0, 1);

    // timbre for MIDI-thru uses velocity
    const timbre = clamp((st.timbreBase ?? 0.25) + (st.timbreSpan ?? 0.65) * vel01, 0, 1);

    const v = A.voices[A.voicePtr % A.voices.length];
    A.voicePtr++;
    triggerMelodyVoice(ac, v, {
      freq,
      vel: vel01,
      cutoffHz: cutoff,
      attack,
      decaySec: decay,
      release,
      timbre,
      detuneCents: 0,
      reso: clamp(st.reso ?? 0.7, 0.1, 12),
    });
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

    const { cols } = getGridDims();
    const col = idx % cols;
    const row = Math.floor(idx / cols);
    const t = performance.now() * 0.001;
    applyPaintToIdx(idx, row, col, t);
  };

  const onPointerMove = (e) => {
    if (!drawing) return;
    const cv = canvasRef.current;
    if (!cv) return;
    const { x, y } = pointerToCanvas(e);
    const idx = getIdx(x, y);
    if (idx == null) return;

    const { cols } = getGridDims();
    const col = idx % cols;
    const row = Math.floor(idx / cols);
    const t = performance.now() * 0.001;
    applyPaintToIdx(idx, row, col, t);
  };

  const onPointerUp = () => setDrawing(false);

  const gen = () => {
    setMelCells((p) => [...p]);
    setPercCells((p) => [...p]);
  };

  const clearLayer = (layer) => {
    if (layer === "perc") setPercCells([]);
    else setMelCells([]);
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

    const st = sRef.current;
    const dark = !!st.darkMode;

    // background
    ctx.clearRect(0, 0, w, h);
    ctx.fillStyle = dark ? "#0B0D10" : "#FAFAFA";
    ctx.fillRect(0, 0, w, h);

    const t = tm * 0.001;
    const nowS = performance.now() * 0.001;

    // choose visible layers
    const view = st.viewLayer;
    const showMel = view === "melody" || view === "both";
    const showPerc = view === "perc" || view === "both";

    // maps
    const melMap = new Map();
    const percMap = new Map();
    for (const c of melRef.current) melMap.set(c.idx, c);
    for (const c of percRef.current) percMap.set(c.idx, c);

    ctx.textAlign = "center";
    ctx.textBaseline = "middle";

    const { cols, rows } = getGridDims();

    const drawCellFill = (x, y, ww, hh, colHex, alpha) => {
      if (!colHex) return;
      ctx.save();
      ctx.globalAlpha = alpha;
      ctx.fillStyle = colHex;
      ctx.fillRect(x, y, ww, hh); // NO FRAMES, just fill
      ctx.restore();
    };

    const drawChar = (ch, x, y, sizePx, ink) => {
      ctx.save();
      ctx.font = `${Math.floor(sizePx)}px ${getFontFamily()}`;
      ctx.fillStyle = ink;
      ctx.fillText(ch, x, y);
      ctx.restore();
    };

    // grid lines
    const lineCol = dark ? "rgba(255,255,255,0.08)" : "rgba(0,0,0,0.08)";

    if (st.pat === "char-grid") {
      const space = st.space;
      const cols2 = Math.max(1, Math.floor(w / space));
      const rows2 = Math.max(1, Math.floor(h / space));

      if (st.gridLines) {
        ctx.save();
        ctx.strokeStyle = lineCol;
        ctx.lineWidth = 1;
        for (let c = 0; c <= cols2; c++) {
          const x = c * space;
          ctx.beginPath();
          ctx.moveTo(x, 0);
          ctx.lineTo(x, h);
          ctx.stroke();
        }
        for (let r = 0; r <= rows2; r++) {
          const y = r * space;
          ctx.beginPath();
          ctx.moveTo(0, y);
          ctx.lineTo(w, y);
          ctx.stroke();
        }
        ctx.restore();
      }

      const chs = (st.chars || "01").split("");
      const spd = (st.charSpd ?? 2) * 0.9;

      for (let r = 0; r < rows2; r++) {
        for (let c = 0; c < cols2; c++) {
          const idx = r * cols2 + c;
          const x0 = c * space;
          const y0 = r * space;
          const cx = x0 + space / 2;
          const cy = y0 + space / 2;

          // alpha from MIDI expiry
          const mel = melMap.get(idx);
          const per = percMap.get(idx);

          const melCol = mel?.paint?.color;
          const perCol = per?.paint?.color;

          const melAlive = mel && (mel.expiresAt == null || mel.expiresAt > nowS);
          const perAlive = per && (per.expiresAt == null || per.expiresAt > nowS);

          const melA =
            mel?.expiresAt != null ? clamp((mel.expiresAt - nowS) / 0.35, 0, 1) : 1;
          const perA =
            per?.expiresAt != null ? clamp((per.expiresAt - nowS) / 0.35, 0, 1) : 1;

          // fill order: melody then perc, or ghost
          if (showMel && melAlive && melCol) {
            drawCellFill(x0, y0, space, space, melCol, st.viewLayer === "both" && st.ghostOverlay ? 0.55 * melA : 0.92 * melA);
          }
          if (showPerc && perAlive && perCol) {
            drawCellFill(x0, y0, space, space, perCol, st.viewLayer === "both" && st.ghostOverlay ? 0.55 * perA : 0.92 * perA);
          }

          const gi = chs.length ? Math.floor((t * spd + r * 0.07 + c * 0.05) * 3) % chs.length : 0;
          const ink = dark ? "#EDEDED" : "#111111";
          const inkOn = dark ? "#0B0D10" : "#0A0A0A";
          const hasFill =
            (showMel && melAlive && melCol) || (showPerc && perAlive && perCol);

          drawChar(chs[gi] ?? "0", cx, cy, st.charSz, hasFill ? inkOn : ink);
        }
      }
      return;
    }

    // swiss-grid
    if (st.pat === "swiss-grid") {
      const ce = colEdgesSwiss || Array.from({ length: st.cols + 1 }, (_, i) => i / st.cols);
      const re = rowEdgesSwiss || Array.from({ length: st.rows + 1 }, (_, i) => i / st.rows);

      if (st.gridLines) {
        ctx.save();
        ctx.strokeStyle = lineCol;
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

      const chs = (st.chars || "01").split("");
      const spd = (st.charSpd ?? 2) * 0.85;

      for (let r = 0; r < st.rows; r++) {
        for (let c = 0; c < st.cols; c++) {
          const idx = r * st.cols + c;
          const g = swissCellGeom(r, c, w, h);

          const mel = melMap.get(idx);
          const per = percMap.get(idx);

          const melCol = mel?.paint?.color;
          const perCol = per?.paint?.color;

          const melAlive = mel && (mel.expiresAt == null || mel.expiresAt > nowS);
          const perAlive = per && (per.expiresAt == null || per.expiresAt > nowS);

          const melA =
            mel?.expiresAt != null ? clamp((mel.expiresAt - nowS) / 0.35, 0, 1) : 1;
          const perA =
            per?.expiresAt != null ? clamp((per.expiresAt - nowS) / 0.35, 0, 1) : 1;

          if (showMel && melAlive && melCol) {
            drawCellFill(g.x, g.y, g.w, g.h, melCol, st.viewLayer === "both" && st.ghostOverlay ? 0.55 * melA : 0.92 * melA);
          }
          if (showPerc && perAlive && perCol) {
            drawCellFill(g.x, g.y, g.w, g.h, perCol, st.viewLayer === "both" && st.ghostOverlay ? 0.55 * perA : 0.92 * perA);
          }

          const gi = chs.length ? Math.floor((t * spd + r * 0.09 + c * 0.05) * 3) % chs.length : 0;
          const sz = Math.max(8, Math.min(g.w, g.h) * 0.55 * (st.swissCharScale ?? 1));

          const ink = dark ? "#EDEDED" : "#111111";
          const inkOn = dark ? "#0B0D10" : "#0A0A0A";
          const hasFill =
            (showMel && melAlive && melCol) || (showPerc && perAlive && perCol);

          drawChar(chs[gi] ?? "0", g.cx, g.cy, sz, hasFill ? inkOn : ink);
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
  }, []);

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
  const dark = s.darkMode;
  const keyName = NOTE_NAMES[s.keyRoot] ?? "C";

  const panelBg = dark ? "bg-neutral-950 border-neutral-800 text-neutral-100" : "bg-neutral-50 border-neutral-200 text-neutral-900";
  const inputBg = dark ? "bg-neutral-900 border-neutral-700 text-neutral-100" : "bg-white border-neutral-300 text-neutral-900";
  const subtle = dark ? "text-neutral-400" : "text-neutral-600";
  const canvasWrap = dark ? "bg-neutral-950" : "bg-white";

  const Btn = ({ onClick, children, className = "", title, disabled }) => (
    <button
      onClick={onClick}
      title={title}
      disabled={disabled}
      className={
        "px-3 py-2 rounded-lg border text-xs font-semibold min-h-[44px] transition " +
        (dark
          ? "border-neutral-700 " + (disabled ? "opacity-50" : "hover:bg-neutral-900")
          : "border-neutral-300 " + (disabled ? "opacity-50" : "hover:bg-neutral-100")) +
        " " +
        className
      }
    >
      {children}
    </button>
  );

  return (
    <div className={"w-full h-[100svh] flex flex-col md:flex-row overflow-hidden " + (dark ? "bg-neutral-950" : "bg-white")}>
      {panelOpen && (
        <div className="fixed inset-0 bg-black/40 z-30 md:hidden" onClick={() => setPanelOpen(false)} />
      )}

      {/* Controls */}
      <div
        className={
          "fixed md:static z-40 md:z-auto inset-y-0 left-0 w-80 max-w-[90vw] border-r p-4 md:p-5 overflow-y-auto space-y-4 text-sm transform transition-transform duration-200 md:transform-none " +
          panelBg +
          " " +
          (panelOpen ? "translate-x-0" : "-translate-x-full md:translate-x-0")
        }
      >
        <div className="flex gap-2">
          <button
            onClick={gen}
            className={"flex-1 flex justify-center px-4 py-2.5 rounded-lg font-medium min-h-[44px] " + (dark ? "bg-white text-black hover:bg-neutral-200" : "bg-black text-white hover:bg-neutral-800")}
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
            className={"flex-1 flex justify-center px-4 py-2.5 rounded-lg font-medium min-h-[44px] " + (dark ? "bg-white text-black hover:bg-neutral-200" : "bg-black text-white hover:bg-neutral-800")}
            title="Download PNG"
          >
            <Download size={16} />
          </button>
        </div>

        <div className="grid grid-cols-2 gap-2">
          <button
            onClick={unlockAudio}
            className={"w-full px-4 py-2.5 rounded-lg font-medium min-h-[44px] " + (dark ? "bg-white text-black hover:bg-neutral-200" : "bg-neutral-900 text-white hover:bg-black")}
          >
            Enable Audio
          </button>

          <button
            onClick={panic}
            className={"w-full px-4 py-2.5 rounded-lg font-medium min-h-[44px] flex items-center justify-center gap-2 " + (dark ? "bg-amber-300 text-black hover:bg-amber-200" : "bg-amber-500 text-white hover:bg-amber-600")}
            title="Kills runaway delay/feedback and mutes briefly"
          >
            <AlertTriangle size={16} />
            Panic
          </button>
        </div>

        <div className="grid grid-cols-2 gap-2">
          <Btn
            onClick={() => setS((p) => ({ ...p, darkMode: !p.darkMode }))}
            className={dark ? "bg-white text-black border-white" : "bg-black text-white border-black"}
            title="Dark / light mode"
          >
            <span className="inline-flex items-center gap-2 justify-center">
              {dark ? <Moon size={14} /> : <Sun size={14} />}
              {dark ? "Dark" : "Light"}
            </span>
          </Btn>

          <Btn
            onClick={() => setPanelOpen(false)}
            className={dark ? "bg-neutral-900" : "bg-white"}
            title="Close panel (mobile)"
          >
            Close
          </Btn>
        </div>

        {/* Pattern */}
        <div className="space-y-2">
          <label className="block text-xs font-semibold uppercase tracking-wider">Pattern</label>
          <select
            value={s.pat}
            onChange={(e) => setS((p) => ({ ...p, pat: e.target.value }))}
            className={"w-full px-3 py-2 rounded-lg border " + inputBg}
          >
            <option value="swiss-grid">Swiss Grid</option>
            <option value="char-grid">Character Grid</option>
          </select>
        </div>

        {/* Layer display / paint */}
        <div className="space-y-2">
          <label className="block text-xs font-semibold uppercase tracking-wider">Layers</label>

          <div className="grid grid-cols-3 gap-2">
            <Btn
              onClick={() => setS((p) => ({ ...p, viewLayer: "melody" }))}
              className={s.viewLayer === "melody" ? (dark ? "bg-white text-black border-white" : "bg-black text-white border-black") : ""}
            >
              Melody
            </Btn>
            <Btn
              onClick={() => setS((p) => ({ ...p, viewLayer: "perc" }))}
              className={s.viewLayer === "perc" ? (dark ? "bg-white text-black border-white" : "bg-black text-white border-black") : ""}
            >
              Perc
            </Btn>
            <Btn
              onClick={() => setS((p) => ({ ...p, viewLayer: "both" }))}
              className={s.viewLayer === "both" ? (dark ? "bg-white text-black border-white" : "bg-black text-white border-black") : ""}
            >
              Both
            </Btn>
          </div>

          {s.viewLayer === "both" && (
            <Btn
              onClick={() => setS((p) => ({ ...p, ghostOverlay: !p.ghostOverlay }))}
              className={s.ghostOverlay ? (dark ? "bg-neutral-900" : "bg-white") : ""}
              title="Ghost overlay when both layers are shown"
            >
              <span className="inline-flex items-center gap-2 justify-center">
                <Layers size={14} />
                Ghost overlay: {s.ghostOverlay ? "ON" : "OFF"}
              </span>
            </Btn>
          )}

          <label className="block text-xs font-semibold uppercase tracking-wider">Paint target</label>
          <div className="grid grid-cols-2 gap-2">
            <Btn
              onClick={() => setPaint((p) => ({ ...p, layer: "melody" }))}
              className={paint.layer === "melody" ? (dark ? "bg-white text-black border-white" : "bg-black text-white border-black") : ""}
            >
              Paint Melody
            </Btn>
            <Btn
              onClick={() => setPaint((p) => ({ ...p, layer: "perc" }))}
              className={paint.layer === "perc" ? (dark ? "bg-white text-black border-white" : "bg-black text-white border-black") : ""}
            >
              Paint Perc
            </Btn>
          </div>
        </div>

        {/* Paint */}
        <div className="space-y-2">
          <label className="block text-xs font-semibold uppercase tracking-wider">Paint</label>

          <div className="flex items-center justify-between gap-2">
            <input
              type="color"
              value={paint.color}
              onChange={(e) => setPaint((p) => ({ ...p, color: e.target.value, useSeq: false }))}
              className={"h-10 w-14 rounded-md border " + (dark ? "border-neutral-700 bg-neutral-900" : "border-neutral-300 bg-white")}
              title="Pick color"
            />

            <button
              onClick={() => setPaint((p) => ({ ...p, useSeq: !p.useSeq, mode: "color" }))}
              className={
                "flex-1 px-3 py-2 rounded-lg border text-xs font-semibold flex items-center justify-center gap-2 min-h-[44px] " +
                (paint.useSeq
                  ? (dark ? "bg-white text-black border-white" : "bg-black text-white border-black")
                  : inputBg)
              }
            >
              <Palette size={14} />
              {paint.useSeq ? "Color String ON" : "Color String OFF"}
            </button>

            <button
              onClick={() => setPaint((p) => ({ ...p, mode: p.mode === "none" ? "color" : "none" }))}
              className={
                "px-3 py-2 rounded-lg text-xs font-semibold min-h-[44px] " +
                (paint.mode === "none"
                  ? (dark ? "bg-white text-black" : "bg-black text-white")
                  : dark
                  ? "bg-neutral-900 text-neutral-100"
                  : "bg-neutral-200 text-neutral-700")
              }
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
                className={"h-9 w-full rounded-md border " + (dark ? "border-neutral-700 bg-neutral-900" : "border-neutral-300 bg-white")}
                title={`Color String ${i + 1}`}
              />
            ))}
          </div>

          <div className="grid grid-cols-2 gap-2">
            <div className="space-y-1">
              <div className={"text-xs " + subtle}>Color motion</div>
              <select
                value={s.colorSeqBehave}
                onChange={(e) => setS((p) => ({ ...p, colorSeqBehave: e.target.value }))}
                className={"w-full px-2 py-2 rounded-lg border text-xs " + inputBg}
              >
                <option value="same">Same (musical)</option>
                <option value="cycle">Cycle</option>
                <option value="wave">Wave</option>
                <option value="random">Random</option>
              </select>
            </div>
            <div className="space-y-1">
              <div className={"text-xs " + subtle}>Speed</div>
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

          <div className="grid grid-cols-2 gap-2">
            <Btn onClick={() => clearLayer("melody")}>
              Clear Melody
            </Btn>
            <Btn onClick={() => clearLayer("perc")}>
              Clear Perc
            </Btn>
          </div>
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
                className={"p-1.5 rounded " + (s.gridLines ? (dark ? "bg-white text-black" : "bg-black text-white") : dark ? "bg-neutral-900" : "bg-neutral-200")}
              >
                {s.gridLines ? <Play size={14} fill={dark ? "black" : "white"} /> : <Square size={14} />}
              </button>
            </div>

            <label className="block text-xs font-semibold uppercase tracking-wider">Variable Grid Density</label>

            <div className={"rounded-lg border p-3 space-y-2 " + (dark ? "border-neutral-800 bg-neutral-900" : "border-neutral-200 bg-white")}>
              <div className="flex items-center justify-between">
                <div className="text-xs font-semibold uppercase tracking-wider">Columns (rhythm)</div>
                <button
                  onClick={() => setS((p) => ({ ...p, varColsOn: !p.varColsOn }))}
                  className={"p-1.5 rounded " + (s.varColsOn ? (dark ? "bg-white text-black" : "bg-black text-white") : dark ? "bg-neutral-800" : "bg-neutral-200")}
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
                  <div className={"text-[11px] " + subtle}>
                    Columns affect <b>step speed</b> (narrow = faster, wide = slower).
                  </div>
                </>
              )}
            </div>

            <div className={"rounded-lg border p-3 space-y-2 " + (dark ? "border-neutral-800 bg-neutral-900" : "border-neutral-200 bg-white")}>
              <div className="flex items-center justify-between">
                <div className="text-xs font-semibold uppercase tracking-wider">Rows (tails)</div>
                <button
                  onClick={() => setS((p) => ({ ...p, varRowsOn: !p.varRowsOn }))}
                  className={"p-1.5 rounded " + (s.varRowsOn ? (dark ? "bg-white text-black" : "bg-black text-white") : dark ? "bg-neutral-800" : "bg-neutral-200")}
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
                  <div className={"text-[11px] " + subtle}>
                    Rows affect <b>envelope</b> and <b>tails</b>. (Also affects Character Grid sound.)
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
              className={"w-full px-3 py-2 rounded-lg border font-mono " + inputBg}
            />
            <div className="flex items-center justify-between">
              <label className="text-xs font-semibold uppercase tracking-wider">Grid Lines</label>
              <button
                onClick={() => setS((p) => ({ ...p, gridLines: !p.gridLines }))}
                className={"p-1.5 rounded " + (s.gridLines ? (dark ? "bg-white text-black" : "bg-black text-white") : dark ? "bg-neutral-900" : "bg-neutral-200")}
              >
                {s.gridLines ? <Play size={14} fill={dark ? "black" : "white"} /> : <Square size={14} />}
              </button>
            </div>

            <div className={"text-[11px] " + subtle}>
              Note: variable rows/cols still affects <b>sound</b> here (even though the visual grid is uniform).
            </div>
          </div>
        )}

        {/* Clock + key */}
        <div className="space-y-2">
          <label className="block text-xs font-semibold uppercase tracking-wider">Clock</label>
          <label className={"block text-xs " + subtle}>BPM: {s.bpm}</label>
          <input
            type="range"
            min="40"
            max="220"
            value={s.bpm}
            onChange={(e) => setS((p) => ({ ...p, bpm: parseInt(e.target.value, 10) }))}
            className="w-full"
          />

          <div className="grid grid-cols-2 gap-2">
            <div className="space-y-1">
              <div className={"text-xs " + subtle}>Key</div>
              <select
                value={s.keyRoot}
                onChange={(e) => setS((p) => ({ ...p, keyRoot: parseInt(e.target.value, 10) }))}
                className={"w-full px-2 py-2 rounded-lg border text-xs " + inputBg}
              >
                {NOTE_NAMES.map((n, i) => (
                  <option key={n} value={i}>
                    {n}
                  </option>
                ))}
              </select>
            </div>
            <div className="space-y-1">
              <div className={"text-xs " + subtle}>Scale</div>
              <select
                value={s.scaleName}
                onChange={(e) => setS((p) => ({ ...p, scaleName: e.target.value }))}
                className={"w-full px-2 py-2 rounded-lg border text-xs " + inputBg}
              >
                {Object.keys(SCALES).map((name) => (
                  <option key={name} value={name}>
                    {name}
                  </option>
                ))}
              </select>
            </div>
          </div>

          <div className={"text-[11px] " + subtle}>
            <b>Always in tune:</b> melody + percussion quantized to {keyName} {s.scaleName}.<br />
            Top rows = higher, bottom rows = lower (for both layers).
          </div>
        </div>

        {/* Melody */}
        <div className="space-y-2">
          <div className="flex items-center justify-between">
            <label className="text-xs font-semibold uppercase tracking-wider">Melody</label>
            <button
              onClick={() => setS((p) => ({ ...p, melodyOn: !p.melodyOn }))}
              className={"p-1.5 rounded " + (s.melodyOn ? (dark ? "bg-white text-black" : "bg-black text-white") : dark ? "bg-neutral-900" : "bg-neutral-200")}
              title="Melody on/off"
            >
              {s.melodyOn ? <Play size={14} fill={dark ? "black" : "white"} /> : <Square size={14} />}
            </button>
          </div>

          <label className={"block text-xs " + subtle}>Voices: {s.voices}</label>
          <input
            type="range"
            min="1"
            max="24"
            value={s.voices}
            onChange={(e) => setS((p) => ({ ...p, voices: parseInt(e.target.value, 10) }))}
            className="w-full"
          />

          <label className={"block text-xs " + subtle}>Max notes / step: {s.maxNotesPerStep}</label>
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
              <div className={"text-xs " + subtle}>Base MIDI</div>
              <input
                type="number"
                min="12"
                max="72"
                value={s.baseMidi}
                onChange={(e) => setS((p) => ({ ...p, baseMidi: parseInt(e.target.value || "36", 10) }))}
                className={"w-full px-2 py-2 rounded-lg border text-xs " + inputBg}
              />
            </div>
            <div className="space-y-1">
              <div className={"text-xs " + subtle}>Octaves</div>
              <input
                type="number"
                min="1"
                max="7"
                value={s.octaveSpan}
                onChange={(e) => setS((p) => ({ ...p, octaveSpan: parseInt(e.target.value || "4", 10) }))}
                className={"w-full px-2 py-2 rounded-lg border text-xs " + inputBg}
              />
            </div>
          </div>

          <label className={"block text-xs " + subtle}>Timbre (osc blend) base: {s.timbreBase.toFixed(2)}</label>
          <input
            type="range"
            min="0"
            max="1"
            step="0.01"
            value={s.timbreBase}
            onChange={(e) => setS((p) => ({ ...p, timbreBase: parseFloat(e.target.value) }))}
            className="w-full"
          />
          <label className={"block text-xs " + subtle}>Timbre span: {s.timbreSpan.toFixed(2)}</label>
          <input
            type="range"
            min="0"
            max="1"
            step="0.01"
            value={s.timbreSpan}
            onChange={(e) => setS((p) => ({ ...p, timbreSpan: parseFloat(e.target.value) }))}
            className="w-full"
          />

          <div className="grid grid-cols-2 gap-2">
            <div className="space-y-1">
              <div className={"text-xs " + subtle}>Resonance: {s.reso.toFixed(2)}</div>
              <input
                type="range"
                min="0.1"
                max="6"
                step="0.01"
                value={s.reso}
                onChange={(e) => setS((p) => ({ ...p, reso: parseFloat(e.target.value) }))}
                className="w-full"
              />
            </div>
            <div className="space-y-1">
              <div className={"text-xs " + subtle}>Detune: {s.detune}c</div>
              <input
                type="range"
                min="0"
                max="18"
                step="1"
                value={s.detune}
                onChange={(e) => setS((p) => ({ ...p, detune: parseInt(e.target.value, 10) }))}
                className="w-full"
              />
            </div>
          </div>

          <div className="flex items-center gap-2">
            <Volume2 size={16} />
            <label className={"block text-xs " + subtle}>Melody Vol: {s.melodyVol.toFixed(2)}</label>
          </div>
          <input
            type="range"
            min="0"
            max="1.5"
            step="0.01"
            value={s.melodyVol}
            onChange={(e) => setS((p) => ({ ...p, melodyVol: parseFloat(e.target.value) }))}
            className="w-full"
          />
        </div>

        {/* Perc */}
        <div className="space-y-2">
          <div className="flex items-center justify-between">
            <label className="text-xs font-semibold uppercase tracking-wider">Percussion</label>
            <button
              onClick={() => setS((p) => ({ ...p, percOn: !p.percOn }))}
              className={"p-1.5 rounded " + (s.percOn ? (dark ? "bg-white text-black" : "bg-black text-white") : dark ? "bg-neutral-900" : "bg-neutral-200")}
              title="Perc on/off"
            >
              {s.percOn ? <Play size={14} fill={dark ? "black" : "white"} /> : <Square size={14} />}
            </button>
          </div>

          <div className="grid grid-cols-2 gap-2">
            <div className="space-y-1">
              <div className={"text-xs " + subtle}>Base MIDI (tune)</div>
              <input
                type="number"
                min="0"
                max="72"
                value={s.percBaseMidi}
                onChange={(e) => setS((p) => ({ ...p, percBaseMidi: parseInt(e.target.value || "24", 10) }))}
                className={"w-full px-2 py-2 rounded-lg border text-xs " + inputBg}
              />
            </div>
            <div className="space-y-1">
              <div className={"text-xs " + subtle}>Octaves</div>
              <input
                type="number"
                min="1"
                max="6"
                value={s.percOctaveSpan}
                onChange={(e) => setS((p) => ({ ...p, percOctaveSpan: parseInt(e.target.value || "3", 10) }))}
                className={"w-full px-2 py-2 rounded-lg border text-xs " + inputBg}
              />
            </div>
          </div>

          <label className={"block text-xs " + subtle}>Max hits / step: {s.percMaxHitsPerStep}</label>
          <input
            type="range"
            min="1"
            max="16"
            value={s.percMaxHitsPerStep}
            onChange={(e) => setS((p) => ({ ...p, percMaxHitsPerStep: parseInt(e.target.value, 10) }))}
            className="w-full"
          />

          <label className={"block text-xs " + subtle}>Decay base: {s.percDecayBase.toFixed(2)}</label>
          <input
            type="range"
            min="0.03"
            max="1.0"
            step="0.01"
            value={s.percDecayBase}
            onChange={(e) => setS((p) => ({ ...p, percDecayBase: parseFloat(e.target.value) }))}
            className="w-full"
          />
          <label className={"block text-xs " + subtle}>Decay span: {s.percDecaySpan.toFixed(2)}</label>
          <input
            type="range"
            min="0"
            max="2.2"
            step="0.01"
            value={s.percDecaySpan}
            onChange={(e) => setS((p) => ({ ...p, percDecaySpan: parseFloat(e.target.value) }))}
            className="w-full"
          />

          <div className="grid grid-cols-3 gap-2">
            <div className="space-y-1">
              <div className={"text-xs " + subtle}>Tone</div>
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
              <div className={"text-xs " + subtle}>Noise</div>
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
              <div className={"text-xs " + subtle}>Body</div>
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

          <label className={"block text-xs " + subtle}>Perc drive send: {s.percDriveSend.toFixed(2)}</label>
          <input
            type="range"
            min="0"
            max="1"
            step="0.01"
            value={s.percDriveSend}
            onChange={(e) => setS((p) => ({ ...p, percDriveSend: parseFloat(e.target.value) }))}
            className="w-full"
          />

          <div className="flex items-center gap-2">
            <Volume2 size={16} />
            <label className={"block text-xs " + subtle}>Perc Vol: {s.percVol.toFixed(2)}</label>
          </div>
          <input
            type="range"
            min="0"
            max="1.5"
            step="0.01"
            value={s.percVol}
            onChange={(e) => setS((p) => ({ ...p, percVol: parseFloat(e.target.value) }))}
            className="w-full"
          />
        </div>

        {/* Master + FX */}
        <div className="space-y-2">
          <label className="block text-xs font-semibold uppercase tracking-wider">Master + FX</label>

          <div className="flex items-center gap-2">
            <Volume2 size={16} />
            <label className={"block text-xs " + subtle}>Master: {s.master.toFixed(2)}</label>
          </div>
          <input
            type="range"
            min="0"
            max="1.2"
            step="0.01"
            value={s.master}
            onChange={(e) => setS((p) => ({ ...p, master: parseFloat(e.target.value) }))}
            className="w-full"
          />

          <div className={"rounded-lg border p-3 space-y-2 " + (dark ? "border-neutral-800 bg-neutral-900" : "border-neutral-200 bg-white")}>
            <div className="flex items-center justify-between">
              <div className="text-xs font-semibold uppercase tracking-wider">Reverb</div>
              <button
                onClick={() => setS((p) => ({ ...p, reverbOn: !p.reverbOn }))}
                className={"p-1.5 rounded " + (s.reverbOn ? (dark ? "bg-white text-black" : "bg-black text-white") : dark ? "bg-neutral-800" : "bg-neutral-200")}
              >
                {s.reverbOn ? <Play size={14} fill={dark ? "black" : "white"} /> : <Square size={14} />}
              </button>
            </div>
            <label className={"block text-xs " + subtle}>Mix: {s.reverbMix.toFixed(2)}</label>
            <input
              type="range"
              min="0"
              max="0.8"
              step="0.01"
              value={s.reverbMix}
              onChange={(e) => setS((p) => ({ ...p, reverbMix: parseFloat(e.target.value) }))}
              className="w-full"
            />
            <label className={"block text-xs " + subtle}>Time: {s.reverbTime.toFixed(1)}s</label>
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

          <div className={"rounded-lg border p-3 space-y-2 " + (dark ? "border-neutral-800 bg-neutral-900" : "border-neutral-200 bg-white")}>
            <div className="flex items-center justify-between">
              <div className="text-xs font-semibold uppercase tracking-wider">Delay</div>
              <button
                onClick={() => setS((p) => ({ ...p, delayOn: !p.delayOn }))}
                className={"p-1.5 rounded " + (s.delayOn ? (dark ? "bg-white text-black" : "bg-black text-white") : dark ? "bg-neutral-800" : "bg-neutral-200")}
              >
                {s.delayOn ? <Play size={14} fill={dark ? "black" : "white"} /> : <Square size={14} />}
              </button>
            </div>
            <label className={"block text-xs " + subtle}>Mix: {s.delayMix.toFixed(2)}</label>
            <input
              type="range"
              min="0"
              max="0.8"
              step="0.01"
              value={s.delayMix}
              onChange={(e) => setS((p) => ({ ...p, delayMix: parseFloat(e.target.value) }))}
              className="w-full"
            />
            <label className={"block text-xs " + subtle}>Time: {s.delayTime.toFixed(2)}s</label>
            <input
              type="range"
              min="0.05"
              max="0.9"
              step="0.01"
              value={s.delayTime}
              onChange={(e) => setS((p) => ({ ...p, delayTime: parseFloat(e.target.value) }))}
              className="w-full"
            />
            <label className={"block text-xs " + subtle}>Feedback: {s.delayFeedback.toFixed(2)}</label>
            <input
              type="range"
              min="0"
              max="0.75"
              step="0.01"
              value={s.delayFeedback}
              onChange={(e) => setS((p) => ({ ...p, delayFeedback: parseFloat(e.target.value) }))}
              className="w-full"
            />
            <div className={"text-[11px] " + subtle}>
              Kept safer to avoid runaway feedback. Use <b>Panic</b> if anything gets stuck.
            </div>
          </div>

          <div className={"rounded-lg border p-3 space-y-2 " + (dark ? "border-neutral-800 bg-neutral-900" : "border-neutral-200 bg-white")}>
            <div className="flex items-center justify-between">
              <div className="text-xs font-semibold uppercase tracking-wider">Drive</div>
              <button
                onClick={() => setS((p) => ({ ...p, driveOn: !p.driveOn }))}
                className={"p-1.5 rounded " + (s.driveOn ? (dark ? "bg-white text-black" : "bg-black text-white") : dark ? "bg-neutral-800" : "bg-neutral-200")}
              >
                {s.driveOn ? <Play size={14} fill={dark ? "black" : "white"} /> : <Square size={14} />}
              </button>
            </div>
            <label className={"block text-xs " + subtle}>Amount: {s.drive.toFixed(2)}</label>
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

        {/* MIDI */}
        <div className="space-y-2">
          <div className="flex items-center justify-between">
            <label className="text-xs font-semibold uppercase tracking-wider">MIDI</label>
            <button
              onClick={() => setS((p) => ({ ...p, midiOn: !p.midiOn }))}
              className={"p-1.5 rounded " + (s.midiOn ? (dark ? "bg-white text-black" : "bg-black text-white") : dark ? "bg-neutral-900" : "bg-neutral-200")}
              title="MIDI on/off"
              disabled={!midiSupported}
            >
              {s.midiOn ? <Play size={14} fill={dark ? "black" : "white"} /> : <Square size={14} />}
            </button>
          </div>

          {!midiSupported ? (
            <div className={"text-[11px] " + subtle}>This browser/device doesn’t support Web MIDI.</div>
          ) : (
            <>
              <div className="space-y-1">
                <div className={"text-xs " + subtle}>Input</div>
                <select
                  value={midiInputId}
                  onChange={(e) => setMidiInputId(e.target.value)}
                  className={"w-full px-2 py-2 rounded-lg border text-xs " + inputBg}
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
                <Btn
                  onClick={() => setS((p) => ({ ...p, midiDraw: !p.midiDraw }))}
                  className={s.midiDraw ? (dark ? "bg-white text-black border-white" : "bg-black text-white border-black") : ""}
                >
                  MIDI draws
                </Btn>
                <Btn
                  onClick={() => setS((p) => ({ ...p, midiThru: !p.midiThru }))}
                  className={s.midiThru ? (dark ? "bg-white text-black border-white" : "bg-black text-white border-black") : ""}
                >
                  MIDI thru
                </Btn>
              </div>

              <div className="grid grid-cols-2 gap-2">
                <Btn
                  onClick={() => setS((p) => ({ ...p, midiTargetLayer: "melody" }))}
                  className={s.midiTargetLayer === "melody" ? (dark ? "bg-white text-black border-white" : "bg-black text-white border-black") : ""}
                >
                  MIDI → Melody
                </Btn>
                <Btn
                  onClick={() => setS((p) => ({ ...p, midiTargetLayer: "perc" }))}
                  className={s.midiTargetLayer === "perc" ? (dark ? "bg-white text-black border-white" : "bg-black text-white border-black") : ""}
                >
                  MIDI → Perc
                </Btn>
              </div>

              <div className="space-y-1">
                <div className={"text-xs " + subtle}>Channel</div>
                <select
                  value={s.midiChannel}
                  onChange={(e) => setS((p) => ({ ...p, midiChannel: parseInt(e.target.value, 10) }))}
                  className={"w-full px-2 py-2 rounded-lg border text-xs " + inputBg}
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
                  <div className={"text-xs " + subtle}>Note low</div>
                  <input
                    type="number"
                    min="0"
                    max="127"
                    value={s.midiLo}
                    onChange={(e) => setS((p) => ({ ...p, midiLo: parseInt(e.target.value || "0", 10) }))}
                    className={"w-full px-2 py-2 rounded-lg border text-xs " + inputBg}
                  />
                </div>
                <div className="space-y-1">
                  <div className={"text-xs " + subtle}>Note high</div>
                  <input
                    type="number"
                    min="0"
                    max="127"
                    value={s.midiHi}
                    onChange={(e) => setS((p) => ({ ...p, midiHi: parseInt(e.target.value || "127", 10) }))}
                    className={"w-full px-2 py-2 rounded-lg border text-xs " + inputBg}
                  />
                </div>
              </div>

              <div className={"text-[11px] " + subtle}>
                MIDI paints: velocity → intensity, duration → persistence. Column spreads across the grid (not just one column).
              </div>
            </>
          )}
        </div>

        <div className={"text-[11px] " + subtle}>
          If you ever get silence: click <b>Enable Audio</b> once (browser rule). If you ever get runaway noise: hit <b>Panic</b>.
        </div>
      </div>

      {/* Canvas */}
      <div className={"flex-1 min-h-0 p-2 md:p-8 relative overflow-hidden " + canvasWrap}>
        <button
          onClick={() => setPanelOpen((v) => !v)}
          className={"md:hidden absolute top-3 left-3 z-20 px-3 py-2 rounded-lg text-xs font-semibold shadow " + (dark ? "bg-white text-black" : "bg-black text-white")}
        >
          {panelOpen ? "Hide controls" : "Show controls"}
        </button>

        <canvas
          ref={canvasRef}
          className={"w-full h-full rounded-lg shadow-sm touch-none select-none " + (dark ? "shadow-black/40" : "")}
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
