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

const clamp = (v, a, b) => Math.max(a, Math.min(b, v));
const lerp = (a, b, t) => a + (b - a) * t;

// --- BPM detection (autocorrelation over time-domain) ---
function detectBpmFromFloatBuffer(floatBuf, sampleRate, minBpm = 60, maxBpm = 200) {
  // Remove DC
  let mean = 0;
  for (let i = 0; i < floatBuf.length; i++) mean += floatBuf[i];
  mean /= floatBuf.length;

  const buf = new Float32Array(floatBuf.length);
  for (let i = 0; i < floatBuf.length; i++) buf[i] = floatBuf[i] - mean;

  // Energy gate (avoid false positives in silence)
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

// ---- non-uniform grid edges (density warp) ----
// Produces edges [0..size] length count+1
function buildWarpedEdges(count, size, on, center = 0.5, strength = 2, width = 0.25) {
  const n = Math.max(1, count | 0);
  const edges = new Float32Array(n + 1);
  edges[0] = 0;
  if (!on || n === 1) {
    for (let i = 1; i <= n; i++) edges[i] = (i / n) * size;
    return edges;
  }

  const c = clamp(center, 0, 1);
  const k = Math.max(0, strength);
  const sig = Math.max(0.03, Math.min(0.75, width)); // avoid 0
  // We want denser near center => smaller cells near center
  // weight(u) bigger near center, then cellWidth ~ 1/weight
  const invWidths = new Float32Array(n);
  let sum = 0;

  for (let i = 0; i < n; i++) {
    const mid = (i + 0.5) / n;
    const d = (mid - c) / sig;
    const bump = Math.exp(-0.5 * d * d); // 0..1
    const weight = 1 + k * bump; // 1..1+k
    const inv = 1 / weight; // smaller near center
    invWidths[i] = inv;
    sum += inv;
  }

  let acc = 0;
  for (let i = 0; i < n; i++) {
    acc += invWidths[i] / sum;
    edges[i + 1] = acc * size;
  }
  edges[n] = size; // snap
  return edges;
}

function findBin(edges, v) {
  // edges: Float32Array length n+1
  const n = edges.length - 1;
  if (v < edges[0] || v > edges[n]) return null;
  // binary search
  let lo = 0, hi = n - 1;
  while (lo <= hi) {
    const mid = (lo + hi) >> 1;
    const a = edges[mid];
    const b = edges[mid + 1];
    if (v < a) hi = mid - 1;
    else if (v >= b) lo = mid + 1;
    else return mid;
  }
  return null;
}

export default function App() {
  const canvasRef = React.useRef(null);
  const animRef = React.useRef(null);

  const audioCtxRef = React.useRef(null);
  const analyserRef = React.useRef(null);
  const audioElRef = React.useRef(null);
  const mediaElSrcRef = React.useRef(null);
  const micStreamRef = React.useRef(null);
  const midiVelRef = React.useRef(0);

  const midiNoteRef = React.useRef(0);
  const smoothAudioRef = React.useRef(0);
  const smoothBassRef = React.useRef(0);

  // BPM
  const bpmRef = React.useRef({ bpm: null, smooth: null, lastUpdate: 0 });

  // Image sampling (single image for color sampling)
  const imgRef = React.useRef(null);
  const imgCanvasRef = React.useRef(null);

  // Image String (5 images)
  const imgSeqRef = React.useRef(
    Array.from({ length: 5 }, () => ({ loaded: false, name: "", canvas: null }))
  );
  const [imgSeqInfo, setImgSeqInfo] = React.useState(
    Array.from({ length: 5 }, () => ({ loaded: false, name: "" }))
  );

  // Mobile controls drawer
  const [panelOpen, setPanelOpen] = React.useState(false);

  const [audioOn, setAudioOn] = React.useState(false);
  const [audioMode, setAudioMode] = React.useState("mic"); // mic | file
  const [audioFileUrl, setAudioFileUrl] = React.useState("");
  const [audioFileName, setAudioFileName] = React.useState("");
  const [audioFilePlaying, setAudioFilePlaying] = React.useState(false);
  const [audioLvl, setAudioLvl] = React.useState(0);
  const [bassLvl, setBassLvl] = React.useState(0);

  const [cells, setCells] = React.useState([]);
  const [menu, setMenu] = React.useState(null);
  const [drawing, setDrawing] = React.useState(false);

  const [midiOn, setMidiOn] = React.useState(false);
  const [midiDevs, setMidiDevs] = React.useState([]);
  const [audioDevs, setAudioDevs] = React.useState([]);
  const [selAudio, setSelAudio] = React.useState("");

  // Painting state
  const [paint, setPaint] = React.useState({
    mode: "none", // none | color | sample | imgseq
    color: "#111111",
    useSeq: false, // if true, painted cells use animated palette string
  });

  const [imageInfo, setImageInfo] = React.useState({ loaded: false, name: "" });

  const [s, setS] = React.useState({
    pat: "swiss-grid",

    // common
    thick: 2,
    space: 40,

    distOn: false,
    distType: "liquify",
    distStr: 30,
    distSpd: 1,

    audioSens: 3,
    midiSens: 2,

    dotSz: 4,
    shapeSz: 8,

    txt: "SOUND",
    fontSz: 48,

    chars: "01",
    charSz: 24,
    charSpd: 2,

    cols: 12,
    rows: 16,
    grid: true,
    rot: 0,

    cycle: "crossfade",
    behave: "string-wave",

    // string behavior shared
    strBehave: "wave", // cycle | wave | random | squeeze
    stagger: 0.08,

    // "String % / squeeze" behaviour controls
    squeezeAmt: 0.85, // 0..0.98
    squeezeSpd: 1.5, // speed multiplier
    squeezeFlow: 1.0, // how fast the text scrolls horizontally
    squeezeDensity: 1.0, // glyph spacing multiplier (smaller => denser)

    // Swiss grid: base always-on string glyphs
    swissBaseOn: true,
    swissCharScale: 1,

    // BPM sync
    speedMode: "manual", // manual | bpm
    bpmTarget: 120,
    bpmMultiply: 1,

    // Fill behavior
    fillAs: "background", // background | ink

    // Fonts
    googleFont: "Inter",
    customFont: null,

    // Color sequence (5 colors) + animation
    colorSeqOn: false,
    colorSeqBehave: "same", // same | cycle | wave | random
    colorSeqSpeed: 1,
    colorSeq: ["#111111", "#ff0055", "#00c2ff", "#00ff88", "#ffe600"],

    // Image preview
    imgPreviewOn: false,
    imgPreviewAlpha: 0.15,

    // Image String (5 images)
    imgSeqOn: false,
    imgSeqBehave: "same", // same | cycle | wave | random
    imgSeqSpeed: 1,

    // Swiss grid: grid focus + radial density scaling
    radialGridOn: false,
    gridCenterX: 0.5,
    gridCenterY: 0.5,
    radialStrength: 1.2,
    radialMaxScale: 2.2,

    // NEW: axis density warp (non-uniform columns/rows)
    colWarpOn: false,
    colWarpCenter: 0.5,
    colWarpStrength: 2.5,
    colWarpWidth: 0.25,

    rowWarpOn: false,
    rowWarpCenter: 0.5,
    rowWarpStrength: 2.5,
    rowWarpWidth: 0.25,

    // Swiss grid: spanning text chopped by cells (TRUE glyph clip)
    spanOn: false,
    spanText: "R",
    spanRow: 6,
    spanCol: 4,
    spanCols: 7, // width in cells
    spanRows: 8, // height in cells
    spanFontScale: 1.0,
  });

  const [svgPath, setSvgPath] = React.useState(null);

  const ease = (t) => (t < 0.5 ? 2 * t * t : -1 + (4 - 2 * t) * t);

  // --- Device enumeration ---
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

  // --- MIDI ---
  React.useEffect(() => {
    if (!midiOn) {
      midiVelRef.current = 0;
      return;
    }
    navigator.requestMIDIAccess().then((acc) => {
      const devs = [];
      for (const inp of acc.inputs.values()) {
        devs.push(inp.name);
        inp.onmidimessage = (e) => {
          const [st, n, v] = e.data;
          const msg = st >> 4;

          // Note on
          if (msg === 9 && v > 0) {
            midiNoteRef.current = n;
            midiVelRef.current = v / 127;
          } else if (msg === 8 || (msg === 9 && v === 0)) {
            midiVelRef.current = 0;
          }

          // CC: treat as mild activity too
          if (msg === 11) {
            midiVelRef.current = Math.max(midiVelRef.current, (v ?? 0) / 127);
          }
        };
      }
      setMidiDevs(devs);
    });
  }, [midiOn]);

  // --- Audio + Levels + BPM (mic OR uploaded audio file) ---
  React.useEffect(() => {
    if (!audioOn) {
      try {
        if (audioElRef.current) {
          audioElRef.current.pause();
          setAudioFilePlaying(false);
        }
      } catch {}
      try {
        if (micStreamRef.current) {
          micStreamRef.current.getTracks().forEach((t) => t.stop());
        }
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

      // BPM update ~ every 700ms
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

  // --- Noise + Distortion ---
  const noise = React.useMemo(() => {
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
      const l = (t, a, b) => a + t * (b - a);
      return l(
        v,
        l(u, p[A] / 128 - 1, p[B] / 128 - 1),
        l(u, p[A + 1] / 128 - 1, p[B + 1] / 128 - 1)
      );
    };
  }, []);

  const dist = (x, y, t, str, tp) => {
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

  // --- Helpers: indices ---
  const getSwissEdges = React.useCallback(
    (w, h) => {
      // If radial is on, we keep old geom (no edges)
      if (s.radialGridOn) return null;
      const xEdges = buildWarpedEdges(s.cols, w, s.colWarpOn, s.colWarpCenter, s.colWarpStrength, s.colWarpWidth);
      const yEdges = buildWarpedEdges(s.rows, h, s.rowWarpOn, s.rowWarpCenter, s.rowWarpStrength, s.rowWarpWidth);
      return { xEdges, yEdges };
    },
    [
      s.cols,
      s.rows,
      s.radialGridOn,
      s.colWarpOn,
      s.colWarpCenter,
      s.colWarpStrength,
      s.colWarpWidth,
      s.rowWarpOn,
      s.rowWarpCenter,
      s.rowWarpStrength,
      s.rowWarpWidth,
    ]
  );

  const getSwissIdx = React.useCallback(
    (cx, cy) => {
      const cv = canvasRef.current;
      if (!cv) return null;

      const w = cv.width;
      const h = cv.height;

      // Radial mode: revert to uniform idx
      if (s.radialGridOn) {
        const cw = w / s.cols;
        const ch = h / s.rows;
        const col = Math.floor(cx / cw);
        const row = Math.floor(cy / ch);
        return col >= 0 && col < s.cols && row >= 0 && row < s.rows ? row * s.cols + col : null;
      }

      const edges = getSwissEdges(w, h);
      if (!edges) return null;

      const col = findBin(edges.xEdges, cx);
      const row = findBin(edges.yEdges, cy);
      if (col == null || row == null) return null;
      return row * s.cols + col;
    },
    [s.cols, s.rows, s.radialGridOn, getSwissEdges]
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

  const getFontFamily = () => {
    if (s.customFont) return s.customFont;
    if (s.googleFont) return `"${s.googleFont}", sans-serif`;
    return '-apple-system, "SF Pro Display", sans-serif';
  };

  // --- Re-seed ---
  const gen = () => {
    setCells((prev) => prev.map((c) => ({ ...c, ph: Math.random() * Math.PI * 2 })));
  };

  // --- Image upload + build sampling canvas (single image for color sampling) ---
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

  // --- Image String upload (5 slots) ---
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

  const sampleColorAtCanvasPoint = (cx, cy) => {
    const cv = canvasRef.current;
    const img = imgRef.current;
    const off = imgCanvasRef.current;
    if (!cv || !img || !off) return null;

    const cw = cv.width, ch = cv.height;
    const iw = img.width, ih = img.height;

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

  // --- Cell mutators ---
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

  // --- Pointer to canvas (PointerEvents: mouse/touch/pen) ---
  const pointerToCanvas = (e) => {
    const cv = canvasRef.current;
    const r = cv.getBoundingClientRect();
    const x = (e.clientX - r.left) * (cv.width / r.width);
    const y = (e.clientY - r.top) * (cv.height / r.height);
    return { x, y };
  };

  // --- Speed mapping (manual vs BPM) ---
  const getSpeedFactor = (baseSpeed) => {
    if (s.speedMode !== "bpm") return baseSpeed;
    const detected = bpmRef.current.smooth;
    const bpm = detected ?? s.bpmTarget;
    const factor = (bpm / 120) * s.bpmMultiply;
    return baseSpeed * factor;
  };

  // --- Palette helpers ---
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

  // --- Image String helpers ---
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

  // --- Swiss grid cell geometry ---
  const swissCellGeom = (r, c, w, h) => {
    // Radial density grid uses old geometry
    if (s.radialGridOn) {
      const baseW = w / s.cols;
      const baseH = h / s.rows;

      const u = s.cols <= 1 ? 0 : c / (s.cols - 1);
      const v = s.rows <= 1 ? 0 : r / (s.rows - 1);
      const dx = u - (s.gridCenterX ?? 0.5);
      const dy = v - (s.gridCenterY ?? 0.5);
      const distN = Math.sqrt(dx * dx + dy * dy);

      const strength = Math.max(0, s.radialStrength ?? 1.2);
      const maxScale = Math.max(1, s.radialMaxScale ?? 2.2);
      const sc = clamp(1 + distN * strength, 1, maxScale);

      const wu = (s.gridCenterX ?? 0.5) + dx * sc;
      const wv = (s.gridCenterY ?? 0.5) + dy * sc;

      const cx = clamp(wu, 0, 1) * w;
      const cy = clamp(wv, 0, 1) * h;

      const cellW = baseW * sc;
      const cellH = baseH * sc;

      return { x: cx - cellW / 2, y: cy - cellH / 2, w: cellW, h: cellH, cx, cy };
    }

    // Non-uniform edges if warp enabled
    const xEdges = buildWarpedEdges(s.cols, w, s.colWarpOn, s.colWarpCenter, s.colWarpStrength, s.colWarpWidth);
    const yEdges = buildWarpedEdges(s.rows, h, s.rowWarpOn, s.rowWarpCenter, s.rowWarpStrength, s.rowWarpWidth);

    const x0 = xEdges[c];
    const x1 = xEdges[c + 1];
    const y0 = yEdges[r];
    const y1 = yEdges[r + 1];

    const cw = x1 - x0;
    const ch = y1 - y0;

    return {
      x: x0,
      y: y0,
      w: cw,
      h: ch,
      cx: x0 + cw / 2,
      cy: y0 + ch / 2,
    };
  };

  // --- SQUEEZE renderer (clipped inside a rect) ---
  const drawSqueezeStringInRect = (ctx, rect, chs, st, inkColor) => {
    if (!chs || chs.length === 0) return;

    const { x, y, w, h } = rect;

    ctx.save();
    ctx.beginPath();
    ctx.rect(x, y, w, h);
    ctx.clip();

    ctx.textAlign = "center";
    ctx.textBaseline = "middle";
    if (inkColor) ctx.fillStyle = inkColor;

    const sp = getSpeedFactor(s.squeezeSpd || 1);
    const osc = (Math.sin(st * sp * Math.PI * 2) + 1) * 0.5;
    const amt = clamp(s.squeezeAmt ?? 0.85, 0, 0.98);
    const sx = clamp(1 - amt * osc, 0.05, 1);

    const flow = getSpeedFactor(s.squeezeFlow || 1);
    const scroll = st * 160 * flow;

    const sampleGlyph = chs[0];
    const mw = ctx.measureText(sampleGlyph).width || 10;
    const spacing = Math.max(6, mw * (s.squeezeDensity ?? 1));

    const centerY = y + h / 2;
    const cx = x + w / 2;
    const cy = y + h / 2;
    ctx.translate(cx, cy);
    ctx.scale(sx, 1);
    ctx.translate(-cx, -cy);

    const left = x - w;
    const right = x + w * 2;
    const baseK = Math.floor(scroll / spacing);

    for (let px = left; px <= right; px += spacing) {
      const k = baseK + Math.floor((px - left) / spacing);
      const gi = ((k % chs.length) + chs.length) % chs.length;
      ctx.fillText(chs[gi], px, centerY);
    }

    ctx.restore();
  };

  // --- Apply paint / draw ---
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

  // Clamp menu to viewport
  const openMenuAt = (clientX, clientY, idx) => {
    const pad = 12;
    const menuW = 220;
    const menuH = 250;
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

  React.useEffect(() => {
    const cl = () => setMenu(null);
    window.addEventListener("click", cl);
    window.addEventListener("touchstart", cl, { passive: true });
    return () => {
      window.removeEventListener("click", cl);
      window.removeEventListener("touchstart", cl);
    };
  }, []);

  // --- Render ---
  const render = (tm = 0) => {
    const cv = canvasRef.current;
    if (!cv) return;
    const ctx = cv.getContext("2d");
    const w = cv.width, h = cv.height;

    ctx.fillStyle = "#FAFAFA";
    ctx.fillRect(0, 0, w, h);

    const midi = midiVelRef.current * s.midiSens;
    const aud = smoothAudioRef.current * s.audioSens;
    const bass = smoothBassRef.current * s.audioSens;

    const distSpd = getSpeedFactor(s.distSpd);
    const charSpd = getSpeedFactor(s.charSpd);
    const at = tm * 0.001 * distSpd;
    const ct = tm * 0.001 * charSpd;

    ctx.fillStyle = "#0A0A0A";

    // --- patterns ---
    if (s.pat === "vertical-lines") {
      const th = s.thick * (1 + bass * 0.5);
      for (let x = 0; x < w; x += s.space) {
        ctx.beginPath();
        for (let y = 0; y < h; y += 2) {
          let dx = x, dy = y;
          if (s.distOn) {
            const d = dist(x - w / 2, y - h / 2, at, s.distStr * (1 + aud), s.distType);
            dx += d.x; dy += d.y;
          }
          if (y === 0) ctx.moveTo(dx, dy);
          else ctx.lineTo(dx, dy);
        }
        ctx.lineWidth = th;
        ctx.stroke();
      }
      return;
    }

    if (s.pat === "horizontal-lines") {
      const th = s.thick * (1 + bass * 0.5);
      for (let y = 0; y < h; y += s.space) {
        ctx.beginPath();
        for (let x = 0; x < w; x += 2) {
          let dx = x, dy = y;
          if (s.distOn) {
            const d = dist(x - w / 2, y - h / 2, at, s.distStr * (1 + aud), s.distType);
            dx += d.x; dy += d.y;
          }
          if (x === 0) ctx.moveTo(dx, dy);
          else ctx.lineTo(dx, dy);
        }
        ctx.lineWidth = th;
        ctx.stroke();
      }
      return;
    }

    if (s.pat === "dots") {
      const ds = s.dotSz * (1 + (bass + midi) * 0.6);
      for (let y = 0; y < h; y += s.space)
        for (let x = 0; x < w; x += s.space) {
          let dx = x, dy = y;
          if (s.distOn) {
            const d = dist(x - w / 2, y - h / 2, at, s.distStr * (1 + aud), s.distType);
            dx += d.x; dy += d.y;
          }
          ctx.beginPath();
          ctx.arc(dx, dy, ds, 0, Math.PI * 2);
          ctx.fill();
        }
      return;
    }

    if (s.pat === "squares") {
      const ss = s.shapeSz * (1 + (bass + midi) * 0.6);
      for (let y = 0; y < h; y += s.space)
        for (let x = 0; x < w; x += s.space) {
          let dx = x, dy = y;
          if (s.distOn) {
            const d = dist(x - w / 2, y - h / 2, at, s.distStr * (1 + aud), s.distType);
            dx += d.x; dy += d.y;
          }
          ctx.fillRect(dx - ss / 2, dy - ss / 2, ss, ss);
        }
      return;
    }

    if (s.pat === "text") {
      ctx.font = `600 ${s.fontSz}px ${getFontFamily()}`;
      ctx.textAlign = "center";
      ctx.textBaseline = "middle";
      for (let y = 0; y < h; y += s.space)
        for (let x = 0; x < w; x += s.space) {
          ctx.save();
          ctx.translate(x, y);
          const sc = 1 + ease((bass + midi) * 0.4);
          ctx.scale(sc, sc);
          if (midiNoteRef.current > 0) ctx.rotate((midiNoteRef.current / 127) * 0.2);
          ctx.fillText(s.txt, 0, 0);
          ctx.restore();
        }
      return;
    }

    // --- build map of painted/overlay cells ---
    const cellByIdx = new Map();
    for (const c of cells) cellByIdx.set(c.idx, c);

    // --- CHAR GRID ---
    if (s.pat === "char-grid") {
      const cols = Math.max(1, Math.floor(w / s.space));
      const rows = Math.max(1, Math.floor(h / s.space));
      const chs = s.chars.split("");

      const fontPx = s.charSz;
      ctx.font = `${fontPx}px ${getFontFamily()}`;
      ctx.textAlign = "center";
      ctx.textBaseline = "middle";

      for (let r = 0; r < rows; r++) {
        for (let c = 0; c < cols; c++) {
          const idxLinear = r * cols + c;
          const x0 = c * s.space;
          const y0 = r * s.space;
          const cx = x0 + s.space / 2;
          const cy = y0 + s.space / 2;
          const st = ct + (r + c) * s.stagger;

          const entry = cellByIdx.get(idxLinear);

          const fillCol = resolveFillColor({ paintObj: entry?.paint, st, r, c });
          const imgBg = resolveFillImageCanvas({ paintObj: entry?.paint, globalOn: s.imgSeqOn, st, r, c });

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

          const inkOverride = resolveInkColor({ paintObj: entry?.paint, globalOn: s.colorSeqOn, st, r, c });

          if (s.strBehave === "squeeze" && chs.length > 0) {
            ctx.save();
            ctx.font = `${fontPx}px ${getFontFamily()}`;
            drawSqueezeStringInRect(
              ctx,
              { x: x0, y: y0, w: s.space, h: s.space },
              chs,
              st,
              (s.fillAs === "ink" && fillCol) ? fillCol : inkOverride
            );
            ctx.restore();
          } else {
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

            ctx.translate(cx, cy);
            ctx.scale(1 + ease((bass + midi) * 0.3), 1 + ease((bass + midi) * 0.3));
            if (chs.length > 0) ctx.fillText(chs[gi], 0, 0);
            ctx.restore();
          }
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

    // --- SWISS GRID ---
    if (s.pat === "swiss-grid") {
      // grid stroke (for radial grid, we skip drawing lines—still useful)
      if (s.grid && !s.radialGridOn) {
        // draw warped grid lines if warp is on; else uniform
        const xEdges = buildWarpedEdges(s.cols, w, s.colWarpOn, s.colWarpCenter, s.colWarpStrength, s.colWarpWidth);
        const yEdges = buildWarpedEdges(s.rows, h, s.rowWarpOn, s.rowWarpCenter, s.rowWarpStrength, s.rowWarpWidth);

        ctx.strokeStyle = "#E5E5E5";
        ctx.lineWidth = 0.5;

        for (let i = 0; i < xEdges.length; i++) {
          ctx.beginPath();
          ctx.moveTo(xEdges[i], 0);
          ctx.lineTo(xEdges[i], h);
          ctx.stroke();
        }
        for (let i = 0; i < yEdges.length; i++) {
          ctx.beginPath();
          ctx.moveTo(0, yEdges[i]);
          ctx.lineTo(w, yEdges[i]);
          ctx.stroke();
        }
      } else if (s.grid && s.radialGridOn) {
        // (optional) skip in radial mode
      }

      const chs = s.chars.split("");

      // 1) base layer letters (always on)
      if (s.swissBaseOn && chs.length > 0) {
        for (let r = 0; r < s.rows; r++) {
          for (let c = 0; c < s.cols; c++) {
            const idxLinear = r * s.cols + c;
            const entry = cellByIdx.get(idxLinear);

            const overlayType = entry?.type;
            const hasOverlay = overlayType && overlayType !== "paint";
            if (hasOverlay) continue;

            const g = swissCellGeom(r, c, w, h);
            const st = ct + (r + c) * s.stagger;

            const fillCol = resolveFillColor({ paintObj: entry?.paint, st, r, c });
            const imgBg = resolveFillImageCanvas({ paintObj: entry?.paint, globalOn: s.imgSeqOn, st, r, c });

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

            const inkOverride = resolveInkColor({ paintObj: entry?.paint, globalOn: s.colorSeqOn, st, r, c });

            const baseSz = Math.min(g.w, g.h) * 0.5 * s.swissCharScale;
            ctx.font = `${baseSz * 1.2}px ${getFontFamily()}`;
            ctx.textAlign = "center";
            ctx.textBaseline = "middle";

            if (s.strBehave === "squeeze") {
              ctx.save();
              drawSqueezeStringInRect(
                ctx,
                { x: g.x, y: g.y, w: g.w, h: g.h },
                chs,
                st,
                (s.fillAs === "ink" && fillCol) ? fillCol : inkOverride
              );
              ctx.restore();
            } else {
              let gi = 0;
              if (s.strBehave === "cycle") gi = (Math.floor(st * 3) + r + c) % chs.length;
              else if (s.strBehave === "wave") {
                const wv = Math.sin((c * 0.5 + r * 0.3 + st) * 0.8);
                gi = Math.floor((wv + 1) * 0.5 * chs.length) % chs.length;
              } else {
                const sd = r * 1000 + c + Math.floor(st * 2);
                gi = Math.floor((Math.sin(sd) * 0.5 + 0.5) * chs.length);
              }

              ctx.save();
              if (s.fillAs === "ink" && fillCol) ctx.fillStyle = fillCol;
              else if (inkOverride) ctx.fillStyle = inkOverride;

              const gr = (s.rot + aud * 45) * (Math.PI / 180);
              ctx.translate(g.cx, g.cy);
              if (gr !== 0) ctx.rotate(gr);
              ctx.scale(1 + ease((bass + midi) * 0.3), 1 + ease((bass + midi) * 0.3));
              ctx.fillText(chs[gi], 0, 0);
              ctx.restore();
            }
          }
        }
      }

      // 2) TRUE SPAN TEXT (glyph clipped by cells)
      if (s.spanOn && s.spanText?.length) {
        const row = clamp(s.spanRow, 0, s.rows - 1);
        const col = clamp(s.spanCol, 0, s.cols - 1);
        const spanCols = clamp(s.spanCols ?? 4, 1, s.cols - col);
        const spanRows = clamp(s.spanRows ?? 4, 1, s.rows - row);

        const startGeom = swissCellGeom(row, col, w, h);
        const endGeom = swissCellGeom(row + spanRows - 1, col + spanCols - 1, w, h);

        const spanX = startGeom.x;
        const spanY = startGeom.y;
        const spanW = endGeom.x + endGeom.w - spanX;
        const spanH = endGeom.y + endGeom.h - spanY;

        const fontSize = Math.max(6, spanH * 0.9 * (s.spanFontScale || 1));

        ctx.save();
        ctx.font = `900 ${fontSize}px ${getFontFamily()}`;
        ctx.textBaseline = "middle";
        ctx.textAlign = "center";
        ctx.fillStyle = "#000";

        const textX = spanX + spanW / 2;
        const textY = spanY + spanH / 2;

        for (let rr = 0; rr < spanRows; rr++) {
          for (let cc = 0; cc < spanCols; cc++) {
            const g = swissCellGeom(row + rr, col + cc, w, h);
            ctx.save();
            ctx.beginPath();
            ctx.rect(g.x, g.y, g.w, g.h);
            ctx.clip();
            ctx.fillText(s.spanText, textX, textY);
            ctx.restore();
          }
        }

        ctx.restore();
      }

      // 3) overlay objects (drawn cells)
      const overlayEntries = cells.filter((c) => c.type && c.type !== "paint");
      overlayEntries.forEach((cel, idx) => {
        const col = cel.idx % s.cols;
        const row = Math.floor(cel.idx / s.cols);
        const g = swissCellGeom(row, col, w, h);

        const st = ct + (row + col) * s.stagger;
        const lt = ct + idx * s.stagger;
        const ab = ease((bass + midi) * 0.5);

        const fillCol = resolveFillColor({ paintObj: cel.paint, st, r: row, c: col });
        const imgBg = resolveFillImageCanvas({ paintObj: cel.paint, globalOn: s.imgSeqOn, st, r: row, c: col });

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
          paintObj: cel.paint,
          globalOn: s.colorSeqOn,
          st,
          r: row,
          c: col,
        });

        ctx.save();
        if (s.fillAs === "ink" && fillCol) ctx.fillStyle = fil
