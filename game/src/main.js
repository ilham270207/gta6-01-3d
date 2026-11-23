// LA VEGA 3D — boot, input (keyboard / mouse / touch), screens,
// cinematic title menu, settings, deterministic shots and video autopilot.
import * as THREE from 'three';
import { Game, driveInputTo } from './game.js';
import { createAudio } from './audio.js';
import { loadSettings, saveSettings, applyQuality } from './settings.js';
import { STEP, PLACES, SAVE_KEY } from './config.js';

const params = new URLSearchParams(window.location.search);
const SHOT = params.get('shot');
const SEED = Number.parseInt(params.get('seed') ?? '1', 10) || 1;
const VIDEO = params.get('video') === '1';
const IS_TOUCH = window.matchMedia('(pointer: coarse)').matches || 'ontouchstart' in window;
// Control modes (ilham 19:27 WIB): 'auto' (default — touch device = touch
// mode, else keyboard), 'touch' (joystick + buttons, keyboard help hidden),
// 'keyboard' (keyboard help shown, touch buttons hidden). Persisted in settings.
function effectiveControlMode() {
  if (settings.controlMode === 'touch') return 'touch';
  if (settings.controlMode === 'keyboard') return 'keyboard';
  return IS_TOUCH ? 'touch' : 'keyboard';
}
function applyControlMode() {
  const m = effectiveControlMode();
  document.body.classList.toggle('mode-touch', m === 'touch');
  document.body.classList.toggle('mode-keyboard', m === 'keyboard');
}

const $ = (id) => document.getElementById(id);
const settings = loadSettings();
document.body.classList.toggle('hud-compact', settings.hudDensity === 'compact');
applyControlMode();
const audio = createAudio();
audio.setVolumes(settings.musicVol, settings.sfxVol, settings.muted);

let renderer, game;
let mode = 'boot';
let keys = { up: false, down: false, left: false, right: false, run: false, punch: false, shoot: false, enter: false, jump: false, aim: false, reload: false };
let touchMove = { x: 0, y: 0, active: false };
let touchRun = false;
// (Claude parity: touch camera drag is direct — no velocity/inertia. The
// old camVel kept spinning the camera after the finger lifted.)
let fpsEMA = 60;
let lastQualityDrop = 0;
let qualityTouched = false; // user picked a quality by hand: auto-scaling stands down
let qualityPillTimer = 0;
function showQualityPill(level) {
  const pill = $('quality-pill');
  if (!pill) return;
  pill.textContent = 'Quality auto-set to ' + level + ' for smoother play';
  pill.style.display = 'block';
  clearTimeout(qualityPillTimer);
  qualityPillTimer = setTimeout(() => { pill.style.display = 'none'; }, 5000);
}

function show(id, on) { const el = $(id); if (el) el.style.display = on ? 'flex' : 'none'; }
function showHud(on) { const el = $('hud'); if (el) el.style.display = on ? 'block' : 'none'; const pb = $('btn-phone'); if (pb) pb.style.display = on ? 'block' : 'none'; }
function showTouchUI(on) {
  const el = $('touch-ui');
  if (!el) return;
  el.style.display = on && effectiveControlMode() === 'touch' && game && game.mode === 'play' ? 'block' : 'none';
}

// ---------------------------------------------------------------- boot
async function boot() {
  renderer = new THREE.WebGLRenderer({ antialias: true, powerPreference: 'high-performance' });
  renderer.toneMapping = THREE.ACESFilmicToneMapping; // Lucas P1: filmic curve, richer dusk/night
  renderer.toneMappingExposure = 1.15; // M-H: brighter, less muddy under ACES
  renderer.shadowMap.type = THREE.PCFShadowMap;
  renderer.setSize(window.innerWidth, window.innerHeight);
  renderer.domElement.classList.add('webgl');
  $('app').appendChild(renderer.domElement);

  game = new Game({ renderer, seed: SEED, audio });
  // Loading progress: % + what is loading, a slow-connection reassurance,
  // and a hard timeout with a RETRY button instead of a dead screen.
  // (M-E: on ilham's LTE the 40 MB game took 2+ minutes with a static
  // 'Loading La Vega…' and no feedback — it looked stuck forever.)
  const setProgress = (pct, label) => {
    const pc = $('loading-pct'); if (pc) pc.textContent = Math.round(pct) + '%';
    const fl = $('loading-fill'); if (fl) fl.style.width = pct + '%';
    const lb = $('loading-label'); if (lb) lb.textContent = label;
  };
  const slowTimer = setTimeout(() => {
    const lb = $('loading-label');
    if (lb) lb.textContent = 'Still loading — the game is big (40 MB), hang on…';
  }, 20000);
  try {
    await Promise.race([
      game.boot((pct, label) => setProgress(pct, label)),
      new Promise((_, rej) => setTimeout(() => rej(new Error('Loading timed out after 4 minutes — check your connection and retry.')), 240000)),
    ]);
  } catch (e) {
    clearTimeout(slowTimer);
    const lb = $('loading-label'); if (lb) lb.textContent = 'Failed to load: ' + e.message;
    const rt = $('btn-loading-retry');
    if (rt) { rt.style.display = 'inline-block'; rt.onclick = () => location.reload(); }
    console.error(e);
    return; // stay on the loading screen with the retry button
  }
  clearTimeout(slowTimer);
  setProgress(100, 'Ready!');
  applyQuality(renderer, game.scene, settings);
  window.__game = game;

  const loading = $('loading');
  if (loading) loading.style.display = 'none';

  wireScreens();
  wireInput();
  wireTouch();
  game.showMenuCharacter();
  if (window.__refreshCharCard) window.__refreshCharCard();
  wireSettings();

  if (SHOT) {
    // Deterministic screenshot scene.
    game.stageShot(SHOT);
    game.mode = 'play';
    mode = 'play';
    showHud(true);
    setTimeout(() => { window.__shotReady = true; }, 1200);
  } else if (VIDEO) {
    startVideo();
  } else {
    // Title menu: golden-hour cinematic over the living city.
    game.state.clock = 17.45;
    game.mode = 'title';
    mode = 'title';
    show('title-screen', true);
    showHud(false);
    updateMenuButtons();
  }
  requestAnimationFrame(loop);
}

