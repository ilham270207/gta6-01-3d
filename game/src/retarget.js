// Retarget Quaternius animation clips onto ilham's NEW character GLBs
// (Male_0_k6kg.glb / Female_1_h08g.glb — UE5-style rig, 0 animations).
// Written in this session from the two rigs' bone structures (read from the
// GLB JSON chunks), NOT copied from any other retarget code.
//
// Method — rest-pose-corrected world-space retarget, bones processed in
// hierarchy order (parents first) so each bone's local rotation is computed
// against its parent's *retargeted* world rotation at the same frame:
//   desiredWorld(t) = Qt_rest * (Qs_rest^-1 * Qs(t))
//   local(t)        = parentWorld(t)^-1 * desiredWorld(t)
// where Qs(t) is the source bone's world quaternion sampled at 30 fps with
// an AnimationMixer. This works for any rest-pose difference (Quaternius
// vs UE5 mannequin) because every quantity is measured in world space.
// Root motion: the source "Body" translation track is copied to the target
// "pelvis" position track (converted to pelvis-local space), scaled by
// (targetHeight / sourceHeight).
import * as THREE from 'three';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import { clone as cloneSkinned } from 'three/addons/utils/SkeletonUtils.js';
import { findClip } from './quaternius.js';

// Quaternius (source) bone name -> new-model (target) bone name.
// Order matters: parents before children.
// NOTE: names are the RUNTIME names. GLTFLoader sanitizes node names via
// PropertyBinding.sanitizeNodeName, which strips dots — so 'Shoulder.L'
// is 'ShoulderL' by the time the scene exists (same for 'Foot.L' -> 'FootL').
const BONE_MAP = {
  Body: 'pelvis',
  Hips: 'spine_01',
  Abdomen: 'spine_02',
  Torso: 'spine_03',
  Neck: 'neck_01',
  Head: 'Head',
  ShoulderL: 'clavicle_l',
  UpperArmL: 'upperarm_l',
  LowerArmL: 'lowerarm_l',
  PalmL: 'hand_l',
  ShoulderR: 'clavicle_r',
  UpperArmR: 'upperarm_r',
  LowerArmR: 'lowerarm_r',
  PalmR: 'hand_r',
  UpperLegL: 'thigh_l',
  LowerLegL: 'calf_l',
  FootL: 'foot_l',
  UpperLegR: 'thigh_r',
  LowerLegR: 'calf_r',
  FootR: 'foot_r',
};

const _qa = new THREE.Quaternion();
const _qb = new THREE.Quaternion();
const _qc = new THREE.Quaternion();
const _v1 = new THREE.Vector3();

function boneByName(root, name) {
  let found = null;
  root.traverse((o) => { if (!found && o.isBone && o.name === name) found = o; });
  return found;
}

// Sample one source clip onto the target skeleton. Returns a THREE.AnimationClip
// whose tracks are named after the TARGET bones, or null on failure.
export function retargetClip(srcClip, srcRoot, tgtRoot, heightScale) {
  srcRoot.updateMatrixWorld(true);
  tgtRoot.updateMatrixWorld(true);
  const pairs = [];
  for (const [srcName, tgtName] of Object.entries(BONE_MAP)) {
    const sb = boneByName(srcRoot, srcName);
    const tb = boneByName(tgtRoot, tgtName);
    if (!sb || !tb) continue;
    pairs.push({
      sb, tb,
      srcRest: sb.getWorldQuaternion(new THREE.Quaternion()),
      tgtRest: tb.getWorldQuaternion(new THREE.Quaternion()),
      parentRestWorld: tb.parent ? tb.parent.getWorldQuaternion(new THREE.Quaternion()) : new THREE.Quaternion(),
      parentRestPos: tb.parent ? tb.parent.getWorldPosition(new THREE.Vector3()) : new THREE.Vector3(),
      parentPair: null,
    });
  }
  if (pairs.length < 10) return null;
  for (const p of pairs) {
    p.parentPair = pairs.find((q) => q.tb === p.tb.parent) || null;
  }
  const bodyPair = pairs.find((p) => p.sb.name === 'Body') || null;
  const bodyRestPos = bodyPair ? bodyPair.sb.getWorldPosition(new THREE.Vector3()) : null;
  const pelvisRestPos = bodyPair ? bodyPair.tb.getWorldPosition(new THREE.Vector3()) : null;

  // Pose a clone of the source rig and sample at 30 fps.
  const srcClone = cloneSkinned(srcRoot);
  const mixer = new THREE.AnimationMixer(srcClone);
  const action = mixer.clipAction(srcClip);
  action.play();
  const cloneBones = new Map();
  srcClone.traverse((o) => { if (o.isBone) cloneBones.set(o.name, o); });
  const fps = 30;
  const frames = Math.max(2, Math.round(srcClip.duration * fps) + 1);
  const times = new Float32Array(frames);
  const quatData = new Map();
  for (const p of pairs) quatData.set(p.tb, new Float32Array(frames * 4));
  const posData = bodyPair ? new Float32Array(frames * 3) : null;
  const frameWorld = new Map();

  for (let f = 0; f < frames; f += 1) {
    const t = Math.min(srcClip.duration, f / fps);
    times[f] = t;
    mixer.setTime(t);
    mixer.update(0);
    srcClone.updateMatrixWorld(true);
    frameWorld.clear();
    for (const p of pairs) {
      const cb = cloneBones.get(p.sb.name);
      if (!cb) continue;
      cb.getWorldQuaternion(_qa); // Qs(t)
      _qb.copy(p.srcRest).invert().multiply(_qa); // delta = Qs_rest^-1 * Qs(t)
      _qc.copy(p.tgtRest).multiply(_qb); // desired world = Qt_rest * delta
      frameWorld.set(p.tb, _qc.clone());
      const pw = p.parentPair ? frameWorld.get(p.parentPair.tb) : p.parentRestWorld;
      _qc.premultiply(_qa.copy(pw).invert()); // local = parentWorld(t)^-1 * world
      const arr = quatData.get(p.tb);
      arr[f * 4] = _qc.x; arr[f * 4 + 1] = _qc.y; arr[f * 4 + 2] = _qc.z; arr[f * 4 + 3] = _qc.w;
    }
    if (bodyPair && posData) {
      const cb = cloneBones.get('Body');
      cb.getWorldPosition(_v1);
      // pelvis world(t) = pelvisRest + (body(t) - bodyRest) * heightScale
      _v1.x = pelvisRestPos.x + (_v1.x - bodyRestPos.x) * heightScale;
      _v1.y = pelvisRestPos.y + (_v1.y - bodyRestPos.y) * heightScale;
      _v1.z = pelvisRestPos.z + (_v1.z - bodyRestPos.z) * heightScale;
      // ...then to pelvis-local space (parent = root, static).
      _v1.sub(bodyPair.parentRestPos);
      _v1.applyQuaternion(_qa.copy(bodyPair.parentRestWorld).invert());
      posData[f * 3] = _v1.x; posData[f * 3 + 1] = _v1.y; posData[f * 3 + 2] = _v1.z;
    }
  }
  mixer.stopAllAction();

  const tracks = [];
  for (const p of pairs) {
    tracks.push(new THREE.QuaternionKeyframeTrack(`${p.tb.name}.quaternion`, times, quatData.get(p.tb)));
  }
  if (bodyPair && posData) {
    tracks.push(new THREE.VectorKeyframeTrack('pelvis.position', times, posData));
  }
  return new THREE.AnimationClip(srcClip.name, srcClip.duration, tracks);
}

