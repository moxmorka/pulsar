import React, { useState, useEffect, useRef } from 'react';
import { RotateCcw, Download } from 'lucide-react';

export default function PixelMoireGenerator() {
  const canvasRef = useRef(null);
  const animationRef = useRef(null);
  const audioContextRef = useRef(null);
  const analyserRef = useRef(null);
  const [audioEnabled, setAudioEnabled] = useState(false);
  const [audioLevel, setAudioLevel] = useState(0);
  const [bassLevel, setBassLevel] = useState(0);
  const speedMultiplier = useRef(1);

  const [settings, setSettings] = useState({
    patternType: 'vertical-lines',
    lineThickness: 10,
    spacing: 20,
    distortionEnabled: true,
    distortionType: 'liquify',
    distortionStrength: 20,
    distortionSpeed: 1,
    pixelationEnabled: false,
    pixelSize: 4,
    audioSensitivity: 2
  });

  const distortionTypes = [
    { value: 'liquify', label: 'Liquify' },
    { value: 'ripple', label: 'Ripple' },
    { value: 'swirl', label: 'Swirl' }
  ];

  // Audio setup
  useEffect(() => {
    if (!audioEnabled) {
      if (audioContextRef.current) audioContextRef.current.close();
      speedMultiplier.current = 1;
      return;
    }

    const initAudio = async () => {
      try {
        const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
        const audioContext = new (window.AudioContext || window.webkitAudioContext)();
        audioContextRef.current = audioContext;
        const source = audioContext.createMediaStreamSource(stream);
        const analyser = audioContext.createAnalyser();
        analyser.fftSize = 2048;
        analyserRef.current = analyser;
        source.connect(analyser);

        const updateAudio = () => {
          if (!analyserRef.current) return;
          const dataArray = new Uint8Array(analyserRef.current.frequencyBinCount);
          analyserRef.current.getByteFrequencyData(dataArray);
          
          const bass = dataArray.slice(0, 50);
          const bassAvg = bass.reduce((a, b) => a + b, 0) / bass.length / 255;
          const overall = dataArray.reduce((a, b) => a + b, 0) / dataArray.length / 255;
          
          setAudioLevel(overall);
          setBassLevel(bassAvg);
          
          // DIRECT speed control - no smoothing, no refs, just set it
          speedMultiplier.current = 0.1 + (overall * settings.audioSensitivity * 10);
          
          requestAnimationFrame(updateAudio);
        };
        updateAudio();
      } catch (err) {
        alert('Audio failed: ' + err.message);
      }
    };

    initAudio();
  }, [audioEnabled]);

  // Simple noise
  const noise = (() => {
    const p = [];
    for (let i = 0; i < 256; i++) p[i] = Math.random();
    return (x, y) => {
      const X = Math.floor(x) & 255;
      const Y = Math.floor(y) & 255;
      return p[(X + Y) & 255];
    };
  })();

  const getDistortion = (x, y, time, strength) => {
    const t = time || 0;
    const dx = noise(x * 0.01 + t * 0.1, y * 0.01) * strength;
    const dy = noise(x * 0.01 + 100, y * 0.01 + 100 + t * 0.1) * strength;
    return { x: dx, y: dy };
  };

  const render = (time = 0) => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext('2d');
    const width = canvas.width;
    const height = canvas.height;
    
    ctx.fillStyle = '#ffffff';
    ctx.fillRect(0, 0, width, height);
    ctx.fillStyle = '#000000';
    
    // Use speedMultiplier.current DIRECTLY
    const animTime = time * 0.001 * settings.distortionSpeed * speedMultiplier.current;
    
    // Draw pattern
    if (settings.patternType === 'vertical-lines') {
      for (let x = 0; x < width; x += settings.spacing) {
        ctx.beginPath();
        for (let y = 0; y < height; y++) {
          let drawX = x, drawY = y;
          if (settings.distortionEnabled) {
            const d = getDistortion(x - width/2, y - height/2, animTime, settings.distortionStrength);
            drawX += d.x;
            drawY += d.y;
          }
          if (y === 0) ctx.moveTo(drawX, drawY);
          else ctx.lineTo(drawX, drawY);
        }
        ctx.lineWidth = settings.lineThickness;
        ctx.stroke();
      }
    }
    
    // Pixelation
    if (settings.pixelationEnabled && settings.pixelSize > 1) {
      const imageData = ctx.getImageData(0, 0, width, height);
      const pixelated = ctx.createImageData(width, height);
      const pixelSize = Math.round(4 + bassLevel * settings.audioSensitivity);
      for (let y = 0; y < height; y += pixelSize) {
        for (let x = 0; x < width; x += pixelSize) {
          const sampleX = Math.min(x + Math.floor(pixelSize / 2), width - 1);
          const sampleY = Math.min(y + Math.floor(pixelSize / 2), height - 1);
          const idx = (sampleY * width + sampleX) * 4;
          const r = imageData.data[idx];
          const g = imageData.data[idx + 1];
          const b = imageData.data[idx + 2];
          const a = imageData.data[idx + 3];
          for (let py = y; py < Math.min(y + pixelSize, height); py++) {
            for (let px = x; px < Math.min(x + pixelSize, width); px++) {
              const i = (py * width + px) * 4;
              pixelated.data[i] = r;
              pixelated.data[i + 1] = g;
              pixelated.data[i + 2] = b;
              pixelated.data[i + 3] = a;
            }
          }
        }
      }
      ctx.putImageData(pixelated, 0, 0);
    }
  };

  useEffect(() => {
    const loop = (time) => {
      render(time);
      animationRef.current = requestAnimationFrame(loop);
    };
    animationRef.current = requestAnimationFrame(loop);
    return () => cancelAnimationFrame(animationRef.current);
  }, [settings]);

  useEffect(() => {
    const handleResize = () => {
      const canvas = canvasRef.current;
      if (canvas) {
        canvas.width = canvas.offsetWidth;
        canvas.height = canvas.offsetHeight;
      }
    };
    handleResize();
    window.addEventListener('resize', handleResize);
    return () => window.removeEventListener('resize', handleResize);
  }, []);

  return (
    <div className="w-full h-screen bg-gray-100 flex">
      <div className="w-80 bg-white shadow-lg p-4 overflow-y-auto space-y-4">
        <div className="flex gap-2">
          <button onClick={() => setSettings(s => ({ ...s, lineThickness: Math.random() * 15 + 5, spacing: Math.random() * 30 + 15 }))} 
                  className="flex items-center gap-1 px-3 py-2 bg-green-500 text-white rounded text-sm">
            <RotateCcw size={14} /> Random
          </button>
          <button onClick={() => { const link = document.createElement('a'); link.download = 'pattern.png'; link.href = canvasRef.current.toDataURL(); link.click(); }} 
                  className="flex items-center gap-1 px-3 py-2 bg-purple-500 text-white rounded text-sm">
            <Download size={14} /> Save
          </button>
        </div>

        <div className="bg-yellow-200 border-2 border-red-500 p-3 rounded text-xs font-mono">
          <div className="font-bold mb-2">DEBUG:</div>
          <div>Audio: {audioLevel.toFixed(3)}</div>
          <div>Bass: {bassLevel.toFixed(3)}</div>
          <div>Speed: {speedMultiplier.current.toFixed(2)}x</div>
        </div>

        <div>
          <h3 className="font-semibold mb-2">Audio</h3>
          <label className="flex items-center mb-2">
            <input type="checkbox" checked={audioEnabled} onChange={(e) => setAudioEnabled(e.target.checked)} className="mr-2" />
            Enable Audio Input
          </label>
          
          {audioEnabled && (
            <div className="space-y-2">
              <div>
                <label className="block text-xs mb-1">Sensitivity: {settings.audioSensitivity.toFixed(1)}x</label>
                <input type="range" min="0.1" max="5" step="0.1" value={settings.audioSensitivity} 
                       onChange={(e) => setSettings(s => ({ ...s, audioSensitivity: parseFloat(e.target.value) }))} className="w-full" />
              </div>
              <div className="text-xs">Level: {(audioLevel * 100).toFixed(0)}%</div>
              <div className="w-full bg-gray-200 rounded h-2">
                <div className="bg-blue-500 h-2 rounded" style={{ width: `${audioLevel * 100}%` }} />
              </div>
            </div>
          )}
        </div>

        <div>
          <h3 className="font-semibold mb-2">Pattern</h3>
          <label className="block text-sm mb-1">Thickness: {settings.lineThickness.toFixed(1)}</label>
          <input type="range" min="2" max="30" value={settings.lineThickness} onChange={(e) => setSettings(s => ({ ...s, lineThickness: parseFloat(e.target.value) }))} className="w-full mb-2" />
          <label className="block text-sm mb-1">Spacing: {settings.spacing.toFixed(1)}</label>
          <input type="range" min="10" max="60" value={settings.spacing} onChange={(e) => setSettings(s => ({ ...s, spacing: parseFloat(e.target.value) }))} className="w-full" />
        </div>

        <div>
          <h3 className="font-semibold mb-2">Distortion</h3>
          <label className="flex items-center mb-2">
            <input type="checkbox" checked={settings.distortionEnabled} onChange={(e) => setSettings(s => ({ ...s, distortionEnabled: e.target.checked }))} className="mr-2" />
            Enable
          </label>
          {settings.distortionEnabled && (
            <div className="space-y-2">
              <label className="block text-sm mb-1">Strength: {settings.distortionStrength}</label>
              <input type="range" min="5" max="80" value={settings.distortionStrength} onChange={(e) => setSettings(s => ({ ...s, distortionStrength: parseInt(e.target.value) }))} className="w-full" />
              <label className="block text-sm mb-1">Base Speed: {settings.distortionSpeed}</label>
              <input type="range" min="0.1" max="3" step="0.1" value={settings.distortionSpeed} onChange={(e) => setSettings(s => ({ ...s, distortionSpeed: parseFloat(e.target.value) }))} className="w-full" />
            </div>
          )}
        </div>

        <div>
          <h3 className="font-semibold mb-2">Pixelation</h3>
          <label className="flex items-center mb-2">
            <input type="checkbox" checked={settings.pixelationEnabled} onChange={(e) => setSettings(s => ({ ...s, pixelationEnabled: e.target.checked }))} className="mr-2" />
            Enable (Bass Reactive)
          </label>
        </div>
      </div>

      <div className="flex-1 p-4">
        <canvas ref={canvasRef} className="w-full h-full border border-gray-300 bg-white rounded-lg shadow-lg" />
      </div>
    </div>
  );
}
