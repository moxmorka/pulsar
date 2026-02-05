import React from 'react';
import { RotateCcw, Download, Play, Square } from 'lucide-react';

const App = () => {
  const canvasRef = React.useRef(null);
  const animRef = React.useRef(null);
  const audioRef = React.useRef(null);
  const analyserRef = React.useRef(null);
  const midiVelRef = React.useRef(0);
  const midiNoteRef = React.useRef(0);
  const smoothAudioRef = React.useRef(0);
  const smoothBassRef = React.useRef(0);

  const [audioOn, setAudioOn] = React.useState(false);
  const [audioLvl, setAudioLvl] = React.useState(0);
  const [bassLvl, setBassLvl] = React.useState(0);
  const [cells, setCells] = React.useState([]);
  const [menu, setMenu] = React.useState(null);
  const [drawing, setDrawing] = React.useState(false);
  const [midiOn, setMidiOn] = React.useState(false);
  const [midiDevs, setMidiDevs] = React.useState([]);
  const [audioDevs, setAudioDevs] = React.useState([]);
  const [selAudio, setSelAudio] = React.useState('');

  const [s, setS] = React.useState({
    pat: 'swiss-grid', thick: 2, space: 40, distOn: false, distType: 'liquify', distStr: 30, distSpd: 1,
    audioSens: 3, midiSens: 2, dotSz: 4, shapeSz: 8, txt: 'SOUND', fontSz: 48, chars: '01', charSz: 24,
    charSpd: 2, cols: 12, rows: 16, grid: true, rot: 0, cycle: 'crossfade', behave: 'pulse', strBehave: 'wave',
    stagger: 0.08, draw: false, selEl: 'char', pixOn: false, pixSz: 4
  });

  const ease = (t) => t < 0.5 ? 2 * t * t : -1 + (4 - 2 * t) * t;

  React.useEffect(() => {
    navigator.mediaDevices.enumerateDevices().then(d => {
      const a = d.filter(x => x.kind === 'audioinput');
      setAudioDevs(a);
      if (a.length > 0) setSelAudio(a[0].deviceId);
    });
  }, []);

  React.useEffect(() => {
    if (!midiOn) { midiVelRef.current = 0; return; }
    navigator.requestMIDIAccess().then(acc => {
      const devs = [];
      for (const inp of acc.inputs.values()) {
        devs.push(inp.name);
        inp.onmidimessage = (e) => {
          const [st, n, v] = e.data;
          if ((st >> 4) === 9 && v > 0) { midiNoteRef.current = n; midiVelRef.current = v / 127; }
          else midiVelRef.current = 0;
        };
      }
      setMidiDevs(devs);
    });
  }, [midiOn]);

  React.useEffect(() => {
    if (!audioOn) {
      if (audioRef.current) audioRef.current.close();
      setAudioLvl(0); setBassLvl(0); smoothAudioRef.current = 0; smoothBassRef.current = 0;
      return;
    }
    navigator.mediaDevices.getUserMedia({ audio: selAudio ? { deviceId: { exact: selAudio } } : true }).then(st => {
      const ac = new (window.AudioContext || window.webkitAudioContext)();
      audioRef.current = ac;
      const an = ac.createAnalyser();
      an.fftSize = 2048;
      analyserRef.current = an;
      ac.createMediaStreamSource(st).connect(an);
      const upd = () => {
        if (!analyserRef.current) return;
        const d = new Uint8Array(analyserRef.current.frequencyBinCount);
        analyserRef.current.getByteFrequencyData(d);
        const b = d.slice(0, 50).reduce((a, x) => a + x, 0) / 50 / 255;
        const o = d.reduce((a, x) => a + x, 0) / d.length / 255;
        smoothAudioRef.current += (o - smoothAudioRef.current) * 0.15;
        smoothBassRef.current += (b - smoothBassRef.current) * 0.15;
        setAudioLvl(smoothAudioRef.current); setBassLvl(smoothBassRef.current);
        requestAnimationFrame(upd);
      };
      upd();
    });
  }, [audioOn, selAudio]);

  const noise = (() => { const p = []; for (let i = 0; i < 512; i++) p[i] = Math.floor(Math.random() * 256); return (x, y) => { const X = Math.floor(x) & 255, Y = Math.floor(y) & 255; x -= Math.floor(x); y -= Math.floor(y); const f = t => t * t * t * (t * (t * 6 - 15) + 10); const u = f(x), v = f(y), A = p[X] + Y, B = p[X + 1] + Y; const l = (t, a, b) => a + t * (b - a); return l(v, l(u, p[A] / 128 - 1, p[B] / 128 - 1), l(u, p[A + 1] / 128 - 1, p[B + 1] / 128 - 1)); }; })();

  const dist = (x, y, t, str, tp) => { const f = 0.008; let dx = 0, dy = 0; if (tp === 'liquify') { dx = noise((x + t * 30) * f, y * f) * str; dy = noise((x + t * 30) * f + 100, (y + t * 20) * f + 100) * str; } else if (tp === 'ripple') { const d = Math.sqrt(x * x + y * y), r = Math.sin((d - t * 40) * 0.015) * str; dx = (x / (d || 1)) * r; dy = (y / (d || 1)) * r; } else if (tp === 'swirl') { const a = Math.atan2(y, x), rad = Math.sqrt(x * x + y * y), na = a + t * 0.2 + (str * 0.0008) * (1 / (1 + rad * 0.01)); dx = Math.cos(na) * rad - x; dy = Math.sin(na) * rad - y; } return { x: dx, y: dy }; };

  const gen = () => { const c = [], tot = s.cols * s.rows, u = new Set(); for (let i = 0; i < Math.floor(tot * 0.25); i++) { let idx; do { idx = Math.floor(Math.random() * tot); } while (u.has(idx)); u.add(idx); c.push({ idx, type: ['char', 'dot', 'square'][Math.floor(Math.random() * 3)], ph: Math.random() * Math.PI * 2 }); } setCells(c); };

  const getC = (cx, cy) => { const cv = canvasRef.current; if (!cv) return null; const cw = cv.width / s.cols, ch = cv.height / s.rows; const col = Math.floor(cx / cw), row = Math.floor(cy / ch); return (col >= 0 && col < s.cols && row >= 0 && row < s.rows) ? row * s.cols + col : null; };

  const clk = (e) => { if (s.pat !== 'swiss-grid') return; const cv = canvasRef.current, r = cv.getBoundingClientRect(); const x = (e.clientX - r.left) * (cv.width / r.width), y = (e.clientY - r.top) * (cv.height / r.height); const idx = getC(x, y); if (idx === null) return; if (s.draw) setCells(p => { const ex = p.findIndex(c => c.idx === idx); return ex === -1 ? [...p, { idx, type: s.selEl, ph: Math.random() * Math.PI * 2 }] : p; }); else { e.preventDefault(); setMenu({ x: e.clientX, y: e.clientY, idx }); } };

  const down = (e) => { if (s.pat === 'swiss-grid' && s.draw) { setDrawing(true); clk(e); }};
  const move = (e) => { if (!drawing || s.pat !== 'swiss-grid' || !s.draw) return; const cv = canvasRef.current, r = cv.getBoundingClientRect(); const x = (e.clientX - r.left) * (cv.width / r.width), y = (e.clientY - r.top) * (cv.height / r.height); const idx = getC(x, y); if (idx !== null) setCells(p => { const ex = p.findIndex(c => c.idx === idx); return ex === -1 ? [...p, { idx, type: s.selEl, ph: Math.random() * Math.PI * 2 }] : p; }); };
  const up = () => setDrawing(false);

  const add = (tp) => { if (menu) { const ex = cells.findIndex(c => c.idx === menu.idx); if (ex >= 0) { const n = [...cells]; n[ex] = { idx: menu.idx, type: tp, ph: Math.random() * Math.PI * 2 }; setCells(n); } else setCells([...cells, { idx: menu.idx, type: tp, ph: Math.random() * Math.PI * 2 }]); setMenu(null); }};
  const rem = () => { if (menu) { setCells(cells.filter(c => c.idx !== menu.idx)); setMenu(null); }};

  React.useEffect(() => { const cl = () => setMenu(null); window.addEventListener('click', cl); return () => window.removeEventListener('click', cl); }, []);

  const render = (tm = 0) => {
    const cv = canvasRef.current; if (!cv) return;
    const ctx = cv.getContext('2d'), w = cv.width, h = cv.height;
    ctx.fillStyle = '#FAFAFA'; ctx.fillRect(0, 0, w, h); ctx.fillStyle = '#0A0A0A';
    const at = tm * 0.001 * s.distSpd, midi = midiVelRef.current * s.midiSens;
    const aud = smoothAudioRef.current * s.audioSens, bass = smoothBassRef.current * s.audioSens;

    if (s.pat === 'vertical-lines') {
      const th = s.thick * (1 + bass * 0.5);
      for (let x = 0; x < w; x += s.space) { ctx.beginPath(); for (let y = 0; y < h; y += 2) { let dx = x, dy = y; if (s.distOn) { const d = dist(x - w/2, y - h/2, at, s.distStr * (1 + aud), s.distType); dx += d.x; dy += d.y; } if (y === 0) ctx.moveTo(dx, dy); else ctx.lineTo(dx, dy); } ctx.lineWidth = th; ctx.stroke(); }
    } else if (s.pat === 'horizontal-lines') {
      const th = s.thick * (1 + bass * 0.5);
      for (let y = 0; y < h; y += s.space) { ctx.beginPath(); for (let x = 0; x < w; x += 2) { let dx = x, dy = y; if (s.distOn) { const d = dist(x - w/2, y - h/2, at, s.distStr * (1 + aud), s.distType); dx += d.x; dy += d.y; } if (x === 0) ctx.moveTo(dx, dy); else ctx.lineTo(dx, dy); } ctx.lineWidth = th; ctx.stroke(); }
    } else if (s.pat === 'dots') {
      const ds = s.dotSz * (1 + (bass + midi) * 0.6);
      for (let y = 0; y < h; y += s.space) for (let x = 0; x < w; x += s.space) { let dx = x, dy = y; if (s.distOn) { const d = dist(x - w/2, y - h/2, at, s.distStr * (1 + aud), s.distType); dx += d.x; dy += d.y; } ctx.beginPath(); ctx.arc(dx, dy, ds, 0, Math.PI * 2); ctx.fill(); }
    } else if (s.pat === 'squares') {
      const ss = s.shapeSz * (1 + (bass + midi) * 0.6);
      for (let y = 0; y < h; y += s.space) for (let x = 0; x < w; x += s.space) { let dx = x, dy = y; if (s.distOn) { const d = dist(x - w/2, y - h/2, at, s.distStr * (1 + aud), s.distType); dx += d.x; dy += d.y; } ctx.fillRect(dx - ss/2, dy - ss/2, ss, ss); }
    } else if (s.pat === 'text') {
      ctx.font = `600 ${s.fontSz}px -apple-system, "SF Pro Display", sans-serif`; ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
      for (let y = 0; y < h; y += s.space) for (let x = 0; x < w; x += s.space) { ctx.save(); ctx.translate(x, y); const sc = 1 + ease((bass + midi) * 0.4); ctx.scale(sc, sc); if (midiNoteRef.current > 0) ctx.rotate((midiNoteRef.current / 127) * 0.2); ctx.fillText(s.txt, 0, 0); ctx.restore(); }
    } else if (s.pat === 'char-grid') {
      ctx.font = `${s.charSz}px "SF Mono", Monaco, monospace`; ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
      const chs = s.chars.split(''); if (chs.length > 0) { const ct = tm * 0.001 * s.charSpd; let ri = 0; for (let y = 0; y < h; y += s.space) { let ci = 0; for (let x = 0; x < w; x += s.space) { const st = ct + (ri + ci) * s.stagger; let idx; if (s.strBehave === 'cycle') idx = (Math.floor(st * 3) + ri + ci) % chs.length; else if (s.strBehave === 'wave') { const wv = Math.sin((ci * 0.5 + ri * 0.3 + st) * 0.8); idx = Math.floor((wv + 1) * 0.5 * chs.length) % chs.length; } else { const sd = ri * 1000 + ci + Math.floor(st * 2); idx = Math.floor((Math.sin(sd) * 0.5 + 0.5) * chs.length); } ctx.save(); ctx.translate(x, y); ctx.scale(1 + ease((bass + midi) * 0.3), 1 + ease((bass + midi) * 0.3)); ctx.fillText(chs[idx], 0, 0); ctx.restore(); ci++; } ri++; }}
    } else if (s.pat === 'swiss-grid') {
      const cw = w / s.cols, ch = h / s.rows, sz = Math.min(cw, ch) * 0.5;
      if (s.grid) { ctx.strokeStyle = '#E5E5E5'; ctx.lineWidth = 0.5; for (let i = 0; i <= s.cols; i++) { ctx.beginPath(); ctx.moveTo(i * cw, 0); ctx.lineTo(i * cw, h); ctx.stroke(); } for (let i = 0; i <= s.rows; i++) { ctx.beginPath(); ctx.moveTo(0, i * ch); ctx.lineTo(w, i * ch); ctx.stroke(); }}
      const chs = s.chars.split(''), ct = tm * 0.001 * s.charSpd;
      cells.forEach((cel, idx) => {
        const col = cel.idx % s.cols, row = Math.floor(cel.idx / s.cols);
        const cx = col * cw + cw / 2, cy = row * ch + ch / 2;
        const lt = ct + idx * s.stagger, ab = ease((bass + midi) * 0.5);
        ctx.save(); ctx.translate(cx, cy);
        const gr = (s.rot + aud * 45) * Math.PI / 180; if (gr !== 0) ctx.rotate(gr);
        if (s.behave === 'pulse') { const p = Math.sin(lt * 3 + cel.ph) * 0.5 + 0.5; ctx.scale(0.8 + p * 0.4 + ab * 0.3, 0.8 + p * 0.4 + ab * 0.3); }
        else if (s.behave === 'orbit') { const r = sz * 0.3 * (1 + ab * 0.5), a = lt * 1.5 + cel.ph; ctx.translate(Math.cos(a) * r, Math.sin(a) * r); }
        else if (s.behave === 'bounce') { const bn = Math.abs(Math.sin(lt * 2 + cel.ph)); ctx.translate(0, -bn * sz * 0.5 * (1 + ab)); }
        if (cel.type === 'char' && chs.length > 0) { ctx.font = `${sz * 1.2}px "SF Mono", Monaco, monospace`; ctx.textAlign = 'center'; ctx.textBaseline = 'middle'; if (s.cycle === 'crossfade') { const cf = (lt * 2) % chs.length, ci = Math.floor(cf), ni = (ci + 1) % chs.length, pr = cf - ci, ep = ease(pr); ctx.globalAlpha = 1 - ep; ctx.fillText(chs[ci], 0, 0); ctx.globalAlpha = ep; ctx.fillText(chs[ni], 0, 0); ctx.globalAlpha = 1; } else ctx.fillText(chs[Math.floor(lt * 2) % chs.length], 0, 0); }
        else if (cel.type === 'dot') { ctx.beginPath(); ctx.arc(0, 0, sz * 0.4 * (1 + ab * 0.4), 0, Math.PI * 2); ctx.fill(); }
        else if (cel.type === 'square') { const ss = sz * 0.8 * (1 + ab * 0.4); ctx.fillRect(-ss/2, -ss/2, ss, ss); }
        ctx.restore();
      });
      if (s.pixOn) { const img = ctx.getImageData(0, 0, w, h), pix = ctx.createImageData(w, h), ps = s.pixSz; for (let y = 0; y < h; y += ps) for (let x = 0; x < w; x += ps) { const i = (y * w + x) * 4, r = img.data[i], g = img.data[i + 1], b = img.data[i + 2]; for (let py = 0; py < ps && y + py < h; py++) for (let px = 0; px < ps && x + px < w; px++) { const pi = ((y + py) * w + (x + px)) * 4; pix.data[pi] = r; pix.data[pi + 1] = g; pix.data[pi + 2] = b; pix.data[pi + 3] = 255; }} ctx.putImageData(pix, 0, 0); }
    }
  };

  React.useEffect(() => { const loop = (t) => { render(t); animRef.current = requestAnimationFrame(loop); }; animRef.current = requestAnimationFrame(loop); return () => cancelAnimationFrame(animRef.current); }, [s, cells]);
  React.useEffect(() => { const rsz = () => { if (canvasRef.current) { canvasRef.current.width = canvasRef.current.offsetWidth; canvasRef.current.height = canvasRef.current.offsetHeight; }}; rsz(); window.addEventListener('resize', rsz); return () => window.removeEventListener('resize', rsz); }, []);
  React.useEffect(() => { gen(); }, []);

  return (
    <div className="w-full h-screen bg-white flex">
      <div className="w-72 bg-neutral-50 border-r border-neutral-200 p-5 overflow-y-auto space-y-4 text-sm">
        <div className="flex gap-2">
          <button onClick={gen} className="flex-1 flex justify-center px-4 py-2.5 bg-black text-white rounded-lg font-medium hover:bg-neutral-800"><RotateCcw size={16} /></button>
          <button onClick={() => { const l = document.createElement('a'); l.download = 'pattern.png'; l.href = canvasRef.current.toDataURL(); l.click(); }} className="flex-1 flex justify-center px-4 py-2.5 bg-black text-white rounded-lg font-medium hover:bg-neutral-800"><Download size={16} /></button>
        </div>
        <div className="space-y-2">
          <label className="block text-xs font-semibold uppercase tracking-wider">Pattern</label>
          <select value={s.pat} onChange={(e) => setS(p => ({ ...p, pat: e.target.value }))} className="w-full px-3 py-2 bg-white border border-neutral-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-black">
            <option value="vertical-lines">Vertical Lines</option>
            <option value="horizontal-lines">Horizontal Lines</option>
            <option value="dots">Dots</option>
            <option value="squares">Squares</option>
            <option value="text">Text</option>
            <option value="char-grid">Character Grid</option>
            <option value="swiss-grid">Swiss Grid</option>
          </select>
        </div>
        <div className="space-y-2">
          <div className="flex items-center justify-between">
            <label className="text-xs font-semibold uppercase tracking-wider">Audio</label>
            <button onClick={() => setAudioOn(!audioOn)} className={`p-1.5 rounded ${audioOn ? 'bg-black text-white' : 'bg-neutral-200'}`}>{audioOn ? <Play size={14} fill="white" /> : <Square size={14} />}</button>
          </div>
          {audioDevs.length > 0 && <select value={selAudio} onChange={(e) => setSelAudio(e.target.value)} className="w-full px-3 py-2 bg-white border border-neutral-300 rounded-lg text-xs">{audioDevs.map(d => <option key={d.deviceId} value={d.deviceId}>{d.label || `Device ${d.deviceId.slice(0,8)}`}</option>)}</select>}
          {audioOn && <div className="space-y-1.5"><div className="h-1 bg-neutral-200 rounded-full"><div className="h-full bg-black transition-all" style={{ width: `${audioLvl * 100}%` }} /></div><div className="h-1 bg-neutral-200 rounded-full"><div className="h-full bg-neutral-600 transition-all" style={{ width: `${bassLvl * 100}%` }} /></div></div>}
        </div>
        <div className="space-y-2">
          <div className="flex items-center justify-between">
            <label className="text-xs font-semibold uppercase tracking-wider">MIDI</label>
            <button onClick={() => setMidiOn(!midiOn)} className={`p-1.5 rounded ${midiOn ? 'bg-black text-white' : 'bg-neutral-200'}`}>{midiOn ? <Play size={14} fill="white" /> : <Square size={14} />}</button>
          </div>
          {midiOn && midiDevs.length > 0 && <div className="text-xs text-neutral-600">{midiDevs.length} device(s)</div>}
        </div>
        <div className="space-y-2">
          <div className="flex items-center justify-between">
            <label className="text-xs font-semibold uppercase tracking-wider">Distortion</label>
            <button onClick={() => setS(p => ({ ...p, distOn: !p.distOn }))} className={`p-1.5 rounded ${s.distOn ? 'bg-black text-white' : 'bg-neutral-200'}`}>{s.distOn ? <Play size={14} fill="white" /> : <Square size={14} />}</button>
          </div>
          {s.distOn && <select value={s.distType} onChange={(e) => setS(p => ({ ...p, distType: e.target.value }))} className="w-full px-3 py-2 bg-white border border-neutral-300 rounded-lg text-xs"><option value="liquify">Liquify</option><option value="ripple">Ripple</option><option value="swirl">Swirl</option></select>}
        </div>
        {s.pat === 'swiss-grid' && <>
          <div className="space-y-2">
            <label className="block text-xs font-semibold uppercase tracking-wider">Grid {s.cols} × {s.rows}</label>
            <input type="range" min="4" max="40" value={s.cols} onChange={(e) => setS(p => ({ ...p, cols: parseInt(e.target.value) }))} className="w-full" />
            <div className="flex items-center justify-between"><label className="text-xs font-semibold uppercase tracking-wider">Draw</label><button onClick={() => setS(p => ({ ...p, draw: !p.draw }))} className={`p-1.5 rounded ${s.draw ? 'bg-black text-white' : 'bg-neutral-200'}`}>{s.draw ? <Play size={14} fill="white" /> : <Square size={14} />}</button></div>
            <button onClick={() => setCells([])} className="w-full px-4 py-2.5 bg-neutral-900 text-white rounded-lg font-medium hover:bg-black">Clear</button>
          </div>
          <div className="space-y-2">
            <label className="block text-xs font-semibold uppercase tracking-wider">Behavior</label>
            <select value={s.behave} onChange={(e) => setS(p => ({ ...p, behave: e.target.value }))} className="w-full px-3 py-2 bg-white border border-neutral-300 rounded-lg"><option value="pulse">Pulse</option><option value="orbit">Orbit</option><option value="bounce">Bounce</option></select>
          </div>
          <div className="space-y-2">
            <label className="block text-xs font-semibold uppercase tracking-wider">Characters</label>
            <input type="text" value={s.chars} onChange={(e) => setS(p => ({ ...p, chars: e.target.value }))} className="w-full px-3 py-2 bg-white border border-neutral-300 rounded-lg font-mono" />
          </div>
        </>}
        {s.pat === 'char-grid' && <div className="space-y-2">
          <label className="block text-xs font-semibold uppercase tracking-wider">String Behavior</label>
          <select value={s.strBehave} onChange={(e) => setS(p => ({ ...p, strBehave: e.target.value }))} className="w-full px-3 py-2 bg-white border border-neutral-300 rounded-lg"><option value="cycle">Cycle</option><option value="wave">Wave</option><option value="random">Random</option></select>
        </div>}
      </div>
      <div className="flex-1 p-8 bg-white relative">
        <canvas ref={canvasRef} className="w-full h-full rounded-lg shadow-sm" onClick={clk} onMouseDown={down} onMouseMove={move} onMouseUp={up} onMouseLeave={up} />
        {menu && <div className="fixed bg-white shadow-2xl rounded-lg border py-1 z-50" style={{ left: menu.x, top: menu.y }} onClick={(e) => e.stopPropagation()}>
          <button onClick={() => add('char')} className="block w-full px-4 py-2 text-left hover:bg-gray-100 text-sm">Add Char</button>
          <button onClick={() => add('dot')} className="block w-full px-4 py-2 text-left hover:bg-gray-100 text-sm">Add Dot</button>
          <button onClick={() => add('square')} className="block w-full px-4 py-2 text-left hover:bg-gray-100 text-sm">Add Square</button>
          <div className="border-t my-1"></div>
          <button onClick={rem} className="block w-full px-4 py-2 text-left hover:bg-red-50 text-sm text-red-600">Remove</button>
        </div>}
      </div>
    </div>
  );
};

export default App;
