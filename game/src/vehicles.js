// LA VEGA 3D — cars. Five distinct models built from primitives:
// sedan, taxi (with roof sign), truck (cab + cargo box), sport (low, spoiler),
// police (black & white, light bar). Plus traffic AI that follows the road grid.
import * as THREE from 'three';
import { CAR_MODELS, ROADS, WORLD } from './config.js';
import { clamp, angDiff } from './rng.js';
import { Q, cloneQuaterniusCar } from './quaternius.js';
import { cloneBuyCar } from './buycars.js';

// Wheel-spin axis (car lateral axis, local X).
const X_AXIS = new THREE.Vector3(1, 0, 0);
// GLB car templates per game car model (truck stays procedural — the pickup
// GLB is a different scale/orientation and the game truck is a cargo box).
// 'sedan' randomly picks the sedan or SUV GLB for traffic variety.
function glbCarTemplate(model) {
  if (!Q.ok) return null;
  if (model === 'sport') return Q.cars.sport;
  if (model === 'suv') return Q.cars.suv;
  if (model === 'sedan') return Math.random() < 0.5 ? Q.cars.sedan : Q.cars.suv;
  if (model === 'taxi') return Q.cars.taxi;
  if (model === 'police') return Q.cars.police;
  if (model === 'pickup') return Q.cars.pickup; // Quaternius pickup GLB (CC0), Z-long like the other GLB cars
  return null;
}

function box(w, h, d, mat, x = 0, y = 0, z = 0) {
  const m = new THREE.Mesh(new THREE.BoxGeometry(w, h, d), mat);
  m.position.set(x, y, z);
  m.castShadow = true;
  m.receiveShadow = true;
  return m;
}
function cyl(rt, rb, h, mat, x = 0, y = 0, z = 0, seg = 12) {
  const m = new THREE.Mesh(new THREE.CylinderGeometry(rt, rb, h, seg), mat);
  m.position.set(x, y, z);
  m.castShadow = true;
  return m;
}

const glassMat = new THREE.MeshLambertMaterial({ color: 0x1a2f42 });
const tireMat = new THREE.MeshLambertMaterial({ color: 0x14161a });
const chromeMat = new THREE.MeshLambertMaterial({ color: 0xd8dde2 });

// City bus (M3c, ilham 19:28 WIB): 10 m procedural bus — blue body, white
// stripe, glass band, destination sign, 6 wheels. Length along X, front
// at -X, like the other procedural cars.
function buildBusMesh(colorHex) {
  const g = new THREE.Group();
  const L = 10, W = 2.6;
  const bodyMat = new THREE.MeshLambertMaterial({ color: colorHex });
  const whiteMat = new THREE.MeshLambertMaterial({ color: 0xf2f5f7 });
  g.add(box(L, 2.0, W, bodyMat, 0, 1.5, 0)); // body 0.5..2.5
  g.add(box(L + 0.06, 0.45, W + 0.04, whiteMat, 0, 1.05, 0)); // white stripe
  g.add(box(9.2, 0.85, W + 0.04, glassMat, 0.1, 2.0, 0)); // window band
  g.add(box(0.1, 0.85, 2.2, glassMat, -L / 2 - 0.02, 2.0, 0)); // windshield
  g.add(box(0.14, 0.35, 1.3, new THREE.MeshLambertMaterial({ color: 0x111111, emissive: 0xffb347, emissiveIntensity: 1.2 }), -L / 2 - 0.04, 2.45, 0)); // destination sign
  g.add(box(9.6, 0.15, 2.5, new THREE.MeshLambertMaterial({ color: 0xd8dde2 }), 0, 2.58, 0)); // roof
  g.add(box(0.12, 0.25, 0.5, new THREE.MeshLambertMaterial({ color: 0xfff2b0, emissive: 0xfff2b0, emissiveIntensity: 0.8 }), -L / 2 - 0.02, 0.8, 0.85)); // headlights
  g.add(box(0.12, 0.25, 0.5, new THREE.MeshLambertMaterial({ color: 0xfff2b0, emissive: 0xfff2b0, emissiveIntensity: 0.8 }), -L / 2 - 0.02, 0.8, -0.85));
  g.add(box(0.12, 0.25, 0.5, new THREE.MeshLambertMaterial({ color: 0xd92038, emissive: 0xd92038, emissiveIntensity: 0.6 }), L / 2 + 0.02, 0.8, 0.85)); // taillights
  g.add(box(0.12, 0.25, 0.5, new THREE.MeshLambertMaterial({ color: 0xd92038, emissive: 0xd92038, emissiveIntensity: 0.6 }), L / 2 + 0.02, 0.8, -0.85));
  const wheels = [];
  for (const [wx, wz] of [[-3.8, -1.15], [-3.8, 1.15], [2.8, -1.15], [2.8, 1.15], [4.0, -1.15], [4.0, 1.15]]) {
    const wheel = cyl(0.45, 0.45, 0.3, tireMat, wx, 0.45, wz, 14);
    wheel.rotation.x = Math.PI / 2;
    g.add(wheel); wheels.push(wheel);
    const hub = cyl(0.22, 0.22, 0.32, chromeMat, wx, 0.45, wz, 10);
    hub.rotation.x = Math.PI / 2;
    g.add(hub);
  }
  g.userData.wheels = wheels;
  g.userData.wheelR = 0.45;
  return g;
}

