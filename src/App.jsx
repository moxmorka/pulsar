// App.jsx
import React from "react";
import { RotateCcw, Download, Play, Square, Palette, Moon, Sun, Layers } from "lucide-react";

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
   Variable grid density (edges)
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
function quantizeToScale(midi, scaleSet) {
  if (!scaleSet?.length) return midi;
  let best = scaleSet[0];
  let bestD = Math.abs(midi - best);
  for (let i = 1; i < scaleSet.length; i++) {
    const d = Math.abs(midi - scaleSet[i]);
    if (d < bestD) {
      bestD = d;
      best = scaleSet[i];
    }
  }
  return best;
}

/* =======================
   Melody synth
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

  osc.type = "triangle";
  filter.type = "lowpass";
  filter.Q.value = 0.75;

  gain.gain.value = 0.0; // silent idle

  osc.connect(filter);
  filter.connect(gain);
  osc.start();
  return { osc, filter, gain };
}

function triggerVoice(ac, voice, { freq, vel, cutoffHz, attack, decaySec, release, oscType = "triangle" }) {
  const now = ac.currentTime;
  const v = clamp(vel, 0.0001, 1);

  if (voice.osc.type !== oscType) voice.osc.type = oscType;

  voice.osc.frequency.cancelScheduledValues(now);
  voice.osc.frequency.setValueAtTime(freq, now);

  voice.filter.frequency.cancelScheduledValues(now);
  voice.filter.frequency.setValueAtTime(clamp(cutoffHz, 80, 16000), now);

  const g = voice.gain.gain;
  g.cancelScheduledValues(now);

  g.setValueAtTime(0.0, now);
  g.linearRampToValueAtTime(v, now + clamp(attack, 0.001, 0.25));
  g.exponentialRampToValueAtTime(0.00001, now + clamp(attack, 0.001, 0.25) + clamp(decaySec, 0.02, 3.0));
  g.linearRampToValueAtTime(
    0.0,
    now + clamp(attack, 0.001, 0.25) + clamp(decaySec, 0.02, 3.0) + clamp(release, 0.02, 3.0)
  );
}

/* =======================
   Percussion (kit)
======================= */
function makeNoiseBuffer(ac, durSec) {
  const len = Math.max(1, Math.floor(ac.sampleRate * durSec));
  const buf = ac.createBuffer(1, len, ac.sampleRate);
  const data = buf.getChannelData(0);
  for (let i = 0; i < len; i++) data[i] = Math.random() * 2 - 1;
  return buf;
}

/**
 * UPDATED: percussion now supports explicit Attack/Decay/Level (like melody shaping).
 * - attack: overall hit attack (seconds)
 * - level: overall hit level multiplier (0..2-ish)
 * - decay: (already existed) still used per-component, plus as an overall “tail” envelope
 */
function triggerPerc(ac, dest, opts) {
  const {
    type = "kick", // kick | snare | hat | tom | wood | shaker | rim
    freq = 110,
    vel = 0.7,
    attack = 0.002, // NEW
    level = 1.0, // NEW
    decay = 0.18,
    tone = 0.55,
    bright = 0.5,
    punch = 0.65,
    driveAmt = 0.0,
    acoustic = false,
  } = opts;

  const now = ac.currentTime;
  const v = clamp(vel, 0, 1);
  const lvl = clamp(level ?? 1.0, 0, 2.5);
  const atk = clamp(attack ?? 0.002, 0.0005, 0.08);

  // overall envelope time uses decay too (acts like “macro decay”)
  const envDecay = clamp(decay ?? 0.18, 0.03, 1.8) * (type === "shaker" ? 1.2 : 1.0);

  // macro output gain (this is the main “attack/decay/level” shaper)
  const out = ac.createGain();
  out.gain.cancelScheduledValues(now);
  out.gain.setValueAtTime(0.00001, now);
  out.gain.linearRampToValueAtTime(lvl, now + atk);
  out.gain.exponentialRampToValueAtTime(0.00001, now + atk + envDecay);

  const shaper = ac.createWaveShaper();
  shaper.oversample = "2x";
  {
    const nC = 2048;
    const curve = new Float32Array(nC);
    const k = clamp(driveAmt, 0, 1) * (acoustic ? 12 : 28);
    for (let i = 0; i < nC; i++) {
      const x = (i * 2) / (nC - 1) - 1;
      curve[i] = k > 0.001 ? Math.tanh(x * (1 + k)) : x;
    }
    shaper.curve = curve;
  }

  // click
  const clickBuf = makeNoiseBuffer(ac, 0.01);
  const click = ac.createBufferSource();
  click.buffer = clickBuf;

  const clickHP = ac.createBiquadFilter();
  clickHP.type = "highpass";
  clickHP.frequency.setValueAtTime(type === "hat" || type === "shaker" ? 6500 : 2200, now);

  const clickGain = ac.createGain();
  clickGain.gain.setValueAtTime(0.0, now);
  clickGain.gain.linearRampToValueAtTime(
    (type === "wood" || type === "rim" ? 0.55 : acoustic ? 0.22 : 0.35) * v * (0.5 + punch),
    now + 0.001
  );
  clickGain.gain.exponentialRampToValueAtTime(0.00001, now + (type === "shaker" ? 0.04 : 0.02));

  click.connect(clickHP);
  clickHP.connect(clickGain);

  // noise
  const nDur = clamp(0.03 + decay * 0.9, 0.05, 1.6);
  const noiseBuf = makeNoiseBuffer(ac, nDur);
  const noise = ac.createBufferSource();
  noise.buffer = noiseBuf;

  const noiseBP = ac.createBiquadFilter();
  noiseBP.type = "bandpass";
  noiseBP.Q.value = clamp((acoustic ? 6 : 4) + punch * 10, 4, 24);

  const noiseCenter =
    type === "hat" || type === "shaker"
      ? lerp(6500, 12000, bright)
      : type === "snare"
      ? lerp(acoustic ? 1100 : 1400, acoustic ? 3200 : 4200, bright)
      : type === "wood" || type === "rim"
      ? lerp(900, 3200, bright)
      : lerp(300, 2000, bright);

  noiseBP.frequency.setValueAtTime(noiseCenter, now);

  const noiseHP = ac.createBiquadFilter();
  noiseHP.type = "highpass";
  noiseHP.frequency.setValueAtTime(
    type === "kick" ? 60 : type === "tom" ? 120 : type === "wood" || type === "rim" ? 250 : 900,
    now
  );

  const noiseGain = ac.createGain();
  const noiseAmt =
    type === "kick"
      ? acoustic ? 0.09 : 0.12
      : type === "tom"
      ? 0.18
      : type === "snare"
      ? acoustic ? 0.55 : 0.75
      : type === "wood" || type === "rim"
      ? 0.35
      : acoustic ? 0.75 : 0.95;

  noiseGain.gain.setValueAtTime(0.0, now);
  noiseGain.gain.linearRampToValueAtTime(noiseAmt * v * (1 - tone), now + 0.002);
  noiseGain.gain.exponentialRampToValueAtTime(
    0.00001,
    now + clamp(decay, 0.03, 1.8) * (type === "shaker" ? 1.2 : 1.0)
  );

  noise.connect(noiseBP);
  noiseBP.connect(noiseHP);
  noiseHP.connect(noiseGain);

  // body
  const body = ac.createOscillator();
  body.type = type === "wood" || type === "rim" ? "triangle" : acoustic ? "triangle" : "sine";

  const f0 = clamp(freq, 35, 6000);
  const drop =
    type === "kick"
      ? lerp(1.8, 3.2, punch)
      : type === "tom"
      ? lerp(1.2, 2.0, punch)
      : type === "wood" || type === "rim"
      ? lerp(1.05, 1.35, punch)
      : acoustic
      ? lerp(1.01, 1.05, punch)
      : 1.02;

  // small “human” drift for acoustic feel
  const drift = acoustic ? (Math.random() * 2 - 1) * 0.006 : 0;
  body.frequency.setValueAtTime(f0 * drop * (1 + drift), now);
  body.frequency.exponentialRampToValueAtTime(
    f0 * (1 + drift * 0.25),
    now + (type === "kick" ? 0.04 : type === "wood" ? 0.015 : 0.03)
  );

  const bodyGain = ac.createGain();
  const bodyAmt =
    type === "kick"
      ? acoustic ? 0.92 : 1.0
      : type === "tom"
      ? 0.85
      : type === "snare"
      ? acoustic ? 0.34 : 0.25
      : type === "wood" || type === "rim"
      ? 0.55
      : type === "shaker"
      ? 0.05
      : acoustic ? 0.10 : 0.12;

  const a = type === "wood" || type === "rim" ? 0.0009 : acoustic ? 0.0022 : 0.0015;
  const d = clamp(decay, 0.03, 1.8) * (type === "wood" || type === "rim" ? 0.55 : acoustic ? 1.25 : 1.0);

  bodyGain.gain.setValueAtTime(0.0, now);
  bodyGain.gain.linearRampToValueAtTime(bodyAmt * v * tone, now + a);
  bodyGain.gain.exponentialRampToValueAtTime(0.00001, now + d);

  // “wood” extra resonator
  const woodRes = ac.createBiquadFilter();
  woodRes.type = "bandpass";
  woodRes.Q.value = type === "wood" || type === "rim" ? 18 : acoustic ? 10 : 1;
  woodRes.frequency.setValueAtTime(
    type === "wood" || type === "rim"
      ? clamp(f0 * lerp(1.6, 2.8, bright), 350, 6500)
      : clamp(f0 * 2.2, 220, 7000),
    now
  );

  // sum
  clickGain.connect(out);
  noiseGain.connect(out);
  body.connect(bodyGain);
  bodyGain.connect(out);

  if (type === "wood" || type === "rim" || acoustic) {
    out.connect(woodRes);
    woodRes.connect(shaper);
  } else {
    out.connect(shaper);
  }

  shaper.connect(dest);

  click.start(now);
  click.stop(now + 0.04);

  noise.start(now);
  noise.stop(now + nDur + 0.05);

  body.start(now);
  body.stop(now + d + 0.1);
}

