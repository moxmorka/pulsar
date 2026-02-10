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

/* -------------------- utils -------------------- */
const clamp = (v, a, b) => Math.max(a, Math.min(b, v));
const lerp = (a, b, t) => a + (b - a) * t;
const fract = (x) => x - Math.floor(x);

function hexFromRgb(r, g, b) {
  const to2 = (n) => n.toString(16).padStart(2, "0");
  return `#${to2(r)}${to2(g)}${to2(b)}`;
}
function isHexColor(s) {
  return /^#([0-9a-fA-F]{3}|[0-9a-fA-F]{6})$/.test(s);
}

/* -------------------- BPM detection (autocorr) -------------------- */
function detectBpmFromFloatBuffer(floatBuf, sampleRate, minBpm = 60, maxBpm = 200) {
  // Remove DC
  let mean = 0;
  for (let i = 0; i < floatBuf.length; i++) mean += floatBuf[i];
  mean /= floatBuf.length;

  const buf = new Float32Array(floatBuf.length);
  for (let i = 0; i < floatBuf.length; i++) buf[i] = floatBuf[i] - mean;

  // Energy gate
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

/* -------------------- main app -------------------- */
export default function App() {
  const canvasRef = React.useRef(null);
  const animRef = React.useRef(null);

  // audio
  const audioCtxRef = React.useRef(null);
  const analyserRef = React.useRef(null);
  const audioElRef = React.useRef(null);
  const mediaElSrcRef = React.useRef(null);
  const micStreamRef = React.useRef(null);

  // levels
  const smoothAudioRef = React.useRef(0);
  const smoothBassRef = React.useRef(0);

  // midi
  const midiVelRef = React.useRef(0);
  const midiNoteRef = React.useRef(0);
  const midiChanRef = React.useRef(Array.from({ length: 16 }, () => 0));

  // bpm
  const bpmRef = React.useRef({ bpm: null, smooth: null, lastUpdate: 0 });

  // image sampling
  const imgRef = React.useRef(null);
  const imgCanvasRef = React.useRef(null);

  // image string slots (5)
  const imgSeqRef = React.useRef(
    Array.from({ length: 5 }, () => ({ loaded: false, name: "", canvas: null }))
  );

  // ui state
  const [panelOpen, setPanelOpen] = React.useState(false);

  const [audioOn, setAudioOn] = React.useState(false);
  const [audioMode, setAudioMode] = React.useState("mic"); // mic | file
  const [audioFileUrl, setAudioFileUrl] = React.useState("");
  const [audioFileName, setAudioFileName] = React.useState("");
  const [audioFilePlaying, setAudioFilePlaying] = React.useState(false);
  const [audioLvl, setAudioLvl] = React.useState(0);
  const [bassLvl, setBassLvl] = React.useState(0);

  const [midiOn, setMidiOn] = React.useState(false);
  const [midiDevs, setMidiDevs] = React.useState([]);
  const [audioDevs, setAudioDevs] = React.useState([]);
  const [selAudio, setSelAudio] = React.useState("");

  const [cells, setCells] = React.useState([]); // per-cell data: overlays + painted bg/ink/img
  const [menu, setMenu] = React.useState(null);
  const [drawing, setDrawing] = React.useState(false);

  const [imageInfo, setImageInfo] = React.useState({ loaded: false, name: "" });
  const [imgSeqInfo, setImgSeqInfo] = React.useState(
    Array.from({ length: 5 }, () => ({ loaded: false, name: "" }))
  );

  // painting
  const [paint, setPaint] = React.useState({
    mode: "none", // none | color | sample | imgseq
    color: "#111111",
    useSeq: false, // if true, painted cells use animated palette string
  });

  const [svgPath, setSvgPath] = React.useState(null);

  const [s, setS] = React.useState({
    pat: "swiss-grid",

    // distortion
    distOn: false,
    distType: "liquify",
    distStr: 30,
    distSpd: 1,

    // audio/midi sens
    audioSens: 3,
    midiSens: 2,

    // other patterns
    thick: 2,
    space: 40,
    dotSz: 4,
    shapeSz: 8,
    txt: "SOUND",
    fontSz: 48,

    // grid
    cols: 12,
    rows: 16,
    grid: true,
    rot: 0,

    // Swiss-grid design controls
    marginX: 48,
    marginY: 48,
    gutterX: 8,
    gutterY: 8,
    gridRot: 0, // rotates the whole swiss grid around its center

    // focus point & radial density
    radialGridOn: false,
    gridCenterX: 0.5,
    gridCenterY: 0.5,
    radialStrength: 1.2,
    radialMaxScale: 2.2,

    // strings
    chars: "01",
    charSz: 24,
    charSpd: 2,
    stagger: 0.08,

    // string behavior
    strBehave: "wave", // cycle | wave | random | squeeze
    squeezeAmt: 0.85, // 0..1
    squeezeSpd: 1.5,

    // phrase mode (chopped text across cells)
    stringMode: "chars", // chars | phrase
    phrase: "BRRRIIISSSSKKK10 ",
    phraseDir: "x", // x | y
    phraseScroll: 1.0, // speed multiplier
    phraseScale: 1.05, // size multiplier

    // swiss base string always-on
    swissBaseOn: true,
    swissCharScale: 1,

    // overlays/draw
    draw: false,
    selEl: "char", // char | dot | square | svg
    cycle: "crossfade",
    behave: "string-wave", // overlay physics

    // pixelate
    pixOn: false,
    pixSz: 4,

    // speed sync
    speedMode: "manual", // manual | bpm
    bpmTarget: 120,
    bpmMultiply: 1,

    // fill behavior
    fillAs: "background", // background | ink

    // fonts
    googleFont: "Inter",
    customFont: null,

    // color string
    colorSeqOn: false,
    colorSeqBehave: "same", // same | cycle | wave | random | squeeze
    colorSeqSpeed: 1,
    colorSeq: ["#111111", "#ff0055", "#00c2ff", "#00ff88", "#ffe600"],

    // reference image overlay
    imgPreviewOn: false,
    imgPreviewAlpha: 0.15,

    // image string (5 images)
    imgSeqOn: false,
    imgSeqBehave: "same", // same | cycle | wave | random | squeeze
    imgSeqSpeed: 1,
  });

  const ease = (t) => (t < 0.5 ? 2 * t * t : -1 + (4 - 2 * t) * t);

  /* -------------------- enumerate devices -------------------- */
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

  /* -------------------- MIDI -------------------- */
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
          const ch = (st & 0x0f) + 1; // 1..16

          if (msg === 9 && v > 0) {
            midiNoteRef.current = n;
            midiVelRef.current = v / 127;
            midiChanRef.current[ch - 1] = Math.max(midiChanRef.current[ch - 1], v / 127);
          } else if (msg === 8 || (msg === 9 && v === 0)) {
            midiVelRef.current = 0;
          }

          if (msg === 11) {
            const val = (v ?? 0) / 127;
            midiChanRef.current[ch - 1] = Math.max(midiChanRef.current[ch - 1], val * 0.8);
          }
        };
      }
      setMidiDevs(devs);
    });
  }, [midiOn]);

  /* -------------------- Audio (mic or file) + BPM -------------------- */
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
          bpmRef.current = { bpm, smooth: lerp(prev, bpm, 0.25), lastUpdate: now };
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

  /* -------------------- noise + dist -------------------- */
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
      return l(v, l(u, p[A] / 128 - 1, p[B] / 128 - 1), l(u, p[A + 1] / 128 - 1, p[B + 1] / 128 - 1));
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

  /* -------------------- indexes -------------------- */
  const getSwissIdx = React.useCallback(
    (cx, cy) => {
      const cv = canvasRef.current;
      if (!cv) return null;

      // NOTE: selection uses "layout rects" from computeSwissLayout()
      const layout = computeSwissLayout(cv.width, cv.height);
      if (!layout) return null;
      const { cells: rects } = layout;

      // fast approximate: bounding check first
      if (cx < layout.bounds.x || cy < layout.bounds.y || cx > layout.bounds.x + layout.bounds.w || cy > layout.bounds.y + layout.bounds.h) {
        return null;
      }

      // exact: find cell whose rect contains point
      for (let i = 0; i < rects.length; i++) {
        const r = rects[i];
        if (cx >= r.x && cy >= r.y && cx <= r.x + r.w && cy <= r.y + r.h) return i;
      }
      return null;
    },
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [s.cols, s.rows, s.marginX, s.marginY, s.gutterX, s.gutterY, s.gridRot, s.radialGridOn, s.gridCenterX, s.gridCenterY, s.radialStrength, s.radialMaxScale]
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

  /* -------------------- fonts -------------------- */
  const getFontFamily = () => {
    if (s.customFont) return s.customFont;
    if (s.googleFont) return `"${s.googleFont}", sans-serif`;
    return '-apple-system, "SF Pro Display", sans-serif';
  };

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

  /* -------------------- speed sync -------------------- */
  const getSpeedFactor = (baseSpeed) => {
    if (s.speedMode !== "bpm") return baseSpeed;
    const detected = bpmRef.current.smooth;
    const bpm = detected ?? s.bpmTarget;
    const factor = (bpm / 120) * s.bpmMultiply;
    return baseSpeed * factor;
  };

  /* -------------------- palette helpers -------------------- */
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

      const eff = beh === "squeeze" ? "cycle" : beh;

      if (eff === "cycle") return (Math.floor(t * 3) + r + c) % len;
      if (eff === "wave") {
        const wv = Math.sin((c * 0.5 + r * 0.3 + t) * 0.8);
        return Math.floor((wv + 1) * 0.5 * len) % len;
      }
      // random
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

  /* -------------------- image string helpers -------------------- */
  const imageSeqReadyCount = React.useMemo(
    () => imgSeqInfo.filter((x) => x.loaded).length,
    [imgSeqInfo]
  );

  const imageSeqIndex = React.useCallback(
    (st, r, c) => {
      const beh = s.imgSeqBehave === "same" ? s.strBehave : s.imgSeqBehave;
      const t = st * (s.imgSeqSpeed || 1);

      const eff = beh === "squeeze" ? "cycle" : beh;

      if (eff === "cycle") return Math.floor(t * 3) + r + c;
      if (eff === "wave") {
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
    return loaded.length ? loaded : [];
  }, [imgSeqInfo]);

  const getImageSeqCanvasByK = React.useCallback(
    (k) => {
      const loaded = getImageSeqCanvasAt();
      if (!loaded.length) return null;
      const idx = ((k % loaded.length) + loaded.length) % loaded.length;
      return loaded[idx].canvas;
    },
    [getImageSeqCanvasAt]
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
      if (paintObj?.mode === "imgseq") return getImageSeqCanvasByK(imageSeqIndex(st, r, c));
      if (globalOn) return getImageSeqCanvasByK(imageSeqIndex(st, r, c));
      return null;
    },
    [imageSeqIndex, getImageSeqCanvasByK]
  );

  /* -------------------- cell mutators -------------------- */
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

  /* -------------------- pointer helpers -------------------- */
  const pointerToCanvas = (e) => {
    const cv = canvasRef.current;
    const r = cv.getBoundingClientRect();
    const x = (e.clientX - r.left) * (cv.width / r.width);
    const y = (e.clientY - r.top) * (cv.height / r.height);
    return { x, y };
  };

  const openMenuAt = (clientX, clientY, idx) => {
    const pad = 12;
    const menuW = 240;
    const menuH = 260;
    const x = clamp(clientX, pad, window.innerWidth - menuW - pad);
    const y = clamp(clientY, pad, window.innerHeight - menuH - pad);
    setMenu({ x, y, idx });
  };

  /* -------------------- image upload (sampling) -------------------- */
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

  /* -------------------- image string uploads (5 slots) -------------------- */
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

        imgSeqRef.current = imgSeqRef.current.map((x, i) => (i === slot ? { loaded: true, name: file.name, canvas: off } : x));
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
    imgSeqRef.current = imgSeqRef.current.map((x, i) => (i === slot ? { loaded: false, name: "", canvas: null } : x));
    setImgSeqInfo((prev) => {
      const n = [...prev];
      n[slot] = { loaded: false, name: "" };
      return n;
    });
  };

  /* -------------------- paint apply -------------------- */
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

    // draw overlay
    upsertCell(idx, { type: s.selEl, ph: Math.random() * Math.PI * 2 });
  };

  /* -------------------- pointer events -------------------- */
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

  /* -------------------- menu actions -------------------- */
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

  /* -------------------- grid layout (designable Swiss grid) -------------------- */
  // returns rects in *canvas space* (already rotated grid handled for drawing, but picking uses same rects in unrotated layout)
  const computeSwissLayout = (W, H) => {
    const cols = Math.max(1, s.cols);
    const rows = Math.max(1, s.rows);

    const marginX = clamp(s.marginX ?? 48, 0, Math.min(W * 0.45, 4000));
    const marginY = clamp(s.marginY ?? 48, 0, Math.min(H * 0.45, 4000));

    const gutterX = clamp(s.gutterX ?? 8, 0, Math.min(W * 0.25, 2000));
    const gutterY = clamp(s.gutterY ?? 8, 0, Math.min(H * 0.25, 2000));

    const areaW = Math.max(1, W - 2 * marginX);
    const areaH = Math.max(1, H - 2 * marginY);

    const cellW = Math.max(1, (areaW - gutterX * (cols - 1)) / cols);
    const cellH = Math.max(1, (areaH - gutterY * (rows - 1)) / rows);

    // base rects (unrotated)
    const rects = [];
    for (let r = 0; r < rows; r++) {
      for (let c = 0; c < cols; c++) {
        const x = marginX + c * (cellW + gutterX);
        const y = marginY + r * (cellH + gutterY);
        rects.push({ x, y, w: cellW, h: cellH, cx: x + cellW / 2, cy: y + cellH / 2, r, c });
      }
    }

    // radial scaling (denser near center => smaller near center, bigger outward)
    if (s.radialGridOn) {
      const cxu = clamp(s.gridCenterX ?? 0.5, 0, 1);
      const cyu = clamp(s.gridCenterY ?? 0.5, 0, 1);
      const strength = Math.max(0, s.radialStrength ?? 1.2);
      const maxScale = Math.max(1, s.radialMaxScale ?? 2.2);

      const centerX = marginX + cxu * areaW;
      const centerY = marginY + cyu * areaH;

      // remap each rect size and position from its original center
      for (let i = 0; i < rects.length; i++) {
        const rr = rects[i];
        const dx = (rr.cx - centerX) / (areaW || 1);
        const dy = (rr.cy - centerY) / (areaH || 1);
        const d = Math.sqrt(dx * dx + dy * dy);

        const sc = clamp(1 + d * strength, 1, maxScale);

        const nw = rr.w * sc;
        const nh = rr.h * sc;

        rects[i] = {
          ...rr,
          w: nw,
          h: nh,
          x: rr.cx - nw / 2,
          y: rr.cy - nh / 2,
        };
      }
    }

    // bounds for quick checks
    const minX = rects.reduce((m, r) => Math.min(m, r.x), Infinity);
    const minY = rects.reduce((m, r) => Math.min(m, r.y), Infinity);
    const maxX = rects.reduce((m, r) => Math.max(m, r.x + r.w), -Infinity);
    const maxY = rects.reduce((m, r) => Math.max(m, r.y + r.h), -Infinity);

    return { cells: rects, bounds: { x: minX, y: minY, w: maxX - minX, h: maxY - minY } };
  };

  /* -------------------- string behaviors -------------------- */
  const applySqueezeTransform = (ctx, st) => {
    if (s.strBehave !== "squeeze") return;
    const t = st * (s.squeezeSpd || 1);
    const osc = (Math.sin(t * Math.PI * 2) + 1) * 0.5; // 0..1
    const amt = clamp(s.squeezeAmt ?? 0.85, 0, 0.98);
    const sx = clamp(1 - amt * osc, 0.05, 1);
    ctx.scale(sx, 1);
  };

  const charIndexFromMode = (st, r, c, chsLen) => {
    if (chsLen <= 0) return 0;
    const beh = s.strBehave === "squeeze" ? "cycle" : s.strBehave;

    if (beh === "cycle") return (Math.floor(st * 3) + r + c) % chsLen;
    if (beh === "wave") {
      const wv = Math.sin((c * 0.5 + r * 0.3 + st) * 0.8);
      return Math.floor((wv + 1) * 0.5 * chsLen) % chsLen;
    }
    const sd = r * 1000 + c + Math.floor(st * 2);
    return Math.floor((Math.sin(sd) * 0.5 + 0.5) * chsLen);
  };

  /* -------------------- phrase mode (chop across cells) -------------------- */
  const drawPhraseChoppedInCell = (ctx, cellRect, phrase, t, axis, font, ink) => {
    // clip to cell
    ctx.save();
    ctx.beginPath();
    ctx.rect(cellRect.x, cellRect.y, cellRect.w, cellRect.h);
    ctx.clip();

    ctx.font = font;
    ctx.textBaseline = "middle";
    ctx.textAlign = "left";
    if (ink) ctx.fillStyle = ink;

    // measure phrase once per draw call
    const text = phrase.length ? phrase : " ";
    const metrics = ctx.measureText(text);
    const tw = Math.max(1, metrics.width);
    const th = (metrics.actualBoundingBoxAscent ?? 0) + (metrics.actualBoundingBoxDescent ?? 0) || 24;

    if (axis === "y") {
      // vertical scroll: rotate local drawing
      ctx.translate(cellRect.x + cellRect.w / 2, cellRect.y + cellRect.h / 2);
      ctx.rotate(-Math.PI / 2);
      // now local x axis corresponds to vertical in screen
      const scroll = (t % tw);
      let startX = -cellRect.h / 2 - scroll;
      const y = 0;
      // draw repeated
      for (let x = startX; x < cellRect.h / 2 + tw * 2; x += tw) ctx.fillText(text, x, y);
    } else {
      // horizontal scroll
      const y = cellRect.y + cellRect.h / 2;
      const scroll = (t % tw);
      let startX = cellRect.x - scroll;
      for (let x = startX; x < cellRect.x + cellRect.w + tw * 2; x += tw) ctx.fillText(text, x, y);
    }

    ctx.restore();
  };

  /* -------------------- re-seed -------------------- */
  const gen = () => setCells((prev) => prev.map((c) => ({ ...c, ph: Math.random() * Math.PI * 2 })));

  /* -------------------- resize canvas -------------------- */
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

  /* -------------------- render -------------------- */
  const render = (tm = 0) => {
    const cv = canvasRef.current;
    if (!cv) return;
    const ctx = cv.getContext("2d");
    const w = cv.width,
      h = cv.height;

    // decay midi channels
    for (let i = 0; i < 16; i++) midiChanRef.current[i] *= 0.92;

    ctx.fillStyle = "#FAFAFA";
    ctx.fillRect(0, 0, w, h);

    const midi = midiVelRef.current * s.midiSens;
    const aud = smoothAudioRef.current * s.audioSens;
    const bass = smoothBassRef.current * s.audioSens;

    const distSpd = getSpeedFactor(s.distSpd);
    const charSpd = getSpeedFactor(s.charSpd);
    const at = tm * 0.001 * distSpd;
    const ct = tm * 0.001 * charSpd;

    // default ink
    ctx.fillStyle = "#0A0A0A";

    /* -------- other patterns (kept minimal) -------- */
    if (s.pat === "vertical-lines") {
      const th = s.thick * (1 + bass * 0.5);
      for (let x = 0; x < w; x += s.space) {
        ctx.beginPath();
        for (let y = 0; y < h; y += 2) {
          let dx = x,
            dy = y;
          if (s.distOn) {
            const d = dist(x - w / 2, y - h / 2, at, s.distStr * (1 + aud), s.distType);
            dx += d.x;
            dy += d.y;
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
          let dx = x,
            dy = y;
          if (s.distOn) {
            const d = dist(x - w / 2, y - h / 2, at, s.distStr * (1 + aud), s.distType);
            dx += d.x;
            dy += d.y;
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
          let dx = x,
            dy = y;
          if (s.distOn) {
            const d = dist(x - w / 2, y - h / 2, at, s.distStr * (1 + aud), s.distType);
            dx += d.x;
            dy += d.y;
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
          let dx = x,
            dy = y;
          if (s.distOn) {
            const d = dist(x - w / 2, y - h / 2, at, s.distStr * (1 + aud), s.distType);
            dx += d.x;
            dy += d.y;
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

    /* -------------------- CHAR GRID -------------------- */
    if (s.pat === "char-grid") {
      const cols = Math.max(1, Math.floor(w / s.space));
      const rows = Math.max(1, Math.floor(h / s.space));
      const chs = s.chars.split("");

      const cellByIdx = new Map();
      for (const c of cells) cellByIdx.set(c.idx, c);

      // phrase mode: draw chopped phrase per cell by clipping
      if (s.stringMode === "phrase") {
        const font = `${Math.round(s.charSz * (s.phraseScale || 1))}px ${getFontFamily()}`;

        for (let r = 0; r < rows; r++) {
          for (let c = 0; c < cols; c++) {
            const idxLinear = r * cols + c;
            const entry = cellByIdx.get(idxLinear);

            const cellRect = { x: c * s.space, y: r * s.space, w: s.space, h: s.space };

            const st = ct + (r + c) * s.stagger;
            const fillCol = resolveFillColor({ paintObj: entry?.paint, st, r, c });
            const imgBg = resolveFillImageCanvas({ paintObj: entry?.paint, globalOn: s.imgSeqOn, st, r, c });

            if (imgBg) {
              ctx.save();
              ctx.imageSmoothingEnabled = true;
              drawCoverCanvas(ctx, imgBg, cellRect.x, cellRect.y, cellRect.w, cellRect.h);
              ctx.restore();
            }
            if (fillCol && s.fillAs === "background") {
              ctx.save();
              ctx.fillStyle = fillCol;
              ctx.globalAlpha = 0.9;
              ctx.fillRect(cellRect.x, cellRect.y, cellRect.w, cellRect.h);
              ctx.restore();
            }

            const inkOverride =
              (s.fillAs === "ink" && fillCol) ? fillCol : resolveInkColor({ paintObj: entry?.paint, globalOn: s.colorSeqOn, st, r, c }) ?? "#0A0A0A";

            // scroll time
            const scrollT = (ct * 80) * (s.phraseScroll || 1);
            drawPhraseChoppedInCell(ctx, cellRect, s.phrase, scrollT, s.phraseDir, font, inkOverride);
          }
        }
        return;
      }

      // chars mode: one char per cell but forms strings across grid
      ctx.font = `${s.charSz}px ${getFontFamily()}`;
      ctx.textAlign = "center";
      ctx.textBaseline = "middle";

      let idxLinear = 0;
      for (let r = 0; r < rows; r++) {
        for (let c = 0; c < cols; c++) {
          const x = c * s.space + s.space / 2;
          const y = r * s.space + s.space / 2;
          const st = ct + (r + c) * s.stagger;

          const entry = cellByIdx.get(idxLinear);

          const fillCol = resolveFillColor({ paintObj: entry?.paint, st, r, c });
          const imgBg = resolveFillImageCanvas({ paintObj: entry?.paint, globalOn: s.imgSeqOn, st, r, c });
          if (imgBg) drawCoverCanvas(ctx, imgBg, c * s.space, r * s.space, s.space, s.space);
          if (fillCol && s.fillAs === "background") {
            ctx.save();
            ctx.fillStyle = fillCol;
            ctx.globalAlpha = 0.9;
            ctx.fillRect(c * s.space, r * s.space, s.space, s.space);
            ctx.restore();
          }

          const inkOverride = resolveInkColor({ paintObj: entry?.paint, globalOn: s.colorSeqOn, st, r, c });

          const ci = chs.length ? charIndexFromMode(st, r, c, chs.length) : 0;

          ctx.save();
          if (s.fillAs === "ink" && fillCol) ctx.fillStyle = fillCol;
          else if (inkOverride) ctx.fillStyle = inkOverride;

          ctx.translate(x, y);
          ctx.scale(1 + ease((bass + midi) * 0.3), 1 + ease((bass + midi) * 0.3));
          applySqueezeTransform(ctx, st);

          if (chs.length) ctx.fillText(chs[ci], 0, 0);
          ctx.restore();

          idxLinear++;
        }
      }
      return;
    }

    /* -------------------- SWISS GRID -------------------- */
    if (s.pat === "swiss-grid") {
      const layout = computeSwissLayout(w, h);
      const rects = layout.cells;
      const chs = s.chars.split("");
      const cellByIdx = new Map();
      for (const c of cells) cellByIdx.set(c.idx, c);

      // optional grid lines (draw in a rotated group)
      const gridAngle = (s.gridRot || 0) * (Math.PI / 180);
      const centerX = w / 2;
      const centerY = h / 2;

      if (s.grid) {
        ctx.save();
        ctx.translate(centerX, centerY);
        if (gridAngle) ctx.rotate(gridAngle);
        ctx.translate(-centerX, -centerY);

        ctx.strokeStyle = "#E5E5E5";
        ctx.lineWidth = 0.75;

        for (let i = 0; i < rects.length; i++) {
          const r = rects[i];
          ctx.strokeRect(r.x, r.y, r.w, r.h);
        }
        ctx.restore();
      }

      // draw content also in rotated space (so grid + content match)
      ctx.save();
      ctx.translate(centerX, centerY);
      if (gridAngle) ctx.rotate(gridAngle);
      ctx.translate(-centerX, -centerY);

      // base size per cell (varies if radial is on)
      const baseFont = (rect) => `${Math.max(6, Math.min(rect.w, rect.h) * 0.55 * s.swissCharScale)}px ${getFontFamily()}`;

      // 1) Base string layer (always-on) — either chars mode or phrase mode
      if (s.swissBaseOn) {
        for (let idx = 0; idx < rects.length; idx++) {
          const rect = rects[idx];
          const r = rect.r;
          const c = rect.c;
          const entry = cellByIdx.get(idx);

          const st = ct + (r + c) * s.stagger;

          const fillCol = resolveFillColor({ paintObj: entry?.paint, st, r, c });
          const imgBg = resolveFillImageCanvas({ paintObj: entry?.paint, globalOn: s.imgSeqOn, st, r, c });

          if (imgBg) drawCoverCanvas(ctx, imgBg, rect.x, rect.y, rect.w, rect.h);
          if (fillCol && s.fillAs === "background") {
            ctx.save();
            ctx.fillStyle = fillCol;
            ctx.globalAlpha = 0.9;
            ctx.fillRect(rect.x, rect.y, rect.w, rect.h);
            ctx.restore();
          }

          // If overlay exists here (char/dot/square/svg), base is skipped (like you asked)
          const overlayType = entry?.type;
          const hasOverlay = overlayType && overlayType !== "paint";
          if (hasOverlay) continue;

          // Phrase mode => chopped phrase in each cell
          if (s.stringMode === "phrase") {
            const inkOverride =
              (s.fillAs === "ink" && fillCol) ? fillCol : resolveInkColor({ paintObj: entry?.paint, globalOn: s.colorSeqOn, st, r, c }) ?? "#0A0A0A";

            const fontPx = Math.max(8, Math.min(rect.w, rect.h) * 0.55 * s.swissCharScale * (s.phraseScale || 1));
            const font = `${Math.round(fontPx)}px ${getFontFamily()}`;
            const scrollT = (ct * 90) * (s.phraseScroll || 1);

            drawPhraseChoppedInCell(ctx, rect, s.phrase, scrollT, s.phraseDir, font, inkOverride);
            continue;
          }

          // Chars mode => single glyph string per cell
          if (!chs.length) continue;

          const ci = charIndexFromMode(st, r, c, chs.length);
          const inkOverride = resolveInkColor({ paintObj: entry?.paint, globalOn: s.colorSeqOn, st, r, c });

          ctx.save();
          if (s.fillAs === "ink" && fillCol) ctx.fillStyle = fillCol;
          else if (inkOverride) ctx.fillStyle = inkOverride;

          // per-cell rotation (the old rot)
          const gr = (s.rot + aud * 45) * (Math.PI / 180);

          ctx.translate(rect.cx, rect.cy);
          if (gr) ctx.rotate(gr);

          ctx.font = baseFont(rect);
          ctx.textAlign = "center";
          ctx.textBaseline = "middle";

          ctx.scale(1 + ease((bass + midi) * 0.3), 1 + ease((bass + midi) * 0.3));
          applySqueezeTransform(ctx, st);

          ctx.fillText(chs[ci], 0, 0);
          ctx.restore();
        }
      }

      // 2) overlays (drawn objects)
      const overlayEntries = cells.filter((c) => c.type && c.type !== "paint");
      overlayEntries.forEach((cel, k) => {
        const rect = rects[cel.idx];
        if (!rect) return;

        const r = rect.r;
        const c = rect.c;

        const st = ct + (r + c) * s.stagger;
        const lt = ct + k * s.stagger;
        const ab = ease((bass + midi) * 0.5);

        const fillCol = resolveFillColor({ paintObj: cel.paint, st, r, c });
        const imgBg = resolveFillImageCanvas({ paintObj: cel.paint, globalOn: s.imgSeqOn, st, r, c });

        if (imgBg) drawCoverCanvas(ctx, imgBg, rect.x, rect.y, rect.w, rect.h);
        if (fillCol && s.fillAs === "background") {
          ctx.save();
          ctx.fillStyle = fillCol;
          ctx.globalAlpha = 0.9;
          ctx.fillRect(rect.x, rect.y, rect.w, rect.h);
          ctx.restore();
        }

        const inkOverride = resolveInkColor({ paintObj: cel.paint, globalOn: s.colorSeqOn, st, r, c });

        ctx.save();
        if (s.fillAs === "ink" && fillCol) ctx.fillStyle = fillCol;
        else if (inkOverride) ctx.fillStyle = inkOverride;

        ctx.translate(rect.cx, rect.cy);

        const gr = (s.rot + aud * 45) * (Math.PI / 180);
        if (gr) ctx.rotate(gr);

        const baseSz = Math.min(rect.w, rect.h) * 0.55 * s.swissCharScale;

        // overlay physics
        if (s.behave === "string-wave") {
          const waveFreq = 2 + k * 0.1;
          const waveAmp = baseSz * 0.3 * (1 + ab * 0.5);
          const phase1 = Math.sin(lt * waveFreq + cel.ph);
          const phase2 = Math.cos(lt * (waveFreq * 1.5) + cel.ph + 1);
          const damping = 0.7 + ab * 0.3;
          ctx.translate(phase1 * waveAmp * damping, phase2 * waveAmp * damping);
          const stretch = 1 + phase1 * 0.2;
          ctx.scale(stretch, 1 / stretch);
        } else if (s.behave === "string-pendulum") {
          const swingAngle = Math.sin(lt * 1.5 + cel.ph) * (0.5 + ab * 0.5);
          const swingRadius = baseSz * 0.4;
          ctx.rotate(swingAngle);
          ctx.translate(0, swingRadius * Math.abs(Math.sin(swingAngle)));
          const tension = 1 + Math.abs(swingAngle) * 0.3;
          ctx.scale(1, tension);
        } else if (s.behave === "string-elastic") {
          const bounce = Math.sin(lt * 4 + cel.ph);
          const elasticity = 1 + bounce * (0.3 + ab * 0.4);
          const squash = 1 / Math.sqrt(elasticity);
          ctx.scale(squash, elasticity);
          ctx.rotate(bounce * 0.1);
        }

        if (cel.type === "char" && chs.length > 0) {
          ctx.font = `${baseSz}px ${getFontFamily()}`;
          ctx.textAlign = "center";
          ctx.textBaseline = "middle";
          const cf = (lt * 2) % chs.length;
          const ci = Math.floor(cf);
          const ni = (ci + 1) % chs.length;
          const pr = cf - ci;
          const ep = ease(pr);
          ctx.globalAlpha = 1 - ep;
          ctx.fillText(chs[ci], 0, 0);
          ctx.globalAlpha = ep;
          ctx.fillText(chs[ni], 0, 0);
          ctx.globalAlpha = 1;
        } else if (cel.type === "dot") {
          ctx.beginPath();
          ctx.arc(0, 0, baseSz * 0.35 * (1 + ab * 0.4), 0, Math.PI * 2);
          ctx.fill();
        } else if (cel.type === "square") {
          const ss = baseSz * 0.75 * (1 + ab * 0.4);
          ctx.fillRect(-ss / 2, -ss / 2, ss, ss);
        } else if (cel.type === "svg" && svgPath) {
          const scale = baseSz / Math.max(svgPath.width, svgPath.height);
          ctx.save();
          ctx.scale(scale, scale);
          ctx.translate(-svgPath.width / 2, -svgPath.height / 2);
          const path = new Path2D(svgPath.path);
          ctx.fill(path);
          ctx.restore();
        }

        ctx.restore();
      });

      ctx.restore(); // end rotated grid group

      // Optional reference image overlay (helps sampling)
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
  }, [s, cells, paint, svgPath]);

  /* -------------------- UI helpers -------------------- */
  const interactive = s.pat === "swiss-grid" || s.pat === "char-grid";
  const bpmDisplay = bpmRef.current.smooth;

  const addOptionBlockClass = "w-full px-3 py-2 bg-white border border-neutral-300 rounded-lg text-xs";

  return (
    <div className="w-full h-[100svh] bg-white flex flex-col md:flex-row">
      {/* mobile overlay */}
      {panelOpen && (
        <div className="fixed inset-0 bg-black/30 z-30 md:hidden" onClick={() => setPanelOpen(false)} />
      )}

      {/* controls drawer */}
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

              <label className="block text-xs font-semibold uppercase tracking-wider">Multiplier: {s.bpmMultiply.toFixed(2)}×</label>
              <input
                type="range"
                min="0.25"
                max="4"
                step="0.01"
                value={s.bpmMultiply}
                onChange={(e) => setS((p) => ({ ...p, bpmMultiply: parseFloat(e.target.value) }))}
                className="w-full"
              />

              <div className="text-xs text-neutral-600">Affects Char Speed + Distortion Speed in both grids.</div>
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

          <select value={audioMode} onChange={(e) => setAudioMode(e.target.value)} className={addOptionBlockClass}>
            <option value="mic">Microphone</option>
            <option value="file">Audio File</option>
          </select>

          {audioMode === "mic" && audioDevs.length > 0 && (
            <select value={selAudio} onChange={(e) => setSelAudio(e.target.value)} className={addOptionBlockClass}>
              {audioDevs.map((d) => (
                <option key={d.deviceId} value={d.deviceId}>
                  {d.label || `Device ${d.deviceId.slice(0, 8)}`}
                </option>
              ))}
            </select>
          )}

          {audioMode === "file" && (
            <div className="space-y-2">
              <div className="flex items-center justify-between gap-2">
                <div className="text-xs text-neutral-700 truncate">{audioFileName || "No file selected"}</div>
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
              <div className="text-[11px] text-neutral-600">Tip: File mode is easiest on mobile.</div>
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
          {midiOn && midiDevs.length > 0 && <div className="text-xs text-neutral-600">{midiDevs.length} device(s)</div>}
        </div>

        {/* Distortion */}
        <div className="space-y-2">
          <div className="flex items-center justify-between">
            <label className="text-xs font-semibold uppercase tracking-wider">Distortion</label>
            <button
              onClick={() => setS((p) => ({ ...p, distOn: !p.distOn }))}
              className={`p-1.5 rounded ${s.distOn ? "bg-black text-white" : "bg-neutral-200"}`}
            >
              {s.distOn ? <Play size={14} fill="white" /> : <Square size={14} />}
            </button>
          </div>

          {s.distOn && (
            <>
              <select value={s.distType} onChange={(e) => setS((p) => ({ ...p, distType: e.target.value }))} className={addOptionBlockClass}>
                <option value="liquify">Liquify</option>
                <option value="ripple">Ripple</option>
                <option value="swirl">Swirl</option>
              </select>

              <label className="block text-xs font-semibold uppercase tracking-wider">Strength: {s.distStr}</label>
              <input type="range" min="0" max="200" value={s.distStr} onChange={(e) => setS((p) => ({ ...p, distStr: parseInt(e.target.value) }))} className="w-full" />

              <label className="block text-xs font-semibold uppercase tracking-wider">Speed: {s.distSpd}×</label>
              <input type="range" min="0" max="10" step="0.1" value={s.distSpd} onChange={(e) => setS((p) => ({ ...p, distSpd: parseFloat(e.target.value) }))} className="w-full" />
            </>
          )}
        </div>

        {/* String mode */}
        {interactive && (
          <div className="space-y-2">
            <label className="block text-xs font-semibold uppercase tracking-wider flex items-center gap-2">
              <Type size={14} /> String Mode
            </label>
            <select value={s.stringMode} onChange={(e) => setS((p) => ({ ...p, stringMode: e.target.value }))} className={addOptionBlockClass}>
              <option value="chars">Chars (one glyph per cell)</option>
              <option value="phrase">Phrase (chopped across cells)</option>
            </select>

            {s.stringMode === "phrase" && (
              <>
                <label className="block text-xs font-semibold uppercase tracking-wider">Phrase</label>
                <input value={s.phrase} onChange={(e) => setS((p) => ({ ...p, phrase: e.target.value }))} className="w-full px-3 py-2 bg-white border border-neutral-300 rounded-lg font-mono text-xs" />

                <div className="grid grid-cols-2 gap-2">
                  <div className="space-y-1">
                    <div className="text-xs text-neutral-600">Direction</div>
                    <select value={s.phraseDir} onChange={(e) => setS((p) => ({ ...p, phraseDir: e.target.value }))} className={addOptionBlockClass}>
                      <option value="x">Horizontal</option>
                      <option value="y">Vertical</option>
                    </select>
                  </div>
                  <div className="space-y-1">
                    <div className="text-xs text-neutral-600">Scroll</div>
                    <input type="range" min="0" max="4" step="0.05" value={s.phraseScroll} onChange={(e) => setS((p) => ({ ...p, phraseScroll: parseFloat(e.target.value) }))} className="w-full" />
                  </div>
                </div>

                <label className="block text-xs font-semibold uppercase tracking-wider">Scale: {s.phraseScale.toFixed(2)}×</label>
                <input type="range" min="0.6" max="2" step="0.01" value={s.phraseScale} onChange={(e) => setS((p) => ({ ...p, phraseScale: parseFloat(e.target.value) }))} className="w-full" />
              </>
            )}
          </div>
        )}

        {/* String behavior */}
        {interactive && (
          <div className="space-y-2">
            <label className="block text-xs font-semibold uppercase tracking-wider">String Behavior</label>
            <select value={s.strBehave} onChange={(e) => setS((p) => ({ ...p, strBehave: e.target.value }))} className={addOptionBlockClass}>
              <option value="cycle">Cycle</option>
              <option value="wave">Wave</option>
              <option value="random">Random</option>
              <option value="squeeze">Squeeze (%)</option>
            </select>

            {s.strBehave === "squeeze" && (
              <>
                <label className="block text-xs font-semibold uppercase tracking-wider">Squeeze: {Math.round(s.squeezeAmt * 100)}%</label>
                <input type="range" min="0" max="0.98" step="0.01" value={s.squeezeAmt} onChange={(e) => setS((p) => ({ ...p, squeezeAmt: parseFloat(e.target.value) }))} className="w-full" />

                <label className="block text-xs font-semibold uppercase tracking-wider">Squeeze Speed: {s.squeezeSpd.toFixed(2)}×</label>
                <input type="range" min="0" max="6" step="0.05" value={s.squeezeSpd} onChange={(e) => setS((p) => ({ ...p, squeezeSpd: parseFloat(e.target.value) }))} className="w-full" />
              </>
            )}
          </div>
        )}

        {/* Characters */}
        {interactive && s.stringMode === "chars" && (
          <div className="space-y-2">
            <label className="block text-xs font-semibold uppercase tracking-wider">Characters</label>
            <input
              type="text"
              value={s.chars}
              onChange={(e) => setS((p) => ({ ...p, chars: e.target.value }))}
              className="w-full px-3 py-2 bg-white border border-neutral-300 rounded-lg font-mono"
            />
          </div>
        )}

        {/* Speed */}
        {interactive && (
          <div className="space-y-2">
            <label className="block text-xs font-semibold uppercase tracking-wider">Speed: {s.charSpd.toFixed(2)}×</label>
            <input type="range" min="0" max="10" step="0.1" value={s.charSpd} onChange={(e) => setS((p) => ({ ...p, charSpd: parseFloat(e.target.value) }))} className="w-full" />
          </div>
        )}

        {/* Color string */}
        {interactive && (
          <div className="space-y-2">
            <div className="flex items-center justify-between">
              <label className="text-xs font-semibold uppercase tracking-wider flex items-center gap-2">
                <Palette size={14} /> Color String
              </label>
              <button onClick={() => setS((p) => ({ ...p, colorSeqOn: !p.colorSeqOn }))} className={`p-1.5 rounded ${s.colorSeqOn ? "bg-black text-white" : "bg-neutral-200"}`}>
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

            <div className="grid grid-cols-2 gap-2">
              <div className="space-y-1">
                <div className="text-xs text-neutral-600">Behavior</div>
                <select value={s.colorSeqBehave} onChange={(e) => setS((p) => ({ ...p, colorSeqBehave: e.target.value }))} className={addOptionBlockClass}>
                  <option value="same">Same as letters</option>
                  <option value="cycle">Cycle</option>
                  <option value="wave">Wave</option>
                  <option value="random">Random</option>
                  <option value="squeeze">Squeeze</option>
                </select>
              </div>
              <div className="space-y-1">
                <div className="text-xs text-neutral-600">Speed</div>
                <input type="range" min="0" max="4" step="0.05" value={s.colorSeqSpeed} onChange={(e) => setS((p) => ({ ...p, colorSeqSpeed: parseFloat(e.target.value) }))} className="w-full" />
              </div>
            </div>
          </div>
        )}

        {/* Paint + Image */}
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
              <input type="color" value={paint.color} onChange={(e) => setPaint((p) => ({ ...p, color: e.target.value, useSeq: false }))} className="h-10 w-14 rounded-md border border-neutral-300 bg-white" />
              <div className="flex-1">
                <div className="text-xs text-neutral-600">Paint</div>
                <div className="font-mono text-xs">{paint.useSeq ? "(color string)" : paint.color}</div>
              </div>

              <select value={s.fillAs} onChange={(e) => setS((p) => ({ ...p, fillAs: e.target.value }))} className={addOptionBlockClass}>
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

            <div className="space-y-2">
              <div className="flex items-center justify-between">
                <div className="text-xs text-neutral-700 font-medium flex items-center gap-2">
                  <ImageIcon size={14} /> Upload image (for sampling)
                </div>
                {imageInfo.loaded && <div className="text-[10px] text-green-700">✓ {imageInfo.name}</div>}
              </div>
              <input type="file" accept="image/*" onChange={handleImageUpload} className="w-full text-xs" />

              <div className="flex items-center justify-between mt-2">
                <label className="text-xs font-semibold uppercase tracking-wider">Image Preview</label>
                <button onClick={() => setS((p) => ({ ...p, imgPreviewOn: !p.imgPreviewOn }))} className={`p-1.5 rounded ${s.imgPreviewOn ? "bg-black text-white" : "bg-neutral-200"}`}>
                  {s.imgPreviewOn ? <Play size={14} fill="white" /> : <Square size={14} />}
                </button>
              </div>
              <label className="block text-xs font-semibold uppercase tracking-wider">Opacity: {Math.round((s.imgPreviewAlpha ?? 0.15) * 100)}%</label>
              <input type="range" min="0" max="0.6" step="0.01" value={s.imgPreviewAlpha ?? 0.15} onChange={(e) => setS((p) => ({ ...p, imgPreviewAlpha: parseFloat(e.target.value) }))} className="w-full" />
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
                      <span className={`text-[10px] ${slot.loaded ? "text-green-700" : "text-neutral-500"}`}>{slot.loaded ? "✓" : i + 1}</span>
                    </div>
                    <input type="file" accept="image/*" onChange={(e) => handleImageSeqUpload(i, e.target.files?.[0])} className="w-full text-[10px]" />
                    {slot.loaded && (
                      <button onClick={() => clearImageSeqSlot(i)} className="w-full text-[10px] text-red-600 hover:underline">
                        remove
                      </button>
                    )}
                  </div>
                ))}
              </div>

              <div className="grid grid-cols-2 gap-2">
                <div className="space-y-1">
                  <div className="text-xs text-neutral-600">Behavior</div>
                  <select value={s.imgSeqBehave} onChange={(e) => setS((p) => ({ ...p, imgSeqBehave: e.target.value }))} className={addOptionBlockClass}>
                    <option value="same">Same as letters</option>
                    <option value="cycle">Cycle</option>
                    <option value="wave">Wave</option>
                    <option value="random">Random</option>
                    <option value="squeeze">Squeeze</option>
                  </select>
                </div>
                <div className="space-y-1">
                  <div className="text-xs text-neutral-600">Speed</div>
                  <input type="range" min="0" max="4" step="0.05" value={s.imgSeqSpeed} onChange={(e) => setS((p) => ({ ...p, imgSeqSpeed: parseFloat(e.target.value) }))} className="w-full" />
                </div>
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

        {/* Swiss-grid controls */}
        {s.pat === "swiss-grid" && (
          <div className="space-y-3">
            <div className="flex items-center gap-2">
              <Grid3X3 size={14} />
              <div className="text-xs font-semibold uppercase tracking-wider">Swiss Grid Design</div>
            </div>

            <label className="block text-xs font-semibold uppercase tracking-wider">Cols × Rows: {s.cols} × {s.rows}</label>
            <input type="range" min="2" max="40" value={s.cols} onChange={(e) => setS((p) => ({ ...p, cols: parseInt(e.target.value) }))} className="w-full" />
            <input type="range" min="2" max="40" value={s.rows} onChange={(e) => setS((p) => ({ ...p, rows: parseInt(e.target.value) }))} className="w-full" />

            <label className="block text-xs font-semibold uppercase tracking-wider">Margins X/Y: {s.marginX}px / {s.marginY}px</label>
            <input type="range" min="0" max="200" value={s.marginX} onChange={(e) => setS((p) => ({ ...p, marginX: parseInt(e.target.value) }))} className="w-full" />
            <input type="range" min="0" max="200" value={s.marginY} onChange={(e) => setS((p) => ({ ...p, marginY: parseInt(e.target.value) }))} className="w-full" />

            <label className="block text-xs font-semibold uppercase tracking-wider">Gutters X/Y: {s.gutterX}px / {s.gutterY}px</label>
            <input type="range" min="0" max="80" value={s.gutterX} onChange={(e) => setS((p) => ({ ...p, gutterX: parseInt(e.target.value) }))} className="w-full" />
            <input type="range" min="0" max="80" value={s.gutterY} onChange={(e) => setS((p) => ({ ...p, gutterY: parseInt(e.target.value) }))} className="w-full" />

            <label className="block text-xs font-semibold uppercase tracking-wider">Grid Rotate: {s.gridRot}°</label>
            <input type="range" min="-45" max="45" step="1" value={s.gridRot} onChange={(e) => setS((p) => ({ ...p, gridRot: parseInt(e.target.value) }))} className="w-full" />

            <div className="flex items-center justify-between">
              <label className="text-xs font-semibold uppercase tracking-wider">Radial Density</label>
              <button onClick={() => setS((p) => ({ ...p, radialGridOn: !p.radialGridOn }))} className={`p-1.5 rounded ${s.radialGridOn ? "bg-black text-white" : "bg-neutral-200"}`}>
                {s.radialGridOn ? <Play size={14} fill="white" /> : <Square size={14} />}
              </button>
            </div>

            {s.radialGridOn && (
              <>
                <label className="block text-xs font-semibold uppercase tracking-wider">Focus X: {(s.gridCenterX * 100).toFixed(0)}%</label>
                <input type="range" min="0" max="1" step="0.01" value={s.gridCenterX} onChange={(e) => setS((p) => ({ ...p, gridCenterX: parseFloat(e.target.value) }))} className="w-full" />
                <label className="block text-xs font-semibold uppercase tracking-wider">Focus Y: {(s.gridCenterY * 100).toFixed(0)}%</label>
                <input type="range" min="0" max="1" step="0.01" value={s.gridCenterY} onChange={(e) => setS((p) => ({ ...p, gridCenterY: parseFloat(e.target.value) }))} className="w-full" />

                <label className="block text-xs font-semibold uppercase tracking-wider">Strength: {s.radialStrength.toFixed(2)}</label>
                <input type="range" min="0" max="4" step="0.01" value={s.radialStrength} onChange={(e) => setS((p) => ({ ...p, radialStrength: parseFloat(e.target.value) }))} className="w-full" />

                <label className="block text-xs font-semibold uppercase tracking-wider">Max Scale: {s.radialMaxScale.toFixed(2)}×</label>
                <input type="range" min="1" max="6" step="0.01" value={s.radialMaxScale} onChange={(e) => setS((p) => ({ ...p, radialMaxScale: parseFloat(e.target.value) }))} className="w-full" />
              </>
            )}

            <div className="flex items-center justify-between">
              <label className="text-xs font-semibold uppercase tracking-wider">Swiss Base Letters</label>
              <button onClick={() => setS((p) => ({ ...p, swissBaseOn: !p.swissBaseOn }))} className={`p-1.5 rounded ${s.swissBaseOn ? "bg-black text-white" : "bg-neutral-200"}`}>
                {s.swissBaseOn ? <Play size={14} fill="white" /> : <Square size={14} />}
              </button>
            </div>

            <label className="block text-xs font-semibold uppercase tracking-wider">Glyph Scale: {s.swissCharScale.toFixed(2)}×</label>
            <input type="range" min="0.5" max="2" step="0.01" value={s.swissCharScale} onChange={(e) => setS((p) => ({ ...p, swissCharScale: parseFloat(e.target.value) }))} className="w-full" />

            <label className="block text-xs font-semibold uppercase tracking-wider">Draw Element</label>
            <select value={s.selEl} onChange={(e) => setS((p) => ({ ...p, selEl: e.target.value }))} className={addOptionBlockClass}>
              <option value="char">Character</option>
              <option value="dot">Dot</option>
              <option value="square">Square</option>
              <option value="svg">SVG</option>
            </select>

            <div className="flex items-center justify-between">
              <label className="text-xs font-semibold uppercase tracking-wider">Draw Mode</label>
              <button onClick={() => setS((p) => ({ ...p, draw: !p.draw }))} className={`p-1.5 rounded ${s.draw ? "bg-black text-white" : "bg-neutral-200"}`}>
                {s.draw ? <Play size={14} fill="white" /> : <Square size={14} />}
              </button>
            </div>

            <button onClick={() => setCells([])} className="w-full px-4 py-2.5 bg-neutral-900 text-white rounded-lg font-medium hover:bg-black min-h-[44px]">
              Clear
            </button>

            <label className="block text-xs font-semibold uppercase tracking-wider">Overlay Behavior</label>
            <select value={s.behave} onChange={(e) => setS((p) => ({ ...p, behave: e.target.value }))} className={addOptionBlockClass}>
              <option value="string-wave">String Wave</option>
              <option value="string-pendulum">String Pendulum</option>
              <option value="string-elastic">String Elastic</option>
            </select>
          </div>
        )}

        {/* Char-grid extra controls */}
        {s.pat === "char-grid" && (
          <div className="space-y-2">
            <label className="block text-xs font-semibold uppercase tracking-wider">Char Size: {s.charSz}px</label>
            <input type="range" min="8" max="80" value={s.charSz} onChange={(e) => setS((p) => ({ ...p, charSz: parseInt(e.target.value) }))} className="w-full" />

            <label className="block text-xs font-semibold uppercase tracking-wider">Spacing: {s.space}px</label>
            <input type="range" min="10" max="220" value={s.space} onChange={(e) => setS((p) => ({ ...p, space: parseInt(e.target.value) }))} className="w-full" />

            <div className="flex items-center justify-between">
              <label className="text-xs font-semibold uppercase tracking-wider">Draw Mode</label>
              <button onClick={() => setS((p) => ({ ...p, draw: !p.draw }))} className={`p-1.5 rounded ${s.draw ? "bg-black text-white" : "bg-neutral-200"}`}>
                {s.draw ? <Play size={14} fill="white" /> : <Square size={14} />}
              </button>
            </div>

            <button onClick={() => setCells([])} className="w-full px-4 py-2.5 bg-neutral-900 text-white rounded-lg font-medium hover:bg-black min-h-[44px]">
              Clear Painted Cells
            </button>
          </div>
        )}

        {/* Fonts */}
        <div className="space-y-2">
          <label className="block text-xs font-semibold uppercase tracking-wider">Google Font</label>
          <select value={s.googleFont} onChange={(e) => setS((p) => ({ ...p, googleFont: e.target.value }))} className={addOptionBlockClass}>
            <option value="Inter">Inter</option>
            <option value="Roboto Mono">Roboto Mono</option>
            <option value="Space Mono">Space Mono</option>
            <option value="JetBrains Mono">JetBrains Mono</option>
            <option value="Fira Code">Fira Code</option>
          </select>

          <label className="block text-xs font-semibold uppercase tracking-wider">Custom Font (.ttf/.otf)</label>
          <input type="file" accept=".ttf,.otf,.woff,.woff2" onChange={handleFontUpload} className="w-full text-xs" />
          {s.customFont && <div className="text-xs text-green-600">✓ Custom font loaded</div>}

          <label className="block text-xs font-semibold uppercase tracking-wider">Upload SVG Shape</label>
          <input type="file" accept=".svg" onChange={handleSvgUpload} className="w-full text-xs" />
          {svgPath && <div className="text-xs text-green-600">✓ SVG loaded</div>}
        </div>

        {/* sensitivity */}
        <div className="space-y-2">
          <label className="block text-xs font-semibold uppercase tracking-wider">Audio Sensitivity: {s.audioSens}</label>
          <input type="range" min="0" max="10" step="0.1" value={s.audioSens} onChange={(e) => setS((p) => ({ ...p, audioSens: parseFloat(e.target.value) }))} className="w-full" />
        </div>

        <div className="space-y-2">
          <label className="block text-xs font-semibold uppercase tracking-wider">MIDI Sensitivity: {s.midiSens}</label>
          <input type="range" min="0" max="10" step="0.1" value={s.midiSens} onChange={(e) => setS((p) => ({ ...p, midiSens: parseFloat(e.target.value) }))} className="w-full" />
        </div>
      </div>

      {/* canvas */}
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
          <div className="fixed bg-white shadow-2xl rounded-lg border py-1 z-50" style={{ left: menu.x, top: menu.y }} onClick={(e) => e.stopPropagation()}>
            <button onClick={() => add("char")} className="block w-full px-4 py-2 text-left hover:bg-gray-100 text-sm">
              Add Char
            </button>
            <button onClick={() => add("dot")} className="block w-full px-4 py-2 text-left hover:bg-gray-100 text-sm">
              Add Dot
            </button>
            <button onClick={() => add("square")} className="block w-full px-4 py-2 text-left hover:bg-gray-100 text-sm">
              Add Square
            </button>
            <button onClick={() => add("svg")} className="block w-full px-4 py-2 text-left hover:bg-gray-100 text-sm flex items-center gap-2">
              <ImageIcon size={14} /> Add SVG
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
