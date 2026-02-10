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
const fract = (x) => x - Math.floor(x);
const hash01 = (i) => fract(Math.sin((i + 1) * 12.9898) * 43758.5453);

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

export default function App() {
  const canvasRef = React.useRef(null);
  const animRef = React.useRef(null);

  const audioCtxRef = React.useRef(null);
  const analyserRef = React.useRef(null);
  const audioElRef = React.useRef(null);
  const mediaElSrcRef = React.useRef(null);
  const micStreamRef = React.useRef(null);
  const midiVelRef = React.useRef(0);

  // MIDI channel activity (1-16) for density/behavior mapping
  const midiChanRef = React.useRef(Array.from({ length: 16 }, () => 0));
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
    strBehave: "wave", // used by char-grid AND swiss-grid base string

    // String squeeze (Cavalry-like String Percentage)
    squeezeAmt: 0.85, // 0..1 how much to compress
    squeezeSpd: 1.5, // speed multiplier

    stagger: 0.08,

    draw: false,
    selEl: "char", // char | dot | square | svg

    // Swiss grid: base always-on string glyphs (like char-grid)
    swissBaseOn: true,

    // Swiss grid: glyph size multiplier for base + overlay chars
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
          const ch = (st & 0x0f) + 1; // 1-16

          // Note on
          if (msg === 9 && v > 0) {
            midiNoteRef.current = n;
            midiVelRef.current = v / 127;
            midiChanRef.current[ch - 1] = Math.max(midiChanRef.current[ch - 1], v / 127);
          } else if (msg === 8 || (msg === 9 && v === 0)) {
            midiVelRef.current = 0;
          }

          // CC
          if (msg === 11) {
            const val = (v ?? 0) / 127;
            midiChanRef.current[ch - 1] = Math.max(midiChanRef.current[ch - 1], val * 0.8);
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
        l(u, p[A + 1] / 128 - 1, p[B] / 128 - 1)
      );
    };
  }, []);

  const dist = (x, y, t, str, tp) => {
    const f = 0.008;
    let dx = 0,
      dy = 0;

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
  const getSwissIdx = React.useCallback(
    (cx, cy) => {
      const cv = canvasRef.current;
      if (!cv) return null;
      const cw = cv.width / s.cols;
      const ch = cv.height / s.rows;
      const col = Math.floor(cx / cw);
      const row = Math.floor(cy / ch);
      return col >= 0 && col < s.cols && row >= 0 && row < s.rows ? row * s.cols + col : null;
    },
    [s.cols, s.rows]
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

  // --- Color sequence helpers ---
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

  const getImageSeqCanvasAt = React.useCallback(() => {
    const loaded = imgSeqRef.current.filter((x) => x.loaded && x.canvas);
    if (loaded.length === 0) return null;
    return loaded;
  }, [imgSeqInfo]);

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
      const loaded = getImageSeqCanvasAt();
      if (!loaded || loaded.length === 0) return null;

      const k = imageSeqIndex(st, r, c);
      const idx = ((k % loaded.length) + loaded.length) % loaded.length;

      if (paintObj?.mode === "imgseq") return loaded[idx].canvas;
      if (globalOn) return loaded[idx].canvas;
      return null;
    },
    [imageSeqIndex, getImageSeqCanvasAt]
  );

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
    const idx = s.pat === "swiss-grid" ? getSwissIdx(x, y) : getCharGridIdx(x, y);
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
    const idx = s.pat === "swiss-grid" ? getSwissIdx(x, y) : getCharGridIdx(x, y);
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
    const w = cv.width,
      h = cv.height;

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

    if (s.pat === "swiss-grid") {
      const cw = w / s.cols;
      const ch = h / s.rows;
      const baseSz = Math.min(cw, ch) * 0.5 * s.swissCharScale;

      if (s.grid) {
        ctx.strokeStyle = "#E5E5E5";
        ctx.lineWidth = 0.5;
        for (let i = 0; i <= s.cols; i++) {
          ctx.beginPath();
          ctx.moveTo(i * cw, 0);
          ctx.lineTo(i * cw, h);
          ctx.stroke();
        }
        for (let i = 0; i <= s.rows; i++) {
          ctx.beginPath();
          ctx.moveTo(0, i * ch);
          ctx.lineTo(w, i * ch);
          ctx.stroke();
        }
      }

      const chs = s.chars.split("");
      const cellByIdx = new Map();
      for (const c of cells) cellByIdx.set(c.idx, c);

      // Base letters (always on)
      if (s.swissBaseOn && chs.length > 0) {
        ctx.font = `${baseSz * 1.2}px ${getFontFamily()}`;
        ctx.textAlign = "center";
        ctx.textBaseline = "middle";

        for (let r = 0; r < s.rows; r++) {
          for (let c = 0; c < s.cols; c++) {
            const idxLinear = r * s.cols + c;
            const cx = c * cw + cw / 2;
            const cy = r * ch + ch / 2;

            const entry = cellByIdx.get(idxLinear);
            const st = ct + (r + c) * s.stagger;

            const fillCol = resolveFillColor({ paintObj: entry?.paint, st, r, c });
            const imgBg = resolveFillImageCanvas({ paintObj: entry?.paint, globalOn: s.imgSeqOn, st, r, c });

            if (imgBg) {
              ctx.save();
              drawCoverCanvas(ctx, imgBg, c * cw, r * ch, cw, ch);
              ctx.restore();
            }

            if (fillCol && s.fillAs === "background") {
              ctx.save();
              ctx.fillStyle = fillCol;
              ctx.globalAlpha = 0.9;
              ctx.fillRect(c * cw, r * ch, cw, ch);
              ctx.restore();
            }

            // if cell has overlay object, base skips
            const overlayType = entry?.type;
            const hasOverlay = overlayType && overlayType !== "paint";
            if (hasOverlay) continue;

            let ci = 0;
            if (s.strBehave === "cycle") ci = (Math.floor(st * 3) + r + c) % chs.length;
            else if (s.strBehave === "wave") {
              const wv = Math.sin((c * 0.5 + r * 0.3 + st) * 0.8);
              ci = Math.floor((wv + 1) * 0.5 * chs.length) % chs.length;
            } else {
              const sd = r * 1000 + c + Math.floor(st * 2);
              ci = Math.floor((Math.sin(sd) * 0.5 + 0.5) * chs.length);
            }

            const inkOverride = resolveInkColor({ paintObj: entry?.paint, globalOn: s.colorSeqOn, st, r, c });

            ctx.save();
            if (s.fillAs === "ink" && fillCol) ctx.fillStyle = fillCol;
            else if (inkOverride) ctx.fillStyle = inkOverride;

            const gr = (s.rot + aud * 45) * (Math.PI / 180);
            ctx.translate(cx, cy);
            if (gr !== 0) ctx.rotate(gr);
            ctx.scale(1 + ease((bass + midi) * 0.3), 1 + ease((bass + midi) * 0.3));
            ctx.fillText(chs[ci], 0, 0);
            ctx.restore();
          }
        }
      }
    }

    // show reference image faintly if sampling
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
  };

  React.useEffect(() => {
    const loop = (t) => {
      render(t);
      animRef.current = requestAnimationFrame(loop);
    };
    animRef.current = requestAnimationFrame(loop);
    return () => cancelAnimationFrame(animRef.current);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [s, cells, paint]);

  // canvas resize (mobile safe)
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

  React.useEffect(() => {
    const cv = canvasRef.current;
    if (!cv) return;
    cv.style.touchAction = "none";
  }, []);

  // load google font
  React.useEffect(() => {
    if (!s.googleFont) return;
    const link = document.createElement("link");
    link.href = `https://fonts.googleapis.com/css2?family=${s.googleFont.replace(/ /g, "+")}:wght@400;600;700&display=swap`;
    link.rel = "stylesheet";
    document.head.appendChild(link);
    return () => document.head.removeChild(link);
  }, [s.googleFont]);

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

  const handleSvgUpload = (e) => {
    const file = e.target.files?.[0];
    if (!file) return;
    const reader = new FileReader();
    reader.onload = (ev) => {
      const parser = new DOMParser();
      const svgDoc = parser.parseFromString(ev.target.result, "image/svg+xml");
      const svgEl = svgDoc.querySelector("svg");
      const pathEl = svgEl?.querySelector("path");
      if (pathEl && svgEl) {
        const pathData = pathEl.getAttribute("d");
        const viewBox = svgEl.getAttribute("viewBox") || "0 0 100 100";
        const [, , vw, vh] = viewBox.split(" ").map(Number);
        setSvgPath({ path: pathData, width: vw, height: vh });
      }
    };
    reader.readAsText(file);
  };

  const interactive = s.pat === "swiss-grid" || s.pat === "char-grid";
  const bpmDisplay = bpmRef.current.smooth;

  return (
    <div className="w-full h-[100svh] bg-white flex flex-col md:flex-row">
      {panelOpen && <div className="fixed inset-0 bg-black/30 z-30 md:hidden" onClick={() => setPanelOpen(false)} />}

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

        <div className="space-y-2">
          <label className="block text-xs font-semibold uppercase tracking-wider">Pattern</label>
          <select
            value={s.pat}
            onChange={(e) => setS((p) => ({ ...p, pat: e.target.value }))}
            className="w-full px-3 py-2 bg-white border border-neutral-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-black"
          >
            <option value="vertical-lines">Vertical Lines</option>
            <option value="horizontal-lines">Horizontal Lines</option>
            <option value="dots">Dots</option>
            <option value="squares">Squares</option>
            <option value="text">Text</option>
            <option value="char-grid">Character Grid</option>
            <option value="swiss-grid">Swiss Grid</option>
          </select>
        </div>

        {/* Speed Sync */}
        <div className="space-y-2">
          <div className="flex items-center justify-between">
            <label className="text-xs font-semibold uppercase tracking-wider">Speed Sync</label>
            <select
              value={s.speedMode}
              onChange={(e) => setS((p) => ({ ...p, speedMode: e.target.value }))}
              className="px-2 py-1 bg-white border border-neutral-300 rounded-md text-xs"
            >
              <option value="manual">Manual</option>
              <option value="bpm">BPM</option>
            </select>
          </div>

          {s.speedMode === "bpm" && (
            <div className="space-y-2">
              <div className="flex items-center justify-between">
                <div className="text-xs text-neutral-700">
                  Detected: <span className="font-semibold">{bpmDisplay ? bpmDisplay.toFixed(1) : "—"}</span> BPM
                </div>
                <div className="text-[10px] text-neutral-500">(needs audio)</div>
              </div>
              <label className="block text-xs font-semibold uppercase tracking-wider">Fallback BPM: {s.bpmTarget}</label>
              <input
                type="range"
                min="60"
                max="200"
                value={s.bpmTarget}
                onChange={(e) => setS((p) => ({ ...p, bpmTarget: parseInt(e.target.value) }))}
                className="w-full"
              />
              <label className="block text-xs font-semibold uppercase tracking-wider">
                Multiplier: {s.bpmMultiply.toFixed(2)}×
              </label>
              <input
                type="range"
                min="0.25"
                max="4"
                step="0.01"
                value={s.bpmMultiply}
                onChange={(e) => setS((p) => ({ ...p, bpmMultiply: parseFloat(e.target.value) }))}
                className="w-full"
              />
              <div className="text-xs text-neutral-600">Affects Char Speed + Distortion Speed.</div>
            </div>
          )}
        </div>

        {/* Audio */}
        <div className="space-y-2">
          <div className="flex items-center justify-between">
            <label className="text-xs font-semibold uppercase tracking-wider">Audio</label>
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
                <div className="text-xs text-neutral-700">{audioFileName ? audioFileName : "No file selected"}</div>
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
                <div className="h-full bg-neutral-600 transition-all" style={{ width: `${bassLvl * 100}%` }} />
              </div>
            </div>
          )}
        </div>

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

        {/* Paint + image sampling */}
        {interactive && (
          <div className="space-y-2">
            <label className="block text-xs font-semibold uppercase tracking-wider">Cell Color / Image</label>
            <div className="flex items-center gap-2">
              <button
                onClick={() => setPaint((p) => ({ ...p, mode: p.mode === "color" ? "none" : "color" }))}
                className={`flex-1 px-3 py-2 rounded-lg border text-xs font-medium flex items-center justify-center gap-2 min-h-[44px] ${
                  paint.mode === "color" ? "bg-black text-white border-black" : "bg-white border-neutral-300"
                }`}
              >
                <Wand2 size={14} />
                Paint
              </button>
              <button
                onClick={() => setPaint((p) => ({ ...p, mode: p.mode === "sample" ? "none" : "sample", useSeq: false }))}
                className={`flex-1 px-3 py-2 rounded-lg border text-xs font-medium flex items-center justify-center gap-2 min-h-[44px] ${
                  paint.mode === "sample" ? "bg-black text-white border-black" : "bg-white border-neutral-300"
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
                {imageInfo.loaded && <div className="text-[10px] text-green-700">✓ {imageInfo.name}</div>}
              </div>
              <input type="file" accept="image/*" onChange={handleImageUpload} className="w-full text-xs" />
            </div>

            {/* Image String (5 images) */}
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
                      <button onClick={() => clearImageSeqSlot(i)} className="w-full text-[10px] text-red-600 hover:underline">
                        remove
                      </button>
                    )}
                  </div>
                ))}
              </div>

              <button
                onClick={() => setPaint((p) => ({ ...p, mode: p.mode === "imgseq" ? "none" : "imgseq", useSeq: false }))}
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

        {/* Font uploads */}
        <div className="space-y-2">
          <label className="block text-xs font-semibold uppercase tracking-wider">Custom Font (.ttf/.otf)</label>
          <input type="file" accept=".ttf,.otf,.woff,.woff2" onChange={handleFontUpload} className="w-full text-xs" />
        </div>
        <div className="space-y-2">
          <label className="block text-xs font-semibold uppercase tracking-wider">Upload SVG Shape</label>
          <input type="file" accept=".svg" onChange={handleSvgUpload} className="w-full text-xs" />
        </div>
      </div>

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
            <button onClick={() => add("char")} className="block w-full px-4 py-2 text-left hover:bg-gray-100 text-sm">
              Add Char
            </button>
            <button onClick={() => add("dot")} className="block w-full px-4 py-2 text-left hover:bg-gray-100 text-sm">
              Add Dot
            </button>
            <button onClick={() => add("square")} className="block w-full px-4 py-2 text-left hover:bg-gray-100 text-sm">
              Add Square
            </button>
            <div className="border-t my-1"></div>
            <button onClick={rem} className="block w-full px-4 py-2 text-left hover:bg-red-50 text-sm text-red-600">
              Remove
            </button>
          </div>
        )}
      </div>
    </div>
  );
}
