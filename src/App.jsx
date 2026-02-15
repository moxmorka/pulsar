import React, { useEffect, useRef, useState } from "react";

/* =============================
   Utilities
============================= */
const clamp = (v, a, b) => Math.max(a, Math.min(b, v));
const midiToFreq = m => 440 * Math.pow(2, (m - 69) / 12);

const NOTE_NAMES = ["C","C#","D","D#","E","F","F#","G","G#","A","A#","B"];
const SCALES = {
  major: [0,2,4,5,7,9,11],
  naturalMinor: [0,2,3,5,7,8,10],
  dorian: [0,2,3,5,7,9,10]
};

/* =============================
   Physical Voice (Mutable-ish)
============================= */
function makeVoice(ac, type="synth") {
  const osc = ac.createOscillator();
  const gain = ac.createGain();
  const filter = ac.createBiquadFilter();

  osc.type = type === "perc" ? "triangle" : "sawtooth";
  filter.type = "lowpass";
  filter.Q.value = 0.8;

  osc.connect(filter);
  filter.connect(gain);
  gain.connect(ac.destination);

  gain.gain.value = 0.0001;
  osc.start();

  return { osc, gain, filter };
}

function triggerVoice(ac, v, {freq, velocity, attack, decay}) {
  const now = ac.currentTime;
  v.osc.frequency.setValueAtTime(freq, now);
  v.filter.frequency.setValueAtTime(400 + velocity*8000, now);

  const g = v.gain.gain;
  g.cancelScheduledValues(now);
  g.setValueAtTime(0.0001, now);
  g.exponentialRampToValueAtTime(velocity, now + attack);
  g.exponentialRampToValueAtTime(0.0001, now + attack + decay);
}

/* =============================
   MAIN APP
============================= */
export default function App() {

  const canvasRef = useRef(null);
  const audioRef = useRef(null);
  const voicesRef = useRef([]);
  const percVoicesRef = useRef([]);

  const [darkMode,setDarkMode] = useState(true);
  const [cells,setCells] = useState([]);
  const [midiActive,setMidiActive] = useState(false);
  const [scale,setScale] = useState("naturalMinor");
  const [keyRoot,setKeyRoot] = useState(0);
  const [scatter,setScatter] = useState(true);

  const cols = 16;
  const rows = 12;

  /* =============================
     AUDIO INIT
  ============================= */
  function ensureAudio(){
    if(!audioRef.current){
      const ac = new (window.AudioContext||window.webkitAudioContext)();
      audioRef.current = ac;

      voicesRef.current = Array.from({length:12},()=>makeVoice(ac,"synth"));
      percVoicesRef.current = Array.from({length:6},()=>makeVoice(ac,"perc"));
    }
  }

  /* =============================
     MIDI
  ============================= */
  useEffect(()=>{
    if(!navigator.requestMIDIAccess) return;

    navigator.requestMIDIAccess().then(access=>{
      access.inputs.forEach(input=>{
        input.onmidimessage = handleMIDI;
      });
    });
  },[]);

  function handleMIDI(e){
    ensureAudio();
    setMidiActive(true);

    const [cmd,note,vel] = e.data;
    if(cmd===144 && vel>0){
      noteOn(note,vel/127);
    }
  }

  function noteOn(note,velocity){

    const ac = audioRef.current;
    const scaleArr = SCALES[scale];
    const pitchClass = (note-keyRoot)%12;
    const inScale = scaleArr.includes((pitchClass+12)%12);

    const col = scatter
      ? Math.floor(Math.random()*cols)
      : note % cols;

    const row = Math.floor(
      ((note-36)/48)*rows
    );

    const decay = 0.1 + velocity*1.2;
    const attack = 0.005 + (1-velocity)*0.08;

    const freq = midiToFreq(note);

    const v = voicesRef.current[Math.floor(Math.random()*voicesRef.current.length)];
    triggerVoice(ac,v,{freq,velocity,attack,decay});

    const p = percVoicesRef.current[Math.floor(Math.random()*percVoicesRef.current.length)];
    triggerVoice(ac,p,{freq:freq*0.5,velocity:velocity*0.7,attack:0.001,decay:0.2});

    const hue = 200 + velocity*120;
    const color = `hsl(${hue},70%,${30+velocity*40}%)`;

    setCells(c=>{
      const next = [...c];
      next.push({
        col:clamp(col,0,cols-1),
        row:clamp(row,0,rows-1),
        color
      });
      return next.slice(-200);
    });
  }

  /* =============================
     DRAW
  ============================= */
  useEffect(()=>{
    const cv = canvasRef.current;
    const ctx = cv.getContext("2d");

    function resize(){
      cv.width=cv.offsetWidth;
      cv.height=cv.offsetHeight;
    }
    resize();
    window.addEventListener("resize",resize);

    function draw(){
      ctx.fillStyle = darkMode ? "#000" : "#fff";
      ctx.fillRect(0,0,cv.width,cv.height);

      const cw = cv.width/cols;
      const ch = cv.height/rows;

      for(let r=0;r<rows;r++){
        for(let c=0;c<cols;c++){
          ctx.strokeStyle = darkMode?"#222":"#ddd";
          ctx.strokeRect(c*cw,r*ch,cw,ch);
        }
      }

      cells.forEach(cell=>{
        ctx.fillStyle = cell.color;
        ctx.fillRect(cell.col*cw,cell.row*ch,cw,ch);
      });

      requestAnimationFrame(draw);
    }
    draw();
  },[cells,darkMode]);

  /* =============================
     UI
  ============================= */
  return (
    <div style={{
      background:darkMode?"#000":"#fff",
      color:darkMode?"#fff":"#000",
      height:"100vh",
      display:"flex",
      flexDirection:"column"
    }}>
      <div style={{padding:12,display:"flex",gap:10}}>
        <button onClick={()=>setDarkMode(v=>!v)}>
          {darkMode?"Light":"Dark"}
        </button>

        <button onClick={()=>setScatter(v=>!v)}>
          Scatter: {scatter?"ON":"OFF"}
        </button>

        <select value={scale} onChange={e=>setScale(e.target.value)}>
          {Object.keys(SCALES).map(s=>
            <option key={s}>{s}</option>
          )}
        </select>

        <select value={keyRoot} onChange={e=>setKeyRoot(parseInt(e.target.value))}>
          {NOTE_NAMES.map((n,i)=>
            <option value={i} key={n}>{n}</option>
          )}
        </select>
      </div>

      <canvas
        ref={canvasRef}
        style={{flex:1}}
        onClick={()=>ensureAudio()}
      />
    </div>
  );
}
