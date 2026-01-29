import React, { useState, useEffect, useRef } from 'react';
import { Play, Pause, Download } from 'lucide-react';

const Bruno = () => {
  const canvasRef = useRef(null);
  const [audioEnabled, setAudioEnabled] = useState(false);
  const [drawingEnabled, setDrawingEnabled] = useState(false);
  const [audioDevices, setAudioDevices] = useState([]);
  const [selectedDevice, setSelectedDevice] = useState(null);
  const audioContextRef = useRef(null);
  const analyserRef = useRef(null);
  const animationRef = useRef(null);
  const elementsRef = useRef([]);
  
  const [audioLevels, setAudioLevels] = useState({ bass: 0, mid: 0, high: 0 });
  
  const [settings, setSettings] = useState({
    primitive: 'dot',
    growthRate: 0.5,
    audioSensitivity: 2.0,
    maxElements: 500,
    lineWeight: 1
  });

  const primitives = {
    dot: { name: 'Dots', icon: '●' },
    line: { name: 'Lines', icon: '│' },
    square: { name: 'Squares', icon: '■' },
    circle: { name: 'Circles', icon: '○' }
  };

  useEffect(() => {
    const getDevices = async () => {
      try {
        const devices = await navigator.mediaDevices.enumerateDevices();
        const audioInputs = devices.filter(d => d.kind === 'audioinput');
        setAudioDevices(audioInputs);
        if (audioInputs.length > 0 && !selectedDevice) {
          setSelectedDevice(audioInputs[0].deviceId);
        }
      } catch (err) {
        console.error('Failed to get devices:', err);
      }
    };
    getDevices();
  }, []);

  useEffect(() => {
    if (!audioEnabled) {
      if (audioContextRef.current) audioContextRef.current.close();
      return;
    }

    const initAudio = async () => {
      try {
        if (audioContextRef.current) await audioContextRef.current.close();
        
        const stream = await navigator.mediaDevices.getUserMedia({
          audio: { 
            deviceId: selectedDevice ? { exact: selectedDevice } : undefined,
            echoCancellation: false, 
            noiseSuppression: false, 
            autoGainControl: false 
          }
        });
        
        const audioContext = new (window.AudioContext || window.webkitAudioContext)();
        audioContextRef.current = audioContext;
        
        const source = audioContext.createMediaStreamSource(stream);
        const gain = audioContext.createGain();
        gain.gain.value = 4.0;
        
        const analyser = audioContext.createAnalyser();
        analyser.fftSize = 2048;
        analyser.smoothingTimeConstant = 0.25;
        analyserRef.current = analyser;
        
        source.connect(gain);
        gain.connect(analyser);
        
        const updateAudio = () => {
          if (!audioEnabled || !analyserRef.current) return;
          
          const bufferLength = analyserRef.current.frequencyBinCount;
          const dataArray = new Uint8Array(bufferLength);
          analyserRef.current.getByteFrequencyData(dataArray);
          
          const bass = dataArray.slice(0, Math.floor(bufferLength * 0.15));
          const mid = dataArray.slice(Math.floor(bufferLength * 0.15), Math.floor(bufferLength * 0.5));
          const high = dataArray.slice(Math.floor(bufferLength * 0.5), bufferLength);
          
          const avg = (arr) => arr.reduce((a, b) => a + b, 0) / arr.length / 255;
          
          setAudioLevels({ bass: avg(bass), mid: avg(mid), high: avg(high) });
          requestAnimationFrame(updateAudio);
        };
        
        updateAudio();
      } catch (err) {
        console.error('Audio init failed:', err);
      }
    };
    
    initAudio();
    return () => { if (audioContextRef.current) audioContextRef.current.close(); };
  }, [audioEnabled, selectedDevice]);

  const generateNewElements = (bass, mid, high, centerX, centerY) => {
    const overallLevel = (bass + mid + high) / 3;
    
    if (overallLevel < 0.15) return;
    
    const shouldGenerate = Math.random() < (overallLevel * settings.growthRate);
    if (!shouldGenerate || elementsRef.current.length >= settings.maxElements) return;
    
    const newElements = [];
    const count = Math.floor(1 + bass * settings.audioSensitivity * 3);
    
    for (let i = 0; i < count; i++) {
      if (elementsRef.current.length >= settings.maxElements) break;
      
      let element;
      
      if (settings.primitive === 'dot') {
        const angle = Math.random() * Math.PI * 2;
        const distance = mid * 300 + Math.random() * 100;
        const size = 2 + high * 8;
        
        element = {
          type: 'dot',
          x: centerX + Math.cos(angle) * distance,
          y: centerY + Math.sin(angle) * distance,
          size: size,
          age: 0,
          vx: Math.cos(angle) * bass * 2,
          vy: Math.sin(angle) * bass * 2
        };
      } else if (settings.primitive === 'line') {
        const angle = Math.random() * Math.PI * 2;
        const distance = mid * 200;
        const length = 20 + bass * 100;
        const rotation = high * Math.PI;
        
        element = {
          type: 'line',
          x: centerX + Math.cos(angle) * distance,
          y: centerY + Math.sin(angle) * distance,
          length: length,
          rotation: rotation,
          age: 0,
          angularVel: (Math.random() - 0.5) * mid * 0.1
        };
      } else if (settings.primitive === 'square') {
        const gridPos = Math.floor(Math.random() * 10);
        const size = 10 + mid * 40;
        
        element = {
          type: 'square',
          x: centerX + (gridPos % 5 - 2) * (50 + bass * 50),
          y: centerY + (Math.floor(gridPos / 5) - 1) * (50 + bass * 50),
          size: size,
          rotation: high * Math.PI * 2,
          age: 0,
          scale: 0.1
        };
      } else if (settings.primitive === 'circle') {
        const radius = 50 + mid * 200;
        const angle = Math.random() * Math.PI * 2;
        const thickness = 1 + high * 5;
        
        element = {
          type: 'circle',
          x: centerX,
          y: centerY,
          radius: radius,
          thickness: thickness,
          age: 0,
          growth: bass * 2
        };
      }
      
      newElements.push(element);
    }
    
    elementsRef.current = [...elementsRef.current, ...newElements];
  };

  const updateElements = () => {
    elementsRef.current = elementsRef.current.filter(el => el.age < 200);
    
    elementsRef.current.forEach(el => {
      el.age++;
      
      if (el.type === 'dot') {
        el.x += el.vx;
        el.y += el.vy;
        el.vx *= 0.99;
        el.vy *= 0.99;
      } else if (el.type === 'line') {
        el.rotation += el.angularVel;
      } else if (el.type === 'square') {
        el.scale = Math.min(1, el.scale + 0.05);
      } else if (el.type === 'circle') {
        el.radius += el.growth;
        el.growth *= 0.98;
      }
    });
  };

  const render = () => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    
    const ctx = canvas.getContext('2d');
    const width = canvas.width;
    const height = canvas.height;
    
    ctx.fillStyle = '#FAFAFA';
    ctx.fillRect(0, 0, width, height);
    
    const centerX = width / 2;
    const centerY = height / 2;
    
    ctx.fillStyle = '#000000';
    ctx.beginPath();
    ctx.arc(centerX, centerY, 3, 0, Math.PI * 2);
    ctx.fill();
    
    if (!audioEnabled || !drawingEnabled) {
      elementsRef.current = [];
      return;
    }
    
    generateNewElements(audioLevels.bass, audioLevels.mid, audioLevels.high, centerX, centerY);
    updateElements();
    
    ctx.strokeStyle = '#000000';
    ctx.fillStyle = '#000000';
    ctx.lineWidth = settings.lineWeight;
    
    elementsRef.current.forEach(el => {
      const alpha = Math.max(0, 1 - (el.age / 200));
      ctx.globalAlpha = alpha;
      
      if (el.type === 'dot') {
        ctx.beginPath();
        ctx.arc(el.x, el.y, el.size, 0, Math.PI * 2);
        ctx.fill();
      } else if (el.type === 'line') {
        ctx.save();
        ctx.translate(el.x, el.y);
        ctx.rotate(el.rotation);
        ctx.beginPath();
        ctx.moveTo(-el.length / 2, 0);
        ctx.lineTo(el.length / 2, 0);
        ctx.stroke();
        ctx.restore();
      } else if (el.type === 'square') {
        ctx.save();
        ctx.translate(el.x, el.y);
        ctx.rotate(el.rotation);
        ctx.scale(el.scale, el.scale);
        ctx.strokeRect(-el.size / 2, -el.size / 2, el.size, el.size);
        ctx.restore();
      } else if (el.type === 'circle') {
        ctx.beginPath();
        ctx.arc(el.x, el.y, el.radius, 0, Math.PI * 2);
        ctx.lineWidth = el.thickness;
        ctx.stroke();
      }
    });
    
    ctx.globalAlpha = 1;
  };

  useEffect(() => {
    const animate = () => {
      render();
      animationRef.current = requestAnimationFrame(animate);
    };
    animationRef.current = requestAnimationFrame(animate);
    return () => { if (animationRef.current) cancelAnimationFrame(animationRef.current); };
  }, [settings, audioEnabled, drawingEnabled, audioLevels]);

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
    <div className="w-full h-screen bg-white flex flex-col">
      <div className="bg-white border-b border-gray-200 px-6 py-4">
        <div className="max-w-7xl mx-auto flex items-center justify-between">
          <h1 className="text-2xl font-light tracking-tight text-gray-900">Bruno</h1>
          <div className="flex items-center gap-3">
            <button onClick={() => {
              elementsRef.current = [];
              setDrawingEnabled(false);
            }} className="inline-flex items-center gap-2 px-4 py-2 rounded-full bg-gray-100 text-gray-900 text-sm font-medium hover:bg-gray-200">
              Clear
            </button>
            <button onClick={() => { const canvas = canvasRef.current; const link = document.createElement('a'); link.download = 'bruno.png'; link.href = canvas.toDataURL(); link.click(); }} className="inline-flex items-center gap-2 px-4 py-2 rounded-full bg-gray-100 text-gray-900 text-sm font-medium hover:bg-gray-200">
              <Download size={16} /> Export
            </button>
          </div>
        </div>
      </div>

      <div className="flex-1 flex">
        <div className="w-80 bg-gray-50 border-r border-gray-200 overflow-y-auto p-6 space-y-6">
          <div>
            <h3 className="text-sm font-semibold text-gray-900 mb-3">Primitive</h3>
            <div className="grid grid-cols-2 gap-2">
              {Object.entries(primitives).map(([key, p]) => (
                <button key={key} onClick={() => setSettings(prev => ({ ...prev, primitive: key }))} className={`px-4 py-3 rounded-xl text-sm font-medium transition-all ${settings.primitive === key ? 'bg-black text-white' : 'bg-white text-gray-700 hover:bg-gray-100'}`}>
                  <div className="text-2xl mb-1">{p.icon}</div>
                  {p.name}
                </button>
              ))}
            </div>
          </div>

          <div>
            <div className="flex items-center justify-between mb-3">
              <h3 className="text-sm font-semibold text-gray-900">Audio</h3>
              <label className="relative inline-flex items-center cursor-pointer">
                <input type="checkbox" checked={audioEnabled} onChange={(e) => setAudioEnabled(e.target.checked)} className="sr-only peer" />
                <div className="w-11 h-6 bg-gray-300 rounded-full peer peer-checked:after:translate-x-full after:absolute after:top-[2px] after:left-[2px] after:bg-white after:rounded-full after:h-5 after:w-5 after:transition-all peer-checked:bg-black"></div>
              </label>
            </div>
            {audioEnabled && (
              <div className="space-y-3">
                <div className="flex items-center justify-between bg-blue-50 border border-blue-200 rounded-xl p-3">
                  <span className="text-sm font-medium text-gray-900">Start Drawing</span>
                  <label className="relative inline-flex items-center cursor-pointer">
                    <input type="checkbox" checked={drawingEnabled} onChange={(e) => setDrawingEnabled(e.target.checked)} className="sr-only peer" />
                    <div className="w-11 h-6 bg-gray-300 rounded-full peer peer-checked:after:translate-x-full after:absolute after:top-[2px] after:left-[2px] after:bg-white after:rounded-full after:h-5 after:w-5 after:transition-all peer-checked:bg-blue-500"></div>
                  </label>
                </div>
                
                {audioDevices.length > 0 && (
                  <div className="bg-white rounded-xl p-3">
                    <div className="text-xs text-gray-600 mb-2">Audio Input Device</div>
                    <select value={selectedDevice || ''} onChange={(e) => setSelectedDevice(e.target.value)} className="w-full p-2 border border-gray-300 rounded-lg text-xs">
                      {audioDevices.map(device => (
                        <option key={device.deviceId} value={device.deviceId}>
                          {device.label || `Device ${device.deviceId.substring(0, 8)}`}
                        </option>
                      ))}
                    </select>
                  </div>
                )}
                
                <div className="bg-white rounded-xl p-3 space-y-2">
                  <div className="space-y-1">
                    <div className="flex justify-between text-xs text-gray-600">
                      <span>Bass</span>
                      <span>{(audioLevels.bass * 100).toFixed(0)}%</span>
                    </div>
                    <div className="w-full bg-gray-200 rounded-full h-1.5">
                      <div className="bg-black h-1.5 rounded-full" style={{ width: (audioLevels.bass * 100) + '%' }} />
                    </div>
                  </div>
                  <div className="space-y-1">
                    <div className="flex justify-between text-xs text-gray-600">
                      <span>Mid</span>
                      <span>{(audioLevels.mid * 100).toFixed(0)}%</span>
                    </div>
                    <div className="w-full bg-gray-200 rounded-full h-1.5">
                      <div className="bg-black h-1.5 rounded-full" style={{ width: (audioLevels.mid * 100) + '%' }} />
                    </div>
                  </div>
                  <div className="space-y-1">
                    <div className="flex justify-between text-xs text-gray-600">
                      <span>High</span>
                      <span>{(audioLevels.high * 100).toFixed(0)}%</span>
                    </div>
                    <div className="w-full bg-gray-200 rounded-full h-1.5">
                      <div className="bg-black h-1.5 rounded-full" style={{ width: (audioLevels.high * 100) + '%' }} />
                    </div>
                  </div>
                </div>
                
                <div className="bg-white rounded-xl p-3">
                  <div className="flex justify-between text-xs text-gray-600 mb-2">
                    <span>Sensitivity</span>
                    <span>{settings.audioSensitivity.toFixed(1)}x</span>
                  </div>
                  <input type="range" min="0.5" max="10" step="0.1" value={settings.audioSensitivity} onChange={(e) => setSettings(prev => ({ ...prev, audioSensitivity: parseFloat(e.target.value) }))} className="w-full accent-black" />
                </div>
              </div>
            )}
          </div>

          <div className="bg-white rounded-xl p-3 space-y-3">
            <h3 className="text-sm font-semibold text-gray-900">Controls</h3>
            <div>
              <div className="flex justify-between text-xs text-gray-600 mb-2">
                <span>Growth Rate</span>
                <span>{settings.growthRate.toFixed(1)}</span>
              </div>
              <input type="range" min="0.1" max="2" step="0.1" value={settings.growthRate} onChange={(e) => setSettings(prev => ({ ...prev, growthRate: parseFloat(e.target.value) }))} className="w-full accent-black" />
            </div>
            <div>
              <div className="flex justify-between text-xs text-gray-600 mb-2">
                <span>Max Elements</span>
                <span>{settings.maxElements}</span>
              </div>
              <input type="range" min="100" max="2000" step="50" value={settings.maxElements} onChange={(e) => setSettings(prev => ({ ...prev, maxElements: parseInt(e.target.value) }))} className="w-full accent-black" />
            </div>
            <div>
              <div className="flex justify-between text-xs text-gray-600 mb-2">
                <span>Line Weight</span>
                <span>{settings.lineWeight}</span>
              </div>
              <input type="range" min="0.5" max="4" step="0.5" value={settings.lineWeight} onChange={(e) => setSettings(prev => ({ ...prev, lineWeight: parseFloat(e.target.value) }))} className="w-full accent-black" />
            </div>
          </div>
        </div>

        <div className="flex-1 flex items-center justify-center p-8">
          <canvas ref={canvasRef} className="w-full h-full rounded-2xl shadow-sm" />
        </div>
      </div>
    </div>
  );
};

export default Bruno;