function updateMenuButtons() {
  const cont = $('btn-continue');
  // LOAD GAME is always listed (one of the 4 main options) — greyed out
  // when the selected slot has no save, instead of hidden.
  if (cont) cont.disabled = !game.hasSave(game.saveSlot);
  refreshSlots();
}

function refreshSlots() {
  // Menu slot buttons show a summary (or "empty"); the selected slot is
  // highlighted. Pause slots only highlight the current slot.
  for (const btn of document.querySelectorAll('#save-slots .slot')) {
    const slot = Number(btn.dataset.slot);
    const sum = game.saveSlotSummary(slot);
    btn.classList.toggle('sel', slot === game.saveSlot);
    btn.innerHTML = sum
      ? `SLOT ${slot} <small>$${sum.money.toLocaleString('en-US')} · ${sum.missionsDone}/12 jobs · ${String(Math.floor(sum.clock)).padStart(2, '0')}:${String(Math.floor((sum.clock % 1) * 60)).padStart(2, '0')}</small>`
      : `SLOT ${slot} · empty`;
  }
  for (const btn of document.querySelectorAll('#pause-screen .slot')) {
    btn.classList.toggle('sel', Number(btn.dataset.slot) === game.saveSlot);
  }
}

// ---------------------------------------------------------------- screens
function startPlay(fresh) {
  audio.ensure();
  if (fresh) game.reset();
  game.hideMenuChase(); // chase stays on the menu — never in gameplay
  if (game.hideMenuCharacter) game.hideMenuCharacter();
  game.mode = 'play';
  mode = 'play';
  show('title-screen', false);
  show('pause-screen', false);
  show('end-screen', false);
  show('credits-screen', false);
  showHud(true);
  showTouchUI(true);
}

function pauseGame() {
  if (game.mode !== 'play') return;
  game.mode = 'pause';
  mode = 'pause';
  show('pause-screen', true);
  showTouchUI(false);
}

function resumeGame() {
  game.mode = 'play';
  mode = 'play';
  show('pause-screen', false);
  showTouchUI(true);
}

function quitToTitle() {
  game.mode = 'title';
  mode = 'title';
  game.state.clock = 17.45;
  show('pause-screen', false);
  show('end-screen', false);
  show('title-screen', true);
  showHud(false);
  showTouchUI(false);
  updateMenuButtons();
  game.showMenuCharacter();
  if (window.__refreshCharCard) window.__refreshCharCard();
}

