// Procedural WebAudio: engine hum, sirens, gunshots, punches, pickups, jingles.
// Everything synthesized — no audio files, no network.
export function createAudio() {
  let ctx = null;
  let muted = false;
  let master = null;
  let musicGain = null;
  let sfxGain = null;
  let musicVol = 0.6;
  let sfxVol = 0.8;
  let engineOsc = null, engineGain = null, engineFilter = null;
  let musicTimer = null;
  let duckTimer = null;
  let musicOn = false;

  function ensure() {
    if (ctx) { if (ctx.state === 'suspended') ctx.resume(); return true; }
    try {
      const AC = window.AudioContext || window.webkitAudioContext;
      if (!AC) return false;
      ctx = new AC();
      master = ctx.createGain();
      master.gain.value = muted ? 0 : 1;
      master.connect(ctx.destination);
      musicGain = ctx.createGain();
      musicGain.gain.value = musicVol * 0.5;
      musicGain.connect(master);
      sfxGain = ctx.createGain();
      sfxGain.gain.value = sfxVol;
      sfxGain.connect(master);
      // Engine: two detuned saws through a lowpass.
      engineOsc = ctx.createOscillator();
      engineOsc.type = 'sawtooth';
      engineOsc.frequency.value = 55;
      const osc2 = ctx.createOscillator();
      osc2.type = 'square';
      osc2.frequency.value = 27.5;
      engineFilter = ctx.createBiquadFilter();
      engineFilter.type = 'lowpass';
      engineFilter.frequency.value = 320;
      engineGain = ctx.createGain();
      engineGain.gain.value = 0;
      engineOsc.connect(engineFilter);
      osc2.connect(engineFilter);
      engineFilter.connect(engineGain);
      engineGain.connect(sfxGain);
      engineOsc.start();
      osc2.start();
      startMusic();
      return true;
    } catch { return false; }
  }

  function setMuted(m) {
    muted = m;
    if (master) master.gain.value = m ? 0 : 1;
  }
  function isMuted() { return muted; }

  function setVolumes(music, sfx, mute) {
    musicVol = music; sfxVol = sfx;
    if (typeof mute === 'boolean') muted = mute;
    if (musicGain) musicGain.gain.value = musicVol * 0.5;
    if (sfxGain) sfxGain.gain.value = sfxVol;
    if (master) master.gain.value = muted ? 0 : 1;
  }

  function setEngine(speed01, on) {
    if (!ctx || !engineGain) return;
    const t = ctx.currentTime;
    engineGain.gain.setTargetAtTime(on ? 0.05 + speed01 * 0.06 : 0, t, 0.1);
    engineOsc.frequency.setTargetAtTime(50 + speed01 * 110, t, 0.1);
    engineFilter.frequency.setTargetAtTime(280 + speed01 * 900, t, 0.1);
  }

  function blip(freq, dur, type = 'sine', vol = 0.2, slideTo = null, bus = 'sfx') {
    if (!ctx || muted) return;
    const t = ctx.currentTime;
    const o = ctx.createOscillator();
    const g = ctx.createGain();
    o.type = type;
    o.frequency.setValueAtTime(freq, t);
    if (slideTo) o.frequency.exponentialRampToValueAtTime(slideTo, t + dur);
    g.gain.setValueAtTime(vol, t);
    g.gain.exponentialRampToValueAtTime(0.001, t + dur);
    o.connect(g); g.connect(bus === 'music' ? musicGain : sfxGain);
    o.start(t); o.stop(t + dur + 0.02);
  }

  function noiseBurst(dur, vol, filterFreq = 1200) {
    if (!ctx || muted) return;
    const t = ctx.currentTime;
    const len = Math.max(1, Math.floor(ctx.sampleRate * dur));
    const buf = ctx.createBuffer(1, len, ctx.sampleRate);
    const data = buf.getChannelData(0);
    for (let i = 0; i < len; i += 1) data[i] = (Math.random() * 2 - 1) * (1 - i / len);
    const src = ctx.createBufferSource();
    src.buffer = buf;
    const f = ctx.createBiquadFilter();
    f.type = 'lowpass'; f.frequency.value = filterFreq;
    const g = ctx.createGain();
    g.gain.value = vol;
    src.connect(f); f.connect(g); g.connect(sfxGain);
    src.start(t);
  }

  // Two-tone police siren, one cycle.
  function siren() {
    if (!ctx || muted) return;
    const t = ctx.currentTime;
    const o = ctx.createOscillator();
    const g = ctx.createGain();
    o.type = 'triangle';
    o.frequency.setValueAtTime(720, t);
    o.frequency.setValueAtTime(980, t + 0.35);
    o.frequency.setValueAtTime(720, t + 0.7);
    g.gain.setValueAtTime(0.05, t);
    g.gain.setValueAtTime(0.05, t + 0.65);
    g.gain.setValueAtTime(0.0001, t + 0.72);
    o.connect(g); g.connect(sfxGain);
    o.start(t); o.stop(t + 0.75);
  }

  function play(name) {
    if (!ensure()) return;
    switch (name) {
      case 'shoot': noiseBurst(0.14, 0.5, 2600); blip(160, 0.1, 'square', 0.25, 60); break;
      case 'reload': blip(1200, 0.05, 'square', 0.12); setTimeout(() => blip(900, 0.05, 'square', 0.12), 140); setTimeout(() => blip(1500, 0.06, 'square', 0.14), 320); break;
      case 'punch': noiseBurst(0.09, 0.35, 500); blip(90, 0.12, 'sine', 0.3, 45); break;
      case 'hit': blip(220, 0.08, 'square', 0.15, 110); break;
      case 'pickup': blip(660, 0.09, 'sine', 0.2); setTimeout(() => blip(990, 0.14, 'sine', 0.2), 90); break;
      case 'cash': blip(880, 0.08, 'triangle', 0.2); setTimeout(() => blip(1174, 0.1, 'triangle', 0.2), 80); setTimeout(() => blip(1568, 0.18, 'triangle', 0.2), 160); break;
      case 'mission': [523, 659, 784, 1046].forEach((f, i) => setTimeout(() => blip(f, 0.22, 'triangle', 0.22), i * 110)); break;
      case 'fail': [392, 330, 262].forEach((f, i) => setTimeout(() => blip(f, 0.25, 'sawtooth', 0.12), i * 130)); break;
      case 'siren': siren(); break;
      case 'enter': blip(300, 0.08, 'square', 0.12, 420); break;
      case 'busted': [440, 415, 392].forEach((f, i) => setTimeout(() => blip(f, 0.3, 'square', 0.14), i * 150)); break;
      case 'checkpoint': blip(1046, 0.12, 'sine', 0.22); setTimeout(() => blip(1318, 0.2, 'sine', 0.22), 100); break;
      case 'honk': blip(370, 0.16, 'square', 0.16, 370); setTimeout(() => blip(370, 0.14, 'square', 0.14, 370), 200); break;
      case 'alarm': duckMusic(6); for (let i = 0; i < 5; i++) { for (let j = 0; j < 4; j++) setTimeout(() => blip(1250, 0.09, 'square', 0.16), i * 1200 + j * 220); } break; // car alarm: tin-tin-tin-tin x5, ~6 s
      case 'blip': blip(660, 0.07, 'sine', 0.12); break;
      case 'stunt': [784, 988, 1175].forEach((f, i) => setTimeout(() => blip(f, 0.16, 'triangle', 0.2), i * 90)); break;
      default: break;
    }
  }

  // --- Radio stations (all synthesized, no audio files) -------------------
  // chill = Neon Tide FM (laid-back A-minor groove); latin = Mango Radio
  // (dembow-style reggaeton pulse); synth = Static Dub 88.1 (night arpeggio).
  const STATIONS = {
    chill: { label: 'Neon Tide FM 98.6', step: 190, bass: [55, 0, 55, 0, 65.41, 0, 55, 0, 49, 0, 49, 0, 58.27, 0, 65.41, 0], hat: 4, lead: null },
    latin: { label: 'Mango Radio 101', step: 150, bass: [55, 55, 0, 65.41, 0, 55, 0, 49, 55, 0, 65.41, 0, 58.27, 0, 49, 0], hat: 2, lead: [220, 261.63, 329.63, 261.63] },
    synth: { label: 'Static Dub 88.1', step: 140, bass: [55, 0, 0, 55, 0, 0, 65.41, 0, 49, 0, 0, 49, 0, 0, 58.27, 0], hat: 2, lead: [110, 130.81, 164.81, 220, 164.81, 130.81] },
  };
  const STATION_ORDER = ['chill', 'latin', 'synth'];
  let station = 'chill';
  let intensity = 0; // 0 chill, 1 action (faster + louder)
  let ambKind = null, ambGain = null, ambFilter = null, ambSrc = null;

  function stationName() { return STATIONS[station].label; }
  function setStation(name) {
    if (!STATIONS[name]) return stationName();
    station = name; beat = 0;
    restartMusicTimer();
    return stationName();
  }
  function nextStation() {
    const i = STATION_ORDER.indexOf(station);
    return setStation(STATION_ORDER[(i + 1) % STATION_ORDER.length]);
  }
  // Duck the radio under the alarm, then bring it back (respects mute
  // because blip() no-ops when muted and duckMusic only touches musicGain).
  function duckMusic(seconds) {
    if (!ctx || !musicGain) return;
    const t = ctx.currentTime;
    musicGain.gain.setTargetAtTime(musicVol * 0.12, t, 0.1);
    if (duckTimer) clearTimeout(duckTimer);
    duckTimer = setTimeout(() => {
      if (musicGain) musicGain.gain.setTargetAtTime(musicVol * 0.5 * (intensity ? 1.35 : 1), ctx.currentTime, 0.3);
    }, seconds * 1000);
  }

  function setIntensity(level) {
    intensity = level ? 1 : 0;
    if (musicGain) musicGain.gain.setTargetAtTime(musicVol * 0.5 * (intensity ? 1.35 : 1), ctx ? ctx.currentTime : 0, 0.3);
    restartMusicTimer();
  }
  function restartMusicTimer() {
    if (!musicOn || !ctx) return;
    if (musicTimer) clearInterval(musicTimer);
    const st = STATIONS[station];
    const step = st.step * (intensity ? 0.8 : 1);
    musicTimer = setInterval(() => {
      if (muted || !ctx) return;
      const f = st.bass[beat % st.bass.length];
      if (f > 0) blip(f, 0.32, 'triangle', 0.10, null, 'music');
      if (st.lead && beat % 2 === 0) {
        const lf = st.lead[(beat / 2 | 0) % st.lead.length];
        blip(lf, 0.18, 'sawtooth', 0.035, null, 'music');
      }
      if (beat % st.hat === 0) noiseBurst(0.03, 0.04, 6000);
      beat += 1;
    }, step);
  }

  // District ambience: one looping noise source, filter + gain per place.
  // beach = soft surf, city = traffic hum, crowd = street murmur, rain = patter.
  function setAmbience(kind) {
    if (!ctx || muted) { ambKind = kind; return; }
    if (!ambSrc) {
      const len = ctx.sampleRate * 2;
      const buf = ctx.createBuffer(1, len, ctx.sampleRate);
      const d = buf.getChannelData(0);
      for (let i = 0; i < len; i += 1) d[i] = Math.random() * 2 - 1;
      ambSrc = ctx.createBufferSource();
      ambSrc.buffer = buf; ambSrc.loop = true;
      ambFilter = ctx.createBiquadFilter();
      ambFilter.type = 'lowpass'; ambFilter.frequency.value = 500;
      ambGain = ctx.createGain(); ambGain.gain.value = 0;
      ambSrc.connect(ambFilter); ambFilter.connect(ambGain); ambGain.connect(master);
      ambSrc.start();
    }
    if (kind === ambKind) return;
    ambKind = kind;
    const t = ctx.currentTime;
    const cfg = { beach: [420, 0.045], city: [900, 0.035], crowd: [1500, 0.045], rain: [2600, 0.085], none: [500, 0] }[kind] || [500, 0];
    ambFilter.frequency.setTargetAtTime(cfg[0], t, 0.5);
    ambGain.gain.setTargetAtTime(cfg[1], t, 0.5);
  }

  let beat = 0;
  function startMusic() {
    if (musicOn || !ctx) return;
    musicOn = true;
    restartMusicTimer();
  }

  return { ensure, play, setMuted, isMuted, setEngine, setVolumes, setStation, nextStation, stationName, setIntensity, setAmbience };
}
