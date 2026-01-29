import React, { useState, useEffect, useRef } from 'react';

const AudioPatternGenerator = () => {
  const [isListening, setIsListening] = useState(false);
  const [selectedShape, setSelectedShape] = useState('line');
  const [audioLevel, setAudioLevel] = useState(0);
  const [frequency, setFrequency] = useState(0);
  const [settings, setSettings] = useState({
    patternType: 'grid', // grid, radial, scatter
    lineThickness: 2,
    spacing: 30,
    repetition: 20,
    rotation: 0,
    distortionStrength: 30,
    distortionSpeed: 1,
    patternColor: '#000000',
    audioReactiveRepetition: true,
    audioReactiveRotation: false,
    showGrid: false,
    gridSize: 20
  });
  
  const canvasRef = useRef(null);
  const audioContextRef = useRef(null);
  const analyserRef = useRef(null);
  const animationRef = useRef(null);
  const dataArrayRef = useRef(null);

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
    } catch (err) {
      console.error('Audio error:', err);
    }
  };

  const stopAudio = () => {
    if (audioContextRef.current) audioContextRef.current.close();
    if (animationRef.current) cancelAnimationFrame(animationRef.current);
    setIsListening(false);
  };

  const getAudioData = () => {
    if (!analyserRef.current || !dataArrayRef.current) return { level: 0, freq: 0 };
    analyserRef.current.getByteFrequencyData(dataArrayRef.current);
    const avg = dataArrayRef.current.reduce((a, b) => a + b) / dataArrayRef.current.length;
    const lowFreq = dataArrayRef.current.slice(0, 64).reduce((a, b) => a + b) / 64;
    return { level: avg / 255, freq: lowFreq / 255 };
  };

  const drawPattern = (ctx, w, h, audio) => {
    ctx.fillStyle = 'white';
    ctx.fillRect(0, 0, w, h);
    
    const color = settings.patternColor;
    const thickness = settings.lineThickness;
    const spacing = settings.spacing;
    const baseRep = settings.repetition;
    const repetition = settings.audioReactiveRepetition 
      ? Math.floor(baseRep * (1 + audio.level * 2))
      : baseRep;
    const rotation = settings.audioReactiveRotation
      ? settings.rotation + audio.freq * Math.PI
      : settings.rotation * (Math.PI / 180);
    const timeOffset = Date.now() * 0.001 * settings.distortionSpeed;
    const distortion = settings.distortionStrength;

    ctx.save();
    ctx.translate(w / 2, h / 2);
    ctx.rotate(rotation);
    ctx.translate(-w / 2, -h / 2);

    if (settings.patternType === 'grid') {
      if (selectedShape === 'dot') {
        ctx.fillStyle = color;
        for (let i = 0; i < repetition; i++) {
          for (let j = 0; j < repetition; j++) {
            const x = (i - repetition/2) * spacing + w/2;
            const y = (j - repetition/2) * spacing + h/2;
            const offset = Math.sin(timeOffset + i * 0.1) * distortion * audio.level;
            const size = thickness + audio.freq * 5;
            ctx.beginPath();
            ctx.arc(x + offset, y + offset, size, 0, Math.PI * 2);
            ctx.fill();
          }
        }
      } else if (selectedShape === 'line') {
        ctx.strokeStyle = color;
        ctx.lineWidth = thickness;
        for (let i = 0; i < repetition; i++) {
          const y = (i - repetition/2) * spacing + h/2;
          const offset = Math.sin(timeOffset + i * 0.2) * distortion * audio.level;
          ctx.beginPath();
          ctx.moveTo(0, y + offset);
          ctx.lineTo(w, y + offset);
          ctx.stroke();
        }
        for (let i = 0; i < repetition; i++) {
          const x = (i - repetition/2) * spacing + w/2;
          const offset = Math.cos(timeOffset + i * 0.2) * distortion * audio.level;
          ctx.beginPath();
          ctx.moveTo(x + offset, 0);
          ctx.lineTo(x + offset, h);
          ctx.stroke();
        }
      } else if (selectedShape === 'triangle') {
        ctx.strokeStyle = color;
        ctx.lineWidth = thickness;
        for (let i = 0; i < repetition; i++) {
          for (let j = 0; j < repetition; j++) {
            const x = (i - repetition/2) * spacing + w/2;
            const y = (j - repetition/2) * spacing + h/2;
            const s = spacing * 0.6;
            ctx.beginPath();
            ctx.moveTo(x, y - s/2);
            ctx.lineTo(x + s/2, y + s/2);
            ctx.lineTo(x - s/2, y + s/2);
            ctx.closePath();
            ctx.stroke();
          }
        }
      } else if (selectedShape === 'square') {
        ctx.strokeStyle = color;
        ctx.lineWidth = thickness;
        for (let i = 0; i < repetition; i++) {
          for (let j = 0; j < repetition; j++) {
            const x = (i - repetition/2) * spacing + w/2;
            const y = (j - repetition/2) * spacing + h/2;
            const s = spacing * 0.6;
            ctx.strokeRect(x - s/2, y - s/2, s, s);
          }
        }
      }
    } else if (settings.patternType === 'radial') {
      const centerX = w / 2;
      const centerY = h / 2;
      const angleStep = (Math.PI * 2) / repetition;
      
      if (selectedShape === 'dot') {
        ctx.fillStyle = color;
        for (let ring = 1; ring <= 10; ring++) {
          const radius = ring * spacing;
          for (let i = 0; i < repetition; i++) {
            const angle = i * angleStep + timeOffset;
            const x = centerX + radius * Math.cos(angle);
            const y = centerY + radius * Math.sin(angle);
            const size = thickness + audio.freq * 5;
            ctx.beginPath();
            ctx.arc(x, y, size, 0, Math.PI * 2);
            ctx.fill();
          }
        }
      } else if (selectedShape === 'line') {
        ctx.strokeStyle = color;
        ctx.lineWidth = thickness;
        for (let i = 0; i < repetition; i++) {
          const angle = i * angleStep;
          const length = Math.min(w, h) * 0.4 * (1 + audio.level * 0.3);
          ctx.beginPath();
          ctx.moveTo(centerX, centerY);
          ctx.lineTo(centerX + length * Math.cos(angle), centerY + length * Math.sin(angle));
          ctx.stroke();
        }
      } else if (selectedShape === 'triangle') {
        ctx.strokeStyle = color;
        ctx.lineWidth = thickness;
        for (let i = 0; i < repetition; i++) {
          const angle = i * angleStep;
          const radius = spacing * 3;
          const x = centerX + radius * Math.cos(angle);
          const y = centerY + radius * Math.sin(angle);
          const s = spacing * 0.5;
          ctx.save();
          ctx.translate(x, y);
          ctx.rotate(angle);
          ctx.beginPath();
          ctx.moveTo(0, -s/2);
          ctx.lineTo(s/2, s/2);
          ctx.lineTo(-s/2, s/2);
          ctx.closePath();
          ctx.stroke();
          ctx.restore();
        }
      } else if (selectedShape === 'square') {
        ctx.strokeStyle = color;
        ctx.lineWidth = thickness;
        for (let i = 0; i < repetition; i++) {
          const angle = i * angleStep;
          const radius = spacing * 3;
          const x = centerX + radius * Math.cos(angle);
          const y = centerY + radius * Math.sin(angle);
          const s = spacing * 0.5;
          ctx.save();
          ctx.translate(x, y);
          ctx.rotate(angle);
          ctx.strokeRect(-s/2, -s/2, s, s);
          ctx.restore();
        }
      }
    } else if (settings.patternType === 'scatter') {
      if (selectedShape === 'dot') {
        ctx.fillStyle = color;
        for (let i = 0; i < repetition * 5; i++) {
          const angle = (i / repetition) * Math.PI * 2;
          const radius = (i % 10) * spacing;
          const x = w/2 + radius * Math.cos(angle) + Math.sin(timeOffset + i) * distortion;
          const y = h/2 + radius * Math.sin(angle) + Math.cos(timeOffset + i) * distortion;
          const size = thickness + audio.freq * 5;
          ctx.beginPath();
          ctx.arc(x, y, size, 0, Math.PI * 2);
          ctx.fill();
        }
      } else if (selectedShape === 'line') {
        ctx.strokeStyle = color;
        ctx.lineWidth = thickness;
        for (let i = 0; i < repetition; i++) {
          const angle = (i / repetition) * Math.PI * 2;
          const x1 = w/2 + Math.cos(angle) * 100;
          const y1 = h/2 + Math.sin(angle) * 100;
          const x2 = w/2 + Math.cos(angle + timeOffset) * 300;
          const y2 = h/2 + Math.sin(angle + timeOffset) * 300;
          ctx.beginPath();
          ctx.moveTo(x1, y1);
          ctx.lineTo(x2, y2);
          ctx.stroke();
        }
      }
    }

    ctx.restore();

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
    drawPattern(ctx, w, h, audio);
    animationRef.current = requestAnimationFrame(animate);
  };

  useEffect(() => {
    if (isListening) {
      const loop = () => {
        animate();
        animationRef.current = requestAnimationFrame(loop);
      };
      loop();
    } else {
      if (animationRef.current) cancelAnimationFrame(animationRef.current);
    }
    return () => {
      if (animationRef.current) cancelAnimationFrame(animationRef.current);
    };
  }, [isListening, selectedShape, settings]);

  return (
    <div className="w-full h-screen bg-white overflow-hidden relative">
      <canvas ref={canvasRef} className="absolute inset-0" />
      
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
            <label className="text-xs font-semibold text-gray-500 uppercase tracking-wider">Pattern</label>
            <div className="grid grid-cols-3 gap-2">
              {['grid', 'radial', 'scatter'].map(type => (
                <button
                  key={type}
                  onClick={() => setSettings(prev => ({...prev, patternType: type}))}
                  className={`h-10 rounded-lg text-xs font-medium transition-all ${
                    settings.patternType === type 
                      ? 'bg-black text-white shadow-sm' 
                      : 'bg-gray-100 text-gray-700 hover:bg-gray-200'
                  }`}
                >
                  {type}
                </button>
              ))}
            </div>
          </div>
          
          <div className="space-y-3 pt-4 border-t border-gray-200">
            <label className="text-xs font-semibold text-gray-500 uppercase tracking-wider">Controls</label>
            
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
                max="100"
                value={settings.spacing}
                onChange={(e) => setSettings(prev => ({...prev, spacing: parseInt(e.target.value)}))}
                className="w-full h-1 bg-gray-200 rounded-full appearance-none cursor-pointer [&::-webkit-slider-thumb]:appearance-none [&::-webkit-slider-thumb]:w-4 [&::-webkit-slider-thumb]:h-4 [&::-webkit-slider-thumb]:rounded-full [&::-webkit-slider-thumb]:bg-black"
              />
            </div>

            <div>
              <div className="flex justify-between items-center mb-2">
                <span className="text-xs text-gray-600">Repetition</span>
                <span className="text-xs text-gray-900 font-mono">{settings.repetition}</span>
              </div>
              <input
                type="range"
                min="5"
                max="50"
                value={settings.repetition}
                onChange={(e) => setSettings(prev => ({...prev, repetition: parseInt(e.target.value)}))}
                className="w-full h-1 bg-gray-200 rounded-full appearance-none cursor-pointer [&::-webkit-slider-thumb]:appearance-none [&::-webkit-slider-thumb]:w-4 [&::-webkit-slider-thumb]:h-4 [&::-webkit-slider-thumb]:rounded-full [&::-webkit-slider-thumb]:bg-black"
              />
            </div>

            <div>
              <div className="flex justify-between items-center mb-2">
                <span className="text-xs text-gray-600">Rotation</span>
                <span className="text-xs text-gray-900 font-mono">{settings.rotation}°</span>
              </div>
              <input
                type="range"
                min="0"
                max="360"
                value={settings.rotation}
                onChange={(e) => setSettings(prev => ({...prev, rotation: parseInt(e.target.value)}))}
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
            <label className="text-xs font-semibold text-gray-500 uppercase tracking-wider">Audio Reactivity</label>
            
            <label className="flex items-center justify-between">
              <span className="text-xs text-gray-600">Repetition</span>
              <input
                type="checkbox"
                checked={settings.audioReactiveRepetition}
                onChange={(e) => setSettings(prev => ({...prev, audioReactiveRepetition: e.target.checked}))}
                className="w-4 h-4 rounded"
              />
            </label>

            <label className="flex items-center justify-between">
              <span className="text-xs text-gray-600">Rotation</span>
              <input
                type="checkbox"
                checked={settings.audioReactiveRotation}
                onChange={(e) => setSettings(prev => ({...prev, audioReactiveRotation: e.target.checked}))}
                className="w-4 h-4 rounded"
              />
            </label>
          </div>

          <div className="space-y-3 pt-4 border-t border-gray-200">
            <label className="text-xs font-semibold text-gray-500 uppercase tracking-wider">Appearance</label>
            
            <div>
              <div className="flex justify-between items-center mb-2">
                <span className="text-xs text-gray-600">Pattern Color</span>
              </div>
              <input
                type="color"
                value={settings.patternColor}
                onChange={(e) => setSettings(prev => ({...prev, patternColor: e.target.value}))}
                className="w-full h-10 rounded-lg cursor-pointer"
              />
            </div>

            <label className="flex items-center justify-between">
              <span className="text-xs text-gray-600">Grid</span>
              <input
                type="checkbox"
                checked={settings.showGrid}
                onChange={(e) => setSettings(prev => ({...prev, showGrid: e.target.checked}))}
                className="w-4 h-4 rounded"
              />
            </label>
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

export default AudioPatternGenerator;