function wireScreens() {
  $('btn-play')?.addEventListener('click', () => startPlay(true));
  $('btn-continue')?.addEventListener('click', () => { game.loadGame(game.saveSlot); startPlay(false); });
  $('btn-credits')?.addEventListener('click', () => { show('title-screen', false); show('credits-screen', true); });
  $('btn-credits-back')?.addEventListener('click', () => { show('credits-screen', false); show('title-screen', true); });
  // Save slots: menu click loads a saved slot (or just selects an empty one);
  // pause click only selects the slot for the next S save.
  for (const btn of document.querySelectorAll('#save-slots .slot')) {
    btn.addEventListener('click', () => {
      const slot = Number(btn.dataset.slot);
      game.saveSlot = slot;
      if (game.hasSave(slot)) { game.loadGame(slot); startPlay(false); }
      else refreshSlots();
    });
  }
  for (const btn of document.querySelectorAll('#pause-screen .slot')) {
    btn.addEventListener('click', () => { game.saveSlot = Number(btn.dataset.slot); refreshSlots(); });
  }
  // Phone panel buttons (T opens the phone in-game).
  $('phone-la-rosa')?.addEventListener('click', () => game.callLaRosa());
  $('phone-manny')?.addEventListener('click', () => game.callManny());
  $('phone-crew')?.addEventListener('click', () => game.callCrew());
  $('phone-gps')?.addEventListener('click', () => game.phoneGps());
  $('phone-close')?.addEventListener('click', () => game.closePhone());
  let settingsFrom = 'title';
  $('btn-settings')?.addEventListener('click', () => { settingsFrom = 'title'; show('title-screen', false); show('settings-screen', true); });
  $('btn-pause-settings')?.addEventListener('click', () => { settingsFrom = 'pause'; show('pause-screen', false); show('settings-screen', true); });
  $('btn-settings-back')?.addEventListener('click', () => { show('settings-screen', false); show(settingsFrom === 'pause' ? 'pause-screen' : 'title-screen', true); });
  $('btn-open-controls')?.addEventListener('click', () => { show('settings-screen', false); show('controls-screen', true); });
  $('btn-controls-back')?.addEventListener('click', () => { show('controls-screen', false); show('settings-screen', true); });
  $('btn-trailer')?.addEventListener('click', () => {
    const m = $('trailer-modal');
    const v = $('trailer-video');
    if (m) m.style.display = 'flex';
    if (v) { v.currentTime = 0; v.play().catch(() => {}); }
  });
  $('btn-trailer-close')?.addEventListener('click', () => {
    const m = $('trailer-modal');
    const v = $('trailer-video');
    if (v) v.pause();
    if (m) m.style.display = 'none';
  });
  $('btn-resume')?.addEventListener('click', resumeGame);
  $('btn-save')?.addEventListener('click', () => game.saveGame());
  $('btn-quit')?.addEventListener('click', quitToTitle);
  $('btn-switch-char')?.addEventListener('click', () => { game.switchCharacter(game.selectedChar === 'jax' ? 'maya' : 'jax'); resumeGame(); });
  // Character switcher (menu): Jax <-> Maya, fixed — the old one only changed
  // the card, never the player model. pickChar rebuilds the player for real.
  const CHARS = { jax: { name: 'JAX VEGA', role: 'Wheelman — the new guy', desc: 'Fresh off the ferry, empty pockets, fast reputation. La Rosa gave him one shot.' }, maya: { name: 'MAYA REYES', role: 'Street racer — Neon Row', desc: "Neon Row's fastest wheel. She drives like the city owes her money." } };
  const refreshCharCard = () => {
    const c = CHARS[game.selectedChar] || CHARS.jax;
    const n = $('char-name'), r = $('char-role'), d = $('char-desc');
    if (n) n.textContent = c.name; if (r) r.textContent = c.role; if (d) d.textContent = c.desc;
    document.querySelectorAll('#char-dots .dot').forEach((el, i) => el.classList.toggle('on', (game.selectedChar === 'maya') === (i === 1)));
    game.showMenuCharacter();
  };
  window.__refreshCharCard = refreshCharCard;
  const pickChar = (id) => {
    if (game.selectedChar === id) return;
    game.selectedChar = id;
    try { localStorage.setItem('la-vega-3d-character', id); } catch {}
    game.rebuildPlayer(id);
    refreshCharCard();
  };
  $('char-prev')?.addEventListener('click', () => pickChar(game.selectedChar === 'jax' ? 'maya' : 'jax'));
  $('char-next')?.addEventListener('click', () => pickChar(game.selectedChar === 'jax' ? 'maya' : 'jax'));
  // Phone icon button (HUD): tap/click opens the phone, same as T.
  $('btn-phone')?.addEventListener('click', () => { if (game.mode === 'play') game.openPhone(); else if (game.mode === 'phone') game.closePhone(); });
  $('crew-plates')?.addEventListener('click', () => game.useCrewAbility('plates'));
  $('crew-fix')?.addEventListener('click', () => game.useCrewAbility('fix'));
  $('crew-eyes')?.addEventListener('click', () => game.useCrewAbility('eyes'));
  $('btn-again')?.addEventListener('click', () => { game.respawn(); showTouchUI(true); });
  $('dialogue-box')?.addEventListener('click', () => game.advanceDialogue());
  // Hide the trailer button if the trailer file is missing.
  const tv = $('trailer-video');
  if (tv) {
    tv.addEventListener('error', () => { const b = $('btn-trailer'); if (b) b.style.display = 'none'; });
  }
}

// ---------------------------------------------------------------- settings
function wireSettings() {
  const q = $('set-quality');
  const sh = $('set-shadows');
  const mu = $('set-music');
  const sf = $('set-sfx');
  const mt = $('set-mute');
  const se = $('set-sensitivity');
  const hd = $('set-hud');
  const cm = $('set-controls');
  if (q) q.value = settings.quality;
  if (sh) sh.checked = settings.shadows;
  if (mu) mu.value = settings.musicVol;
  if (sf) sf.value = settings.sfxVol;
  if (mt) mt.checked = settings.muted;
  if (se) se.value = settings.sensitivity;
  if (hd) hd.value = settings.hudDensity || 'full';
  if (cm) cm.value = settings.controlMode || 'auto';
  const apply = () => {
    saveSettings(settings);
    applyQuality(renderer, game.scene, settings);
    audio.setVolumes(settings.musicVol, settings.sfxVol, settings.muted);
  };
  q?.addEventListener('change', () => { settings.quality = q.value; qualityTouched = true; apply(); });
  sh?.addEventListener('change', () => { settings.shadows = sh.checked; apply(); });
  mu?.addEventListener('input', () => { settings.musicVol = Number(mu.value); apply(); });
  sf?.addEventListener('input', () => { settings.sfxVol = Number(sf.value); apply(); });
  mt?.addEventListener('change', () => { settings.muted = mt.checked; apply(); });
  se?.addEventListener('input', () => { settings.sensitivity = Number(se.value); apply(); });
  hd?.addEventListener('change', () => { settings.hudDensity = hd.value; document.body.classList.toggle('hud-compact', hd.value === 'compact'); apply(); });
  cm?.addEventListener('change', () => { settings.controlMode = cm.value; applyControlMode(); apply(); showTouchUI(mode === 'play'); });
  $('btn-reset-save')?.addEventListener('click', () => {
    try {
      localStorage.removeItem(SAVE_KEY);
      localStorage.removeItem(`${SAVE_KEY}-s2`);
      localStorage.removeItem(`${SAVE_KEY}-s3`);
    } catch {}
    game.reset();
    updateMenuButtons();
    alert('All 3 saves wiped. Fresh start, Jax.');
  });
}

