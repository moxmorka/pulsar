{/* Melody Sound (NEW) */}
<div className="space-y-2">
  <label className="block text-xs font-semibold uppercase tracking-wider">Melody Sound</label>

  <div className="space-y-1">
    <div className={`text-xs ${subtleText}`}>Resonance (Q): {s.melResonance.toFixed(2)}</div>
    <input
      type="range"
      min="0.1"
      max="18"
      step="0.05"
      value={s.melResonance}
      onChange={(e) => setS((p) => ({ ...p, melResonance: parseFloat(e.target.value) }))}
      className="w-full"
    />
  </div>

  <div className="space-y-1">
    <div className={`text-xs ${subtleText}`}>Timbre (drive): {s.melTimbre.toFixed(2)}</div>
    <input
      type="range"
      min="0"
      max="1"
      step="0.01"
      value={s.melTimbre}
      onChange={(e) => setS((p) => ({ ...p, melTimbre: parseFloat(e.target.value) }))}
      className="w-full"
    />
  </div>

  <div className="grid grid-cols-2 gap-2">
    <div className="space-y-1">
      <div className={`text-xs ${subtleText}`}>Mod Amt: {s.melModAmt.toFixed(2)}</div>
      <input
        type="range"
        min="0"
        max="1"
        step="0.01"
        value={s.melModAmt}
        onChange={(e) => setS((p) => ({ ...p, melModAmt: parseFloat(e.target.value) }))}
        className="w-full"
      />
    </div>
    <div className="space-y-1">
      <div className={`text-xs ${subtleText}`}>Mod Rate: {s.melModRate.toFixed(2)} Hz</div>
      <input
        type="range"
        min="0.05"
        max="30"
        step="0.05"
        value={s.melModRate}
        onChange={(e) => setS((p) => ({ ...p, melModRate: parseFloat(e.target.value) }))}
        className="w-full"
      />
    </div>
  </div>

  <div className="grid grid-cols-2 gap-2">
    <div className="space-y-1">
      <div className={`text-xs ${subtleText}`}>Tune Semi: {s.melTuneSemi}</div>
      <input
        type="range"
        min="-24"
        max="24"
        step="1"
        value={s.melTuneSemi}
        onChange={(e) => setS((p) => ({ ...p, melTuneSemi: parseInt(e.target.value, 10) }))}
        className="w-full"
      />
    </div>
    <div className="space-y-1">
      <div className={`text-xs ${subtleText}`}>Tune Cents: {s.melTuneCents}</div>
      <input
        type="range"
        min="-100"
        max="100"
        step="1"
        value={s.melTuneCents}
        onChange={(e) => setS((p) => ({ ...p, melTuneCents: parseInt(e.target.value, 10) }))}
        className="w-full"
      />
    </div>
  </div>
</div>
