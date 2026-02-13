// App.jsx
import React from "react";
import {
  RotateCcw,
  Download,
  Play,
  Square,
  Image as ImageIcon,
  Wand2,
  Palette,
} from "lucide-react";

/* =========================
   Utils
========================= */
const clamp = (v, a, b) => Math.max(a, Math.min(b, v));
const lerp = (a, b, t) => a + (b - a) * t;

function detectBpmFromFloatBuffer(floatBuf, sampleRate, minBpm = 60, maxBpm = 200) {
  let mean = 0;
  for (let i = 0; i < floatBuf.length; i++) mean += floatBuf[i];
  mean /= floatBuf.length;

  const buf = new Float32Array(floatBuf.length);
  for (let i = 0; i < floatBuf.length; i++) buf[i] = floatBuf[i] - mean;

  let energy = 0;
  for (let i = 0; i < buf.length; i++) energy += buf[i] * buf[i];
  energy /= buf.length;
  if (energy < 1e-4) return null;

  const minLag = Math.floor(sampleRate * (60 / maxBpm));
  const maxLag = Math.floor(sampleRate * (60 / minBpm));

  let bestLag = -1;
  let bestCorr = 0;
  const N = buf.length;

  for (let lag = minLag; lag <= maxLag; lag++) {
    let corr = 0;
    for (let i = 0; i < N - lag; i++) corr += buf[i] * buf[i + lag];
    corr /= N - lag;
    if (corr > bestCorr) {
      bestCorr = corr;
      bestLag = lag;
    }
  }

  if (bestLag <= 0) return null;

  const confidence = bestCorr / (energy + 1e-9);
  if (confidence < 0.15) return null;

  const bpm = (60 * sampleRate) / bestLag;
  return clamp(bpm, minBpm, maxBpm);
}

function hexFromRgb(r, g, b) {
  const to2 = (n) => n.toString(16).padStart(2, "0");
  return `#${to2(r)}${to2(g)}${to2(b)}`;
}
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

/* =========================
   Variable grid edges (Swiss)
========================= */
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

/* =========================
   Span rendering
========================= */
function drawSpanTextChopped({
  ctx,
  text,
  region, // {x,y,w,h,r0,c0,rN,cN}
  getCellRect,
  fontFamily,
  fontScale,
  tracking,
  align,
}) {
  if (!text) return;
  const { x, y, w, h, r0, c0, rN, cN } = region;

  const fontPx = Math.max(8, Math.min(h, w) * 0.75 * (fontScale || 1));
  ctx.save();
  ctx.font = `700 ${fontPx}px ${fontFamily}`;
  ctx.textBaseline = "middle";
  ctx.textAlign = "left";

  const padX = Math.max(6, w * 0.06);
  const tx = align === "center" ? x + w * 0.5 : x + padX;
  const ty = y + h * 0.5;

  const drawText = (x0, y0) => {
    if (!tracking) {
      if (align === "center") {
        ctx.textAlign = "center";
        ctx.fillText(text, x0, y0);
        ctx.textAlign = "left";
      } else {
        ctx.fillText(text, x0, y0);
      }
      return;
    }

    let x = x0;
    if (align === "center") {
      let width = 0;
      for (const ch of text) width += ctx.measureText(ch).width + tracking;
      width -= tracking;
      x = x0 - width / 2;
    }
    for (const ch of text) {
      ctx.fillText(ch, x, y0);
      x += ctx.measureText(ch).width + tracking;
    }
  };

  for (let rr = r0; rr < rN; rr++) {
    for (let cc = c0; cc < cN; cc++) {
      const cell = getCellRect(rr, cc);
      ctx.save();
      ctx.beginPath();
      ctx.rect(cell.x, cell.y, cell.w, cell.h);
      ctx.clip();
      drawText(tx, ty);
      ctx.restore();
    }
  }
  ctx.restore();
}

function fillCellsFromTextMask({
  ctx,
  text,
  region, // {x,y,w,h,r0,c0,rN,cN}
  getCellRect,
  fontFamily,
  fontScale,
  tracking,
  align,
  fillColor,
  threshold = 0.18,
  maskScale = 2,
}) {
  if (!text) return;

  const { x, y, w, h, r0, c0, rN, cN } = region;
  const sc = clamp(maskScale ?? 2, 1, 4);

  const mw = Math.max(1, Math.floor(w * sc));
  const mh = Math.max(1, Math.floor(h * sc));
  const m = document.createElement("canvas");
  m.width = mw;
  m.height = mh;
  const mctx = m.getContext("2d", { willReadFrequently: true });

  mctx.clearRect(0, 0, mw, mh);

  const fontPx = Math.max(8, Math.min(h, w) * 0.75 * (fontScale || 1));
  mctx.font = `700 ${fontPx * sc}px ${fontFamily}`;
  mctx.textBaseline = "middle";
  mctx.textAlign = "left";

  const padX = Math.max(6, w * 0.06);
  const tx = align === "center" ? w * 0.5 : padX;
  const ty = h * 0.5;

  const drawText = (x0, y0) => {
    if (!tracking) {
      if (align === "center") {
        mctx.textAlign = "center";
        mctx.fillText(text, x0 * sc, y0 * sc);
        mctx.textAlign = "left";
      } else {
        mctx.fillText(text, x0 * sc, y0 * sc);
      }
      return;
    }

    let x = x0;
    if (align === "center") {
      let width = 0;
      for (const ch of text) width += mctx.measureText(ch).width + tracking * sc;
      width -= tracking * sc;
      x = x0 - width / (2 * sc);
    }
    for (const ch of text) {
      mctx.fillText(ch, x * sc, y0 * sc);
      x += (mctx.measureText(ch).width + tracking * sc) / sc;
    }
  };

  mctx.fillStyle = "#000";
  drawText(tx, ty);

  const img = mctx.getImageData(0, 0, mw, mh).data;

  ctx.save();
  ctx.fillStyle = fillColor || "#000";

  for (let rr = r0; rr < rN; rr++) {
    for (let cc = c0; cc < cN; cc++) {
      const cell = getCellRect(rr, cc);

      const cx0 = Math.floor(((cell.x - x) / w) * mw);
      const cy0 = Math.floor(((cell.y - y) / h) * mh);
      const cx1 = Math.ceil(((cell.x + cell.w - x) / w) * mw);
      const cy1 = Math.ceil(((cell.y + cell.h - y) / h) * mh);

      const ax0 = clamp(cx0, 0, mw);
      const ay0 = clamp(cy0, 0, mh);
      const ax1 = clamp(cx1, 0, mw);
      const ay1 = clamp(cy1, 0, mh);

      const ww = Math.max(0, ax1 - ax0);
      const hh = Math.max(0, ay1 - ay0);
      if (ww === 0 || hh === 0) continue;

      const sx = Math.max(3, Math.floor(ww / 10));
      const sy = Math.max(3, Math.floor(hh / 10));

      let hits = 0;
      let total = 0;

      for (let yy = ay0; yy < ay1; yy += sy) {
        for (let xx = ax0; xx < ax1; xx += sx) {
          const i = (yy * mw + xx) * 4;
          const a = img[i + 3] / 255;
          const lum = (img[i] + img[i + 1] + img[i + 2]) / (3 * 255);
          const ink = a > 0 ? a : 1 - lum;
          if (ink > 0.2) hits++;
          total++;
        }
      }

      const coverage = total ? hits / total : 0;
      if (coverage >= threshold) {
        ctx.fillRect(cell.x, cell.y, cell.w, cell.h);
      }
    }
  }

  ctx.restore();
}

/* =========================
   MIDI + Scale helpers
========================= */
function midiToFreq(m) {
  return 440 * Math.pow(2, (m - 69) / 12);
}

const SCALES = {
  chromatic: [0, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11],
  major: [0, 2, 4, 5, 7, 9, 11],
  minor: [0, 2, 3, 5, 7, 8, 10],
  pentatonic: [0, 2, 4, 7, 9],
};

function quantizeToScale(midiNote, rootMidi, scaleName = "minor") {
  const scale = SCALES[scaleName] || SCALES.minor;
  const rel = midiNote - rootMidi;
  const oct = Math.floor(rel / 12);
  const within = ((rel % 12) + 12) % 12;

  // find closest degree
  let best = scale[0];
  let bestDist = Infinity;
  for (const deg of scale) {
    const d = Math.abs(deg - within);
    if (d < bestDist) {
      bestDist = d;
      best = deg;
    }
  }
  return rootMidi + oct * 12 + best;
}

/* =========================
   Audio voice + FX Bus
========================= */
function createSimpleVoice(ac) {
  const osc = ac.createOscillator();
  const filter = ac.createBiquadFilter();
  const gain = ac.createGain();

  osc.type = "sawtooth";
  filter.type = "lowpass";
  filter.Q.value = 0.7;
  filter.frequency.value = 1200;

  gain.gain.value = 0.0001;

  osc.connect(filter);
  filter.connect(gain);
  osc.start();

  return { osc, filter, gain };
}

function triggerVoice(ac, voice, { freq, vel, cutoffHz, decaySec }) {
  const now = ac.currentTime;
  const v = clamp(vel, 0.0001, 1);

  voice.osc.frequency.setValueAtTime(freq, now);
  voice.filter.frequency.setValueAtTime(clamp(cutoffHz, 80, 16000), now);

  voice.gain.gain.cancelScheduledValues(now);
  voice.gain.gain.setValueAtTime(Math.max(0.0001, v), now);
  voice.gain.gain.exponentialRampToValueAtTime(0.0001, now + clamp(decaySec, 0.02, 3.0));
}

// quick impulse for convolver reverb (no external libs)
function makeImpulse(ac, seconds = 1.8, decay = 2.2) {
  const rate = ac.sampleRate;
  const length = Math.max(1, Math.floor(rate * seconds));
  const impulse = ac.createBuffer(2, length, rate);

  for (let ch = 0; ch < 2; ch++) {
    const data = impulse.getChannelData(ch);
    for (let i = 0; i < length; i++) {
      const t = i / length;
      const amp = Math.pow(1 - t, decay);
      data[i] = (Math.random() * 2 - 1) * amp;
    }
  }
  return impulse;
}

function createFxBus(ac) {
  // input -> (dry)-> master
  //      -> (delay)-> delayWet -> master
  //      -> (reverb)-> reverbWet -> master
  const input = ac.createGain();
  const master = ac.createGain();

  const dry = ac.createGain();
  const wetDelay = ac.createGain();
  const wetVerb = ac.createGain();

  // Delay
  const delay = ac.createDelay(2.0);
  const fb = ac.createGain();
  const delayFilter = ac.createBiquadFilter();
  delayFilter.type = "lowpass";
  delayFilter.frequency.value = 7000;

  delay.delayTime.value = 0.25;
  fb.gain.value = 0.28;

  input.connect(delay);
  delay.connect(delayFilter);
  delayFilter.connect(fb);
  fb.connect(delay);

  delayFilter.connect(wetDelay);

  // Reverb
  const conv = ac.createConvolver();
  conv.buffer = makeImpulse(ac, 1.8, 2.2);
  input.connect(conv);
  conv.connect(wetVerb);

  // Dry
  input.connect(dry);

  // sums
  dry.connect(master);
  wetDelay.connect(master);
  wetVerb.connect(master);

  // defaults
  dry.gain.value = 0.9;
  wetDelay.gain.value = 0.15;
  wetVerb.gain.value = 0.18;
  master.gain.value = 0.9;

  master.connect(ac.destination);

  return {
    input,
    master,
    dry,
    wetDelay,
    wetVerb,
    delay,
    fb,
    delayFilter,
    conv,
    params: {
      setMaster: (v) => (master.gain.value = clamp(v, 0, 1.2)),
      setDelayTime: (v) => (delay.delayTime.value = clamp(v, 0.01, 1.5)),
      setDelayFb: (v) => (fb.gain.value = clamp(v, 0, 0.92)),
      setDelayWet: (v) => (wetDelay.gain.value = clamp(v, 0, 1)),
      setVerbWet: (v) => (wetVerb.gain.value = clamp(v, 0, 1)),
      setVerbSize: (sec) => {
        conv.buffer = makeImpulse(ac, clamp(sec, 0.4, 4.0), 2.2);
      },
      setDelayTone: (hz) => (delayFilter.frequency.value = clamp(hz, 800, 16000)),
    },
  };
}

