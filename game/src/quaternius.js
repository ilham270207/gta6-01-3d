// Quaternius GLB model loader (base64-embedded, no fetch — file:// safe).
// Parses the embedded GLBs once at boot and hands out SkeletonUtils clones.
import * as THREE from 'three';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import { clone as cloneSkinned } from 'three/addons/utils/SkeletonUtils.js';
import {
  Q_JAX_B64, Q_LAROSA_B64, Q_NPC_MALE_B64, Q_NPC_FEMALE_B64,
  Q_CAR_SPORT_B64, Q_CAR_SEDAN_B64, Q_CAR_SUV_B64, Q_CAR_TAXI_B64, Q_CAR_POLICE_B64,
  Q_CAR_PICKUP_B64, Q_PALM_B64,
  Q_WPN_PISTOL_B64, Q_WPN_SMG_B64, Q_WPN_SHOTGUN_B64, Q_WPN_RIFLE_B64,
} from './quaternius-data.js';

const _loader = new GLTFLoader();

function b64ToArrayBuffer(b64) {
  const bin = atob(b64);
  const len = bin.length;
  const bytes = new Uint8Array(len);
  for (let i = 0; i < len; i++) bytes[i] = bin.charCodeAt(i);
  return bytes.buffer;
}

function parseGLB(b64) {
  return new Promise((resolve, reject) => {
    _loader.parse(b64ToArrayBuffer(b64), '', resolve, reject);
  });
}

// Find an animation clip whose last name segment ends with the suffix
// (e.g. "HumanArmature|Man_Walk" -> "Man_Walk" ends with "walk").
// Falls back to any clip whose name contains the suffix.
export function findClip(animations, suffix) {
  const s = suffix.toLowerCase();
  let c = animations.find(a => a.name.split('|').pop().toLowerCase().endsWith(s));
  if (!c) c = animations.find(a => a.name.toLowerCase().includes(s));
  return c || null;
}

// Loaded Quaternius templates (parsed GLTFs). null until loadQuaternius() runs.
export const Q = {
  chars: { jax: null, laRosa: null, npcMale: null, npcFemale: null },
  cars: { sport: null, sedan: null, suv: null, taxi: null, police: null, pickup: null },
  trees: { palm: null },
  weapons: { pistol: null, smg: null, shotgun: null, rifle: null },
  ok: false,
};

// Parse every embedded GLB once. Never throws: a failed model just stays null
// and callers fall back to the procedural equivalents.
export async function loadQuaternius() {
  const jobs = [
    ['chars.jax', Q_JAX_B64, 'chars', 'jax'],
    ['chars.laRosa', Q_LAROSA_B64, 'chars', 'laRosa'],
    ['chars.npcMale', Q_NPC_MALE_B64, 'chars', 'npcMale'],
    ['chars.npcFemale', Q_NPC_FEMALE_B64, 'chars', 'npcFemale'],
    ['cars.sport', Q_CAR_SPORT_B64, 'cars', 'sport'],
    ['cars.sedan', Q_CAR_SEDAN_B64, 'cars', 'sedan'],
    ['cars.suv', Q_CAR_SUV_B64, 'cars', 'suv'],
    ['cars.taxi', Q_CAR_TAXI_B64, 'cars', 'taxi'],
    ['cars.police', Q_CAR_POLICE_B64, 'cars', 'police'],
    ['cars.pickup', Q_CAR_PICKUP_B64, 'cars', 'pickup'],
    ['trees.palm', Q_PALM_B64, 'trees', 'palm'],
    ['weapons.pistol', Q_WPN_PISTOL_B64, 'weapons', 'pistol'],
    ['weapons.smg', Q_WPN_SMG_B64, 'weapons', 'smg'],
    ['weapons.shotgun', Q_WPN_SHOTGUN_B64, 'weapons', 'shotgun'],
    ['weapons.rifle', Q_WPN_RIFLE_B64, 'weapons', 'rifle'],
  ];
  let okCount = 0;
  for (const [label, b64, group, key] of jobs) {
    try {
      const gltf = await parseGLB(b64);
      Q[group][key] = gltf;
      okCount++;
      // Log clip names for characters (useful for debugging animation wiring).
      if (group === 'chars') {
        console.log(`[quaternius] ${label}: ${gltf.scene.children.length} roots, ${gltf.animations.length} clips: ${gltf.animations.map(a => a.name.split('|').pop()).join(', ')}`);
      } else {
        console.log(`[quaternius] ${label}: loaded (${gltf.scene.children.length} roots)`);
      }
    } catch (e) {
      console.warn(`[quaternius] ${label} FAILED to parse:`, e);
      Q[group][key] = null;
    }
  }
  Q.ok = okCount > 0;
  console.log(`[quaternius] loaded ${okCount}/${jobs.length} models`);
  return Q;
}

