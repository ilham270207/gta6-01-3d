// Humanoid characters: real human-proportioned rigs.
// Primary: CesiumMan GLB (donated by Cesium, CC-BY 4.0, embedded base64 — no fetch),
// skinned, animated procedurally through its bones (walk / run / punch / aim).
// Fallback: a primitive-built humanoid with true human proportions, used if the
// GLB cannot be parsed and for varied pedestrians.
import * as THREE from 'three';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import { clone as cloneSkinned } from 'three/addons/utils/SkeletonUtils.js';
import { CESIUM_MAN_B64 } from './cesium-man-data.js';
import { cloneQuaterniusChar } from './quaternius.js';
import { clamp } from './rng.js';

let cesiumTemplate = null;   // parsed GLTF scene (template for clones)
let cesiumFailed = false;

// Subtle per-NPC tints (multiply the mannequin's painted texture).
const GLB_TINTS = [0xffffff, 0xffe6cc, 0xd8e4ff, 0xf2d8c0, 0xdde8d8, 0xe8d8e8];

// Clone the CesiumMan rig: each clone gets its own skeleton, so every NPC
// is a real GLB humanoid, not a procedural box. Materials are cloned per
// instance so the tint varies; geometry + texture stay shared.
function cloneCesiumMan(opts = {}) {
  if (!cesiumTemplate) return null;
  const root = cloneSkinned(cesiumTemplate);
  const tint = opts.tint ?? 0xffffff;
  root.traverse((o) => {
    if (o.isMesh) {
      o.castShadow = true;
      o.material = o.material.clone();
      o.material.color.setHex(tint);
    }
  });
  return root;
}

function b64ToBuffer(b64) {
  const bin = atob(b64);
  const bytes = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i += 1) bytes[i] = bin.charCodeAt(i);
  return bytes.buffer;
}

export async function loadCesiumMan() {
  if (cesiumTemplate || cesiumFailed) return cesiumTemplate;
  try {
    const loader = new GLTFLoader();
    const gltf = await new Promise((resolve, reject) => {
      loader.parse(b64ToBuffer(CESIUM_MAN_B64), '', resolve, reject);
    });
    cesiumTemplate = gltf.scene;
    return cesiumTemplate;
  } catch (e) {
    console.warn('CesiumMan GLB failed, using procedural humanoids:', e);
    cesiumFailed = true;
    return null;
  }
}

function findBone(root, namePart) {
  let found = null;
  root.traverse((o) => {
    if (!found && o.isBone && o.name.includes(namePart)) found = o;
  });
  return found;
}

