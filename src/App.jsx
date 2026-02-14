import React from "react";
import { Play, Square, RotateCcw, Download, Palette } from "lucide-react";

const clamp = (v, a, b) => Math.max(a, Math.min(b, v));
const lerp = (a, b, t) => a + (b - a) * t;

function midiToFreq(m) {
  return 440 * Math.pow(2, (m - 69) / 12);
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

// ===================== VARIABLE GRID EDGES =====================
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
    const wi = 1 / (1 + st * g); // smaller => denser there
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

// ===================== SOUND ENGINE =====================
function createVoice(ac) {
  const osc = ac.createOscillator();
  const filter = ac.createBiquadFilter();
  const amp = ac.createGain();

  osc.type = "sawtooth";
  filter.type = "lowpass";
  filter.Q.value = 0.7;
  filter.frequency.value = 1600;

  amp.gain.value = 0.0001;

  osc.connect(filter);
  filter.connect(amp);

  osc.start();
  return { osc, filter, amp };
}

function makeImpulseResponse(ac, seconds = 1.7, decay = 2.2) {
  const sr = ac.sampleRate;
  const len = Math.floor(sr * seconds);
  const buf = ac.createBuffer(2, len, sr);
  for (let ch = 0; ch < 2; ch++) {
    const d = buf.getChannelData(ch);
    for (let i = 0; i < len; i++) {
      const t = i / len;
      d[i] = (Math.random() * 2 - 1) * Math.pow(1 - t, decay);
    }
  }
  return buf;
}

function ensureMasterFX(ac, refs) {
  if (refs.master?.in) return refs.master;

  const input = ac.createGain();
  const out = ac.createGain();

  // Dry
  const dry = ac.createGain();

  // Delay
  const delay = ac.createDelay(2.0);
  const delayWet = ac.createGain();
  const feedback = ac.createGain();

  // Reverb
  const convolver = ac.createConvolver();
  convolver.buffer = makeImpulseResponse(ac, 1.8, 2.2);
  const revWet = ac.createGain();

  input.connect(dry);
  dry.connect(out);

  input.connect(delay);
  delay.connect(delayWet);
  delayWet.connect(out);

  delay.connect(feedback);
  feedback.connect(delay);

  input.connect(convolver);
  convolver.connect(revWet);
  revWet.connect(out);

  out.connect(ac.destination);

  refs.master = { in: input, out, dry, delay, delayWet, feedback, convolver, revWet };
  return refs.master;
}

export default function App() {
  const canvasRef = React.useRef(null);
  const animRef = React.useRef(null);

  const [panelOpen, setPanelOpen] = React.useState(true);
  const [drawing, setDrawing] = React.useState(false);

  const [cells, setCells] = React.useState([]);
  const cellsRef = React.useRef([]);
  React.useEffect(() => {
    cellsRef.current = cells;
  }, [cells]);

  const [s, setS] = React.useState({
    pat: "swiss-grid", // swiss-grid | char-grid

    // char-grid visuals
    chars: "01",
    space: 40,
    charSz: 26,
    charSpd: 1.6,

    // swiss-grid visuals
    cols: 12,
    rows: 16,
    grid: true,

    // VARIABLE GRID DENSITY
    varColsOn: false,
    colFocus: 0.5,
    colStrength: 6,
    colSigma: 0.18,

    varRowsOn: false,
    rowFocus: 0.5,
    rowStrength: 6,
    rowSigma: 0.18,

    // paint
    fillAs: "background", // background | ink
    paintColor: "#111111",
    paintUseSeq: false,

    // Color string
    colorSeqSpeed: 1,
    colorSeq: ["#111111", "#ff0055", "#00c2ff", "#00ff88", "#ffe600"],

    // sound
    soundOn: true,
    soundBpm: 120,
    soundRoot: 48,
    soundPitchSpan: 24,
    soundDecay: 0.18,
    soundVoices: 10,
    soundMaxNotesPerStep: 6,
    soundCutoffBase: 450,
    soundCutoffSpan: 7200,

    // NEW: make timing follow warped column widths
    soundTimeFromCols: true, // <-- this is the “columns affect speed” you asked for
    soundDensity: 1.0,
    soundHumanize: 6, // ms

    // MIDI
    midiOn: false,
    midiAffectsDensity: true,
    midiPitchBendSemis: 0,

    // FX
    fxOn: true,
    fxDry: 0.85,
    fxDelayMix: 0.22,
    fxDelayTime: 0.2,
    fxDelayFb: 0.32,
    fxReverbMix: 0.18,

    masterGain: 0.9,
  });

  const sRef = React.useRef(s);
  React.useEffect(() => {
    sRef.current = s;
  }, [s]);

  const midiVelRef = React.useRef(0);
  const midiNoteRef = React.useRef(0);

  const soundCtxRef = React.useRef(null);
  const masterRef = React.useRef({ master: null });
  const voicePoolRef = React.useRef([]);
  const voicePtrRef = React.useRef(0);

  // IMPORTANT: use setTimeout scheduler (not setInterval) so per-column timing works
  const seqTimeoutRef = React.useRef(null);
  const stepRef = React.useRef(0);

  const palette = React.useMemo(() => {
    const arr = Array.isArray(s.colorSeq) ? s.colorSeq : [];
    const fixed = arr.map((x) => (isHexColor(x) ? x : "#111111"));
    const five = fixed.slice(0, 5);
    while (five.length < 5) five.push("#111111");
    return five;
  }, [s.colorSeq]);

  const colorSeqIndex = React.useCallback((t, r, c, len) => {
    if (len <= 1) return 0;
    const tt = t * (sRef.current?.colorSeqSpeed || 1);
    const k = Math.floor(tt * 3) + r + c;
    return ((k % len) + len) % len;
  }, []);

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

  const wakeAudio = React.useCallback(async () => {
    if (!soundCtxRef.current) {
      soundCtxRef.current = new (window.AudioContext || window.webkitAudioContext)();
      ensureMasterFX(soundCtxRef.current, masterRef.current);
    }
    try {
      if (soundCtxRef.current.state === "suspended") {
        await soundCtxRef.current.resume();
      }
    } catch {}
  }, []);

  const rebuildVoicePoolIfNeeded = React.useCallback(() => {
    const ac = soundCtxRef.current;
    if (!ac) return;

    const want = clamp(sRef.current.soundVoices ?? 10, 1, 32);
    if (voicePoolRef.current.length === want) return;

    try {
      voicePoolRef.current.forEach((v) => {
        try {
          v.amp.disconnect();
        } catch {}
      });
    } catch {}

    voicePoolRef.current = Array.from({ length: want }, () => createVoice(ac));
    voicePtrRef.current = 0;

    const m = ensureMasterFX(ac, masterRef.current);
    voicePoolRef.current.forEach((v) => v.amp.connect(m.in));
  }, []);

  const applyFXParams = React.useCallback(() => {
    const ac = soundCtxRef.current;
    if (!ac) return;
    const st = sRef.current;
    const m = ensureMasterFX(ac, masterRef.current);
    const now = ac.currentTime;

    m.out.gain.setTargetAtTime(clamp(st.masterGain ?? 0.9, 0, 1), now, 0.02);

    const fxOn = !!st.fxOn;
    const dry = fxOn ? clamp(st.fxDry ?? 0.85, 0, 1) : 1;
    const dMix = fxOn ? clamp(st.fxDelayMix ?? 0.22, 0, 1) : 0;
    const rMix = fxOn ? clamp(st.fxReverbMix ?? 0.18, 0, 1) : 0;

    m.dry.gain.setTargetAtTime(dry, now, 0.02);
    m.delayWet.gain.setTargetAtTime(dMix, now, 0.02);
    m.delay.delayTime.setTargetAtTime(clamp(st.fxDelayTime ?? 0.2, 0, 1.5), now, 0.02);
    m.feedback.gain.setTargetAtTime(clamp(st.fxDelayFb ?? 0.32, 0, 0.85), now, 0.02);
    m.revWet.gain.setTargetAtTime(rMix, now, 0.02);
  }, []);

  const stopSequencer = React.useCallback(() => {
    if (seqTimeoutRef.current) clearTimeout(seqTimeoutRef.current);
    seqTimeoutRef.current = null;
  }, []);

  const scheduleNext = React.useCallback((ms, fn) => {
    if (seqTimeoutRef.current) clearTimeout(seqTimeoutRef.current);
    seqTimeoutRef.current = setTimeout(fn, Math.max(0, ms));
  }, []);

  const startSequencer = React.useCallback(async () => {
    await wakeAudio();
    rebuildVoicePoolIfNeeded();
    applyFXParams();
    stopSequencer();

    const ac = soundCtxRef.current;
    if (!ac) return;

    const tick = () => {
      const st = sRef.current;
      if (!st.soundOn || st.pat !== "swiss-grid") return;

      rebuildVoicePoolIfNeeded();
      applyFXParams();

      const cols = st.cols;
      const rows = st.rows;

      const ce = colEdges || Array.from({ length: cols + 1 }, (_, i) => i / cols);
      const re = rowEdges || Array.from({ length: rows + 1 }, (_, i) => i / rows);

      const step = stepRef.current;
      const col = step % cols;
      const t = step * 0.25;

      const map = new Map();
      for (const c of cellsRef.current) map.set(c.idx, c);

      // column width drives time if enabled
      const baseStepMs = (60 / clamp(st.soundBpm ?? 120, 30, 300)) * 1000;
      let stepMs = baseStepMs;
      if (st.soundTimeFromCols) {
        const colW = (ce[col + 1] - ce[col]) || (1 / cols);
        // normalize around average width (1/cols)
        const norm = colW / (1 / cols);
        // narrower => faster, wider => slower
        stepMs = baseStepMs * clamp(norm, 0.35, 2.25);
      }

      const midiVel = midiVelRef.current;
      const midiBoost = st.midiAffectsDensity ? lerp(1.0, 1.8, midiVel) : 1.0;
      const probBase = clamp(st.soundDensity ?? 1.0, 0, 3) * midiBoost;

      const hits = [];
      for (let r = 0; r < rows; r++) {
        const idx = r * cols + col;
        const cell = map.get(idx);
        if (!cell?.paint) continue;

        let colHex = null;
        if (cell.paint.mode === "color") colHex = cell.paint.color;
        else if (cell.paint.mode === "seq") {
          const len = palette.length;
          colHex = palette[colorSeqIndex(t, r, col, len)];
        } else continue;

        const rgb = hexToRgb(colHex);
        if (!rgb) continue;
        const lum = luminance01(rgb);

        // row center in warped grid -> pitch
        const rowCenter = (re[r] + re[r + 1]) * 0.5; // 0..1
        const rowNorm = 1 - rowCenter;

        // cell area in warped grid -> intensity
        const cellW = (ce[col + 1] - ce[col]) || 1 / cols;
        const cellH = (re[r + 1] - re[r]) || 1 / rows;
        const area = clamp(cellW * cellH * cols * rows, 0.2, 2.5); // normalized-ish

        const localProb = clamp(probBase * (0.25 + lum * 0.9) * (0.7 + 0.3 * area), 0, 1.25);
        if (Math.random() > Math.min(1, localProb)) continue;

        const pitchSpan = clamp(st.soundPitchSpan ?? 24, 0, 60);
        let note =
          (st.soundRoot ?? 48) +
          Math.round(rowNorm * pitchSpan) +
          (st.midiPitchBendSemis ?? 0);

        note = clamp(note, 24, 96);
        const freq = midiToFreq(note);

        const vel = clamp((0.08 + 0.92 * (0.35 * rowNorm + 0.65 * lum)) * clamp(area, 0.8, 1.25), 0.05, 1);

        const cutoff =
          (st.soundCutoffBase ?? 450) +
          (st.soundCutoffSpan ?? 7200) * clamp(0.15 + 0.85 * lum, 0, 1);

        hits.push({ freq, vel, cutoff });
      }

      hits.sort((a, b) => b.vel - a.vel);
      const maxNotes = clamp(st.soundMaxNotesPerStep ?? 6, 1, 32);
      const chosen = hits.slice(0, maxNotes);

      const decay = clamp(st.soundDecay ?? 0.18, 0.02, 1.8);
      const humanMs = clamp(st.soundHumanize ?? 0, 0, 60);

      const now = ac.currentTime;
      for (const h of chosen) {
        const pool = voicePoolRef.current;
        const v = pool[voicePtrRef.current % pool.length];
        voicePtrRef.current++;

        const offset = humanMs > 0 ? (Math.random() * 2 - 1) * (humanMs / 1000) : 0;
        const fireAt = now + Math.max(0, offset);

        v.osc.frequency.setValueAtTime(h.freq, fireAt);
        v.filter.frequency.setValueAtTime(h.cutoff, fireAt);

        v.amp.gain.cancelScheduledValues(fireAt);
        v.amp.gain.setValueAtTime(0.0001, fireAt);
        v.amp.gain.exponentialRampToValueAtTime(h.vel, fireAt + 0.002);
        v.amp.gain.exponentialRampToValueAtTime(0.0001, fireAt + decay);
      }

      stepRef.current++;

      scheduleNext(stepMs, tick);
    };

    scheduleNext(0, tick);
  }, [wakeAudio, rebuildVoicePoolIfNeeded, applyFXParams, stopSequencer, scheduleNext, palette, colorSeqIndex, colEdges, rowEdges]);

  React.useEffect(() => {
    if (s.soundOn && s.pat === "swiss-grid") startSequencer();
    else stopSequencer();
    return () => stopSequencer();
  }, [s.soundOn, s.pat, startSequencer, stopSequencer]);

  React.useEffect(() => {
    if (!s.midiOn) {
      midiVelRef.current = 0;
      midiNoteRef.current = 0;
      return;
    }
    let cancelled = false;

    navigator
      .requestMIDIAccess?.()
      .then((acc) => {
        if (cancelled) return;
        for (const inp of acc.inputs.values()) {
          inp.onmidimessage = (e) => {
            const [stt, n, v] = e.data;
            const msg = stt >> 4;

            if (msg === 9 && v > 0) {
              midiNoteRef.current = n;
              midiVelRef.current = v / 127;
            } else if (msg === 8 || (msg === 9 && v === 0)) {
              midiVelRef.current = 0;
            }

            if (msg === 11) {
              midiVelRef.current = Math.max(midiVelRef.current, (v ?? 0) / 127);
              if (n === 1) {
                const semis = Math.round(((v ?? 0) / 127) * 12);
                setS((p) => ({ ...p, midiPitchBendSemis: semis }));
              }
            }
          };
        }
      })
      .catch(() => {});

    return () => {
      cancelled = true;
    };
  }, [s.midiOn]);

  // ===== Painting =====
  const upsertCell = (idx, paint) => {
    setCells((prev) => {
      const i = prev.findIndex((c) => c.idx === idx);
      const next = [...prev];
      if (i >= 0) next[i] = { ...next[i], paint };
      else next.push({ idx, paint });
      return next;
    });
  };

  const pointerToCanvas = (e) => {
    const cv = canvasRef.current;
    const r = cv.getBoundingClientRect();
    const x = (e.clientX - r.left) * (cv.width / r.width);
    const y = (e.clientY - r.top) * (cv.height / r.height);
    return { x, y };
  };

  const getSwissIdx = (x, y) => {
    const cv = canvasRef.current;
    if (!cv) return null;

    const cols = sRef.current.cols;
    const rows = sRef.current.rows;

    const ce = colEdges || Array.from({ length: cols + 1 }, (_, i) => i / cols);
    const re = rowEdges || Array.from({ length: rows + 1 }, (_, i) => i / rows);

    const x01 = clamp(x / cv.width, 0, 0.999999);
    const y01 = clamp(y / cv.height, 0, 0.999999);

    // find col
    let c = 0;
    for (; c < cols; c++) if (x01 >= ce[c] && x01 < ce[c + 1]) break;

    // find row
    let r = 0;
    for (; r < rows; r++) if (y01 >= re[r] && y01 < re[r + 1]) break;

    if (c < 0 || r < 0 || c >= cols || r >= rows) return null;
    return r * cols + c;
  };

  const getCharIdx = (x, y) => {
    const cv = canvasRef.current;
    if (!cv) return null;
    const sp = sRef.current.space;
    const cols = Math.max(1, Math.floor(cv.width / sp));
    const rows = Math.max(1, Math.floor(cv.height / sp));
    const col = Math.floor(x / sp);
    const row = Math.floor(y / sp);
    if (col < 0 || row < 0 || col >= cols || row >= rows) return null;
    return row * cols + col;
  };

  const getIdx = (x, y) => {
    if (sRef.current.pat === "swiss-grid") return getSwissIdx(x, y);
    if (sRef.current.pat === "char-grid") return getCharIdx(x, y);
    return null;
  };

  const paintAt = (idx) => {
    const st = sRef.current;
    if (idx == null) return;
    if (st.paintUseSeq) upsertCell(idx, { mode: "seq" });
    else upsertCell(idx, { mode: "color", color: st.paintColor });
  };

  const onPointerDown = async (e) => {
    e.preventDefault?.();
    await wakeAudio();
    setDrawing(true);
    const { x, y } = pointerToCanvas(e);
    paintAt(getIdx(x, y));
    try {
      e.currentTarget?.setPointerCapture?.(e.pointerId);
    } catch {}
  };

  const onPointerMove = (e) => {
    if (!drawing) return;
    const { x, y } = pointerToCanvas(e);
    paintAt(getIdx(x, y));
  };

  const onPointerUp = () => setDrawing(false);

  // ===== Canvas resize =====
  React.useEffect(() => {
    const rsz = () => {
      const cv = canvasRef.current;
      if (!cv) return;
      cv.width = cv.offsetWidth;
      cv.height = cv.offsetHeight;
    };
    rsz();
    window.addEventListener("resize", rsz);
    window.addEventListener("orientationchange", rsz);
    return () => {
      window.removeEventListener("resize", rsz);
      window.removeEventListener("orientationchange", rsz);
    };
  }, []);

  // ===== Render =====
  const render = (tm = 0) => {
    const cv = canvasRef.current;
    if (!cv) return;
    const ctx = cv.getContext("2d");
    const w = cv.width,
      h = cv.height;

    const st = sRef.current;
    const t = (tm * 0.001) * (st.charSpd ?? 1.6);

    ctx.fillStyle = "#FAFAFA";
    ctx.fillRect(0, 0, w, h);

    const cellByIdx = new Map();
    for (const c of cellsRef.current) cellByIdx.set(c.idx, c);

    const resolvePaintColor = (paintObj, r, c) => {
      if (!paintObj) return null;
      if (paintObj.mode === "color") return paintObj.color;
      if (paintObj.mode === "seq") {
        const len = palette.length;
        return palette[colorSeqIndex(t, r, c, len)];
      }
      return null;
    };

    // CHAR GRID
    if (st.pat === "char-grid") {
      const sp = st.space;
      const cols = Math.max(1, Math.floor(w / sp));
      const rows = Math.max(1, Math.floor(h / sp));
      const chs = (st.chars || "01").split("");

      ctx.textAlign = "center";
      ctx.textBaseline = "middle";
      ctx.font = `${st.charSz ?? 26}px ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, "Liberation Mono", "Courier New", monospace`;

      for (let r = 0; r < rows; r++) {
        for (let c = 0; c < cols; c++) {
          const idx = r * cols + c;
          const entry = cellByIdx.get(idx);
          const paintCol = resolvePaintColor(entry?.paint, r, c);

          const x0 = c * sp;
          const y0 = r * sp;
          const cx = x0 + sp / 2;
          const cy = y0 + sp / 2;

          if (paintCol && st.fillAs === "background") {
            ctx.save();
            ctx.fillStyle = paintCol;
            ctx.globalAlpha = 0.92;
            ctx.fillRect(x0, y0, sp, sp);
            ctx.restore();
          }

          const gi = chs.length ? (Math.floor(t * 3) + r + c) % chs.length : 0;
          ctx.save();
          ctx.fillStyle = st.fillAs === "ink" && paintCol ? paintCol : "#111";
          ctx.fillText(chs[gi] ?? "", cx, cy);
          ctx.restore();
        }
      }
      return;
    }

    // SWISS GRID (with variable edges)
    if (st.pat === "swiss-grid") {
      const cols = st.cols;
      const rows = st.rows;

      const ce = colEdges || Array.from({ length: cols + 1 }, (_, i) => i / cols);
      const re = rowEdges || Array.from({ length: rows + 1 }, (_, i) => i / rows);

      if (st.grid) {
        ctx.strokeStyle = "#E5E5E5";
        ctx.lineWidth = 0.6;
        for (let c = 0; c < ce.length; c++) {
          const x = ce[c] * w;
          ctx.beginPath();
          ctx.moveTo(x, 0);
          ctx.lineTo(x, h);
          ctx.stroke();
        }
        for (let r = 0; r < re.length; r++) {
          const y = re[r] * h;
          ctx.beginPath();
          ctx.moveTo(0, y);
          ctx.lineTo(w, y);
          ctx.stroke();
        }
      }

      const chs = (st.chars || "01").split("");
      ctx.textAlign = "center";
      ctx.textBaseline = "middle";

      for (let r = 0; r < rows; r++) {
        for (let c = 0; c < cols; c++) {
          const idx = r * cols + c;
          const entry = cellByIdx.get(idx);
          const paintCol = resolvePaintColor(entry?.paint, r, c);

          const x0 = ce[c] * w;
          const x1 = ce[c + 1] * w;
          const y0 = re[r] * h;
          const y1 = re[r + 1] * h;

          const cw = x1 - x0;
          const ch = y1 - y0;
          const cx = x0 + cw / 2;
          const cy = y0 + ch / 2;

          if (paintCol && st.fillAs === "background") {
            ctx.save();
            ctx.fillStyle = paintCol;
            ctx.globalAlpha = 0.92;
            ctx.fillRect(x0, y0, cw, ch);
            ctx.restore();
          }

          const baseSz = Math.min(cw, ch) * 0.55;
          ctx.font = `${Math.max(10, baseSz)}px ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, "Liberation Mono", "Courier New", monospace`;

          const gi = chs.length ? (Math.floor(t * 3) + r + c) % chs.length : 0;

          ctx.save();
          ctx.fillStyle = st.fillAs === "ink" && paintCol ? paintCol : "#111";
          ctx.fillText(chs[gi] ?? "", cx, cy);
          ctx.restore();
        }
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
  }, [palette, colorSeqIndex, colEdges, rowEdges]);

  const reseed = () => {
    stepRef.current = 0;
  };

  const downloadPng = () => {
    const cv = canvasRef.current;
    if (!cv) return;
    const a = document.createElement("a");
    a.download = "pattern.png";
    a.href = cv.toDataURL("image/png");
    a.click();
  };

  return (
    <div className="w-full h-[100svh] bg-white flex flex-col md:flex-row">
      <div className="md:hidden p-2">
        <button
          onClick={() => setPanelOpen((v) => !v)}
          className="w-full px-3 py-2 rounded-lg bg-black text-white text-sm font-semibold"
        >
          {panelOpen ? "Hide controls" : "Show controls"}
        </button>
      </div>

      {panelOpen && (
        <div className="w-full md:w-80 bg-neutral-50 border-r border-neutral-200 p-4 overflow-y-auto space-y-4 text-sm">
          <div className="flex gap-2">
            <button
              onClick={reseed}
              className="flex-1 flex justify-center px-4 py-2.5 bg-black text-white rounded-lg font-medium hover:bg-neutral-800"
              title="Reset step"
            >
              <RotateCcw size={16} />
            </button>
            <button
              onClick={downloadPng}
              className="flex-1 flex justify-center px-4 py-2.5 bg-black text-white rounded-lg font-medium hover:bg-neutral-800"
              title="Download PNG"
            >
              <Download size={16} />
            </button>
          </div>

          <div className="space-y-2">
            <label className="block text-xs font-semibold uppercase tracking-wider">Pattern</label>
            <select
              value={s.pat}
              onChange={(e) => setS((p) => ({ ...p, pat: e.target.value }))}
              className="w-full px-3 py-2 bg-white border border-neutral-300 rounded-lg"
            >
              <option value="swiss-grid">Swiss Grid</option>
              <option value="char-grid">Character Grid</option>
            </select>
          </div>

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
                <div className="flex items-center justify-between">
                  <div className="text-xs font-semibold uppercase tracking-wider">Grid Lines</div>
                  <button
                    onClick={() => setS((p) => ({ ...p, grid: !p.grid }))}
                    className={`p-1.5 rounded ${s.grid ? "bg-black text-white" : "bg-neutral-200"}`}
                  >
                    {s.grid ? <Play size={14} fill="white" /> : <Square size={14} />}
                  </button>
                </div>
              </div>

              {/* Variable Grid Density */}
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
            </>
          )}

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
            </div>
          )}

          <div className="space-y-2">
            <label className="block text-xs font-semibold uppercase tracking-wider">Paint</label>

            <div className="flex items-center gap-2">
              <input
                type="color"
                value={s.paintColor}
                onChange={(e) => setS((p) => ({ ...p, paintColor: e.target.value, paintUseSeq: false }))}
                className="h-10 w-14 rounded-md border border-neutral-300 bg-white"
              />
              <div className="flex-1">
                <div className="text-xs text-neutral-600">Mode</div>
                <div className="font-mono text-xs">{s.paintUseSeq ? "(color string)" : s.paintColor}</div>
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
              onClick={() => setS((p) => ({ ...p, paintUseSeq: !p.paintUseSeq }))}
              className={`w-full px-3 py-2 rounded-lg border text-xs font-semibold flex items-center justify-center gap-2 ${
                s.paintUseSeq ? "bg-black text-white border-black" : "bg-white border-neutral-300"
              }`}
            >
              <Palette size={14} />
              Paint with Color String
            </button>

            <button
              onClick={() => setCells([])}
              className="w-full px-3 py-2 rounded-lg bg-neutral-900 text-white font-semibold hover:bg-black"
            >
              Clear painted cells
            </button>
          </div>

          <div className="space-y-2">
            <label className="block text-xs font-semibold uppercase tracking-wider">Color String</label>
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

            <label className="block text-xs font-semibold uppercase tracking-wider">
              Speed: {s.colorSeqSpeed.toFixed(2)}
            </label>
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

          {s.pat === "swiss-grid" && (
            <div className="space-y-2">
              <div className="flex items-center justify-between">
                <label className="text-xs font-semibold uppercase tracking-wider">Grid Sound</label>
                <button
                  onClick={() => setS((p) => ({ ...p, soundOn: !p.soundOn }))}
                  className={`p-1.5 rounded ${s.soundOn ? "bg-black text-white" : "bg-neutral-200"}`}
                >
                  {s.soundOn ? <Play size={14} fill="white" /> : <Square size={14} />}
                </button>
              </div>

              <label className="block text-xs font-semibold uppercase tracking-wider">BPM: {s.soundBpm}</label>
              <input
                type="range"
                min="40"
                max="220"
                value={s.soundBpm}
                onChange={(e) => setS((p) => ({ ...p, soundBpm: parseInt(e.target.value) }))}
                className="w-full"
              />

              <div className="flex items-center justify-between">
                <div className="text-xs font-semibold uppercase tracking-wider">Timing from columns</div>
                <button
                  onClick={() => setS((p) => ({ ...p, soundTimeFromCols: !p.soundTimeFromCols }))}
                  className={`p-1.5 rounded ${s.soundTimeFromCols ? "bg-black text-white" : "bg-neutral-200"}`}
                  title="Warp timing using column widths"
                >
                  {s.soundTimeFromCols ? <Play size={14} fill="white" /> : <Square size={14} />}
                </button>
              </div>

              <label className="block text-xs font-semibold uppercase tracking-wider">Root Note: {s.soundRoot}</label>
              <input
                type="range"
                min="24"
                max="72"
                value={s.soundRoot}
                onChange={(e) => setS((p) => ({ ...p, soundRoot: parseInt(e.target.value) }))}
                className="w-full"
              />

              <label className="block text-xs font-semibold uppercase tracking-wider">
                Pitch Span: {s.soundPitchSpan} semis
              </label>
              <input
                type="range"
                min="0"
                max="60"
                value={s.soundPitchSpan}
                onChange={(e) => setS((p) => ({ ...p, soundPitchSpan: parseInt(e.target.value) }))}
                className="w-full"
              />

              <label className="block text-xs font-semibold uppercase tracking-wider">
                Density: {s.soundDensity.toFixed(2)}
              </label>
              <input
                type="range"
                min="0"
                max="3"
                step="0.01"
                value={s.soundDensity}
                onChange={(e) => setS((p) => ({ ...p, soundDensity: parseFloat(e.target.value) }))}
                className="w-full"
              />

              <label className="block text-xs font-semibold uppercase tracking-wider">
                Decay: {s.soundDecay.toFixed(2)}s
              </label>
              <input
                type="range"
                min="0.03"
                max="1.2"
                step="0.01"
                value={s.soundDecay}
                onChange={(e) => setS((p) => ({ ...p, soundDecay: parseFloat(e.target.value) }))}
                className="w-full"
              />

              <label className="block text-xs font-semibold uppercase tracking-wider">Voices: {s.soundVoices}</label>
              <input
                type="range"
                min="1"
                max="16"
                value={s.soundVoices}
                onChange={(e) => setS((p) => ({ ...p, soundVoices: parseInt(e.target.value) }))}
                className="w-full"
              />

              <label className="block text-xs font-semibold uppercase tracking-wider">
                Max notes/step: {s.soundMaxNotesPerStep}
              </label>
              <input
                type="range"
                min="1"
                max="16"
                value={s.soundMaxNotesPerStep}
                onChange={(e) => setS((p) => ({ ...p, soundMaxNotesPerStep: parseInt(e.target.value) }))}
                className="w-full"
              />
            </div>
          )}

          <div className="space-y-2">
            <div className="flex items-center justify-between">
              <label className="text-xs font-semibold uppercase tracking-wider">FX</label>
              <button
                onClick={() => setS((p) => ({ ...p, fxOn: !p.fxOn }))}
                className={`p-1.5 rounded ${s.fxOn ? "bg-black text-white" : "bg-neutral-200"}`}
              >
                {s.fxOn ? <Play size={14} fill="white" /> : <Square size={14} />}
              </button>
            </div>

            <label className="block text-xs font-semibold uppercase tracking-wider">Delay Mix: {s.fxDelayMix.toFixed(2)}</label>
            <input
              type="range"
              min="0"
              max="1"
              step="0.01"
              value={s.fxDelayMix}
              onChange={(e) => setS((p) => ({ ...p, fxDelayMix: parseFloat(e.target.value) }))}
              className="w-full"
            />

            <label className="block text-xs font-semibold uppercase tracking-wider">Delay Time: {s.fxDelayTime.toFixed(2)}s</label>
            <input
              type="range"
              min="0"
              max="1.2"
              step="0.01"
              value={s.fxDelayTime}
              onChange={(e) => setS((p) => ({ ...p, fxDelayTime: parseFloat(e.target.value) }))}
              className="w-full"
            />

            <label className="block text-xs font-semibold uppercase tracking-wider">Delay Feedback: {s.fxDelayFb.toFixed(2)}</label>
            <input
              type="range"
              min="0"
              max="0.85"
              step="0.01"
              value={s.fxDelayFb}
              onChange={(e) => setS((p) => ({ ...p, fxDelayFb: parseFloat(e.target.value) }))}
              className="w-full"
            />

            <label className="block text-xs font-semibold uppercase tracking-wider">Reverb Mix: {s.fxReverbMix.toFixed(2)}</label>
            <input
              type="range"
              min="0"
              max="1"
              step="0.01"
              value={s.fxReverbMix}
              onChange={(e) => setS((p) => ({ ...p, fxReverbMix: parseFloat(e.target.value) }))}
              className="w-full"
            />
          </div>

          <div className="space-y-2">
            <div className="flex items-center justify-between">
              <label className="text-xs font-semibold uppercase tracking-wider">MIDI</label>
              <button
                onClick={() => setS((p) => ({ ...p, midiOn: !p.midiOn }))}
                className={`p-1.5 rounded ${s.midiOn ? "bg-black text-white" : "bg-neutral-200"}`}
              >
                {s.midiOn ? <Play size={14} fill="white" /> : <Square size={14} />}
              </button>
            </div>
            <div className="flex items-center justify-between">
              <div className="text-xs font-semibold uppercase tracking-wider">MIDI boosts density</div>
              <button
                onClick={() => setS((p) => ({ ...p, midiAffectsDensity: !p.midiAffectsDensity }))}
                className={`p-1.5 rounded ${s.midiAffectsDensity ? "bg-black text-white" : "bg-neutral-200"}`}
              >
                {s.midiAffectsDensity ? <Play size={14} fill="white" /> : <Square size={14} />}
              </button>
            </div>
          </div>
        </div>
      )}

      <div className="flex-1 min-h-0 p-2 md:p-6 bg-white">
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
      </div>
    </div>
  );
}
