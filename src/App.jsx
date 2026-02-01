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
  const distortionMultiplier = useRef(1);
  const speedMultiplier = useRef(1);
  const sensitivityRef = useRef(2);

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
    audioSensitivity: 2,
    dotSize: 8,
    shapeSize: 10,
    text: 'SOUND',
    font: 'Impact',
    fontSize: 40
  });

  const distortionTypes = [
    { value: 'liquify', label: 'Liquify Flow' },
    { value: 'ripple', label: 'Ripple Waves' },
    { value: 'swirl', label: 'Swirl Vortex' },
    { value: 'turbulence', label: 'Turbulence' },
    { value: 'marble', label: 'Marble Veins' },
    { value: 'wave', label: 'Wave Field' }
  ];

  const googleFonts = [
    'Impact',
    'Roboto',
    'Open Sans',
    'Montserrat',
    'Bebas Neue',
    'Anton',
    'Pacifico',
    'Lobster'
  ];

  // Load Google Fonts
  useEffect(() => {
    const link = document.createElement('link');
    link.href = 'https://fonts.googleapis.com/css2?family=Roboto:wght@900&family=Open+Sans:wght@800&family=Montserrat:wght@900&family=Bebas+Neue&family=Anton&family=Pacifico&family=Lobster&display=swap';
    link.rel = 'stylesheet';
    document.head.appendChild(link);
  }, []);

  // Audio setup
  useEffect(() => {
    if (!audioEnabled) {
      if (audioContextRef.current) audioContextRef.current.close();
      distortionMultiplier.current = 1;
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
          
          // SUBTLE changes - keep the base motion feel
          // Intensity: 1.0x (no change) to 2.0x (bit more intricate)
          const targetIntensity = 1.0 + (overall * sensitivityRef.current * 0.5);
          distortionMultiplier.current = distortionMultiplier.current + (targetIntensity - distortionMultiplier.current) * 0.1;
          
          // Speed: 1.0x (base speed) to 2.0x (faster)
          const targetSpeed = 1.0 + (overall * sensitivityRef.current * 0.5);
          speedMultiplier.current = speedMultiplier.current + (targetSpeed - speedMultiplier.current) * 0.1;
          
          requestAnimationFrame(updateAudio);
        };
        updateAudio();
      } catch (err) {
        alert('Audio failed: ' + err.message);
      }
    };

    initAudio();
  }, [audioEnabled]);

  // Proper noise function
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
      const A = p[X] + Y;
      const B = p[X + 1] + Y;
      const lerp = (t, a, b) => a + t * (b - a);
      return lerp(v, lerp(u, p[A] / 128 - 1, p[B] / 128 - 1), lerp(u, p[A + 1] / 128 - 1, p[B + 1] / 128 - 1));
    };
  })();

  const getDistortion = (x, y, time, strength, type) => {
    const freq = 0.01;
    const t = time || 0;
    let dx = 0, dy = 0;
    
    // Key change: time shifts the SAMPLE POSITION in noise space
    // This makes the pattern FLOW instead of oscillate
    
    switch (type) {
      case 'liquify':
        // Sample from moving position in noise field
        dx = noise((x + t * 50) * freq, y * freq) * strength;
        dy = noise((x + t * 50) * freq + 100, (y + t * 30) * freq + 100) * strength;
        break;
      case 'ripple':
        const dist = Math.sqrt(x * x + y * y);
        // Expanding ripple that flows outward continuously
        const ripple = Math.sin((dist - t * 50) * 0.02) * strength;
        dx = (x / (dist || 1)) * ripple;
        dy = (y / (dist || 1)) * ripple;
        break;
      case 'swirl':
        const angle = Math.atan2(y, x);
        const radius = Math.sqrt(x * x + y * y);
        // Continuous rotation
        const rotation = t * 0.3;
        const newAngle = angle + rotation + (strength * 0.001) * (1 / (1 + radius * 0.01));
        dx = Math.cos(newAngle) * radius - x;
        dy = Math.sin(newAngle) * radius - y;
        break;
      case 'turbulence':
        dx = noise((x + t * 40) * freq, y * freq) * strength;
        dy = noise(x * freq + 200, (y + t * 40) * freq + 200) * strength;
        break;
      case 'marble':
        const m1 = (x + t * 30) * freq + strength * 0.05 * noise(x * freq * 2, y * freq * 2);
        const m2 = (y + t * 30) * freq + strength * 0.05 * noise(x * freq * 2 + 100, y * freq * 2 + 100);
        dx = Math.sin(m1) * strength;
        dy = Math.sin(m2) * strength;
        break;
      case 'wave':
        // Traveling waves
        dx = Math.sin(y * freq * 5 - t * 0.5) * strength;
        dy = Math.cos(x * freq * 3 - t * 0.5) * strength;
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
    
    ctx.fillStyle = '#ffffff';
    ctx.fillRect(0, 0, width, height);
    ctx.fillStyle = '#000000';
    
    // CONTINUOUS forward motion - audio controls BOTH speed and intensity
    const animTime = time * 0.001 * settings.distortionSpeed * speedMultiplier.current;
    
    // Audio controls distortion STRENGTH, not time
    const audioDistortionStrength = settings.distortionStrength * distortionMultiplier.current;
    const audioDotSize = settings.dotSize * (1 + bassLevel * sensitivityRef.current * 0.5);
    const audioShapeSize = settings.shapeSize * (1 + bassLevel * sensitivityRef.current * 0.5);
    
    // Draw pattern based on type
    if (settings.patternType === 'dots') {
      ctx.fillStyle = '#000000';
      for (let y = 0; y < height; y += settings.spacing) {
        for (let x = 0; x < width; x += settings.spacing) {
          let drawX = x, drawY = y;
          if (settings.distortionEnabled) {
            const d = getDistortion(x - width/2, y - height/2, animTime, audioDistortionStrength, settings.distortionType);
            drawX += d.x;
            drawY += d.y;
          }
          ctx.beginPath();
          ctx.arc(drawX, drawY, audioDotSize, 0, Math.PI * 2);
          ctx.fill();
        }
      }
    } else if (settings.patternType === 'squares') {
      ctx.fillStyle = '#000000';
      for (let y = 0; y < height; y += settings.spacing) {
        for (let x = 0; x < width; x += settings.spacing) {
          let drawX = x, drawY = y;
          if (settings.distortionEnabled) {
            const d = getDistortion(x - width/2, y - height/2, animTime, audioDistortionStrength, settings.distortionType);
            drawX += d.x;
            drawY += d.y;
          }
          const halfSize = audioShapeSize / 2;
          ctx.fillRect(drawX - halfSize, drawY - halfSize, audioShapeSize, audioShapeSize);
        }
      }
    } else if (settings.patternType === 'triangles') {
      ctx.fillStyle = '#000000';
      for (let y = 0; y < height; y += settings.spacing) {
        for (let x = 0; x < width; x += settings.spacing) {
          let drawX = x, drawY = y;
          if (settings.distortionEnabled) {
            const d = getDistortion(x - width/2, y - height/2, animTime, audioDistortionStrength, settings.distortionType);
            drawX += d.x;
            drawY += d.y;
          }
          ctx.beginPath();
          ctx.moveTo(drawX, drawY - audioShapeSize);
          ctx.lineTo(drawX + audioShapeSize, drawY + audioShapeSize);
          ctx.lineTo(drawX - audioShapeSize, drawY + audioShapeSize);
          ctx.closePath();
          ctx.fill();
        }
      }
    } else if (settings.patternType === 'text') {
      ctx.fillStyle = '#000000';
      ctx.font = `${settings.fontSize}px "${settings.font}", sans-serif`;
      ctx.textAlign = 'center';
      ctx.textBaseline = 'middle';
      const textWidth = ctx.measureText(settings.text).width;
      const charSpacing = settings.spacing;
      for (let y = 0; y < height; y += settings.spacing) {
        for (let x = 0; x < width; x += settings.spacing) {
          let drawX = x, drawY = y;
          if (settings.distortionEnabled) {
            const d = getDistortion(x - width/2, y - height/2, animTime, audioDistortionStrength, settings.distortionType);
            drawX += d.x;
            drawY += d.y;
          }
          ctx.save();
          ctx.translate(drawX, drawY);
          ctx.scale(1 + bassLevel * sensitivityRef.current * 0.3, 1 + bassLevel * sensitivityRef.current * 0.3);
          ctx.fillText(settings.text, 0, 0);
          ctx.restore();
        }
      }
    } else if (settings.patternType === 'vertical-lines') {
      for (let x = 0; x < width; x += settings.spacing) {
        ctx.beginPath();
        for (let y = 0; y < height; y++) {
          let drawX = x, drawY = y;
          if (settings.distortionEnabled) {
            const d = getDistortion(x - width/2, y - height/2, animTime, audioDistortionStrength, settings.distortionType);
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
            const d = getDistortion(x - width/2, y - height/2, animTime, audioDistortionStrength, settings.distortionType);
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
    
    // Pixelation with bass control
    if (settings.pixelationEnabled) {
      const pixelSize = Math.round(settings.pixelSize + (bassLevel * sensitivityRef.current * 4));
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
          <div>Intensity: {distortionMultiplier.current.toFixed(2)}x</div>
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
                <label className="block text-xs mb-1">Sensitivity: {settings.audioSensitivity.toFixed(2)}x</label>
                <input type="range" min="0.1" max="3" step="0.1" value={settings.audioSensitivity} 
                       onChange={(e) => {
                         const val = parseFloat(e.target.value);
                         setSettings(s => ({ ...s, audioSensitivity: val }));
                         sensitivityRef.current = val;
                       }} 
                       className="w-full" />
                <div className="text-xs text-gray-500 mt-1">Controls distortion intensity</div>
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
          <select value={settings.patternType} onChange={(e) => setSettings(s => ({ ...s, patternType: e.target.value }))} className="w-full p-2 border rounded mb-2 text-sm">
            <option value="vertical-lines">Vertical Lines</option>
            <option value="horizontal-lines">Horizontal Lines</option>
            <option value="checkerboard">Checkerboard</option>
            <option value="dots">Dots</option>
            <option value="squares">Squares</option>
            <option value="triangles">Triangles</option>
            <option value="text">Text</option>
          </select>
          
          {(settings.patternType === 'vertical-lines' || settings.patternType === 'horizontal-lines') && (
            <div>
              <label className="block text-sm mb-1">Thickness: {settings.lineThickness.toFixed(1)}</label>
              <input type="range" min="2" max="30" value={settings.lineThickness} onChange={(e) => setSettings(s => ({ ...s, lineThickness: parseFloat(e.target.value) }))} className="w-full mb-2" />
            </div>
          )}
          
          {settings.patternType === 'dots' && (
            <div>
              <label className="block text-sm mb-1">Dot Size: {settings.dotSize.toFixed(1)}</label>
              <input type="range" min="2" max="20" value={settings.dotSize} onChange={(e) => setSettings(s => ({ ...s, dotSize: parseFloat(e.target.value) }))} className="w-full mb-2" />
            </div>
          )}
          
          {(settings.patternType === 'squares' || settings.patternType === 'triangles') && (
            <div>
              <label className="block text-sm mb-1">Shape Size: {settings.shapeSize.toFixed(1)}</label>
              <input type="range" min="4" max="30" value={settings.shapeSize} onChange={(e) => setSettings(s => ({ ...s, shapeSize: parseFloat(e.target.value) }))} className="w-full mb-2" />
            </div>
          )}
          
          {settings.patternType === 'text' && (
            <div className="space-y-2">
              <div>
                <label className="block text-sm mb-1">Text</label>
                <input type="text" value={settings.text} onChange={(e) => setSettings(s => ({ ...s, text: e.target.value }))} className="w-full p-2 border rounded text-sm" />
              </div>
              <div>
                <label className="block text-sm mb-1">Font</label>
                <select value={settings.font} onChange={(e) => setSettings(s => ({ ...s, font: e.target.value }))} className="w-full p-2 border rounded text-sm">
                  {googleFonts.map(font => <option key={font} value={font}>{font}</option>)}
                </select>
              </div>
              <div>
                <label className="block text-sm mb-1">Font Size: {settings.fontSize}</label>
                <input type="range" min="20" max="100" value={settings.fontSize} onChange={(e) => setSettings(s => ({ ...s, fontSize: parseInt(e.target.value) }))} className="w-full" />
              </div>
            </div>
          )}
          
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
              <label className="block text-sm mb-1">Base Speed: {settings.distortionSpeed}</label>
              <input type="range" min="0.1" max="3" step="0.1" value={settings.distortionSpeed} onChange={(e) => setSettings(s => ({ ...s, distortionSpeed: parseFloat(e.target.value) }))} className="w-full" />
            </div>
          )}
        </div>

        <div>
          <h3 className="font-semibold mb-2">Pixelation</h3>
          <label className="flex items-center mb-2">
            <input type="checkbox" checked={settings.pixelationEnabled} onChange={(e) => setSettings(s => ({ ...s, pixelationEnabled: e.target.checked }))} className="mr-2" />
            Enable Bass Reactive
          </label>
          <div>
            <label className="block text-sm mb-1">Base Size: {settings.pixelSize}</label>
            <input type="range" min="2" max="12" value={settings.pixelSize} onChange={(e) => setSettings(s => ({ ...s, pixelSize: parseInt(e.target.value) }))} className="w-full" />
            <div className="text-xs text-gray-500 mt-1">Bass adds extra pixelation when enabled</div>
          </div>
        </div>
      </div>

      <div className="flex-1 p-4">
        <canvas ref={canvasRef} className="w-full h-full border border-gray-300 bg-white rounded-lg shadow-lg" />
      </div>
    </div>
  );
}