// ---------------------------------------------------------------- input
const KEYMAP = {
  KeyW: 'up', ArrowUp: 'up', KeyS: 'down', ArrowDown: 'down',
  KeyA: 'left', ArrowLeft: 'left', KeyD: 'right', ArrowRight: 'right',
  ShiftLeft: 'run', ShiftRight: 'run',
  Space: 'jump', KeyQ: 'punch', KeyF: 'shoot', KeyN: 'nitro', // Claude scheme: Space=jump, Q=punch
};
function wireInput() {
  window.addEventListener('keydown', (e) => {
    if (e.repeat) return;
    // Dealer panel open: number keys pick a car, Enter buys, B/Esc closes.
    // (M-G.) Runs before every other key handler.
    if (game.dealerOpen) {
      const idx = { Digit1: 0, Digit2: 1, Digit3: 2, Digit4: 3, Digit5: 4, Digit6: 5, Digit7: 6, Digit8: 7, Digit9: 8, Digit0: 9 }[e.code];
      if (idx !== undefined) { game.dealerSelect(idx); return; }
      if (e.code === 'Enter') { game.dealerBuy(); return; }
      if (e.code === 'Escape' || e.code === 'KeyB') { game.closeDealer(); return; }
    }
    if (e.code === 'Enter' && game.cutscene) { game.finishCutscene(); return; }
    const k = KEYMAP[e.code];
    if (k) { keys[k] = true; if (e.code === 'Space') e.preventDefault(); }
    if (e.code === 'KeyE' || e.code === 'Enter') {
      if (game.mode === 'dialogue') { game.advanceDialogue(); return; }
      if ((game.mode === 'busted' || game.mode === 'wasted' || game.mode === 'done') && e.code === 'Enter') {
        game.respawn(); showTouchUI(true); return;
      }
      if (game.mode === 'play') keys.enter = true;
      else if (game.mode === 'title' && e.code === 'Enter') startPlay(true);
    }
    if (e.code === 'KeyP' || e.code === 'Escape') {
      if (game.mode === 'phone') game.closePhone();
      else if (game.mode === 'play') pauseGame();
      else if (game.mode === 'pause') resumeGame();
    }
    if (e.code === 'KeyT') {
      if (game.mode === 'play') game.openPhone();
      else if (game.mode === 'phone') game.closePhone();
    }
    if (game.mode === 'play' && e.code === 'KeyH') game.honk();
    if (game.mode === 'play' && e.code === 'KeyR') game.cycleStation();
    if (game.mode === 'play' && e.code === 'KeyX') keys.reload = true;
    if (game.mode === 'play' && e.code === 'KeyB') game.buyNearestBusiness();
    if (game.mode === 'play' && e.code === 'KeyV' && !game.state.player.onFoot) {
      // Car camera distance: normal -> far -> near -> normal.
      game.camZoom = game.camZoom > 1.2 ? 0.7 : game.camZoom > 0.9 ? 1.4 : 1.0;
    }
    if (game.mode === 'play' && e.code === 'KeyZ') game.useCrewAbility('plates');
    if (game.mode === 'play' && e.code === 'KeyC') game.useCrewAbility('fix');
    if (game.mode === 'play' && e.code === 'KeyG') game.useCrewAbility('eyes');
    if (game.mode === 'play' && e.code === 'KeyV' && game.state.player.onFoot) {
      // Quick switch protagonist (Jax <-> Maya) — V on foot only.
      game.switchCharacter(game.selectedChar === 'jax' ? 'maya' : 'jax');
    }
    // Digit4: respray at the garage, shotgun everywhere else (Claude: 1-5 = weapons).
    if (game.mode === 'play' && e.code === 'Digit4' && !game.weaponWheelOpen) {
      const p = game.state.player;
      if (Math.hypot(p.x - PLACES.garage.x, p.z - PLACES.garage.y) < 20) game.cyclePaint();
      else game.selectWeapon('shotgun');
    }
    if (e.code === 'KeyS' && game.mode === 'pause') game.saveGame();
    if (e.code === 'KeyQ' && game.mode === 'pause') quitToTitle();
    if (e.code === 'Tab' && game.mode === 'play') { e.preventDefault(); game.toggleWeaponWheel(); }
    if (e.code === 'KeyM') {
      settings.muted = !settings.muted;
      saveSettings(settings);
      audio.setVolumes(settings.musicVol, settings.sfxVol, settings.muted);
    }
    if (game.mode === 'play' && (e.code === 'Digit1' || e.code === 'Digit2' || e.code === 'Digit3' || e.code === 'Digit5')) {
      if (game.weaponWheelOpen) {
        game.selectWeapon({ Digit1: 'fists', Digit2: 'pistol', Digit3: 'smg', Digit5: 'rifle' }[e.code]);
      } else {
        // Near the dealer, 1/2/3 still buy cars (dealer prompt); elsewhere
        // 1-5 pick weapons directly, Claude-style.
        const p = game.state.player;
        const nearDealer = Math.hypot(p.x - PLACES.dealer.x, p.z - PLACES.dealer.y) < 14;
        if (nearDealer && e.code !== 'Digit5') {
          game.buyCar(e.code === 'Digit1' ? 'sedan' : e.code === 'Digit2' ? 'truck' : 'sport');
        } else {
          game.selectWeapon({ Digit1: 'fists', Digit2: 'pistol', Digit3: 'smg', Digit5: 'rifle' }[e.code]);
        }
      }
    }
  });
  window.addEventListener('keyup', (e) => {
    const k = KEYMAP[e.code];
    if (k) keys[k] = false;
  });
  // Mouse wheel zooms the follow camera in/out (Claude parity).
  window.addEventListener('wheel', (e) => {
    if (game.mode === 'play') game.setCamZoom(e.deltaY > 0 ? 0.12 : -0.12);
  }, { passive: true });
  // Mouse: drag to orbit the camera, click to shoot, RIGHT-HOLD to aim (ADS).
  let dragging = false;
  let lastX = 0, lastY = 0;
  let downAt = 0;
  const cvs = renderer.domElement;
  cvs.addEventListener('contextmenu', (e) => e.preventDefault());
  cvs.addEventListener('pointerdown', (e) => {
    if (e.pointerType === 'touch') return;
    if (e.button === 2) { keys.aim = true; return; } // right-hold = aim down sights
    dragging = true; lastX = e.clientX; lastY = e.clientY; downAt = performance.now();
  });
  window.addEventListener('pointermove', (e) => {
    if (!dragging || e.pointerType === 'touch') return;
    const dx = e.clientX - lastX;
    const dy = e.clientY - lastY;
    lastX = e.clientX; lastY = e.clientY;
    // Claude parity: 0.0024 rad/px (the old 0.004 was 67% too twitchy — "liar").
    // Drag right = look right; drag down = higher camera angle (pitch -0.35..1.1).
    // Any drag resets the idle timer (Claude Rr=0) — the in-car auto-follow
    // only resumes after 2 s without a drag.
    game.camYaw += dx * 0.0024 * settings.sensitivity;
    game.camPitch = Math.max(-0.35, Math.min(1.1, game.camPitch + dy * 0.0024 * settings.sensitivity));
    game.camIdleT = 0;
  });
  window.addEventListener('pointerup', (e) => {
    if (e.button === 2) { keys.aim = false; return; }
    if (!dragging) return;
    dragging = false;
    if (e.pointerType !== 'touch' && performance.now() - downAt < 220 && game.mode === 'play') {
      keys.shoot = true;
      setTimeout(() => { keys.shoot = false; }, 120);
    }
  });
  window.addEventListener('resize', () => {
    renderer.setSize(window.innerWidth, window.innerHeight);
  });
}

