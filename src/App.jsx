import React, { useState, useEffect, useRef } from 'react';
import { Play, Pause, Download, Mic, MicOff } from 'lucide-react';

const AudioVisualSynthesizer = () => {
  const canvasRef = useRef(null);
  const animationRef = useRef(null);
  const [isAnimating, setIsAnimating] = useState(true);
  
  // Audio system
  const [audioEnabled, setAudioEnabled] = useState(false);
  const [audioDevices, setAudioDevices] = useState([]);
  const [selectedAudioDevice, setSelectedAudioDevice] = useState(null);
  const audioContextRef = useRef(null);
  const analyserRef = useRef(null);
  const audioFrameRef = useRef(null);
  
  // Audio data with temporal smoothing
  const audioDataRef = useRef({
    bass: 0,
    mid: 0,
    high: 0,
    overall: 0,
    bassSmooth: 0,
    midSmooth: 0,
    highSmooth: 0,
    overallSmooth: 0,
    bassHistory: new Array(30).fill(0),
    midHistory: new Array(30).fill(0),
    highHistory: new Array(30).fill(0)
  });
  
  const [settings, setSettings] = useState({
    style: 'waves', // 'waves', 'munari', 'minimal', 'orbital'
    colorMode: 'monochrome', // 'monochrome', 'gradient', 'duotone'
    sensitivity: 2.5,
    smoothing: 0.85,
    complexity: 3,
    showShapes: true,
    shapeStyle: 'munari', // 'munari', 'geometric', 'organic'
    lineWeight: 2,
    breathingEffect: true
  });

  // Munari-inspired shapes
  const munariShapes = {
    circle: (ctx, x, y, r, phase) => {
      ctx.beginPath();
      ctx.arc(x, y, r, 0, Math.PI * 2);
      ctx.stroke();
    },
    crescent: (ctx, x, y, r, phase) => {
      ctx.save();
      ctx.translate(x, y);
      ctx.rotate(phase);
      ctx.beginPath();
      ctx.arc(0, 0, r, 0.3, Math.PI * 2 - 0.3);
      ctx.stroke();
      ctx.restore();
    },
    semicircle: (ctx, x, y, r, phase) => {
      ctx.save();
      ctx.translate(x, y);
      ctx.rotate(phase);
      ctx.beginPath();
      ctx.arc(0, 0, r, 0, Math.PI);
      ctx.stroke();
      ctx.restore();
    },
    quartercircle: (ctx, x, y, r, phase) => {
      ctx.save();
      ctx.translate(x, y);
      ctx.rotate(phase);
      ctx.beginPath();
      ctx.arc(0, 0, r, 0, Math.PI / 2);
      ctx.stroke();
      ctx.restore();
    },
    ring: (ctx, x, y, r, phase) => {
      ctx.beginPath();
      ctx.arc(x, y, r, 0, Math.PI * 2);
      ctx.stroke();
      ctx.beginPath();
      ctx.arc(x, y, r * 0.7, 0, Math.PI * 2);
      ctx.stroke();
    },
    abstractSun: (ctx, x, y, r, phase) => {
      // Central circle
      ctx.beginPath();
      ctx.arc(x, y, r * 0.3, 0, Math.PI * 2);
      ctx.stroke();
      // Rays
      const rays = 8;
      for (let i = 0; i < rays; i++) {
        const angle = (i / rays) * Math.PI * 2 + phase;
        ctx.beginPath();
        ctx.moveTo(x + Math.cos(angle) * r * 0.5, y + Math.sin(angle) * r * 0.5);
        ctx.lineTo(x + Math.cos(angle) * r, y + Math.sin(angle) * r);
        ctx.stroke();
      }
    }
  };

  // Initialize audio devices
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
    navigator.mediaDevices.addEventListener('devicechange', getAudioDevices);
    
    return () => {
      navigator.mediaDevices.removeEventListener('devicechange', getAudioDevices);
    };
  }, []);

  // Audio system initialization
  useEffect(() => {
    const initAudio = async () => {
      try {
        if (audioContextRef.current && audioContextRef.current.state !== 'closed') {
          await audioContextRef.current.close();
        }

        const constraints = {
          audio: {
            deviceId: selectedAudioDevice ? { exact: selectedAudioDevice } : undefined,
            echoCancellation: false,
            noiseSuppression: false,
            autoGainControl: false,
            latency: 0,
            sampleRate: 48000
          }
        };
        
        const stream = await navigator.mediaDevices.getUserMedia(constraints);
        const audioContext = new (window.AudioContext || window.webkitAudioContext)();
        await audioContext.resume();
        audioContextRef.current = audioContext;
        
        const source = audioContext.createMediaStreamSource(stream);
        const gainNode = audioContext.createGain();
        gainNode.gain.value = settings.sensitivity;
        
        const analyser = audioContext.createAnalyser();
        analyser.fftSize = 8192;
        analyser.smoothingTimeConstant = 0.3;
        analyser.minDecibels = -90;
        analyser.maxDecibels = -10;
        analyserRef.current = analyser;
        
        source.connect(gainNode);
        gainNode.connect(analyser);
        
        const updateAudioData = () => {
          if (!audioEnabled || !analyserRef.current) {
            audioFrameRef.current = null;
            return;
          }
          
          const bufferLength = analyserRef.current.frequencyBinCount;
          const dataArray = new Uint8Array(bufferLength);
          analyserRef.current.getByteFrequencyData(dataArray);
          
          // Frequency band analysis
          const bassEnd = Math.floor(bufferLength * 0.05);
          const midEnd = Math.floor(bufferLength * 0.25);
          const highEnd = Math.floor(bufferLength * 0.6);
          
          const bass = dataArray.slice(0, bassEnd);
          const mid = dataArray.slice(bassEnd, midEnd);
          const high = dataArray.slice(midEnd, highEnd);
          
          const bassAvg = bass.reduce((a, b) => a + b, 0) / bass.length / 255;
          const midAvg = mid.reduce((a, b) => a + b, 0) / mid.length / 255;
          const highAvg = high.reduce((a, b) => a + b, 0) / high.length / 255;
          const overall = dataArray.reduce((a, b) => a + b, 0) / bufferLength / 255;
          
          // Temporal smoothing with custom easing
          const smoothFactor = settings.smoothing;
          const data = audioDataRef.current;
          
          data.bass = bassAvg;
          data.mid = midAvg;
          data.high = highAvg;
          data.overall = overall;
          
          // Smooth with history
          data.bassSmooth = data.bassSmooth * smoothFactor + bassAvg * (1 - smoothFactor);
          data.midSmooth = data.midSmooth * smoothFactor + midAvg * (1 - smoothFactor);
          data.highSmooth = data.highSmooth * smoothFactor + highAvg * (1 - smoothFactor);
          data.overallSmooth = data.overallSmooth * smoothFactor + overall * (1 - smoothFactor);
          
          // Update history for temporal effects
          data.bassHistory.shift();
          data.bassHistory.push(data.bassSmooth);
          data.midHistory.shift();
          data.midHistory.push(data.midSmooth);
          data.highHistory.shift();
          data.highHistory.push(data.highSmooth);
          
          audioFrameRef.current = requestAnimationFrame(updateAudioData);
        };
        
        updateAudioData();
        
      } catch (err) {
        console.error('Audio access failed:', err);
        alert('Audio Error: ' + err.message);
      }
    };

    if (audioEnabled) {
      initAudio();
    } else {
      if (audioFrameRef.current) {
        cancelAnimationFrame(audioFrameRef.current);
        audioFrameRef.current = null;
      }
      if (audioContextRef.current && audioContextRef.current.state !== 'closed') {
        audioContextRef.current.close();
      }
    }
    
    return () => {
      if (audioFrameRef.current) {
        cancelAnimationFrame(audioFrameRef.current);
      }
      if (audioContextRef.current && audioContextRef.current.state !== 'closed') {
        audioContextRef.current.close();
      }
    };
  }, [audioEnabled, selectedAudioDevice]);

  // Bezier curve generation
  const generateAudioCurve = (width, height, audioData, layer = 0, time = 0) => {
    const points = [];
    const segments = 60;
    const { bassSmooth, midSmooth, highSmooth, bassHistory, midHistory } = audioData;
    
    for (let i = 0; i <= segments; i++) {
      const t = i / segments;
      const x = t * width;
      
      // Multi-layered frequency response
      const bassWave = Math.sin(t * Math.PI * 2 + time * 0.5 + layer * 0.5) * bassSmooth * height * 0.15;
      const midWave = Math.sin(t * Math.PI * 4 + time * 1.2) * midSmooth * height * 0.08;
      const highDetail = Math.sin(t * Math.PI * 12 + time * 2) * highSmooth * height * 0.03;
      
      // Historical influence for smooth motion
      const historyInfluence = bassHistory[Math.floor(t * bassHistory.length)] * height * 0.05;
      
      const baseY = height / 2 + (layer - 1) * height * 0.15;
      const y = baseY + bassWave + midWave + highDetail + historyInfluence;
      
      points.push({ x, y });
    }
    
    return points;
  };

  // Smooth bezier path from points
  const drawSmoothCurve = (ctx, points, tension = 0.5) => {
    if (points.length < 2) return;
    
    ctx.beginPath();
    ctx.moveTo(points[0].x, points[0].y);
    
    for (let i = 0; i < points.length - 1; i++) {
      const p0 = points[Math.max(0, i - 1)];
      const p1 = points[i];
      const p2 = points[i + 1];
      const p3 = points[Math.min(points.length - 1, i + 2)];
      
      const cp1x = p1.x + (p2.x - p0.x) * tension;
      const cp1y = p1.y + (p2.y - p0.y) * tension;
      const cp2x = p2.x - (p3.x - p1.x) * tension;
      const cp2y = p2.y - (p3.y - p1.y) * tension;
      
      ctx.bezierCurveTo(cp1x, cp1y, cp2x, cp2y, p2.x, p2.y);
    }
    
    ctx.stroke();
  };

  // Main render function
  const render = (time = 0) => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    
    const ctx = canvas.getContext('2d');
    const width = canvas.width;
    const height = canvas.height;
    
    // Clear with style
    if (settings.colorMode === 'monochrome') {
      ctx.fillStyle = '#FAFAFA';
    } else if (settings.colorMode === 'gradient') {
      const gradient = ctx.createLinearGradient(0, 0, 0, height);
      gradient.addColorStop(0, '#F5F5F7');
      gradient.addColorStop(1, '#E8E8ED');
      ctx.fillStyle = gradient;
    } else {
      ctx.fillStyle = '#FFFFFF';
    }
    ctx.fillRect(0, 0, width, height);
    
    const audioData = audioDataRef.current;
    const t = time * 0.001;
    
    // Breathing effect
    const breathScale = settings.breathingEffect 
      ? 1 + audioData.overallSmooth * 0.15 
      : 1;
    
    ctx.save();
    ctx.translate(width / 2, height / 2);
    ctx.scale(breathScale, breathScale);
    ctx.translate(-width / 2, -height / 2);
    
    // Render based on style
    if (settings.style === 'waves') {
      // Multi-layered wave curves
      const layers = settings.complexity;
      
      for (let layer = 0; layer < layers; layer++) {
        const points = generateAudioCurve(width, height, audioData, layer, t);
        
        // Color based on mode
        if (settings.colorMode === 'monochrome') {
          const opacity = 0.3 + (layer / layers) * 0.4;
          ctx.strokeStyle = `rgba(0, 0, 0, ${opacity})`;
        } else if (settings.colorMode === 'gradient') {
          const hue = (layer / layers) * 60 + 200;
          ctx.strokeStyle = `hsla(${hue}, 70%, 50%, 0.6)`;
        } else {
          ctx.strokeStyle = layer % 2 === 0 ? 'rgba(0, 0, 0, 0.4)' : 'rgba(100, 100, 100, 0.3)';
        }
        
        ctx.lineWidth = settings.lineWeight * (1 + audioData.midSmooth * 0.5);
        ctx.lineCap = 'round';
        ctx.lineJoin = 'round';
        
        drawSmoothCurve(ctx, points, 0.3);
      }
    } else if (settings.style === 'munari') {
      // Munari geometric composition
      const goldenRatio = 1.618;
      const shapeTypes = Object.keys(munariShapes);
      
      ctx.strokeStyle = settings.colorMode === 'monochrome' ? '#000000' : '#1D1D1F';
      ctx.lineWidth = settings.lineWeight;
      
      // Primary shapes driven by bass
      const primaryCount = 3 + Math.floor(audioData.bassSmooth * 3);
      for (let i = 0; i < primaryCount; i++) {
        const angle = (i / primaryCount) * Math.PI * 2 + t * 0.3;
        const distance = width * 0.25 * (1 + audioData.bassSmooth * 0.3);
        const x = width / 2 + Math.cos(angle) * distance;
        const y = height / 2 + Math.sin(angle) * distance;
        const radius = (width * 0.08) * (1 + audioData.midSmooth * 0.5);
        
        const shapeType = shapeTypes[i % shapeTypes.length];
        munariShapes[shapeType](ctx, x, y, radius, t + i);
      }
      
      // Secondary details driven by mids
      ctx.globalAlpha = 0.4 + audioData.midSmooth * 0.3;
      const detailCount = Math.floor(audioData.midSmooth * 8);
      for (let i = 0; i < detailCount; i++) {
        const x = width * (0.2 + Math.random() * 0.6);
        const y = height * (0.2 + Math.random() * 0.6);
        const radius = width * 0.03 * (1 + audioData.highSmooth);
        
        munariShapes.circle(ctx, x, y, radius, t);
      }
      ctx.globalAlpha = 1;
      
    } else if (settings.style === 'minimal') {
      // Single elegant line
      const points = generateAudioCurve(width, height, audioData, 0, t);
      
      ctx.strokeStyle = settings.colorMode === 'monochrome' ? '#000000' : '#1D1D1F';
      ctx.lineWidth = settings.lineWeight * (2 + audioData.overallSmooth * 2);
      ctx.lineCap = 'round';
      
      drawSmoothCurve(ctx, points, 0.4);
      
    } else if (settings.style === 'orbital') {
      // Orbital rings modulated by frequency
      const rings = settings.complexity * 2;
      
      for (let i = 0; i < rings; i++) {
        const baseRadius = (width * 0.15) + (i * width * 0.08);
        const points = [];
        const segments = 120;
        
        for (let j = 0; j <= segments; j++) {
          const angle = (j / segments) * Math.PI * 2;
          
          // Modulate radius by frequency bands
          const bassModulation = audioData.bassSmooth * width * 0.05 * Math.sin(angle * 2 + t);
          const midModulation = audioData.midSmooth * width * 0.03 * Math.sin(angle * 4 + t * 1.5);
          const highModulation = audioData.highSmooth * width * 0.01 * Math.sin(angle * 8 + t * 2);
          
          const r = baseRadius + bassModulation + midModulation + highModulation;
          const x = width / 2 + Math.cos(angle) * r;
          const y = height / 2 + Math.sin(angle) * r;
          
          points.push({ x, y });
        }
        
        const opacity = 0.2 + (i / rings) * 0.3;
        ctx.strokeStyle = `rgba(0, 0, 0, ${opacity})`;
        ctx.lineWidth = settings.lineWeight;
        
        drawSmoothCurve(ctx, points, 0.2);
      }
    }
    
    ctx.restore();
  };

  // Animation loop
  useEffect(() => {
    const animateLoop = (time) => {
      render(time);
      if (isAnimating) {
        animationRef.current = requestAnimationFrame(animateLoop);
      }
    };
    
    if (isAnimating) {
      animationRef.current = requestAnimationFrame(animateLoop);
    }
    
    return () => {
      if (animationRef.current) cancelAnimationFrame(animationRef.current);
    };
  }, [isAnimating, settings]);

  // Canvas resize
  useEffect(() => {
    const handleResize = () => {
      const canvas = canvasRef.current;
      if (canvas) {
        canvas.width = canvas.offsetWidth * window.devicePixelRatio;
        canvas.height = canvas.offsetHeight * window.devicePixelRatio;
        const ctx = canvas.getContext('2d');
        ctx.scale(window.devicePixelRatio, window.devicePixelRatio);
        render();
      }
    };
    handleResize();
    window.addEventListener('resize', handleResize);
    return () => window.removeEventListener('resize', handleResize);
  }, []);

  return (
    <div className="w-full h-screen bg-gray-50 flex">
      {/* Minimal Control Panel */}
      <div className="w-72 bg-white border-r border-gray-200 p-6 overflow-y-auto">
        <h1 className="text-xl font-semibold mb-6 text-gray-900">Audio Visual</h1>
        
        {/* Audio Controls */}
        <div className="mb-6">
          <h3 className="text-sm font-medium text-gray-700 mb-3">Audio Input</h3>
          
          <button
            onClick={() => setAudioEnabled(!audioEnabled)}
            className={`w-full flex items-center justify-center gap-2 px-4 py-3 rounded-lg transition-all ${
              audioEnabled 
                ? 'bg-blue-500 text-white hover:bg-blue-600' 
                : 'bg-gray-100 text-gray-700 hover:bg-gray-200'
            }`}
          >
            {audioEnabled ? <Mic size={18} /> : <MicOff size={18} />}
            {audioEnabled ? 'Audio Active' : 'Enable Audio'}
          </button>
          
          {audioEnabled && audioDevices.length > 0 && (
            <select 
              value={selectedAudioDevice || ''} 
              onChange={(e) => setSelectedAudioDevice(e.target.value)}
              className="w-full mt-3 p-2 border border-gray-300 rounded-lg text-sm"
            >
              {audioDevices.map(device => (
                <option key={device.deviceId} value={device.deviceId}>
                  {device.label || `Input ${device.deviceId.substring(0, 8)}`}
                </option>
              ))}
            </select>
          )}
          
          {audioEnabled && (
            <div className="mt-4 space-y-2">
              <div className="flex justify-between text-xs text-gray-600">
                <span>Bass</span>
                <span>{(audioDataRef.current.bassSmooth * 100).toFixed(0)}%</span>
              </div>
              <div className="w-full bg-gray-200 rounded-full h-1.5">
                <div 
                  className="bg-red-500 h-1.5 rounded-full transition-all duration-100" 
                  style={{ width: `${audioDataRef.current.bassSmooth * 100}%` }}
                />
              </div>
              
              <div className="flex justify-between text-xs text-gray-600">
                <span>Mid</span>
                <span>{(audioDataRef.current.midSmooth * 100).toFixed(0)}%</span>
              </div>
              <div className="w-full bg-gray-200 rounded-full h-1.5">
                <div 
                  className="bg-green-500 h-1.5 rounded-full transition-all duration-100" 
                  style={{ width: `${audioDataRef.current.midSmooth * 100}%` }}
                />
              </div>
              
              <div className="flex justify-between text-xs text-gray-600">
                <span>High</span>
                <span>{(audioDataRef.current.highSmooth * 100).toFixed(0)}%</span>
              </div>
              <div className="w-full bg-gray-200 rounded-full h-1.5">
                <div 
                  className="bg-blue-500 h-1.5 rounded-full transition-all duration-100" 
                  style={{ width: `${audioDataRef.current.highSmooth * 100}%` }}
                />
              </div>
            </div>
          )}
        </div>

        <div className="border-t border-gray-200 pt-6 space-y-6">
          {/* Visual Style */}
          <div>
            <h3 className="text-sm font-medium text-gray-700 mb-3">Visual Style</h3>
            <div className="grid grid-cols-2 gap-2">
              {['waves', 'munari', 'minimal', 'orbital'].map(style => (
                <button
                  key={style}
                  onClick={() => setSettings(prev => ({ ...prev, style }))}
                  className={`px-3 py-2 rounded-lg text-sm capitalize transition-all ${
                    settings.style === style
                      ? 'bg-gray-900 text-white'
                      : 'bg-gray-100 text-gray-700 hover:bg-gray-200'
                  }`}
                >
                  {style}
                </button>
              ))}
            </div>
          </div>

          {/* Color Mode */}
          <div>
            <h3 className="text-sm font-medium text-gray-700 mb-3">Color Mode</h3>
            <div className="space-y-2">
              {['monochrome', 'gradient', 'duotone'].map(mode => (
                <button
                  key={mode}
                  onClick={() => setSettings(prev => ({ ...prev, colorMode: mode }))}
                  className={`w-full px-3 py-2 rounded-lg text-sm capitalize transition-all ${
                    settings.colorMode === mode
                      ? 'bg-gray-900 text-white'
                      : 'bg-gray-100 text-gray-700 hover:bg-gray-200'
                  }`}
                >
                  {mode}
                </button>
              ))}
            </div>
          </div>

          {/* Sensitivity */}
          <div>
            <label className="text-sm font-medium text-gray-700 mb-2 block">
              Sensitivity: {settings.sensitivity.toFixed(1)}x
            </label>
            <input 
              type="range" 
              min="0.5" 
              max="5" 
              step="0.1"
              value={settings.sensitivity} 
              onChange={(e) => setSettings(prev => ({ ...prev, sensitivity: parseFloat(e.target.value) }))} 
              className="w-full accent-gray-900"
            />
          </div>

          {/* Smoothing */}
          <div>
            <label className="text-sm font-medium text-gray-700 mb-2 block">
              Smoothing: {(settings.smoothing * 100).toFixed(0)}%
            </label>
            <input 
              type="range" 
              min="0" 
              max="0.95" 
              step="0.05"
              value={settings.smoothing} 
              onChange={(e) => setSettings(prev => ({ ...prev, smoothing: parseFloat(e.target.value) }))} 
              className="w-full accent-gray-900"
            />
          </div>

          {/* Complexity */}
          <div>
            <label className="text-sm font-medium text-gray-700 mb-2 block">
              Complexity: {settings.complexity}
            </label>
            <input 
              type="range" 
              min="1" 
              max="6" 
              step="1"
              value={settings.complexity} 
              onChange={(e) => setSettings(prev => ({ ...prev, complexity: parseInt(e.target.value) }))} 
              className="w-full accent-gray-900"
            />
          </div>

          {/* Line Weight */}
          <div>
            <label className="text-sm font-medium text-gray-700 mb-2 block">
              Line Weight: {settings.lineWeight}px
            </label>
            <input 
              type="range" 
              min="1" 
              max="5" 
              step="0.5"
              value={settings.lineWeight} 
              onChange={(e) => setSettings(prev => ({ ...prev, lineWeight: parseFloat(e.target.value) }))} 
              className="w-full accent-gray-900"
            />
          </div>

          {/* Breathing Effect */}
          <div>
            <label className="flex items-center gap-2 cursor-pointer">
              <input 
                type="checkbox" 
                checked={settings.breathingEffect} 
                onChange={(e) => setSettings(prev => ({ ...prev, breathingEffect: e.target.checked }))} 
                className="w-4 h-4 accent-gray-900"
              />
              <span className="text-sm text-gray-700">Breathing Effect</span>
            </label>
          </div>
        </div>

        {/* Control Buttons */}
        <div className="border-t border-gray-200 pt-6 space-y-2">
          <button
            onClick={() => setIsAnimating(!isAnimating)}
            className="w-full flex items-center justify-center gap-2 px-4 py-3 bg-gray-900 text-white rounded-lg hover:bg-gray-800 transition-all"
          >
            {isAnimating ? <Pause size={18} /> : <Play size={18} />}
            {isAnimating ? 'Pause' : 'Play'}
          </button>
          
          <button
            onClick={() => {
              const canvas = canvasRef.current;
              const link = document.createElement('a');
              link.download = `audio-visual-${Date.now()}.png`;
              link.href = canvas.toDataURL();
              link.click();
            }}
            className="w-full flex items-center justify-center gap-2 px-4 py-3 bg-gray-100 text-gray-700 rounded-lg hover:bg-gray-200 transition-all"
          >
            <Download size={18} />
            Export PNG
          </button>
        </div>
      </div>

      {/* Canvas */}
      <div className="flex-1 flex items-center justify-center p-8">
        <canvas 
          ref={canvasRef} 
          className="w-full h-full rounded-xl shadow-2xl bg-white"
          style={{ width: '100%', height: '100%' }}
        />
      </div>
    </div>
  );
};

export default AudioVisualSynthesizer;