export function buildCarMesh(model, colorHex) {
  if (model === 'bus') return buildBusMesh(colorHex);
  // Buy-car GLBs (fetched from game/models/cars/): real 3D models, spinnable
  // wheels where the mesh names allow it. Falls through to the procedural
  // car when the GLB isn't loaded (file://).
  const spec0 = CAR_MODELS[model];
  if (spec0 && spec0.buycar) {
    const b = cloneBuyCar(model, spec0.len);
    if (b) {
      b.group.userData.isGLB = true;
      b.group.userData.wheels = b.wheels;
      if (b.wheels.length) {
        const wb = new THREE.Box3().setFromObject(b.wheels[0]);
        b.group.userData.wheelR = Math.max(0.15, (wb.max.y - wb.min.y) / 2);
      }
      return b.group;
    }
  }
  // Quaternius GLB car (if loaded): real 3D model, spinnable wheels,
  // authored paint. Falls back to the procedural car if unavailable.
  const qTemplate = glbCarTemplate(model);
  if (qTemplate) {
    const q = cloneQuaterniusCar(qTemplate);
    if (q) {
      q.group.userData.isGLB = true;
      q.group.userData.wheels = q.wheels;
      // GLB cars are shorter than the game's spec (sedan 3.31 m vs 4.6 m,
      // sport 3.93 m vs 4.4 m, police 3.73 m vs 4.8 m): scale the whole car
      // up so its length matches CAR_MODELS[model].len, then re-ground it.
      const box = new THREE.Box3().setFromObject(q.group);
      const len = box.max.z - box.min.z;
      const target = CAR_MODELS[model].len;
      if (len > 0.01 && target > 0) {
        q.group.scale.setScalar(target / len);
        q.group.updateMatrixWorld(true);
        const box2 = new THREE.Box3().setFromObject(q.group);
        if (box2.min.y < -0.01) {
          // Same local-vs-world fix as cloneBuyCar: convert the offset.
          const localY = q.group.worldToLocal(new THREE.Vector3(0, box2.min.y, 0)).y;
          for (const c of q.group.children) c.position.y -= localY;
          q.group.updateMatrixWorld(true);
        }
        // Real wheel radius after scaling, for correct spin speed.
        if (q.wheels.length) {
          const wb = new THREE.Box3().setFromObject(q.wheels[0]);
          q.group.userData.wheelR = Math.max(0.15, (wb.max.y - wb.min.y) / 2);
        }
      }
      return q.group;
    }
  }
  const spec = CAR_MODELS[model];
  const g = new THREE.Group();
  const bodyMat = new THREE.MeshLambertMaterial({ color: colorHex });
  const L = spec.len, W = spec.wid;
  // Wheels (4, or 6 for the truck).
  const wheelPos = model === 'truck'
    ? [[-L / 2 + 0.9, -W / 2], [-L / 2 + 0.9, W / 2], [L / 2 - 1.6, -W / 2], [L / 2 - 1.6, W / 2], [L / 2 - 0.6, -W / 2], [L / 2 - 0.6, W / 2]]
    : [[-L / 2 + 0.85, -W / 2], [-L / 2 + 0.85, W / 2], [L / 2 - 0.85, -W / 2], [L / 2 - 0.85, W / 2]];
  for (const [wx, wz] of wheelPos) {
    const wheel = cyl(0.36, 0.36, 0.28, tireMat, wx, 0.36, wz, 14);
    wheel.rotation.x = Math.PI / 2;
    g.add(wheel);
    const hub = cyl(0.18, 0.18, 0.3, chromeMat, wx, 0.36, wz, 10);
    hub.rotation.x = Math.PI / 2;
    g.add(hub);
  }

  if (model === 'truck') {
    // Detailed procedural cargo truck (no free GLB truck fit the size gate):
    // cab + glasshouse + ribbed cargo box + chrome grill/bumper + lights.
    g.add(box(1.9, 1.5, W - 0.1, bodyMat, -L / 2 + 1.15, 1.25, 0));           // cab
    g.add(box(1.7, 1.1, W - 0.3, glassMat, -L / 2 + 1.15, 2.2, 0));           // cab top (glasshouse)
    g.add(box(L - 2.6, 2.1, W, new THREE.MeshLambertMaterial({ color: 0xcfd6dd }), L / 2 - 1.4, 1.55, 0)); // cargo box
    g.add(box(0.15, 0.5, W, new THREE.MeshLambertMaterial({ color: 0xffd166, emissive: 0xffd166, emissiveIntensity: 0.4 }), -L / 2 + 0.05, 0.9, 0)); // front marker strip
    g.add(box(0.1, 0.7, W - 0.4, chromeMat, -L / 2 - 0.02, 0.85, 0));         // chrome grill
    g.add(box(0.18, 0.35, W, chromeMat, -L / 2 - 0.03, 0.45, 0));             // front bumper
    g.add(box(0.1, 0.25, 0.5, new THREE.MeshLambertMaterial({ color: 0xfff2b0, emissive: 0xfff2b0, emissiveIntensity: 0.9 }), -L / 2 - 0.04, 1.0, 0.7)); // headlight L
    g.add(box(0.1, 0.25, 0.5, new THREE.MeshLambertMaterial({ color: 0xfff2b0, emissive: 0xfff2b0, emissiveIntensity: 0.9 }), -L / 2 - 0.04, 1.0, -0.7)); // headlight R
    g.add(box(0.1, 0.3, 0.4, new THREE.MeshLambertMaterial({ color: 0xd92038, emissive: 0xd92038, emissiveIntensity: 0.7 }), L / 2 + 0.02, 0.9, 0.8)); // taillight L
    g.add(box(0.1, 0.3, 0.4, new THREE.MeshLambertMaterial({ color: 0xd92038, emissive: 0xd92038, emissiveIntensity: 0.7 }), L / 2 + 0.02, 0.9, -0.8)); // taillight R
    for (const rx of [-0.6, 0.4, 1.4]) { // cargo box ribs (both sides)
      g.add(box(0.08, 1.9, 0.04, new THREE.MeshLambertMaterial({ color: 0x9aa4ad }), L / 2 - 1.4 + rx, 1.55, W / 2 + 0.01));
      g.add(box(0.08, 1.9, 0.04, new THREE.MeshLambertMaterial({ color: 0x9aa4ad }), L / 2 - 1.4 + rx, 1.55, -W / 2 - 0.01));
    }
    g.add(cyl(0.09, 0.09, 1.1, new THREE.MeshLambertMaterial({ color: 0x3a3f46 }), -L / 2 + 2.15, 2.6, W / 2 - 0.15, 8)); // exhaust stack
    g.add(box(0.5, 0.5, 0.06, new THREE.MeshLambertMaterial({ color: 0x22252a }), L / 2 - 0.9, 0.35, W / 2 - 0.1)); // mud flap L
    g.add(box(0.5, 0.5, 0.06, new THREE.MeshLambertMaterial({ color: 0x22252a }), L / 2 - 0.9, 0.35, -W / 2 + 0.1)); // mud flap R
  } else if (model === 'sport') {
    g.add(box(L, 0.55, W, bodyMat, 0, 0.62, 0));                              // low body
    g.add(box(L * 0.45, 0.42, W - 0.35, glassMat, -0.2, 1.08, 0));            // cabin
    g.add(box(0.12, 0.28, W - 0.2, bodyMat, L / 2 - 0.1, 1.05, 0));           // spoiler strut
    g.add(box(0.5, 0.08, W + 0.1, bodyMat, L / 2 - 0.1, 1.22, 0));            // spoiler wing
    g.add(box(0.3, 0.18, W - 0.1, new THREE.MeshLambertMaterial({ color: 0xfff2b0, emissive: 0xfff2b0, emissiveIntensity: 0.8 }), -L / 2 - 0.02, 0.7, 0)); // headlights
  } else {
    g.add(box(L, 0.62, W, bodyMat, 0, 0.68, 0));                              // body
    g.add(box(L * 0.52, 0.55, W - 0.3, glassMat, -L * 0.04, 1.22, 0));        // cabin
    g.add(box(0.18, 0.2, W - 0.2, new THREE.MeshLambertMaterial({ color: 0xfff2b0, emissive: 0xfff2b0, emissiveIntensity: 0.7 }), -L / 2 - 0.02, 0.72, 0)); // headlights
    g.add(box(0.12, 0.18, W - 0.2, new THREE.MeshLambertMaterial({ color: 0xd92038, emissive: 0xd92038, emissiveIntensity: 0.5 }), L / 2 + 0.02, 0.72, 0)); // taillights
    if (model === 'taxi') {
      g.add(box(1.0, 0.28, 0.6, new THREE.MeshLambertMaterial({ color: 0x20242c, emissive: 0xffd166, emissiveIntensity: 0.7 }), -L * 0.04, 1.62, 0)); // roof sign
      // checker band
      g.add(box(L * 0.9, 0.14, 0.02, new THREE.MeshLambertMaterial({ color: 0x20242c }), 0, 0.95, W / 2 + 0.01));
      g.add(box(L * 0.9, 0.14, 0.02, new THREE.MeshLambertMaterial({ color: 0x20242c }), 0, 0.95, -W / 2 - 0.01));
    }
    if (model === 'police') {
      // white doors
      g.add(box(L * 0.42, 0.5, W + 0.02, new THREE.MeshLambertMaterial({ color: 0xf2f2f2 }), -L * 0.05, 0.68, 0));
      // light bar
      const bar = box(0.7, 0.18, 1.1, new THREE.MeshLambertMaterial({ color: 0x222222 }), -L * 0.04, 1.58, 0);
      g.add(bar);
      const red = box(0.32, 0.16, 0.5, new THREE.MeshLambertMaterial({ color: 0xd92038, emissive: 0xff2233, emissiveIntensity: 2 }), -L * 0.04, 1.68, -0.28);
      const blue = box(0.32, 0.16, 0.5, new THREE.MeshLambertMaterial({ color: 0x2266ff, emissive: 0x2266ff, emissiveIntensity: 2 }), -L * 0.04, 1.68, 0.28);
      g.add(red); g.add(blue);
      g.userData.lightBar = { red, blue };
    }
  }
  // Headlight beams (subtle, daytime-visible cones are skipped; keep glow discs).
  return g;
}

