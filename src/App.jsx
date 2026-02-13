// App.jsx
import React from "react";
import { Play, Square, RotateCcw, Download } from "lucide-react";

const clamp = (v, a, b) => Math.max(a, Math.min(b, v));
const lerp = (a, b, t) => a + (b - a) * t;

function midiToFreq(m) {
  return 440 * Math.pow(2, (m - 69) / 12);
}
function hexFromRgb(r, g, b) {
  const to2 = (n) => n.toString(16).padStart(2, "0");
  return `#${to2(r)}${to2(g)}${to2(b)}`;
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
function isHexColor(s) {
  return /^#([0-9a-fA-F]{3}|[0-9a-fA-F]{6})$/.test(s);
}

// ------------------------------
// Sound engine: voices + master FX
// ------------------------------
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

function triggerVoice(ac, voice, { freq, vel, cutoffHz, decaySec }) {
  const now = ac.currentTime;
  const v = clamp(vel, 0.0001, 1);

  voice.osc.frequency.setValueAtTime(freq, now);
  voice.filter.frequency.setValueAtTime(clamp(cutoffHz, 80, 14000), now);

  // envelope
  voice.amp.gain.cancelScheduledValues(now);
  voice.amp.gain.setValueAtTime(0.0001, now);
  voice.amp.gain.exponentialRampToValueAtTime(v, now + 0.002);
  voice.amp.gain.exponentialRampToValueAtTime(
    0.0001,
    now + clamp(decaySec, 0.02, 2.0)
  );
}

function makeImpulseResponse(ac, seconds = 1.6, decay = 2.2) {
  const sr = ac.sampleRate;
  const len = Math.floor(sr * seconds);
  const buf = ac.createBuffer(2, len, sr);

  for (let ch = 0; ch < 2; ch++) {
    const d = buf.getChannelData(ch);
    for (let i = 0; i < len; i++) {
      const t = i / len;
      // exponentially decaying noise
      d[i] = (Math.random() * 2 - 1) * Math.pow(1 - t, decay);
    }
  }
  return buf;
}

function ensureMasterFX(ac, refs) {
  if (refs.master?.in) return refs.master;

  const input = ac.createGain();
  const dry = ac.createGain();
  const wet = ac.createGain();
  const out = ac.createGain();

  // Delay
  const delay = ac.createDelay(2.0);
  const feedback = ac.createGain();
  const delayWet = ac.createGain();

  // Reverb (convolver)
  const convolver = ac.createConvolver();
  convolver.buffer = makeImpulseResponse(ac, 1.8, 2.2);
  const revWet = ac.createGain();

  // Routing:
  // input -> dry -> out
  // input -> delay -> delayWet -> out
  // delay -> feedback -> delay (feedback loop)
  // input -> convolver -> revWet -> out
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
    wet, // (unused but kept)
    delay,
    feedback,
    delayWet,
    convolver,
    revWet,
  };

  return refs.master;
}

// ------------------------------
// Visual noise helper (simple)
// ------------------------------
function makeNoise() {
  const p = [];
  for (let i = 0; i < 512; i++) p[i] = Math.floor(Math.random() * 256);
  return (x, y) => {
    const X = Math.floor(x) & 255;
    const Y = Math.floor(y) & 255;
    x -= Math.floor(x);
    y -= Math.floor(y);
    const f = (t) => t * t * t * (t * (t * 6 - 15) + 10);
    const u = f(x);
    const v = f(y);
    const A = p[X] + Y;
    const B = p[X + 1] + Y;
    const lerp2 = (t, a, b) => a + t * (b - a);
    return lerp2(
      v,
      lerp2(u, p[A] / 128 - 1, p[B] / 128 - 1),
      lerp2(u, p[A + 1] / 128 - 1, p[B + 1] / 128 - 1)
    );
  };
}

