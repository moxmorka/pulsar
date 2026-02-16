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
   Sound engine w/ FX (SYNTH)
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
   Percussion "physical-ish" engine
   - noise exciter -> resonator (bandpass) -> body lowpass
   - pitch quantized (same key/scale)
======================= */
function ensureNoiseBuffer(ac, seconds = 1.0) {
  const len = Math.max(1, Math.floor(seconds * ac.sampleRate));
  const buf = ac.createBuffer(1, len, ac.sampleRate);
  const d = buf.getChannelData(0);
  for (let i = 0; i < len; i++) d[i] = (Math.random() * 2 - 1) * 0.7;
  return buf;
}
function makePercVoice(ac, noiseBuf) {
  const src = ac.createBufferSource();
  src.buffer = noiseBuf;
  src.loop = true;

  const excGain = ac.createGain();
  excGain.gain.value = 0.0001;

  const bp = ac.createBiquadFilter();
  bp.type = "bandpass";
  bp.Q.value = 10;

  const bodyLP = ac.createBiquadFilter();
  bodyLP.type = "lowpass";
  bodyLP.frequency.value = 8000;
  bodyLP.Q.value = 0.6;

  const out = ac.createGain();
  out.gain.value = 0.0001;

  src.connect(excGain);
  excGain.connect(bp);
  bp.connect(bodyLP);
  bodyLP.connect(out);

  src.start();

  return { src, excGain, bp, bodyLP, out };
}
function triggerPerc(ac, v, params) {
  const {
    freq,
    vel,
    click,
    tone,
    decay,
    damp,
    drive,
    // optional: pitchMod for slight punch
  } = params;

  const now = ac.currentTime;
  const vel01 = clamp(vel, 0.0001, 1);

  // resonator tuning
  v.bp.frequency.cancelScheduledValues(now);
  v.bp.frequency.setValueAtTime(clamp(freq, 30, 14000), now);
  v.bp.Q.cancelScheduledValues(now);
  v.bp.Q.setValueAtTime(clamp(3 + damp * 24, 2, 40), now);

  // body tone
  v.bodyLP.frequency.cancelScheduledValues(now);
  v.bodyLP.frequency.setValueAtTime(clamp(600 + tone * 14000, 200, 16000), now);

  // exciter envelope (this is the "hit")
  const g = v.excGain.gain;
  g.cancelScheduledValues(now);
  g.setValueAtTime(0.0001, now);

  const atk = clamp(0.001 + (1 - click) * 0.008, 0.001, 0.02);
  const peak = clamp(0.05 + vel01 * 0.95, 0.05, 1);

  g.exponentialRampToValueAtTime(Math.max(0.00012, peak), now + atk);

  // decay time
  const d = clamp(0.04 + decay * 2.2, 0.03, 3.0);
  g.exponentialRampToValueAtTime(0.0001, now + atk + d);

  // output gain shape (body bloom)
  const og = v.out.gain;
  og.cancelScheduledValues(now);
  og.setValueAtTime(0.0001, now);
  const bodyPeak = clamp(0.06 + vel01 * 0.65, 0.05, 0.9);
  og.exponentialRampToValueAtTime(Math.max(0.00012, bodyPeak), now + 0.006);
  og.exponentialRampToValueAtTime(0.0001, now + 0.006 + d * 1.15);

  // subtle nonlinearity via Q and tone interaction (no extra nodes)
  // "drive" influences exciter peak and Q slightly
  const driveMul = clamp(1 + drive * 1.25, 1, 2.25);
  g.setValueAtTime(Math.max(0.00012, peak / driveMul), now + 0.0001);
}

