// App.jsx
import React from "react";
import { RotateCcw, Download, Play, Square, Palette, Moon, Sun, Layers } from "lucide-react";

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
function quantizeToScale(midi, scaleSet) {
  if (!scaleSet?.length) return midi;
  let best = scaleSet[0],
    bestD = Math.abs(midi - best);
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
   FX helpers
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

/* =======================
   Melody synth (stable)
   - multiple instruments (Plaits-ish macros)
   - no idle hum
======================= */
function makeMelodyVoice(ac) {
  const oscA = ac.createOscillator();
  const oscB = ac.createOscillator(); // used for FM or detune layer
  const filter = ac.createBiquadFilter();
  const vca = ac.createGain();
  const mix = ac.createGain();

  // default
  oscA.type = "sawtooth";
  oscB.type = "sine";
  oscA.frequency.value = 220;
  oscB.frequency.value = 220;

  filter.type = "lowpass";
  filter.Q.value = 0.7;

  // silence idle
  vca.gain.value = 0.0;
  mix.gain.value = 1.0;

  oscA.connect(mix);
  oscB.connect(mix);
  mix.connect(filter);
  filter.connect(vca);

  oscA.start();
  oscB.start();

  return { oscA, oscB, filter, vca, mix };
}

// instrument models:
// harm: 0..1, timbre:0..1, morph:0..1
function applyMelodyInstrument(ac, voice, st, { freq, harm, timbre, morph }) {
  const now = ac.currentTime;
  const inst = st.melInst || "PlaitsClassic";

  // reset routing defaults
  voice.oscA.detune.setValueAtTime(0, now);
  voice.oscB.detune.setValueAtTime(0, now);
  voice.oscA.frequency.setValueAtTime(freq, now);
  voice.oscB.frequency.setValueAtTime(freq, now);

  if (inst === "PlaitsClassic") {
    // "macro" idea:
    // harm -> wave choice + detune
    // timbre -> filter Q + cutoff bias
    // morph -> FM depth
    voice.oscA.type = harm < 0.33 ? "triangle" : harm < 0.66 ? "sawtooth" : "square";
    voice.oscB.type = "sine";

    // mild detune for thickness
    const det = (harm - 0.5) * 14;
    voice.oscA.detune.setValueAtTime(det, now);
    voice.oscB.detune.setValueAtTime(-det, now);

    // FM-ish: modulate oscA frequency via oscB -> (AudioParam not directly connectable without Gain)
    // We'll do pseudo-FM by offsetting oscB frequency ratio and later using filter / envelope to keep it musical.
    const ratio = 1 + Math.floor(morph * 5) * 0.5; // 1..3.5
    voice.oscB.frequency.setValueAtTime(freq * ratio, now);

    // filter feel
    voice.filter.Q.setTargetAtTime(0.6 + timbre * 8.0, now, 0.01);
  } else if (inst === "Pluck") {
    voice.oscA.type = "triangle";
    voice.oscB.type = "square";
    voice.oscB.detune.setValueAtTime((morph - 0.5) * 30, now);
    voice.filter.Q.setTargetAtTime(2.5 + timbre * 10.0, now, 0.01);
  } else if (inst === "FMGlass") {
    voice.oscA.type = "sine";
    voice.oscB.type = "sine";
    const ratio = 1 + Math.floor((0.2 + morph) * 8) * 0.25; // 1..3
    voice.oscB.frequency.setValueAtTime(freq * ratio, now);
    voice.filter.Q.setTargetAtTime(0.8 + timbre * 4.0, now, 0.01);
  } else {
    // Basic
    voice.oscA.type = "sawtooth";
    voice.oscB.type = "sine";
    voice.filter.Q.setTargetAtTime(0.7 + timbre * 2.0, now, 0.01);
  }
}

function triggerMelody(ac, voice, st, { freq, vel, cutoffHz, attack, decaySec, release, harm, timbre, morph }) {
  const now = ac.currentTime;
  const v = clamp(vel, 0.0001, 1);

  applyMelodyInstrument(ac, voice, st, { freq, harm, timbre, morph });

  // filter cutoff
  voice.filter.frequency.cancelScheduledValues(now);
  voice.filter.frequency.setValueAtTime(clamp(cutoffHz, 80, 16000), now);

  // envelope
  const g = voice.vca.gain;
  g.cancelScheduledValues(now);
  g.setValueAtTime(0.0, now);
  g.linearRampToValueAtTime(Math.max(0.00012, v), now + clamp(attack, 0.001, 0.25));
  g.linearRampToValueAtTime(
    0.0,
    now + clamp(attack, 0.001, 0.25) + clamp(decaySec, 0.02, 2.5) + clamp(release, 0.02, 3.0)
  );
}

/* =======================
   Percussion (percussive, no hum)
   - kick/tom/snare/hat-like models
   - tuned to scale for body / resonances
======================= */
function makeNoiseBuffer(ac, seconds) {
  const len = Math.max(1, Math.floor(ac.sampleRate * seconds));
  const buf = ac.createBuffer(1, len, ac.sampleRate);
  const data = buf.getChannelData(0);
  for (let i = 0; i < len; i++) data[i] = Math.random() * 2 - 1;
  return buf;
}

function triggerPerc(ac, dest, opts) {
  const now = ac.currentTime;
  const {
    freq = 110,
    vel = 0.8,
    model = "kick", // kick | snare | hat | tom
    decay = 0.18,
    tone = 0.6, // 0..1 (noise->body)
    bright = 0.5,
    punch = 0.7,
    driveAmt = 0.0,
  } = opts;

  const v = clamp(vel, 0.0, 1.0);

  // output gain & optional shaper (per-hit so no constant distortion noise)
  const out = ac.createGain();
  out.gain.value = 1.0;

  const shaper = ac.createWaveShaper();
  shaper.oversample = "2x";
  const nC = 2048;
  const curve = new Float32Array(nC);
  const k = clamp(driveAmt, 0, 1) * 25;
  for (let i = 0; i < nC; i++) {
    const x = (i * 2) / (nC - 1) - 1;
    curve[i] = Math.tanh(x * (1 + k));
  }
  shaper.curve = curve;

  out.connect(shaper);
  shaper.connect(dest);

  // click transient (helps “percussive”)
  const click = ac.createOscillator();
  click.type = "square";
  click.frequency.setValueAtTime(clamp(freq * 8, 500, 8000), now);
  const clickGain = ac.createGain();
  clickGain.gain.setValueAtTime(0.0, now);
  clickGain.gain.linearRampToValueAtTime(0.25 * v * punch, now + 0.001);
  clickGain.gain.exponentialRampToValueAtTime(0.00001, now + 0.01 + 0.02 * (1 - bright));
  click.connect(clickGain);
  clickGain.connect(out);
  click.start(now);
  click.stop(now + 0.05);

  // noise source (short)
  const noiseDur = clamp(0.03 + decay * (model === "hat" ? 0.6 : 0.9), 0.03, 1.2);
  const noiseSrc = ac.createBufferSource();
  noiseSrc.buffer = makeNoiseBuffer(ac, noiseDur);
  const noiseGain = ac.createGain();
  noiseGain.gain.setValueAtTime(0.0, now);

  // filter noise differently by model
  const nf = ac.createBiquadFilter();
  if (model === "hat") {
    nf.type = "highpass";
    nf.frequency.setValueAtTime(4000 + bright * 7000, now);
    nf.Q.value = 0.7;
  } else if (model === "snare") {
    nf.type = "bandpass";
    nf.frequency.setValueAtTime(clamp(freq * (1.6 + bright * 2.2), 300, 9000), now);
    nf.Q.value = 1.2 + bright * 6;
  } else {
    nf.type = "bandpass";
    nf.frequency.setValueAtTime(clamp(freq * (1.0 + bright * 1.6), 120, 12000), now);
    nf.Q.value = 1.2 + bright * 8;
  }

  // noise envelope
  const na = 0.001;
  const nd = clamp(decay * (model === "hat" ? 0.45 : model === "snare" ? 0.75 : 0.6), 0.02, 1.5);
  const noiseLevel = (model === "hat" ? 0.9 : model === "snare" ? 0.8 : 0.5) * v * (1 - tone);
  noiseGain.gain.linearRampToValueAtTime(noiseLevel, now + na);
  noiseGain.gain.exponentialRampToValueAtTime(0.00001, now + na + nd);

  noiseSrc.connect(nf);
  nf.connect(noiseGain);
  noiseGain.connect(out);

  noiseSrc.start(now);
  noiseSrc.stop(now + noiseDur + 0.05);

  // body oscillator (tuned)
  const body = ac.createOscillator();
  body.type = model === "hat" ? "triangle" : "sine";

  // pitch envelope for kick/tom
  const f0 = clamp(freq, 30, 6000);
  if (model === "kick") {
    body.frequency.setValueAtTime(clamp(f0 * (2.0 + (1 - bright) * 1.5), 50, 6000), now);
    body.frequency.exponentialRampToValueAtTime(clamp(f0, 35, 400), now + 0.02 + 0.03 * (1 - punch));
  } else if (model === "tom") {
    body.frequency.setValueAtTime(clamp(f0 * 1.4, 60, 2000), now);
    body.frequency.exponentialRampToValueAtTime(clamp(f0, 45, 1400), now + 0.03);
  } else {
    body.frequency.setValueAtTime(f0, now);
  }

  const bodyGain = ac.createGain();
  bodyGain.gain.setValueAtTime(0.0, now);

  const ba = 0.001;
  const bd = clamp(decay * (model === "kick" ? 1.2 : model === "tom" ? 1.0 : 0.6), 0.03, 2.0);
  const bodyLevel =
    (model === "hat" ? 0.15 : model === "snare" ? 0.25 : model === "kick" ? 0.95 : 0.7) *
    v *
    tone;

  bodyGain.gain.linearRampToValueAtTime(bodyLevel, now + ba);
  bodyGain.gain.exponentialRampToValueAtTime(0.00001, now + ba + bd);

  // body shaping filter (tiny lowpass for harshness control)
  const bf = ac.createBiquadFilter();
  bf.type = "lowpass";
  bf.frequency.setValueAtTime(clamp(900 + bright * 8000, 250, 14000), now);
  bf.Q.value = 0.7;

  body.connect(bf);
  bf.connect(bodyGain);
  bodyGain.connect(out);

  body.start(now);
  body.stop(now + ba + bd + 0.08);
}

/* =======================
   Main App
======================= */
export default function App() {
  const canvasRef = React.useRef(null);
  const rafRef = React.useRef(null);

  // LAYERS
  const [activeLayer, setActiveLayer] = React.useState("melody"); // melody | perc
  const [layerView, setLayerView] = React.useState("both"); // both | active | ghost
  const [ghostOpacity, setGhostOpacity] = React.useState(0.28);

  // CELLS
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

  // char-grid stable dims (prevents “notes sometimes don’t play” after resize)
  const charDimsRef = React.useRef({ cols: 16, rows: 12 });

  // settings
  const [s, setS] = React.useState({
    pat: "swiss-grid", // swiss-grid | char-grid

    // char-grid
    space: 42,
    charSz: 22,
    chars: "01",
    charSpd: 2.0, // now BPM-linked multiplier

    // swiss-grid
    cols: 12,
    rows: 16,
    gridLines: true,
    swissCharScale: 1.0,

    // variable density (swiss only)
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

    // Plaits-ish instrument macros
    melInst: "PlaitsClassic", // PlaitsClassic | Pluck | FMGlass | Basic
    melHarm: 0.55,
    melTimbre: 0.55,
    melMorph: 0.45,

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
    drive: 0.45, // slightly safer default (less “noisy”)
    // ======= LAYER VOLUMES =======
    melodyVol: 0.9,
    percVol: 0.85,

    // ======= PERCUSSION =======
    percOn: true,
    percMaxHitsPerStep: 8,
    percBaseMidi: 24,
    percOctaveSpan: 3,

    // percussion character
    percTone: 0.45,
    percDecayBase: 0.10,
    percDecaySpan: 0.45,
    percPunch: 0.75,
    percBright: 0.55,
    percDrive: 0.08,

    // mapping: hue -> model
    percModelMode: "hue", // hue | bands

    // ======= MIDI =======
    midiOn: true,
    midiDraw: true,
    midiThru: true,
    midiQuantize: true, // NEW: keeps MIDI-thru precise/in-key
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

  // variable edges (swiss only)
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

  // stable char dims getter
  const getCharDims = React.useCallback(() => {
    return charDimsRef.current || { cols: 16, rows: 12 };
  }, []);

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
      if (s.pat === "char-grid") return getCharGridIdx(cx, cy);
      return null;
    },
    [s.pat, getSwissIdx, getCharGridIdx]
  );

  // upsert/remove per layer
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

  const applyPaintToIdx = (idx, r, c, t) => {
    if (idx == null) return;
    const layerKey = activeLayer === "perc" ? "perc" : "melody";
    if (paint.mode === "none") {
      removeCellLayer(layerKey, idx);
      return;
    }
    if (paint.useSeq) {
      const len = palette.length;
      const ci = colorSeqIndex(t, r, c, len);
      upsertCellLayer(layerKey, idx, { paint: { mode: "color", color: palette[ci] } });
    } else {
      upsertCellLayer(layerKey, idx, { paint: { mode: "color", color: paint.color } });
    }
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
     AUDIO GRAPH
     - separate melodyBus + percBus
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

      // buses -> drive -> fx
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
      A.running = false;
      A.step = 0;
      A.timer = null;
      A._revTime = null;

      updateAudioParamsRealtime();
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
    const A = ensureAudio();
    const ac = A.ac;
    const want = clamp(sRef.current.voices ?? 12, 1, 32);
    if (A.voices.length !== want) {
      const newPool = Array.from({ length: want }, () => {
        const v = makeMelodyVoice(ac);
        v.vca.connect(A.melodyBus);
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
     Scheduler
     - melody + percussion
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

      if (!st.soundOn && !st.percOn) {
        audioRef.current.timer = setTimeout(tick, 50);
        return;
      }

      const melNow = cellsMelRef.current;
      const percNow = cellsPercRef.current;

      const melMap = new Map();
      const percMap = new Map();
      for (const c of melNow) melMap.set(c.idx, c);
      for (const c of percNow) percMap.set(c.idx, c);

      let cols = 1,
        rows = 1;
      const isSwiss = st.pat === "swiss-grid";

      if (isSwiss) {
        cols = Math.max(1, st.cols | 0);
        rows = Math.max(1, st.rows | 0);
      } else {
        const d = charDimsRef.current || { cols: 16, rows: 12 };
        cols = Math.max(1, d.cols | 0);
        rows = Math.max(1, d.rows | 0);
      }

      const bpm = clamp(st.bpm ?? 120, 30, 260);
      const baseStepSec = 60 / bpm / 2;
      let stepSec = baseStepSec;

      // swiss only: variable column speed
      if (isSwiss && st.varColsOn) {
        const ce = colEdges || Array.from({ length: cols + 1 }, (_, i) => i / cols);
        const curCol = audioRef.current.step % cols;
        const w = ce[curCol + 1] - ce[curCol];
        const avg = 1 / cols;
        const ratio = clamp(w / avg, 0.35, 2.4);
        stepSec = baseStepSec * ratio;
      }

      const col = audioRef.current.step % cols;

      // harmony base
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

      const percDegreesCount = 7 * clamp(st.percOctaveSpan ?? 3, 1, 7);
      const percScaleMidi = buildScaleMidi({
        rootPc: clamp(st.keyRoot ?? 0, 0, 11),
        scaleName: st.scaleName,
        baseMidi: clamp(st.percBaseMidi ?? 24, 0, 72),
        degreesCount: percDegreesCount,
      });

      // swiss: row density affects tails
      const re = isSwiss ? rowEdges || Array.from({ length: rows + 1 }, (_, i) => i / rows) : null;
      const avgRowH = isSwiss ? 1 / rows : 1;

      const nowS = performance.now() * 0.001;

      // ===== MELODY
      if (st.soundOn) {
        const hits = [];
        for (let r = 0; r < rows; r++) {
          const idx = r * cols + col;
          const cell = melMap.get(idx);
          const paintObj = cell?.paint;
          if (!paintObj?.color) continue;

          if (typeof cell.expiresAt === "number" && cell.expiresAt <= nowS) continue;

          const rgb = hexToRgb(paintObj.color);
          if (!rgb) continue;

          const lum = luminance01(rgb);
          const hh = hue01(rgb);

          let lane = 0;
          if (st.laneMode === "hue") {
            const lanes = chordTones.length;
            lane = clamp(Math.floor(hh * lanes), 0, lanes - 1);
          } else {
            lane = col % chordTones.length;
          }

          const rowNorm = rows <= 1 ? 0.5 : 1 - r / (rows - 1); // top=1 high
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

          attack = clamp(attack, 0.002, 0.25);
          decay = clamp(decay, 0.03, 2.2);
          release = clamp(release, 0.03, 3.0);

          // subtle macro variation from color
          const harm = clamp((st.melHarm ?? 0.55) * 0.75 + hh * 0.25, 0, 1);
          const timbre = clamp((st.melTimbre ?? 0.55) * 0.75 + lum * 0.25, 0, 1);
          const morph = clamp((st.melMorph ?? 0.45) * 0.7 + (1 - rowNorm) * 0.3, 0, 1);

          hits.push({ freq, vel, cutoff, attack, decay, release, harm, timbre, morph, score: vel });
        }

        hits.sort((a, b) => b.score - a.score);
        const chosen = hits.slice(0, Math.min(maxNotes, hits.length));

        const pool = audioRef.current.voices;
        for (const h of chosen) {
          const v = pool[audioRef.current.voicePtr % pool.length];
          audioRef.current.voicePtr++;
          triggerMelody(ac, v, st, {
            freq: h.freq,
            vel: h.vel,
            cutoffHz: h.cutoff,
            attack: h.attack,
            decaySec: h.decay,
            release: h.release,
            harm: h.harm,
            timbre: h.timbre,
            morph: h.morph,
          });
        }
      }

      // ===== PERCUSSION
      if (st.percOn) {
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
          const hh = hue01(rgb);

          // top higher, bottom lower
          const rowNorm = rows <= 1 ? 0.5 : 1 - r / (rows - 1);

          // tuned body: pick degree along perc scale
          const degFloat = rowNorm * (percDegreesCount - 1);
          const degIdx = clamp(Math.round(degFloat), 0, percDegreesCount - 1);
          let midi = percScaleMidi[degIdx];

          // gentle hue wiggle but still in key
          const wig = Math.round((hh - 0.5) * 4);
          midi = percScaleMidi[clamp(degIdx + wig, 0, percDegreesCount - 1)] ?? midi;
          midi = quantizeToScale(midi, percScaleMidi);
          const freq = midiToFreq(midi);

          const vel = clamp(0.10 + 0.90 * lum, 0.05, 1);

          let decay =
            (st.percDecayBase ?? 0.1) +
            (st.percDecaySpan ?? 0.45) * clamp((1 - rowNorm) * 0.7 + lum * 0.5, 0, 1);

          if (isSwiss && st.varRowsOn && re) {
            const rh = re[r + 1] - re[r];
            const ratio = clamp(rh / avgRowH, 0.35, 2.4);
            decay *= clamp(ratio, 0.7, 1.6);
          }
          decay = clamp(decay, 0.03, 1.8);

          // choose drum model
          let model = "kick";
          if ((st.percModelMode || "hue") === "hue") {
            // hue regions -> models
            // 0..1: kick -> tom -> snare -> hat (cyclic)
            if (hh < 0.25) model = "kick";
            else if (hh < 0.5) model = "tom";
            else if (hh < 0.75) model = "snare";
            else model = "hat";
          } else {
            // row bands: bottom = kick, mid = snare/tom, top = hat
            if (rowNorm < 0.33) model = "kick";
            else if (rowNorm < 0.66) model = hh < 0.5 ? "tom" : "snare";
            else model = "hat";
          }

          hits.push({
            freq,
            vel,
            decay,
            model,
            tone: clamp(st.percTone ?? 0.45, 0, 1),
            punch: clamp(st.percPunch ?? 0.75, 0, 1),
            bright: clamp((st.percBright ?? 0.55) * (0.6 + lum * 0.6), 0, 1),
            driveAmt: clamp(st.percDrive ?? 0.08, 0, 1),
            score: vel,
          });
        }

        hits.sort((a, b) => b.score - a.score);
        const chosen = hits.slice(0, Math.min(maxHits, hits.length));

        for (const h of chosen) {
          triggerPerc(ac, audioRef.current.percBus, {
            freq: h.freq,
            vel: h.vel,
            model: h.model,
            tone: h.tone,
            decay: h.decay,
            punch: h.punch,
            bright: h.bright,
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
     - MIDI draws MELODY layer
     - MIDI-thru quantized option
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

  const getGridDims = React.useCallback(() => {
    const st = sRef.current;
    if (st.pat === "swiss-grid") return { cols: Math.max(1, st.cols | 0), rows: Math.max(1, st.rows | 0) };
    const d = charDimsRef.current || { cols: 16, rows: 12 };
    return { cols: Math.max(1, d.cols | 0), rows: Math.max(1, d.rows | 0) };
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

      upsertCellLayer("melody", idx, {
        paint: { mode: "color", color },
        midi: { note, vel: vel01, ch, t0: nowS, dur: 0 },
        expiresAt,
      });

      midiActiveRef.current.set(`${note}:${ch}`, { t0: nowS, vel01, note, ch, idx, row, col });
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
        (st.midiFadeMin ?? 0.25) + (st.midiFadeMax ?? 2.5 - (st.midiFadeMin ?? 0.25)) * clamp(dur / 2.0, 0, 1),
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

  function quantizedMidiFreq(note) {
    const st = sRef.current;
    const degreesCount = 7 * clamp(st.octaveSpan ?? 4, 1, 7);
    const scaleMidi = buildScaleMidi({
      rootPc: clamp(st.keyRoot ?? 0, 0, 11),
      scaleName: st.scaleName,
      baseMidi: clamp(st.baseMidi ?? 36, 12, 60),
      degreesCount,
    });
    const q = quantizeToScale(note, scaleMidi);
    return midiToFreq(q);
  }

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

    const freq = st.midiQuantize ? quantizedMidiFreq(note) : midiToFreq(note);

    const attack = 0.004 + (1 - vel01) * 0.02;
    const decay = 0.08 + vel01 * 0.35;
    const release = 0.12 + (1 - vel01) * 0.35;

    const cutoff = (st.cutoffBase ?? 400) + (st.cutoffSpan ?? 7200) * clamp(0.25 + vel01 * 0.75, 0, 1);

    const v = A.voices[A.voicePtr % A.voices.length];
    A.voicePtr++;

    triggerMelody(ac, v, st, {
      freq,
      vel: vel01 * 0.95,
      cutoffHz: cutoff,
      attack,
      decaySec: decay,
      release,
      harm: st.melHarm ?? 0.55,
      timbre: st.melTimbre ?? 0.55,
      morph: st.melMorph ?? 0.45,
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

  /* =======================
     Render loop (ghost fixed)
======================= */
  const getFontFamily = () => `"Inter", system-ui, -apple-system, Segoe UI, Roboto, sans-serif`;

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
      if (s.pat === "char-grid") {
        const { cols, rows } = charDimsRef.current || { cols: 16, rows: 12 };
        if (s.gridLines) {
          ctx.save();
          ctx.strokeStyle = gridLineChar;
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
      } else {
        const cols = Math.max(1, s.cols | 0);
        const rows = Math.max(1, s.rows | 0);
        if (s.gridLines) {
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
      }
    };

    // BPM-locked char animation
    const bpm = clamp(s.bpm ?? 120, 30, 260);
    const bpmFactor = bpm / 120;
    const spd = (s.charSpd ?? 2) * bpmFactor;

    const drawLayerCells = (map, alphaMul) => {
      ctx.textAlign = "center";
      ctx.textBaseline = "middle";

      const chs = (s.chars || "01").split("");

      if (s.pat === "char-grid") {
        const { cols, rows } = charDimsRef.current || { cols: 16, rows: 12 };
        for (let r = 0; r < rows; r++) {
          for (let c = 0; c < cols; c++) {
            const idx = r * cols + c;
            const x0 = c * s.space;
            const y0 = r * s.space;
            const cx = x0 + s.space / 2;
            const cy = y0 + s.space / 2;

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
              ctx.fillRect(x0, y0, s.space, s.space);
              ctx.restore();
            }

            const gi = chs.length ? Math.floor((t * spd + r * 0.07 + c * 0.05) * 3) % chs.length : 0;
            ctx.save();
            ctx.globalAlpha = alphaMul * (col ? 1 : 0.95);
            ctx.font = `${s.charSz}px ${getFontFamily()}`;
            ctx.fillStyle = col ? paintedText : baseText;
            ctx.fillText(chs[gi] ?? "0", cx, cy);
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

    // FIXED LOGIC:
    // - both: draw both (active on top)
    // - active: draw only active
    // - ghost: draw active normally + other as ghost opacity
    const other = activeLayer === "melody" ? "perc" : "melody";

    if (layerView === "both") {
      if (activeLayer === "melody") {
        drawLayerCells(percMap, 0.78);
        drawLayerCells(melMap, 1.0);
      } else {
        drawLayerCells(melMap, 0.78);
        drawLayerCells(percMap, 1.0);
      }
    } else if (layerView === "active") {
      if (activeLayer === "melody") drawLayerCells(melMap, 1.0);
      else drawLayerCells(percMap, 1.0);
    } else if (layerView === "ghost") {
      // draw active full
      if (activeLayer === "melody") drawLayerCells(melMap, 1.0);
      else drawLayerCells(percMap, 1.0);
      // draw other as ghost
      const ga = clamp(ghostOpacity, 0, 0.8);
      if (other === "melody") drawLayerCells(melMap, ga);
      else drawLayerCells(percMap, ga);
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
  }, [s, cellsMel, cellsPerc, colEdges, rowEdges, activeLayer, layerView, ghostOpacity, isDark]);

  // resize canvas + lock char grid dims
  React.useEffect(() => {
    const rsz = () => {
      const cv = canvasRef.current;
      if (!cv) return;

      cv.width = Math.max(1, Math.floor(cv.offsetWidth));
      cv.height = Math.max(1, Math.floor(cv.offsetHeight));

      // lock char-grid dims so indices are stable
      const cols = Math.max(1, Math.floor(cv.width / (sRef.current.space || 42)));
      const rows = Math.max(1, Math.floor(cv.height / (sRef.current.space || 42)));
      charDimsRef.current = { cols, rows };
    };
    rsz();
    window.addEventListener("resize", rsz);
    window.addEventListener("orientationchange", rsz);
    return () => {
      window.removeEventListener("resize", rsz);
      window.removeEventListener("orientationchange", rsz);
    };
  }, []);

  // update char dims when spacing changes
  React.useEffect(() => {
    const cv = canvasRef.current;
    if (!cv) return;
    const cols = Math.max(1, Math.floor(cv.width / (s.space || 42)));
    const rows = Math.max(1, Math.floor(cv.height / (s.space || 42)));
    charDimsRef.current = { cols, rows };
  }, [s.space]);

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

  const shellBg = isDark ? "bg-neutral-950" : "bg-white";
  const panelBg = isDark ? "bg-neutral-950 border-neutral-800 text-neutral-100" : "bg-neutral-50 border-neutral-200 text-neutral-900";
  const inputBg = isDark ? "bg-neutral-900 border-neutral-700 text-neutral-100" : "bg-white border-neutral-300 text-neutral-900";
  const subtleText = isDark ? "text-neutral-300" : "text-neutral-600";
  const buttonPrimary = isDark ? "bg-white text-black hover:bg-neutral-200" : "bg-black text-white hover:bg-neutral-800";
  const buttonDark = isDark ? "bg-neutral-100 text-black hover:bg-white" : "bg-neutral-900 text-white hover:bg-black";
  const buttonMuted = isDark ? "bg-neutral-800 text-neutral-100" : "bg-neutral-200 text-neutral-700";

  return (
    <div className={`w-full h-[100svh] ${shellBg} flex flex-col md:flex-row overflow-hidden`}>
      {panelOpen && <div className="fixed inset-0 bg-black/40 z-30 md:hidden" onClick={() => setPanelOpen(false)} />}

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
          <button onClick={gen} className={`flex-1 flex justify-center px-4 py-2.5 rounded-lg font-medium min-h-[44px] ${buttonPrimary}`} title="Refresh">
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
          <button onClick={unlockAudio} className={`flex-1 px-4 py-2.5 rounded-lg font-medium min-h-[44px] ${buttonDark}`}>
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
          <select value={s.pat} onChange={(e) => setS((p) => ({ ...p, pat: e.target.value }))} className={`w-full px-3 py-2 border rounded-lg ${inputBg}`}>
            <option value="swiss-grid">Swiss Grid</option>
            <option value="char-grid">Character Grid</option>
          </select>
        </div>

        {/* Layer controls */}
        <div className="space-y-2">
          <label className="block text-xs font-semibold uppercase tracking-wider">Layer</label>

          <div className="grid grid-cols-2 gap-2">
            <button
              onClick={() => setActiveLayer("melody")}
              className={`px-3 py-2 rounded-lg border text-xs font-semibold min-h-[44px] flex items-center justify-center gap-2 ${
                activeLayer === "melody" ? (isDark ? "bg-white text-black border-white" : "bg-black text-white border-black") : inputBg
              }`}
            >
              <Layers size={14} />
              Melody
            </button>
            <button
              onClick={() => setActiveLayer("perc")}
              className={`px-3 py-2 rounded-lg border text-xs font-semibold min-h-[44px] flex items-center justify-center gap-2 ${
                activeLayer === "perc" ? (isDark ? "bg-white text-black border-white" : "bg-black text-white border-black") : inputBg
              }`}
            >
              <Layers size={14} />
              Perc
            </button>
          </div>

          <div className="grid grid-cols-2 gap-2">
            <div className="space-y-1">
              <div className={`text-xs ${subtleText}`}>View</div>
              <select value={layerView} onChange={(e) => setLayerView(e.target.value)} className={`w-full px-2 py-2 border rounded-lg text-xs ${inputBg}`}>
                <option value="both">Both</option>
                <option value="active">Active only</option>
                <option value="ghost">Ghost other</option>
              </select>
            </div>
            <div className="space-y-1">
              <div className={`text-xs ${subtleText}`}>Ghost</div>
              <input type="range" min="0" max="0.8" step="0.01" value={ghostOpacity} onChange={(e) => setGhostOpacity(parseFloat(e.target.value))} className="w-full" disabled={layerView !== "ghost"} />
            </div>
          </div>

          <div className={`text-[11px] ${subtleText}`}>
            Paint into the <b>active</b> layer. In <b>Ghost other</b> you see the other layer faintly while keeping the active layer normal.
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
                paint.useSeq ? (isDark ? "bg-white text-black border-white" : "bg-black text-white border-black") : inputBg
              }`}
            >
              <Palette size={14} />
              {paint.useSeq ? "Color String ON" : "Color String OFF"}
            </button>

            <button
              onClick={() => setPaint((p) => ({ ...p, mode: p.mode === "none" ? "color" : "none" }))}
              className={`px-3 py-2 rounded-lg text-xs font-semibold min-h-[44px] ${
                paint.mode === "none" ? (isDark ? "bg-white text-black" : "bg-black text-white") : buttonMuted
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

          <div className="grid grid-cols-2 gap-2">
            <div className="space-y-1">
              <div className={`text-xs ${subtleText}`}>Color motion</div>
              <select value={s.colorSeqBehave} onChange={(e) => setS((p) => ({ ...p, colorSeqBehave: e.target.value }))} className={`w-full px-2 py-2 border rounded-lg text-xs ${inputBg}`}>
                <option value="same">Same (musical)</option>
                <option value="cycle">Cycle</option>
                <option value="wave">Wave</option>
                <option value="random">Random</option>
              </select>
            </div>
            <div className="space-y-1">
              <div className={`text-xs ${subtleText}`}>Speed</div>
              <input type="range" min="0" max="4" step="0.05" value={s.colorSeqSpeed} onChange={(e) => setS((p) => ({ ...p, colorSeqSpeed: parseFloat(e.target.value) }))} className="w-full" />
            </div>
          </div>

          <button onClick={clearPaint} className={`w-full px-4 py-2.5 rounded-lg font-medium min-h-[44px] ${buttonDark}`}>
            Clear Active Layer
          </button>
        </div>

        {/* Grid controls (unchanged) */}
        {s.pat === "swiss-grid" && (
          <div className="space-y-2">
            <label className="block text-xs font-semibold uppercase tracking-wider">
              Grid {s.cols} × {s.rows}
            </label>
            <input type="range" min="4" max="40" value={s.cols} onChange={(e) => setS((p) => ({ ...p, cols: parseInt(e.target.value, 10) }))} className="w-full" />
            <input type="range" min="4" max="40" value={s.rows} onChange={(e) => setS((p) => ({ ...p, rows: parseInt(e.target.value, 10) }))} className="w-full" />

            <div className="flex items-center justify-between">
              <label className="text-xs font-semibold uppercase tracking-wider">Grid Lines</label>
              <button
                onClick={() => setS((p) => ({ ...p, gridLines: !p.gridLines }))}
                className={`p-1.5 rounded ${s.gridLines ? (isDark ? "bg-white text-black" : "bg-black text-white") : buttonMuted}`}
              >
                {s.gridLines ? <Play size={14} fill={isDark ? "black" : "white"} /> : <Square size={14} />}
              </button>
            </div>

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
                  <input type="range" min="0" max="1" step="0.01" value={s.colFocus} onChange={(e) => setS((p) => ({ ...p, colFocus: parseFloat(e.target.value) }))} className="w-full" />
                  <label className="block text-xs font-semibold uppercase tracking-wider">Strength: {s.colStrength.toFixed(1)}</label>
                  <input type="range" min="0" max="20" step="0.1" value={s.colStrength} onChange={(e) => setS((p) => ({ ...p, colStrength: parseFloat(e.target.value) }))} className="w-full" />
                  <label className="block text-xs font-semibold uppercase tracking-wider">Band Width: {s.colSigma.toFixed(2)}</label>
                  <input type="range" min="0.05" max="0.5" step="0.01" value={s.colSigma} onChange={(e) => setS((p) => ({ ...p, colSigma: parseFloat(e.target.value) }))} className="w-full" />
                  <div className={`text-[11px] ${subtleText}`}>
                    Columns affect <b>step speed</b> (narrow = faster, wide = slower).
                  </div>
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
                  <input type="range" min="0" max="1" step="0.01" value={s.rowFocus} onChange={(e) => setS((p) => ({ ...p, rowFocus: parseFloat(e.target.value) }))} className="w-full" />
                  <label className="block text-xs font-semibold uppercase tracking-wider">Strength: {s.rowStrength.toFixed(1)}</label>
                  <input type="range" min="0" max="20" step="0.1" value={s.rowStrength} onChange={(e) => setS((p) => ({ ...p, rowStrength: parseFloat(e.target.value) }))} className="w-full" />
                  <label className="block text-xs font-semibold uppercase tracking-wider">Band Width: {s.rowSigma.toFixed(2)}</label>
                  <input type="range" min="0.05" max="0.5" step="0.01" value={s.rowSigma} onChange={(e) => setS((p) => ({ ...p, rowSigma: parseFloat(e.target.value) }))} className="w-full" />
                  <div className={`text-[11px] ${subtleText}`}>
                    Rows affect <b>envelope</b> and <b>tails</b>.
                  </div>
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
            <label className="block text-xs font-semibold uppercase tracking-wider">
              Char Speed (BPM-linked): {s.charSpd.toFixed(2)}×
            </label>
            <input type="range" min="0" max="10" step="0.1" value={s.charSpd} onChange={(e) => setS((p) => ({ ...p, charSpd: parseFloat(e.target.value) }))} className="w-full" />
            <label className="block text-xs font-semibold uppercase tracking-wider">Characters</label>
            <input type="text" value={s.chars} onChange={(e) => setS((p) => ({ ...p, chars: e.target.value }))} className={`w-full px-3 py-2 border rounded-lg font-mono ${inputBg}`} />
            <div className="flex items-center justify-between">
              <label className="text-xs font-semibold uppercase tracking-wider">Grid Lines</label>
              <button
                onClick={() => setS((p) => ({ ...p, gridLines: !p.gridLines }))}
                className={`p-1.5 rounded ${s.gridLines ? (isDark ? "bg-white text-black" : "bg-black text-white") : buttonMuted}`}
              >
                {s.gridLines ? <Play size={14} fill={isDark ? "black" : "white"} /> : <Square size={14} />}
              </button>
            </div>
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

        {/* Melody */}
        <div className="space-y-2">
          <div className="flex items-center justify-between">
            <label className="text-xs font-semibold uppercase tracking-wider">Melody</label>
            <button
              onClick={() => setS((p) => ({ ...p, soundOn: !p.soundOn }))}
              className={`p-1.5 rounded ${s.soundOn ? (isDark ? "bg-white text-black" : "bg-black text-white") : buttonMuted}`}
              title="Melody on/off"
            >
              {s.soundOn ? <Play size={14} fill={isDark ? "black" : "white"} /> : <Square size={14} />}
            </button>
          </div>

          <label className="block text-xs font-semibold uppercase tracking-wider">BPM: {s.bpm}</label>
          <input type="range" min="40" max="220" value={s.bpm} onChange={(e) => setS((p) => ({ ...p, bpm: parseInt(e.target.value, 10) }))} className="w-full" />

          <label className="block text-xs font-semibold uppercase tracking-wider">Max notes / step: {s.maxNotesPerStep}</label>
          <input type="range" min="1" max="24" value={s.maxNotesPerStep} onChange={(e) => setS((p) => ({ ...p, maxNotesPerStep: parseInt(e.target.value, 10) }))} className="w-full" />

          <div className="grid grid-cols-2 gap-2">
            <div className="space-y-1">
              <div className={`text-xs ${subtleText}`}>Key</div>
              <select value={s.keyRoot} onChange={(e) => setS((p) => ({ ...p, keyRoot: parseInt(e.target.value, 10) }))} className={`w-full px-2 py-2 border rounded-lg text-xs ${inputBg}`}>
                {NOTE_NAMES.map((n, i) => (
                  <option key={n} value={i}>
                    {n}
                  </option>
                ))}
              </select>
            </div>
            <div className="space-y-1">
              <div className={`text-xs ${subtleText}`}>Scale</div>
              <select value={s.scaleName} onChange={(e) => setS((p) => ({ ...p, scaleName: e.target.value }))} className={`w-full px-2 py-2 border rounded-lg text-xs ${inputBg}`}>
                {Object.keys(SCALES).map((name) => (
                  <option key={name} value={name}>
                    {name}
                  </option>
                ))}
              </select>
            </div>
          </div>

          <div className={`text-[11px] ${subtleText}`}>
            <b>Always in tune:</b> melody + percussion + (optional) MIDI-thru are quantized to {keyName} {s.scaleName}.<br />
            <b>Top = higher</b>, <b>bottom = lower</b>.
          </div>

          <div className="space-y-1">
            <div className={`text-xs ${subtleText}`}>Instrument</div>
            <select value={s.melInst} onChange={(e) => setS((p) => ({ ...p, melInst: e.target.value }))} className={`w-full px-2 py-2 border rounded-lg text-xs ${inputBg}`}>
              <option value="PlaitsClassic">PlaitsClassic</option>
              <option value="Pluck">Pluck</option>
              <option value="FMGlass">FMGlass</option>
              <option value="Basic">Basic</option>
            </select>
          </div>

          <div className="space-y-1">
            <div className={`text-xs ${subtleText}`}>Harm: {s.melHarm.toFixed(2)}</div>
            <input type="range" min="0" max="1" step="0.01" value={s.melHarm} onChange={(e) => setS((p) => ({ ...p, melHarm: parseFloat(e.target.value) }))} className="w-full" />
          </div>
          <div className="space-y-1">
            <div className={`text-xs ${subtleText}`}>Timbre: {s.melTimbre.toFixed(2)}</div>
            <input type="range" min="0" max="1" step="0.01" value={s.melTimbre} onChange={(e) => setS((p) => ({ ...p, melTimbre: parseFloat(e.target.value) }))} className="w-full" />
          </div>
          <div className="space-y-1">
            <div className={`text-xs ${subtleText}`}>Morph: {s.melMorph.toFixed(2)}</div>
            <input type="range" min="0" max="1" step="0.01" value={s.melMorph} onChange={(e) => setS((p) => ({ ...p, melMorph: parseFloat(e.target.value) }))} className="w-full" />
          </div>

          <label className="block text-xs font-semibold uppercase tracking-wider">Voices: {s.voices}</label>
          <input type="range" min="1" max="24" value={s.voices} onChange={(e) => setS((p) => ({ ...p, voices: parseInt(e.target.value, 10) }))} className="w-full" />

          <label className="block text-xs font-semibold uppercase tracking-wider">Master: {s.master.toFixed(2)}</label>
          <input type="range" min="0" max="1.2" step="0.01" value={s.master} onChange={(e) => setS((p) => ({ ...p, master: parseFloat(e.target.value) }))} className="w-full" />
        </div>

        {/* Percussion */}
        <div className="space-y-2">
          <div className="flex items-center justify-between">
            <label className="text-xs font-semibold uppercase tracking-wider">Percussion</label>
            <button
              onClick={() => setS((p) => ({ ...p, percOn: !p.percOn }))}
              className={`p-1.5 rounded ${s.percOn ? (isDark ? "bg-white text-black" : "bg-black text-white") : buttonMuted}`}
              title="Perc on/off"
            >
              {s.percOn ? <Play size={14} fill={isDark ? "black" : "white"} /> : <Square size={14} />}
            </button>
          </div>

          <label className="block text-xs font-semibold uppercase tracking-wider">Max hits / step: {s.percMaxHitsPerStep}</label>
          <input type="range" min="1" max="24" value={s.percMaxHitsPerStep} onChange={(e) => setS((p) => ({ ...p, percMaxHitsPerStep: parseInt(e.target.value, 10) }))} className="w-full" />

          <div className="grid grid-cols-2 gap-2">
            <div className="space-y-1">
              <div className={`text-xs ${subtleText}`}>Base MIDI</div>
              <input type="number" min="0" max="96" value={s.percBaseMidi} onChange={(e) => setS((p) => ({ ...p, percBaseMidi: parseInt(e.target.value || "24", 10) }))} className={`w-full px-2 py-2 border rounded-lg text-xs ${inputBg}`} />
            </div>
            <div className="space-y-1">
              <div className={`text-xs ${subtleText}`}>Octaves</div>
              <input type="number" min="1" max="7" value={s.percOctaveSpan} onChange={(e) => setS((p) => ({ ...p, percOctaveSpan: parseInt(e.target.value || "3", 10) }))} className={`w-full px-2 py-2 border rounded-lg text-xs ${inputBg}`} />
            </div>
          </div>

          <div className="space-y-1">
            <div className={`text-xs ${subtleText}`}>Model map</div>
            <select value={s.percModelMode} onChange={(e) => setS((p) => ({ ...p, percModelMode: e.target.value }))} className={`w-full px-2 py-2 border rounded-lg text-xs ${inputBg}`}>
              <option value="hue">Hue (kick/tom/snare/hat)</option>
              <option value="bands">Row bands (bottom kick / top hat)</option>
            </select>
          </div>

          <div className="space-y-1">
            <div className={`text-xs ${subtleText}`}>Tone (noise → body): {s.percTone.toFixed(2)}</div>
            <input type="range" min="0" max="1" step="0.01" value={s.percTone} onChange={(e) => setS((p) => ({ ...p, percTone: parseFloat(e.target.value) }))} className="w-full" />
          </div>

          <div className="space-y-1">
            <div className={`text-xs ${subtleText}`}>Punch: {s.percPunch.toFixed(2)}</div>
            <input type="range" min="0" max="1" step="0.01" value={s.percPunch} onChange={(e) => setS((p) => ({ ...p, percPunch: parseFloat(e.target.value) }))} className="w-full" />
          </div>

          <div className="space-y-1">
            <div className={`text-xs ${subtleText}`}>Brightness: {s.percBright.toFixed(2)}</div>
            <input type="range" min="0" max="1" step="0.01" value={s.percBright} onChange={(e) => setS((p) => ({ ...p, percBright: parseFloat(e.target.value) }))} className="w-full" />
          </div>

          <div className="space-y-1">
            <div className={`text-xs ${subtleText}`}>Decay base: {s.percDecayBase.toFixed(2)}s</div>
            <input type="range" min="0.02" max="0.6" step="0.01" value={s.percDecayBase} onChange={(e) => setS((p) => ({ ...p, percDecayBase: parseFloat(e.target.value) }))} className="w-full" />
          </div>

          <div className="space-y-1">
            <div className={`text-xs ${subtleText}`}>Decay span: {s.percDecaySpan.toFixed(2)}s</div>
            <input type="range" min="0" max="1.2" step="0.01" value={s.percDecaySpan} onChange={(e) => setS((p) => ({ ...p, percDecaySpan: parseFloat(e.target.value) }))} className="w-full" />
          </div>

          <div className="space-y-1">
            <div className={`text-xs ${subtleText}`}>Perc drive: {s.percDrive.toFixed(2)}</div>
            <input type="range" min="0" max="1" step="0.01" value={s.percDrive} onChange={(e) => setS((p) => ({ ...p, percDrive: parseFloat(e.target.value) }))} className="w-full" />
          </div>

          <div className={`text-[11px] ${subtleText}`}>
            For deeper drums: lower <b>Base MIDI</b> (18–26), raise <b>Tone</b>, and keep <b>Perc drive</b> low.
          </div>
        </div>

        {/* MIDI */}
        <div className="space-y-2">
          <div className="flex items-center justify-between">
            <label className="text-xs font-semibold uppercase tracking-wider">MIDI</label>
            <button
              onClick={() => setS((p) => ({ ...p, midiOn: !p.midiOn }))}
              className={`p-1.5 rounded ${s.midiOn ? (isDark ? "bg-white text-black" : "bg-black text-white") : buttonMuted}`}
              title="MIDI on/off"
              disabled={!midiSupported}
            >
              {s.midiOn ? <Play size={14} fill={isDark ? "black" : "white"} /> : <Square size={14} />}
            </button>
          </div>

          {!midiSupported ? (
            <div className={`text-[11px] ${subtleText}`}>This browser/device doesn’t support Web MIDI.</div>
          ) : (
            <>
              <div className="space-y-1">
                <div className={`text-xs ${subtleText}`}>Input</div>
                <select value={midiInputId} onChange={(e) => setMidiInputId(e.target.value)} className={`w-full px-2 py-2 border rounded-lg text-xs ${inputBg}`}>
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
                    s.midiDraw ? (isDark ? "bg-white text-black border-white" : "bg-black text-white border-black") : inputBg
                  }`}
                >
                  MIDI draws
                </button>
                <button
                  onClick={() => setS((p) => ({ ...p, midiThru: !p.midiThru }))}
                  className={`px-3 py-2 rounded-lg border text-xs font-semibold min-h-[44px] ${
                    s.midiThru ? (isDark ? "bg-white text-black border-white" : "bg-black text-white border-black") : inputBg
                  }`}
                >
                  MIDI thru
                </button>
              </div>

              <button
                onClick={() => setS((p) => ({ ...p, midiQuantize: !p.midiQuantize }))}
                className={`w-full px-3 py-2 rounded-lg border text-xs font-semibold min-h-[44px] ${
                  s.midiQuantize ? (isDark ? "bg-white text-black border-white" : "bg-black text-white border-black") : inputBg
                }`}
              >
                MIDI-thru quantize: {s.midiQuantize ? "ON" : "OFF"}
              </button>

              <div className={`text-[11px] ${subtleText}`}>
                If MIDI sounded “noisy / not precise”: keep <b>quantize ON</b> and reduce <b>Drive</b>.
              </div>
            </>
          )}
        </div>

        {/* FX */}
        <div className="space-y-2">
          <label className="block text-xs font-semibold uppercase tracking-wider">FX</label>

          <div className={`rounded-lg border p-3 space-y-2 ${isDark ? "border-neutral-800 bg-neutral-900" : "border-neutral-200 bg-white"}`}>
            <div className="flex items-center justify-between">
              <div className="text-xs font-semibold uppercase tracking-wider">Reverb</div>
              <button onClick={() => setS((p) => ({ ...p, reverbOn: !p.reverbOn }))} className={`p-1.5 rounded ${s.reverbOn ? (isDark ? "bg-white text-black" : "bg-black text-white") : buttonMuted}`}>
                {s.reverbOn ? <Play size={14} fill={isDark ? "black" : "white"} /> : <Square size={14} />}
              </button>
            </div>
            <label className="block text-xs font-semibold uppercase tracking-wider">Mix: {s.reverbMix.toFixed(2)}</label>
            <input type="range" min="0" max="0.8" step="0.01" value={s.reverbMix} onChange={(e) => setS((p) => ({ ...p, reverbMix: parseFloat(e.target.value) }))} className="w-full" />
            <label className="block text-xs font-semibold uppercase tracking-wider">Time: {s.reverbTime.toFixed(1)}s</label>
            <input type="range" min="0.5" max="6" step="0.1" value={s.reverbTime} onChange={(e) => setS((p) => ({ ...p, reverbTime: parseFloat(e.target.value) }))} className="w-full" />
          </div>

          <div className={`rounded-lg border p-3 space-y-2 ${isDark ? "border-neutral-800 bg-neutral-900" : "border-neutral-200 bg-white"}`}>
            <div className="flex items-center justify-between">
              <div className="text-xs font-semibold uppercase tracking-wider">Delay</div>
              <button onClick={() => setS((p) => ({ ...p, delayOn: !p.delayOn }))} className={`p-1.5 rounded ${s.delayOn ? (isDark ? "bg-white text-black" : "bg-black text-white") : buttonMuted}`}>
                {s.delayOn ? <Play size={14} fill={isDark ? "black" : "white"} /> : <Square size={14} />}
              </button>
            </div>
            <label className="block text-xs font-semibold uppercase tracking-wider">Mix: {s.delayMix.toFixed(2)}</label>
            <input type="range" min="0" max="0.8" step="0.01" value={s.delayMix} onChange={(e) => setS((p) => ({ ...p, delayMix: parseFloat(e.target.value) }))} className="w-full" />
            <label className="block text-xs font-semibold uppercase tracking-wider">Time: {s.delayTime.toFixed(2)}s</label>
            <input type="range" min="0.05" max="0.9" step="0.01" value={s.delayTime} onChange={(e) => setS((p) => ({ ...p, delayTime: parseFloat(e.target.value) }))} className="w-full" />
            <label className="block text-xs font-semibold uppercase tracking-wider">Feedback: {s.delayFeedback.toFixed(2)}</label>
            <input type="range" min="0" max="0.85" step="0.01" value={s.delayFeedback} onChange={(e) => setS((p) => ({ ...p, delayFeedback: parseFloat(e.target.value) }))} className="w-full" />
          </div>

          <div className={`rounded-lg border p-3 space-y-2 ${isDark ? "border-neutral-800 bg-neutral-900" : "border-neutral-200 bg-white"}`}>
            <div className="flex items-center justify-between">
              <div className="text-xs font-semibold uppercase tracking-wider">Drive</div>
              <button onClick={() => setS((p) => ({ ...p, driveOn: !p.driveOn }))} className={`p-1.5 rounded ${s.driveOn ? (isDark ? "bg-white text-black" : "bg-black text-white") : buttonMuted}`}>
                {s.driveOn ? <Play size={14} fill={isDark ? "black" : "white"} /> : <Square size={14} />}
              </button>
            </div>
            <label className="block text-xs font-semibold uppercase tracking-wider">Amount: {s.drive.toFixed(2)}</label>
            <input type="range" min="0" max="1" step="0.01" value={s.drive} onChange={(e) => setS((p) => ({ ...p, drive: parseFloat(e.target.value) }))} className="w-full" />
          </div>
        </div>

        <div className={`text-[11px] ${isDark ? "text-neutral-400" : "text-neutral-500"}`}>
          If you hear nothing: press <b>Enable Audio</b> once (browser rule).
        </div>
      </div>

      {/* Canvas */}
      <div className={`flex-1 min-h-0 p-2 md:p-8 ${shellBg} relative overflow-hidden`}>
        <button onClick={() => setPanelOpen((v) => !v)} className={`md:hidden absolute top-3 left-3 z-20 px-3 py-2 rounded-lg text-xs font-semibold shadow ${buttonPrimary}`}>
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