// GLB cars face +Z locally; procedural cars face -X. Different yaw formula.
export function carRotationY(car) {
  return car.glb ? Math.PI / 2 - car.angle : Math.PI - car.angle;
}
function spinWheels(car, dt) {
  if (!car.wheels || !car.speed) return;
  const spin = car.speed * dt / (car.wheelR || 0.28); // wheel radius (GLB cars store the real one)
  for (const w of car.wheels) w.rotateOnAxis(X_AXIS, spin);
}

// Car entity: physics + state. angle: heading, 0 = +x, turning toward +z.
export function createCar(scene, model, colorHex, x, z, angle, opts = {}) {
  const spec = CAR_MODELS[model];
  const mesh = buildCarMesh(model, colorHex);
  mesh.position.set(x, 0, z);
  const glb = !!mesh.userData.isGLB;
  mesh.rotation.y = glb ? Math.PI / 2 - angle : Math.PI - angle; // three.js: rotation.y positive is CCW seen from above; heading angle in xz-plane
  scene.add(mesh);
  return {
    id: opts.id ?? -1,
    model,
    color: colorHex,
    mesh,
    glb,
    wheels: mesh.userData.wheels || null,
    wheelR: mesh.userData.wheelR || 0.28,
    x, z, angle,
    speed: 0,
    steer: 0,
    parked: !!opts.parked,
    isPolice: model === 'police',
    isPlayer: false,
    ai: opts.ai || null,      // traffic: { axis: 'x'|'z', dir: 1|-1, road }
    driver: opts.driver ?? null,
    health: 100,              // damage model: 100 = pristine, 0 = disabled
    fuel: 100,                // simulator: drains while driving
    disabled: false,
    hitFlag: false,           // set when the car bounces off a solid
    stolenOnce: false,
    slip: false,              // rain: wet road, less grip
    boost: false,             // nitro active
    nitro: 100,               // nitro tank (refills at the gas station)
    topBonus: 1,              // drive skill raises top speed
  };
}

