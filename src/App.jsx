import React, { useState, useEffect, useRef } from "react";
import { Play, Pause } from "lucide-react";

const PixelMoireGenerator = () => {
  const canvasRef = useRef(null);
  const rafRef = useRef(null);

  // =========================
  // STATE
  // =========================
  const [isAnimating, setIsAnimating] = useState(true);
  const [audioEnabled, setAudioEnabled] = useState(false);

  // =========================
  // AUDIO
  // =========================
  const audioCtxRef = useRef(null);
  const analyserRef = useRef(null);
  const streamRef = useRef(null);
  const audioRAFRef = useRef(null);

  const audioFrame = useRef({
    bass: 0,
    mid: 0,
    high: 0,
    level: 0,
    fft: new Uint8Array(0),
    phase: 0,
  });

  // =========================
  // SETTINGS (keeps your vibe)
  // =========================
  const settings = useRef({
    spacing: 18,
    thickness: 1.5,
    distortionStrength: 20,

    audioAmount: 60,
    interferenceRatio: 1.037,
  });

  // =========================
  // AUDIO INIT
  // =========================
  useEffect(() => {
    if (!audioEnabled) {
      if (audioRAFRef.current) cancelAnimationFrame(audioRAFRef.current);
      if (streamRef.current) streamRef.current.getTracks().forEach(t => t.stop());
      if (audioCtxRef.current) audioCtxRef.current.close();
      return;
    }

    const init = async () => {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      streamRef.current = stream;

      const AudioCtx = window.AudioContext || window.webkitAudioContext;
      const ctx = new AudioCtx();
      await ctx.resume();

      const src = ctx.createMediaStreamSource(stream);
      const analyser = ctx.createAnalyser();
      analyser.fftSize = 4096;
      analyser.smoothingTimeConstant = 0.15;

      src.connect(analyser);

      audioCtxRef.current = ctx;
      analyserRef.current = analyser;

      const update = () => {
        const a = analyserRef.current;
        if (!a) return;

        const f = audioFrame.current;
        const bins = a.frequencyBinCount;
        if (f.fft.length !== bins) f.fft = new Uint8Array(bins);
        a.getByteFrequencyData(f.fft);

        const avg = (s, e) => {
          let sum = 0;
          for (let i = s; i < e; i++) sum += f.fft[i];
          return sum / (e - s) / 255;
        };

        const bass = avg(0, bins * 0.1);
        const mid = avg(bins * 0.1, bins * 0.45);
        const high = avg(bins * 0.45, bins * 0.9);
        const level = (bass + mid + high) / 3;

        const smooth = 0.18;
        f.bass += (bass - f.bass) * smooth;
        f.mid += (mid - f.mid) * smooth;
        f.high += (high - f.high) * smooth;
        f.level += (level - f.level) * smooth;

        f.phase += 0.03 + f.high * 0.25 + f.level * 0.06;

        audioRAFRef.current = requestAnimationFrame(update);
      };

      update();
    };

    init();
  }, [audioEnabled]);

  // =========================
  // PHASE FIELD (REAL MOIRÉ)
  // =========================
  const phaseField = (x, y) => {
    if (!audioEnabled) return 0;

    const f = audioFrame.current;
    const amt = settings.current.audioAmount;

    const fx = 0.02 * (1 + f.mid * 0.15);
    const fy = fx * settings.current.interferenceRatio;

    const p1 = Math.sin(y * fy + f.phase * 0.8) * f.bass * amt * 2.2;
    const p2 = Math.sin(x * fx - f.phase * 1.1) * f.mid * amt * 1.9;
    const shimmer =
      Math.sin((x + y) * 0.08 + f.phase * 3.5) * f.high * amt * 0.4;

    return p1 + p2 + shimmer;
  };

  // =========================
  // DRAW
  // =========================
  const render = () => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext("2d");

    const w = canvas.width = canvas.offsetWidth;
    const h = canvas.height = canvas.offsetHeight;

    ctx.fillStyle = "#fff";
    ctx.fillRect(0, 0, w, h);
    ctx.strokeStyle = "#000";
    ctx.lineWidth = settings.current.thickness;

    // ---------- LAYER A ----------
    for (let x = 0; x < w; x += settings.current.spacing) {
      ctx.beginPath();
      let first = true;
      for (let y = 0; y < h; y++) {
        let dx = x + phaseField(x, y);
        if (first) {
          ctx.moveTo(dx, y);
          first = false;
        } else ctx.lineTo(dx, y);
      }
      ctx.stroke();
    }

    // ---------- LAYER B (interference) ----------
    ctx.globalAlpha = 0.65;
    for (let y = 0; y < h; y += settings.current.spacing * 1.01) {
      ctx.beginPath();
      let first = true;
      for (let x = 0; x < w; x++) {
        let dy = y + phaseField(x, y);
        if (first) {
          ctx.moveTo(x, dy);
          first = false;
        } else ctx.lineTo(x, dy);
      }
      ctx.stroke();
    }
    ctx.globalAlpha = 1;
  };

  // =========================
  // RAF LOOP
  // =========================
  useEffect(() => {
    const loop = () => {
      if (isAnimating) render();
      rafRef.current = requestAnimationFrame(loop);
    };
    rafRef.current = requestAnimationFrame(loop);
    return () => cancelAnimationFrame(rafRef.current);
  }, [isAnimating, audioEnabled]);

  // =========================
  // UI
  // =========================
  return (
    <div style={{ width: "100vw", height: "100vh", display: "flex" }}>
      <div style={{ width: 220, padding: 12, background: "#fff", borderRight: "1px solid #ddd" }}>
        <button onClick={() => setIsAnimating(v => !v)}>
          {isAnimating ? <Pause /> : <Play />}
        </button>

        <label style={{ display: "block", marginTop: 12 }}>
          <input
            type="checkbox"
            checked={audioEnabled}
            onChange={e => setAudioEnabled(e.target.checked)}
          />
          Audio Reactive
        </label>

        <label style={{ display: "block", marginTop: 12 }}>
          Audio Amount
          <input
            type="range"
            min="0"
            max="140"
            defaultValue={settings.current.audioAmount}
            onChange={e => (settings.current.audioAmount = +e.target.value)}
          />
        </label>
      </div>

      <canvas
        ref={canvasRef}
        style={{ flex: 1, display: "block", background: "#fff" }}
      />
    </div>
  );
};

export default PixelMoireGenerator;