/* =========================
   Scan patterns (both grids)
========================= */
function getIndicesForStep({
  mode,
  step,
  cols,
  rows,
  // lfo uses time
  t01 = 0,
}) {
  cols = Math.max(1, cols);
  rows = Math.max(1, rows);

  if (mode === "columns") {
    const c = step % cols;
    const out = [];
    for (let r = 0; r < rows; r++) out.push(r * cols + c);
    return out;
  }

  if (mode === "rows") {
    const r = step % rows;
    const out = [];
    for (let c = 0; c < cols; c++) out.push(r * cols + c);
    return out;
  }

  if (mode === "snake") {
    const c = step % cols;
    const out = [];
    const up = c % 2 === 1;
    if (!up) {
      for (let r = 0; r < rows; r++) out.push(r * cols + c);
    } else {
      for (let r = rows - 1; r >= 0; r--) out.push(r * cols + c);
    }
    return out;
  }

  if (mode === "perimeter") {
    // step walks along perimeter; returns one "ring column/row slice" per step
    const per = cols * 2 + rows * 2 - 4;
    const k = ((step % per) + per) % per;

    const out = [];
    // map k -> one index
    let x = 0,
      y = 0;
    if (k < cols) {
      x = k;
      y = 0;
    } else if (k < cols + rows - 1) {
      x = cols - 1;
      y = k - cols + 1;
    } else if (k < cols + rows - 1 + cols - 1) {
      x = cols - 1 - (k - (cols + rows - 1));
      y = rows - 1;
    } else {
      x = 0;
      y = rows - 1 - (k - (cols + rows - 1 + cols - 1));
    }
    out.push(y * cols + x);
    return out;
  }

  if (mode === "lfo") {
    // pick a column by sine sweep
    const c = Math.floor(((Math.sin(t01 * Math.PI * 2) + 1) * 0.5) * cols);
    const cc = clamp(c, 0, cols - 1);
    const out = [];
    for (let r = 0; r < rows; r++) out.push(r * cols + cc);
    return out;
  }

  // default: columns
  return getIndicesForStep({ mode: "columns", step, cols, rows, t01 });
}

