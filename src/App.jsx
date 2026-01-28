import React, { useState, useEffect, useRef } from "react";
import { Play, Pause } from "lucide-react";

const PixelMoireGenerator = () => {
  const canvasRef = useRef(null);
  const animationRef = useRef(null);

  // =========================
  // BASIC STATE
  // =========================
  const [isAnimating, setIsAnimating] = useState(true);

  // =========================
  // AUDIO STATE
  // =========================
  const [audioEnabled, setAudioEnabled] = useState(false);
  const audioContextRef = useRef(null);
  const analyserRef = useRef(null);
  const streamRef = useRef(null);
  const audioRAFRef = useRef(null);

  const audioFrameRef = useRef({
    bass: 0,
    mid: 0,
    high: 0,
    level: 0,
    fft: new Uint8Array(0),
    phase: 0,
  });

  // =========================
  // SETTINGS
  // =========================
  const settingsRef = useRef({
    spacing: 18,
    lineThickness: 1.6,
    audioShapeAmount: 55,
    audioReactiveShape: true,
  });

  // =========================
  // AUDIO INIT
  // =========================
  useEffect(() => {
    if (!audioEnabled) {
      if (audioRAFRef.current) cancelAnimationFrame(audioRAFRef.current);
      if (streamRef.current) streamRef.current.getTracks().forEach(t => t.stop());
      if (audioContextRef.current) audioContextRef.current.close();
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

      audioContextRef.current = ctx;
      analyserRef.current = analyser;

      const update = () => {
        const a = analyserRef.current;
        if (!a) return;

        const f = audioFrameRef.current;
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

        f.phase += 0.03 + f.high * 0.15 + f.level * 0.04;

        audioRAFRef.current = requestAnimationFrame(update);
      };

      update();
    };

    init();
  }, [audioEnabled]);

  // =========================
  // PHASE FIELD (THE IMPORTANT PART)
  // =========================
  const getAudioPhase = (x, y) => {
    if (!audioEnabled || !settingsRef.current.audioReactiveShape) return 0;

    const f = audioFrameRef.current;
    const amt = settingsRef.current.audioShapeAmount;

    const fx = 0.02;
    const fy = fx * 1.037;

    const phaseX = Math.sin(y * fy + f.phase * 0.7) * f.bass * amt * 2.2;
    const phaseY = Math.sin(x * fx - f.phase * 0.9) * f.mid * amt * 1.8;
    const micro =
      Math.sin((x + y) * 0.08 + f.phase * 3) * f.high * amt * 0.35;

    return phaseX + phaseY + micro;
  };

  // =========================
  // RENDER
  // =========================
  const render = (time = 0) => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext("2d");

    const w = canvas.width = canvas.offsetWidth;
    const h = canvas.height = canvas.offsetHeight;

    ctx.fillStyle = "#fff";
    ctx.fillRect(0, 0, w, h);
    ctx.strokeStyle = "#000";
    ctx.lineWidth = settingsRef.current.lineThickness;

    for (let x = 0; x < w; x += settingsRef.current.spacing) {
      ctx.beginPath();
      let first = true;

      for (let y = 0; y < h; y++) {
        let drawX = x;
        let drawY = y;

        const phase = getAudioPhase(drawX, drawY);
        drawX += phase;

        if (first) {
          ctx.moveTo(drawX, drawY);
          first = false;
        } else {
          ctx.lineTo(drawX, drawY);
        }
      }
      ctx.stroke();
    }
  };

  // =========================
  // RAF LOOP
  // =========================
  useEffect(() => {
    const loop = (t) => {
      if (isAnimating) render(t);
      animationRef.current = requestAnimationFrame(loop);
    };
    animationRef.current = requestAnimationFrame(loop);
    return () => cancelAnimationFrame(animationRef.current);
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
          Shape Amount
          <input
            type="range"
            min="0"
            max="120"
            defaultValue={settingsRef.current.audioShapeAmount}
            onChange={e => {
              settingsRef.current.audioShapeAmount = +e.target.value;
            }}
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
