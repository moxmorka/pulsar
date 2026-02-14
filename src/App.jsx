// App.jsx
import React from "react";
import { RotateCcw, Download, Play, Square, Palette, Moon, Sun, Plug, PlugZap } from "lucide-react";

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
   Sound engine w/ FX + Analyzer
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

function triggerVoice(ac, voice, { freq, vel, cutoffHz, attackSec, holdSec, releaseSec }) {
  const now = ac.currentTime;
  const v = clamp(vel, 0.0001, 1);

  voice.osc.frequency.setValueAtTime(freq, now);

  voice.filter.frequency.cancelScheduledValues(now);
  voice.filter.frequency.setValueAtTime(clamp(cutoffHz, 80, 16000), now);

  const g = voice.gain.gain;
  g.cancelScheduledValues(now);
  g.setValueAtTime(0.0001, now);
  g.exponentialRampToValueAtTime(v, now + clamp(attackSec, 0.001, 0.2));
  g.setValueAtTime(v, now + clamp(attackSec, 0.001, 0.2) + clamp(holdSec, 0.005, 2.5));
  g.exponentialRampToValueAtTime(0.0001, now + clamp(attackSec, 0.001, 0.2) + clamp(holdSec, 0.005, 2.5) + clamp(releaseSec, 0.01, 2.5));
}

/* =======================
   Visual: radial typographic stamp (reference-like)
======================= */
function drawRadialTextStamp(ctx, {
  x, y, radius, text, repeats, rotation, fontPx, letterSpacing = 1, color, alpha = 1
}) {
  if (!text || !text.length) return;
  const words = text.trim();
  if (!words) return;

  ctx.save();
  ctx.translate(x, y);
  ctx.rotate(rotation);

  ctx.globalAlpha = alpha;
  ctx.fillStyle = color;
  ctx.textAlign = "center";
  ctx.textBaseline = "middle";
  ctx.font = `${Math.max(8, Math.floor(fontPx))}px "Inter", system-ui, sans-serif`;

  const chars = words.split("");
  const total = Math.max(1, repeats);
  for (let ring = 0; ring < total; ring++) {
    const r = radius * (0.55 + ring * 0.12);
    const n = Math.max(24, chars.length * 5);
    for (let i = 0; i < n; i++) {
      const ang = (i / n) * Math.PI * 2;
      ctx.save();
      ctx.rotate(ang);
      ctx.translate(0, -r);
      ctx.rotate(Math.PI / 2);
      const ch = chars[i % chars.length];
      ctx.fillText(ch, 0, 0);
      ctx.restore();
    }
  }

  ctx.restore();
}