// ---------------------------------------------------------------- touch
function wireTouch() {
  if (!IS_TOUCH) return;
  const joy = $('touch-joystick');
  const knob = $('touch-knob');
  if (!joy || !knob) return;
  let joyId = null;
  let center = { x: 0, y: 0 };
  const setKnob = (dx, dy) => { knob.style.transform = `translate(${dx}px, ${dy}px)`; };
  const updateFromTouch = (t) => {
    const dx = t.clientX - center.x;
    const dy = t.clientY - center.y;
    const len = Math.hypot(dx, dy);
    const max = 52;
    const cl = len > max ? max / len : 1;
    const nx = (dx * cl) / max, ny = (dy * cl) / max;
    setKnob(dx * cl, dy * cl);
    touchMove = { x: nx, y: ny, active: true };
    touchRun = Math.hypot(nx, ny) > 0.85;
  };
  joy.addEventListener('touchstart', (e) => {
    e.preventDefault();
    const t = e.changedTouches[0];
    joyId = t.identifier;
    const r = joy.getBoundingClientRect();
    center = { x: r.left + r.width / 2, y: r.top + r.height / 2 };
    updateFromTouch(t);
  }, { passive: false });
  joy.addEventListener('touchmove', (e) => {
    e.preventDefault();
    for (const t of e.changedTouches) if (t.identifier === joyId) updateFromTouch(t);
  }, { passive: false });
  const endJoy = (e) => {
    for (const t of e.changedTouches) {
      if (t.identifier === joyId) {
        joyId = null;
        touchMove = { x: 0, y: 0, active: false };
        touchRun = false;
        setKnob(0, 0);
      }
    }
  };
  joy.addEventListener('touchend', endJoy);
  joy.addEventListener('touchcancel', endJoy);
  // Action buttons: hold-to-activate, tap for E.
  const hold = (id, key) => {
    const b = $(id);
    if (!b) return;
    b.addEventListener('touchstart', (e) => { e.preventDefault(); keys[key] = true; }, { passive: false });
    const up = () => { keys[key] = false; };
    b.addEventListener('touchend', up);
    b.addEventListener('touchcancel', up);
  };
  hold('btn-gas', 'up');
  hold('btn-brake', 'down');
  hold('btn-punch', 'punch');
  hold('btn-jump', 'jump');
  hold('btn-shoot', 'shoot');
  hold('btn-aim', 'aim');
  const enterBtn = $('btn-enter');
  if (enterBtn) {
    enterBtn.addEventListener('touchstart', (e) => {
      e.preventDefault();
      if (game.mode === 'dialogue') game.advanceDialogue();
      else if (game.mode === 'play') keys.enter = true;
    }, { passive: false });
  }
  const pauseBtn = $('btn-touch-pause');
  if (pauseBtn) {
    pauseBtn.addEventListener('touchstart', (e) => {
      e.preventDefault();
      if (game.mode === 'play') pauseGame();
      else if (game.mode === 'pause') resumeGame();
    }, { passive: false });
  }
  // Swipe on the canvas rotates the camera. Drag right = look right.
  // Claude parity (measured from the Claude file): touch drag is DIRECT —
  // 0.005 rad/px, no velocity/inertia (the old camVel kept spinning the
  // camera after the finger lifted — the "liar" feel on the phone). Two
  // fingers pinch-zoom instead (Claude: jn *= prevDist/curDist).
  const cvs = renderer.domElement;
  const swipes = new Map();
  let pinchDist = 0;
  cvs.addEventListener('touchstart', (e) => {
    for (const t of e.changedTouches) swipes.set(t.identifier, { x: t.clientX, y: t.clientY });
    if (swipes.size >= 2) {
      const pts = [...swipes.values()];
      pinchDist = Math.hypot(pts[0].x - pts[1].x, pts[0].y - pts[1].y);
    }
  }, { passive: true });
  cvs.addEventListener('touchmove', (e) => {
    if (swipes.size >= 2) {
      // Pinch zoom (Claude): spread fingers = zoom in (distance shrinks).
      for (const t of e.changedTouches) {
        if (swipes.has(t.identifier)) swipes.set(t.identifier, { x: t.clientX, y: t.clientY });
      }
      const pts = [...swipes.values()];
      const d = Math.hypot(pts[0].x - pts[1].x, pts[0].y - pts[1].y);
      if (pinchDist > 0 && d > 0) game.camZoom = Math.min(1.8, Math.max(0.6, game.camZoom * (pinchDist / d)));
      pinchDist = d;
      game.camIdleT = 0;
      return;
    }
    // Single finger: direct camera drag, Claude 0.005 rad/px, no inertia.
    for (const t of e.changedTouches) {
      const prev = swipes.get(t.identifier);
      if (!prev) continue;
      game.camYaw += (t.clientX - prev.x) * 0.005 * settings.sensitivity;
      game.camPitch = Math.max(-0.35, Math.min(1.1, game.camPitch + (t.clientY - prev.y) * 0.005 * settings.sensitivity));
      game.camIdleT = 0;
      swipes.set(t.identifier, { x: t.clientX, y: t.clientY });
    }
  }, { passive: true });
  cvs.addEventListener('touchend', (e) => {
    for (const t of e.changedTouches) swipes.delete(t.identifier);
    if (swipes.size < 2) pinchDist = 0;
  }, { passive: true });
}

