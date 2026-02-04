import React from 'react';
import { RotateCcw, Download } from 'lucide-react';

const PixelMoireGenerator = () => {
  // All refs
  const canvasRef = React.useRef(null);
  const animationRef = React.useRef(null);
  const audioContextRef = React.useRef(null);
  const analyserRef = React.useRef(null);
  const distortionMultiplier = React.useRef(1);
  const speedMultiplier = React.useRef(1);
  const sensitivityRef = React.useRef(2);
  const svgImageRef = React.useRef(null);
  const midiAccessRef = React.useRef(null);
  const midiVelocityRef = React.useRef(0);
  const midiNoteRef = React.useRef(0);

  // All state
  const [audioEnabled, setAudioEnabled] = React.useState(false);
  const [audioLevel, setAudioLevel] = React.useState(0);
  const [bassLevel, setBassLevel] = React.useState(0);
  const [customSvg, setCustomSvg] = React.useState(null);
  const [customFont, setCustomFont] = React.useState(null);
  const [gridCells, setGridCells] = React.useState([]);
  const [contextMenu, setContextMenu] = React.useState(null);
  const [isDrawing, setIsDrawing] = React.useState(false);
  const [midiEnabled, setMidiEnabled] = React.useState(false);
  const [midiDevices, setMidiDevices] = React.useState([]);

  const [settings, setSettings] = React.useState({
    patternType: 'vertical-lines',
    lineThickness: 10,
    spacing: 20,
    distortionEnabled: false,
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
    charCycleSpeed: 5,
    gridColumns: 8,
    gridRows: 6,
    gridPreset: 'custom',
    drawMode: false,
    selectedElement: 'char',
    showGridLines: true,
    gridRotation: 0,
    cycleMode: 'independent',
    elementBehavior: 'static',
    midiSensitivity: 1,
    easingFunction: 'fibonacci',
    stringBehavior: 'cycle',
    motionDamping: 0.8,
    charStagger: 0.1
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
  
  const gridPresets = [
    { name: 'Custom', cols: 8, rows: 6 },
    { name: 'Swiss Poster', cols: 12, rows: 16 },
    { name: 'Magazine', cols: 16, rows: 20 },
    { name: 'Minimal', cols: 6, rows: 8 },
    { name: 'Dense', cols: 24, rows: 18 },
    { name: 'Ultra Dense', cols: 40, rows: 30 },
    { name: 'Golden', cols: 13, rows: 8 }
  ];

  // Fibonacci easing
  const PHI = 1.618033988749895;
  const easingFunctions = {
    appleEase: (t) => t < 0.5 ? 2 * t * t : -1 + (4 - 2 * t) * t,
    fibonacci: (t) => Math.pow(t, PHI - 1),
    goldenEaseOut: (t) => 1 - Math.pow(1 - t, PHI),
    goldenEaseIn: (t) => Math.pow(t, PHI),
    fibonacciSpring: (t) => {
      const c4 = (2 * Math.PI) / PHI;
      return t === 0 ? 0 : t === 1 ? 1 : Math.pow(2, -10 * t) * Math.sin((t * 10 - 0.75) * c4) + 1;
    },
    appleElastic: (t) => {
      const c4 = (2 * Math.PI) / 3;
      return t === 0 ? 0 : t === 1 ? 1 : Math.pow(2, -8 * t) * Math.sin((t * 8 - 0.75) * c4) + 1;
    }
  };
  
  const applyEasing = (t) => {
    const easing = easingFunctions[settings.easingFunction] || easingFunctions.fibonacci;
    return easing(Math.max(0, Math.min(1, t)));
  };

  // Load fonts
  React.useEffect(() => {
    const link = document.createElement('link');
    link.href = 'https://fonts.googleapis.com/css2?family=Roboto:wght@900&family=Open+Sans:wght@800&family=Montserrat:wght@900&family=Bebas+Neue&family=Anton&display=swap';
    link.rel = 'stylesheet';
    document.head.appendChild(link);
  }, []);

  // MIDI
  React.useEffect(() => {
    if (!midiEnabled) {
      midiVelocityRef.current = 0;
      midiNoteRef.current = 0;
      return;
    }

    const initMIDI = async () => {
      try {
        const access = await navigator.requestMIDIAccess();
        midiAccessRef.current = access;
        
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
            } else if (command === 8 || (command === 9 && velocity === 0)) {
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

  // Audio
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
          distortionMultiplier.current = 1.0 + overall * sensitivityRef.current * 0.5;
          speedMultiplier.current = 1.0 + overall * sensitivityRef.current * 0.5;
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
      cells.push({
        index: index,
        type: ['char', 'dot', 'square'][Math.floor(Math.random() * 3)]
      });
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
  
  const handleCanvasMouseUp = () => {
    setIsDrawing(false);
  };
  
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
          ctx.scale(1 + (bassLevel + midiInfluence) * 0.3, 1 + (bassLevel + midiInfluence) * 0.3);
          ctx.fillText(settings.text, 0, 0);
          ctx.restore();
        }
      }
    } else if (settings.patternType === 'char-grid') {
      ctx.font = `${settings.charGridSize}px "${settings.font}", monospace`;
      ctx.textAlign = 'center';
      ctx.textBaseline = 'middle';
      const chars = settings.charSequence.split('');
      if (chars.length > 0) {
        const cycleTime = time * 0.001 * settings.charCycleSpeed;
        
        let rowIndex = 0;
        for (let y = 0; y < height; y += settings.spacing) {
          let colIndex = 0;
          for (let x = 0; x < width; x += settings.spacing) {
            const posOffset = rowIndex * 7 + colIndex * 3;
            const charIndex = (posOffset + Math.floor(cycleTime)) % chars.length;
            const char = chars[charIndex];
            
            ctx.save();
            ctx.translate(x, y);
            ctx.scale(1 + (bassLevel + midiInfluence) * 0.3, 1 + (bassLevel + midiInfluence) * 0.3);
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
      
      if (settings.showGridLines) {
        ctx.strokeStyle = '#cccccc';
        ctx.lineWidth = 1;
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
      
      gridCells.forEach(cell => {
        const col = cell.index % settings.gridColumns;
        const row = Math.floor(cell.index / settings.gridColumns);
        const centerX = col * cellWidth + cellWidth / 2;
        const centerY = row * cellHeight + cellHeight / 2;
        
        // Generative morphing parameters
        const morphPhase = (cycleTime + cell.index * 0.1) % 1;
        const easedMorph = applyEasing(morphPhase);
        
        ctx.save();
        ctx.translate(centerX, centerY);
        
        if (cell.type === 'char' && chars.length > 0) {
          ctx.font = `${settings.charGridSize}px "${settings.font}", monospace`;
          ctx.textAlign = 'center';
          ctx.textBaseline = 'middle';
          
          // Morph between characters smoothly
          const charIndexFloat = (cycleTime + cell.index * 0.2) % chars.length;
          const currentIndex = Math.floor(charIndexFloat);
          const nextIndex = (currentIndex + 1) % chars.length;
          const morphProgress = charIndexFloat - currentIndex;
          const easedProgress = applyEasing(morphProgress);
          
          // Fade out current char
          ctx.globalAlpha = 1 - easedProgress;
          const scale1 = 1 - easedProgress * 0.3;
          ctx.scale(scale1, scale1);
          ctx.fillText(chars[currentIndex], 0, 0);
          
          // Fade in next char
          ctx.scale(1/scale1, 1/scale1);
          ctx.globalAlpha = easedProgress;
          const scale2 = 0.7 + easedProgress * 0.3;
          ctx.scale(scale2, scale2);
          ctx.fillText(chars[nextIndex], 0, 0);
          
        } else if (cell.type === 'dot') {
          // Morph: circle → star → pentagon → circle
          const sides = 3 + morphPhase * 5; // 3 to 8 sides
          const radius = 12;
          const innerRadius = radius * (0.5 + easedMorph * 0.3);
          
          ctx.beginPath();
          for (let i = 0; i < Math.floor(sides) * 2; i++) {
            const angle = (i * Math.PI) / Math.floor(sides);
            const r = i % 2 === 0 ? radius : innerRadius;
            const x = Math.cos(angle) * r;
            const y = Math.sin(angle) * r;
            if (i === 0) ctx.moveTo(x, y);
            else ctx.lineTo(x, y);
          }
          ctx.closePath();
          ctx.fill();
          
        } else if (cell.type === 'square') {
          // Morph: square → octagon → circle → triangle → square
          const size = 30;
          const phase = morphPhase * 4; // 4 distinct shapes
          
          if (phase < 1) {
            // Square to octagon
            const t = applyEasing(phase);
            const cut = t * 8;
            ctx.beginPath();
            ctx.moveTo(-size/2 + cut, -size/2);
            ctx.lineTo(size/2 - cut, -size/2);
            ctx.lineTo(size/2, -size/2 + cut);
            ctx.lineTo(size/2, size/2 - cut);
            ctx.lineTo(size/2 - cut, size/2);
            ctx.lineTo(-size/2 + cut, size/2);
            ctx.lineTo(-size/2, size/2 - cut);
            ctx.lineTo(-size/2, -size/2 + cut);
            ctx.closePath();
            ctx.fill();
          } else if (phase < 2) {
            // Octagon to circle
            const t = applyEasing(phase - 1);
            const sides = Math.floor(8 + t * 24); // 8 to 32 sides (approaches circle)
            ctx.beginPath();
            for (let i = 0; i < sides; i++) {
              const angle = (i * 2 * Math.PI) / sides;
              const x = Math.cos(angle) * size/2;
              const y = Math.sin(angle) * size/2;
              if (i === 0) ctx.moveTo(x, y);
              else ctx.lineTo(x, y);
            }
            ctx.closePath();
            ctx.fill();
          } else if (phase < 3) {
            // Circle to triangle
            const t = applyEasing(phase - 2);
            const sides = Math.floor(32 - t * 29); // 32 to 3 sides
            ctx.beginPath();
            for (let i = 0; i < sides; i++) {
              const angle = (i * 2 * Math.PI) / sides;
              const x = Math.cos(angle) * size/2;
              const y = Math.sin(angle) * size/2;
              if (i === 0) ctx.moveTo(x, y);
              else ctx.lineTo(x, y);
            }
            ctx.closePath();
            ctx.fill();
          } else {
            // Triangle to square
            const t = applyEasing(phase - 3);
            const sides = Math.floor(3 + t * 1); // 3 to 4 sides
            ctx.beginPath();
            for (let i = 0; i < sides; i++) {
              const angle = (i * 2 * Math.PI) / sides - Math.PI/2;
              const x = Math.cos(angle) * size/2;
              const y = Math.sin(angle) * size/2;
              if (i === 0) ctx.moveTo(x, y);
              else ctx.lineTo(x, y);
            }
            ctx.closePath();
            ctx.fill();
          }
        }
        
        ctx.restore();
      });
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
  }, [settings, gridCells]);

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
          <button onClick={() => setSettings(s => ({ ...s, lineThickness: Math.random() * 15 + 5 }))} className="flex items-center gap-1 px-3 py-2 bg-green-500 text-white rounded text-sm">
            <RotateCcw size={14} /> Random
          </button>
          <button onClick={() => { const link = document.createElement('a'); link.download = 'pattern.png'; link.href = canvasRef.current.toDataURL(); link.click(); }} className="flex items-center gap-1 px-3 py-2 bg-purple-500 text-white rounded text-sm">
            <Download size={14} /> Save
          </button>
        </div>

        <div>
          <h3 className="font-semibold mb-2">MIDI</h3>
          <label className="flex items-center mb-2">
            <input type="checkbox" checked={midiEnabled} onChange={(e) => setMidiEnabled(e.target.checked)} className="mr-2" />
            Enable MIDI
          </label>
          {midiEnabled && midiDevices.length > 0 && (
            <div className="text-xs text-green-600">{midiDevices.length} device(s) connected</div>
          )}
        </div>

        <div>
          <h3 className="font-semibold mb-2">Audio</h3>
          <label className="flex items-center mb-2">
            <input type="checkbox" checked={audioEnabled} onChange={(e) => setAudioEnabled(e.target.checked)} className="mr-2" />
            Enable Audio
          </label>
        </div>

        <div>
          <h3 className="font-semibold mb-2">Pattern</h3>
          <select value={settings.patternType} onChange={(e) => setSettings(s => ({ ...s, patternType: e.target.value }))} className="w-full p-2 border rounded text-sm">
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
            <label className="block text-sm">Thickness: {settings.lineThickness.toFixed(1)}</label>
            <input type="range" min="2" max="30" value={settings.lineThickness} onChange={(e) => setSettings(s => ({ ...s, lineThickness: parseFloat(e.target.value) }))} className="w-full" />
          </div>
        )}
        
        {settings.patternType === 'horizontal-lines' && (
          <div>
            <label className="block text-sm">Thickness: {settings.lineThickness.toFixed(1)}</label>
            <input type="range" min="2" max="30" value={settings.lineThickness} onChange={(e) => setSettings(s => ({ ...s, lineThickness: parseFloat(e.target.value) }))} className="w-full" />
          </div>
        )}

        {settings.patternType === 'text' && (
          <div className="space-y-2">
            <div>
              <label className="block text-sm">Text</label>
              <input type="text" value={settings.text} onChange={(e) => setSettings(s => ({ ...s, text: e.target.value }))} className="w-full p-2 border rounded text-sm" />
            </div>
            <div>
              <label className="block text-sm">Font Size: {settings.fontSize}</label>
              <input type="range" min="20" max="100" value={settings.fontSize} onChange={(e) => setSettings(s => ({ ...s, fontSize: parseInt(e.target.value) }))} className="w-full" />
            </div>
          </div>
        )}

        <div>
          <label className="block text-sm">Spacing: {settings.spacing.toFixed(1)}</label>
          <input type="range" min="10" max="60" value={settings.spacing} onChange={(e) => setSettings(s => ({ ...s, spacing: parseFloat(e.target.value) }))} className="w-full" />
        </div>

        {settings.patternType === 'char-grid' && (
          <div className="space-y-2">
            <div>
              <label className="block text-sm">Character Sequence</label>
              <input type="text" value={settings.charSequence} onChange={(e) => setSettings(s => ({ ...s, charSequence: e.target.value }))} className="w-full p-2 border rounded text-sm font-mono" />
            </div>
            <div>
              <label className="block text-sm">Size: {settings.charGridSize}</label>
              <input type="range" min="10" max="60" value={settings.charGridSize} onChange={(e) => setSettings(s => ({ ...s, charGridSize: parseInt(e.target.value) }))} className="w-full" />
            </div>
          </div>
        )}

        {settings.patternType === 'swiss-grid' && (
          <div className="space-y-2">
            <div>
              <label className="block text-sm">Grid Preset</label>
              <select value={settings.gridPreset} onChange={(e) => {
                const preset = gridPresets.find(p => p.name === e.target.value);
                if (preset) {
                  setSettings(s => ({ ...s, gridPreset: e.target.value, gridColumns: preset.cols, gridRows: preset.rows }));
                }
              }} className="w-full p-2 border rounded text-sm">
                {gridPresets.map(p => <option key={p.name} value={p.name}>{p.name}</option>)}
              </select>
            </div>
            <div>
              <label className="block text-sm">Columns: {settings.gridColumns}</label>
              <input type="range" min="2" max="60" value={settings.gridColumns} onChange={(e) => setSettings(s => ({ ...s, gridColumns: parseInt(e.target.value) }))} className="w-full" />
            </div>
            <div>
              <label className="block text-sm">Rows: {settings.gridRows}</label>
              <input type="range" min="2" max="60" value={settings.gridRows} onChange={(e) => setSettings(s => ({ ...s, gridRows: parseInt(e.target.value) }))} className="w-full" />
            </div>
            <div>
              <label className="flex items-center">
                <input type="checkbox" checked={settings.showGridLines} onChange={(e) => setSettings(s => ({ ...s, showGridLines: e.target.checked }))} className="mr-2" />
                Show Grid Lines
              </label>
            </div>
            <div className="border-t pt-2">
              <h4 className="font-semibold text-sm mb-2">Draw Mode</h4>
              <label className="flex items-center mb-2">
                <input type="checkbox" checked={settings.drawMode} onChange={(e) => setSettings(s => ({ ...s, drawMode: e.target.checked }))} className="mr-2" />
                Enable (Click & Drag)
              </label>
              {settings.drawMode && (
                <div>
                  <label className="block text-sm">Brush Element</label>
                  <select value={settings.selectedElement} onChange={(e) => setSettings(s => ({ ...s, selectedElement: e.target.value }))} className="w-full p-2 border rounded text-sm">
                    <option value="char">Character</option>
                    <option value="dot">Dot</option>
                    <option value="square">Square</option>
                  </select>
                </div>
              )}
            </div>
            <button onClick={generateRandomGrid} className="w-full px-3 py-2 bg-blue-500 text-white rounded text-sm">
              Generate Random
            </button>
            <button onClick={() => setGridCells([])} className="w-full px-3 py-2 bg-red-500 text-white rounded text-sm">
              Clear Grid
            </button>
            <div>
              <label className="block text-sm">Character Sequence</label>
              <input type="text" value={settings.charSequence} onChange={(e) => setSettings(s => ({ ...s, charSequence: e.target.value }))} className="w-full p-2 border rounded text-sm font-mono" placeholder="01 or abc" />
            </div>
          </div>
        )}

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
              <div>
                <label className="block text-sm">Strength: {settings.distortionStrength}</label>
                <input type="range" min="5" max="80" value={settings.distortionStrength} onChange={(e) => setSettings(s => ({ ...s, distortionStrength: parseInt(e.target.value) }))} className="w-full" />
              </div>
              <div>
                <label className="block text-sm">Speed: {settings.distortionSpeed}</label>
                <input type="range" min="0.1" max="3" step="0.1" value={settings.distortionSpeed} onChange={(e) => setSettings(s => ({ ...s, distortionSpeed: parseFloat(e.target.value) }))} className="w-full" />
              </div>
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
              <label className="block text-sm">Pixel Size: {settings.pixelSize}</label>
              <input type="range" min="2" max="12" value={settings.pixelSize} onChange={(e) => setSettings(s => ({ ...s, pixelSize: parseInt(e.target.value) }))} className="w-full" />
            </div>
          )}
        </div>
      </div>

      <div className="flex-1 p-4 relative">
        <canvas 
          ref={canvasRef} 
          className="w-full h-full border bg-white rounded-lg shadow-lg cursor-crosshair" 
          onClick={handleCanvasClick}
          onMouseDown={handleCanvasMouseDown}
          onMouseMove={handleCanvasMouseMove}
          onMouseUp={handleCanvasMouseUp}
          onMouseLeave={handleCanvasMouseUp}
        />
        
        {contextMenu && (
          <div 
            className="fixed bg-white shadow-lg rounded-lg border border-gray-300 py-1 z-50"
            style={{ left: contextMenu.x, top: contextMenu.y }}
            onClick={(e) => e.stopPropagation()}
          >
            <button onClick={() => addElement('char')} className="block w-full px-4 py-2 text-left hover:bg-gray-100 text-sm">
              Add Character
            </button>
            <button onClick={() => addElement('dot')} className="block w-full px-4 py-2 text-left hover:bg-gray-100 text-sm">
              Add Dot
            </button>
            <button onClick={() => addElement('square')} className="block w-full px-4 py-2 text-left hover:bg-gray-100 text-sm">
              Add Square
            </button>
            <div className="border-t border-gray-200 my-1"></div>
            <button onClick={removeElement} className="block w-full px-4 py-2 text-left hover:bg-red-100 text-sm text-red-600">
              Remove Element
            </button>
          </div>
        )}
      </div>
    </div>
  );
};

export default PixelMoireGenerator;