/* =========================
   App
========================= */
export default function App() {
  const canvasRef = React.useRef(null);
  const animRef = React.useRef(null);

  // audio input (mic/file) analyser for visuals (optional)
  const audioCtxRef = React.useRef(null);
  const analyserRef = React.useRef(null);
  const audioElRef = React.useRef(null);
  const mediaElSrcRef = React.useRef(null);
  const micStreamRef = React.useRef(null);

  const smoothAudioRef = React.useRef(0);
  const smoothBassRef = React.useRef(0);
  const bpmRef = React.useRef({ bpm: null, smooth: null, lastUpdate: 0 });

  // MIDI
  const midiVelRef = React.useRef(0);
  const midiNoteRef = React.useRef(0);
  const midiCCRef = React.useRef({}); // cc -> 0..1

  // Painting + images
  const imgRef = React.useRef(null);
  const imgCanvasRef = React.useRef(null);
  const imgSeqRef = React.useRef(
    Array.from({ length: 5 }, () => ({ loaded: false, name: "", canvas: null }))
  );

  // Sequencer / synth + FX
  const synthCtxRef = React.useRef(null);
  const fxRef = React.useRef(null);
  const voicePoolRef = React.useRef([]);
  const voicePtrRef = React.useRef(0);
  const clockRef = React.useRef(null);
  const stepRef = React.useRef(0);

  // UI State
  const [panelOpen, setPanelOpen] = React.useState(false);

  const [audioOn, setAudioOn] = React.useState(false);
  const [audioMode, setAudioMode] = React.useState("mic");
  const [audioFileUrl, setAudioFileUrl] = React.useState("");
  const [audioFileName, setAudioFileName] = React.useState("");
  const [audioFilePlaying, setAudioFilePlaying] = React.useState(false);
  const [audioLvl, setAudioLvl] = React.useState(0);
  const [bassLvl, setBassLvl] = React.useState(0);

  const [midiOn, setMidiOn] = React.useState(false);
  const [midiDevs, setMidiDevs] = React.useState([]);
  const [audioDevs, setAudioDevs] = React.useState([]);
  const [selAudio, setSelAudio] = React.useState("");

  const [cells, setCells] = React.useState([]);
  const [menu, setMenu] = React.useState(null);
  const [drawing, setDrawing] = React.useState(false);

  const [imgSeqInfo, setImgSeqInfo] = React.useState(
    Array.from({ length: 5 }, () => ({ loaded: false, name: "" }))
  );
  const [imageInfo, setImageInfo] = React.useState({ loaded: false, name: "" });

  const [paint, setPaint] = React.useState({
    mode: "none", // none | color | sample | imgseq
    color: "#111111",
    useSeq: false,
  });

  const [s, setS] = React.useState({
    // PATTERNS kept: char-grid + swiss-grid
    pat: "swiss-grid",

    // char-grid
    space: 40,
    charSz: 24,
    charSpd: 2,

    // swiss-grid
    cols: 12,
    rows: 16,
    grid: true,

    // letters
    chars: "01",
    stagger: 0.08,
    strBehave: "wave", // cycle|wave|random

    // fonts
    googleFont: "Inter",
    customFont: null,

    // color string
    colorSeqOn: false,
    colorSeqBehave: "same",
    colorSeqSpeed: 1,
    colorSeq: ["#111111", "#ff0055", "#00c2ff", "#00ff88", "#ffe600"],
    fillAs: "background", // background | ink

    // image preview + string
    imgPreviewOn: false,
    imgPreviewAlpha: 0.15,
    imgSeqOn: false,
    imgSeqBehave: "same",
    imgSeqSpeed: 1,

    // variable grid density (Swiss)
    varColsOn: false,
    colFocus: 0.5,
    colStrength: 6,
    colSigma: 0.18,
    varRowsOn: false,
    rowFocus: 0.5,
    rowStrength: 6,
    rowSigma: 0.18,

    // span region
    spanOn: false,
    spanText: "TYPE",
    spanRow: 0,
    spanCol: 0,
    spanCols: 8,
    spanRows: 3,
    spanFontScale: 1.0,
    spanTracking: 0,
    spanAlign: "center",
    spanFillOn: true,
    spanFillColor: "#000000",
    spanFillThreshold: 0.18,
    spanMaskScale: 2,

    // drawing
    selEl: "char",
    draw: false,

    // global sensitivities (for visuals)
    audioSens: 3,
    midiSens: 2,

    // ===== SEQUENCER (BOTH GRIDS) =====
    soundOn: false,

    scanMode: "columns", // columns | rows | snake | perimeter | lfo
    bpmBase: 120,
    bpmAudioInfluence: 0.0, // 0..1 (optional)
    bpmMidiInfluence: 0.0, // 0..1 (optional)

    // pitch independent of grid size
    rootMidi: 48, // C3
    scale: "minor", // chromatic | major | minor | pentatonic
    rangeSemis: 24, // pitch spread from bottom->top
    rowPitchAmt: 1.0, // 0..1 (how much row affects pitch)
    colPitchAmt: 0.25, // 0..1 (how much column affects pitch)

    // density / intensity controls (separate from grid size)
    baseMaxNotes: 6,
    audioDensityAmt: 0.0, // 0..1
    midiDensityAmt: 0.0, // 0..1

    decay: 0.18,

    cutoffBase: 700,
    cutoffSpan: 7000,

    // FX
    master: 0.9,
    delayTime: 0.25,
    delayFb: 0.28,
    delayWet: 0.15,
    delayTone: 7000,
    verbWet: 0.18,
    verbSize: 1.8,

    // MIDI routing
    midiNoteToRoot: true,
    ccToFx: true, // CC1 -> verb, CC94 -> delay wet, CC74 -> cutoff tone, CC7 -> master
    ccToSpeed: true, // CC10 -> bpm
  });

  /* =========================
     Device enumeration
  ========================= */
  React.useEffect(() => {
    navigator.mediaDevices
      .enumerateDevices()
      .then((d) => {
        const a = d.filter((x) => x.kind === "audioinput");
        setAudioDevs(a);
        if (a.length > 0) setSelAudio(a[0].deviceId);
      })
      .catch(() => {});
  }, []);

  /* =========================
     MIDI
  ========================= */
  React.useEffect(() => {
    if (!midiOn) {
      midiVelRef.current = 0;
      midiNoteRef.current = 0;
      midiCCRef.current = {};
      return;
    }

    let active = true;
    navigator
      .requestMIDIAccess()
      .then((acc) => {
        if (!active) return;
        const devs = [];
        for (const inp of acc.inputs.values()) {
          devs.push(inp.name || "MIDI");
          inp.onmidimessage = (e) => {
            const [st, d1, d2] = e.data;
            const msg = st >> 4;
            const chan = st & 0x0f;

            // Note on/off
            if (msg === 9 && d2 > 0) {
              midiNoteRef.current = d1;
              midiVelRef.current = d2 / 127;
              if (s.midiNoteToRoot) {
                // snap root to nearest C? No: use exact note, more control.
                // rootMidi is the base; we set it directly from played note.
                // (You can quantize root if you want later.)
              }
            } else if (msg === 8 || (msg === 9 && d2 === 0)) {
              midiVelRef.current = 0;
            }

            // CC
            if (msg === 11) {
              const cc = d1;
              const v = (d2 ?? 0) / 127;
              midiCCRef.current = { ...midiCCRef.current, [cc]: v };

              // Optional mapping to FX / speed / cutoff
              if (s.ccToFx) {
                if (cc === 7) setS((p) => ({ ...p, master: clamp(v * 1.2, 0, 1.2) })); // Volume
                if (cc === 1 || cc === 91) setS((p) => ({ ...p, verbWet: clamp(v, 0, 1) })); // Mod / Reverb
                if (cc === 94) setS((p) => ({ ...p, delayWet: clamp(v, 0, 1) })); // Delay wet
                if (cc === 74) {
                  // "brightness" -> cutoff base
                  const base = 200 + v * 2000;
                  setS((p) => ({ ...p, cutoffBase: base }));
                }
              }
              if (s.ccToSpeed && cc === 10) {
                // Pan knob -> BPM (fun repurpose)
                const bpm = 40 + v * 180;
                setS((p) => ({ ...p, bpmBase: Math.round(bpm) }));
              }
            }
          };
        }
        setMidiDevs(devs);
      })
      .catch(() => {});

    return () => {
      active = false;
    };
  }, [midiOn, s.midiNoteToRoot, s.ccToFx, s.ccToSpeed]);

  /* =========================
     Audio input analyser (optional)
  ========================= */
  React.useEffect(() => {
    if (!audioOn) {
      try {
        if (audioElRef.current) {
          audioElRef.current.pause();
          setAudioFilePlaying(false);
        }
      } catch {}
      try {
        if (micStreamRef.current) micStreamRef.current.getTracks().forEach((t) => t.stop());
      } catch {}
      micStreamRef.current = null;

      try {
        if (mediaElSrcRef.current) mediaElSrcRef.current.disconnect();
      } catch {}
      mediaElSrcRef.current = null;

      try {
        if (audioCtxRef.current) audioCtxRef.current.close();
      } catch {}
      audioCtxRef.current = null;
      analyserRef.current = null;

      setAudioLvl(0);
      setBassLvl(0);
      smoothAudioRef.current = 0;
      smoothBassRef.current = 0;
      bpmRef.current = { bpm: null, smooth: null, lastUpdate: 0 };
      return;
    }

    let cancelled = false;

    const ensureAudioContext = () => {
      const ac = audioCtxRef.current || new (window.AudioContext || window.webkitAudioContext)();
      audioCtxRef.current = ac;
      if (ac.state === "suspended") ac.resume?.();
      const an = analyserRef.current || ac.createAnalyser();
      an.fftSize = 2048;
      analyserRef.current = an;
      return { ac, an };
    };

    const tick = () => {
      if (!analyserRef.current || !audioCtxRef.current) return;
      const an = analyserRef.current;

      const f = new Uint8Array(an.frequencyBinCount);
      an.getByteFrequencyData(f);
      const b = f.slice(0, 50).reduce((a, x) => a + x, 0) / 50 / 255;
      const o = f.reduce((a, x) => a + x, 0) / f.length / 255;

      smoothAudioRef.current += (o - smoothAudioRef.current) * 0.15;
      smoothBassRef.current += (b - smoothBassRef.current) * 0.15;
      setAudioLvl(smoothAudioRef.current);
      setBassLvl(smoothBassRef.current);

      const now = performance.now();
      if (now - bpmRef.current.lastUpdate > 700) {
        const td = new Float32Array(an.fftSize);
        an.getFloatTimeDomainData(td);
        const bpm = detectBpmFromFloatBuffer(td, audioCtxRef.current.sampleRate);
        if (bpm) {
          const prev = bpmRef.current.smooth ?? bpm;
          const sm = lerp(prev, bpm, 0.25);
          bpmRef.current = { bpm, smooth: sm, lastUpdate: now };
        } else {
          bpmRef.current.lastUpdate = now;
        }
      }

      requestAnimationFrame(tick);
    };

    const startMic = async () => {
      const { ac, an } = ensureAudioContext();
      const st = await navigator.mediaDevices.getUserMedia({
        audio: selAudio ? { deviceId: { exact: selAudio } } : true,
      });
      if (cancelled) return;
      micStreamRef.current = st;
      const src = ac.createMediaStreamSource(st);
      src.connect(an);
      tick();
    };

    const startFile = async () => {
      if (!audioFileUrl) {
        setAudioOn(false);
        return;
      }
      const { ac, an } = ensureAudioContext();

      if (!audioElRef.current) {
        const el = document.createElement("audio");
        el.crossOrigin = "anonymous";
        el.loop = true;
        el.preload = "auto";
        audioElRef.current = el;
      }

      const el = audioElRef.current;
      if (el.src !== audioFileUrl) el.src = audioFileUrl;

      if (!mediaElSrcRef.current) {
        mediaElSrcRef.current = ac.createMediaElementSource(el);
        mediaElSrcRef.current.connect(an);
        an.connect(ac.destination);
      }

      try {
        await el.play();
        setAudioFilePlaying(true);
      } catch {
        setAudioFilePlaying(false);
      }

      tick();
    };

    (async () => {
      try {
        if (audioMode === "file") await startFile();
        else await startMic();
      } catch {
        setAudioOn(false);
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [audioOn, selAudio, audioMode, audioFileUrl]);

  /* =========================
     Google font
  ========================= */
  React.useEffect(() => {
    if (!s.googleFont) return;
    const link = document.createElement("link");
    link.href = `https://fonts.googleapis.com/css2?family=${s.googleFont.replace(
      / /g,
      "+"
    )}:wght@400;600;700&display=swap`;
    link.rel = "stylesheet";
    document.head.appendChild(link);
    return () => document.head.removeChild(link);
  }, [s.googleFont]);

  const getFontFamily = () => {
    if (s.customFont) return s.customFont;
    if (s.googleFont) return `"${s.googleFont}", sans-serif`;
    return '-apple-system, "SF Pro Display", sans-serif';
  };

  /* =========================
     Palettes
  ========================= */
  const palette = React.useMemo(() => {
    const arr = Array.isArray(s.colorSeq) ? s.colorSeq : [];
    const fixed = arr.map((x) => (isHexColor(x) ? x : "#111111"));
    const five = fixed.slice(0, 5);
    while (five.length < 5) five.push("#111111");
    return five;
  }, [s.colorSeq]);

  const colorSeqIndex = React.useCallback(
    (st, r, c, len) => {
      if (len <= 1) return 0;
      const beh = s.colorSeqBehave === "same" ? s.strBehave : s.colorSeqBehave;
      const t = st * (s.colorSeqSpeed || 1);
      if (beh === "cycle") return (Math.floor(t * 3) + r + c) % len;
      if (beh === "wave") {
        const wv = Math.sin((c * 0.5 + r * 0.3 + t) * 0.8);
        return Math.floor((wv + 1) * 0.5 * len) % len;
      }
      const sd = r * 1000 + c + Math.floor(t * 2);
      return Math.floor((Math.sin(sd) * 0.5 + 0.5) * len);
    },
    [s.colorSeqBehave, s.strBehave, s.colorSeqSpeed]
  );

  const resolveInkColor = React.useCallback(
    ({ paintObj, globalOn, st, r, c }) => {
      const len = palette.length;
      if (paintObj?.mode === "color" && paintObj.color) return paintObj.color;
      if (paintObj?.mode === "seq") return palette[colorSeqIndex(st, r, c, len)];
      if (globalOn) return palette[colorSeqIndex(st, r, c, len)];
      return null;
    },
    [palette, colorSeqIndex]
  );

  const resolveFillColor = React.useCallback(
    ({ paintObj, st, r, c }) => {
      const len = palette.length;
      if (paintObj?.mode === "color" && paintObj.color) return paintObj.color;
      if (paintObj?.mode === "seq") return palette[colorSeqIndex(st, r, c, len)];
      return null;
    },
    [palette, colorSeqIndex]
  );

  /* =========================
     Image uploads
  ========================= */
  const handleImageUpload = (e) => {
    const file = e.target.files?.[0];
    if (!file) return;
    const reader = new FileReader();
    reader.onload = (ev) => {
      const img = new window.Image();
      img.onload = () => {
        imgRef.current = img;
        const off = document.createElement("canvas");
        off.width = img.width;
        off.height = img.height;
        const octx = off.getContext("2d");
        octx.drawImage(img, 0, 0);
        imgCanvasRef.current = off;
        setImageInfo({ loaded: true, name: file.name });
      };
      img.src = ev.target.result;
    };
    reader.readAsDataURL(file);
  };

  const handleImageSeqUpload = (slot, file) => {
    if (!file) return;
    const reader = new FileReader();
    reader.onload = (ev) => {
      const img = new window.Image();
      img.onload = () => {
        const off = document.createElement("canvas");
        off.width = img.width;
        off.height = img.height;
        const octx = off.getContext("2d");
        octx.drawImage(img, 0, 0);

        imgSeqRef.current = imgSeqRef.current.map((x, i) =>
          i === slot ? { loaded: true, name: file.name, canvas: off } : x
        );

        setImgSeqInfo((prev) => {
          const n = [...prev];
          n[slot] = { loaded: true, name: file.name };
          return n;
        });
      };
      img.src = ev.target.result;
    };
    reader.readAsDataURL(file);
  };

  const clearImageSeqSlot = (slot) => {
    imgSeqRef.current = imgSeqRef.current.map((x, i) =>
      i === slot ? { loaded: false, name: "", canvas: null } : x
    );
    setImgSeqInfo((prev) => {
      const n = [...prev];
      n[slot] = { loaded: false, name: "" };
      return n;
    });
  };

  const imageSeqReadyCount = React.useMemo(
    () => imgSeqInfo.filter((x) => x.loaded).length,
    [imgSeqInfo]
  );

  const imageSeqIndex = React.useCallback(
    (st, r, c) => {
      const beh = s.imgSeqBehave === "same" ? s.strBehave : s.imgSeqBehave;
      const t = st * (s.imgSeqSpeed || 1);
      if (beh === "cycle") return Math.floor(t * 3) + r + c;
      if (beh === "wave") {
        const wv = Math.sin((c * 0.5 + r * 0.3 + t) * 0.8);
        return Math.floor((wv + 1) * 2.5);
      }
      const sd = r * 1000 + c + Math.floor(t * 2);
      return Math.floor((Math.sin(sd) * 0.5 + 0.5) * 5);
    },
    [s.imgSeqBehave, s.strBehave, s.imgSeqSpeed]
  );

  const drawCoverCanvas = (ctx, srcCanvas, dx, dy, dw, dh) => {
    if (!srcCanvas) return;
    const sw = srcCanvas.width;
    const sh = srcCanvas.height;
    if (sw <= 0 || sh <= 0) return;

    const scale = Math.max(dw / sw, dh / sh);
    const cw = dw / scale;
    const ch = dh / scale;
    const sx = (sw - cw) / 2;
    const sy = (sh - ch) / 2;

    ctx.drawImage(srcCanvas, sx, sy, cw, ch, dx, dy, dw, dh);
  };

  const resolveFillImageCanvas = React.useCallback(
    ({ paintObj, globalOn, st, r, c }) => {
      const loaded = imgSeqRef.current.filter((x) => x.loaded && x.canvas);
      if (loaded.length === 0) return null;

      const pick = (k) => loaded[((k % loaded.length) + loaded.length) % loaded.length].canvas;

      if (paintObj?.mode === "imgseq") {
        const k = imageSeqIndex(st, r, c);
        return pick(k);
      }
      if (globalOn) {
        const k = imageSeqIndex(st, r, c);
        return pick(k);
      }
      return null;
    },
    [imageSeqIndex]
  );

  const sampleColorAtCanvasPoint = (cx, cy) => {
    const cv = canvasRef.current;
    const img = imgRef.current;
    const off = imgCanvasRef.current;
    if (!cv || !img || !off) return null;

    const cw = cv.width,
      ch = cv.height;
    const iw = img.width,
      ih = img.height;

    const scale = Math.max(cw / iw, ch / ih);
    const drawW = iw * scale;
    const drawH = ih * scale;
    const ox = (cw - drawW) / 2;
    const oy = (ch - drawH) / 2;

    const ix = Math.floor(((cx - ox) / scale) | 0);
    const iy = Math.floor(((cy - oy) / scale) | 0);

    const sx = clamp(ix, 0, iw - 1);
    const sy = clamp(iy, 0, ih - 1);

    const octx = off.getContext("2d", { willReadFrequently: true });
    const px = octx.getImageData(sx, sy, 1, 1).data;
    return hexFromRgb(px[0], px[1], px[2]);
  };

  /* =========================
     Cells: upsert/remove
  ========================= */
  const upsertCell = (idx, patch) => {
    setCells((prev) => {
      const ex = prev.findIndex((c) => c.idx === idx);
      const next = [...prev];
      if (ex >= 0) {
        const existing = next[ex];
        next[ex] = { ...existing, ...patch, type: patch.type ?? existing.type };
      } else {
        const type = patch.type ?? (patch.paint ? "paint" : s.selEl);
        next.push({ idx, type, ph: Math.random() * Math.PI * 2, ...patch });
      }
      return next;
    });
  };
  const removeCell = (idx) => setCells((prev) => prev.filter((c) => c.idx !== idx));

  /* =========================
     Pointer helpers
  ========================= */
  const pointerToCanvas = (e) => {
    const cv = canvasRef.current;
    const r = cv.getBoundingClientRect();
    const x = (e.clientX - r.left) * (cv.width / r.width);
    const y = (e.clientY - r.top) * (cv.height / r.height);
    return { x, y };
  };

  /* =========================
     Swiss grid edges + geometry
  ========================= */
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

  const swissCellGeom = (r, c, w, h) => {
    const ce = colEdges || Array.from({ length: s.cols + 1 }, (_, i) => i / s.cols);
    const re = rowEdges || Array.from({ length: s.rows + 1 }, (_, i) => i / s.rows);

    const x0 = ce[c] * w;
    const x1 = ce[c + 1] * w;
    const y0 = re[r] * h;
    const y1 = re[r + 1] * h;

    return {
      x: x0,
      y: y0,
      w: x1 - x0,
      h: y1 - y0,
      cx: (x0 + x1) / 2,
      cy: (y0 + y1) / 2,
    };
  };

  /* =========================
     Indexing (both grids)
  ========================= */
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

      return col >= 0 && col < s.cols && row >= 0 && row < s.rows ? row * s.cols + col : null;
    },
    [s.cols, s.rows, colEdges, rowEdges]
  );

  const getCharGridIdx = React.useCallback(
    (cx, cy) => {
      const cv = canvasRef.current;
      if (!cv) return null;
      const col = Math.floor(cx / s.space);
      const row = Math.floor(cy / s.space);
      const cols = Math.max(1, Math.floor(cv.width / s.space));
      const rows = Math.max(1, Math.floor(cv.height / s.space));
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

  /* =========================
     Paint apply
  ========================= */
  const applyPaintToIdx = (idx, cx, cy) => {
    if (idx == null) return;
    const useSeq = !!paint.useSeq;

    if (paint.mode === "color") {
      upsertCell(idx, { paint: useSeq ? { mode: "seq" } : { mode: "color", color: paint.color } });
      return;
    }

    if (paint.mode === "sample") {
      const c = sampleColorAtCanvasPoint(cx, cy);
      if (c) {
        setPaint((p) => ({ ...p, color: c, useSeq: false }));
        upsertCell(idx, { paint: { mode: "color", color: c } });
      }
      return;
    }

    if (paint.mode === "imgseq") {
      if (imageSeqReadyCount > 0) upsertCell(idx, { paint: { mode: "imgseq" } });
      return;
    }

    upsertCell(idx, { type: s.selEl, ph: Math.random() * Math.PI * 2 });
  };

  const openMenuAt = (clientX, clientY, idx) => {
    const pad = 12;
    const menuW = 220;
    const menuH = 210;
    const x = clamp(clientX, pad, window.innerWidth - menuW - pad);
    const y = clamp(clientY, pad, window.innerHeight - menuH - pad);
    setMenu({ x, y, idx });
  };

  const onPointerDown = (e) => {
    const interactive = s.pat === "swiss-grid" || s.pat === "char-grid";
    if (!interactive) return;

    try {
      e.currentTarget?.setPointerCapture?.(e.pointerId);
    } catch {}

    const { x, y } = pointerToCanvas(e);
    const idx = getIdx(x, y);
    if (idx === null) return;

    if (s.draw) {
      setDrawing(true);
      applyPaintToIdx(idx, x, y);
    } else {
      e.preventDefault?.();
      openMenuAt(e.clientX ?? 0, e.clientY ?? 0, idx);
    }
  };

  const onPointerMove = (e) => {
    if (!drawing) return;
    const interactive = s.pat === "swiss-grid" || s.pat === "char-grid";
    if (!interactive || !s.draw) return;

    const { x, y } = pointerToCanvas(e);
    const idx = getIdx(x, y);
    if (idx === null) return;
    applyPaintToIdx(idx, x, y);
  };

  const onPointerUp = () => setDrawing(false);

  React.useEffect(() => {
    const cl = () => setMenu(null);
    window.addEventListener("click", cl);
    window.addEventListener("touchstart", cl, { passive: true });
    return () => {
      window.removeEventListener("click", cl);
      window.removeEventListener("touchstart", cl);
    };
  }, []);

  const add = (tp) => {
    if (!menu) return;
    upsertCell(menu.idx, { type: tp, ph: Math.random() * Math.PI * 2 });
    setMenu(null);
  };
  const rem = () => {
    if (!menu) return;
    removeCell(menu.idx);
    setMenu(null);
  };

  /* =========================
     Resize canvas (IMPORTANT: no huge viewport)
  ========================= */
  React.useEffect(() => {
    const rsz = () => {
      const cv = canvasRef.current;
      if (!cv) return;
      const w = cv.offsetWidth;
      const h = cv.offsetHeight;
      // guard against 0
      cv.width = Math.max(2, Math.floor(w));
      cv.height = Math.max(2, Math.floor(h));
    };
    rsz();
    window.addEventListener("resize", rsz);
    window.addEventListener("orientationchange", rsz);
    return () => {
      window.removeEventListener("resize", rsz);
      window.removeEventListener("orientationchange", rsz);
    };
  }, []);

  React.useEffect(() => {
    const cv = canvasRef.current;
    if (!cv) return;
    cv.style.touchAction = "none";
  }, []);

  /* =========================
     Sequencer (BOTH grids)
     - not tied to grid size
     - scan columns/rows/snake/perimeter/lfo
     - density, FX, MIDI CC control
  ========================= */
  React.useEffect(() => {
    if (!s.soundOn) {
      if (clockRef.current) clearInterval(clockRef.current);
      clockRef.current = null;
      return;
    }

    if (!synthCtxRef.current) synthCtxRef.current = new (window.AudioContext || window.webkitAudioContext)();
    const ac = synthCtxRef.current;
    if (ac.state === "suspended") ac.resume?.();

    // FX bus
    if (!fxRef.current) fxRef.current = createFxBus(ac);
    const fx = fxRef.current;

    // keep FX params in sync
    fx.params.setMaster(s.master);
    fx.params.setDelayTime(s.delayTime);
    fx.params.setDelayFb(s.delayFb);
    fx.params.setDelayWet(s.delayWet);
    fx.params.setDelayTone(s.delayTone);
    fx.params.setVerbWet(s.verbWet);
    fx.params.setVerbSize(s.verbSize);

    // voices
    const wantVoices = 12;
    if (!voicePoolRef.current || voicePoolRef.current.length !== wantVoices) {
      // disconnect old
      try {
        voicePoolRef.current.forEach((v) => {
          try {
            v.gain.disconnect();
          } catch {}
        });
      } catch {}
      voicePoolRef.current = Array.from({ length: wantVoices }, () => {
        const v = createSimpleVoice(ac);
        v.gain.connect(fx.input);
        return v;
      });
      voicePtrRef.current = 0;
    }

    // build map of painted cells
    const map = new Map();
    for (const c of cells) map.set(c.idx, c);

    const getGridDims = () => {
      if (s.pat === "swiss-grid") return { cols: s.cols, rows: s.rows };
      // char-grid depends on canvas
      const cv = canvasRef.current;
      if (!cv) return { cols: 1, rows: 1 };
      const cols = Math.max(1, Math.floor(cv.width / s.space));
      const rows = Math.max(1, Math.floor(cv.height / s.space));
      return { cols, rows };
    };

    const computeBpm = () => {
      const aud = smoothAudioRef.current * s.audioSens;
      const mid = midiVelRef.current * s.midiSens;

      const bpmFromAudio = bpmRef.current.smooth ?? null;
      const audioBpmBlend = bpmFromAudio ? lerp(s.bpmBase, bpmFromAudio, clamp(s.bpmAudioInfluence, 0, 1)) : s.bpmBase;

      // optional midi influence: treat velocity as "push tempo"
      const midiBpm = s.bpmBase * (1 + clamp(mid, 0, 1) * 0.5);
      const afterMidi = lerp(audioBpmBlend, midiBpm, clamp(s.bpmMidiInfluence, 0, 1));

      return clamp(afterMidi, 30, 300);
    };

    const computeMaxNotes = () => {
      const aud = smoothAudioRef.current * s.audioSens;
      const mid = midiVelRef.current * s.midiSens;
      const density = clamp(
        (clamp(s.audioDensityAmt, 0, 1) * clamp(aud, 0, 1) +
          clamp(s.midiDensityAmt, 0, 1) * clamp(mid, 0, 1)),
        0,
        1
      );
      const base = clamp(s.baseMaxNotes ?? 6, 1, 32);
      return clamp(Math.round(base * (1 + density * 1.5)), 1, 32);
    };

    const stepOnce = () => {
      const { cols, rows } = getGridDims();
      const step = stepRef.current;

      // allow MIDI note -> root
      const liveRoot = s.midiNoteToRoot && midiNoteRef.current > 0 ? midiNoteRef.current : s.rootMidi;

      const maxNotes = computeMaxNotes();
      const t01 = (performance.now() * 0.0001) % 1;

      // pick indices for this step
      const indices = getIndicesForStep({
        mode: s.scanMode,
        step,
        cols,
        rows,
        t01,
      });

      // gather hits
      const hits = [];
      const st = step * 0.25;

      for (const idx of indices) {
        const cell = map.get(idx);
        if (!cell?.paint) continue;

        // derive row/col from idx under this grid's dims
        const r = Math.floor(idx / cols);
        const c = idx % cols;
        if (r < 0 || r >= rows || c < 0 || c >= cols) continue;

        // paint -> color
        let colHex = null;
        if (cell.paint.mode === "color") colHex = cell.paint.color;
        else if (cell.paint.mode === "seq") {
          const len = palette.length;
          const ci = colorSeqIndex(st, r, c, len);
          colHex = palette[ci];
        } else {
          // ignore imgseq for sound (keep it visual)
          continue;
        }
        const rgb = hexToRgb(colHex);
        if (!rgb) continue;
        const lum = luminance01(rgb); // 0..1

        // independent pitch mapping:
        // - row affects pitch strongly (bottom -> low)
        // - col affects pitch slightly (left->right)
        const rowNorm = rows <= 1 ? 0.5 : 1 - r / (rows - 1);
        const colNorm = cols <= 1 ? 0.5 : c / (cols - 1);

        const spread = clamp(s.rangeSemis ?? 24, 0, 60);
        const rowAmt = clamp(s.rowPitchAmt ?? 1, 0, 1);
        const colAmt = clamp(s.colPitchAmt ?? 0.25, 0, 1);

        const rawMidi =
          liveRoot +
          rowAmt * (rowNorm * spread) +
          colAmt * ((colNorm - 0.5) * spread * 0.5);

        const quantMidi = quantizeToScale(Math.round(rawMidi), liveRoot, s.scale);
        const freq = midiToFreq(clamp(quantMidi, 12, 120));

        // vel + cutoff from luminance + position
        const vel = clamp(0.08 + 0.92 * (0.55 * lum + 0.45 * rowNorm), 0.05, 1);

        const cutoff =
          (s.cutoffBase ?? 700) +
          (s.cutoffSpan ?? 7000) * clamp(0.15 + 0.85 * lum, 0, 1);

        hits.push({ freq, vel, cutoff });
      }

      // choose loudest
      hits.sort((a, b) => b.vel - a.vel);
      const chosen = hits.slice(0, maxNotes);

      // span accent (optional): if span is on, boost notes inside span region (swiss only)
      // NOTE: we do NOT “break” char-grid if span is enabled; it just won't boost there.
      const decay = clamp(s.decay ?? 0.18, 0.02, 2.5);

      for (const h of chosen) {
        const pool = voicePoolRef.current;
        const v = pool[voicePtrRef.current % pool.length];
        voicePtrRef.current++;
        triggerVoice(ac, v, { freq: h.freq, vel: h.vel, cutoffHz: h.cutoff, decaySec: decay });
      }

      stepRef.current++;
    };

    const restartClock = () => {
      if (clockRef.current) clearInterval(clockRef.current);
      const bpm = computeBpm();
      const stepMs = (60 / bpm) * 1000; // 1 step per beat (simple, musical)
      clockRef.current = setInterval(stepOnce, stepMs);
    };

    restartClock();

    // keep BPM reactive: refresh clock when key params change
    // (simple approach: restart each time effect runs)
    return () => {
      if (clockRef.current) clearInterval(clockRef.current);
      clockRef.current = null;
    };
  }, [
    s.soundOn,
    s.pat,
    s.cols,
    s.rows,
    s.space,
    cells,
    palette,
    colorSeqIndex,

    s.scanMode,
    s.bpmBase,
    s.bpmAudioInfluence,
    s.bpmMidiInfluence,

    s.rootMidi,
    s.midiNoteToRoot,
    s.scale,
    s.rangeSemis,
    s.rowPitchAmt,
    s.colPitchAmt,
    s.baseMaxNotes,
    s.audioDensityAmt,
    s.midiDensityAmt,
    s.decay,
    s.cutoffBase,
    s.cutoffSpan,

    s.master,
    s.delayTime,
    s.delayFb,
    s.delayWet,
    s.delayTone,
    s.verbWet,
    s.verbSize,

    s.audioSens,
    s.midiSens,
  ]);

  /* =========================
     Render (only char-grid + swiss-grid)
  ========================= */
  const render = (tm = 0) => {
    const cv = canvasRef.current;
    if (!cv) return;
    const ctx = cv.getContext("2d");
    const w = cv.width;
    const h = cv.height;

    ctx.fillStyle = "#FAFAFA";
    ctx.fillRect(0, 0, w, h);

    // for visual motion
    const stBase = tm * 0.001 * (s.charSpd || 1);

    const midi = midiVelRef.current * s.midiSens;
    const aud = smoothAudioRef.current * s.audioSens;
    const bass = smoothBassRef.current * s.audioSens;

    const cellByIdx = new Map();
    for (const c of cells) cellByIdx.set(c.idx, c);

    // --------- CHAR GRID ----------
    if (s.pat === "char-grid") {
      const cols = Math.max(1, Math.floor(w / s.space));
      const rows = Math.max(1, Math.floor(h / s.space));
      const chs = (s.chars || "").split("");

      ctx.font = `${s.charSz}px ${getFontFamily()}`;
      ctx.textAlign = "center";
      ctx.textBaseline = "middle";

      for (let r = 0; r < rows; r++) {
        for (let c = 0; c < cols; c++) {
          const idxLinear = r * cols + c;
          const x0 = c * s.space;
          const y0 = r * s.space;
          const cx = x0 + s.space / 2;
          const cy = y0 + s.space / 2;

          const st = stBase + (r + c) * s.stagger;
          const entry = cellByIdx.get(idxLinear);

          const fillCol = resolveFillColor({ paintObj: entry?.paint, st, r, c });
          const imgBg = resolveFillImageCanvas({
            paintObj: entry?.paint,
            globalOn: s.imgSeqOn,
            st,
            r,
            c,
          });

          if (imgBg) {
            ctx.save();
            ctx.globalAlpha = 1;
            ctx.imageSmoothingEnabled = true;
            drawCoverCanvas(ctx, imgBg, x0, y0, s.space, s.space);
            ctx.restore();
          }

          if (fillCol && s.fillAs === "background") {
            ctx.save();
            ctx.fillStyle = fillCol;
            ctx.globalAlpha = 0.9;
            ctx.fillRect(x0, y0, s.space, s.space);
            ctx.restore();
          }

          const inkOverride = resolveInkColor({
            paintObj: entry?.paint,
            globalOn: s.colorSeqOn,
            st,
            r,
            c,
          });

          let gi = 0;
          if (chs.length > 0) {
            if (s.strBehave === "cycle") gi = (Math.floor(st * 3) + r + c) % chs.length;
            else if (s.strBehave === "wave") {
              const wv = Math.sin((c * 0.5 + r * 0.3 + st) * 0.8);
              gi = Math.floor((wv + 1) * 0.5 * chs.length) % chs.length;
            } else {
              const sd = r * 1000 + c + Math.floor(st * 2);
              gi = Math.floor((Math.sin(sd) * 0.5 + 0.5) * chs.length);
            }
          }

          ctx.save();
          if (s.fillAs === "ink" && fillCol) ctx.fillStyle = fillCol;
          else if (inkOverride) ctx.fillStyle = inkOverride;
          else ctx.fillStyle = "#0A0A0A";

          const sc = 1 + clamp((bass + midi) * 0.25, 0, 0.5);
          ctx.translate(cx, cy);
          ctx.scale(sc, sc);
          if (chs.length > 0) ctx.fillText(chs[gi], 0, 0);
          ctx.restore();
        }
      }

      // SPAN (char-grid)
      if (s.spanOn && s.spanText?.length) {
        const r0 = clamp(s.spanRow, 0, rows - 1);
        const c0 = clamp(s.spanCol, 0, cols - 1);
        const spanCols = clamp(s.spanCols ?? 8, 1, cols - c0);
        const spanRows = clamp(s.spanRows ?? 1, 1, rows - r0);

        const rN = r0 + spanRows;
        const cN = c0 + spanCols;

        const rx = c0 * s.space;
        const ry = r0 * s.space;
        const rw = spanCols * s.space;
        const rh = spanRows * s.space;

        if (s.spanFillOn) {
          fillCellsFromTextMask({
            ctx,
            text: s.spanText,
            region: { x: rx, y: ry, w: rw, h: rh, r0, c0, rN, cN },
            getCellRect: (rr, cc) => ({ x: cc * s.space, y: rr * s.space, w: s.space, h: s.space }),
            fontFamily: getFontFamily(),
            fontScale: s.spanFontScale,
            tracking: s.spanTracking,
            align: s.spanAlign || "center",
            fillColor: s.spanFillColor || "#000",
            threshold: s.spanFillThreshold ?? 0.18,
            maskScale: s.spanMaskScale ?? 2,
          });
        } else {
          drawSpanTextChopped({
            ctx,
            text: s.spanText,
            region: { x: rx, y: ry, w: rw, h: rh, r0, c0, rN, cN },
            getCellRect: (rr, cc) => ({ x: cc * s.space, y: rr * s.space, w: s.space, h: s.space }),
            fontFamily: getFontFamily(),
            fontScale: s.spanFontScale,
            tracking: s.spanTracking,
            align: s.spanAlign || "center",
          });
        }
      }

      const showRef = (paint.mode === "sample" || s.imgPreviewOn) && imgRef.current;
      if (showRef) {
        const img = imgRef.current;
        const scale = Math.max(w / img.width, h / img.height);
        const dw = img.width * scale;
        const dh = img.height * scale;
        const ox = (w - dw) / 2;
        const oy = (h - dh) / 2;
        ctx.save();
        ctx.globalAlpha = s.imgPreviewAlpha ?? 0.15;
        ctx.drawImage(img, ox, oy, dw, dh);
        ctx.restore();
      }
      return;
    }

    // --------- SWISS GRID ----------
    if (s.pat === "swiss-grid") {
      if (s.grid) {
        ctx.strokeStyle = "#E5E5E5";
        ctx.lineWidth = 0.5;

        const ce = colEdges || Array.from({ length: s.cols + 1 }, (_, i) => i / s.cols);
        const re = rowEdges || Array.from({ length: s.rows + 1 }, (_, i) => i / s.rows);

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
      }

      const chs = (s.chars || "").split("");

      for (let r = 0; r < s.rows; r++) {
        for (let c = 0; c < s.cols; c++) {
          const idxLinear = r * s.cols + c;
          const entry = cellByIdx.get(idxLinear);

          const g = swissCellGeom(r, c, w, h);
          const st = stBase + (r + c) * s.stagger;

          const fillCol = resolveFillColor({ paintObj: entry?.paint, st, r, c });
          const imgBg = resolveFillImageCanvas({
            paintObj: entry?.paint,
            globalOn: s.imgSeqOn,
            st,
            r,
            c,
          });

          if (imgBg) {
            ctx.save();
            ctx.globalAlpha = 1;
            ctx.imageSmoothingEnabled = true;
            drawCoverCanvas(ctx, imgBg, g.x, g.y, g.w, g.h);
            ctx.restore();
          }

          if (fillCol && s.fillAs === "background") {
            ctx.save();
            ctx.fillStyle = fillCol;
            ctx.globalAlpha = 0.9;
            ctx.fillRect(g.x, g.y, g.w, g.h);
            ctx.restore();
          }

          const inkOverride = resolveInkColor({
            paintObj: entry?.paint,
            globalOn: s.colorSeqOn,
            st,
            r,
            c,
          });

          const baseSz = Math.min(g.w, g.h) * 0.55;
          ctx.font = `${baseSz}px ${getFontFamily()}`;
          ctx.textAlign = "center";
          ctx.textBaseline = "middle";

          let gi = 0;
          if (chs.length > 0) {
            if (s.strBehave === "cycle") gi = (Math.floor(st * 3) + r + c) % chs.length;
            else if (s.strBehave === "wave") {
              const wv = Math.sin((c * 0.5 + r * 0.3 + st) * 0.8);
              gi = Math.floor((wv + 1) * 0.5 * chs.length) % chs.length;
            } else {
              const sd = r * 1000 + c + Math.floor(st * 2);
              gi = Math.floor((Math.sin(sd) * 0.5 + 0.5) * chs.length);
            }
          }

          ctx.save();
          if (s.fillAs === "ink" && fillCol) ctx.fillStyle = fillCol;
          else if (inkOverride) ctx.fillStyle = inkOverride;
          else ctx.fillStyle = "#0A0A0A";

          const sc = 1 + clamp((bass + midi) * 0.25, 0, 0.5);
          ctx.translate(g.cx, g.cy);
          ctx.scale(sc, sc);

          if (chs.length > 0) ctx.fillText(chs[gi], 0, 0);
          ctx.restore();
        }
      }

      // SPAN (swiss)
      if (s.spanOn && s.spanText?.length) {
        const r0 = clamp(s.spanRow, 0, s.rows - 1);
        const c0 = clamp(s.spanCol, 0, s.cols - 1);
        const spanCols = clamp(s.spanCols ?? 8, 1, s.cols - c0);
        const spanRows = clamp(s.spanRows ?? 1, 1, s.rows - r0);

        const rN = r0 + spanRows;
        const cN = c0 + spanCols;

        const g00 = swissCellGeom(r0, c0, w, h);
        const g11 = swissCellGeom(rN - 1, cN - 1, w, h);

        const rx = g00.x;
        const ry = g00.y;
        const rw = g11.x + g11.w - g00.x;
        const rh = g11.y + g11.h - g00.y;

        if (s.spanFillOn) {
          fillCellsFromTextMask({
            ctx,
            text: s.spanText,
            region: { x: rx, y: ry, w: rw, h: rh, r0, c0, rN, cN },
            getCellRect: (rr, cc) => swissCellGeom(rr, cc, w, h),
            fontFamily: getFontFamily(),
            fontScale: s.spanFontScale,
            tracking: s.spanTracking,
            align: s.spanAlign || "center",
            fillColor: s.spanFillColor || "#000",
            threshold: s.spanFillThreshold ?? 0.18,
            maskScale: s.spanMaskScale ?? 2,
          });
        } else {
          drawSpanTextChopped({
            ctx,
            text: s.spanText,
            region: { x: rx, y: ry, w: rw, h: rh, r0, c0, rN, cN },
            getCellRect: (rr, cc) => swissCellGeom(rr, cc, w, h),
            fontFamily: getFontFamily(),
            fontScale: s.spanFontScale,
            tracking: s.spanTracking,
            align: s.spanAlign || "center",
          });
        }
      }

      const showRef = (paint.mode === "sample" || s.imgPreviewOn) && imgRef.current;
      if (showRef) {
        const img = imgRef.current;
        const scale = Math.max(w / img.width, h / img.height);
        const dw = img.width * scale;
        const dh = img.height * scale;
        const ox = (w - dw) / 2;
        const oy = (h - dh) / 2;
        ctx.save();
        ctx.globalAlpha = s.imgPreviewAlpha ?? 0.15;
        ctx.drawImage(img, ox, oy, dw, dh);
        ctx.restore();
      }
      return;
    }
  };

  React.useEffect(() => {
    const loop = (t) => {
      render(t);
      animRef.current = requestAnimationFrame(loop);
    };
    animRef.current = requestAnimationFrame(loop);
    return () => cancelAnimationFrame(animRef.current);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [s, cells, paint, colEdges, rowEdges, audioOn]);

  /* =========================
     Misc UI actions
  ========================= */
  const gen = () => setCells((prev) => prev.map((c) => ({ ...c, ph: Math.random() * Math.PI * 2 })));

  const handleFontUpload = (e) => {
    const file = e.target.files?.[0];
    if (!file) return;
    const reader = new FileReader();
    reader.onload = (ev) => {
      const fontFace = new FontFace("CustomFont", `url(${ev.target.result})`);
      fontFace.load().then((loaded) => {
        document.fonts.add(loaded);
        setS((p) => ({ ...p, customFont: "CustomFont" }));
      });
    };
    reader.readAsDataURL(file);
  };

  const interactive = s.pat === "swiss-grid" || s.pat === "char-grid";
  const bpmDisplay = bpmRef.current.smooth;

  return (
    <div className="w-full h-[100svh] overflow-hidden bg-white flex flex-col md:flex-row">
      {panelOpen && (
        <div
          className="fixed inset-0 bg-black/30 z-30 md:hidden"
          onClick={() => setPanelOpen(false)}
        />
      )}

      {/* LEFT PANEL */}
      <div
        className={
          "fixed md:static z-40 md:z-auto inset-y-0 left-0 w-80 max-w-[90vw] bg-neutral-50 border-r border-neutral-200 p-4 md:p-5 overflow-y-auto space-y-4 text-sm transform transition-transform duration-200 md:transform-none " +
          (panelOpen ? "translate-x-0" : "-translate-x-full md:translate-x-0")
        }
      >
        <div className="flex gap-2">
          <button
            onClick={gen}
            className="flex-1 flex justify-center px-4 py-2.5 bg-black text-white rounded-lg font-medium hover:bg-neutral-800 min-h-[44px]"
            title="Re-seed phases"
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
            className="flex-1 flex justify-center px-4 py-2.5 bg-black text-white rounded-lg font-medium hover:bg-neutral-800 min-h-[44px]"
            title="Download PNG"
          >
            <Download size={16} />
          </button>
        </div>

        {/* Pattern */}
        <div className="space-y-2">
          <label className="block text-xs font-semibold uppercase tracking-wider">Pattern</label>
          <select
            value={s.pat}
            onChange={(e) => setS((p) => ({ ...p, pat: e.target.value }))}
            className="w-full px-3 py-2 bg-white border border-neutral-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-black"
          >
            <option value="char-grid">Character Grid</option>
            <option value="swiss-grid">Swiss Grid</option>
          </select>
        </div>

        {/* ===== GRID SOUND (BOTH) ===== */}
        <div className="space-y-2">
          <div className="flex items-center justify-between">
            <label className="text-xs font-semibold uppercase tracking-wider">Grid Sound</label>
            <button
              onClick={() => setS((p) => ({ ...p, soundOn: !p.soundOn }))}
              className={`p-1.5 rounded ${s.soundOn ? "bg-black text-white" : "bg-neutral-200"}`}
              title="Turn grid sound on/off"
            >
              {s.soundOn ? <Play size={14} fill="white" /> : <Square size={14} />}
            </button>
          </div>

          <label className="block text-xs font-semibold uppercase tracking-wider">
            Scan Mode
          </label>
          <select
            value={s.scanMode}
            onChange={(e) => setS((p) => ({ ...p, scanMode: e.target.value }))}
            className="w-full px-3 py-2 bg-white border border-neutral-300 rounded-lg text-xs"
          >
            <option value="columns">Columns</option>
            <option value="rows">Rows</option>
            <option value="snake">Snake</option>
            <option value="perimeter">Perimeter</option>
            <option value="lfo">LFO Sweep</option>
          </select>

          <label className="block text-xs font-semibold uppercase tracking-wider">
            BPM: {s.bpmBase}
          </label>
          <input
            type="range"
            min="40"
            max="220"
            value={s.bpmBase}
            onChange={(e) => setS((p) => ({ ...p, bpmBase: parseInt(e.target.value) }))}
            className="w-full"
          />

          <div className="grid grid-cols-2 gap-2">
            <div className="space-y-1">
              <div className="text-[11px] font-semibold uppercase tracking-wider text-neutral-700">
                Audio BPM mix
              </div>
              <input
                type="range"
                min="0"
                max="1"
                step="0.01"
                value={s.bpmAudioInfluence}
                onChange={(e) => setS((p) => ({ ...p, bpmAudioInfluence: parseFloat(e.target.value) }))}
                className="w-full"
              />
              <div className="text-[10px] text-neutral-600">
                Detected: {bpmDisplay ? bpmDisplay.toFixed(1) : "—"}
              </div>
            </div>
            <div className="space-y-1">
              <div className="text-[11px] font-semibold uppercase tracking-wider text-neutral-700">
                MIDI Speed mix
              </div>
              <input
                type="range"
                min="0"
                max="1"
                step="0.01"
                value={s.bpmMidiInfluence}
                onChange={(e) => setS((p) => ({ ...p, bpmMidiInfluence: parseFloat(e.target.value) }))}
                className="w-full"
              />
              <div className="text-[10px] text-neutral-600">uses velocity</div>
            </div>
          </div>

          <label className="block text-xs font-semibold uppercase tracking-wider">
            Decay: {s.decay.toFixed(2)}s
          </label>
          <input
            type="range"
            min="0.03"
            max="1.5"
            step="0.01"
            value={s.decay}
            onChange={(e) => setS((p) => ({ ...p, decay: parseFloat(e.target.value) }))}
            className="w-full"
          />

          <label className="block text-xs font-semibold uppercase tracking-wider">
            Root Note (MIDI): {s.rootMidi}
          </label>
          <input
            type="range"
            min="24"
            max="84"
            value={s.rootMidi}
            onChange={(e) => setS((p) => ({ ...p, rootMidi: parseInt(e.target.value) }))}
            className="w-full"
          />

          <label className="block text-xs font-semibold uppercase tracking-wider">Scale</label>
          <select
            value={s.scale}
            onChange={(e) => setS((p) => ({ ...p, scale: e.target.value }))}
            className="w-full px-3 py-2 bg-white border border-neutral-300 rounded-lg text-xs"
          >
            <option value="chromatic">Chromatic</option>
            <option value="major">Major</option>
            <option value="minor">Minor</option>
            <option value="pentatonic">Pentatonic</option>
          </select>

          <label className="block text-xs font-semibold uppercase tracking-wider">
            Pitch Range: {s.rangeSemis} semis
          </label>
          <input
            type="range"
            min="0"
            max="48"
            value={s.rangeSemis}
            onChange={(e) => setS((p) => ({ ...p, rangeSemis: parseInt(e.target.value) }))}
            className="w-full"
          />

          <div className="grid grid-cols-2 gap-2">
            <div className="space-y-1">
              <div className="text-[11px] font-semibold uppercase tracking-wider text-neutral-700">
                Row → Pitch
              </div>
              <input
                type="range"
                min="0"
                max="1"
                step="0.01"
                value={s.rowPitchAmt}
                onChange={(e) => setS((p) => ({ ...p, rowPitchAmt: parseFloat(e.target.value) }))}
                className="w-full"
              />
            </div>
            <div className="space-y-1">
              <div className="text-[11px] font-semibold uppercase tracking-wider text-neutral-700">
                Col → Pitch
              </div>
              <input
                type="range"
                min="0"
                max="1"
                step="0.01"
                value={s.colPitchAmt}
                onChange={(e) => setS((p) => ({ ...p, colPitchAmt: parseFloat(e.target.value) }))}
                className="w-full"
              />
            </div>
          </div>

          <label className="block text-xs font-semibold uppercase tracking-wider">
            Max Notes / Step: {s.baseMaxNotes}
          </label>
          <input
            type="range"
            min="1"
            max="16"
            value={s.baseMaxNotes}
            onChange={(e) => setS((p) => ({ ...p, baseMaxNotes: parseInt(e.target.value) }))}
            className="w-full"
          />

          <div className="grid grid-cols-2 gap-2">
            <div className="space-y-1">
              <div className="text-[11px] font-semibold uppercase tracking-wider text-neutral-700">
                Audio Density
              </div>
              <input
                type="range"
                min="0"
                max="1"
                step="0.01"
                value={s.audioDensityAmt}
                onChange={(e) => setS((p) => ({ ...p, audioDensityAmt: parseFloat(e.target.value) }))}
                className="w-full"
              />
            </div>
            <div className="space-y-1">
              <div className="text-[11px] font-semibold uppercase tracking-wider text-neutral-700">
                MIDI Density
              </div>
              <input
                type="range"
                min="0"
                max="1"
                step="0.01"
                value={s.midiDensityAmt}
                onChange={(e) => setS((p) => ({ ...p, midiDensityAmt: parseFloat(e.target.value) }))}
                className="w-full"
              />
            </div>
          </div>

          {/* FX */}
          <div className="rounded-lg border border-neutral-200 bg-white p-3 space-y-2">
            <div className="text-xs font-semibold uppercase tracking-wider">FX</div>

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

            <label className="block text-xs font-semibold uppercase tracking-wider">
              Reverb Wet: {s.verbWet.toFixed(2)}
            </label>
            <input
              type="range"
              min="0"
              max="1"
              step="0.01"
              value={s.verbWet}
              onChange={(e) => setS((p) => ({ ...p, verbWet: parseFloat(e.target.value) }))}
              className="w-full"
            />

            <label className="block text-xs font-semibold uppercase tracking-wider">
              Reverb Size: {s.verbSize.toFixed(2)}s
            </label>
            <input
              type="range"
              min="0.4"
              max="4"
              step="0.01"
              value={s.verbSize}
              onChange={(e) => setS((p) => ({ ...p, verbSize: parseFloat(e.target.value) }))}
              className="w-full"
            />

            <label className="block text-xs font-semibold uppercase tracking-wider">
              Delay Wet: {s.delayWet.toFixed(2)}
            </label>
            <input
              type="range"
              min="0"
              max="1"
              step="0.01"
              value={s.delayWet}
              onChange={(e) => setS((p) => ({ ...p, delayWet: parseFloat(e.target.value) }))}
              className="w-full"
            />

            <label className="block text-xs font-semibold uppercase tracking-wider">
              Delay Time: {s.delayTime.toFixed(2)}s
            </label>
            <input
              type="range"
              min="0.01"
              max="1.5"
              step="0.01"
              value={s.delayTime}
              onChange={(e) => setS((p) => ({ ...p, delayTime: parseFloat(e.target.value) }))}
              className="w-full"
            />

            <label className="block text-xs font-semibold uppercase tracking-wider">
              Feedback: {s.delayFb.toFixed(2)}
            </label>
            <input
              type="range"
              min="0"
              max="0.92"
              step="0.01"
              value={s.delayFb}
              onChange={(e) => setS((p) => ({ ...p, delayFb: parseFloat(e.target.value) }))}
              className="w-full"
            />

            <label className="block text-xs font-semibold uppercase tracking-wider">
              Delay Tone: {Math.round(s.delayTone)} Hz
            </label>
            <input
              type="range"
              min="800"
              max="16000"
              step="10"
              value={s.delayTone}
              onChange={(e) => setS((p) => ({ ...p, delayTone: parseFloat(e.target.value) }))}
              className="w-full"
            />
          </div>

          {/* MIDI routing */}
          <div className="rounded-lg border border-neutral-200 bg-white p-3 space-y-2">
            <div className="text-xs font-semibold uppercase tracking-wider">MIDI Routing</div>

            <div className="flex items-center justify-between">
              <div className="text-xs text-neutral-700">Note → Root</div>
              <button
                onClick={() => setS((p) => ({ ...p, midiNoteToRoot: !p.midiNoteToRoot }))}
                className={`p-1.5 rounded ${s.midiNoteToRoot ? "bg-black text-white" : "bg-neutral-200"}`}
              >
                {s.midiNoteToRoot ? <Play size={14} fill="white" /> : <Square size={14} />}
              </button>
            </div>

            <div className="flex items-center justify-between">
              <div className="text-xs text-neutral-700">CC → FX</div>
              <button
                onClick={() => setS((p) => ({ ...p, ccToFx: !p.ccToFx }))}
                className={`p-1.5 rounded ${s.ccToFx ? "bg-black text-white" : "bg-neutral-200"}`}
              >
                {s.ccToFx ? <Play size={14} fill="white" /> : <Square size={14} />}
              </button>
            </div>

            <div className="text-[11px] text-neutral-600">
              CC7=Master, CC1/91=Reverb, CC94=Delay wet, CC74=Cutoff base
            </div>

            <div className="flex items-center justify-between">
              <div className="text-xs text-neutral-700">CC10 → BPM</div>
              <button
                onClick={() => setS((p) => ({ ...p, ccToSpeed: !p.ccToSpeed }))}
                className={`p-1.5 rounded ${s.ccToSpeed ? "bg-black text-white" : "bg-neutral-200"}`}
              >
                {s.ccToSpeed ? <Play size={14} fill="white" /> : <Square size={14} />}
              </button>
            </div>
          </div>
        </div>

        {/* Audio input (optional visuals + bpm detect) */}
        <div className="space-y-2">
          <div className="flex items-center justify-between">
            <label className="text-xs font-semibold uppercase tracking-wider">Audio Input</label>
            <button
              onClick={() => setAudioOn(!audioOn)}
              className={`p-1.5 rounded ${audioOn ? "bg-black text-white" : "bg-neutral-200"}`}
            >
              {audioOn ? <Play size={14} fill="white" /> : <Square size={14} />}
            </button>
          </div>

          <select
            value={audioMode}
            onChange={(e) => setAudioMode(e.target.value)}
            className="w-full px-3 py-2 bg-white border border-neutral-300 rounded-lg text-xs"
          >
            <option value="mic">Microphone</option>
            <option value="file">Audio File</option>
          </select>

          {audioMode === "mic" && audioDevs.length > 0 && (
            <select
              value={selAudio}
              onChange={(e) => setSelAudio(e.target.value)}
              className="w-full px-3 py-2 bg-white border border-neutral-300 rounded-lg text-xs"
            >
              {audioDevs.map((d) => (
                <option key={d.deviceId} value={d.deviceId}>
                  {d.label || `Device ${d.deviceId.slice(0, 8)}`}
                </option>
              ))}
            </select>
          )}

          {audioMode === "file" && (
            <div className="space-y-2">
              <div className="flex items-center justify-between">
                <div className="text-xs text-neutral-700">{audioFileName || "No file selected"}</div>
                <button
                  onClick={async () => {
                    const el = audioElRef.current;
                    if (!el) return;
                    try {
                      if (audioFilePlaying) {
                        el.pause();
                        setAudioFilePlaying(false);
                      } else {
                        await el.play();
                        setAudioFilePlaying(true);
                      }
                    } catch {
                      setAudioFilePlaying(false);
                    }
                  }}
                  className={`px-3 py-2 rounded-lg text-xs font-semibold min-h-[36px] ${
                    audioFileUrl ? "bg-black text-white" : "bg-neutral-200 text-neutral-500"
                  }`}
                  disabled={!audioFileUrl}
                >
                  {audioFilePlaying ? "Pause" : "Play"}
                </button>
              </div>

              <input
                type="file"
                accept="audio/*"
                className="w-full text-xs"
                onChange={(e) => {
                  const f = e.target.files?.[0];
                  if (!f) return;
                  if (audioFileUrl) URL.revokeObjectURL(audioFileUrl);
                  const url = URL.createObjectURL(f);
                  setAudioFileUrl(url);
                  setAudioFileName(f.name);
                }}
              />
            </div>
          )}

          {audioOn && (
            <div className="space-y-1.5">
              <div className="h-1 bg-neutral-200 rounded-full">
                <div className="h-full bg-black transition-all" style={{ width: `${audioLvl * 100}%` }} />
              </div>
              <div className="h-1 bg-neutral-200 rounded-full">
                <div
                  className="h-full bg-neutral-600 transition-all"
                  style={{ width: `${bassLvl * 100}%` }}
                />
              </div>
            </div>
          )}
        </div>

        {/* MIDI */}
        <div className="space-y-2">
          <div className="flex items-center justify-between">
            <label className="text-xs font-semibold uppercase tracking-wider">MIDI</label>
            <button
              onClick={() => setMidiOn(!midiOn)}
              className={`p-1.5 rounded ${midiOn ? "bg-black text-white" : "bg-neutral-200"}`}
            >
              {midiOn ? <Play size={14} fill="white" /> : <Square size={14} />}
            </button>
          </div>
          {midiOn && midiDevs.length > 0 && (
            <div className="text-xs text-neutral-600">{midiDevs.length} device(s)</div>
          )}
        </div>

        {/* Paint + Image */}
        {interactive && (
          <div className="space-y-2">
            <label className="block text-xs font-semibold uppercase tracking-wider">
              Cell Color / Image
            </label>

            <div className="flex items-center gap-2">
              <button
                onClick={() => setPaint((p) => ({ ...p, mode: p.mode === "color" ? "none" : "color" }))}
                className={`flex-1 px-3 py-2 rounded-lg border text-xs font-medium flex items-center justify-center gap-2 min-h-[44px] ${
                  paint.mode === "color"
                    ? "bg-black text-white border-black"
                    : "bg-white border-neutral-300"
                }`}
              >
                <Wand2 size={14} />
                Paint
              </button>
              <button
                onClick={() =>
                  setPaint((p) => ({
                    ...p,
                    mode: p.mode === "sample" ? "none" : "sample",
                    useSeq: false,
                  }))
                }
                className={`flex-1 px-3 py-2 rounded-lg border text-xs font-medium flex items-center justify-center gap-2 min-h-[44px] ${
                  paint.mode === "sample"
                    ? "bg-black text-white border-black"
                    : "bg-white border-neutral-300"
                }`}
                disabled={!imageInfo.loaded}
              >
                <ImageIcon size={14} />
                Sample
              </button>
            </div>

            <div className="flex items-center justify-between gap-2">
              <input
                type="color"
                value={paint.color}
                onChange={(e) => setPaint((p) => ({ ...p, color: e.target.value, useSeq: false }))}
                className="h-10 w-14 rounded-md border border-neutral-300 bg-white"
              />
              <div className="flex-1">
                <div className="text-xs text-neutral-600">Paint</div>
                <div className="font-mono text-xs">{paint.useSeq ? "(color string)" : paint.color}</div>
              </div>
              <select
                value={s.fillAs}
                onChange={(e) => setS((p) => ({ ...p, fillAs: e.target.value }))}
                className="px-2 py-2 bg-white border border-neutral-300 rounded-lg text-xs"
              >
                <option value="background">Background</option>
                <option value="ink">Ink</option>
              </select>
            </div>

            <button
              onClick={() => setPaint((p) => ({ ...p, useSeq: !p.useSeq, mode: "color" }))}
              className={`w-full px-3 py-2 rounded-lg border text-xs font-semibold flex items-center justify-center gap-2 min-h-[44px] ${
                paint.useSeq ? "bg-black text-white border-black" : "bg-white border-neutral-300"
              }`}
            >
              <Palette size={14} />
              Paint with Color String
            </button>

            <div className="space-y-1">
              <div className="flex items-center justify-between">
                <div className="text-xs text-neutral-700 font-medium flex items-center gap-2">
                  <ImageIcon size={14} /> Upload image
                </div>
                {imageInfo.loaded && (
                  <div className="text-[10px] text-green-700">✓ {imageInfo.name}</div>
                )}
              </div>
              <input type="file" accept="image/*" onChange={handleImageUpload} className="w-full text-xs" />

              <div className="mt-2 space-y-2">
                <div className="flex items-center justify-between">
                  <label className="text-xs font-semibold uppercase tracking-wider">Image Preview</label>
                  <button
                    onClick={() => setS((p) => ({ ...p, imgPreviewOn: !p.imgPreviewOn }))}
                    className={`p-1.5 rounded ${s.imgPreviewOn ? "bg-black text-white" : "bg-neutral-200"}`}
                  >
                    {s.imgPreviewOn ? <Play size={14} fill="white" /> : <Square size={14} />}
                  </button>
                </div>
                <label className="block text-xs font-semibold uppercase tracking-wider">
                  Opacity: {Math.round((s.imgPreviewAlpha ?? 0.15) * 100)}%
                </label>
                <input
                  type="range"
                  min="0"
                  max="0.6"
                  step="0.01"
                  value={s.imgPreviewAlpha ?? 0.15}
                  onChange={(e) => setS((p) => ({ ...p, imgPreviewAlpha: parseFloat(e.target.value) }))}
                  className="w-full"
                />
              </div>
            </div>

            {/* Image String */}
            <div className="space-y-2">
              <div className="flex items-center justify-between">
                <label className="text-xs font-semibold uppercase tracking-wider flex items-center gap-2">
                  <ImageIcon size={14} /> Image String
                </label>
                <button
                  onClick={() => setS((p) => ({ ...p, imgSeqOn: !p.imgSeqOn }))}
                  className={`p-1.5 rounded ${s.imgSeqOn ? "bg-black text-white" : "bg-neutral-200"}`}
                  disabled={imageSeqReadyCount === 0}
                >
                  {s.imgSeqOn ? <Play size={14} fill="white" /> : <Square size={14} />}
                </button>
              </div>

              <div className="grid grid-cols-5 gap-2">
                {imgSeqInfo.map((slot, i) => (
                  <div key={i} className="space-y-1">
                    <div className="h-9 w-full rounded-md border border-neutral-300 bg-white flex items-center justify-center">
                      <span className={`text-[10px] ${slot.loaded ? "text-green-700" : "text-neutral-500"}`}>
                        {slot.loaded ? "✓" : i + 1}
                      </span>
                    </div>
                    <input
                      type="file"
                      accept="image/*"
                      onChange={(e) => handleImageSeqUpload(i, e.target.files?.[0])}
                      className="w-full text-[10px]"
                    />
                    {slot.loaded && (
                      <button
                        onClick={() => clearImageSeqSlot(i)}
                        className="w-full text-[10px] text-red-600 hover:underline"
                      >
                        remove
                      </button>
                    )}
                  </div>
                ))}
              </div>

              <div className="grid grid-cols-2 gap-2">
                <div className="space-y-1">
                  <div className="text-xs text-neutral-600">Behavior</div>
                  <select
                    value={s.imgSeqBehave}
                    onChange={(e) => setS((p) => ({ ...p, imgSeqBehave: e.target.value }))}
                    className="w-full px-2 py-2 bg-white border border-neutral-300 rounded-lg text-xs"
                  >
                    <option value="same">Same as letters</option>
                    <option value="cycle">Cycle</option>
                    <option value="wave">Wave</option>
                    <option value="random">Random</option>
                  </select>
                </div>
                <div className="space-y-1">
                  <div className="text-xs text-neutral-600">Speed</div>
                  <input
                    type="range"
                    min="0"
                    max="4"
                    step="0.05"
                    value={s.imgSeqSpeed}
                    onChange={(e) => setS((p) => ({ ...p, imgSeqSpeed: parseFloat(e.target.value) }))}
                    className="w-full"
                  />
                </div>
              </div>

              <button
                onClick={() =>
                  setPaint((p) => ({ ...p, mode: p.mode === "imgseq" ? "none" : "imgseq", useSeq: false }))
                }
                className={`w-full px-3 py-2 rounded-lg border text-xs font-semibold flex items-center justify-center gap-2 min-h-[44px] ${
                  paint.mode === "imgseq" ? "bg-black text-white border-black" : "bg-white border-neutral-300"
                }`}
                disabled={imageSeqReadyCount === 0}
              >
                <ImageIcon size={14} /> Paint with Image String
              </button>
            </div>
          </div>
        )}

        {/* Color string */}
        {interactive && (
          <div className="space-y-2">
            <div className="flex items-center justify-between">
              <label className="text-xs font-semibold uppercase tracking-wider flex items-center gap-2">
                <Palette size={14} /> Color String
              </label>
              <button
                onClick={() => setS((p) => ({ ...p, colorSeqOn: !p.colorSeqOn }))}
                className={`p-1.5 rounded ${s.colorSeqOn ? "bg-black text-white" : "bg-neutral-200"}`}
              >
                {s.colorSeqOn ? <Play size={14} fill="white" /> : <Square size={14} />}
              </button>
            </div>

            <div className="grid grid-cols-5 gap-2">
              {s.colorSeq.map((col, i) => (
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
                  className="h-9 w-full rounded-md border border-neutral-300 bg-white"
                />
              ))}
            </div>
          </div>
        )}

        {/* String behavior */}
        {interactive && (
          <div className="space-y-2">
            <label className="block text-xs font-semibold uppercase tracking-wider">String Behavior</label>
            <select
              value={s.strBehave}
              onChange={(e) => setS((p) => ({ ...p, strBehave: e.target.value }))}
              className="w-full px-3 py-2 bg-white border border-neutral-300 rounded-lg"
            >
              <option value="cycle">Cycle</option>
              <option value="wave">Wave</option>
              <option value="random">Random</option>
            </select>

            <label className="block text-xs font-semibold uppercase tracking-wider">Characters</label>
            <input
              type="text"
              value={s.chars}
              onChange={(e) => setS((p) => ({ ...p, chars: e.target.value }))}
              className="w-full px-3 py-2 bg-white border border-neutral-300 rounded-lg font-mono"
            />
          </div>
        )}

        {/* Swiss-grid controls */}
        {s.pat === "swiss-grid" && (
          <>
            <div className="space-y-2">
              <label className="block text-xs font-semibold uppercase tracking-wider">
                Grid {s.cols} × {s.rows}
              </label>
              <input
                type="range"
                min="4"
                max="40"
                value={s.cols}
                onChange={(e) => setS((p) => ({ ...p, cols: parseInt(e.target.value) }))}
                className="w-full"
              />
              <input
                type="range"
                min="4"
                max="40"
                value={s.rows}
                onChange={(e) => setS((p) => ({ ...p, rows: parseInt(e.target.value) }))}
                className="w-full"
              />
            </div>

            {/* Variable Density UI */}
            <div className="space-y-2">
              <label className="block text-xs font-semibold uppercase tracking-wider">
                Variable Grid Density
              </label>

              <div className="rounded-lg border border-neutral-200 bg-white p-3 space-y-2">
                <div className="flex items-center justify-between">
                  <div className="text-xs font-semibold uppercase tracking-wider">Columns (vertical)</div>
                  <button
                    onClick={() => setS((p) => ({ ...p, varColsOn: !p.varColsOn }))}
                    className={`p-1.5 rounded ${s.varColsOn ? "bg-black text-white" : "bg-neutral-200"}`}
                  >
                    {s.varColsOn ? <Play size={14} fill="white" /> : <Square size={14} />}
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
                  </>
                )}
              </div>

              <div className="rounded-lg border border-neutral-200 bg-white p-3 space-y-2">
                <div className="flex items-center justify-between">
                  <div className="text-xs font-semibold uppercase tracking-wider">Rows (horizontal)</div>
                  <button
                    onClick={() => setS((p) => ({ ...p, varRowsOn: !p.varRowsOn }))}
                    className={`p-1.5 rounded ${s.varRowsOn ? "bg-black text-white" : "bg-neutral-200"}`}
                  >
                    {s.varRowsOn ? <Play size={14} fill="white" /> : <Square size={14} />}
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
                  </>
                )}
              </div>
            </div>

            <div className="space-y-2">
              <label className="block text-xs font-semibold uppercase tracking-wider">Draw Element</label>
              <select
                value={s.selEl}
                onChange={(e) => setS((p) => ({ ...p, selEl: e.target.value }))}
                className="w-full px-3 py-2 bg-white border border-neutral-300 rounded-lg"
              >
                <option value="char">Character</option>
                <option value="dot">Dot</option>
                <option value="square">Square</option>
              </select>
            </div>

            <div className="flex items-center justify-between">
              <label className="text-xs font-semibold uppercase tracking-wider">Draw Mode</label>
              <button
                onClick={() => setS((p) => ({ ...p, draw: !p.draw }))}
                className={`p-1.5 rounded ${s.draw ? "bg-black text-white" : "bg-neutral-200"}`}
              >
                {s.draw ? <Play size={14} fill="white" /> : <Square size={14} />}
              </button>
            </div>

            <button
              onClick={() => setCells([])}
              className="w-full px-4 py-2.5 bg-neutral-900 text-white rounded-lg font-medium hover:bg-black min-h-[44px]"
            >
              Clear
            </button>

            <div className="space-y-2">
              <label className="block text-xs font-semibold uppercase tracking-wider">Google Font</label>
              <select
                value={s.googleFont}
                onChange={(e) => setS((p) => ({ ...p, googleFont: e.target.value }))}
                className="w-full px-3 py-2 bg-white border border-neutral-300 rounded-lg text-xs"
              >
                <option value="Inter">Inter</option>
                <option value="Roboto Mono">Roboto Mono</option>
                <option value="Space Mono">Space Mono</option>
                <option value="JetBrains Mono">JetBrains Mono</option>
                <option value="Fira Code">Fira Code</option>
              </select>
            </div>

            <div className="space-y-2">
              <label className="block text-xs font-semibold uppercase tracking-wider">
                Custom Font (.ttf/.otf)
              </label>
              <input
                type="file"
                accept=".ttf,.otf,.woff,.woff2"
                onChange={handleFontUpload}
                className="w-full text-xs"
              />
              {s.customFont && <div className="text-xs text-green-600">✓ Custom font loaded</div>}
            </div>
          </>
        )}

        {/* Char-grid controls */}
        {s.pat === "char-grid" && (
          <div className="space-y-2">
            <label className="block text-xs font-semibold uppercase tracking-wider">
              Char Size: {s.charSz}px
            </label>
            <input
              type="range"
              min="8"
              max="80"
              value={s.charSz}
              onChange={(e) => setS((p) => ({ ...p, charSz: parseInt(e.target.value) }))}
              className="w-full"
            />
            <label className="block text-xs font-semibold uppercase tracking-wider">
              Spacing: {s.space}px
            </label>
            <input
              type="range"
              min="10"
              max="200"
              value={s.space}
              onChange={(e) => setS((p) => ({ ...p, space: parseInt(e.target.value) }))}
              className="w-full"
            />
            <label className="block text-xs font-semibold uppercase tracking-wider">
              Speed: {s.charSpd.toFixed(2)}×
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
            <div className="flex items-center justify-between">
              <label className="text-xs font-semibold uppercase tracking-wider">Draw Mode</label>
              <button
                onClick={() => setS((p) => ({ ...p, draw: !p.draw }))}
                className={`p-1.5 rounded ${s.draw ? "bg-black text-white" : "bg-neutral-200"}`}
              >
                {s.draw ? <Play size={14} fill="white" /> : <Square size={14} />}
              </button>
            </div>

            <button
              onClick={() => setCells([])}
              className="w-full px-4 py-2.5 bg-neutral-900 text-white rounded-lg font-medium hover:bg-black min-h-[44px]"
            >
              Clear Painted Cells
            </button>
          </div>
        )}

        {/* Global sensitivity */}
        <div className="space-y-2">
          <label className="block text-xs font-semibold uppercase tracking-wider">
            Audio Sensitivity: {s.audioSens}
          </label>
          <input
            type="range"
            min="0"
            max="10"
            step="0.1"
            value={s.audioSens}
            onChange={(e) => setS((p) => ({ ...p, audioSens: parseFloat(e.target.value) }))}
            className="w-full"
          />
        </div>
        <div className="space-y-2">
          <label className="block text-xs font-semibold uppercase tracking-wider">
            MIDI Sensitivity: {s.midiSens}
          </label>
          <input
            type="range"
            min="0"
            max="10"
            step="0.1"
            value={s.midiSens}
            onChange={(e) => setS((p) => ({ ...p, midiSens: parseFloat(e.target.value) }))}
            className="w-full"
          />
        </div>
      </div>

      {/* CANVAS */}
      <div className="flex-1 min-h-0 p-2 md:p-8 bg-white relative">
        <button
          onClick={() => setPanelOpen((v) => !v)}
          className="md:hidden absolute top-3 left-3 z-20 px-3 py-2 rounded-lg bg-black text-white text-xs font-semibold shadow"
        >
          {panelOpen ? "Hide controls" : "Show controls"}
        </button>

        <canvas
          ref={canvasRef}
          className="w-full h-full rounded-lg shadow-sm touch-none"
          onPointerDown={onPointerDown}
          onPointerMove={onPointerMove}
          onPointerUp={onPointerUp}
          onPointerLeave={onPointerUp}
          onPointerCancel={onPointerUp}
          onContextMenu={(e) => e.preventDefault()}
        />

        {menu && (
          <div
            className="fixed bg-white shadow-2xl rounded-lg border py-1 z-50"
            style={{ left: menu.x, top: menu.y }}
            onClick={(e) => e.stopPropagation()}
          >
            <button
              onClick={() => add("char")}
              className="block w-full px-4 py-2 text-left hover:bg-gray-100 text-sm"
            >
              Add Char
            </button>
            <button
              onClick={() => add("dot")}
              className="block w-full px-4 py-2 text-left hover:bg-gray-100 text-sm"
            >
              Add Dot
            </button>
            <button
              onClick={() => add("square")}
              className="block w-full px-4 py-2 text-left hover:bg-gray-100 text-sm"
            >
              Add Square
            </button>
            <div className="border-t my-1"></div>
            <button
              onClick={rem}
              className="block w-full px-4 py-2 text-left hover:bg-red-50 text-sm text-red-600"
            >
              Remove
            </button>
          </div>
        )}
      </div>
    </div>
  );
}