/* =======================
   Main App
======================= */
export default function App() {
  const canvasRef = React.useRef(null);
  const rafRef = React.useRef(null);

  // track canvas px for char-grid “rows/cols” controls
  const canvasPxRef = React.useRef({ w: 800, h: 600 });

  // LAYERS
  const [activeLayer, setActiveLayer] = React.useState("melody"); // melody | perc
  const [layerView, setLayerView] = React.useState("both"); // both | active | ghost
  const [ghostOpacity, setGhostOpacity] = React.useState(0.28);

  // CELLS: melody + percussion
  const [cellsMel, setCellsMel] = React.useState([]);
  const [cellsPerc, setCellsPerc] = React.useState([]);
  const cellsMelRef = React.useRef([]);
  const cellsPercRef = React.useRef([]);
  React.useEffect(() => void (cellsMelRef.current = cellsMel), [cellsMel]);
  React.useEffect(() => void (cellsPercRef.current = cellsPerc), [cellsPerc]);

  const [panelOpen, setPanelOpen] = React.useState(false);

  // painting
  const [paint, setPaint] = React.useState({
    mode: "color",
    color: "#111111",
    useSeq: true,
  });
  const [drawing, setDrawing] = React.useState(false);

  // theme
  const [theme, setTheme] = React.useState("light");
  const isDark = theme === "dark";

  // settings
  const [s, setS] = React.useState({
    pat: "swiss-grid", // swiss-grid | char-grid

    // char-grid (base)
    space: 42,
    charSz: 22,
    chars: "01",
    charSpd: 2.0,
    charFollowBpm: true,

    // char-grid rows/cols controls
    charUseDims: false,
    charCols: 18,
    charRows: 12,

    // NEW: char-grid variable density (non-uniform edges)
    charVarColsOn: false,
    charColFocus: 0.5,
    charColStrength: 6,
    charColSigma: 0.18,
    charVarRowsOn: false,
    charRowFocus: 0.5,
    charRowStrength: 6,
    charRowSigma: 0.18,

    // swiss-grid
    cols: 12,
    rows: 16,
    gridLines: true,
    swissCharScale: 1.0,

    // swiss variable density
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
    colorSeqBehave: "same",

    // ======= MELODY SOUND =======
    soundOn: true,
    bpm: 120,
    maxNotesPerStep: 10,

    keyRoot: 0,
    scaleName: "naturalMinor",
    baseMidi: 36,
    octaveSpan: 4,

    chordType: "7", // triad | 7
    prog: [0, 5, 3, 6],
    progRate: 4,

    laneMode: "hue",
    velFrom: "luma",
    cutoffBase: 400,
    cutoffSpan: 7200,

    // ADSR controls
    atkBase: 0.008,
    atkSpan: 0.09,
    decBase: 0.08,
    decSpan: 0.65,
    relBase: 0.06,
    relSpan: 0.85,

    voices: 14,
    melodyOsc: "triangle",

    // smoothing morph time when grid changes
    morphSec: 0.6,

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
    drive: 0.6,

    // ======= LAYER VOLUMES =======
    melodyVol: 0.9,
    percVol: 0.85,

    // ======= PERCUSSION =======
    percOn: true,
    percMaxHitsPerStep: 8,
    percBaseMidi: 24,
    percOctaveSpan: 3,
    percTone: 0.45,

    // UPDATED: “shaping” like melody
    percLevelBase: 1.0,      // NEW
    percLevelSpan: 0.75,     // NEW
    percAtkBase: 0.0015,     // NEW
    percAtkSpan: 0.018,      // NEW
    percDecBase: 0.10,       // NEW (replaces old percDecayBase conceptually)
    percDecSpan: 0.50,       // NEW

    percPunch: 0.7,
    percBright: 0.55,
    percDrive: 0.08,

    // percussion kit
    percKit: "classic", // classic | wood | soft | acoustic

    // audition
    auditionOnPaint: true,
    auditionVel: 0.55,

    // ======= MIDI =======
    midiOn: true,
    midiDraw: true,
    midiThru: true,
    midiChannel: -1,
    midiLo: 36,
    midiHi: 84,
    midiFadeMin: 0.25,
    midiFadeMax: 2.5,
    midiQuantizeToScale: true,
  });

  const sRef = React.useRef(s);
  React.useEffect(() => void (sRef.current = s), [s]);

  // palette
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
     Swiss edges (render + scheduler)
======================= */
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

  // scheduler uses refs (no stale edges)
  const colEdgesRef = React.useRef(colEdges);
  const rowEdgesRef = React.useRef(rowEdges);
  React.useEffect(() => void (colEdgesRef.current = colEdges), [colEdges]);
  React.useEffect(() => void (rowEdgesRef.current = rowEdges), [rowEdges]);

  function swissCellGeom(r, c, w, h) {
    const ce = colEdges || Array.from({ length: s.cols + 1 }, (_, i) => i / s.cols);
    const re = rowEdges || Array.from({ length: s.rows + 1 }, (_, i) => i / s.rows);
    const x0 = ce[c] * w;
    const x1 = ce[c + 1] * w;
    const y0 = re[r] * h;
    const y1 = re[r + 1] * h;
    return { x: x0, y: y0, w: x1 - x0, h: y1 - y0, cx: (x0 + x1) / 2, cy: (y0 + y1) / 2 };
  }

  /* =======================
     Char-grid effective dims + edges
======================= */
  const computeCharEffDims = React.useCallback((st) => {
    const { w, h } = canvasPxRef.current || { w: 800, h: 600 };
    if (st.charUseDims) {
      return { cols: clamp(st.charCols ?? 18, 2, 120) | 0, rows: clamp(st.charRows ?? 12, 2, 120) | 0 };
    }
    const space = clamp(st.space ?? 42, 8, 400);
    return { cols: Math.max(1, Math.floor(w / space)), rows: Math.max(1, Math.floor(h / space)) };
  }, []);

  const charEdges = React.useMemo(() => {
    if (s.pat !== "char-grid") return null;
    const { cols, rows } = computeCharEffDims(s);

    const ce = s.charVarColsOn
      ? buildVariableEdges(cols, s.charColFocus, s.charColStrength, s.charColSigma)
      : Array.from({ length: cols + 1 }, (_, i) => i / cols);

    const re = s.charVarRowsOn
      ? buildVariableEdges(rows, s.charRowFocus, s.charRowStrength, s.charRowSigma)
      : Array.from({ length: rows + 1 }, (_, i) => i / rows);

    return { cols, rows, ce, re };
  }, [
    s.pat,
    s.space,
    s.charUseDims,
    s.charCols,
    s.charRows,
    s.charVarColsOn,
    s.charColFocus,
    s.charColStrength,
    s.charColSigma,
    s.charVarRowsOn,
    s.charRowFocus,
    s.charRowStrength,
    s.charRowSigma,
    computeCharEffDims,
  ]);

  const charEdgesRef = React.useRef(charEdges);
  React.useEffect(() => void (charEdgesRef.current = charEdges), [charEdges]);

  function charCellGeom(r, c, w, h) {
    const CE = charEdgesRef.current;
    const ce = CE?.ce ?? Array.from({ length: (CE?.cols ?? 16) + 1 }, (_, i) => i / (CE?.cols ?? 16));
    const re = CE?.re ?? Array.from({ length: (CE?.rows ?? 12) + 1 }, (_, i) => i / (CE?.rows ?? 12));
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

  const getCharGridIdx = React.useCallback((cx, cy) => {
    const cv = canvasRef.current;
    if (!cv) return null;
    const CE = charEdgesRef.current;
    const cols = CE?.cols ?? 16;
    const rows = CE?.rows ?? 12;
    const ce = CE?.ce ?? Array.from({ length: cols + 1 }, (_, i) => i / cols);
    const re = CE?.re ?? Array.from({ length: rows + 1 }, (_, i) => i / rows);

    const x01 = cx / cv.width;
    const y01 = cy / cv.height;
    const col = findIndexFromEdges(ce, x01);
    const row = findIndexFromEdges(re, y01);
    if (col < 0 || row < 0 || col >= cols || row >= rows) return null;
    return row * cols + col;
  }, []);

  const getIdx = React.useCallback(
    (cx, cy) => {
      if (s.pat === "swiss-grid") return getSwissIdx(cx, cy);
      if (s.pat === "char-grid") return getCharGridIdx(cx, cy);
      return null;
    },
    [s.pat, getSwissIdx, getCharGridIdx]
  );

  /* =======================
     Cell CRUD per layer
======================= */
  const upsertCellLayer = React.useCallback((layer, idx, patch) => {
    const setFn = layer === "perc" ? setCellsPerc : setCellsMel;
    setFn((prev) => {
      const ex = prev.findIndex((c) => c.idx === idx);
      const next = [...prev];
      if (ex >= 0) next[ex] = { ...next[ex], ...patch };
      else next.push({ idx, ...patch });
      return next;
    });
  }, []);
  const removeCellLayer = React.useCallback((layer, idx) => {
    const setFn = layer === "perc" ? setCellsPerc : setCellsMel;
    setFn((prev) => prev.filter((c) => c.idx !== idx));
  }, []);

  /* =======================
     AUDIO GRAPH (lazy init)
======================= */
  const audioRef = React.useRef({
    ac: null,
    master: null,
    melodyBus: null,
    percBus: null,
    dry: null,
    wetRev: null,
    wetDel: null,
    convolver: null,
    delay: null,
    feedback: null,
    drive: null,
    voices: [],
    voicePtr: 0,
    running: false,
    step: 0,
    timer: null,
    _revTime: null,
  });

  function ensureAudio() {
    const A = audioRef.current;
    if (!A.ac) {
      const ac = new (window.AudioContext || window.webkitAudioContext)();

      const master = ac.createGain();
      master.gain.value = 0.85;

      const melodyBus = ac.createGain();
      melodyBus.gain.value = clamp(sRef.current.melodyVol ?? 0.9, 0, 1.5);

      const percBus = ac.createGain();
      percBus.gain.value = clamp(sRef.current.percVol ?? 0.85, 0, 1.5);

      const drive = ac.createWaveShaper();
      drive.oversample = "2x";

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

      melodyBus.connect(drive);
      percBus.connect(drive);

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
      A.melodyBus = melodyBus;
      A.percBus = percBus;
      A.drive = drive;
      A.dry = dry;
      A.wetRev = wetRev;
      A.wetDel = wetDel;
      A.convolver = convolver;
      A.delay = delay;
      A.feedback = feedback;

      A.voices = [];
      A.voicePtr = 0;
      A._revTime = null;

      updateAudioParamsRealtime();
      ensureVoices();
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
    const now = A.ac.currentTime;

    A.melodyBus.gain.setTargetAtTime(clamp(st.melodyVol ?? 0.9, 0, 1.5), now, 0.02);
    A.percBus.gain.setTargetAtTime(clamp(st.percVol ?? 0.85, 0, 1.5), now, 0.02);
    A.master.gain.setTargetAtTime(clamp(st.master, 0, 1.2), now, 0.02);

    // drive
    if (st.driveOn) {
      const k = clamp(st.drive ?? 0.6, 0, 1) * 40;
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
    A.wetRev.gain.setTargetAtTime(st.reverbOn ? clamp(st.reverbMix, 0, 1) : 0, now, 0.02);
    if (A._revTime == null) A._revTime = st.reverbTime;
    if (Math.abs(st.reverbTime - A._revTime) > 0.12) {
      A._revTime = st.reverbTime;
      A.convolver.buffer = createReverbImpulse(A.ac, clamp(st.reverbTime, 0.3, 6), 2.0);
    }

    // delay
    A.wetDel.gain.setTargetAtTime(st.delayOn ? clamp(st.delayMix, 0, 1) : 0, now, 0.02);
    A.delay.delayTime.setTargetAtTime(clamp(st.delayTime, 0.01, 1.5), now, 0.02);
    A.feedback.gain.setTargetAtTime(clamp(st.delayFeedback, 0, 0.95), now, 0.02);
  }

  function ensureVoices() {
    const A = audioRef.current;
    if (!A.ac) return;
    const ac = A.ac;
    const want = clamp(sRef.current.voices ?? 12, 1, 32);
    if (A.voices.length !== want) {
      const newPool = Array.from({ length: want }, () => {
        const v = makeVoice(ac);
        v.gain.connect(A.melodyBus);
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
     Grid dims helper
======================= */
  const getGridDims = React.useCallback(() => {
    const st = sRef.current;
    if (st.pat === "swiss-grid") {
      return { cols: Math.max(1, st.cols | 0), rows: Math.max(1, st.rows | 0) };
    }
    const CE = charEdgesRef.current;
    if (CE) return { cols: CE.cols, rows: CE.rows };
    const { cols, rows } = computeCharEffDims(st);
    return { cols, rows };
  }, [computeCharEffDims]);

  /* =======================
     Smooth morph between grid changes
======================= */
  const morphRef = React.useRef({
    active: false,
    t0: 0,
    dur: 0.6,
    prev: null,
  });

  const lastGridRef = React.useRef({
    pat: s.pat,
    cols: s.cols,
    rows: s.rows,
    space: s.space,
    charUseDims: s.charUseDims,
    charCols: s.charCols,
    charRows: s.charRows,
    charEffCols: computeCharEffDims(s).cols,
    charEffRows: computeCharEffDims(s).rows,

    varColsOn: s.varColsOn,
    colFocus: s.colFocus,
    colStrength: s.colStrength,
    colSigma: s.colSigma,
    varRowsOn: s.varRowsOn,
    rowFocus: s.rowFocus,
    rowStrength: s.rowStrength,
    rowSigma: s.rowSigma,

    charVarColsOn: s.charVarColsOn,
    charColFocus: s.charColFocus,
    charColStrength: s.charColStrength,
    charColSigma: s.charColSigma,
    charVarRowsOn: s.charVarRowsOn,
    charRowFocus: s.charRowFocus,
    charRowStrength: s.charRowStrength,
    charRowSigma: s.charRowSigma,
  });

  React.useEffect(() => {
    const st = sRef.current;
    const eff = computeCharEffDims(st);

    const cur = {
      pat: st.pat,
      cols: st.cols,
      rows: st.rows,
      space: st.space,
      charUseDims: st.charUseDims,
      charCols: st.charCols,
      charRows: st.charRows,
      charEffCols: eff.cols,
      charEffRows: eff.rows,

      varColsOn: st.varColsOn,
      colFocus: st.colFocus,
      colStrength: st.colStrength,
      colSigma: st.colSigma,
      varRowsOn: st.varRowsOn,
      rowFocus: st.rowFocus,
      rowStrength: st.rowStrength,
      rowSigma: st.rowSigma,

      charVarColsOn: st.charVarColsOn,
      charColFocus: st.charColFocus,
      charColStrength: st.charColStrength,
      charColSigma: st.charColSigma,
      charVarRowsOn: st.charVarRowsOn,
      charRowFocus: st.charRowFocus,
      charRowStrength: st.charRowStrength,
      charRowSigma: st.charRowSigma,
    };

    const prev = lastGridRef.current;
    const changed = Object.keys(cur).some((k) => cur[k] !== prev[k]);

    if (changed) {
      morphRef.current.active = true;
      morphRef.current.t0 = performance.now() * 0.001;
      morphRef.current.dur = clamp(st.morphSec ?? 0.6, 0.05, 2.0);
      morphRef.current.prev = prev;
      lastGridRef.current = cur;
    }
  }, [
    s.pat,
    s.cols,
    s.rows,
    s.space,
    s.charUseDims,
    s.charCols,
    s.charRows,
    s.morphSec,

    s.varColsOn,
    s.colFocus,
    s.colStrength,
    s.colSigma,
    s.varRowsOn,
    s.rowFocus,
    s.rowStrength,
    s.rowSigma,

    s.charVarColsOn,
    s.charColFocus,
    s.charColStrength,
    s.charColSigma,
    s.charVarRowsOn,
    s.charRowFocus,
    s.charRowStrength,
    s.charRowSigma,

    computeCharEffDims,
  ]);

  /* =======================
     Audition on paint
======================= */
  const auditionPaint = React.useCallback((layerKey, row, col, rows, cols, color) => {
    const st = sRef.current;
    if (!st.auditionOnPaint) return;

    // Only try playing if audio exists & is running (or user just enabled it)
    const A = audioRef.current.ac ? audioRef.current : ensureAudio();
    if (!A.ac || A.ac.state === "suspended") return;

    ensureVoices();
    updateAudioParamsRealtime();

    const degreesCount = 7 * clamp(st.octaveSpan ?? 4, 1, 7);
    const scaleMidi = buildScaleMidi({
      rootPc: clamp(st.keyRoot ?? 0, 0, 11),
      scaleName: st.scaleName,
      baseMidi: clamp(st.baseMidi ?? 36, 12, 60),
      degreesCount,
    });

    const rowNorm = rows <= 1 ? 0.5 : 1 - row / (rows - 1);
    const degIdx = clamp(Math.round(rowNorm * (degreesCount - 1)), 0, degreesCount - 1);

    const rgb = hexToRgb(color || "#777777");
    const lum = rgb ? luminance01(rgb) : 0.6;
    const vel = clamp(st.auditionVel ?? 0.55, 0.05, 1) * clamp(0.4 + lum, 0.2, 1);

    if (layerKey === "melody") {
      const midi = scaleMidi[degIdx];
      const freq = midiToFreq(midi);

      const v = A.voices[A.voicePtr % A.voices.length];
      A.voicePtr++;

      triggerVoice(A.ac, v, {
        freq,
        vel,
        cutoffHz: (st.cutoffBase ?? 400) + (st.cutoffSpan ?? 7200) * clamp(0.25 + lum * 0.75, 0, 1),
        attack: 0.004,
        decaySec: 0.12,
        release: 0.12,
        oscType: st.melodyOsc ?? "triangle",
      });
    } else {
      const h = rgb ? hue01(rgb) : 0.4;

      const kit = st.percKit ?? "classic";
      const type =
        kit === "classic" || kit === "acoustic"
          ? h < 0.33
            ? "kick"
            : h < 0.66
            ? "snare"
            : "hat"
          : kit === "wood"
          ? h < 0.33
            ? "wood"
            : h < 0.66
            ? "rim"
            : "shaker"
          : h < 0.33
          ? "tom"
          : h < 0.66
          ? "snare"
          : "shaker";

      const percDegreesCount = 7 * clamp(st.percOctaveSpan ?? 3, 1, 7);
      const percScaleMidi = buildScaleMidi({
        rootPc: clamp(st.keyRoot ?? 0, 0, 11),
        scaleName: st.scaleName,
        baseMidi: clamp(st.percBaseMidi ?? 24, 0, 72),
        degreesCount: percDegreesCount,
      });

      const pm = percScaleMidi[clamp(Math.round(rowNorm * (percDegreesCount - 1)), 0, percDegreesCount - 1)];
      const freq = midiToFreq(pm);

      const acoustic = kit === "acoustic";

      // NEW: use shaping controls for audition too
      const level = clamp((st.percLevelBase ?? 1.0) + (st.percLevelSpan ?? 0.75) * lum, 0, 2.5);
      const atk = clamp((st.percAtkBase ?? 0.0015) + (st.percAtkSpan ?? 0.018) * (1 - rowNorm), 0.0005, 0.08);
      const dec = clamp((st.percDecBase ?? 0.10) + (st.percDecSpan ?? 0.50) * (1 - rowNorm), 0.03, 1.7);

      triggerPerc(A.ac, A.percBus, {
        type,
        freq,
        vel,
        level,
        attack: atk,
        decay: dec * (acoustic ? 1.15 : 1),
        tone: clamp(st.percTone ?? 0.45, 0, 1),
        bright: clamp(st.percBright ?? 0.55, 0, 1),
        punch: clamp(st.percPunch ?? 0.7, 0, 1) * (acoustic ? 0.92 : 1),
        driveAmt: clamp(st.percDrive ?? 0.08, 0, 1) * (acoustic ? 0.35 : 1),
        acoustic,
      });
    }
  }, []);

  /* =======================
     Paint apply
======================= */
  const applyPaintToIdx = (idx, r, c, t, rows, cols) => {
    if (idx == null) return;
    const layerKey = activeLayer === "perc" ? "perc" : "melody";

    if (paint.mode === "none") {
      removeCellLayer(layerKey, idx);
      return;
    }

    let chosenColor = paint.color;
    if (paint.useSeq) {
      const len = palette.length;
      const ci = colorSeqIndex(t, r, c, len);
      chosenColor = palette[ci];
    }

    upsertCellLayer(layerKey, idx, { paint: { mode: "color", color: chosenColor } });
    auditionPaint(layerKey === "perc" ? "perc" : "melody", r, c, rows, cols, chosenColor);
  };

  const gen = () => {
    setCellsMel((p) => [...p]);
    setCellsPerc((p) => [...p]);
  };

  const clearPaint = () => {
    if (activeLayer === "perc") setCellsPerc([]);
    else setCellsMel([]);
  };

  /* =======================
     Scheduler (melody + perc)
======================= */
  function startScheduler() {
    audioRef.current.running = true;

    const tick = () => {
      if (!audioRef.current.running) return;

      const st = sRef.current;

      const melNow = cellsMelRef.current;
      const percNow = cellsPercRef.current;

      const melMap = new Map();
      const percMap = new Map();
      for (const c of melNow) melMap.set(c.idx, c);
      for (const c of percNow) percMap.set(c.idx, c);

      const isSwiss = st.pat === "swiss-grid";
      const dims = getGridDims();
      const cols = dims.cols;
      const rows = dims.rows;

      // step duration
      const bpm = clamp(st.bpm ?? 120, 30, 260);
      const baseStepSec = 60 / bpm / 2;
      let stepSec = baseStepSec;

      // variable columns timing (swiss only)
      if (isSwiss && st.varColsOn) {
        const ce = colEdgesRef.current || Array.from({ length: cols + 1 }, (_, i) => i / cols);
        const curCol = audioRef.current.step % cols;
        const w = (ce[curCol + 1] ?? (curCol + 1) / cols) - (ce[curCol] ?? curCol / cols);
        const avg = 1 / cols;
        const ratio = clamp(w / avg, 0.35, 2.4);
        stepSec = baseStepSec * ratio;
      }

      const col = audioRef.current.step % cols;
      const nowS = performance.now() * 0.001;

      // morph amount
      let morph = 1;
      if (morphRef.current.active && morphRef.current.prev) {
        const t = (nowS - morphRef.current.t0) / Math.max(0.0001, morphRef.current.dur);
        morph = clamp(t, 0, 1);
        if (morph >= 1) morphRef.current.active = false;
      }

      // old snapshot mapping
      const prevSnap = morphRef.current.prev;
      const getOldRowIndex = (rNow) => {
        if (!prevSnap) return rNow;
        const yNorm = rows <= 1 ? 0.5 : (rNow + 0.5) / rows;
        const oldRows =
          prevSnap.pat === "swiss-grid"
            ? Math.max(1, prevSnap.rows | 0)
            : Math.max(1, prevSnap.charEffRows | 0);
        return clamp(Math.floor(yNorm * oldRows), 0, oldRows - 1);
      };
      const getOldColIndex = (cNow) => {
        if (!prevSnap) return cNow;
        const xNorm = cols <= 1 ? 0.5 : (cNow + 0.5) / cols;
        const oldCols =
          prevSnap.pat === "swiss-grid"
            ? Math.max(1, prevSnap.cols | 0)
            : Math.max(1, prevSnap.charEffCols | 0);
        return clamp(Math.floor(xNorm * oldCols), 0, oldCols - 1);
      };
      const blendFreq = (fOld, fNew) => {
        if (!isFinite(fOld) || fOld <= 0) return fNew;
        if (!isFinite(fNew) || fNew <= 0) return fOld;
        const a = Math.log(fOld);
        const b = Math.log(fNew);
        return Math.exp(lerp(a, b, morph));
      };

      // progression / chords
      const prog = Array.isArray(st.prog) && st.prog.length ? st.prog : [0, 5, 3, 6];
      const progRate = Math.max(1, st.progRate | 0);

      const chordIndexNow = Math.floor(col / progRate) % prog.length;
      const chordDegreeNow = ((prog[chordIndexNow] | 0) % 7 + 7) % 7;

      const oldCol = getOldColIndex(col);
      const chordIndexOld = Math.floor(oldCol / progRate) % prog.length;
      const chordDegreeOld = ((prog[chordIndexOld] | 0) % 7 + 7) % 7;

      const degreesCount = 7 * clamp(st.octaveSpan ?? 4, 1, 7);
      const scaleMidi = buildScaleMidi({
        rootPc: clamp(st.keyRoot ?? 0, 0, 11),
        scaleName: st.scaleName,
        baseMidi: clamp(st.baseMidi ?? 36, 12, 60),
        degreesCount,
      });

      const chordTonesNow = degreeToChordTones(scaleMidi, chordDegreeNow, st.chordType === "triad" ? "triad" : "7");
      const chordTonesOld = degreeToChordTones(scaleMidi, chordDegreeOld, st.chordType === "triad" ? "triad" : "7");

      // percussion scale set
      const percDegreesCount = 7 * clamp(st.percOctaveSpan ?? 3, 1, 7);
      const percScaleMidi = buildScaleMidi({
        rootPc: clamp(st.keyRoot ?? 0, 0, 11),
        scaleName: st.scaleName,
        baseMidi: clamp(st.percBaseMidi ?? 24, 0, 72),
        degreesCount: percDegreesCount,
      });

      const re = isSwiss ? rowEdgesRef.current || Array.from({ length: rows + 1 }, (_, i) => i / rows) : null;
      const avgRowH = isSwiss ? 1 / rows : 1;

      // Only play if audio exists and is resumed
      const A = audioRef.current;
      const canPlay = !!A.ac && A.ac.state === "running";
      if (canPlay) {
        ensureVoices();
        updateAudioParamsRealtime();
      }

      // ===== MELODY
      if (st.soundOn && canPlay) {
        const hits = [];
        const maxNotes = clamp(st.maxNotesPerStep ?? 10, 1, 32);

        for (let r = 0; r < rows; r++) {
          const idx = r * cols + col;
          const cell = melMap.get(idx);
          const paintObj = cell?.paint;
          if (!paintObj?.color) continue;
          if (typeof cell.expiresAt === "number" && cell.expiresAt <= nowS) continue;

          const rgb = hexToRgb(paintObj.color);
          if (!rgb) continue;

          const lum = luminance01(rgb);
          const h = hue01(rgb);

          const rowNormNow = rows <= 1 ? 0.5 : 1 - r / (rows - 1);

          const oldR = getOldRowIndex(r);
          const oldRows =
            prevSnap
              ? prevSnap.pat === "swiss-grid"
                ? Math.max(1, prevSnap.rows | 0)
                : Math.max(1, prevSnap.charEffRows | 0)
              : rows;

          const rowNormOld = oldRows <= 1 ? 0.5 : 1 - oldR / (oldRows - 1);

          let laneNow = 0;
          let laneOld = 0;
          if (st.laneMode === "hue") {
            laneNow = clamp(Math.floor(h * chordTonesNow.length), 0, chordTonesNow.length - 1);
            laneOld = clamp(Math.floor(h * chordTonesOld.length), 0, chordTonesOld.length - 1);
          } else {
            laneNow = col % chordTonesNow.length;
            laneOld = oldCol % chordTonesOld.length;
          }

          const degIdxNow = clamp(Math.round(rowNormNow * (degreesCount - 1)), 0, degreesCount - 1);
          const rowMidiNow = scaleMidi[degIdxNow];

          const degIdxOld = clamp(Math.round(rowNormOld * (degreesCount - 1)), 0, degreesCount - 1);
          const rowMidiOld = scaleMidi[degIdxOld];

          let targetNow = chordTonesNow[laneNow];
          while (targetNow < rowMidiNow - 6) targetNow += 12;
          while (targetNow > rowMidiNow + 6) targetNow -= 12;

          let targetOld = chordTonesOld[laneOld];
          while (targetOld < rowMidiOld - 6) targetOld += 12;
          while (targetOld > rowMidiOld + 6) targetOld -= 12;

          const fNow = midiToFreq(targetNow);
          const fOld = midiToFreq(targetOld);
          const freq = morph < 1 ? blendFreq(fOld, fNow) : fNow;

          const vel = st.velFrom === "fixed" ? 0.55 : clamp(0.08 + 0.92 * lum, 0.05, 1);
          const cutoff = (st.cutoffBase ?? 400) + (st.cutoffSpan ?? 7200) * clamp(0.15 + 0.85 * lum, 0, 1);

          let attack = (st.atkBase ?? 0.008) + (st.atkSpan ?? 0.09) * clamp(1 - rowNormNow, 0, 1);
          let decay = (st.decBase ?? 0.08) + (st.decSpan ?? 0.65) * clamp(lum, 0, 1);
          let release = (st.relBase ?? 0.06) + (st.relSpan ?? 0.85) * clamp(rowNormNow, 0, 1);

          if (isSwiss && st.varRowsOn && re) {
            const rh = (re[r + 1] ?? (r + 1) / rows) - (re[r] ?? r / rows);
            const ratio = clamp(rh / avgRowH, 0.35, 2.4);
            const tailMul = clamp(ratio, 0.55, 1.9);
            decay *= tailMul;
            release *= tailMul;
            attack *= clamp(1.25 - (tailMul - 1) * 0.4, 0.5, 1.4);
          }

          attack = clamp(attack, 0.002, 0.25);
          decay = clamp(decay, 0.03, 2.8);
          release = clamp(release, 0.03, 2.8);

          hits.push({ freq, vel, cutoff, attack, decay, release, score: vel });
        }

        hits.sort((a, b) => b.score - a.score);
        const chosen = hits.slice(0, Math.min(maxNotes, hits.length));

        const pool = A.voices;
        for (const h of chosen) {
          const v = pool[A.voicePtr % pool.length];
          A.voicePtr++;
          triggerVoice(A.ac, v, {
            freq: h.freq,
            vel: h.vel,
            cutoffHz: h.cutoff,
            attack: h.attack,
            decaySec: h.decay,
            release: h.release,
            oscType: st.melodyOsc ?? "triangle",
          });
        }
      }

      // ===== PERCUSSION (UPDATED: attack/decay/level shaping)
      if (st.percOn && canPlay) {
        const hits = [];
        const maxHits = clamp(st.percMaxHitsPerStep ?? 8, 1, 32);

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

          const kit = st.percKit ?? "classic";
          const acoustic = kit === "acoustic";

          const type =
            kit === "classic" || kit === "acoustic"
              ? h < 0.33
                ? "kick"
                : h < 0.66
                ? "snare"
                : "hat"
              : kit === "wood"
              ? h < 0.33
                ? "wood"
                : h < 0.66
                ? "rim"
                : "shaker"
              : h < 0.33
              ? "tom"
              : h < 0.66
              ? "snare"
              : "shaker";

          const rowNormNow = rows <= 1 ? 0.5 : 1 - r / (rows - 1);

          const oldR = getOldRowIndex(r);
          const oldRows =
            prevSnap
              ? prevSnap.pat === "swiss-grid"
                ? Math.max(1, prevSnap.rows | 0)
                : Math.max(1, prevSnap.charEffRows | 0)
              : rows;
          const rowNormOld = oldRows <= 1 ? 0.5 : 1 - oldR / (oldRows - 1);

          const degIdxNow = clamp(Math.round(rowNormNow * (percDegreesCount - 1)), 0, percDegreesCount - 1);
          const degIdxOld = clamp(Math.round(rowNormOld * (percDegreesCount - 1)), 0, percDegreesCount - 1);

          let midiNow = percScaleMidi[degIdxNow];
          let midiOld = percScaleMidi[degIdxOld];

          const wig = Math.round((h - 0.5) * 4);
          midiNow = percScaleMidi[clamp(degIdxNow + wig, 0, percDegreesCount - 1)] ?? midiNow;
          midiOld = percScaleMidi[clamp(degIdxOld + wig, 0, percDegreesCount - 1)] ?? midiOld;

          midiNow = quantizeToScale(midiNow, percScaleMidi);
          midiOld = quantizeToScale(midiOld, percScaleMidi);

          const fNow = midiToFreq(midiNow);
          const fOld = midiToFreq(midiOld);
          const freq = morph < 1 ? blendFreq(fOld, fNow) : fNow;

          const vel = clamp(0.12 + 0.88 * lum, 0.05, 1);

          // NEW: perc envelope params (like melody shaping)
          let level = (st.percLevelBase ?? 1.0) + (st.percLevelSpan ?? 0.75) * clamp(lum, 0, 1);
          let attack = (st.percAtkBase ?? 0.0015) + (st.percAtkSpan ?? 0.018) * clamp(1 - rowNormNow, 0, 1);
          let decay =
            (st.percDecBase ?? 0.10) +
            (st.percDecSpan ?? 0.50) * clamp((1 - rowNormNow) * 0.7 + lum * 0.5, 0, 1);

          if (isSwiss && st.varRowsOn && re) {
            const rh = (re[r + 1] ?? (r + 1) / rows) - (re[r] ?? r / rows);
            const ratio = clamp(rh / avgRowH, 0.35, 2.4);
            decay *= clamp(ratio, 0.65, 1.7);
            // a tiny compensation: denser rows feel more “snappy”
            attack *= clamp(1.2 - (ratio - 1) * 0.25, 0.6, 1.4);
          }

          attack = clamp(attack, 0.0005, 0.08);
          decay = clamp(decay, 0.03, 1.7) * (acoustic ? 1.15 : 1);
          level = clamp(level, 0, 2.5);

          hits.push({
            type,
            freq,
            vel,
            level,
            attack,
            decay,
            tone: clamp(st.percTone ?? 0.45, 0, 1),
            punch: clamp(st.percPunch ?? 0.7, 0, 1) * (acoustic ? 0.92 : 1),
            bright: clamp((st.percBright ?? 0.55) * (0.6 + lum * 0.6), 0, 1),
            driveAmt: clamp(st.percDrive ?? 0.08, 0, 1) * (acoustic ? 0.35 : 1),
            acoustic,
            score: vel,
          });
        }

        hits.sort((a, b) => b.score - a.score);
        const chosen = hits.slice(0, Math.min(maxHits, hits.length));

        for (const h of chosen) {
          triggerPerc(A.ac, A.percBus, {
            type: h.type,
            freq: h.freq,
            vel: h.vel,
            level: h.level,
            attack: h.attack,
            decay: h.decay,
            tone: h.tone,
            punch: h.punch,
            bright: h.bright,
            driveAmt: h.driveAmt,
            acoustic: h.acoustic,
          });
        }
      }

      audioRef.current.step++;
      audioRef.current.timer = setTimeout(tick, Math.max(10, stepSec * 1000));
    };

    const A = audioRef.current;
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
======================= */
  const [midiSupported, setMidiSupported] = React.useState(false);
  const [midiInputs, setMidiInputs] = React.useState([]);
  const [midiInputId, setMidiInputId] = React.useState("");
  const midiAccessRef = React.useRef(null);
  const midiActiveRef = React.useRef(new Map());

  const midiToColor = React.useCallback((note, vel01, durSec) => {
    const h = clamp(note / 127, 0, 1);
    const s2 = clamp(0.25 + vel01 * 0.7, 0, 1);
    const l2 = clamp(0.18 + vel01 * 0.55 + clamp(durSec / 2.5, 0, 1) * 0.12, 0, 1);
    return rgbToHex(hslToRgb(h, s2, l2));
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

      const { idx } = midiNoteToCell(note);
      const color = midiToColor(note, vel01, 0);
      const expiresAt = nowS + clamp(st.midiFadeMin ?? 0.25, 0.05, 6);

      upsertCellLayer("melody", idx, {
        paint: { mode: "color", color },
        midi: { note, vel: vel01, ch, t0: nowS, dur: 0 },
        expiresAt,
      });

      midiActiveRef.current.set(`${note}:${ch}`, { t0: nowS, vel01, note, ch, idx });
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
          (st.midiFadeMax ?? 2.5 - (st.midiFadeMin ?? 0.25)) * clamp(dur / 2.0, 0, 1),
        0.05,
        8
      );
      const expiresAt = nowS + fade;

      upsertCellLayer("melody", entry.idx, {
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

    const A = audioRef.current.ac ? audioRef.current : ensureAudio();
    const ac = A.ac;
    if (!ac || ac.state !== "running") return;

    ensureVoices();
    updateAudioParamsRealtime();

    const vel01 = clamp(vel / 127, 0.05, 1);

    let midi = note;

    if (st.midiQuantizeToScale) {
      const degreesCount = 7 * clamp(st.octaveSpan ?? 4, 1, 7);
      const scaleMidi = buildScaleMidi({
        rootPc: clamp(st.keyRoot ?? 0, 0, 11),
        scaleName: st.scaleName,
        baseMidi: clamp(st.baseMidi ?? 36, 12, 60),
        degreesCount,
      });

      const candidates = [];
      for (let k = -6; k <= 6; k++) {
        for (const m of scaleMidi) candidates.push(m + 12 * k);
      }
      candidates.sort((a, b) => a - b);
      midi = quantizeToScale(midi, candidates);
    }

    const freq = midiToFreq(midi);

    const attack = 0.002 + (1 - vel01) * 0.01;
    const decay = 0.07 + vel01 * 0.25;
    const release = 0.09 + (1 - vel01) * 0.22;

    const cutoff = (st.cutoffBase ?? 400) + (st.cutoffSpan ?? 7200) * clamp(0.25 + vel01 * 0.75, 0, 1);

    const v = A.voices[A.voicePtr % A.voices.length];
    A.voicePtr++;
    triggerVoice(ac, v, { freq, vel: vel01, cutoffHz: cutoff, attack, decaySec: decay, release, oscType: st.melodyOsc ?? "triangle" });
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

    const st = sRef.current;

    if (st.pat === "swiss-grid") {
      const cols = st.cols;
      const rows = st.rows;
      const col = idx % st.cols;
      const row = Math.floor(idx / st.cols);
      const t = performance.now() * 0.001;
      applyPaintToIdx(idx, row, col, t, rows, cols);
    } else {
      const CE = charEdgesRef.current;
      const cols = CE?.cols ?? 16;
      const rows = CE?.rows ?? 12;
      const col = idx % cols;
      const row = Math.floor(idx / cols);
      const t = performance.now() * 0.001;
      applyPaintToIdx(idx, row, col, t, rows, cols);
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
      const cols = st.cols;
      const rows = st.rows;
      const col = idx % st.cols;
      const row = Math.floor(idx / st.cols);
      const t = performance.now() * 0.001;
      applyPaintToIdx(idx, row, col, t, rows, cols);
    } else {
      const CE = charEdgesRef.current;
      const cols = CE?.cols ?? 16;
      const rows = CE?.rows ?? 12;
      const col = idx % cols;
      const row = Math.floor(idx / cols);
      const t = performance.now() * 0.001;
      applyPaintToIdx(idx, row, col, t, rows, cols);
    }
  };

  const onPointerUp = () => setDrawing(false);

  /* =======================
     Render loop
======================= */
  const getFontFamily = () =>
    `system-ui, -apple-system, Segoe UI, Roboto, Helvetica, Arial, "Apple Color Emoji", "Segoe UI Emoji"`;

  const render = (tm) => {
    const cv = canvasRef.current;
    if (!cv) return;
    const ctx = cv.getContext("2d");
    const w = cv.width,
      h = cv.height;

    ctx.clearRect(0, 0, w, h);

    const bg = isDark ? "#0B0B0C" : "#FAFAFA";
    const gridLine = isDark ? "#1F2023" : "#E6E6E6";
    const gridLineChar = isDark ? "#1F2023" : "#EAEAEA";
    const baseText = isDark ? "#EDEDED" : "#111111";
    const paintedText = "#0A0A0A";

    ctx.fillStyle = bg;
    ctx.fillRect(0, 0, w, h);

    const t = tm * 0.001;
    const nowS = performance.now() * 0.001;

    const melMap = new Map();
    const percMap = new Map();
    for (const c of cellsMel) melMap.set(c.idx, c);
    for (const c of cellsPerc) percMap.set(c.idx, c);

    const drawGrid = () => {
      if (!s.gridLines) return;

      if (s.pat === "char-grid") {
        const CE = charEdgesRef.current;
        const cols = CE?.cols ?? 16;
        const rows = CE?.rows ?? 12;
        const ce = CE?.ce ?? Array.from({ length: cols + 1 }, (_, i) => i / cols);
        const re = CE?.re ?? Array.from({ length: rows + 1 }, (_, i) => i / rows);

        ctx.save();
        ctx.strokeStyle = gridLineChar;
        ctx.lineWidth = 1;

        for (let c = 0; c <= cols; c++) {
          const x = (ce[c] ?? c / cols) * w;
          ctx.beginPath();
          ctx.moveTo(x, 0);
          ctx.lineTo(x, h);
          ctx.stroke();
        }
        for (let r = 0; r <= rows; r++) {
          const y = (re[r] ?? r / rows) * h;
          ctx.beginPath();
          ctx.moveTo(0, y);
          ctx.lineTo(w, y);
          ctx.stroke();
        }
        ctx.restore();
      } else {
        const cols = Math.max(1, s.cols | 0);
        const rows = Math.max(1, s.rows | 0);
        const ce = colEdges || Array.from({ length: cols + 1 }, (_, i) => i / cols);
        const re = rowEdges || Array.from({ length: rows + 1 }, (_, i) => i / rows);

        ctx.save();
        ctx.strokeStyle = gridLine;
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
    };

    const charSpeed = (() => {
      const base = s.charSpd ?? 2;
      if (!s.charFollowBpm) return base;
      return base * (clamp(s.bpm ?? 120, 30, 260) / 120);
    })();

    const drawLayerCells = (map, alphaMul) => {
      ctx.textAlign = "center";
      ctx.textBaseline = "middle";

      const chs = (s.chars || "01").split("");
      const spd = charSpeed * (s.pat === "char-grid" ? 0.9 : 0.85);

      if (s.pat === "char-grid") {
        const CE = charEdgesRef.current;
        const cols = CE?.cols ?? 16;
        const rows = CE?.rows ?? 12;

        for (let r = 0; r < rows; r++) {
          for (let c = 0; c < cols; c++) {
            const idx = r * cols + c;
            const g = charCellGeom(r, c, w, h);

            const entry = map.get(idx);
            const col = entry?.paint?.color;

            let a = 1;
            if (entry?.expiresAt != null) {
              const rem = entry.expiresAt - nowS;
              if (rem <= 0) continue;
              a = clamp(rem / 0.35, 0, 1);
            }

            if (col) {
              ctx.save();
              ctx.globalAlpha = 0.92 * a * alphaMul;
              ctx.fillStyle = col;
              ctx.fillRect(g.x, g.y, g.w, g.h);
              ctx.restore();
            }

            const gi = chs.length ? Math.floor((t * spd + r * 0.07 + c * 0.05) * 3) % chs.length : 0;

            // FIX: use s.charSz (but still clamp to cell)
            const maxCell = Math.max(8, Math.min(g.w, g.h) * 0.9);
            const sz = clamp(s.charSz ?? 22, 6, maxCell);

            ctx.save();
            ctx.globalAlpha = alphaMul * (col ? 1 : 0.95);
            ctx.font = `${Math.floor(sz)}px ${getFontFamily()}`;
            ctx.fillStyle = col ? paintedText : baseText;
            ctx.fillText(chs[gi] ?? "0", g.cx, g.cy);
            ctx.restore();
          }
        }
      } else {
        const cols = Math.max(1, s.cols | 0);
        const rows = Math.max(1, s.rows | 0);

        for (let r = 0; r < rows; r++) {
          for (let c = 0; c < cols; c++) {
            const idx = r * cols + c;
            const g = swissCellGeom(r, c, w, h);

            const entry = map.get(idx);
            const col = entry?.paint?.color;

            let a = 1;
            if (entry?.expiresAt != null) {
              const rem = entry.expiresAt - nowS;
              if (rem <= 0) continue;
              a = clamp(rem / 0.35, 0, 1);
            }

            if (col) {
              ctx.save();
              ctx.globalAlpha = 0.92 * a * alphaMul;
              ctx.fillStyle = col;
              ctx.fillRect(g.x, g.y, g.w, g.h);
              ctx.restore();
            }

            const gi = chs.length ? Math.floor((t * spd + r * 0.09 + c * 0.05) * 3) % chs.length : 0;
            const sz = Math.max(8, Math.min(g.w, g.h) * 0.55 * (s.swissCharScale ?? 1));

            ctx.save();
            ctx.globalAlpha = alphaMul * (col ? 1 : 0.95);
            ctx.font = `${Math.floor(sz)}px ${getFontFamily()}`;
            ctx.fillStyle = col ? paintedText : baseText;
            ctx.fillText(chs[gi] ?? "0", g.cx, g.cy);
            ctx.restore();
          }
        }
      }
    };

    drawGrid();

    if (layerView === "ghost") {
      if (activeLayer === "melody") {
        drawLayerCells(melMap, 1.0);
        drawLayerCells(percMap, clamp(ghostOpacity, 0, 1));
      } else {
        drawLayerCells(percMap, 1.0);
        drawLayerCells(melMap, clamp(ghostOpacity, 0, 1));
      }
      return;
    }

    if (layerView === "both") {
      if (activeLayer === "melody") {
        drawLayerCells(percMap, 0.78);
        drawLayerCells(melMap, 1.0);
      } else {
        drawLayerCells(melMap, 0.78);
        drawLayerCells(percMap, 1.0);
      }
      return;
    }

    if (activeLayer === "melody") drawLayerCells(melMap, 1.0);
    else drawLayerCells(percMap, 1.0);
  };

  React.useEffect(() => {
    const loop = (t) => {
      render(t);
      rafRef.current = requestAnimationFrame(loop);
    };
    rafRef.current = requestAnimationFrame(loop);
    return () => cancelAnimationFrame(rafRef.current);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [s, cellsMel, cellsPerc, colEdges, rowEdges, activeLayer, layerView, ghostOpacity, isDark]);

  // resize canvas
  React.useEffect(() => {
    const rsz = () => {
      const cv = canvasRef.current;
      if (!cv) return;
      cv.width = Math.max(1, Math.floor(cv.offsetWidth));
      cv.height = Math.max(1, Math.floor(cv.offsetHeight));
      canvasPxRef.current = { w: cv.width, h: cv.height };
    };
    rsz();
    window.addEventListener("resize", rsz);
    window.addEventListener("orientationchange", rsz);
    return () => {
      window.removeEventListener("resize", rsz);
      window.removeEventListener("orientationchange", rsz);
    };
  }, []);

  /* =======================
     UI helpers
======================= */
  const keyName = NOTE_NAMES[s.keyRoot] ?? "C";

  const shellBg = isDark ? "bg-neutral-950" : "bg-white";
  const panelBg = isDark
    ? "bg-neutral-950 border-neutral-800 text-neutral-100"
    : "bg-neutral-50 border-neutral-200 text-neutral-900";
  const inputBg = isDark ? "bg-neutral-900 border-neutral-700 text-neutral-100" : "bg-white border-neutral-300 text-neutral-900";
  const subtleText = isDark ? "text-neutral-300" : "text-neutral-600";
  const buttonPrimary = isDark ? "bg-white text-black hover:bg-neutral-200" : "bg-black text-white hover:bg-neutral-800";
  const buttonDark = isDark ? "bg-neutral-100 text-black hover:bg-white" : "bg-neutral-900 text-white hover:bg-black";
  const buttonMuted = isDark ? "bg-neutral-800 text-neutral-100" : "bg-neutral-200 text-neutral-700";

  // progression helpers
  const progStr = (Array.isArray(s.prog) ? s.prog : [0, 5, 3, 6]).join(",");

  const setProgFromString = (str) => {
    const parts = String(str)
      .split(/[,\s]+/)
      .map((x) => x.trim())
      .filter(Boolean)
      .map((x) => parseInt(x, 10))
      .filter((n) => Number.isFinite(n));
    const cleaned = parts.length ? parts.map((n) => clamp(n, -20, 20)) : [0, 5, 3, 6];
    setS((p) => ({ ...p, prog: cleaned }));
  };

  const PROG_PRESETS = {
    "i–VI–III–VII": [0, 5, 3, 6],
    "i–VII–VI–VII": [0, 6, 5, 6],
    "i–iv–v–i": [0, 3, 4, 0],
    "i–VI–VII–i": [0, 5, 6, 0],
    "vi–IV–I–V (major)": [5, 3, 0, 4],
    "I–V–vi–IV (major)": [0, 4, 5, 3],
    "ii–V–I–vi (major-ish)": [1, 4, 0, 5],
    "i–bVII–bVI–V (minor)": [0, 6, 5, 4],
    "i–iv–VI–V": [0, 3, 5, 4],
    "I–iii–IV–V (major)": [0, 2, 3, 4],
  };

  const setProgressionPreset = (name) => {
    const next = PROG_PRESETS[name] ?? [0, 5, 3, 6];
    setS((p) => ({ ...p, prog: next }));
  };

  const randomizeProgression = () => {
    const keys = Object.keys(PROG_PRESETS);
    const pick = keys[Math.floor(Math.random() * keys.length)];
    setProgressionPreset(pick);
  };

  return (
    <div className={`w-full h-[100svh] ${shellBg} flex flex-col md:flex-row overflow-hidden`}>
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
        {/* top row */}
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
              const cv = canvasRef.current;
              if (!cv) return;
              const l = document.createElement("a");
              l.download = "pattern.png";
              l.href = cv.toDataURL("image/png");
              l.click();
            }}
            className={`flex-1 flex justify-center px-4 py-2.5 rounded-lg font-medium min-h-[44px] ${buttonPrimary}`}
            title="Download PNG"
          >
            <Download size={16} />
          </button>
        </div>

        {/* theme + audio */}
        <div className="flex gap-2">
          <button
            onClick={unlockAudio}
            className={`flex-1 px-4 py-2.5 rounded-lg font-medium min-h-[44px] ${buttonDark}`}
          >
            Enable Audio
          </button>

          <button
            onClick={() => setTheme((t) => (t === "dark" ? "light" : "dark"))}
            className={`px-3 py-2.5 rounded-lg font-semibold min-h-[44px] ${buttonMuted}`}
            title="Toggle dark mode"
          >
            {isDark ? <Sun size={16} /> : <Moon size={16} />}
          </button>
        </div>

        {/* Pattern */}
        <div className="space-y-2">
          <label className="block text-xs font-semibold uppercase tracking-wider">Pattern</label>
          <select
            value={s.pat}
            onChange={(e) => setS((p) => ({ ...p, pat: e.target.value }))}
            className={`w-full px-3 py-2 border rounded-lg ${inputBg}`}
          >
            <option value="swiss-grid">Swiss Grid</option>
            <option value="char-grid">Character Grid</option>
          </select>

          <div className="space-y-1">
            <div className={`text-xs ${subtleText}`}>Grid-change smoothing: {s.morphSec.toFixed(2)}s</div>
            <input
              type="range"
              min="0.05"
              max="1.5"
              step="0.05"
              value={s.morphSec}
              onChange={(e) => setS((p) => ({ ...p, morphSec: parseFloat(e.target.value) }))}
              className="w-full"
            />
          </div>
        </div>

        {/* Layer controls */}
        <div className="space-y-2">
          <label className="block text-xs font-semibold uppercase tracking-wider">Layer</label>

          <div className="grid grid-cols-2 gap-2">
            <button
              onClick={() => setActiveLayer("melody")}
              className={`px-3 py-2 rounded-lg border text-xs font-semibold min-h-[44px] flex items-center justify-center gap-2 ${
                activeLayer === "melody"
                  ? isDark
                    ? "bg-white text-black border-white"
                    : "bg-black text-white border-black"
                  : inputBg
              }`}
            >
              <Layers size={14} />
              Melody
            </button>
            <button
              onClick={() => setActiveLayer("perc")}
              className={`px-3 py-2 rounded-lg border text-xs font-semibold min-h-[44px] flex items-center justify-center gap-2 ${
                activeLayer === "perc"
                  ? isDark
                    ? "bg-white text-black border-white"
                    : "bg-black text-white border-black"
                  : inputBg
              }`}
            >
              <Layers size={14} />
              Perc
            </button>
          </div>

          <div className="grid grid-cols-2 gap-2">
            <div className="space-y-1">
              <div className={`text-xs ${subtleText}`}>View</div>
              <select
                value={layerView}
                onChange={(e) => setLayerView(e.target.value)}
                className={`w-full px-2 py-2 border rounded-lg text-xs ${inputBg}`}
              >
                <option value="both">Both</option>
                <option value="active">Active only</option>
                <option value="ghost">Ghost other</option>
              </select>
            </div>
            <div className="space-y-1">
              <div className={`text-xs ${subtleText}`}>Ghost</div>
              <input
                type="range"
                min="0"
                max="0.8"
                step="0.01"
                value={ghostOpacity}
                onChange={(e) => setGhostOpacity(parseFloat(e.target.value))}
                className="w-full"
                disabled={layerView !== "ghost"}
              />
            </div>
          </div>

          <div className={`text-[11px] ${subtleText}`}>
            Paint into the <b>active</b> layer. Use <b>Ghost other</b> to trace without switching.
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
              className={`h-10 w-14 rounded-md border ${isDark ? "border-neutral-700 bg-neutral-900" : "border-neutral-300 bg-white"}`}
              title="Pick color"
            />

            <button
              onClick={() => setPaint((p) => ({ ...p, useSeq: !p.useSeq, mode: "color" }))}
              className={`flex-1 px-3 py-2 rounded-lg border text-xs font-semibold flex items-center justify-center gap-2 min-h-[44px] ${
                paint.useSeq
                  ? isDark
                    ? "bg-white text-black border-white"
                    : "bg-black text-white border-black"
                  : inputBg
              }`}
            >
              <Palette size={14} />
              {paint.useSeq ? "Color String ON" : "Color String OFF"}
            </button>

            <button
              onClick={() => setPaint((p) => ({ ...p, mode: p.mode === "none" ? "color" : "none" }))}
              className={`px-3 py-2 rounded-lg text-xs font-semibold min-h-[44px] ${
                paint.mode === "none"
                  ? isDark
                    ? "bg-white text-black"
                    : "bg-black text-white"
                  : buttonMuted
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
                className={`h-9 w-full rounded-md border ${isDark ? "border-neutral-700 bg-neutral-900" : "border-neutral-300 bg-white"}`}
                title={`Color String ${i + 1}`}
              />
            ))}
          </div>

          <button onClick={clearPaint} className={`w-full px-4 py-2.5 rounded-lg font-medium min-h-[44px] ${buttonDark}`}>
            Clear Active Layer
          </button>

          <div className="space-y-1 pt-2">
            <div className={`text-xs ${subtleText}`}>Audition on paint</div>
            <button
              onClick={() => setS((p) => ({ ...p, auditionOnPaint: !p.auditionOnPaint }))}
              className={`px-3 py-2 rounded-lg border text-xs font-semibold min-h-[44px] ${
                s.auditionOnPaint
                  ? isDark
                    ? "bg-white text-black border-white"
                    : "bg-black text-white border-black"
                  : inputBg
              }`}
            >
              {s.auditionOnPaint ? "ON" : "OFF"}
            </button>
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

            <label className="block text-xs font-semibold uppercase tracking-wider">Variable Grid Density</label>

            <div className={`rounded-lg border p-3 space-y-2 ${isDark ? "border-neutral-800 bg-neutral-900" : "border-neutral-200 bg-white"}`}>
              <div className="flex items-center justify-between">
                <div className="text-xs font-semibold uppercase tracking-wider">Columns (rhythm)</div>
                <button
                  onClick={() => setS((p) => ({ ...p, varColsOn: !p.varColsOn }))}
                  className={`p-1.5 rounded ${s.varColsOn ? (isDark ? "bg-white text-black" : "bg-black text-white") : buttonMuted}`}
                >
                  {s.varColsOn ? <Play size={14} fill={isDark ? "black" : "white"} /> : <Square size={14} />}
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
                </>
              )}
            </div>

            <div className={`rounded-lg border p-3 space-y-2 ${isDark ? "border-neutral-800 bg-neutral-900" : "border-neutral-200 bg-white"}`}>
              <div className="flex items-center justify-between">
                <div className="text-xs font-semibold uppercase tracking-wider">Rows (tails)</div>
                <button
                  onClick={() => setS((p) => ({ ...p, varRowsOn: !p.varRowsOn }))}
                  className={`p-1.5 rounded ${s.varRowsOn ? (isDark ? "bg-white text-black" : "bg-black text-white") : buttonMuted}`}
                >
                  {s.varRowsOn ? <Play size={14} fill={isDark ? "black" : "white"} /> : <Square size={14} />}
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
                </>
              )}
            </div>
          </div>
        )}

        {s.pat === "char-grid" && (
          <div className="space-y-2">
            <label className="block text-xs font-semibold uppercase tracking-wider">Spacing (base): {s.space}px</label>
            <input
              type="range"
              min="12"
              max="120"
              value={s.space}
              onChange={(e) => setS((p) => ({ ...p, space: parseInt(e.target.value, 10) }))}
              className="w-full"
            />

            <div className={`rounded-lg border p-3 space-y-2 ${isDark ? "border-neutral-800 bg-neutral-900" : "border-neutral-200 bg-white"}`}>
              <div className="flex items-center justify-between">
                <div className="text-xs font-semibold uppercase tracking-wider">Rows & Cols controls</div>
                <button
                  onClick={() => setS((p) => ({ ...p, charUseDims: !p.charUseDims }))}
                  className={`p-1.5 rounded ${s.charUseDims ? (isDark ? "bg-white text-black" : "bg-black text-white") : buttonMuted}`}
                  title="Use desired rows/cols"
                >
                  {s.charUseDims ? <Play size={14} fill={isDark ? "black" : "white"} /> : <Square size={14} />}
                </button>
              </div>

              <div className={`text-[11px] ${subtleText}`}>
                When ON, grid uses target <b>Cols × Rows</b>. Density warping still works.
              </div>

              <label className="block text-xs font-semibold uppercase tracking-wider">Cols: {s.charCols}</label>
              <input
                type="range"
                min="4"
                max="80"
                value={s.charCols}
                onChange={(e) => setS((p) => ({ ...p, charCols: parseInt(e.target.value, 10) }))}
                className="w-full"
                disabled={!s.charUseDims}
              />

              <label className="block text-xs font-semibold uppercase tracking-wider">Rows: {s.charRows}</label>
              <input
                type="range"
                min="4"
                max="80"
                value={s.charRows}
                onChange={(e) => setS((p) => ({ ...p, charRows: parseInt(e.target.value, 10) }))}
                className="w-full"
                disabled={!s.charUseDims}
              />
            </div>

            {/* ... your existing char-grid density + char settings remain unchanged ... */}

            <label className="block text-xs font-semibold uppercase tracking-wider">Char Size: {s.charSz}px</label>
            <input type="range" min="8" max="80" value={s.charSz} onChange={(e) => setS((p) => ({ ...p, charSz: parseInt(e.target.value, 10) }))} className="w-full" />

            <label className="block text-xs font-semibold uppercase tracking-wider">Char Speed: {s.charSpd.toFixed(2)}×</label>
            <input type="range" min="0" max="10" step="0.1" value={s.charSpd} onChange={(e) => setS((p) => ({ ...p, charSpd: parseFloat(e.target.value) }))} className="w-full" />

            <button
              onClick={() => setS((p) => ({ ...p, charFollowBpm: !p.charFollowBpm }))}
              className={`px-3 py-2 rounded-lg border text-xs font-semibold min-h-[44px] ${
                s.charFollowBpm
                  ? isDark
                    ? "bg-white text-black border-white"
                    : "bg-black text-white border-black"
                  : inputBg
              }`}
            >
              Char speed follows BPM
            </button>

            <label className="block text-xs font-semibold uppercase tracking-wider">Characters</label>
            <input
              type="text"
              value={s.chars}
              onChange={(e) => setS((p) => ({ ...p, chars: e.target.value }))}
              className={`w-full px-3 py-2 border rounded-lg font-mono ${inputBg}`}
            />
          </div>
        )}

        {/* Volumes */}
        <div className="space-y-2">
          <label className="block text-xs font-semibold uppercase tracking-wider">Volumes</label>
          <div className="space-y-1">
            <div className={`text-xs ${subtleText}`}>Melody: {s.melodyVol.toFixed(2)}</div>
            <input type="range" min="0" max="1.5" step="0.01" value={s.melodyVol} onChange={(e) => setS((p) => ({ ...p, melodyVol: parseFloat(e.target.value) }))} className="w-full" />
          </div>
          <div className="space-y-1">
            <div className={`text-xs ${subtleText}`}>Perc: {s.percVol.toFixed(2)}</div>
            <input type="range" min="0" max="1.5" step="0.01" value={s.percVol} onChange={(e) => setS((p) => ({ ...p, percVol: parseFloat(e.target.value) }))} className="w-full" />
          </div>
        </div>

        {/* Melody (unchanged from your version) */}
        {/* ... keep your Melody section exactly as-is ... */}

        {/* Percussion (UPDATED UI: shaping sliders added) */}
        <div className="space-y-2">
          <div className="flex items-center justify-between">
            <label className="text-xs font-semibold uppercase tracking-wider">Percussion</label>
            <button
              onClick={() => setS((p) => ({ ...p, percOn: !p.percOn }))}
              className={`p-1.5 rounded ${s.percOn ? (isDark ? "bg-white text-black" : "bg-black text-white") : buttonMuted}`}
            >
              {s.percOn ? <Play size={14} fill={isDark ? "black" : "white"} /> : <Square size={14} />}
            </button>
          </div>

          <div className="space-y-1">
            <div className={`text-xs ${subtleText}`}>Kit</div>
            <select value={s.percKit} onChange={(e) => setS((p) => ({ ...p, percKit: e.target.value }))} className={`w-full px-2 py-2 border rounded-lg text-xs ${inputBg}`}>
              <option value="classic">Classic (kick/snare/hat)</option>
              <option value="acoustic">Acoustic (softer/woodier)</option>
              <option value="wood">Wood (wood/rim/shaker)</option>
              <option value="soft">Soft (tom/snare/shaker)</option>
            </select>
          </div>

          <label className="block text-xs font-semibold uppercase tracking-wider">Max hits / step: {s.percMaxHitsPerStep}</label>
          <input type="range" min="1" max="24" value={s.percMaxHitsPerStep} onChange={(e) => setS((p) => ({ ...p, percMaxHitsPerStep: parseInt(e.target.value, 10) }))} className="w-full" />

          {/* NEW: Perc shaping panel */}
          <div className={`rounded-lg border p-3 space-y-2 ${isDark ? "border-neutral-800 bg-neutral-900" : "border-neutral-200 bg-white"}`}>
            <div className="text-xs font-semibold uppercase tracking-wider">Perc shaping</div>

            <div className="space-y-1">
              <div className={`text-xs ${subtleText}`}>Level base: {s.percLevelBase.toFixed(2)}×</div>
              <input type="range" min="0" max="2.5" step="0.01" value={s.percLevelBase} onChange={(e) => setS((p) => ({ ...p, percLevelBase: parseFloat(e.target.value) }))} className="w-full" />
            </div>
            <div className="space-y-1">
              <div className={`text-xs ${subtleText}`}>Level span: {s.percLevelSpan.toFixed(2)}×</div>
              <input type="range" min="0" max="2.5" step="0.01" value={s.percLevelSpan} onChange={(e) => setS((p) => ({ ...p, percLevelSpan: parseFloat(e.target.value) }))} className="w-full" />
            </div>

            <div className="space-y-1">
              <div className={`text-xs ${subtleText}`}>Attack base: {s.percAtkBase.toFixed(4)}s</div>
              <input type="range" min="0.0005" max="0.03" step="0.0005" value={s.percAtkBase} onChange={(e) => setS((p) => ({ ...p, percAtkBase: parseFloat(e.target.value) }))} className="w-full" />
            </div>
            <div className="space-y-1">
              <div className={`text-xs ${subtleText}`}>Attack span: {s.percAtkSpan.toFixed(4)}s</div>
              <input type="range" min="0" max="0.06" step="0.0005" value={s.percAtkSpan} onChange={(e) => setS((p) => ({ ...p, percAtkSpan: parseFloat(e.target.value) }))} className="w-full" />
            </div>

            <div className="space-y-1">
              <div className={`text-xs ${subtleText}`}>Decay base: {s.percDecBase.toFixed(3)}s</div>
              <input type="range" min="0.03" max="0.8" step="0.005" value={s.percDecBase} onChange={(e) => setS((p) => ({ ...p, percDecBase: parseFloat(e.target.value) }))} className="w-full" />
            </div>
            <div className="space-y-1">
              <div className={`text-xs ${subtleText}`}>Decay span: {s.percDecSpan.toFixed(3)}s</div>
              <input type="range" min="0" max="1.6" step="0.01" value={s.percDecSpan} onChange={(e) => setS((p) => ({ ...p, percDecSpan: parseFloat(e.target.value) }))} className="w-full" />
            </div>
          </div>

          <div className={`text-[11px] ${subtleText}`}>Hue chooses drum type inside the kit. Attack/Decay/Level now shape the whole hit in real time.</div>
        </div>

        {/* ... keep your MIDI + FX sections exactly as-is ... */}

        <div className={`text-[11px] ${isDark ? "text-neutral-400" : "text-neutral-500"}`}>
          If you hear nothing: press <b>Enable Audio</b> once (browser rule).
        </div>
      </div>

      {/* Canvas */}
      <div className={`flex-1 min-h-0 p-2 md:p-8 ${shellBg} relative overflow-hidden`}>
        <button
          onClick={() => setPanelOpen((v) => !v)}
          className={`md:hidden absolute top-3 left-3 z-20 px-3 py-2 rounded-lg text-xs font-semibold shadow ${buttonPrimary}`}
        >
          {panelOpen ? "Hide controls" : "Show controls"}
        </button>

        <canvas
          ref={canvasRef}
          className={`w-full h-full rounded-lg shadow-sm touch-none select-none ${isDark ? "bg-neutral-950" : "bg-white"}`}
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
