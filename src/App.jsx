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

// ===================== SOUND ENGINE =====================
function createVoice(ac) {
  const osc = ac.createOscillator();
  const filter = ac.createBiquadFilter();
  const amp = ac.createGain();

  osc.type = "sawtooth";
  filter.type = "lowpass";
  filter.Q.value = 0.65;
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

  // Routing
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

  refs.master = {
    in: input,
    out,
    dry,
    delay,
    delayWet,
    feedback,
    convolver,
    revWet,
  };

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
    soundCutoffBase: 500,
    soundCutoffSpan: 6500,
    soundDensity: 1.0,
    soundHumanize: 0,

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
  const seqTimerRef = React.useRef(null);
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
    if (seqTimerRef.current) clearInterval(seqTimerRef.current);
    seqTimerRef.current = null;
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

      const step = stepRef.current;
      const col = step % cols;
      const t = step * 0.25;

      const map = new Map();
      for (const c of cellsRef.current) map.set(c.idx, c);

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

        const localProb = clamp(probBase * (0.35 + lum * 0.8), 0, 1.2);
        if (Math.random() > Math.min(1, localProb)) continue;

        const rowNorm = 1 - r / Math.max(1, rows - 1);
        const pitchSpan = clamp(st.soundPitchSpan ?? 24, 0, 60);

        let note =
          (st.soundRoot ?? 48) +
          Math.round(rowNorm * pitchSpan) +
          (st.midiPitchBendSemis ?? 0);

        note = clamp(note, 24, 96);
        const freq = midiToFreq(note);

        const vel = clamp(0.08 + 0.92 * (0.35 * rowNorm + 0.65 * lum), 0.05, 1);
        const cutoff =
          (st.soundCutoffBase ?? 500) +
          (st.soundCutoffSpan ?? 6500) * clamp(0.15 + 0.85 * lum, 0, 1);

        hits.push({ freq, vel, cutoff });
      }

      hits.sort((a, b) => b.vel - a.vel);
      const maxNotes = clamp(st.soundMaxNotesPerStep ?? 6, 1, 32);
      const chosen = hits.slice(0, maxNotes);

      const decay = clamp(st.soundDecay ?? 0.18, 0.02, 1.8);
      const humanMs = clamp(st.soundHumanize ?? 0, 0, 40);

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
    };

    const stepMs = (60 / clamp(sRef.current.soundBpm ?? 120, 30, 300)) * 1000;
    seqTimerRef.current = setInterval(tick, stepMs);
  }, [wakeAudio, rebuildVoicePoolIfNeeded, applyFXParams, stopSequencer, palette, colorSeqIndex]);

  React.useEffect(() => {
    if (s.soundOn && s.pat === "swiss-grid") startSequencer();
    else stopSequencer();
    return () => stopSequencer();
  }, [s.soundOn, s.pat, startSequencer, stopSequencer]);

  React.useEffect(() => {
    if (!(s.soundOn && s.pat === "swiss-grid")) return;
    startSequencer();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [s.soundBpm]);

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

  // ===== Painting helpers =====
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
    const col = Math.floor((x / cv.width) * sRef.current.cols);
    const row = Math.floor((y / cv.height) * sRef.current.rows);
    if (col < 0 || row < 0 || col >= sRef.current.cols || row >= sRef.current.rows) return null;
    return row * sRef.current.cols + col;
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

    // SWISS GRID
    if (st.pat === "swiss-grid") {
      const cols = st.cols;
      const rows = st.rows;

      if (st.grid) {
        ctx.strokeStyle = "#E5E5E5";
        ctx.lineWidth = 0.6;
        for (let c = 0; c <= cols; c++) {
          const x = (c / cols) * w;
          ctx.beginPath();
          ctx.moveTo(x, 0);
          ctx.lineTo(x, h);
          ctx.stroke();
        }
        for (let r = 0; r <= rows; r++) {
          const y = (r / row

