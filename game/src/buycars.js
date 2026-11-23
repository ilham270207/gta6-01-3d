// LA VEGA 3D — buy-car GLB models (Poly Pizza, CC0/CC-BY).
// Fetched from game/models/cars/ on http(s) (GitHub Pages serves them); on
// file:// the loader skips silently and the dealer falls back to the 4
// procedural/Quaternius models. Written in this session (total rewrite),
// not copied from the Claude file.
// Wheel handling mirrors cloneQuaterniusCar: named wheel meshes get their
// geometry cloned + re-centred on the axle so spinWheels() can rotate them
// around local X. Models whose wheels are merged with the body simply have
// no spinnable wheels (same as the procedural truck).
import * as THREE from 'three';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';

// key, file, wheel matcher ('wheel' = /wheel/i, 'rim' = /rim|rubber/i,
// 'tire' = small meshes near the ground, 'none' = wheels merged with body),
// nonUniform: [sx, sy, sz] multipliers applied AFTER the uniform length
// scale (dominus is almost square, vip sedan is off-centre + van-shaped).
export const BUYCAR_DEFS = [
  { key: 'wedge', file: 'supercar-wedge-purple.glb', wheels: 'none' },
  { key: 'dominus', file: 'supercar-dominus.glb', wheels: 'none', nonUniform: [0.52, 1, 1] },
  { key: 'muscle', file: 'muscle-yellow.glb', wheels: 'wheel' },
  { key: 'sedansport', file: 'sports-sedan-orange.glb', wheels: 'wheel' },
  { key: 'hatch', file: 'hatchback-grey.glb', wheels: 'rim' },
  { key: 'sportster', file: 'sportster-white.glb', wheels: 'tire' },
  { key: 'f1', file: 'racecar-f1.glb', wheels: 'none' },
  { key: 'convblue', file: 'convertible-blue.glb', wheels: 'none' },
  { key: 'convpink', file: 'convertible-wedge-pink.glb', wheels: 'wheel' },
  { key: 'roadster', file: 'convertible-roadster.glb', wheels: 'none', filterRoad: true },
  { key: 'vip', file: 'sedan-red-vip.glb', wheels: 'none', nonUniform: [0.7, 0.67, 1] },
];

export const BUYCARS = { ok: false, cars: {} };

const _loader = new GLTFLoader();

function withTimeout(promise, ms, label) {
  return Promise.race([
    promise,
    new Promise((_, reject) => setTimeout(() => reject(new Error(`timeout ${label}`)), ms)),
  ]);
}

export async function loadBuyCars() {
  if (location.protocol === 'file:') {
    console.log('[buycars] file:// — skipping fetch, dealer uses procedural models');
    return 0;
  }
  let okCount = 0;
  for (const def of BUYCAR_DEFS) {
    try {
      const gltf = await withTimeout(
        _loader.loadAsync(`models/cars/${def.file}`), 20000, def.file,
      );
      BUYCARS.cars[def.key] = gltf;
      okCount += 1;
      console.log(`[buycars] ${def.key}: loaded (${gltf.scene.children.length} roots)`);
    } catch (e) {
      console.warn(`[buycars] ${def.key} FAILED:`, e?.message || e);
    }
  }
  BUYCARS.ok = okCount > 0;
  console.log(`[buycars] loaded ${okCount}/${BUYCAR_DEFS.length} models`);
  return okCount;
}

// Remove flat road-slab meshes (convertible-roadster ships with a piece of
// road: a thin wide slab sitting at y≈0). Heuristic: very flat, wide, and
// at the very bottom — no real car part looks like that.
function filterRoadSlabs(group) {
  const doomed = [];
  group.traverse(o => {
    if (!o.isMesh) return;
    o.geometry.computeBoundingBox();
    const bb = o.geometry.boundingBox;
    const h = bb.max.y - bb.min.y;
    const w = Math.max(bb.max.x - bb.min.x, bb.max.z - bb.min.z);
    const worldMinY = o.position.y + bb.min.y;
    if (h < 0.06 && w > 1.0 && worldMinY < 0.05) doomed.push(o);
  });
  for (const o of doomed) {
    if (o.parent) o.parent.remove(o);
  }
  return doomed.length;
}

