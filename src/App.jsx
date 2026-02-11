// App.jsx
import React from "react";
import { Play, Square, RotateCcw, Download } from "lucide-react";

/**
 * FULL, WORKING, SELF-CONTAINED APP:
 * - Swiss grid (rows/cols)
 * - Paint cells with 5-color “color string” palette OR a fixed color
 * - “Span Text” that FILLS CELLS using a text mask (no overlay letter on top)
 * - Simple “Plaits-ish” macro-osc synth that reads painted cells as sequences
 *   Lanes: A=row0, B=row1, C=row2, D=row3
 *   Steps: columns
 *   Pattern: e.g. "ACAB"
 *
 * This is a clean standalone version (so you can build on it).
 * If you need me to merge into your 1400-line file, upload your App.jsx as a file and I’ll return the merged full file.
 */

// ---------------- helpers ----------------
const clamp = (v, a, b) => Math.max(a, Math.min(b, v));
const clamp01 = (v) => clamp(v, 0, 1);

function isHexColor(s) {
  return /^#([0-9a-fA-F]{3}|[0-9a-fA-F]{6})$/.test(s);
}

function hexToRgbObj(hex) {
  if (!hex) return { r: 0, g: 0, b: 0 };
  let h = hex.replace("#", "").trim();
  if (h.length === 3) h = h.split("").map((c) => c + c).join("");
  const n = parseInt(h, 16);
  return { r: (n >> 16) & 255, g: (n >> 8) & 255, b: n & 255 };
}
function rgbDist2(a, b) {
  const dr = a.r - b.r;
  const dg = a.g - b.g;
  const db = a.b - b.b;
  return dr * dr + dg * dg + db * db;
}
function nearestPaletteIndex(hex, palette) {
  const c = hexToRgbObj(hex);
  let best = 0;
  let bestD = Infinity;
  for (let i = 0; i < palette.length; i++) {
    const p = hexToRgbObj(palette[i]);
    const d = rgbDist2(c, p);
    if (d < bestD) {
      bestD = d;
      best = i;
    }
  }
  return best;
}

function midiToHz(m) {
  return 440 * Math.pow(2, (m - 69) / 12);
}

const SCALES = {
  minor: [0, 2, 3, 5, 7, 8, 10],
  major: [0, 2, 4, 5, 7, 9, 11],
  dorian: [0, 2, 3, 5, 7, 9, 10],
  phrygian: [0, 1, 3, 5, 7, 8, 10],
};

function degreeToMidi(baseMidi, degree, scaleName = "minor") {
  const sc = SCALES[scaleName] || SCALES.minor;
  const oct = Math.floor(degree / sc.length);
  const idx = ((degree % sc.length) + sc.length) % sc.length;
  return baseMidi + oct * 12 + sc[idx];
}

// ---------------- SPAN TEXT: fill cells from text mask ----------------
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
  mctx.font = `800 ${fontPx * sc}px ${fontFamily}`;
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

// ---------------- synth (simple “plaits-ish macro osc”) ----------------
function macroWave(timbre01, phase01) {
  const p = phase01 % 1;
  if (timbre01 <= 0.33) {
    return Math.sin(p * Math.PI * 2);
  } else if (timbre01 <= 0.66) {
    return 2 * (p - 0.5);
  } else {
    return p < 0.5 ? 1 : -1;
  }
}

function createMacroOsc(ctx, freqHz, timbre01 = 0.5) {
  const sr = ctx.sampleRate;
  const len = Math.max(256, Math.floor(sr / 60));
  const buf = ctx.createBuffer(1, len, sr);
  const data = buf.getChannelData(0);

  for (let i = 0; i < len; i++) {
    const ph = i / len;
    data[i] = macroWave(timbre01, ph);
  }

  const src = ctx.createBufferSource();
  src.buffer = buf;
  src.loop = true;

  const refHz = 60;
  src.playbackRate.value = freqHz / refHz;
  return src;
}