// Build a primitive humanoid with realistic proportions (total height ~1.8m).
// Pivots at shoulders/hips/knees/elbows so the same animation code drives it.
function buildProceduralHumanoid(opts = {}) {
  const skin = opts.skin ?? 0xc68e5e;
  const shirt = opts.shirt ?? 0x3d7dd9;
  const pants = opts.pants ?? 0x2c3240;
  const hair = opts.hair ?? 0x201510;
  const g = new THREE.Group();
  const mat = (c) => new THREE.MeshLambertMaterial({ color: c });
  const skinM = mat(skin), shirtM = mat(shirt), pantsM = mat(pants), hairM = mat(hair, 0.95);

  function mesh(geo, m, x, y, z) {
    const meshObj = new THREE.Mesh(geo, m);
    meshObj.position.set(x, y, z);
    meshObj.castShadow = true;
    return meshObj;
  }

  // Legs: hip pivots at y=0.95, thigh 0.45, shin 0.45, foot.
  const legs = {};
  for (const side of ['L', 'R']) {
    const sx = side === 'L' ? -0.11 : 0.11;
    const hip = new THREE.Group();
    hip.position.set(sx, 0.95, 0);
    hip.add(mesh(new THREE.CylinderGeometry(0.075, 0.065, 0.45, 10), pantsM, 0, -0.22, 0));
    const knee = new THREE.Group();
    knee.position.set(0, -0.45, 0);
    knee.add(mesh(new THREE.CylinderGeometry(0.06, 0.05, 0.45, 10), pantsM, 0, -0.22, 0));
    knee.add(mesh(new THREE.BoxGeometry(0.11, 0.07, 0.26), mat(0x1c1c22, 0.7), 0, -0.44, 0.05));
    hip.add(knee);
    g.add(hip);
    legs[side] = { hip, knee };
  }
  // Torso: pelvis to shoulders, 0.55 tall, 0.38 wide.
  const torso = new THREE.Group();
  torso.position.set(0, 0.95, 0);
  torso.add(mesh(new THREE.BoxGeometry(0.38, 0.5, 0.2), shirtM, 0, 0.28, 0));
  torso.add(mesh(new THREE.BoxGeometry(0.4, 0.08, 0.22), pantsM, 0, 0.02, 0)); // belt
  g.add(torso);
  // Head + neck: head centre ~1.62.
  const neck = new THREE.Group();
  neck.position.set(0, 0.55, 0);
  neck.add(mesh(new THREE.CylinderGeometry(0.05, 0.055, 0.09, 8), skinM, 0, 0.02, 0));
  const head = new THREE.Group();
  head.position.set(0, 0.12, 0);
  head.add(mesh(new THREE.SphereGeometry(0.115, 14, 12), skinM, 0, 0.06, 0));
  head.add(mesh(new THREE.SphereGeometry(0.118, 14, 10, 0, Math.PI * 2, 0, Math.PI * 0.55), hairM, 0, 0.075, -0.01));
  // Simple face: eyes.
  const eyeM = new THREE.MeshBasicMaterial({ color: 0x14100c });
  head.add(mesh(new THREE.SphereGeometry(0.013, 6, 6), eyeM, -0.042, 0.065, 0.105));
  head.add(mesh(new THREE.SphereGeometry(0.013, 6, 6), eyeM, 0.042, 0.065, 0.105));
  neck.add(head);
  torso.add(neck);
  // Arms: shoulder pivots at y=0.48 on torso, upper arm 0.32, forearm 0.3.
  const arms = {};
  for (const side of ['L', 'R']) {
    const sx = side === 'L' ? -0.23 : 0.23;
    const shoulder = new THREE.Group();
    shoulder.position.set(sx, 0.48, 0);
    shoulder.add(mesh(new THREE.CylinderGeometry(0.055, 0.05, 0.32, 10), shirtM, 0, -0.16, 0));
    const elbow = new THREE.Group();
    elbow.position.set(0, -0.32, 0);
    elbow.add(mesh(new THREE.CylinderGeometry(0.048, 0.042, 0.3, 10), skinM, 0, -0.15, 0));
    elbow.add(mesh(new THREE.SphereGeometry(0.055, 10, 8), skinM, 0, -0.31, 0));
    shoulder.add(elbow);
    torso.add(shoulder);
    arms[side] = { shoulder, elbow };
  }
  const bones = {
    hipL: legs.L.hip, hipR: legs.R.hip, kneeL: legs.L.knee, kneeR: legs.R.knee,
    shoulderL: arms.L.shoulder, shoulderR: arms.R.shoulder,
    elbowL: arms.L.elbow, elbowR: arms.R.elbow,
    torso, neck, head,
  };
  return { group: g, bones, procedural: true };
}