export function carForward(car) {
  return { x: Math.cos(car.angle), z: Math.sin(car.angle) };
}

// Simple arcade car physics: accel/brake/steer, drag, building collision handled by caller.
// car.slip (rain) cuts grip; car.boost (nitro) raises accel + top speed.
export function stepCar(car, input, dt, collide) {
  const spec = CAR_MODELS[car.model];
  const top = spec.top * (car.slip ? 0.85 : 1) * (car.boost ? 1.35 : 1) * (car.topBonus || 1) * (car.flatTire ? 0.35 : 1); // popped tires: crawl
  const accel = spec.accel * (car.boost ? 1.6 : 1);
  const fwd = carForward(car);
  if (input.throttle) car.speed += accel * dt;
  if (input.brake) car.speed -= accel * 1.4 * dt;
  if (!input.throttle && !input.brake) car.speed -= Math.sign(car.speed) * 6 * dt;
  if (Math.abs(car.speed) < 0.2 && !input.throttle) car.speed = 0;
  car.speed = clamp(car.speed, -top * 0.35, top);
  const steerTarget = input.steer || 0;
  car.steer += (steerTarget - car.steer) * Math.min(1, dt * 8);
  if (Math.abs(car.speed) > 0.3) {
    car.angle += car.steer * spec.turn * (car.speed / top) * dt * (car.speed >= 0 ? 1 : -1) * 2.2;
  }
  const nx = car.x + Math.cos(car.angle) * car.speed * dt;
  const nz = car.z + Math.sin(car.angle) * car.speed * dt;
  if (collide && collide(nx, nz, 1.6)) {
    car.speed *= -0.25; // bounce off
    car.hitFlag = true;
  } else {
    car.x = nx; car.z = nz;
  }
  // Keep inside the world.
  car.x = clamp(car.x, 2, WORLD.size - 2);
  car.z = clamp(car.z, 2, WORLD.size - 2);
  car.mesh.position.set(car.x, 0, car.z);
  car.mesh.rotation.y = carRotationY(car);
  spinWheels(car, dt);
  // Body roll/pitch for feel.
  car.mesh.rotation.z = -car.steer * clamp(Math.abs(car.speed) / spec.top, 0, 1) * 0.06;
  return car;
}

