// App.jsx
import React from "react";
import { Play, Square, Palette } from "lucide-react";

const clamp = (v, a, b) => Math.max(a, Math.min(b, v));
const lerp = (a, b, t) => a + (b - a) * t;

// ====================== MIDI + AUDIO HELPERS ======================
function midiToFreq(m) {
  return 440 * Math.pow(2, (m - 69) / 12);
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

// ====================== VARIABLE GRID HELPERS ======================
const gaussian = (x, sigma) => {
  const s2 = (sigma * sigma) || 1e-6;
  return Math.exp(-(x * x) / (2 * s2));
};

// Build non-uniform edges [0..1] with denser lines near focus.
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
    const wi = 1 / (1 + st * g); // smaller => denser (more lines)
    w[i] = wi;
    sum += wi;
  }

  const edges = new Array(n + 1);
  edges[0] = 0;
  let acc = 0;
  for (let i = 0; i < n; i++) {
    acc += w[i] / (sum || 1);
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

// ====================== SYNTH + FX ENGINE ======================
function makeDistortionCurve(amount = 0) {
  const k = clamp(amount, 0, 1) * 200;
  const n = 44100;
  const curve = new Float32Array(n);
  const deg = Math.PI / 180;
  for (let i = 0; i < n; i++) {
    const x = (i * 2) / n - 1;
    curve[i] = ((3 + k) * x * 20 * deg) / (Math.PI + k * Math.abs(x));
  }
  return curve;
}

// Simple noise impulse for convolution reverb (rebuild when time/decay changes)
function buildImpulse(ac, timeSec = 1.6, decay = 2.3) {
  const sr = ac.sampleRate;
  const len = Math.max(1, Math.floor(sr * clamp(timeSec, 0.2, 6)));
  const buf = ac.createBuffer(2, len, sr);

  for (let ch = 0; ch < 2; ch++) {
    const data = buf.getChannelData(ch);
    for (let i = 0; i < len; i++) {
      const t = i / len;
      const env = Math.pow(1 - t, clamp(decay, 0.5, 6));
      data[i] = (Math.random() * 2 - 1) * env;
    }
  }
  return buf;
}

// Create master FX graph once and reuse. Store on ac._master
function ensureMasterFX(ac) {
  if (ac._master) return ac._master;

  const input = ac.createGain();
  const master = ac.createGain();

  // Delay send/return
  const delaySend = ac.createGain();
  const delay = ac.createDelay(2.0);
  const feedback = ac.createGain();
  const delayReturn = ac.createGain();

  // Reverb send/return
  const convolver = ac.createConvolver();
  const wet = ac.createGain();
  const dry = ac.createGain();

  // Filter + distortion (post mix)
  const postFilter = ac.createBiquadFilter();
  postFilter.type = "lowpass";
  postFilter.frequency.value = 14000;
  postFilter.Q.value = 0.7;

  const shaper = ac.createWaveShaper();
  shaper.curve = makeDistortionCurve(0);
  shaper.oversample = "2x";

  // wiring
  input.connect(dry);
  input.connect(delaySend);
  input.connect(convolver);

  // delay loop
  delaySend.connect(delay);
  delay.connect(feedback);
  feedback.connect(delay);
  delay.connect(delayReturn);

  // reverb
  convolver.connect(wet);

  // mix
  dry.connect(master);
  wet.connect(master);
  delayReturn.connect(master);

  // post
  master.connect(postFilter);
  postFilter.connect(shaper);
  shaper.connect(ac.destination);

  // defaults
  dry.gain.value = 1;
  wet.gain.value = 0.25;
  delaySend.gain.value = 0.2;
  delay.delayTime.value = 0.18;
  feedback.gain.value = 0.35;
  delayReturn.gain.value = 1;
  master.gain.value = 0.9;

  convolver.buffer = buildImpulse(ac, 1.6, 2.3);

  ac._master = {
    input,
    master,
    dry,
    wet,
    delaySend,
    delay,
    feedback,
    delayReturn,
    convolver,
    postFilter,
    shaper,
  };

  return ac._master;
}

// Voice is oscillator -> filter -> env gain -> master input
function createVoice(ac, fxInput) {
  const osc = ac.createOscillator();
  const filter = ac.createBiquadFilter();
  const vca = ac.createGain();

  osc.type = "sawtooth";
  filter.type = "lowpass";
  filter.frequency.value = 1200;
  filter.Q.value = 0.7;

  vca.gain.value = 0.0001;

  osc.connect(filter);
  filter.connect(vca);
  vca.connect(fxInput);

  osc.start();

  return { osc, filter, vca };
}

// Short env trigger
function triggerVoice(ac, voice, { freq, vel, cutoffHz, q, decaySec }) {
  const now = ac.currentTime;
  const v = clamp(vel, 0.0001, 1);

  voice.osc.frequency.setValueAtTime(freq, now);
  voice.filter.frequency.setTargetAtTime(clamp(cutoffHz, 80, 18000), now, 0.005);
  voice.filter.Q.setTargetAtTime(clamp(q ?? 0.8, 0.1, 18), now, 0.01);

  voice.vca.gain.cancelScheduledValues(now);
  voice.vca.gain.setValueAtTime(v, now);
  voice.vca.gain.exponentialRampToValueAtTime(0.0001, now + clamp(decaySec, 0.02, 2.5));
}

// ====================== APP ======================
export default function App() {
  const canvasRef = React.useRef(null);
  const animRef = React.useRef(null);

  // --- MIDI refs ---
  const midiOnRef = React.useRef(false);
  const midiNoteRef = React.useRef(0);
  const midiVelRef = React.useRef(0);
  const midiCCRef = React.useRef({}); // 0..127 -> 0..1

  // --- Cells ---
  const [cells, setCells] = React.useState([]); // for UI (re-render)
  const cellsRef = React.useRef([]); // for sound/render stable reads
  React.useEffect(() => {
    cellsRef.current = cells;
  }, [cells]);

  // --- Sound engine refs ---
  const soundCtxRef = React.useRef(null);
  const voicePoolRef = React.useRef([]);
  const voicePtrRef = React.useRef(0);
  const clockRef = React.useRef({ running: false, timer: null, step: 0 });
  const fxCacheRef = React.useRef({ revTime: null, revDecay: null });

  // --- Settings ---
  const [s, setS] = React.useState({
    pat: "swiss-grid", // swiss-grid | char-grid

    // character grid
    space: 42,
    charSz: 22,
    chars: "01",
    charSpd: 1.2,

    // swiss grid
    cols: 12,
    rows: 16,
    gridLines: true,
    swissCharScale: 1,

    // variable density
    varColsOn: true,
    colFocus: 1.0,
    colStrength: 0.0,
    colSigma: 0.5,

    varRowsOn: true,
    rowFocus: 1.0,
    rowStrength: 20.0,
    rowSigma: 0.5,

    // paint
    paintColor: "#111111",

    // ===== GRID SOUND =====
    soundOn: true,
    soundBpm: 120,
    soundSwing: 0.0, // 0..0.5
    soundDecay: 0.18,
    soundRoot: 48, // MIDI
    soundSpan: 24, // semitones up from root
    soundVoices: 10,
    soundMaxNotesPerStep: 8,

    // brightness -> timbre
    soundCutoffBase: 500,
    soundCutoffSpan: 7000,
    soundReso: 0.9,

    // variable columns -> timing influence
    timeByCol: 0.8, // 0..1 (how much col width changes timing)

    // ===== FX =====
    fxMaster: 0.9,
    fxDelayMix: 0.22,
    fxDelayTime: 0.18,
    fxDelayFb: 0.35,

    fxReverbMix: 0.25,
    fxReverbTime: 1.6,
    fxReverbDecay: 2.3,

    fxDrive: 0.0, // distortion amount 0..1
    fxPostCutoff: 14000, // post lowpass
  });

  const sRef = React.useRef(s);
  React.useEffect(() => {
    sRef.current = s;
  }, [s]);

  // --- MIDI setup ---
  const [midiEnabled, setMidiEnabled] = React.useState(false);
  React.useEffect(() => {
    midiOnRef.current = midiEnabled;
    if (!midiEnabled) {
      midiNoteRef.current = 0;
      midiVelRef.current = 0;
      midiCCRef.current = {};
      return;
    }
    let cancelled = false;

    navigator
      .requestMIDIAccess?.()
      .then((acc) => {
        if (cancelled) return;
        for (const inp of acc.inputs.values()) {
          inp.onmidimessage = (e) => {
            const [st, d1, d2] = e.data;
            const msg = st >> 4;

            // note on
            if (msg === 9 && d2 > 0) {
              midiNoteRef.current = d1;
              midiVelRef.current = d2 / 127;
            }
            // note off
            if (msg === 8 || (msg === 9 && d2 === 0)) {
              midiVelRef.current = 0;
            }
            // CC
            if (msg === 11) {
              midiCCRef.current[d1] = (d2 ?? 0) / 127;
            }
          };
        }
      })
      .catch(() => {
        // ignore
      });

    return () => {
      cancelled = true;
    };
  }, [midiEnabled]);

  // --- Variable edges for swiss grid ---
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

  // --- Geometry helpers ---
  const swissCellGeom = React.useCallback(
    (r, c, w, h) => {
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
        x01: (ce[c] + ce[c + 1]) * 0.5,
        y01: (re[r] + re[r + 1]) * 0.5,
        colWidth01: ce[c + 1] - ce[c],
        rowHeight01: re[r + 1] - re[r],
      };
    },
    [colEdges, rowEdges, s.cols, s.rows]
  );

  const pointerToCanvas = (e) => {
    const cv = canvasRef.current;
    const r = cv.getBoundingClientRect();
    const x = (e.clientX - r.left) * (cv.width / r.width);
    const y = (e.clientY - r.top) * (cv.height / r.height);
    return { x, y };
  };

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
      const cols = Math.max(1, Math.floor(cv.width / s.space));
      const rows = Math.max(1, Math.floor(cv.height / s.space));
      const c = Math.floor(cx / s.space);
      const r = Math.floor(cy / s.space);
      if (c < 0 || r < 0 || c >= cols || r >= rows) return null;
      return r * cols + c;
    },
    [s.space]
  );

  const getIdx = React.useCallback(
    (cx, cy) => {
      if (s.pat === "swiss-grid") return getSwissIdx(cx, cy);
      return getCharGridIdx(cx, cy);
    },
    [s.pat, getSwissIdx, getCharGridIdx]
  );

  // --- paint interaction (drag paint) ---
  const [painting, setPainting] = React.useState(false);

  const upsertPaintCell = (idx, patch) => {
    setCells((prev) => {
      const i = prev.findIndex((x) => x.idx === idx);
      if (i >= 0) {
        const next = [...prev];
        next[i] = { ...next[i], ...patch };
        return next;
      }
      return [...prev, { idx, ...patch }];
    });
  };

  const removeCell = (idx) => setCells((prev) => prev.filter((x) => x.idx !== idx));

  const onPointerDown = (e) => {
    e.preventDefault?.();
    try {
      e.currentTarget?.setPointerCapture?.(e.pointerId);
    } catch {}

    const { x, y } = pointerToCanvas(e);
    const idx = getIdx(x, y);
    if (idx == null) return;

    setPainting(true);
    upsertPaintCell(idx, { paint: { mode: "color", color: sRef.current.paintColor } });
  };

  const onPointerMove = (e) => {
    if (!painting) return;
    const { x, y } = pointerToCanvas(e);
    const idx = getIdx(x, y);
    if (idx == null) return;
    upsertPaintCell(idx, { paint: { mode: "color", color: sRef.current.paintColor } });
  };

  const onPointerUp = () => setPainting(false);

  // ====================== SOUND SCHEDULER (NO RESTART ON PAINT) ======================
  React.useEffect(() => {
    const stt = sRef.current;
    if (!stt.soundOn) {
      // stop
      if (clockRef.current.timer) clearTimeout(clockRef.current.timer);
      clockRef.current = { running: false, timer: null, step: 0 };
      return;
    }

    // start audio context
    if (!soundCtxRef.current) {
      soundCtxRef.current = new (window.AudioContext || window.webkitAudioContext)();
    }
    const ac = soundCtxRef.current;
    if (ac.state === "suspended") ac.resume?.();

    // ensure FX exists
    const fx = ensureMasterFX(ac);

    // build/resize voice pool (depends on voices only)
    const ensureVoices = () => {
      const want = clamp(sRef.current.soundVoices ?? 10, 1, 32);
      if (voicePoolRef.current.length !== want) {
        // disconnect old
        try {
          voicePoolRef.current.forEach((v) => {
            try {
              v.vca.disconnect();
            } catch {}
          });
        } catch {}
        voicePoolRef.current = Array.from({ length: want }, () => createVoice(ac, fx.input));
        voicePtrRef.current = 0;
      }
    };

    ensureVoices();

    clockRef.current.running = true;

    const tick = () => {
      if (!clockRef.current.running) return;

      const st = sRef.current;
      ensureVoices();

      // --- realtime FX updates (EVERY tick) ---
      const now = ac.currentTime;

      // master gain
      fx.master.gain.setTargetAtTime(clamp(st.fxMaster ?? 0.9, 0, 1.5), now, 0.02);

      // post cutoff + drive
      fx.postFilter.frequency.setTargetAtTime(clamp(st.fxPostCutoff ?? 14000, 200, 20000), now, 0.02);
      fx.shaper.curve = makeDistortionCurve(clamp(st.fxDrive ?? 0, 0, 1));

      // delay
      fx.delaySend.gain.setTargetAtTime(clamp(st.fxDelayMix ?? 0.22, 0, 1), now, 0.02);
      fx.delay.delayTime.setTargetAtTime(clamp(st.fxDelayTime ?? 0.18, 0, 1.5), now, 0.02);
      fx.feedback.gain.setTargetAtTime(clamp(st.fxDelayFb ?? 0.35, 0, 0.95), now, 0.02);

      // reverb wet
      fx.wet.gain.setTargetAtTime(clamp(st.fxReverbMix ?? 0.25, 0, 1), now, 0.02);

      // rebuild convolver impulse only when needed
      const rt = clamp(st.fxReverbTime ?? 1.6, 0.2, 6);
      const rd = clamp(st.fxReverbDecay ?? 2.3, 0.5, 6);
      if (fxCacheRef.current.revTime !== rt || fxCacheRef.current.revDecay !== rd) {
        fx.convolver.buffer = buildImpulse(ac, rt, rd);
        fxCacheRef.current.revTime = rt;
        fxCacheRef.current.revDecay = rd;
      }

      // --- MIDI CC modulation (optional, realtime) ---
      const cc = midiCCRef.current;
      const cc91 = clamp(cc[91] ?? 0, 0, 1); // reverb mix
      const cc94 = clamp(cc[94] ?? 0, 0, 1); // delay mix
      const cc74 = clamp(cc[74] ?? 0, 0, 1); // cutoff
      const cc71 = clamp(cc[71] ?? 0, 0, 1); // resonance

      // apply CC as multipliers (so UI still works)
      fx.wet.gain.setTargetAtTime(clamp((st.fxReverbMix ?? 0.25) * (0.4 + 0.9 * cc91), 0, 1), now, 0.02);
      fx.delaySend.gain.setTargetAtTime(clamp((st.fxDelayMix ?? 0.22) * (0.4 + 0.9 * cc94), 0, 1), now, 0.02);

      // --- Sequencer step ---
      const isSwiss = st.pat === "swiss-grid";
      const cols = isSwiss ? st.cols : null;

      const step = clockRef.current.step;

      // base step duration from BPM (16th-ish)
      const bpm = clamp(st.soundBpm ?? 120, 30, 300);
      const baseStepSec = (60 / bpm) * 0.25;

      // swing: alternate steps longer/shorter
      const swing = clamp(st.soundSwing ?? 0, 0, 0.5);
      const swingMul = step % 2 === 0 ? (1 + swing) : (1 - swing);

      // variable column width affects timing in swiss mode
      let colMul = 1.0;
      if (isSwiss && colEdges) {
        const c = step % st.cols;
        const w01 = (colEdges[c + 1] - colEdges[c]) * st.cols; // avg=1
        const amt = clamp(st.timeByCol ?? 0.8, 0, 1);
        colMul = lerp(1, clamp(w01, 0.4, 2.2), amt);
      }

      const stepSec = baseStepSec * swingMul * colMul;

      // Build a fast lookup of painted cells (only)
      const map = new Map();
      for (const c of cellsRef.current) map.set(c.idx, c);

      const maxNotes = clamp(st.soundMaxNotesPerStep ?? 8, 1, 32);
      const decay = clamp(st.soundDecay ?? 0.18, 0.02, 2.5);

      // collect hits
      const hits = [];

      if (isSwiss) {
        const col = step % st.cols;

        for (let r = 0; r < st.rows; r++) {
          const idx = r * st.cols + col;
          const cell = map.get(idx);
          if (!cell?.paint || cell.paint.mode !== "color") continue;

          const rgb = hexToRgb(cell.paint.color);
          if (!rgb) continue;

          const lum = luminance01(rgb); // 0..1
          const g = swissCellGeom(r, col, 1, 1); // normalized geometry (w/h=1)
          // IMPORTANT: variable ROW density affects pitch mapping by y01 center
          const y01 = g.y01; // 0..1 top->bottom

          // pitch: higher at top
          const pitchPos = 1 - y01;
          const note = (st.soundRoot ?? 48) + Math.floor(pitchPos * clamp(st.soundSpan ?? 24, 1, 60));
          const freq = midiToFreq(note);

          // velocity from luminance + MIDI velocity (if held)
          const mVel = midiVelRef.current || 0;
          const vel = clamp(0.08 + 0.92 * (0.7 * lum + 0.3 * pitchPos) * (0.6 + 0.8 * mVel), 0.03, 1);

          // cutoff uses brightness and optional CC74
          const cutoffBase = st.soundCutoffBase ?? 500;
          const cutoffSpan = st.soundCutoffSpan ?? 7000;
          const cutoff = cutoffBase + cutoffSpan * clamp(lum * (0.5 + 1.2 * cc74), 0, 1);

          // resonance uses UI + CC71
          const q = clamp((st.soundReso ?? 0.9) * (0.5 + 1.5 * cc71), 0.1, 18);

          hits.push({ freq, vel, cutoff, q });
        }
      } else {
        // char-grid mode: scan current step column across computed grid
        const cv = canvasRef.current;
        if (cv) {
          const w = cv.width;
          const h = cv.height;
          const cols2 = Math.max(1, Math.floor(w / st.space));
          const rows2 = Math.max(1, Math.floor(h / st.space));
          const col = step % cols2;

          for (let r = 0; r < rows2; r++) {
            const idx = r * cols2 + col;
            const cell = map.get(idx);
            if (!cell?.paint || cell.paint.mode !== "color") continue;

            const rgb = hexToRgb(cell.paint.color);
            if (!rgb) continue;

            const lum = luminance01(rgb);
            const pitchPos = 1 - r / Math.max(1, rows2 - 1);
            const note = (st.soundRoot ?? 48) + Math.floor(pitchPos * clamp(st.soundSpan ?? 24, 1, 60));
            const freq = midiToFreq(note);

            const mVel = midiVelRef.current || 0;
            const vel = clamp(0.08 + 0.92 * (0.75 * lum + 0.25 * pitchPos) * (0.6 + 0.8 * mVel), 0.03, 1);

            const cutoff = (st.soundCutoffBase ?? 500) + (st.soundCutoffSpan ?? 7000) * clamp(lum * (0.5 + 1.2 * cc74), 0, 1);
            const q = clamp((st.soundReso ?? 0.9) * (0.5 + 1.5 * cc71), 0.1, 18);

            hits.push({ freq, vel, cutoff, q });
          }
        }
      }

      // pick loudest
      hits.sort((a, b) => b.vel - a.vel);
      const chosen = hits.slice(0, maxNotes);

      for (const h of chosen) {
        const pool = voicePoolRef.current;
        const v = pool[voicePtrRef.current % pool.length];
        voicePtrRef.current++;
        triggerVoice(ac, v, { freq: h.freq, vel: h.vel, cutoffHz: h.cutoff, q: h.q, decaySec: decay });
      }

      clockRef.current.step++;

      // schedule next tick using setTimeout so BPM changes are realtime
      clockRef.current.timer = setTimeout(tick, stepSec * 1000);
    };

    // start
    if (clockRef.current.timer) clearTimeout(clockRef.current.timer);
    clockRef.current.timer = setTimeout(tick, 0);

    return () => {
      if (clockRef.current.timer) clearTimeout(clockRef.current.timer);
      clockRef.current = { running: false, timer: null, step: 0 };
    };
    // IMPORTANT: do NOT depend on `cells`
  }, [s.soundOn]);

  // also rebuild voice pool when voices changes (safe)
  React.useEffect(() => {
    const ac = soundCtxRef.current;
    if (!ac) return;
    ensureMasterFX(ac);
    // voices will be ensured inside tick; this is optional
  }, [s.soundVoices]);

  // ====================== RENDER LOOP ======================
  const render = (t = 0) => {
    const cv = canvasRef.current;
    if (!cv) return;
    const ctx = cv.getContext("2d");
    const w = cv.width;
    const h = cv.height;

    ctx.clearRect(0, 0, w, h);
    ctx.fillStyle = "#FAFAFA";
    ctx.fillRect(0, 0, w, h);

    const st = sRef.current;
    const map = new Map();
    for (const c of cellsRef.current) map.set(c.idx, c);

    ctx.fillStyle = "#111";

    if (st.pat === "char-grid") {
      const cols = Math.max(1, Math.floor(w / st.space));
      const rows = Math.max(1, Math.floor(h / st.space));
      const chs = (st.chars || "01").split("");
      const tt = (t * 0.001) * (st.charSpd || 1);

      ctx.textAlign = "center";
      ctx.textBaseline = "middle";
      ctx.font = `${st.charSz}px ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, "Liberation Mono", "Courier New", monospace`;

      for (let r = 0; r < rows; r++) {
        for (let c = 0; c < cols; c++) {
          const idx = r * cols + c;
          const x0 = c * st.space;
          const y0 = r * st.space;
          const cx = x0 + st.space / 2;
          const cy = y0 + st.space / 2;

          const paint = map.get(idx)?.paint;
          if (paint?.mode === "color") {
            ctx.save();
            ctx.fillStyle = paint.color;
            ctx.globalAlpha = 0.9;
            ctx.fillRect(x0, y0, st.space, st.space);
            ctx.restore();
          }

          const gi = chs.length ? (Math.floor(tt * 2) + r + c) % chs.length : 0;

          ctx.fillStyle = "#111";
          ctx.fillText(chs[gi] ?? "0", cx, cy);
        }
      }
      return;
    }

    // swiss grid
    const ce = colEdges || Array.from({ length: st.cols + 1 }, (_, i) => i / st.cols);
    const re = rowEdges || Array.from({ length: st.rows + 1 }, (_, i) => i / st.rows);

    // grid lines
    if (st.gridLines) {
      ctx.strokeStyle = "#E5E5E5";
      ctx.lineWidth = 0.6;
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

    const chs = (st.chars || "01").split("");
    const tt = (t * 0.001) * (st.charSpd || 1);

    for (let r = 0; r < st.rows; r++) {
      for (let c = 0; c < st.cols; c++) {
        const idx = r * st.cols + c;
        const g = swissCellGeom(r, c, w, h);

        const paint = map.get(idx)?.paint;
        if (paint?.mode === "color") {
          ctx.save();
          ctx.fillStyle = paint.color;
          ctx.globalAlpha = 0.9;
          ctx.fillRect(g.x, g.y, g.w, g.h);
          ctx.restore();
        }

        // letter
        const baseSz = Math.min(g.w, g.h) * 0.55 * (st.swissCharScale || 1);
        ctx.font = `${Math.max(10, baseSz)}px ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, "Liberation Mono", "Courier New", monospace`;
        ctx.textAlign = "center";
        ctx.textBaseline = "middle";
        ctx.fillStyle = "#111";

        const gi = chs.length ? (Math.floor(tt * 2) + r + c) % chs.length : 0;
        ctx.fillText(chs[gi] ?? "0", g.cx, g.cy);
      }
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
  }, [colEdges, rowEdges]);

  // canvas resize
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

  // ====================== UI ======================
  const toggleSound = async () => {
    setS((p) => ({ ...p, soundOn: !p.soundOn }));
    // wake context on first user gesture
    if (!soundCtxRef.current) {
      soundCtxRef.current = new (window.AudioContext || window.webkitAudioContext)();
      ensureMasterFX(soundCtxRef.current);
      try {
        await soundCtxRef.current.resume?.();
      } catch {}
    } else {
      try {
        await soundCtxRef.current.resume?.();
      } catch {}
    }
  };

  return (
    <div className="w-full h-[100svh] bg-white flex flex-col md:flex-row">
      {/* Controls */}
      <div className="w-full md:w-80 bg-neutral-50 border-b md:border-b-0 md:border-r border-neutral-200 p-4 md:p-5 overflow-y-auto space-y-4 text-sm">
        <div className="flex items-center justify-between gap-2">
          <div className="text-xs font-semibold uppercase tracking-wider">Pattern</div>
          <select
            value={s.pat}
            onChange={(e) => setS((p) => ({ ...p, pat: e.target.value }))}
            className="px-3 py-2 bg-white border border-neutral-300 rounded-lg text-xs"
          >
            <option value="swiss-grid">Swiss Grid</option>
            <option value="char-grid">Character Grid</option>
          </select>
        </div>

        {/* Paint */}
        <div className="space-y-2">
          <div className="text-xs font-semibold uppercase tracking-wider flex items-center gap-2">
            <Palette size={14} /> Paint Color
          </div>
          <div className="flex items-center gap-2">
            <input
              type="color"
              value={s.paintColor}
              onChange={(e) => setS((p) => ({ ...p, paintColor: e.target.value }))}
              className="h-10 w-16 rounded-md border border-neutral-300 bg-white"
            />
            <button
              onClick={() => setCells([])}
              className="flex-1 px-3 py-2 rounded-lg bg-neutral-900 text-white text-xs font-semibold min-h-[40px]"
            >
              Clear Painted Cells
            </button>
          </div>
        </div>

        {/* Characters */}
        <div className="space-y-2">
          <div className="text-xs font-semibold uppercase tracking-wider">Characters</div>
          <input
            value={s.chars}
            onChange={(e) => setS((p) => ({ ...p, chars: e.target.value }))}
            className="w-full px-3 py-2 bg-white border border-neutral-300 rounded-lg font-mono"
          />
          <label className="block text-xs font-semibold uppercase tracking-wider">
            Char Speed: {s.charSpd.toFixed(2)}×
          </label>
          <input
            type="range"
            min="0"
            max="6"
            step="0.05"
            value={s.charSpd}
            onChange={(e) => setS((p) => ({ ...p, charSpd: parseFloat(e.target.value) }))}
            className="w-full"
          />
        </div>

        {/* Char-grid controls */}
        {s.pat === "char-grid" && (
          <div className="space-y-2">
            <label className="block text-xs font-semibold uppercase tracking-wider">
              Cell Size: {s.space}px
            </label>
            <input
              type="range"
              min="16"
              max="120"
              value={s.space}
              onChange={(e) => setS((p) => ({ ...p, space: parseInt(e.target.value) }))}
              className="w-full"
            />
            <label className="block text-xs font-semibold uppercase tracking-wider">
              Font Size: {s.charSz}px
            </label>
            <input
              type="range"
              min="10"
              max="80"
              value={s.charSz}
              onChange={(e) => setS((p) => ({ ...p, charSz: parseInt(e.target.value) }))}
              className="w-full"
            />
          </div>
        )}

        {/* Swiss controls */}
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
                <div className="text-xs text-neutral-700">Grid Lines</div>
                <input
                  type="checkbox"
                  checked={s.gridLines}
                  onChange={(e) => setS((p) => ({ ...p, gridLines: e.target.checked }))}
                />
              </div>
            </div>

            {/* Variable density */}
            <div className="space-y-2">
              <div className="text-xs font-semibold uppercase tracking-wider">Variable Grid Density</div>

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

        {/* Sound */}
        <div className="space-y-2">
          <div className="flex items-center justify-between">
            <div className="text-xs font-semibold uppercase tracking-wider">Grid Sound</div>
            <button
              onClick={toggleSound}
              className={`p-1.5 rounded ${s.soundOn ? "bg-black text-white" : "bg-neutral-200"}`}
              title="Toggle sound"
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

          <label className="block text-xs font-semibold uppercase tracking-wider">
            Swing: {s.soundSwing.toFixed(2)}
          </label>
          <input
            type="range"
            min="0"
            max="0.5"
            step="0.01"
            value={s.soundSwing}
            onChange={(e) => setS((p) => ({ ...p, soundSwing: parseFloat(e.target.value) }))}
            className="w-full"
          />

          <label className="block text-xs font-semibold uppercase tracking-wider">
            Decay: {s.soundDecay.toFixed(2)}s
          </label>
          <input
            type="range"
            min="0.03"
            max="1.5"
            step="0.01"
            value={s.soundDecay}
            onChange={(e) => setS((p) => ({ ...p, soundDecay: parseFloat(e.target.value) }))}
            className="w-full"
          />

          <label className="block text-xs font-semibold uppercase tracking-wider">
            Root Note (MIDI): {s.soundRoot}
          </label>
          <input
            type="range"
            min="24"
            max="72"
            value={s.soundRoot}
            onChange={(e) => setS((p) => ({ ...p, soundRoot: parseInt(e.target.value) }))}
            className="w-full"
          />

          <label className="block text-xs font-semibold uppercase tracking-wider">
            Pitch Span: {s.soundSpan} st
          </label>
          <input
            type="range"
            min="6"
            max="60"
            value={s.soundSpan}
            onChange={(e) => setS((p) => ({ ...p, soundSpan: parseInt(e.target.value) }))}
            className="w-full"
          />

          <label className="block text-xs font-semibold uppercase tracking-wider">Voices: {s.soundVoices}</label>
          <input
            type="range"
            min="1"
            max="24"
            value={s.soundVoices}
            onChange={(e) => setS((p) => ({ ...p, soundVoices: parseInt(e.target.value) }))}
            className="w-full"
          />

          <label className="block text-xs font-semibold uppercase tracking-wider">
            Max notes / step: {s.soundMaxNotesPerStep}
          </label>
          <input
            type="range"
            min="1"
            max="24"
            value={s.soundMaxNotesPerStep}
            onChange={(e) => setS((p) => ({ ...p, soundMaxNotesPerStep: parseInt(e.target.value) }))}
            className="w-full"
          />

          {s.pat === "swiss-grid" && (
            <>
              <label className="block text-xs font-semibold uppercase tracking-wider">
                Timing reacts to column widths: {s.timeByCol.toFixed(2)}
              </label>
              <input
                type="range"
                min="0"
                max="1"
                step="0.01"
                value={s.timeByCol}
                onChange={(e) => setS((p) => ({ ...p, timeByCol: parseFloat(e.target.value) }))}
                className="w-full"
              />
            </>
          )}
        </div>

        {/* FX */}
        <div className="space-y-2">
          <div className="text-xs font-semibold uppercase tracking-wider">FX</div>

          <label className="block text-xs font-semibold uppercase tracking-wider">Master: {s.fxMaster.toFixed(2)}</label>
          <input
            type="range"
            min="0"
            max="1.5"
            step="0.01"
            value={s.fxMaster}
            onChange={(e) => setS((p) => ({ ...p, fxMaster: parseFloat(e.target.value) }))}
            className="w-full"
          />

          <div className="grid grid-cols-2 gap-3">
            <div className="space-y-2">
              <div className="text-xs font-semibold uppercase tracking-wider">Delay</div>
              <label className="block text-xs">Mix: {s.fxDelayMix.toFixed(2)}</label>
              <input
                type="range"
                min="0"
                max="1"
                step="0.01"
                value={s.fxDelayMix}
                onChange={(e) => setS((p) => ({ ...p, fxDelayMix: parseFloat(e.target.value) }))}
                className="w-full"
              />
              <label className="block text-xs">Time: {s.fxDelayTime.toFixed(2)}s</label>
              <input
                type="range"
                min="0"
                max="1.5"
                step="0.01"
                value={s.fxDelayTime}
                onChange={(e) => setS((p) => ({ ...p, fxDelayTime: parseFloat(e.target.value) }))}
                className="w-full"
              />
              <label className="block text-xs">Feedback: {s.fxDelayFb.toFixed(2)}</label>
              <input
                type="range"
                min="0"
                max="0.95"
                step="0.01"
                value={s.fxDelayFb}
                onChange={(e) => setS((p) => ({ ...p, fxDelayFb: parseFloat(e.target.value) }))}
                className="w-full"
              />
            </div>

            <div className="space-y-2">
              <div className="text-xs font-semibold uppercase tracking-wider">Reverb</div>
              <label className="block text-xs">Mix: {s.fxReverbMix.toFixed(2)}</label>
              <input
                type="range"
                min="0"
                max="1"
                step="0.01"
                value={s.fxReverbMix}
                onChange={(e) => setS((p) => ({ ...p, fxReverbMix: parseFloat(e.target.value) }))}
                className="w-full"
              />
              <label className="block text-xs">Time: {s.fxReverbTime.toFixed(2)}s</label>
              <input
                type="range"
                min="0.2"
                max="6"
                step="0.01"
                value={s.fxReverbTime}
                onChange={(e) => setS((p) => ({ ...p, fxReverbTime: parseFloat(e.target.value) }))}
                className="w-full"
              />
              <label className="block text-xs">Decay: {s.fxReverbDecay.toFixed(2)}</label>
              <input
                type="range"
                min="0.5"
                max="6"
                step="0.01"
                value={s.fxReverbDecay}
                onChange={(e) => setS((p) => ({ ...p, fxReverbDecay: parseFloat(e.target.value) }))}
                className="w-full"
              />
            </div>
          </div>

          <label className="block text-xs font-semibold uppercase tracking-wider">Drive: {s.fxDrive.toFixed(2)}</label>
          <input
            type="range"
            min="0"
            max="1"
            step="0.01"
            value={s.fxDrive}
            onChange={(e) => setS((p) => ({ ...p, fxDrive: parseFloat(e.target.value) }))}
            className="w-full"
          />

          <label className="block text-xs font-semibold uppercase tracking-wider">
            Post Cutoff: {Math.round(s.fxPostCutoff)} Hz
          </label>
          <input
            type="range"
            min="300"
            max="20000"
            step="10"
            value={s.fxPostCutoff}
            onChange={(e) => setS((p) => ({ ...p, fxPostCutoff: parseFloat(e.target.value) }))}
            className="w-full"
          />
        </div>

        {/* MIDI */}
        <div className="space-y-2">
          <div className="flex items-center justify-between">
            <div className="text-xs font-semibold uppercase tracking-wider">MIDI</div>
            <button
              onClick={() => setMidiEnabled((v) => !v)}
              className={`p-1.5 rounded ${midiEnabled ? "bg-black text-white" : "bg-neutral-200"}`}
            >
              {midiEnabled ? <Play size={14} fill="white" /> : <Square size={14} />}
            </button>
          </div>
          {midiEnabled && (
            <div className="text-[11px] text-neutral-600 space-y-1">
              <div>Note: {midiNoteRef.current || "—"} | Vel: {(midiVelRef.current || 0).toFixed(2)}</div>
              <div>CC91=reverb, CC94=delay, CC74=cutoff, CC71=reso</div>
            </div>
          )}
        </div>
      </div>

      {/* Canvas */}
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
          style={{ touchAction: "none" }}
        />
      </div>
    </div>
  );
}