export class Humanoid {
  // opts: { tint, procedural, skin, shirt, pants, hair, scale }
  constructor(opts = {}) {
    this.opts = opts;
    this.group = new THREE.Group();
    this.bones = null;
    this.procedural = false;
    this.walkPhase = Math.random() * 6.28;
    this.punchT = -1;
    this.punchCount = 0; // alternates the punch twist L/R (M-J)
    this.punchElapsed = 0; // seconds since the current punch started (M-J)
    this.bullyPhase = Math.random() * 6.28; // swagger cadence (M-J)
    this.aiming = false;
    this.quat = null; // Quaternius clip-driven rig (mixer + actions), if any.
    this.scale = opts.scale ?? 1;
    if (cesiumTemplate && !opts.procedural && opts.glb) {
      // Every GLB humanoid (player, peds, cops, rivals) gets its own clone
      // of the CesiumMan rig with an independent skeleton, so bone animation
      // works per instance. The template itself is never consumed.
      const root = cloneCesiumMan(opts);
      this.group.add(root);
      this.group.scale.setScalar(this.scale);
      const byName = (part) => {
        let found = null;
        root.traverse((o) => { if (!found && o.isBone && o.name.includes(part)) found = o; });
        return found;
      };
      this.bones = {
        hipL: byName('leg_joint_L_1'), hipR: byName('leg_joint_R_1'),
        kneeL: byName('leg_joint_L_2'), kneeR: byName('leg_joint_R_2'),
        shoulderL: byName('arm_joint_L'), shoulderR: byName('arm_joint_R'),
        elbowL: byName('arm_joint_L__2_') || byName('arm_joint_L'),
        elbowR: byName('arm_joint_R__2_') || byName('arm_joint_R'),
        torso: byName('torso_joint_2') || byName('torso_joint_1'),
        neck: byName('neck_joint_1'),
        head: byName('neck_joint_2'),
      };
      this.mesh = root;
    }
    if (!this.bones && opts.retarget) {
      // Retargeted NEW character model (ilham's Male/Female GLBs with
      // Quaternius clips retargeted onto the UE5-style rig — see retarget.js).
      // Same shape as the Quaternius branch: mixer + actions drive animate().
      const r = opts.retarget;
      if (r && r.group) {
        this.group.add(r.group);
        this.group.scale.setScalar(this.scale);
        this.quat = { mixer: r.mixer, actions: r.actions, moveCurrent: 'idle', punching: false };
        this.quatNorm = r.normScale || 1;
        this.mesh = r.group;
        this.bones = {};
      }
    }
    if (!this.bones && opts.quat) {
      // Quaternius character (Jax / La Rosa / NPC variants): real embedded
      // walk/run/idle clips driven by an AnimationMixer instead of
      // procedural bone posing. Falls back to procedural if parsing failed.
      const q = cloneQuaterniusChar(opts.quat);
      if (q) {
        this.group.add(q.group);
        this.group.scale.setScalar(this.scale);
        this.quat = { mixer: q.mixer, actions: q.actions, moveCurrent: 'idle', punching: false };
        this.quatNorm = q.normScale || 1; // rig normalize factor (male rigs ~0.37)
        // (M-J overlay lives at group level — see animate() — never += on a
        // bone: the mixer does not rewrite every bone every frame, so a
        // bone offset accumulates and the rig drifts.)
        this.mesh = q.group;
        // Mark as "has a rig" so the procedural fallback below is skipped.
        this.bones = {};
      }
    }
    if (!this.bones) {
      const p = buildProceduralHumanoid(opts);
      this.group.add(p.group);
      this.bones = p.bones;
      this.mesh = p.group; // so setLieFlat works for the procedural rig too
      this.procedural = true;
      this.group.scale.setScalar(this.scale);
    }
    // Store base rotations for reset each frame.
    this.baseRot = {};
    for (const k of Object.keys(this.bones)) {
      const b = this.bones[k];
      if (b) this.baseRot[k] = b.rotation.clone();
    }
  }

  // Lie flat (sunbather): rotate the INNER rig, not the outer group.
  // animate() owns the outer group's rotation.x/z (M-J swagger/lean), so a
  // lie-flat there is overwritten every frame and the random facing angle
  // rolls the body onto its side — the tilted, floating sunbather on ilham's
  // phone. The inner rig is never written by animate().
  setLieFlat(on) {
    if (this.mesh) this.mesh.rotation.x = on ? -Math.PI / 2 : 0;
  }
  setPhonePose(on) {
    // One hand up with a phone, head bowed: inner-rig tilt (animate() never
    // touches the inner rig) + a small phone box in front of the chest.
    if (!this._phone) {
      const m = new THREE.Mesh(new THREE.BoxGeometry(0.09, 0.16, 0.02), new THREE.MeshLambertMaterial({ color: 0x11131a }));
      m.position.set(0, 1.25, 0.35);
      m.rotation.x = -0.3;
      this._phone = m;
      this.group.add(m);
    }
    this._phone.visible = !!on;
    if (this.mesh) this.mesh.rotation.x = on ? 0.22 : 0;
  }

