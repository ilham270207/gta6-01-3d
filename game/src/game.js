// LA VEGA 3D — game logic: player, cars, traffic, pedestrians, police,
// wanted system, combat, the five jobs, camera, HUD + live minimap, save/load.
// Coordinates in metres; x east, z south. World 260x260.
import * as THREE from 'three';
import { STEP, SAVE_KEY, WORLD, ROADS, STREETS_NS, STREETS_EW, PALETTE, PLACES, DISTRICTS, CAR_MODELS, CAR_CATALOG, CHARACTERS, PLAYER, WANTED_MAX, MISSIONS, FUEL_PRICE, REPAIR_BASE, WEAPONS, RANKS } from './config.js';
import { createRandom, clamp, angDiff, dist2 } from './rng.js';
import { buildCity } from './city.js';
import { buildCarMesh, createCar, stepCar, stepTrafficCar, carForward, carRotationY } from './vehicles.js';
// City bus route (M3c): serpentine loop over roads 91-143-169-247, turning
// on roads 65/221. Each leg runs the direction that puts the bus in the lane
// next to its stop (northbound on 91/169, southbound on 143/247).
const BUS_ROUTE = [[91, 221], [91, 65], [143, 65], [143, 221], [169, 221], [169, 65], [247, 65], [247, 221]];
const BUS_STOPS = [[91, 130], [143, 104], [169, 208], [247, 78]]; // road points beside the 4 shelters
const BUS_X_AXIS = new THREE.Vector3(1, 0, 0);
import { Humanoid, loadCesiumMan } from './humanoid.js';
import { loadQuaternius, Q, cloneQuaterniusWeapon } from './quaternius.js';
import { loadBuyCars } from './buycars.js'; // Auto Palms dealer GLBs (M-G)
import { loadRetargetedCharacter } from './retarget.js';

const TAU = Math.PI * 2;

export function driveInputTo(car, tx, tz) {
  const dx = tx - car.x, dz = tz - car.z;
  const d = Math.hypot(dx, dz);
  const want = Math.atan2(dz, dx);
  const diff = angDiff(car.angle, want);
  const steer = clamp(diff * 1.6, -1, 1);
  return { throttle: d > 3, brake: Math.abs(diff) > 2.2 && d < 25, steer, stop: d < 3 };
}
export function walkInputTo(px, pz, tx, tz) {
  const dx = tx - px, dz = tz - pz;
  const d = Math.hypot(dx, dz);
  const want = Math.atan2(dz, dx);
  return { angle: want, dist: d, run: d > 12 };
}

export class Game {
  constructor(opts) {
    this.opts = opts;
    this.seed = opts.seed ?? 1;
    this.rng = createRandom(this.seed);
    this.audio = opts.audio;
    this.mode = 'title'; // title | play | pause | busted | wasted | done
    this.time = 0;
    this.camYaw = 0;
    this.camYawOffset = 0;
    this.camPitch = 0.32;
    this.camIdleT = 0; // seconds since the last camera drag (Claude Rr) — drives the in-car auto-follow only.
    this.scene = new THREE.Scene();
    this.scene.background = new THREE.Color(PALETTE.sky);
    this.scene.fog = new THREE.Fog(0x9fd0e8, 90, 240);
    this.camera = new THREE.PerspectiveCamera(62, 1280 / 720, 0.1, 600);
    this.renderer = opts.renderer;
    this.city = null;
    this.player = null;
    this.playerWeapon = null; // pistol mesh in Jax's right hand (visible when armed).
    this.laRosa = null; // La Rosa standing at the club (Quaternius GLB, idles).
    this.newChars = { jax: null, laRosa: null }; // ilham's NEW Male/Female GLBs (retargeted), null = fallback to Quaternius.
    this.camZoom = 1; // camera zoom multiplier (mouse wheel, 0.6..1.8) — Claude parity.
    this.ads = 0; // aim-down-sights 0..1 (Point Blank style; lerps toward input.aim)
    this.bloom = 0; // crosshair spread bloom from firing, decays over ~1 s
    this.reloadT = 0; // >0 while a magazine reload is running
    this.aimPulse = 0; // brief aim pose after each shot (so hipfire still raises the gun)
    this.weaponWheelOpen = false;
    this.cars = [];
    this.peds = [];
    this.cops = [];
    this.cruisers = [];
    this.menuChase = null; // title-screen chase scene (see ensureMenuChase)
    this.cutscene = null; // active mission card cutscene {t, dur, kind, onDone} (M-I)
    this.dealerOpen = false; this.dealerSel = 0; this.dealerPreview = null; // Auto Palms dealer (M-G)
    this.nearestPolice = 999; this.policeUnits = 0; this.chatterT = 8; // dispatch board (M-G)
    this.lastDistrictKey = null; this.locationUntil = 0; // location intro card (M-G)
    this.rivals = [];
    this.bullets = [];
    this.particles = [];
    this.message = { text: '', until: 0 };
    this.saveRequested = false;
    this.saveSlot = 1; // current save slot (1..3, Claude parity)
    // The player is ALWAYS Jax (ilham 19:24 WIB: character switcher removed).
    // Root cause of the bug: buildPlayer() runs once at boot from the saved
    // choice, while the menu switcher only changed the pedestal model + the
    // saved value — so picking Maya in the menu still played the model baked
    // at boot (npcMale businessman from an old saved choice). No switching.
    this.selectedChar = 'jax';
    this.trauma = 0;
    this.shotMode = null;
    this.autoInput = null;
    this.muzzleUntil = 0;
    this.sirenAt = 0;
    this.weather = 'sunny';
    this.weatherT = 45;
    this.heli = null;
    this.roadblocks = [];
    this.spikes = []; // police spike strips (wanted 4+), { group, x, z, axis, until }
    this.searchMode = false;
    this.lastKnown = { x: 150, z: 114 };
    this.lastSeenT = 0;
    this.noSeeT = 0;
    this.dialogue = null;      // { lines, idx, onDone }
    this.extraTraffic = [];
    this.rushActive = false;
    // Living-world systems (district standing, random events, rain, phone).
    this.eventT = 45;
    this.eventVehicles = [];   // { car, until }
    this.rain = null;          // THREE.LineSegments rain streaks
    this.phoneOpen = false;
    this.loot = []; // cash drops from dead NPCs (auto-collect on walk-over)
    this.protagPos = { jax: { x: 150, z: 114, angle: Math.PI / 2 }, maya: { x: 104, z: 78, angle: 0 } }; // per-protagonist positions (switch keeps each where they stood)
    this.lastIntensity = -1;
    this.lastAmbience = '';
    this.lastAmbienceT = 0;
    this.stunts = [];
    this.collectibles = [];
    this.taxiJob = null;       // { x, z, timer, reward, marker }
    this.lastHour = 10;
    this.lastSkillsText = '';
    this.state = this.freshState();
    this.cutscene = null;
    if (this.hud && this.hud.card) this.hud.card.style.display = 'none';
    this.hud = {};
    this.minimap = null;
  }

  freshState() {
    return {
      money: 0, ammo: 24, hasPistol: true, wanted: 0, wantedDecay: 0, wantedGainCd: 0,
      mag: 12, mags: { pistol: 12 }, // magazine (reserve ammo is `ammo`); per-weapon mags
      health: PLAYER.health,
      player: { x: 150, z: 114, angle: 0, onFoot: true, carId: -1, punchCd: 0, shootCd: 0, lastHurt: -99, speed01: 0, y: 0, vy: 0, grounded: true, jumpAnt: 0, landT: 0 },
      mission: { index: -1, step: 0, timer: 0, hasPackage: false, rivalsLeft: 0 },
      missionAvailable: 0, missionsDone: 0,
      owned: [],              // bought cars, by model, parked at Manny's Garage
      clock: 12.0,            // game hours; Claude starts 12:00 (midday, blue sky)
      day: 1,                 // day counter (contekan P1.8)
      weaponsOwned: { pistol: true, smg: false, shotgun: false, rifle: false },
      weapon: 'pistol',        // selected weapon key (WEAPONS) — Claude start loadout: PISTOL 36 + $0
      crew: { muscle: false, driver: false, hacker: false }, // $1500 passives, bought at the club (B)
      stats: { stolen: 0, shots: 0 },
      standing: { marina: 0, downtown: 0, neon: 0, south: 0 }, // district standing 0-100%
      businesses: { bar: false, garage: false }, // passive income
      skills: { drive: 0, shoot: 0, stamina: 0 }, // 0-100 each
      collectibles: 0,        // packages found (0/10)
      respawn: null,          // {x,z} safehouse respawn, null = hospital
    };
  }

  // ---- Districts -----------------------------------------------------------
  districtAt(x, z) {
    for (const d of DISTRICTS) {
      if (x >= d.x0 && x < d.x1 && z >= d.z0 && z < d.z1) return d;
    }
    return DISTRICTS[0];
  }
  currentDistrict() {
    const p = this.state.player;
    return this.districtAt(p.x, p.z);
  }

  // Street you're on: the nearest road centre line on either axis (the
  // closer one wins). Outside the city grid it's the area name instead.
  currentStreet() {
    const p = this.state.player;
    if (p.x < 30) return 'The Shore';
    if (p.x > 260 && p.z > 260) return 'Rocky Hills';
    if (p.x > 260) return 'The Desert';
    if (p.z > 260) return 'The Forest';
    let bx = 0, bd = 1e9;
    ROADS.forEach((r, i) => { const d = Math.abs(p.x - r); if (d < bd) { bd = d; bx = i; } });
    let bz = 0, bd2 = 1e9;
    ROADS.forEach((r, i) => { const d = Math.abs(p.z - r); if (d < bd2) { bd2 = d; bz = i; } });
    return bd <= bd2 ? STREETS_NS[bx] : STREETS_EW[bz];
  }

  // NPC dubbing REMOVED (ilham 18:40 WIB): dialog stays as text only.
  // (speak() + voiceEnabled() deleted by ilham request — dialog is text only.)

  // ------------------------------------------------------------ boot
  async boot(onProgress) {
    const prog = (pct, label) => { if (onProgress) onProgress(pct, label); };
    prog(5, 'Loading characters…');
    await loadCesiumMan();
    prog(25, 'Loading characters…');
    await loadQuaternius(); // Quaternius GLB characters + cars (base64, file:// safe).
    // Buy-car GLBs for the Auto Palms dealer (M-G): fetched from
    // game/models/cars/ on http(s); skips silently on file:// and the
    // dealer falls back to procedural cars. Never blocks boot.
    loadBuyCars().then((n) => { if (n > 0) console.log(`[buycars] ${n} dealer models ready`); }).catch(() => {});
    // Ilham's NEW character GLBs (game/models/*.glb, fetched — NOT embedded,
    // ~16 MB each). Only on http(s) (GitHub Pages preview); on file:// the
    // fetch would fail, so skip silently and keep the Quaternius heroes.
    // DISABLED (M3b, 23 Nov): on ilham's phone the new GLBs render as a
    // NAKED T-POSE mannequin (textures don't load, retargeted animation
    // doesn't play) and the player is invisible — while the Quaternius
    // heroes render clothed + animated on the same phone. Fall back to
    // Quaternius for Jax + La Rosa until the new GLBs are re-exported
    // (smaller JPEG textures) and the retarget is re-verified on mobile.
    // (Kept in game/models/ — do NOT delete — re-enable by uncommenting.)
    // if (window.location.protocol.startsWith('http')) {
    //   if (Q.chars.jax) this.newChars.jax = await loadRetargetedCharacter('./models/male.glb', Q.chars.jax);
    //   if (Q.chars.laRosa) this.newChars.laRosa = await loadRetargetedCharacter('./models/female.glb', Q.chars.laRosa);
    // }
    const scene = this.scene;
    // Lighting: warm morning sun + sky bounce.
    const sun = new THREE.DirectionalLight(0xfff2d0, 2.6);
    sun.position.set(60, 90, 30);
    sun.castShadow = true;
    sun.shadow.mapSize.set(2048, 2048);
    sun.shadow.camera.left = -70; sun.shadow.camera.right = 70;
    sun.shadow.camera.top = 70; sun.shadow.camera.bottom = -70;
    sun.shadow.camera.near = 10; sun.shadow.camera.far = 260;
    sun.shadow.bias = -0.0004;
    scene.add(sun);
    this.sun = sun;
    scene.add(new THREE.HemisphereLight(0xbfe3ff, 0x8a7a5a, 1.15));
    // Clouds.
    this.clouds = [];
    const cloudMat = new THREE.MeshLambertMaterial({ color: 0xffffff, transparent: true, opacity: 0.9 });
    for (let i = 0; i < 9; i += 1) {
      const c = new THREE.Group();
      // High, flat, wide clouds (the old y 55-75 blobs read as low grey
      // lumps hugging the rooftops — ilham's screenshot). They drift slowly.
      for (let j = 0; j < 5; j += 1) {
        const s = new THREE.Mesh(new THREE.SphereGeometry(this.rng.range(5, 9), 10, 8), cloudMat);
        s.position.set(j * 5 - 10 + this.rng.range(-1.5, 1.5), this.rng.range(-0.4, 0.6), this.rng.range(-2, 2));
        s.scale.y = 0.3;
        c.add(s);
      }
      c.position.set(this.rng.range(-40, 300), this.rng.range(85, 120), this.rng.range(-40, 300));
      c.userData.drift = this.rng.range(0.4, 1.0);
      scene.add(c);
      this.clouds.push(c);
    }
    // Sky bodies: visible sun disc + glow, moon, and stars (M-E). They sit
    // 380 m out and follow the player; fog:false so the horizon fog never
    // swallows them, and the depth test still lets buildings occlude them.
    const skyGroup = new THREE.Group();
    const sunDisc = new THREE.Mesh(new THREE.CircleGeometry(14, 24),
      new THREE.MeshBasicMaterial({ color: 0xffe9a8, fog: false }));
    const sunGlow = new THREE.Mesh(new THREE.CircleGeometry(34, 24),
      new THREE.MeshBasicMaterial({ color: 0xffc46b, transparent: true, opacity: 0.3, fog: false, depthWrite: false }));
    const moonDisc = new THREE.Mesh(new THREE.CircleGeometry(10, 24),
      new THREE.MeshBasicMaterial({ color: 0xe8eef7, fog: false }));
    skyGroup.add(sunDisc, sunGlow, moonDisc);
    const starGeo = new THREE.BufferGeometry();
    const starPos = new Float32Array(360 * 3);
    for (let i = 0; i < 360; i += 1) {
      const a = this.rng.range(0, TAU), e = this.rng.range(0.12, 1.45);
      starPos[i * 3] = Math.cos(a) * Math.cos(e) * 380;
      starPos[i * 3 + 1] = Math.sin(e) * 380;
      starPos[i * 3 + 2] = Math.sin(a) * Math.cos(e) * 380;
    }
    starGeo.setAttribute('position', new THREE.BufferAttribute(starPos, 3));
    const starMat = new THREE.PointsMaterial({ color: 0xffffff, size: 1.8, sizeAttenuation: false, transparent: true, opacity: 0, fog: false, depthWrite: false });
    const stars = new THREE.Points(starGeo, starMat);
    skyGroup.add(stars);
    scene.add(skyGroup);
    this.skySun = sunDisc; this.skyGlow = sunGlow; this.skyMoon = moonDisc; this.skyStars = stars;
    prog(45, 'Building La Vega…');
    // Sky dome: vertical gradient (canvas texture) — day blue, dusk rose,
    // night deep blue. Follows the player; fog:false; drawn first so
    // everything else paints over it. (M-H: HD sky for dossier shots.)
    const skyCanvas = document.createElement('canvas');
    skyCanvas.width = 4; skyCanvas.height = 256;
    this.skyCanvas = skyCanvas;
    const skyTex = new THREE.CanvasTexture(skyCanvas);
    skyTex.colorSpace = THREE.SRGBColorSpace;
    const skyDome = new THREE.Mesh(
      new THREE.SphereGeometry(480, 24, 16),
      new THREE.MeshBasicMaterial({ map: skyTex, side: THREE.BackSide, fog: false, depthWrite: false }));
    skyDome.renderOrder = -1;
    scene.add(skyDome);
    this.skyDome = skyDome; this.skyTex = skyTex; this.skyPhase = '';
    this.cloudMat = cloudMat;

    this.city = buildCity(scene, this.rng);
    prog(65, 'Spawning cars & people…');
    this.buildPlayer();
    this.attachPlayerWeapon();
    this.buildCars();
    this.buildPeds();
    this.buildLaRosa();
    prog(85, 'Warming up the streets…');
    this.buildParticles();
    this.buildRain();
    this.buildStunts();
    this.buildCollectibles();
    this.cacheHud();
    this.reset();
    prog(100, 'Ready!');
  }