function recenterWheel(o) {
  o.geometry = o.geometry.clone();
  o.geometry.computeBoundingBox();
  const bb = o.geometry.boundingBox;
  const cx = (bb.min.x + bb.max.x) / 2;
  const cy = (bb.min.y + bb.max.y) / 2;
  const cz = (bb.min.z + bb.max.z) / 2;
  o.geometry.translate(-cx, -cy, -cz);
  o.position.set(cx, cy, cz);
}

// Clone a buy-car template, normalized to face +Z with `targetLen` along Z,
// re-centred and grounded (minY = 0). Returns { group, wheels } or null.
export function cloneBuyCar(key, targetLen) {
  const def = BUYCAR_DEFS.find(d => d.key === key);
  const gltf = def && BUYCARS.cars[key];
  if (!gltf) return null;
  const group = gltf.scene.clone(true);
  group.traverse(o => { if (o.isMesh) { o.castShadow = true; o.receiveShadow = true; } });
  if (def.filterRoad) filterRoadSlabs(group);
  // Face +Z: if the longest horizontal axis is X, rotate 90° so length is Z.
  let box = new THREE.Box3().setFromObject(group);
  const sx = box.max.x - box.min.x;
  const sz = box.max.z - box.min.z;
  if (sx > sz) {
    group.rotation.y = Math.PI / 2;
    group.updateMatrixWorld(true);
    box = new THREE.Box3().setFromObject(group);
  }
  // Scale to the target length (uniform), then the per-model non-uniform fix.
  const len = box.max.z - box.min.z;
  if (len > 0.01 && targetLen > 0) {
    const k = targetLen / len;
    group.scale.setScalar(k);
    if (def.nonUniform) {
      group.scale.x *= def.nonUniform[0];
      group.scale.y *= def.nonUniform[1];
      group.scale.z *= def.nonUniform[2];
    }
    group.updateMatrixWorld(true);
  }
  // Re-centre X/Z on 0 and ground minY to 0 (vip sedan's bbox is off-centre).
  // NOTE (M-G bugfix): the offset must be converted to the group's LOCAL
  // space — children positions are local, but the box is in world space.
  // Subtracting world units from local positions under-corrects by the
  // scale factor (k ~ 0.5 left the Countach floating 1.13 m in the air).
  // worldToLocal accounts for the 90 deg rotation + non-uniform scale.
  box = new THREE.Box3().setFromObject(group);
  const target = new THREE.Vector3((box.min.x + box.max.x) / 2, box.min.y, (box.min.z + box.max.z) / 2);
  const local = group.worldToLocal(target.clone());
  for (const c of group.children) { c.position.x -= local.x; c.position.y -= local.y; c.position.z -= local.z; }
  group.updateMatrixWorld(true);
  // Collect spinnable wheels.
  const wheels = [];
  group.traverse(o => {
    if (!o.isMesh) return;
    let isWheel = false;
    if (def.wheels === 'wheel') isWheel = /wheel/i.test(o.name);
    else if (def.wheels === 'rim') isWheel = /rim|rubber/i.test(o.name);
    else if (def.wheels === 'tire') {
      o.geometry.computeBoundingBox();
      const bb = o.geometry.boundingBox;
      const dims = [bb.max.x - bb.min.x, bb.max.y - bb.min.y, bb.max.z - bb.min.z];
      isWheel = dims.every(d => d < 0.3) && o.position.y < 0.4;
    }
    if (!isWheel) return;
    recenterWheel(o);
    wheels.push(o);
  });
  return { group, wheels };
}