  // Animate: speed01 0..1 (0 idle), phase advances with distance.
  animate(dt, speed01, opts = {}) {
    // Quaternius rig: drive the embedded clips (idle/walk/run/punch) with
    // the AnimationMixer, crossfading on state changes.
    if (this.quat) {
      const q = this.quat;
      const A = q.actions;
      const moveTarget = speed01 < 0.05 ? 'idle' : speed01 < 0.75 ? 'walk' : 'run';
      if (this.punchT >= 0 && A.punch && !q.punching) {
        q.punching = true;
        const cur = A[q.moveCurrent];
        if (cur) cur.fadeOut(0.08);
        // Bully wind-up: the clip starts SLOW (arm cocks back) then snaps.
        A.punch.reset().setEffectiveTimeScale(0.55).fadeIn(0.08).play();
      } else if (this.punchT < 0 && q.punching) {
        q.punching = false;
        if (A.punch) A.punch.fadeOut(0.12);
        const cur = A[q.moveCurrent];
        if (cur) cur.reset().fadeIn(0.12).play();
      }
      if (!q.punching && A[moveTarget] && q.moveCurrent !== moveTarget) {
        const prev = A[q.moveCurrent];
        if (prev) prev.fadeOut(0.15);
        A[moveTarget].reset().fadeIn(0.15).play();
        q.moveCurrent = moveTarget;
      }
      // Match clip playback speed to movement speed.
      const cur = A[q.moveCurrent];
      if (cur) cur.setEffectiveTimeScale(q.moveCurrent === 'idle' ? 1 : 0.7 + speed01 * 0.7);
      // Punch snap: after the 0.14 s wind-up the strike fires fast (2.3x).
      if (q.punching && A.punch) A.punch.setEffectiveTimeScale(this.punchElapsed < 0.14 ? 0.55 : 2.3);
      q.mixer.update(dt);
      // Bully-feel overlay (M-J): swagger + punch, layered on top of the
      // clips at the GROUP level with ABSOLUTE sets. (Bone += was tried
      // first and VERIFIED to drift: the walk clip leaves Abdomen/Hips
      // unwritten, so offsets accumulated 0.086 -> 0.299. Group rotation
      // and position are rewritten by the caller every frame before
      // animate(), so absolute sets here can never accumulate.)
      this.bullyPhase += dt * (4 + speed01 * 9);
      const ph = this.bullyPhase;
      let roll = 0, lean = 0;
      if (speed01 > 0.05 && this.punchT < 0) {
        // Swagger: confident whole-body roll + slight forward lean, grows
        // with speed. (Bully walk, tuned from our own Quaternius clips.)
        roll = Math.sin(ph) * 0.04 * speed01;
        lean = (0.02 + 0.04 * speed01) * speed01;
      }
      if (this.punchT >= 0) {
        // Alternating punch: the shoulders roll the other way on every
        // other punch (left/right feel), the body leans in, and the
        // character lunges a step forward along its facing.
        const t = clamp(this.punchT, 0, 1);
        const punch = Math.sin(t * Math.PI);
        const sign = (this.punchCount % 2 === 0) ? 1 : -1;
        roll += sign * punch * 0.05;
        lean += punch * 0.06;
        const a = Math.PI / 2 - this.group.rotation.y; // facing angle
        this.group.position.x += Math.cos(a) * punch * 0.15;
        this.group.position.z += Math.sin(a) * punch * 0.15;
      }
      this.group.rotation.z = roll;
      this.group.rotation.x = lean;
      return;
    }
    const b = this.bones;
    if (!b) return;
    this.walkPhase += dt * (4 + speed01 * 9);
    const ph = this.walkPhase;
    const swing = speed01 * 0.75;
    const setR = (bone, x, y = 0, z = 0) => {
      if (!bone) return;
      const base = this.baseRot[bone === b.hipL ? 'hipL' : bone === b.hipR ? 'hipR' : bone === b.kneeL ? 'kneeL' : bone === b.kneeR ? 'kneeR' : bone === b.shoulderL ? 'shoulderL' : bone === b.shoulderR ? 'shoulderR' : bone === b.elbowL ? 'elbowL' : bone === b.elbowR ? 'elbowR' : bone === b.torso ? 'torso' : bone === b.neck ? 'neck' : 'head'] || { x: 0, y: 0, z: 0 };
      bone.rotation.set(base.x + x, base.y + y, base.z + z);
    };
    const s = Math.sin(ph), c = Math.cos(ph);
    // Legs: opposite swing; knees bend on the back-swing.
    setR(b.hipL, -s * swing);
    setR(b.hipR, s * swing);
    setR(b.kneeL, Math.max(0, c) * swing * 1.4);
    setR(b.kneeR, Math.max(0, -c) * swing * 1.4);
    // Arms swing opposite the legs; when aiming, right arm points forward.
    if (this.aiming || opts.aim) {
      setR(b.shoulderR, -Math.PI / 2 + 0.1, 0, 0);
      setR(b.elbowR, 0.05, 0, 0);
      setR(b.shoulderL, s * swing * 0.5);
    } else {
      setR(b.shoulderL, s * swing * 0.9);
      setR(b.shoulderR, -s * swing * 0.9);
      setR(b.elbowL, -0.25 - Math.max(0, -s) * 0.35);
      setR(b.elbowR, -0.25 - Math.max(0, s) * 0.35);
    }
    // Punch: right arm snaps forward.
    if (this.punchT >= 0) {
      const t = clamp(this.punchT, 0, 1);
      const punch = Math.sin(t * Math.PI);
      setR(b.shoulderR, -Math.PI / 2 * punch - s * swing * 0.9 * (1 - punch), 0, 0);
      setR(b.elbowR, -0.1 * (1 - punch));
      if (b.torso) {
        const base = this.baseRot.torso || { x: 0, y: 0, z: 0 };
        b.torso.rotation.set(base.x, base.y + punch * 0.35 * ((this.punchCount % 2 === 0) ? 1 : -1), base.z);
      }
    } else if (b.torso) {
      const base = this.baseRot.torso || { x: 0, y: 0, z: 0 };
      b.torso.rotation.set(base.x + speed01 * 0.12, base.y, base.z + s * 0.03 * speed01);
    }
    // Idle breathing.
    if (speed01 < 0.05 && b.torso) {
      const base = this.baseRot.torso || { x: 0, y: 0, z: 0 };
      b.torso.rotation.x = base.x + Math.sin(performance.now() * 0.0012) * 0.02;
    }
    // Slight forward lean when running.
    if (this.group) this.group.rotation.x = 0;
  }

  punch() { this.punchT = 0; this.punchCount += 1; this.punchElapsed = 0; }
  updatePunch(dt) {
    if (this.punchT >= 0) {
      this.punchT += dt * 3.2;
      this.punchElapsed += dt;
      if (this.punchT > 1) this.punchT = -1;
    }
  }

  // Squash & stretch (M-J, Bully-feel jump): scales the whole rig around
  // the feet (the group origin sits at the feet). 1 = normal size.
  setSquash(f) {
    if (!this.group) return;
    this.group.scale.setScalar(this.scale * f);
  }

  // Attach an object (e.g. a weapon mesh) to the right hand, if this rig
  // has a right-hand bone. Returns the object, or null if no hand bone.
  attachToRightHand(obj) {
    if (!this.mesh) return null;
    let hand = null;
    this.mesh.traverse((o) => {
      if (!hand && o.isBone && /hand/i.test(o.name) && /r$/i.test(o.name)) hand = o;
    });
    if (!hand) return null;
    hand.add(obj);
    return obj;
  }
}
