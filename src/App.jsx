import React from 'react';
import { RotateCcw, Download, Play, Square } from 'lucide-react';

const GenerativePatternSystem = () => {
  const canvasRef = React.useRef(null);
  const animationRef = React.useRef(null);
  const audioContextRef = React.useRef(null);
  const analyserRef = React.useRef(null);
  const midiVelocityRef = React.useRef(0);
  const midiNoteRef = React.useRef(0);
  const smoothAudioRef = React.useRef(0);
  const smoothBassRef = React.useRef(0);

  const [audioEnabled, setAudioEnabled] = React.useState(false);
  const [audioLevel, setAudioLevel] = React.useState(0);
  const [bassLevel, setBassLevel] = React.useState(0);
  const [gridCells, setGridCells] = React.useState([]);
  const [midiEnabled, setMidiEnabled] = React.useState(false);
  const [midiDevices, setMidiDevices] = React.useState([]);
  const [audioDevices, setAudioDevices] = React.useState([]);
  const [selectedAudioDevice, setSelectedAudioDevice] = React.useState('');

  const [settings, setSettings] = React.useState({
    patternType: 'swiss-grid',
    lineThickness: 2,
    spacing: 40,
    distortionEnabled: false,
    distortionType: 'liquify',
    distortionStrength: 30,
    distortionSpeed: 1,
    audioSensitivity: 3,
    midiSensitivity: 2,
    dotSize: 4,
    shapeSize: 8,
    text: 'SOUND',
    fontSize: 48,
    charSequence: '01',
    charGridSize: 24,
    charCycleSpeed: 2,
    gridColumns: 12,
    gridRows: 16,
    showGridLines: true,
    gridRotation: 0,
    cycleMode: 'crossfade',
    elementBehavior: 'pulse',
    stringBehavior: 'wave',
    motionSmoothing: 0.15,
    charStagger: 0.08
  });

  const PHI = 1.618033988749895;
  
  const easeOutQuart = (t) => 1 - Math.pow(1 - t, 4);
  const easeInOutCubic = (t) => t < 0.5 ? 4 * t * t * t : 1 - Math.pow(-2 * t + 2, 3) / 2;
  const applyEasing = (t) => easeInOutCubic(Math.max(0, Math.min(1, t)));

  React.useEffect(() => {
    const getAudioDevices = async () => {
      try {
        const devices = await navigator.mediaDevices.enumerateDevices();
        const audioInputs = devices.filter(device => device.kind === 'audioinput');
        setAudioDevices(audioInputs);
        if (audioInputs.length > 0 && !selectedAudioDevice) {
          setSelectedAudioDevice(audioInputs[0].deviceId);
        }
      } catch (err) {
        console.error('Failed to enumerate devices');
      }
    };
    getAudioDevices();
  }, []);

  React.useEffect(() => {
    if (!midiEnabled) {
      midiVelocityRef.current = 0;
      midiNoteRef.current = 0;
      return;
    }
    const initMIDI = async () => {
      try {
        const access = await navigator.requestMIDIAccess();
        const devices = [];
        for (const input of access.inputs.values()) {
          devices.push(input.name);
          input.onmidimessage = (event) => {
            const [status, note, velocity] = event.data;
            const command = status >> 4;
            if (command === 9 && velocity > 0) {
              midiNoteRef.current = note;
              midiVelocityRef.current = velocity / 127;
            } else if (command === 8 || (command === 9 && velocity === 0)) {
              midiVelocityRef.current = 0;
            }
          };
        }
        setMidiDevices(devices);
      } catch (err) {
        console.error('MIDI failed');
      }
    };
    initMIDI();
  }, [midiEnabled]);

  React.useEffect(() => {
    if (!audioEnabled) {
      if (audioContextRef.current) {
        audioContextRef.current.close();
        audioContextRef.current = null;
      }
      analyserRef.current = null;
      setAudioLevel(0);
      setBassLevel(0);
      smoothAudioRef.current = 0;
      smoothBassRef.current = 0;
      return;
    }
    const initAudio = async () => {
      try {
        const constraints = { 
          audio: selectedAudioDevice ? { deviceId: { exact: selectedAudioDevice } } : true 
        };
        const stream = await navigator.mediaDevices.getUserMedia(constraints);
        const audioContext = new (window.AudioContext || window.webkitAudioContext)();
        audioContextRef.current = audioContext;
        const source = audioContext.createMediaStreamSource(stream);
        const analyser = audioContext.createAnalyser();
        analyser.fftSize = 2048;
        analyser.smoothingTimeConstant = 0.8;
        analyserRef.current = analyser;
        source.connect(analyser);
        
        const updateAudio = () => {
          if (!analyserRef.current) return;
          const dataArray = new Uint8Array(analyserRef.current.frequencyBinCount);
          analyserRef.current.getByteFrequencyData(dataArray);
          const bass = dataArray.slice(0, 50).reduce((a, b) => a + b, 0) / 50 / 255;
          const overall = dataArray.reduce((a, b) => a + b, 0) / dataArray.length / 255;
          
          // Smooth interpolation
          smoothAudioRef.current += (overall - smoothAudioRef.current) * settings.motionSmoothing;
          smoothBassRef.current += (bass - smoothBassRef.current) * settings.motionSmoothing;
          
          setAudioLevel(smoothAudioRef.current);
          setBassLevel(smoothBassRef.current);
          requestAnimationFrame(updateAudio);
        };
        updateAudio();
      } catch (err) {
        alert('Audio access denied');
      }
    };
    initAudio();
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
      const A = p[X] + Y;
      const B = p[X + 1] + Y;
      const lerp = (t, a, b) => a + t * (b - a);
      return lerp(v, lerp(u, p[A] / 128 - 1, p[B] / 128 - 1), lerp(u, p[A + 1] / 128 - 1, p[B + 1] / 128 - 1));
    };
  })();

  const getDistortion = (x, y, time, strength, type) => {
    const freq = 0.008;
    const t = time || 0;
    let dx = 0, dy = 0;
    switch (type) {
      case 'liquify':
        dx = noise((x + t * 30) * freq, y * freq) * strength;
        dy = noise((x + t * 30) * freq + 100, (y + t * 20) * freq + 100) * strength;
        break;
      case 'ripple':
        const dist = Math.sqrt(x * x + y * y);
        const ripple = Math.sin((dist - t * 40) * 0.015) * strength;
        dx = (x / (dist || 1)) * ripple;
        dy = (y / (dist || 1)) * ripple;
        break;
      case 'swirl':
        const angle = Math.atan2(y, x);
        const radius = Math.sqrt(x * x + y * y);
        const rotation = t * 0.2;
        const newAngle = angle + rotation + (strength * 0.0008) * (1 / (1 + radius * 0.01));
        dx = Math.cos(newAngle) * radius - x;
        dy = Math.sin(newAngle) * radius - y;
        break;
    }
    return { x: dx, y: dy };
  };

  const generateRandomGrid = () => {
    const cells = [];
    const totalCells = settings.gridColumns * settings.gridRows;
    const numElements = Math.floor(totalCells * 0.25);
    const usedIndices = new Set();
    for (let i = 0; i < numElements; i++) {
      let index;
      do {
        index = Math.floor(Math.random() * totalCells);
      } while (usedIndices.has(index));
      usedIndices.add(index);
      cells.push({ 
        index: index, 
        type: ['char', 'dot', 'square'][Math.floor(Math.random() * 3)],
        phase: Math.random() * Math.PI * 2
      });
    }
    setGridCells(cells);
  };

  const render = (time = 0) => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext('2d');
    const width = canvas.width;
    const height = canvas.height;
    
    ctx.fillStyle = '#FAFAFA';
    ctx.fillRect(0, 0, width, height);
    ctx.fillStyle = '#0A0A0A';
    
    const animTime = time * 0.001 * settings.distortionSpeed;
    const midiInfluence = midiVelocityRef.current * settings.midiSensitivity;
    const audioReactive = smoothAudioRef.current * settings.audioSensitivity;
    const bassReactive = smoothBassRef.current * settings.audioSensitivity;
    
    if (settings.patternType === 'vertical-lines') {
      const lineThickness = settings.lineThickness * (1 + bassReactive * 0.5);
      for (let x = 0; x < width; x += settings.spacing) {
        ctx.beginPath();
        for (let y = 0; y < height; y += 2) {
          let drawX = x, drawY = y;
          if (settings.distortionEnabled) {
            const d = getDistortion(x - width/2, y - height/2, animTime, settings.distortionStrength * (1 + audioReactive), settings.distortionType);
            drawX += d.x;
            drawY += d.y;
          }
          if (y === 0) ctx.moveTo(drawX, drawY);
          else ctx.lineTo(drawX, drawY);
        }
        ctx.lineWidth = lineThickness;
        ctx.strokeStyle = '#0A0A0A';
        ctx.stroke();
      }
    } else if (settings.patternType === 'horizontal-lines') {
      const lineThickness = settings.lineThickness * (1 + bassReactive * 0.5);
      for (let y = 0; y < height; y += settings.spacing) {
        ctx.beginPath();
        for (let x = 0; x < width; x += 2) {
          let drawX = x, drawY = y;
          if (settings.distortionEnabled) {
            const d = getDistortion(x - width/2, y - height/2, animTime, settings.distortionStrength * (1 + audioReactive), settings.distortionType);
            drawX += d.x;
            drawY += d.y;
          }
          if (x === 0) ctx.moveTo(drawX, drawY);
          else ctx.lineTo(drawX, drawY);
        }
        ctx.lineWidth = lineThickness;
        ctx.strokeStyle = '#0A0A0A';
        ctx.stroke();
      }
    } else if (settings.patternType === 'dots') {
      const dotSize = settings.dotSize * (1 + (bassReactive + midiInfluence) * 0.6);
      for (let y = 0; y < height; y += settings.spacing) {
        for (let x = 0; x < width; x += settings.spacing) {
          let drawX = x, drawY = y;
          if (settings.distortionEnabled) {
            const d = getDistortion(x - width/2, y - height/2, animTime, settings.distortionStrength * (1 + audioReactive), settings.distortionType);
            drawX += d.x;
            drawY += d.y;
          }
          ctx.beginPath();
          ctx.arc(drawX, drawY, dotSize, 0, Math.PI * 2);
          ctx.fill();
        }
      }
    } else if (settings.patternType === 'squares') {
      const shapeSize = settings.shapeSize * (1 + (bassReactive + midiInfluence) * 0.6);
      for (let y = 0; y < height; y += settings.spacing) {
        for (let x = 0; x < width; x += settings.spacing) {
          let drawX = x, drawY = y;
          if (settings.distortionEnabled) {
            const d = getDistortion(x - width/2, y - height/2, animTime, settings.distortionStrength * (1 + audioReactive), settings.distortionType);
            drawX += d.x;
            drawY += d.y;
          }
          const halfSize = shapeSize / 2;
          ctx.fillRect(drawX - halfSize, drawY - halfSize, shapeSize, shapeSize);
        }
      }
    } else if (settings.patternType === 'text') {
      ctx.font = `${settings.fontSize}px -apple-system, BlinkMacSystemFont, "SF Pro Display", sans-serif`;
      ctx.textAlign = 'center';
      ctx.textBaseline = 'middle';
      ctx.fontWeight = '600';
      
      for (let y = 0; y < height; y += settings.spacing) {
        for (let x = 0; x < width; x += settings.spacing) {
          ctx.save();
          ctx.translate(x, y);
          const scale = 1 + applyEasing((bassReactive + midiInfluence) * 0.4);
          ctx.scale(scale, scale);
          if (midiNoteRef.current > 0) {
            const rotation = (midiNoteRef.current / 127) * 0.2;
            ctx.rotate(rotation);
          }
          ctx.fillText(settings.text, 0, 0);
          ctx.restore();
        }
      }
    } else if (settings.patternType === 'char-grid') {
      ctx.font = `${settings.charGridSize}px "SF Mono", "Monaco", monospace`;
      ctx.textAlign = 'center';
      ctx.textBaseline = 'middle';
      const chars = settings.charSequence.split('');
      if (chars.length > 0) {
        const cycleTime = time * 0.001 * settings.charCycleSpeed;
        let rowIndex = 0;
        for (let y = 0; y < height; y += settings.spacing) {
          let colIndex = 0;
          for (let x = 0; x < width; x += settings.spacing) {
            const staggerOffset = (rowIndex + colIndex) * settings.charStagger;
            const localCycleTime = cycleTime + staggerOffset;
            let charIndex;
            if (settings.stringBehavior === 'cycle') {
              charIndex = (Math.floor(localCycleTime * 3) + rowIndex + colIndex) % chars.length;
            } else if (settings.stringBehavior === 'wave') {
              const wave = Math.sin((colIndex * 0.5 + rowIndex * 0.3 + localCycleTime) * 0.8);
              charIndex = Math.floor((wave + 1) * 0.5 * chars.length) % chars.length;
            } else {
              const seed = rowIndex * 1000 + colIndex + Math.floor(localCycleTime * 2);
              charIndex = Math.floor((Math.sin(seed) * 0.5 + 0.5) * chars.length);
            }
            const char = chars[charIndex];
            ctx.save();
            ctx.translate(x, y);
            const reactiveScale = 1 + applyEasing((bassReactive + midiInfluence) * 0.3);
            ctx.scale(reactiveScale, reactiveScale);
            ctx.fillText(char, 0, 0);
            ctx.restore();
            colIndex++;
          }
          rowIndex++;
        }
      }
    } else if (settings.patternType === 'swiss-grid') {
      const cellWidth = width / settings.gridColumns;
      const cellHeight = height / settings.gridRows;
      const adaptiveSize = Math.min(cellWidth, cellHeight) * 0.5;
      
      if (settings.showGridLines) {
        ctx.strokeStyle = '#E5E5E5';
        ctx.lineWidth = 0.5;
        for (let i = 0; i <= settings.gridColumns; i++) {
          ctx.beginPath();
          ctx.moveTo(i * cellWidth, 0);
          ctx.lineTo(i * cellWidth, height);
          ctx.stroke();
        }
        for (let i = 0; i <= settings.gridRows; i++) {
          ctx.beginPath();
          ctx.moveTo(0, i * cellHeight);
          ctx.lineTo(width, i * cellHeight);
          ctx.stroke();
        }
      }
      
      const chars = settings.charSequence.split('');
      const cycleTime = time * 0.001 * settings.charCycleSpeed;
      
      gridCells.forEach((cell, cellIdx) => {
        const col = cell.index % settings.gridColumns;
        const row = Math.floor(cell.index / settings.gridColumns);
        const centerX = col * cellWidth + cellWidth / 2;
        const centerY = row * cellHeight + cellHeight / 2;
        const stagger = cellIdx * settings.charStagger;
        const localTime = cycleTime + stagger;
        const audioBoost = applyEasing((bassReactive + midiInfluence) * 0.5);
        
        ctx.save();
        ctx.translate(centerX, centerY);
        
        const gridRotationRad = (settings.gridRotation * Math.PI) / 180;
        if (gridRotationRad !== 0) {
          ctx.rotate(gridRotationRad);
        }
        
        if (settings.elementBehavior === 'pulse') {
          const pulse = Math.sin(localTime * 3 + cell.phase) * 0.5 + 0.5;
          const scale = 0.8 + pulse * 0.4 + audioBoost * 0.3;
          ctx.scale(scale, scale);
        } else if (settings.elementBehavior === 'orbit') {
          const orbitRadius = adaptiveSize * 0.3 * (1 + audioBoost * 0.5);
          const orbitAngle = localTime * 1.5 + cell.phase;
          const orbitX = Math.cos(orbitAngle) * orbitRadius;
          const orbitY = Math.sin(orbitAngle) * orbitRadius;
          ctx.translate(orbitX, orbitY);
        } else if (settings.elementBehavior === 'bounce') {
          const bounce = Math.abs(Math.sin(localTime * 2 + cell.phase));
          const bounceY = -bounce * adaptiveSize * 0.5 * (1 + audioBoost);
          ctx.translate(0, bounceY);
        }
        
        if (cell.type === 'char' && chars.length > 0) {
          ctx.font = `${adaptiveSize * 1.2}px "SF Mono", "Monaco", monospace`;
          ctx.textAlign = 'center';
          ctx.textBaseline = 'middle';
          
          if (settings.cycleMode === 'crossfade') {
            const charIndexFloat = (localTime * 2) % chars.length;
            const currentIndex = Math.floor(charIndexFloat);
            const nextIndex = (currentIndex + 1) % chars.length;
            const progress = charIndexFloat - currentIndex;
            const easedProgress = applyEasing(progress);
            
            ctx.globalAlpha = 1 - easedProgress;
            ctx.fillText(chars[currentIndex], 0, 0);
            ctx.globalAlpha = easedProgress;
            ctx.fillText(chars[nextIndex], 0, 0);
            ctx.globalAlpha = 1;
          } else {
            const charIndex = Math.floor(localTime * 2) % chars.length;
            ctx.fillText(chars[charIndex], 0, 0);
          }
        } else if (cell.type === 'dot') {
          const radius = adaptiveSize * 0.4 * (1 + audioBoost * 0.4);
          ctx.beginPath();
          ctx.arc(0, 0, radius, 0, Math.PI * 2);
          ctx.fill();
        } else if (cell.type === 'square') {
          const size = adaptiveSize * 0.8 * (1 + audioBoost * 0.4);
          ctx.fillRect(-size/2, -size/2, size, size);
        }
        ctx.restore();
      });
    }
  };

  React.useEffect(() => {
    const loop = (time) => {
      render(time);
      animationRef.current = requestAnimationFrame(loop);
    };
    animationRef.current = requestAnimationFrame(loop);
    return () => cancelAnimationFrame(animationRef.current);
  }, [settings, gridCells, audioLevel, bassLevel]);

  React.useEffect(() => {
    const handleResize = () => {
      if (canvasRef.current) {
        canvasRef.current.width = canvasRef.current.offsetWidth;
        canvasRef.current.height = canvasRef.current.offsetHeight;
      }
    };
    handleResize();
    window.addEventListener('resize', handleResize);
    return () => window.removeEventListener('resize', handleResize);
  }, []);

  React.useEffect(() => {
    generateRandomGrid();
  }, []);

  return (
    <div className="w-full h-screen bg-white flex">
      <div className="w-72 bg-neutral-50 border-r border-neutral-200 p-6 overflow-y-auto space-y-6">
        <div className="flex gap-2">
          <button onClick={generateRandomGrid} className="flex-1 flex items-center justify-center gap-2 px-4 py-2.5 bg-black text-white rounded-lg text-sm font-medium hover:bg-neutral-800 transition-colors">
            <RotateCcw size={16} />
          </button>
          <button onClick={() => {
            const link = document.createElement('a');
            link.download = 'pattern.png';
            link.href = canvasRef.current.toDataURL();
            link.click();
          }} className="flex-1 flex items-center justify-center gap-2 px-4 py-2.5 bg-black text-white rounded-lg text-sm font-medium hover:bg-neutral-800 transition-colors">
            <Download size={16} />
          </button>
        </div>

        <div className="space-y-3">
          <label className="block text-xs font-semibold text-neutral-900 uppercase tracking-wider">Pattern</label>
          <select value={settings.patternType} onChange={(e) => setSettings(s => ({ ...s, patternType: e.target.value }))} className="w-full px-3 py-2 bg-white border border-neutral-300 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-black">
            <option value="vertical-lines">Vertical Lines</option>
            <option value="horizontal-lines">Horizontal Lines</option>
            <option value="dots">Dots</option>
            <option value="squares">Squares</option>
            <option value="text">Text</option>
            <option value="char-grid">Character Grid</option>
            <option value="swiss-grid">Swiss Grid</option>
          </select>
        </div>

        <div className="space-y-3">
          <div className="flex items-center justify-between">
            <label className="text-xs font-semibold text-neutral-900 uppercase tracking-wider">Audio</label>
            <button onClick={() => setAudioEnabled(!audioEnabled)} className={`p-1.5 rounded transition-colors ${audioEnabled ? 'bg-black text-white' : 'bg-neutral-200'}`}>
              {audioEnabled ? <Play size={14} fill="white" /> : <Square size={14} />}
            </button>
          </div>
          {audioDevices.length > 0 && (
            <select value={selectedAudioDevice} onChange={(e) => setSelectedAudioDevice(e.target.value)} className="w-full px-3 py-2 bg-white border border-neutral-300 rounded-lg text-xs focus:outline-none focus:ring-2 focus:ring-black">
              {audioDevices.map(d => <option key={d.deviceId} value={d.deviceId}>{d.label || `Device ${d.deviceId.slice(0,8)}`}</option>)}
            </select>
          )}
          {audioEnabled && (
            <div className="space-y-2">
              <div className="h-1 bg-neutral-200 rounded-full overflow-hidden">
                <div className="h-full bg-black transition-all duration-75" style={{ width: `${audioLevel * 100}%` }} />
              </div>
              <div className="h-1 bg-neutral-200 rounded-full overflow-hidden">
                <div className="h-full bg-neutral-600 transition-all duration-75" style={{ width: `${bassLevel * 100}%` }} />
              </div>
            </div>
          )}
        </div>

        <div className="space-y-3">
          <div className="flex items-center justify-between">
            <label className="text-xs font-semibold text-neutral-900 uppercase tracking-wider">MIDI</label>
            <button onClick={() => setMidiEnabled(!midiEnabled)} className={`p-1.5 rounded transition-colors ${midiEnabled ? 'bg-black text-white' : 'bg-neutral-200'}`}>
              {midiEnabled ? <Play size={14} fill="white" /> : <Square size={14} />}
            </button>
          </div>
          {midiEnabled && midiDevices.length > 0 && (
            <div className="text-xs text-neutral-600">{midiDevices.length} device(s)</div>
          )}
        </div>

        <div className="space-y-3">
          <div className="flex items-center justify-between">
            <label className="text-xs font-semibold text-neutral-900 uppercase tracking-wider">Distortion</label>
            <button onClick={() => setSettings(s => ({ ...s, distortionEnabled: !s.distortionEnabled }))} className={`p-1.5 rounded transition-colors ${settings.distortionEnabled ? 'bg-black text-white' : 'bg-neutral-200'}`}>
              {settings.distortionEnabled ? <Play size={14} fill="white" /> : <Square size={14} />}
            </button>
          </div>
          {settings.distortionEnabled && (
            <select value={settings.distortionType} onChange={(e) => setSettings(s => ({ ...s, distortionType: e.target.value }))} className="w-full px-3 py-2 bg-white border border-neutral-300 rounded-lg text-xs focus:outline-none focus:ring-2 focus:ring-black">
              <option value="liquify">Liquify</option>
              <option value="ripple">Ripple</option>
              <option value="swirl">Swirl</option>
            </select>
          )}
        </div>

        {settings.patternType === 'swiss-grid' && (
          <>
            <div className="space-y-3">
              <label className="block text-xs font-semibold text-neutral-900 uppercase tracking-wider">Grid</label>
              <div className="flex gap-2">
                <div className="flex-1">
                  <div className="text-xs text-neutral-600 mb-1">{settings.gridColumns} × {settings.gridRows}</div>
                  <input type="range" min="4" max="40" value={settings.gridColumns} onChange={(e) => setSettings(s => ({ ...s, gridColumns: parseInt(e.target.value) }))} className="w-full" />
                </div>
              </div>
              <button onClick={() => setGridCells([])} className="w-full px-4 py-2.5 bg-neutral-900 text-white rounded-lg text-sm font-medium hover:bg-black transition-colors">Clear</button>
            </div>

            <div className="space-y-3">
              <label className="block text-xs font-semibold text-neutral-900 uppercase tracking-wider">Behavior</label>
              <select value={settings.elementBehavior} onChange={(e) => setSettings(s => ({ ...s, elementBehavior: e.target.value }))} className="w-full px-3 py-2 bg-white border border-neutral-300 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-black">
                <option value="pulse">Pulse</option>
                <option value="orbit">Orbit</option>
                <option value="bounce">Bounce</option>
              </select>
            </div>

            <div className="space-y-3">
              <label className="block text-xs font-semibold text-neutral-900 uppercase tracking-wider">Characters</label>
              <input type="text" value={settings.charSequence} onChange={(e) => setSettings(s => ({ ...s, charSequence: e.target.value }))} className="w-full px-3 py-2 bg-white border border-neutral-300 rounded-lg font-mono text-sm focus:outline-none focus:ring-2 focus:ring-black" />
            </div>
          </>
        )}

        {settings.patternType === 'char-grid' && (
          <div className="space-y-3">
            <label className="block text-xs font-semibold text-neutral-900 uppercase tracking-wider">String Behavior</label>
            <select value={settings.stringBehavior} onChange={(e) => setSettings(s => ({ ...s, stringBehavior: e.target.value }))} className="w-full px-3 py-2 bg-white border border-neutral-300 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-black">
              <option value="cycle">Cycle</option>
              <option value="wave">Wave</option>
              <option value="random">Random</option>
            </select>
          </div>
        )}
      </div>

      <div className="flex-1 p-8 bg-white">
        <canvas ref={canvasRef} className="w-full h-full rounded-lg shadow-sm" />
      </div>
    </div>
  );
};

export default GenerativePatternSystem;
