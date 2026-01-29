import React, { useState, useEffect, useRef } from 'react';
import { Play, Pause, RotateCcw, Download, Type, Grid } from 'lucide-react';

const PixelMoireGenerator = () => {
  const canvasRef = useRef(null);
  const animationRef = useRef(null);
  const [isAnimating, setIsAnimating] = useState(false);
  const [customFonts, setCustomFonts] = useState([]);
  const [activeSettings, setActiveSettings] = useState(null);
  const [targetSettings, setTargetSettings] = useState(null);
  const transitionProgress = useRef(0);
  const transitionSpeed = 0.08;
  const previousPattern = useRef(null);
  const currentPattern = useRef(null);
  const [audioEnabled, setAudioEnabled] = useState(false);
  const [audioDevices, setAudioDevices] = useState([]);
  const [selectedAudioDevice, setSelectedAudioDevice] = useState(null);
  const audioContextRef = useRef(null);
  const analyserRef = useRef(null);
  const [audioLevel, setAudioLevel] = useState(0);
  const [audioFrequency, setAudioFrequency] = useState(0);
  const [bassLevel, setBassLevel] = useState(0);
  const [midLevel, setMidLevel] = useState(0);
  const [highLevel, setHighLevel] = useState(0);
  const animationFrameRef = useRef(null);

  const systemFonts = [
    'Impact',
    'Arial Black', 
    'Helvetica',
    'Times New Roman',
    'Courier New',
    'Georgia',
    'Verdana',
    'Comic Sans MS'
  ];

  const webFonts = [
    'Roboto',
    'Open Sans',
    'Lato',
    'Montserrat',
    'Poppins',
    'Oswald',
    'Inter',
    'Bebas Neue',
    'Anton',
    'Pacifico',
    'Lobster',
    'Orbitron'
  ];

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
      
      const testElement = document.createElement('div');
      testElement.style.fontFamily = '"' + fontName + '", Arial';
      testElement.style.position = 'absolute';
      testElement.style.left = '-9999px';
      testElement.textContent = 'Test';
      document.body.appendChild(testElement);
      
      setTimeout(() => {
        setCustomFonts(prev => [...prev, fontName]);
        setSettings(prev => ({ ...prev, font: fontName }));
        document.body.removeChild(testElement);
        
        setTimeout(() => {
          const canvas = canvasRef.current;
          if (canvas) {
            canvas.width = canvas.offsetWidth;
            canvas.height = canvas.offsetHeight;
            render();
          }
        }, 100);
        
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
    audioReactiveSpacing: false,
    audioReactiveThickness: false,
    audioReactiveDistortion: false,
    audioReactivePattern: false,
    audioSensitivity: 1.5
  });

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
        
        console.log('Requesting audio with constraints:', constraints);
        const stream = await navigator.mediaDevices.getUserMedia(constraints);
        console.log('Audio stream obtained:', stream.getAudioTracks());
        
        const audioContext = new (window.AudioContext || window.webkitAudioContext)();
        await audioContext.resume();
        audioContextRef.current = audioContext;
        console.log('AudioContext created, state:', audioContext.state);
        
        const source = audioContext.createMediaStreamSource(stream);
        
        const gainNode = audioContext.createGain();
        gainNode.gain.value = 3.0;
        
        const analyser = audioContext.createAnalyser();
        analyser.fftSize = 8192;
        analyser.smoothingTimeConstant = 0.1;
        analyser.minDecibels = -100;
        analyser.maxDecibels = -20;
        analyserRef.current = analyser;
        
        source.connect(gainNode);
        gainNode.connect(analyser);
        console.log('Audio pipeline connected with gain boost');
        
        const updateAudioData = () => {
          if (!audioEnabled || !analyserRef.current) {
            animationFrameRef.current = null;
            return;
          }
          
          const bufferLength = analyserRef.current.frequencyBinCount;
          const dataArray = new Uint8Array(bufferLength);
          
          analyserRef.current.getByteFrequencyData(dataArray);
          
          const bass = dataArray.slice(0, Math.floor(bufferLength * 0.1));
          const mid = dataArray.slice(Math.floor(bufferLength * 0.1), Math.floor(bufferLength * 0.4));
          const high = dataArray.slice(Math.floor(bufferLength * 0.4), Math.floor(bufferLength * 0.8));
          
          const bassAvg = bass.reduce((a, b) => a + b, 0) / bass.length / 255;
          const midAvg = mid.reduce((a, b) => a + b, 0) / mid.length / 255;
          const highAvg = high.reduce((a, b) => a + b, 0) / high.length / 255;
          
          let sum = 0;
          for (let i = 0; i < bufferLength; i++) {
            sum += dataArray[i];
          }
          const average = sum / bufferLength;
          const normalizedLevel = average / 255;
          
          setAudioLevel(normalizedLevel);
          setBassLevel(bassAvg);
          setMidLevel(midAvg);
          setHighLevel(highAvg);
          
          const sensitivity = settings.audioSensitivity;
          const amplifiedLevel = Math.min(normalizedLevel * sensitivity, 1);
          const amplifiedBass = Math.min(bassAvg * sensitivity, 1);
          const amplifiedMid = Math.min(midAvg * sensitivity, 1);
          const amplifiedHigh = Math.min(highAvg * sensitivity, 1);
          
          if (settings.audioReactiveSpacing) {
            const newSpacing = 10 + (amplifiedBass * 50);
            setSettings(prev => ({ ...prev, spacing: newSpacing }));
          }
          
          if (settings.audioReactiveThickness) {
            const newThickness = 2 + (amplifiedMid * 28);
            setSettings(prev => ({ ...prev, lineThickness: newThickness }));
          }
          
          if (settings.audioReactiveDistortion) {
            const newStrength = 5 + (amplifiedLevel * 75);
            setSettings(prev => ({ ...prev, distortionStrength: newStrength }));
          }
          
          if (settings.audioReactivePattern && amplifiedHigh > 0.5) {
            const patterns = ['vertical-lines', 'horizontal-lines', 'checkerboard'];
            const patternIndex = Math.floor(amplifiedHigh * 2.99);
            setSettings(prev => ({ ...prev, patternType: patterns[patternIndex] }));
          }
          
          animationFrameRef.current = requestAnimationFrame(updateAudioData);
        };
        
        updateAudioData();
        
      } catch (err) {
        console.error('Audio access failed:', err);
        alert('Audio Error: ' + err.message + '\n\nTry opening this in your web browser (Chrome/Firefox) instead of Claude Desktop app. The desktop app may have audio restrictions.\n\nOr check:\n1. Browser permissions for microphone\n2. UAD Volt is selected as input in system settings\n3. UAD Volt driver is installed');
      }
    };

    if (audioEnabled) {
      initAudio();
    } else {
      if (animationFrameRef.current) {
        cancelAnimationFrame(animationFrameRef.current);
        animationFrameRef.current = null;
      }
      if (audioContextRef.current && audioContextRef.current.state !== 'closed') {
        audioContextRef.current.close();
      }
    }
    
    return () => {
      if (animationFrameRef.current) {
        cancelAnimationFrame(animationFrameRef.current);
      }
      if (audioContextRef.current && audioContextRef.current.state !== 'closed') {
        audioContextRef.current.close();
      }
    };
  }, [audioEnabled, selectedAudioDevice]);

  useEffect(() => {
    if (!audioEnabled || !analyserRef.current) return;
    
    if (animationFrameRef.current) {
      cancelAnimationFrame(animationFrameRef.current);
    }
    
    const updateAudioData = () => {
      if (!audioEnabled || !analyserRef.current) {
        animationFrameRef.current = null;
        return;
      }
      
      const bufferLength = analyserRef.current.frequencyBinCount;
      const dataArray = new Uint8Array(bufferLength);
      
      analyserRef.current.getByteFrequencyData(dataArray);
      
      const bass = dataArray.slice(0, Math.floor(bufferLength * 0.1));
      const mid = dataArray.slice(Math.floor(bufferLength * 0.1), Math.floor(bufferLength * 0.4));
      const high = dataArray.slice(Math.floor(bufferLength * 0.4), Math.floor(bufferLength * 0.8));
      
      const bassAvg = bass.reduce((a, b) => a + b, 0) / bass.length / 255;
      const midAvg = mid.reduce((a, b) => a + b, 0) / mid.length / 255;
      const highAvg = high.reduce((a, b) => a + b, 0) / high.length / 255;
      
      let sum = 0;
      for (let i = 0; i < bufferLength; i++) {
        sum += dataArray[i];
      }
      const average = sum / bufferLength;
      const normalizedLevel = average / 255;
      
      setAudioLevel(normalizedLevel);
      setBassLevel(bassAvg);
      setMidLevel(midAvg);
      setHighLevel(highAvg);
      
      const sensitivity = settings.audioSensitivity;
      const amplifiedLevel = Math.min(normalizedLevel * sensitivity, 1);
      const amplifiedBass = Math.min(bassAvg * sensitivity, 1);
      const amplifiedMid = Math.min(midAvg * sensitivity, 1);
      const amplifiedHigh = Math.min(highAvg * sensitivity, 1);
      
      if (settings.audioReactiveSpacing) {
        const newSpacing = 10 + (amplifiedBass * 50);
        setSettings(prev => ({ ...prev, spacing: newSpacing }));
      }
      
      if (settings.audioReactiveThickness) {
        const newThickness = 2 + (amplifiedMid * 28);
        setSettings(prev => ({ ...prev, lineThickness: newThickness }));
      }
      
      if (settings.audioReactiveDistortion) {
        const newStrength = 5 + (amplifiedLevel * 75);
        setSettings(prev => ({ ...prev, distortionStrength: newStrength }));
      }
      
      if (settings.audioReactivePattern && amplifiedHigh > 0.5) {
        const patterns = ['vertical-lines', 'horizontal-lines', 'checkerboard'];
        const patternIndex = Math.floor(amplifiedHigh * 2.99);
        setSettings(prev => ({ ...prev, patternType: patterns[patternIndex] }));
      }
      
      animationFrameRef.current = requestAnimationFrame(updateAudioData);
    };
    
    updateAudioData();
    
  }, [settings.audioReactiveSpacing, settings.audioReactiveThickness, settings.audioReactiveDistortion, settings.audioReactivePattern, settings.audioSensitivity]);

  useEffect(() => {
    if (!activeSettings) {
      setActiveSettings({ ...settings });
      setTargetSettings({ ...settings });
    } else {
      const hasChanged = JSON.stringify(settings) !== JSON.stringify(targetSettings);
      if (hasChanged) {
        previousPattern.current = currentPattern.current;
        setTargetSettings({ ...settings });
        transitionProgress.current = 0;
      }
    }
  }, [settings]);

  const lerp = (start, end, t) => {
    return start + (end - start) * t;
  };

  const getCurrentSettings = () => {
    if (!activeSettings || !targetSettings) return settings;
    
    const t = Math.min(transitionProgress.current, 1);
    const eased = t * t * (3 - 2 * t);
    
    return {
      ...targetSettings,
      lineThickness: lerp(activeSettings.lineThickness, targetSettings.lineThickness, eased),
      spacing: lerp(activeSettings.spacing, targetSettings.spacing, eased),
      fontSize: lerp(activeSettings.fontSize, targetSettings.fontSize, eased),
      shapeSize: lerp(activeSettings.shapeSize, targetSettings.shapeSize, eased),
      distortionStrength: lerp(activeSettings.distortionStrength, targetSettings.distortionStrength, eased),
      distortionSpeed: lerp(activeSettings.distortionSpeed, targetSettings.distortionSpeed, eased),
      pixelSize: lerp(activeSettings.pixelSize, targetSettings.pixelSize, eased),
      gridSize: lerp(activeSettings.gridSize, targetSettings.gridSize, eased)
    };
  };

  const shapes = [
    { name: 'Circle', draw: (ctx, size) => { ctx.beginPath(); ctx.arc(size/2, size/2, size * 0.4, 0, Math.PI * 2); ctx.stroke(); }},
    { name: 'Square', draw: (ctx, size) => { const s = size * 0.7; const offset = (size - s) / 2; ctx.strokeRect(offset, offset, s, s); }},
    { name: 'Triangle', draw: (ctx, size) => { ctx.beginPath(); ctx.moveTo(size/2, size * 0.1); ctx.lineTo(size * 0.9, size * 0.9); ctx.lineTo(size * 0.1, size * 0.9); ctx.closePath(); ctx.stroke(); }},
    { name: 'Star', draw: (ctx, size) => { ctx.beginPath(); const cx = size/2; const cy = size/2; const r = size * 0.4; for (let i = 0; i < 5; i++) { const angle = (i * 4 * Math.PI / 5) - Math.PI/2; const x = cx + r * Math.cos(angle); const y = cy + r * Math.sin(angle); if (i === 0) ctx.moveTo(x, y); else ctx.lineTo(x, y); } ctx.closePath(); ctx.stroke(); }},
    { name: 'Heart', draw: (ctx, size) => { ctx.beginPath(); const x = size/2; const y = size * 0.3; const w = size * 0.5; ctx.moveTo(x, y + w/4); ctx.bezierCurveTo(x, y, x - w/2, y - w/2, x - w/2, y + w/4); ctx.bezierCurveTo(x - w/2, y + w, x, y + w * 1.2, x, y + w * 1.5); ctx.bezierCurveTo(x, y + w * 1.2, x + w/2, y + w, x + w/2, y + w/4); ctx.bezierCurveTo(x + w/2, y - w/2, x, y, x, y + w/4); ctx.stroke(); }},
    { name: 'Person', draw: (ctx, size) => { ctx.beginPath(); ctx.arc(size/2, size * 0.25, size * 0.1, 0, Math.PI * 2); ctx.stroke(); ctx.beginPath(); ctx.moveTo(size/2, size * 0.35); ctx.lineTo(size/2, size * 0.6); ctx.moveTo(size/2, size * 0.4); ctx.lineTo(size * 0.3, size * 0.5); ctx.moveTo(size/2, size * 0.4); ctx.lineTo(size * 0.7, size * 0.5); ctx.moveTo(size/2, size * 0.6); ctx.lineTo(size * 0.4, size * 0.9); ctx.moveTo(size/2, size * 0.6); ctx.lineTo(size * 0.6, size * 0.9); ctx.stroke(); }}
  ];

  const noise = (() => {
    const p = [];
    for (let i = 0; i < 512; i++) {
      p[i] = Math.floor(Math.random() * 256);
    }
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
      const lerpFunc = (t, a, b) => a + t * (b - a);
      return lerpFunc(v, lerpFunc(u, p[A] / 128 - 1, p[B] / 128 - 1), lerpFunc(u, p[A + 1] / 128 - 1, p[B + 1] / 128 - 1));
    };
  })();

  const getDistortion = (x, y, time, strength, distortionType) => {
    const freq = 0.01;
    const t = time || 0;
    let dx = 0;
    let dy = 0;
    
    switch (distortionType) {
      case 'liquify':
        dx = noise(x * freq + t * 0.1, y * freq) * strength;
        dy = noise(x * freq + 100, y * freq + 100 + t * 0.1) * strength;
        break;
      case 'ripple':
        const dist = Math.sqrt(x * x + y * y);
        const ripple = Math.sin(dist * 0.02 + t * 2) * strength;
        dx = (x / (dist || 1)) * ripple;
        dy = (y / (dist || 1)) * ripple;
        break;
      case 'swirl':
        const angle = Math.atan2(y, x);
        const radius = Math.sqrt(x * x + y * y);
        const swirlAmount = strength * 0.001 + t * 0.5;
        const newAngle = angle + swirlAmount * (1 / (1 + radius * 0.01));
        dx = Math.cos(newAngle) * radius - x;
        dy = Math.sin(newAngle) * radius - y;
        break;
      case 'turbulence':
        dx = Math.abs(noise(x * freq + t * 0.2, y * freq)) * strength;
        dy = Math.abs(noise(x * freq + 200, y * freq + 200 + t * 0.2)) * strength;
        break;
      case 'marble':
        const marble1 = x * freq + strength * 0.1 * noise(x * freq * 2 + t * 0.1, y * freq * 2);
        const marble2 = y * freq + strength * 0.1 * noise(x * freq * 2 + 100, y * freq * 2 + 100 + t * 0.1);
        dx = Math.sin(marble1 + t * 0.5) * strength;
        dy = Math.sin(marble2 + t * 0.5) * strength;
        break;
      case 'wave':
        dx = Math.sin(y * freq * 5 + t * 2) * strength;
        dy = Math.cos(x * freq * 3 + t * 1.5) * strength;
        break;
      default:
        dx = noise(x * freq + t * 0.1, y * freq) * strength;
        dy = noise(x * freq + 100, y * freq + 100 + t * 0.1) * strength;
    }
    return { x: dx, y: dy };
  };

  const render = (time = 0) => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext('2d');
    const width = canvas.width;
    const height = canvas.height;
    
    if (transitionProgress.current < 1) {
      transitionProgress.current += transitionSpeed;
      if (transitionProgress.current >= 1) {
        transitionProgress.current = 1;
        setActiveSettings({ ...targetSettings });
        previousPattern.current = null;
      }
    }
    
    const currentSettings = getCurrentSettings();
    const t = Math.min(transitionProgress.current, 1);
    const eased = t < 0.5 ? 2 * t * t : 1 - Math.pow(-2 * t + 2, 2) / 2;
    
    ctx.fillStyle = '#ffffff';
    ctx.fillRect(0, 0, width, height);
    ctx.fillStyle = '#000000';
    
    const animTime = isAnimating ? time * 0.001 * currentSettings.distortionSpeed : 0;
    
    if (previousPattern.current && eased < 1) {
      ctx.save();
      ctx.globalAlpha = 1 - eased;
      drawPattern(ctx, width, height, animTime, activeSettings, true);
      ctx.restore();
      
      ctx.save();
      ctx.globalAlpha = eased;
      drawPattern(ctx, width, height, animTime, currentSettings, false);
      ctx.restore();
    } else {
      drawPattern(ctx, width, height, animTime, currentSettings, false);
    }
    
    if (currentSettings.pixelationEnabled && currentSettings.pixelSize > 1 && eased >= 1) {
      const imageData = ctx.getImageData(0, 0, width, height);
      const pixelatedData = ctx.createImageData(width, height);
      for (let y = 0; y < height; y += currentSettings.pixelSize) {
        for (let x = 0; x < width; x += currentSettings.pixelSize) {
          const sampleX = Math.min(x + Math.floor(currentSettings.pixelSize / 2), width - 1);
          const sampleY = Math.min(y + Math.floor(currentSettings.pixelSize / 2), height - 1);
          const sampleIndex = (sampleY * width + sampleX) * 4;
          const r = imageData.data[sampleIndex];
          const g = imageData.data[sampleIndex + 1];
          const b = imageData.data[sampleIndex + 2];
          const a = imageData.data[sampleIndex + 3];
          for (let py = y; py < Math.min(y + currentSettings.pixelSize, height); py++) {
            for (let px = x; px < Math.min(x + currentSettings.pixelSize, width); px++) {
              const index = (py * width + px) * 4;
              pixelatedData.data[index] = r;
              pixelatedData.data[index + 1] = g;
              pixelatedData.data[index + 2] = b;
              pixelatedData.data[index + 3] = a;
            }
          }
        }
      }
      ctx.putImageData(pixelatedData, 0, 0);
    }
    
    if (currentSettings.showGrid) {
      ctx.save();
      ctx.strokeStyle = 'rgba(255, 0, 0, 0.3)';
      ctx.lineWidth = 1;
      const cellSize = Math.min(width, height) / currentSettings.gridSize;
      for (let i = 0; i <= currentSettings.gridSize; i++) {
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
    
    currentPattern.current = { settings: currentSettings, time: animTime };
  };
  
  const drawPattern = (ctx, width, height, animTime, settings, isPrevious) => {
    if (settings.patternType === 'vertical-lines') {
      for (let x = 0; x < width; x += settings.spacing) {
        ctx.beginPath();
        let firstPoint = true;
        for (let y = 0; y < height; y += 1) {
          let drawX = x;
          let drawY = y;
          if (settings.distortionEnabled) {
            const distortion = getDistortion(x - width/2, y - height/2, animTime, settings.distortionStrength, settings.distortionType);
            drawX += distortion.x;
            drawY += distortion.y;
          }
          if (firstPoint) {
            ctx.moveTo(drawX, drawY);
            firstPoint = false;
          } else {
            ctx.lineTo(drawX, drawY);
          }
        }
        ctx.lineWidth = settings.lineThickness;
        ctx.stroke();
      }
    } else if (settings.patternType === 'horizontal-lines') {
      for (let y = 0; y < height; y += settings.spacing) {
        ctx.beginPath();
        let firstPoint = true;
        for (let x = 0; x < width; x += 1) {
          let drawX = x;
          let drawY = y;
          if (settings.distortionEnabled) {
            const distortion = getDistortion(x - width/2, y - height/2, animTime, settings.distortionStrength, settings.distortionType);
            drawX += distortion.x;
            drawY += distortion.y;
          }
          if (firstPoint) {
            ctx.moveTo(drawX, drawY);
            firstPoint = false;
          } else {
            ctx.lineTo(drawX, drawY);
          }
        }
        ctx.lineWidth = settings.lineThickness;
        ctx.stroke();
      }
    } else if (settings.patternType === 'checkerboard') {
      const cellSize = settings.spacing;
      for (let y = 0; y < height; y += cellSize) {
        for (let x = 0; x < width; x += cellSize) {
          let drawX = x;
          let drawY = y;
          if (settings.distortionEnabled) {
            const distortion = getDistortion(x - width/2, y - height/2, animTime, settings.distortionStrength, settings.distortionType);
            drawX += distortion.x;
            drawY += distortion.y;
          }
          if ((Math.floor(x / cellSize) + Math.floor(y / cellSize)) % 2 === 0) {
            ctx.fillRect(drawX, drawY, cellSize, cellSize);
          }
        }
      }
    }
    
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
  };

  useEffect(() => {
    const animateLoop = (time) => {
      render(time);
      animationRef.current = requestAnimationFrame(animateLoop);
    };
    
    animationRef.current = requestAnimationFrame(animateLoop);
    
    return () => {
      if (animationRef.current) cancelAnimationFrame(animationRef.current);
    };
  }, [isAnimating, settings, activeSettings, targetSettings]);

  useEffect(() => {
    render();
  }, [settings, customFonts]);

  useEffect(() => {
    const handleResize = () => {
      const canvas = canvasRef.current;
      if (canvas) {
        canvas.width = canvas.offsetWidth;
        canvas.height = canvas.offsetHeight;
        render();
      }
    };
    handleResize();
    window.addEventListener('resize', handleResize);
    return () => window.removeEventListener('resize', handleResize);
  }, []);

  return (
    <div className="w-full h-screen bg-gray-100 flex">
      <div className="w-80 bg-white shadow-lg p-4 overflow-y-auto">
        <div className="mb-4">
          <div className="flex gap-2 mb-3">
            <button onClick={() => setIsAnimating(!isAnimating)} className="flex items-center gap-1 px-3 py-2 bg-blue-500 text-white rounded text-sm">
              {isAnimating ? <Pause size={14} /> : <Play size={14} />}
              {isAnimating ? 'Pause' : 'Play'}
            </button>
            <button onClick={() => setSettings(prev => ({ ...prev, lineThickness: Math.floor(Math.random() * 15) + 5, spacing: Math.floor(Math.random() * 30) + 15, distortionStrength: Math.floor(Math.random() * 40) + 10, distortionType: distortionTypes[Math.floor(Math.random() * distortionTypes.length)].value, patternType: ['vertical-lines', 'horizontal-lines', 'checkerboard'][Math.floor(Math.random() * 3)]}))} className="flex items-center gap-1 px-3 py-2 bg-green-500 text-white rounded text-sm">
              <RotateCcw size={14} />
              Random
            </button>
            <button onClick={() => { const canvas = canvasRef.current; const link = document.createElement('a'); link.download = 'pattern.png'; link.href = canvas.toDataURL(); link.click(); }} className="flex items-center gap-1 px-3 py-2 bg-purple-500 text-white rounded text-sm">
              <Download size={14} />
              Save
            </button>
          </div>
        </div>

        <div className="space-y-4">
          <div>
            <h3 className="font-semibold mb-2">🎛️ Pulsar 23 Audio Input</h3>
            
            <div className="text-xs bg-yellow-50 border border-yellow-200 p-2 rounded mb-2">
              ⚠️ <strong>Browser Check:</strong> This works best in Chrome/Firefox. Make sure to <strong>ALLOW microphone access</strong> when prompted!
            </div>
            
            <button 
              onClick={async () => {
                try {
                  const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
                  alert('✅ Audio permission granted! Your devices: ' + stream.getAudioTracks().map(t => t.label).join(', '));
                  stream.getTracks().forEach(track => track.stop());
                  await getAudioDevices();
                } catch (err) {
                  alert('❌ Audio permission failed: ' + err.message);
                }
              }}
              className="w-full mb-2 px-3 py-2 bg-orange-500 text-white rounded text-sm font-medium hover:bg-orange-600"
            >
              🎤 Test Audio Permission
            </button>
            
            <label className="flex items-center mb-2">
              <input 
                type="checkbox" 
                checked={audioEnabled} 
                onChange={(e) => setAudioEnabled(e.target.checked)} 
                className="mr-2" 
              />
              Enable Audio Reactivity
            </label>
            
            {audioEnabled && (
              <div className="space-y-3">
                {audioDevices.length > 0 && (
                  <div>
                    <label className="block text-xs font-medium mb-1">Audio Input Device:</label>
                    <select 
                      value={selectedAudioDevice || ''} 
                      onChange={(e) => setSelectedAudioDevice(e.target.value)}
                      className="w-full p-2 border rounded text-xs"
                    >
                      {audioDevices.map(device => (
                        <option key={device.deviceId} value={device.deviceId}>
                          {device.label || `Audio Input ${device.deviceId.substring(0, 8)}`}
                        </option>
                      ))}
                    </select>
                  </div>
                )}

                <div>
                  <label className="block text-xs mb-1">Input Gain Boost: {settings.audioSensitivity.toFixed(1)}x</label>
                  <input 
                    type="range" 
                    min="0.1" 
                    max="10" 
                    step="0.1"
                    value={settings.audioSensitivity} 
                    onChange={(e) => setSettings(prev => ({ ...prev, audioSensitivity: parseFloat(e.target.value) }))} 
                    className="w-full" 
                  />
                  <div className="text-xs text-gray-500">Try 5-10x for line-level input</div>
                </div>
                
                <div className="bg-gradient-to-r from-blue-50 to-purple-50 p-3 rounded space-y-2">
                  <div>
                    <div className="text-xs font-medium mb-1">Overall: {(audioLevel * 100).toFixed(0)}%</div>
                    <div className="w-full bg-gray-200 rounded-full h-2">
                      <div 
                        className="bg-gradient-to-r from-blue-500 to-purple-500 h-2 rounded-full transition-all duration-75" 
                        style={{ width: (audioLevel * 100) + '%' }}
                      />
                    </div>
                  </div>
                  
                  <div className="grid grid-cols-3 gap-2 text-xs">
                    <div>
                      <div className="font-medium mb-1">Bass</div>
                      <div className="w-full bg-gray-200 rounded-full h-1.5">
                        <div 
                          className="bg-red-500 h-1.5 rounded-full transition-all duration-75" 
                          style={{ width: (bassLevel * 100) + '%' }}
                        />
                      </div>
                    </div>
                    <div>
                      <div className="font-medium mb-1">Mid</div>
                      <div className="w-full bg-gray-200 rounded-full h-1.5">
                        <div 
                          className="bg-green-500 h-1.5 rounded-full transition-all duration-75" 
                          style={{ width: (midLevel * 100) + '%' }}
                        />
                      </div>
                    </div>
                    <div>
                      <div className="font-medium mb-1">High</div>
                      <div className="w-full bg-gray-200 rounded-full h-1.5">
                        <div 
                          className="bg-blue-500 h-1.5 rounded-full transition-all duration-75" 
                          style={{ width: (highLevel * 100) + '%' }}
                        />
                      </div>
                    </div>
                  </div>
                </div>
                
                <div className="space-y-2 bg-gray-50 p-2 rounded">
                  <div className="text-xs font-semibold text-gray-700">Reactive Parameters:</div>
                  
                  <label className="flex items-center">
                    <input 
                      type="checkbox" 
                      checked={settings.audioReactiveSpacing} 
                      onChange={(e) => setSettings(prev => ({ ...prev, audioReactiveSpacing: e.target.checked }))} 
                      className="mr-2" 
                    />
                    <span className="text-sm">Spacing (Bass) 🔴</span>
                  </label>
                  
                  <label className="flex items-center">
                    <input 
                      type="checkbox" 
                      checked={settings.audioReactiveThickness} 
                      onChange={(e) => setSettings(prev => ({ ...prev, audioReactiveThickness: e.target.checked }))} 
                      className="mr-2" 
                    />
                    <span className="text-sm">Thickness (Mid) 🟢</span>
                  </label>
                  
                  <label className="flex items-center">
                    <input 
                      type="checkbox" 
                      checked={settings.audioReactiveDistortion} 
                      onChange={(e) => setSettings(prev => ({ ...prev, audioReactiveDistortion: e.target.checked }))} 
                      className="mr-2" 
                    />
                    <span className="text-sm">Distortion (Overall) 🟣</span>
                  </label>
                  
                  <label className="flex items-center">
                    <input 
                      type="checkbox" 
                      checked={settings.audioReactivePattern} 
                      onChange={(e) => setSettings(prev => ({ ...prev, audioReactivePattern: e.target.checked }))} 
                      className="mr-2" 
                    />
                    <span className="text-sm">Pattern Switch (High) 🔵</span>
                  </label>
                </div>

                <div className="text-xs text-gray-600 bg-blue-50 p-2 rounded">
                  💡 Connect your Pulsar 23 output to your audio interface input, then select it above.
                </div>
                
                <div className="text-xs bg-gray-100 p-2 rounded font-mono">
                  <div>Devices: {audioDevices.length}</div>
                  <div>Selected: {audioDevices.find(d => d.deviceId === selectedAudioDevice)?.label || 'None'}</div>
                  <div>Context: {audioContextRef.current ? audioContextRef.current.state : 'None'}</div>
                  <div>Analyser: {analyserRef.current ? 'Ready' : 'None'}</div>
                  <div>Frame: {animationFrameRef.current ? 'Running' : 'Stopped'}</div>
                  <div>Raw Audio: {audioLevel.toFixed(3)}</div>
                  <div>Bass: {bassLevel.toFixed(3)} | Mid: {midLevel.toFixed(3)} | High: {highLevel.toFixed(3)}</div>
                </div>
              </div>
            )}
          </div>

          <div>
            <h3 className="font-semibold mb-2 flex items-center gap-1">
              <Type size={16} />
              Shapes
            </h3>
            <label className="flex items-center mb-2">
              <input type="checkbox" checked={settings.shapeEnabled} onChange={(e) => setSettings(prev => ({ ...prev, shapeEnabled: e.target.checked }))} className="mr-2" />
              Enable Shape
            </label>
            {settings.shapeEnabled && (
              <>
                <div className="mb-3">
                  <label className="block text-sm font-medium mb-2">{shapes[settings.shapeIndex].name}</label>
                  <input type="range" min="0" max={shapes.length - 1} value={settings.shapeIndex} onChange={(e) => setSettings(prev => ({ ...prev, shapeIndex: parseInt(e.target.value) }))} className="w-full" />
                  <div className="text-xs text-gray-500 text-center mt-1">Shape {settings.shapeIndex + 1} of {shapes.length}</div>
                </div>
                <div>
                  <label className="block text-sm mb-1">Size: {settings.shapeSize}%</label>
                  <input type="range" min="30" max="200" value={settings.shapeSize} onChange={(e) => setSettings(prev => ({ ...prev, shapeSize: parseInt(e.target.value) }))} className="w-full" />
                </div>
              </>
            )}
          </div>

          <div>
            <h3 className="font-semibold mb-2">Pattern</h3>
            <select value={settings.patternType} onChange={(e) => setSettings(prev => ({ ...prev, patternType: e.target.value }))} className="w-full p-2 border rounded">
              <option value="vertical-lines">Vertical Lines</option>
              <option value="horizontal-lines">Horizontal Lines</option>
              <option value="checkerboard">Checkerboard</option>
            </select>
            <div className="mt-2">
              <label className="block text-sm mb-1">Thickness: {settings.lineThickness}</label>
              <input type="range" min="2" max="30" value={settings.lineThickness} onChange={(e) => setSettings(prev => ({ ...prev, lineThickness: parseInt(e.target.value) }))} className="w-full" />
            </div>
            <div className="mt-2">
              <label className="block text-sm mb-1">Spacing: {settings.spacing}</label>
              <input type="range" min="10" max="60" value={settings.spacing} onChange={(e) => setSettings(prev => ({ ...prev, spacing: parseInt(e.target.value) }))} className="w-full" />
            </div>
          </div>

          <div>
            <h3 className="font-semibold mb-2 flex items-center gap-1">
              <Type size={16} />
              Text
            </h3>
            <label className="flex items-center mb-2">
              <input type="checkbox" checked={settings.textEnabled} onChange={(e) => setSettings(prev => ({ ...prev, textEnabled: e.target.checked }))} className="mr-2" />
              Enable Text
            </label>
            {settings.textEnabled && (
              <>
                <input type="text" value={settings.text} onChange={(e) => setSettings(prev => ({ ...prev, text: e.target.value }))} className="w-full p-2 border rounded mb-2" placeholder="Type text..." />
                <div>
                  <label className="block text-sm mb-1">Font</label>
                  <select value={settings.font} onChange={(e) => setSettings(prev => ({ ...prev, font: e.target.value }))} className="w-full p-2 border rounded mb-2">
                    <optgroup label="System Fonts">
                      {systemFonts.map(font => (
                        <option key={font} value={font}>{font}</option>
                      ))}
                    </optgroup>
                    <optgroup label="Web Fonts">
                      {webFonts.map(font => (
                        <option key={font} value={font}>{font}</option>
                      ))}
                    </optgroup>
                    {customFonts.length > 0 && (
                      <optgroup label="Custom Fonts">
                        {customFonts.map(font => (
                          <option key={font} value={font}>{font}</option>
                        ))}
                      </optgroup>
                    )}
                  </select>
                </div>
                <div>
                  <label className="block text-sm mb-1">Upload Custom Font</label>
                  <input
                    type="file"
                    accept=".ttf,.otf,.woff,.woff2"
                    onChange={handleFontUpload}
                    className="w-full p-2 border rounded mb-2 text-sm"
                  />
                  <div className="text-xs text-gray-500">
                    Supports .ttf, .otf, .woff, .woff2 files
                  </div>
                </div>
                <div>
                  <label className="block text-sm mb-1">Size: {settings.fontSize}%</label>
                  <input type="range" min="50" max="200" value={settings.fontSize} onChange={(e) => setSettings(prev => ({ ...prev, fontSize: parseInt(e.target.value) }))} className="w-full" />
                </div>
              </>
            )}
          </div>

          <div>
            <h3 className="font-semibold mb-2">Distortion</h3>
            <label className="flex items-center mb-2">
              <input type="checkbox" checked={settings.distortionEnabled} onChange={(e) => setSettings(prev => ({ ...prev, distortionEnabled: e.target.checked }))} className="mr-2" />
              Enable Effects
            </label>
            {settings.distortionEnabled && (
              <>
                <select value={settings.distortionType} onChange={(e) => setSettings(prev => ({ ...prev, distortionType: e.target.value }))} className="w-full p-2 border rounded mb-2">
                  {distortionTypes.map(type => <option key={type.value} value={type.value}>{type.label}</option>)}
                </select>
                <div>
                  <label className="block text-sm mb-1">Strength: {settings.distortionStrength}</label>
                  <input type="range" min="5" max="80" value={settings.distortionStrength} onChange={(e) => setSettings(prev => ({ ...prev, distortionStrength: parseInt(e.target.value) }))} className="w-full" />
                </div>
                <div>
                  <label className="block text-sm mb-1">Speed: {settings.distortionSpeed}</label>
                  <input type="range" min="0.1" max="3" step="0.1" value={settings.distortionSpeed} onChange={(e) => setSettings(prev => ({ ...prev, distortionSpeed: parseFloat(e.target.value) }))} className="w-full" />
                </div>
              </>
            )}
          </div>

          <div>
            <h3 className="font-semibold mb-2">Lo-Fi Effects</h3>
            <label className="flex items-center mb-2">
              <input type="checkbox" checked={settings.pixelationEnabled} onChange={(e) => setSettings(prev => ({ ...prev, pixelationEnabled: e.target.checked }))} className="mr-2" />
              Pixelation
            </label>
            {settings.pixelationEnabled && (
              <div>
                <label className="block text-sm mb-1">Pixel Size: {settings.pixelSize}</label>
                <input type="range" min="2" max="20" value={settings.pixelSize} onChange={(e) => setSettings(prev => ({ ...prev, pixelSize: parseInt(e.target.value) }))} className="w-full" />
              </div>
            )}
          </div>

          <div>
            <h3 className="font-semibold mb-2 flex items-center gap-1">
              <Grid size={16} />
              Grid
            </h3>
            <label className="flex items-center mb-2">
              <input type="checkbox" checked={settings.showGrid} onChange={(e) => setSettings(prev => ({ ...prev, showGrid: e.target.checked }))} className="mr-2" />
              Show Grid
            </label>
            <div>
              <label className="block text-sm mb-1">Grid Size: {settings.gridSize}x{settings.gridSize}</label>
              <input type="range" min="10" max="50" value={settings.gridSize} onChange={(e) => setSettings(prev => ({ ...prev, gridSize: parseInt(e.target.value) }))} className="w-full" />
            </div>
          </div>
        </div>
      </div>

      <div className="flex-1 p-4">
        <canvas ref={canvasRef} className="w-full h-full border border-gray-300 bg-white rounded-lg shadow-lg" style={{ width: '100%', height: '100%' }} />
      </div>
    </div>
  );
};

export default PixelMoireGenerator;
