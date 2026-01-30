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
  const [audioTimeMultiplier, setAudioTimeMultiplier] = useState(1);
  const lastPixelUpdate = useRef(0);

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
    gridSize: 20,
    showGrid: false,
    audioReactiveSpeed: false,
    audioReactivePixels: false,
    audioSensitivity: 1.5
  });

  const systemFonts = ['Impact', 'Arial Black', 'Helvetica', 'Times New Roman', 'Courier New', 'Georgia', 'Verdana', 'Comic Sans MS'];
  const webFonts = ['Roboto', 'Open Sans', 'Lato', 'Montserrat', 'Poppins', 'Oswald', 'Inter', 'Bebas Neue', 'Anton', 'Pacifico', 'Lobster', 'Orbitron'];

  useEffect(() => {
    const link = document.createElement('link');
    link.href = 'https://fonts.googleapis.com/css2?family=Roboto:wght@900&family=Open+Sans:wght@800&family=Lato:wght@900&family=Montserrat:wght@900&family=Poppins:wght@900&family=Oswald:wght@700&family=Inter:wght@900&family=Bebas+Neue&family=Anton&family=Pacifico&family=Lobster&family=Orbitron:wght@900&display=swap';
    link.rel = 'stylesheet';
    document.head.appendChild(link);
    return () => {
      if (document.head.contains(link)) {
        document.head.removeChild(link);
      }
    };
  }, []);

  const handleFontUpload = (event) => {
    const file = event.target.files[0];
    if (file && (file.name.endsWith('.ttf') || file.name.endsWith('.otf') || file.name.endsWith('.woff') || file.name.endsWith('.woff2'))) {
      const fontName = 'CustomFont' + Date.now();
      const url = URL.createObjectURL(file);
      const fontFaceCSS = '@font-face { font-family: "' + fontName + '"; src: url("' + url + '"); font-display: swap; }';
      const styleElement = document.createElement('style');
      styleElement.textContent = fontFaceCSS;
      document.head.appendChild(styleElement);
      setTimeout(() => {
        setCustomFonts(prev => [...prev, fontName]);
        setSettings(prev => ({ ...prev, font: fontName }));
        alert('Font uploaded as "' + fontName + '"!');
      }, 500);
    } else {
      alert('Please upload a valid font file (.ttf, .otf, .woff, .woff2)');
    }
  };

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
    { name: 'Triangle', draw: (ctx, size) => { ctx.beginPath(); ctx.moveTo(size/2, size * 0.1); ctx.lineTo(size * 0.9, size * 0.9); ctx.lineTo(size * 0.1, size * 0.9); ctx.closePath(); ctx.stroke(); }},
    { name: 'Star', draw: (ctx, size) => { ctx.beginPath(); const cx = size/2; const cy = size/2; const r = size * 0.4; for (let i = 0; i < 5; i++) { const angle = (i * 4 * Math.PI / 5) - Math.PI/2; const x = cx + r * Math.cos(angle); const y = cy + r * Math.sin(angle); if (i === 0) ctx.moveTo(x, y); else ctx.lineTo(x, y); } ctx.closePath(); ctx.stroke(); }},
    { name: 'Heart', draw: (ctx, size) => { ctx.beginPath(); const x = size/2; const y = size * 0.3; const w = size * 0.5; ctx.moveTo(x, y + w/4); ctx.bezierCurveTo(x, y, x - w/2, y - w/2, x - w/2, y + w/4); ctx.bezierCurveTo(x - w/2, y + w, x, y + w * 1.2, x, y + w * 1.5); ctx.bezierCurveTo(x, y + w * 1.2, x + w/2, y + w, x + w/2, y + w/4); ctx.bezierCurveTo(x + w/2, y - w/2, x, y, x, y + w/4); ctx.stroke(); }},
    { name: 'Person', draw: (ctx, size) => { ctx.beginPath(); ctx.arc(size/2, size * 0.25, size * 0.1, 0, Math.PI * 2); ctx.stroke(); ctx.beginPath(); ctx.moveTo(size/2, size * 0.35); ctx.lineTo(size/2, size * 0.6); ctx.moveTo(size/2, size * 0.4); ctx.lineTo(size * 0.3, size * 0.5); ctx.moveTo(size/2, size * 0.4); ctx.lineTo(size * 0.7, size * 0.5); ctx.moveTo(size/2, size * 0.6); ctx.lineTo(size * 0.4, size * 0.9); ctx.moveTo(size/2, size * 0.6); ctx.lineTo(size * 0.6, size * 0.9); ctx.stroke(); }}
  ];

  useEffect(() => {
    const getAudioDevices = async () => {
      try {
        const devices = await navigator.mediaDevices.enumerateDevices();
        const audioInputs = devices.filter(device => device.kind === 'audioinput');
        setAudioDevices(audioInputs);
        if (audioInputs.length > 0 && !selectedAudioDevice) {
          setSelectedAudioDevice(audioInputs[0].deviceId);
        }
      } catch (err) {
        console.error('Failed to enumerate devices:', err);
      }
    };
    getAudioDevices();
  }, []);

  useEffect(() => {
    const initAudio = async () => {
      try {
        if (audioContextRef.current) {
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
          if (!audioEnabled || !analyserRef.current) return;
          const bufferLength = analyserRef.current.frequencyBinCount;
          const dataArray = new Uint8Array(bufferLength);
          analyserRef.current.getByteFrequencyData(dataArray);
          
          const bass = dataArray.slice(0, Math.floor(bufferLength * 0.1));
          const bassAvg = bass.reduce((a, b) => a + b, 0) / bass.length / 255;
          const sum = dataArray.reduce((a, b) => a + b, 0);
          const normalizedLevel = sum / bufferLength / 255;
          
          setAudioLevel(normalizedLevel);
          setBassLevel(bassAvg);
          
          const sensitivity = settings.audioSensitivity;
          const amplifiedLevel = Math.min(normalizedLevel * sensitivity, 1);
          const amplifiedBass = Math.min(bassAvg * sensitivity, 1);
          
          if (settings.audioReactiveSpeed) {
            setAudioTimeMultiplier(0.2 + amplifiedLevel * 2.8);
          }
          
          if (settings.audioReactivePixels && settings.pixelationEnabled) {
            const now = Date.now();
            if (now - lastPixelUpdate.current > 100) {
              setSettings(prev => ({ ...prev, pixelSize: Math.round(4 + amplifiedBass * 2) }));
              lastPixelUpdate.current = now;
            }
          }
          requestAnimationFrame(updateAudio);
        };
        updateAudio();
      } catch (err) {
        alert('Audio Error: ' + err.message);
      }
    };

    if (audioEnabled) {
      initAudio();
    } else {
      if (audioContextRef.current) {
        audioContextRef.current.close();
      }
    }
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
      const u = fade(x);
      const v = fade(y);
      const lerp = (t, a, b) => a + t * (b - a);
      return lerp(v, lerp(u, p[p[X] + Y] / 128 - 1, p[p[X + 1] + Y] / 128 - 1), 
                     lerp(u, p[p[X] + Y + 1] / 128 - 1, p[p[X + 1] + Y + 1] / 128 - 1));
    };
  })();

  const getDistortion = (x, y, time, strength, type) => {
    const freq = 0.01;
    const t = time || 0;
    let dx = 0, dy = 0;
    
    if (type === 'liquify') {
      dx = noise(x * freq + t * 0.1, y * freq) * strength;
      dy = noise(x * freq + 100, y * freq + 100 + t * 0.1) * strength;
    } else if (type === 'ripple') {
      const dist = Math.sqrt(x * x + y * y);
      const ripple = Math.sin(dist * 0.02 + t * 2) * strength;
      dx = (x / (dist || 1)) * ripple;
      dy = (y / (dist || 1)) * ripple;
    } else if (type === 'swirl') {
      const angle = Math.atan2(y, x);
      const radius = Math.sqrt(x * x + y * y);
      const newAngle = angle + (strength * 0.001 + t * 0.5) * (1 / (1 + radius * 0.01));
      dx = Math.cos(newAngle) * radius - x;
      dy = Math.sin(newAngle) * radius - y;
    } else if (type === 'turbulence') {
      dx = Math.abs(noise(x * freq + t * 0.2, y * freq)) * strength;
      dy = Math.abs(noise(x * freq + 200, y * freq + 200 + t * 0.2)) * strength;
    } else if (type === 'marble') {
      const marble1 = x * freq + strength * 0.1 * noise(x * freq * 2 + t * 0.1, y * freq * 2);
      const marble2 = y * freq + strength * 0.1 * noise(x * freq * 2 + 100, y * freq * 2 + 100 + t * 0.1);
      dx = Math.sin(marble1 + t * 0.5) * strength;
      dy = Math.sin(marble2 + t * 0.5) * strength;
    } else if (type === 'wave') {
      dx = Math.sin(y * freq * 5 + t * 2) * strength;
      dy = Math.cos(x * freq * 3 + t * 1.5) * strength;
    }
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
    
    const animTime = isAnimating ? time * 0.001 * settings.distortionSpeed * audioTimeMultiplier : 0;
    
    if (settings.patternType === 'vertical-lines') {
      for (let x = 0; x < width; x += settings.spacing) {
        ctx.beginPath();
        for (let y = 0; y < height; y += 1) {
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
        for (let x = 0; x < width; x += 1) {
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
          let drawX = x, drawY = y;
          if (settings.distortionEnabled) {
            const d = getDistortion(x - width/2, y - height/2, animTime, settings.distortionStrength, settings.distortionType);
            drawX += d.x;
            drawY += d.y;
          }
          if ((Math.floor(x / cellSize) + Math.floor(y / cellSize)) % 2 === 0) {
            ctx.fillRect(drawX, drawY, cellSize, cellSize);
          }
        }
      }
    }
    
    // Draw shapes
    if (settings.shapeEnabled) {
      ctx.save();
      const centerX = width / 2;
      const centerY = height / 2;
      const shapeSize = Math.min(width, height) * (settings.shapeSize / 100);
      if (settings.distortionEnabled) {
        const resolution = 200;
        const tempCanvas = document.createElement('canvas');
        const tempCtx = tempCanvas.getContext('2d');
        tempCanvas.width = resolution;
        tempCanvas.height = resolution;
        tempCtx.strokeStyle = '#000000';
        tempCtx.lineWidth = 3;
        shapes[settings.shapeIndex].draw(tempCtx, resolution);
        const imageData = tempCtx.getImageData(0, 0, resolution, resolution);
        const sampleSize = 2;
        for (let y = 0; y < resolution; y += sampleSize) {
          for (let x = 0; x < resolution; x += sampleSize) {
            const index = (y * resolution + x) * 4;
            const alpha = imageData.data[index + 3];
            if (alpha > 50) {
              const relativeX = (x - resolution/2) / resolution * shapeSize;
              const relativeY = (y - resolution/2) / resolution * shapeSize;
              const worldX = centerX + relativeX;
              const worldY = centerY + relativeY;
              const distortion = getDistortion(worldX - width/2, worldY - height/2, animTime + (x + y) * 0.01, settings.distortionStrength, settings.distortionType);
              const finalX = worldX + distortion.x * 1.2;
              const finalY = worldY + distortion.y * 1.2;
              const pixelSize = Math.max(2, shapeSize / 100);
              ctx.fillRect(finalX - pixelSize/2, finalY - pixelSize/2, pixelSize, pixelSize);
            }
          }
        }
      } else {
        ctx.save();
        ctx.translate(centerX, centerY);
        ctx.strokeStyle = '#000000';
        ctx.lineWidth = 5;
        ctx.translate(-shapeSize/2, -shapeSize/2);
        shapes[settings.shapeIndex].draw(ctx, shapeSize);
        ctx.restore();
      }
      ctx.restore();
    }
    
    // Draw text
    if (settings.textEnabled && settings.text) {
      ctx.save();
      const canvasSize = Math.max(width, height);
      let fontSize = canvasSize * 0.6;
      const textLength = settings.text.length;
      if (textLength > 1) {
        fontSize = fontSize / Math.sqrt(textLength * 0.5);
      }
      fontSize = fontSize * (settings.fontSize / 100);
      const centerX = width / 2;
      const centerY = height / 2;
      if (settings.distortionEnabled) {
        const chars = settings.text.split('');
        ctx.font = '900 ' + fontSize + 'px "' + settings.font + '", Impact, Arial Black, sans-serif';
        const totalWidth = ctx.measureText(settings.text).width;
        const charWidth = totalWidth / chars.length;
        chars.forEach((char, charIndex) => {
          const charBaseX = centerX - totalWidth/2 + charIndex * charWidth + charWidth/2;
          const charBaseY = centerY;
          const tempCanvas = document.createElement('canvas');
          const tempCtx = tempCanvas.getContext('2d');
          const resolution = 150;
          tempCanvas.width = resolution;
          tempCanvas.height = resolution;
          tempCtx.font = '900 ' + (resolution * 0.7) + 'px "' + settings.font + '"';
          tempCtx.fillStyle = '#000000';
          tempCtx.textAlign = 'center';
          tempCtx.textBaseline = 'middle';
          tempCtx.fillText(char, resolution/2, resolution/2);
          const imageData = tempCtx.getImageData(0, 0, resolution, resolution);
          const sampleSize = 3;
          for (let y = 0; y < resolution; y += sampleSize) {
            for (let x = 0; x < resolution; x += sampleSize) {
              const index = (y * resolution + x) * 4;
              const alpha = imageData.data[index + 3];
              if (alpha > 50) {
                const relativeX = (x - resolution/2) / resolution * fontSize;
                const relativeY = (y - resolution/2) / resolution * fontSize;
                const worldX = charBaseX + relativeX;
                const worldY = charBaseY + relativeY;
                const distortion = getDistortion(worldX - width/2, worldY - height/2, animTime + charIndex * 1.5 + (x + y) * 0.01, settings.distortionStrength, settings.distortionType);
                const finalX = worldX + distortion.x * 1.2;
                const finalY = worldY + distortion.y * 1.2;
                const pixelSize = Math.max(2, fontSize / 120);
                ctx.fillRect(finalX - pixelSize/2, finalY - pixelSize/2, pixelSize, pixelSize);
              }
            }
          }
        });
      } else {
        ctx.font = '900 ' + fontSize + 'px "' + settings.font + '", Impact, Arial Black, sans-serif';
        ctx.fillStyle = '#000000';
        ctx.textAlign = 'center';
        ctx.textBaseline = 'middle';
        ctx.fillText(settings.text, centerX, centerY);
      }
      ctx.restore();
    }
    
    if (settings.pixelationEnabled && settings.pixelSize > 1) {
      const imageData = ctx.getImageData(0, 0, width, height);
      const pixelated = ctx.createImageData(width, height);
      for (let y = 0; y < height; y += settings.pixelSize) {
        for (let x = 0; x < width; x += settings.pixelSize) {
          const sampleX = Math.min(x + Math.floor(settings.pixelSize / 2), width - 1);
          const sampleY = Math.min(y + Math.floor(settings.pixelSize / 2), height - 1);
          const idx = (sampleY * width + sampleX) * 4;
          const [r, g, b, a] = [imageData.data[idx], imageData.data[idx + 1], imageData.data[idx + 2], imageData.data[idx + 3]];
          for (let py = y; py < Math.min(y + settings.pixelSize, height); py++) {
            for (let px = x; px < Math.min(x + settings.pixelSize, width); px++) {
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
    
    // Draw grid
    if (settings.showGrid) {
      ctx.save();
      ctx.strokeStyle = 'rgba(255, 0, 0, 0.3)';
      ctx.lineWidth = 1;
      const cellSize = Math.min(width, height) / settings.gridSize;
      for (let i = 0; i <= settings.gridSize; i++) {
        const pos = i * cellSize;
        ctx.beginPath();
        ctx.moveTo(pos, 0);
        ctx.lineTo(pos, height);
        ctx.stroke();
        ctx.beginPath();
        ctx.moveTo(0, pos);
        ctx.lineTo(width, pos);
        ctx.stroke();
      }
      ctx.restore();
    }
  };

  useEffect(() => {
    const loop = (time) => {
      render(time);
      animationRef.current = requestAnimationFrame(loop);
    };
    animationRef.current = requestAnimationFrame(loop);
    return () => cancelAnimationFrame(animationRef.current);
  }, [isAnimating, settings, audioTimeMultiplier]);

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
          <button onClick={() => setSettings(s => ({ ...s, lineThickness: Math.random() * 15 + 5, spacing: Math.random() * 30 + 15, distortionStrength: Math.random() * 40 + 10 }))} 
                  className="flex items-center gap-1 px-3 py-2 bg-green-500 text-white rounded text-sm">
            <RotateCcw size={14} />
          </button>
          <button onClick={() => { const canvas = canvasRef.current; const link = document.createElement('a'); link.download = 'pattern.png'; link.href = canvas.toDataURL(); link.click(); }} 
                  className="flex items-center gap-1 px-3 py-2 bg-purple-500 text-white rounded text-sm">
            <Download size={14} />
          </button>
        </div>

        <div>
          <h3 className="font-semibold mb-2">Audio Input</h3>
          <label className="flex items-center mb-2">
            <input type="checkbox" checked={audioEnabled} onChange={(e) => setAudioEnabled(e.target.checked)} className="mr-2" />
            Enable Audio
          </label>
          
          {audioEnabled && (
            <div className="space-y-3">
              {audioDevices.length > 0 && (
                <select value={selectedAudioDevice || ''} onChange={(e) => setSelectedAudioDevice(e.target.value)} className="w-full p-2 border rounded text-xs">
                  {audioDevices.map(d => <option key={d.deviceId} value={d.deviceId}>{d.label || `Input ${d.deviceId.substring(0, 8)}`}</option>)}
                </select>
              )}

              <div>
                <label className="block text-xs mb-1">Sensitivity: {settings.audioSensitivity.toFixed(1)}x</label>
                <input type="range" min="0.1" max="10" step="0.1" value={settings.audioSensitivity} 
                       onChange={(e) => setSettings(s => ({ ...s, audioSensitivity: parseFloat(e.target.value) }))} className="w-full" />
              </div>
              
              <div className="bg-gradient-to-r from-blue-50 to-purple-50 p-3 rounded">
                <div className="text-xs mb-1">Level: {(audioLevel * 100).toFixed(0)}%</div>
                <div className="w-full bg-gray-200 rounded h-2 mb-2">
                  <div className="bg-blue-500 h-2 rounded" style={{ width: `${audioLevel * 100}%` }} />
                </div>
                <div className="text-xs">Bass: {(bassLevel * 100).toFixed(0)}%</div>
                <div className="w-full bg-gray-200 rounded h-2">
                  <div className="bg-red-500 h-2 rounded" style={{ width: `${bassLevel * 100}%` }} />
                </div>
              </div>
              
              <div className="space-y-2 bg-gray-50 p-2 rounded">
                <label className="flex items-center">
                  <input type="checkbox" checked={settings.audioReactiveSpeed} 
                         onChange={(e) => setSettings(s => ({ ...s, audioReactiveSpeed: e.target.checked }))} className="mr-2" />
                  <span className="text-sm">Animation Speed 🟣</span>
                </label>
                
                <label className="flex items-center">
                  <input type="checkbox" checked={settings.audioReactivePixels} 
                         onChange={(e) => setSettings(s => ({ ...s, audioReactivePixels: e.target.checked }))} className="mr-2" />
                  <span className="text-sm">Pixelation (Bass) 🔴</span>
                </label>
                
                {settings.audioReactiveSpeed && (
                  <div className="text-xs text-gray-600 bg-blue-50 p-2 rounded">
                    Speed: {audioTimeMultiplier.toFixed(2)}x
                  </div>
                )}
              </div>
            </div>
          )}
        </div>

        <div>
          <h3 className="font-semibold mb-2">Pattern</h3>
          <select value={settings.patternType} onChange={(e) => setSettings(s => ({ ...s, patternType: e.target.value }))} className="w-full p-2 border rounded mb-2 text-sm">
            <option value="vertical-lines">Vertical Lines</option>
            <option value="horizontal-lines">Horizontal Lines</option>
            <option value="checkerboard">Checkerboard</option>
          </select>
          <label className="block text-sm mb-1">Thickness: {settings.lineThickness.toFixed(1)}</label>
          <input type="range" min="2" max="30" value={settings.lineThickness} onChange={(e) => setSettings(s => ({ ...s, lineThickness: parseFloat(e.target.value) }))} className="w-full mb-2" />
          <label className="block text-sm mb-1">Spacing: {settings.spacing.toFixed(1)}</label>
          <input type="range" min="10" max="60" value={settings.spacing} onChange={(e) => setSettings(s => ({ ...s, spacing: parseFloat(e.target.value) }))} className="w-full" />
        </div>

        <div>
          <h3 className="font-semibold mb-2 flex items-center gap-1"><Type size={16} />Text</h3>
          <label className="flex items-center mb-2">
            <input type="checkbox" checked={settings.textEnabled} onChange={(e) => setSettings(s => ({ ...s, textEnabled: e.target.checked }))} className="mr-2" />
            Enable Text
          </label>
          {settings.textEnabled && (
            <>
              <input type="text" value={settings.text} onChange={(e) => setSettings(s => ({ ...s, text: e.target.value }))} className="w-full p-2 border rounded mb-2 text-sm" placeholder="Type text..." />
              <select value={settings.font} onChange={(e) => setSettings(s => ({ ...s, font: e.target.value }))} className="w-full p-2 border rounded mb-2 text-sm">
                <optgroup label="System Fonts">
                  {systemFonts.map(font => <option key={font} value={font}>{font}</option>)}
                </optgroup>
                <optgroup label="Web Fonts">
                  {webFonts.map(font => <option key={font} value={font}>{font}</option>)}
                </optgroup>
                {customFonts.length > 0 && (
                  <optgroup label="Custom Fonts">
                    {customFonts.map(font => <option key={font} value={font}>{font}</option>)}
                  </optgroup>
                )}
              </select>
              <input type="file" accept=".ttf,.otf,.woff,.woff2" onChange={handleFontUpload} className="w-full p-2 border rounded mb-2 text-xs" />
              <label className="block text-sm mb-1">Size: {settings.fontSize}%</label>
              <input type="range" min="50" max="200" value={settings.fontSize} onChange={(e) => setSettings(s => ({ ...s, fontSize: parseInt(e.target.value) }))} className="w-full" />
            </>
          )}
        </div>

        <div>
          <h3 className="font-semibold mb-2">Shapes</h3>
          <label className="flex items-center mb-2">
            <input type="checkbox" checked={settings.shapeEnabled} onChange={(e) => setSettings(s => ({ ...s, shapeEnabled: e.target.checked }))} className="mr-2" />
            Enable Shape
          </label>
          {settings.shapeEnabled && (
            <>
              <label className="block text-sm mb-2">{shapes[settings.shapeIndex].name}</label>
              <input type="range" min="0" max={shapes.length - 1} value={settings.shapeIndex} onChange={(e) => setSettings(s => ({ ...s, shapeIndex: parseInt(e.target.value) }))} className="w-full mb-2" />
              <label className="block text-sm mb-1">Size: {settings.shapeSize}%</label>
              <input type="range" min="30" max="200" value={settings.shapeSize} onChange={(e) => setSettings(s => ({ ...s, shapeSize: parseInt(e.target.value) }))} className="w-full" />
            </>
          )}
        </div>

        <div>
          <h3 className="font-semibold mb-2">Distortion</h3>
          <label className="flex items-center mb-2">
            <input type="checkbox" checked={settings.distortionEnabled} onChange={(e) => setSettings(s => ({ ...s, distortionEnabled: e.target.checked }))} className="mr-2" />
            Enable
          </label>
          {settings.distortionEnabled && (
            <>
              <select value={settings.distortionType} onChange={(e) => setSettings(s => ({ ...s, distortionType: e.target.value }))} className="w-full p-2 border rounded mb-2">
                {distortionTypes.map(t => <option key={t.value} value={t.value}>{t.label}</option>)}
              </select>
              <label className="block text-sm mb-1">Strength: {settings.distortionStrength}</label>
              <input type="range" min="5" max="80" value={settings.distortionStrength} onChange={(e) => setSettings(s => ({ ...s, distortionStrength: parseInt(e.target.value) }))} className="w-full mb-2" />
              <label className="block text-sm mb-1">Speed: {settings.distortionSpeed}</label>
              <input type="range" min="0.1" max="3" step="0.1" value={settings.distortionSpeed} onChange={(e) => setSettings(s => ({ ...s, distortionSpeed: parseFloat(e.target.value) }))} className="w-full" />
            </>
          )}
        </div>

        <div>
          <h3 className="font-semibold mb-2">Pixelation</h3>
          <label className="flex items-center mb-2">
            <input type="checkbox" checked={settings.pixelationEnabled} onChange={(e) => setSettings(s => ({ ...s, pixelationEnabled: e.target.checked }))} className="mr-2" />
            Enable
          </label>
          {settings.pixelationEnabled && (
            <>
              <label className="block text-sm mb-1">Size: {settings.pixelSize}</label>
              <input type="range" min="2" max="20" value={settings.pixelSize} onChange={(e) => setSettings(s => ({ ...s, pixelSize: parseInt(e.target.value) }))} className="w-full" />
            </>
          )}
        </div>

        <div>
          <h3 className="font-semibold mb-2 flex items-center gap-1"><Grid size={16} />Grid</h3>
          <label className="flex items-center mb-2">
            <input type="checkbox" checked={settings.showGrid} onChange={(e) => setSettings(s => ({ ...s, showGrid: e.target.checked }))} className="mr-2" />
            Show Grid
          </label>
          {settings.showGrid && (
            <>
              <label className="block text-sm mb-1">Grid Size: {settings.gridSize}x{settings.gridSize}</label>
              <input type="range" min="10" max="50" value={settings.gridSize} onChange={(e) => setSettings(s => ({ ...s, gridSize: parseInt(e.target.value) }))} className="w-full" />
            </>
          )}
        </div>
      </div>

      <div className="flex-1 p-4">
        <canvas ref={canvasRef} className="w-full h-full border border-gray-300 bg-white rounded-lg shadow-lg" />
      </div>
    </div>
  );
}
