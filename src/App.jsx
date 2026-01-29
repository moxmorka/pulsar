import React, { useState, useEffect, useRef } from 'react';

const AudioPatternMorpher = () => {
  const [isListening, setIsListening] = useState(false);
  const [selectedShape, setSelectedShape] = useState('dot');
  const [morphValue, setMorphValue] = useState(0);
  const [audioLevel, setAudioLevel] = useState(0);
  const [frequency, setFrequency] = useState(0);
  
  const canvasRef = useRef(null);
  const audioContextRef = useRef(null);
  const analyserRef = useRef(null);
  const animationRef = useRef(null);
  const dataArrayRef = useRef(null);

  const PHI = 1.618033988749895; // Golden ratio
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
    ctx.clearRect(0, 0, w, h);
    
    // Pattern 0: Golden spiral
    if (morph < 0.33) {
      const t = morph / 0.33;
      const numDots = 200;
      const angle = PHI * Math.PI * 2;
      
      for (let i = 0; i < numDots; i++) {
        const theta = i * angle;
        const radius = Math.sqrt(i) * 15 * (1 + audio.level * 0.5);
        const x = w / 2 + radius * Math.cos(theta);
        const y = h / 2 + radius * Math.sin(theta);
        const size = (3 + audio.freq * 10) * (1 - t * 0.5);
        
        ctx.fillStyle = `hsla(${(i * 5 + audio.level * 360) % 360}, 70%, 60%, ${0.8 - t * 0.3})`;
        ctx.beginPath();
        ctx.arc(x, y, size, 0, Math.PI * 2);
        ctx.fill();
      }
    }
    
    // Pattern 1: Fibonacci grid
    if (morph >= 0.33 && morph < 0.67) {
      const t = (morph - 0.33) / 0.34;
      const gridSize = 12;
      
      for (let i = 0; i < gridSize; i++) {
        for (let j = 0; j < gridSize; j++) {
          const fibX = FIBONACCI[i % FIBONACCI.length];
          const fibY = FIBONACCI[j % FIBONACCI.length];
          const x = (w / gridSize) * i + fibX * 2;
          const y = (h / gridSize) * j + fibY * 2;
          const size = (fibX + fibY) * 0.3 * (1 + audio.level);
          const pulse = Math.sin(Date.now() * 0.001 * audio.freq * 10 + i + j) * 0.5 + 0.5;
          
          ctx.fillStyle = `hsla(${(i * j * 10 + audio.freq * 180) % 360}, 60%, 50%, ${0.7 * pulse})`;
          ctx.beginPath();
          ctx.arc(x, y, size * (1 + t * 0.5), 0, Math.PI * 2);
          ctx.fill();
        }
      }
    }
    
    // Pattern 2: Voronoi-inspired cellular
    if (morph >= 0.67) {
      const t = (morph - 0.67) / 0.33;
      const numCells = 50;
      const points = [];
      
      for (let i = 0; i < numCells; i++) {
        const angle = (i / numCells) * Math.PI * 2 * PHI;
        const radius = (i / numCells) * Math.min(w, h) * 0.4;
        points.push({
          x: w / 2 + radius * Math.cos(angle) * (1 + audio.level * 0.3),
          y: h / 2 + radius * Math.sin(angle) * (1 + audio.level * 0.3)
        });
      }
      
      for (let x = 0; x < w; x += 8) {
        for (let y = 0; y < h; y += 8) {
          let minDist = Infinity;
          let closestIdx = 0;
          
          points.forEach((p, idx) => {
            const dist = Math.hypot(x - p.x, y - p.y);
            if (dist < minDist) {
              minDist = dist;
              closestIdx = idx;
            }
          });
          
          const hue = (closestIdx * 30 + audio.freq * 180) % 360;
          const brightness = 30 + minDist * 0.1;
          ctx.fillStyle = `hsla(${hue}, 70%, ${brightness}%, ${0.6 + t * 0.2})`;
          ctx.fillRect(x, y, 8, 8);
        }
      }
    }
  };

  const drawLinePatterns = (ctx, w, h, morph, audio) => {
    ctx.clearRect(0, 0, w, h);
    
    // Pattern 0: Moiré interference
    if (morph < 0.33) {
      const t = morph / 0.33;
      const numLines = 80;
      
      for (let i = 0; i < numLines; i++) {
        const angle1 = (i / numLines) * Math.PI + audio.level * 0.5;
        const angle2 = angle1 + Math.PI / 3 + audio.freq * 0.3;
        const offset = i * (w / numLines);
        
        ctx.strokeStyle = `hsla(200, 70%, 60%, ${0.3 - t * 0.1})`;
        ctx.lineWidth = 1 + audio.level * 2;
        
        ctx.beginPath();
        ctx.moveTo(0, offset);
        ctx.lineTo(w, offset + Math.sin(angle1) * 100);
        ctx.stroke();
        
        ctx.strokeStyle = `hsla(340, 70%, 60%, ${0.3 - t * 0.1})`;
        ctx.beginPath();
        ctx.moveTo(offset, 0);
        ctx.lineTo(offset + Math.sin(angle2) * 100, h);
        ctx.stroke();
      }
    }
    
    // Pattern 1: Fibonacci spiral lines
    if (morph >= 0.33 && morph < 0.67) {
      const t = (morph - 0.33) / 0.34;
      const numSpirals = 8;
      
      for (let s = 0; s < numSpirals; s++) {
        const hue = (s * 45 + audio.level * 120) % 360;
        ctx.strokeStyle = `hsla(${hue}, 70%, 60%, ${0.5 + t * 0.3})`;
        ctx.lineWidth = 2 + audio.freq * 4;
        
        ctx.beginPath();
        for (let i = 0; i < 100; i++) {
          const fibIdx = i % FIBONACCI.length;
          const angle = i * 0.1 * PHI + s * 0.5;
          const radius = FIBONACCI[fibIdx] * 3 * (1 + audio.level * 0.5);
          const x = w / 2 + radius * Math.cos(angle);
          const y = h / 2 + radius * Math.sin(angle);
          
          if (i === 0) ctx.moveTo(x, y);
          else ctx.lineTo(x, y);
        }
        ctx.stroke();
      }
    }
    
    // Pattern 2: Radial golden angle
    if (morph >= 0.67) {
      const t = (morph - 0.67) / 0.33;
      const numLines = 144;
      const goldenAngle = Math.PI * (3 - Math.sqrt(5));
      
      for (let i = 0; i < numLines; i++) {
        const angle = i * goldenAngle;
        const length = (i / numLines) * Math.min(w, h) * 0.5 * (1 + audio.level);
        const x1 = w / 2;
        const y1 = h / 2;
        const x2 = x1 + length * Math.cos(angle);
        const y2 = y1 + length * Math.sin(angle);
        
        ctx.strokeStyle = `hsla(${(i * 3 + audio.freq * 180) % 360}, 70%, 60%, ${0.4 + t * 0.3})`;
        ctx.lineWidth = 1 + audio.level * 3;
        ctx.beginPath();
        ctx.moveTo(x1, y1);
        ctx.lineTo(x2, y2);
        ctx.stroke();
      }
    }
  };

  const drawTrianglePatterns = (ctx, w, h, morph, audio) => {
    ctx.clearRect(0, 0, w, h);
    
    // Pattern 0: Sierpinski-inspired
    if (morph < 0.33) {
      const t = morph / 0.33;
      const drawTriangle = (x, y, size, depth) => {
        if (depth === 0 || size < 5) {
          ctx.fillStyle = `hsla(${(depth * 60 + audio.level * 180) % 360}, 70%, 60%, ${0.6 - t * 0.2})`;
          ctx.beginPath();
          ctx.moveTo(x, y);
          ctx.lineTo(x + size, y);
          ctx.lineTo(x + size / 2, y - size * 0.866);
          ctx.closePath();
          ctx.fill();
          return;
        }
        
        const newSize = size / 2 * (1 + audio.freq * 0.2);
        drawTriangle(x, y, newSize, depth - 1);
        drawTriangle(x + newSize, y, newSize, depth - 1);
        drawTriangle(x + newSize / 2, y - newSize * 0.866, newSize, depth - 1);
      };
      
      drawTriangle(w / 4, h * 0.75, w / 2, 5);
    }
    
    // Pattern 1: Golden triangle tessellation
    if (morph >= 0.33 && morph < 0.67) {
      const t = (morph - 0.33) / 0.34;
      const rows = 10;
      const cols = 12;
      
      for (let i = 0; i < rows; i++) {
        for (let j = 0; j < cols; j++) {
          const x = (w / cols) * j;
          const y = (h / rows) * i;
          const size = (w / cols) * (1 + audio.level * 0.3);
          const rotation = (i * j) * 0.1 + audio.freq * Math.PI;
          
          ctx.save();
          ctx.translate(x + size / 2, y + size / 2);
          ctx.rotate(rotation);
          
          ctx.fillStyle = `hsla(${((i + j) * 30 + audio.level * 180) % 360}, 70%, 60%, ${0.5 + t * 0.3})`;
          ctx.beginPath();
          ctx.moveTo(0, -size / 2 / PHI);
          ctx.lineTo(size / 2, size / 2 / PHI);
          ctx.lineTo(-size / 2, size / 2 / PHI);
          ctx.closePath();
          ctx.fill();
          
          ctx.restore();
        }
      }
    }
    
    // Pattern 2: Concentric triangular waves
    if (morph >= 0.67) {
      const t = (morph - 0.67) / 0.33;
      const numRings = 20;
      
      for (let i = 0; i < numRings; i++) {
        const radius = (i + 1) * 30 * (1 + audio.level * 0.5);
        const rotation = i * 0.3 + Date.now() * 0.001 * audio.freq;
        const sides = 3;
        
        ctx.strokeStyle = `hsla(${(i * 18 + audio.freq * 180) % 360}, 70%, 60%, ${0.6 + t * 0.2})`;
        ctx.lineWidth = 2 + audio.level * 3;
        ctx.beginPath();
        
        for (let j = 0; j <= sides; j++) {
          const angle = (j / sides) * Math.PI * 2 + rotation;
          const x = w / 2 + radius * Math.cos(angle);
          const y = h / 2 + radius * Math.sin(angle);
          if (j === 0) ctx.moveTo(x, y);
          else ctx.lineTo(x, y);
        }
        ctx.stroke();
      }
    }
  };

  const drawSquarePatterns = (ctx, w, h, morph, audio) => {
    ctx.clearRect(0, 0, w, h);
    
    // Pattern 0: Checkerboard moiré
    if (morph < 0.33) {
      const t = morph / 0.33;
      const gridSize = 20;
      const cellSize = Math.min(w, h) / gridSize;
      
      for (let i = 0; i < gridSize; i++) {
        for (let j = 0; j < gridSize; j++) {
          const x = i * cellSize + Math.sin(j * 0.5 + audio.freq * 5) * 10;
          const y = j * cellSize + Math.cos(i * 0.5 + audio.level * 5) * 10;
          
          const hue = ((i + j) * 20 + audio.level * 180) % 360;
          ctx.fillStyle = `hsla(${hue}, 70%, 60%, ${0.5 - t * 0.2})`;
          ctx.fillRect(x, y, cellSize * 0.9, cellSize * 0.9);
        }
      }
    }
    
    // Pattern 1: Fibonacci square spiral
    if (morph >= 0.33 && morph < 0.67) {
      const t = (morph - 0.33) / 0.34;
      let x = w / 2;
      let y = h / 2;
      let direction = 0;
      
      for (let i = 0; i < FIBONACCI.length; i++) {
        const size = FIBONACCI[i] * 8 * (1 + audio.level * 0.3);
        const hue = (i * 30 + audio.freq * 180) % 360;
        
        ctx.strokeStyle = `hsla(${hue}, 70%, 60%, ${0.6 + t * 0.3})`;
        ctx.lineWidth = 3 + audio.level * 4;
        ctx.strokeRect(x, y, size, size);
        
        // Move to next position in spiral
        if (direction === 0) x += size;
        else if (direction === 1) y += size;
        else if (direction === 2) x -= size;
        else y -= size;
        
        direction = (direction + 1) % 4;
      }
    }
    
    // Pattern 2: Nested golden rectangles
    if (morph >= 0.67) {
      const t = (morph - 0.67) / 0.33;
      const maxSize = Math.min(w, h) * 0.8;
      let size = maxSize;
      
      for (let i = 0; i < 20; i++) {
        const rotation = i * 0.15 + audio.freq * Math.PI;
        const scale = 1 + audio.level * 0.2;
        
        ctx.save();
        ctx.translate(w / 2, h / 2);
        ctx.rotate(rotation);
        
        const rectW = size * scale;
        const rectH = size / PHI * scale;
        
        ctx.strokeStyle = `hsla(${(i * 18 + audio.level * 180) % 360}, 70%, 60%, ${0.5 + t * 0.3})`;
        ctx.lineWidth = 2 + audio.level * 3;
        ctx.strokeRect(-rectW / 2, -rectH / 2, rectW, rectH);
        
        ctx.restore();
        
        size *= 0.85;
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
    
    animationRef.current = requestAnimationFrame(animate);
  };

  return (
    <div className="w-full h-screen bg-black overflow-hidden relative">
      <canvas
        ref={canvasRef}
        className="absolute inset-0"
      />
      
      <div className="absolute top-4 left-4 bg-black bg-opacity-80 p-4 rounded-lg text-white space-y-4 z-10">
        <button
          onClick={isListening ? stopAudio : startAudio}
          className="w-full px-4 py-2 bg-white text-black rounded hover:bg-gray-200"
        >
          {isListening ? 'Stop' : 'Start Audio'}
        </button>
        
        <div className="space-y-2">
          <label className="text-xs">Shape</label>
          <div className="grid grid-cols-2 gap-2">
            {['dot', 'line', 'triangle', 'square'].map(shape => (
              <button
                key={shape}
                onClick={() => setSelectedShape(shape)}
                className={`px-3 py-1 rounded text-xs ${
                  selectedShape === shape 
                    ? 'bg-white text-black' 
                    : 'bg-gray-800 text-white hover:bg-gray-700'
                }`}
              >
                {shape}
              </button>
            ))}
          </div>
        </div>
        
        <div className="space-y-2">
          <label className="text-xs">Pattern Morph</label>
          <input
            type="range"
            min="0"
            max="1"
            step="0.01"
            value={morphValue}
            onChange={(e) => setMorphValue(parseFloat(e.target.value))}
            className="w-full"
          />
          <div className="text-xs text-gray-400">
            {morphValue < 0.33 ? 'Pattern A' : morphValue < 0.67 ? 'Pattern B' : 'Pattern C'}
          </div>
        </div>
        
        <div className="text-xs space-y-1">
          <div>Audio: {(audioLevel * 100).toFixed(0)}%</div>
          <div>Freq: {(frequency * 100).toFixed(0)}%</div>
        </div>
      </div>
    </div>
  );
};

export default AudioPatternMorpher;
