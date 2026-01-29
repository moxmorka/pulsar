import React, { useState, useEffect, useRef } from 'react';
import { Play, Pause, RotateCcw, Download } from 'lucide-react';

const AudioReactiveMoire = () => {
  const canvasRef = useRef(null);
  const [isAnimating, setIsAnimating] = useState(false);
  const [audioEnabled, setAudioEnabled] = useState(false);
  const [audioDevices, setAudioDevices] = useState([]);
  const [selectedDevice, setSelectedDevice] = useState(null);
  const audioContextRef = useRef(null);
  const analyserRef = useRef(null);
  const audioDataRef = useRef(null);
  const animationRef = useRef(null);
  
  const [audioLevels, setAudioLevels] = useState({ bass: 0, mid: 0, high: 0, overall: 0 });
  
  const [settings, setSettings] = useState({
    patternType: 'vertical',
    lineThickness: 2,
    spacing: 20,
    distortionEnabled: true,
    distortionStrength: 15,
    wiggleBass: true,
    wiggleMid: true,
    wiggleHigh: true,
    wiggleAmount: 20,
    wiggleFrequency: 3,
    audioSensitivity: 2.5
  });

  useEffect(() => {
    const getDevices = async () => {
      try {
        const devices = await navigator.mediaDevices.enumerateDevices();
        const inputs = devices.filter(d => d.kind === 'audioinput');
        setAudioDevices(inputs);
        if (inputs.length > 0) setSelectedDevice(inputs[0].deviceId);
      } catch (err) {
        console.error('Device enumeration failed:', err);
      }
    };
    getDevices();
  }, []);

  useEffect(() => {
    if (!audioEnabled) {
      if (audioContextRef.current) audioContextRef.current.close();
      audioDataRef.current = null;
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
        gain.gain.value = 3.0;
        
        const analyser = audioContext.createAnalyser();
        analyser.fftSize = 4096;
        analyser.smoothingTimeConstant = 0.2;
        analyserRef.current = analyser;
        
        source.connect(gain);
        gain.connect(analyser);
        
        const updateAudio = () => {
          if (!audioEnabled || !analyserRef.current) return;
          
          const bufferLength = analyserRef.current.frequencyBinCount;
          const dataArray = new Uint8Array(bufferLength);
          analyserRef.current.getByteFrequencyData(dataArray);
          audioDataRef.current = dataArray;
          
          const bass = dataArray.slice(0, Math.floor(bufferLength * 0.1));
          const mid = dataArray.slice(Math.floor(bufferLength * 0.1), Math.floor(bufferLength * 0.4));
          const high = dataArray.slice(Math.floor(bufferLength * 0.4), bufferLength);
          
          const avg = (arr) => arr.reduce((a, b) => a + b, 0) / arr.length / 255;
          
          setAudioLevels({
            bass: avg(bass),
            mid: avg(mid),
            high: avg(high),
            overall: avg(dataArray)
          });
          
          requestAnimationFrame(updateAudio);
        };
        
        updateAudio();
      } catch (err) {
        console.error('Audio init failed:', err);
        alert('Microphone access denied or unavailable');
      }
    };
    
    initAudio();
    
    return () => {
      if (audioContextRef.current) audioContextRef.current.close();
    };
  }, [audioEnabled, selectedDevice]);

  const getAudioWiggle = (position, lineIndex) => {
    if (!audioEnabled || !audioDataRef.current) return { x: 0, y: 0 };
    
    const data = audioDataRef.current;
    const len = data.length;
    const sensitivity = settings.audioSensitivity;
    const freq = settings.wiggleFrequency * 0.01;
    const amount = settings.wiggleAmount;
    
    let wiggleX = 0;
    let wiggleY = 0;
    
    if (settings.wiggleBass) {
      const bassData = data.slice(0, Math.floor(len * 0.1));
      const idx = Math.floor((position * freq + lineIndex * 0.5) * bassData.length) % bassData.length;
      const val = (bassData[idx] / 255) * sensitivity;
      wiggleX += Math.sin(position * freq * 2 + lineIndex) * val * amount;
      wiggleY += Math.cos(position * freq * 2 + lineIndex) * val * amount;
    }
    
    if (settings.wiggleMid) {
      const midData = data.slice(Math.floor(len * 0.1), Math.floor(len * 0.4));
      const idx = Math.floor((position * freq * 2 + lineIndex * 0.3) * midData.length) % midData.length;
      const val = (midData[idx] / 255) * sensitivity;
      wiggleX += Math.sin(position * freq * 4 + lineIndex * 1.5) * val * amount * 0.7;
      wiggleY += Math.cos(position * freq * 4 + lineIndex * 1.5) * val * amount * 0.7;
    }
    
    if (settings.wiggleHigh) {
      const highData = data.slice(Math.floor(len * 0.4), len);
      const idx = Math.floor((position * freq * 4 + lineIndex * 0.2) * highData.length) % highData.length;
      const val = (highData[idx] / 255) * sensitivity;
      wiggleX += Math.sin(position * freq * 8 + lineIndex * 2) * val * amount * 0.5;
      wiggleY += Math.cos(position * freq * 8 + lineIndex * 2) * val * amount * 0.5;
    }
    
    return { x: wiggleX, y: wiggleY };
  };

  const noise = (() => {
    const p = new Array(512).fill(0).map(() => Math.floor(Math.random() * 256));
    return (x, y) => {
      const X = Math.floor(x) & 255;
      const Y = Math.floor(y) & 255;
      x -= Math.floor(x);
      y -= Math.floor(y);
      const fade = t => t * t * t * (t * (t * 6 - 15) + 10);
      const lerp = (t, a, b) => a + t * (b - a);
      const u = fade(x);
      const v = fade(y);
      const A = p[X] + Y;
      const B = p[X + 1] + Y;
      return lerp(v, lerp(u, p[A] / 128 - 1, p[B] / 128 - 1), lerp(u, p[A + 1] / 128 - 1, p[B + 1] / 128 - 1));
    };
  })();

  const getDistortion = (x, y, time, strength) => {
    const freq = 0.01;
    return {
      x: noise(x * freq + time * 0.1, y * freq) * strength,
      y: noise(x * freq + 100, y * freq + 100 + time * 0.1) * strength
    };
  };

  const render = (time = 0) => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    
    const ctx = canvas.getContext('2d');
    const width = canvas.width;
    const height = canvas.height;
    
    ctx.fillStyle = '#ffffff';
    ctx.fillRect(0, 0, width, height);
    ctx.fillStyle = '#000000';
    ctx.strokeStyle = '#000000';
    ctx.lineWidth = settings.lineThickness;
    
    const animTime = isAnimating ? time * 0.001 : 0;
    
    if (settings.patternType === 'vertical') {
      let lineIndex = 0;
      for (let x = 0; x < width; x += settings.spacing) {
        ctx.beginPath();
        for (let y = 0; y < height; y += 2) {
          let drawX = x;
          let drawY = y;
          
          const wiggle = getAudioWiggle(y, lineIndex);
          drawX += wiggle.x;
          
          if (settings.distortionEnabled) {
            const dist = getDistortion(x - width/2, y - height/2, animTime, settings.distortionStrength);
            drawX += dist.x;
            drawY += dist.y;
          }
          
          if (y === 0) ctx.moveTo(drawX, drawY);
          else ctx.lineTo(drawX, drawY);
        }
        ctx.stroke();
        lineIndex++;
      }
    } else {
      let lineIndex = 0;
      for (let y = 0; y < height; y += settings.spacing) {
        ctx.beginPath();
        for (let x = 0; x < width; x += 2) {
          let drawX = x;
          let drawY = y;
          
          const wiggle = getAudioWiggle(x, lineIndex);
          drawY += wiggle.y;
          
          if (settings.distortionEnabled) {
            const dist = getDistortion(x - width/2, y - height/2, animTime, settings.distortionStrength);
            drawX += dist.x;
            drawY += dist.y;
          }
          
          if (x === 0) ctx.moveTo(drawX, drawY);
          else ctx.lineTo(drawX, drawY);
        }
        ctx.stroke();
        lineIndex++;
      }
    }
  };

  useEffect(() => {
    const animate = (time) => {
      render(time);
      animationRef.current = requestAnimationFrame(animate);
    };
    animationRef.current = requestAnimationFrame(animate);
    return () => {
      if (animationRef.current) cancelAnimationFrame(animationRef.current);
    };
  }, [settings, isAnimating, audioEnabled]);

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
      <div className="w-80 bg-white shadow-lg p-4 overflow-y-auto space-y-4">
        <div className="flex gap-2 mb-4">
          <button onClick={() => setIsAnimating(!isAnimating)} className="flex items-center gap-1 px-3 py-2 bg-blue-500 text-white rounded text-sm">
            {isAnimating ? <><Pause size={14} /> Pause</> : <><Play size={14} /> Play</>}
          </button>
          <button onClick={() => setSettings(prev => ({ ...prev, lineThickness: Math.random() * 8 + 2, spacing: Math.random() * 30 + 15, distortionStrength: Math.random() * 40 + 10 }))} className="flex items-center gap-1 px-3 py-2 bg-green-500 text-white rounded text-sm">
            <RotateCcw size={14} /> Random
          </button>
          <button onClick={() => { const canvas = canvasRef.current; const link = document.createElement('a'); link.download = 'audio-moire.png'; link.href = canvas.toDataURL(); link.click(); }} className="flex items-center gap-1 px-3 py-2 bg-purple-500 text-white rounded text-sm">
            <Download size={14} /> Save
          </button>
        </div>

        <div>
          <h3 className="font-bold mb-2">🎛️ Pulsar 23 Audio Input</h3>
          <label className="flex items-center mb-3">
            <input type="checkbox" checked={audioEnabled} onChange={(e) => setAudioEnabled(e.target.checked)} className="mr-2" />
            Enable Audio Reactivity
          </label>
          
          {audioEnabled && (
            <div className="space-y-3">
              {audioDevices.length > 0 && (
                <div>
                  <label className="block text-xs mb-1">Input Device:</label>
                  <select value={selectedDevice || ''} onChange={(e) => setSelectedDevice(e.target.value)} className="w-full p-2 border rounded text-xs">
                    {audioDevices.map(d => <option key={d.deviceId} value={d.deviceId}>{d.label || `Device ${d.deviceId.substring(0, 8)}`}</option>)}
                  </select>
                </div>
              )}
              
              <div>
                <label className="block text-xs mb-1">Input Gain: {settings.audioSensitivity.toFixed(1)}x</label>
                <input type="range" min="0.5" max="10" step="0.1" value={settings.audioSensitivity} onChange={(e) => setSettings(prev => ({ ...prev, audioSensitivity: parseFloat(e.target.value) }))} className="w-full" />
              </div>
              
              <div className="bg-gradient-to-r from-blue-50 to-purple-50 p-3 rounded space-y-2">
                <div className="text-xs">
                  <div className="font-medium mb-1">Overall: {(audioLevels.overall * 100).toFixed(0)}%</div>
                  <div className="w-full bg-gray-200 rounded h-2">
                    <div className="bg-gradient-to-r from-blue-500 to-purple-500 h-2 rounded" style={{ width: (audioLevels.overall * 100) + '%' }} />
                  </div>
                </div>
                
                <div className="grid grid-cols-3 gap-2 text-xs">
                  <div>
                    <div className="font-medium mb-1">Bass</div>
                    <div className="w-full bg-gray-200 rounded h-1.5">
                      <div className="bg-red-500 h-1.5 rounded" style={{ width: (audioLevels.bass * 100) + '%' }} />
                    </div>
                  </div>
                  <div>
                    <div className="font-medium mb-1">Mid</div>
                    <div className="w-full bg-gray-200 rounded h-1.5">
                      <div className="bg-green-500 h-1.5 rounded" style={{ width: (audioLevels.mid * 100) + '%' }} />
                    </div>
                  </div>
                  <div>
                    <div className="font-medium mb-1">High</div>
                    <div className="w-full bg-gray-200 rounded h-1.5">
                      <div className="bg-blue-500 h-1.5 rounded" style={{ width: (audioLevels.high * 100) + '%' }} />
                    </div>
                  </div>
                </div>
              </div>
              
              <div className="space-y-2 bg-gray-50 p-2 rounded">
                <div className="text-xs font-semibold">Line Wiggle Controls:</div>
                <label className="flex items-center text-sm">
                  <input type="checkbox" checked={settings.wiggleBass} onChange={(e) => setSettings(prev => ({ ...prev, wiggleBass: e.target.checked }))} className="mr-2" />
                  Bass Wiggle 🔴
                </label>
                <label className="flex items-center text-sm">
                  <input type="checkbox" checked={settings.wiggleMid} onChange={(e) => setSettings(prev => ({ ...prev, wiggleMid: e.target.checked }))} className="mr-2" />
                  Mid Wiggle 🟢
                </label>
                <label className="flex items-center text-sm">
                  <input type="checkbox" checked={settings.wiggleHigh} onChange={(e) => setSettings(prev => ({ ...prev, wiggleHigh: e.target.checked }))} className="mr-2" />
                  High Wiggle 🔵
                </label>
              </div>
              
              <div>
                <label className="block text-xs mb-1">Wiggle Amount: {settings.wiggleAmount}</label>
                <input type="range" min="5" max="80" value={settings.wiggleAmount} onChange={(e) => setSettings(prev => ({ ...prev, wiggleAmount: parseInt(e.target.value) }))} className="w-full" />
              </div>
              
              <div>
                <label className="block text-xs mb-1">Wiggle Frequency: {settings.wiggleFrequency}</label>
                <input type="range" min="1" max="10" value={settings.wiggleFrequency} onChange={(e) => setSettings(prev => ({ ...prev, wiggleFrequency: parseInt(e.target.value) }))} className="w-full" />
              </div>
            </div>
          )}
        </div>

        <div>
          <h3 className="font-bold mb-2">Pattern</h3>
          <select value={settings.patternType} onChange={(e) => setSettings(prev => ({ ...prev, patternType: e.target.value }))} className="w-full p-2 border rounded mb-2">
            <option value="vertical">Vertical Lines</option>
            <option value="horizontal">Horizontal Lines</option>
          </select>
          
          <div>
            <label className="block text-sm mb-1">Thickness: {settings.lineThickness.toFixed(1)}</label>
            <input type="range" min="1" max="10" step="0.5" value={settings.lineThickness} onChange={(e) => setSettings(prev => ({ ...prev, lineThickness: parseFloat(e.target.value) }))} className="w-full" />
          </div>
          
          <div className="mt-2">
            <label className="block text-sm mb-1">Spacing: {settings.spacing}</label>
            <input type="range" min="10" max="60" value={settings.spacing} onChange={(e) => setSettings(prev => ({ ...prev, spacing: parseInt(e.target.value) }))} className="w-full" />
          </div>
        </div>

        <div>
          <h3 className="font-bold mb-2">Distortion</h3>
          <label className="flex items-center mb-2">
            <input type="checkbox" checked={settings.distortionEnabled} onChange={(e) => setSettings(prev => ({ ...prev, distortionEnabled: e.target.checked }))} className="mr-2" />
            Enable Distortion
          </label>
          {settings.distortionEnabled && (
            <div>
              <label className="block text-sm mb-1">Strength: {settings.distortionStrength}</label>
              <input type="range" min="5" max="80" value={settings.distortionStrength} onChange={(e) => setSettings(prev => ({ ...prev, distortionStrength: parseInt(e.target.value) }))} className="w-full" />
            </div>
          )}
        </div>
      </div>

      <div className="flex-1 p-4">
        <canvas ref={canvasRef} className="w-full h-full border border-gray-300 bg-white rounded-lg shadow-lg" />
      </div>
    </div>
  );
};

export default AudioReactiveMoire;
