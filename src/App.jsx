import { useState, useEffect, useRef } from 'react';
import { Play, Pause, RotateCcw, Download, Type, Grid } from 'lucide-react';

export default function PixelMoireGenerator() {
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

  useEffect(() => {
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
        alert('Audio Error: ' + err.message + '\n\n1. Allow microphone/audio when prompted\n2. Select BlackHole from dropdown\n3. Make sure audio is routed to BlackHole');
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
            for (let px = x; px