// Merge touch joystick into the keyboard key state (camera-relative).
function mergedKeys() {
  const k = { ...keys };
  // ENTER is a one-shot action: the game sees it exactly once. Without this
  // the flag stays true and the player would enter/exit a car every frame.
  keys.enter = false;
  if (touchMove.active) {
    // Joystick up = forward (camera direction), like W.
    const fx = Math.cos(game.camYaw), fz = Math.sin(game.camYaw);
    const rx = -fz, rz = fx;
    const mx = fx * -touchMove.y + rx * touchMove.x;
    const mz = fz * -touchMove.y + rz * touchMove.x;
    // Decompose into camera-relative digital keys.
    const fwd = -touchMove.y;
    const strafe = touchMove.x;
    k.up = fwd > 0.25; k.down = fwd < -0.25;
    k.left = strafe < -0.25; k.right = strafe > 0.25;
    k.run = touchRun;
    void mx; void mz;
  }
  return k;
}

// ---------------------------------------------------------------- loop
let lastT = performance.now();
let acc = 0;
let titleAngle = 0.6;

function loop(now) {
  requestAnimationFrame(loop);
  const dtMs = Math.min(100, now - lastT);
  lastT = now;
  const dt = dtMs / 1000;
  fpsEMA = fpsEMA * 0.95 + (1000 / Math.max(1, dtMs)) * 0.05;

  if (SHOT) {
    game.update(STEP, { up: false, down: false, left: false, right: false, run: false, punch: false, shoot: false, enter: false });
    game.render();
    return;
  }

  if (mode === 'title') {
    // Karimbu-style menu framing: camera on the wet sand at the water's
    // edge, looking EAST at the city — the hero on his pedestal in the
    // foreground, beach palms framing the shot, hotels and glass towers
    // behind, dusk sky above. Slow drift along the beach (no full orbit:
    // the sea half of the old orbit showed nothing but water).
    titleAngle += dt * 0.05;
    const sway = Math.sin(titleAngle);
    const cam = game.camera;
    cam.position.set(17.5 + sway * 1.2, 5.2, 130 + sway * 5);
    cam.lookAt(72, 5.5, 130);
    // Golden hour on the menu, always: the game starts at noon, the menu
    // is dusk. Clamped back whenever it drifts out of the dusk band.
    if (game.state.clock < 16.5 || game.state.clock >= 18.9) game.state.clock = 17.6;
    game.ensureMenuChase(); // live police chase behind the hero (title backdrop)
    if (game.menuChar) game.menuChar.group.rotation.y += dt * 0.5; // pedestal turntable
    game.updateMenuChase(dt);
    game.updateDayNight(dt * 0.2); // sunset barely moves on the menu
    game.updateAmbient(dt);
    game.updateChunks();
    game.render();
    return;
  }

  if (VIDEO) {
    // Video mode is frame-stepped by the recorder: it calls
    // window.__advanceVideo() once per captured frame (deterministic,
    // independent of wall-clock frame rate in software WebGL).
    if (!videoReady) { videoReady = true; window.__videoReady = true; }
    game.render();
    return;
  }

  if (game.mode === 'dialogue') {
    game.updateAmbient(dt);
    game.render();
    return;
  }

  acc += dt;
  let steps = 0;
  while (acc >= STEP && steps < 5) {
    game.update(STEP, mergedKeys());
    acc -= STEP;
    steps += 1;
  }
  if (steps === 5) acc = 0;
  // (Claude parity: no touch-camera inertia — drag applies directly.)
  if (IS_TOUCH && game.mode === 'play') updateTouchButtons();
  // Adaptive quality: drop a level if the frame rate sags.
  if (!qualityTouched && game.mode === 'play' && now - lastQualityDrop > 8000 && fpsEMA < 26) {
    lastQualityDrop = now;
    let dropped = false;
    if (settings.quality === 'high') { settings.quality = 'medium'; dropped = true; }
    else if (settings.quality === 'medium') { settings.quality = 'low'; settings.shadows = false; dropped = true; }
    if (dropped) {
      saveSettings(settings);
      applyQuality(renderer, game.scene, settings);
      const q = $('set-quality');
      if (q) q.value = settings.quality;
      const sh2 = $('set-shadows');
      if (sh2) sh2.checked = settings.shadows;
      showQualityPill(settings.quality === 'medium' ? 'Medium' : 'Low');
    }
  }
  game.render();
  showTouchUI(game.mode === 'play');
}