// Clone a character template: returns { group, mixer, actions:{idle,walk,run,punch}, bones, normScale }.
// actions are AnimationAction objects (idle playing by default). Returns null
// if the template is missing.
//
// SCALE NORMALIZATION: Quaternius male rigs are authored ~4.8 m tall while
// the females are ~1.8 m — the game world is in metres with a ~1.8 m human.
// The whole rig is scaled so its standing height is 1.8 m, feet on the
// ground (minY = 0). The factor is measured per model, never hardcoded.
export function cloneQuaterniusChar(gltf) {
  if (!gltf) return null;
  const group = cloneSkinned(gltf.scene);
  group.traverse(o => { if (o.isMesh) { o.castShadow = true; o.receiveShadow = true; } });
  let normScale = 1;
  group.updateMatrixWorld(true);
  const box = new THREE.Box3().setFromObject(group);
  const h = box.max.y - box.min.y;
  if (h > 0.01) {
    normScale = 1.8 / h;
    group.scale.setScalar(normScale);
    group.updateMatrixWorld(true);
    // Re-ground: shift the inner content so the lowest point sits at y = 0.
    const box2 = new THREE.Box3().setFromObject(group);
    if (Math.abs(box2.min.y) > 0.001) {
      for (const c of group.children) c.position.y -= box2.min.y;
      group.updateMatrixWorld(true);
    }
  }
  const mixer = new THREE.AnimationMixer(group);
  const anims = gltf.animations;
  const clips = {
    idle: findClip(anims, 'idle'),
    walk: findClip(anims, 'walk'),
    run: findClip(anims, 'run'),
    punch: findClip(anims, 'punch'),
  };
  const actions = {};
  for (const [k, clip] of Object.entries(clips)) {
    if (!clip) continue;
    const a = mixer.clipAction(clip);
    a.setLoop(THREE.LoopRepeat, Infinity);
    if (k === 'punch') a.setLoop(THREE.LoopOnce, 1);
    actions[k] = a;
  }
  if (actions.idle) actions.idle.play();
  return { group, mixer, actions, clips, normScale };
}

// Clone a car template: returns { group, wheels } where wheels are Mesh nodes
// re-centered on their own axle so rotating them around local X spins the wheel.
// Returns null if the template is missing.
export function cloneQuaterniusCar(gltf) {
  if (!gltf) return null;
  const group = gltf.scene.clone(true);
  group.traverse(o => { if (o.isMesh) { o.castShadow = true; o.receiveShadow = true; } });
  const wheels = [];
  group.traverse(o => {
    if (!o.isMesh || !/wheel/i.test(o.name)) return;
    // CRITICAL: wheel meshes in the GLB share ONE geometry object (left and
    // right wheels reference the same Cylinder). Translating the geometry
    // in place for wheel #1 would also move wheel #2's vertices, so the
    // second wheel ends up collapsed inside the body. Clone per mesh first.
    o.geometry = o.geometry.clone();
    // Re-center geometry on the wheel axle: bbox center -> mesh position,
    // geometry translated so the mesh spins around its own center (local X).
    o.geometry.computeBoundingBox();
    const bb = o.geometry.boundingBox;
    const cx = (bb.min.x + bb.max.x) / 2;
    const cy = (bb.min.y + bb.max.y) / 2;
    const cz = (bb.min.z + bb.max.z) / 2;
    o.geometry.translate(-cx, -cy, -cz);
    o.position.set(cx, cy, cz);
    wheels.push(o);
  });
  return { group, wheels };
}

// Clone a weapon template (small GLB, no animations). Returns the group or null.
export function cloneQuaterniusWeapon(gltf) {
  if (!gltf) return null;
  const group = gltf.scene.clone(true);
  group.traverse(o => { if (o.isMesh) { o.castShadow = true; } });
  return group;
}
