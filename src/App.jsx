import React, { useState, useEffect, useRef } from "react";
import { Play, Pause, RotateCcw, Download, Type, Grid } from "lucide-react";

const PixelMoireGenerator = () => {
  const canvasRef = useRef(null);
  const animationRef = useRef(null);

  const [isAnimating, setIsAnimating] = useState(false);

  const [customFonts, setCustomFonts] = useState([]);
  const [activeSettings, setActiveSettings] = useState(null);
  const [targetSettings, setTargetSettings] = useState(null);

  const transitionProgress = useRef(0);
  const transitionSpeed = 0.08;

  // =========================
  // AUDIO
  // =========================
  const [audioEnabled, setAudioEnabled] = useState(false);
  const [audioDevices, setAudioDevices] = useState([]);
  const [selectedAudioDevice, setSelectedAudioDevice] = useState(null);

  const audioContextRef = useRef(null);
  const analyserRef = useRef(null);
  const audioRAFRef = useRef(null);

  // UI meters only
  const [audioLevel, setAudioLevel] = useState(0);
  const [bassLevel, setBassLevel] = useState(0);
  const [midLevel, setMidLevel] = useState(0);
  const [highLevel, setHighLevel] = useState(0);

  // Geometry-driving audio frame (NO React state)
  const audioFrameRef = useRef({
    level: 0,
    bass: 0,
    mid: 0,
    high: 0,
    waveform: new Float32Array(0),
    fft: new Uint8Array(0),
    phase: 0,
  });

  // =========================
  // SETTINGS
  // =========================
  const [settings, setSettings] = useState({
    patternType: "vertical-lines",
    lineThickness: 10,
    spacing: 20,

    textEnabled: false,
    text: "",
    fontSize: 120,
    font: "Impact",

    distortionEnabled: true,
    distortionStrength: 20,
    distortionSpeed: 1,

    pixelationEnabled: false,
    pixelSize: 4,

    showGrid: false,
    gridSize: 20,

    // Audio toggles
    audioReactiveSpacing: false,
    audioReactiveThickness: false,
    audioReactiveDistortion: false,
    audioReactivePattern: false,

    // ⭐ SHAPE BENDING ⭐
    audioReactiveShape: true,
    audioShapeAmount: 60,
    audioShapeScale: 0.015,
  });

  // =========================
  // AUDIO DEVICE ENUM
  // =========================
  useEffect(() => {
    const getDevices = async () => {
      const devices = await navigator.mediaDevices.enumerateDevices();
      const inputs = devices.filter(d => d.kind === "audioinput");
      setAudioDevices(inputs);
      if (!selectedAudioDevice && inputs.length) {
        setSelectedAudioDevice(inputs[0].deviceId);
      }
    };
    getDevices();
    navigator.mediaDevices.addEventListener("devicechange", getDevices);
    return () =>
      navigator.mediaDevices.removeEventListener("devicechange", getDevices);
  }, []);

  // =========================
  // AUDIO INIT
  // =========================
  useEffect(() => {
    if (!audioEnabled) {
      if (audioRAFRef.current) cancelAnimationFrame(audioRAFRef.current);
      if (audioContextRef.current) audioContextRef.current.close();
      return;
    }

    const init = async () => {
      const stream = await navigator.mediaDevices.getUserMedia({
        audio: {
          deviceId: selectedAudioDevice
            ? { exact: selectedAudioDevice }
            : undefined,
        },
      });

      const ctx = new AudioContext();
      const src = ctx.createMediaStreamSource(stream);
      const analyser = ctx.createAnalyser();
      analyser.fftSize = 8192;
      analyser.smoothingTimeConstant = 0.2;

      src.connect(analyser);

      audioContextRef.current = ctx;
      analyserRef.current = analyser;

      const update = () => {
        if (!analyserRef.current) return;

        const analyser = analyserRef.current;
        const f = audioFrameRef.current;

        // FFT
        const bins = analyser.frequencyBinCount;
        if (f.fft.length !== bins) f.fft = new Uint8Array(bins);
        analyser.getByteFrequencyData(f.fft);

        // Waveform
        if (f.waveform.length !== analyser.fftSize) {
          f.waveform = new Float32Array(analyser.fftSize);
        }
        analyser.getFloatTimeDomainData(f.waveform);

        const avg = (a, b) => {
          let s = 0;
          for (let i = a; i < b; i++) s += f.fft[i];
          return s / Math.max(1, b - a) / 255;
        };

        const bass = avg(0, bins * 0.1);
        const mid = avg(bins * 0.1, bins * 0.4);
        const high = avg(bins * 0.4, bins * 0.8);
        const level = (bass + mid + high) / 3;

        const smooth = 0.15;
        f.bass += (bass - f.bass) * smooth;
        f.mid += (mid - f.mid) * smooth;
        f.high += (high - f.high) * smooth;
        f.level += (level - f.level) * smooth;
        f.phase += 0.04 + f.high * 0.2;

        setAudioLevel(f.level);
        setBassLevel(f.bass);
        setMidLevel(f.mid);
        setHighLevel(f.high);

        audioRAFRef.current = requestAnimationFrame(update);
      };

      update();
    };

    init();
  }, [audioEnabled, selectedAudioDevice]);

  // =========================
  // AUDIO → SHAPE WARP
  // =========================
  const getAudioWarp = (x, y, w, h) => {
    if (!audioEnabled || !settings.audioReactiveShape) return { x: 0, y: 0 };

    const f = audioFrameRef.current;
    const amt = settings.audioShapeAmount;
    const scale = settings.audioShapeScale;

    const wfIndex = Math.floor((y / h) * (f.waveform.length - 1));
    const wf = f.waveform[wfIndex] || 0;

    const travel = Math.sin(y * scale + f.phase);
    const bend = wf * 0.6 + travel * 0.4;

    return {
      x: bend * amt * (0.3 + f.mid),
      y: bend * amt * 0.15 * (0.3 + f.bass),
    };
  };

  // =========================
  // DRAW
  // =========================
  const render = (time = 0) => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext("2d");

    canvas.width = canvas.offsetWidth;
    canvas.height = canvas.offsetHeight;

    const w = canvas.width;
    const h = canvas.height;

    ctx.fillStyle = "#fff";
    ctx.fillRect(0, 0, w, h);
    ctx.strokeStyle = "#000";

    const t = isAnimating ? time * 0.001 * settings.distortionSpeed : 0;

    if (settings.patternType === "vertical-lines") {
      for (let x = 0; x < w; x += settings.spacing) {
        ctx.beginPath();
        let first = true;

        for (let y = 0; y < h; y++) {
          let dx = x;
          let dy = y;

          const aw = getAudioWarp(dx, dy, w, h);
          dx += aw.x;
          dy += aw.y;

          if (first) {
            ctx.moveTo(dx, dy);
            first = false;
          } else ctx.lineTo(dx, dy);
        }

        ctx.lineWidth = settings.lineThickness;
        ctx.stroke();
      }
    }

    if (settings.patternType === "horizontal-lines") {
      for (let y = 0; y < h; y += settings.spacing) {
        ctx.beginPath();
        let first = true;

        for (let x = 0; x < w; x++) {
          let dx = x;
          let dy = y;

          const aw = getAudioWarp(dx, dy, w, h);
          dx += aw.x * 0.2;
          dy += aw.x;

          if (first) {
            ctx.moveTo(dx, dy);
            first = false;
          } else ctx.lineTo(dx, dy);
        }

        ctx.lineWidth = settings.lineThickness;
        ctx.stroke();
      }
    }
  };

  // =========================
  // RAF LOOP
  // =========================
  useEffect(() => {
    const loop = (t) => {
      render(t);
      animationRef.current = requestAnimationFrame(loop);
    };
    animationRef.current = requestAnimationFrame(loop);
    return () => cancelAnimationFrame(animationRef.current);
  }, [settings, isAnimating, audioEnabled]);

  return (
    <div className="w-full h-screen flex">
      <div className="w-72 p-4 bg-white border-r space-y-3">
        <button onClick={() => setIsAnimating(!isAnimating)}>
          {isAnimating ? <Pause /> : <Play />}
        </button>

        <label>
          <input
            type="checkbox"
            checked={audioEnabled}
            onChange={(e) => setAudioEnabled(e.target.checked)}
          />
          Audio Reactive Shape
        </label>

        <label>
          Shape Amount
          <input
            type="range"
            min="0"
            max="120"
            value={settings.audioShapeAmount}
            onChange={(e) =>
              setSettings((s) => ({
                ...s,
                audioShapeAmount: +e.target.value,
              }))
            }
          />
        </label>
      </div>

      <canvas
        ref={canvasRef}
        className="flex-1 bg-white"
        style={{ width: "100%", height: "100%" }}
      />
    </div>
  );
};

export default PixelMoireGenerator;
