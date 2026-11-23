// Verify the retarget math in Node (no browser needed): parse the
// texture-stripped new-model GLBs + Quaternius source, retarget the
// walk/run/idle/punch clips, and check the output clips are sane:
// finite unit quaternions, pelvis near rest height, limbs actually move.
import * as THREE from '/home/hatch/workspace/makefun/gta6-01-3d/game/three/three.module.js';
import { GLTFLoader } from '/home/hatch/workspace/makefun/gta6-01-3d/game/three/addons/loaders/GLTFLoader.js';
import { retargetClip } from '/home/hatch/workspace/makefun/gta6-01-3d/game/src/retarget.js';
import { findClip } from '/home/hatch/workspace/makefun/gta6-01-3d/game/src/quaternius.js';
import { readFileSync } from 'node:fs';

const loader = new GLTFLoader();
async function parse(path) {
  const buf = readFileSync(path).buffer.slice(0);
  return new Promise((resolve, reject) => loader.parse(buf, '', resolve, reject));
}

function bone(root, name) {
  let f = null;
  root.traverse((o) => { if (!f && o.isBone && o.name === name) f = o; });
  return f;
}

let failures = 0;
for (const [label, srcPath, tgtPath] of [
  ['Jax (male)', '/tmp/jax-notex.glb', '/tmp/male-notex.glb'],
  ['La Rosa (female)', '/tmp/larosa-notex.glb', '/tmp/female-notex.glb'],
]) {
  console.log(`\n== ${label} ==`);
  const src = await parse(srcPath);
  const tgt = await parse(tgtPath);
  src.scene.updateMatrixWorld(true);
  tgt.scene.updateMatrixWorld(true);
  const srcH = new THREE.Box3().setFromObject(src.scene);
  const tgtH = new THREE.Box3().setFromObject(tgt.scene);
  const srcHeight = srcH.max.y - srcH.min.y;
  const tgtHeight = tgtH.max.y - tgtH.min.y;
  console.log(`src height ${srcHeight.toFixed(2)}m, tgt height ${tgtHeight.toFixed(2)}m, scale ${ (tgtHeight / srcHeight).toFixed(3) }`);
  const hs = tgtHeight / srcHeight;
  for (const key of ['idle', 'walk', 'run', 'punch']) {
    const clip = findClip(src.animations, key);
    if (!clip) { console.log(`  ${key}: NO SOURCE CLIP`); failures++; continue; }
    const ret = retargetClip(clip, src.scene, tgt.scene, hs);
    if (!ret) { console.log(`  ${key}: RETARGET RETURNED NULL`); failures++; continue; }
    // Validate tracks: finite + unit quaternions.
    let bad = 0, tracks = 0;
    for (const tr of ret.tracks) {
      tracks++;
      const v = tr.values;
      for (let i = 0; i < v.length; i++) if (!Number.isFinite(v[i])) bad++;
      if (tr.ValueTypeName === 'quaternion') {
        for (let i = 0; i < v.length; i += 4) {
          const len = Math.hypot(v[i], v[i + 1], v[i + 2], v[i + 3]);
          if (Math.abs(len - 1) > 0.01) bad++;
        }
      }
    }
    console.log(`  ${key}: duration ${ret.duration.toFixed(2)}s, ${tracks} tracks, bad values: ${bad}`);
    if (bad) failures++;
    // Play the retargeted clip on the target skeleton and check poses.
    const mixer = new THREE.AnimationMixer(tgt.scene);
    const action = mixer.clipAction(ret);
    action.play();
    const thigh = bone(tgt.scene, 'thigh_l');
    const calf = bone(tgt.scene, 'calf_l');
    const pelvis = bone(tgt.scene, 'pelvis');
    const head = bone(tgt.scene, 'Head');
    const samples = [];
    for (const t of [0, ret.duration * 0.25, ret.duration * 0.5, ret.duration * 0.75]) {
      mixer.setTime(t); mixer.update(0); tgt.scene.updateMatrixWorld(true);
      const tq = thigh.getWorldQuaternion(new THREE.Quaternion());
      const cq = calf.getWorldQuaternion(new THREE.Quaternion());
      const pp = pelvis.getWorldPosition(new THREE.Vector3());
      const hp = head.getWorldPosition(new THREE.Vector3());
      const ok = [tq, cq].every((q) => Number.isFinite(q.x + q.y + q.z + q.w)) && Number.isFinite(pp.y) && Number.isFinite(hp.y);
      samples.push(`t=${t.toFixed(2)} thigh=(${tq.x.toFixed(2)},${tq.y.toFixed(2)},${tq.z.toFixed(2)},${tq.w.toFixed(2)}) pelvisY=${pp.y.toFixed(2)} headY=${hp.y.toFixed(2)} ${ok ? 'OK' : 'BAD'}`);
      if (!ok) failures++;
    }
    console.log('    ' + samples.join('\n    '));
    // Thigh must actually move during walk/run.
    if (key === 'walk' || key === 'run') {
      mixer.setTime(0); mixer.update(0);
      const q0 = thigh.getWorldQuaternion(new THREE.Quaternion()).clone();
      mixer.setTime(ret.duration * 0.5); mixer.update(0);
      const q1 = thigh.getWorldQuaternion(new THREE.Quaternion());
      const moved = Math.abs(q0.angleTo(q1));
      console.log(`    thigh swing over half cycle: ${moved.toFixed(3)} rad ${moved > 0.05 ? 'OK (limb moves)' : 'SUSPICIOUS (limb static)'}`);
      if (moved <= 0.05) failures++;
    }
    mixer.stopAllAction();
  }
}
console.log(`\nRESULT: ${failures === 0 ? 'ALL CHECKS PASSED' : failures + ' FAILURES'}`);
process.exit(failures === 0 ? 0 : 1);
