import React, { useState, useEffect, useRef } from 'react';

const AudioPatternMorpher = () => {
  const [isListening, setIsListening] = useState(false);
  const [selectedShape, setSelectedShape] = useState('dot');
  const [morphValue, setMorphValue] = useState(0);
  const [audioLevel, setAudioLevel] = useState(0);
  const [frequency, setFrequency] = useState(0);
  const [settings, setSettings] = useState({
    lineThickness: 2,
    spacing: 20,
    layerCount: 3,
    distortionStrength: 30,
    distortionSpeed: 1,
    showGrid: false,
    gridSize: 20,
    pixelationEnabled: false,
    pixelSize: 4
  });
  
  const canvasRef = useRef(null);
  const audioContextRef = useRef(null);
  const analyserRef = useRef(null);
  const animationRef = useRef(null);
  const dataArrayRef = useRef(null);

  const PHI = 1.618033988749895;
  const FIBONACCI = [1, 1, 2, 3, 5, 8, 13, 21, 34, 55, 89, 144];

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;

    canvas.width = window.innerWidth;
    canvas.height = window.innerHeight;

    const handleResize = () => {
      canvas.width = window.innerWidth;
      canvas.height = window.innerHeight;
    };

    window.addEventListener('resize', handleResize);
    return () => window.removeEventListener('resize', handleResize);
  }, []);

  const startAudio = async () => {
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      const audioContext = new (window.AudioContext || window.webkitAudioContext)();
      const analyser = audioContext.createAnalyser();
      const source = audioContext.createMediaStreamSource(stream);
      
      analyser.fftSize = 2048;
      source.connect(analyser);
      
      audioContextRef.current = audioContext;
      analyserRef.current = analyser;
      dataArrayRef.current = new Uint8Array(analyser.frequencyBinCount);
      
      setIsListening(true);
      animate();
    } catch (err) {
      console.error('Audio error:', err);
    }
  };

  const stopAudio = () => {
    if (audioContextRef.current) {
      audioContextRef.current.close();
    }
    if (animationRef.current) {
      cancelAnimationFrame(animationRef.current);
    }
    setIsListening(false);
  };

  const getAudioData = () => {
    if (!analyserRef.current || !dataArrayRef.current) return { level: 0, freq: 0 };
    
    analyserRef.current.getByteFrequencyData(dataArrayRef.current);
    
    const avg = dataArrayRef.current.reduce((a, b) => a + b) / dataArrayRef.current.length;
    const lowFreq = dataArrayRef.current.slice(0, 64).reduce((a, b) => a + b) / 64;
    
    return { level: avg / 255, freq: lowFreq / 255 };
  };

  const drawDotPatterns = (ctx, w, h, morph, audio) => {
    ctx.fillStyle = 'white';
    ctx.fillRect(0, 0, w, h);
    
    const numLayers = settings.layerCount;
    const spacing = settings.spacing;
    const distortion = settings.distortionStrength;
    const speed = settings.distortionSpeed;
    
    if (morph < 0.33) {
      const gridSize = Math.floor(Math.max(w, h) / spacing);
      
      for (let layer = 0; layer < numLayers; layer++) {
        const offset = audio.level * distortion + layer * 10;
        const timeOffset = Date.now() * 0.001 * speed + layer * 0.5;
        
        for (let i = 0; i < gridSize; i++) {
          for (let j = 0; j < gridSize; j++) {
            const x = i * spacing + Math.sin(timeOffset + i * 0.1) * offset;
            const y = j * spacing + Math.cos(timeOffset + j * 0.1) * offset;
            const size = settings.lineThickness + audio.freq * 4;
            
            ctx.fillStyle = `rgba(0, 0, 0, ${0.5 / numLayers})`;
            ctx.beginPath();
            ctx.arc(x, y, size, 0, Math.PI * 2);
            ctx.fill();
          }
        }
      }
    }
    
    if (morph >= 0.33 && morph < 0.67) {
      const rows = Math.floor(h / spacing);
      const cols = Math.floor(w / spacing);
      const timeOffset = Date.now() * 0.001 * speed;
      
      for (let i = 0; i < cols; i++) {
        for (let j = 0; j < rows; j++) {
          const x = i * spacing;
          const y = j * spacing + Math.sin(i * 0.3 + timeOffset + audio.freq * 10) * distortion * audio.level;
          const size = settings.lineThickness + audio.level * 3;
          
          ctx.fillStyle = `rgba(0, 0, 0, 0.7)`;
          ctx.beginPath();
          ctx.arc(x, y, size, 0, Math.PI * 2);
          ctx.fill();
        }
      }
    }
    
    if (morph >= 0.67) {
      const gridSize = Math.floor(Math.max(w, h) / spacing);
      const timeOffset = Date.now() * 0.001 * speed;
      const angle1 = audio.freq * Math.PI * 0.3 + timeOffset;
      
      for (let i = 0; i < gridSize; i++) {
        for (let j = 0; j < gridSize; j++) {
          const baseX = i * spacing;
          const baseY = j * spacing;
          const x1 = baseX + Math.sin(angle1 + j * 0.1) * distortion * audio.level;
          const y1 = baseY + Math.cos(angle1 + i * 0.1) * distortion * audio.level;
          const size = settings.lineThickness + audio.level * 4;
          
          ctx.fillStyle = `rgba(0, 0, 0, 0.6)`;
          ctx.beginPath();
          ctx.arc(x1, y1, size, 0, Math.PI * 2);
          ctx.fill();
        }
      }
    }
  };

  const drawLinePatterns = (ctx, w, h, morph, audio) => {
    ctx.fillStyle = 'white';
    ctx.fillRect(0, 0, w, h);
    
    const numLayers = settings.layerCount;
    const spacing = settings.spacing;
    const distortion = settings.distortionStrength;
    const speed = settings.distortionSpeed;
    const thickness = settings.lineThickness;
    
    if (morph < 0.33) {
      const numLines = Math.floor(h / spacing);
      const timeOffset = Date.now() * 0.001 * speed;
      const offset = audio.level * distortion;
      
      ctx.strokeStyle = `rgba(0, 0, 0, ${0.4 / numLayers})`;
      ctx.lineWidth = thickness + audio.freq * 3;
      
      for (let layer = 0; layer < numLayers; layer++) {
        const layerOffset = offset + layer * 15;
        
        for (let i = 0; i < numLines; i++) {
          const y = i * spacing + layerOffset + Math.sin(timeOffset + i * 0.1) * 10;
          ctx.beginPath();
          ctx.moveTo(0, y);
          ctx.lineTo(w, y);
          ctx.stroke();
        }
        
        for (let i = 0; i < numLines; i++) {
          const x = i * spacing + layerOffset * 1.3 + Math.cos(timeOffset + i * 0.1) * 10;
          ctx.beginPath();
          ctx.moveTo(x, 0);
          ctx.lineTo(x, h);
          ctx.stroke();
        }
      }
    }
    
    if (morph >= 0.33 && morph < 0.67) {
      const numLines = Math.floor(h / spacing);
      const timeOffset = Date.now() * 0.001 * speed;
      
      ctx.strokeStyle = `rgba(0, 0, 0, 0.6)`;
      ctx.lineWidth = thickness + audio.level * 3;
      
      for (let i = 0; i < numLines; i++) {
        const y = i * spacing;
        ctx.beginPath();
        ctx.moveTo(0, y);
        
        for (let x = 0; x < w; x += 5) {
          const wave1 = Math.sin(x * 0.02 + timeOffset + audio.freq * 5) * distortion * 0.5;
          const wave2 = Math.sin(x * 0.03 - audio.level * 3 + timeOffset) * distortion * 0.3;
          const yOffset = y + wave1 + wave2;
          ctx.lineTo(x, yOffset);
        }
        ctx.stroke();
      }
    }
    
    if (morph >= 0.67) {
      const numLines = Math.floor((w + h) / spacing);
      const timeOffset = Date.now() * 0.001 * speed;
      const angle1 = Math.PI / 4 + audio.freq * 0.5 + timeOffset * 0.5;
      const angle2 = -Math.PI / 4 + audio.level * 0.5 + timeOffset * 0.3;
      
      ctx.strokeStyle = `rgba(0, 0, 0, 0.4)`;
      ctx.lineWidth = thickness + audio.freq * 2;
      
      for (let i = 0; i < numLines; i++) {
        const offset = i * spacing;
        ctx.beginPath();
        ctx.moveTo(offset * Math.cos(angle1), offset * Math.sin(angle1));
        ctx.lineTo(w + offset * Math.cos(angle1), h + offset * Math.sin(angle1));
        ctx.stroke();
      }
      
      for (let i = 0; i < numLines; i++) {
        const offset = i * spacing;
        ctx.beginPath();
        ctx.moveTo(offset * Math.cos(angle2), h - offset * Math.sin(angle2));
        ctx.lineTo(w + offset * Math.cos(angle2), -offset * Math.sin(angle2));
        ctx.stroke();
      }
    }
  };

  const drawTrianglePatterns = (ctx, w, h, morph, audio) => {
    ctx.fillStyle = 'white';
    ctx.fillRect(0, 0, w, h);
    
    const spacing = settings.spacing;
    const distortion = settings.distortionStrength;
    const speed = settings.distortionSpeed;
    const thickness = settings.lineThickness;
    
    if (morph < 0.33) {
      const rows = Math.floor(h / spacing);
      const cols = Math.floor(w / spacing);
      const timeOffset = Date.now() * 0.001 * speed;
      const offset = audio.level * distortion;
      
      ctx.strokeStyle = `rgba(0, 0, 0, 0.6)`;
      ctx.lineWidth = thickness + audio.freq * 2;
      
      for (let i = 0; i < rows; i++) {
        for (let j = 0; j < cols; j++) {
          const x = j * spacing + offset + Math.sin(timeOffset + i * 0.1) * 10;
          const y = i * spacing;
          const cellW = spacing;
          const cellH = spacing;
          const flip = (i + j) % 2 === 0;
          
          ctx.beginPath();
          if (flip) {
            ctx.moveTo(x, y);
            ctx.lineTo(x + cellW, y);
            ctx.lineTo(x + cellW/2, y + cellH);
          } else {
            ctx.moveTo(x, y + cellH);
            ctx.lineTo(x + cellW, y + cellH);
            ctx.lineTo(x + cellW/2, y);
          }
          ctx.closePath();
          ctx.stroke();
        }
      }
    }
    
    if (morph >= 0.33 && morph < 0.67) {
      const gridSize = Math.floor(Math.min(w, h) / spacing);
      const size = spacing;
      const timeOffset = Date.now() * 0.001 * speed;
      const offset1 = audio.level * distortion + Math.sin(timeOffset) * 10;
      const offset2 = audio.freq * distortion + Math.cos(timeOffset) * 10;
      
      ctx.strokeStyle = `rgba(0, 0, 0, 0.5)`;
      ctx.lineWidth = thickness + audio.level * 2;
      
      for (let i = 0; i < gridSize; i++) {
        for (let j = 0; j < gridSize; j++) {
          const x = j * size + offset1;
          const y = i * size;
          
          ctx.beginPath();
          ctx.moveTo(x + size/2, y);
          ctx.lineTo(x + size, y + size);
          ctx.lineTo(x, y + size);
          ctx.closePath();
          ctx.stroke();
        }
      }
      
      for (let i = 0; i < gridSize; i++) {
        for (let j = 0; j < gridSize; j++) {
          const x = j * size;
          const y = i * size + offset2;
          
          ctx.beginPath();
          ctx.moveTo(x + size/2, y);
          ctx.lineTo(x + size, y + size);
          ctx.lineTo(x, y + size);
          ctx.closePath();
          ctx.stroke();
        }
      }
    }
    
    if (morph >= 0.67) {
      const gridSize = Math.floor(Math.max(w, h) / spacing);
      const timeOffset = Date.now() * 0.001 * speed;
      const rotation = audio.freq * Math.PI * 0.2 + timeOffset * 0.5;
      
      ctx.save();
      ctx.translate(w/2, h/2);
      ctx.rotate(rotation);
      ctx.translate(-w/2, -h/2);
      
      ctx.strokeStyle = `rgba(0, 0, 0, 0.4)`;
      ctx.lineWidth = thickness + audio.level * 2;
      
      for (let i = -gridSize; i < gridSize * 2; i++) {
        for (let j = -gridSize; j < gridSize * 2; j++) {
          const x = j * spacing;
          const y = i * spacing;
          const size = spacing * 0.9;
          
          ctx.beginPath();
          ctx.moveTo(x + size/2, y);
          ctx.lineTo(x + size, y + size);
          ctx.lineTo(x, y + size);
          ctx.closePath();
          ctx.stroke();
        }
      }
      
      ctx.restore();
    }
  };

  const drawSquarePatterns = (ctx, w, h, morph, audio) => {
    ctx.fillStyle = 'white';
    ctx.fillRect(0, 0, w, h);
    
    const spacing = settings.spacing;
    const distortion = settings.distortionStrength;
    const speed = settings.distortionSpeed;
    const thickness = settings.lineThickness;
    
    if (morph < 0.33) {
      const gridSize = Math.floor(Math.min(w, h) / spacing);
      const cellSize = spacing;
      const timeOffset = Date.now() * 0.001 * speed;
      const offset = audio.level * distortion + Math.sin(timeOffset) * 15;
      
      ctx.strokeStyle = `rgba(0, 0, 0, 0.5)`;
      ctx.lineWidth = thickness + audio.freq * 2;
      
      for (let i = 0; i < gridSize; i++) {
        for (let j = 0; j < gridSize; j++) {
          const x = i * cellSize + offset;
          const y = j * cellSize;
          ctx.strokeRect(x, y, cellSize * 0.8, cellSize * 0.8);
        }
      }
      
      for (let i = 0; i < gridSize; i++) {
        for (let j = 0; j < gridSize; j++) {
          const x = i * cellSize;
          const y = j * cellSize + offset * 1.2;
          ctx.strokeRect(x, y, cellSize * 0.8, cellSize * 0.8);
        }
      }
    }
    
    if (morph >= 0.33 && morph < 0.67) {
      const gridSize = Math.floor(Math.min(w, h) / spacing);
      const cellSize = spacing;
      const timeOffset = Date.now() * 0.001 * speed;
      const rotation = audio.freq * Math.PI * 0.15 + timeOffset * 0.3;
      
      ctx.save();
      ctx.translate(w/2, h/2);
      ctx.rotate(rotation);
      ctx.translate(-w/2, -h/2);
      
      ctx.strokeStyle = `rgba(0, 0, 0, 0.4)`;
      ctx.lineWidth = thickness + audio.level * 2;
      
      for (let i = -gridSize; i < gridSize * 2; i++) {
        for (let j = -gridSize; j < gridSize * 2; j++) {
          const x = i * cellSize;
          const y = j * cellSize;
          ctx.strokeRect(x, y, cellSize * 0.9, cellSize * 0.9);
        }
      }
      
      ctx.restore();
      
      ctx.strokeStyle = `rgba(0, 0, 0, 0.3)`;
      ctx.lineWidth = thickness + audio.level * 2;
      for (let i = 0; i < gridSize; i++) {
        for (let j = 0; j < gridSize; j++) {
          const x = i * cellSize;
          const y = j * cellSize;
          ctx.strokeRect(x, y, cellSize * 0.9, cellSize * 0.9);
        }
      }
    }
    
    if (morph >= 0.67) {
      const rows = Math.floor(h / spacing);
      const cols = Math.floor(w / spacing);
      const cellW = spacing;
      const cellH = spacing;
      const timeOffset = Date.now() * 0.001 * speed;
      
      ctx.strokeStyle = `rgba(0, 0, 0, 0.6)`;
      ctx.lineWidth = thickness + audio.freq * 2;
      
      for (let i = 0; i < rows; i++) {
        for (let j = 0; j < cols; j++) {
          const x = j * cellW;
          const y = i * cellH + Math.sin(j * 0.5 + timeOffset + audio.level * 5) * distortion * 0.5;
          const size = cellW * 0.7;
          
          ctx.strokeRect(x, y, size, size);
        }
      }
    }
  };

  const animate = () => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    
    const ctx = canvas.getContext('2d');
    const w = canvas.width;
    const h = canvas.height;
    
    const audio = getAudioData();
    setAudioLevel(audio.level);
    setFrequency(audio.freq);
    
    switch (selectedShape) {
      case 'dot':
        drawDotPatterns(ctx, w, h, morphValue, audio);
        break;
      case 'line':
        drawLinePatterns(ctx, w, h, morphValue, audio);
        break;
      case 'triangle':
        drawTrianglePatterns(ctx, w, h, morphValue, audio);
        break;
      case 'square':
        drawSquarePatterns(ctx, w, h, morphValue, audio);
        break;
    }
    
    if (settings.pixelationEnabled) {
      const imageData = ctx.getImageData(0, 0, w, h);
      const pixelSize = settings.pixelSize;
      
      for (let y = 0; y < h; y += pixelSize) {
        for (let x = 0; x < w; x += pixelSize) {
          const pixelIndex = (y * w + x) * 4;
          const r = imageData.data[pixelIndex];
          const g = imageData.data[pixelIndex + 1];
          const b = imageData.data[pixelIndex + 2];
          
          ctx.fillStyle = `rgb(${r}, ${g}, ${b})`;
          ctx.fillRect(x, y, pixelSize, pixelSize);
        }
      }
    }
    
    if (settings.showGrid) {
      const gridSpacing = Math.min(w, h) / settings.gridSize;
      ctx.strokeStyle = 'rgba(255, 0, 0, 0.3)';
      ctx.lineWidth = 1;
      
      for (let i = 0; i <= settings.gridSize; i++) {
        ctx.beginPath();
        ctx.moveTo(i * gridSpacing, 0);
        ctx.lineTo(i * gridSpacing, h);
        ctx.stroke();
        
        ctx.beginPath();
        ctx.moveTo(0, i * gridSpacing);
        ctx.lineTo(w, i * gridSpacing);
        ctx.stroke();
      }
    }
    
    animationRef.current = requestAnimationFrame(animate);
  };

  return (
    <div className="w-full h-screen bg-white overflow-hidden relative">
      <canvas
        ref={canvasRef}
        className="absolute inset-0"
      />
      
      <div className="absolute top-6 left-6 bg-white bg-opacity-95 backdrop-blur-xl rounded-2xl shadow-lg border border-gray-200 overflow-hidden z-10" style={{ width: '280px', maxHeight: '90vh', overflowY: 'auto' }}>
        <div className="p-6 space-y-6">
          <button
            onClick={isListening ? stopAudio : startAudio}
            className="w-full h-11 bg-black text-white rounded-full font-medium text-sm hover:bg-gray-800 transition-colors flex items-center justify-center gap-2"
          >
            {isListening ? '◼' : '▶'} {isListening ? 'Stop' : 'Start'}
          </button>
          
          <div className="space-y-3">
            <label className="text-xs font-semibold text-gray-500 uppercase tracking-wider">Shape</label>
            <div className="grid grid-cols-2 gap-2">
              {['dot', 'line', 'triangle', 'square'].map(shape => (
                <button
                  key={shape}
                  onClick={() => setSelectedShape(shape)}
                  className={`h-10 rounded-lg text-xs font-medium transition-all ${
                    selectedShape === shape 
                      ? 'bg-black text-white shadow-sm' 
                      : 'bg-gray-100 text-gray-700 hover:bg-gray-200'
                  }`}
                >
                  {shape}
                </button>
              ))}
            </div>
          </div>
          
          <div className="space-y-3">
            <div className="flex justify-between items-center">
              <label className="text-xs font-semibold text-gray-500 uppercase tracking-wider">Morph</label>
              <span className="text-xs text-gray-400 font-mono">
                {morphValue < 0.33 ? 'A' : morphValue < 0.67 ? 'B' : 'C'}
              </span>
            </div>
            <input
              type="range"
              min="0"
              max="1"
              step="0.01"
              value={morphValue}
              onChange={(e) => setMorphValue(parseFloat(e.target.value))}
              className="w-full h-1 bg-gray-200 rounded-full appearance-none cursor-pointer [&::-webkit-slider-thumb]:appearance-none [&::-webkit-slider-thumb]:w-4 [&::-webkit-slider-thumb]:h-4 [&::-webkit-slider-thumb]:rounded-full [&::-webkit-slider-thumb]:bg-black"
            />
          </div>

          <div className="space-y-3 pt-4 border-t border-gray-200">
            <label className="text-xs font-semibold text-gray-500 uppercase tracking-wider">Pattern Controls</label>
            
            <div>
              <div className="flex justify-between items-center mb-2">
                <span className="text-xs text-gray-600">Thickness</span>
                <span className="text-xs text-gray-900 font-mono">{settings.lineThickness}</span>
              </div>
              <input
                type="range"
                min="1"
                max="10"
                value={settings.lineThickness}
                onChange={(e) => setSettings(prev => ({...prev, lineThickness: parseInt(e.target.value)}))}
                className="w-full h-1 bg-gray-200 rounded-full appearance-none cursor-pointer [&::-webkit-slider-thumb]:appearance-none [&::-webkit-slider-thumb]:w-4 [&::-webkit-slider-thumb]:h-4 [&::-webkit-slider-thumb]:rounded-full [&::-webkit-slider-thumb]:bg-black"
              />
            </div>

            <div>
              <div className="flex justify-between items-center mb-2">
                <span className="text-xs text-gray-600">Spacing</span>
                <span className="text-xs text-gray-900 font-mono">{settings.spacing}</span>
              </div>
              <input
                type="range"
                min="10"
                max="80"
                value={settings.spacing}
                onChange={(e) => setSettings(prev => ({...prev, spacing: parseInt(e.target.value)}))}
                className="w-full h-1 bg-gray-200 rounded-full appearance-none cursor-pointer [&::-webkit-slider-thumb]:appearance-none [&::-webkit-slider-thumb]:w-4 [&::-webkit-slider-thumb]:h-4 [&::-webkit-slider-thumb]:rounded-full [&::-webkit-slider-thumb]:bg-black"
              />
            </div>

            <div>
              <div className="flex justify-between items-center mb-2">
                <span className="text-xs text-gray-600">Layer Count</span>
                <span className="text-xs text-gray-900 font-mono">{settings.layerCount}</span>
              </div>
              <input
                type="range"
                min="1"
                max="6"
                value={settings.layerCount}
                onChange={(e) => setSettings(prev => ({...prev, layerCount: parseInt(e.target.value)}))}
                className="w-full h-1 bg-gray-200 rounded-full appearance-none cursor-pointer [&::-webkit-slider-thumb]:appearance-none [&::-webkit-slider-thumb]:w-4 [&::-webkit-slider-thumb]:h-4 [&::-webkit-slider-thumb]:rounded-full [&::-webkit-slider-thumb]:bg-black"
              />
            </div>

            <div>
              <div className="flex justify-between items-center mb-2">
                <span className="text-xs text-gray-600">Distortion</span>
                <span className="text-xs text-gray-900 font-mono">{settings.distortionStrength}</span>
              </div>
              <input
                type="range"
                min="0"
                max="100"
                value={settings.distortionStrength}
                onChange={(e) => setSettings(prev => ({...prev, distortionStrength: parseInt(e.target.value)}))}
                className="w-full h-1 bg-gray-200 rounded-full appearance-none cursor-pointer [&::-webkit-slider-thumb]:appearance-none [&::-webkit-slider-thumb]:w-4 [&::-webkit-slider-thumb]:h-4 [&::-webkit-slider-thumb]:rounded-full [&::-webkit-slider-thumb]:bg-black"
              />
            </div>

            <div>
              <div className="flex justify-between items-center mb-2">
                <span className="text-xs text-gray-600">Speed</span>
                <span className="text-xs text-gray-900 font-mono">{settings.distortionSpeed}</span>
              </div>
              <input
                type="range"
                min="0.1"
                max="10"
                step="0.1"
                value={settings.distortionSpeed}
                onChange={(e) => setSettings(prev => ({...prev, distortionSpeed: parseFloat(e.target.value)}))}
                className="w-full h-1 bg-gray-200 rounded-full appearance-none cursor-pointer [&::-webkit-slider-thumb]:appearance-none [&::-webkit-slider-thumb]:w-4 [&::-webkit-slider-thumb]:h-4 [&::-webkit-slider-thumb]:rounded-full [&::-webkit-slider-thumb]:bg-black"
              />
            </div>
          </div>

          <div className="space-y-3 pt-4 border-t border-gray-200">
            <label className="text-xs font-semibold text-gray-500 uppercase tracking-wider">Effects</label>
            
            <label className="flex items-center justify-between">
              <span className="text-xs text-gray-600">Grid</span>
              <input
                type="checkbox"
                checked={settings.showGrid}
                onChange={(e) => setSettings(prev => ({...prev, showGrid: e.target.checked}))}
                className="w-4 h-4 rounded"
              />
            </label>

            {settings.showGrid && (
              <div>
                <div className="flex justify-between items-center mb-2">
                  <span className="text-xs text-gray-600">Grid Size</span>
                  <span className="text-xs text-gray-900 font-mono">{settings.gridSize}</span>
                </div>
                <input
                  type="range"
                  min="10"
                  max="50"
                  value={settings.gridSize}
                  onChange={(e) => setSettings(prev => ({...prev, gridSize: parseInt(e.target.value)}))}
                  className="w-full h-1 bg-gray-200 rounded-full appearance-none cursor-pointer [&::-webkit-slider-thumb]:appearance-none [&::-webkit-slider-thumb]:w-4 [&::-webkit-slider-thumb]:h-4 [&::-webkit-slider-thumb]:rounded-full [&::-webkit-slider-thumb]:bg-black"
                />
              </div>
            )}

            <label className="flex items-center justify-between">
              <span className="text-xs text-gray-600">Pixelation</span>
              <input
                type="checkbox"
                checked={settings.pixelationEnabled}
                onChange={(e) => setSettings(prev => ({...prev, pixelationEnabled: e.target.checked}))}
                className="w-4 h-4 rounded"
              />
            </label>

            {settings.pixelationEnabled && (
              <div>
                <div className="flex justify-between items-center mb-2">
                  <span className="text-xs text-gray-600">Pixel Size</span>
                  <span className="text-xs text-gray-900 font-mono">{settings.pixelSize}</span>
                </div>
                <input
                  type="range"
                  min="2"
                  max="20"
                  value={settings.pixelSize}
                  onChange={(e) => setSettings(prev => ({...prev, pixelSize: parseInt(e.target.value)}))}
                  className="w-full h-1 bg-gray-200 rounded-full appearance-none cursor-pointer [&::-webkit-slider-thumb]:appearance-none [&::-webkit-slider-thumb]:w-4 [&::-webkit-slider-thumb]:h-4 [&::-webkit-slider-thumb]:rounded-full [&::-webkit-slider-thumb]:bg-black"
                />
              </div>
            )}
          </div>
          
          <div className="pt-4 border-t border-gray-200 space-y-2">
            <div className="flex justify-between text-xs">
              <span className="text-gray-500 font-medium">Level</span>
              <span className="text-gray-900 font-mono">{(audioLevel * 100).toFixed(0)}%</span>
            </div>
            <div className="flex justify-between text-xs">
              <span className="text-gray-500 font-medium">Freq</span>
              <span className="text-gray-900 font-mono">{(frequency * 100).toFixed(0)}%</span>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
};

export default AudioPatternMorpher;
