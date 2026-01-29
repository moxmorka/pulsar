import React, { useState, useEffect, useRef } from 'react';
import { Play, Pause, Download } from 'lucide-react';

const MoireAudioReactive = () => {
  const canvasRef = useRef(null);
  const [isAnimating, setIsAnimating] = useState(false);
  const [audioEnabled, setAudioEnabled] = useState(false);
  const audioContextRef = useRef(null);
  const analyserRef = useRef(null);
  const audioDataRef = useRef(null);
  const animationRef = useRef(null);
  
  const [audioLevels, setAudioLevels] = useState({ bass: 0, mid: 0, high: 0 });
  const [preset, setPreset] = useState('flow');
  
  const presets = {
    flow: { name: 'Flow', density: 15, complexity: 1 },
    waves: { name: 'Waves', density: 20, complexity: 1 },
    chaos: { name: 'Chaos', density: 30, complexity: 1 },
    grid: { name: 'Grid', density: 12, complexity: 1 }
  };

  const [settings, setSettings] = useState({
    audioSensitivity: 3.5,
    morphSpeed: 0.4,
    lineWeight: 1.5,
    patternDensity: 15,
    shearAmount: 0.5,
    scaleVariation: 1.2,
    pixelationEnabled: false,
    pixelSize: 4,
    minLines: 1,
    maxLines: 30
  });

  useEffect(() => {
    if (!audioEnabled) {
      if (audioContextRef.current) audioContextRef.current.close();
      audioDataRef.current = null;
      return;
    }

    const initAudio = async () => {
      try {
        if (audioContextRef.current) await audioContextRef.current.close();
        
        const stream = await navigator.mediaDevices.getUserMedia({
          audio: { echoCancellation: false, noiseSuppression: false, autoGainControl: false }
        });
        
        const audioContext = new (window.AudioContext || window.webkitAudioContext)();
        audioContextRef.current = audioContext;
        
        const source = audioContext.createMediaStreamSource(stream);
        const gain = audioContext.createGain();
        gain.gain.value = 4.0;
        
        const analyser = audioContext.createAnalyser();
        analyser.fftSize = 2048;
        analyser.smoothingTimeConstant = 0.25;
        analyserRef.current = analyser;
        
        source.connect(gain);
        gain.connect(analyser);
        
        const updateAudio = () => {
          if (!audioEnabled || !analyserRef.current) return;
          
          const bufferLength = analyserRef.current.frequencyBinCount;
          const dataArray = new Uint8Array(bufferLength);
          analyserRef.current.getByteFrequencyData(dataArray);
          audioDataRef.current = dataArray;
          
          const bass = dataArray.slice(0, Math.floor(bufferLength * 0.15));
          const mid = dataArray.slice(Math.floor(bufferLength * 0.15), Math.floor(bufferLength * 0.5));
          const high = dataArray.slice(Math.floor(bufferLength * 0.5), bufferLength);
          
          const avg = (arr) => arr.reduce((a, b) => a + b, 0) / arr.length / 255;
          
          setAudioLevels({ bass: avg(bass), mid: avg(mid), high: avg(high) });
          requestAnimationFrame(updateAudio);
        };
        
        updateAudio();
      } catch (err) {
        console.error('Audio init failed:', err);
      }
    };
    
    initAudio();
    return () => { if (audioContextRef.current) audioContextRef.current.close(); };
  }, [audioEnabled]);

  const noise = (() => {
    const p = new Array(512).fill(0).map(() => Math.floor(Math.random() * 256));
    return (x, y) => {
      const X = Math.floor(x) & 255;
      const Y = Math.floor(y) & 255;
      x -= Math.floor(x);
      y -= Math.floor(y);
      const fade = t => t * t * t * (t * (t * 6 - 15) + 10);
      const lerp = (t, a, b) => a + t * (b - a);
      const u = fade(x);
      const v = fade(y);
      const A = p[X] + Y;
      const B = p[X + 1] + Y;
      return lerp(v, lerp(u, p[A] / 128 - 1, p[B] / 128 - 1), lerp(u, p[A + 1] / 128 - 1, p[B + 1] / 128 - 1));
    };
  })();

  const drawMoirePattern = (ctx, width, height, t, patternType, layerIndex, audioLevels) => {
    const bass = audioLevels.bass * settings.audioSensitivity;
    const mid = audioLevels.mid * settings.audioSensitivity;
    const high = audioLevels.high * settings.audioSensitivity;
    
    const centerX = width / 2;
    const centerY = height / 2;
    const shearX = Math.sin(t * 0.7 + layerIndex * 0.8) * settings.shearAmount + mid * 0.3;
    const shearY = Math.cos(t * 0.5 + layerIndex * 1.2) * settings.shearAmount * 0.7 + bass * 0.2;
    const scale = 1 + Math.sin(t + layerIndex) * 0.3 * settings.scaleVariation + mid * 0.5;
    const offset = Math.cos(t * 0.7 + layerIndex * 0.8) * 50 + high * 100;
    
    ctx.save();
    ctx.translate(centerX, centerY);
    ctx.transform(1, shearY, shearX, 1, 0, 0);
    ctx.scale(scale, scale);
    ctx.translate(-centerX, -centerY);
    
    const density = settings.patternDensity + Math.floor(mid * 20);
    const spacing = Math.max(5, 40 - density + bass * 30);
    
    ctx.strokeStyle = '#000000';
    ctx.lineWidth = settings.lineWeight;
    
    if (patternType === 0) {
      for (let i = -width; i < width * 2; i += spacing) {
        ctx.beginPath();
        for (let y = -height; y < height * 2; y += 2) {
          const x = i + Math.sin(y * 0.02 + t + layerIndex + bass * 3) * (30 + mid * 40);
          const xNoise = x + noise(x * 0.01, y * 0.01 + t * 0.2) * (20 + high * 30);
          ctx.lineTo(xNoise + offset, y);
        }
        ctx.stroke();
      }
    } else if (patternType === 1) {
      for (let i = -height; i < height * 2; i += spacing) {
        ctx.beginPath();
        for (let x = -width; x < width * 2; x += 2) {
          const y = i + Math.cos(x * 0.02 + t + layerIndex + mid * 3) * (30 + bass * 40);
          const yNoise = y + noise(x * 0.01 + t * 0.2, y * 0.01) * (20 + high * 30);
          ctx.lineTo(x, yNoise + offset);
        }
        ctx.stroke();
      }
    } else if (patternType === 2) {
      for (let i = -height; i < height * 2; i += spacing) {
        ctx.beginPath();
        for (let x = -width; x < width * 2; x += 2) {
          const y = i + Math.sin(x * 0.03 + t * 1.2 + layerIndex + bass * 4) * (35 + mid * 45);
          const yNoise = y + noise(x * 0.012 + t * 0.25, y * 0.012) * (25 + high * 35);
          ctx.lineTo(x, yNoise + offset * 0.8);
        }
        ctx.stroke();
      }
    } else {
      for (let i = -width; i < width * 2; i += spacing * 1.5) {
        ctx.beginPath();
        for (let y = -height; y < height * 2; y += 2) {
          const x = i + Math.sin(y * 0.03 + t * 1.5 + layerIndex + bass * 4) * (40 + mid * 50);
          const xNoise = x + noise(x * 0.015, y * 0.015 + t * 0.3) * (25 + high * 35);
          ctx.lineTo(xNoise + offset * 1.5, y);
        }
        ctx.stroke();
      }
    }
    ctx.restore();
  };

  const drawFigure = (ctx, type, size) => {
    const cx = size / 2;
    const cy = size / 2;
    
    if (type === 'face') {
      ctx.arc(cx, cy, size * 0.35, 0, Math.PI * 2);
      ctx.stroke();
      ctx.beginPath();
      ctx.arc(cx - size * 0.12, cy - size * 0.08, size * 0.06, 0, Math.PI * 2);
      ctx.fill();
      ctx.beginPath();
      ctx.arc(cx + size * 0.12, cy - size * 0.08, size * 0.06, 0, Math.PI * 2);
      ctx.fill();
      ctx.beginPath();
      ctx.arc(cx, cy + size * 0.1, size * 0.15, 0, Math.PI);
      ctx.stroke();
    } else if (type === 'tree') {
      ctx.moveTo(cx, size * 0.7);
      ctx.lineTo(cx, size * 0.3);
      ctx.stroke();
      for (let i = 0; i < 3; i++) {
        ctx.beginPath();
        ctx.arc(cx, size * 0.25 - i * size * 0.08, size * 0.15 - i * size * 0.03, 0, Math.PI * 2);
        ctx.stroke();
      }
    } else if (type === 'sun') {
      ctx.arc(cx, cy, size * 0.15, 0, Math.PI * 2);
      ctx.stroke();
      for (let i = 0; i < 12; i++) {
        const angle = (i * Math.PI * 2) / 12;
        ctx.beginPath();
        ctx.moveTo(cx + Math.cos(angle) * size * 0.2, cy + Math.sin(angle) * size * 0.2);
        ctx.lineTo(cx + Math.cos(angle) * size * 0.35, cy + Math.sin(angle) * size * 0.35);
        ctx.stroke();
      }
    } else if (type === 'cat') {
      ctx.arc(cx, cy, size * 0.25, 0, Math.PI * 2);
      ctx.stroke();
      ctx.beginPath();
      ctx.moveTo(cx - size * 0.2, cy - size * 0.25);
      ctx.lineTo(cx - size * 0.25, cy - size * 0.4);
      ctx.lineTo(cx - size * 0.15, cy - size * 0.3);
      ctx.moveTo(cx + size * 0.2, cy - size * 0.25);
      ctx.lineTo(cx + size * 0.25, cy - size * 0.4);
      ctx.lineTo(cx + size * 0.15, cy - size * 0.3);
      ctx.stroke();
    }
  };

  const render = (time = 0) => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    
    const ctx = canvas.getContext('2d');
    const width = canvas.width;
    const height = canvas.height;
    
    ctx.fillStyle = '#FAFAFA';
    ctx.fillRect(0, 0, width, height);
    
    if (!audioEnabled) {
      ctx.fillStyle = '#000000';
      ctx.beginPath();
      ctx.arc(width / 2, height / 2, 3, 0, Math.PI * 2);
      ctx.fill();
      return;
    }
    
    const audioLevelsData = audioLevels;
    
    const overallAudioLevel = (audioLevelsData.bass + audioLevelsData.mid + audioLevelsData.high) / 3;
    const lineCount = Math.floor(settings.minLines + (overallAudioLevel * settings.audioSensitivity * (settings.maxLines - settings.minLines)));
    const actualLineCount = Math.max(1, Math.min(settings.maxLines, lineCount));
    
    const patternIndex = overallAudioLevel > 0.5 ? 1 : 0;
    drawMoirePattern(ctx, width, height, 0, patternIndex, 0, audioLevelsData, actualLineCount);
    
    if (settings.pixelationEnabled && settings.pixelSize > 1) {
      const imageData = ctx.getImageData(0, 0, width, height);
      const pixelatedData = ctx.createImageData(width, height);
      for (let y = 0; y < height; y += settings.pixelSize) {
        for (let x = 0; x < width; x += settings.pixelSize) {
          const sampleX = Math.min(x + Math.floor(settings.pixelSize / 2), width - 1);
          const sampleY = Math.min(y + Math.floor(settings.pixelSize / 2), height - 1);
          const sampleIndex = (sampleY * width + sampleX) * 4;
          const r = imageData.data[sampleIndex];
          const g = imageData.data[sampleIndex + 1];
          const b = imageData.data[sampleIndex + 2];
          const a = imageData.data[sampleIndex + 3];
          for (let py = y; py < Math.min(y + settings.pixelSize, height); py++) {
            for (let px = x; px < Math.min(x + settings.pixelSize, width); px++) {
              const index = (py * width + px) * 4;
              pixelatedData.data[index] = r;
              pixelatedData.data[index + 1] = g;
              pixelatedData.data[index + 2] = b;
              pixelatedData.data[index + 3] = a;
            }
          }
        }
      }
      ctx.putImageData(pixelatedData, 0, 0);
    }
  };

  useEffect(() => {
    const animate = (time) => {
      render(time);
      animationRef.current = requestAnimationFrame(animate);
    };
    animationRef.current = requestAnimationFrame(animate);
    return () => { if (animationRef.current) cancelAnimationFrame(animationRef.current); };
  }, [settings, isAnimating, audioEnabled, preset, audioLevels]);

  useEffect(() => {
    const handleResize = () => {
      const canvas = canvasRef.current;
      if (canvas) {
        canvas.width = canvas.offsetWidth;
        canvas.height = canvas.offsetHeight;
        render();
      }
    };
    handleResize();
    window.addEventListener('resize', handleResize);
    return () => window.removeEventListener('resize', handleResize);
  }, []);

  return (
    <div className="w-full h-screen bg-white flex flex-col">
      <div className="bg-white border-b border-gray-200 px-6 py-4">
        <div className="max-w-7xl mx-auto flex items-center justify-between">
          <h1 className="text-2xl font-light tracking-tight text-gray-900">Bruno</h1>
          <div className="flex items-center gap-3">
            <button onClick={() => setIsAnimating(!isAnimating)} className="inline-flex items-center gap-2 px-4 py-2 rounded-full bg-black text-white text-sm font-medium hover:bg-gray-800">
              {isAnimating ? <><Pause size={16} /> Pause</> : <><Play size={16} /> Play</>}
            </button>
            <button onClick={() => { const canvas = canvasRef.current; const link = document.createElement('a'); link.download = 'moire.png'; link.href = canvas.toDataURL(); link.click(); }} className="inline-flex items-center gap-2 px-4 py-2 rounded-full bg-gray-100 text-gray-900 text-sm font-medium hover:bg-gray-200">
              <Download size={16} /> Export
            </button>
          </div>
        </div>
      </div>

      <div className="flex-1 flex">
        <div className="w-80 bg-gray-50 border-r border-gray-200 overflow-y-auto p-6 space-y-6">
          <div>
            <h3 className="text-sm font-semibold text-gray-900 mb-3">Presets</h3>
            <div className="space-y-2">
              {Object.entries(presets).map(([key, p]) => (
                <button key={key} onClick={() => setPreset(key)} className={`w-full text-left px-4 py-3 rounded-xl text-sm font-medium ${preset === key ? 'bg-black text-white' : 'bg-white text-gray-700 hover:bg-gray-100'}`}>
                  {p.name}
                </button>
              ))}
            </div>
          </div>

          <div>
            <div className="flex items-center justify-between mb-3">
              <h3 className="text-sm font-semibold text-gray-900">Audio</h3>
              <label className="relative inline-flex items-center cursor-pointer">
                <input type="checkbox" checked={audioEnabled} onChange={(e) => setAudioEnabled(e.target.checked)} className="sr-only peer" />
                <div className="w-11 h-6 bg-gray-300 rounded-full peer peer-checked:after:translate-x-full after:absolute after:top-[2px] after:left-[2px] after:bg-white after:rounded-full after:h-5 after:w-5 after:transition-all peer-checked:bg-black"></div>
              </label>
            </div>
            {audioEnabled && (
              <div className="space-y-3">
                <div className="bg-white rounded-xl p-3 space-y-2">
                  <div className="space-y-1"><div className="flex justify-between text-xs text-gray-600"><span>Bass</span><span>{(audioLevels.bass * 100).toFixed(0)}%</span></div><div className="w-full bg-gray-200 rounded-full h-1.5"><div className="bg-black h-1.5 rounded-full" style={{ width: (audioLevels.bass * 100) + '%' }} /></div></div>
                  <div className="space-y-1"><div className="flex justify-between text-xs text-gray-600"><span>Mid</span><span>{(audioLevels.mid * 100).toFixed(0)}%</span></div><div className="w-full bg-gray-200 rounded-full h-1.5"><div className="bg-black h-1.5 rounded-full" style={{ width: (audioLevels.mid * 100) + '%' }} /></div></div>
                  <div className="space-y-1"><div className="flex justify-between text-xs text-gray-600"><span>High</span><span>{(audioLevels.high * 100).toFixed(0)}%</span></div><div className="w-full bg-gray-200 rounded-full h-1.5"><div className="bg-black h-1.5 rounded-full" style={{ width: (audioLevels.high * 100) + '%' }} /></div></div>
                </div>
                <div className="bg-white rounded-xl p-3">
                  <div className="flex justify-between text-xs text-gray-600 mb-2"><span>Sensitivity</span><span>{settings.audioSensitivity.toFixed(1)}x</span></div>
                  <input type="range" min="0.5" max="10" step="0.1" value={settings.audioSensitivity} onChange={(e) => setSettings(prev => ({ ...prev, audioSensitivity: parseFloat(e.target.value) }))} className="w-full accent-black" />
                </div>
              </div>
            )}
          </div>

          <div className="bg-white rounded-xl p-3 space-y-3">
            <h3 className="text-sm font-semibold text-gray-900">Controls</h3>
            <div><div className="flex justify-between text-xs text-gray-600 mb-1"><span>Speed</span><span>{settings.morphSpeed.toFixed(1)}</span></div><input type="range" min="0.1" max="2" step="0.1" value={settings.morphSpeed} onChange={(e) => setSettings(prev => ({ ...prev, morphSpeed: parseFloat(e.target.value) }))} className="w-full accent-black" /></div>
            <div><div className="flex justify-between text-xs text-gray-600 mb-1"><span>Line Weight</span><span>{settings.lineWeight.toFixed(1)}</span></div><input type="range" min="0.5" max="4" step="0.1" value={settings.lineWeight} onChange={(e) => setSettings(prev => ({ ...prev, lineWeight: parseFloat(e.target.value) }))} className="w-full accent-black" /></div>
            <div><div className="flex justify-between text-xs text-gray-600 mb-1"><span>Density</span><span>{settings.patternDensity}</span></div><input type="range" min="5" max="40" value={settings.patternDensity} onChange={(e) => setSettings(prev => ({ ...prev, patternDensity: parseInt(e.target.value) }))} className="w-full accent-black" /></div>
            <div><div className="flex justify-between text-xs text-gray-600 mb-1"><span>Shear</span><span>{settings.shearAmount.toFixed(1)}</span></div><input type="range" min="0" max="2" step="0.1" value={settings.shearAmount} onChange={(e) => setSettings(prev => ({ ...prev, shearAmount: parseFloat(e.target.value) }))} className="w-full accent-black" /></div>
            <div><div className="flex justify-between text-xs text-gray-600 mb-1"><span>Min Lines</span><span>{settings.minLines}</span></div><input type="range" min="1" max="10" value={settings.minLines} onChange={(e) => setSettings(prev => ({ ...prev, minLines: parseInt(e.target.value) }))} className="w-full accent-black" /></div>
            <div><div className="flex justify-between text-xs text-gray-600 mb-1"><span>Max Lines</span><span>{settings.maxLines}</span></div><input type="range" min="10" max="100" value={settings.maxLines} onChange={(e) => setSettings(prev => ({ ...prev, maxLines: parseInt(e.target.value) }))} className="w-full accent-black" /></div>
          </div>

          <div className="bg-white rounded-xl p-3 space-y-3">
            <div className="flex items-center justify-between"><span className="text-sm font-semibold text-gray-900">Pixelation</span><label className="relative inline-flex items-center cursor-pointer"><input type="checkbox" checked={settings.pixelationEnabled} onChange={(e) => setSettings(prev => ({ ...prev, pixelationEnabled: e.target.checked }))} className="sr-only peer" /><div className="w-11 h-6 bg-gray-300 rounded-full peer peer-checked:after:translate-x-full after:absolute after:top-[2px] after:left-[2px] after:bg-white after:rounded-full after:h-5 after:w-5 after:transition-all peer-checked:bg-black"></div></label></div>
            {settings.pixelationEnabled && <div><div className="flex justify-between text-xs text-gray-600 mb-1"><span>Size</span><span>{settings.pixelSize}</span></div><input type="range" min="2" max="20" value={settings.pixelSize} onChange={(e) => setSettings(prev => ({ ...prev, pixelSize: parseInt(e.target.value) }))} className="w-full accent-black" /></div>}
          </div>


        </div>

        <div className="flex-1 flex items-center justify-center p-8">
          <canvas ref={canvasRef} className="w-full h-full rounded-2xl shadow-sm" />
        </div>
      </div>
    </div>
  );
};

export default MoireAudioReactive;
