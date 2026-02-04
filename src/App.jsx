import React from 'react';
import { RotateCcw, Download } from 'lucide-react';

const GenerativePatternSystem = () => {
  const canvasRef = React.useRef(null);
  const animationRef = React.useRef(null);
  const audioContextRef = React.useRef(null);
  const analyserRef = React.useRef(null);
  const distortionMultiplier = React.useRef(1);
  const speedMultiplier = React.useRef(1);
  const sensitivityRef = React.useRef(2);
  const midiVelocityRef = React.useRef(0);
  const midiNoteRef = React.useRef(0);

  const [audioEnabled, setAudioEnabled] = React.useState(false);
  const [audioLevel, setAudioLevel] = React.useState(0);
  const [bassLevel, setBassLevel] = React.useState(0);
  const [gridCells, setGridCells] = React.useState([]);
  const [contextMenu, setContextMenu] = React.useState(null);
  const [isDrawing, setIsDrawing] = React.useState(false);
  const [midiEnabled, setMidiEnabled] = React.useState(false);
  const [midiDevices, setMidiDevices] = React.useState([]);
  const [audioDevices, setAudioDevices] = React.useState([]);
  const [selectedAudioDevice, setSelectedAudioDevice] = React.useState('');

  const [settings, setSettings] = React.useState({
    patternType: 'swiss-grid',
    lineThickness: 10,
    spacing: 20,
    distortionEnabled: false,
    distortionType: 'liquify',
    distortionStrength: 20,
    distortionSpeed: 1,
    pixelationEnabled: false,
    pixelSize: 4,
    audioSensitivity: 2,
    midiSensitivity: 1,
    dotSize: 8,
    shapeSize: 10,
    text: 'SOUND',
    fontSize: 40,
    charSequence: '01',
    charGridSize: 20,
    charCycleSpeed: 5,
    gridColumns: 12,
    gridRows: 16,
    gridPreset: 'Swiss Poster',
    drawMode: false,
    selectedElement: 'char',
    showGridLines: true,
    gridRotation: 0,
    cycleMode: 'crossfade',
    elementBehavior: 'static',
    easingFunction: 'fibonacci',
    stringBehavior: 'cycle',
    motionDamping: 0.8,
    charStagger: 0.15
  });

  const distortionTypes = [
    { value: 'liquify', label: 'Liquify Flow' },
    { value: 'ripple', label: 'Ripple Waves' },
    { value: 'swirl', label: 'Swirl Vortex' },
    { value: 'turbulence', label: 'Turbulence' },
    { value: 'marble', label: 'Marble Veins' },
    { value: 'wave', label: 'Wave Field' }
  ];
  
  const gridPresets = [
    { name: 'Swiss Poster', cols: 12, rows: 16 },
    { name: 'Magazine', cols: 16, rows: 20 },
    { name: 'Dense', cols: 24, rows: 18 },
    { name: 'Minimal', cols: 6, rows: 8 }
  ];

  const PHI = 1.618033988749895;
  const easingFunctions = {
    fibonacci: (t) => Math.pow(t, PHI - 1),
    goldenEaseOut: (t) => 1 - Math.pow(1 - t, PHI),
    appleEase: (t) => t < 0.5 ? 2 * t * t : -1 + (4 - 2 * t) * t
  };
  
  const applyEasing = (t) => {
    const easing = easingFunctions[settings.easingFunction] || easingFunctions.fibonacci;
    return easing(Math.max(0, Math.min(1, t)));
  };

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
        console.error('Failed');
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
              distortionMultiplier.current = 1 + (velocity / 127) * settings.midiSensitivity * 2;
            } else {
              midiVelocityRef.current = 0;
              distortionMultiplier.current = 1;
            }
          };
        }
        setMidiDevices(devices);
      } catch (err) {
        console.error('MIDI failed');
      }
    };
    initMIDI();
  }, [midiEnabled, settings.midiSensitivity]);

  React.useEffect(() => {
    if (!audioEnabled) {
      if (audioContextRef.current) audioContextRef.current.close();
      distortionMultiplier.current = 1;
      speedMultiplier.current = 1;
      setAudioLevel(0);
      setBassLevel(0);
      return;
    }
    const initAudio = async () => {
      try {
        const constraints = { audio: selectedAudioDevice ? { deviceId: { exact: selectedAudioDevice } } : true };
        const stream = await navigator.mediaDevices.getUserMedia(constraints);
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
          distortionMultiplier.current = 1.0 + overall * sensitivityRef.current * 0.5;
          speedMultiplier.current = 1.0 + overall * sensitivityRef.current * 0.5;
          requestAnimationFrame(updateAudio);
        };
        updateAudio();
      } catch (err) {
        alert('Audio denied');
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

  const generateRandomGrid = () => {
    const cells = [];
    const totalCells = settings.gridColumns * settings.gridRows;
    const numElements = Math.floor(totalCells * 0.3);
    const usedIndices = new Set();
    for (let i = 0; i < numElements; i++) {
      let index;
      do {
        index = Math.floor(Math.random() * totalCells);
      } while (usedIndices.has(index));
      usedIndices.add(index);
      cells.push({ index: index, type: ['char', 'dot', 'square'][Math.floor(Math.random() * 3)] });
    }
    setGridCells(cells);
  };
  
  const getCellFromClick = (canvasX, canvasY) => {
    const canvas = canvasRef.current;
    if (!canvas) return null;
    const cellWidth = canvas.width / settings.gridColumns;
    const cellHeight = canvas.height / settings.gridRows;
    const col = Math.floor(canvasX / cellWidth);
    const row = Math.floor(canvasY / cellHeight);
    if (col >= 0 && col < settings.gridColumns && row >= 0 && row < settings.gridRows) {
      return row * settings.gridColumns + col;
    }
    return null;
  };
  
  const handleCanvasClick = (e) => {
    if (settings.patternType !== 'swiss-grid') return;
    const canvas = canvasRef.current;
    const rect = canvas.getBoundingClientRect();
    const x = e.clientX - rect.left;
    const y = e.clientY - rect.top;
    const scaleX = canvas.width / rect.width;
    const scaleY = canvas.height / rect.height;
    const canvasX = x * scaleX;
    const canvasY = y * scaleY;
    const cellIndex = getCellFromClick(canvasX, canvasY);
    if (cellIndex === null) return;
    if (settings.drawMode) {
      setGridCells(prev => {
        const existing = prev.findIndex(c => c.index === cellIndex);
        if (existing === -1) {
          return [...prev, { index: cellIndex, type: settings.selectedElement }];
        }
        return prev;
      });
    } else {
      e.preventDefault();
      setContextMenu({ x: e.clientX, y: e.clientY, cellIndex });
    }
  };
  
  const handleCanvasMouseDown = (e) => {
    if (settings.patternType === 'swiss-grid' && settings.drawMode) {
      setIsDrawing(true);
      handleCanvasClick(e);
    }
  };
  
  const handleCanvasMouseMove = (e) => {
    if (!isDrawing || settings.patternType !== 'swiss-grid' || !settings.drawMode) return;
    const canvas = canvasRef.current;
    const rect = canvas.getBoundingClientRect();
    const x = e.clientX - rect.left;
    const y = e.clientY - rect.top;
    const scaleX = canvas.width / rect.width;
    const scaleY = canvas.height / rect.height;
    const canvasX = x * scaleX;
    const canvasY = y * scaleY;
    const cellIndex = getCellFromClick(canvasX, canvasY);
    if (cellIndex !== null) {
      setGridCells(prev => {
        const existing = prev.findIndex(c => c.index === cellIndex);
        if (existing === -1) {
          return [...prev, { index: cellIndex, type: settings.selectedElement }];
        }
        return prev;
      });
    }
  };
  
  const handleCanvasMouseUp = () => setIsDrawing(false);
  
  const addElement = (type) => {
    if (contextMenu) {
      const existing = gridCells.findIndex(c => c.index === contextMenu.cellIndex);
      if (existing >= 0) {
        const newCells = [...gridCells];
        newCells[existing] = { index: contextMenu.cellIndex, type };
        setGridCells(newCells);
      } else {
        setGridCells([...gridCells, { index: contextMenu.cellIndex, type }]);
      }
      setContextMenu(null);
    }
  };
  
  const removeElement = () => {
    if (contextMenu) {
      setGridCells(gridCells.filter(c => c.index !== contextMenu.cellIndex));
      setContextMenu(null);
    }
  };
  
  React.useEffect(() => {
    const closeMenu = () => setContextMenu(null);
    window.addEventListener('click', closeMenu);
    return () => window.removeEventListener('click', closeMenu);
  }, []);

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
    const midiInfluence = midiVelocityRef.current * settings.midiSensitivity;
    const audioDistortionStrength = settings.distortionStrength * distortionMultiplier.current;
    const targetDamping = 1.0 - (bassLevel + midiInfluence) * 0.7;
    const currentDamping = settings.motionDamping + (targetDamping - settings.motionDamping) * 0.1;
    
    if (settings.patternType === 'vertical-lines') {
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
    } else if (settings.patternType === 'dots') {
      const dotSize = settings.dotSize * (1 + (bassLevel + midiInfluence) * 0.5);
      for (let y = 0; y < height; y += settings.spacing) {
        for (let x = 0; x < width; x += settings.spacing) {
          let drawX = x, drawY = y;
          if (settings.distortionEnabled) {
            const d = getDistortion(x - width/2, y - height/2, animTime, audioDistortionStrength, settings.distortionType);
            drawX += d.x;
            drawY += d.y;
          }
          ctx.beginPath();
          ctx.arc(drawX, drawY, dotSize, 0, Math.PI * 2);
          ctx.fill();
        }
      }
    } else if (settings.patternType === 'squares') {
      const shapeSize = settings.shapeSize * (1 + (bassLevel + midiInfluence) * 0.5);
      for (let y = 0; y < height; y += settings.spacing) {
        for (let x = 0; x < width; x += settings.spacing) {
          let drawX = x, drawY = y;
          if (settings.distortionEnabled) {
            const d = getDistortion(x - width/2, y - height/2, animTime, audioDistortionStrength, settings.distortionType);
            drawX += d.x;
            drawY += d.y;
          }
          const halfSize = shapeSize / 2;
          ctx.fillRect(drawX - halfSize, drawY - halfSize, shapeSize, shapeSize);
        }
      }
    } else if (settings.patternType === 'text') {
      ctx.font = `${settings.fontSize}px monospace`;
      ctx.textAlign = 'center';
      ctx.textBaseline = 'middle';
      const audioSpacing = settings.spacing * (1 + (bassLevel + midiInfluence) * 0.5);
      for (let y = 0; y < height; y += audioSpacing) {
        for (let x = 0; x < width; x += audioSpacing) {
          let drawX = x, drawY = y;
          if (settings.distortionEnabled) {
            const d = getDistortion(x - width/2, y - height/2, animTime, audioDistortionStrength, settings.distortionType);
            drawX += d.x;
            drawY += d.y;
          }
          ctx.save();
          ctx.translate(drawX, drawY);
          const scalePhase = (bassLevel + midiInfluence) * 0.5;
          const easedScale = 1 + applyEasing(scalePhase) * 0.4;
          ctx.scale(easedScale, easedScale);
          if (midiNoteRef.current > 0) {
            const rotation = (midiNoteRef.current / 127) * Math.PI * 2;
            ctx.rotate(rotation * currentDamping);
          }
          ctx.fillText(settings.text, 0, 0);
          ctx.restore();
        }
      }
    } else if (settings.patternType === 'char-grid') {
      ctx.font = `${settings.charGridSize}px monospace`;
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
              const posOffset = rowIndex * 7 + colIndex * 3;
              charIndex = (posOffset + Math.floor(localCycleTime)) % chars.length;
            } else if (settings.stringBehavior === 'wave') {
              const wave = Math.sin((colIndex + rowIndex + localCycleTime) * 0.5);
              charIndex = Math.floor((wave + 1) * 0.5 * chars.length) % chars.length;
            } else {
              const seed = rowIndex * 1000 + colIndex + Math.floor(localCycleTime);
              charIndex = Math.floor((Math.sin(seed) * 0.5 + 0.5) * chars.length);
            }
            const char = chars[charIndex];
            ctx.save();
            ctx.translate(x, y);
            const scalePhase = (bassLevel + midiInfluence) * 0.3;
            const easedScale = 1 + applyEasing(scalePhase) * 0.5;
            ctx.scale(easedScale, easedScale);
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
      const adaptiveCharSize = Math.min(cellWidth, cellHeight) * 0.6;
      const gridRotation = settings.gridRotation + (bassLevel + midiInfluence) * 45;
      if (settings.showGridLines) {
        ctx.strokeStyle = '#e5e5e5';
        ctx.lineWidth = 0.5;
        ctx.globalAlpha = 0.3;
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
        ctx.globalAlpha = 1;
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
        const morphPhase = (localTime + cell.index * 0.1) % 1;
        const audioBoost = (bassLevel + midiInfluence) * 0.4;
        const easedMorph = applyEasing(morphPhase + audioBoost);
        ctx.save();
        ctx.translate(centerX, centerY);
        if (gridRotation !== 0) {
          ctx.rotate((gridRotation * Math.PI) / 180);
        }
        if (settings.elementBehavior === 'orbit') {
          const orbitRadius = Math.min(cellWidth, cellHeight) * 0.2 + audioBoost * 10;
          const orbitAngle = localTime * 2;
          ctx.translate(Math.cos(orbitAngle) * orbitRadius * currentDamping, Math.sin(orbitAngle) * orbitRadius * currentDamping);
        } else if (settings.elementBehavior === 'bounce') {
          const bounceAmount = Math.abs(Math.sin(localTime * 3)) * (Math.min(cellWidth, cellHeight) * 0.3 + audioBoost * 10);
          ctx.translate(0, -bounceAmount * currentDamping);
        }
        if (cell.type === 'char' && chars.length > 0) {
          ctx.font = `${adaptiveCharSize}px monospace`;
          ctx.textAlign = 'center';
          ctx.textBaseline = 'middle';
          if (settings.cycleMode === 'crossfade') {
            const charIndexFloat = (localTime * 2) % chars.length;
            const currentIndex = Math.floor(charIndexFloat);
            const nextIndex = (currentIndex + 1) % chars.length;
            const morphProgress = charIndexFloat - currentIndex;
            const easedProgress = applyEasing(morphProgress);
            ctx.globalAlpha = 1 - easedProgress;
            const scale1 = 1 - easedProgress * 0.3 + audioBoost * 0.2;
            ctx.save();
            ctx.scale(scale1, scale1);
            ctx.fillText(chars[currentIndex], 0, 0);
            ctx.restore();
            ctx.globalAlpha = easedProgress;
            const scale2 = 0.7 + easedProgress * 0.3 + audioBoost * 0.2;
            ctx.save();
            ctx.scale(scale2, scale2);
            ctx.fillText(chars[nextIndex], 0, 0);
            ctx.restore();
            ctx.globalAlpha = 1;
          } else {
            const charIndex = Math.floor(localTime * 2) % chars.length;
            const scale = 1 + audioBoost * 0.3;
            ctx.scale(scale, scale);
            ctx.fillText(chars[charIndex], 0, 0);
          }
        } else if (cell.type === 'dot') {
          const radius = Math.min(cellWidth, cellHeight) * 0.25 + audioBoost * 8;
          const morphState = easedMorph * 3;
          ctx.beginPath();
          if (morphState < 1) {
            const t = morphState;
            const points = 5;
            const innerRadius = radius * (0.4 + t * 0.2);
            for (let i = 0; i < points * 2; i++) {
              const angle = (i * Math.PI) / points - Math.PI / 2;
              const r = i % 2 === 0 ? radius : innerRadius;
              const x = Math.cos(angle) * r;
              const y = Math.sin(angle) * r;
              if (i === 0) ctx.moveTo(x, y);
              else ctx.lineTo(x, y);
            }
          } else {
            ctx.arc(0, 0, radius, 0, Math.PI * 2);
          }
          ctx.closePath();
          ctx.fill();
        } else if (cell.type === 'square') {
          const size = Math.min(cellWidth, cellHeight) * 0.5 + audioBoost * 15;
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
  }, [settings, gridCells, bassLevel, audioLevel]);

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

  React.useEffect(() => {
    generateRandomGrid();
  }, []);

  return (
    <div className="w-full h-screen bg-gray-50 flex">
      <div className="w-80 bg-white shadow-xl p-4 overflow-y-auto space-y-4 text-sm">
        <div className="flex gap-2">
          <button onClick={generateRandomGrid} className="flex items-center gap-2 px-3 py-2 bg-blue-600 text-white rounded-lg font-medium hover:bg-blue-700">
            <RotateCcw size={14} /> Random
          </button>
          <button onClick={() => {
            const link = document.createElement('a');
            link.download = 'pattern.png';
            link.href = canvasRef.current.toDataURL();
            link.click();
          }} className="flex items-center gap-2 px-3 py-2 bg-purple-600 text-white rounded-lg font-medium hover:bg-purple-700">
            <Download size={14} /> Save
          </button>
        </div>

        <div>
          <label className="block font-semibold mb-2">Pattern Type</label>
          <select value={settings.patternType} onChange={(e) => setSettings(s => ({ ...s, patternType: e.target.value }))} className="w-full p-2 border rounded">
            <option value="vertical-lines">Vertical Lines</option>
            <option value="horizontal-lines">Horizontal Lines</option>
            <option value="dots">Dots</option>
            <option value="squares">Squares</option>
            <option value="text">Text</option>
            <option value="char-grid">Character Grid</option>
            <option value="swiss-grid">Swiss Grid</option>
          </select>
        </div>

        {settings.patternType === 'vertical-lines' && (
          <div>
            <label className="block mb-2">Thickness: {settings.lineThickness}</label>
            <input type="range" min="2" max="30" value={settings.lineThickness} onChange={(e) => setSettings(s => ({ ...s, lineThickness: parseFloat(e.target.value) }))} className="w-full" />
          </div>
        )}

        {settings.patternType === 'text' && (
          <>
            <div>
              <label className="block mb-2">Text</label>
              <input type="text" value={settings.text} onChange={(e) => setSettings(s => ({ ...s, text: e.target.value }))} className="w-full p-2 border rounded" />
            </div>
            <div>
              <label className="block mb-2">Size: {settings.fontSize}</label>
              <input type="range" min="20" max="100" value={settings.fontSize} onChange={(e) => setSettings(s => ({ ...s, fontSize: parseInt(e.target.value) }))} className="w-full" />
            </div>
          </>
        )}

        <div>
          <label className="block font-semibold mb-2">Audio</label>
          <label className="flex items-center gap-2 mb-2">
            <input type="checkbox" checked={audioEnabled} onChange={(e) => setAudioEnabled(e.target.checked)} />
            Enable Audio
          </label>
          {audioDevices.length > 0 && (
            <select value={selectedAudioDevice} onChange={(e) => setSelectedAudioDevice(e.target.value)} className="w-full p-2 border rounded mb-2">
              {audioDevices.map(d => <option key={d.deviceId} value={d.deviceId}>{d.label || `Device ${d.deviceId.slice(0,8)}`}</option>)}
            </select>
          )}
          {audioEnabled && (
            <div className="space-y-2">
              <div className="flex justify-between text-xs">
                <span>Level</span>
                <span>{(audioLevel * 100).toFixed(0)}%</span>
              </div>
              <div className="w-full h-2 bg-gray-200 rounded">
                <div className="h-full bg-blue-500 rounded" style={{ width: `${audioLevel * 100}%` }} />
              </div>
              <div className="flex justify-between text-xs">
                <span>Bass</span>
                <span>{(bassLevel * 100).toFixed(0)}%</span>
              </div>
              <div className="w-full h-2 bg-gray-200 rounded">
                <div className="h-full bg-purple-500 rounded" style={{ width: `${bassLevel * 100}%` }} />
              </div>
            </div>
          )}
        </div>

        <div>
          <label className="block font-semibold mb-2">MIDI</label>
          <label className="flex items-center gap-2">
            <input type="checkbox" checked={midiEnabled} onChange={(e) => setMidiEnabled(e.target.checked)} />
            Enable MIDI
          </label>
          {midiEnabled && midiDevices.length > 0 && (
            <div className="text-xs text-green-600 mt-1">{midiDevices.length} device(s)</div>
          )}
        </div>

        <div>
          <label className="block font-semibold mb-2">Distortion</label>
          <label className="flex items-center gap-2 mb-2">
            <input type="checkbox" checked={settings.distortionEnabled} onChange={(e) => setSettings(s => ({ ...s, distortionEnabled: e.target.checked }))} />
            Enable
          </label>
          {settings.distortionEnabled && (
            <>
              <select value={settings.distortionType} onChange={(e) => setSettings(s => ({ ...s, distortionType: e.target.value }))} className="w-full p-2 border rounded mb-2">
                {distortionTypes.map(t => <option key={t.value} value={t.value}>{t.label}</option>)}
              </select>
              <div>
                <label className="block mb-2">Strength: {settings.distortionStrength}</label>
                <input type="range" min="5" max="80" value={settings.distortionStrength} onChange={(e) => setSettings(s => ({ ...s, distortionStrength: parseInt(e.target.value) }))} className="w-full" />
              </div>
            </>
          )}
        </div>

        {settings.patternType === 'swiss-grid' && (
          <>
            <div>
              <label className="block font-semibold mb-2">Grid</label>
              <select value={settings.gridPreset} onChange={(e) => {
                const preset = gridPresets.find(p => p.name === e.target.value);
                if (preset) setSettings(s => ({ ...s, gridPreset: e.target.value, gridColumns: preset.cols, gridRows: preset.rows }));
              }} className="w-full p-2 border rounded mb-2">
                {gridPresets.map(p => <option key={p.name} value={p.name}>{p.name}</option>)}
              </select>
              <div className="mb-2">
                <label className="block mb-1">Columns: {settings.gridColumns}</label>
                <input type="range" min="4" max="60" value={settings.gridColumns} onChange={(e) => setSettings(s => ({ ...s, gridColumns: parseInt(e.target.value) }))} className="w-full" />
              </div>
              <div>
                <label className="block mb-1">Rows: {settings.gridRows}</label>
                <input type="range" min="4" max="60" value={settings.gridRows} onChange={(e) => setSettings(s => ({ ...s, gridRows: parseInt(e.target.value) }))} className="w-full" />
              </div>
            </div>

            <div>
              <label className="block font-semibold mb-2">Draw Mode</label>
              <label className="flex items-center gap-2 mb-2">
                <input type="checkbox" checked={settings.drawMode} onChange={(e) => setSettings(s => ({ ...s, drawMode: e.target.checked }))} />
                Enable
              </label>
              <button onClick={() => setGridCells([])} className="w-full px-3 py-2 bg-red-600 text-white rounded font-medium">Clear Grid</button>
            </div>

            <div>
              <label className="block font-semibold mb-2">Animation</label>
              <div className="mb-2">
                <label className="block mb-1">Characters</label>
                <input type="text" value={settings.charSequence} onChange={(e) => setSettings(s => ({ ...s, charSequence: e.target.value }))} className="w-full p-2 border rounded font-mono" />
              </div>
              <div className="mb-2">
                <label className="block mb-1">Behavior</label>
                <select value={settings.elementBehavior} onChange={(e) => setSettings(s => ({ ...s, elementBehavior: e.target.value }))} className="w-full p-2 border rounded">
                  <option value="static">Static</option>
                  <option value="orbit">Orbit</option>
                  <option value="bounce">Bounce</option>
                </select>
              </div>
            </div>
          </>
        )}

        {settings.patternType === 'char-grid' && (
          <div>
            <label className="block font-semibold mb-2">String Behavior</label>
            <select value={settings.stringBehavior} onChange={(e) => setSettings(s => ({ ...s, stringBehavior: e.target.value }))} className="w-full p-2 border rounded">
              <option value="cycle">Cycle</option>
              <option value="wave">Wave</option>
              <option value="random">Random</option>
            </select>
          </div>
        )}
      </div>

      <div className="flex-1 p-8 relative">
        <canvas 
          ref={canvasRef} 
          className="w-full h-full border bg-white rounded-xl shadow-2xl cursor-crosshair" 
          onClick={handleCanvasClick}
          onMouseDown={handleCanvasMouseDown}
          onMouseMove={handleCanvasMouseMove}
          onMouseUp={handleCanvasMouseUp}
          onMouseLeave={handleCanvasMouseUp}
        />
        {contextMenu && (
          <div className="fixed bg-white shadow-2xl rounded-lg border py-1 z-50" style={{ left: contextMenu.x, top: contextMenu.y }} onClick={(e) => e.stopPropagation()}>
            <button onClick={() => addElement('char')} className="block w-full px-4 py-2 text-left hover:bg-gray-100">Add Char</button>
            <button onClick={() => addElement('dot')} className="block w-full px-4 py-2 text-left hover:bg-gray-100">Add Dot</button>
            <button onClick={() => addElement('square')} className="block w-full px-4 py-2 text-left hover:bg-gray-100">Add Square</button>
            <div className="border-t my-1"></div>
            <button onClick={removeElement} className="block w-full px-4 py-2 text-left hover:bg-red-50 text-red-600">Remove</button>
          </div>
        )}
      </div>
    </div>
  );
};

export default GenerativePatternSystem;
