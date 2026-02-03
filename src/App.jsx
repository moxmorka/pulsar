import React from 'react';
import { RotateCcw, Download } from 'lucide-react';

const PixelMoireGenerator = () => {
  const canvasRef = React.useRef(null);
  const animationRef = React.useRef(null);
  const audioContextRef = React.useRef(null);
  const analyserRef = React.useRef(null);
  const distortionMultiplier = React.useRef(1);
  const speedMultiplier = React.useRef(1);
  const sensitivityRef = React.useRef(2);
  const svgImageRef = React.useRef(null);

  const [audioEnabled, setAudioEnabled] = React.useState(false);
  const [audioLevel, setAudioLevel] = React.useState(0);
  const [bassLevel, setBassLevel] = React.useState(0);
  const [customSvg, setCustomSvg] = React.useState(null);
  const [customFont, setCustomFont] = React.useState(null);

  const [settings, setSettings] = React.useState({
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
    fontSize: 40,
    customSvgScale: 1,
    charSequence: '01',
    charGridSize: 20,
    charCycleSpeed: 5
  });

  const distortionTypes = [
    { value: 'liquify', label: 'Liquify Flow' },
    { value: 'ripple', label: 'Ripple Waves' },
    { value: 'swirl', label: 'Swirl Vortex' },
    { value: 'turbulence', label: 'Turbulence' },
    { value: 'marble', label: 'Marble Veins' },
    { value: 'wave', label: 'Wave Field' }
  ];

  const googleFonts = ['Impact', 'Roboto', 'Open Sans', 'Montserrat', 'Bebas Neue', 'Anton', 'Pacifico', 'Lobster'];

  React.useEffect(() => {
    const link = document.createElement('link');
    link.href = 'https://fonts.googleapis.com/css2?family=Roboto:wght@900&family=Open+Sans:wght@800&family=Montserrat:wght@900&family=Bebas+Neue&family=Anton&family=Pacifico&family=Lobster&display=swap';
    link.rel = 'stylesheet';
    document.head.appendChild(link);
  }, []);

  const handleSvgUpload = (e) => {
    const file = e.target.files[0];
    if (!file) return;
    const reader = new FileReader();
    reader.onload = (event) => {
      const svgText = event.target.result;
      const img = new Image();
      const blob = new Blob([svgText], { type: 'image/svg+xml' });
      const url = URL.createObjectURL(blob);
      img.onload = () => {
        svgImageRef.current = img;
        setCustomSvg(url);
        setSettings(s => ({ ...s, patternType: 'custom-svg' }));
      };
      img.src = url;
    };
    reader.readAsText(file);
  };

  const handleFontUpload = (e) => {
    const file = e.target.files[0];
    if (!file) return;
    const reader = new FileReader();
    reader.onload = (event) => {
      const fontName = 'CustomFont';
      const fontFace = new FontFace(fontName, `url(${event.target.result})`);
      fontFace.load().then((loadedFont) => {
        document.fonts.add(loadedFont);
        setCustomFont(fontName);
        setSettings(s => ({ ...s, font: fontName }));
      }).catch(() => alert('Font loading failed'));
    };
    reader.readAsDataURL(file);
  };

  React.useEffect(() => {
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
          const targetIntensity = 1.0 + (overall * sensitivityRef.current * 0.5);
          distortionMultiplier.current = distortionMultiplier.current + (targetIntensity - distortionMultiplier.current) * 0.1;
          const targetSpeed = 1.0 + (overall * sensitivityRef.current * 0.5);
          speedMultiplier.current = speedMultiplier.current + (targetSpeed - speedMultiplier.current) * 0.1;
          requestAnimationFrame(updateAudio);
        };
        updateAudio();
      } catch (err) {
        alert('Audio failed');
      }
    };
    initAudio();
  }, [audioEnabled]);

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
    switch (type) {
      case 'liquify':
        dx = noise((x + t * 50) * freq, y * freq) * strength;
        dy = noise((x + t * 50) * freq + 100, (y + t * 30) * freq + 100) * strength;
        break;
      case 'ripple':
        const dist = Math.sqrt(x * x + y * y);
        const ripple = Math.sin((dist - t * 50) * 0.02) * strength;
        dx = (x / (dist || 1)) * ripple;
        dy = (y / (dist || 1)) * ripple;
        break;
      case 'swirl':
        const angle = Math.atan2(y, x);
        const radius = Math.sqrt(x * x + y * y);
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
    const animTime = time * 0.001 * settings.distortionSpeed * speedMultiplier.current;
    const audioDistortionStrength = settings.distortionStrength * distortionMultiplier.current;
    const audioDotSize = settings.dotSize * (1 + bassLevel * sensitivityRef.current * 0.5);
    const audioShapeSize = settings.shapeSize * (1 + bassLevel * sensitivityRef.current * 0.5);
    
    if (settings.patternType === 'dots') {
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
    } else if (settings.patternType === 'custom-svg' && svgImageRef.current) {
      for (let y = 0; y < height; y += settings.spacing) {
        for (let x = 0; x < width; x += settings.spacing) {
          let drawX = x, drawY = y;
          if (settings.distortionEnabled) {
            const d = getDistortion(x - width/2, y - height/2, animTime, audioDistortionStrength, settings.distortionType);
            drawX += d.x;
            drawY += d.y;
          }
          const size = audioShapeSize * settings.customSvgScale;
          ctx.save();
          ctx.translate(drawX, drawY);
          ctx.scale(1 + bassLevel * sensitivityRef.current * 0.3, 1 + bassLevel * sensitivityRef.current * 0.3);
          ctx.drawImage(svgImageRef.current, -size/2, -size/2, size, size);
          ctx.restore();
        }
      }
    } else if (settings.patternType === 'squares') {
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
      ctx.font = `${settings.fontSize}px "${settings.font}", sans-serif`;
      ctx.textAlign = 'center';
      ctx.textBaseline = 'middle';
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
    } else if (settings.patternType === 'char-grid') {
      ctx.font = `${settings.charGridSize}px "${settings.font}", monospace`;
      ctx.textAlign = 'center';
      ctx.textBaseline = 'middle';
      const chars = settings.charSequence.split('');
      if (chars.length === 0) return;
      
      // Time-based cycling - each character rotates through the sequence
      const cycleOffset = audioEnabled 
        ? Math.floor(animTime * settings.charCycleSpeed * (1 + audioLevel * 2)) 
        : 0;
      
      let globalIndex = 0;
      for (let y = 0; y < height; y += settings.spacing) {
        for (let x = 0; x < width; x += settings.spacing) {
          let drawX = x, drawY = y;
          if (settings.distortionEnabled) {
            const d = getDistortion(x - width/2, y - height/2, animTime, audioDistortionStrength, settings.distortionType);
            drawX += d.x;
            drawY += d.y;
          }
          
          // Each position cycles through ALL characters over time
          const charIndex = (globalIndex + cycleOffset) % chars.length;
          const char = chars[charIndex];
          
          ctx.save();
          ctx.translate(drawX, drawY);
          ctx.scale(1 + bassLevel * sensitivityRef.current * 0.3, 1 + bassLevel * sensitivityRef.current * 0.3);
          ctx.fillText(char, 0, 0);
          ctx.restore();
          
          globalIndex++;
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

  React.useEffect(() => {
    const loop = (time) => {
      render(time);
      animationRef.current = requestAnimationFrame(loop);
    };
    animationRef.current = requestAnimationFrame(loop);
    return () => cancelAnimationFrame(animationRef.current);
  }, [settings]);

  React.useEffect(() => {
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
          <button onClick={() => setSettings(s => ({ ...s, lineThickness: Math.random() * 15 + 5, spacing: Math.random() * 30 + 15 }))} className="flex items-center gap-1 px-3 py-2 bg-green-500 text-white rounded text-sm">
            <RotateCcw size={14} /> Random
          </button>
          <button onClick={() => { const link = document.createElement('a'); link.download = 'pattern.png'; link.href = canvasRef.current.toDataURL(); link.click(); }} className="flex items-center gap-1 px-3 py-2 bg-purple-500 text-white rounded text-sm">
            <Download size={14} /> Save
          </button>
        </div>

        <div className="bg-yellow-200 border-2 border-red-500 p-3 rounded text-xs font-mono">
          <div className="font-bold mb-2">DEBUG:</div>
          <div>Audio: {audioLevel.toFixed(3)}</div>
          <div>Bass: {bassLevel.toFixed(3)}</div>
          <div>Intensity: {distortionMultiplier.current.toFixed(2)}x</div>
          <div>Speed: {speedMultiplier.current.toFixed(2)}x</div>
          {settings.patternType === 'char-grid' && (
            <>
              <div>Chars: "{settings.charSequence}"</div>
              <div>Char count: {settings.charSequence.length}</div>
            </>
          )}
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
                <input type="range" min="0.1" max="3" step="0.1" value={settings.audioSensitivity} onChange={(e) => { const val = parseFloat(e.target.value); setSettings(s => ({ ...s, audioSensitivity: val })); sensitivityRef.current = val; }} className="w-full" />
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
            <option value="char-grid">Character Grid</option>
            <option value="custom-svg">Custom SVG Shape</option>
          </select>
          
          {settings.patternType === 'custom-svg' && (
            <div className="space-y-2 mb-2">
              <label className="block">
                <div className="text-sm mb-1">Upload SVG File</div>
                <input type="file" accept=".svg" onChange={handleSvgUpload} className="w-full text-xs p-2 border rounded" />
              </label>
              {customSvg && (
                <>
                  <div className="text-xs text-green-600">✓ SVG loaded</div>
                  <div>
                    <label className="block text-sm mb-1">SVG Scale: {settings.customSvgScale.toFixed(1)}x</label>
                    <input type="range" min="0.5" max="3" step="0.1" value={settings.customSvgScale} onChange={(e) => setSettings(s => ({ ...s, customSvgScale: parseFloat(e.target.value) }))} className="w-full" />
                  </div>
                </>
              )}
            </div>
          )}
          
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
                  {customFont && <option value={customFont}>Custom Font</option>}
                </select>
              </div>
              <div>
                <label className="block">
                  <div className="text-sm mb-1">Upload Custom Font (.ttf, .otf, .woff)</div>
                  <input type="file" accept=".ttf,.otf,.woff,.woff2" onChange={handleFontUpload} className="w-full text-xs p-2 border rounded" />
                </label>
                {customFont && <div className="text-xs text-green-600">✓ Custom font loaded</div>}
              </div>
              <div>
                <label className="block text-sm mb-1">Font Size: {settings.fontSize}</label>
                <input type="range" min="20" max="100" value={settings.fontSize} onChange={(e) => setSettings(s => ({ ...s, fontSize: parseInt(e.target.value) }))} className="w-full" />
              </div>
            </div>
          )}
          
          {settings.patternType === 'char-grid' && (
            <div className="space-y-2">
              <div>
                <label className="block text-sm mb-1">Character Sequence</label>
                <input type="text" value={settings.charSequence} onChange={(e) => setSettings(s => ({ ...s, charSequence: e.target.value }))} className="w-full p-2 border rounded text-sm font-mono" placeholder="01 or abc or !@#$" />
                <div className="text-xs text-gray-500 mt-1">Characters cycle when audio is enabled (e.g., "01", "█▓▒░", "!@#$%", "あいうえお")</div>
              </div>
              <div>
                <label className="block text-sm mb-1">Font</label>
                <select value={settings.font} onChange={(e) => setSettings(s => ({ ...s, font: e.target.value }))} className="w-full p-2 border rounded text-sm">
                  {googleFonts.map(font => <option key={font} value={font}>{font}</option>)}
                  {customFont && <option value={customFont}>Custom Font</option>}
                </select>
              </div>
              <div>
                <label className="block">
                  <div className="text-sm mb-1">Upload Custom Font (.ttf, .otf, .woff)</div>
                  <input type="file" accept=".ttf,.otf,.woff,.woff2" onChange={handleFontUpload} className="w-full text-xs p-2 border rounded" />
                </label>
                {customFont && <div className="text-xs text-green-600">✓ Custom font loaded</div>}
              </div>
              <div>
                <label className="block text-sm mb-1">Character Size: {settings.charGridSize}</label>
                <input type="range" min="10" max="60" value={settings.charGridSize} onChange={(e) => setSettings(s => ({ ...s, charGridSize: parseInt(e.target.value) }))} className="w-full" />
              </div>
              <div>
                <label className="block text-sm mb-1">Cycle Speed: {settings.charCycleSpeed}</label>
                <input type="range" min="1" max="20" value={settings.charCycleSpeed} onChange={(e) => setSettings(s => ({ ...s, charCycleSpeed: parseInt(e.target.value) }))} className="w-full" />
                <div className="text-xs text-gray-500 mt-1">How fast characters cycle through (audio reactive)</div>
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
};

export default PixelMoireGenerator;