// Load one new character GLB via fetch (NOT embedded — the files are ~16 MB
// each and would blow the 20 MB game budget), retarget the four Quaternius
// clips onto it, and normalize its height to 1.8 m.
// Returns { group, mixer, actions, clips, normScale } like cloneQuaterniusChar,
// or null on failure (caller falls back to Quaternius).
export async function loadRetargetedCharacter(url, srcGltf) {
  // Hard timeout: a stalled fetch/parse (e.g. huge PNG textures in a slow
  // headless renderer) must NEVER hang the boot — fall back to Quaternius.
  const timeout = (ms) => new Promise((_, reject) => setTimeout(() => reject(new Error(`timeout ${ms}ms for ${url}`)), ms));
  try {
    const res = await Promise.race([fetch(url), timeout(25000)]);
    if (!res.ok) throw new Error(`HTTP ${res.status} for ${url}`);
    const buf = await res.arrayBuffer();
    const loader = new GLTFLoader();
    const tgtGltf = await Promise.race([
      new Promise((resolve, reject) => { loader.parse(buf, '', resolve, reject); }),
      timeout(25000),
    ]);
    const tgtScene = tgtGltf.scene;
    tgtScene.updateMatrixWorld(true);
    const tgtBox = new THREE.Box3().setFromObject(tgtScene);
    const tgtH = tgtBox.max.y - tgtBox.min.y;
    srcGltf.scene.updateMatrixWorld(true);
    const srcBox = new THREE.Box3().setFromObject(srcGltf.scene);
    const srcH = srcBox.max.y - srcBox.min.y;
    const heightScale = tgtH > 0.01 && srcH > 0.01 ? tgtH / srcH : 1;

    const group = cloneSkinned(tgtScene);
    group.traverse((o) => { if (o.isMesh) { o.castShadow = true; o.receiveShadow = true; } });
    // Normalize height to 1.8 m, feet on the ground.
    let normScale = 1;
    group.updateMatrixWorld(true);
    const box = new THREE.Box3().setFromObject(group);
    const h = box.max.y - box.min.y;
    if (h > 0.01) {
      normScale = 1.8 / h;
      group.scale.setScalar(normScale);
      group.updateMatrixWorld(true);
      const box2 = new THREE.Box3().setFromObject(group);
      if (Math.abs(box2.min.y) > 0.001) {
        for (const c of group.children) c.position.y -= box2.min.y;
        group.updateMatrixWorld(true);
      }
    }
    // Retarget the four gameplay clips from the Quaternius source.
    const mixer = new THREE.AnimationMixer(group);
    const anims = srcGltf.animations;
    const srcClips = {
      idle: findClip(anims, 'idle'),
      walk: findClip(anims, 'walk'),
      run: findClip(anims, 'run'),
      punch: findClip(anims, 'punch'),
    };
    const actions = {};
    const clips = {};
    for (const [k, clip] of Object.entries(srcClips)) {
      if (!clip) continue;
      const ret = retargetClip(clip, srcGltf.scene, tgtScene, heightScale);
      if (!ret) continue;
      clips[k] = ret;
      const a = mixer.clipAction(ret);
      a.setLoop(THREE.LoopRepeat, Infinity);
      if (k === 'punch') a.setLoop(THREE.LoopOnce, 1);
      actions[k] = a;
    }
    if (actions.idle) actions.idle.play();
    console.log(`[retarget] ${url}: height ${tgtH.toFixed(2)}m (src ${srcH.toFixed(2)}m), clips: ${Object.keys(actions).join(',')}`);
    return { group, mixer, actions, clips, normScale };
  } catch (e) {
    console.warn(`[retarget] failed for ${url}:`, e);
    return null;
  }
}
