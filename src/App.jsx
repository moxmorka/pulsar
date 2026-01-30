import React, { useState, useEffect, useRef } from 'react';
import { Play, Pause, RotateCcw, Download, Type, Grid } from 'lucide-react';

export default function PixelMoireGenerator() {
  const canvasRef = useRef(null);
  const animationRef = useRef(null);
  const [isAnimating, setIsAnimating] = useState(false);
  const [customFonts, setCustomFonts] = useState([]);
  const [audioEnabled, setAudioEnabled] = useState(false);
  const [audioDevices, setAudioDevices] = useState([]);
  const [selectedAudioDevice, setSelectedAudioDevice] = useState(null);
  const audioContextRef = useRef(null);
  const analyserRef = useRef(null);
  const [audioLevel, setAudioLevel] = useState(0);
  const [bassLevel, setBassLevel] = useState(0);
  const [midLevel, setMidLevel] = useState(0);
  const [highLevel, setHighLevel] = useState(0);
  const [audioTimeMultiplier, setAudioTimeMultiplier] = useState(1);
  const targetSpeedMultiplier = useRef(1);
  const targetPixelSize = useRef(4);
  const audioFrameRef = useRef(null);
  const sensitivityRef = useRef(1.5);
  const audioReactiveSpeedRef = useRef(false);
  const audioReactivePixelsRef = useRef(false);
  const pixelationEnabledRef = useRef(false);

  const [settings, setSettings] = useState({
    patternType: 'vertical-lines',
    lineThickness: 10,
    spacing: 20,
    textEnabled: false,
    text: '',
    fontSize: 120,
    font: 'Impact',
    shapeEnabled: false,
    shapeIndex: 0,
    shapeSize: 100,
    distortionEnabled: true,
    distortionType: 'liquify',
    distortionStrength: 20,
    distortionSpeed: 1,
    pixelationEnabled: false,
    pixelSize: 4,
    audioReactiveSpeed: false,
    audioReactivePixels: false,
    audioSensitivity: 1.5
  });

  const systemFonts = ['Impact', 'Arial Black', 'Helvetica', 'Times New Roman'];
  const webFonts = ['Roboto', 'Montserrat', 'Bebas Neue', 'Anton'];
  
  // Keep refs in sync with settings
  useEffect(() => {
    sensitivityRef.current = settings.audioSensitivity;
    audioReactiveSpeedRef.current = settings.audioReactiveSpeed;
    audioReactivePixelsRef.current = settings.audioReactivePixels;
    pixelationEnabledRef.current = settings.pixelationEnabled;
  }, [settings.audioSensitivity, settings.audioReactiveSpeed, settings.audioReactivePixels, settings.pixelationEnabled]);
  
  const distortionTypes = [
    { value: 'liquify', label: 'Liquify Flow' },
    { value: 'ripple', label: 'Ripple Waves' },
    { value: 'swirl', label: 'Swirl Vortex' },
    { value: 'turbulence', label: 'Turbulence' },
    { value: 'marble', label: 'Marble Veins' },
    { value: 'wave', label: 'Wave Field' }
  ];

  const shapes = [
    { name: 'Circle', draw: (ctx, size) => { ctx.beginPath(); ctx.arc(size/2, size/2, size * 0.4, 0, Math.PI * 2); ctx.stroke(); }},
    { name: 'Square', draw: (ctx, size) => { const s = size * 0.7; const offset = (size - s) / 2; ctx.strokeRect(offset, offset, s, s); }},
    { name: 'Triangle', draw: (ctx, size) => { ctx.beginPath(); ctx.moveTo(size/2, size * 0.1); ctx.lineTo(size * 0.9, size * 0.9); ctx.lineTo(size * 0.1, size * 0.9); ctx.closePath(); ctx.stroke(); }}
  ];

  useEffect(() => {
    const link = document.createElement('link');
    link.href = 'https://fonts.googleapis.com/css2?family=Roboto:wght@900&family=Montserrat:wght@900&family=Bebas+Neue&family=Anton&display=swap';
    link.rel = 'stylesheet';
    document.head.appendChild(link);
  }, []);

  useEffect(() => {
    const getDevices = async () => {
      try {
        const devices = await navigator.mediaDevices.enumerateDevices();
        const audioInputs = devices.filter(d => d.kind === 'audioinput');
        setAudioDevices(audioInputs);
        if (audioInputs.length > 0 && !selectedAudioDevice) {
          setSelectedAudioDevice(audioInputs[0].deviceId);
        }
      } catch (err) {
        console.error('Device enumeration failed:', err);
      }
    };
    getDevices();
  }, [selectedAudioDevice]);

  useEffect(() => {
    if (!audioEnabled) {
      if (audioFrameRef.current) cancelAnimationFrame(audioFrameRef.current);
      if (audioContextRef.current && audioContextRef.current.state !== 'closed') {
        audioContextRef.current.close();
      }
      setAudioTimeMultiplier(1);
      return;
    }

    const initAudio = async () => {
      try {
        if (audioContextRef.current && audioContextRef.current.state !== 'closed') {
          await audioContextRef.current.close();
        }
        
        const stream = await navigator.mediaDevices.getUserMedia({
          audio: {
            deviceId: selectedAudioDevice ? { exact: selectedAudioDevice } : undefined,
            echoCancellation: false,
            noiseSuppression: false,
            autoGainControl: false
          }
        });

        const audioContext = new (window.AudioContext || window.webkitAudioContext)();
        audioContextRef.current = audioContext;
        const source = audioContext.createMediaStreamSource(stream);
        const gainNode = audioContext.createGain();
        gainNode.gain.value = 3.0;
        const analyser = audioContext.createAnalyser();
        analyser.fftSize = 8192;
        analyser.smoothingTimeConstant = 0.1;
        analyserRef.current = analyser;
        source.connect(gainNode);
        gainNode.connect(analyser);

        const updateAudio = () => {
          if (!analyserRef.current) return;
          
          const bufferLength = analyserRef.current.frequencyBinCount;
          const dataArray = new Uint8Array(bufferLength);
          analyserRef.current.getByteFrequencyData(dataArray);
          
          const bass = dataArray.slice(0, Math.floor(bufferLength * 0.1));
          const mid = dataArray.slice(Math.floor(bufferLength * 0.1), Math.floor(bufferLength * 0.4));
          const high = dataArray.slice(Math.floor(bufferLength * 0.4), Math.floor(bufferLength * 0.8));
          
          const bassAvg = bass.reduce((a, b) => a + b, 0) / bass.length / 255;
          const midAvg = mid.reduce((a, b) => a + b, 0) / mid.length / 255;
          const highAvg = high.reduce((a, b) => a + b, 0) / high.length / 255;
          const sum = dataArray.reduce((a, b) => a + b, 0);
          const normalizedLevel = sum / bufferLength / 255;
          
          setAudioLevel(normalizedLevel);
          setBassLevel(bassAvg);
          setMidLevel(midAvg);
          setHighLevel(highAvg);
          
          const sensitivity = sensitivityRef.current;
          const amplifiedLevel = Math.min(normalizedLevel * sensitivity, 1);
          const amplifiedBass = Math.min(bassAvg * sensitivity, 1);
          
          // Set target values - will be smoothly interpolated in render
          if (audioReactiveSpeedRef.current) {
            targetSpeedMultiplier.current = 0.2 + amplifiedLevel * 2.8;
          } else {
            targetSpeedMultiplier.current = 1;
          }
          
          if (audioReactivePixelsRef.current && pixelationEnabledRef.current) {
            targetPixelSize.current = 4 + amplifiedBass * 2;
          } else {
            targetPixelSize.current = 4;
          }
          
          audioFrameRef.current = requestAnimationFrame(updateAudio);
        };
        
        updateAudio();
      } catch (err) {
        alert('Audio Error: ' + err.message);
      }
    };

    initAudio();
    
    return () => {
      if (audioFrameRef.current) cancelAnimationFrame(audioFrameRef.current);
    };
  }, [audioEnabled, selectedAudioDevice]);

  const noise = (() => {
    const p = [];
    for (let i = 0; i < 512; i++) p[i] = Math.floor(Math.random() * 256);
    return (x, y) => {
      const X = Math.floor(x) & 255;
      const Y = Math.floor(y) & 255;
      x -= Math.floor(x);
      y -= Math.floor(y);
      const fade = t => t * t * t * (t * (t * 6 - 15) + 10);
      const lerp = (t, a, b) => a + t * (b - a);
      return lerp(fade(y), lerp(fade(x), p[p[X] + Y] / 128 - 1, p[p[X + 1] + Y] / 128 - 1), 
                            lerp(fade(x), p[p[X] + Y + 1] / 128 - 1, p[p[X + 1] + Y + 1] / 128 - 1));
    };
  })();

  const getDistortion = (x, y, time, strength, type) => {
    const freq = 0.01;
    const t = time || 0;
    let dx = 0, dy = 0;
    
    switch (type) {
      case 'liquify':
        dx = noise(x * freq + t * 0.1, y * freq) * strength;
        dy = noise(x * freq + 100, y * freq + 100 + t * 0.1) * strength;
        break;
      case 'ripple':
        const dist = Math.sqrt(x * x + y * y);
        const ripple = Math.sin(dist * 0.02 + t * 2) * strength;
        dx = (x / (dist || 1)) * ripple;
        dy = (y / (dist || 1)) * ripple;
        break;
      case 'swirl':
        const angle = Math.atan2(y, x);
        const radius = Math.sqrt(x * x + y * y);
        const newAngle = angle + (strength * 0.001 + t * 0.5) * (1 / (1 + radius * 0.01));
        dx = Math.cos(newAngle) * radius - x;
        dy = Math.sin(newAngle) * radius - y;
        break;
      case 'turbulence':
        dx = Math.abs(noise(x * freq + t * 0.2, y * freq)) * strength;
        dy = Math.abs(noise(x * freq + 200, y * freq + 200 + t * 0.2)) * strength;
        break;
      case 'marble':
        const m1 = x * freq + strength * 0.1 * noise(x * freq * 2 + t * 0.1, y * freq * 2);
        const m2 = y * freq + strength * 0.1 * noise(x * freq * 2 + 100, y * freq * 2 + 100 + t * 0.1);
        dx = Math.sin(m1 + t * 0.5) * strength;
        dy = Math.sin(m2 + t * 0.5) * strength;
        break;
      case 'wave':
        dx = Math.sin(y * freq * 5 + t * 2) * strength;
        dy = Math.cos(x * freq * 3 + t * 1.5) * strength;
        break;
    }
    return { x: dx, y: dy };
  };

  const render = (time = 0) => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext('2d');
    const width = canvas.width;
    const height = canvas.height;
    
    // Smooth interpolation for audio reactivity
    const speedDiff = targetSpeedMultiplier.current - audioTimeMultiplier;
    if (Math.abs(speedDiff) > 0.01) {
      setAudioTimeMultiplier(audioTimeMultiplier + speedDiff * 0.1);
    }
    
    let currentPixelSize = settings.pixelSize;
    if (settings.audioReactivePixels && settings.pixelationEnabled) {
      currentPixelSize = settings.pixelSize + (targetPixelSize.current - settings.pixelSize) * 0.1;
    }
    
    ctx.fillStyle = '#ffffff';
    ctx.fillRect(0, 0, width, height);
    ctx.fillStyle = '#000000';
    
    const animTime = isAnimating ? time * 0.001 * settings.distortionSpeed * audioTimeMultiplier : 0;
    
    if (settings.patternType === 'vertical-lines') {
      for (let x = 0; x < width; x += settings.spacing) {
        ctx.beginPath();
        for (let y = 0; y < height; y++) {
          let drawX = x, drawY = y;
          if (settings.distortionEnabled) {
            const d = getDistortion(x - width/2, y - height/2, animTime, settings.distortionStrength, settings.distortionType);
            drawX += d.x;
            drawY += d.y;
          }
          if (y === 0) ctx.moveTo(drawX, drawY);
          else ctx.lineTo(drawX, drawY);
        }
        ctx.lineWidth = settings.lineThickness;
        ctx.stroke();
      }
    } else if (settings.patternType === 'horizontal-lines') {
      for (let y = 0; y < height; y += settings.spacing) {
        ctx.beginPath();
        for (let x = 0; x < width; x++) {
          let drawX = x, drawY = y;
          if (settings.distortionEnabled) {
            const d = getDistortion(x - width/2, y - height/2, animTime, settings.distortionStrength, settings.distortionType);
            drawX += d.x;
            drawY += d.y;
          }
          if (x === 0) ctx.moveTo(drawX, drawY);
          else ctx.lineTo(drawX, drawY);
        }
        ctx.lineWidth = settings.lineThickness;
        ctx.stroke();
      }
    } else if (settings.patternType === 'checkerboard') {
      const cellSize = settings.spacing;
      for (let y = 0; y < height; y += cellSize) {
        for (let x = 0; x < width; x += cellSize) {
          if ((Math.floor(x / cellSize) + Math.floor(y / cellSize)) % 2 === 0) {
            ctx.fillRect(x, y, cellSize, cellSize);
          }
        }
      }
    }
    
    if (settings.pixelationEnabled && currentPixelSize > 1) {
      const pixelSize = Math.round(currentPixelSize);
      const imageData = ctx.getImageData(0, 0, width, height);
      const pixelated = ctx.createImageData(width, height);
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
  }, [isAnimating, settings]);

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
          <button onClick={() => setIsAnimating(!isAnimating)} className="flex items-center gap-1 px-3 py-2 bg-blue-500 text-white rounded text-sm">
            {isAnimating ? <Pause size={14} /> : <Play size={14} />}
          </button>
          <button onClick={() => setSettings(s => ({ ...s, lineThickness: Math.random() * 15 + 5, spacing: Math.random() * 30 + 15 }))} 
                  className="flex items-center gap-1 px-3 py-2 bg-green-500 text-white rounded text-sm">
            <RotateCcw size={14} />
          </button>
          <button onClick={() => { const canvas = canvasRef.current; const link = document.createElement('a'); link.download = 'pattern.png'; link.href = canvas.toDataURL(); link.click(); }} 
                  className="flex items-center gap-1 px-3 py-2 bg-purple-500 text-white rounded text-sm">
            <Download size={14} />
          </button>
        </div>

        <div>
          <h3 className="font-semibold mb-2">Audio</h3>
          <label className="flex items-center mb-2">
            <input type="checkbox" checked={audioEnabled} onChange={(e) => setAudioEnabled(e.target.checked)} className="mr-2" />
            Enable Audio
          </label>
          
          {audioEnabled && (
            <div className="space-y-2">
              <select value={selectedAudioDevice || ''} onChange={(e) => setSelectedAudioDevice(e.target.value)} className="w-full p-2 border rounded text-xs">
                {audioDevices.map(d => <option key={d.deviceId} value={d.deviceId}>{d.label || d.deviceId.substring(0, 8)}</option>)}
              </select>

              <div>
                <label className="block text-xs mb-1">Sensitivity: {settings.audioSensitivity.toFixed(1)}x</label>
                <input type="range" min="0.1" max="10" step="0.1" value={settings.audioSensitivity} 
                       onChange={(e) => setSettings(s => ({ ...s, audioSensitivity: parseFloat(e.target.value) }))} className="w-full" />
              </div>

              <div className="text-xs">Bass: {(bassLevel * 100).toFixed(0)}%</div>
              <div className="w-full bg-gray-200 rounded h-2">
                <div className="bg-red-500 h-2 rounded" style={{ width: `${bassLevel * 100}%` }} />
              </div>

              <label className="flex items-center">
                <input type="checkbox" checked={settings.audioReactiveSpeed} 
                       onChange={(e) => setSettings(s => ({ ...s, audioReactiveSpeed: e.target.checked }))} className="mr-2" />
                <span className="text-sm">Speed (Overall)</span>
              </label>

              <label className="flex items-center">
                <input type="checkbox" checked={settings.audioReactivePixels} 
                       onChange={(e) => setSettings(s => ({ ...s, audioReactivePixels: e.target.checked }))} className="mr-2" />
                <span className="text-sm">Pixels (Bass)</span>
              </label>
            </div>
          )}
        </div>

        <div>
          <h3 className="font-semibold mb-2">Pattern</h3>
          <select value={settings.patternType} onChange={(e) => setSettings(s => ({ ...s, patternType: e.target.value }))} className="w-full p-2 border rounded mb-2 text-sm">
            <option value="vertical-lines">Vertical</option>
            <option value="horizontal-lines">Horizontal</option>
            <option value="checkerboard">Checkerboard</option>
          </select>
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
              <select value={settings.distortionType} onChange={(e) => setSettings(s => ({ ...s, distortionType: e.target.value }))} className="w-full p-2 border rounded text-sm">
                {distortionTypes.map(t => <option key={t.value} value={t.value}>{t.label}</option>)}
              </select>
              <label className="block text-sm mb-1">Strength: {settings.distortionStrength}</label>
              <input type="range" min="5" max="80" value={settings.distortionStrength} onChange={(e) => setSettings(s => ({ ...s, distortionStrength: parseInt(e.target.value) }))} className="w-full" />
              <label className="block text-sm mb-1">Speed: {settings.distortionSpeed}</label>
              <input type="range" min="0.1" max="3" step="0.1" value={settings.distortionSpeed} onChange={(e) => setSettings(s => ({ ...s, distortionSpeed: parseFloat(e.target.value) }))} className="w-full" />
            </div>
          )}
        </div>

        <div>
          <h3 className="font-semibold mb-2">Pixelation</h3>
          <label className="flex items-center mb-2">
            <input type="checkbox" checked={settings.pixelationEnabled} onChange={(e) => setSettings(s => ({ ...s, pixelationEnabled: e.target.checked }))} className="mr-2" />
            Enable
          </label>
          {settings.pixelationEnabled && (
            <div>
              <label className="block text-sm mb-1">Size: {settings.pixelSize}</label>
              <input type="range" min="2" max="20" value={settings.pixelSize} onChange={(e) => setSettings(s => ({ ...s, pixelSize: parseInt(e.target.value) }))} className="w-full" />
            </div>
          )}
        </div>
      </div>

      <div className="flex-1 p-4">
        <canvas ref={canvasRef} className="w-full h-full border border-gray-300 bg-white rounded-lg shadow-lg" />
      </div>
    </div>
  );
}