/* =======================
   Main App
======================= */
export default function App() {
  const canvasRef = React.useRef(null);
  const rafRef = React.useRef(null);

  // LAYERS: synth + percussion
  const [cellsSynth, setCellsSynth] = React.useState([]);
  const [cellsPerc, setCellsPerc] = React.useState([]);

  const cellsSynthRef = React.useRef([]);
  const cellsPercRef = React.useRef([]);

  React.useEffect(() => {
    cellsSynthRef.current = cellsSynth;
  }, [cellsSynth]);
  React.useEffect(() => {
    cellsPercRef.current = cellsPerc;
  }, [cellsPerc]);

  const [panelOpen, setPanelOpen] = React.useState(false);

  // painting
  const [paint, setPaint] = React.useState({
    mode: "color",
    color: "#111111",
    useSeq: true,
    layer: "synth", // synth | perc
  });
  const [drawing, setDrawing] = React.useState(false);

  // settings (visual + sound + midi)
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

    // variable density (Swiss only, unchanged)
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

    // ======= SOUND (always in key) =======
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

    // ======= PERC LAYER =======
    percOn: true,
    percVoices: 10,
    percMaster: 0.72,

    // percussive controls (Taiko-ish range)
    percBaseMidi: 24, // lower = deeper
    percOctaveSpan: 3, // vertical span
    percDecay: 0.55, // 0..1
    percDamp: 0.45, // 0..1 (Q)
    percTone: 0.35, // 0..1 (LPF cutoff)
    percClick: 0.65, // 0..1 (attack)
    percDrive: 0.25, // 0..1 (hit nonlinearity-ish)

    // VIEW / GHOSTING
    view: "both", // both | synth | perc
    ghost: true,
    ghostAlpha: 0.22,

    // ======= MIDI =======
    midiOn: true,
    midiDraw: true, // MIDI paints the grid
    midiThru: true, // MIDI also plays the synth immediately
    midiTarget: "synth", // synth | perc  (where MIDI draws)
    midiChannel: -1, // -1 = omni, else 0..15
    midiLo: 36,
    midiHi: 84,
    midiFadeMin: 0.25, // seconds
    midiFadeMax: 2.5, // seconds
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

  // variable edges (Swiss only)
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

  // upsert / remove for a layer
  const upsertCell = React.useCallback((layer, idx, patch) => {
    const setter = layer === "perc" ? setCellsPerc : setCellsSynth;
    setter((prev) => {
      const ex = prev.findIndex((c) => c.idx === idx);
      const next = [...prev];
      if (ex >= 0) next[ex] = { ...next[ex], ...patch };
      else next.push({ idx, ...patch });
      return next;
    });
  }, []);
  const removeCell = React.useCallback((layer, idx) => {
    const setter = layer === "perc" ? setCellsPerc : setCellsSynth;
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
     AUDIO GRAPH (stable)
======================= */
  const audioRef = React.useRef({
    ac: null,

    // main mix
    master: null,
    synthBus: null,
    percBus: null,

    // synth FX
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

    // perc
    noiseBuf: null,
    percVoices: [],
    percPtr: 0,

    // sched
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

      const synthBus = ac.createGain();
      synthBus.gain.value = 1;

      const percBus = ac.createGain();
      percBus.gain.value = 0.72;

      // --- synth drive + FX
      const drive = ac.createWaveShaper();
      drive.oversample = "2x";

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

      // synth routing: voices -> drive -> (dry + fx) -> synthBus
      drive.connect(dry);
      drive.connect(convolver);
      drive.connect(delay);

      convolver.connect(wetRev);
      delay.connect(wetDel);

      dry.connect(synthBus);
      wetRev.connect(synthBus);
      wetDel.connect(synthBus);

      // buses to master
      synthBus.connect(master);
      percBus.connect(master);

      master.connect(ac.destination);

      // noise for perc
      const noiseBuf = ensureNoiseBuffer(ac, 1.0);

      A.ac = ac;
      A.master = master;
      A.synthBus = synthBus;
      A.percBus = percBus;

      A.drive = drive;
      A.dry = dry;
      A.wetRev = wetRev;
      A.wetDel = wetDel;
      A.convolver = convolver;
      A.delay = delay;
      A.feedback = feedback;

      A.noiseBuf = noiseBuf;
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

  function updateAudioParamsRealtime() {
    const A = audioRef.current;
    if (!A.ac) return;
    const st = sRef.current;

    A.master.gain.setTargetAtTime(clamp(st.master, 0, 1.2), A.ac.currentTime, 0.02);

    // separate buses
    A.synthBus.gain.setTargetAtTime(st.soundOn ? 1 : 0, A.ac.currentTime, 0.02);
    A.percBus.gain.setTargetAtTime(st.percOn ? clamp(st.percMaster, 0, 1.2) : 0, A.ac.currentTime, 0.02);

    // drive curve
    if (st.driveOn) {
      const k = clamp(st.drive ?? 0.6, 0, 1) * 35; // slightly tamer than before (less constant overdrive)
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

    // delay (clamp feedback to avoid runaway hum)
    A.wetDel.gain.setTargetAtTime(st.delayOn ? clamp(st.delayMix, 0, 1) : 0, A.ac.currentTime, 0.02);
    A.delay.delayTime.setTargetAtTime(clamp(st.delayTime, 0.01, 1.5), A.ac.currentTime, 0.02);
    A.feedback.gain.setTargetAtTime(clamp(st.delayFeedback, 0, 0.92), A.ac.currentTime, 0.02);
  }

  function ensureVoices() {
    const A = ensureAudio();
    const ac = A.ac;
    const want = clamp(sRef.current.voices ?? 12, 1, 32);
    if (A.voices.length !== want) {
      // tear down old silently
      A.voices = Array.from({ length: want }, () => {
        const v = makeVoice(ac);
        v.gain.connect(A.drive);
        return v;
      });
      A.voicePtr = 0;
    }
  }

  function ensurePercVoices() {
    const A = ensureAudio();
    const ac = A.ac;
    const want = clamp(sRef.current.percVoices ?? 10, 1, 24);
    if (A.percVoices.length !== want) {
      A.percVoices = Array.from({ length: want }, () => {
        const pv = makePercVoice(ac, A.noiseBuf);
        pv.out.connect(A.percBus);
        return pv;
      });
      A.percPtr = 0;
    }
  }

  React.useEffect(() => {
    if (audioRef.current.ac) {
      ensureVoices();
      ensurePercVoices();
      updateAudioParamsRealtime();
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [s]);

  /* =======================
     Scheduler (stable)
     - synth: columns affect step speed (Swiss varColsOn)
     - synth: rows affect envelope / tails (Swiss varRowsOn)
     - perc: SAME grid logic + pitch from row + deep tuning controls
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
      ensurePercVoices();
      updateAudioParamsRealtime();

      // maps
      const mapSynth = new Map();
      for (const c of cellsSynthRef.current) mapSynth.set(c.idx, c);
      const mapPerc = new Map();
      for (const c of cellsPercRef.current) mapPerc.set(c.idx, c);

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

      // COLUMNS => rhythm (variable step time) (Swiss only, unchanged)
      if (isSwiss && st.varColsOn) {
        const ce = colEdges || Array.from({ length: cols + 1 }, (_, i) => i / cols);
        const curCol = audioRef.current.step % cols;
        const w = ce[curCol + 1] - ce[curCol];
        const avg = 1 / cols;
        const ratio = clamp(w / avg, 0.35, 2.4);
        stepSec = baseStepSec * ratio;
      }

      const col = audioRef.current.step % cols;

      // harmony (shared quantization)
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

      // ROWS => envelope + tails (Swiss varRowsOn influences more)
      const re = isSwiss ? rowEdges || Array.from({ length: rows + 1 }, (_, i) => i / rows) : null;
      const avgRowH = isSwiss ? 1 / rows : 1;

      // ===== SYNTH HITS =====
      if (st.soundOn) {
        const hits = [];
        for (let r = 0; r < rows; r++) {
          const idx = r * cols + col;
          const cell = mapSynth.get(idx);
          const paintObj = cell?.paint;
          if (!paintObj?.color) continue;

          // expired MIDI painted cells skip
          if (typeof cell.expiresAt === "number") {
            const nowS = performance.now() * 0.001;
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

          // row -> scale degree index (top high, bottom low)
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

          const score = vel;
          hits.push({ freq, vel, cutoff, attack, decay, release, score });
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

      // ===== PERC HITS (same grid scanning, quantized pitch from row) =====
      if (st.percOn) {
        const hits = [];
        const degreesCountP = 7 * clamp(st.percOctaveSpan ?? 3, 1, 7);
        const scalePerc = buildScaleMidi({
          rootPc: clamp(st.keyRoot ?? 0, 0, 11),
          scaleName: st.scaleName,
          baseMidi: clamp(st.percBaseMidi ?? 24, 0, 84),
          degreesCount: degreesCountP,
        });

        for (let r = 0; r < rows; r++) {
          const idx = r * cols + col;
          const cell = mapPerc.get(idx);
          const paintObj = cell?.paint;
          if (!paintObj?.color) continue;

          if (typeof cell.expiresAt === "number") {
            const nowS = performance.now() * 0.001;
            if (cell.expiresAt <= nowS) continue;
          }

          const rgb = hexToRgb(paintObj.color);
          if (!rgb) continue;

          const lum = luminance01(rgb);

          // top = higher, bottom = lower (your requirement)
          const rowNorm = rows <= 1 ? 0.5 : 1 - r / (rows - 1);
          const degIdx = clamp(Math.round(rowNorm * (degreesCountP - 1)), 0, degreesCountP - 1);
          const m = scalePerc[degIdx];
          const freq = midiToFreq(m);

          // velocity derives from color luminance (like synth)
          const vel = clamp(0.08 + 0.92 * lum, 0.05, 1);

          // if Swiss variable rows enabled, make tails noticeably react (deep rows / bigger rows)
          let decayMul = 1.0;
          if (isSwiss && st.varRowsOn && re) {
            const rh = re[r + 1] - re[r];
            const ratio = clamp(rh / avgRowH, 0.35, 2.4);
            decayMul = clamp(ratio, 0.55, 1.9);
          }

          hits.push({
            freq,
            vel,
            decayMul,
            score: vel,
          });
        }

        hits.sort((a, b) => b.score - a.score);
        const chosen = hits.slice(0, Math.min(12, hits.length)); // keep perc tight

        const pool = audioRef.current.percVoices;
        for (const h of chosen) {
          const v = pool[audioRef.current.percPtr % pool.length];
          audioRef.current.percPtr++;

          triggerPerc(ac, v, {
            freq: h.freq,
            vel: h.vel,
            click: clamp(st.percClick ?? 0.65, 0, 1),
            tone: clamp(st.percTone ?? 0.35, 0, 1),
            decay: clamp((st.percDecay ?? 0.55) * h.decayMul, 0, 1.2),
            damp: clamp(st.percDamp ?? 0.45, 0, 1),
            drive: clamp(st.percDrive ?? 0.25, 0, 1),
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
     - MIDI paints whichever layer you choose (s.midiTarget)
     - optional MIDI-thru plays SYNTH only (unchanged)
======================= */
  const [midiSupported, setMidiSupported] = React.useState(false);
  const [midiInputs, setMidiInputs] = React.useState([]);
  const [midiInputId, setMidiInputId] = React.useState("");
  const midiAccessRef = React.useRef(null);
  const midiActiveRef = React.useRef(new Map()); // key: note+ch => { t0, vel01, note, ch, idx, layer }

  const midiToColor = React.useCallback((note, vel01, durSec) => {
    const h = clamp(note / 127, 0, 1);
    const s2 = clamp(0.25 + vel01 * 0.7, 0, 1);
    const l = clamp(0.18 + vel01 * 0.55 + clamp(durSec / 2.5, 0, 1) * 0.12, 0, 1);
    return rgbToHex(hslToRgb(h, s2, l));
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

      // higher pitch goes toward top
      const t = clamp((note - lo) / span, 0, 1);
      const row = clamp(Math.round((1 - t) * (rows - 1)), 0, rows - 1);

      // column follows scheduler
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

      const layer = st.midiTarget === "perc" ? "perc" : "synth";

      const color = midiToColor(note, vel01, 0);
      const expiresAt = nowS + clamp(st.midiFadeMin ?? 0.25, 0.05, 6);

      upsertCell(layer, idx, {
        paint: { mode: "color", color },
        midi: { note, vel: vel01, ch, t0: nowS, dur: 0 },
        expiresAt,
      });

      midiActiveRef.current.set(`${note}:${ch}`, { t0: nowS, vel01, note, ch, idx, row, col, layer });
    },
    [midiNoteToCell, midiToColor, upsertCell]
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

    inp.onmidimessage = async (e) => {
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

    const layer = paint.layer === "perc" ? "perc" : "synth";

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

    const layer = paint.layer === "perc" ? "perc" : "synth";

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

  // refresh (keeps UI)
  const gen = () => {
    setCellsSynth((p) => [...p]);
    setCellsPerc((p) => [...p]);
  };

  const clearSynth = () => setCellsSynth([]);
  const clearPerc = () => setCellsPerc([]);
  const clearAll = () => {
    setCellsSynth([]);
    setCellsPerc([]);
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

    const dark = s.theme === "dark";

    const bg = dark ? "#0B0B0D" : "#FAFAFA";
    const gridStroke = dark ? "#1F1F24" : "#E6E6E6";
    const gridStrokeChar = dark ? "#23232A" : "#EAEAEA";
    const textOnEmpty = dark ? "#EDEDED" : "#111111";
    const textOnFill = dark ? "#0A0A0A" : "#0A0A0A"; // keep punchy
    const panelBg = dark ? "bg-neutral-900 border-neutral-800" : "bg-neutral-50 border-neutral-200";
    // (panel class applied in JSX below)

    ctx.clearRect(0, 0, w, h);
    ctx.fillStyle = bg;
    ctx.fillRect(0, 0, w, h);

    const t = tm * 0.001;
    const nowS = performance.now() * 0.001;

    const mapSynth = new Map();
    for (const c of cellsSynth) mapSynth.set(c.idx, c);
    const mapPerc = new Map();
    for (const c of cellsPerc) mapPerc.set(c.idx, c);

    ctx.textAlign = "center";
    ctx.textBaseline = "middle";

    const drawLayerCell = (colHex, rect, alpha) => {
      if (!colHex) return;
      ctx.save();
      ctx.fillStyle = colHex;
      ctx.globalAlpha = clamp(alpha, 0, 1);
      ctx.fillRect(rect.x, rect.y, rect.w, rect.h); // NO extra frame/border
      ctx.restore();
    };

    const layerVisible = (layer) => s.view === "both" || s.view === layer;
    const ghostVisible = (layer) => s.ghost && s.view !== "both" && s.view !== layer;

    const layerAlpha = (layer) => {
      if (layerVisible(layer)) return 0.92;
      if (ghostVisible(layer)) return clamp(s.ghostAlpha ?? 0.22, 0, 0.8);
      return 0;
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

      const chs = (s.chars || "01").split("");
      const spd = (s.charSpd ?? 2) * 0.9;

      for (let r = 0; r < rows; r++) {
        for (let c = 0; c < cols; c++) {
          const idx = r * cols + c;
          const x0 = c * s.space;
          const y0 = r * s.space;
          const cx = x0 + s.space / 2;
          const cy = y0 + s.space / 2;

          // layer colors + expiry fade
          const eS = mapSynth.get(idx);
          const eP = mapPerc.get(idx);

          const rect = { x: x0, y: y0, w: s.space, h: s.space };

          const alphaFromEntry = (entry, baseA) => {
            if (!entry?.paint?.color) return 0;
            if (entry?.expiresAt != null) {
              const rem = entry.expiresAt - nowS;
              if (rem <= 0) return 0;
              return baseA * clamp(rem / 0.35, 0, 1);
            }
            return baseA;
          };

          const aS = alphaFromEntry(eS, layerAlpha("synth"));
          const aP = alphaFromEntry(eP, layerAlpha("perc"));

          // draw synth then perc on top
          if (aS > 0) drawLayerCell(eS?.paint?.color, rect, aS);
          if (aP > 0) drawLayerCell(eP?.paint?.color, rect, aP);

          const hasFill = aS > 0 || aP > 0;

          const gi = chs.length ? Math.floor((t * spd + r * 0.07 + c * 0.05) * 3) % chs.length : 0;
          ctx.save();
          ctx.font = `${s.charSz}px ${getFontFamily()}`;
          ctx.fillStyle = hasFill ? textOnFill : textOnEmpty;
          ctx.globalAlpha = hasFill ? 1 : 0.95;
          ctx.fillText(chs[gi] ?? "0", cx, cy);
          ctx.restore();
        }
      }
      return;
    }

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

      const chs = (s.chars || "01").split("");
      const spd = (s.charSpd ?? 2) * 0.85;

      const alphaFromEntry = (entry, baseA) => {
        if (!entry?.paint?.color) return 0;
        if (entry?.expiresAt != null) {
          const rem = entry.expiresAt - nowS;
          if (rem <= 0) return 0;
          return baseA * clamp(rem / 0.35, 0, 1);
        }
        return baseA;
      };

      for (let r = 0; r < rows; r++) {
        for (let c = 0; c < cols; c++) {
          const idx = r * cols + c;
          const g = swissCellGeom(r, c, w, h);

          const eS = mapSynth.get(idx);
          const eP = mapPerc.get(idx);

          const aS = alphaFromEntry(eS, layerAlpha("synth"));
          const aP = alphaFromEntry(eP, layerAlpha("perc"));

          if (aS > 0) drawLayerCell(eS?.paint?.color, { x: g.x, y: g.y, w: g.w, h: g.h }, aS);
          if (aP > 0) drawLayerCell(eP?.paint?.color, { x: g.x, y: g.y, w: g.w, h: g.h }, aP);

          const hasFill = aS > 0 || aP > 0;

          const gi = chs.length ? Math.floor((t * spd + r * 0.09 + c * 0.05) * 3) % chs.length : 0;
          const sz = Math.max(8, Math.min(g.w, g.h) * 0.55 * (s.swissCharScale ?? 1));

          ctx.save();
          ctx.font = `${Math.floor(sz)}px ${getFontFamily()}`;
          ctx.fillStyle = hasFill ? textOnFill : textOnEmpty;
          ctx.globalAlpha = hasFill ? 1 : 0.95;
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
  }, [s, cellsSynth, cellsPerc, colEdges, rowEdges]);

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

  const panelClass =
    "fixed md:static z-40 md:z-auto inset-y-0 left-0 w-80 max-w-[90vw] border-r p-4 md:p-5 overflow-y-auto space-y-4 text-sm transform transition-transform duration-200 md:transform-none " +
    (dark ? "bg-neutral-900 border-neutral-800 text-neutral-100" : "bg-neutral-50 border-neutral-200 text-neutral-900") +
    " " +
    (panelOpen ? "translate-x-0" : "-translate-x-full md:translate-x-0");

  const selectClass =
    "w-full px-3 py-2 rounded-lg border " +
    (dark ? "bg-neutral-950 border-neutral-700 text-neutral-100" : "bg-white border-neutral-300 text-neutral-900");

  const subSelectClass =
    "w-full px-2 py-2 rounded-lg border text-xs " +
    (dark ? "bg-neutral-950 border-neutral-700 text-neutral-100" : "bg-white border-neutral-300 text-neutral-900");

  const btnPrimary =
    "w-full px-4 py-2.5 rounded-lg font-medium min-h-[44px] " +
    (dark ? "bg-neutral-100 text-neutral-900 hover:bg-white" : "bg-neutral-900 text-white hover:bg-black");

  const btnBlack =
    "flex-1 flex justify-center px-4 py-2.5 rounded-lg font-medium hover:opacity-90 min-h-[44px] " +
    (dark ? "bg-neutral-100 text-neutral-900" : "bg-black text-white");

  const btnGhost =
    "px-3 py-2 rounded-lg border text-xs font-semibold min-h-[44px] " +
    (dark ? "border-neutral-700 bg-neutral-950" : "border-neutral-300 bg-white");

  return (
    <div className={"w-full h-[100svh] flex flex-col md:flex-row overflow-hidden " + (dark ? "bg-black" : "bg-white")}>
      {panelOpen && <div className="fixed inset-0 bg-black/30 z-30 md:hidden" onClick={() => setPanelOpen(false)} />}

      {/* Controls */}
      <div className={panelClass}>
        <div className="flex gap-2">
          <button onClick={gen} className={btnBlack} title="Refresh">
            <RotateCcw size={16} />
          </button>
          <button
            onClick={() => {
              const l = document.createElement("a");
              l.download = "pattern.png";
              l.href = canvasRef.current.toDataURL();
              l.click();
            }}
            className={btnBlack}
            title="Download PNG"
          >
            <Download size={16} />
          </button>
        </div>

        <div className="flex gap-2">
          <button onClick={unlockAudio} className={btnPrimary}>
            Enable Audio (click once)
          </button>
          <button
            onClick={() => setS((p) => ({ ...p, theme: p.theme === "dark" ? "light" : "dark" }))}
            className={
              "px-3 py-2.5 rounded-lg min-h-[44px] flex items-center justify-center " +
              (dark ? "bg-neutral-950 border border-neutral-700" : "bg-white border border-neutral-300")
            }
            title="Toggle theme"
          >
            {dark ? <Sun size={16} /> : <Moon size={16} />}
          </button>
        </div>

        <div className="space-y-2">
          <label className="block text-xs font-semibold uppercase tracking-wider">Pattern</label>
          <select value={s.pat} onChange={(e) => setS((p) => ({ ...p, pat: e.target.value }))} className={selectClass}>
            <option value="swiss-grid">Swiss Grid</option>
            <option value="char-grid">Character Grid</option>
          </select>
        </div>

        {/* Layer + ghost */}
        <div className="space-y-2">
          <label className="block text-xs font-semibold uppercase tracking-wider">Layers</label>

          <div className="grid grid-cols-2 gap-2">
            <button
              onClick={() => setPaint((p) => ({ ...p, layer: "synth" }))}
              className={
                btnGhost +
                " " +
                (paint.layer === "synth"
                  ? dark
                    ? "bg-neutral-100 text-neutral-900 border-neutral-100"
                    : "bg-black text-white border-black"
                  : dark
                  ? "text-neutral-100"
                  : "text-neutral-900")
              }
            >
              Paint: Synth
            </button>
            <button
              onClick={() => setPaint((p) => ({ ...p, layer: "perc" }))}
              className={
                btnGhost +
                " " +
                (paint.layer === "perc"
                  ? dark
                    ? "bg-neutral-100 text-neutral-900 border-neutral-100"
                    : "bg-black text-white border-black"
                  : dark
                  ? "text-neutral-100"
                  : "text-neutral-900")
              }
            >
              Paint: Perc
            </button>
          </div>

          <div className="grid grid-cols-3 gap-2">
            <button
              onClick={() => setS((p) => ({ ...p, view: "both" }))}
              className={
                btnGhost +
                " " +
                (s.view === "both"
                  ? dark
                    ? "bg-neutral-100 text-neutral-900 border-neutral-100"
                    : "bg-black text-white border-black"
                  : "")
              }
            >
              View Both
            </button>
            <button
              onClick={() => setS((p) => ({ ...p, view: "synth" }))}
              className={
                btnGhost +
                " " +
                (s.view === "synth"
                  ? dark
                    ? "bg-neutral-100 text-neutral-900 border-neutral-100"
                    : "bg-black text-white border-black"
                  : "")
              }
            >
              View Synth
            </button>
            <button
              onClick={() => setS((p) => ({ ...p, view: "perc" }))}
              className={
                btnGhost +
                " " +
                (s.view === "perc"
                  ? dark
                    ? "bg-neutral-100 text-neutral-900 border-neutral-100"
                    : "bg-black text-white border-black"
                  : "")
              }
            >
              View Perc
            </button>
          </div>

          <div className="flex items-center justify-between">
            <div className="text-xs font-semibold uppercase tracking-wider">Ghost layer</div>
            <button
              onClick={() => setS((p) => ({ ...p, ghost: !p.ghost }))}
              className={`p-1.5 rounded ${s.ghost ? (dark ? "bg-neutral-100 text-neutral-900" : "bg-black text-white") : dark ? "bg-neutral-800" : "bg-neutral-200"}`}
              title="Ghost on/off"
            >
              {s.ghost ? <Play size={14} fill={dark ? "black" : "white"} /> : <Square size={14} />}
            </button>
          </div>

          {s.ghost && (
            <div className="space-y-1">
              <div className={dark ? "text-xs text-neutral-300" : "text-xs text-neutral-600"}>
                Ghost alpha: {s.ghostAlpha.toFixed(2)}
              </div>
              <input
                type="range"
                min="0"
                max="0.6"
                step="0.01"
                value={s.ghostAlpha}
                onChange={(e) => setS((p) => ({ ...p, ghostAlpha: parseFloat(e.target.value) }))}
                className="w-full"
              />
            </div>
          )}

          <div className="grid grid-cols-3 gap-2">
            <button onClick={clearSynth} className={btnGhost}>
              Clear Synth
            </button>
            <button onClick={clearPerc} className={btnGhost}>
              Clear Perc
            </button>
            <button
              onClick={clearAll}
              className={
                btnGhost +
                " " +
                (dark ? "bg-neutral-100 text-neutral-900 border-neutral-100" : "bg-neutral-900 text-white border-neutral-900")
              }
            >
              Clear All
            </button>
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
              className={"h-10 w-14 rounded-md border " + (dark ? "border-neutral-700 bg-neutral-950" : "border-neutral-300 bg-white")}
              title="Pick color"
            />

            <button
              onClick={() => setPaint((p) => ({ ...p, useSeq: !p.useSeq, mode: "color" }))}
              className={`flex-1 px-3 py-2 rounded-lg border text-xs font-semibold flex items-center justify-center gap-2 min-h-[44px] ${
                paint.useSeq
                  ? dark
                    ? "bg-neutral-100 text-neutral-900 border-neutral-100"
                    : "bg-black text-white border-black"
                  : dark
                  ? "bg-neutral-950 border-neutral-700"
                  : "bg-white border-neutral-300"
              }`}
            >
              <Palette size={14} />
              {paint.useSeq ? "Color String ON" : "Color String OFF"}
            </button>

            <button
              onClick={() => setPaint((p) => ({ ...p, mode: p.mode === "none" ? "color" : "none" }))}
              className={`px-3 py-2 rounded-lg text-xs font-semibold min-h-[44px] ${
                paint.mode === "none"
                  ? dark
                    ? "bg-neutral-100 text-neutral-900"
                    : "bg-black text-white"
                  : dark
                  ? "bg-neutral-800 text-neutral-100"
                  : "bg-neutral-200 text-neutral-700"
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
                className={"h-9 w-full rounded-md border " + (dark ? "border-neutral-700 bg-neutral-950" : "border-neutral-300 bg-white")}
                title={`Color String ${i + 1}`}
              />
            ))}
          </div>

          <div className="grid grid-cols-2 gap-2">
            <div className="space-y-1">
              <div className={dark ? "text-xs text-neutral-300" : "text-xs text-neutral-600"}>Color motion</div>
              <select
                value={s.colorSeqBehave}
                onChange={(e) => setS((p) => ({ ...p, colorSeqBehave: e.target.value }))}
                className={subSelectClass}
              >
                <option value="same">Same (musical)</option>
                <option value="cycle">Cycle</option>
                <option value="wave">Wave</option>
                <option value="random">Random</option>
              </select>
            </div>
            <div className="space-y-1">
              <div className={dark ? "text-xs text-neutral-300" : "text-xs text-neutral-600"}>Speed</div>
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
                className={`p-1.5 rounded ${s.gridLines ? (dark ? "bg-neutral-100 text-neutral-900" : "bg-black text-white") : dark ? "bg-neutral-800" : "bg-neutral-200"}`}
              >
                {s.gridLines ? <Play size={14} fill={dark ? "black" : "white"} /> : <Square size={14} />}
              </button>
            </div>

            <label className="block text-xs font-semibold uppercase tracking-wider">Variable Grid Density</label>

            <div className={"rounded-lg border p-3 space-y-2 " + (dark ? "border-neutral-800 bg-neutral-950" : "border-neutral-200 bg-white")}>
              <div className="flex items-center justify-between">
                <div className="text-xs font-semibold uppercase tracking-wider">Columns (rhythm)</div>
                <button
                  onClick={() => setS((p) => ({ ...p, varColsOn: !p.varColsOn }))}
                  className={`p-1.5 rounded ${s.varColsOn ? (dark ? "bg-neutral-100 text-neutral-900" : "bg-black text-white") : dark ? "bg-neutral-800" : "bg-neutral-200"}`}
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
                  <div className={dark ? "text-[11px] text-neutral-300" : "text-[11px] text-neutral-600"}>
                    Columns affect <b>step speed</b> (narrow = faster, wide = slower).
                  </div>
                </>
              )}
            </div>

            <div className={"rounded-lg border p-3 space-y-2 " + (dark ? "border-neutral-800 bg-neutral-950" : "border-neutral-200 bg-white")}>
              <div className="flex items-center justify-between">
                <div className="text-xs font-semibold uppercase tracking-wider">Rows (tails)</div>
                <button
                  onClick={() => setS((p) => ({ ...p, varRowsOn: !p.varRowsOn }))}
                  className={`p-1.5 rounded ${s.varRowsOn ? (dark ? "bg-neutral-100 text-neutral-900" : "bg-black text-white") : dark ? "bg-neutral-800" : "bg-neutral-200"}`}
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
                  <div className={dark ? "text-[11px] text-neutral-300" : "text-[11px] text-neutral-600"}>
                    Rows affect <b>envelope</b> and <b>tails</b> (and row-height changes it more).
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
              className={
                "w-full px-3 py-2 rounded-lg font-mono border " +
                (dark ? "bg-neutral-950 border-neutral-700 text-neutral-100" : "bg-white border-neutral-300 text-neutral-900")
              }
            />
            <div className="flex items-center justify-between">
              <label className="text-xs font-semibold uppercase tracking-wider">Grid Lines</label>
              <button
                onClick={() => setS((p) => ({ ...p, gridLines: !p.gridLines }))}
                className={`p-1.5 rounded ${s.gridLines ? (dark ? "bg-neutral-100 text-neutral-900" : "bg-black text-white") : dark ? "bg-neutral-800" : "bg-neutral-200"}`}
              >
                {s.gridLines ? <Play size={14} fill={dark ? "black" : "white"} /> : <Square size={14} />}
              </button>
            </div>
          </div>
        )}

        {/* Sound (Synth) */}
        <div className="space-y-2">
          <div className="flex items-center justify-between">
            <label className="text-xs font-semibold uppercase tracking-wider">Synth</label>
            <button
              onClick={() => setS((p) => ({ ...p, soundOn: !p.soundOn }))}
              className={`p-1.5 rounded ${s.soundOn ? (dark ? "bg-neutral-100 text-neutral-900" : "bg-black text-white") : dark ? "bg-neutral-800" : "bg-neutral-200"}`}
              title="Synth on/off"
            >
              {s.soundOn ? <Play size={14} fill={dark ? "black" : "white"} /> : <Square size={14} />}
            </button>
          </div>

          <label className="block text-xs font-semibold uppercase tracking-wider">BPM: {s.bpm}</label>
          <input type="range" min="40" max="220" value={s.bpm} onChange={(e) => setS((p) => ({ ...p, bpm: parseInt(e.target.value, 10) }))} className="w-full" />

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
              <div className={dark ? "text-xs text-neutral-300" : "text-xs text-neutral-600"}>Key</div>
              <select value={s.keyRoot} onChange={(e) => setS((p) => ({ ...p, keyRoot: parseInt(e.target.value, 10) }))} className={subSelectClass}>
                {NOTE_NAMES.map((n, i) => (
                  <option key={n} value={i}>
                    {n}
                  </option>
                ))}
              </select>
            </div>
            <div className="space-y-1">
              <div className={dark ? "text-xs text-neutral-300" : "text-xs text-neutral-600"}>Scale</div>
              <select value={s.scaleName} onChange={(e) => setS((p) => ({ ...p, scaleName: e.target.value }))} className={subSelectClass}>
                {Object.keys(SCALES).map((name) => (
                  <option key={name} value={name}>
                    {name}
                  </option>
                ))}
              </select>
            </div>
          </div>

          <div className={dark ? "text-[11px] text-neutral-300" : "text-[11px] text-neutral-600"}>
            <b>Always in tune:</b> pitches are quantized to {keyName} {s.scaleName}.<br />
            <b>Layers:</b> synth + percussion use the <b>same key/scale</b>.
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
              className={`p-1.5 rounded ${s.percOn ? (dark ? "bg-neutral-100 text-neutral-900" : "bg-black text-white") : dark ? "bg-neutral-800" : "bg-neutral-200"}`}
              title="Perc on/off"
            >
              {s.percOn ? <Play size={14} fill={dark ? "black" : "white"} /> : <Square size={14} />}
            </button>
          </div>

          <label className="block text-xs font-semibold uppercase tracking-wider">Perc volume: {s.percMaster.toFixed(2)}</label>
          <input type="range" min="0" max="1.2" step="0.01" value={s.percMaster} onChange={(e) => setS((p) => ({ ...p, percMaster: parseFloat(e.target.value) }))} className="w-full" />

          <div className="grid grid-cols-2 gap-2">
            <div className="space-y-1">
              <div className={dark ? "text-xs text-neutral-300" : "text-xs text-neutral-600"}>Deep tune (base)</div>
              <input
                type="range"
                min="0"
                max="60"
                value={s.percBaseMidi}
                onChange={(e) => setS((p) => ({ ...p, percBaseMidi: parseInt(e.target.value, 10) }))}
                className="w-full"
              />
              <div className={dark ? "text-[11px] text-neutral-400" : "text-[11px] text-neutral-500"}>
                baseMidi: {s.percBaseMidi} (lower = deeper)
              </div>
            </div>
            <div className="space-y-1">
              <div className={dark ? "text-xs text-neutral-300" : "text-xs text-neutral-600"}>Pitch span</div>
              <input
                type="range"
                min="1"
                max="6"
                value={s.percOctaveSpan}
                onChange={(e) => setS((p) => ({ ...p, percOctaveSpan: parseInt(e.target.value, 10) }))}
                className="w-full"
              />
              <div className={dark ? "text-[11px] text-neutral-400" : "text-[11px] text-neutral-500"}>octaves: {s.percOctaveSpan}</div>
            </div>
          </div>

          <div className="space-y-1">
            <div className={dark ? "text-xs text-neutral-300" : "text-xs text-neutral-600"}>Decay: {s.percDecay.toFixed(2)}</div>
            <input type="range" min="0" max="1" step="0.01" value={s.percDecay} onChange={(e) => setS((p) => ({ ...p, percDecay: parseFloat(e.target.value) }))} className="w-full" />
          </div>

          <div className="space-y-1">
            <div className={dark ? "text-xs text-neutral-300" : "text-xs text-neutral-600"}>Damp (resonance): {s.percDamp.toFixed(2)}</div>
            <input type="range" min="0" max="1" step="0.01" value={s.percDamp} onChange={(e) => setS((p) => ({ ...p, percDamp: parseFloat(e.target.value) }))} className="w-full" />
          </div>

          <div className="space-y-1">
            <div className={dark ? "text-xs text-neutral-300" : "text-xs text-neutral-600"}>Tone: {s.percTone.toFixed(2)}</div>
            <input type="range" min="0" max="1" step="0.01" value={s.percTone} onChange={(e) => setS((p) => ({ ...p, percTone: parseFloat(e.target.value) }))} className="w-full" />
          </div>

          <div className="space-y-1">
            <div className={dark ? "text-xs text-neutral-300" : "text-xs text-neutral-600"}>Click (attack): {s.percClick.toFixed(2)}</div>
            <input type="range" min="0" max="1" step="0.01" value={s.percClick} onChange={(e) => setS((p) => ({ ...p, percClick: parseFloat(e.target.value) }))} className="w-full" />
          </div>

          <div className="space-y-1">
            <div className={dark ? "text-xs text-neutral-300" : "text-xs text-neutral-600"}>Drive: {s.percDrive.toFixed(2)}</div>
            <input type="range" min="0" max="1" step="0.01" value={s.percDrive} onChange={(e) => setS((p) => ({ ...p, percDrive: parseFloat(e.target.value) }))} className="w-full" />
          </div>

          <div className={dark ? "text-[11px] text-neutral-300" : "text-[11px] text-neutral-600"}>
            <b>Pitch rule:</b> top rows = higher drums, bottom rows = deeper drums. Still quantized to {keyName} {s.scaleName}.
          </div>
        </div>

        {/* MIDI */}
        <div className="space-y-2">
          <div className="flex items-center justify-between">
            <label className="text-xs font-semibold uppercase tracking-wider">MIDI</label>
            <button
              onClick={() => setS((p) => ({ ...p, midiOn: !p.midiOn }))}
              className={`p-1.5 rounded ${s.midiOn ? (dark ? "bg-neutral-100 text-neutral-900" : "bg-black text-white") : dark ? "bg-neutral-800" : "bg-neutral-200"}`}
              title="MIDI on/off"
              disabled={!midiSupported}
            >
              {s.midiOn ? <Play size={14} fill={dark ? "black" : "white"} /> : <Square size={14} />}
            </button>
          </div>

          {!midiSupported ? (
            <div className={dark ? "text-[11px] text-neutral-300" : "text-[11px] text-neutral-600"}>This browser/device doesn’t support Web MIDI.</div>
          ) : (
            <>
              <div className="space-y-1">
                <div className={dark ? "text-xs text-neutral-300" : "text-xs text-neutral-600"}>Input</div>
                <select value={midiInputId} onChange={(e) => setMidiInputId(e.target.value)} className={subSelectClass}>
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
                    s.midiDraw
                      ? dark
                        ? "bg-neutral-100 text-neutral-900 border-neutral-100"
                        : "bg-black text-white border-black"
                      : dark
                      ? "bg-neutral-950 border-neutral-700"
                      : "bg-white border-neutral-300"
                  }`}
                >
                  MIDI draws
                </button>
                <button
                  onClick={() => setS((p) => ({ ...p, midiThru: !p.midiThru }))}
                  className={`px-3 py-2 rounded-lg border text-xs font-semibold min-h-[44px] ${
                    s.midiThru
                      ? dark
                        ? "bg-neutral-100 text-neutral-900 border-neutral-100"
                        : "bg-black text-white border-black"
                      : dark
                      ? "bg-neutral-950 border-neutral-700"
                      : "bg-white border-neutral-300"
                  }`}
                >
                  MIDI thru (synth)
                </button>
              </div>

              <div className="space-y-1">
                <div className={dark ? "text-xs text-neutral-300" : "text-xs text-neutral-600"}>MIDI draws to</div>
                <select
                  value={s.midiTarget}
                  onChange={(e) => setS((p) => ({ ...p, midiTarget: e.target.value }))}
                  className={subSelectClass}
                >
                  <option value="synth">Synth layer</option>
                  <option value="perc">Perc layer</option>
                </select>
              </div>

              <div className="space-y-1">
                <div className={dark ? "text-xs text-neutral-300" : "text-xs text-neutral-600"}>Channel</div>
                <select
                  value={s.midiChannel}
                  onChange={(e) => setS((p) => ({ ...p, midiChannel: parseInt(e.target.value, 10) }))}
                  className={subSelectClass}
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
                  <div className={dark ? "text-xs text-neutral-300" : "text-xs text-neutral-600"}>Note low</div>
                  <input
                    type="number"
                    min="0"
                    max="127"
                    value={s.midiLo}
                    onChange={(e) => setS((p) => ({ ...p, midiLo: parseInt(e.target.value || "0", 10) }))}
                    className={subSelectClass}
                  />
                </div>
                <div className="space-y-1">
                  <div className={dark ? "text-xs text-neutral-300" : "text-xs text-neutral-600"}>Note high</div>
                  <input
                    type="number"
                    min="0"
                    max="127"
                    value={s.midiHi}
                    onChange={(e) => setS((p) => ({ ...p, midiHi: parseInt(e.target.value || "127", 10) }))}
                    className={subSelectClass}
                  />
                </div>
              </div>

              <div className={dark ? "text-[11px] text-neutral-300" : "text-[11px] text-neutral-600"}>
                MIDI paints cells: <b>velocity → intensity</b>, <b>duration → persistence</b>. (Column locks to the running rhythm.)
              </div>
            </>
          )}
        </div>

        {/* FX */}
        <div className="space-y-2">
          <label className="block text-xs font-semibold uppercase tracking-wider">FX (Synth)</label>

          <div className={"rounded-lg border p-3 space-y-2 " + (dark ? "border-neutral-800 bg-neutral-950" : "border-neutral-200 bg-white")}>
            <div className="flex items-center justify-between">
              <div className="text-xs font-semibold uppercase tracking-wider">Reverb</div>
              <button
                onClick={() => setS((p) => ({ ...p, reverbOn: !p.reverbOn }))}
                className={`p-1.5 rounded ${s.reverbOn ? (dark ? "bg-neutral-100 text-neutral-900" : "bg-black text-white") : dark ? "bg-neutral-800" : "bg-neutral-200"}`}
              >
                {s.reverbOn ? <Play size={14} fill={dark ? "black" : "white"} /> : <Square size={14} />}
              </button>
            </div>
            <label className="block text-xs font-semibold uppercase tracking-wider">Mix: {s.reverbMix.toFixed(2)}</label>
            <input type="range" min="0" max="0.8" step="0.01" value={s.reverbMix} onChange={(e) => setS((p) => ({ ...p, reverbMix: parseFloat(e.target.value) }))} className="w-full" />
            <label className="block text-xs font-semibold uppercase tracking-wider">Time: {s.reverbTime.toFixed(1)}s</label>
            <input type="range" min="0.5" max="6" step="0.1" value={s.reverbTime} onChange={(e) => setS((p) => ({ ...p, reverbTime: parseFloat(e.target.value) }))} className="w-full" />
          </div>

          <div className={"rounded-lg border p-3 space-y-2 " + (dark ? "border-neutral-800 bg-neutral-950" : "border-neutral-200 bg-white")}>
            <div className="flex items-center justify-between">
              <div className="text-xs font-semibold uppercase tracking-wider">Delay</div>
              <button
                onClick={() => setS((p) => ({ ...p, delayOn: !p.delayOn }))}
                className={`p-1.5 rounded ${s.delayOn ? (dark ? "bg-neutral-100 text-neutral-900" : "bg-black text-white") : dark ? "bg-neutral-800" : "bg-neutral-200"}`}
              >
                {s.delayOn ? <Play size={14} fill={dark ? "black" : "white"} /> : <Square size={14} />}
              </button>
            </div>

            <label className="block text-xs font-semibold uppercase tracking-wider">Mix: {s.delayMix.toFixed(2)}</label>
            <input type="range" min="0" max="0.8" step="0.01" value={s.delayMix} onChange={(e) => setS((p) => ({ ...p, delayMix: parseFloat(e.target.value) }))} className="w-full" />

            <label className="block text-xs font-semibold uppercase tracking-wider">Time: {s.delayTime.toFixed(2)}s</label>
            <input type="range" min="0.05" max="0.9" step="0.01" value={s.delayTime} onChange={(e) => setS((p) => ({ ...p, delayTime: parseFloat(e.target.value) }))} className="w-full" />

            <label className="block text-xs font-semibold uppercase tracking-wider">Feedback: {s.delayFeedback.toFixed(2)}</label>
            <input type="range" min="0" max="0.85" step="0.01" value={s.delayFeedback} onChange={(e) => setS((p) => ({ ...p, delayFeedback: parseFloat(e.target.value) }))} className="w-full" />
          </div>

          <div className={"rounded-lg border p-3 space-y-2 " + (dark ? "border-neutral-800 bg-neutral-950" : "border-neutral-200 bg-white")}>
            <div className="flex items-center justify-between">
              <div className="text-xs font-semibold uppercase tracking-wider">Drive</div>
              <button
                onClick={() => setS((p) => ({ ...p, driveOn: !p.driveOn }))}
                className={`p-1.5 rounded ${s.driveOn ? (dark ? "bg-neutral-100 text-neutral-900" : "bg-black text-white") : dark ? "bg-neutral-800" : "bg-neutral-200"}`}
              >
                {s.driveOn ? <Play size={14} fill={dark ? "black" : "white"} /> : <Square size={14} />}
              </button>
            </div>
            <label className="block text-xs font-semibold uppercase tracking-wider">Amount: {s.drive.toFixed(2)}</label>
            <input type="range" min="0" max="1" step="0.01" value={s.drive} onChange={(e) => setS((p) => ({ ...p, drive: parseFloat(e.target.value) }))} className="w-full" />
          </div>
        </div>

        <div className={dark ? "text-[11px] text-neutral-400" : "text-[11px] text-neutral-500"}>
          If you hear nothing after it “goes silent”: click the canvas once or press <b>Enable Audio</b> (browser rule).
        </div>
      </div>

      {/* Canvas */}
      <div className={"flex-1 min-h-0 p-2 md:p-8 relative overflow-hidden " + (dark ? "bg-black" : "bg-white")}>
        <button
          onClick={() => setPanelOpen((v) => !v)}
          className={
            "md:hidden absolute top-3 left-3 z-20 px-3 py-2 rounded-lg text-xs font-semibold shadow " +
            (dark ? "bg-neutral-100 text-neutral-900" : "bg-black text-white")
          }
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
