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
  const midiAccessRef = React.useRef(null);
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
    audioSensitivity: 2,
    dotSize: 8,
    shapeSize: 10,
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
    midiSensitivity: 1,
    easingFunction: 'fibonacci',
    stringBehavior: 'cycle',
    motionDamping: 0.8,
    charStagger: 0.15
  });

  const distortionTypes = [
    { value: 'liquify', label: 'Liquify' },
    { value: 'ripple', label: 'Ripple' },
    { value: 'swirl', label: 'Swirl' }
  ];
  
  const gridPresets = [
    { name: 'Swiss Poster', cols: 12, rows: 16 },
    { name: 'Dense', cols: 24, rows: 18 },
    { name: 'Minimal', cols: 6, rows: 8 }
  ];

  const PHI = 1.618033988749895;
  
  const applyEasing = (t) => {
    return Math.pow(t, PHI - 1);
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
            } else {
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
      if (audioContextRef.current) audioContextRef.current.close();
      setAudioLevel(0);
      setBassLevel(0);
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
          requestAnimationFrame(updateAudio);
        };
        updateAudio();
      } catch (err) {
        alert('Audio access denied');
      }
    };
    initAudio();
  }, [audioEnabled, selectedAudioDevice]);

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

  const render = (time = 0) => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext('2d');
    const width = canvas.width;
    const height = canvas.height;
    
    ctx.fillStyle = '#ffffff';
    ctx.fillRect(0, 0, width, height);
    ctx.fillStyle = '#000000';
    
    const midiInfluence = midiVelocityRef.current * settings.midiSensitivity;
    const cycleTime = time * 0.001 * settings.charCycleSpeed;
    
    if (settings.patternType === 'swiss-grid') {
      const cellWidth = width / settings.gridColumns;
      const cellHeight = height / settings.gridRows;
      const adaptiveCharSize = Math.min(cellWidth, cellHeight) * 0.6;
      
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
      
      gridCells.forEach((cell, cellIdx) => {
        const col = cell.index % settings.gridColumns;
        const row = Math.floor(cell.index / settings.gridColumns);
        const centerX = col * cellWidth + cellWidth / 2;
        const centerY = row * cellHeight + cellHeight / 2;
        
        const stagger = cellIdx * settings.charStagger;
        const localTime = cycleTime + stagger;
        const audioBoost = (bassLevel + midiInfluence) * 0.4;
        
        ctx.save();
        ctx.translate(centerX, centerY);
        
        if (cell.type === 'char' && chars.length > 0) {
          ctx.font = `${adaptiveCharSize}px monospace`;
          ctx.textAlign = 'center';
          ctx.textBaseline = 'middle';
          const charIndex = Math.floor(localTime * 2) % chars.length;
          const scale = 1 + audioBoost * 0.3;
          ctx.scale(scale, scale);
          ctx.fillText(chars[charIndex], 0, 0);
        } else if (cell.type === 'dot') {
          const radius = Math.min(cellWidth, cellHeight) * 0.25 + audioBoost * 8;
          ctx.beginPath();
          ctx.arc(0, 0, radius, 0, Math.PI * 2);
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
  }, [settings, gridCells, bassLevel]);

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
      <div className="w-80 bg-white shadow-xl p-6 overflow-y-auto space-y-6">
        <div className="flex gap-2">
          <button onClick={generateRandomGrid} className="flex items-center gap-2 px-4 py-2 bg-blue-600 text-white rounded-lg text-sm font-medium">
            <RotateCcw size={16} /> Random
          </button>
          <button onClick={() => { const link = document.createElement('a'); link.download = 'pattern.png'; link.href = canvasRef.current.toDataURL(); link.click(); }} className="flex items-center gap-2 px-4 py-2 bg-purple-600 text-white rounded-lg text-sm font-medium">
            <Download size={16} /> Save
          </button>
        </div>

        <div className="space-y-3">
          <h3 className="font-semibold text-sm uppercase tracking-wide text-gray-700">Audio Input</h3>
          <label className="flex items-center gap-3">
            <input type="checkbox" checked={audioEnabled} onChange={(e) => setAudioEnabled(e.target.checked)} className="w-4 h-4" />
            <span className="text-sm">Enable Audio</span>
          </label>
          {audioDevices.length > 0 && (
            <select value={selectedAudioDevice} onChange={(e) => setSelectedAudioDevice(e.target.value)} className="w-full p-2 border rounded-lg text-sm">
              {audioDevices.map(device => (
                <option key={device.deviceId} value={device.deviceId}>
                  {device.label || `Device ${device.deviceId.slice(0, 8)}`}
                </option>
              ))}
            </select>
          )}
          {audioEnabled && (
            <div className="space-y-2">
              <div className="flex justify-between text-xs">
                <span>Audio</span>
                <span>{(audioLevel * 100).toFixed(0)}%</span>
              </div>
              <div className="w-full h-2 bg-gray-200 rounded-full">
                <div className="h-full bg-blue-500 rounded-full transition-all" style={{ width: `${audioLevel * 100}%` }} />
              </div>
              <div className="flex justify-between text-xs">
                <span>Bass</span>
                <span>{(bassLevel * 100).toFixed(0)}%</span>
              </div>
              <div className="w-full h-2 bg-gray-200 rounded-full">
                <div className="h-full bg-purple-500 rounded-full transition-all" style={{ width: `${bassLevel * 100}%` }} />
              </div>
            </div>
          )}
        </div>

        <div className="space-y-3">
          <h3 className="font-semibold text-sm uppercase tracking-wide text-gray-700">MIDI Input</h3>
          <label className="flex items-center gap-3">
            <input type="checkbox" checked={midiEnabled} onChange={(e) => setMidiEnabled(e.target.checked)} className="w-4 h-4" />
            <span className="text-sm">Enable MIDI</span>
          </label>
          {midiEnabled && midiDevices.length > 0 && (
            <div className="text-xs text-green-600">{midiDevices.length} device(s) connected</div>
          )}
        </div>

        <div className="space-y-3">
          <h3 className="font-semibold text-sm uppercase tracking-wide text-gray-700">Grid</h3>
          <select value={settings.gridPreset} onChange={(e) => {
            const preset = gridPresets.find(p => p.name === e.target.value);
            if (preset) {
              setSettings(s => ({ ...s, gridPreset: e.target.value, gridColumns: preset.cols, gridRows: preset.rows }));
            }
          }} className="w-full p-2 border rounded-lg text-sm">
            {gridPresets.map(p => <option key={p.name} value={p.name}>{p.name}</option>)}
          </select>
          <div>
            <label className="block text-sm mb-2">Columns: {settings.gridColumns}</label>
            <input type="range" min="4" max="60" value={settings.gridColumns} onChange={(e) => setSettings(s => ({ ...s, gridColumns: parseInt(e.target.value) }))} className="w-full" />
          </div>
          <div>
            <label className="block text-sm mb-2">Rows: {settings.gridRows}</label>
            <input type="range" min="4" max="60" value={settings.gridRows} onChange={(e) => setSettings(s => ({ ...s, gridRows: parseInt(e.target.value) }))} className="w-full" />
          </div>
          <label className="flex items-center gap-3">
            <input type="checkbox" checked={settings.showGridLines} onChange={(e) => setSettings(s => ({ ...s, showGridLines: e.target.checked }))} className="w-4 h-4" />
            <span className="text-sm">Show Grid Lines</span>
          </label>
        </div>

        <div className="space-y-3">
          <h3 className="font-semibold text-sm uppercase tracking-wide text-gray-700">Animation</h3>
          <div>
            <label className="block text-sm mb-2">Characters</label>
            <input type="text" value={settings.charSequence} onChange={(e) => setSettings(s => ({ ...s, charSequence: e.target.value }))} className="w-full p-2 border rounded-lg text-sm font-mono" />
          </div>
          <div>
            <label className="block text-sm mb-2">Speed: {settings.charCycleSpeed}</label>
            <input type="range" min="0.5" max="10" step="0.5" value={settings.charCycleSpeed} onChange={(e) => setSettings(s => ({ ...s, charCycleSpeed: parseFloat(e.target.value) }))} className="w-full" />
          </div>
          <div>
            <label className="block text-sm mb-2">Stagger: {settings.charStagger.toFixed(2)}</label>
            <input type="range" min="0" max="0.5" step="0.01" value={settings.charStagger} onChange={(e) => setSettings(s => ({ ...s, charStagger: parseFloat(e.target.value) }))} className="w-full" />
          </div>
        </div>

        <button onClick={() => setGridCells([])} className="w-full px-4 py-2 bg-red-600 text-white rounded-lg text-sm font-medium">
          Clear Grid
        </button>
      </div>

      <div className="flex-1 p-8">
        <canvas ref={canvasRef} className="w-full h-full border bg-white rounded-xl shadow-2xl" />
      </div>
    </div>
  );
};

export default GenerativePatternSystem;
