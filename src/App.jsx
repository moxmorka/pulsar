// App.jsx
import React from "react";
import { RotateCcw, Download, Play, Square, Palette, Moon, Sun, AlertTriangle } from "lucide-react";

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

  gain.gain.value = 0.00001;

  osc.connect(filter);
  filter.connect(gain);

  osc.start();
  return { osc, filter, gain, busyUntil: 0 };
}

/** Critical anti-hum: always "pre-mute" before re-triggering so nothing gets stuck */
function triggerVoice(ac, voice, { freq, vel, cutoffHz, attack, decaySec, release }) {
  const now = ac.currentTime;
  const v = clamp(vel, 0.0001, 1);

  voice.osc.frequency.setValueAtTime(freq, now);

  voice.filter.frequency.cancelScheduledValues(now);
  voice.filter.frequency.setValueAtTime(clamp(cutoffHz, 80, 16000), now);

  const g = voice.gain.gain;
  g.cancelScheduledValues(now);

  // Pre-mute very fast to kill any stuck gain
  const cur = Math.max(g.value || 0.00001, 0.00001);
  g.setValueAtTime(cur, now);
  g.exponentialRampToValueAtTime(0.00001, now + 0.008);

  const a = clamp(attack, 0.002, 0.2);
  const d = clamp(decaySec, 0.02, 2.5);
  const r = clamp(release, 0.02, 2.8);

  // then proper envelope
  const t0 = now + 0.010;
  g.setValueAtTime(0.00001, t0);
  g.exponentialRampToValueAtTime(Math.max(0.00012, v), t0 + a);
  g.exponentialRampToValueAtTime(0.00001, t0 + a + d + r);

  voice.busyUntil = t0 + a + d + r;
}

/* =======================
   Percussion voice (tunable physical-ish tom/mallet)
   - sine + resonant "body" + click/noise
======================= */
function makePercVoice(ac) {
  const osc = ac.createOscillator();
  const body = ac.createBiquadFilter();
  const click = ac.createBiquadFilter();
  const gain = ac.createGain();

  osc.type = "sine";
  body.type = "bandpass";
  body.Q.value = 12;

  click.type = "highpass";
  click.frequency.value = 2000;

  gain.gain.value = 0.00001;

  // osc -> body -> gain
  osc.connect(body);
  body.connect(gain);

  // click noise (generated per hit, injected via a gain node later)
  // (we keep filter ready)

  osc.start();
  return { osc, body, click, gain, busyUntil: 0 };
}