  // Rain streaks: one LineSegments cloud that follows the player, hidden
  // unless the weather is rain/storm (see updateRain).
  buildRain() {
    const N = 700;
    const pos = new Float32Array(N * 6);
    for (let i = 0; i < N; i += 1) {
      const x = (Math.random() - 0.5) * 60, y = Math.random() * 30, z = (Math.random() - 0.5) * 60;
      pos.set([x, y, z, x, y - 0.7, z], i * 6);
    }
    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.BufferAttribute(pos, 3));
    const mat = new THREE.LineBasicMaterial({ color: 0xaaccee, transparent: true, opacity: 0.45 });
    const lines = new THREE.LineSegments(geo, mat);
    lines.visible = false;
    lines.frustumCulled = false;
    this.scene.add(lines);
    this.rain = { lines, speed: 26 };
  }

  // Stunt jumps: 3 wedge ramps (desert highway, park, beach dune).
  // NOTE (yellow-box bug, fixed): the Palm Court ramp used to sit at
  // (104, 88) — ON the z=91 road — so in the ?shot=city framing it visually
  // overlapped the staged sedan and looked like a yellow box sitting on the
  // car. It now lives on the park's south-east lawn, clear of every road
  // and clear of the shot camera's sightline to the sedan.
  buildStunts() {
    const spots = [
      { x: 330, z: 130, name: 'Desert Highway Jump' },
      { x: 110, z: 83, name: 'Palm Court Jump' },
      { x: 24, z: 200, name: 'Beach Dune Jump' },
    ];
    for (const s of spots) {
      const g = new THREE.Group();
      const ramp = new THREE.Mesh(
        new THREE.BoxGeometry(4, 0.5, 3),
        new THREE.MeshLambertMaterial({ color: 0xffd166 }),
      );
      ramp.rotation.z = -0.35;
      ramp.position.y = 0.4;
      ramp.castShadow = true;
      g.add(ramp);
      const ring = new THREE.Mesh(
        new THREE.TorusGeometry(2.2, 0.12, 8, 24),
        new THREE.MeshBasicMaterial({ color: 0xffd166 }),
      );
      ring.rotation.x = Math.PI / 2;
      ring.position.y = 0.15;
      g.add(ring);
      g.position.set(s.x, 0, s.z);
      this.scene.add(g);
      this.stunts.push({ ...s, done: false, mesh: g });
    }
  }

  // Collectibles: 10 gold packages hidden around the city + biomes.
  buildCollectibles() {
    const spots = [
      [156, 120], [52, 208], [208, 52], [117, 65], [65, 91],
      [182, 182], [23, 78], [104, 78], [30, 200], [330, 130],
    ];
    for (const [x, z] of spots) {
      const m = new THREE.Mesh(
        new THREE.BoxGeometry(0.7, 0.5, 0.7),
        new THREE.MeshLambertMaterial({ color: 0xffd166, emissive: 0xaa7700, emissiveIntensity: 0.7 }),
      );
      m.position.set(x, 1.1, z);
      m.castShadow = true;
      this.scene.add(m);
      this.collectibles.push({ x, z, mesh: m, taken: false });
    }
  }

  // Selected weapon GLB in Jax's right hand (Quaternius weapon models).
  // Shown only when a real weapon is selected (fists = no mesh). Re-attached
  // on every weapon change / grant so the hand always holds the right tier.
  attachPlayerWeapon() {
    if (this.playerWeapon) { this.playerWeapon.removeFromParent(); this.playerWeapon = null; }
    const key = this.state.weapon;
    if (!key || key === 'fists' || !this.player) return;
    const gltf = Q.weapons[key];
    if (!gltf) return;
    const gun = cloneQuaterniusWeapon(gltf);
    if (!gun) return;
    const attached = this.player.attachToRightHand(gun);
    this.playerWeapon = attached || null;
    if (this.playerWeapon) {
      this.playerWeapon.visible = true;
      // The gun hangs off a hand bone inside the character skeleton, whose
      // world scale is large on top of the weapon's own authored scale —
      // measure the attached gun in the world and shrink it to real size.
      this.player.group.updateWorldMatrix(true, true);
      const box = new THREE.Box3().setFromObject(this.playerWeapon);
      const len = Math.max(box.max.x - box.min.x, box.max.y - box.min.y, box.max.z - box.min.z);
      const target = (WEAPONS[key] && WEAPONS[key].len) || 0.18;
      if (len > 0.01) this.playerWeapon.scale.multiplyScalar(target / len);
    }
  }

  // Weapon wheel (Claude parity): Q toggles the radial menu, 1-5 / click picks.
  toggleWeaponWheel() {
    this.weaponWheelOpen = !this.weaponWheelOpen;
    const el = document.getElementById('weapon-wheel');
    if (el) { el.style.display = this.weaponWheelOpen ? 'flex' : 'none'; if (this.weaponWheelOpen) this.refreshWeaponWheel(); }
  }
  refreshWeaponWheel() {
    const s = this.state;
    for (const key of ['fists', 'pistol', 'smg', 'shotgun', 'rifle']) {
      const b = document.getElementById(`ww-${key}`);
      if (!b) continue;
      const owned = key === 'fists' || !!s.weaponsOwned[key];
      const w = WEAPONS[key];
      b.classList.toggle('sel', s.weapon === key);
      b.classList.toggle('locked', !owned);
      b.textContent = owned ? `${w.name}` : `${w.name} $${w.price}`;
    }
  }
  selectWeapon(key) {
    const s = this.state;
    if (!WEAPONS[key]) return;
    if (key !== 'fists' && !s.weaponsOwned[key]) { this.say(`You don't own the ${WEAPONS[key].name} — buy it at the Gun Shop (B).`, 3); return; }
    // Keep each weapon's magazine: stash the old one, restore the new one.
    s.mags[s.weapon] = s.mag;
    s.weapon = key;
    s.mag = s.mags[key] ?? (WEAPONS[key].mag || 0);
    this.reloadT = 0;
    this.attachPlayerWeapon();
    this.weaponWheelOpen = false;
    const el = document.getElementById('weapon-wheel');
    if (el) el.style.display = 'none';
    this.say(`${WEAPONS[key].name} equipped.`, 2);
  }
  // Start a magazine reload (manual via X, or auto when the mag empties).
  startReload() {
    const s = this.state, w = WEAPONS[s.weapon];
    if (!w || !w.mag || this.reloadT > 0 || s.mag >= w.mag || s.ammo <= 0) return;
    this.reloadT = w.reload;
    this.audio.play('reload');
  }
  // Gun Shop (Claude parity): B near Vega Arms buys the next unowned tier,
  // or an ammo pack once all four are owned.
  buyWeapon() {
    const s = this.state;
    const order = ['pistol', 'smg', 'shotgun', 'rifle'];
    const next = order.find((k) => !s.weaponsOwned[k]);
    if (!next) {
      if (s.money < 100) { this.say('Ammo pack costs $100.', 2); return; }
      const pack = (WEAPONS[s.weapon] && WEAPONS[s.weapon].pack) || 24;
      s.money -= 100; s.ammo += pack;
      this.say(`Ammo +${pack} ($100).`, 3);
      return;
    }
    const w = WEAPONS[next];
    if (s.money < w.price) { this.say(`${w.name} costs $${w.price} — you have $${s.money}.`, 3); return; }
    s.money -= w.price;
    s.weaponsOwned[next] = true;
    s.ammo += w.pack;
    s.mags[next] = w.mag; // new gun comes with a full magazine
    if (next === 'pistol') s.hasPistol = true;
    s.weapon = next;
    s.mag = w.mag;
    this.attachPlayerWeapon();
    this.say(`${w.name} bought for $${w.price} (+${w.pack} ammo) — equipped.`, 4);
  }
  // Camera zoom (Claude parity): mouse wheel zooms the follow camera.
  setCamZoom(d) { this.camZoom = Math.min(1.8, Math.max(0.6, (this.camZoom || 1) + d)); }
  // Respect rank (Claude parity) from jobs done.
  rankTitle() {
    const n = this.state.missionsDone;
    if (n >= 12) return RANKS[5];
    if (n >= 9) return RANKS[4];
    if (n >= 6) return RANKS[3];
    if (n >= 4) return RANKS[2];
    if (n >= 2) return RANKS[1];
    return RANKS[0];
  }

  cacheHud() {
    const $ = (id) => document.getElementById(id);
    this.hud = {
      money: $('hud-money'), wanted: $('hud-wanted'), rank: $('hud-rank'), health: $('hud-health-fill'),
      objective: $('hud-objective'), message: $('hud-message'), timer: $('hud-timer'),
      speed: $('hud-speed'), ammo: $('hud-ammo'), title: $('title-screen'),
      pause: $('pause-screen'), end: $('end-screen'), endTitle: $('end-title'), endText: $('end-text'),
      fuel: $('hud-fuel-fill'), fuelWrap: $('hud-fuel'), clock: $('hud-clock'),
      dispatch: $('hud-dispatch'), dialogue: $('dialogue-box'), dlgWho: $('dlg-who'),
      dlgText: $('dlg-text'), act: $('hud-act'), district: $('hud-district'),
      pauseInfo: $('pause-info'), phone: $('phone-panel'), prompt: $('hud-prompt'),
      hint: $('hud-hint'), next: $('hud-next'), crewBar: $('crew-bar'),
      crewPlates: $('crew-plates'), crewFix: $('crew-fix'), crewEyes: $('crew-eyes'),
      radio: $('hud-radio'), rp: $('hud-rp-fill'), locCard: $('location-card'), locName: $('location-name'), locSub: $('location-sub'),
      dealer: $('dealer-panel'), dealerList: $('dealer-list'), dealerBuyBtn: $('dealer-buy'),
      dlgPortrait: $('dlg-portrait'), dlgRole: $('dlg-role'),
      card: $('mission-card'), cardAct: $('mission-card-act'), cardTitle: $('mission-card-title'),
      cardBody: $('mission-card-body'), cardSub: $('mission-card-sub'),
    };
    this.minimap = $('minimap');
    if (this.hud.dealerBuyBtn) this.hud.dealerBuyBtn.onclick = () => this.dealerBuy();
    const dealerClose = document.getElementById('dealer-close');
    if (dealerClose) dealerClose.onclick = () => this.closeDealer();
    if (this.hud.card) this.hud.card.onclick = () => this.finishCutscene();
  }

  // ---- Dialogue (story cutscenes, simple panel) --------------------------
  // ---- Mission cutscene cards (M-I: simple, ilham revises later) --------
  // Full-screen intro/outro card over the live 3D city (no new art).
  // Intro plays a slow cinematic dolly (see updateCamera); outro is card
  // only. Auto-advances after dur, or on ENTER / tap. onDone runs once.
  showMissionCard(kind, def, onDone, extra = {}) {
    const h = this.hud;
    if (!h.card) { if (onDone) onDone(); return; }
    const isIntro = kind === 'intro';
    h.cardAct.textContent = isIntro ? def.act : 'JOB COMPLETE';
    h.cardTitle.textContent = def.name;
    h.cardBody.textContent = isIntro ? def.intro : def.onComplete;
    h.cardSub.textContent = isIntro
      ? `JOB FROM ${def.giver || 'La Rosa'} · REWARD $${def.reward}`
      : `+$${def.reward} · ${extra.district || ''} standing ${extra.standing ?? ''}%`;
    h.card.style.display = 'flex';
    this.cutscene = { t: 0, dur: isIntro ? 2.8 : 3.2, kind, onDone };
  }
  finishCutscene() {
    const cs = this.cutscene;
    if (!cs) return;
    this.cutscene = null;
    if (this.hud.card) this.hud.card.style.display = 'none';
    if (cs.onDone) cs.onDone();
  }


  startDialogue(lines, onDone) {
    if (!lines || lines.length === 0) { if (onDone) onDone(); return; }
    this.dialogue = { lines, idx: 0, onDone };
    this.prevMode = this.mode;
    this.mode = 'dialogue';
    this.renderDialogue();
  }
  renderDialogue() {
    const d = this.dialogue;
    const h = this.hud;
    if (!h.dialogue) return;
    const line = d.lines[d.idx];
    h.dialogue.style.display = 'block';
    if (h.dlgWho) h.dlgWho.textContent = line.who;
    if (h.dlgText) h.dlgText.textContent = line.text;
    if (h.dlgPortrait) {
      h.dlgPortrait.textContent = (line.who || '?')[0].toUpperCase();
      h.dlgPortrait.style.background = line.who === 'La Rosa' ? '#ff2e88' : line.who === 'Jax' ? '#ffd166' : '#2a9d8f';
      h.dlgPortrait.style.color = line.who === 'Jax' ? '#20242c' : '#fff';
    }
    if (h.dlgRole) {
      const ch = CHARACTERS.find((c) => c.name.toLowerCase().includes(line.who.toLowerCase()));
      h.dlgRole.textContent = ch ? ch.role : 'La Vega';
    }
    // Dub the line (La Rosa / Jax / others get different pitches).
  }
  advanceDialogue() {
    const d = this.dialogue;
    if (!d) return;
    d.idx += 1;
    if (d.idx >= d.lines.length) {
      const cb = d.onDone;
      this.dialogue = null;
      if (this.hud.dialogue) this.hud.dialogue.style.display = 'none';
      this.mode = this.prevMode || 'play';
      if (cb) cb();
    } else {
      this.renderDialogue();
    }
  }

  // ---- Garage / economy ---------------------------------------------------
  spawnOwnedCars() {
    // Owned cars park in the lot beside Manny's Garage.
    const spots = [
      { x: 74, z: 148, angle: Math.PI / 2 },
      { x: 74, z: 154, angle: Math.PI / 2 },
      { x: 74, z: 160, angle: Math.PI / 2 },
    ];
    this.state.owned.forEach((model, i) => {
      const spot = spots[i % spots.length];
      const spec = CAR_MODELS[model];
      const car = createCar(this.scene, model, this.rng.pick(spec.colors), spot.x, spot.z, spot.angle, { id: 500 + i, parked: true });
      car.owned = true;
      this.cars.push(car);
    });
  }

  // ---- Auto Palms dealer (M-G): browse + buy the buy-car GLBs ----------
  nearDealer() {
    const p = this.state.player;
    return Math.hypot(p.x - PLACES.dealer.x, p.z - PLACES.dealer.y) < 14;
  }
  openDealer() {
    if (this.dealerOpen || !this.nearDealer()) return;
    this.dealerOpen = true;
    this.dealerSel = 0;
    this.renderDealerList();
    if (this.hud.dealer) this.hud.dealer.style.display = 'flex';
    this.showDealerPreview(CAR_CATALOG[this.dealerSel]);
    this.audio.play('pickup');
  }
  closeDealer() {
    if (!this.dealerOpen) return;
    this.dealerOpen = false;
    if (this.hud.dealer) this.hud.dealer.style.display = 'none';
    this.hideDealerPreview();
  }
  renderDealerList() {
    const h = this.hud;
    if (!h.dealerList) return;
    const s = this.state;
    h.dealerList.innerHTML = '';
    CAR_CATALOG.forEach((key, i) => {
      const spec = CAR_MODELS[key];
      const owned = s.owned.includes(key);
      const row = document.createElement('div');
      row.className = 'dealer-row' + (i === this.dealerSel ? ' sel' : '') + (owned ? ' owned' : '') + (!owned && s.money < spec.price ? ' cant' : '');
      row.innerHTML = `<span>${spec.name}${owned ? ' · OWNED' : ''}</span><span class="p">$${spec.price} · ${Math.round(spec.top * 3.6)} km/h</span>`;
      row.onclick = () => this.dealerSelect(i);
      h.dealerList.appendChild(row);
    });
    const sel = CAR_MODELS[CAR_CATALOG[this.dealerSel]];
    if (h.dealerBuyBtn) h.dealerBuyBtn.textContent = s.owned.includes(CAR_CATALOG[this.dealerSel]) ? 'OWNED' : `BUY — $${sel.price}`;
  }
  dealerSelect(i) {
    if (!this.dealerOpen) return;
    this.dealerSel = Math.max(0, Math.min(CAR_CATALOG.length - 1, i));
    this.renderDealerList();
    this.showDealerPreview(CAR_CATALOG[this.dealerSel]);
  }
  dealerBuy() {
    if (!this.dealerOpen) return;
    const key = CAR_CATALOG[this.dealerSel];
    if (this.state.owned.includes(key)) { this.say('Already yours — find it at Manny\'s Garage.', 3); return; }
    if (this.buyCar(key)) this.renderDealerList();
  }
  showDealerPreview(model) {
    this.hideDealerPreview();
    const s = this.state, p = s.player;
    const spec = CAR_MODELS[model];
    // Park the preview on open ground 5 m in front of the player, facing
    // them — the player is standing there, so the spot is always clear.
    const dx = PLACES.dealer.x - p.x, dz = PLACES.dealer.y - p.z;
    const d = Math.hypot(dx, dz) || 1;
    const x = p.x + (dx / d) * 5, z = p.z + (dz / d) * 5;
    const angle = Math.atan2(-dz, -dx);
    const car = createCar(this.scene, model, this.rng.pick(spec.colors), x, z, angle, { id: 900, parked: true });
    this.dealerPreview = car;
  }
  hideDealerPreview() {
    if (!this.dealerPreview) return;
    this.scene.remove(this.dealerPreview.mesh);
    this.dealerPreview = null;
  }

  buyCar(model) {
    const s = this.state;
    const p = s.player;
    if (dist2(p.x, p.z, PLACES.dealer.x, PLACES.dealer.y) > 14 * 14) return false;
    if (s.owned.length >= 3) { this.say('Garage is full (3 cars max).', 3); return false; }
    const price = CAR_MODELS[model].price;
    if (s.money < price) { this.say(`Not enough cash — ${model} costs $${price}.`, 3); this.audio.play('fail'); return false; }
    s.money -= price;
    s.owned.push(model);
    this.spawnOwnedCars();
    this.audio.play('cash');
    this.say(`You bought the ${model}! It's parked at Manny's Garage.`, 4);
    // Mission 9 (Clean Wheels, array index 8) completes on purchase.
    const m = this.state.mission;
    if (m.index === 8 && MISSIONS[8].steps[m.step] && MISSIONS[8].steps[m.step].type === 'buy') {
      this.completeMission();
    }
    return true;
  }

  refuelCurrentCar() {
    const s = this.state;
    const p = s.player;
    if (p.onFoot) return false;
    const car = this.cars.find((c) => c.id === p.carId);
    if (!car) return false;
    if (dist2(car.x, car.z, PLACES.gas.x, PLACES.gas.y) > 9 * 9) return false;
    if (car.fuel > 95) { this.say('Tank is already full.', 2); return false; }
    if (s.money < FUEL_PRICE) { this.say(`Need $${FUEL_PRICE} for fuel.`, 2); return false; }
    s.money -= FUEL_PRICE;
    car.fuel = 100;
    car.nitro = 100; // nitro tank refilled too
    this.audio.play('pickup');
    this.say('Tank filled — $20. Full tank, full send.', 3);
    return true;
  }

  repairCurrentCar() {
    const s = this.state;
    const p = s.player;
    if (p.onFoot) return false;
    const car = this.cars.find((c) => c.id === p.carId);
    if (!car) return false;
    if (dist2(car.x, car.z, PLACES.garage.x, PLACES.garage.y) > 10 * 10) return false;
    if (car.health > 95) { this.say('This car is already in good shape.', 2); return false; }
    const cost = Math.round(REPAIR_BASE * (1 - car.health / 100) + 10);
    if (s.money < cost) { this.say(`Repair costs $${cost} — not enough cash.`, 3); return false; }
    s.money -= cost;
    car.health = 100;
    car.flatTire = false; // new tires at Manny's
    car.disabled = false;
    this.audio.play('pickup');
    this.say(`Manny fixed her up — $${cost}. Good as new.`, 3);
    return true;
  }

  // Character model source for a menu choice id (jax / laRosa / npcMale /
  // npcFemale). New retargeted GLBs first for the heroes, Quaternius for the
  // NPCs, CesiumMan as the last fallback. Returns { retarget } or { quat }.
  charSource(key) {
    if (key === 'maya') key = 'npcFemale'; // Maya = the green-dress female model
    if (key === 'jax') {
      if (this.newChars.jax) return { retarget: this.newChars.jax };
      if (Q.chars.jax) return { quat: Q.chars.jax };
    } else if (key === 'laRosa') {
      if (this.newChars.laRosa) return { retarget: this.newChars.laRosa };
      if (Q.chars.laRosa) return { quat: Q.chars.laRosa };
    } else if (key === 'npcMale') {
      if (Q.chars.npcMale) return { quat: Q.chars.npcMale };
      if (Q.chars.jax) return { quat: Q.chars.jax };
    } else if (key === 'npcFemale') {
      if (Q.chars.npcFemale) return { quat: Q.chars.npcFemale };
      if (Q.chars.laRosa) return { quat: Q.chars.laRosa };
    }
    return null;
  }

  buildPlayer() {
    // Player model follows the selection (Jax / Maya) — built at boot from
    // the saved choice, and REBUILT on every switch. The old bug: the
    // switcher only changed the menu card, the player stayed whatever
    // buildPlayer baked at boot (pick Maya, play as the businessman).
    const saved = (typeof localStorage !== 'undefined' && localStorage.getItem('la-vega-3d-character')) || 'jax';
    this.selectedChar = saved === 'maya' ? 'maya' : 'jax';
    const src = this.charSource(this.selectedChar);
    const h = src
      ? new Humanoid({ ...src, scale: 1 })
      : new Humanoid({ glb: true, scale: 1 });
    const start = this.protagPos[this.selectedChar] || { x: 150, z: 114, angle: Math.PI / 2 };
    h.group.position.set(start.x, 0, start.z);
    this.scene.add(h.group);
    this.player = h;
    if (this.state && this.state.player) {
      const p = this.state.player;
      p.x = start.x; p.z = start.z; p.angle = start.angle;
    }
  }

  // Rebuild the player model for the given protagonist id ('jax' | 'maya').
  rebuildPlayer(id) {
    const old = this.player;
    if (old && old.group) this.scene.remove(old.group);
    const src = this.charSource(id);
    const h = src ? new Humanoid({ ...src, scale: 1 }) : new Humanoid({ glb: true, scale: 1 });
    const p = this.state.player;
    h.group.position.set(p.x, 0, p.z);
    this.scene.add(h.group);
    this.player = h;
    this.attachPlayerWeapon();
  }

  // Switch protagonist (menu / pause / V key on foot). Each protagonist
  // keeps their own position; money + missions are shared.
  switchCharacter(id) {
    if (id !== 'jax' && id !== 'maya') return false;
    if (id === this.selectedChar) return false;
    if (this.mode !== 'play' && this.mode !== 'pause' && this.mode !== 'title') return false;
    const p = this.state.player;
    this.protagPos[this.selectedChar] = { x: p.x, z: p.z, angle: p.angle };
    if (!p.onFoot) { const car = this.cars.find((c) => c.id === p.carId); if (car) car.isPlayer = false; p.onFoot = true; p.carId = -1; }
    this.selectedChar = id;
    try { localStorage.setItem('la-vega-3d-character', id); } catch {}
    const spot = this.protagPos[id] || { x: 150, z: 114, angle: Math.PI / 2 };
    p.x = spot.x; p.z = spot.z; p.angle = spot.angle;
    this.rebuildPlayer(id);
    this.player.group.visible = true;
    this.camYaw = p.angle; this.camYawOffset = 0;
    const l = 4.2, pitch = this.camPitch ?? 0.32;
    this.camera.position.set(p.x - Math.cos(p.angle) * l * Math.cos(pitch), (p.y || 0) + 1.6 + l * Math.sin(pitch), p.z - Math.sin(p.angle) * l * Math.cos(pitch));
    this.camera.lookAt(p.x, (p.y || 0) + 1.6, p.z);
    this.say(id === 'jax' ? 'Now playing as Jax Vega.' : 'Now playing as Maya Reyes.', 3);
    this.saveGame();
    return true;
  }

  // Title-menu pedestal: the selected protagonist on a turntable at the beach.
  showMenuCharacter() {
    if (this.menuChar) { this.scene.remove(this.menuChar.group); this.menuChar = null; }
    if (this.menuPedestal) { this.scene.remove(this.menuPedestal); this.menuPedestal = null; }
    const src = this.charSource(this.selectedChar);
    const h = src ? new Humanoid({ ...src, scale: 1 }) : new Humanoid({ glb: true, scale: 1 });
    h.group.position.set(22, 0.55, 130);
    this.scene.add(h.group);
    this.menuChar = h;
    const ped = new THREE.Mesh(new THREE.CylinderGeometry(1.3, 1.5, 0.55, 20), new THREE.MeshLambertMaterial({ color: 0x2a2f3a }));
    ped.position.set(22, 0.275, 130);
    this.scene.add(ped);
    this.menuPedestal = ped;
  }
  hideMenuCharacter() {
    if (this.menuChar) this.menuChar.group.visible = false;
    if (this.menuPedestal) this.menuPedestal.visible = false;
  }

  // ---- Menu chase scene: the title backdrop is a LIVE police chase ------
  // Jax's red getaway sport car tears down road 39 (right in front of the
  // menu camera) with two LVPD cruisers on its tail, lights flashing, and
  // a police heli overhead with its spotlight on the getaway car. The
  // hero on his pedestal + the chase + the city = the trailer poster,
  // rendered live — no static image. Frozen traffic is hidden while the
  // chase runs so nothing clips through it; it comes back on PLAY.
  ensureMenuChase() {
    if (this.menuChase) return;
    const mk = (model, color, x, z) => {
      const car = createCar(this.scene, model, color, x, z, Math.PI / 2, { id: 9000 + Math.floor(Math.random() * 90) });
      car.angle = Math.PI / 2;
      car.mesh.rotation.y = carRotationY(car);
      return car;
    };
    const getaway = mk('sport', 0xd92038, 41.5, 96);
    const c1 = mk('police', 0x20242c, 36.5, 87);
    const c2 = mk('police', 0x20242c, 41.5, 80);
    // Light bars: the procedural police mesh carries its own (red/blue in
    // userData.lightBar); a GLB police car doesn't — bolt ours on instead.
    const lights = [];
    for (const c of [c1, c2]) {
      if (c.mesh.userData.lightBar) {
        lights.push(c.mesh.userData.lightBar);
      } else {
        const barMat = new THREE.MeshLambertMaterial({ color: 0x222222 });
        const bar = new THREE.Mesh(new THREE.BoxGeometry(0.7, 0.18, 1.1), barMat);
        bar.position.set(0, 1.62, 0);
        c.mesh.add(bar);
        const red = new THREE.Mesh(new THREE.BoxGeometry(0.32, 0.16, 0.5),
          new THREE.MeshLambertMaterial({ color: 0xd92038, emissive: 0xff2233, emissiveIntensity: 2 }));
        red.position.set(0, 1.72, -0.28);
        c.mesh.add(red);
        const blue = new THREE.Mesh(new THREE.BoxGeometry(0.32, 0.16, 0.5),
          new THREE.MeshLambertMaterial({ color: 0x2266ff, emissive: 0x2266ff, emissiveIntensity: 2 }));
        blue.position.set(0, 1.72, 0.28);
        c.mesh.add(blue);
        lights.push({ red, blue });
      }
    }
    // Menu heli: same recipe as the wanted heli (body, tail, glass, rotor,
    // spotlight cone + ground spot), hovering over the getaway car.
    const hg = new THREE.Group();
    const hBody = new THREE.MeshLambertMaterial({ color: 0x20242c });
    const hB = new THREE.Mesh(new THREE.BoxGeometry(3.4, 1.4, 1.8), hBody);
    hB.castShadow = true;
    hg.add(hB);
    const hTail = new THREE.Mesh(new THREE.BoxGeometry(3.2, 0.5, 0.5), hBody);
    hTail.position.set(3, 0.2, 0);
    hg.add(hTail);
    const hGlass = new THREE.Mesh(new THREE.BoxGeometry(1.2, 0.9, 1.7), new THREE.MeshLambertMaterial({ color: 0x9fd8ef }));
    hGlass.position.set(-1.4, 0.1, 0);
    hg.add(hGlass);
    const rotor = new THREE.Group();
    const blade = new THREE.Mesh(new THREE.BoxGeometry(8, 0.08, 0.5), new THREE.MeshLambertMaterial({ color: 0x111111 }));
    rotor.add(blade);
    const blade2 = blade.clone();
    blade2.rotation.y = Math.PI / 2;
    rotor.add(blade2);
    rotor.position.y = 1.1;
    hg.add(rotor);
    const cone = new THREE.Mesh(
      new THREE.ConeGeometry(7, 42, 20, 1, true),
      new THREE.MeshBasicMaterial({ color: 0xfff2b0, transparent: true, opacity: 0.14, side: THREE.DoubleSide, depthWrite: false }),
    );
    cone.position.y = -21;
    cone.rotation.x = Math.PI;
    hg.add(cone);
    const spot = new THREE.Mesh(new THREE.CircleGeometry(6.5, 20), new THREE.MeshBasicMaterial({ color: 0xfff2b0, transparent: true, opacity: 0.22, depthWrite: false }));
    spot.rotation.x = -Math.PI / 2;
    spot.position.y = -41.5;
    hg.add(spot);
    this.scene.add(hg);
    for (const c of this.cars) if (c.ai) c.mesh.visible = false; // hide frozen traffic
    this.menuChase = { cars: [getaway, c1, c2], lights, heli: { group: hg, rotor }, z0: 120 };
  }

  updateMenuChase(dt) {
    const mc = this.menuChase;
    if (!mc) return;
    mc.z0 += 16 * dt;
    if (mc.z0 > 168) mc.z0 = 96; // loop — the teleport happens off-screen (visible z window is ~115..145)
    mc.t = (mc.t || 0) + dt; // chase-local clock (game.time freezes in title mode)
    const [getaway, c1, c2] = mc.cars;
    getaway.z = mc.z0; c1.z = mc.z0 - 9; c2.z = mc.z0 - 16;
    for (const c of mc.cars) c.mesh.position.set(c.x, 0, c.z);
    // Police lights alternate red/blue, fast strobe.
    const redOn = Math.sin(mc.t * 10) > 0;
    for (const lb of mc.lights) {
      lb.red.material.emissiveIntensity = redOn ? 2.5 : 0.15;
      lb.blue.material.emissiveIntensity = redOn ? 0.15 : 2.5;
    }
    // Heli shadows the getaway car, rotor spinning, spotlight on it.
    mc.heli.group.position.set(39, 34, mc.z0 + 2);
    mc.heli.rotor.rotation.y += dt * 20;
  }

  hideMenuChase() {
    const mc = this.menuChase;
    if (!mc) return;
    for (const c of mc.cars) this.scene.remove(c.mesh);
    this.scene.remove(mc.heli.group);
    this.menuChase = null;
    for (const c of this.cars) if (c.ai) c.mesh.visible = true; // traffic back
  }

  // Modular NPC variety (no new 1.9 MB GLB — the 48 MiB gate): each ped's
  // Shirt/Suit material gets its own hue so the same model never looks twin.
  // Materials are cloned per ped (SkeletonUtils clones share materials).
  tintPedShirt(h) {
    if (!h || !h.group) return;
    h.group.traverse((o) => {
      if (!o.isMesh || !o.material || !o.material.color) return;
      const name = o.material.name || '';
      if (name !== 'Shirt' && name !== 'Suit') return;
      o.material = o.material.clone();
      o.material.color.offsetHSL(this.rng.range(-0.18, 0.18), 0, this.rng.range(-0.06, 0.06));
    });
  }

  // Random Quaternius pedestrian template (weighted: the two NPC variants
  // most often, Jax / La Rosa rarely so the heroes stay distinctive).
  // Returns null if no Quaternius character loaded.
  quatPedTemplate() {
    const pool = [];
    if (Q.chars.npcMale) pool.push(Q.chars.npcMale, Q.chars.npcMale, Q.chars.npcMale);
    if (Q.chars.npcFemale) pool.push(Q.chars.npcFemale, Q.chars.npcFemale, Q.chars.npcFemale);
    if (Q.chars.jax) pool.push(Q.chars.jax);
    if (Q.chars.laRosa) pool.push(Q.chars.laRosa);
    return pool.length ? this.rng.pick(pool) : null;
  }

  // La Rosa, standing at the club door (the talk spot), idling.
  buildLaRosa() {
    if (this.newChars.laRosa) {
      const h = new Humanoid({ retarget: this.newChars.laRosa, scale: 1 });
      h.group.position.set(PLACES.club.x, 0, PLACES.club.y + 8);
      h.group.rotation.y = Math.PI; // face the street (south).
      this.scene.add(h.group);
      this.laRosa = h;
      return;
    }
    if (!Q.chars.laRosa) return;
    const h = new Humanoid({ quat: Q.chars.laRosa, scale: 1 });
    h.group.position.set(PLACES.club.x, 0, PLACES.club.y + 8);
    h.group.rotation.y = Math.PI; // face the street (south).
    this.scene.add(h.group);
    this.laRosa = h;
  }

  buildCars() {
    // Parked cars (stealable) — PARALLEL-PARKED at the kerb, never across
    // the road and never inside a block. Rule: a car on a VERTICAL road
    // (x = R) sits at x = R ± 6.25 (middle of the 2.5 m sidewalk, clear of
    // the 8.3 m building line)
    // facing north/south (angle ±PI/2); a car on a HORIZONTAL road (z = R)
    // sits at z = R ± 6.25 facing east/west (angle 0/PI). The old spots had
    // cars parked PERPENDICULAR to their road (e.g. a sedan at (152,118)
    // facing south across the z=117 road) and one inside a block — that is
    // the "mobil parkir miring / sembarangan" ilham saw on his phone.
    const parkedSpots = [
      { model: 'sedan', x: 123.25, z: 130, angle: Math.PI / 2 },  // E kerb, road 117, facing S
      { model: 'taxi', x: 135, z: 123.25, angle: 0 },             // S kerb, road 117, facing E
      { model: 'sport', x: 175.25, z: 104, angle: -Math.PI / 2 }, // E kerb, road 169, facing N
      { model: 'sedan', x: 83, z: 149.25, angle: Math.PI },       // S kerb, road 143, facing W
      { model: 'truck', x: 58.75, z: 204, angle: Math.PI / 2 },   // W kerb, road 65, facing S
      { model: 'sedan', x: 203, z: 58.75, angle: 0 },            // S kerb, road 65, facing E
      { model: 'taxi', x: 110.75, z: 180, angle: Math.PI / 2 },   // W kerb, road 117, facing S
      { model: 'sport', x: 230, z: 110.75, angle: Math.PI },      // N kerb, road 117, facing W
      { model: 'pickup', x: 123.25, z: 180, angle: Math.PI / 2 },  // E kerb, road 117, facing S (GLB pickup)
      { model: 'suv', x: 203, z: 123.25, angle: 0 },               // S kerb, road 117, facing E
    ];
    let id = 0;
    for (const s of parkedSpots) {
      const spec = CAR_MODELS[s.model];
      const car = createCar(this.scene, s.model, this.rng.pick(spec.colors), s.x, s.z, s.angle, { id: id++, parked: true });
      this.cars.push(car);
    }
    // Traffic.
    const models = ['sedan', 'sedan', 'taxi', 'truck', 'sport', 'sedan', 'taxi', 'sedan', 'truck', 'sedan', 'sport', 'taxi', 'sedan', 'sedan', 'pickup', 'pickup', 'suv', 'pickup', 'sedan', 'taxi', 'sport', 'suv', 'sedan', 'pickup']; // 24 cars: pickup GLB joins traffic
    for (let i = 0; i < models.length; i += 1) {
      const axis = this.rng.chance(0.5) ? 'x' : 'z';
      const road = this.rng.pick(ROADS);
      const dir = this.rng.chance(0.5) ? 1 : -1;
      const lane = 2.5;
      const x = axis === 'x' ? this.rng.range(20, 250) : road + (dir > 0 ? -lane : lane);
      const z = axis === 'x' ? road + (dir > 0 ? lane : -lane) : this.rng.range(20, 250);
      const model = models[i];
      const spec = CAR_MODELS[model];
      const angle = axis === 'x' ? (dir > 0 ? 0 : Math.PI) : (dir > 0 ? Math.PI / 2 : -Math.PI / 2);
      const car = createCar(this.scene, model, this.rng.pick(spec.colors), x, z, angle, { id: id++, ai: { axis, dir, road } });
      this.cars.push(car);
      // Every traffic car has a driver: stealing one is a carjacking (the
      // driver bails out and flees). Parked cars stay empty (alarm case).
      const dh = Q.chars.npcMale
        ? new Humanoid({ quat: Q.chars.npcMale, scale: this.rng.range(0.97, 1.04) })
        : new Humanoid({ glb: true, tint: 0x8f959e, scale: this.rng.range(0.97, 1.04) });
      dh.group.visible = false; // seated inside, unrendered until the jacking
      this.tintPedShirt(dh);
      car.driver = { h: dh };
    }
    // City bus: starts at (91,221) heading north on road 91, drives the
    // serpentine loop and pauses 4 s at each shelter (see stepBus).
    const bus = createCar(this.scene, 'bus', 0x2a5a9a, 91, 221, -Math.PI / 2, { id: 9001 });
    bus.bus = true;
    bus.busWp = 0; bus.busPauseT = 0; bus.stopCd = 0; bus.speed = 0;
    this.bus = bus;
    this.cars.push(bus);
  }

  buildPeds() {
    for (let i = 0; i < 36; i += 1) { // 24 -> 36: the city felt empty (ilham 18:38 WIB)
      const road = this.rng.pick(ROADS);
      const side = this.rng.chance(0.5) ? 1 : -1;
      // Spawn ON a sidewalk: middle of the 2.5 m strip (6.25 m off the road
      // centreline), and clear of intersections — the along-coordinate must
      // not sit on a perpendicular road, or the ped spawns in traffic.
      const SW = WORLD.roadWidth / 2 + WORLD.sidewalk / 2; // 6.25
      let along = this.rng.range(20, 250);
      let guard = 0;
      while (ROADS.some((r) => Math.abs(along - r) < WORLD.roadWidth / 2 + 1) && guard++ < 8) along = this.rng.range(20, 250);
      const onXRoad = this.rng.chance(0.5);
      const x = onXRoad ? along : road + side * SW;
      const z = onXRoad ? road + side * SW : along;
      const quat = this.quatPedTemplate();
      const h = quat
        ? new Humanoid({ quat, scale: this.rng.range(0.94, 1.06) })
        : new Humanoid({
          glb: true, scale: this.rng.range(0.94, 1.06),
          tint: this.rng.pick([0xffffff, 0xffe6cc, 0xd8e4ff, 0xf2d8c0, 0xdde8d8, 0xe8d8e8]),
        });
      this.tintPedShirt(h);
      h.group.position.set(x, 0, z);
      this.scene.add(h.group);
      this.peds.push({
        h, x, z, angle: this.rng.range(0, TAU), speed: this.rng.range(1.0, 1.7),
        tx: x, tz: z, path: null, pathT: 0, flee: 0, hp: 50, dead: false, deadT: 0,
        // Smart NPC: personality drives reactions (see updatePeds).
        personality: this.rng.pick(['fearful', 'fearful', 'watcher', 'brave', 'indifferent', 'indifferent']),
        state: 'walk', stateT: 0, punchCd: 0, called: false,
        // Daily routine: most walk, some sit / chat / check their phone.
        routine: this.rng.pick(['walk', 'walk', 'walk', 'walk', 'walk', 'sit', 'talk', 'phone']),
        routineT: this.rng.range(2, 9),
        targetPed: null, // brawl target (another ped) or null = the player
      });
    }

    // ---- Beach life: 8 of the 36 peds live on the sand/sea instead of the
    // sidewalks — fishing at the water's edge, sunbathing on towels,
    // swimming, and one riding a jet ski. (Lucas P0 / ilham 16:10 WIB.)
    const BEACH_Z = [52, 78, 104, 156, 182, 208, 234]; // between road crossings
    const beachRoles = ['fish', 'fish', 'sunbathe', 'sunbathe', 'swim', 'jetski', 'sunbathe', 'swim'];
    const beachExtra = [[24, 172], [25, 188]]; // [x, z] north of the harbor quay (quay is z 105-155 — the old spots sat on concrete)
    for (let b = 0; b < beachRoles.length; b += 1) {
      const ped = this.peds[b];
      const role = beachRoles[b];
      ped.beach = role; ped.returning = false;
      const bz = b >= 6 ? beachExtra[b - 6][1] : BEACH_Z[(b * 3 + 1) % BEACH_Z.length]; // extra beach peds near Pier 9
      if (role === 'fish') {
        ped.beachX = 16.5; ped.beachZ = bz;
        ped.x = 16.5; ped.z = bz; ped.angle = Math.PI; ped.state = 'fish';
        // Fishing rod in the right hand, tip out over the water.
        const rod = new THREE.Mesh(
          new THREE.CylinderGeometry(0.025, 0.035, 2.4, 6),
          new THREE.MeshLambertMaterial({ color: 0x8a6a42 }));
        rod.position.set(0.35, 1.25, 0.15);
        rod.rotation.set(0.35, 0, -0.9);
        ped.h.group.add(rod);
        ped.rod = rod;
      } else if (role === 'sunbathe') {
        ped.beachX = this.rng.range(20, 26); ped.beachZ = bz;
        ped.x = ped.beachX; ped.z = ped.beachZ; ped.angle = this.rng.range(0, TAU); ped.state = 'sunbathe';
        // Bright beach towel under the sunbather.
        const towel = new THREE.Mesh(
          new THREE.PlaneGeometry(0.9, 1.9),
          new THREE.MeshLambertMaterial({ color: this.rng.pick([0xff2e88, 0x22d3ee, 0xffd166, 0x7dff5e]) }));
        towel.rotation.x = -Math.PI / 2; towel.rotation.z = Math.PI / 2 - ped.angle; // aligned with the body's long axis (was random -> body half off the towel)
        towel.position.set(ped.beachX, 0.04, ped.beachZ);
        this.scene.add(towel);
      } else if (role === 'swim') {
        ped.beachX = this.rng.range(8, 12); ped.beachZ = b === 7 ? 143 : this.rng.pick([70, 90, 170, 200]); // extra swimmer near Pier 9
        ped.x = ped.beachX; ped.z = ped.beachZ; ped.state = 'swim';
        ped.swimZ0 = ped.beachZ; ped.swimT = this.rng.range(0, TAU);
      } else { // jetski
        ped.beachX = 6; ped.beachZ = 130;
        ped.x = 6; ped.z = 130; ped.state = 'jetski'; ped.skiT = Math.PI / 2;
        const ski = new THREE.Group();
        const hull = new THREE.Mesh(new THREE.BoxGeometry(2.4, 0.3, 1.0), new THREE.MeshLambertMaterial({ color: 0xf2f5f7 }));
        hull.position.y = 0.15; ski.add(hull);
        const nose = new THREE.Mesh(new THREE.BoxGeometry(0.7, 0.22, 0.9), new THREE.MeshLambertMaterial({ color: 0x22d3ee }));
        nose.position.set(1.3, 0.22, 0); ski.add(nose);
        const seat = new THREE.Mesh(new THREE.BoxGeometry(0.9, 0.25, 0.6), new THREE.MeshLambertMaterial({ color: 0x20242c }));
        seat.position.set(-0.4, 0.42, 0); ski.add(seat);
        const bar = new THREE.Mesh(new THREE.CylinderGeometry(0.04, 0.04, 0.7, 6), new THREE.MeshLambertMaterial({ color: 0x20242c }));
        bar.rotation.z = Math.PI / 2; bar.position.set(0.7, 0.75, 0); ski.add(bar);
        ski.position.set(ped.x, 0.15, ped.z);
        this.scene.add(ski);
        ped.ski = ski;
      }
      ped.h.group.position.set(ped.x, 0, ped.z);
      ped.h.group.rotation.y = Math.PI / 2 - ped.angle;
    }
  }

  buildParticles() {
    const geo = new THREE.BoxGeometry(0.14, 0.14, 0.14);
    const mat = new THREE.MeshBasicMaterial({ color: 0xffd166 });
    for (let i = 0; i < 48; i += 1) {
      const m = new THREE.Mesh(geo, mat.clone());
      m.visible = false;
      this.scene.add(m);
      this.particles.push({ mesh: m, vx: 0, vy: 0, vz: 0, life: 0 });
    }
  }

  burst(x, y, z, color, n = 8, spread = 3) {
    let c = 0;
    for (const p of this.particles) {
      if (p.life > 0) continue;
      p.life = 0.5;
      p.mesh.visible = true;
      p.mesh.material.color.setHex(color);
      p.mesh.position.set(x, y, z);
      p.vx = (Math.random() - 0.5) * spread;
      p.vy = Math.random() * spread * 0.8 + 1;
      p.vz = (Math.random() - 0.5) * spread;
      if (++c >= n) break;
    }
  }

  // ------------------------------------------------------------ state
  reset() {
    this.state = this.freshState();
    this.time = 0;
    this.hideMenuChase(); // menu chase cars/heli leave with the old world
    this.rng = createRandom(this.seed);
    // Player at the ferry side of Marlin Row, near the club.
    const p = this.state.player;
    p.x = 150; p.z = 114; p.angle = Math.PI / 2; p.onFoot = true; p.carId = -1; p.health = PLAYER.health;
    this.player.group.position.set(p.x, 0, p.z);
    this.player.group.rotation.y = Math.PI / 2 - p.angle;
    this.player.group.visible = true;
    // Cars back to start: remove all and rebuild.
    for (const c of this.cars) this.scene.remove(c.mesh);
    this.cars = [];
    this.buildCars();
    // Clear cops/cruisers/rivals/heli/roadblocks.
    // Cops are {h} humanoids; cruisers are car objects — handle them
    // separately (like removePolice does). A merged loop crashes on
    // cruiser.h, which is undefined. Cruiser meshes were already removed
    // by the cars loop above, so only the arrays need clearing here.
    for (const c of this.cops) this.scene.remove(c.h.group);
    this.cops = []; this.cruisers = [];
    for (const r of this.rivals) this.scene.remove(r.h.group);
    this.rivals = [];
    if (this.heli) { this.scene.remove(this.heli.group); this.heli = null; }
    for (const rb of this.roadblocks) for (const c of rb.cars) { const i = this.cars.indexOf(c); if (i >= 0) this.cars.splice(i, 1); this.scene.remove(c.mesh); }
    this.roadblocks = [];
    this.searchMode = false;
    this.dialogue = null;
    this.shotCamMode = null;
    for (const b of this.bullets) this.scene.remove(b.line);
    this.bullets = [];
    // Peds alive again.
    for (const ped of this.peds) {
      ped.dead = false; ped.flee = 0; ped.hp = 50; ped.called = false;
      ped.targetPed = null; ped.routineT = this.rng.range(2, 9);
      ped.returning = false;
      if (ped.beach) {
        ped.state = ped.beach;
        ped.x = ped.beachX; ped.z = ped.beachZ;
        ped.h.group.position.set(ped.x, 0, ped.z);
        if (ped.beach === 'swim') ped.swimZ0 = ped.beachZ;
        if (ped.beach === 'jetski') ped.skiT = Math.PI / 2;
      } else {
        ped.state = 'walk';
      }
      ped.h.group.visible = true;
      ped.h.group.rotation.set(0, 0, 0);
    }
    // Living-world systems reset.
    this.eventT = this.rng.range(45, 75);
    for (const ev of this.eventVehicles) { const i = this.cars.indexOf(ev.car); if (i >= 0) this.cars.splice(i, 1); this.scene.remove(ev.car.mesh); }
    this.eventVehicles = [];
    this.taxiJob = null;
    for (const st of this.stunts) st.done = false;
    for (const c of this.collectibles) { c.taken = false; c.mesh.visible = true; }
    if (this.rain) this.rain.lines.visible = false;
    this.weather = 'sunny';
    this.lastHour = Math.floor(this.state.clock);
    this.closePhone(true);
    // Owned cars (garage) back to their spots.
    this.spawnOwnedCars();
    this.city.beacon.visible = false;
    this.setMessage('');
    this.updateHud(true);
  }

  setMessage(text, dur = 4) {
    this.message = { text, until: this.time + dur };
  }

  say(text, dur = 4) { this.setMessage(text, dur); }

  // Save slots (Claude parity): slot 1 is the legacy key, slots 2-3 are siblings.
  saveKeyFor(slot) { return slot === 1 ? SAVE_KEY : `${SAVE_KEY}-s${slot}`; }

  saveSlotSummary(slot) {
    try {
      const raw = localStorage.getItem(this.saveKeyFor(slot));
      if (!raw) return null;
      const d = JSON.parse(raw);
      return { money: d.money ?? 0, missionsDone: d.missionsDone ?? 0, clock: d.clock ?? 12 };
    } catch { return null; }
  }

  saveGame(slot = this.saveSlot) {
    try {
      const s = this.state;
      localStorage.setItem(this.saveKeyFor(slot), JSON.stringify({
        money: s.money, ammo: s.ammo, hasPistol: s.hasPistol,
        weaponsOwned: s.weaponsOwned, weapon: s.weapon,
        mag: s.mag, mags: s.mags,
        missionAvailable: s.missionAvailable, missionsDone: s.missionsDone,
        owned: s.owned, clock: s.clock, day: s.day || 1,
        x: s.player.x, z: s.player.z,
        standing: s.standing, businesses: s.businesses, skills: s.skills,
        collectibles: s.collectibles, respawn: s.respawn,
        crew: s.crew,
      }));
      this.saveSlot = slot;
      this.say(`Game saved (slot ${slot}).`);
      return true;
    } catch { this.say('Save failed.'); return false; }
  }

  loadGame(slot = this.saveSlot) {
    try {
      const raw = localStorage.getItem(this.saveKeyFor(slot));
      if (!raw) return false;
      const d = JSON.parse(raw);
      this.reset();
      const s = this.state;
      s.money = d.money ?? 0; s.ammo = d.ammo ?? 24; s.hasPistol = d.hasPistol ?? true;
      s.weaponsOwned = d.weaponsOwned ?? { pistol: false, smg: false, shotgun: false, rifle: false };
      s.weapon = d.weapon ?? (s.hasPistol ? 'pistol' : 'fists');
      // Old saves stored total ammo in `ammo`; split it into mag + reserve.
      s.mags = d.mags ?? {};
      s.mag = d.mag ?? Math.min(WEAPONS[s.weapon]?.mag || 0, s.ammo);
      if (d.mag === undefined) s.ammo = Math.max(0, s.ammo - s.mag);
      this.attachPlayerWeapon();
      s.missionAvailable = d.missionAvailable ?? 0; s.missionsDone = d.missionsDone ?? 0;
      s.owned = d.owned ?? []; s.clock = d.clock ?? 10.0; s.day = d.day ?? 1;
      s.player.x = d.x ?? 150; s.player.z = d.z ?? 114;
      s.standing = d.standing ?? { marina: 0, downtown: 0, neon: 0, south: 0 };
      s.businesses = d.businesses ?? { bar: false, garage: false };
      s.crew = d.crew ?? { muscle: false, driver: false, hacker: false };
      this.saveSlot = slot;
      s.skills = d.skills ?? { drive: 0, shoot: 0, stamina: 0 };
      s.collectibles = d.collectibles ?? 0;
      s.respawn = d.respawn ?? null;
      this.player.group.position.set(s.player.x, 0, s.player.z);
      this.collectibles.forEach((c, i) => { c.taken = i < s.collectibles; c.mesh.visible = !c.taken; });
      return true;
    } catch { return false; }
  }

  hasSave(slot = this.saveSlot) {
    try { return !!localStorage.getItem(this.saveKeyFor(slot)); } catch { return false; }
  }

  // ------------------------------------------------------------ helpers
  pointInSolid(x, z, r) {
    for (const b of this.city.colliders) {
      const cx = clamp(x, b.x0, b.x1), cz = clamp(z, b.z0, b.z1);
      const dx = x - cx, dz = z - cz;
      if (dx * dx + dz * dz < r * r) return b;
    }
    return null;
  }
  collideCircle(p, r) {
    const b = this.pointInSolid(p.x, p.z, r);
    if (!b) return false;
    const cx = clamp(p.x, b.x0, b.x1), cz = clamp(p.z, b.z0, b.z1);
    const dx = p.x - cx, dz = p.z - cz;
    const d2 = dx * dx + dz * dz;
    if (d2 > 0.01) {
      const d = Math.sqrt(d2);
      p.x = cx + (dx / d) * r; p.z = cz + (dz / d) * r;
    } else {
      p.z = b.z0 - r;
    }
    return true;
  }
  circleHitsSolid(x, z, r) { return !!this.pointInSolid(x, z, r); }

  // Walk (dx,dz) for dt, steering around buildings: probe 1.2 m ahead; if
  // blocked, try headings ±45°, ±90°, ±135° until one is clear. Returns
  // false when boxed in (caller waits instead of pushing through a wall).
  // Used by fleeing peds, brawlers, shelter-seekers, rivals and foot cops
  // — everyone who used to walk straight through buildings. (M-E.)
  stepWalker(w, dx, dz, speed, dt) {
    const d = Math.hypot(dx, dz) || 1;
    let hx = dx / d, hz = dz / d;
    if (this.pointInSolid(w.x + hx * 1.2, w.z + hz * 1.2, 0.4)) {
      const base = Math.atan2(hz, hx);
      let found = false;
      for (const off of [Math.PI / 4, -Math.PI / 4, Math.PI / 2, -Math.PI / 2, (3 * Math.PI) / 4, (-3 * Math.PI) / 4]) {
        const a = base + off;
        const nx = Math.cos(a), nz = Math.sin(a);
        if (!this.pointInSolid(w.x + nx * 1.2, w.z + nz * 1.2, 0.4)) { hx = nx; hz = nz; found = true; break; }
      }
      if (!found) return false;
    }
    w.angle = Math.atan2(hz, hx);
    w.x += hx * speed * dt;
    w.z += hz * speed * dt;
    return true;
  }

  // ---- Crew abilities, ACTIVE (P2.9) ------------------------------------
  // Z Swap Plates (Hacker): -1 star, 60 s cooldown. C Quick Fix (Driver):
  // full repair on the spot, 45 s. G Eyes Out (Muscle): 15 s of cover —
  // no new heat while the lookout watches, 60 s cooldown.
  useCrewAbility(kind) {
    const s = this.state;
    if (this.mode !== 'play') return;
    const now = this.time;
    this.crewCd = this.crewCd || {};
    const cdLeft = (k) => Math.max(0, Math.ceil((this.crewCd[k] || 0) - now));
    if (kind === 'plates') {
      if (!s.crew.hacker) { this.say('Hire the Hacker at the club first ($1500, press B).', 3); return; }
      if (cdLeft('plates') > 0) { this.say(`Swap Plates recharging (${cdLeft('plates')}s).`, 2); return; }
      if (s.wanted <= 0) { this.say('No heat to lose — save Swap Plates for a chase.', 2); return; }
      this.crewCd.plates = now + 60;
      s.wanted = Math.max(0, s.wanted - 1);
      s.wantedDecay = 0;
      this.say('Plates swapped — wanted down 1★. The Hacker earned their cut.', 3);
      this.audio.play('pickup');
    } else if (kind === 'fix') {
      if (!s.crew.driver) { this.say('Hire the Driver at the club first ($1500, press B).', 3); return; }
      if (cdLeft('fix') > 0) { this.say(`Quick Fix recharging (${cdLeft('fix')}s).`, 2); return; }
      const car = s.player.onFoot ? null : this.cars.find((c) => c.id === s.player.carId);
      if (!car) { this.say('Quick Fix needs a car — get in one first.', 2); return; }
      if (car.health >= 100 && !car.flatTire) { this.say('Car is already in good shape.', 2); return; }
      this.crewCd.fix = now + 45;
      car.health = 100; car.flatTire = false; car.disabled = false;
      this.say('Quick Fix — the Driver patched her up on the spot.', 3);
      this.audio.play('pickup');
    } else if (kind === 'eyes') {
      if (!s.crew.muscle) { this.say('Hire the Muscle at the club first ($1500, press B).', 3); return; }
      if (cdLeft('eyes') > 0) { this.say(`Eyes Out recharging (${cdLeft('eyes')}s).`, 2); return; }
      this.crewCd.eyes = now + 60;
      this.eyesOutUntil = now + 15;
      this.say('Eyes Out — Muscle is watching the streets. 15s of cover.', 3);
      this.audio.play('pickup');
    }
    this.updateHud(true);
  }

  addWanted(n, reason, force = false) {
    const s = this.state;
    // force = the crime is instantly witnessed (car theft: alarm + 1 star
    // the moment it happens, no waiting for a cop to notice).
    if (this.time < (this.eyesOutUntil || 0)) return; // Eyes Out: lookout covers you
    if (!force && this.time < s.wantedGainCd) return;
    s.wanted = clamp(s.wanted + n, 0, WANTED_MAX);
    s.wantedGainCd = this.time + 1.5;
    s.wantedDecay = 0;
    if (n > 0) this.say(`${reason} — wanted level ${s.wanted}★`, 3);
  }

  nearestCar(x, z, maxD, parkedOnly = false) {
    let best = null, bestD = maxD;
    for (const c of this.cars) {
      if (parkedOnly && !c.parked) continue;
      if (c.isPolice) continue;
      if (c.bus) continue; // the route bus is never stealable
      const d = Math.hypot(c.x - x, c.z - z);
      if (d < bestD) { bestD = d; best = c; }
    }
    return best;
  }

  missionMarker() {
    const s = this.state;
    if (s.mission.index < 0) {
      if (s.missionAvailable < MISSIONS.length) return PLACES.club;
      return null;
    }
    const def = MISSIONS[s.mission.index];
    const step = def.steps[s.mission.step];
    return step ? step.marker : null;
  }

  objectiveText() {
    const s = this.state;
    if (s.mission.index < 0) {
      if (s.missionAvailable >= MISSIONS.length) return 'All jobs done — La Vega is yours. Free roam!';
      return `Next job: ${MISSIONS[s.missionAvailable].name} — visit La Rosa at the club (press E)`;
    }
    const def = MISSIONS[s.mission.index];
    const step = def.steps[s.mission.step];
    return `${def.name} — ${step ? step.text : ''}`;
  }

  actText() {
    const s = this.state;
    if (s.mission.index >= 0) return MISSIONS[s.mission.index].act;
    if (s.missionAvailable < MISSIONS.length) return MISSIONS[s.missionAvailable].act;
    return 'LA VEGA — FREE ROAM';
  }

  startMission(i) {
    const s = this.state;
    const def = MISSIONS[i];
    const begin = () => {
      s.mission.index = i; s.mission.step = 0; s.mission.timer = 0; s.mission.hasPackage = false;
      this.say(def.intro, 6);
      this.audio.play('mission');
      if (i === 3) { // Shake the Tail: start hot.
        s.wanted = 2;
        this.spawnPolice();
      }
      if (i === 4) this.spawnRivals('armed');
      if (i === 2) this.spawnRivals('melee', 2, PLACES.club.x, PLACES.club.y); // club.y = z (PLACES has no .z — the old call spawned them at the warehouse)
      if (i === 5) { s.wanted = Math.max(s.wanted, 1); this.spawnPolice(); }
      this.updateHud(true);
    };
    // Story cutscene first: full-screen intro card + slow dolly, then
    // the existing dialogue, then the mission begins. Skipped in
    // screenshot mode so dossier shots stay clean. (M-I.)
    const start = () => {
      if (def.dialogueBefore && !this.shotMode) this.startDialogue(def.dialogueBefore, begin);
      else begin();
    };
    if (!this.shotMode) this.showMissionCard('intro', def, start);
    else start();
  }

  advanceStep() {
    const s = this.state;
    s.mission.step += 1;
    s.mission.timer = 0;
  }

  completeMission() {
    const s = this.state;
    const def = MISSIONS[s.mission.index];
    s.money += def.reward;
    s.missionsDone += 1;
    s.missionAvailable = Math.max(s.missionAvailable, s.mission.index + 1);
    // District standing: +8% in the district where the job was finished.
    const d = this.currentDistrict();
    s.standing[d.key] = Math.min(100, (s.standing[d.key] || 0) + 8);
    this.say(`Standing in ${d.name} up to ${s.standing[d.key]}%.`, 4);
    this.say(def.onComplete, 6);
    this.audio.play('cash');
    this.burst(s.player.x, 1.5, s.player.z, 0xffd166, 16, 5);
    if (s.mission.index === 0) { const had = s.weaponsOwned.pistol; s.hasPistol = true; s.weaponsOwned.pistol = true; s.weapon = 'pistol'; s.ammo += 24; this.attachPlayerWeapon(); this.say(`${def.onComplete} (${had ? '+24 ammo' : 'Pistol + 24 ammo'})`, 6); }
    s.mission.index = -1; s.mission.step = 0; s.mission.timer = 0;
    this.saveGame();
    const after = () => {
      if (s.missionsDone >= MISSIONS.length) {
        this.mode = 'done';
        if (this.hud.endTitle) this.hud.endTitle.textContent = 'LA VEGA IS YOURS';
        if (this.hud.endText) this.hud.endText.textContent = `All twelve jobs done. Final take: $${s.money}. Jax Vega owns this city.`;
        if (this.hud.end) this.hud.end.style.display = 'flex';
      }
    };
    // Outro card first (reward + standing), then the existing dialogue.
    // Skipped in screenshot mode. (M-I.)
    const outro = () => {
      if (def.dialogueAfter && !this.shotMode) this.startDialogue(def.dialogueAfter, after);
      else after();
    };
    if (!this.shotMode) this.showMissionCard('outro', def, outro, { district: d.name, standing: s.standing[d.key] });
    else outro();
    this.updateHud(true);
  }

  failMission(reason) {
    const s = this.state;
    if (s.mission.index < 0) return;
    this.say(`${reason} — job failed. Talk to La Rosa to try again.`, 5);
    this.audio.play('fail');
    s.mission.index = -1; s.mission.step = 0; s.mission.timer = 0;
    this.updateHud(true);
  }

  spawnRivals(mode = 'armed', count = 4, cx = PLACES.warehouse.x, cz = PLACES.warehouse.y) {
    const s = this.state;
    s.mission.rivalsLeft = count;
    const spots = mode === 'melee'
      ? [{ x: cx + 4, z: cz + 3 }, { x: cx - 4, z: cz + 4 }]
      : [
        { x: 50, z: 204 }, { x: 56, z: 212 }, { x: 46, z: 210 }, { x: 54, z: 202 },
      ];
    for (const spot of spots.slice(0, count)) {
      const h = Q.chars.npcMale
        ? new Humanoid({ quat: Q.chars.npcMale, scale: this.rng.range(0.98, 1.06) })
        : new Humanoid({ glb: true, tint: 0x8f959e, scale: this.rng.range(0.98, 1.06) });
      h.group.position.set(spot.x, 0, spot.z);
      this.scene.add(h.group);
      this.rivals.push({ h, x: spot.x, z: spot.z, angle: 0, hp: mode === 'melee' ? 70 : 100, shootCd: this.rng.range(0.5, 2), dead: false, speed01: 0, melee: mode === 'melee', punchCd: 0 });
    }
  }

  spawnPolice() {
    const s = this.state;
    const p = s.player;
    // Foot cops.
    const wantCops = Math.min(s.wanted, 6); // 5-star swarm: up to 6 foot cops
    while (this.cops.length < wantCops) {
      const a = this.rng.range(0, TAU);
      const d = this.rng.range(18, 26);
      const x = clamp(p.x + Math.cos(a) * d, 5, 255), z = clamp(p.z + Math.sin(a) * d, 5, 255);
      const h = Q.chars.npcMale
        ? new Humanoid({ quat: Q.chars.npcMale, scale: this.rng.range(0.97, 1.04) })
        : new Humanoid({ glb: true, tint: 0x9fb8e8, scale: this.rng.range(0.97, 1.04) });
      h.group.position.set(x, 0, z);
      this.scene.add(h.group);
      this.cops.push({ h, x, z, angle: 0, hp: 50, punchCd: 0, dead: false });
    }
    // Cruisers for wanted >= 2.
    const wantCruisers = s.wanted >= 2 ? Math.min(s.wanted - 1, 5) : 0; // up to 5 cruisers at 5 stars
    while (this.cruisers.length < wantCruisers) {
      const a = this.rng.range(0, TAU);
      const d = this.rng.range(22, 30);
      const x = clamp(p.x + Math.cos(a) * d, 5, 255), z = clamp(p.z + Math.sin(a) * d, 5, 255);
      const car = createCar(this.scene, 'police', 0x20242c, x, z, a, { id: 1000 + this.cruisers.length });
      car.isPolice = true;
      this.cars.push(car);
      this.cruisers.push(car);
    }
  }

  removePolice() {
    for (const c of this.cops) this.scene.remove(c.h.group);
    this.cops = [];
    for (const car of this.cruisers) {
      const i = this.cars.indexOf(car);
      if (i >= 0) this.cars.splice(i, 1);
      this.scene.remove(car.mesh);
    }
    this.cruisers = [];
    for (const rb of this.roadblocks) for (const c of rb.cars) { const i = this.cars.indexOf(c); if (i >= 0) this.cars.splice(i, 1); this.scene.remove(c.mesh); }
    this.roadblocks = [];
    for (const sp of this.spikes) this.scene.remove(sp.group);
    this.spikes = [];
    if (this.heli) { this.scene.remove(this.heli.group); this.heli = null; }
    this.searchMode = false;
  }

  // Police helicopter (wanted 4-5): circles above the player with a spotlight.
  spawnHeli() {
    if (this.heli) return;
    const g = new THREE.Group();
    const bodyMat = new THREE.MeshLambertMaterial({ color: 0x20242c });
    const body = new THREE.Mesh(new THREE.BoxGeometry(3.4, 1.4, 1.8), bodyMat);
    body.castShadow = true;
    g.add(body);
    const tail = new THREE.Mesh(new THREE.BoxGeometry(3.2, 0.5, 0.5), bodyMat);
    tail.position.set(3, 0.2, 0);
    g.add(tail);
    const glass = new THREE.Mesh(new THREE.BoxGeometry(1.2, 0.9, 1.7), new THREE.MeshLambertMaterial({ color: 0x9fd8ef }));
    glass.position.set(-1.4, 0.1, 0);
    g.add(glass);
    const rotor = new THREE.Group();
    const blade = new THREE.Mesh(new THREE.BoxGeometry(8, 0.08, 0.5), new THREE.MeshLambertMaterial({ color: 0x111111 }));
    rotor.add(blade);
    const blade2 = blade.clone();
    blade2.rotation.y = Math.PI / 2;
    rotor.add(blade2);
    rotor.position.y = 1.1;
    g.add(rotor);
    const skids = new THREE.Mesh(new THREE.BoxGeometry(2.6, 0.15, 1.6), bodyMat);
    skids.position.y = -0.9;
    g.add(skids);
    const cone = new THREE.Mesh(
      new THREE.ConeGeometry(7, 42, 20, 1, true),
      new THREE.MeshBasicMaterial({ color: 0xfff2b0, transparent: true, opacity: 0.14, side: THREE.DoubleSide, depthWrite: false }),
    );
    cone.position.y = -21;
    cone.rotation.x = Math.PI;
    g.add(cone);
    const spot = new THREE.Mesh(new THREE.CircleGeometry(6.5, 20), new THREE.MeshBasicMaterial({ color: 0xfff2b0, transparent: true, opacity: 0.22, depthWrite: false }));
    spot.rotation.x = -Math.PI / 2;
    spot.position.y = -41.5;
    g.add(spot);
    g.position.set(this.state.player.x, 42, this.state.player.z);
    this.scene.add(g);
    this.heli = { group: g, rotor, angle: 0, cone }; // cone stored: brighten it when the beam is on the player
    this.dispatch('Dispatch: Air-1 on station. Suspect lit up — all units converge.');
    this.audio.play('siren');
  }

  // Carjacking: the driver bails out of the stolen car and runs away from
  // the player (6 s at 3.4 m/s, panicked — reuses the ped flee state).
  carjackDriver(car) {
    const d = car.driver; car.driver = null;
    if (!d || !d.h) return;
    const p = this.state.player;
    const side = Math.sign(Math.cos(car.angle + Math.PI / 2) * (car.x - p.x) + Math.sin(car.angle + Math.PI / 2) * (car.z - p.z)) || 1;
    const x = car.x + Math.cos(car.angle + Math.PI / 2) * side * 2.2;
    const z = car.z + Math.sin(car.angle + Math.PI / 2) * side * 2.2;
    d.h.group.visible = true;
    d.h.group.position.set(x, 0, z);
    this.scene.add(d.h.group);
    this.peds.push({
      h: d.h, x, z, angle: Math.atan2(p.z - z, p.x - x) + Math.PI, speed: 3.4,
      tx: x, tz: z, path: null, pathT: 0, flee: 6, hp: 50, dead: false, deadT: 0,
      state: 'flee', stateT: 6, routine: 'walk', routineT: 10, personality: 'fearful', called: false,
    });
    this.say('The driver bailed out and ran!', 2);
  }

  // Spike strip (wanted 4+): laid across the road ahead of the player.
  spawnSpikeStrip() {
    const p = this.state.player;
    const aheadX = p.x + Math.cos(p.angle) * 26;
    const aheadZ = p.z + Math.sin(p.angle) * 26;
    let bestRoad = ROADS[0], bestD = 1e9, axis = 'x';
    for (const r of ROADS) {
      const d = Math.abs(aheadZ - r);
      if (d < bestD) { bestD = d; bestRoad = r; axis = 'x'; }
      const d2 = Math.abs(aheadX - r);
      if (d2 < bestD) { bestD = d2; bestRoad = r; axis = 'z'; }
    }
    const x = axis === 'x' ? clamp(aheadX, 30, 250) : bestRoad;
    const z = axis === 'x' ? bestRoad : clamp(aheadZ, 30, 250);
    const g = new THREE.Group();
    const strip = new THREE.Mesh(new THREE.BoxGeometry(axis === 'x' ? 1.2 : 10, 0.12, axis === 'x' ? 10 : 1.2), new THREE.MeshLambertMaterial({ color: 0x1a1d22 }));
    strip.position.y = 0.06; g.add(strip);
    for (let i = -4; i <= 4; i += 1) {
      const spike = new THREE.Mesh(new THREE.ConeGeometry(0.09, 0.35, 6), new THREE.MeshLambertMaterial({ color: 0x8a939e }));
      spike.position.set(axis === 'x' ? 0 : i * 1.1, 0.25, axis === 'x' ? i * 1.1 : 0);
      g.add(spike);
    }
    g.position.set(x, 0, z);
    this.scene.add(g);
    this.spikes.push({ group: g, x, z, axis, until: this.time + 30 });
    this.dispatch('Dispatch: spike strip deployed ahead of the suspect.');
    this.say('Spike strip ahead — steer around it!', 3);
  }

  // Crossing a spike strip pops the tires (top speed x0.35 until repaired).
  updateSpikes() {
    for (let i = this.spikes.length - 1; i >= 0; i -= 1) {
      const sp = this.spikes[i];
      if (this.time > sp.until) { this.scene.remove(sp.group); this.spikes.splice(i, 1); continue; }
      for (const car of this.cars) {
        if (car.flatTire || car.parked) continue;
        const across = sp.axis === 'x' ? Math.abs(car.z - sp.z) : Math.abs(car.x - sp.x);
        const along = sp.axis === 'x' ? Math.abs(car.x - sp.x) : Math.abs(car.z - sp.z);
        if (across < 1.6 && along < 5.2) {
          car.flatTire = true;
          car.health = Math.max(0, (car.health ?? 100) - 15);
          if (car.isPlayer) {
            this.audio.play('hit');
            this.say('Tires popped on the spike strip! Get to Manny\'s.', 3);
            this.trauma = Math.min(1, (this.trauma || 0) + 0.2);
          }
        }
      }
    }
  }

  // Roadblock (wanted 3+): police cars parked across the road ahead of you.
  spawnRoadblock() {
    const s = this.state;
    const p = s.player;
    const aheadX = p.x + Math.cos(p.angle) * 34;
    const aheadZ = p.z + Math.sin(p.angle) * 34;
    let bestRoad = ROADS[0], bestD = 1e9, axis = 'x';
    for (const r of ROADS) {
      const d = Math.abs(aheadZ - r);
      if (d < bestD) { bestD = d; bestRoad = r; axis = 'x'; }
      const d2 = Math.abs(aheadX - r);
      if (d2 < bestD) { bestD = d2; bestRoad = r; axis = 'z'; }
    }
    const cars = [];
    const angle = axis === 'x' ? Math.PI / 2 : 0;
    const cx = axis === 'x' ? clamp(aheadX, 30, 250) : bestRoad;
    const cz = axis === 'x' ? bestRoad : clamp(aheadZ, 30, 250);
    for (const off of [-3.2, 3.2]) {
      const x = axis === 'x' ? cx + off : cx;
      const z = axis === 'x' ? cz : cz + off;
      const car = createCar(this.scene, 'police', 0x20242c, x, z, angle, { id: 2000 + this.roadblocks.length * 2 + cars.length });
      car.isPolice = true;
      car.parked = true;
      this.cars.push(car);
      cars.push(car);
    }
    this.roadblocks.push({ cars, x: cx, z: cz });
    this.dispatch('Dispatch: roadblock set near ' + this.nearestPlaceName(cx, cz) + '. Suspect boxed in.');
  }

  // ------------------------------------------------------------ combat
  shoot(fromX, fromZ, fromAngle, byPlayer, dmg = 50, range = 45, spread = 1) {
    const s = this.state;
    const dirX = Math.cos(fromAngle), dirZ = Math.sin(fromAngle);
    let best = null, bestT = range;
    const targets = [];
    if (byPlayer) {
      for (const r of this.rivals) if (!r.dead) targets.push({ x: r.x, z: r.z, ref: r, kind: 'rival' });
      for (const c of this.cops) if (!c.dead) targets.push({ x: c.x, z: c.z, ref: c, kind: 'cop' });
      for (const ped of this.peds) if (!ped.dead) targets.push({ x: ped.x, z: ped.z, ref: ped, kind: 'ped' });
    } else {
      targets.push({ x: s.player.x, z: s.player.z, ref: null, kind: 'player' });
    }
    for (const t of targets) {
      const dx = t.x - fromX, dz = t.z - fromZ;
      const along = dx * dirX + dz * dirZ;
      if (along < 0 || along > range) continue;
      // Hit cone widens with distance and with spread (hipfire/bloom wide,
      // ADS tight — Point Blank style).
      const perp = Math.abs(-dx * dirZ + dz * dirX);
      if (perp > (1.2 + along * 0.02) * spread) continue;
      if (along < bestT) { bestT = along; best = t; }
    }
    const endX = fromX + dirX * bestT, endZ = fromZ + dirZ * bestT;
    // Tracer line.
    const geo = new THREE.BufferGeometry().setFromPoints([
      new THREE.Vector3(fromX, 1.35, fromZ), new THREE.Vector3(endX, 1.2, endZ),
    ]);
    const line = new THREE.Line(geo, new THREE.LineBasicMaterial({ color: 0xffe9a8, transparent: true, opacity: 0.9 }));
    this.scene.add(line);
    this.bullets.push({ line, life: 0.08 });
    this.audio.play('shoot');
    if (byPlayer) { s.stats.shots += 1; this.hearShot(fromX, fromZ); }
    if (best) {
      this.burst(endX, 1.2, endZ, 0xff5544, 6, 2.5);
      if (best.kind === 'player') {
        this.hurtPlayer(9);
      } else if (best.kind === 'rival') {
        best.ref.hp -= dmg + s.skills.shoot * 0.2; // shoot skill adds damage
        if (byPlayer) s.skills.shoot = Math.min(100, s.skills.shoot + 2);
        if (best.ref.hp <= 0 && !best.ref.dead) {
          this.startDeathFigure(best.ref, endX - s.player.x, endZ - s.player.z, 50, 150);
          s.mission.rivalsLeft -= 1;
          this.say(`Vulture down — ${Math.max(0, s.mission.rivalsLeft)} left.`, 2);
        }
        this.addWanted(1, 'Shooting in the street');
      } else if (best.kind === 'cop') {
        best.ref.hp -= 50;
        if (best.ref.hp <= 0 && !best.ref.dead) {
          this.startDeathFigure(best.ref, endX - s.player.x, endZ - s.player.z, best.kind === 'cop' ? 50 : 5, best.kind === 'cop' ? 150 : 50);
        }
        this.addWanted(1, 'Shooting a cop');
      } else if (best.kind === 'ped') {
        best.ref.hp -= 50;
        if (best.ref.hp <= 0 && !best.ref.dead) {
          this.startDeathFigure(best.ref, endX - s.player.x, endZ - s.player.z, best.kind === 'cop' ? 50 : 5, best.kind === 'cop' ? 150 : 50);
        }
        this.addWanted(1, 'Hitting a pedestrian');
      }
    }
  }

  hurtPlayer(dmg) {
    const s = this.state;
    const p = s.player;
    if (this.time - p.lastHurt < 0.4) return;
    p.lastHurt = this.time;
    s.health -= dmg;
    this.trauma = Math.min(1, this.trauma + 0.18); // tamed (was 0.35)
    this.audio.play('hit');
    if (s.health <= 0) {
      this.wasted();
    }
    this.updateHud(true);
  }

  wasted() {
    const s = this.state;
    s.money = Math.max(0, s.money - 150);
    this.mode = 'wasted';
    this.audio.play('busted');
    if (this.hud.endTitle) this.hud.endTitle.textContent = 'WASTED';
    if (this.hud.endText) this.hud.endText.textContent = `You wake up at La Vega General, $150 lighter. The city waits — press Enter to keep playing.`;
    if (this.hud.end) this.hud.end.style.display = 'flex';
  }

  busted() {
    const s = this.state;
    s.money = Math.max(0, s.money - 100);
    s.wanted = 0;
    this.removePolice();
    this.mode = 'busted';
    this.audio.play('busted');
    if (this.hud.endTitle) this.hud.endTitle.textContent = 'BUSTED';
    if (this.hud.endText) this.hud.endText.textContent = `The cops haul you in. $100 bail. You wake up at La Vega General — press Enter to keep playing.`;
    if (this.hud.end) this.hud.end.style.display = 'flex';
  }

  respawn() {
    const s = this.state;
    s.health = PLAYER.health;
    const rp = s.respawn || { x: PLACES.hospital.x, z: PLACES.hospital.y + 12 };
    s.player.x = rp.x; s.player.z = rp.z;
    s.player.angle = Math.PI / 2;
    if (!s.player.onFoot && s.player.carId >= 0) {
      const car = this.cars.find((c) => c.id === s.player.carId);
      if (car) car.isPlayer = false;
      s.player.carId = -1;
    }
    s.player.onFoot = true;
    this.player.group.visible = true;
    this.player.group.position.set(s.player.x, 0, s.player.z);
    if (this.hud.end) this.hud.end.style.display = 'none';
    this.mode = 'play';
    this.updateHud(true);
  }

  // ------------------------------------------------------------ update
  update(dt, keys) {
    this.time += dt;
    if (this.mode !== 'play' && this.mode !== 'title') {
      // Still animate the world behind overlays.
      this.updateAmbient(dt);
      return;
    }
    const s = this.state;
    const p = s.player;
    let input = this.autoInput || keys;
    // --- mission cutscene card: player frozen, world keeps living,
    // camera does the slow dolly on intro. Any action / ENTER skips.
    if (this.cutscene) {
      const cs = this.cutscene;
      cs.t += dt;
      if (input.enter || input.shoot || input.punch || cs.t >= cs.dur) this.finishCutscene();
      input = {};
    }
    // Dealer panel open: freeze the player (world keeps living); the panel
    // keys are handled in main.js. (M-G.)
    if (this.dealerOpen) input = {};
    if (this.mode === 'phone') input = {}; // phoning: stand still, hold the phone up


    // --- mission timer
    if (s.mission.index >= 0) {
      const def = MISSIONS[s.mission.index];
      const step = def.steps[s.mission.step];
      if (step && step.time) {
        s.mission.timer += dt;
        if (s.mission.timer > step.time) this.failMission('Out of time');
      }
    }

    // --- player
    if (p.onFoot) this.updateOnFoot(dt, input);
    else this.updateDriving(dt, input);
    this.clampToIsland(); // endless island: never walk/drive into the deep sea or the void

    // --- world systems
    this.updateTraffic(dt);
    this.updatePeds(dt);
    for (const f of [...this.cops, ...this.rivals]) if (f.dead) this.updateDeadFigure(f, dt); // dead cops/rivals keep falling/lying too
    if (this.laRosa) this.laRosa.animate(dt, 0); // La Rosa idles at the club.
    if (this.playerWeapon) this.playerWeapon.visible = this.state.weapon !== 'fists';
    this.updatePolice(dt);
    this.updateRivals(dt);
    this.updateBullets(dt);
    this.updateParticles(dt);
    this.updateLoot(dt); // cash drops: bob, expire after 30 s, auto-collect < 2.5 m
    this.updateSpikes(); // spike strips pop tires
    this.updateMissions(dt);
    this.updateWanted(dt);
    this.updateDayNight(dt);
    this.updateAmbient(dt);
    this.updateRandomEvents(dt);
    this.updateEvents(dt);
    this.updateRain(dt);
    this.updateTaxi(dt);
    this.updateCollectibles(dt);
    this.updateStunts(dt);
    this.updateAmbience(dt);
    this.updateIntensity();
    this.updateCamera(dt);
    this.updateBeacon();
    this.updateHud();
    // Engine sound.
    const car = p.onFoot ? null : this.cars.find((c) => c.id === p.carId);
    this.audio.setEngine(car ? Math.abs(car.speed) / CAR_MODELS[car.model].top : 0, !!car);
    // Siren.
    if (this.cruisers.length && this.time - this.sirenAt > 2.2) {
      this.sirenAt = this.time;
      this.audio.play('siren');
    }
  }

  updateOnFoot(dt, input) {
    const s = this.state;
    const p = s.player;
    // Camera-relative movement.
    let mx = 0, mz = 0;
    const fwdX = Math.cos(this.camYaw), fwdZ = Math.sin(this.camYaw);
    const rightX = -fwdZ, rightZ = fwdX;
    if (input.up) { mx += fwdX; mz += fwdZ; }
    if (input.down) { mx -= fwdX; mz -= fwdZ; }
    if (input.left) { mx -= rightX; mz -= rightZ; }
    if (input.right) { mx += rightX; mz += rightZ; }
    const moving = mx !== 0 || mz !== 0;
    // ADS slows the walk (Point Blank: you aim, you don't sprint).
    const adsSlow = this.ads > 0.3 ? 0.55 : 1;
    const speed = (input.run ? PLAYER.run : PLAYER.walk) * (1 + s.skills.stamina * 0.001) * adsSlow;
    if (moving) {
      const len = Math.hypot(mx, mz);
      mx /= len; mz /= len;
      const targetAngle = Math.atan2(mz, mx);
      p.angle += clamp(angDiff(p.angle, targetAngle), -8 * dt, 8 * dt);
      p.x += mx * speed * dt;
      p.z += mz * speed * dt;
      p.speed01 = input.run ? 1 : 0.55;
      this.lastPlayerSpeed = speed;
      if (input.run) s.skills.stamina = Math.min(100, s.skills.stamina + 0.05 * dt * 60 * 0.016);
      this.collideCircle(p, PLAYER.radius);
      p.x = clamp(p.x, 2, WORLD.size - 2);
      p.z = clamp(p.z, 2, WORLD.size - 2);
      // Claude parity: NO auto-follow on foot — the camera only moves when
      // the player drags it. (The old 1.2 rad/s swing behind the player is
      // what made the camera feel "liar" on the phone.)
    } else {
      p.speed01 = 0;
    }
    // Jump (Space, Claude parity) — Bully feel, tuned from our own clips:
    // 0.12 s crouch anticipation (squash), stretch while rising, squash
    // on landing. (M-J.) No new animation system, just squash & stretch.
    if (input.jump && p.grounded && !p.jumpAnt) p.jumpAnt = 0.12;
    if (p.jumpAnt > 0) {
      p.jumpAnt -= dt;
      this.player.setSquash(0.88);
      if (p.jumpAnt <= 0) { p.jumpAnt = 0; p.vy = 6.5; p.grounded = false; this.player.setSquash(1.06); }
    } else if (!p.grounded) {
      p.vy -= 22 * dt; p.y += p.vy * dt;
      if (p.y <= 0) { p.y = 0; p.vy = 0; p.grounded = true; p.landT = 0.12; this.player.setSquash(0.9); }
      else this.player.setSquash(p.vy > 0 ? 1.06 : 1.0);
    } else if (p.landT > 0) {
      p.landT -= dt;
      this.player.setSquash(0.9);
      if (p.landT <= 0) { p.landT = 0; this.player.setSquash(1); }
    } else this.player.setSquash(1);
    // Punch.
    p.punchCd -= dt;
    if (input.punch && p.punchCd <= 0) {
      p.punchCd = 0.45;
      this.player.punch();
      this.audio.play('punch');
      const hx = p.x + Math.cos(p.angle) * 1.2, hz = p.z + Math.sin(p.angle) * 1.2;
      const pd = PLAYER.punchDamage * (s.crew.muscle ? 2 : 1); // Muscle passive
      let hitSomething = false;
      for (const ped of this.peds) {
        if (ped.dead) continue;
        if (dist2(hx, hz, ped.x, ped.z) < PLAYER.punchRange * PLAYER.punchRange) {
          ped.hp -= pd;
          ped.flee = 4;
          this.burst(ped.x, 1.2, ped.z, 0xffffff, 5, 2);
          if (ped.hp <= 0) this.startDeathFigure(ped, ped.x - p.x, ped.z - p.z, 5, 50);
          this.addWanted(1, 'Assaulting a pedestrian');
          hitSomething = true;
        }
      }
      for (const c of this.cops) {
        if (c.dead) continue;
        if (dist2(hx, hz, c.x, c.z) < PLAYER.punchRange * PLAYER.punchRange) {
          c.hp -= pd;
          this.burst(c.x, 1.2, c.z, 0xffffff, 5, 2);
          if (c.hp <= 0) this.startDeathFigure(c, c.x - p.x, c.z - p.z, 50, 150);
          this.addWanted(1, 'Hitting a cop');
          hitSomething = true;
        }
      }
      for (const r of this.rivals) {
        if (r.dead) continue;
        if (dist2(hx, hz, r.x, r.z) < PLAYER.punchRange * PLAYER.punchRange) {
          r.hp -= pd;
          this.burst(r.x, 1.2, r.z, 0xffffff, 5, 2);
          if (r.hp <= 0) { this.startDeathFigure(r, r.x - p.x, r.z - p.z, 50, 150); s.mission.rivalsLeft -= 1; }
          hitSomething = true;
        }
      }
      if (!hitSomething) this.burst(hx, 1.1, hz, 0xcccccc, 2, 1);
    }
    // Shoot — ADS + magazine + reload + recoil (Point Blank style).
    const w = WEAPONS[s.weapon] || WEAPONS.fists;
    const hasGun = s.weapon !== 'fists';
    // ADS: right mouse / AIM button, on foot with a gun. Lerps 0..1.
    const wantAds = !!input.aim && p.onFoot && hasGun && this.reloadT <= 0;
    this.ads = Math.max(0, Math.min(1, (this.ads || 0) + (wantAds ? dt * 6 : -dt * 6)));
    this.aimPulse = Math.max(0, (this.aimPulse || 0) - dt);
    this.player.aiming = this.ads > 0.3 || this.aimPulse > 0;
    // Spread bloom from firing; recovers over ~1 s.
    this.bloom = Math.max(0, (this.bloom || 0) - dt * 1.2);
    // Reload timer: when it ends, move rounds from reserve into the mag.
    if (this.reloadT > 0) {
      this.reloadT -= dt;
      if (this.reloadT <= 0) {
        const need = w.mag - s.mag, take = Math.min(need, s.ammo);
        s.mag += take; s.ammo -= take;
      }
    }
    p.shootCd -= dt;
    if (input.shoot && p.shootCd <= 0 && this.reloadT <= 0) {
      if (s.weapon === 'fists') { this.say('Fists only — press Tab for the weapon wheel.', 2); p.shootCd = 0.5; }
      else if (s.mag <= 0) {
        if (s.ammo > 0) this.startReload(); // auto-reload on empty mag
        else { this.say('Out of ammo — buy more at the Gun Shop (B).', 2); p.shootCd = 0.5; }
      }
      else {
        p.shootCd = w.interval;
        s.mag -= 1;
        this.aimPulse = 0.22; // gun stays raised briefly after each shot
        this.muzzleUntil = this.time + 0.08;
        // Recoil: camera kick + crosshair bloom (shotgun kicks hardest).
        this.bloom = Math.min(1, (this.bloom || 0) + (s.weapon === 'shotgun' ? 0.6 : 0.3));
        this.trauma = Math.min(1, this.trauma + (s.weapon === 'shotgun' ? 0.08 : 0.04)); // tamed (was 0.22/0.12)
        // Spread: shotgun wide, ADS tight, bloom opens it back up.
        const spread = (s.weapon === 'shotgun' ? 1.7 : 1) * (1 - 0.55 * this.ads) * (1 + 0.7 * this.bloom);
        this.shoot(p.x, p.z, p.angle, true, w.damage, w.range, spread);
        if (s.mag <= 0 && s.ammo > 0) this.startReload();
      }
    }
    // Manual reload: X on foot with a gun (R is the radio).
    if (input.reload && hasGun && p.onFoot && this.reloadT <= 0 && s.mag < w.mag && s.ammo > 0) {
      this.startReload();
    }
    input.reload = false;
    // Enter / exit car, talk to La Rosa.
    // Priority: the club (start a job) and the dealer (shop) beat grabbing
    // a passing car — both sit right next to busy roads.
    if (input.enter) {
      input.enter = false;
      // The club's front door (south side) is the talk spot, not the building centre.
      if (dist2(p.x, p.z, PLACES.club.x, PLACES.club.y + 8) < 10 * 10) {
        if (s.mission.index < 0 && s.missionAvailable < MISSIONS.length) {
          this.startMission(s.missionAvailable);
        } else if (s.mission.index >= 0) {
          this.say('Job in progress — check the objective.', 2);
        } else {
          this.say('La Rosa: "You did it, Jax. The city is yours."', 3);
        }
      } else if (dist2(p.x, p.z, PLACES.dealer.x, PLACES.dealer.y) < 14 * 14) {
        this.openDealer(); // Auto Palms catalog (M-G)
      } else {
        const car = this.nearestCar(p.x, p.z, 4);
        if (car) {
          p.onFoot = false; p.carId = car.id; car.isPlayer = true; car.parked = false;
          this.player.group.visible = false;
          this.audio.play('enter');
          // Stealing a parked car raises the heat (only the first time per car).
          // Your own garage cars are free — no heat.
          if (!car.owned && !car.stolenOnce) {
            car.stolenOnce = true;
            s.stats.stolen += 1;
            this.addWanted(1, 'Car theft', true); // INSTANT 1 star — no cooldown
            if (car.driver) this.carjackDriver(car); // occupied: driver flees
            else this.audio.play('alarm'); // empty parked car: alarm screams
            // Witnesses react to the theft: fearful flee, watchers call it in.
            for (const ped of this.peds) {
              if (ped.dead) continue;
              const d = Math.hypot(ped.x - p.x, ped.z - p.z);
              if (d < 16) this.pedReact(ped, 'theft', d);
            }
          }
          // Taxi: sometimes a fare hops in when you take a cab.
          if (car.model === 'taxi' && !this.taxiJob && this.rng.chance(0.5)) this.startTaxiJob();
          if (car.fuel < 20) this.say(`Careful — fuel is low (${Math.round(car.fuel)}%). Petro Vega can fill you up.`, 3);
          else if (car.health < 40) this.say('This car is beat up — Manny\'s Garage can fix it.', 3);
          else this.say(`${car.model[0].toUpperCase() + car.model.slice(1)} — drive with WASD.`, 2);
        }
      }
    }
    // Pose.
    this.player.group.position.set(p.x, p.y || 0, p.z);
    this.player.group.rotation.y = Math.PI / 2 - p.angle;
    this.player.animate(dt, p.speed01);
    this.player.updatePunch(dt);
  }

  updateDriving(dt, input) {
    const s = this.state;
    const p = s.player;
    const car = this.cars.find((c) => c.id === p.carId);
    if (!car) { p.onFoot = true; p.carId = -1; this.player.group.visible = true; return; }
    // Simulator: fuel drains with throttle; empty tank stalls the car.
    if (car.fuel > 0 && input.up) car.fuel = Math.max(0, car.fuel - dt * (0.25 + Math.abs(car.speed) * 0.012));
    if (car.fuel <= 0 && car.speed > 0) car.speed = Math.max(0, car.speed - 12 * dt);
    // Nitro (N): boost while the tank lasts; drive skill raises top speed.
    car.topBonus = 1 + s.skills.drive * 0.001 + (s.crew.driver ? 0.08 : 0); // Driver passive: +8% top speed
    car.boost = !!(input.nitro && car.nitro > 0 && !car.disabled);
    if (car.boost) {
      car.nitro = Math.max(0, car.nitro - 30 * dt);
      if (Math.random() < dt * 20) this.burst(car.x - Math.cos(car.angle) * 2, 0.8, car.z - Math.sin(car.angle) * 2, 0x66ccff, 1, 1);
    }
    if (Math.abs(car.speed) > 20) s.skills.drive = Math.min(100, s.skills.drive + 0.05 * dt * 60 * 0.016);
    const drive = {
      throttle: !!input.up && car.fuel > 0 && !car.disabled, brake: !!input.down || !!input.jump, // Space = handbrake in a car (Claude)
      steer: (input.left ? -1 : 0) + (input.right ? 1 : 0),
    };
    stepCar(car, drive, dt, (x, z, r) => this.circleHitsSolid(x, z, r));
    // --- Drift + near-miss scoring (P2.12): real money, HUD toast. ------
    const spd = Math.abs(car.speed);
    const drifting = spd > 14 && drive.steer !== 0; // hard steering at speed = drift (handbrake is NOT required — it bleeds speed too fast to hold a 3 s chain)
    if (drifting) {
      this.driftT = (this.driftT || 0) + dt;
      if (Math.random() < dt * 6) this.burst(car.x - Math.cos(car.angle) * 2, 0.4, car.z - Math.sin(car.angle) * 2, 0xcccccc, 1, 1);
      if (this.driftT >= 3) {
        this.driftT = 0;
        this.driftChain = (this.driftChain || 0) + 1;
        s.money += 150;
        this.say(`DRIFT x${this.driftChain} +$150`, 2);
        this.audio.play('cash');
        this.updateHud(true);
      }
    } else { this.driftT = 0; this.driftChain = 0; }
    this.nearMissCd = this.nearMissCd || {};
    for (const o of this.cars) {
      if (o === car || !o.ai || o.parked) continue;
      const d = Math.hypot(o.x - car.x, o.z - car.z);
      const closing = Math.abs(car.speed - o.speed);
      if (d > 3.2 && d < 4.8 && closing > 8 && (this.time - (this.nearMissCd[o.id] || 0)) > 3) {
        this.nearMissCd[o.id] = this.time;
        s.money += 250;
        this.say('NEAR MISS +$250', 2);
        this.audio.play('cash');
        this.updateHud(true);
      }
    }
    // Damage model: hard hits hurt the car; at 0 health it is disabled.
    if (car.hitFlag) {
      car.hitFlag = false;
      const dmg = 4 + Math.abs(car.speed) * 0.25;
      car.health = Math.max(0, car.health - dmg);
      this.trauma = Math.min(1, this.trauma + 0.12); // tamed (was 0.25)
      this.audio.play('hit');
      this.burst(car.x, 1, car.z, 0xffaa33, 5, 2);
      if (car.health <= 0 && !car.disabled) {
        car.disabled = true;
        this.say('The car is wrecked! Get it to Manny\'s Garage for repairs.', 4);
      }
    }
    if (car.disabled) car.speed = 0;
    // Smoke when badly damaged.
    if (car.health < 40 && car.health > 0 && Math.random() < dt * 8) {
      this.burst(car.x, 1.4, car.z, 0x888888, 1, 1);
    }
    p.x = car.x; p.z = car.z; p.angle = car.angle;
    // Drive-by (contekan P2.13): shoot from the car — same magazine and
    // costs as on foot, wider spread, no ADS. F / click / FIRE all work.
    {
      const w = WEAPONS[s.weapon];
      const hasGun = s.weapon !== 'fists';
      p.shootCd -= dt;
      if (input.shoot && p.shootCd <= 0 && this.reloadT <= 0) {
        if (!hasGun) { this.say('Fists only — press Tab for the weapon wheel.', 2); p.shootCd = 0.5; }
        else if (s.mag <= 0) {
          if (s.ammo > 0) this.startReload();
          else { this.say('Out of ammo — buy more at the Gun Shop (B).', 2); p.shootCd = 0.5; }
        } else {
          p.shootCd = w.interval;
          s.mag -= 1;
          this.muzzleUntil = this.time + 0.08;
          this.bloom = Math.min(1, (this.bloom || 0) + 0.25);
          this.trauma = Math.min(1, (this.trauma || 0) + 0.04); // tamed (was 0.08)
          const spread = (s.weapon === 'shotgun' ? 1.7 : 1) * 1.3 * (1 + 0.7 * this.bloom);
          this.shoot(p.x, p.z, p.angle, true, w.damage, w.range, spread);
          if (s.mag <= 0 && s.ammo > 0) this.startReload();
        }
      }
      if (input.reload && hasGun && this.reloadT <= 0 && s.mag < w.mag && s.ammo > 0) this.startReload();
    }
    this.lastPlayerSpeed = car.speed;
    // Claude parity (Wg): in-car auto-follow is a gentle exponential lerp
    // toward the car's heading, ONLY after 2 s without a drag AND while
    // moving faster than 3 m/s. (Old code: constant 1.6 rad/s slew after
    // 0.8 s — that yank is what made the camera feel "liar".)
    if (this.camIdleT > 2 && Math.abs(car.speed) > 3) {
      this.camYaw += angDiff(this.camYaw, car.angle) * Math.min(1, dt * 2.2);
    }
    // E: context action first (fuel / repair), otherwise exit the car.
    if (input.enter) {
      input.enter = false;
      if (this.refuelCurrentCar()) return;
      if (this.repairCurrentCar()) return;
      p.onFoot = true; p.carId = -1; car.isPlayer = false;
      p.x = car.x - Math.sin(car.angle) * 2.2;
      p.z = car.z + Math.cos(car.angle) * 2.2;
      p.angle = car.angle;
      this.player.group.visible = true;
      this.player.group.position.set(p.x, 0, p.z);
      this.audio.play('enter');
    }
    // Ram peds / cops.
    for (const ped of this.peds) {
      if (ped.dead) continue;
      if (dist2(p.x, p.z, ped.x, ped.z) < 2.2 * 2.2 && Math.abs(car.speed) > 4) {
        ped.hp = 0; this.startDeathFigure(ped, Math.cos(car.angle) * car.speed * 0.5, Math.sin(car.angle) * car.speed * 0.5, 5, 50);
        this.burst(ped.x, 1, ped.z, 0xff5544, 8, 3);
        this.addWanted(1, 'Running over a pedestrian');
      }
    }
    for (const c of this.cops) {
      if (c.dead) continue;
      if (dist2(p.x, p.z, c.x, c.z) < 2.4 * 2.4 && Math.abs(car.speed) > 4) {
        c.hp = 0; this.startDeathFigure(c, Math.cos(car.angle) * car.speed * 0.5, Math.sin(car.angle) * car.speed * 0.5, 50, 150);
        this.burst(c.x, 1, c.z, 0xff5544, 8, 3);
        this.addWanted(1, 'Running over a cop');
      }
    }
  }

  updateTraffic(dt) {
    const raining = this.weather === 'rain' || this.weather === 'storm';
    for (const car of this.cars) {
      car.slip = raining;
      if (car.isPlayer || car.parked || car.isPolice) continue;
      if (car.ai) {
        // Safety net: a car that somehow left the road grid (corner clip,
        // physics hiccup) gets put back on a road. If the player is far
        // away it respawns on a random road; if close, it U-turns instead
        // so nothing visibly pops.
        if (car.x < 28 || car.x > 260 || car.z < 28 || car.z > 260) {
          const dPlayer = Math.hypot(car.x - this.state.player.x, car.z - this.state.player.z);
          if (dPlayer > 60) {
            const axis = this.rng.chance(0.5) ? 'x' : 'z';
            const road = this.rng.pick(ROADS);
            const dir = this.rng.chance(0.5) ? 1 : -1;
            const lane = 2.5;
            car.ai.axis = axis; car.ai.road = road; car.ai.dir = dir;
            car.x = axis === 'x' ? this.rng.range(40, 246) : road + (dir > 0 ? -lane : lane);
            car.z = axis === 'x' ? road + (dir > 0 ? lane : -lane) : this.rng.range(40, 246);
            car.angle = axis === 'x' ? (dir > 0 ? 0 : Math.PI) : (dir > 0 ? Math.PI / 2 : -Math.PI / 2);
            car.speed = 0;
          } else {
            car.ai.dir *= -1;
          }
        }
        stepTrafficCar(car, dt, (x, z, r) => this.circleHitsSolid(x, z, r), this.rng, this.cars, this.time, this.peds);
      }
    }
    // Honk: a traffic car stuck behind the player's car leans on the horn.
    const pc = this.state.player.onFoot ? null : this.cars.find((c) => c.id === this.state.player.carId);
    if (pc) {
      for (const car of this.cars) {
        if (!car.ai || car === pc) continue;
        const dx = pc.x - car.x, dz = pc.z - car.z;
        const ahead = dx * Math.cos(car.angle) + dz * Math.sin(car.angle);
        const side = Math.abs(-dx * Math.sin(car.angle) + dz * Math.cos(car.angle));
        if (ahead > 0 && ahead < 9 && side < 2.4 && car.speed < 1) {
          car.honkT = (car.honkT || 0) + dt;
          if (car.honkT > 2.5) {
            car.honkT = 0;
            this.audio.play('honk');
            this.say('HONK! Move it!', 1.5);
          }
        } else {
          car.honkT = 0;
        }
      }
    }
    this.stepBus(dt);
    // --- Car-vs-car collision: no pass-through. Circle per car (radius from
    // length); positional separation + speed damping + COND damage + bump.
    const allCars = this.cars;
    for (let i = 0; i < allCars.length; i += 1) {
      for (let j = i + 1; j < allCars.length; j += 1) {
        const a = allCars[i], b = allCars[j];
        if (a.parked && b.parked) continue;
        const ra = ((CAR_MODELS[a.model] && CAR_MODELS[a.model].len) || 4.6) * 0.42 + 0.9;
        const rb = ((CAR_MODELS[b.model] && CAR_MODELS[b.model].len) || 4.6) * 0.42 + 0.9;
        const dx = b.x - a.x, dz = b.z - a.z;
        const d = Math.hypot(dx, dz) || 0.001;
        const min = ra + rb;
        if (d >= min) continue;
        const nx = dx / d, nz = dz / d, overlap = min - d;
        const moveA = !a.parked, moveB = !b.parked;
        const tot = (moveA ? 1 : 0) + (moveB ? 1 : 0) || 1;
        if (moveA) { a.x -= nx * overlap / tot; a.z -= nz * overlap / tot; }
        if (moveB) { b.x += nx * overlap / tot; b.z += nz * overlap / tot; }
        a.mesh.position.set(a.x, 0, a.z); b.mesh.position.set(b.x, 0, b.z);
        const rel = Math.abs(a.speed - b.speed) + Math.abs(a.speed) * 0.2 + Math.abs(b.speed) * 0.2;
        if (rel > 2) {
          const dmg = Math.min(12, Math.max(1, Math.round(rel * 0.7)));
          a.health = Math.max(0, (a.health ?? 100) - dmg);
          b.health = Math.max(0, (b.health ?? 100) - dmg);
          a.speed *= 0.45; b.speed *= 0.45;
          if (a.isPlayer || b.isPlayer) {
            this.audio.play('hit');
            this.trauma = Math.min(1, (this.trauma || 0) + 0.12);
            this.burst((a.x + b.x) / 2, 1, (a.z + b.z) / 2, 0xffaa33, 6, 2);
            const pc = a.isPlayer ? a : b;
            if (pc.health <= 25) this.say('Car is beat up — Manny\'s Garage can fix it.', 3);
          }
        } else { a.speed *= 0.8; b.speed *= 0.8; }
      }
    }
  }

  // City bus: follows BUS_ROUTE at ~8 m/s (4 m/s in turns), stops for the
  // player / traffic ahead, and pauses 4 s at each shelter.
  stepBus(dt) {
    const bus = this.bus;
    if (!bus || !bus.mesh) return;
    bus.busPauseT = Math.max(0, (bus.busPauseT || 0) - dt);
    bus.stopCd = Math.max(0, (bus.stopCd || 0) - dt);
    if (bus.busPauseT > 0) { bus.speed = 0; return; }
    const wp = BUS_ROUTE[bus.busWp % BUS_ROUTE.length];
    const dx = wp[0] - bus.x, dz = wp[1] - bus.z;
    const d = Math.hypot(dx, dz);
    if (d < 2) { bus.busWp += 1; return; }
    const targetAngle = Math.atan2(dz, dx);
    let diff = targetAngle - bus.angle;
    while (diff > Math.PI) diff -= Math.PI * 2;
    while (diff < -Math.PI) diff += Math.PI * 2;
    bus.angle += Math.max(-2.2 * dt, Math.min(2.2 * dt, diff));
    // Stop for the player or any car right ahead (don't run anyone over).
    let blocked = false;
    const s = this.state;
    const px = s.player.x - bus.x, pz = s.player.z - bus.z;
    const ca = Math.cos(bus.angle), sa = Math.sin(bus.angle);
    if (px * ca + pz * sa > 0 && px * ca + pz * sa < 10 && Math.abs(-px * sa + pz * ca) < 2.6) blocked = true;
    if (!blocked) {
      for (const c of this.cars) {
        if (c === bus || c.parked) continue;
        const cx = c.x - bus.x, cz = c.z - bus.z;
        if (cx * ca + cz * sa > 0 && cx * ca + cz * sa < 10 && Math.abs(-cx * sa + cz * ca) < 2.6) { blocked = true; break; }
      }
    }
    const want = blocked ? 0 : (Math.abs(diff) > 0.3 ? 4 : 8);
    bus.speed += (want - bus.speed) * Math.min(1, dt * 1.2);
    bus.x += Math.cos(bus.angle) * bus.speed * dt;
    bus.z += Math.sin(bus.angle) * bus.speed * dt;
    bus.mesh.position.set(bus.x, 0, bus.z);
    bus.mesh.rotation.y = Math.PI - bus.angle;
    if (bus.wheels && bus.speed > 0.1) {
      const spin = bus.speed * dt / (bus.wheelR || 0.45);
      for (const w of bus.wheels) w.rotateOnAxis(BUS_X_AXIS, spin);
    }
    if (bus.stopCd <= 0) {
      for (const st of BUS_STOPS) {
        if (Math.hypot(bus.x - st[0], bus.z - st[1]) < 4) {
          bus.busPauseT = 4; bus.stopCd = 25; bus.speed = 0;
          break;
        }
      }
    }
  }

  honk() {
    this.audio.play('honk');
    // Nearby pedestrians turn to look (watchers stare, fearful flinch).
    for (const ped of this.peds) {
      if (ped.dead) continue;
      const d = Math.hypot(ped.x - this.state.player.x, ped.z - this.state.player.z);
      if (d < 12 && ped.state === 'walk' && ped.personality === 'watcher') {
        ped.state = 'watch'; ped.stateT = 2;
      }
    }
  }

  // Radio: cycle to the next station (R key).
  cycleStation() {
    const name = this.audio.nextStation();
    this.say(`Radio: ${name}.`, 2);
  }

  // Smart NPC perception: a gunshot nearby makes witnesses react.
  hearShot(x, z) {
    for (const ped of this.peds) {
      if (ped.dead) continue;
      const d = Math.hypot(ped.x - x, ped.z - z);
      if (d > 35) continue;
      this.pedReact(ped, 'gunshot', d);
    }
  }

  pedReact(ped, cause, distToPlayer) {
    if (ped.dead || ped.state === 'flee') return;
    const s = this.state;
    switch (ped.personality) {
      case 'fearful':
        ped.state = 'flee'; ped.stateT = this.rng.range(4, 7);
        // Runs away screaming — and calls the cops.
        if (!ped.called && (cause === 'gunshot' || cause === 'theft')) {
          ped.called = true;
          const what = cause === 'gunshot' ? 'shots fired' : 'a car theft';
          setTimeout(() => {
            if (!ped.dead && this.state.wanted > 0) return; // already hot
            if (!ped.dead) { this.addWanted(1, 'A witness called the cops'); this.dispatch(`Dispatch: witness reports ${what} near ` + this.nearestPlaceName(ped.x, ped.z)); }
          }, 3000);
        }
        break;
      case 'watcher':
        ped.state = 'watch'; ped.stateT = 3;
        break;
      case 'brave':
        if (distToPlayer < 6) { ped.state = 'fight'; ped.stateT = 4; }
        else { ped.state = 'watch'; ped.stateT = 2; }
        break;
      case 'indifferent':
      default:
        break; // keeps walking, doesn't care
    }
    if (cause === 'wanted' && s.wanted >= 3 && (ped.personality === 'fearful' || ped.personality === 'watcher')) {
      ped.state = 'flee'; ped.stateT = 5;
    }
    // NPC bark (text only — dubbing removed).
    if (ped.state === 'flee' && this.rng.chance(0.4)) {
    }
  }

  nearestPlaceName(x, z) {
    let best = 'Marlin Row', bestD = 1e9;
    for (const k of Object.keys(PLACES)) {
      const p = PLACES[k];
      const d = (p.x - x) * (p.x - x) + (p.y - z) * (p.y - z);
      if (d < bestD) { bestD = d; best = p.name; }
    }
    return best;
  }

  dispatch(text) {
    this.dispatchText = text;
    this.dispatchUntil = this.time + 5;
    if (this.hud.dispatch) this.hud.dispatch.textContent = text;
  }

  // A beach ped that fled or fought walks back to its beach spot, then
  // resumes its beach activity instead of joining the sidewalk crowd.
  sendPedHome(ped) {
    if (!ped.beach) return;
    ped.returning = true;
    ped.tx = ped.beachX; ped.tz = ped.beachZ;
    ped.path = this.sidewalkPath(ped.x, ped.z, ped.tx, ped.tz);
    ped.pathT = 20;
  }

  // ---- Death: fall + fling + loot ---------------------------------------
  // A figure that dies FALLS (eased 0.45 s, tipped away from the hit) instead
  // of snapping sideways, slides with the impact, lies 30 s, then fades.
  startDeathFigure(f, fx = 0, fz = 0, lootMin = 5, lootMax = 50) {
    if (!f || f.dead) return;
    f.dead = true; f.deathT = 0;
    const m = Math.hypot(fx, fz) || 0;
    const s = m > 6 ? m * 0.4 : 3; // car hits fling harder than fists
    f.flingX = m > 0.01 ? (fx / m) * s : 0;
    f.flingZ = m > 0.01 ? (fz / m) * s : 0;
    f.fallSign = f.flingX !== 0 ? Math.sign(f.flingX) : 1;
    if (f.h && f.h.group) f.h.group.rotation.z = 0;
    this.spawnLoot(f.x, f.z, this.rng.range(lootMin, lootMax));
  }
  updateDeadFigure(f, dt) {
    if (!f.h || !f.h.group) return;
    f.deathT = (f.deathT || 0) + dt;
    const k = Math.min(1, f.deathT / 0.45);
    const e = 1 - (1 - k) * (1 - k) * (1 - k);
    f.h.group.rotation.z = (Math.PI / 2) * e * (f.fallSign || 1);
    if (k < 1) { f.x += (f.flingX || 0) * dt * (1 - k); f.z += (f.flingZ || 0) * dt * (1 - k); f.h.group.position.set(f.x, 0, f.z); }
    if (f.deathT > 30) f.h.group.visible = false;
  }
  spawnLoot(x, z, amount) {
    amount = Math.max(1, Math.round(amount));
    if (this.loot.length >= 12) { const old = this.loot.shift(); if (old) this.scene.remove(old.group); }
    const group = new THREE.Group();
    const stack = new THREE.Mesh(new THREE.BoxGeometry(0.55, 0.14, 0.32), new THREE.MeshLambertMaterial({ color: 0x27ae60 }));
    stack.position.y = 0.12; group.add(stack);
    const band = new THREE.Mesh(new THREE.BoxGeometry(0.57, 0.05, 0.1), new THREE.MeshLambertMaterial({ color: 0xf5f0dc }));
    band.position.y = 0.12; group.add(band);
    const cv = document.createElement('canvas'); cv.width = 64; cv.height = 64;
    const g2 = cv.getContext('2d'); g2.fillStyle = '#27ae60'; g2.beginPath(); g2.arc(32, 32, 30, 0, Math.PI * 2); g2.fill(); g2.fillStyle = '#fff'; g2.font = 'bold 40px Arial'; g2.textAlign = 'center'; g2.textBaseline = 'middle'; g2.fillText('$', 32, 34);
    const spr = new THREE.Sprite(new THREE.SpriteMaterial({ map: new THREE.CanvasTexture(cv), transparent: true, depthTest: false }));
    spr.scale.set(0.9, 0.9, 1); spr.position.y = 0.95; group.add(spr);
    group.position.set(x, 0, z);
    this.scene.add(group);
    this.loot.push({ group, spr, amount, t: 0 });
  }
  updateLoot(dt) {
    const p = this.state.player;
    for (let i = this.loot.length - 1; i >= 0; i -= 1) {
      const L = this.loot[i];
      L.t += dt;
      L.spr.position.y = 0.95 + Math.sin(L.t * 3) * 0.12;
      L.group.rotation.y += dt * 1.2;
      if (L.t > 28) L.group.scale.setScalar(Math.max(0.05, 1 - (L.t - 28) / 2));
      if (L.t > 30) { this.scene.remove(L.group); this.loot.splice(i, 1); continue; }
      if (Math.hypot(p.x - L.group.position.x, p.z - L.group.position.z) < 2.5) {
        this.state.money += L.amount;
        this.say(`+$${L.amount} — pocketed.`, 2);
        this.audio.play('cash');
        this.scene.remove(L.group);
        this.loot.splice(i, 1);
        this.updateHud(true);
      }
    }
  }
  // Benches a ped may sit on (park + bus stops + viewpoint — mirrors city.js).
  nearestBench(x, z, maxD = 14) {
    const B = [[96, 82.5, -Math.PI / 2], [110, 82.5, -Math.PI / 2], [102, 70, 0], [114, 72, Math.PI], [98.1, 130, Math.PI], [239.9, 78, 0], [176.1, 208, Math.PI], [135.9, 104, 0], [330, 330, -Math.PI / 2]];
    let best = null, bestD = maxD * maxD;
    for (const [bx, bz, a] of B) {
      const d = (bx - x) * (bx - x) + (bz - z) * (bz - z);
      if (d < bestD) { bestD = d; best = { x: bx, z: bz, angle: a }; }
    }
    return best;
  }

  updatePeds(dt) {
    const s = this.state;
    for (const ped of this.peds) {
      if (ped.dead) { this.updateDeadFigure(ped, dt); continue; }
      ped.stateT -= dt;
      // Wanted reaction: at 3+ stars, people near the player scatter.
      if (s.wanted >= 3 && ped.state === 'walk') {
        const d = Math.hypot(ped.x - s.player.x, ped.z - s.player.z);
        if (d < 14) this.pedReact(ped, 'wanted', d);
      }
      if (ped.state === 'flee' || ped.flee > 0) {
        ped.flee = Math.max(0, ped.flee - dt);
        const dx = ped.x - s.player.x, dz = ped.z - s.player.z;
        this.stepWalker(ped, dx, dz, 3.4, dt);
        ped.h.animate(dt, 0.95);
        if (ped.stateT <= 0 && ped.flee <= 0) { this.sendPedHome(ped); ped.state = 'walk'; }
      } else if (ped.state === 'watch') {
        // Stands and stares at the player, then calls it in.
        const dx = s.player.x - ped.x, dz = s.player.z - ped.z;
        ped.angle = Math.atan2(dz, dx);
        ped.h.animate(dt, 0);
        if (ped.stateT <= 0) {
          if (!ped.called && ped.personality === 'watcher') {
            ped.called = true;
            this.addWanted(1, 'A witness called the cops');
            this.dispatch('Dispatch: witness reports a disturbance near ' + this.nearestPlaceName(ped.x, ped.z));
          }
          ped.state = 'flee'; ped.stateT = 4;
        }
      } else if (ped.state === 'fight') {
        // Brave: closes in and swings — at the player, or at another ped
        // in a street brawl (targetPed set by a random event).
        const tp = ped.targetPed && !ped.targetPed.dead ? ped.targetPed : null;
        const tx = tp ? tp.x : s.player.x, tz = tp ? tp.z : s.player.z;
        const dx = tx - ped.x, dz = tz - ped.z;
        const d = Math.hypot(dx, dz) || 1;
        ped.angle = Math.atan2(dz, dx);
        if (d > 1.4) {
          this.stepWalker(ped, dx, dz, 3.6, dt);
          ped.h.animate(dt, 0.8);
        } else {
          ped.h.animate(dt, 0);
          ped.punchCd -= dt;
          if (ped.punchCd <= 0) {
            ped.punchCd = 1.2;
            ped.h.punch();
            if (tp) {
              tp.hp -= 12;
              if (tp.hp <= 0) {
                this.startDeathFigure(tp, 0, 0, 5, 50);
                ped.state = 'walk'; ped.targetPed = null;
              }
            } else if (s.player.onFoot) {
              this.hurtPlayer(6);
            }
          }
        }
        ped.h.updatePunch(dt);
        if (ped.stateT <= 0) { this.sendPedHome(ped); ped.state = 'walk'; ped.targetPed = null; }
      } else if (ped.state === 'sit' || ped.state === 'talk' || ped.state === 'phone') {
        // Routine pause: sitting on a kerb, chatting, checking a phone.
        // Idle animation; talkers face the nearest other talker.
        ped.h.animate(dt, 0);
        if (ped.state === 'talk') {
          let best = null, bestD = 6;
          for (const o of this.peds) {
            if (o === ped || o.dead || o.state !== 'talk') continue;
            const dd = Math.hypot(o.x - ped.x, o.z - ped.z);
            if (dd < bestD) { bestD = dd; best = o; }
          }
          if (best) ped.angle = Math.atan2(best.z - ped.z, best.x - ped.x);
        }
        if (ped.stateT <= 0) ped.state = 'walk';
      } else if (ped.state === 'shelter') {
        // Rain: walk to the nearest building edge, then wait it out.
        if (this.weather !== 'rain' && this.weather !== 'storm') {
          ped.state = 'walk';
        } else {
          const dx = ped.tx - ped.x, dz = ped.tz - ped.z;
          const d = Math.hypot(dx, dz);
          if (d > 0.6) {
            this.stepWalker(ped, dx, dz, ped.speed * 1.4, dt);
            ped.h.animate(dt, 0.6);
          } else {
            ped.h.animate(dt, 0);
          }
        }
      } else if (ped.state === 'fish') {
        // Fishing at the water's edge: rod out over the sea, patient wait.
        ped.angle = Math.PI; // face the sea (west)
        ped.h.animate(dt, 0);
        if (ped.rod) ped.rod.rotation.x = 0.35 + Math.sin(this.time * 1.6 + ped.z) * 0.07;
      } else if (ped.state === 'sunbathe') {
        // Flat out on a towel, soaking up the La Vega sun.
        ped.h.animate(dt, 0);
      } else if (ped.state === 'swim') {
        // Chest-deep in the sea, drifting slowly along the shore.
        ped.swimT += dt * 0.12;
        ped.z = ped.swimZ0 + Math.sin(ped.swimT) * 6;
        ped.angle = 0; // face the beach (east)
        ped.h.animate(dt, 0.25);
      } else if (ped.state === 'jetski') {
        // Small ellipse in the sea (x 3..9, z 118..142), between the z=117
        // and z=143 roads and west of the beach road — it can never ride
        // over asphalt. The old big ellipse (x 4..12, z 150..230) crossed
        // the E-W roads at z=169/195, which ran across the sea: the jet
        // ski was filmed riding on the road (ilham 19:15 WIB).
        ped.skiT += dt * 0.22;
        const sx = 6 + Math.sin(ped.skiT) * 3;
        const sz = 130 + Math.cos(ped.skiT) * 12;
        const vx = Math.cos(ped.skiT) * 3, vz = -Math.sin(ped.skiT) * 12;
        ped.angle = Math.atan2(vz, vx);
        ped.x = sx; ped.z = sz;
        if (ped.ski) {
          ped.ski.position.set(sx, 0.15, sz);
          ped.ski.rotation.y = Math.PI / 2 - ped.angle;
        }
        ped.h.animate(dt, 0.3);
      } else {
        // Routine: walk the sidewalks, cross at intersections (zebra crossings).
        // Idle routines: occasionally sit, chat or check a phone instead.
        ped.routineT -= dt;
        if (ped.routineT <= 0 && ped.routine !== 'walk') {
          ped.routineT = this.rng.range(10, 22);
          // Sit only on a real bench (park / bus stop) — sitting mid-grass on
          // an invisible kerb is the 'meditating NPC' glitch ilham saw.
          if (ped.routine === 'sit') {
            const bench = this.nearestBench(ped.x, ped.z, 14);
            if (bench) { ped.x = bench.x; ped.z = bench.z; ped.angle = bench.angle; }
            else ped.routine = 'talk';
          }
          ped.state = ped.routine;
          ped.stateT = this.rng.range(6, 14);
          if (ped.routine === 'talk') {
            // Chat in pairs: a nearby walker joins in too.
            for (const o of this.peds) {
              if (o === ped || o.dead || o.state !== 'walk') continue;
              if (Math.hypot(o.x - ped.x, o.z - ped.z) < 12) {
                o.state = 'talk'; o.stateT = this.rng.range(6, 12);
                break;
              }
            }
          }
        }
        // Pick a new sidewalk destination when the path runs out (or the
        // ped dawdled too long on one path): a random sidewalk, clear of
        // intersections, reached via axis-aligned sidewalk legs.
        ped.pathT -= dt;
        if (ped.returning) {
          ped.pathT = 20;
          if (!ped.path || ped.path.length === 0) ped.path = this.sidewalkPath(ped.x, ped.z, ped.beachX, ped.beachZ);
        } else if ((!ped.path || ped.path.length === 0 || ped.pathT <= 0)) {
          ped.pathT = 20;
          const SW = WORLD.roadWidth / 2 + WORLD.sidewalk / 2;
          const road = this.rng.pick(ROADS);
          const side = this.rng.chance(0.5) ? 1 : -1;
          let along = this.rng.range(12, 248);
          let guard = 0;
          while (ROADS.some((r) => Math.abs(along - r) < WORLD.roadWidth / 2 + 1) && guard++ < 8) along = this.rng.range(12, 248);
          if (this.rng.chance(0.5)) { ped.tx = road + side * SW; ped.tz = along; }
          else { ped.tx = along; ped.tz = road + side * SW; }
          ped.path = this.sidewalkPath(ped.x, ped.z, ped.tx, ped.tz);
        }
        const wp = ped.path[0];
        const dx = wp.x - ped.x, dz = wp.z - ped.z;
        const d = Math.hypot(dx, dz);
        if (d > 0.5) {
          ped.angle = Math.atan2(dz, dx);
          ped.x += (dx / d) * ped.speed * dt;
          ped.z += (dz / d) * ped.speed * dt;
          ped.h.animate(dt, 0.35);
        } else {
          ped.path.shift();
          ped.h.animate(dt, 0);
          if (ped.path.length === 0 && ped.returning) {
            ped.returning = false;
            ped.state = ped.beach;
            if (ped.beach === 'swim') ped.swimZ0 = ped.z;
            if (ped.beach === 'jetski') ped.skiT = Math.PI / 2;
          }
        }
      }
      this.collideCircle(ped, 0.4);
      ped.x = clamp(ped.x, 2, WORLD.size - 2);
      ped.z = clamp(ped.z, 2, WORLD.size - 2);
      // Sitting peds ride 0.35 m lower (on an invisible kerb/bench);
      // swimmers sit chest-deep in the sea, jet-ski riders stand on the ski,
      // sunbathers lie flat on their towel (inner rig — see setLieFlat).
      const py = ped.state === 'sit' ? -0.35
        : ped.state === 'swim' ? -0.85 + Math.sin(this.time * 2 + ped.x) * 0.08
        : ped.state === 'jetski' ? 0.55
        : ped.state === 'sunbathe' ? 0.12 : 0;
      ped.h.group.position.set(ped.x, py, ped.z);
      ped.h.group.rotation.y = Math.PI / 2 - ped.angle;
      ped.h.setLieFlat(ped.state === 'sunbathe');
    }
  }

  // Nearest covered spot (just outside a building face) for rain shelter.
  nearestShelter(x, z) {
    let best = null, bestD = 1e9;
    for (const b of this.city.colliders) {
      const cx = clamp(x, b.x0, b.x1), cz = clamp(z, b.z0, b.z1);
      const d = (cx - x) * (cx - x) + (cz - z) * (cz - z);
      if (d < bestD) { bestD = d; best = { b, cx, cz }; }
    }
    if (!best) return { x, z };
    const { b, cx, cz } = best;
    // Push out from the nearest face.
    const dl = Math.abs(cx - b.x0), dr = Math.abs(cx - b.x1), dt = Math.abs(cz - b.z0), db = Math.abs(cz - b.z1);
    const m = Math.min(dl, dr, dt, db);
    if (m === dl) return { x: b.x0 - 1.2, z: cz };
    if (m === dr) return { x: b.x1 + 1.2, z: cz };
    if (m === dt) return { x: cx, z: b.z0 - 1.2 };
    return { x: cx, z: b.z1 + 1.2 };
  }

  // Sidewalk pathing: pedestrians walk ON sidewalks (6.25 m off a road
  // centreline — the middle of the 1.6 m strip) and cross a road only at an
  // intersection (zebra crossing). Waypoints are always sidewalk points
  // clear of intersections; legs are axis-aligned along sidewalk lines, so
  // a road is only ever crossed at an intersection corner, never mid-block.
  nearestSidewalk(x, z) {
    const SW = WORLD.roadWidth / 2 + WORLD.sidewalk / 2;
    let best = null, bestD = 1e9;
    for (const r of ROADS) {
      for (const s of [-1, 1]) {
        for (const c of [{ x: r + s * SW, z: clamp(z, 12, 248) }, { x: clamp(x, 12, 248), z: r + s * SW }]) {
          const d = (c.x - x) * (c.x - x) + (c.z - z) * (c.z - z);
          if (d < bestD) { bestD = d; best = c; }
        }
      }
    }
    return best || { x, z };
  }

  nearestLaneCoord(v) {
    const SW = WORLD.roadWidth / 2 + WORLD.sidewalk / 2;
    let best = null, bestD = 1e9;
    for (const r of ROADS) {
      for (const s of [-1, 1]) {
        const c = r + s * SW;
        const d = Math.abs(v - c);
        if (d < bestD) { bestD = d; best = c; }
      }
    }
    return best;
  }

  // Axis-aligned sidewalk path from (x, z) to a sidewalk target (tx, tz).
  // Returns [{x,z}...] waypoints, target last. Every leg lies on a sidewalk
  // line; the first leg walks a strayed ped back to the nearest kerb.
  sidewalkPath(x, z, tx, tz) {
    const SW = WORLD.roadWidth / 2 + WORLD.sidewalk / 2;
    const start = this.nearestSidewalk(x, z);
    const target = { x: tx, z: tz };
    const laneOf = (p, axis) => {
      for (const r of ROADS) {
        for (const s of [-1, 1]) {
          const c = r + s * SW;
          if (axis === 'x' && Math.abs(p.x - c) < 0.6) return c;
          if (axis === 'z' && Math.abs(p.z - c) < 0.6) return c;
        }
      }
      return null;
    };
    const sv = laneOf(start, 'x'), sh = laneOf(start, 'z');
    const tv = laneOf(target, 'x'), th = laneOf(target, 'z');
    const path = [];
    const push = (p) => {
      const last = path.length ? path[path.length - 1] : start;
      if (Math.hypot(p.x - last.x, p.z - last.z) > 0.3) path.push(p);
    };
    if (sv !== null && tv !== null) {
      if (Math.abs(sv - tv) < 0.01) push(target);
      else {
        const h = this.nearestLaneCoord(start.z);
        push({ x: sv, z: h }); push({ x: tv, z: h }); push(target);
      }
    } else if (sh !== null && th !== null) {
      if (Math.abs(sh - th) < 0.01) push(target);
      else {
        const v = this.nearestLaneCoord(start.x);
        push({ x: v, z: sh }); push({ x: v, z: th }); push(target);
      }
    } else if (sv !== null && th !== null) {
      push({ x: sv, z: th }); push(target);
    } else if (sh !== null && tv !== null) {
      push({ x: tv, z: sh }); push(target);
    } else {
      push(target);
    }
    if (!path.length) path.push(target);
    return path;
  }

  updatePolice(dt) {
    const s = this.state;
    const p = s.player;
    if (s.wanted > 0) this.spawnPolice();
    else if (this.cops.length || this.cruisers.length || this.roadblocks.length || this.heli) {
      // Heat off: police give up and leave.
      this.removePolice();
    }
    // --- Search mode: no cop can see you -> they search your last known spot.
    let nearest = 999;
    for (const c of this.cops) if (!c.dead) nearest = Math.min(nearest, Math.hypot(c.x - p.x, c.z - p.z));
    for (const c of this.cruisers) nearest = Math.min(nearest, Math.hypot(c.x - p.x, c.z - p.z));
    if (s.wanted > 0) {
      if (nearest < 42) {
        this.noSeeT = 0;
        this.lastKnown = { x: p.x, z: p.z };
        this.lastSeenT = this.time;
        if (this.searchMode) { this.searchMode = false; this.dispatch('Dispatch: visual contact re-established. All units converge.'); }
      } else {
        this.noSeeT += dt;
        if (this.noSeeT > 8 && !this.searchMode) {
          this.searchMode = true;
          this.dispatch('Dispatch: lost visual. Units searching near ' + this.nearestPlaceName(this.lastKnown.x, this.lastKnown.z) + '.');
        }
      }
    }
    // --- Helicopter at 4-5 stars.
    if (s.wanted >= 4 && !this.heli) this.spawnHeli();
    if (s.wanted < 4 && this.heli) { this.scene.remove(this.heli.group); this.heli = null; }
    if (this.heli) {
      const h = this.heli;
      h.angle += dt * 0.5;
      // Spotlight sweep (P2.20): the orbit tightens and loosens (5-13 m) so
      // the beam sweeps across the player — IN SIGHT while it is on you.
      // NOTE: this.time is the in-game clock (crawls), so the sweep uses
      // its own fast timer — otherwise the orbit freezes for minutes.
      this.heliSweep = (this.heliSweep || 0) + dt;
      const orbitR = 9 + Math.sin(this.heliSweep * 0.3) * 4;
      const heliH = s.wanted >= 5 ? 30 : 42;
      h.group.position.set(
        p.x + Math.cos(h.angle) * orbitR, heliH + Math.sin(this.time * 0.7) * 1.5,
        p.z + Math.sin(h.angle) * orbitR,
      );
      h.rotor.rotation.y += dt * 22;
      h.group.lookAt(p.x, 0, p.z);
      const beamD = Math.hypot(h.group.position.x - p.x, h.group.position.z - p.z);
      this.heliInSight = beamD < 10;
      if (h.cone) h.cone.material.opacity = this.heliInSight ? 0.26 : 0.14;
    }
    // --- Spike strips at 4+ stars, ahead of the player (every ~25 s).
    if (s.wanted >= 4 && this.time - (this.lastSpikeAt || 0) > 25) {
      this.lastSpikeAt = this.time;
      this.spawnSpikeStrip();
    }
    // --- Roadblocks at 3+ stars (max 3), ahead of the player.
    if (s.wanted >= 3 && this.roadblocks.length < 3 && this.time - (this.lastRoadblockAt || 0) > 20) {
      this.lastRoadblockAt = this.time;
      this.spawnRoadblock();
    }
    if (s.wanted < 3 && this.roadblocks.length) {
      for (const rb of this.roadblocks) for (const c of rb.cars) { const i = this.cars.indexOf(c); if (i >= 0) this.cars.splice(i, 1); this.scene.remove(c.mesh); }
      this.roadblocks = [];
    }
    // Foot cops chase and punch.
    for (const cop of this.cops) {
      if (cop.dead) continue;
      const dx = p.x - cop.x, dz = p.z - cop.z;
      const d = Math.hypot(dx, dz) || 1;
      cop.angle = Math.atan2(dz, dx);
      if (d > 1.6) {
        this.stepWalker(cop, dx, dz, 5.4, dt);
        cop.h.animate(dt, 0.85);
      } else {
        cop.h.animate(dt, 0);
        cop.punchCd -= dt;
        if (cop.punchCd <= 0 && p.onFoot) {
          cop.punchCd = 1.1;
          cop.h.punch();
          this.hurtPlayer(8);
        }
      }
      this.collideCircle(cop, 0.4);
      cop.h.group.position.set(cop.x, 0, cop.z);
      cop.h.group.rotation.y = Math.PI / 2 - cop.angle;
      cop.h.updatePunch(dt);
      // Busted: cop catches you on foot.
      if (d < 1.4 && p.onFoot && s.wanted > 0 && this.mode === 'play') this.busted();
    }
    // Cruisers: PREDICTIVE pursuit — aim at where the player will be.
    for (const cruiser of this.cruisers) {
      if (cruiser.dropped) {
        // Parked after the cop bailed out: lights keep flashing, no driving.
        cruiser.speed = 0;
        if (cruiser.mesh.userData.lightBar) {
          const on = Math.floor(this.time * 6) % 2 === 0;
          cruiser.mesh.userData.lightBar.red.material.emissiveIntensity = on ? 2.5 : 0.2;
          cruiser.mesh.userData.lightBar.blue.material.emissiveIntensity = on ? 0.2 : 2.5;
        }
        continue;
      }
      let vx = 0, vz = 0;
      if (p.onFoot) {
        const sp = this.lastPlayerSpeed || 0;
        vx = Math.cos(p.angle) * sp; vz = Math.sin(p.angle) * sp;
      } else {
        const car = this.cars.find((c) => c.id === p.carId);
        if (car) { vx = Math.cos(car.angle) * car.speed; vz = Math.sin(car.angle) * car.speed; }
      }
      const lead = 1.1;
      let tx = p.x + vx * lead, tz = p.z + vz * lead;
      if (this.searchMode) { tx = this.lastKnown.x; tz = this.lastKnown.z; }
      const inp = driveInputTo(cruiser, tx, tz);
      stepCar(cruiser, { throttle: inp.throttle, brake: inp.brake, steer: inp.steer }, dt, (x, z, r) => this.circleHitsSolid(x, z, r));
      if (cruiser.mesh.userData.lightBar) {
        const on = Math.floor(this.time * 6) % 2 === 0;
        cruiser.mesh.userData.lightBar.red.material.emissiveIntensity = on ? 2.5 : 0.2;
        cruiser.mesh.userData.lightBar.blue.material.emissiveIntensity = on ? 0.2 : 2.5;
      }
      const d = Math.hypot(p.x - cruiser.x, p.z - cruiser.z);
      if (d < 2.6 && p.onFoot) this.hurtPlayer(12);
      if (d < 3.4 && !p.onFoot) {
        const car = this.cars.find((c) => c.id === p.carId);
        if (car) {
          car.speed *= 0.82;
          this.trauma = Math.min(1, this.trauma + 0.1); // tamed (was 0.2)
          this.hurtPlayer(4);
        }
      }
      // Close pursuit: the cop bails out and chases on foot. Far away the
      // cop stays in the car and keeps driving.
      if (!cruiser.dropped && d < 12 && this.cops.length < Math.min(s.wanted, 6)) {
        cruiser.dropped = true;
        cruiser.speed = 0;
        const h = Q.chars.npcMale
          ? new Humanoid({ quat: Q.chars.npcMale, scale: 1 })
          : new Humanoid({ glb: true, tint: 0x9fb8e8, scale: 1 });
        h.group.position.set(cruiser.x + 2, 0, cruiser.z);
        this.scene.add(h.group);
        this.cops.push({ h, x: cruiser.x + 2, z: cruiser.z, angle: 0, hp: 50, punchCd: 0, dead: false });
        this.dispatch('LVPD: unit on foot, suspect close by.');
      }
    }
  }

  updateRivals(dt) {
    const s = this.state;
    const p = s.player;
    for (const r of this.rivals) {
      if (r.dead) continue;
      const dx = p.x - r.x, dz = p.z - r.z;
      const d = Math.hypot(dx, dz) || 1;
      r.angle = Math.atan2(dz, dx);
      if (d > 14) {
        // Advance on the player.
        this.stepWalker(r, dx, dz, 3.4, dt);
        r.h.animate(dt, 0.7);
      } else if (r.melee) {
        // Thugs fight with fists.
        r.h.animate(dt, 0);
        if (d > 1.5) {
          this.stepWalker(r, dx, dz, 3.6, dt);
          r.h.animate(dt, 0.8);
        } else {
          r.punchCd -= dt;
          if (r.punchCd <= 0 && p.onFoot) {
            r.punchCd = 1.1;
            r.h.punch();
            this.hurtPlayer(7);
          }
          r.h.updatePunch(dt);
        }
      } else {
        r.h.animate(dt, 0);
        r.shootCd -= dt;
        if (r.shootCd <= 0) {
          r.shootCd = this.rng.range(1.4, 2.6);
          r.h.aiming = true;
          setTimeout(() => { r.h.aiming = false; }, 200);
          this.shoot(r.x, r.z, r.angle, false);
        }
      }
      this.collideCircle(r, 0.4);
      r.h.group.position.set(r.x, 0, r.z);
      r.h.group.rotation.y = Math.PI / 2 - r.angle;
    }
  }

  updateBullets(dt) {
    for (let i = this.bullets.length - 1; i >= 0; i -= 1) {
      const b = this.bullets[i];
      b.life -= dt;
      if (b.life <= 0) {
        this.scene.remove(b.line);
        b.line.geometry.dispose();
        this.bullets.splice(i, 1);
      }
    }
  }

  updateParticles(dt) {
    for (const p of this.particles) {
      if (p.life <= 0) continue;
      p.life -= dt;
      if (p.life <= 0) { p.mesh.visible = false; continue; }
      p.mesh.position.x += p.vx * dt;
      p.mesh.position.y += p.vy * dt;
      p.mesh.position.z += p.vz * dt;
      p.vy -= 9 * dt;
      p.mesh.scale.setScalar(Math.max(0.1, p.life * 2));
    }
  }

  updateMissions(dt) {
    const s = this.state;
    if (s.mission.index < 0) return;
    const def = MISSIONS[s.mission.index];
    const step = def.steps[s.mission.step];
    if (!step) return;
    const p = s.player;
    const near = (m, r) => m && dist2(p.x, p.z, m.x, m.y) < r * r;
    switch (step.type) {
      case 'steal':
        if (!p.onFoot) { this.advanceStep(); this.say('Good — now bring it to Manny\'s Garage.', 3); this.audio.play('pickup'); }
        break;
      case 'reach':
        if (near(step.marker, 5)) {
          if (s.mission.index === 1) { s.mission.hasPackage = true; this.say('Package grabbed — get it to the club!', 3); this.audio.play('pickup'); }
          this.advanceStep();
        }
        break;
      case 'deliver':
        if (near(step.marker, 6)) {
          if (step.needCar && p.onFoot) { this.say('Bring the car here, not yourself.', 2); break; }
          this.completeMission();
        }
        break;
      case 'evade':
        if (s.wanted === 0) this.completeMission();
        break;
      case 'killAll':
        if (s.mission.rivalsLeft <= 0) this.completeMission();
        break;
      case 'defeat':
        if (s.mission.rivalsLeft <= 0) this.completeMission();
        break;
      case 'reachWanted':
        if (s.wanted >= (step.wanted || 3)) { this.advanceStep(); this.say('That got their attention — now VANISH.', 3); }
        break;
      case 'heat': // Claude parity: the job itself puts heat on you.
        s.wanted = step.wanted || 3; s.wantedDecay = 0;
        this.say(`The heat is on — ${s.wanted} stars!`, 3);
        this.advanceStep();
        break;
      case 'buy':
        // Completed by buyCar() via the dealer prompt (see buyCarStep below).
        break;
      case 'checkpoint': {
        s.mission.timer = s.mission.timer; // timer handled in update()
        if (near(step.marker, 7)) {
          this.audio.play('checkpoint');
          this.burst(step.marker.x, 2, step.marker.y, 0xffd166, 14, 5);
          s.mission.step += 1;
          s.mission.timer = 0;
          if (s.mission.step >= def.steps.length) this.completeMission();
          else { const total = def.steps.filter((x) => x.type === 'checkpoint').length; const n = def.steps.slice(0, s.mission.step + 1).filter((x) => x.type === 'checkpoint').length; this.say(`Checkpoint ${n}/${total} — go!`, 2); }
        }
        break;
      }
      default: break;
    }
  }

  updateWanted(dt) {
    const s = this.state;
    if (s.wanted <= 0) return;
    // Decay when no police can see you.
    let nearest = 999;
    for (const c of this.cops) if (!c.dead) nearest = Math.min(nearest, Math.hypot(c.x - s.player.x, c.z - s.player.z));
    for (const c of this.cruisers) nearest = Math.min(nearest, Math.hypot(c.x - s.player.x, c.z - s.player.z));
    if (nearest > 45) {
      s.wantedDecay += dt * (s.crew.hacker ? 2 : 1); // Hacker passive: wanted decays 2x faster
      // The helicopter keeps eyes on you — heat cools slower under Air-1.
      const decayNeed = this.heli ? 12 : 7;
      if (s.wantedDecay > decayNeed) {
        s.wantedDecay = 0;
        s.wanted -= 1;
        if (s.wanted === 0) this.say('Clean — the heat is off.', 3);
      }
    } else {
      s.wantedDecay = 0;
    }
    this.nearestPolice = nearest;
    this.policeUnits = this.cops.filter((c) => !c.dead).length + this.cruisers.length + (this.heli ? 1 : 0);
    // Police radio chatter (contekan P2.14): a line every ~9 s while hot.
    this.chatterT -= dt;
    if (this.chatterT <= 0) {
      this.chatterT = 9 + this.rng.range(0, 4);
      this.say(this.rng.pick([
        "LVPD: 'All units, suspect is mobile — stay on him.'",
        "LVPD: 'Air-1, keep the spotlight on the suspect.'",
        "LVPD: 'Suspect heading downtown — set a roadblock.'",
        "LVPD: 'Scanners cooled — hold at 3 stars, do not engage alone.'",
        "LVPD: 'Unit 12, cut him off at the next intersection.'",
      ]), 4);
    }
    // Health regen when cool.
    if (s.wanted === 0 && s.health < PLAYER.health && this.time - s.player.lastHurt > 6) {
      s.health = Math.min(PLAYER.health, s.health + 2 * dt);
    }
  }

  // Day-night cycle + dynamic weather + rush-hour traffic.
  paintSkyDome(top, mid, horizon) {
    const g = this.skyCanvas.getContext('2d');
    const grad = g.createLinearGradient(0, 0, 0, 256);
    grad.addColorStop(0, top);
    grad.addColorStop(0.55, mid);
    grad.addColorStop(0.8, horizon);
    grad.addColorStop(1, horizon);
    g.fillStyle = grad; g.fillRect(0, 0, 4, 256);
    this.skyTex.needsUpdate = true;
  }


  updateDayNight(dt) {
    const s = this.state;
    // 1 game hour per 2 real minutes.
    const prevClock = s.clock;
    s.clock = (s.clock + dt / 120) % 24;
    if (s.clock < prevClock) s.day = (s.day || 1) + 1; // midnight -> new day
    const hour = s.clock;
    // Sun elevation: up at 6:00, down at 18:00.
    const dayT = Math.sin(((hour - 6) / 12) * Math.PI); // 1 at noon, 0 at 6/18, negative at night
    const sunH = Math.max(0.04, dayT);
    const dusk = hour >= 16.5 && hour < 19 ? 1 : (hour >= 5 && hour < 7 ? 0.7 : 0);
    const night = dayT <= 0;
    // Weather: weighted random every 45-120s — sun 50%, clouds 25%, rain 18%, storm 7%.
    this.weatherT -= dt;
    if (this.weatherT <= 0) {
      this.weatherT = this.rng.range(45, 120);
      const prev = this.weather;
      const r = Math.random();
      this.weather = r < 0.5 ? 'sunny' : r < 0.75 ? 'cloudy' : r < 0.93 ? 'rain' : 'storm';
      if (this.weather === 'cloudy') this.say('Clouds roll in over La Vega.', 2);
      if ((this.weather === 'rain' || this.weather === 'storm') && prev !== 'rain' && prev !== 'storm') {
        this.say(this.weather === 'storm' ? 'Storm rolling in — roads are slick.' : 'Rain over La Vega — streets are getting wet.', 4);
        // Pedestrians run for cover.
        for (const ped of this.peds) {
          if (ped.dead || ped.state !== 'walk') continue;
          if (this.rng.chance(0.6)) {
            const sh = this.nearestShelter(ped.x, ped.z);
            ped.tx = sh.x; ped.tz = sh.z; ped.state = 'shelter';
          }
        }
      }
      if (this.weather === 'sunny' || this.weather === 'cloudy') {
        for (const ped of this.peds) if (ped.state === 'shelter') ped.state = 'walk';
      }
    }
    // Business income: passive payout every in-game hour.
    const hr = Math.floor(s.clock);
    if (hr !== this.lastHour) {
      this.lastHour = hr;
      const inc = (s.businesses.bar ? 50 : 0) + (s.businesses.garage ? 35 : 0);
      if (inc > 0) {
        s.money += inc;
        this.say(`Business income +$${inc}.`, 4);
      }
    }
    const cloudDim = this.weather === 'cloudy' ? 0.6 : this.weather === 'rain' ? 0.6 : this.weather === 'storm' ? 0.45 : 1; // rain no longer crushes the ground to black (M3c)
    const sun = this.sun;
    if (sun) {
      const az = ((hour - 6) / 12) * Math.PI; // east -> west
      const px = s.player.x + Math.cos(az) * 90;
      const pz = s.player.z + Math.sin(az) * 40;
      sun.position.set(px, 25 + sunH * 75, pz);
      sun.target.position.set(s.player.x, 0, s.player.z);
      sun.target.updateMatrixWorld();
      if (night) {
        sun.intensity = 0.25;
        sun.color.setHex(0x8fa8d8); // moonlight
      } else if (dusk > 0) {
        sun.intensity = 1.6 * cloudDim;
        sun.color.setHex(0xff9a4d); // golden hour
      } else {
        sun.intensity = 2.6 * cloudDim;
        sun.color.setHex(0xfff2d0);
      }
    }
    // Sky + fog follow the time of day (PS2-style: strong fog on the horizon).
    const sky = this.scene.background;
    const fog = this.scene.fog;
    if (night) {
      sky.setHex(0x0b1020); // Lucas P1: deep night blue (CE palette)
      fog.color.setHex(0x0b1020);
      fog.near = 45; fog.far = 150; // closer night fog
    } else if (dusk > 0) {
      sky.setHex(0xd1546e); // La Vega dusk: rose-neon, NOT Karimbu's purple-orange
      fog.color.setHex(0xc74f68);
      fog.near = 70; fog.far = 210;
    } else {
      sky.setHex(this.weather === 'cloudy' ? 0x9db8c8 : this.weather === 'rain' || this.weather === 'storm' ? 0x7a8a99 : 0x87c5e8);
      fog.color.setHex(this.weather === 'cloudy' ? 0x9db8c8 : this.weather === 'rain' || this.weather === 'storm' ? 0x7a8a99 : 0x9fd0e8);
      fog.near = 90; fog.far = 240;
    }
    // Clouds drift slowly across the sky (M3c: high clouds, not low blobs).
    for (const c of this.clouds) {
      c.position.x += (c.userData.drift || 0.6) * dt;
      if (c.position.x > 340) c.position.x = -60;
    }
    // Sky bodies follow the player: sun disc + glow by day (orange at
    // dusk), moon + stars by night. (M-E: realistic sky.)
    if (this.skySun) {
      const p = s.player;
      const az = ((hour - 6) / 12) * Math.PI; // east -> west, same as the light
      const el = Math.asin(Math.max(0, Math.min(1, dayT))); // sun elevation
      const sd = new THREE.Vector3(Math.cos(az) * Math.cos(el), Math.sin(el), Math.sin(az) * Math.cos(el));
      const sp = new THREE.Vector3(p.x + sd.x * 380, Math.max(14, sd.y * 380), p.z + sd.z * 380);
      this.skySun.position.copy(sp);
      this.skyGlow.position.copy(sp);
      this.skySun.lookAt(p.x, 1.6, p.z);
      this.skyGlow.lookAt(p.x, 1.6, p.z);
      this.skySun.visible = !night; this.skyGlow.visible = !night;
      if (!night) {
        this.skySun.material.color.setHex(dusk > 0 ? 0xff7a2e : 0xffe9a8);
        this.skyGlow.material.color.setHex(dusk > 0 ? 0xff5e3a : 0xffc46b);
        this.skyGlow.material.opacity = dusk > 0 ? 0.5 : 0.3;
      }
      // Moon: opposite side of the sky, up at night.
      const md = new THREE.Vector3(-Math.cos(az) * 0.8, 0.55, -Math.sin(az) * 0.8).normalize();
      this.skyMoon.position.set(p.x + md.x * 380, 40 + md.y * 380, p.z + md.z * 380);
      this.skyMoon.lookAt(p.x, 1.6, p.z);
      this.skyMoon.visible = night;
      // Stars dome centres on the player; night only.
      this.skyStars.position.set(p.x, 0, p.z);
      this.skyStars.material.opacity = night ? 0.9 : 0;
      // Bigger glow at dusk.
      this.skyGlow.scale.setScalar(dusk > 0 ? 1.6 : 1);
    }
    // Sky dome gradient + cloud tint follow the phase (day/dusk/night/
    // cloudy/rain). Repainted only when the phase changes, not per frame.
    if (this.skyDome) {
      const phase = night ? 'night' : dusk > 0 ? 'dusk' : this.weather === 'cloudy' ? 'cloudy' : (this.weather === 'rain' || this.weather === 'storm') ? 'rain' : 'day';
      this.skyDome.position.set(s.player.x, 0, s.player.z);
      if (phase !== this.skyPhase) {
        this.skyPhase = phase;
        if (phase === 'night') { this.paintSkyDome('#04060d', '#0b1020', '#1a2340'); this.cloudMat.color.setHex(0x2a3550); }
        else if (phase === 'dusk') { this.paintSkyDome('#3d2456', '#d1546e', '#ffb36b'); this.cloudMat.color.setHex(0xffb3a0); }
        else if (phase === 'cloudy') { this.paintSkyDome('#5a7a94', '#9db8c8', '#c8d8e2'); this.cloudMat.color.setHex(0xdde8ee); }
        else if (phase === 'rain') { this.paintSkyDome('#3a4a5a', '#7a8a99', '#9aa8b5'); this.cloudMat.color.setHex(0x8a99a8); }
        else { this.paintSkyDome('#2f6fc4', '#87c5e8', '#cfeefb'); this.cloudMat.color.setHex(0xffffff); }
      }
    }
    // Rush hour: 08:00-09:00 and 17:00-18:00 — denser traffic.
    const rush = (hour >= 8 && hour < 9) || (hour >= 17 && hour < 18);
    if (rush !== this.rushActive) {
      this.rushActive = rush;
      if (rush) {
        this.say('Rush hour — the streets are packed.', 2);
        this.spawnExtraTraffic();
      } else {
        this.removeExtraTraffic();
      }
    }
    // Chunk loading: only biome chunks near the player stay visible.
    this.chunkT = (this.chunkT || 0) - dt;
    if (this.chunkT <= 0) {
      this.chunkT = 0.5;
      this.updateChunks();
    }
  }

  updateChunks() {
    if (!this.city || !this.city.chunkGroups) return;
    const p = this.state.player;
    for (const cg of this.city.chunkGroups) {
      const dx = cg.cx - p.x, dz = cg.cz - p.z;
      const d = Math.hypot(dx, dz);
      cg.group.visible = d < 170;
    }
  }

  // ---- Living world: random events ----------------------------------------
  updateRandomEvents(dt) {
    if (this.mode !== 'play') return;
    this.eventT -= dt;
    if (this.eventT > 0) return;
    this.eventT = this.rng.range(60, 120);
    const type = this.rng.pick(['chase', 'ambulance', 'fight', 'robbery']);
    const near = this.nearestPlaceName(this.state.player.x, this.state.player.z);
    if (type === 'chase') {
      const suspect = this.spawnEventVehicle('sedan', 0x222222, 30);
      const cruiser = this.spawnEventVehicle('police', 0xffffff, 42);
      if (suspect && cruiser) {
        this.eventVehicles.push({ car: suspect, until: this.time + 15 }, { car: cruiser, until: this.time + 15 });
        this.dispatch(`Dispatch: pursuit in progress near ${near}.`);
        this.audio.play('siren');
      }
    } else if (type === 'ambulance') {
      const amb = this.spawnEventVehicle('truck', 0xffffff, 30);
      if (amb) {
        this.eventVehicles.push({ car: amb, until: this.time + 14 });
        this.dispatch(`Ambulance responding near ${near}.`);
        this.audio.play('siren');
      }
    } else if (type === 'fight') {
      const near2 = this.peds.filter((p) => !p.dead && p.state === 'walk' && Math.hypot(p.x - this.state.player.x, p.z - this.state.player.z) < 40);
      if (near2.length >= 2) {
        const a = near2[0], b = near2[1];
        a.state = 'fight'; a.stateT = 8; a.targetPed = b;
        b.state = 'fight'; b.stateT = 8; b.targetPed = a;
        this.dispatch(`Two men brawling near ${near}.`);
        this.say('Fight breaking out over there!', 3);
      }
    } else if (type === 'robbery') {
      const near2 = this.peds.filter((p) => !p.dead && p.state === 'walk' && Math.hypot(p.x - this.state.player.x, p.z - this.state.player.z) < 40);
      if (near2.length) {
        const p = near2[0];
        p.state = 'flee'; p.stateT = 6;
        this.dispatch(`Robbery at ${near} — suspect fleeing on foot!`);
      }
    }
  }

  // Spawn an ambient event car on a road near the player, driving by.
  spawnEventVehicle(model, color, offsetAlong) {
    const s = this.state;
    const axis = this.rng.chance(0.5) ? 'x' : 'z';
    let roads = ROADS.filter((r) => Math.abs(r - (axis === 'x' ? s.player.z : s.player.x)) < 60);
    if (!roads.length) roads = ROADS;
    const road = this.rng.pick(roads);
    const dir = this.rng.chance(0.5) ? 1 : -1;
    const lane = 2.5;
    const along = (axis === 'x' ? s.player.x : s.player.z) + dir * (offsetAlong || 30);
    const x = axis === 'x' ? along : road + (dir > 0 ? -lane : lane);
    const z = axis === 'x' ? road + (dir > 0 ? lane : -lane) : along;
    const angle = axis === 'x' ? (dir > 0 ? 0 : Math.PI) : (dir > 0 ? Math.PI / 2 : -Math.PI / 2);
    const spec = CAR_MODELS[model];
    const car = createCar(this.scene, model, color, x, z, angle, { id: 4000 + Math.floor(Math.random() * 900), ai: { axis, dir, road } });
    this.cars.push(car);
    return car;
  }

  updateEvents(dt) {
    for (let i = this.eventVehicles.length - 1; i >= 0; i -= 1) {
      const ev = this.eventVehicles[i];
      const car = ev.car;
      if (car.ai) stepTrafficCar(car, dt, (x, z, r) => this.circleHitsSolid(x, z, r), this.rng, this.cars, this.time, this.peds);
      const d = Math.hypot(car.x - this.state.player.x, car.z - this.state.player.z);
      if (this.time > ev.until || d > 120) {
        const ci = this.cars.indexOf(car);
        if (ci >= 0) this.cars.splice(ci, 1);
        this.scene.remove(car.mesh);
        this.eventVehicles.splice(i, 1);
      }
    }
  }

  // ---- Weather: rain streaks -----------------------------------------------
  updateRain(dt) {
    if (!this.rain) return;
    const raining = this.weather === 'rain' || this.weather === 'storm';
    this.rain.lines.visible = raining && this.mode === 'play';
    if (!this.rain.lines.visible) return;
    const p = this.state.player;
    this.rain.lines.position.set(p.x, 0, p.z);
    const pos = this.rain.lines.geometry.attributes.position;
    const arr = pos.array;
    const speed = this.rain.speed * (this.weather === 'storm' ? 1.5 : 1);
    for (let i = 0; i < arr.length; i += 6) {
      let y = arr[i + 1] - speed * dt;
      if (y < 0) y += 30;
      arr[i + 1] = y; arr[i + 4] = y - 0.7;
    }
    pos.needsUpdate = true;
  }

  // ---- Taxi jobs -------------------------------------------------------------
  startTaxiJob() {
    const s = this.state;
    const dest = this.rng.pick(Object.values(PLACES));
    const reward = 80 + Math.floor(this.rng.range(0, 70));
    const marker = new THREE.Mesh(
      new THREE.OctahedronGeometry(1.2),
      new THREE.MeshBasicMaterial({ color: 0xffd166 }),
    );
    marker.position.set(dest.x, 3, dest.y);
    this.scene.add(marker);
    this.taxiJob = { x: dest.x, z: dest.y, timer: 75, reward, marker };
    this.say(`Taxi job: take the fare to ${dest.name} — $${reward} if you're quick.`, 5);
    this.dispatch(`Taxi: passenger wants ${dest.name}.`);
  }

  updateTaxi(dt) {
    const s = this.state;
    const job = this.taxiJob;
    if (!job) return;
    job.timer -= dt;
    job.marker.rotation.y += dt * 2;
    job.marker.position.y = 3 + Math.sin(this.time * 2) * 0.3;
    const d = Math.hypot(s.player.x - job.x, s.player.z - job.z);
    if (d < 6) {
      s.money += job.reward;
      this.say(`Taxi fare paid +$${job.reward}.`, 4);
      this.audio.play('pickup');
      this.scene.remove(job.marker);
      this.taxiJob = null;
      return;
    }
    if (job.timer <= 0) {
      this.say('Taxi job failed — the passenger walked away.', 4);
      this.scene.remove(job.marker);
      this.taxiJob = null;
    }
  }

  // ---- Collectibles + stunts -------------------------------------------------
  updateCollectibles(dt) {
    const s = this.state;
    for (const c of this.collectibles) {
      if (c.taken) continue;
      c.mesh.rotation.y += dt * 1.5;
      const d = Math.hypot(s.player.x - c.x, s.player.z - c.z);
      if (d < 2.5) {
        c.taken = true; c.mesh.visible = false;
        s.collectibles += 1;
        s.money += 50;
        this.say(`Package found (${s.collectibles}/10) +$50.`, 3);
        this.audio.play('pickup');
      }
    }
  }

  updateStunts(dt) {
    const s = this.state;
    if (s.player.onFoot) return;
    const car = this.cars.find((c) => c.id === s.player.carId);
    if (!car) return;
    for (const st of this.stunts) {
      if (st.done) continue;
      const d = Math.hypot(car.x - st.x, car.z - st.z);
      if (d < 4 && Math.abs(car.speed) > 22) {
        st.done = true;
        s.money += 150;
        this.say(`STUNT JUMP! ${st.name} +$150.`, 4);
        this.audio.play('stunt');
        this.trauma = Math.min(0.6, this.trauma + 0.15); // tamed (was 0.3)
      }
    }
  }

  // ---- Ambience + music intensity --------------------------------------------
  updateAmbience(dt) {
    this.lastAmbienceT -= dt;
    if (this.lastAmbienceT > 0) return;
    this.lastAmbienceT = 2;
    if (this.weather === 'rain' || this.weather === 'storm') {
      if (this.lastAmbience !== 'rain') { this.lastAmbience = 'rain'; this.audio.setAmbience('rain'); }
      return;
    }
    const d = this.currentDistrict();
    if (d.key !== this.lastAmbience) {
      this.lastAmbience = d.key;
      this.audio.setAmbience(d.ambience);
    }
  }

  updateIntensity() {
    const s = this.state;
    const intensity = s.wanted >= 3 ? 2 : s.mission.index >= 0 ? 1 : 0;
    if (intensity !== this.lastIntensity) {
      this.lastIntensity = intensity;
      this.audio.setIntensity(intensity);
    }
  }

  // ---- Phone (T) ---------------------------------------------------------------
  openPhone() {
    if (this.mode !== 'play') return;
    this.mode = 'phone';
    this.phoneOpen = true;
    if (this.player) this.player.setPhonePose(true);
    const h = this.hud;
    if (h.phone) h.phone.style.display = 'block';
    if (h.dialogue) h.dialogue.style.display = 'none';
    this.updateHud();
  }

  closePhone(silent) {
    if (!this.phoneOpen && !silent) return;
    this.phoneOpen = false;
    if (this.player) this.player.setPhonePose(false);
    const h = this.hud;
    if (h && h.phone) h.phone.style.display = 'none';
    if (this.mode === 'phone') this.mode = 'play';
  }

  callLaRosa() {
    const s = this.state;
    if (s.missionAvailable < MISSIONS.length && s.mission.index < 0) {
      this.closePhone();
      this.startMission(s.missionAvailable);
    } else if (s.mission.index < 0) {
      this.say('La Rosa: All jobs done, Jax. The city is yours.', 4);
    } else {
      this.say('La Rosa: Focus, Jax. Finish the job you started.', 4);
    }
  }

  callManny() {
    const s = this.state;
    const d = Math.hypot(s.player.x - PLACES.garage.x, s.player.z - PLACES.garage.y);
    const car = s.player.onFoot ? null : this.cars.find((c) => c.id === s.player.carId);
    if (d < 20 && car) {
      car.health = 100;
      car.flatTire = false;
      this.say("Manny: Patched up, good as new. On the house.", 4);
    } else {
      this.say("Manny: Bring the car to my garage and I'll fix it.", 4);
    }
  }

  callCrew() {
    this.say('Crew: Leo, Maya and Rico are on standby — call when you need backup.', 4);
  }

  phoneGps() {
    this.say(`GPS: ${this.objectiveText()}`, 5);
    this.closePhone();
  }

  // ---- Vehicle customisation ---------------------------------------------------
  cyclePaint() {
    const s = this.state;
    if (s.player.onFoot) return;
    const car = this.cars.find((c) => c.id === s.player.carId);
    if (!car) return;
    const d = Math.hypot(s.player.x - PLACES.garage.x, s.player.z - PLACES.garage.y);
    if (d > 20) { this.say("Respray only at Manny's Garage.", 3); return; }
    if (s.money < 50) { this.say('Respray costs $50.', 3); return; }
    const palette = [0xe63946, 0x457b9d, 0xffd166, 0x2a9d8f, 0x8338ec, 0xf8f9fa, 0x111111];
    const idx = palette.indexOf(car.color);
    const next = palette[(idx + 1) % palette.length];
    // Recolour the dominant body colour (works for GLB + procedural cars).
    // Materials are cloned first — GLB clones share materials by default.
    const counts = new Map();
    car.mesh.traverse((o) => {
      if (o.isMesh && o.material && o.material.color) {
        const hex = o.material.color.getHex();
        counts.set(hex, (counts.get(hex) || 0) + 1);
      }
    });
    let bodyHex = null, best = 0;
    for (const [hex, n] of counts) if (n > best) { best = n; bodyHex = hex; }
    if (bodyHex !== null) {
      car.mesh.traverse((o) => {
        if (o.isMesh && o.material && o.material.color && o.material.color.getHex() === bodyHex) {
          o.material = o.material.clone();
          o.material.color.setHex(next);
        }
      });
    }
    car.color = next;
    s.money -= 50;
    this.say('Respray done — $50.', 3);
    this.audio.play('pickup');
  }

  // ---- Crew passives ($1500 each, Claude parity) ----------------------------------
  // Muscle: punch damage x2. Driver: +8% top speed. Hacker: wanted decays 2x.
  buyCrew() {
    const s = this.state;
    const order = [
      ['muscle', 'Muscle (Leo) — punch damage x2'],
      ['driver', 'Driver (Maya) — +8% top speed'],
      ['hacker', 'Hacker (Rico) — wanted fades 2x faster'],
    ];
    const next = order.find(([k]) => !s.crew[k]);
    if (!next) { this.say('Crew complete — Leo, Maya and Rico all work for you.', 3); return; }
    if (s.money < 1500) { this.say(`Crew passive costs $1500 — ${next[1]}.`, 3); this.audio.play('fail'); return; }
    s.money -= 1500;
    s.crew[next[0]] = true;
    this.audio.play('cash');
    this.say(`Crew hired: ${next[1]}.`, 4);
  }

  // ---- Businesses + safehouse ----------------------------------------------------
  buyBusiness(kind) {
    const s = this.state;
    const defs = {
      bar: { price: 2000, place: PLACES.casino, name: 'the Neon Bar' },
      garage: { price: 1500, place: PLACES.garage, name: "Manny's Garage share" },
      safehouse: { price: 1200, place: { x: 23, y: 78 }, name: 'Beach House safehouse' },
    };
    const def = defs[kind];
    if (!def) return;
    const pz = def.place.z !== undefined ? def.place.z : def.place.y;
    const d = Math.hypot(s.player.x - def.place.x, s.player.z - pz);
    if (d > 15) { this.say(`Go to ${def.name} to buy it.`, 3); return; }
    if (kind === 'safehouse') {
      if (s.respawn) { this.say('You already own the Beach House.', 3); return; }
      if (s.money < def.price) { this.say(`Beach House costs $${def.price}.`, 3); return; }
      s.money -= def.price;
      s.respawn = { x: 23, z: 78 };
      this.say('Beach House bought — you respawn here now.', 4);
      return;
    }
    if (s.businesses[kind]) { this.say(`You already own ${def.name}.`, 3); return; }
    if (s.money < def.price) { this.say(`${def.name} costs $${def.price}.`, 3); return; }
    s.money -= def.price;
    s.businesses[kind] = true;
    this.say(`${def.name} bought — passive income every hour.`, 4);
  }

  // B key: buy whatever business is in front of you.
  buyNearestBusiness() {
    const s = this.state;
    if (Math.hypot(s.player.x - PLACES.dealer.x, s.player.z - PLACES.dealer.y) < 14) { this.openDealer(); return; }
    const dGun = Math.hypot(s.player.x - PLACES.gunShop.x, s.player.z - PLACES.gunShop.y);
    if (dGun < 15) { this.buyWeapon(); return; }
    const dCas = Math.hypot(s.player.x - PLACES.casino.x, s.player.z - PLACES.casino.y);
    const dGar = Math.hypot(s.player.x - PLACES.garage.x, s.player.z - PLACES.garage.y);
    const dBea = Math.hypot(s.player.x - PLACES.beach.x, s.player.z - PLACES.beach.y);
    if (dCas < 15) this.buyBusiness('bar');
    else if (dGar < 15) this.buyBusiness('garage');
    else if (dBea < 15) this.buyBusiness('safehouse');
    else if (Math.hypot(s.player.x - PLACES.club.x, s.player.z - PLACES.club.y) < 15) this.buyCrew();
    else this.say("Buy: weapons at Vega Arms (gun shop), crew at the club, businesses at the Neon Bar, Manny's Garage, or the Beach House.", 4);
  }

  spawnExtraTraffic() {
    // Six extra cars join the rush (spawned at the map edges, driving in).
    const models = ['sedan', 'taxi', 'sedan', 'truck', 'sedan', 'sport'];
    models.forEach((model, i) => {
      const axis = this.rng.chance(0.5) ? 'x' : 'z';
      const road = this.rng.pick(ROADS);
      const dir = this.rng.chance(0.5) ? 1 : -1;
      const lane = 2.5;
      const x = axis === 'x' ? this.rng.range(20, 250) : road + (dir > 0 ? -lane : lane);
      const z = axis === 'x' ? road + (dir > 0 ? lane : -lane) : this.rng.range(20, 250);
      const spec = CAR_MODELS[model];
      const angle = axis === 'x' ? (dir > 0 ? 0 : Math.PI) : (dir > 0 ? Math.PI / 2 : -Math.PI / 2);
      const car = createCar(this.scene, model, this.rng.pick(spec.colors), x, z, angle, { id: 3000 + i, ai: { axis, dir, road } });
      this.cars.push(car);
      this.extraTraffic.push(car);
    });
  }

  removeExtraTraffic() {
    for (const car of this.extraTraffic) {
      const i = this.cars.indexOf(car);
      if (i >= 0) this.cars.splice(i, 1);
      this.scene.remove(car.mesh);
    }
    this.extraTraffic = [];
  }

  updateAmbient(dt) {
    for (const c of this.clouds) {
      c.position.x += dt * 0.7;
      if (c.position.x > 270) c.position.x = -10;
    }
    // Waves lap the shore.
    if (this.city) {
      this.city.waves.forEach((w, i) => {
        w.position.x = 13.2 + Math.sin(this.time * 0.5 + i * 1.3) * 0.5;
        w.material.opacity = 0.22 + 0.15 * Math.sin(this.time * 0.8 + i);
      });
      // Beacon pulse + mission arrow bob (the arrow floats above the target).
      if (this.city.beacon.visible) {
        this.city.beacon.rotation.y += dt * 0.8;
        this.city.beacon.children[1].scale.setScalar(1 + Math.sin(this.time * 4) * 0.12);
        if (this.city.beaconArrow) this.city.beaconArrow.position.y = 6.5 + Math.sin(this.time * 3) * 0.5;
      }
    }
  }

  updateBeacon() {
    const m = this.missionMarker();
    const beacon = this.city.beacon;
    if (!m) { beacon.visible = false; return; }
    beacon.visible = true;
    beacon.position.set(m.x, 0, m.y);
  }

  updateCamera(dt) {
    const s = this.state;
    const p = s.player;
    // Cinematic shot framing: side-tracking view for the chase screenshot.
    if (this.shotCamMode === 'chase') {
      const fx = Math.cos(p.angle), fz = Math.sin(p.angle);
      const px = -fz, pz = fx;
      // Side view (camera over the open sea / park — never inside a building).
      const desired = new THREE.Vector3(p.x - fx * 2 + px * 13, 5.5, p.z - fz * 2 + pz * 13);
      const k = 1 - Math.exp(-dt * 6);
      this.camera.position.lerp(desired, k);
      this.camera.lookAt(p.x - fx * 4, 1.4, p.z - fz * 4);
      this.camera.aspect = this.renderer.domElement.clientWidth / Math.max(1, this.renderer.domElement.clientHeight);
      this.camera.updateProjectionMatrix();
      return;
    }
    if (this.shotCamMode === 'mission') {
      // Side view of the pier: player, beacon and sea in one frame.
      const fx = Math.cos(p.angle), fz = Math.sin(p.angle);
      const px = -fz, pz = fx;
      const desired = new THREE.Vector3(p.x - fx * 5 + px * 9, 4.5, p.z - fz * 5 + pz * 9);
      const k = 1 - Math.exp(-dt * 6);
      this.camera.position.lerp(desired, k);
      this.camera.lookAt(p.x + fx * 5, 1.5, p.z + fz * 5);
      this.camera.aspect = this.renderer.domElement.clientWidth / Math.max(1, this.renderer.domElement.clientHeight);
      this.camera.updateProjectionMatrix();
      return;
    }
    if (this.shotCamMode === 'city') {
      // High 3/4 view over the park trees: staged sedan + peds on the
      // sidewalk + the z=91 road + the city behind, all in one frame.
      const desired = new THREE.Vector3(98, 13, 70);
      const k = 1 - Math.exp(-dt * 6);
      this.camera.position.lerp(desired, k);
      this.camera.lookAt(112, 1, 94);
      this.camera.aspect = this.renderer.domElement.clientWidth / Math.max(1, this.renderer.domElement.clientHeight);
      this.camera.updateProjectionMatrix();
      return;
    }
    // Mission intro cutscene: slow low dolly — starts close and low
    // behind Jax (dramatic low angle), pulls back and rises to the normal
    // follow position. The end point uses the follow camera's own formula,
    // so the handover is seamless. (M-I.)
    if (this.cutscene && this.cutscene.kind === 'intro') {
      const cs = this.cutscene;
      const k = Math.min(1, cs.t / cs.dur);
      const e = k * k * (3 - 2 * k); // smoothstep
      const fx = Math.cos(p.angle), fz = Math.sin(p.angle);
      const start = new THREE.Vector3(p.x - fx * 3.2, (p.y || 0) + 1.0, p.z - fz * 3.2);
      const yaw = this.camYaw + (this.camYawOffset || 0);
      const end = new THREE.Vector3(
        p.x - Math.cos(yaw) * 4.2 * Math.cos(0.32),
        (p.y || 0) + 1.6 + 4.2 * Math.sin(0.32),
        p.z - Math.sin(yaw) * 4.2 * Math.cos(0.32));
      this.camera.position.lerpVectors(start, end, e);
      this.camera.lookAt(p.x, (p.y || 0) + 1.5 + (1 - e) * 0.4, p.z);
      this.camera.aspect = this.renderer.domElement.clientWidth / Math.max(1, this.renderer.domElement.clientHeight);
      this.camera.updateProjectionMatrix();
      return;
    }

    // Follow camera — Claude Wg() parity, measured from the Claude file:
    // dist 4.2 on foot / 9+|speed|*0.08 in car (x zoom); target = player
    // centre +1.6 on foot / +1.8 in car; lookAt the player (not 4 m ahead);
    // FOV 70 on foot / 70+|speed|*0.45 in car, lerped at dt*4; camera
    // collision steps back from s to 1.2 in 0.6 m increments.
    this.camIdleT = (this.camIdleT || 0) + dt;
    const inCar = !p.onFoot;
    const carSpeed = inCar ? Math.abs((this.cars.find((c) => c.id === p.carId) || { speed: 0 }).speed) : 0;
    const zoom = this.camZoom || 1;
    const sDist = (inCar ? 9 + carSpeed * 0.08 : 4.2) * zoom;
    const pitch = this.camPitch ?? 0.32;
    const targetY = (p.y || 0) + (inCar ? 1.8 : 1.6);
    const yaw = this.camYaw + this.camYawOffset;
    const dirX = Math.cos(yaw), dirZ = Math.sin(yaw);
    const cosP = Math.cos(pitch), sinP = Math.sin(pitch);
    // Camera collision (Claude stepping): first unblocked distance wins.
    const blockedAt = (l) => {
      const cx = p.x - dirX * l * cosP, cz = p.z - dirZ * l * cosP;
      const cy = targetY + l * sinP;
      if (cy < 0.6) return true;
      if (this.city && this.city.colliders) {
        for (const b of this.city.colliders) {
          // Only block when the camera is BELOW the roof (b.h): the old check
          // ignored height, so the camera stepped back even when it was above
          // a low house — the "wild camera" ilham kept feeling.
          if (cy < (b.h ?? 999) + 0.4 && cx > b.x0 - 0.4 && cx < b.x1 + 0.4 && cz > b.z0 - 0.4 && cz < b.z1 + 0.4) return true;
        }
        if (this.city.treeSpots) {
          for (const t of this.city.treeSpots) {
            const dx = cx - t.x, dz = cz - t.z;
            if (dx * dx + dz * dz < t.r * t.r) return true;
          }
        }
      }
      return false;
    };
    let l = 1.2;
    for (let u = sDist; u > 1.2; u -= 0.6) { if (!blockedAt(u)) { l = u; break; } }
    const desired = new THREE.Vector3(p.x - dirX * l * cosP, targetY + l * sinP, p.z - dirZ * l * cosP);
    const k = 1 - Math.exp(-dt * (inCar ? 5 : 7));
    this.camera.position.lerp(desired, k);
    // Claude: hide the player mesh when the camera is right on top of him
    // on foot (l <= 1.6), and always while driving (driver sits in the car).
    // Player is (almost) never hidden on foot: the old l > 1.6 rule hid
    // the hero whenever the camera collapsed against a building/palm — the
    // 'character vanishes in portrait' ilham kept seeing. Camera floor is
    // 1.2, so 1.25 hides only when the camera is inside the player.
    if (this.player && this.player.group) this.player.group.visible = inCar ? false : l > 1.25;
    this.camera.lookAt(p.x, targetY + 0.2, p.z);
    // FOV (Claude): 70 on foot, 70+|speed|*0.45 in car, lerped at dt*4.
    // ADS zooms in: -22 at full aim (70 -> 48), Point Blank style.
    const fovTarget = 70 + (inCar ? carSpeed * 0.45 : 0) - (inCar ? 0 : 22 * (this.ads || 0));
    if (Math.abs(this.camera.fov - fovTarget) > 0.1) {
      this.camera.fov += (fovTarget - this.camera.fov) * Math.min(1, dt * 4);
      this.camera.updateProjectionMatrix();
    }
    // Trauma shake (halved + faster decay — the old shake fired on every
    // gunshot and car hit, so the camera never stopped shaking).
    if (this.trauma > 0.01) {
      this.camera.position.x += (Math.random() - 0.5) * this.trauma * 0.25;
      this.camera.position.y += (Math.random() - 0.5) * this.trauma * 0.2;
      this.trauma = Math.max(0, this.trauma - dt * 2.2);
    }
    // Sun shadow frustum follows the player (position set by updateDayNight).
    if (this.sun) {
      this.sun.target.position.set(p.x, 0, p.z);
      this.sun.target.updateMatrixWorld();
    }
    this.camera.aspect = this.renderer.domElement.clientWidth / Math.max(1, this.renderer.domElement.clientHeight);
    this.camera.updateProjectionMatrix();
  }

  // ------------------------------------------------------------ HUD
  updateHud(force = false) {
    const s = this.state;
    const h = this.hud;
    if (!h.money) return;
    // Contextual E prompt — the mission trigger was invisible (players stood
    // metres from the club door, pressed E, nothing happened).
    if (h.prompt) {
      const p = s.player;
      let txt = '';
      if (s.mission.index < 0 && s.missionAvailable < MISSIONS.length && dist2(p.x, p.z, PLACES.club.x, PLACES.club.y + 8) < 100) txt = 'PRESS E — TALK TO LA ROSA';
      else if (p.onFoot && this.nearestCar(p.x, p.z, 4)) txt = 'PRESS E — GET IN THE CAR';
      else if (p.onFoot && dist2(p.x, p.z, PLACES.dealer.x, PLACES.dealer.y) < 196) txt = 'PRESS E — BROWSE CARS AT AUTO PALMS';
      if (h.prompt.textContent !== txt) h.prompt.textContent = txt;
      h.prompt.style.display = txt ? 'block' : 'none';
    }
    if (this.dealerOpen && !this.nearDealer()) this.closeDealer();
    const money = `$${s.money.toLocaleString('en-US')}`;
    if (force || h.money.textContent !== money) h.money.textContent = money;
    const stars = '★'.repeat(s.wanted) + '☆'.repeat(WANTED_MAX - s.wanted);
    if (force || h.wanted.textContent !== stars) {
      h.wanted.textContent = stars;
      h.wanted.style.color = s.wanted > 0 ? '#ffd166' : '#ffffff88';
    }
    if (h.health) h.health.style.width = `${Math.max(0, s.health)}%`;
    // Objective with STAGE x/y (P2.11).
    const obj = s.mission.index >= 0
      ? `STAGE ${s.mission.step + 1}/${MISSIONS[s.mission.index].steps.length} · ${this.objectiveText()}`
      : this.objectiveText();
    if (force || h.objective.textContent !== obj) h.objective.textContent = obj;
    const msg = this.time < this.message.until ? this.message.text : '';
    if (force || h.message.textContent !== msg) h.message.textContent = msg;
    if (h.message) h.message.style.display = msg ? 'block' : 'none';
    if (h.ammo) {
      const wName = (WEAPONS[s.weapon] && WEAPONS[s.weapon].name) || 'PISTOL';
      h.ammo.textContent = s.weapon === 'fists' ? '👊 FISTS'
        : this.reloadT > 0 ? `🔫 ${wName} RELOADING…`
        : `🔫 ${wName} ${s.mag}/${s.ammo}`;
    }
    // Crosshair: only on foot with a gun. Gap shrinks when aiming (ADS) and
    // grows with firing bloom — Point Blank style.
    const ch = document.getElementById('crosshair');
    if (ch) {
      const showCh = s.player.onFoot && s.weapon !== 'fists' && this.mode === 'play';
      ch.style.display = showCh ? 'block' : 'none';
      if (showCh) {
        const spreadF = (1 - 0.55 * (this.ads || 0)) * (1 + 0.7 * (this.bloom || 0));
        const gap = Math.round(5 + 15 * spreadF);
        ch.style.setProperty('--gap', `${gap}px`);
        ch.classList.toggle('ads', (this.ads || 0) > 0.5);
      }
    }
    if (h.timer) {
      if (s.mission.index >= 0) {
        const def = MISSIONS[s.mission.index];
        const step = def.steps[s.mission.step];
        h.timer.textContent = step && step.time ? `⏱ ${Math.max(0, Math.ceil(step.time - s.mission.timer))}s` : '';
      } else h.timer.textContent = '';
    }
    if (h.speed) {
      const car = s.player.onFoot ? null : this.cars.find((c) => c.id === s.player.carId);
      let line = '';
      if (car) {
        const spec = CAR_MODELS[car.model];
        const gear = Math.min(5, Math.max(1, Math.ceil((Math.abs(car.speed) / (spec.top || 1)) * 5)));
        line = `${spec.name} · COND ${Math.round(car.health)}% · ${Math.round(Math.abs(car.speed) * 3.6)} km/h · G${gear} · NITRO ${Math.round(car.nitro)}%`;
      }
      if (h.speed.textContent !== line) h.speed.textContent = line;
    }
    if (h.fuel && h.fuelWrap) {
      const car = s.player.onFoot ? null : this.cars.find((c) => c.id === s.player.carId);
      if (car) {
        h.fuelWrap.style.display = 'flex';
        h.fuel.style.width = `${Math.max(0, car.fuel)}%`;
        h.fuel.style.background = car.fuel < 20 ? '#ff5544' : '#ffd166';
        h.fuelWrap.title = `Fuel ${Math.round(car.fuel)}% · Damage ${Math.round(100 - car.health)}%`;
      } else {
        h.fuelWrap.style.display = 'none';
      }
    }
    if (h.clock) {
      const hh = Math.floor(s.clock);
      const mm = Math.floor((s.clock - hh) * 60);
      const label = `DAY ${s.day || 1} · ${String(hh).padStart(2, '0')}:${String(mm).padStart(2, '0')}`;
      if (h.clock.textContent !== label) h.clock.textContent = label;
    }
    if (h.rank) {
      const line = `RANK ${s.missionsDone} · ${this.rankTitle()}`;
      if (h.rank.textContent !== line) h.rank.textContent = line;
    }
    if (h.rp) {
      const th = [2, 4, 6, 9, 12];
      const done = s.missionsDone;
      const next = th.find((t) => t > done) ?? 12;
      const prev = [...th].reverse().find((t) => t <= done) ?? 0;
      const pct = next > prev ? Math.min(100, ((done - prev) / (next - prev)) * 100) : 100;
      h.rp.style.width = `${pct}%`;
      const rpWrap = h.rp.parentElement;
      if (rpWrap) rpWrap.title = done >= 12 ? 'Max rank — La Vega Legend' : `Next rank at ${next} jobs (${next - done} to go)`;
    }
    if (h.act) {
      // Staging (P2.11): MISSION n/12 + act name, not just the act.
      const act = s.mission.index >= 0
        ? `MISSION ${s.mission.index + 1}/12 · ${this.actText()}`
        : s.missionAvailable < MISSIONS.length
          ? `NEXT JOB ${s.missionAvailable + 1}/12 · ${this.actText()}`
          : this.actText();
      if (h.act.textContent !== act) h.act.textContent = act;
    }
    if (h.next) {
      const nxt = s.mission.index >= 0 && s.mission.index + 1 < MISSIONS.length
        ? `NEXT: ${MISSIONS[s.mission.index + 1].name}`
        : s.mission.index < 0 && s.missionAvailable < MISSIONS.length
          ? `NEXT: ${MISSIONS[s.missionAvailable].name} — visit La Rosa at the club`
          : '';
      if (h.next.textContent !== nxt) h.next.textContent = nxt;
      h.next.style.display = nxt ? 'block' : 'none';
    }
    // Contextual hint (P2.16): one line of situational advice.
    if (h.hint) {
      let hint = '';
      if (s.wanted > 0 && this.nearestPolice <= 25) hint = 'TIP: DUCK BEHIND COVER — break line of sight!';
      else if (s.wanted > 0 && this.nearestPolice > 45) hint = 'TIP: STAY OUT OF SIGHT — the heat is cooling off.';
      else if (s.health < 35) hint = 'TIP: EAT AT A DINER TO HEAL UP.';
      else if (!s.player.onFoot && (this.cars.find((c) => c.id === s.player.carId) || {}).fuel < 20) hint = 'TIP: FUEL LOW — head to Petro Vega.';
      else if (this.heliInSight) hint = 'TIP: AIR-1 HAS THE SPOTLIGHT ON YOU — get under cover!';
      if (h.hint.textContent !== hint) h.hint.textContent = hint;
      h.hint.style.display = hint ? 'block' : 'none';
    }
    // Crew ability bar: only the hired crew's buttons, with cooldowns.
    if (h.crewBar) {
      const any = s.crew.hacker || s.crew.driver || s.crew.muscle;
      h.crewBar.style.display = any ? 'flex' : 'none';
      if (any) {
        const cd = (k) => Math.max(0, Math.ceil(((this.crewCd || {})[k] || 0) - this.time));
        const setBtn = (el, on, label, k) => {
          if (!el) return;
          el.style.display = on ? 'inline-block' : 'none';
          const left = cd(k);
          const txt = left > 0 ? `${label} ${left}s` : label;
          if (el.textContent !== txt) el.textContent = txt;
          el.disabled = left > 0;
        };
        setBtn(h.crewPlates, s.crew.hacker, 'Z · SWAP PLATES', 'plates');
        setBtn(h.crewFix, s.crew.driver, 'C · QUICK FIX', 'fix');
        setBtn(h.crewEyes, s.crew.muscle, 'G · EYES OUT', 'eyes');
      }
    }
    if (h.district) {
      const d = this.currentDistrict();
      const line = `${d.name} · ${this.currentStreet()} · ${Math.round(s.standing[d.key] || 0)}%`;
      if (h.district.textContent !== line) h.district.textContent = line;
    }
    // Radio station in the HUD (contekan P1.5).
    if (h.radio) {
      const label = `♪ ${this.audio.stationName()}`;
      if (h.radio.textContent !== label) h.radio.textContent = label;
    }
    // Location intro card (contekan P1.7): big district name on entry.
    if (h.locCard) {
      const d = this.currentDistrict();
      if (this.mode === 'play' && d.key !== this.lastDistrictKey) {
        this.lastDistrictKey = d.key;
        h.locName.textContent = d.name;
        h.locSub.textContent = `${this.currentStreet()} · standing ${Math.round(s.standing[d.key] || 0)}%`;
        h.locCard.style.display = 'block';
        this.locationUntil = this.time + 2.5;
      }
      if (this.time > this.locationUntil) h.locCard.style.display = 'none';
    }
    if (h.pauseInfo) {
      const txt = `Standing — MARINA ${Math.round(s.standing.marina)}% · DOWNTOWN ${Math.round(s.standing.downtown)}% · NEON ROW ${Math.round(s.standing.neon)}% · SOUTH BEACH ${Math.round(s.standing.south)}% | Skills — Drive ${Math.floor(s.skills.drive)} · Shoot ${Math.floor(s.skills.shoot)} · Stamina ${Math.floor(s.skills.stamina)} | Packages ${s.collectibles}/10 | Businesses — Bar ${s.businesses.bar ? 'owned' : '—'} · Garage ${s.businesses.garage ? 'owned' : '—'} | Crew — Muscle ${s.crew.muscle ? '✓' : '—'} · Driver ${s.crew.driver ? '✓' : '—'} · Hacker ${s.crew.hacker ? '✓' : '—'}`;
      if (txt !== this.lastSkillsText) { this.lastSkillsText = txt; h.pauseInfo.textContent = txt; }
    }
    if (h.dispatch) {
      if (s.wanted > 0) {
        // Live dispatch board: units + tactic + distance + IN SIGHT.
        const units = this.policeUnits;
        const tactic = this.roadblocks.length > 0 ? 'ROADBLOCK' : this.nearestPolice <= 25 ? 'PURSUING' : 'SEARCHING';
        const sight = this.heliInSight ? '👁 IN SIGHT — AIR-1 OVERHEAD' : this.nearestPolice <= 45 ? '👁 IN SIGHT' : 'HIDDEN — stay out of sight';
        const line = `LVPD DISPATCH · ${units} UNIT${units === 1 ? '' : 'S'} · ${tactic} · ${Math.round(this.nearestPolice)}m · ${sight}`;
        if (h.dispatch.textContent !== line) h.dispatch.textContent = line;
      } else if (this.time > (this.dispatchUntil || 0)) {
        if (h.dispatch.textContent !== '') h.dispatch.textContent = '';
      } else if (h.dispatch.textContent !== this.dispatchText) {
        h.dispatch.textContent = this.dispatchText;
      }
      h.dispatch.style.display = h.dispatch.textContent ? 'block' : 'none';
    }
    // Wanted stars blink while a unit has eyes on you (contekan P1.2).
    if (h.wanted) h.wanted.classList.toggle('insight', s.wanted > 0 && this.nearestPolice <= 45);
    this.drawMinimap();
  }

  drawMinimap() {
    const cv = this.minimap;
    if (!cv) return;
    const g = cv.getContext('2d');
    const W = cv.width, H = cv.height;
    const R = W / 2;
    const scale = W / WORLD.size;
    const X = (x) => x * scale, Z = (z) => z * scale;
    // Round modern map: clip everything to a circle, dark glass background.
    g.save();
    g.beginPath(); g.arc(R, R, R, 0, TAU); g.clip();
    g.clearRect(0, 0, W, H);
    g.fillStyle = 'rgba(10,20,36,0.82)'; g.fillRect(0, 0, W, H);
    // Sea + land + biomes (muted, so roads and markers pop).
    g.fillStyle = '#2f7fb8'; g.fillRect(0, 0, X(WORLD.seaX), H);
    g.fillStyle = '#79b264'; g.fillRect(X(WORLD.seaX), 0, W - X(WORLD.seaX), H);
    g.fillStyle = '#d9c48a'; g.fillRect(X(WORLD.seaX), 0, X(WORLD.sandX - WORLD.seaX), H);
    g.fillStyle = '#3f7a34'; g.fillRect(0, Z(260), W * (260 / WORLD.size), H - Z(260)); // forest (north)
    g.fillStyle = '#ddc07e'; g.fillRect(X(260), 0, W - X(260), H * (260 / WORLD.size)); // desert (east)
    g.fillStyle = '#8a7a68'; g.fillRect(X(260), Z(260), W - X(260), H - Z(260)); // rocky hills (NE)
    // Park.
    if (this.city) {
      const pk = this.city.park;
      g.fillStyle = '#69b455'; g.fillRect(X(pk.x0), Z(pk.z0), X(pk.x1 - pk.x0), Z(pk.z1 - pk.z0));
    }
    // Roads (city grid only — biomes have their own dirt roads).
    g.strokeStyle = 'rgba(255,255,255,0.55)'; g.lineWidth = 1.6;
    for (const r of ROADS) {
      g.beginPath(); g.moveTo(X(r), 0); g.lineTo(X(r), Z(260)); g.stroke();
      g.beginPath(); g.moveTo(0, Z(r)); g.lineTo(X(260), Z(r)); g.stroke();
    }
    // Buildings.
    if (this.city) {
      g.fillStyle = 'rgba(255,255,255,0.28)';
      for (const b of this.city.mapBuildings) g.fillRect(X(b.x - b.w / 2), Z(b.z - b.d / 2), Math.max(1, X(b.w)), Math.max(1, Z(b.d)));
    }
    // Mission marker (pulsing gold diamond).
    const m = this.missionMarker();
    if (m) {
      const pulse = 5 + Math.sin(this.time * 5) * 1.5;
      g.fillStyle = '#ffd166';
      const mx = X(m.x), mz = Z(m.y);
      g.beginPath();
      g.moveTo(mx, mz - pulse); g.lineTo(mx + pulse * 0.8, mz); g.lineTo(mx, mz + pulse); g.lineTo(mx - pulse * 0.8, mz);
      g.closePath(); g.fill();
      g.strokeStyle = 'rgba(255,209,102,0.5)'; g.lineWidth = 1.5;
      g.beginPath(); g.arc(mx, mz, pulse + 4, 0, TAU); g.stroke();
    }
    // Cops (red when the heat is on).
    if (this.state.wanted > 0) {
      g.fillStyle = '#ff4455';
      for (const c of this.cops) { g.beginPath(); g.arc(X(c.x), Z(c.z), 2.5, 0, TAU); g.fill(); }
      for (const c of this.cruisers) { g.beginPath(); g.arc(X(c.x), Z(c.z), 3, 0, TAU); g.fill(); }
    }
    // Player arrow (white with gold outline, rotates with the player).
    const p = this.state.player;
    g.save();
    g.translate(X(p.x), Z(p.z));
    g.rotate(p.angle);
    g.fillStyle = '#ffffff';
    g.strokeStyle = '#ffd166'; g.lineWidth = 1.5;
    g.beginPath(); g.moveTo(7, 0); g.lineTo(-5, -5); g.lineTo(-5, 5); g.closePath(); g.fill(); g.stroke();
    g.restore();
    // North indicator.
    g.fillStyle = 'rgba(255,255,255,0.9)';
    g.font = 'bold 11px Arial'; g.textAlign = 'center'; g.textBaseline = 'top';
    g.fillText('N', R, 5);
    g.restore();
    // Thin outer ring (drawn on top of the clip).
    g.strokeStyle = 'rgba(255,255,255,0.35)'; g.lineWidth = 1.5;
    g.beginPath(); g.arc(R, R, R - 1, 0, TAU); g.stroke();
  }

  // Island bounds (M3c endless map): the player and their car can roam the
  // whole 400 m island + the beach margin, but never walk/drive into the
  // deep sea or the void beyond the sand ring.
  clampToIsland() {
    const s = this.state, p = s.player;
    p.x = clamp(p.x, -30, 430); p.z = clamp(p.z, -30, 430);
    if (!p.onFoot) {
      const car = this.cars.find((c) => c.id === p.carId);
      if (car) { car.x = clamp(car.x, -30, 430); car.z = clamp(car.z, -30, 430); p.x = car.x; p.z = car.z; }
    }
  }

  render() {
    this.renderer.render(this.scene, this.camera);
  }

  // ------------------------------------------------------------ shots
  // Stage a deterministic screenshot scene. Called before rendering frames.
  stageShot(name) {
    this.shotMode = name;
    this.reset();
    const s = this.state;
    const p = s.player;
    // Golden hour for dossier shots: dusk light, rose sky, long shadows —
    // far prettier than plain noon. (M-H.)
    s.clock = 17.6;
    this.updateDayNight(0);
    if (this.hud.title) this.hud.title.style.display = 'none';
    if (this.hud.pause) this.hud.pause.style.display = 'none';
    if (this.hud.end) this.hud.end.style.display = 'none';
    // Credits screen is display:flex by default (CSS) — hide it here too,
    // or it covers the shot (same bug as startPlay, fixed in M2, but the
    // shot path bypasses startPlay).
    const credits = document.getElementById('credits-screen');
    if (credits) credits.style.display = 'none';
    this.mode = 'play';
    if (name === 'cover') {
      // Cruising the central boulevard in the red sport car, 1 star.
      const car = this.cars.find((c) => c.model === 'sport' && c.parked);
      p.x = 117; p.z = 91; p.angle = 0;
      p.onFoot = false; p.carId = car.id; car.isPlayer = true; car.parked = false;
      car.x = 117; car.z = 91; car.angle = 0; car.speed = 18;
      car.mesh.position.set(car.x, 0, car.z); car.mesh.rotation.y = carRotationY(car);
      this.player.group.visible = false;
      s.wanted = 1;
      this.camYaw = 0;
      this.spawnPolice();
    } else if (name === 'chase') {
      // Beach chase: player speeds south along the sand, cruisers on his tail,
      // camera over the open sea so nothing blocks the shot.
      const car = this.cars.find((c) => c.model === 'sport' && c.parked);
      p.x = 23; p.z = 100; p.angle = Math.PI / 2;
      p.onFoot = false; p.carId = car.id; car.isPlayer = true; car.parked = false;
      car.x = 23; car.z = 100; car.angle = Math.PI / 2; car.speed = 24;
      car.mesh.position.set(car.x, 0, car.z); car.mesh.rotation.y = carRotationY(car);
      this.player.group.visible = false;
      s.wanted = 3;
      this.camYaw = Math.PI / 2;
      this.spawnPolice();
      // Pull cruisers in close behind (north of the player).
      this.cruisers.forEach((c, i) => {
        c.x = 23 + (i % 2 ? 2.5 : -2.5);
        c.z = 100 - (8 + i * 6);
        c.angle = Math.PI / 2; c.speed = 26;
        c.mesh.position.set(c.x, 0, c.z); c.mesh.rotation.y = carRotationY(c);
      });
      this.shotCamMode = 'chase'; // side-tracking cinematic camera
    } else if (name === 'mission') {
      // Dock Run pickup at Pier 9 — standing on the pier, sea behind.
      this.startMission(1);
      p.x = 10; p.z = 138; p.angle = -Math.PI / 2;
      this.player.group.position.set(p.x, 0, p.z);
      this.player.group.rotation.y = Math.PI / 2 - p.angle;
      this.player.animate(0.016, 0.4);
      this.camYaw = -Math.PI / 2 + 0.35;
      s.hasPistol = true; s.ammo = 24;
      this.shotCamMode = 'mission'; // side view: pier + player + beacon + sea
    } else if (name === 'city') {
      // On foot by Palm Court Park, pedestrians and a boosted sedan at the kerb.
      p.x = 100; p.z = 84; p.angle = Math.PI / 2;
      this.player.group.position.set(p.x, 0, p.z);
      this.player.group.rotation.y = Math.PI / 2 - p.angle;
      this.camYaw = Math.PI / 2 - 0.4;
      this.shotCamMode = 'city'; // high 3/4 view over the park trees (see updateCamera)
      const car = this.cars.find((c) => c.model === 'sedan' && c.parked);
      if (car) { car.x = 112; car.z = 94; car.angle = Math.PI / 2; car.mesh.position.set(car.x, 0, car.z); car.mesh.rotation.y = carRotationY(car); }
      // Peds nearby, on the sidewalk north of the z=91 road (z 85.9..87.5)
      // — never in the middle of the road.
      this.peds.slice(0, 6).forEach((ped, i) => {
        ped.x = 96 + i * 2.5; ped.z = 86.7;
        ped.h.group.position.set(ped.x, 0, ped.z);
      });
    }
    // Let the world settle for a few frames, then snap the camera in tight.
    for (let i = 0; i < 30; i += 1) {
      this.updateAmbient(STEP);
      this.updateCamera(STEP);
    }
    this.updateCamera(1);
    this.updateCamera(1);
    this.updateHud(true);
    this.render();
  }
}