/* =======================
   Main App
======================= */
export default function App() {
  const canvasRef = React.useRef(null);
  const rafRef = React.useRef(null);

  // cells
  const [cells, setCells] = React.useState([]);
  const cellsRef = React.useRef([]);
  React.useEffect(() => {
    cellsRef.current = cells;
  }, [cells]);

  const [panelOpen, setPanelOpen] = React.useState(false);

  // painting
  const [paint, setPaint] = React.useState({
    mode: "color",
    color: "#111111",
    useSeq: true,
  });
  const [drawing, setDrawing] = React.useState(false);

  const [s, setS] = React.useState({
    // theme
    darkMode: false,

    // patterns
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
    colorSeq: ["#111111", "#ff0055", "#00c2ff", "#00ff88", "#ffe600"],
    colorSeqSpeed: 1.0,
    colorSeqBehave: "same", // same | cycle | wave | random

    // SOUND
    soundOn: true,
    bpm: 120,
    maxNotesPerStep: 10,

    // harmony
    keyRoot: 0,
    scaleName: "naturalMinor",
    baseMidi: 36,
    octaveSpan: 4,
    chordType: "7",
    prog: [0, 5, 3, 6],
    progRate: 4,

    // mapping
    laneMode: "hue", // column | hue
    velFrom: "luma",
    cutoffBase: 420,
    cutoffSpan: 8400,

    // envelope base
    attackBase: 0.008,
    attackSpan: 0.08,
    holdBase: 0.05,
    holdSpan: 0.55,
    releaseBase: 0.06,
    releaseSpan: 0.75,

    // voice pool
    voices: 12,

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

    // Visual reactive stamp
    stampOn: true,
    stampText: "PARIS ROUBAIX · HE RIDES · THEY BOUNCE ·",
    stampStrength: 0.9, // how much audio affects it
    stampSize: 0.68, // relative to canvas
  });

  const sRef = React.useRef(s);
  React.useEffect(() => {
    sRef.current = s;
  }, [s]);

  // palette
  const palette = React.useMemo(() => {
    const arr = Array.isArray(s.colorSeq) ? s.colorSeq : [];
    const fixed = arr.map((x) => (isHexColor(x) ? x : "#111111")).slice(0, 5);
    while (fixed.length < 5) fixed.push("#111111");
    return fixed;
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

  // variable edges (swiss-grid)
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

  // pointer -> canvas coords
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

  // upsert / remove
  const upsertCell = (idx, patch) => {
    setCells((prev) => {
      const ex = prev.findIndex((c) => c.idx === idx);
      const next = [...prev];
      if (ex >= 0) next[ex] = { ...next[ex], ...patch };
      else next.push({ idx, ...patch });
      return next;
    });
  };
  const removeCell = (idx) => setCells((prev) => prev.filter((c) => c.idx !== idx));

  const applyPaintToIdx = (idx, r, c, t) => {
    if (idx == null) return;
    if (paint.mode === "none") {
      removeCell(idx);
      return;
    }
    if (paint.useSeq) {
      const len = palette.length;
      const ci = colorSeqIndex(t, r, c, len);
      upsertCell(idx, { paint: { mode: "color", color: palette[ci] } });
    } else {
      upsertCell(idx, { paint: { mode: "color", color: paint.color } });
    }
  };

  /* =======================
     AUDIO GRAPH (stable)
======================= */
  const audioRef = React.useRef({
    ac: null,
    master: null,
    analyser: null,
    analyserBuf: null,

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

    // computed audio metrics
    rms: 0,
    centroid01: 0,
    midiPulse: 0,
  });

  function ensureAudio() {
    const A = audioRef.current;
    if (!A.ac) {
      const ac = new (window.AudioContext || window.webkitAudioContext)();

      const master = ac.createGain();
      master.gain.value = 0.85;

      // analyser (tap at master input)
      const analyser = ac.createAnalyser();
      analyser.fftSize = 1024;
      analyser.smoothingTimeConstant = 0.75;
      const analyserBuf = new Uint8Array(analyser.frequencyBinCount);

      // saturation
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

      // routing:
      // voices -> drive -> split (dry + fx) -> analyser -> master -> destination
      drive.connect(dry);
      drive.connect(convolver);
      drive.connect(delay);

      convolver.connect(wetRev);
      delay.connect(wetDel);

      dry.connect(analyser);
      wetRev.connect(analyser);
      wetDel.connect(analyser);

      analyser.connect(master);
      master.connect(ac.destination);

      A.ac = ac;
      A.master = master;
      A.analyser = analyser;
      A.analyserBuf = analyserBuf;
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

      // init drive curve
      updateDriveCurve();
      // init FX gains
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

  function updateDriveCurve() {
    const A = audioRef.current;
    if (!A.ac || !A.drive) return;
    const st = sRef.current;
    const n = 2048;

    if (!st.driveOn) {
      const curve = new Float32Array(n);
      for (let i = 0; i < n; i++) curve[i] = (i * 2) / (n - 1) - 1;
      A.drive.curve = curve;
      return;
    }

    const k = clamp(st.drive ?? 0.6, 0, 1) * 50;
    const curve = new Float32Array(n);
    for (let i = 0; i < n; i++) {
      const x = (i * 2) / (n - 1) - 1;
      curve[i] = Math.tanh(x * (1 + k));
    }
    A.drive.curve = curve;
  }

  function updateAudioParamsRealtime() {
    const A = audioRef.current;
    if (!A.ac) return;
    const st = sRef.current;

    A.master.gain.setTargetAtTime(clamp(st.master, 0, 1.2), A.ac.currentTime, 0.02);
    updateDriveCurve();

    A.wetRev.gain.setTargetAtTime(st.reverbOn ? clamp(st.reverbMix, 0, 1) : 0, A.ac.currentTime, 0.02);
    if (A._revTime == null) A._revTime = st.reverbTime;
    if (Math.abs(st.reverbTime - A._revTime) > 0.15) {
      A._revTime = st.reverbTime;
      A.convolver.buffer = createReverbImpulse(A.ac, clamp(st.reverbTime, 0.3, 6), 2.0);
    }

    A.wetDel.gain.setTargetAtTime(st.delayOn ? clamp(st.delayMix, 0, 1) : 0, A.ac.currentTime, 0.02);
    A.delay.delayTime.setTargetAtTime(clamp(st.delayTime, 0.01, 1.5), A.ac.currentTime, 0.02);
    A.feedback.gain.setTargetAtTime(clamp(st.delayFeedback, 0, 0.95), A.ac.currentTime, 0.02);
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

  // only update audio params if audio already exists (don’t auto-start)
  React.useEffect(() => {
    if (audioRef.current.ac) {
      ensureVoices();
      updateAudioParamsRealtime();
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [s]);

  function updateAudioMeters() {
    const A = audioRef.current;
    if (!A.ac || !A.analyser) return;

    const buf = A.analyserBuf;
    A.analyser.getByteFrequencyData(buf);

    // RMS-ish from spectrum magnitude
    let sum = 0;
    let wsum = 0;
    let fsum = 0;
    const n = buf.length;
    for (let i = 0; i < n; i++) {
      const v = buf[i] / 255;
      sum += v * v;
      const w = v;
      wsum += w;
      fsum += w * (i / (n - 1));
    }
    const rms = Math.sqrt(sum / Math.max(1, n));
    const centroid01 = wsum > 1e-6 ? fsum / wsum : 0;

    // smooth
    A.rms = lerp(A.rms, rms, 0.25);
    A.centroid01 = lerp(A.centroid01, centroid01, 0.2);

    // decay midiPulse
    A.midiPulse = lerp(A.midiPulse, 0, 0.1);
  }

  /* =======================
     WHY ONLY TOP ROWS PLAYED?
     Fix: stop biasing the "score" toward top.
     Old code had: score = vel + rowNorm*0.08 (favours top heavily).
     Now: score = vel + tiny randomness + small “novelty” from hue.
======================= */

  /* =======================
     Scheduler (stable)
     - columns var-density => rhythm (stepSec)
     - rows var-density => envelope (attack/hold/release)
======================= */
  function startScheduler() {
    const A = ensureAudio();
    if (A.ac.state === "suspended") A.ac.resume?.();
    A.running = true;

    const tick = () => {
      if (!audioRef.current.running) return;

      const st = sRef.current;
      if (!st.soundOn) {
        audioRef.current.timer = setTimeout(tick, 50);
        return;
      }

      ensureVoices();
      updateAudioParamsRealtime();
      updateAudioMeters();

      const cellsNow = cellsRef.current;

      // lookup
      const map = new Map();
      for (const c of cellsNow) map.set(c.idx, c);

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

      // base step duration
      const bpm = clamp(st.bpm ?? 120, 30, 260);
      const baseStepSec = 60 / bpm / 2; // 8th-note feel
      let stepSec = baseStepSec;

      // Column density => rhythm
      if (isSwiss && st.varColsOn) {
        const ce =
          colEdges ||
          (st.cols
            ? Array.from({ length: st.cols + 1 }, (_, i) => i / st.cols)
            : Array.from({ length: cols + 1 }, (_, i) => i / cols));
        const stepCol = audioRef.current.step % cols;
        const w = ce[stepCol + 1] - ce[stepCol];
        const avg = 1 / cols;
        const ratio = clamp(w / avg, 0.35, 2.6);
        stepSec = baseStepSec * ratio;
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

      const hits = [];

      for (let r = 0; r < rows; r++) {
        const idx = r * cols + col;
        const cell = map.get(idx);
        const paintObj = cell?.paint;
        if (!paintObj?.color) continue;

        const rgb = hexToRgb(paintObj.color);
        if (!rgb) continue;

        const lum = luminance01(rgb);
        const h = hue01(rgb);

        // lane
        let lane = 0;
        if (st.laneMode === "hue") {
          const lanes = chordTones.length;
          lane = clamp(Math.floor(h * lanes), 0, lanes - 1);
        } else {
          lane = col % chordTones.length;
        }

        // row pitch (scale)
        const rowNorm = rows <= 1 ? 0.5 : 1 - r / (rows - 1); // top=1, bottom=0
        const degFloat = rowNorm * (degreesCount - 1);
        const degIdx = clamp(Math.round(degFloat), 0, degreesCount - 1);
        const rowMidi = scaleMidi[degIdx];

        // chord tone moved near rowMidi
        let target = chordTones[lane];
        while (target < rowMidi - 6) target += 12;
        while (target > rowMidi + 6) target -= 12;

        const freq = midiToFreq(target);

        // velocity
        const vel = st.velFrom === "fixed" ? 0.55 : clamp(0.08 + 0.92 * lum, 0.05, 1);

        // cutoff (brightness + a touch of centroid)
        const A = audioRef.current;
        const centroidBoost = clamp(A.centroid01 ?? 0, 0, 1);
        const cutoff =
          (st.cutoffBase ?? 420) +
          (st.cutoffSpan ?? 8400) * clamp(0.15 + 0.75 * lum + 0.25 * centroidBoost, 0, 1);

        // =============================
        // ROWS (TAILS) => envelope shaping
        // - If varRowsOn: row height ratio affects tail + attack
        // - Also: top rows sharper, bottom rows longer (musical)
        // =============================
        let rowHeightRatio = 1;
        if (isSwiss && st.varRowsOn) {
          const re =
            rowEdges ||
            (st.rows
              ? Array.from({ length: st.rows + 1 }, (_, i) => i / st.rows)
              : Array.from({ length: rows + 1 }, (_, i) => i / rows));
          const rh = re[r + 1] - re[r];
          const avg = 1 / rows;
          rowHeightRatio = clamp(rh / avg, 0.35, 2.6);
        }

        // Base envelope, then shaped by row position + rowHeightRatio
        const attackSec = clamp(
          (st.attackBase ?? 0.008) + (st.attackSpan ?? 0.08) * (1 - rowNorm) * (1 / Math.sqrt(rowHeightRatio)),
          0.002,
          0.18
        );

        const holdSec = clamp(
          (st.holdBase ?? 0.05) + (st.holdSpan ?? 0.55) * (0.2 + 0.8 * lum) * Math.sqrt(rowHeightRatio) * (0.4 + 0.6 * (1 - rowNorm)),
          0.01,
          2.2
        );

        const releaseSec = clamp(
          (st.releaseBase ?? 0.06) + (st.releaseSpan ?? 0.75) * (0.2 + 0.8 * lum) * Math.sqrt(rowHeightRatio) * (0.4 + 0.6 * (1 - rowNorm)),
          0.03,
          2.4
        );

        // score: DO NOT bias to top. Keep bottom audible in dense grids.
        const score = vel + 0.02 * Math.sin((h * 10 + r * 0.17 + col * 0.11) * 10) + 0.01 * Math.random();

        hits.push({ freq, vel, cutoff, attackSec, holdSec, releaseSec, score });
      }

      hits.sort((a, b) => b.score - a.score);
      const chosen = hits.slice(0, maxNotes);

      // trigger
      const pool = audioRef.current.voices;
      for (const h of chosen) {
        const v = pool[audioRef.current.voicePtr % pool.length];
        audioRef.current.voicePtr++;
        triggerVoice(audioRef.current.ac, v, {
          freq: h.freq,
          vel: h.vel,
          cutoffHz: h.cutoff,
          attackSec: h.attackSec,
          holdSec: h.holdSec,
          releaseSec: h.releaseSec,
        });
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
     MIDI (optional)
     - WebMIDI input
     - NoteOn: pulse visuals + optionally “jump” the sequencer column
     - CC: macro-map to FX like modular reverb/delay/drive/master
======================= */
  const [midiState, setMidiState] = React.useState({ supported: false, enabled: false, inputs: 0 });

  React.useEffect(() => {
    let midi = null;
    let stop = false;

    async function setupMIDI() {
      if (!navigator.requestMIDIAccess) {
        setMidiState({ supported: false, enabled: false, inputs: 0 });
        return;
      }
      setMidiState((p) => ({ ...p, supported: true }));

      try {
        midi = await navigator.requestMIDIAccess();
        if (stop) return;

        const hookInput = (input) => {
          input.onmidimessage = (msg) => {
            const [st, d1, d2] = msg.data || [];
            const type = st & 0xf0;

            // note on
            if (type === 0x90 && d2 > 0) {
              const A = ensureAudio();
              A.midiPulse = 1;

              // Optional: jump column by note (feels like “MIDI drives pattern”)
              const cols = Math.max(1, sRef.current.cols | 0);
              audioRef.current.step = (audioRef.current.step + (d1 % cols)) % (cols * 8);

              // Optional: tiny accent = push delay mix
              const mix = clamp(sRef.current.delayMix + 0.06, 0, 0.8);
              sRef.current.delayMix = mix;
              setS((p) => ({ ...p, delayMix: mix }));
            }

            // CC macros
            if (type === 0xb0) {
              const cc = d1;
              const v = d2 / 127;

              // CC1 -> reverb mix
              if (cc === 1) setS((p) => ({ ...p, reverbMix: clamp(v * 0.8, 0, 0.8) }));
              // CC2 -> delay mix
              if (cc === 2) setS((p) => ({ ...p, delayMix: clamp(v * 0.8, 0, 0.8) }));
              // CC3 -> drive
              if (cc === 3) setS((p) => ({ ...p, drive: clamp(v, 0, 1), driveOn: true }));
              // CC7 -> master
              if (cc === 7) setS((p) => ({ ...p, master: clamp(v * 1.2, 0, 1.2) }));
            }
          };
        };

        const refresh = () => {
          let inputs = 0;
          for (const input of midi.inputs.values()) {
            inputs++;
            hookInput(input);
          }
          setMidiState({ supported: true, enabled: true, inputs });
        };

        refresh();
        midi.onstatechange = refresh;
      } catch {
        setMidiState({ supported: true, enabled: false, inputs: 0 });
      }
    }

    setupMIDI();
    return () => {
      stop = true;
      try {
        if (midi) midi.onstatechange = null;
      } catch {}
    };
  }, []);

  /* =======================
     Input handlers
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

  const gen = () => setCells((p) => [...p]);
  const clearPaint = () => setCells([]);

  /* =======================
     Render loop (big visual output)
     - Dark/light mode
     - Audio-reactive stamp like your references
     - Grid itself stays crisp + useful
======================= */
  const getFontFamily = () => `"Inter", system-ui, -apple-system, Segoe UI, Roboto, sans-serif`;

  const render = (tm) => {
    const cv = canvasRef.current;
    if (!cv) return;

    // keep meters hot
    updateAudioMeters();

    const ctx = cv.getContext("2d");
    const w = cv.width,
      h = cv.height;

    const t = tm * 0.001;

    const A = audioRef.current;
    const rms = clamp(A.rms ?? 0, 0, 1);
    const centroid01 = clamp(A.centroid01 ?? 0, 0, 1);
    const midiPulse = clamp(A.midiPulse ?? 0, 0, 1);

    const bg = s.darkMode ? "#0B0B0C" : "#FAFAFA";
    const fg = s.darkMode ? "#F4F4F5" : "#111111";
    const gridCol = s.darkMode ? "rgba(255,255,255,0.08)" : "rgba(0,0,0,0.08)";

    // background with subtle audio pulse
    ctx.clearRect(0, 0, w, h);
    ctx.fillStyle = bg;
    ctx.fillRect(0, 0, w, h);

    // paint lookup
    const map = new Map();
    for (const c of cells) map.set(c.idx, c);

    // big stamp (reference-like)
    if (s.stampOn) {
      const strength = clamp(s.stampStrength ?? 0.9, 0, 1);
      const size = clamp(s.stampSize ?? 0.68, 0.2, 1.2);

      const baseR = Math.min(w, h) * size * 0.42;
      const pulse = 1 + strength * (rms * 0.6 + midiPulse * 0.25);
      const radius = baseR * pulse;

      const rot = t * (0.25 + strength * 1.15 * (0.25 + centroid01)) + midiPulse * 0.6;
      const fontPx = Math.max(10, Math.min(w, h) * 0.022 * (1 + rms * 0.4));

      const stampColor = s.darkMode ? "rgba(255,255,255,0.85)" : "rgba(0,0,0,0.82)";
      drawRadialTextStamp(ctx, {
        x: w * 0.5,
        y: h * 0.5,
        radius,
        text: s.stampText,
        repeats: 2 + Math.floor(strength * 2),
        rotation: rot,
        fontPx,
        color: stampColor,
        alpha: 0.22 + strength * 0.35 * (0.35 + rms),
      });

      // center glow (soft)
      ctx.save();
      ctx.globalAlpha = 0.08 + rms * 0.18;
      ctx.beginPath();
      ctx.arc(w * 0.5, h * 0.5, Math.min(w, h) * 0.38 * (1 + rms * 0.2), 0, Math.PI * 2);
      ctx.fillStyle = s.darkMode ? "#FFFFFF" : "#000000";
      ctx.fill();
      ctx.restore();
    }

    ctx.fillStyle = fg;
    ctx.textAlign = "center";
    ctx.textBaseline = "middle";

    // draw grid
    if (s.pat === "char-grid") {
      const cols = Math.max(1, Math.floor(w / s.space));
      const rows = Math.max(1, Math.floor(h / s.space));

      if (s.gridLines) {
        ctx.save();
        ctx.strokeStyle = gridCol;
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
      const spd = (s.charSpd ?? 2) * (0.85 + 0.6 * centroid01);

      for (let r = 0; r < rows; r++) {
        for (let c = 0; c < cols; c++) {
          const idx = r * cols + c;
          const x0 = c * s.space;
          const y0 = r * s.space;
          const cx = x0 + s.space / 2;
          const cy = y0 + s.space / 2;

          const entry = map.get(idx);
          const col = entry?.paint?.color;

          if (col) {
            ctx.save();
            ctx.globalAlpha = 0.85;
            ctx.fillStyle = col;
            ctx.fillRect(x0, y0, s.space, s.space);
            ctx.restore();
          }

          const gi = chs.length ? (Math.floor((t * spd + r * 0.07 + c * 0.05) * 3) % chs.length) : 0;

          const wob = 1 + 0.35 * (rms * 0.8 + midiPulse * 0.25);
          ctx.save();
          ctx.font = `${Math.floor(s.charSz * wob)}px ${getFontFamily()}`;
          ctx.fillStyle = col ? (s.darkMode ? "#0B0B0C" : "#0A0A0A") : fg;
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
        ctx.strokeStyle = gridCol;
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
      const spd = (s.charSpd ?? 2) * (0.8 + 0.8 * centroid01);

      for (let r = 0; r < rows; r++) {
        for (let c = 0; c < cols; c++) {
          const idx = r * cols + c;
          const g = swissCellGeom(r, c, w, h);
          const entry = map.get(idx);
          const col = entry?.paint?.color;

          if (col) {
            ctx.save();
            ctx.fillStyle = col;
            ctx.globalAlpha = 0.9;
            ctx.fillRect(g.x, g.y, g.w, g.h);
            ctx.restore();
          }

          const gi = chs.length ? (Math.floor((t * spd + r * 0.09 + c * 0.05) * 3) % chs.length) : 0;

          const baseSz = Math.max(8, Math.min(g.w, g.h) * 0.55 * (s.swissCharScale ?? 1));
          const wob = 1 + 0.22 * (rms + midiPulse * 0.35);
          const sz = Math.floor(baseSz * wob);

          ctx.save();
          ctx.font = `${sz}px ${getFontFamily()}`;
          ctx.fillStyle = col ? (s.darkMode ? "#0B0B0C" : "#0A0A0A") : fg;
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
  }, [s, cells, colEdges, rowEdges]);

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

  // load Inter
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

  return (
    <div className={`w-full h-[100svh] flex flex-col md:flex-row overflow-hidden ${s.darkMode ? "bg-black" : "bg-white"}`}>
      {panelOpen && (
        <div className="fixed inset-0 bg-black/30 z-30 md:hidden" onClick={() => setPanelOpen(false)} />
      )}

      {/* Controls */}
      <div
        className={
          "fixed md:static z-40 md:z-auto inset-y-0 left-0 w-80 max-w-[90vw] border-r p-4 md:p-5 overflow-y-auto space-y-4 text-sm transform transition-transform duration-200 md:transform-none " +
          (panelOpen ? "translate-x-0" : "-translate-x-full md:translate-x-0") +
          (s.darkMode ? " bg-neutral-950 border-neutral-800 text-neutral-100" : " bg-neutral-50 border-neutral-200 text-neutral-900")
        }
      >
        <div className="flex gap-2">
          <button
            onClick={gen}
            className={`flex-1 flex justify-center px-4 py-2.5 rounded-lg font-medium min-h-[44px] ${s.darkMode ? "bg-white text-black hover:bg-neutral-200" : "bg-black text-white hover:bg-neutral-800"}`}
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
            className={`flex-1 flex justify-center px-4 py-2.5 rounded-lg font-medium min-h-[44px] ${s.darkMode ? "bg-white text-black hover:bg-neutral-200" : "bg-black text-white hover:bg-neutral-800"}`}
            title="Download PNG"
          >
            <Download size={16} />
          </button>
        </div>

        {/* Theme + MIDI */}
        <div className="flex gap-2">
          <button
            onClick={() => setS((p) => ({ ...p, darkMode: !p.darkMode }))}
            className={`flex-1 px-3 py-2 rounded-lg border text-xs font-semibold flex items-center justify-center gap-2 min-h-[44px] ${
              s.darkMode ? "bg-neutral-900 border-neutral-700" : "bg-white border-neutral-300"
            }`}
            title="Toggle dark/light"
          >
            {s.darkMode ? <Sun size={14} /> : <Moon size={14} />}
            {s.darkMode ? "Light mode" : "Dark mode"}
          </button>

          <div
            className={`flex-1 px-3 py-2 rounded-lg border text-xs font-semibold flex items-center justify-center gap-2 min-h-[44px] ${
              s.darkMode ? "bg-neutral-900 border-neutral-700" : "bg-white border-neutral-300"
            }`}
            title="MIDI status"
          >
            {midiState.enabled ? <PlugZap size={14} /> : <Plug size={14} />}
            {midiState.supported ? (midiState.enabled ? `MIDI: ${midiState.inputs}` : "MIDI off") : "No MIDI"}
          </div>
        </div>

        {/* Pattern */}
        <div className="space-y-2">
          <label className="block text-xs font-semibold uppercase tracking-wider">Pattern</label>
          <select
            value={s.pat}
            onChange={(e) => setS((p) => ({ ...p, pat: e.target.value }))}
            className={`w-full px-3 py-2 border rounded-lg ${s.darkMode ? "bg-neutral-900 border-neutral-700" : "bg-white border-neutral-300"}`}
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
              className={`h-10 w-14 rounded-md border ${s.darkMode ? "border-neutral-700 bg-neutral-900" : "border-neutral-300 bg-white"}`}
              title="Pick color"
            />

            <button
              onClick={() => setPaint((p) => ({ ...p, useSeq: !p.useSeq, mode: "color" }))}
              className={`flex-1 px-3 py-2 rounded-lg border text-xs font-semibold flex items-center justify-center gap-2 min-h-[44px] ${
                paint.useSeq ? (s.darkMode ? "bg-white text-black border-white" : "bg-black text-white border-black") : (s.darkMode ? "bg-neutral-900 border-neutral-700" : "bg-white border-neutral-300")
              }`}
            >
              <Palette size={14} />
              {paint.useSeq ? "Color String ON" : "Color String OFF"}
            </button>

            <button
              onClick={() => setPaint((p) => ({ ...p, mode: p.mode === "none" ? "color" : "none" }))}
              className={`px-3 py-2 rounded-lg text-xs font-semibold min-h-[44px] ${
                paint.mode === "none"
                  ? (s.darkMode ? "bg-white text-black" : "bg-black text-white")
                  : (s.darkMode ? "bg-neutral-800 text-neutral-200" : "bg-neutral-200 text-neutral-700")
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
              <div className={`text-xs ${s.darkMode ? "text-neutral-300" : "text-neutral-600"}`}>Color motion</div>
              <select
                value={s.colorSeqBehave}
                onChange={(e) => setS((p) => ({ ...p, colorSeqBehave: e.target.value }))}
                className={`w-full px-2 py-2 border rounded-lg text-xs ${s.darkMode ? "bg-neutral-900 border-neutral-700" : "bg-white border-neutral-300"}`}
              >
                <option value="same">Same (musical)</option>
                <option value="cycle">Cycle</option>
                <option value="wave">Wave</option>
                <option value="random">Random</option>
              </select>
            </div>
            <div className="space-y-1">
              <div className={`text-xs ${s.darkMode ? "text-neutral-300" : "text-neutral-600"}`}>Speed</div>
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
            className={`w-full px-4 py-2.5 rounded-lg font-medium min-h-[44px] ${s.darkMode ? "bg-white text-black hover:bg-neutral-200" : "bg-neutral-900 text-white hover:bg-black"}`}
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
              max="60"
              value={s.cols}
              onChange={(e) => setS((p) => ({ ...p, cols: parseInt(e.target.value, 10) }))}
              className="w-full"
            />
            <input
              type="range"
              min="4"
              max="60"
              value={s.rows}
              onChange={(e) => setS((p) => ({ ...p, rows: parseInt(e.target.value, 10) }))}
              className="w-full"
            />

            <div className="flex items-center justify-between">
              <label className="text-xs font-semibold uppercase tracking-wider">Grid Lines</label>
              <button
                onClick={() => setS((p) => ({ ...p, gridLines: !p.gridLines }))}
                className={`p-1.5 rounded ${s.gridLines ? (s.darkMode ? "bg-white text-black" : "bg-black text-white") : (s.darkMode ? "bg-neutral-800" : "bg-neutral-200")}`}
              >
                {s.gridLines ? <Play size={14} fill="currentColor" /> : <Square size={14} />}
              </button>
            </div>

            <label className="block text-xs font-semibold uppercase tracking-wider">Variable Grid Density</label>

            <div className={`rounded-lg border p-3 space-y-2 ${s.darkMode ? "border-neutral-700 bg-neutral-900" : "border-neutral-200 bg-white"}`}>
              <div className="flex items-center justify-between">
                <div className="text-xs font-semibold uppercase tracking-wider">Columns (rhythm)</div>
                <button
                  onClick={() => setS((p) => ({ ...p, varColsOn: !p.varColsOn }))}
                  className={`p-1.5 rounded ${s.varColsOn ? (s.darkMode ? "bg-white text-black" : "bg-black text-white") : (s.darkMode ? "bg-neutral-800" : "bg-neutral-200")}`}
                >
                  {s.varColsOn ? <Play size={14} fill="currentColor" /> : <Square size={14} />}
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
                  <div className={`text-[11px] ${s.darkMode ? "text-neutral-300" : "text-neutral-600"}`}>
                    Columns affect <b>step speed</b> (narrow = faster, wide = slower).
                  </div>
                </>
              )}
            </div>

            <div className={`rounded-lg border p-3 space-y-2 ${s.darkMode ? "border-neutral-700 bg-neutral-900" : "border-neutral-200 bg-white"}`}>
              <div className="flex items-center justify-between">
                <div className="text-xs font-semibold uppercase tracking-wider">Rows (tails)</div>
                <button
                  onClick={() => setS((p) => ({ ...p, varRowsOn: !p.varRowsOn }))}
                  className={`p-1.5 rounded ${s.varRowsOn ? (s.darkMode ? "bg-white text-black" : "bg-black text-white") : (s.darkMode ? "bg-neutral-800" : "bg-neutral-200")}`}
                >
                  {s.varRowsOn ? <Play size={14} fill="currentColor" /> : <Square size={14} />}
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
                  <div className={`text-[11px] ${s.darkMode ? "text-neutral-300" : "text-neutral-600"}`}>
                    Rows affect <b>attack/hold/release</b> via row height + position (bottom gets longer tails).
                  </div>
                </>
              )}
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
                setS((p) => ({ ...p, soundOn: !p.soundOn }));
              }}
              className={`p-1.5 rounded ${s.soundOn ? (s.darkMode ? "bg-white text-black" : "bg-black text-white") : (s.darkMode ? "bg-neutral-800" : "bg-neutral-200")}`}
              title="Sound on/off"
            >
              {s.soundOn ? <Play size={14} fill="currentColor" /> : <Square size={14} />}
            </button>
          </div>

          <label className="block text-xs font-semibold uppercase tracking-wider">BPM: {s.bpm}</label>
          <input type="range" min="40" max="220" value={s.bpm} onChange={(e) => setS((p) => ({ ...p, bpm: parseInt(e.target.value, 10) }))} className="w-full" />

          <label className="block text-xs font-semibold uppercase tracking-wider">Max notes / step: {s.maxNotesPerStep}</label>
          <input type="range" min="1" max="24" value={s.maxNotesPerStep} onChange={(e) => setS((p) => ({ ...p, maxNotesPerStep: parseInt(e.target.value, 10) }))} className="w-full" />

          <div className="grid grid-cols-2 gap-2">
            <div className="space-y-1">
              <div className={`text-xs ${s.darkMode ? "text-neutral-300" : "text-neutral-600"}`}>Key</div>
              <select value={s.keyRoot} onChange={(e) => setS((p) => ({ ...p, keyRoot: parseInt(e.target.value, 10) }))} className={`w-full px-2 py-2 border rounded-lg text-xs ${s.darkMode ? "bg-neutral-900 border-neutral-700" : "bg-white border-neutral-300"}`}>
                {NOTE_NAMES.map((n, i) => (
                  <option key={n} value={i}>
                    {n}
                  </option>
                ))}
              </select>
            </div>
            <div className="space-y-1">
              <div className={`text-xs ${s.darkMode ? "text-neutral-300" : "text-neutral-600"}`}>Scale</div>
              <select value={s.scaleName} onChange={(e) => setS((p) => ({ ...p, scaleName: e.target.value }))} className={`w-full px-2 py-2 border rounded-lg text-xs ${s.darkMode ? "bg-neutral-900 border-neutral-700" : "bg-white border-neutral-300"}`}>
                {Object.keys(SCALES).map((name) => (
                  <option key={name} value={name}>
                    {name}
                  </option>
                ))}
              </select>
            </div>
          </div>

          <div className={`text-[11px] ${s.darkMode ? "text-neutral-300" : "text-neutral-600"}`}>
            <b>Always in tune:</b> pitches are quantized to {keyName} {s.scaleName}. <br />
            <b>Dense grids:</b> bottom rows now play too (no “top bias” in scoring).
          </div>

          <label className="block text-xs font-semibold uppercase tracking-wider">Master: {s.master.toFixed(2)}</label>
          <input type="range" min="0" max="1.2" step="0.01" value={s.master} onChange={(e) => setS((p) => ({ ...p, master: parseFloat(e.target.value) }))} className="w-full" />
        </div>

        {/* FX */}
        <div className="space-y-2">
          <label className="block text-xs font-semibold uppercase tracking-wider">FX</label>

          <div className={`rounded-lg border p-3 space-y-2 ${s.darkMode ? "border-neutral-700 bg-neutral-900" : "border-neutral-200 bg-white"}`}>
            <div className="flex items-center justify-between">
              <div className="text-xs font-semibold uppercase tracking-wider">Reverb (Plate-ish)</div>
              <button
                onClick={() => setS((p) => ({ ...p, reverbOn: !p.reverbOn }))}
                className={`p-1.5 rounded ${s.reverbOn ? (s.darkMode ? "bg-white text-black" : "bg-black text-white") : (s.darkMode ? "bg-neutral-800" : "bg-neutral-200")}`}
              >
                {s.reverbOn ? <Play size={14} fill="currentColor" /> : <Square size={14} />}
              </button>
            </div>
            <label className="block text-xs font-semibold uppercase tracking-wider">Mix: {s.reverbMix.toFixed(2)}</label>
            <input type="range" min="0" max="0.8" step="0.01" value={s.reverbMix} onChange={(e) => setS((p) => ({ ...p, reverbMix: parseFloat(e.target.value) }))} className="w-full" />
            <label className="block text-xs font-semibold uppercase tracking-wider">Time: {s.reverbTime.toFixed(1)}s</label>
            <input type="range" min="0.5" max="6" step="0.1" value={s.reverbTime} onChange={(e) => setS((p) => ({ ...p, reverbTime: parseFloat(e.target.value) }))} className="w-full" />
          </div>

          <div className={`rounded-lg border p-3 space-y-2 ${s.darkMode ? "border-neutral-700 bg-neutral-900" : "border-neutral-200 bg-white"}`}>
            <div className="flex items-center justify-between">
              <div className="text-xs font-semibold uppercase tracking-wider">Delay</div>
              <button
                onClick={() => setS((p) => ({ ...p, delayOn: !p.delayOn }))}
                className={`p-1.5 rounded ${s.delayOn ? (s.darkMode ? "bg-white text-black" : "bg-black text-white") : (s.darkMode ? "bg-neutral-800" : "bg-neutral-200")}`}
              >
                {s.delayOn ? <Play size={14} fill="currentColor" /> : <Square size={14} />}
              </button>
            </div>
            <label className="block text-xs font-semibold uppercase tracking-wider">Mix: {s.delayMix.toFixed(2)}</label>
            <input type="range" min="0" max="0.8" step="0.01" value={s.delayMix} onChange={(e) => setS((p) => ({ ...p, delayMix: parseFloat(e.target.value) }))} className="w-full" />
            <label className="block text-xs font-semibold uppercase tracking-wider">Time: {s.delayTime.toFixed(2)}s</label>
            <input type="range" min="0.05" max="0.9" step="0.01" value={s.delayTime} onChange={(e) => setS((p) => ({ ...p, delayTime: parseFloat(e.target.value) }))} className="w-full" />
            <label className="block text-xs font-semibold uppercase tracking-wider">Feedback: {s.delayFeedback.toFixed(2)}</label>
            <input type="range" min="0" max="0.85" step="0.01" value={s.delayFeedback} onChange={(e) => setS((p) => ({ ...p, delayFeedback: parseFloat(e.target.value) }))} className="w-full" />
          </div>

          <div className={`rounded-lg border p-3 space-y-2 ${s.darkMode ? "border-neutral-700 bg-neutral-900" : "border-neutral-200 bg-white"}`}>
            <div className="flex items-center justify-between">
              <div className="text-xs font-semibold uppercase tracking-wider">Drive</div>
              <button
                onClick={() => setS((p) => ({ ...p, driveOn: !p.driveOn }))}
                className={`p-1.5 rounded ${s.driveOn ? (s.darkMode ? "bg-white text-black" : "bg-black text-white") : (s.darkMode ? "bg-neutral-800" : "bg-neutral-200")}`}
              >
                {s.driveOn ? <Play size={14} fill="currentColor" /> : <Square size={14} />}
              </button>
            </div>
            <label className="block text-xs font-semibold uppercase tracking-wider">Amount: {s.drive.toFixed(2)}</label>
            <input type="range" min="0" max="1" step="0.01" value={s.drive} onChange={(e) => setS((p) => ({ ...p, drive: parseFloat(e.target.value) }))} className="w-full" />
          </div>
        </div>

        {/* Visual Stamp */}
        <div className="space-y-2">
          <label className="block text-xs font-semibold uppercase tracking-wider">Big Typographic Output</label>
          <div className="flex items-center justify-between">
            <div className={`text-xs ${s.darkMode ? "text-neutral-300" : "text-neutral-600"}`}>Stamp</div>
            <button
              onClick={() => setS((p) => ({ ...p, stampOn: !p.stampOn }))}
              className={`p-1.5 rounded ${s.stampOn ? (s.darkMode ? "bg-white text-black" : "bg-black text-white") : (s.darkMode ? "bg-neutral-800" : "bg-neutral-200")}`}
            >
              {s.stampOn ? <Play size={14} fill="currentColor" /> : <Square size={14} />}
            </button>
          </div>
          <label className="block text-xs font-semibold uppercase tracking-wider">Text</label>
          <input
            type="text"
            value={s.stampText}
            onChange={(e) => setS((p) => ({ ...p, stampText: e.target.value }))}
            className={`w-full px-3 py-2 border rounded-lg font-mono text-xs ${s.darkMode ? "bg-neutral-900 border-neutral-700" : "bg-white border-neutral-300"}`}
          />
          <label className="block text-xs font-semibold uppercase tracking-wider">Strength: {s.stampStrength.toFixed(2)}</label>
          <input type="range" min="0" max="1" step="0.01" value={s.stampStrength} onChange={(e) => setS((p) => ({ ...p, stampStrength: parseFloat(e.target.value) }))} className="w-full" />
          <label className="block text-xs font-semibold uppercase tracking-wider">Size: {s.stampSize.toFixed(2)}</label>
          <input type="range" min="0.2" max="1.2" step="0.01" value={s.stampSize} onChange={(e) => setS((p) => ({ ...p, stampSize: parseFloat(e.target.value) }))} className="w-full" />

          <div className={`text-[11px] ${s.darkMode ? "text-neutral-300" : "text-neutral-600"}`}>
            Audio drives stamp: <b>volume</b> → scale/opacity, <b>brightness</b> → rotation speed, <b>MIDI</b> → pulses + FX macros.
          </div>
        </div>

        <div className={`text-[11px] ${s.darkMode ? "text-neutral-400" : "text-neutral-500"}`}>
          Tip: click/touch canvas once to unlock audio. MIDI works if your browser supports WebMIDI (usually Chrome/Edge).
        </div>
      </div>

      {/* Canvas */}
      <div className={`flex-1 min-h-0 p-2 md:p-8 relative overflow-hidden ${s.darkMode ? "bg-black" : "bg-white"}`}>
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