export default function App() {
  const canvasRef = React.useRef(null);
  const animRef = React.useRef(null);

  // Persistent state refs so audio loop never restarts
  const sRef = React.useRef(null);
  const cellsRef = React.useRef([]);

  // MIDI refs
  const midiOnRef = React.useRef(false);
  const midiVelRef = React.useRef(0);
  const midiNoteRef = React.useRef(0);

  // Audio context + sequencing refs
  const soundCtxRef = React.useRef(null);
  const masterRef = React.useRef({ master: null });
  const voicePoolRef = React.useRef([]);
  const voicePtrRef = React.useRef(0);
  const runningRef = React.useRef(false);

  const seqTimerRef = React.useRef(null);
  const stepRef = React.useRef(0);

  const noise = React.useMemo(() => makeNoise(), []);

  // UI state
  const [panelOpen, setPanelOpen] = React.useState(true);

  const [cells, setCells] = React.useState([]); // for UI redraw
  const [painting, setPainting] = React.useState(false);

  const [midiOn, setMidiOn] = React.useState(false);

  const [s, setS] = React.useState({
    // Patterns
    pat: "swiss-grid", // swiss-grid | char-grid | vertical-lines | horizontal-lines | dots | squares | text

    // Visual
    thick: 2,
    space: 40,
    distOn: false,
    distType: "liquify",
    distStr: 30,
    distSpd: 1,

    txt: "SOUND",
    fontSz: 56,
    chars: "01",
    charSz: 26,
    charSpd: 1.6,
    stagger: 0.08,

    // Swiss grid
    cols: 12,
    rows: 16,
    grid: true,
    rot: 0,

    // Painting
    paintColor: "#111111",
    fillAs: "background", // background | ink

    // Color string (optional)
    colorSeqOn: false,
    colorSeqSpeed: 1,
    colorSeq: ["#111111", "#ff0055", "#00c2ff", "#00ff88", "#ffe600"],

    // ===== SOUND (Swiss Grid Sequencer) =====
    soundOn: true,
    soundBpm: 120,
    soundRoot: 48,        // MIDI root note (C3)
    soundPitchSpan: 24,   // how many semitones top->bottom
    soundDecay: 0.18,
    soundVoices: 10,
    soundMaxNotesPerStep: 6,
    soundCutoffBase: 500,
    soundCutoffSpan: 6500,

    // Density/Speed mapping (so grid/paint can change feel)
    soundDensity: 1.0,   // multiplies probability of triggering
    soundHumanize: 0.0,  // random timing offset (ms) applied to triggers

    // MIDI mapping
    midiAffectsDensity: true,
    midiPitchBendSemis: 0, // simple "note offset" control via CC or note

    // FX
    fxOn: true,
    fxDry: 0.85,
    fxDelayMix: 0.25,
    fxDelayTime: 0.22,
    fxDelayFb: 0.35,
    fxReverbMix: 0.18,

    // Master
    masterGain: 0.9,
  });

  // keep refs updated
  React.useEffect(() => { sRef.current = s; }, [s]);
  React.useEffect(() => { cellsRef.current = cells; }, [cells]);
  React.useEffect(() => { midiOnRef.current = midiOn; }, [midiOn]);

  // Wake audio on touch (mobile safety)
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

  // MIDI
  React.useEffect(() => {
    if (!midiOn) {
      midiVelRef.current = 0;
      midiNoteRef.current = 0;
      return;
    }
    let cancelled = false;
    navigator.requestMIDIAccess?.().then((acc) => {
      if (cancelled) return;
      for (const inp of acc.inputs.values()) {
        inp.onmidimessage = (e) => {
          const [st, n, v] = e.data;
          const msg = st >> 4;

          // note on/off
          if (msg === 9 && v > 0) {
            midiNoteRef.current = n;
            midiVelRef.current = v / 127;
          } else if (msg === 8 || (msg === 9 && v === 0)) {
            midiVelRef.current = 0;
          }

          // CC
          if (msg === 11) {
            // Treat CC as “activity”
            midiVelRef.current = Math.max(midiVelRef.current, (v ?? 0) / 127);

            // Optional: use CC1 (mod wheel) to push pitch offset
            if (n === 1) {
              const semis = Math.round(((v ?? 0) / 127) * 12);
              setS((p) => ({ ...p, midiPitchBendSemis: semis }));
            }
          }
        };
      }
    }).catch(() => {});
    return () => { cancelled = true; };
  }, [midiOn]);

  // Helpers: color seq
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

  // Painting storage structure: store by idx for swiss / char-grid
  const upsertPaintCell = React.useCallback((idx, patch) => {
    setCells((prev) => {
      const i = prev.findIndex((c) => c.idx === idx);
      const next = [...prev];
      if (i >= 0) next[i] = { ...next[i], ...patch };
      else next.push({ idx, ...patch });
      return next;
    });
  }, []);

  const clearCells = () => setCells([]);

  // Pointer helpers
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

  const getCharGridIdx = (x, y) => {
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
    const pat = sRef.current.pat;
    if (pat === "swiss-grid") return getSwissIdx(x, y);
    if (pat === "char-grid") return getCharGridIdx(x, y);
    return null;
  };

  // Pointer events
  const onPointerDown = async (e) => {
    const pat = sRef.current.pat;
    const interactive = pat === "swiss-grid" || pat === "char-grid";
    if (!interactive) return;

    e.preventDefault?.();
    await wakeAudio(); // IMPORTANT: keep audio alive on touch

    try { e.currentTarget?.setPointerCapture?.(e.pointerId); } catch {}

    const { x, y } = pointerToCanvas(e);
    const idx = getIdx(x, y);
    if (idx == null) return;

    setPainting(true);
    upsertPaintCell(idx, { paint: { color: sRef.current.paintColor } });
  };

  const onPointerMove = (e) => {
    if (!painting) return;
    const pat = sRef.current.pat;
    const interactive = pat === "swiss-grid" || pat === "char-grid";
    if (!interactive) return;

    const { x, y } = pointerToCanvas(e);
    const idx = getIdx(x, y);
    if (idx == null) return;

    upsertPaintCell(idx, { paint: { color: sRef.current.paintColor } });
  };

  const onPointerUp = () => setPainting(false);

  // Resize canvas
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

  // ------------------------------
  // Sequencer loop (does NOT depend on React state)
  // ------------------------------
  const rebuildVoicePoolIfNeeded = React.useCallback(() => {
    const ac = soundCtxRef.current;
    if (!ac) return;
    const want = clamp(sRef.current.soundVoices ?? 10, 1, 32);

    // Keep a pool sized to want. Rebuild only if needed.
    if (voicePoolRef.current.length !== want) {
      // disconnect old
      try {
        voicePoolRef.current.forEach((v) => {
          try { v.amp.disconnect(); } catch {}
        });
      } catch {}

      voicePoolRef.current = Array.from({ length: want }, () => createVoice(ac));
      voicePtrRef.current = 0;

      // connect each voice -> master in
      const master = ensureMasterFX(ac, masterRef.current);
      voicePoolRef.current.forEach((v) => v.amp.connect(master.in));
    }
  }, []);

  const applyFXParams = React.useCallback(() => {
    const ac = soundCtxRef.current;
    if (!ac) return;
    const st = sRef.current;
    const m = ensureMasterFX(ac, masterRef.current);
    const now = ac.currentTime;

    // master gain: simplest: control dry + wet amounts and overall out gain
    m.out.gain.setTargetAtTime(clamp(st.masterGain ?? 0.9, 0, 1), now, 0.02);

    const fxOn = !!st.fxOn;
    const dry = fxOn ? clamp(st.fxDry ?? 0.85, 0, 1) : 1;
    const dMix = fxOn ? clamp(st.fxDelayMix ?? 0.25, 0, 1) : 0;
    const rMix = fxOn ? clamp(st.fxReverbMix ?? 0.18, 0, 1) : 0;

    m.dry.gain.setTargetAtTime(dry, now, 0.02);

    m.delayWet.gain.setTargetAtTime(dMix, now, 0.02);
    m.delay.delayTime.setTargetAtTime(clamp(st.fxDelayTime ?? 0.22, 0, 1.5), now, 0.02);

    // IMPORTANT: clamp feedback so it can't blow up and cause dropouts
    m.feedback.gain.setTargetAtTime(clamp(st.fxDelayFb ?? 0.35, 0, 0.85), now, 0.02);

    m.revWet.gain.setTargetAtTime(rMix, now, 0.02);
  }, []);

  const startSequencer = React.useCallback(async () => {
    await wakeAudio();
    const ac = soundCtxRef.current;
    if (!ac) return;

    rebuildVoicePoolIfNeeded();
    applyFXParams();

    if (seqTimerRef.current) clearInterval(seqTimerRef.current);
    runningRef.current = true;

    const tick = () => {
      const st = sRef.current;
      if (!st.soundOn || st.pat !== "swiss-grid") return;

      // Read live without restarting:
      rebuildVoicePoolIfNeeded();
      applyFXParams();

      const bpm = clamp(st.soundBpm ?? 120, 30, 300);
      // We use setInterval for simplicity; interval is recalculated by restart below when bpm slider changes.
      // But note: changing bpm live is fine — we just restart timer on bpm change effect (see below).

      const cols = st.cols;
      const rows = st.rows;

      const step = stepRef.current;
      const col = step % cols;
      const t = step * 0.25;

      // Build map from painted cells (only paint is stored; if missing, no hit)
      const map = new Map();
      for (const c of cellsRef.current) map.set(c.idx, c);

      // Density factor: paint amount in this column can influence probability
      let paintedInCol = 0;
      for (let r = 0; r < rows; r++) {
        const idx = r * cols + col;
        if (map.get(idx)?.paint) paintedInCol++;
      }
      const colDensity01 = paintedInCol / Math.max(1, rows);

      // MIDI influence
      const midiVel = midiVelRef.current;
      const midiBoost = st.midiAffectsDensity ? lerp(1.0, 1.8, midiVel) : 1.0;

      const probBase = clamp(st.soundDensity ?? 1.0, 0, 3) * midiBoost;
      const prob = clamp(probBase * (0.45 + colDensity01), 0, 1.5); // 0..1.5

      const hits = [];
      for (let r = 0; r < rows; r++) {
        const idx = r * cols + col;
        const cell = map.get(idx);
        if (!cell?.paint?.color) continue;

        // stochastic gate for “density” feel
        if (Math.random() > Math.min(1, prob)) continue;

        const rgb = hexToRgb(cell.paint.color);
        if (!rgb) continue;
        const lum = luminance01(rgb);

        const rowNorm = 1 - r / Math.max(1, rows - 1); // top=1
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

      // Humanize timing (ms)
      const humanMs = clamp(st.soundHumanize ?? 0, 0, 40);
      const now = ac.currentTime;

      for (const h of chosen) {
        const pool = voicePoolRef.current;
        const v = pool[voicePtrRef.current % pool.length];
        voicePtrRef.current++;

        const offset = humanMs > 0 ? (Math.random() * 2 - 1) * (humanMs / 1000) : 0;
        // schedule slightly in future
        const fireAt = now + Math.max(0, offset);

        // set params at fireAt
        v.osc.frequency.setValueAtTime(h.freq, fireAt);
        v.filter.frequency.setValueAtTime(h.cutoff, fireAt);

        v.amp.gain.cancelScheduledValues(fireAt);
        v.amp.gain.setValueAtTime(0.0001, fireAt);
        v.amp.gain.exponentialRampToValueAtTime(h.vel, fireAt + 0.002);
        v.amp.gain.exponentialRampToValueAtTime(0.0001, fireAt + decay);
      }

      stepRef.current++;
    };

    // start timer
    const stepMs = (60 / clamp(sRef.current.soundBpm ?? 120, 30, 300)) * 1000;
    seqTimerRef.current = setInterval(tick, stepMs);
  }, [wakeAudio, rebuildVoicePoolIfNeeded, applyFXParams]);

  const stopSequencer = React.useCallback(() => {
    if (seqTimerRef.current) clearInterval(seqTimerRef.current);
    seqTimerRef.current = null;
    runningRef.current = false;
  }, []);

  // Start/stop based on soundOn + pat
  React.useEffect(() => {
    if (s.soundOn && s.pat === "swiss-grid") startSequencer();
    else stopSequencer();
    return () => stopSequencer();
  }, [s.soundOn, s.pat, startSequencer, stopSequencer]);

  // Restart timer when BPM changes (safe; does NOT kill audio context)
  React.useEffect(() => {
    if (!runningRef.current) return;
    if (!(s.soundOn && s.pat === "swiss-grid")) return;
    startSequencer();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [s.soundBpm]);

  // ------------------------------
  // Render loop
  // ------------------------------
  const render = (tm = 0) => {
    const cv = canvasRef.current;
    if (!cv) return;
    const ctx = cv.getContext("2d");
    const w = cv.width, h = cv.height;

    const st = sRef.current;

    ctx.clearRect(0, 0, w, h);
    ctx.fillStyle = "#FAFAFA";
    ctx.fillRect(0, 0, w, h);

    // visual distortion
    const dist = (x, y, t) => {
      if (!st.distOn) return { x: 0, y: 0 };
      const str = st.distStr ?? 30;
      const tp = st.distType || "liquify";
      const f = 0.008;
      let dx = 0, dy = 0;
      if (tp === "liquify") {
        dx = noise((x + t * 30) * f, y * f) * str;
        dy = noise((x + t * 30) * f + 100, (y + t * 20) * f + 100) * str;
      } else if (tp === "ripple") {
        const d = Math.sqrt(x * x + y * y);
        const r = Math.sin((d - t * 40) * 0.015) * str;
        dx = (x / (d || 1)) * r;
        dy = (y / (d || 1)) * r;
      } else if (tp === "swirl") {
        const a = Math.atan2(y, x);
        const rad = Math.sqrt(x * x + y * y);
        const na = a + t * 0.2 + (str * 0.0008) * (1 / (1 + rad * 0.01));
        dx = Math.cos(na) * rad - x;
        dy = Math.sin(na) * rad - y;
      }
      return { x: dx, y: dy };
    };

    const t = (tm * 0.001) * (st.distSpd ?? 1);
    const ct = (tm * 0.001) * (st.charSpd ?? 1.6);

    // painted cell lookup
    const cellByIdx = new Map();
    for (const c of cellsRef.current) cellByIdx.set(c.idx, c);

    // helpers
    const ink = "#0A0A0A";

    // ----- Patterns -----
    if (st.pat === "vertical-lines") {
      ctx.strokeStyle = ink;
      ctx.lineWidth = st.thick ?? 2;
      for (let x = 0; x < w; x += st.space) {
        ctx.beginPath();
        for (let y = 0; y <= h; y += 2) {
          let dx = x, dy = y;
          const d = dist(x - w / 2, y - h / 2, t);
          dx += d.x; dy += d.y;
          if (y === 0) ctx.moveTo(dx, dy);
          else ctx.lineTo(dx, dy);
        }
        ctx.stroke();
      }
      return;
    }

    if (st.pat === "horizontal-lines") {
      ctx.strokeStyle = ink;
      ctx.lineWidth = st.thick ?? 2;
      for (let y = 0; y < h; y += st.space) {
        ctx.beginPath();
        for (let x = 0; x <= w; x += 2) {
          let dx = x, dy = y;
          const d = dist(x - w / 2, y - h / 2, t);
          dx += d.x; dy += d.y;
          if (x === 0) ctx.moveTo(dx, dy);
          else ctx.lineTo(dx, dy);
        }
        ctx.stroke();
      }
      return;
    }

    if (st.pat === "dots") {
      ctx.fillStyle = ink;
      const ds = 4;
      for (let y = 0; y < h; y += st.space) {
        for (let x = 0; x < w; x += st.space) {
          let dx = x, dy = y;
          const d = dist(x - w / 2, y - h / 2, t);
          dx += d.x; dy += d.y;
          ctx.beginPath();
          ctx.arc(dx, dy, ds, 0, Math.PI * 2);
          ctx.fill();
        }
      }
      return;
    }

    if (st.pat === "squares") {
      ctx.fillStyle = ink;
      const ss = 9;
      for (let y = 0; y < h; y += st.space) {
        for (let x = 0; x < w; x += st.space) {
          let dx = x, dy = y;
          const d = dist(x - w / 2, y - h / 2, t);
          dx += d.x; dy += d.y;
          ctx.fillRect(dx - ss / 2, dy - ss / 2, ss, ss);
        }
      }
      return;
    }

    if (st.pat === "text") {
      ctx.fillStyle = ink;
      ctx.font = `700 ${st.fontSz ?? 56}px ui-sans-serif, system-ui, -apple-system, Segoe UI`;
      ctx.textAlign = "center";
      ctx.textBaseline = "middle";
      for (let y = 0; y < h; y += st.space) {
        for (let x = 0; x < w; x += st.space) {
          let dx = x, dy = y