function triggerPerc(ac, voice, { baseHz, tune, vel, decay, tone, clickAmt }) {
  const now = ac.currentTime;

  const v = clamp(vel, 0.0001, 1);
  const hz = clamp(baseHz * Math.pow(2, tune / 12), 20, 2000);

  // pitch drop for "tom" feel
  voice.osc.frequency.cancelScheduledValues(now);
  voice.osc.frequency.setValueAtTime(hz * 1.6, now);
  voice.osc.frequency.exponentialRampToValueAtTime(hz, now + 0.04);

  // body filter follows pitch
  voice.body.frequency.cancelScheduledValues(now);
  voice.body.frequency.setValueAtTime(hz * clamp(1 + tone * 2.2, 1, 4), now);

  // envelope (fast attack, controlled decay)
  const g = voice.gain.gain;
  g.cancelScheduledValues(now);

  // pre-mute to prevent stuck hum
  const cur = Math.max(g.value || 0.00001, 0.00001);
  g.setValueAtTime(cur, now);
  g.exponentialRampToValueAtTime(0.00001, now + 0.006);

  const a = 0.002;
  const d = clamp(decay, 0.03, 3.0);

  const t0 = now + 0.008;
  g.setValueAtTime(0.00001, t0);
  g.exponentialRampToValueAtTime(Math.max(0.00012, v), t0 + a);
  g.exponentialRampToValueAtTime(0.00001, t0 + a + d);

  // transient click (tiny noise burst)
  if (clickAmt > 0.0001) {
    const len = Math.floor(ac.sampleRate * 0.015);
    const buf = ac.createBuffer(1, Math.max(1, len), ac.sampleRate);
    const data = buf.getChannelData(0);
    for (let i = 0; i < len; i++) {
      const t = i / len;
      data[i] = (Math.random() * 2 - 1) * Math.pow(1 - t, 6);
    }
    const src = ac.createBufferSource();
    src.buffer = buf;

    const cg = ac.createGain();
    cg.gain.value = clamp(clickAmt * (0.2 + v * 0.9), 0, 1);

    src.connect(cg);
    cg.connect(voice.click);
    voice.click.connect(voice.gain);

    src.start(now);
    src.stop(now + 0.02);
  }

  voice.busyUntil = t0 + a + d;
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

  const melCellsRef = React.useRef([]);
  const percCellsRef = React.useRef([]);
  React.useEffect(() => void (melCellsRef.current = melCells), [melCells]);
  React.useEffect(() => void (percCellsRef.current = percCells), [percCells]);

  const [panelOpen, setPanelOpen] = React.useState(false);

  // layer UI
  const [activeLayer, setActiveLayer] = React.useState("melody"); // melody | perc
  const [viewLayer, setViewLayer] = React.useState("both"); // melody | perc | both
  const [ghost, setGhost] = React.useState(true);

  // painting
  const [paint, setPaint] = React.useState({
    mode: "color",
    color: "#111111",
    useSeq: true,
  });
  const [drawing, setDrawing] = React.useState(false);

  // settings
  const [s, setS] = React.useState({
    // appearance
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

    // ======= MELODY =======
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

    // envelope bases
    atkBase: 0.008,
    atkSpan: 0.09,
    decBase: 0.08,
    decSpan: 0.65,
    relBase: 0.06,
    relSpan: 0.85,

    voices: 14,

    // ======= PERCUSSION LAYER =======
    percOn: true,
    percVoices: 10,
    percMix: 0.85,
    percBaseHz: 80, // tunable low tom base
    percTuneSpan: 24, // row mapping in semitones
    percDecay: 0.28,
    percDecaySpan: 1.8, // row/density scaling
    percTone: 0.55, // body brightness
    percClick: 0.35, // transient
    percDrive: 0.25,

    // FX / master
    master: 0.85,

    reverbOn: true,
    reverbMix: 0.22,
    reverbTime: 2.2,

    delayOn: true,
    delayMix: 0.18,
    delayTime: 0.28,
    delayFeedback: 0.32, // safer default (prevents self-osc)
    // drive
    driveOn: true,
    drive: 0.6,

    // ======= MIDI =======
    midiOn: true,
    midiDraw: true,
    midiThru: true,
    midiChannel: -1,
    midiLo: 36,
    midiHi: 84,
    midiFadeMin: 0.25,
    midiFadeMax: 2.5,
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

  // layer-aware set helpers
  const upsertCell = React.useCallback((layer, idx, patch) => {
    const setter = layer === "perc" ? setPercCells : setMelCells;
    setter((prev) => {
      const ex = prev.findIndex((c) => c.idx === idx);
      const next = [...prev];
      if (ex >= 0) next[ex] = { ...next[ex], ...patch };
      else next.push({ idx, ...patch });
      return next;
    });
  }, []);

  const removeCell = React.useCallback((layer, idx) => {
    const setter = layer === "perc" ? setPercCells : setMelCells;
    setter((prev) => prev.filter((c) => c.idx !== idx));
  }, []);

  const applyPaintToIdx = (layer, idx, r, c, t) => {
    if (idx == null) return;
    if (paint.mode === "none") {
      removeCell(layer, idx);
      return;
    }
    if (paint.useSeq) {
      const len = palette.length;
      const ci = colorSeqIndex(t, r, c, len);
      upsertCell(layer, idx, { paint: { mode: "color", color: palette[ci] } });
    } else {
      upsertCell(layer, idx, { paint: { mode: "color", color: paint.color } });
    }
  };

  /* =======================
     AUDIO GRAPH (stable, anti-hum)
======================= */
  const audioRef = React.useRef({
    ac: null,

    // master chain
    master: null,
    comp: null,
    hp: null,

    // FX sends/returns
    dry: null,
    wetRev: null,
    wetDel: null,

    convolver: null,
    delay: null,
    feedback: null,
    fbFilter: null,

    drive: null,
    // percussion bus
    percBus: null,
    percDrive: null,

    // voices
    voices: [],
    voicePtr: 0,

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

      // master + safety (DC blocker + compressor)
      const master = ac.createGain();
      master.gain.value = 0.85;

      const hp = ac.createBiquadFilter();
      hp.type = "highpass";
      hp.frequency.value = 18; // kills DC / rumble

      const comp = ac.createDynamicsCompressor();
      comp.threshold.value = -16;
      comp.knee.value = 24;
      comp.ratio.value = 6;
      comp.attack.value = 0.003;
      comp.release.value = 0.18;

      // saturation (melody)
      const drive = ac.createWaveShaper();
      drive.oversample = "2x";

      // percussion drive
      const percDrive = ac.createWaveShaper();
      percDrive.oversample = "2x";

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
      percDrive.curve = makeCurve(sRef.current.percDrive);

      // dry/wet
      const dry = ac.createGain();
      const wetRev = ac.createGain();
      const wetDel = ac.createGain();

      // reverb
      const convolver = ac.createConvolver();
      convolver.buffer = createReverbImpulse(ac, sRef.current.reverbTime, 2.0);

      // delay with filtered feedback (prevents ringing hum)
      const delay = ac.createDelay(2.0);
      const feedback = ac.createGain();
      const fbFilter = ac.createBiquadFilter();
      fbFilter.type = "lowpass";
      fbFilter.frequency.value = 2600;

      feedback.gain.value = clamp(sRef.current.delayFeedback, 0, 0.75);
      delay.delayTime.value = clamp(sRef.current.delayTime, 0.01, 1.5);

      // feedback loop: delay -> fbFilter -> feedback -> delay
      delay.connect(fbFilter);
      fbFilter.connect(feedback);
      feedback.connect(delay);

      // percussion bus
      const percBus = ac.createGain();
      percBus.gain.value = clamp(sRef.current.percMix, 0, 1.2);
      percBus.connect(percDrive);

      // routing:
      // melody voices -> drive -> dry + FX -> master
      // perc voices  -> percBus -> percDrive -> dry + FX -> master (shares FX)
      drive.connect(dry);
      drive.connect(convolver);
      drive.connect(delay);

      percDrive.connect(dry);
      percDrive.connect(convolver);
      percDrive.connect(delay);

      convolver.connect(wetRev);
      delay.connect(wetDel);

      // master chain
      dry.connect(master);
      wetRev.connect(master);
      wetDel.connect(master);

      master.connect(hp);
      hp.connect(comp);
      comp.connect(ac.destination);

      A.ac = ac;

      A.master = master;
      A.hp = hp;
      A.comp = comp;

      A.drive = drive;
      A.percDrive = percDrive;
      A.percBus = percBus;

      A.dry = dry;
      A.wetRev = wetRev;
      A.wetDel = wetDel;

      A.convolver = convolver;
      A.delay = delay;
      A.feedback = feedback;
      A.fbFilter = fbFilter;

      A.voices = [];
      A.voicePtr = 0;

      A.percVoices = [];
      A.percPtr = 0;

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

  function panicKill() {
    const A = audioRef.current;
    if (!A.ac) return;
    const now = A.ac.currentTime;

    // kill melody voices
    for (const v of A.voices) {
      const g = v.gain.gain;
      g.cancelScheduledValues(now);
      g.setValueAtTime(Math.max(g.value || 0.00001, 0.00001), now);
      g.exponentialRampToValueAtTime(0.00001, now + 0.02);
      v.busyUntil = now + 0.02;
    }
    // kill perc voices
    for (const v of A.percVoices) {
      const g = v.gain.gain;
      g.cancelScheduledValues(now);
      g.setValueAtTime(Math.max(g.value || 0.00001, 0.00001), now);
      g.exponentialRampToValueAtTime(0.00001, now + 0.02);
      v.busyUntil = now + 0.02;
    }

    // pull master down briefly
    A.master.gain.cancelScheduledValues(now);
    const cur = Math.max(A.master.gain.value || 0.00001, 0.00001);
    A.master.gain.setValueAtTime(cur, now);
    A.master.gain.exponentialRampToValueAtTime(0.00001, now + 0.03);
    A.master.gain.exponentialRampToValueAtTime(clamp(sRef.current.master, 0, 1.2), now + 0.08);
  }

  function updateAudioParamsRealtime() {
    const A = audioRef.current;
    if (!A.ac) return;
    const st = sRef.current;

    A.master.gain.setTargetAtTime(clamp(st.master, 0, 1.2), A.ac.currentTime, 0.02);

    // drive curves
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

    // melody drive
    if (st.driveOn) A.drive.curve = makeCurve(st.drive);
    else {
      const n = 2048;
      const curve = new Float32Array(n);
      for (let i = 0; i < n; i++) curve[i] = (i * 2) / (n - 1) - 1;
      A.drive.curve = curve;
    }

    // perc drive + mix
    A.percBus.gain.setTargetAtTime(clamp(st.percMix ?? 0.85, 0, 1.4), A.ac.currentTime, 0.03);
    A.percDrive.curve = makeCurve(clamp(st.percDrive ?? 0.25, 0, 1));

    // reverb
    A.wetRev.gain.setTargetAtTime(st.reverbOn ? clamp(st.reverbMix, 0, 1) : 0, A.ac.currentTime, 0.02);
    if (A._revTime == null) A._revTime = st.reverbTime;
    if (Math.abs(st.reverbTime - A._revTime) > 0.12) {
      A._revTime = st.reverbTime;
      A.convolver.buffer = createReverbImpulse(A.ac, clamp(st.reverbTime, 0.3, 6), 2.0);
    }

    // delay (safe caps)
    A.wetDel.gain.setTargetAtTime(st.delayOn ? clamp(st.delayMix, 0, 1) : 0, A.ac.currentTime, 0.02);
    A.delay.delayTime.setTargetAtTime(clamp(st.delayTime, 0.01, 1.5), A.ac.currentTime, 0.02);
    A.feedback.gain.setTargetAtTime(clamp(st.delayFeedback, 0, 0.75), A.ac.currentTime, 0.02);

    // feedback filter reacts to delay mix/drive a bit
    const fbHz = 1800 + 5200 * clamp(1 - (st.delayFeedback ?? 0.3), 0, 1);
    A.fbFilter.frequency.setTargetAtTime(clamp(fbHz, 900, 7000), A.ac.currentTime, 0.04);
  }

  function ensureVoices() {
    const A = ensureAudio();
    const ac = A.ac;

    const want = clamp(sRef.current.voices ?? 14, 1, 32);
    if (A.voices.length !== want) {
      const newPool = Array.from({ length: want }, () => {
        const v = makeVoice(ac);
        v.gain.connect(A.drive);
        return v;
      });
      A.voices = newPool;
      A.voicePtr = 0;
    }

    const wantP = clamp(sRef.current.percVoices ?? 10, 1, 32);
    if (A.percVoices.length !== wantP) {
      const newPool = Array.from({ length: wantP }, () => {
        const v = makePercVoice(ac);
        v.gain.connect(A.percBus);
        return v;
      });
      A.percVoices = newPool;
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
     Scheduler (stable)
     - columns affect step speed AND sound articulation (more obvious)
     - rows affect envelope (tails) AND density affects more
======================= */
  function startScheduler() {
    const A = ensureAudio();
    const ac = A.ac;
    if (ac.state === "suspended") ac.resume?.();
    A.running = true;

    const tick = () => {
      if (!audioRef.current.running) return;

      const st = sRef.current;

      // keep context alive if it got suspended
      if (audioRef.current.ac?.state === "suspended") {
        audioRef.current.timer = setTimeout(tick, 60);
        return;
      }

      ensureVoices();
      updateAudioParamsRealtime();

      // dims
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

      // column width -> rhythm (more drastic)
      let colMul = 1;
      if (isSwiss && st.varColsOn) {
        const ce = colEdges || Array.from({ length: cols + 1 }, (_, i) => i / cols);
        const curCol = audioRef.current.step % cols;
        const w = ce[curCol + 1] - ce[curCol];
        const avg = 1 / cols;
        const ratio = clamp(w / avg, 0.22, 3.2);
        stepSec = baseStepSec * ratio;
        colMul = ratio;
      }

      const col = audioRef.current.step % cols;

      // harmony
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

      const nowS = performance.now() * 0.001;

      // build lookups
      const melMap = new Map();
      for (const c of melCellsRef.current) melMap.set(c.idx, c);
      const percMap = new Map();
      for (const c of percCellsRef.current) percMap.set(c.idx, c);

      // row edges for tail shaping
      const re = isSwiss ? rowEdges || Array.from({ length: rows + 1 }, (_, i) => i / rows) : null;
      const avgRowH = isSwiss ? 1 / rows : 1;

      // ===== Melody hits
      const melHits = [];
      if (st.soundOn) {
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

          let lane = 0;
          if (st.laneMode === "hue") {
            const lanes = chordTones.length;
            lane = clamp(Math.floor(h * lanes), 0, lanes - 1);
          } else {
            lane = col % chordTones.length;
          }

          const rowNorm = rows <= 1 ? 0.5 : 1 - r / (rows - 1); // top=1
          const degIdx = clamp(Math.round(rowNorm * (degreesCount - 1)), 0, degreesCount - 1);

          const rowMidi = scaleMidi[degIdx];
          let target = chordTones[lane];
          while (target < rowMidi - 6) target += 12;
          while (target > rowMidi + 6) target -= 12;
          const freq = midiToFreq(target);

          const vel = st.velFrom === "fixed" ? 0.55 : clamp(0.08 + 0.92 * lum, 0.05, 1);

          // BIGGER audible effect from column density:
          // narrow (fast) columns -> snappier + brighter; wide -> longer + darker
          const colSpeed = clamp(1 / colMul, 0.25, 3.0); // narrow => bigger

          const cutoff =
            (st.cutoffBase ?? 400) +
            (st.cutoffSpan ?? 7200) * clamp(0.12 + 0.88 * lum, 0, 1) * clamp(0.85 + colSpeed * 0.25, 0.7, 1.35);

          let attack = (st.atkBase ?? 0.008) + (st.atkSpan ?? 0.09) * clamp(1 - rowNorm, 0, 1);
          let decay = (st.decBase ?? 0.08) + (st.decSpan ?? 0.65) * clamp(lum, 0, 1);
          let release = (st.relBase ?? 0.06) + (st.relSpan ?? 0.85) * clamp(rowNorm, 0, 1);

          // row density -> bigger tail differences (more obvious)
          if (isSwiss && st.varRowsOn && re) {
            const rh = re[r + 1] - re[r];
            const ratio = clamp(rh / avgRowH, 0.25, 3.0);
            const tailMul = clamp(ratio, 0.40, 2.6);
            decay *= tailMul;
            release *= tailMul;
            attack *= clamp(1.35 - (tailMul - 1) * 0.55, 0.35, 1.55);
          }

          // column density also shapes articulation
          const wideMul = clamp(colMul, 0.35, 2.5); // wide => bigger
          decay *= clamp(0.75 + wideMul * 0.35, 0.6, 1.6);
          release *= clamp(0.75 + wideMul * 0.35, 0.6, 1.8);
          attack *= clamp(1.15 - (wideMul - 1) * 0.25, 0.55, 1.35);

          attack = clamp(attack, 0.002, 0.22);
          decay = clamp(decay, 0.03, 2.4);
          release = clamp(release, 0.03, 3.0);

          melHits.push({ freq, vel, cutoff, attack, decay, release, score: vel });
        }
      }

      melHits.sort((a, b) => b.score - a.score);
      const melChosen = melHits.slice(0, Math.min(maxNotes, melHits.length));

      // trigger melody
      const mPool = audioRef.current.voices;
      for (const h of melChosen) {
        const v = mPool[audioRef.current.voicePtr % mPool.length];
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

      // ===== Percussion hits (uses same scanning column)
      if (st.percOn) {
        const percHits = [];
        for (let r = 0; r < rows; r++) {
          const idx = r * cols + col;
          const cell = percMap.get(idx);
          const paintObj = cell?.paint;
          if (!paintObj?.color) continue;

          if (typeof cell.expiresAt === "number" && cell.expiresAt <= nowS) continue;

          const rgb = hexToRgb(paintObj.color);
          if (!rgb) continue;

          const lum = luminance01(rgb);
          const rowNorm = rows <= 1 ? 0.5 : 1 - r / (rows - 1); // top=1

          // row -> tune (bottom = lower)
          const tune = (rowNorm - 0.5) * -1 * clamp(st.percTuneSpan ?? 24, 0, 60);

          // density affects decay a lot (so "rows/tails" actually matters)
          let decay = (st.percDecay ?? 0.28) + (st.percDecaySpan ?? 1.8) * clamp(1 - rowNorm, 0, 1);

          if (isSwiss && st.varRowsOn && re) {
            const rh = re[r + 1] - re[r];
            const ratio = clamp(rh / avgRowH, 0.25, 3.0);
            decay *= clamp(ratio, 0.4, 2.8);
          }

          // columns (rhythm) also shapes perc tightness
          decay *= clamp(colMul, 0.35, 2.4);

          const vel = clamp(0.10 + 0.90 * lum, 0.06, 1);
          const score = vel;

          percHits.push({ tune, vel, decay, score });
        }

        percHits.sort((a, b) => b.score - a.score);
        const pMax = clamp(Math.floor((st.maxNotesPerStep ?? 10) * 0.8), 1, 24);
        const percChosen = percHits.slice(0, Math.min(pMax, percHits.length));

        const pPool = audioRef.current.percVoices;
        for (const h of percChosen) {
          const v = pPool[audioRef.current.percPtr % pPool.length];
          audioRef.current.percPtr++;

          triggerPerc(ac, v, {
            baseHz: clamp(st.percBaseHz ?? 80, 20, 400),
            tune: h.tune,
            vel: h.vel,
            decay: h.decay,
            tone: clamp(st.percTone ?? 0.55, 0, 1),
            clickAmt: clamp(st.percClick ?? 0.35, 0, 1),
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
======================= */
  const [midiSupported, setMidiSupported] = React.useState(false);
  const [midiInputs, setMidiInputs] = React.useState([]);
  const [midiInputId, setMidiInputId] = React.useState("");
  const midiAccessRef = React.useRef(null);
  const midiActiveRef = React.useRef(new Map());

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

  const midiNoteToCell = React.useCallback(
    (note) => {
      const st = sRef.current;
      const { cols, rows } = getGridDims();
      const lo = clamp(st.midiLo ?? 36, 0, 127);
      const hi = clamp(st.midiHi ?? 84, 0, 127);
      const span = Math.max(1, hi - lo);

      const t = clamp((note - lo) / span, 0, 1);
      const row = clamp(Math.round((1 - t) * (rows - 1)), 0, rows - 1);

      // spread across grid columns too, not just one: use note hash + current step
      const seed = (note * 131 + (audioRef.current.step || 0) * 17) >>> 0;
      const col = (seed % cols) | 0;

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

      // MIDI paints on the ACTIVE layer (so you can choose melody vs perc)
      const layer = activeLayer === "perc" ? "perc" : "melody";

      upsertCell(layer, idx, {
        paint: { mode: "color", color },
        midi: { note, vel: vel01, ch, t0: nowS, dur: 0 },
        expiresAt,
      });

      midiActiveRef.current.set(`${note}:${ch}`, { t0: nowS, vel01, note, ch, idx, row, col, layer });
    },
    [midiNoteToCell, midiToColor, upsertCell, activeLayer]
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
      const fadeMin = clamp(st.midiFadeMin ?? 0.25, 0.05, 8);
      const fadeMax = clamp(st.midiFadeMax ?? 2.5, fadeMin, 10);

      const fade = clamp(fadeMin + (fadeMax - fadeMin) * clamp(dur / 2.0, 0, 1), 0.05, 12);
      const expiresAt = nowS + fade;

      upsertCell(entry.layer, entry.idx, {
        paint: { mode: "color", color },
        midi: { note, vel: entry.vel01, ch, t0: entry.t0, dur },
        expiresAt,
      });

      midiActiveRef.current.delete(key);
    },
    [midiToColor, upsertCell]
  );

  const midiThruPlay = React.useCallback((note, vel) => {
    const st = sRef.current;
    if (!st.midiOn || !st.midiThru) return;

    const A = ensureAudio();
    const ac = A.ac;
    if (!ac || ac.state === "suspended") return;

    ensureVoices();
    updateAudioParamsRealtime();

    // plays MELODY synth immediately
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

    const layer = activeLayer === "perc" ? "perc" : "melody";

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

    const layer = activeLayer === "perc" ? "perc" : "melody";

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

  const gen = () => {
    // keep UI button; also re-kicks scheduler feel
    setMelCells((p) => [...p]);
    setPercCells((p) => [...p]);
  };

  const clearActiveLayer = () => {
    if (activeLayer === "perc") setPercCells([]);
    else setMelCells([]);
    // user expects clear to stop sound immediately
    panicKill();
  };

  const clearAll = () => {
    setMelCells([]);
    setPercCells([]);
    panicKill();
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

    const dark = !!s.dark;
    const bg = dark ? "#0B0B0D" : "#FAFAFA";
    const grid = dark ? "#24242A" : "#E6E6E6";
    const ink = dark ? "#EDEDF2" : "#111111";
    const ink2 = dark ? "#B7B7C2" : "#0A0A0A";

    ctx.clearRect(0, 0, w, h);
    ctx.fillStyle = bg;
    ctx.fillRect(0, 0, w, h);

    const t = tm * 0.001;
    const nowS = performance.now() * 0.001;

    const mapMel = new Map();
    for (const c of melCells) mapMel.set(c.idx, c);
    const mapPerc = new Map();
    for (const c of percCells) mapPerc.set(c.idx, c);

    const drawCell = (entry, x, y, cw, ch, isPerc) => {
      if (!entry?.paint?.color) return;
      let a = 1;
      if (entry?.expiresAt != null) {
        const rem = entry.expiresAt - nowS;
        if (rem <= 0) return;
        a = clamp(rem / 0.35, 0, 1);
      }
      ctx.save();
      ctx.fillStyle = entry.paint.color;
      ctx.globalAlpha = (isPerc ? 0.62 : 0.92) * a;
      ctx.fillRect(x, y, cw, ch);

      // percussion gets a subtle inset frame so you can see overlap
      if (isPerc) {
        ctx.globalAlpha = 0.55 * a;
        ctx.strokeStyle = dark ? "#EDEDF2" : "#111111";
        ctx.lineWidth = Math.max(1, Math.min(cw, ch) * 0.06);
        ctx.strokeRect(x + ctx.lineWidth * 0.5, y + ctx.lineWidth * 0.5, cw - ctx.lineWidth, ch - ctx.lineWidth);
      }
      ctx.restore();
    };

    ctx.textAlign = "center";
    ctx.textBaseline = "middle";

    if (s.pat === "char-grid") {
      const cols = Math.max(1, Math.floor(w / s.space));
      const rows = Math.max(1, Math.floor(h / s.space));

      if (s.gridLines) {
        ctx.save();
        ctx.strokeStyle = dark ? "#1E1E24" : "#EAEAEA";
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

          const showMel = viewLayer === "melody" || viewLayer === "both";
          const showPerc = viewLayer === "perc" || viewLayer === "both";

          if (showMel) drawCell(mapMel.get(idx), x0, y0, s.space, s.space, false);
          if (showPerc) drawCell(mapPerc.get(idx), x0, y0, s.space, s.space, true);

          const hasAny = (showMel && mapMel.get(idx)?.paint?.color) || (showPerc && mapPerc.get(idx)?.paint?.color);

          const gi = chs.length ? Math.floor((t * spd + r * 0.07 + c * 0.05) * 3) % chs.length : 0;
          ctx.save();
          ctx.font = `${s.charSz}px ${getFontFamily()}`;
          ctx.fillStyle = hasAny ? ink2 : ink;
          ctx.globalAlpha = hasAny ? 1 : 0.92;
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
        ctx.strokeStyle = grid;
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

          const showMel = viewLayer === "melody" || viewLayer === "both";
          const showPerc = viewLayer === "perc" || viewLayer === "both";

          if (showMel) drawCell(mapMel.get(idx), g.x, g.y, g.w, g.h, false);
          if (showPerc) drawCell(mapPerc.get(idx), g.x, g.y, g.w, g.h, true);

          const hasAny = (showMel && mapMel.get(idx)?.paint?.color) || (showPerc && mapPerc.get(idx)?.paint?.color);

          const gi = chs.length ? Math.floor((t * spd + r * 0.09 + c * 0.05) * 3) % chs.length : 0;
          const sz = Math.max(8, Math.min(g.w, g.h) * 0.55 * (s.swissCharScale ?? 1));

          ctx.save();
          ctx.font = `${Math.floor(sz)}px ${getFontFamily()}`;
          ctx.fillStyle = hasAny ? ink2 : ink;
          ctx.globalAlpha = hasAny ? 1 : 0.92;
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
  }, [s, melCells, percCells, colEdges, rowEdges, viewLayer]);

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
  const dark = !!s.dark;

  const shellBg = dark ? "bg-[#0B0B0D] text-[#EDEDF2]" : "bg-white text-black";
  const panelBg = dark ? "bg-[#111114] border-[#23232A]" : "bg-neutral-50 border-neutral-200";
  const panelText = dark ? "text-[#EDEDF2]" : "text-black";
  const inputBg = dark ? "bg-[#15151A] border-[#2B2B33] text-[#EDEDF2]" : "bg-white border-neutral-300 text-black";
  const softText = dark ? "text-[#B7B7C2]" : "text-neutral-600";

  return (
    <div className={`w-full h-[100svh] ${shellBg} flex flex-col md:flex-row overflow-hidden`}>
      {panelOpen && (
        <div className="fixed inset-0 bg-black/30 z-30 md:hidden" onClick={() => setPanelOpen(false)} />
      )}

      {/* Controls */}
      <div
        className={
          `fixed md:static z-40 md:z-auto inset-y-0 left-0 w-80 max-w-[90vw] ${panelBg} border-r p-4 md:p-5 overflow-y-auto space-y-4 text-sm transform transition-transform duration-200 md:transform-none ` +
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
              l.href = canvasRef.current?.toDataURL?.() || "";
              l.click();
            }}
            className="flex-1 flex justify-center px-4 py-2.5 bg-black text-white rounded-lg font-medium hover:bg-neutral-800 min-h-[44px]"
            title="Download PNG"
          >
            <Download size={16} />
          </button>
          <button
            onClick={() => setS((p) => ({ ...p, dark: !p.dark }))}
            className="px-3 py-2.5 rounded-lg bg-neutral-900 text-white hover:bg-black min-h-[44px]"
            title="Dark mode"
          >
            {dark ? <Sun size={16} /> : <Moon size={16} />}
          </button>
        </div>

        <button
          onClick={unlockAudio}
          className="w-full px-4 py-2.5 bg-neutral-900 text-white rounded-lg font-medium hover:bg-black min-h-[44px]"
        >
          Enable Audio (click once)
        </button>

        <div className="flex gap-2">
          <button
            onClick={panicKill}
            className="flex-1 px-3 py-2.5 rounded-lg bg-[#B91C1C] text-white font-semibold hover:bg-[#991B1B] min-h-[44px] flex items-center justify-center gap-2"
            title="Stops hum / stuck notes"
          >
            <AlertTriangle size={16} />
            PANIC
          </button>
          <button
            onClick={clearAll}
            className="flex-1 px-3 py-2.5 rounded-lg bg-neutral-800 text-white font-semibold hover:bg-black min-h-[44px]"
          >
            Clear ALL
          </button>
        </div>

        {/* Layer controls */}
        <div className="space-y-2">
          <label className={`block text-xs font-semibold uppercase tracking-wider ${panelText}`}>Layers</label>

          <div className="grid grid-cols-2 gap-2">
            <button
              onClick={() => setActiveLayer("melody")}
              className={`px-3 py-2 rounded-lg border text-xs font-semibold min-h-[44px] ${
                activeLayer === "melody" ? "bg-black text-white border-black" : dark ? "bg-[#15151A] border-[#2B2B33] text-[#EDEDF2]" : "bg-white border-neutral-300"
              }`}
            >
              Paint: Melody
            </button>
            <button
              onClick={() => setActiveLayer("perc")}
              className={`px-3 py-2 rounded-lg border text-xs font-semibold min-h-[44px] ${
                activeLayer === "perc" ? "bg-black text-white border-black" : dark ? "bg-[#15151A] border-[#2B2B33] text-[#EDEDF2]" : "bg-white border-neutral-300"
              }`}
            >
              Paint: Perc
            </button>
          </div>

          <div className="grid grid-cols-3 gap-2">
            <button
              onClick={() => setViewLayer("melody")}
              className={`px-2 py-2 rounded-lg border text-xs font-semibold min-h-[40px] ${
                viewLayer === "melody" ? "bg-black text-white border-black" : dark ? "bg-[#15151A] border-[#2B2B33] text-[#EDEDF2]" : "bg-white border-neutral-300"
              }`}
            >
              View Mel
            </button>
            <button
              onClick={() => setViewLayer("both")}
              className={`px-2 py-2 rounded-lg border text-xs font-semibold min-h-[40px] ${
                viewLayer === "both" ? "bg-black text-white border-black" : dark ? "bg-[#15151A] border-[#2B2B33] text-[#EDEDF2]" : "bg-white border-neutral-300"
              }`}
            >
              View Both
            </button>
            <button
              onClick={() => setViewLayer("perc")}
              className={`px-2 py-2 rounded-lg border text-xs font-semibold min-h-[40px] ${
                viewLayer === "perc" ? "bg-black text-white border-black" : dark ? "bg-[#15151A] border-[#2B2B33] text-[#EDEDF2]" : "bg-white border-neutral-300"
              }`}
            >
              View Perc
            </button>
          </div>

          <button
            onClick={clearActiveLayer}
            className="w-full px-4 py-2.5 bg-neutral-900 text-white rounded-lg font-medium hover:bg-black min-h-[44px]"
          >
            Clear Active Layer (also stops sound)
          </button>
        </div>

        {/* Pattern */}
        <div className="space-y-2">
          <label className={`block text-xs font-semibold uppercase tracking-wider ${panelText}`}>Pattern</label>
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
          <label className={`block text-xs font-semibold uppercase tracking-wider ${panelText}`}>Paint</label>

          <div className="flex items-center justify-between gap-2">
            <input
              type="color"
              value={paint.color}
              onChange={(e) => setPaint((p) => ({ ...p, color: e.target.value, useSeq: false }))}
              className={`h-10 w-14 rounded-md border ${dark ? "border-[#2B2B33] bg-[#15151A]" : "border-neutral-300 bg-white"}`}
              title="Pick color"
            />

            <button
              onClick={() => setPaint((p) => ({ ...p, useSeq: !p.useSeq, mode: "color" }))}
              className={`flex-1 px-3 py-2 rounded-lg border text-xs font-semibold flex items-center justify-center gap-2 min-h-[44px] ${
                paint.useSeq ? "bg-black text-white border-black" : dark ? "bg-[#15151A] border-[#2B2B33] text-[#EDEDF2]" : "bg-white border-neutral-300"
              }`}
            >
              <Palette size={14} />
              {paint.useSeq ? "Color String ON" : "Color String OFF"}
            </button>

            <button
              onClick={() => setPaint((p) => ({ ...p, mode: p.mode === "none" ? "color" : "none" }))}
              className={`px-3 py-2 rounded-lg text-xs font-semibold min-h-[44px] ${
                paint.mode === "none" ? "bg-black text-white" : dark ? "bg-[#2B2B33] text-[#EDEDF2]" : "bg-neutral-200 text-neutral-700"
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
                className={`h-9 w-full rounded-md border ${dark ? "border-[#2B2B33] bg-[#15151A]" : "border-neutral-300 bg-white"}`}
                title={`Color String ${i + 1}`}
              />
            ))}
          </div>

          <div className="grid grid-cols-2 gap-2">
            <div className="space-y-1">
              <div className={`text-xs ${softText}`}>Color motion</div>
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
              <div className={`text-xs ${softText}`}>Speed</div>
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
        </div>

        {/* Grid controls */}
        {s.pat === "swiss-grid" && (
          <div className="space-y-2">
            <label className={`block text-xs font-semibold uppercase tracking-wider ${panelText}`}>
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
              <label className={`text-xs font-semibold uppercase tracking-wider ${panelText}`}>Grid Lines</label>
              <button
                onClick={() => setS((p) => ({ ...p, gridLines: !p.gridLines }))}
                className={`p-1.5 rounded ${s.gridLines ? "bg-black text-white" : dark ? "bg-[#2B2B33] text-[#EDEDF2]" : "bg-neutral-200"}`}
              >
                {s.gridLines ? <Play size={14} fill="white" /> : <Square size={14} />}
              </button>
            </div>

            <label className={`block text-xs font-semibold uppercase tracking-wider ${panelText}`}>Variable Grid Density</label>

            <div className={`rounded-lg border p-3 space-y-2 ${dark ? "border-[#2B2B33] bg-[#15151A]" : "border-neutral-200 bg-white"}`}>
              <div className="flex items-center justify-between">
                <div className={`text-xs font-semibold uppercase tracking-wider ${panelText}`}>Columns (rhythm)</div>
                <button
                  onClick={() => setS((p) => ({ ...p, varColsOn: !p.varColsOn }))}
                  className={`p-1.5 rounded ${s.varColsOn ? "bg-black text-white" : dark ? "bg-[#2B2B33] text-[#EDEDF2]" : "bg-neutral-200"}`}
                >
                  {s.varColsOn ? <Play size={14} fill="white" /> : <Square size={14} />}
                </button>
              </div>
              {s.varColsOn && (
                <>
                  <label className={`block text-xs font-semibold uppercase tracking-wider ${panelText}`}>Focus X: {s.colFocus.toFixed(2)}</label>
                  <input type="range" min="0" max="1" step="0.01" value={s.colFocus} onChange={(e) => setS((p) => ({ ...p, colFocus: parseFloat(e.target.value) }))} className="w-full" />
                  <label className={`block text-xs font-semibold uppercase tracking-wider ${panelText}`}>Strength: {s.colStrength.toFixed(1)}</label>
                  <input type="range" min="0" max="20" step="0.1" value={s.colStrength} onChange={(e) => setS((p) => ({ ...p, colStrength: parseFloat(e.target.value) }))} className="w-full" />
                  <label className={`block text-xs font-semibold uppercase tracking-wider ${panelText}`}>Band Width: {s.colSigma.toFixed(2)}</label>
                  <input type="range" min="0.05" max="0.5" step="0.01" value={s.colSigma} onChange={(e) => setS((p) => ({ ...p, colSigma: parseFloat(e.target.value) }))} className="w-full" />
                  <div className={`text-[11px] ${softText}`}>Now affects <b>step speed</b> AND <b>articulation</b> (snappy vs long).</div>
                </>
              )}
            </div>

            <div className={`rounded-lg border p-3 space-y-2 ${dark ? "border-[#2B2B33] bg-[#15151A]" : "border-neutral-200 bg-white"}`}>
              <div className="flex items-center justify-between">
                <div className={`text-xs font-semibold uppercase tracking-wider ${panelText}`}>Rows (tails)</div>
                <button
                  onClick={() => setS((p) => ({ ...p, varRowsOn: !p.varRowsOn }))}
                  className={`p-1.5 rounded ${s.varRowsOn ? "bg-black text-white" : dark ? "bg-[#2B2B33] text-[#EDEDF2]" : "bg-neutral-200"}`}
                >
                  {s.varRowsOn ? <Play size={14} fill="white" /> : <Square size={14} />}
                </button>
              </div>
              {s.varRowsOn && (
                <>
                  <label className={`block text-xs font-semibold uppercase tracking-wider ${panelText}`}>Focus Y: {s.rowFocus.toFixed(2)}</label>
                  <input type="range" min="0" max="1" step="0.01" value={s.rowFocus} onChange={(e) => setS((p) => ({ ...p, rowFocus: parseFloat(e.target.value) }))} className="w-full" />
                  <label className={`block text-xs font-semibold uppercase tracking-wider ${panelText}`}>Strength: {s.rowStrength.toFixed(1)}</label>
                  <input type="range" min="0" max="20" step="0.1" value={s.rowStrength} onChange={(e) => setS((p) => ({ ...p, rowStrength: parseFloat(e.target.value) }))} className="w-full" />
                  <label className={`block text-xs font-semibold uppercase tracking-wider ${panelText}`}>Band Width: {s.rowSigma.toFixed(2)}</label>
                  <input type="range" min="0.05" max="0.5" step="0.01" value={s.rowSigma} onChange={(e) => setS((p) => ({ ...p, rowSigma: parseFloat(e.target.value) }))} className="w-full" />
                  <div className={`text-[11px] ${softText}`}>Now strongly changes <b>decay/release</b> and affects percussion decay too.</div>
                </>
              )}
            </div>
          </div>
        )}

        {s.pat === "char-grid" && (
          <div className="space-y-2">
            <label className={`block text-xs font-semibold uppercase tracking-wider ${panelText}`}>Spacing: {s.space}px</label>
            <input type="range" min="12" max="120" value={s.space} onChange={(e) => setS((p) => ({ ...p, space: parseInt(e.target.value, 10) }))} className="w-full" />
            <label className={`block text-xs font-semibold uppercase tracking-wider ${panelText}`}>Char Size: {s.charSz}px</label>
            <input type="range" min="8" max="80" value={s.charSz} onChange={(e) => setS((p) => ({ ...p, charSz: parseInt(e.target.value, 10) }))} className="w-full" />
            <label className={`block text-xs font-semibold uppercase tracking-wider ${panelText}`}>Char Speed: {s.charSpd.toFixed(2)}×</label>
            <input type="range" min="0" max="10" step="0.1" value={s.charSpd} onChange={(e) => setS((p) => ({ ...p, charSpd: parseFloat(e.target.value) }))} className="w-full" />
            <label className={`block text-xs font-semibold uppercase tracking-wider ${panelText}`}>Characters</label>
            <input type="text" value={s.chars} onChange={(e) => setS((p) => ({ ...p, chars: e.target.value }))} className={`w-full px-3 py-2 rounded-lg font-mono border ${inputBg}`} />
          </div>
        )}

        {/* Melody */}
        <div className="space-y-2">
          <div className="flex items-center justify-between">
            <label className={`text-xs font-semibold uppercase tracking-wider ${panelText}`}>Melody</label>
            <button
              onClick={() => setS((p) => ({ ...p, soundOn: !p.soundOn }))}
              className={`p-1.5 rounded ${s.soundOn ? "bg-black text-white" : dark ? "bg-[#2B2B33] text-[#EDEDF2]" : "bg-neutral-200"}`}
            >
              {s.soundOn ? <Play size={14} fill="white" /> : <Square size={14} />}
            </button>
          </div>

          <label className={`block text-xs font-semibold uppercase tracking-wider ${panelText}`}>BPM: {s.bpm}</label>
          <input type="range" min="40" max="220" value={s.bpm} onChange={(e) => setS((p) => ({ ...p, bpm: parseInt(e.target.value, 10) }))} className="w-full" />

          <label className={`block text-xs font-semibold uppercase tracking-wider ${panelText}`}>Max notes / step: {s.maxNotesPerStep}</label>
          <input type="range" min="1" max="24" value={s.maxNotesPerStep} onChange={(e) => setS((p) => ({ ...p, maxNotesPerStep: parseInt(e.target.value, 10) }))} className="w-full" />

          <div className="grid grid-cols-2 gap-2">
            <div className="space-y-1">
              <div className={`text-xs ${softText}`}>Key</div>
              <select value={s.keyRoot} onChange={(e) => setS((p) => ({ ...p, keyRoot: parseInt(e.target.value, 10) }))} className={`w-full px-2 py-2 rounded-lg border text-xs ${inputBg}`}>
                {NOTE_NAMES.map((n, i) => (
                  <option key={n} value={i}>
                    {n}
                  </option>
                ))}
              </select>
            </div>
            <div className="space-y-1">
              <div className={`text-xs ${softText}`}>Scale</div>
              <select value={s.scaleName} onChange={(e) => setS((p) => ({ ...p, scaleName: e.target.value }))} className={`w-full px-2 py-2 rounded-lg border text-xs ${inputBg}`}>
                {Object.keys(SCALES).map((name) => (
                  <option key={name} value={name}>
                    {name}
                  </option>
                ))}
              </select>
            </div>
          </div>

          <div className={`text-[11px] ${softText}`}>
            <b>Always in tune:</b> pitches are quantized to {keyName} {s.scaleName}.<br />
            <b>Anti-hum:</b> PANIC kills stuck envelopes + feedback.
          </div>

          <label className={`block text-xs font-semibold uppercase tracking-wider ${panelText}`}>Voices: {s.voices}</label>
          <input type="range" min="1" max="24" value={s.voices} onChange={(e) => setS((p) => ({ ...p, voices: parseInt(e.target.value, 10) }))} className="w-full" />

          <label className={`block text-xs font-semibold uppercase tracking-wider ${panelText}`}>Master: {s.master.toFixed(2)}</label>
          <input type="range" min="0" max="1.2" step="0.01" value={s.master} onChange={(e) => setS((p) => ({ ...p, master: parseFloat(e.target.value) }))} className="w-full" />
        </div>

        {/* Percussion */}
        <div className="space-y-2">
          <div className="flex items-center justify-between">
            <label className={`text-xs font-semibold uppercase tracking-wider ${panelText}`}>Percussion</label>
            <button
              onClick={() => setS((p) => ({ ...p, percOn: !p.percOn }))}
              className={`p-1.5 rounded ${s.percOn ? "bg-black text-white" : dark ? "bg-[#2B2B33] text-[#EDEDF2]" : "bg-neutral-200"}`}
            >
              {s.percOn ? <Play size={14} fill="white" /> : <Square size={14} />}
            </button>
          </div>

          <label className={`block text-xs font-semibold uppercase tracking-wider ${panelText}`}>Perc Voices: {s.percVoices}</label>
          <input type="range" min="1" max="24" value={s.percVoices} onChange={(e) => setS((p) => ({ ...p, percVoices: parseInt(e.target.value, 10) }))} className="w-full" />

          <label className={`block text-xs font-semibold uppercase tracking-wider ${panelText}`}>Base Pitch (Hz): {s.percBaseHz}</label>
          <input type="range" min="20" max="220" value={s.percBaseHz} onChange={(e) => setS((p) => ({ ...p, percBaseHz: parseInt(e.target.value, 10) }))} className="w-full" />

          <label className={`block text-xs font-semibold uppercase tracking-wider ${panelText}`}>Tune Span (semitones): {s.percTuneSpan}</label>
          <input type="range" min="0" max="48" value={s.percTuneSpan} onChange={(e) => setS((p) => ({ ...p, percTuneSpan: parseInt(e.target.value, 10) }))} className="w-full" />

          <label className={`block text-xs font-semibold uppercase tracking-wider ${panelText}`}>Decay: {s.percDecay.toFixed(2)}s</label>
          <input type="range" min="0.03" max="1.2" step="0.01" value={s.percDecay} onChange={(e) => setS((p) => ({ ...p, percDecay: parseFloat(e.target.value) }))} className="w-full" />

          <label className={`block text-xs font-semibold uppercase tracking-wider ${panelText}`}>Decay Span: {s.percDecaySpan.toFixed(2)}</label>
          <input type="range" min="0" max="3.5" step="0.01" value={s.percDecaySpan} onChange={(e) => setS((p) => ({ ...p, percDecaySpan: parseFloat(e.target.value) }))} className="w-full" />

          <div className="grid grid-cols-2 gap-2">
            <div className="space-y-1">
              <div className={`text-xs ${softText}`}>Tone</div>
              <input type="range" min="0" max="1" step="0.01" value={s.percTone} onChange={(e) => setS((p) => ({ ...p, percTone: parseFloat(e.target.value) }))} className="w-full" />
            </div>
            <div className="space-y-1">
              <div className={`text-xs ${softText}`}>Click</div>
              <input type="range" min="0" max="1" step="0.01" value={s.percClick} onChange={(e) => setS((p) => ({ ...p, percClick: parseFloat(e.target.value) }))} className="w-full" />
            </div>
          </div>

          <label className={`block text-xs font-semibold uppercase tracking-wider ${panelText}`}>Perc Mix: {s.percMix.toFixed(2)}</label>
          <input type="range" min="0" max="1.2" step="0.01" value={s.percMix} onChange={(e) => setS((p) => ({ ...p, percMix: parseFloat(e.target.value) }))} className="w-full" />

          <label className={`block text-xs font-semibold uppercase tracking-wider ${panelText}`}>Perc Drive: {s.percDrive.toFixed(2)}</label>
          <input type="range" min="0" max="1" step="0.01" value={s.percDrive} onChange={(e) => setS((p) => ({ ...p, percDrive: parseFloat(e.target.value) }))} className="w-full" />

          <div className={`text-[11px] ${softText}`}>
            Tip: to get deeper Taiko-ish weight, lower <b>Base Pitch</b> and raise <b>Decay</b>, then reduce <b>Click</b>.
          </div>
        </div>

        {/* MIDI */}
        <div className="space-y-2">
          <div className="flex items-center justify-between">
            <label className={`text-xs font-semibold uppercase tracking-wider ${panelText}`}>MIDI</label>
            <button
              onClick={() => setS((p) => ({ ...p, midiOn: !p.midiOn }))}
              className={`p-1.5 rounded ${s.midiOn ? "bg-black text-white" : dark ? "bg-[#2B2B33] text-[#EDEDF2]" : "bg-neutral-200"}`}
              disabled={!midiSupported}
            >
              {s.midiOn ? <Play size={14} fill="white" /> : <Square size={14} />}
            </button>
          </div>

          {!midiSupported ? (
            <div className={`text-[11px] ${softText}`}>This browser/device doesn’t support Web MIDI.</div>
          ) : (
            <>
              <div className="space-y-1">
                <div className={`text-xs ${softText}`}>Input</div>
                <select value={midiInputId} onChange={(e) => setMidiInputId(e.target.value)} className={`w-full px-2 py-2 rounded-lg border text-xs ${inputBg}`}>
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
                    s.midiDraw ? "bg-black text-white border-black" : dark ? "bg-[#15151A] border-[#2B2B33] text-[#EDEDF2]" : "bg-white border-neutral-300"
                  }`}
                >
                  MIDI draws
                </button>
                <button
                  onClick={() => setS((p) => ({ ...p, midiThru: !p.midiThru }))}
                  className={`px-3 py-2 rounded-lg border text-xs font-semibold min-h-[44px] ${
                    s.midiThru ? "bg-black text-white border-black" : dark ? "bg-[#15151A] border-[#2B2B33] text-[#EDEDF2]" : "bg-white border-neutral-300"
                  }`}
                >
                  MIDI thru
                </button>
              </div>

              <div className={`text-[11px] ${softText}`}>
                MIDI draws into your <b>active paint layer</b>. Note mapping spreads across columns now (not just one).
              </div>
            </>
          )}
        </div>

        {/* FX */}
        <div className="space-y-2">
          <label className={`block text-xs font-semibold uppercase tracking-wider ${panelText}`}>FX</label>

          <div className={`rounded-lg border p-3 space-y-2 ${dark ? "border-[#2B2B33] bg-[#15151A]" : "border-neutral-200 bg-white"}`}>
            <div className="flex items-center justify-between">
              <div className={`text-xs font-semibold uppercase tracking-wider ${panelText}`}>Reverb</div>
              <button
                onClick={() => setS((p) => ({ ...p, reverbOn: !p.reverbOn }))}
                className={`p-1.5 rounded ${s.reverbOn ? "bg-black text-white" : dark ? "bg-[#2B2B33] text-[#EDEDF2]" : "bg-neutral-200"}`}
              >
                {s.reverbOn ? <Play size={14} fill="white" /> : <Square size={14} />}
              </button>
            </div>
            <label className={`block text-xs font-semibold uppercase tracking-wider ${panelText}`}>Mix: {s.reverbMix.toFixed(2)}</label>
            <input type="range" min="0" max="0.8" step="0.01" value={s.reverbMix} onChange={(e) => setS((p) => ({ ...p, reverbMix: parseFloat(e.target.value) }))} className="w-full" />
            <label className={`block text-xs font-semibold uppercase tracking-wider ${panelText}`}>Time: {s.reverbTime.toFixed(1)}s</label>
            <input type="range" min="0.5" max="6" step="0.1" value={s.reverbTime} onChange={(e) => setS((p) => ({ ...p, reverbTime: parseFloat(e.target.value) }))} className="w-full" />
          </div>

          <div className={`rounded-lg border p-3 space-y-2 ${dark ? "border-[#2B2B33] bg-[#15151A]" : "border-neutral-200 bg-white"}`}>
            <div className="flex items-center justify-between">
              <div className={`text-xs font-semibold uppercase tracking-wider ${panelText}`}>Delay</div>
              <button
                onClick={() => setS((p) => ({ ...p, delayOn: !p.delayOn }))}
                className={`p-1.5 rounded ${s.delayOn ? "bg-black text-white" : dark ? "bg-[#2B2B33] text-[#EDEDF2]" : "bg-neutral-200"}`}
              >
                {s.delayOn ? <Play size={14} fill="white" /> : <Square size={14} />}
              </button>
            </div>

            <label className={`block text-xs font-semibold uppercase tracking-wider ${panelText}`}>Mix: {s.delayMix.toFixed(2)}</label>
            <input type="range" min="0" max="0.8" step="0.01" value={s.delayMix} onChange={(e) => setS((p) => ({ ...p, delayMix: parseFloat(e.target.value) }))} className="w-full" />

            <label className={`block text-xs font-semibold uppercase tracking-wider ${panelText}`}>Time: {s.delayTime.toFixed(2)}s</label>
            <input type="range" min="0.05" max="0.9" step="0.01" value={s.delayTime} onChange={(e) => setS((p) => ({ ...p, delayTime: parseFloat(e.target.value) }))} className="w-full" />

            <label className={`block text-xs font-semibold uppercase tracking-wider ${panelText}`}>Feedback: {s.delayFeedback.toFixed(2)}</label>
            <input type="range" min="0" max="0.75" step="0.01" value={s.delayFeedback} onChange={(e) => setS((p) => ({ ...p, delayFeedback: parseFloat(e.target.value) }))} className="w-full" />
            <div className={`text-[11px] ${softText}`}>
              Feedback is capped + filtered to prevent self-oscillating hum.
            </div>
          </div>

          <div className={`rounded-lg border p-3 space-y-2 ${dark ? "border-[#2B2B33] bg-[#15151A]" : "border-neutral-200 bg-white"}`}>
            <div className="flex items-center justify-between">
              <div className={`text-xs font-semibold uppercase tracking-wider ${panelText}`}>Drive</div>
              <button
                onClick={() => setS((p) => ({ ...p, driveOn: !p.driveOn }))}
                className={`p-1.5 rounded ${s.driveOn ? "bg-black text-white" : dark ? "bg-[#2B2B33] text-[#EDEDF2]" : "bg-neutral-200"}`}
              >
                {s.driveOn ? <Play size={14} fill="white" /> : <Square size={14} />}
              </button>
            </div>
            <label className={`block text-xs font-semibold uppercase tracking-wider ${panelText}`}>Amount: {s.drive.toFixed(2)}</label>
            <input type="range" min="0" max="1" step="0.01" value={s.drive} onChange={(e) => setS((p) => ({ ...p, drive: parseFloat(e.target.value) }))} className="w-full" />
          </div>
        </div>

        <div className={`text-[11px] ${softText}`}>
          If you hear a constant tone: press <b>PANIC</b>. If MIDI draws but no audio: click <b>Enable Audio</b> once (browser rule).
        </div>
      </div>

      {/* Canvas */}
      <div className={`flex-1 min-h-0 p-2 md:p-8 ${dark ? "bg-[#0B0B0D]" : "bg-white"} relative overflow-hidden`}>
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