// ---------------- App ----------------
export default function App() {
  const canvasRef = React.useRef(null);
  const rafRef = React.useRef(null);

  const [panelOpen, setPanelOpen] = React.useState(true);

  // --- grid + paint state ---
  const [grid, setGrid] = React.useState({
    cols: 24,
    rows: 16,
    showLines: true,
    bg: "#FAFAFA",
    line: "#E5E5E5",
  });

  // 5-color palette (color string)
  const [palette, setPalette] = React.useState(["#111111", "#ff0055", "#00c2ff", "#00ff88", "#ffe600"]);

  // cells: Map key "r,c" => { mode:"color"|"seq", color? }
  const [cells, setCells] = React.useState(() => new Map());

  const [paint, setPaint] = React.useState({
    mode: "seq", // "seq" uses palette index cycling, "color" uses paint.color
    color: "#111111",
  });

  // --- span text ---
  const [span, setSpan] = React.useState({
    on: true,
    text: "TYPE",
    row: 4,
    col: 4,
    rows: 4,
    cols: 10,
    align: "center",
    fontScale: 1.2,
    tracking: 0,
    fillColor: "#000000",
    threshold: 0.18,
    maskScale: 2,
  });

  // --- synth ---
  const audioCtxRef = React.useRef(null);
  const synthRef = React.useRef({
    master: null,
    filter: null,
    timer: null,
    step: 0,
    last: 0,
    playing: false,
  });

  const [synth, setSynth] = React.useState({
    on: false,
    pattern: "ACAB",
    bpm: 120,
    stepsPerBar: 24, // set = cols
    baseMidi: 48, // C3
    scale: "minor",
    timbre: 0.55,
    cutoff: 1600,
    resonance: 0.2,
    attack: 0.005,
    decay: 0.08,
    sustain: 0.0,
    release: 0.12,
    volume: 0.25,
  });

  // --- canvas sizing ---
  React.useEffect(() => {
    const resize = () => {
      const cv = canvasRef.current;
      if (!cv) return;
      cv.width = cv.offsetWidth;
      cv.height = cv.offsetHeight;
    };
    resize();
    window.addEventListener("resize", resize);
    window.addEventListener("orientationchange", resize);
    return () => {
      window.removeEventListener("resize", resize);
      window.removeEventListener("orientationchange", resize);
    };
  }, []);

  // --- grid geometry ---
  const getCellRect = React.useCallback(
    (r, c) => {
      const cv = canvasRef.current;
      const w = cv?.width ?? 1;
      const h = cv?.height ?? 1;
      const cw = w / grid.cols;
      const ch = h / grid.rows;
      return { x: c * cw, y: r * ch, w: cw, h: ch, cx: c * cw + cw / 2, cy: r * ch + ch / 2 };
    },
    [grid.cols, grid.rows]
  );

  // --- painting interaction ---
  const pointerToCell = (e) => {
    const cv = canvasRef.current;
    const r = cv.getBoundingClientRect();
    const x = (e.clientX - r.left) * (cv.width / r.width);
    const y = (e.clientY - r.top) * (cv.height / r.height);
    const c = clamp(Math.floor((x / cv.width) * grid.cols), 0, grid.cols - 1);
    const rr = clamp(Math.floor((y / cv.height) * grid.rows), 0, grid.rows - 1);
    return { r: rr, c };
  };

  const [drawing, setDrawing] = React.useState(false);

  const paintCell = (r, c) => {
    const key = `${r},${c}`;
    setCells((prev) => {
      const next = new Map(prev);
      if (paint.mode === "color") {
        next.set(key, { mode: "color", color: paint.color });
      } else {
        // seq: store palette index based on current cell (simple)
        const idx = (r + c) % palette.length;
        next.set(key, { mode: "seq", pi: idx });
      }
      return next;
    });
  };

  const eraseCell = (r, c) => {
    const key = `${r},${c}`;
    setCells((prev) => {
      const next = new Map(prev);
      next.delete(key);
      return next;
    });
  };

  const onPointerDown = (e) => {
    e.preventDefault();
    setDrawing(true);
    const { r, c } = pointerToCell(e);
    if (e.button === 2) eraseCell(r, c);
    else paintCell(r, c);
  };

  const onPointerMove = (e) => {
    if (!drawing) return;
    const { r, c } = pointerToCell(e);
    if (e.buttons === 2) eraseCell(r, c);
    else paintCell(r, c);
  };

  const onPointerUp = () => setDrawing(false);

  // prevent context menu
  React.useEffect(() => {
    const cv = canvasRef.current;
    if (!cv) return;
    cv.oncontextmenu = (e) => e.preventDefault();
  }, []);

  // --- build sequence from painted cells ---
  const buildSequence = React.useCallback(() => {
    const steps = Math.max(4, synth.stepsPerBar);
    const lanes = 4; // A/B/C/D
    const seq = Array.from({ length: lanes }, () => Array.from({ length: steps }, () => null));

    for (let lane = 0; lane < lanes; lane++) {
      const r = lane; // row0..3
      if (r >= grid.rows) continue;
      for (let c = 0; c < Math.min(steps, grid.cols); c++) {
        const key = `${r},${c}`;
        const cell = cells.get(key);
        if (!cell) continue;

        let palIndex = 0;
        if (cell.mode === "color" && cell.color) palIndex = nearestPaletteIndex(cell.color, palette);
        else if (cell.mode === "seq") palIndex = cell.pi ?? 0;

        const degree = palIndex; // 0..4
        const midi = degreeToMidi(synth.baseMidi, degree, synth.scale);
        seq[lane][c] = midi;
      }
    }
    return seq;
  }, [cells, palette, synth.baseMidi, synth.scale, synth.stepsPerBar, grid.rows, grid.cols]);

  // --- synth scheduler effect ---
  React.useEffect(() => {
    const stop = () => {
      const st = synthRef.current;
      st.playing = false;
      if (st.timer) clearInterval(st.timer);
      st.timer = null;
    };

    const start = async () => {
      const st = synthRef.current;
      const ac = audioCtxRef.current || new (window.AudioContext || window.webkitAudioContext)();
      audioCtxRef.current = ac;
      if (ac.state === "suspended") await ac.resume?.();

      if (!st.master) {
        const master = ac.createGain();
        master.gain.value = synth.volume;
        master.connect(ac.destination);

        const filter = ac.createBiquadFilter();
        filter.type = "lowpass";
        filter.frequency.value = synth.cutoff;
        filter.Q.value = synth.resonance * 18;

        filter.connect(master);

        st.master = master;
        st.filter = filter;
      }

      st.master.gain.value = synth.volume;
      st.filter.frequency.value = synth.cutoff;
      st.filter.Q.value = synth.resonance * 18;

      st.step = 0;
      st.last = ac.currentTime;
      st.playing = true;

      const intervalMs = 25;
      st.timer = setInterval(() => {
        if (!st.playing) return;

        const bpm = Math.max(30, synth.bpm);
        const secondsPerBeat = 60 / bpm;
        const stepsPerBar = Math.max(4, synth.stepsPerBar);
        const stepDur = (secondsPerBeat * 4) / stepsPerBar; // 4/4

        const seq = buildSequence();
        const pat = (synth.pattern || "A").toUpperCase().replace(/[^ABCD]/g, "");
        const patArr = pat.length ? pat.split("") : ["A"];
        const laneMap = { A: 0, B: 1, C: 2, D: 3 };

        const ac2 = audioCtxRef.current;
        const ahead = 0.15;

        while (st.last < ac2.currentTime + ahead) {
          const stepIndex = st.step % stepsPerBar;
          const laneChar = patArr[st.step % patArr.length];
          const lane = laneMap[laneChar] ?? 0;

          const midi = seq[lane]?.[stepIndex];
          if (midi != null) {
            const t0 = st.last;
            const freq = midiToHz(midi);

            const osc = createMacroOsc(ac2, freq, synth.timbre);
            const env = ac2.createGain();
            env.gain.value = 0;

            osc.connect(env);
            env.connect(st.filter);

            const a = Math.max(0.001, synth.attack);
            const d = Math.max(0.001, synth.decay);
            const r = Math.max(0.01, synth.release);
            const peak = 0.9;
            const sus = clamp01(synth.sustain);

            env.gain.cancelScheduledValues(t0);
            env.gain.setValueAtTime(0, t0);
            env.gain.linearRampToValueAtTime(peak, t0 + a);
            env.gain.linearRampToValueAtTime(peak * sus, t0 + a + d);
            env.gain.linearRampToValueAtTime(0, t0 + a + d + r);

            osc.start(t0);
            osc.stop(t0 + a + d + r + 0.02);

            osc.onended = () => {
              try {
                osc.disconnect();
              } catch {}
              try {
                env.disconnect();
              } catch {}
            };
          }

          st.step++;
          st.last += stepDur;
        }
      }, intervalMs);
    };

    if (!synth.on) {
      stop();
      return;
    }
    start();
    return () => stop();
  }, [
    synth.on,
    synth.pattern,
    synth.bpm,
    synth.stepsPerBar,
    synth.baseMidi,
    synth.scale,
    synth.timbre,
    synth.cutoff,
    synth.resonance,
    synth.attack,
    synth.decay,
    synth.sustain,
    synth.release,
    synth.volume,
    buildSequence,
  ]);

  // --- draw loop ---
  const draw = React.useCallback(() => {
    const cv = canvasRef.current;
    if (!cv) return;
    const ctx = cv.getContext("2d");
    const w = cv.width;
    const h = cv.height;

    // background
    ctx.fillStyle = grid.bg;
    ctx.fillRect(0, 0, w, h);

    // draw painted cells
    for (let r = 0; r < grid.rows; r++) {
      for (let c = 0; c < grid.cols; c++) {
        const key = `${r},${c}`;
        const cell = cells.get(key);
        if (!cell) continue;

        let col = "#111";
        if (cell.mode === "color" && cell.color) col = cell.color;
        else if (cell.mode === "seq") col = palette[clamp(cell.pi ?? 0, 0, palette.length - 1)];

        const g = getCellRect(r, c);
        ctx.fillStyle = col;
        ctx.globalAlpha = 0.9;
        ctx.fillRect(g.x, g.y, g.w, g.h);
        ctx.globalAlpha = 1;
      }
    }

    // span text fill mode
    if (span.on && span.text) {
      const r0 = clamp(span.row, 0, grid.rows - 1);
      const c0 = clamp(span.col, 0, grid.cols - 1);
      const rN = clamp(r0 + span.rows, r0 + 1, grid.rows);
      const cN = clamp(c0 + span.cols, c0 + 1, grid.cols);

      const g00 = getCellRect(r0, c0);
      const g11 = getCellRect(rN - 1, cN - 1);

      const rx = g00.x;
      const ry = g00.y;
      const rw = g11.x + g11.w - g00.x;
      const rh = g11.y + g11.h - g00.y;

      fillCellsFromTextMask({
        ctx,
        text: span.text,
        region: { x: rx, y: ry, w: rw, h: rh, r0, c0, rN, cN },
        getCellRect,
        fontFamily: `"Inter", system-ui, sans-serif`,
        fontScale: span.fontScale,
        tracking: span.tracking,
        align: span.align,
        fillColor: span.fillColor,
        threshold: span.threshold,
        maskScale: span.maskScale,
      });
    }

    // grid lines
    if (grid.showLines) {
      ctx.strokeStyle = grid.line;
      ctx.lineWidth = 0.5;
      const cw = w / grid.cols;
      const ch = h / grid.rows;
      for (let i = 0; i <= grid.cols; i++) {
        const x = i * cw;
        ctx.beginPath();
        ctx.moveTo(x, 0);
        ctx.lineTo(x, h);
        ctx.stroke();
      }
      for (let i = 0; i <= grid.rows; i++) {
        const y = i * ch;
        ctx.beginPath();
        ctx.moveTo(0, y);
        ctx.lineTo(w, y);
        ctx.stroke();
      }
    }

    // lane labels A/B/C/D on left
    ctx.fillStyle = "#111";
    ctx.font = "600 12px Inter, system-ui, sans-serif";
    ctx.textAlign = "left";
    ctx.textBaseline = "middle";
    const laneNames = ["A", "B", "C", "D"];
    for (let i = 0; i < 4; i++) {
      if (i >= grid.rows) break;
      const g = getCellRect(i, 0);
      ctx.fillText(laneNames[i], 6, g.cy);
    }
  }, [cells, getCellRect, grid, palette, span]);

  React.useEffect(() => {
    const loop = () => {
      draw();
      rafRef.current = requestAnimationFrame(loop);
    };
    rafRef.current = requestAnimationFrame(loop);
    return () => cancelAnimationFrame(rafRef.current);
  }, [draw]);

  // --- actions ---
  const clearAll = () => setCells(new Map());

  const downloadPng = () => {
    const cv = canvasRef.current;
    const a = document.createElement("a");
    a.download = "grid.png";
    a.href = cv.toDataURL("image/png");
    a.click();
  };

  // UI
  return (
    <div className="w-full h-[100svh] bg-white flex flex-col md:flex-row">
      {/* panel */}
      <div
        className={
          "md:w-80 w-full md:h-full border-b md:border-b-0 md:border-r border-neutral-200 bg-neutral-50 p-4 space-y-4 overflow-y-auto " +
          (panelOpen ? "" : "hidden md:block")
        }
      >
        <div className="flex gap-2">
          <button
            onClick={clearAll}
            className="flex-1 flex items-center justify-center gap-2 px-3 py-2 rounded-lg bg-black text-white"
          >
            <RotateCcw size={16} /> Clear
          </button>
          <button
            onClick={downloadPng}
            className="flex-1 flex items-center justify-center gap-2 px-3 py-2 rounded-lg bg-black text-white"
          >
            <Download size={16} /> PNG
          </button>
        </div>

        {/* grid */}
        <div className="space-y-2">
          <div className="text-xs font-semibold uppercase tracking-wider">Grid</div>
          <div className="grid grid-cols-2 gap-2">
            <label className="text-xs">
              Cols: {grid.cols}
              <input
                type="range"
                min="4"
                max="64"
                value={grid.cols}
                onChange={(e) => setGrid((p) => ({ ...p, cols: parseInt(e.target.value) }))}
                className="w-full"
              />
            </label>
            <label className="text-xs">
              Rows: {grid.rows}
              <input
                type="range"
                min="4"
                max="48"
                value={grid.rows}
                onChange={(e) => setGrid((p) => ({ ...p, rows: parseInt(e.target.value) }))}
                className="w-full"
              />
            </label>
          </div>
          <label className="flex items-center gap-2 text-xs">
            <input
              type="checkbox"
              checked={grid.showLines}
              onChange={(e) => setGrid((p) => ({ ...p, showLines: e.target.checked }))}
            />
            Show lines
          </label>
        </div>

        {/* palette */}
        <div className="space-y-2">
          <div className="text-xs font-semibold uppercase tracking-wider">Color string (5)</div>
          <div className="grid grid-cols-5 gap-2">
            {palette.map((c, i) => (
              <input
                key={i}
                type="color"
                value={isHexColor(c) ? c : "#111111"}
                onChange={(e) =>
                  setPalette((p) => {
                    const n = [...p];
                    n[i] = e.target.value;
                    return n;
                  })
                }
                className="h-10 w-full rounded-md border border-neutral-300 bg-white"
              />
            ))}
          </div>
        </div>

        {/* paint mode */}
        <div className="space-y-2">
          <div className="text-xs font-semibold uppercase tracking-wider">Paint</div>
          <div className="grid grid-cols-2 gap-2">
            <button
              onClick={() => setPaint((p) => ({ ...p, mode: "seq" }))}
              className={`px-3 py-2 rounded-lg border text-xs font-semibold ${
                paint.mode === "seq" ? "bg-black text-white border-black" : "bg-white border-neutral-300"
              }`}
            >
              Paint sequence
            </button>
            <button
              onClick={() => setPaint((p) => ({ ...p, mode: "color" }))}
              className={`px-3 py-2 rounded-lg border text-xs font-semibold ${
                paint.mode === "color" ? "bg-black text-white border-black" : "bg-white border-neutral-300"
              }`}
            >
              Paint color
            </button>
          </div>
          {paint.mode === "color" && (
            <div className="flex items-center gap-2">
              <input
                type="color"
                value={paint.color}
                onChange={(e) => setPaint((p) => ({ ...p, color: e.target.value }))}
                className="h-10 w-16 rounded-md border border-neutral-300 bg-white"
              />
              <div className="text-xs text-neutral-600">Right-click to erase</div>
            </div>
          )}
          {paint.mode === "seq" && <div className="text-xs text-neutral-600">Right-click to erase</div>}
        </div>

        {/* span text */}
        <div className="space-y-2">
          <div className="flex items-center justify-between">
            <div className="text-xs font-semibold uppercase tracking-wider">Span text</div>
            <label className="flex items-center gap-2 text-xs">
              <input checked={span.on} onChange={(e) => setSpan((p) => ({ ...p, on: e.target.checked }))} type="checkbox" />
              On
            </label>
          </div>

          <input
            value={span.text}
            onChange={(e) => setSpan((p) => ({ ...p, text: e.target.value }))}
            className="w-full px-3 py-2 rounded-lg border border-neutral-300 bg-white text-xs font-mono"
          />

          <div className="grid grid-cols-2 gap-2">
            <label className="text-xs">
              Row
              <input
                type="number"
                value={span.row}
                min="0"
                onChange={(e) => setSpan((p) => ({ ...p, row: parseInt(e.target.value || "0") }))}
                className="w-full px-2 py-2 rounded-lg border border-neutral-300 bg-white text-xs"
              />
            </label>
            <label className="text-xs">
              Col
              <input
                type="number"
                value={span.col}
                min="0"
                onChange={(e) => setSpan((p) => ({ ...p, col: parseInt(e.target.value || "0") }))}
                className="w-full px-2 py-2 rounded-lg border border-neutral-300 bg-white text-xs"
              />
            </label>
            <label className="text-xs">
              Rows
              <input
                type="number"
                value={span.rows}
                min="1"
                onChange={(e) => setSpan((p) => ({ ...p, rows: parseInt(e.target.value || "1") }))}
                className="w-full px-2 py-2 rounded-lg border border-neutral-300 bg-white text-xs"
              />
            </label>
            <label className="text-xs">
              Cols
              <input
                type="number"
                value={span.cols}
                min="1"
                onChange={(e) => setSpan((p) => ({ ...p, cols: parseInt(e.target.value || "1") }))}
                className="w-full px-2 py-2 rounded-lg border border-neutral-300 bg-white text-xs"
              />
            </label>
          </div>

          <div className="grid grid-cols-2 gap-2">
            <label className="text-xs">
              Align
              <select
                value={span.align}
                onChange={(e) => setSpan((p) => ({ ...p, align: e.target.value }))}
                className="w-full px-2 py-2 rounded-lg border border-neutral-300 bg-white text-xs"
              >
                <option value="left">Left</option>
                <option value="center">Center</option>
              </select>
            </label>

            <label className="text-xs">
              Fill
              <input
                type="color"
                value={span.fillColor}
                onChange={(e) => setSpan((p) => ({ ...p, fillColor: e.target.value }))}
                className="w-full h-10 rounded-md border border-neutral-300 bg-white"
              />
            </label>
          </div>

          <label className="text-xs">
            Font scale: {span.fontScale.toFixed(2)}
            <input
              type="range"
              min="0.5"
              max="2"
              step="0.01"
              value={span.fontScale}
              onChange={(e) => setSpan((p) => ({ ...p, fontScale: parseFloat(e.target.value) }))}
              className="w-full"
            />
          </label>

          <label className="text-xs">
            Threshold: {span.threshold.toFixed(2)}
            <input
              type="range"
              min="0.02"
              max="0.6"
              step="0.01"
              value={span.threshold}
              onChange={(e) => setSpan((p) => ({ ...p, threshold: parseFloat(e.target.value) }))}
              className="w-full"
            />
          </label>

          <label className="text-xs">
            Mask quality: {span.maskScale}×
            <input
              type="range"
              min="1"
              max="4"
              step="1"
              value={span.maskScale}
              onChange={(e) => setSpan((p) => ({ ...p, maskScale: parseInt(e.target.value) }))}
              className="w-full"
            />
          </label>
        </div>

        {/* synth */}
        <div className="space-y-2">
          <div className="flex items-center justify-between">
            <div className="text-xs font-semibold uppercase tracking-wider">Synth</div>
            <button
              onClick={() => setSynth((p) => ({ ...p, on: !p.on }))}
              className={`p-1.5 rounded ${synth.on ? "bg-black text-white" : "bg-neutral-200"}`}
              title="Start/Stop"
            >
              {synth.on ? <Play size={14} fill="white" /> : <Square size={14} />}
            </button>
          </div>

          <div className="grid grid-cols-2 gap-2">
            <label className="text-xs">
              Pattern
              <input
                value={synth.pattern}
                onChange={(e) => setSynth((p) => ({ ...p, pattern: e.target.value }))}
                className="w-full px-2 py-2 rounded-lg border border-neutral-300 bg-white text-xs font-mono"
              />
            </label>
            <label className="text-xs">
              BPM: {synth.bpm}
              <input
                type="range"
                min="60"
                max="200"
                value={synth.bpm}
                onChange={(e) => setSynth((p) => ({ ...p, bpm: parseInt(e.target.value) }))}
                className="w-full"
              />
            </label>
          </div>

          <label className="text-xs">
            Steps/Bar (set = cols): {synth.stepsPerBar}
            <input
              type="range"
              min="4"
              max="64"
              value={synth.stepsPerBar}
              onChange={(e) => setSynth((p) => ({ ...p, stepsPerBar: parseInt(e.target.value) }))}
              className="w-full"
            />
          </label>

          <div className="grid grid-cols-2 gap-2">
            <label className="text-xs">
              Base MIDI
              <input
                type="number"
                min="24"
                max="84"
                value={synth.baseMidi}
                onChange={(e) => setSynth((p) => ({ ...p, baseMidi: parseInt(e.target.value || "48") }))}
                className="w-full px-2 py-2 rounded-lg border border-neutral-300 bg-white text-xs"
              />
            </label>
            <label className="text-xs">
              Scale
              <select
                value={synth.scale}
                onChange={(e) => setSynth((p) => ({ ...p, scale: e.target.value }))}
                className="w-full px-2 py-2 rounded-lg border border-neutral-300 bg-white text-xs"
              >
                <option value="minor">Minor</option>
                <option value="major">Major</option>
                <option value="dorian">Dorian</option>
                <option value="phrygian">Phrygian</option>
              </select>
            </label>
          </div>

          <label className="text-xs">
            Timbre: {synth.timbre.toFixed(2)}
            <input
              type="range"
              min="0"
              max="1"
              step="0.01"
              value={synth.timbre}
              onChange={(e) => setSynth((p) => ({ ...p, timbre: parseFloat(e.target.value) }))}
              className="w-full"
            />
          </label>

          <label className="text-xs">
            Cutoff: {Math.round(synth.cutoff)} Hz
            <input
              type="range"
              min="120"
              max="8000"
              step="10"
              value={synth.cutoff}
              onChange={(e) => setSynth((p) => ({ ...p, cutoff: parseFloat(e.target.value) }))}
              className="w-full"
            />
          </label>

          <label className="text-xs">
            Resonance: {synth.resonance.toFixed(2)}
            <input
              type="range"
              min="0"
              max="0.95"
              step="0.01"
              value={synth.resonance}
              onChange={(e) => setSynth((p) => ({ ...p, resonance: parseFloat(e.target.value) }))}
              className="w-full"
            />
          </label>

          <label className="text-xs">
            Release: {synth.release.toFixed(2)}s
            <input
              type="range"
              min="0.02"
              max="0.8"
              step="0.01"
              value={synth.release}
              onChange={(e) => setSynth((p) => ({ ...p, release: parseFloat(e.target.value) }))}
              className="w-full"
            />
          </label>

          <label className="text-xs">
            Volume: {synth.volume.toFixed(2)}
            <input
              type="range"
              min="0"
              max="1"
              step="0.01"
              value={synth.volume}
              onChange={(e) => setSynth((p) => ({ ...p, volume: parseFloat(e.target.value) }))}
              className="w-full"
            />
          </label>

          <div className="text-[10px] text-neutral-500">
            Lanes: A=row0, B=row1, C=row2, D=row3. Paint notes in those rows.
          </div>
        </div>
      </div>

      {/* canvas */}
      <div className="flex-1 min-h-0 p-2 md:p-6 relative">
        <button
          onClick={() => setPanelOpen((v) => !v)}
          className="md:hidden absolute top-3 left-3 z-20 px-3 py-2 rounded-lg bg-black text-white text-xs font-semibold shadow"
        >
          {panelOpen ? "Hide controls" : "Show controls"}
        </button>

        <canvas
          ref={canvasRef}
          className="w-full h-full rounded-lg shadow-sm touch-none"
          style={{ touchAction: "none" }}
          onPointerDown={onPointerDown}
          onPointerMove={onPointerMove}
          onPointerUp={onPointerUp}
          onPointerLeave={onPointerUp}
          onPointerCancel={onPointerUp}
        />
      </div>
    </div>
  );
}