// Minimal touch buttons: show only the actions that make sense right now —
// GAS/BRAKE only in a car, PUNCH/FIRE only on foot (FIRE only with a gun),
// ENTER only in a car or near something to enter/talk to.
let lastTouchBtnState = '';
function updateTouchButtons() {
  if (!game) return;
  const s = game.state, p = s.player;
  const inCar = !p.onFoot;
  let nearInteract = false;
  if (!inCar) {
    const clubD2 = (p.x - PLACES.club.x) ** 2 + (p.z - (PLACES.club.y + 8)) ** 2;
    const dealerD2 = (p.x - PLACES.dealer.x) ** 2 + (p.z - PLACES.dealer.y) ** 2;
    nearInteract = clubD2 < 49 || dealerD2 < 196 || !!game.nearestCar(p.x, p.z, 4);
  }
  const show = {
    'btn-gas': inCar, 'btn-brake': inCar,
    'btn-shoot': (!inCar && !!s.hasPistol) || (inCar && s.weapon !== 'fists'), // drive-by FIRE (M-G)
    'btn-aim': !inCar && s.weapon !== 'fists',
    'btn-punch': !inCar, 'btn-jump': !inCar,
    'btn-enter': inCar || nearInteract,
  };
  const key = Object.entries(show).map(([k, v]) => (v ? '1' : '0')).join('');
  if (key === lastTouchBtnState) return;
  lastTouchBtnState = key;
  for (const [id, on] of Object.entries(show)) {
    const el = $(id);
    if (el) el.style.display = on ? 'flex' : 'none';
  }
}

// ---------------------------------------------------------------- video
// 30-second cinematic trailer + gameplay reel, rendered live by the engine.
// Acts: 0 flyover (0-6s) · 1 boulevard drive (6-14s) · 2 police chase (14-22s)
//       3 warehouse action (22-28s) · 4 title card (28-30s).
let videoT = 0;
let videoAct = -1;
let videoReady = false;

function startVideo() {
  game.reset();
  game.mode = 'play';
  mode = 'play';
  showHud(true);
  videoT = 0;
  videoAct = -1;
  // Mute the music bus for a clean capture (page is muted via --mute-audio anyway).
}

