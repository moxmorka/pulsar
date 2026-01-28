import React, { useState, useEffect, useRef } from 'react';
import { Play, Pause, Download, Mic, MicOff, RotateCcw } from 'lucide-react';

const AudioVisualSynth = () => {
  const canvasRef = useRef(null);
  const animationRef = useRef(null);
  const [isAnimating, setIsAnimating] = useState(true);
  const [audioEnabled, setAudioEnabled] = useState(false);
  const audioContextRef = useRef(null);
  const analyserRef = useRef(null);
  
  const audioDataRef = useRef({
    bassSmooth: 0, midSmooth: 0, highSmooth: 0, overallSmooth: 0,
    bassHistory: new Array(120).fill(0), midHistory: new Array(120).fill(0),
  });
  
  const [settings, setSettings] = useState({
    showCurves: true, showMoire: true, showShapes: true, showText: false,
    curveComplexity: 3, curveStyle: 'harmonic',
    moireType: 'vertical-lines', moireSpacing: 25, moireThickness: 2,
    shapeCount: 5, shapeIndex: 0, shapeSize: 100,
    text: '', fontSize: 120, font: 'Impact',
    distortionEnabled: true, distortionType: 'liquify', distortionStrength: 25, distortionSpeed: 1,
    sensitivity: 2.5, smoothing: 0.88, colorMode: 'monochrome',
  });

  const distortionTypes = [
    { value: 'liquify', label: 'Liquify' }, { value: 'ripple', label: 'Ripple' },
    { value: 'swirl', label: 'Swirl' }, { value: 'wave', label: 'Wave' },
    { value: 'turbulence', label: 'Turbulence' }, { value: 'marble', label: 'Marble' },
  ];

  const shapes = [
    { name: 'Circle', draw: (ctx, s) => { ctx.beginPath(); ctx.arc(s/2, s/2, s*0.4, 0, Math.PI*2); ctx.stroke(); }},
    { name: 'Crescent', draw: (ctx, s) => { ctx.beginPath(); ctx.arc(s/2, s/2, s*0.4, 0.3, Math.PI*2-0.3); ctx.stroke(); }},
    { name: 'Semicircle', draw: (ctx, s) => { ctx.beginPath(); ctx.arc(s/2, s/2, s*0.4, 0, Math.PI); ctx.stroke(); }},
    { name: 'Ring', draw: (ctx, s) => { ctx.beginPath(); ctx.arc(s/2, s/2, s*0.4, 0, Math.PI*2); ctx.stroke(); ctx.beginPath(); ctx.arc(s/2, s/2, s*0.28, 0, Math.PI*2); ctx.stroke(); }},
    { name: 'Square', draw: (ctx, s) => { const sq = s*0.7; const o = (s-sq)/2; ctx.strokeRect(o, o, sq, sq); }},
  ];

  useEffect(() => {
    const initAudio = async () => {
      if (!audioEnabled) return;
      try {
        const stream = await navigator.mediaDevices.getUserMedia({ audio: { echoCancellation: false, noiseSuppression: false, autoGainControl: false } });
        const audioContext = new (window.AudioContext || window.webkitAudioContext)();
        audioContextRef.current = audioContext;
        const source = audioContext.createMediaStreamSource(stream);
        const gainNode = audioContext.createGain();
        gainNode.gain.value = settings.sensitivity;
        const analyser = audioContext.createAnalyser();
        analyser.fftSize = 4096;
        analyser.smoothingTimeConstant = 0.3;
        analyserRef.current = analyser;
        source.connect(gainNode);
        gainNode.connect(analyser);
        
        const update = () => {
          if (!audioEnabled || !analyserRef.current) return;
          const bufferLength = analyserRef.current.frequencyBinCount;
          const dataArray = new Uint8Array(bufferLength);
          analyserRef.current.getByteFrequencyData(dataArray);
          const bass = dataArray.slice(0, Math.floor(bufferLength*0.05)).reduce((a,b)=>a+b,0) / Math.floor(bufferLength*0.05) / 255;
          const mid = dataArray.slice(Math.floor(bufferLength*0.05), Math.floor(bufferLength*0.25)).reduce((a,b)=>a+b,0) / Math.floor(bufferLength*0.2) / 255;
          const high = dataArray.slice(Math.floor(bufferLength*0.25), Math.floor(bufferLength*0.6)).reduce((a,b)=>a+b,0) / Math.floor(bufferLength*0.35) / 255;
          const overall = dataArray.reduce((a,b)=>a+b,0) / bufferLength / 255;
          const sf = settings.smoothing;
          const d = audioDataRef.current;
          d.bassSmooth = d.bassSmooth*sf + bass*(1-sf);
          d.midSmooth = d.midSmooth*sf + mid*(1-sf);
          d.highSmooth = d.highSmooth*sf + high*(1-sf);
          d.overallSmooth = d.overallSmooth*sf + overall*(1-sf);
          d.bassHistory.shift(); d.bassHistory.push(d.bassSmooth);
          d.midHistory.shift(); d.midHistory.push(d.midSmooth);
          requestAnimationFrame(update);
        };
        update();
      } catch (err) { console.error('Audio error:', err); }
    };
    if (audioEnabled) initAudio();
    return () => audioContextRef.current?.close();
  }, [audioEnabled]);

  const noise = (() => {
    const p = []; for (let i = 0; i < 512; i++) p[i] = Math.floor(Math.random()*256);
    return (x, y) => {
      const X = Math.floor(x)&255, Y = Math.floor(y)&255;
      x -= Math.floor(x); y -= Math.floor(y);
      const fade = t => t*t*t*(t*(t*6-15)+10), u = fade(x), v = fade(y);
      const A = p[X]+Y, B = p[X+1]+Y;
      const lerp = (t,a,b) => a+t*(b-a);
      return lerp(v, lerp(u, p[A]/128-1, p[B]/128-1), lerp(u, p[A+1]/128-1, p[B+1]/128-1));
    };
  })();

  const getDistortion = (x, y, time, strength, type) => {
    const freq = 0.008, t = time || 0;
    let dx = 0, dy = 0;
    switch (type) {
      case 'liquify': dx = noise(x*freq+t*0.1, y*freq)*strength; dy = noise(x*freq+100, y*freq+100+t*0.1)*strength; break;
      case 'ripple': const dist = Math.sqrt(x*x+y*y), ripple = Math.sin(dist*0.02+t*2)*strength; dx = (x/(dist||1))*ripple; dy = (y/(dist||1))*ripple; break;
      case 'swirl': const angle = Math.atan2(y,x), radius = Math.sqrt(x*x+y*y), swirlAmount = strength*0.001+t*0.3, newAngle = angle+swirlAmount*(1/(1+radius*0.01)); dx = Math.cos(newAngle)*radius-x; dy = Math.sin(newAngle)*radius-y; break;
      case 'wave': dx = Math.sin(y*freq*5+t*2)*strength; dy = Math.cos(x*freq*3+t*1.5)*strength; break;
      case 'turbulence': dx = Math.abs(noise(x*freq+t*0.2, y*freq))*strength; dy = Math.abs(noise(x*freq+200, y*freq+200+t*0.2))*strength; break;
      case 'marble': const m1 = x*freq+strength*0.1*noise(x*freq*2+t*0.1, y*freq*2), m2 = y*freq+strength*0.1*noise(x*freq*2+100, y*freq*2+100+t*0.1); dx = Math.sin(m1+t*0.5)*strength; dy = Math.sin(m2+t*0.5)*strength; break;
    }
    return { x: dx, y: dy };
  };

  const genCurve = (w, h, ad, layer, time) => {
    const pts = [], segs = 100;
    for (let i = 0; i <= segs; i++) {
      const t = i/segs, x = t*w;
      let y = h/2 + (layer-1)*h*0.12;
      if (settings.curveStyle === 'harmonic') y += Math.sin(t*Math.PI*2+time*0.5+layer*0.8)*ad.bassSmooth*h*0.2 + Math.sin(t*Math.PI*6+time*1.5)*ad.midSmooth*h*0.1;
      else if (settings.curveStyle === 'waveform') { const idx = Math.floor(t*ad.bassHistory.length); y = h/2+(layer-1)*h*0.15 + (ad.bassHistory[idx]||0)*h*0.25 + (ad.midHistory[idx]||0)*h*0.1; }
      else { const f1 = Math.sin(t*Math.PI*3+time*0.8)*ad.bassSmooth, f2 = Math.sin(t*Math.PI*8+time*1.2)*ad.midSmooth; y = h/2+(layer-1)*h*0.1 + (f1+f2)*h*0.15; }
      pts.push({ x, y });
    }
    return pts;
  };

  const drawCurve = (ctx, pts) => {
    if (pts.length < 2) return;
    ctx.beginPath(); ctx.moveTo(pts[0].x, pts[0].y);
    for (let i = 0; i < pts.length-1; i++) {
      const p0 = pts[Math.max(0,i-1)], p1 = pts[i], p2 = pts[i+1], p3 = pts[Math.min(pts.length-1,i+2)];
      const t = 0.4, cp1x = p1.x+(p2.x-p0.x)*t, cp1y = p1.y+(p2.y-p0.y)*t, cp2x = p2.x-(p3.x-p1.x)*t, cp2y = p2.y-(p3.y-p1.y)*t;
      ctx.bezierCurveTo(cp1x, cp1y, cp2x, cp2y, p2.x, p2.y);
    }
    ctx.stroke();
  };

  const render = (time = 0) => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext('2d'), w = canvas.width, h = canvas.height, t = time*0.001;
    ctx.fillStyle = settings.colorMode === 'gradient' ? (() => { const g = ctx.createLinearGradient(0,0,0,h); g.addColorStop(0,'#F5F5F7'); g.addColorStop(1,'#E8E8ED'); return g; })() : '#FAFAFA';
    ctx.fillRect(0, 0, w, h);
    const ad = audioDataRef.current, at = isAnimating ? t*settings.distortionSpeed : 0;
    ctx.lineCap = 'round'; ctx.lineJoin = 'round';
    
    if (settings.showCurves) {
      for (let layer = 0; layer < settings.curveComplexity; layer++) {
        const pts = genCurve(w, h, ad, layer, t);
        ctx.strokeStyle = `rgba(0,0,0,${0.25+(layer/settings.curveComplexity)*0.4})`;
        ctx.lineWidth = 2+ad.midSmooth*3;
        if (settings.distortionEnabled) {
          const dpts = pts.map(p => { const d = getDistortion(p.x-w/2, p.y-h/2, at, settings.distortionStrength, settings.distortionType); return {x:p.x+d.x, y:p.y+d.y}; });
          drawCurve(ctx, dpts);
        } else drawCurve(ctx, pts);
      }
    }
    
    if (settings.showMoire) {
      const sp = settings.moireSpacing*(0.8+ad.bassSmooth*0.4), th = settings.moireThickness*(1+ad.midSmooth*1.5);
      ctx.strokeStyle = `rgba(0,0,0,${0.15+ad.overallSmooth*0.2})`; ctx.lineWidth = th;
      if (settings.moireType === 'vertical-lines') {
        for (let x = 0; x < w; x += sp) { ctx.beginPath(); for (let y = 0; y < h; y += 2) { let dx=x, dy=y; if (settings.distortionEnabled) { const d = getDistortion(x-w/2, y-h/2, at, settings.distortionStrength*0.8, settings.distortionType); dx+=d.x; dy+=d.y; } if (y===0) ctx.moveTo(dx,dy); else ctx.lineTo(dx,dy); } ctx.stroke(); }
      } else if (settings.moireType === 'horizontal-lines') {
        for (let y = 0; y < h; y += sp) { ctx.beginPath(); for (let x = 0; x < w; x += 2) { let dx=x, dy=y; if (settings.distortionEnabled) { const d = getDistortion(x-w/2, y-h/2, at, settings.distortionStrength*0.8, settings.distortionType); dx+=d.x; dy+=d.y; } if (x===0) ctx.moveTo(dx,dy); else ctx.lineTo(dx,dy); } ctx.stroke(); }
      } else if (settings.moireType === 'circles') {
        const mr = Math.sqrt(w*w+h*h)/2;
        for (let r = sp; r < mr; r += sp) { const pts = []; for (let i = 0; i <= 150; i++) { const a = (i/150)*Math.PI*2; let x = w/2+Math.cos(a)*r, y = h/2+Math.sin(a)*r; if (settings.distortionEnabled) { const d = getDistortion(x-w/2, y-h/2, at, settings.distortionStrength*0.6, settings.distortionType); x+=d.x; y+=d.y; } pts.push({x,y}); } ctx.beginPath(); ctx.moveTo(pts[0].x, pts[0].y); for (let p of pts) ctx.lineTo(p.x, p.y); ctx.closePath(); ctx.stroke(); }
      } else if (settings.moireType === 'grid') {
        for (let x = 0; x < w; x += sp) { ctx.beginPath(); for (let y = 0; y < h; y += 2) { let dx=x, dy=y; if (settings.distortionEnabled) { const d = getDistortion(x-w/2, y-h/2, at, settings.distortionStrength*0.7, settings.distortionType); dx+=d.x; dy+=d.y; } if (y===0) ctx.moveTo(dx,dy); else ctx.lineTo(dx,dy); } ctx.stroke(); }
        for (let y = 0; y < h; y += sp) { ctx.beginPath(); for (let x = 0; x < w; x += 2) { let dx=x, dy=y; if (settings.distortionEnabled) { const d = getDistortion(x-w/2, y-h/2, at, settings.distortionStrength*0.7, settings.distortionType); dx+=d.x; dy+=d.y; } if (x===0) ctx.moveTo(dx,dy); else ctx.lineTo(dx,dy); } ctx.stroke(); }
      } else if (settings.moireType === 'checkerboard') {
        for (let y = 0; y < h; y += sp) { for (let x = 0; x < w; x += sp) { let dx=x, dy=y; if (settings.distortionEnabled) { const d = getDistortion(x-w/2, y-h/2, at, settings.distortionStrength, settings.distortionType); dx+=d.x; dy+=d.y; } if ((Math.floor(x/sp)+Math.floor(y/sp))%2===0) ctx.fillRect(dx, dy, sp, sp); }}
      }
    }
    
    if (settings.showShapes) {
      ctx.strokeStyle = 'rgba(0,0,0,0.5)'; ctx.lineWidth = 2;
      for (let i = 0; i < settings.shapeCount; i++) {
        const a = (i/settings.shapeCount)*Math.PI*2+t*0.2, d = w*0.22*(1+ad.bassSmooth*0.25);
        const x = w/2+Math.cos(a)*d, y = h/2+Math.sin(a)*d, r = (w*0.06)*(1+ad.midSmooth*0.4)*(settings.shapeSize/100);
        const sh = shapes[settings.shapeIndex];
        if (settings.distortionEnabled) {
          const res = 100, tc = document.createElement('canvas'), tctx = tc.getContext('2d');
          tc.width = res; tc.height = res; tctx.strokeStyle = '#000'; tctx.lineWidth = 2;
          sh.draw(tctx, res);
          const id = tctx.getImageData(0, 0, res, res);
          for (let py = 0; py < res; py += 3) { for (let px = 0; px < res; px += 3) { const idx = (py*res+px)*4; if (id.data[idx+3] > 50) { const rx = (px-res/2)/res*r*2, ry = (py-res/2)/res*r*2, wx = x+rx, wy = y+ry, di = getDistortion(wx-w/2, wy-h/2, at+i*0.3, settings.distortionStrength*0.8, settings.distortionType); ctx.fillRect(wx+di.x, wy+di.y, 2, 2); }}}
        } else { ctx.save(); ctx.translate(x-r, y-r); sh.draw(ctx, r*2); ctx.restore(); }
      }
    }
    
    if (settings.showText && settings.text) {
      ctx.save();
      let fs = Math.max(w,h)*0.6;
      if (settings.text.length > 1) fs = fs/Math.sqrt(settings.text.length*0.5);
      fs = fs*(settings.fontSize/100);
      const cx = w/2, cy = h/2;
      if (settings.distortionEnabled) {
        const chars = settings.text.split('');
        ctx.font = `900 ${fs}px "${settings.font}", Impact`;
        const tw = ctx.measureText(settings.text).width, cw = tw/chars.length;
        chars.forEach((ch, ci) => {
          const cbx = cx-tw/2+ci*cw+cw/2, cby = cy, tc = document.createElement('canvas'), tctx = tc.getContext('2d'), res = 150;
          tc.width = res; tc.height = res; tctx.font = `900 ${res*0.7}px "${settings.font}"`; tctx.fillStyle = '#000'; tctx.textAlign = 'center'; tctx.textBaseline = 'middle';
          tctx.fillText(ch, res/2, res/2);
          const id = tctx.getImageData(0, 0, res, res);
          for (let y = 0; y < res; y += 3) { for (let x = 0; x < res; x += 3) { const idx = (y*res+x)*4; if (id.data[idx+3] > 50) { const rx = (x-res/2)/res*fs, ry = (y-res/2)/res*fs, wx = cbx+rx, wy = cby+ry, di = getDistortion(wx-w/2, wy-h/2, at+ci*1.5, settings.distortionStrength, settings.distortionType); ctx.fillRect(wx+di.x*1.2, wy+di.y*1.2, Math.max(2,fs/120), Math.max(2,fs/120)); }}}
        });
      } else { ctx.font = `900 ${fs}px "${settings.font}", Impact`; ctx.fillStyle = '#000'; ctx.textAlign = 'center'; ctx.textBaseline = 'middle'; ctx.fillText(settings.text, cx, cy); }
      ctx.restore();
    }
  };

  useEffect(() => { const loop = time => { render(time); if (isAnimating) animationRef.current = requestAnimationFrame(loop); }; if (isAnimating) animationRef.current = requestAnimationFrame(loop); return () => { if (animationRef.current) cancelAnimationFrame(animationRef.current); }; }, [isAnimating, settings]);
  useEffect(() => { const handleResize = () => { const canvas = canvasRef.current; if (canvas) { canvas.width = canvas.offsetWidth*window.devicePixelRatio; canvas.height = canvas.offsetHeight*window.devicePixelRatio; canvas.getContext('2d').scale(window.devicePixelRatio, window.devicePixelRatio); render(); }}; handleResize(); window.addEventListener('resize', handleResize); return () => window.removeEventListener('resize', handleResize); }, []);

  return (
    <div className="w-full h-screen bg-gray-50 flex">
      <div className="w-80 bg-white border-r p-4 overflow-y-auto">
        <h1 className="text-lg font-semibold mb-4">Audio Visual Synth</h1>
        <div className="space-y-4">
          <div className="flex gap-2">
            <button onClick={() => setIsAnimating(!isAnimating)} className="flex-1 flex items-center justify-center gap-1 px-3 py-2 bg-blue-500 text-white rounded text-sm">{isAnimating ? <Pause size={14} /> : <Play size={14} />}</button>
            <button onClick={() => setSettings(p => ({ ...p, distortionStrength: Math.random()*40+20, moireSpacing: Math.random()*30+15 }))} className="flex-1 flex items-center justify-center gap-1 px-3 py-2 bg-green-500 text-white rounded text-sm"><RotateCcw size={14} /></button>
            <button onClick={() => { const link = document.createElement('a'); link.download = 'synth.png'; link.href = canvasRef.current.toDataURL(); link.click(); }} className="flex-1 flex items-center justify-center gap-1 px-3 py-2 bg-purple-500 text-white rounded text-sm"><Download size={14} /></button>
          </div>
          <div><h3 className="font-semibold mb-2">Audio</h3><button onClick={() => setAudioEnabled(!audioEnabled)} className={`w-full flex items-center justify-center gap-2 px-3 py-2 rounded ${audioEnabled ? 'bg-blue-500 text-white' : 'bg-gray-200'}`}>{audioEnabled ? <Mic size={16} /> : <MicOff size={16} />}{audioEnabled ? 'Active' : 'Enable'}</button>{audioEnabled && <div className="mt-3 space-y-2 text-xs"><div className="flex justify-between"><span>Bass</span><span>{(audioDataRef.current.bassSmooth*100).toFixed(0)}%</span></div><div className="w-full bg-gray-200 rounded h-1"><div className="bg-red-500 h-1 rounded" style={{width:`${audioDataRef.current.bassSmooth*100}%`}} /></div><div className="flex justify-between"><span>Mid</span><span>{(audioDataRef.current.midSmooth*100).toFixed(0)}%</span></div><div className="w-full bg-gray-200 rounded h-1"><div className="bg-green-500 h-1 rounded" style={{width:`${audioDataRef.current.midSmooth*100}%`}} /></div></div>}</div>
          <div><h3 className="font-semibold mb-2">Layers</h3><label className="flex items-center mb-1 text-sm"><input type="checkbox" checked={settings.showCurves} onChange={e => setSettings(p => ({ ...p, showCurves: e.target.checked }))} className="mr-2" />Audio Curves</label><label className="flex items-center mb-1 text-sm"><input type="checkbox" checked={settings.showMoire} onChange={e => setSettings(p => ({ ...p, showMoire: e.target.checked }))} className="mr-2" />Moiré Pattern</label><label className="flex items-center mb-1 text-sm"><input type="checkbox" checked={settings.showShapes} onChange={e => setSettings(p => ({ ...p, showShapes: e.target.checked }))} className="mr-2" />Munari Shapes</label><label className="flex items-center text-sm"><input type="checkbox" checked={settings.showText} onChange={e => setSettings(p => ({ ...p, showText: e.target.checked }))} className="mr-2" />Text</label></div>
          {settings.showCurves && <div><h3 className="font-semibold mb-2">Curves</h3><select value={settings.curveStyle} onChange={e => setSettings(p => ({ ...p, curveStyle: e.target.value }))} className="w-full p-2 border rounded mb-2 text-sm"><option value="harmonic">Harmonic</option><option value="waveform">Waveform</option><option value="frequency">Frequency</option></select><label className="block text-sm mb-1">Complexity: {settings.curveComplexity}</label><input type="range" min="1" max="6" value={settings.curveComplexity} onChange={e => setSettings(p => ({ ...p, curveComplexity: parseInt(e.target.value) }))} className="w-full" /></div>}
          {settings.showMoire && <div><h3 className="font-semibold mb-2">Moiré</h3><select value={settings.moireType} onChange={e => setSettings(p => ({ ...p, moireType: e.target.value }))} className="w-full p-2 border rounded mb-2 text-sm"><option value="vertical-lines">Vertical Lines</option><option value="horizontal-lines">Horizontal Lines</option><option value="circles">Circles</option><option value="grid">Grid</option><option value="checkerboard">Checkerboard</option></select><label className="block text-sm mb-1">Spacing: {settings.moireSpacing}</label><input type="range" min="10" max="60" value={settings.moireSpacing} onChange={e => setSettings(p => ({ ...p, moireSpacing: parseInt(e.target.value) }))} className="w-full" /></div>}
          {settings.showShapes && <div><h3 className="font-semibold mb-2">Shapes</h3><label className="block text-sm mb-1">{shapes[settings.shapeIndex].name}</label><input type="range" min="0" max={shapes.length-1} value={settings.shapeIndex} onChange={e => setSettings(p => ({ ...p, shapeIndex: parseInt(e.target.value) }))} className="w-full mb-2" /><label className="block text-sm mb-1">Count: {settings.shapeCount}</label><input type="range" min="2" max="12" value={settings.shapeCount} onChange={e => setSettings(p => ({ ...p, shapeCount: parseInt(e.target.value) }))} className="w-full mb-2" /><label className="block text-sm mb-1">Size: {settings.shapeSize}%</label><input type="range" min="30" max="200" value={settings.shapeSize} onChange={e => setSettings(p => ({ ...p, shapeSize: parseInt(e.target.value) }))} className="w-full" /></div>}
          {settings.showText && <div><h3 className="font-semibold mb-2">Text</h3><input type="text" value={settings.text} onChange={e => setSettings(p => ({ ...p, text: e.target.value }))} className="w-full p-2 border rounded mb-2 text-sm" placeholder="Type text..." /><label className="block text-sm mb-1">Size: {settings.fontSize}%</label><input type="range" min="50" max="200" value={settings.fontSize} onChange={e => setSettings(p => ({ ...p, fontSize: parseInt(e.target.value) }))} className="w-full" /></div>}
          <div><h3 className="font-semibold mb-2">Distortion</h3><label className="flex items-center mb-2 text-sm"><input type="checkbox" checked={settings.distortionEnabled} onChange={e => setSettings(p => ({ ...p, distortionEnabled: e.target.checked }))} className="mr-2" />Enable Flow</label>{settings.distortionEnabled && <><select value={settings.distortionType} onChange={e => setSettings(p => ({ ...p, distortionType: e.target.value }))} className="w-full p-2 border rounded mb-2 text-sm">{distortionTypes.map(t => <option key={t.value} value={t.value}>{t.label}</option>)}</select><label className="block text-sm mb-1">Strength: {settings.distortionStrength}</label><input type="range" min="5" max="80" value={settings.distortionStrength} onChange={e => setSettings(p => ({ ...p, distortionStrength: parseInt(e.target.value) }))} className="w-full" /><label className="block text-sm mb-1">Speed: {settings.distortionSpeed}</label><input type="range" min="0.1" max="3" step="0.1" value={settings.distortionSpeed} onChange={e => setSettings(p => ({ ...p, distortionSpeed: parseFloat(e.target.value) }))} className="w-full" /></>}</div>
          <div><h3 className="font-semibold mb-2">Color</h3><div className="space-y-1">{['monochrome', 'gradient', 'duotone'].map(mode => <button key={mode} onClick={() => setSettings(p => ({ ...p, colorMode: mode }))} className={`w-full px-3 py-2 rounded text-sm capitalize ${settings.colorMode === mode ? 'bg-gray-900 text-white' : 'bg-gray-100'}`}>{mode}</button>)}</div></div>
        </div>
      </div>
      <div className="flex-1 p-4"><canvas ref={canvasRef} className="w-full h-full bg-white rounded-lg shadow-lg" /></div>
    </div>
  );
};

export default AudioVisualSynth;