// Traffic AI: drive along a road, turn at intersections, avoid stopping dead.
// Stops at red lights, yields to pedestrians on the crossing, slows for cars.
// time = game clock (seconds) for the light cycle; peds = pedestrian list.
export function stepTrafficCar(car, dt, collide, rng, cars, time = 0, peds = null) {
  const spec = CAR_MODELS[car.model];
  const ai = car.ai;
  if (!ai) return;
  // Lane offset: right-hand traffic. Road is 10 m wide, lanes at ±2.5 m.
  const lane = 2.5;
  let targetSpeed = spec.top * 0.45 * (car.slip ? 0.85 : 1);
  // --- Red light: the next intersection ahead on this road. Lights cycle
  // 6s green per axis, offset per intersection so neighbours alternate.
  const along = ai.axis === 'x' ? car.x : car.z;
  const ahead = along + (ai.dir > 0 ? 9 : -9);
  let nextCross = null;
  for (const r of ROADS) {
    if (ai.dir > 0 && r > along && r <= ahead) { nextCross = r; break; }
    if (ai.dir < 0 && r < along && r >= ahead) { nextCross = r; break; }
  }
  if (nextCross !== null) {
    const off = Math.round(nextCross / 13) % 2;
    const greenX = (Math.floor(time / 6) + off) % 2 === 0;
    const redForMe = ai.axis === 'x' ? !greenX : greenX;
    if (redForMe) targetSpeed = 0;
  }
  car.speed += (targetSpeed - car.speed) * Math.min(1, dt * 1.5);
  // Desired heading along the road.
  let desired = ai.axis === 'x' ? (ai.dir > 0 ? 0 : Math.PI) : (ai.dir > 0 ? Math.PI / 2 : -Math.PI / 2);
  // At an intersection, maybe turn onto the crossing road. NOTE: for a car
  // driving along x, the crossing roads are the VERTICAL ones, so the
  // near-road test uses car.x (and vice versa) — the old code tested the
  // car's OWN road, so cars "turned" onto their own road as the other axis
  // and drove off-road diagonally to the world corners.
  // Turn cooldown (3 s) stops the car turning straight back at the same
  // intersection on the next frame.
  ai.turnCd = Math.max(0, (ai.turnCd || 0) - dt);
  const nearRoad = (v) => {
    let best = null, bestD = 99;
    for (const r of ROADS) { const d = Math.abs(v - r); if (d < bestD) { bestD = d; best = r; } }
    return bestD < 3.5 ? best : null;
  };
  const cross = ai.axis === 'x' ? nearRoad(car.x) : nearRoad(car.z);
  // At the grid edge (roads 39 / 247) a turn is MANDATORY — otherwise the
  // car drives out of the road network into the biome and never comes back.
  // Two guards the old code missed: (1) the cooldown is NEVER bypassed —
  // at a corner like (247,247) the crossing road is a boundary road on BOTH
  // axes, so bypassing it made the car flip axis every single frame and
  // jitter in place (the probe counted 3010 flips in 120 s); (2) at a
  // boundary turn the new direction must point INTO the grid — a random
  // pick sent half the cars off-grid into the hills, where they wedged
  // against boulders/cliffs (the silver sedan on the slope in ilham's
  // screenshot).
  const isBoundary = cross === 39 || cross === 247;
  if (cross !== null && ai.turnCd <= 0 && (isBoundary || rng.chance(dt * 0.35))) {
    // Turn: swap axis, pick a direction (inward at the grid edge).
    if (ai.axis === 'x') {
      ai.axis = 'z'; ai.road = cross;
      ai.dir = car.z >= 247 ? -1 : car.z <= 39 ? 1 : (rng.chance(0.5) ? 1 : -1);
    } else {
      ai.axis = 'x'; ai.road = cross;
      ai.dir = car.x >= 247 ? -1 : car.x <= 39 ? 1 : (rng.chance(0.5) ? 1 : -1);
    }
    ai.turnCd = 3;
  }
  // Steer toward the lane centre line. The correction sign depends on the
  // axis AND direction: e.g. driving south (axis z, dir +1), being west of
  // the lane means angling EAST, i.e. decreasing the heading — the old code
  // used the same sign for every case, so southbound cars steered AWAY from
  // their lane, drifted off-road diagonally and piled up at the world edge.
  const lanePos = ai.axis === 'x' ? car.z : car.x;
  const laneTarget = ai.road + (ai.axis === 'x' ? (ai.dir > 0 ? lane : -lane) : (ai.dir > 0 ? -lane : lane));
  const err = laneTarget - lanePos;
  const steerSign = ai.dir * (ai.axis === 'x' ? 1 : -1);
  desired += clamp(err * 0.12, -0.5, 0.5) * steerSign;
  const diff = angDiff(car.angle, desired);
  car.angle += clamp(diff, -1.8 * dt, 1.8 * dt);
  // Slow down if another car is right ahead.
  let blocked = false;
  for (const o of cars) {
    if (o === car || o.parked) continue;
    const dx = o.x - car.x, dz = o.z - car.z;
    const ahead = dx * Math.cos(car.angle) + dz * Math.sin(car.angle);
    const side = Math.abs(-dx * Math.sin(car.angle) + dz * Math.cos(car.angle));
    if (ahead > 0 && ahead < 9 && side < 2.4) { blocked = true; break; }
  }
  // Yield to pedestrians crossing ahead (zebra).
  if (!blocked && peds) {
    for (const ped of peds) {
      if (ped.dead) continue;
      const dx = ped.x - car.x, dz = ped.z - car.z;
      const ahead = dx * Math.cos(car.angle) + dz * Math.sin(car.angle);
      const side = Math.abs(-dx * Math.sin(car.angle) + dz * Math.cos(car.angle));
      if (ahead > 0 && ahead < 8 && side < 2.2) { blocked = true; break; }
    }
  }
  if (blocked) car.speed = Math.max(0, car.speed - 18 * dt);
  const nx = car.x + Math.cos(car.angle) * car.speed * dt;
  const nz = car.z + Math.sin(car.angle) * car.speed * dt;
  // Reverse-out recovery: if the next step hits a building (usually a
  // clipped corner mid-turn), back out slowly while turning away instead
  // of spinning in place (the old code added PI*0.9*dt*4 per frame while
  // halving speed — cars wedged themselves against walls forever).
  if (collide && collide(nx, nz, 1.6) && (!ai.reverseT || ai.reverseT <= 0)) {
    ai.reverseT = 1.0;
    ai.reverseDir = rng.chance(0.5) ? 1 : -1;
    ai.revCount = (ai.revCount || 0) + 1;
    ai.revWindowT = 5;
  }
  ai.revWindowT = Math.max(0, (ai.revWindowT || 0) - dt);
  if (ai.revWindowT <= 0) ai.revCount = 0;
  if (ai.reverseT > 0) {
    ai.reverseT -= dt;
    car.angle += ai.reverseDir * 2.2 * dt;
    const bx = car.x - Math.cos(car.angle) * 3 * dt;
    const bz = car.z - Math.sin(car.angle) * 3 * dt;
    if (!collide || !collide(bx, bz, 1.6)) { car.x = bx; car.z = bz; }
    car.speed = 0;
  } else {
    car.x = nx; car.z = nz;
  }
  // Wedge recovery: three reverse-outs in 5 s means the car is truly stuck
  // in a building corner. Snap it back onto its lane centre, facing along
  // the road — never triggers in normal play, stops eternal loops.
  if ((ai.revCount || 0) >= 3) {
    ai.revCount = 0; ai.revWindowT = 0; ai.reverseT = 0;
    const lt = ai.road + (ai.axis === 'x' ? (ai.dir > 0 ? lane : -lane) : (ai.dir > 0 ? -lane : lane));
    if (ai.axis === 'x') car.z = lt; else car.x = lt;
    car.angle = ai.axis === 'x' ? (ai.dir > 0 ? 0 : Math.PI) : (ai.dir > 0 ? Math.PI / 2 : -Math.PI / 2);
    car.speed = 2;
  }
  car.x = clamp(car.x, 2, WORLD.size - 2);
  car.z = clamp(car.z, 2, WORLD.size - 2);
  car.mesh.position.set(car.x, 0, car.z);
  car.mesh.rotation.y = carRotationY(car);
  spinWheels(car, dt);
}