function videoDriveTo(tx, tz) {
  const s = game.state;
  const car = s.player.onFoot ? null : game.cars.find((c) => c.id === s.player.carId);
  if (!car) return { up: false, down: false, left: false, right: false, run: false, punch: false, shoot: false, enter: false };
  const d = driveInputTo(car, tx, tz);
  return { up: d.throttle, down: d.brake, left: d.steer < -0.15, right: d.steer > 0.15, run: false, punch: false, shoot: false, enter: false };
}

function videoTick(dt) {
  videoT += dt;
  const act = videoT < 6 ? 0 : videoT < 14 ? 1 : videoT < 22 ? 2 : videoT < 28 ? 3 : 4;
  // One video frame (1/8s) simulates 6 fixed steps so motion runs near full speed.
  const SIM_STEPS = 6;
  if (act !== videoAct) {
    videoAct = act;
    const s = game.state;
    if (act === 0) {
      game.reset();
      game.state.clock = 17.6; // golden hour for the flyover
      const title = $('video-title');
      if (title) title.style.display = 'block';
    }
    if (act === 1) {
      // Boulevard drive: one straight shot south on Marlin Row (x=117).
      // The car spawns already facing south — no corner turn, so it can
      // never wedge itself into a building at the intersection.
      const title = $('video-title');
      if (title) title.style.display = 'none';
      game.reset();
      game.state.clock = 10.0;
      const st = game.state;
      const car = game.cars.find((c) => c.model === 'sport' && c.parked);
      st.player.x = 117; st.player.z = 143; st.player.angle = Math.PI / 2;
      st.player.onFoot = false; st.player.carId = car.id; car.isPlayer = true; car.parked = false;
      car.x = 117; car.z = 143; car.angle = Math.PI / 2; car.speed = 10;
      game.player.group.visible = false;
      game.camYaw = Math.PI / 2;
      game.updateCamera(1); game.updateCamera(1);
    }
    if (act === 2) {
      // Chase: hard cut to a fresh straight shot east on the z=221 road.
      // (Trailer language: a cut between shots, not one continuous drive.)
      const st = game.state;
      const car = game.cars.find((c) => c.id === st.player.carId);
      st.player.x = 91; st.player.z = 221; st.player.angle = 0;
      car.x = 91; car.z = 221; car.angle = 0; car.speed = 12;
      game.camYaw = 0;
      game.updateCamera(1); game.updateCamera(1);
      s.wanted = 3;
      game.spawnPolice();
    }
    if (act === 3) {
      // Beach shootout: open sand, player facing east toward the city,
      // rivals closing in from the east — camera over open sand, no walls.
      game.reset();
      game.state.clock = 16.0;
      const st = game.state;
      st.hasPistol = true; st.ammo = 60;
      st.player.x = 24; st.player.z = 200; st.player.angle = 0;
      game.player.group.position.set(st.player.x, 0, st.player.z);
      game.spawnRivals('armed', 4, 36, 200);
      game.camYaw = 0;
      game.updateCamera(1); game.updateCamera(1);
    }
    if (act === 4) {
      const title = $('video-title');
      if (title) { title.style.display = 'block'; title.textContent = 'LA VEGA 3D — PLAY IT NOW'; }
    }
  }
  if (act === 0) {
    // Flyover: high slow orbit, world alive behind the title.
    const a = videoT * 0.12;
    const cam = game.camera;
    cam.position.set(130 + Math.cos(a) * 120, 70 - videoT * 2, 130 + Math.sin(a) * 120);
    cam.lookAt(130, 4, 130);
    game.updateAmbient(dt);
    game.updateDayNight(dt * 0.2);
    game.render();
  } else if (act === 1) {
    game.autoInput = videoDriveTo(117, 221); // south on Marlin Row to the z=221 crossroad
    for (let i = 0; i < SIM_STEPS; i += 1) game.update(STEP, game.autoInput);
    game.render();
  } else if (act === 2) {
    game.autoInput = videoDriveTo(221, 221); // east on the z=221 road, cops in pursuit
    for (let i = 0; i < SIM_STEPS; i += 1) game.update(STEP, game.autoInput);
    game.render();
  } else if (act === 3) {
    // On-foot action: face the nearest rival and fire.
    const s = game.state;
    let best = null, bestD = 1e9;
    for (const r of game.rivals) {
      if (r.dead) continue;
      const d = Math.hypot(r.x - s.player.x, r.z - s.player.z);
      if (d < bestD) { bestD = d; best = r; }
    }
    const k = { up: false, down: false, left: false, right: false, run: false, punch: false, shoot: false, enter: false };
    if (best) {
      s.player.angle = Math.atan2(best.z - s.player.z, best.x - s.player.x);
      game.camYaw = s.player.angle;
      if (bestD < 30) k.shoot = true;
      if (bestD > 8) { k.up = true; }
    }
    for (let i = 0; i < SIM_STEPS; i += 1) game.update(STEP, k);
    game.render();
  } else {
    game.updateAmbient(dt);
    game.render();
  }
  if (!videoReady) { videoReady = true; window.__videoReady = true; }
  if (videoT >= 30) window.__videoDone = true;
}

// Frame-stepped capture: the recorder calls this once per video frame.
window.__advanceVideo = () => { videoTick(1 / 8); };

boot().catch((e) => {
  console.error(e);
  const loading = $('loading');
  if (loading) loading.textContent = `Failed to load: ${e.message}`;
});
