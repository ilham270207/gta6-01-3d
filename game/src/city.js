// LA VEGA 3D — the city. Every building gets its own architecture:
// glass towers, brick apartments, art-deco hotel, neon casino, columned city
// hall, mall, hospital, cinema, car dealer, construction site, drive-thru,
// cannery warehouse, La Rosa's club, Manny's garage, beach houses.
// All procedural geometry + canvas textures. No external assets.
import * as THREE from 'three';
import { WORLD, ROADS, PALETTE, PLACES } from './config.js';
import { clamp } from './rng.js';
import { Q } from './quaternius.js'; // GLB palm template (loaded before buildCity)

function canvasTex(w, h, draw) {
  const c = document.createElement('canvas');
  c.width = w; c.height = h;
  draw(c.getContext('2d'), w, h);
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  t.anisotropy = 4;
  return t;
}

const texCache = new Map();
function windowsTex(base, win, lit, cols, rows, seed = 0) {
  const key = `${base}|${win}|${cols}x${rows}|${seed}`;
  if (texCache.has(key)) return texCache.get(key);
  const t = canvasTex(256, 256, (g, w, h) => {
    g.fillStyle = base; g.fillRect(0, 0, w, h);
    const cw = w / cols, ch = h / rows;
    let k = seed;
    for (let r = 0; r < rows; r += 1) {
      for (let cI = 0; cI < cols; cI += 1) {
        k = (k * 16807) % 2147483647;
        const v = k / 2147483647;
        const x0 = cI * cw + cw * 0.18, y0 = r * ch + ch * 0.22, ww = cw * 0.64, hh = ch * 0.56;
        g.fillStyle = v < 0.12 ? lit : win;
        g.fillRect(x0, y0, ww, hh);
        // dark frame + mullion cross so each window reads as structure
        g.strokeStyle = 'rgba(0,0,0,0.5)';
        g.lineWidth = 2;
        g.strokeRect(x0, y0, ww, hh);
        g.beginPath();
        g.moveTo(x0 + ww / 2, y0); g.lineTo(x0 + ww / 2, y0 + hh);
        g.moveTo(x0, y0 + hh / 2); g.lineTo(x0 + ww, y0 + hh / 2);
        g.stroke();
      }
      // floor separator line
      g.fillStyle = 'rgba(0,0,0,0.35)';
      g.fillRect(0, r * ch, w, 3);
    }
    // vertical pilaster strips every two columns
    g.fillStyle = 'rgba(0,0,0,0.22)';
    for (let cI = 0; cI <= cols; cI += 2) g.fillRect(cI * cw - 3, 0, 6, h);
  });
  texCache.set(key, t);
  return t;
}

function signTex(text, bg, fg, sub = '') {
  const key = `sign|${text}|${bg}|${fg}|${sub}`;
  if (texCache.has(key)) return texCache.get(key);
  const t = canvasTex(512, sub ? 192 : 128, (g, w, h) => {
    g.fillStyle = bg; g.fillRect(0, 0, w, h);
    g.strokeStyle = fg; g.lineWidth = 6; g.strokeRect(6, 6, w - 12, h - 12);
    g.fillStyle = fg; g.textAlign = 'center'; g.textBaseline = 'middle';
    g.font = `bold ${sub ? 64 : 72}px Arial, sans-serif`;
    g.fillText(text, w / 2, sub ? h / 2 - 26 : h / 2);
    if (sub) { g.font = 'bold 34px Arial, sans-serif'; g.fillText(sub, w / 2, h / 2 + 52); }
  });
  texCache.set(key, t);
  return t;
}

// Vertical sign texture: text reads bottom-to-top, like a real blade sign
// (the old plain gold/cyan boxes read as a random "gold line" on the
// building from a distance — ilham's screenshot).
function signTexV(text, bg, fg) {
  const key = `signV|${text}|${bg}|${fg}`;
  if (texCache.has(key)) return texCache.get(key);
  const t = canvasTex(128, 512, (g, w, h) => {
    g.fillStyle = bg; g.fillRect(0, 0, w, h);
    g.strokeStyle = fg; g.lineWidth = 5; g.strokeRect(5, 5, w - 10, h - 10);
    g.fillStyle = fg; g.textAlign = 'center'; g.textBaseline = 'middle';
    g.save(); g.translate(w / 2, h / 2); g.rotate(-Math.PI / 2);
    g.font = 'bold 64px Arial, sans-serif';
    g.fillText(text, 0, 0); g.restore();
  });
  texCache.set(key, t);
  return t;
}
function box(w, h, d, material, x = 0, y = 0, z = 0) {
  const m = new THREE.Mesh(new THREE.BoxGeometry(w, h, d), material);
  m.position.set(x, y, z);
  m.castShadow = true;
  m.receiveShadow = true;
  return m;
}
function cyl(rt, rb, h, material, x = 0, y = 0, z = 0, seg = 12) {
  const m = new THREE.Mesh(new THREE.CylinderGeometry(rt, rb, h, seg), material);
  m.position.set(x, y, z);
  m.castShadow = true;
  m.receiveShadow = true;
  return m;
}
const std = (color) => new THREE.MeshLambertMaterial({ color }); // PS2 style: flat Lambert, no PBR
// Ground speckle texture (M3c baseplate, ilham 19:20 WIB): one grayscale
// noise canvas, cloned per ground plane so the repeat fits the plane size.
// The material colour still sets the base tint — the map only breaks up
// the flat fill, so the ground no longer reads as a giant empty plane.
const groundTexBase = canvasTex(256, 256, (g, w, h) => {
  g.fillStyle = '#ffffff'; g.fillRect(0, 0, w, h);
  for (let i = 0; i < 2600; i += 1) {
    const v = 200 + Math.floor(Math.random() * 55);
    g.fillStyle = `rgba(${v},${v},${v},0.5)`;
    g.fillRect(Math.random() * w, Math.random() * h, 1 + Math.random() * 2, 1 + Math.random() * 2);
  }
  for (let i = 0; i < 26; i += 1) {
    const v = 170 + Math.floor(Math.random() * 50);
    g.fillStyle = `rgba(${v},${v},${v},0.28)`;
    g.beginPath(); g.arc(Math.random() * w, Math.random() * h, 6 + Math.random() * 22, 0, Math.PI * 2); g.fill();
  }
});
function groundMat(color, rx, rz) {
  const t = groundTexBase.clone();
  t.needsUpdate = true;
  t.wrapS = THREE.RepeatWrapping; t.wrapT = THREE.RepeatWrapping;
  t.repeat.set(rx, rz);
  return new THREE.MeshLambertMaterial({ color, map: t });
}
const emissiveMat = (color, intensity = 1.2) => new THREE.MeshLambertMaterial({ color: 0x111111, emissive: color, emissiveIntensity: intensity });

export function buildCity(scene, rng) {
  const colliders = [];   // {x0,z0,x1,z1} in metres (x east, z south)
  const mapBuildings = []; // for the 2D minimap: {x,z,w,d,color}
  const group = new THREE.Group();
  scene.add(group);
  const add = (m) => { group.add(m); return m; };
  // h = building height (m). The camera collision (game.js blockedAt) only
  // blocks when the camera is BELOW the roof — without h the camera stepped
  // back even when it was above a low house, which made it jump around.
  const addCollider = (cx, cz, w, d, h = 999) => {
    colliders.push({ x0: cx - w / 2, z0: cz - d / 2, x1: cx + w / 2, z1: cz + d / 2, h });
  };

  // ---- Ground: grass, beach, sea -------------------------------------
  const grass = new THREE.Mesh(new THREE.PlaneGeometry(WORLD.size, WORLD.size), groundMat(PALETTE.grass, 26, 26));
  grass.rotation.x = -Math.PI / 2;
  grass.position.set(WORLD.size / 2, 0, WORLD.size / 2);
  grass.receiveShadow = true;
  add(grass);
  const sand = new THREE.Mesh(new THREE.PlaneGeometry(WORLD.sandX - WORLD.seaX + 2, WORLD.size), groundMat(PALETTE.sand, 2, 26));
  sand.rotation.x = -Math.PI / 2;
  sand.position.set((WORLD.seaX + WORLD.sandX) / 2, 0.02, WORLD.size / 2);
  sand.receiveShadow = true;
  add(sand);
  // Endless island (M3c, ilham: map tiada ujung): the sea is a huge plane
  // (900x900) around the whole island, so every horizon is water, never
  // void. A sand ring (apron) wraps the city square so the shore reads as
  // a beach, not a grass cliff. The ring has a rectangular hole for the
  // city square PLUS the west sea strip (x -40..400), so the beach water
  // in front of Pier 9 stays open sea.
  const sea = new THREE.Mesh(new THREE.PlaneGeometry(900, 900), new THREE.MeshPhongMaterial({ color: PALETTE.sea, shininess: 90, specular: 0x88bbdd })); // Phong: sun glint on the water (M-H)
  sea.rotation.x = -Math.PI / 2;
  sea.position.set(WORLD.size / 2, -0.25, WORLD.size / 2);
  add(sea);
  {
    const outer = 520, half = outer / 2;
    const shape = new THREE.Shape();
    shape.moveTo(-half, -half); shape.lineTo(half, -half); shape.lineTo(half, half); shape.lineTo(-half, half); shape.closePath();
    // Hole: city square (0..400) + west sea strip (x -40..400), in shape
    // coords centred on (200,200): x -240..200, z -200..200.
    const hole = new THREE.Path();
    hole.moveTo(-240, -200); hole.lineTo(200, -200); hole.lineTo(200, 200); hole.lineTo(-240, 200); hole.closePath();
    shape.holes.push(hole);
    const ringGeo = new THREE.ShapeGeometry(shape);
    ringGeo.rotateX(-Math.PI / 2);
    const ring = new THREE.Mesh(ringGeo, groundMat(PALETTE.sand, 0.08, 0.08));
    ring.position.set(WORLD.size / 2, -0.05, WORLD.size / 2);
    ring.receiveShadow = true;
    add(ring);
  }
  // ---- Biome ground: forest (north), desert (east), rocky hills (north-east).
  function groundPatch(x0, z0, x1, z1, color) {
    const p = new THREE.Mesh(new THREE.PlaneGeometry(x1 - x0, z1 - z0), groundMat(color, Math.max(2, (x1 - x0) / 15), Math.max(2, (z1 - z0) / 15)));
    p.rotation.x = -Math.PI / 2;
    p.position.set((x0 + x1) / 2, 0.01, (z0 + z1) / 2);
    p.receiveShadow = true;
    add(p);
    return p;
  }
  groundPatch(0, 260, 260, 400, 0x4a7a3a);   // forest floor — dark green
  groundPatch(260, 0, 400, 260, 0xe8c87a);  // desert sand
  groundPatch(260, 260, 400, 400, 0x8a7a68); // rocky hills — grey-brown
  // ---- Ground detail (M3c baseplate): grass tufts in the forest, pebbles
  // in the hills — instanced, one draw call each, so the ground reads as
  // terrain instead of a flat coloured plane. Never on roads/airport/beach.
  {
    const tufts = [], pebbles = [];
    const onRoad = (x, z) => ROADS.some((r) => Math.abs(x - r) < WORLD.roadWidth / 2 + WORLD.sidewalk + 1)
      || ROADS.some((r) => Math.abs(z - r) < WORLD.roadWidth / 2 + WORLD.sidewalk + 1);
    for (let i = 0; i < 220 && tufts.length < 90; i += 1) {
      const x = rng.range(4, 256), z = rng.range(264, 396);
      if (onRoad(x, z)) continue;
      tufts.push({ x, y: 0.25, z, ry: rng.range(0, Math.PI * 2), s: rng.range(0.7, 1.6) });
    }
    for (let i = 0; i < 160 && pebbles.length < 50; i += 1) {
      const x = rng.range(264, 396), z = rng.range(264, 396);
      if (onRoad(x, z)) continue;
      pebbles.push({ x, y: 0.15, z, ry: rng.range(0, Math.PI * 2), s: rng.range(0.6, 1.8) });
    }
    if (tufts.length) instanced(new THREE.ConeGeometry(0.22, 0.55, 4), std(0x3d6a2e), tufts);
    if (pebbles.length) instanced(new THREE.DodecahedronGeometry(0.3, 0), std(0x6a6258), pebbles);
  }
  // Gentle animated waves: thin white strips drifting along the shore.
  const waves = [];
  for (let i = 0; i < 8; i += 1) {
    const wv = new THREE.Mesh(new THREE.PlaneGeometry(1.2, 26), new THREE.MeshBasicMaterial({ color: 0xffffff, transparent: true, opacity: 0.35 }));
    wv.rotation.x = -Math.PI / 2;
    wv.position.set(13.5 + (i % 3), 0.05, 20 + i * 30);
    add(wv);
    waves.push(wv);
  }

  // ---- InstancedMesh helper: one draw call per part type, positions as
  // {x, y, z, ry} (ry = rotation about Y; rz optional). Used by the power
  // poles, traffic lights, markings and roadside props below.
  function instanced(geo, mat, list, shadow = false) {
    const m = new THREE.InstancedMesh(geo, mat, Math.max(1, list.length));
    const M = new THREE.Matrix4(), Q = new THREE.Quaternion(), E = new THREE.Euler();
    const V = new THREE.Vector3(), S = new THREE.Vector3(1, 1, 1);
    list.forEach((t, i) => {
      E.set(0, t.ry || 0, t.rz || 0); Q.setFromEuler(E);
      V.set(t.x, t.y || 0, t.z);
      if (t.s) S.set(t.s, t.s, t.s); else S.set(1, 1, 1);
      M.compose(V, Q, S);
      m.setMatrixAt(i, M);
    });
    m.castShadow = shadow;
    m.instanceMatrix.needsUpdate = true;
    add(m);
    return m;
  }
  // ---- Roads + sidewalks + markings -----------------------------------
  const roadMat = std(PALETTE.road, 0.95);
  const walkMat = std(PALETTE.sidewalk, 1);
  const yellowMat = new THREE.MeshBasicMaterial({ color: 0xf7c948 });
  // Double yellow centre lines: one InstancedMesh, segments broken at every
  // intersection (16 m clear span between road edges). Replaces the old
  // ~860 individual white dashes — same look, far fewer draw calls.
  const yellowSegs = [];
  for (const r of ROADS) {
    for (let i = 0; i < ROADS.length - 1; i += 1) {
      const mid = (ROADS[i] + ROADS[i + 1]) / 2;
      for (const off of [-0.28, 0.28]) {
        yellowSegs.push({ x: r + off, y: 0.045, z: mid, ry: 0 });
        yellowSegs.push({ x: mid, y: 0.045, z: r + off, ry: Math.PI / 2 });
      }
    }
  }
  const yellowGeo = new THREE.PlaneGeometry(0.14, 16);
  yellowGeo.rotateX(-Math.PI / 2);
  instanced(yellowGeo, yellowMat, yellowSegs);
  for (const r of ROADS) {
    // vertical road (along z) and horizontal road (along x)
    const rv = new THREE.Mesh(new THREE.PlaneGeometry(WORLD.roadWidth, WORLD.size), roadMat);
    rv.rotation.x = -Math.PI / 2; rv.position.set(r, 0.03, WORLD.size / 2); rv.receiveShadow = true; add(rv);
    const rh = new THREE.Mesh(new THREE.PlaneGeometry(WORLD.size - WORLD.seaX, WORLD.roadWidth), roadMat);
    rh.rotation.x = -Math.PI / 2; rh.position.set((WORLD.seaX + WORLD.size) / 2, 0.03, r); rh.receiveShadow = true; add(rh);
    // sidewalks: strips hugging each road
    for (const off of [-1, 1]) {
      const swV = new THREE.Mesh(new THREE.PlaneGeometry(WORLD.sidewalk, WORLD.size), walkMat);
      swV.rotation.x = -Math.PI / 2; swV.position.set(r + off * (WORLD.roadWidth / 2 + WORLD.sidewalk / 2), 0.02, WORLD.size / 2); swV.receiveShadow = true; add(swV);
      const swH = new THREE.Mesh(new THREE.PlaneGeometry(WORLD.size - WORLD.seaX, WORLD.sidewalk), walkMat);
      swH.rotation.x = -Math.PI / 2; swH.position.set((WORLD.seaX + WORLD.size) / 2, 0.02, r + off * (WORLD.roadWidth / 2 + WORLD.sidewalk / 2)); swH.receiveShadow = true; add(swH);
    }
  }

  // ---- Helpers for buildings ------------------------------------------
  function signPlane(text, bg, fg, w, h, x, y, z, rotY = 0, sub = '') {
    const m = new THREE.Mesh(
      new THREE.PlaneGeometry(w, h),
      new THREE.MeshLambertMaterial({ map: signTex(text, bg, fg, sub), emissive: 0xffffff, emissiveMap: signTex(text, bg, fg, sub), emissiveIntensity: 0.35 }),
    );
    m.position.set(x, y, z);
    m.rotation.y = rotY;
    add(m);
    return m;
  }
  function facadeBox(cx, cz, w, h, d, tex, roofColor) {
    const mats = [
      new THREE.MeshLambertMaterial({ map: tex }),
      new THREE.MeshLambertMaterial({ map: tex }),
      std(roofColor, 0.9),
      std(roofColor, 0.9),
      new THREE.MeshLambertMaterial({ map: tex }),
      new THREE.MeshLambertMaterial({ map: tex }),
    ];
    const m = new THREE.Mesh(new THREE.BoxGeometry(w, h, d), mats);
    m.position.set(cx, h / 2, cz);
    m.castShadow = true; m.receiveShadow = true;
    add(m);
    return m;
  }

  // ---- 3D structure kit: real geometry on every building, not just texture.
  // Ground floor band (proud base + storefront glass + door + step).
  function groundFloor(cx, cz, w, d, baseColor, glassColor = 0x9fd8ef) {
    add(box(w + 0.2, 3.6, d + 0.2, std(baseColor, 0.9), cx, 1.8, cz));
    const glass = new THREE.Mesh(new THREE.PlaneGeometry(w * 0.5, 2.4), new THREE.MeshLambertMaterial({ color: glassColor }));
    glass.position.set(cx - w * 0.18, 1.9, cz + d / 2 + 0.18); add(glass); // 0.08 in front of the base face (+0.1) — was 0.02, z-fought at distance
    add(box(1.7, 2.6, 0.18, std(0x2c2c34, 0.9), cx + w * 0.28, 1.3, cz + d / 2 + 0.12)); // door
    add(box(2.4, 0.25, 1.0, std(0x9a9a9a, 0.9), cx + w * 0.28, 0.12, cz + d / 2 + 0.6)); // step
  }
  // Entrance canopy on posts (street face).
  function canopy(cx, cz, d, w, color) {
    add(box(w, 0.22, 1.6, std(color, 0.85), cx, 3.9, cz + d / 2 + 0.8));
    add(cyl(0.08, 0.08, 3.9, std(0x3d4149, 0.8), cx - w / 2 + 0.3, 1.95, cz + d / 2 + 1.4, 6));
    add(cyl(0.08, 0.08, 3.9, std(0x3d4149, 0.8), cx + w / 2 - 0.3, 1.95, cz + d / 2 + 1.4, 6));
  }
  // Corner pilasters (vertical articulation above the ground floor).
  function pilasters(cx, cz, w, d, h, color) {
    const p = std(color, 0.9);
    const hgt = Math.max(2, h - 3.6);
    for (const [px, pz] of [[-1, -1], [1, -1], [-1, 1], [1, 1]]) {
      add(box(0.5, hgt, 0.5, p, cx + px * (w / 2 - 0.1), 3.6 + hgt / 2, cz + pz * (d / 2 - 0.1)));
    }
  }
  // Projecting cornice rim at the roofline.
  function crown(cx, cz, w, d, h, color) {
    const c = std(color, 0.9);
    add(box(w + 0.7, 0.5, 0.4, c, cx, h + 0.25, cz + d / 2 + 0.15));
    add(box(w + 0.7, 0.5, 0.4, c, cx, h + 0.25, cz - d / 2 - 0.15));
    add(box(0.4, 0.5, d + 0.7, c, cx + w / 2 + 0.15, h + 0.25, cz));
    add(box(0.4, 0.5, d + 0.7, c, cx - w / 2 - 0.15, h + 0.25, cz));
  }
  // Thin floor slabs (horizontal structure on tall facades).
  function floorBands(cx, cz, w, d, h, floorH, color) {
    const n = Math.floor((h - 4) / floorH);
    for (let i = 1; i <= n; i += 1) {
      const y = 3.6 + i * floorH;
      if (y > h - 0.5) break;
      add(box(w + 0.35, 0.28, d + 0.35, std(color, 0.9), cx, y, cz));
    }
  }
  // Rooftop props: AC units, water tank, antenna, solar panels, beacon.
  function rooftopProps(cx, cz, w, d, topY, rng) {
    add(box(1.6, 0.9, 1.2, std(0x9aa2ab, 0.8), cx - w * 0.2, topY + 0.45, cz - d * 0.15));
    if (rng.chance(0.6)) add(box(1.2, 0.7, 1.0, std(0x8a939c, 0.8), cx + w * 0.25, topY + 0.35, cz + d * 0.2));
    if (rng.chance(0.5)) add(box(2.2, 0.6, 1.4, std(0xb8b0a2, 0.9), cx + w * 0.05, topY + 0.3, cz + d * 0.25)); // rooftop plant box
    if (rng.chance(0.5)) {
      add(cyl(0.9, 0.9, 2.0, std(0x7a5a3a, 0.9), cx + w * 0.28, topY + 1.0, cz - d * 0.25, 10)); // sits on the roof (was topY+1.6, floating 0.6 m)
      const cone = new THREE.Mesh(new THREE.ConeGeometry(1.0, 0.8, 10), std(0x5d4630, 0.9));
      cone.position.set(cx + w * 0.28, topY + 2.4, cz - d * 0.25); // on the tank lid (was topY+3.0)
      cone.castShadow = true;
      add(cone);
    }
    if (rng.chance(0.4)) {
      add(cyl(0.06, 0.09, 4.5, std(0x3d4149, 0.8), cx - w * 0.3, topY + 2.2, cz + d * 0.25, 6));
      // Red beacon sphere on the antenna tip (Claude v7 addon).
      const beacon = new THREE.Mesh(new THREE.SphereGeometry(0.22, 8, 6), emissiveMat(0xff2233, 2));
      beacon.position.set(cx - w * 0.3, topY + 4.6, cz + d * 0.25);
      add(beacon);
    }
    if (rng.chance(0.3)) {
      // 4 tilted solar panels in a row.
      for (let i = 0; i < 4; i += 1) {
        const p = box(1.6, 0.08, 1.1, std(0x1d3f5e, 0.9), cx - w * 0.25 + i * 1.8, topY + 0.35, cz - d * 0.1); // low edge nearly touches the roof (was topY+0.55)
        p.rotation.x = -0.5;
      }
    }
  }
  // Coloured tilted awning over the ground floor + valance strip + planter
  // boxes with shrubs at both sides (Claude v7 addon, own code).
  function awnings(cx, cz, w, d, color) {
    const a = box(w * 0.85, 0.18, 1.5, std(color, 0.9), cx, 3.4, cz + d / 2 + 0.7);
    a.rotation.x = 0.28; // tilted down toward the street
    add(box(w * 0.85, 0.5, 0.1, std(0x2c2c34, 0.9), cx, 3.0, cz + d / 2 + 1.35)); // valance
    for (const sx of [-1, 1]) {
      add(box(1.0, 0.5, 0.6, std(0x8a6a42, 0.95), cx + sx * (w * 0.42), 0.25, cz + d / 2 + 1.2)); // planter
      const shrub = new THREE.Mesh(new THREE.SphereGeometry(0.45, 8, 6), std(0x3f8f3a, 1));
      shrub.position.set(cx + sx * (w * 0.42), 0.7, cz + d / 2 + 1.2);
      shrub.castShadow = true;
      add(shrub);
    }
  }
  // Balconies on alternating floors (up to 6): slab + railing, street face.
  function balconies(cx, cz, w, d, h) {
    const floors = Math.min(6, Math.floor((h - 4) / 3));
    for (let f = 0; f < floors; f += 2) {
      const y = 5.5 + f * 3;
      if (y > h - 1) break;
      add(box(w * 0.7, 0.22, 1.1, std(0x5a6672, 0.85), cx, y, cz + d / 2 + 0.55)); // slab
      add(box(w * 0.7, 0.7, 0.08, std(0x2c3240, 0.8), cx, y + 0.45, cz + d / 2 + 1.05)); // railing
      for (const px of [-w * 0.32, 0, w * 0.32]) {
        add(box(0.08, 0.7, 0.08, std(0x2c3240, 0.8), cx + px, y + 0.45, cz + d / 2 + 1.05));
      }
    }
  }
  // Small AC boxes on random floors of the street face.
  function facadeAC(cx, cz, w, d, h, rng) {
    const n = Math.max(1, Math.floor(h / 6));
    for (let i = 0; i < n; i += 1) {
      const y = 5 + rng.range(0, Math.max(0.5, h - 6));
      const x = cx + rng.range(-w * 0.35, w * 0.35);
      add(box(0.9, 0.6, 0.4, std(0x9aa2ab, 0.85), x, y, cz + d / 2 + 0.2));
      add(box(0.7, 0.08, 0.42, std(0x6b7a86, 0.85), x, y + 0.34, cz + d / 2 + 0.2));
    }
  }
  // Porch slab + posts + roof (houses / villas).
  function porch(cx, cz, w, d) {
    add(box(3.4, 0.3, 1.6, std(0x9a9a9a, 0.9), cx, 0.15, cz + d / 2 + 0.8));
    add(box(0.18, 2.6, 0.18, std(0xffffff, 0.9), cx - 1.4, 1.3, cz + d / 2 + 1.4));
    add(box(0.18, 2.6, 0.18, std(0xffffff, 0.9), cx + 1.4, 1.3, cz + d / 2 + 1.4));
    add(box(3.6, 0.18, 1.8, std(0x8a5a3a, 0.9), cx, 2.7, cz + d / 2 + 0.8));
  }
  // Front windows + shutters (houses / villas).
  function houseFront(cx, cz, w, d) {
    const glass = new THREE.MeshLambertMaterial({ color: 0x2e4a5e });
    for (const wx of [-w * 0.25, w * 0.25]) {
      const win = new THREE.Mesh(new THREE.PlaneGeometry(1.1, 1.3), glass);
      win.position.set(cx + wx, 2.2, cz + d / 2 + 0.06); add(win);
      add(box(0.45, 1.4, 0.08, std(0x4a6a8a, 0.9), cx + wx - 0.8, 2.2, cz + d / 2 + 0.07));
      add(box(0.45, 1.4, 0.08, std(0x4a6a8a, 0.9), cx + wx + 0.8, 2.2, cz + d / 2 + 0.07));
    }
  }
  // Window grids on the blank side faces, so no building reads as a flat
  // slab from the street. `glow` makes the grid neon-lit (club / casino).
  function sideWindows(cx, cz, w, d, y0, y1, base, win, lit, glow = false) {
    const tex = windowsTex(base, win, lit, 6, Math.max(2, Math.round((y1 - y0) / 3)), 5);
    const mat = glow
      ? new THREE.MeshLambertMaterial({ map: tex, emissive: 0xffffff, emissiveMap: tex, emissiveIntensity: 0.45 })
      : new THREE.MeshLambertMaterial({ map: tex });
    for (const sx of [-1, 1]) {
      const m = new THREE.Mesh(new THREE.PlaneGeometry(Math.min(d * 0.6, 16), y1 - y0), mat);
      m.position.set(cx + sx * (w / 2 + 0.06), (y0 + y1) / 2, cz);
      m.rotation.y = sx * Math.PI / 2;
      add(m);
    }
  }

  // ---- Building styles (each block picks a distinct architecture) ------
  const styles = [
    // 0 glass tower
    (cx, cz, w, d) => {
      const h = rng.range(34, 58);
      const tex = windowsTex(rng.pick(['#7fb2d9', '#9fc6e8', '#6a9ec6', '#8fb8d9']), '#1d3f5e', '#ffe9a8', 8, 16, 3);
      facadeBox(cx, cz, w, h, d, tex, rng.pick([0x2c4a63, 0x3a5a74, 0x22384a]));
      add(box(w * 0.4, 2.2, d * 0.4, std(0x9fb6c6, 0.5, 0.4), cx, h + 1.1, cz)); // rooftop plant
      add(box(w * 0.55, 0.5, d * 0.55, std(0x3a5a74, 0.6), cx, h + 0.25, cz));
      return h;
    },
    // 1 brick apartment
    (cx, cz, w, d) => {
      const h = rng.range(12, 20);
      const tex = windowsTex(rng.pick(['#9a4a38', '#a85a44', '#8a4030']), '#2e1d18', '#ffd98a', 6, 4, 7);
      facadeBox(cx, cz, w, h, d, tex, rng.pick([0x6e342a, 0x5d2d24, 0x7a3b2e]));
      add(box(w + 0.6, 0.7, d + 0.6, std(0x5d2d24, 1), cx, h + 0.35, cz)); // cornice
      add(cyl(0.35, 0.35, 1.6, std(0x7a3b2e, 1), cx - w / 4, h + 0.8, cz - d / 4, 8)); // chimney (was h+1.2, floating 0.4 m)
      return h;
    },
    // 2 art-deco hotel (stepped tiers + fin)
    (cx, cz, w, d) => {
      const h1 = rng.range(14, 18), h2 = h1 * 0.6, h3 = h2 * 0.55;
      const cream = std(0xf3e6c8, 0.8);
      add(box(w, h1, d, cream, cx, h1 / 2, cz));
      add(box(w * 0.7, h2, d * 0.7, cream, cx, h1 + h2 / 2, cz));
      add(box(w * 0.45, h3, d * 0.45, std(0xe8c98a, 0.7, 0.2), cx, h1 + h2 + h3 / 2, cz));
      // (M3c glitch fix: the old wide 'HOTEL LA VEGA' signPlane sat at
      // z+0.06, inside the new HOTEL blade backing — the blade carries the
      // sign now, so the horizontal sign is dropped.)
      return h1 + h2 + h3;
    },
    // 3 stucco house with pitched roof
    (cx, cz, w, d) => {
      const h = rng.range(5, 7);
      const color = rng.pick([0xf2d8a7, 0xf5efe4, 0xe8b4a0, 0xcfe3d0, 0xf0c98a]);
      add(box(w, h, d, std(color, 0.9), cx, h / 2, cz));
      const roof = new THREE.Mesh(new THREE.ConeGeometry(Math.max(w, d) * 0.72, 2.6, 4), std(rng.pick([0xb0512f, 0x7a4a3a, 0x4a6a8a]), 0.9));
      roof.position.set(cx, h + 1.3, cz);
      roof.rotation.y = Math.PI / 4;
      roof.scale.set(w / Math.max(w, d), 1, d / Math.max(w, d));
      roof.castShadow = true;
      add(roof);
      add(box(w * 0.3, 1.4, 0.15, std(0x3a2c22, 0.9), cx, 0.7, cz + d / 2 + 0.05)); // door
      return h + 2.6;
    },
    // 4 modern concrete block with balconies
    (cx, cz, w, d) => {
      const h = rng.range(16, 26);
      const tex = windowsTex(rng.pick(['#cfd6dd', '#dde3e8', '#b8c4cc']), '#33424f', '#ffe9a8', 6, 6, 11);
      facadeBox(cx, cz, w, h, d, tex, rng.pick([0x8a939c, 0x7a8a98, 0x9aa2ab]));
      for (let f = 0; f < 3; f += 1) {
        add(box(w * 0.8, 0.25, 1.1, std(0x5a6672, 0.8), cx, 4 + f * 6, cz + d / 2 + 0.55)); // balcony slab
      }
      return h;
    },
    // 5 low shop row with awnings
    (cx, cz, w, d) => {
      const h = rng.range(5.5, 7.5);
      add(box(w, h, d, std(rng.pick([0xe2725b, 0xf2a541, 0x5b8dd9, 0x7fb069, 0xe25f7a]), 0.85), cx, h / 2, cz));
      add(box(w + 0.4, 0.5, d + 0.4, std(0x3d4149, 0.9), cx, h + 0.25, cz));
      const awn = std(rng.pick([0xff6b6b, 0x4ecdc4, 0xffd166, 0x95d5b2]), 0.9);
      add(box(w * 0.9, 0.25, 1.4, awn, cx, 3.1, cz + d / 2 + 0.6));
      return h;
    },
    // 6 office slab with ribbon windows
    (cx, cz, w, d) => {
      const h = rng.range(20, 34);
      const tex = windowsTex(rng.pick(['#aebac4', '#c0ccd6', '#9fb2c0']), '#22303c', '#cfe8ff', 10, 10, 5);
      facadeBox(cx, cz, w, h, d, tex, rng.pick([0x6b7a86, 0x5a6a76, 0x7a8a96]));
      add(box(w * 0.3, 1.8, d * 0.3, std(0x4a5a66, 0.6, 0.3), cx + w / 4, h + 0.9, cz));
      return h;
    },
    // 7 pastel villa
    (cx, cz, w, d) => {
      const h = rng.range(6, 9);
      add(box(w, h, d, std(rng.pick([0xffd6e0, 0xcdeffd, 0xfff3b0, 0xd8f3c0]), 0.9), cx, h / 2, cz));
      add(box(w * 0.5, h * 0.5, d * 0.6, std(0xffffff, 0.9), cx - w * 0.2, h + h * 0.25, cz));
      add(cyl(0.3, 0.3, 1.4, std(0x8a8f98, 1), cx + w / 3, h + 0.7, cz, 8)); // chimney base on the roof (was h+1.6, floating 0.9 m)
      return h;
    },
    // 8 townhouse: pitched roof + bay window + chimney (M3c variety)
    (cx, cz, w, d) => {
      const h = rng.range(8, 11);
      add(box(w, h, d, std(rng.pick([0xc96f3b, 0x8a6a42, 0x6a7a8a, 0xa85a5a]), 0.9), cx, h / 2, cz));
      const roof = new THREE.Mesh(new THREE.ConeGeometry(Math.max(w, d) * 0.72, 2.4, 4), std(rng.pick([0x5d4630, 0x3d2c1e, 0x2c3a4a]), 0.9));
      roof.position.set(cx, h + 1.2, cz); roof.rotation.y = Math.PI / 4; roof.scale.set(w / Math.max(w, d), 1, d / Math.max(w, d)); roof.castShadow = true; add(roof);
      add(box(w * 0.35, 2.2, 0.8, std(0x9fd8ff, 0.9), cx - w * 0.2, 1.6, cz + d / 2 + 0.3)); // bay window
      add(cyl(0.3, 0.3, 1.6, std(0x7a3b2e, 1), cx + w / 3, h + 1.4, cz - d / 4, 8)); // chimney
      return h + 2.4;
    },
    // 9 modern villa: flat roof + terrace + pool (M3c variety)
    (cx, cz, w, d) => {
      const h = rng.range(5, 7);
      add(box(w, h, d, std(rng.pick([0xf5efe4, 0xe8e0cc, 0xdde3e8]), 0.9), cx, h / 2, cz));
      add(box(w * 0.6, 0.4, d * 0.6, std(0x2c3240, 0.9), cx, h + 0.2, cz)); // roof slab
      const glass = new THREE.Mesh(new THREE.PlaneGeometry(w * 0.6, h * 0.7), new THREE.MeshLambertMaterial({ color: 0x9fd8ff }));
      glass.position.set(cx, h * 0.5, cz + d / 2 + 0.06); add(glass);
      add(box(4, 0.12, 2.6, std(0xe8e0cc, 0.9), cx + w * 0.2, 0.06, cz + d / 2 + 1.6)); // terrace
      const pool = new THREE.Mesh(new THREE.BoxGeometry(3, 0.18, 2), new THREE.MeshLambertMaterial({ color: 0x2fb7d9 }));
      pool.position.set(cx - w * 0.25, 0.14, cz + d / 2 + 1.6); add(pool);
      return h;
    },
    // 10 stepped tower: setback tiers + rooftop plant (M3c variety)
    (cx, cz, w, d) => {
      const h = rng.range(22, 30);
      const tex = windowsTex(rng.pick(['#5a7a9a', '#7a9ab8', '#4a6a8a']), '#16283a', '#ffe9a8', 6, 8, 11);
      facadeBox(cx, cz, w, h, d, tex, rng.pick([0x2c4256, 0x35485c, 0x22364a]));
      add(box(w * 0.65, h * 0.4, d * 0.65, std(0x3a5468, 0.9), cx, h + h * 0.2, cz));
      add(box(w * 0.4, 1.6, d * 0.4, std(0x22364a, 0.9), cx, h * 1.4 + 0.8, cz));
      return h * 1.4 + 1.6;
    },
    // 11 corner shop: glass storefront + awning + shop sign (M3c variety)
    (cx, cz, w, d) => {
      const h = rng.range(6, 8);
      const shop = rng.pick([['BAKERY', '#f27d4a', '#fff3e0'], ['TACOS', '#e84a4a', '#fff3e0'], ['FLOWERS', '#4a9a5a', '#ffffff'], ['BOOKS', '#4a6a9a', '#ffffff']]);
      add(box(w, h, d, std(rng.pick([0xf3e6c8, 0xe8dcc8, 0xdde3e8]), 0.9), cx, h / 2, cz));
      const glass = new THREE.Mesh(new THREE.PlaneGeometry(w * 0.7, 2.6), new THREE.MeshLambertMaterial({ color: 0x9fd8ff }));
      glass.position.set(cx, 1.5, cz + d / 2 + 0.06); add(glass);
      add(box(w * 0.8, 0.5, 0.9, std(0xe84a4a, 0.9), cx, 3.4, cz + d / 2 + 0.4)); // awning
      signPlane(shop[0], shop[1], shop[2], Math.min(w * 0.7, 10), 1.8, cx, h - 1.2, cz + d / 2 + 0.06);
      return h;
    },
  ];

  // ---- Landmarks --------------------------------------------------------
  function buildClub(cx, cz, w, d) {
    const h = 11;
    add(box(w, h, d, std(0x6b2d8f, 0.8), cx, h / 2, cz));
    add(box(w + 1, 1, d + 1, std(0x2a1140, 0.7), cx, h + 0.5, cz));
    // neon sign + pink glow strip
    signPlane("LA ROSA'S", '#ff2e88', '#ffffff', 11, 2.6, cx, h * 0.72, cz + d / 2 + 0.06, 0, 'CLUB • MARLIN ROW');
    const glow = new THREE.Mesh(new THREE.PlaneGeometry(w, 0.5), emissiveMat(0xff2e88, 2));
    glow.position.set(cx, 2.2, cz + d / 2 + 0.07); add(glow);
    const door = new THREE.Mesh(new THREE.PlaneGeometry(3, 4.4), new THREE.MeshLambertMaterial({ color: 0x12081c, emissive: 0xff2e88, emissiveIntensity: 0.25 }));
    door.position.set(cx, 2.2, cz + d / 2 + 0.06); add(door);
    return h + 1;
  }
  function buildGarage(cx, cz, w, d) {
    const h = 8;
    add(box(w, h, d, std(0xf27d4a, 0.85), cx, h / 2, cz));
    add(box(w, 0.8, d, std(0x3d4149, 0.9), cx, h + 0.4, cz));
    signPlane("MANNY'S", '#20242c', '#ffb347', 10, 2.4, cx, h * 0.78, cz + d / 2 + 0.06, 0, 'GARAGE • 24H');
    // open bays (dark insets)
    for (const off of [-w / 4, w / 4]) {
      const bay = new THREE.Mesh(new THREE.PlaneGeometry(4.4, 5), new THREE.MeshLambertMaterial({ color: 0x14100c }));
      bay.position.set(cx + off, 2.5, cz + d / 2 + 0.06); add(bay);
    }
    return h;
  }
  function buildWarehouse(cx, cz, w, d) {
    const h = 10;
    const rust = std(0x8a5f3c, 0.95);
    add(box(w, h, d, rust, cx, h / 2, cz));
    // sawtooth roof
    for (let i = 0; i < 3; i += 1) {
      const tooth = new THREE.Mesh(new THREE.CylinderGeometry(0.01, w / 6, 3.2, 4), std(0x6e4a2e, 0.95));
      tooth.position.set(cx - w / 3 + i * (w / 3), h + 1.4, cz);
      tooth.rotation.y = Math.PI / 4;
      tooth.scale.set(1, 1, d / (w / 3));
      tooth.castShadow = true;
      add(tooth);
    }
    const stack = cyl(0.9, 1.2, 16, std(0x5d4a3a, 0.9), cx + w / 2 + 2, 8, cz - d / 3, 10);
    add(stack);
    signPlane('OLD CANNERY', '#5d3a1e', '#ffd166', 10, 2.2, cx, h * 0.7, cz + d / 2 + 0.06);
    return h + 3;
  }
  function buildHospital(cx, cz, w, d) {
    const h = 16;
    const tex = windowsTex('#e8e8e8', '#3a5a7a', '#fff2b0', 6, 4, 13);
    facadeBox(cx, cz, w, h, d, tex, 0xd8d8d8);
    add(box(w * 0.4, 3, d * 0.4, std(0xffffff, 0.8), cx, h + 1.5, cz));
    signPlane('LA VEGA GENERAL', '#ffffff', '#d92038', 12, 2.4, cx, h * 0.8, cz + d / 2 + 0.06, 0, 'HOSPITAL');
    return h + 3;
  }
  function buildCasino(cx, cz, w, d) {
    const h = 13;
    add(box(w, h, d, std(0x2a1140, 0.75), cx, h / 2, cz));
    add(box(w * 0.7, h * 0.5, d * 0.5, std(0x4a1d6e, 0.7), cx, h + h * 0.25, cz));
    const neon = new THREE.Mesh(new THREE.PlaneGeometry(w * 0.8, 2.4), emissiveMat(0x22e6ff, 2.2));
    neon.position.set(cx, h * 0.55, cz + d / 2 + 0.07); add(neon);
    signPlane('NEON PALM', '#12081c', '#22e6ff', 10, 2.2, cx, h * 0.85, cz + d / 2 + 0.06, 0, 'CASINO');
    return h + h * 0.5;
  }
  function buildCityHall(cx, cz, w, d) {
    const h = 12;
    add(box(w, h, d, std(0xf5efe4, 0.85), cx, h / 2, cz));
    // columned portico
    for (let i = -2; i <= 2; i += 1) {
      add(cyl(0.55, 0.65, h * 0.85, std(0xffffff, 0.7), cx + i * 2.6, h * 0.42, cz + d / 2 + 1.2, 12));
    }
    add(box(w * 0.8, 1.2, 3, std(0xe8e0cc, 0.85), cx, h * 0.88, cz + d / 2 + 1.2));
    const dome = new THREE.Mesh(new THREE.SphereGeometry(4.2, 20, 12, 0, Math.PI * 2, 0, Math.PI / 2), new THREE.MeshLambertMaterial({ color: 0x7fb069 }));
    dome.position.set(cx, h, cz); dome.castShadow = true; add(dome);
    signPlane('CITY HALL', '#f5efe4', '#1d2a4a', 9, 2, cx, h * 0.72, cz + d / 2 + 0.06);
    return h + 4.2;
  }
  function buildMall(cx, cz, w, d) {
    const h = 9;
    add(box(w, h, d, std(0xdde3e8, 0.8), cx, h / 2, cz));
    const glass = new THREE.Mesh(new THREE.PlaneGeometry(w * 0.5, 5), new THREE.MeshLambertMaterial({ color: 0x9fd8ef }));
    glass.position.set(cx, 3, cz + d / 2 + 0.06); add(glass);
    signPlane('LA VEGA MALL', '#e2725b', '#ffffff', 11, 2.4, cx, h * 0.78, cz + d / 2 + 0.06);
    // Forecourt pad + entrance canopy + food-court sign (M3c: mall was a bare box).
    add(box(w * 0.7, 0.12, 6, std(0x9a9a92, 0.9), cx, 0.06, cz + d / 2 + 3.5));
    add(box(8, 0.22, 2, std(0xe2725b, 0.85), cx, 4.1, cz + d / 2 + 1.2));
    add(cyl(0.09, 0.09, 4.1, std(0x3d4149, 0.8), cx - 3.6, 2.05, cz + d / 2 + 2, 6));
    add(cyl(0.09, 0.09, 4.1, std(0x3d4149, 0.8), cx + 3.6, 2.05, cz + d / 2 + 2, 6));
    signPlane('FOOD COURT', '#20242c', '#ffd166', 6, 1.4, cx + w * 0.3, 5.2, cz + d / 2 + 0.06);
    for (const px of [-w * 0.3, w * 0.3]) {
      add(box(1.0, 0.5, 0.6, std(0x8a6a42, 0.95), cx + px, 0.25, cz + d / 2 + 1.6));
      const shrub = new THREE.Mesh(new THREE.SphereGeometry(0.5, 8, 6), std(0x3f8f3a, 1));
      shrub.position.set(cx + px, 0.75, cz + d / 2 + 1.6); shrub.castShadow = true; add(shrub);
    }
    return h;
  }
  function buildCinema(cx, cz, w, d) {
    const h = 9;
    add(box(w, h, d, std(0x3d2c4a, 0.85), cx, h / 2, cz));
    add(box(w * 0.9, 1.6, 2.2, std(0x1d1426, 0.7), cx, 5.2, cz + d / 2 + 0.8)); // marquee
    const marquee = new THREE.Mesh(new THREE.PlaneGeometry(w * 0.8, 1.2), emissiveMat(0xffd166, 1.6));
    marquee.position.set(cx, 5.2, cz + d / 2 + 1.95); add(marquee);
    signPlane('CINEMA', '#1d1426', '#ffd166', 8, 2, cx, h * 0.75, cz + d / 2 + 0.06);
    return h;
  }
  function buildDealer(cx, cz, w, d) {
    const h = 6;
    add(box(w, h, d, std(0x4a6a8a, 0.8), cx, h / 2, cz));
    const glass = new THREE.Mesh(new THREE.PlaneGeometry(w * 0.7, 3.6), new THREE.MeshLambertMaterial({ color: 0xbfe3f2 }));
    glass.position.set(cx, 2.6, cz + d / 2 + 0.06); add(glass);
    signPlane('AUTO PALMS', '#20242c', '#22c3aa', 9, 2.2, cx, h * 0.8, cz + d / 2 + 0.06, 0, 'CARS • TRUCKS');
    return h;
  }
  function buildConstruction(cx, cz, w, d) {
    // Unfinished concrete frame: columns + floor slabs, no walls.
    const h = 14;
    const conc = std(0xb8b0a2, 0.95);
    for (let i = 0; i < 3; i += 1) {
      add(box(w, 0.8, d, conc, cx, 3 + i * 5, cz));
      for (const px of [-w / 2 + 0.5, w / 2 - 0.5]) {
        for (const pz of [-d / 2 + 0.5, d / 2 - 0.5]) {
          add(box(0.9, 3 + i * 5, 0.9, conc, cx + px, (3 + i * 5) / 2, cz + pz));
        }
      }
    }
    // Crane: mast + jib + counter-jib.
    add(box(1, 26, 1, std(0xf7c948, 0.6, 0.3), cx + w / 2 + 3, 13, cz - d / 2));
    add(box(16, 1, 1, std(0xf7c948, 0.6, 0.3), cx + w / 2 - 2, 25, cz - d / 2));
    add(box(1.4, 2.4, 1.4, std(0x3d4149, 0.8), cx + w / 2 + 3, 26.5, cz - d / 2));
    return 27;
  }
  function buildDriveThru(cx, cz, w, d) {
    const h = 5.5;
    add(box(w, h, d, std(0xe01e37, 0.85), cx, h / 2, cz));
    add(box(w * 1.3, 0.5, d * 0.5, std(0xffffff, 0.8), cx, h * 0.7, cz + d / 2 + 1.4)); // canopy
    add(cyl(0.25, 0.25, h * 0.7, std(0xdddddd, 0.7), cx - w * 0.5, h * 0.35, cz + d / 2 + 2.4, 8));
    add(cyl(0.25, 0.25, h * 0.7, std(0xdddddd, 0.7), cx + w * 0.5, h * 0.35, cz + d / 2 + 2.4, 8));
    signPlane('BURGER BAY', '#e01e37', '#ffd166', 8, 2, cx, h * 0.72, cz + d / 2 + 0.06, 0, 'DRIVE-THRU');
    return h;
  }

  function buildVilla(cx, cz, w, d) {
    // Villa La Vega (Claude v7 addon parity): white two-story villa with a
    // terracotta roof, arched loggia, walled garden, pool and palms — the
    // rich side of Marina. Block 0,0, next to the beach.
    const h = 9;
    // Main villa: white stucco + terracotta roof slab.
    add(box(w * 0.62, h, d * 0.7, std(0xf5efe4, 0.85), cx - w * 0.12, h / 2, cz - d * 0.1));
    add(box(w * 0.62 + 1, 0.9, d * 0.7 + 1, std(0xc96f3b, 0.85), cx - w * 0.12, h + 0.45, cz - d * 0.1));
    // Side wing.
    add(box(w * 0.3, h * 0.7, d * 0.4, std(0xefe6d0, 0.85), cx + w * 0.28, h * 0.35, cz + d * 0.22));
    add(box(w * 0.3 + 0.8, 0.7, d * 0.4 + 0.8, std(0xc96f3b, 0.85), cx + w * 0.28, h * 0.7 + 0.35, cz + d * 0.22));
    // Arched loggia: three columns + architrave on the garden face.
    for (let i = -1; i <= 1; i += 1) {
      add(cyl(0.28, 0.32, 3.4, std(0xffffff, 0.7), cx - w * 0.12 + i * 3.2, 1.7, cz + d * 0.28, 10));
    }
    add(box(9.5, 0.7, 0.8, std(0xffffff, 0.7), cx - w * 0.12, 3.7, cz + d * 0.28));
    // Pool: turquoise water in a pale rim, south garden.
    add(box(8.4, 0.12, 5.4, std(0xe8e0cc, 0.9), cx + w * 0.22, 0.06, cz + d * 0.32));
    const pool = new THREE.Mesh(new THREE.BoxGeometry(7, 0.2, 4), new THREE.MeshLambertMaterial({ color: 0x2fb7d9 }));
    pool.position.set(cx + w * 0.22, 0.16, cz + d * 0.32); add(pool);
    // Garden wall on three sides (street face open).
    const wallM = std(0xe8dcc0, 0.9);
    add(box(w, 1.1, 0.4, wallM, cx, 0.55, cz + d / 2 - 0.2));
    add(box(0.4, 1.1, d, wallM, cx - w / 2 + 0.2, 0.55, cz));
    add(box(0.4, 1.1, d, wallM, cx + w / 2 - 0.2, 0.55, cz));
    // Gate pillars + lamp spheres at the street entrance (Claude estate).
    for (const sx of [-1, 1]) {
      add(box(0.7, 2.2, 0.7, wallM, cx + sx * 3, 1.1, cz + d / 2 + 0.4));
      const lamp = new THREE.Mesh(new THREE.SphereGeometry(0.32, 10, 8), emissiveMat(0xfff2b0, 1.2));
      lamp.position.set(cx + sx * 3, 2.45, cz + d / 2 + 0.4);
      add(lamp);
    }
    // Fountain in the garden: stone basin + water + top sphere.
    add(cyl(1.6, 1.8, 0.5, std(0xd8d8d8, 0.9), cx - w * 0.28, 0.25, cz + d * 0.28, 16));
    add(cyl(1.4, 1.4, 0.12, new THREE.MeshLambertMaterial({ color: 0x2fb7d9 }), cx - w * 0.28, 0.5, cz + d * 0.28, 16));
    add(cyl(0.25, 0.3, 0.9, std(0xd8d8d8, 0.9), cx - w * 0.28, 0.95, cz + d * 0.28, 8));
    const fTop = new THREE.Mesh(new THREE.SphereGeometry(0.4, 10, 8), std(0xd8d8d8, 0.9));
    fTop.position.set(cx - w * 0.28, 1.6, cz + d * 0.28);
    fTop.castShadow = true;
    add(fTop);
    // Flower bed along the front wall: a row of coloured blooms.
    const bloomCols = [0xff6b9d, 0xd92038, 0xffd166, 0xffffff, 0xb06fd6, 0xff8a3c];
    for (let i = 0; i < 12; i += 1) {
      const b = new THREE.Mesh(new THREE.SphereGeometry(0.18, 8, 6), std(bloomCols[i % bloomCols.length], 1));
      b.position.set(cx - w * 0.4 + i * (w * 0.8 / 11), 0.32, cz + d / 2 - 0.9);
      add(b);
    }
    // Gazebo in the back corner: 4 posts + pyramid roof.
    const gzX = cx + w * 0.3, gzZ = cz - d * 0.3;
    for (const [ox, oz] of [[-1.2, -1.2], [1.2, -1.2], [-1.2, 1.2], [1.2, 1.2]]) {
      add(box(0.18, 2.4, 0.18, std(0xffffff, 0.9), gzX + ox, 1.2, gzZ + oz));
    }
    const gzRoof = new THREE.Mesh(new THREE.ConeGeometry(2.4, 1.2, 4), std(0xc96f3b, 0.9));
    gzRoof.position.set(gzX, 3.0, gzZ);
    gzRoof.rotation.y = Math.PI / 4;
    gzRoof.castShadow = true;
    add(gzRoof);
    // Lounge chairs + umbrella by the pool.
    for (const lx of [-1.4, 1.4]) {
      const chair = box(0.7, 0.12, 1.9, std(0xf5efe4, 0.9), cx + w * 0.22 + lx, 0.35, cz + d * 0.32 + 3.6);
      chair.rotation.x = -0.25;
      add(box(0.7, 0.35, 0.12, std(0x8a6a42, 0.9), cx + w * 0.22 + lx, 0.18, cz + d * 0.32 + 4.4));
    }
    add(cyl(0.06, 0.06, 2.4, std(0x3d4149, 0.8), cx + w * 0.22, 1.2, cz + d * 0.32 + 3.6, 6));
    const umb = new THREE.Mesh(new THREE.ConeGeometry(1.3, 0.6, 10), std(0xff2e88, 0.9));
    umb.position.set(cx + w * 0.22, 2.6, cz + d * 0.32 + 3.6);
    umb.castShadow = true;
    add(umb);
    // Garden palms.
    for (const [px, pz] of [[-w * 0.32, d * 0.3], [w * 0.05, d * 0.34], [-w * 0.05, -d * 0.3]]) {
      add(cyl(0.16, 0.22, 4.6, std(0x8a6a42, 0.95), cx + px, 2.3, cz + pz, 8));
      const top = new THREE.Mesh(new THREE.SphereGeometry(1.7, 10, 8), new THREE.MeshLambertMaterial({ color: 0x3f8f3a }));
      top.scale.y = 0.55; top.position.set(cx + px, 4.9, cz + pz); top.castShadow = true; add(top);
    }
    signPlane('VILLA LA VEGA', '#f5efe4', '#1d2a4a', 8, 1.8, cx, 2.4, cz + d / 2 + 0.06, 0, 'MARINA HILLS');
    return h + 1;
  }

  // ---- M3c new landmarks: police station, pet shop, restaurant, villa 2 --
  function buildPoliceStation(cx, cz, w, d) {
    const h = 10;
    add(box(w, h, d, std(0xe8e8e8, 0.85), cx, h / 2, cz));
    add(box(w, 1.2, d + 0.6, std(0x1d4e9e, 0.9), cx, h * 0.55, cz)); // blue band
    add(box(w * 0.5, 2.2, d * 0.4, std(0x1d4e9e, 0.9), cx, h + 1.1, cz)); // roof block
    signPlane('LVPD', '#1d4e9e', '#ffffff', 9, 2.4, cx, h * 0.8, cz + d / 2 + 0.06, 0, 'POLICE');
    const glass = new THREE.Mesh(new THREE.PlaneGeometry(w * 0.6, 3), new THREE.MeshLambertMaterial({ color: 0x9fd8ff }));
    glass.position.set(cx, 2.2, cz + d / 2 + 0.06); add(glass);
    // Flag pole + LVPD flag.
    add(cyl(0.07, 0.09, 7, std(0x3d4149, 0.8), cx - w * 0.35, 3.5, cz + d / 2 + 2.2, 6));
    const flag = new THREE.Mesh(new THREE.PlaneGeometry(1.6, 1), new THREE.MeshBasicMaterial({ color: 0x1d4e9e, side: THREE.DoubleSide }));
    flag.position.set(cx - w * 0.35 + 0.85, 6.4, cz + d / 2 + 2.2); add(flag);
    // Police parking in front: 2 marked bays (the cruisers spawn in game.js).
    add(box(10, 0.12, 6, std(0x3d4149, 0.9), cx, 0.06, cz + d / 2 + 4));
    return h + 2.2;
  }
  function buildPetShop(cx, cz, w, d) {
    const h = 6;
    add(box(w, h, d, std(0xf2a541, 0.85), cx, h / 2, cz));
    add(box(w + 0.4, 0.5, d + 0.4, std(0x7a4a2a, 0.9), cx, h + 0.25, cz));
    signPlane('PET SHOP', '#7a4a2a', '#ffffff', 8, 2, cx, h * 0.72, cz + d / 2 + 0.06, 0, 'DOGS • CATS • FISH');
    const glass = new THREE.Mesh(new THREE.PlaneGeometry(w * 0.7, 2.6), new THREE.MeshLambertMaterial({ color: 0xcfe8ff }));
    glass.position.set(cx, 1.9, cz + d / 2 + 0.06); add(glass);
    // Fenced yard + doghouse at the side.
    add(box(4, 1, 0.15, std(0x8a6a42, 0.9), cx + w * 0.3, 0.5, cz + d / 2 + 3));
    add(box(1.6, 1.2, 1.4, std(0x9a5a3a, 0.9), cx + w * 0.3, 0.6, cz + d / 2 + 2));
    const dhRoof = new THREE.Mesh(new THREE.ConeGeometry(1.4, 0.8, 4), std(0x6e4a2e, 0.9));
    dhRoof.position.set(cx + w * 0.3, 1.6, cz + d / 2 + 2); dhRoof.rotation.y = Math.PI / 4; add(dhRoof);
    return h;
  }
  function buildRestaurant(cx, cz, w, d) {
    const h = 7;
    add(box(w, h, d, std(0xe2725b, 0.85), cx, h / 2, cz));
    add(box(w * 0.6, 1, d * 0.5, std(0x3d2c1e, 0.9), cx, h + 0.5, cz - d * 0.2)); // roof block
    signPlane('WARUNG LA VEGA', '#3d2c1e', '#ffd166', 10, 2.2, cx, h * 0.75, cz + d / 2 + 0.06, 0, 'RUMAH MAKAN');
    // Outdoor terrace: 2 tables + umbrellas + chairs.
    for (const tx of [-w * 0.25, w * 0.25]) {
      add(cyl(0.06, 0.06, 2.2, std(0x3d4149, 0.8), cx + tx, 1.1, cz + d / 2 + 3, 6));
      const umb = new THREE.Mesh(new THREE.ConeGeometry(1.4, 0.6, 8), std(0xff6b6b, 0.9));
      umb.position.set(cx + tx, 2.4, cz + d / 2 + 3); umb.castShadow = true; add(umb);
      add(box(1.2, 0.1, 1.2, std(0xf5efe4, 0.9), cx + tx, 0.75, cz + d / 2 + 3));
      for (const [ox, oz] of [[-0.9, 0], [0.9, 0]]) add(box(0.5, 0.45, 0.5, std(0x8a6a42, 0.9), cx + tx + ox, 0.22, cz + d / 2 + 3 + oz));
    }
    return h + 1;
  }
  function buildVilla2(cx, cz, w, d) {
    const h = 8;
    add(box(w, h, d, std(0xffffff, 0.85), cx, h / 2, cz));
    add(box(w * 0.55, h * 0.45, d * 0.55, std(0xf0e0c0, 0.9), cx + w * 0.15, h + h * 0.22, cz));
    const roof = new THREE.Mesh(new THREE.ConeGeometry(Math.max(w, d) * 0.6, 2.2, 4), std(0xc96f3b, 0.9));
    roof.position.set(cx, h + 1.1, cz); roof.rotation.y = Math.PI / 4; roof.castShadow = true; add(roof);
    add(box(7, 0.12, 4.5, std(0xe8e0cc, 0.9), cx - w * 0.2, 0.06, cz + d * 0.3));
    const pool = new THREE.Mesh(new THREE.BoxGeometry(5.5, 0.2, 3.2), new THREE.MeshLambertMaterial({ color: 0x2fb7d9 }));
    pool.position.set(cx - w * 0.2, 0.16, cz + d * 0.3); add(pool);
    signPlane('VILLA DEL MAR', '#1d4e9e', '#ffffff', 8, 1.8, cx, 2.4, cz + d / 2 + 0.06, 0, 'PRIVATE');
    return h + 2.2;
  }

  const special = {
    '0,0': buildVilla,
    '4,2': buildClub,
    '1,4': buildGarage,
    '0,6': buildWarehouse,
    '6,0': buildHospital,
    '3,1': buildCasino,
    '5,5': buildCityHall,
    '2,4': buildMall,
    '5,1': buildCinema,
    '1,2': buildDealer,
    '6,4': buildConstruction,
    '3,5': buildDriveThru,
    '3,4': buildPoliceStation,
    '1,3': buildPetShop,
    '5,3': buildRestaurant,
    '6,6': buildVilla2,
  };

  // ---- Structure pass: apply the 3D kit per style / landmark -----------
  function finishGeneric(cx, cz, w, d, h, style) {
    switch (style) {
      case 0: // glass tower
        groundFloor(cx, cz, w, d, 0x22384a, 0x9fd8ef);
        for (const fx of [-0.35, -0.12, 0.12, 0.35]) {
          add(box(0.28, h * 0.92, 0.3, std(0x9fb6c6, 0.85), cx + fx * w, h * 0.5, cz + d / 2 + 0.12));
        }
        canopy(cx, cz, d, 5, 0x2c4a63);
        crown(cx, cz, w, d, h, 0x2c4a63);
        rooftopProps(cx, cz, w, d, h, rng);
        break;
      case 1: // brick apartment
        groundFloor(cx, cz, w, d, 0x4a241c, 0xffd98a);
        pilasters(cx, cz, w, d, h, 0x6e342a);
        crown(cx, cz, w, d, h, 0x6e342a);
        balconies(cx, cz, w, d, h);
        facadeAC(cx, cz, w, d, h, rng);
        rooftopProps(cx, cz, w, d, h, rng);
        break;
      case 2: // art-deco hotel
        groundFloor(cx, cz, w, d, 0x2a2a33, 0xffe9a8);
        canopy(cx, cz, d, 6, 0xd9a441);
        awnings(cx, cz, w, d, 0xd9a441);
        add(box(1.3, h * 0.8, 0.3, std(0x2a2a33, 1), cx, h * 0.45, cz + d / 2 + 0.12)); // hotel blade backing
        { const bp = new THREE.Mesh(new THREE.PlaneGeometry(1.1, h * 0.75), new THREE.MeshLambertMaterial({ map: signTexV('HOTEL', '#2a2a33', '#ffd166'), emissive: 0xffffff, emissiveMap: signTexV('HOTEL', '#2a2a33', '#ffd166'), emissiveIntensity: 0.45 })); bp.position.set(cx, h * 0.45, cz + d / 2 + 0.3); add(bp); }
        rooftopProps(cx, cz, w, d, h, rng);
        break;
      case 3: // stucco house
        porch(cx, cz, w, d);
        houseFront(cx, cz, w, d);
        break;
      case 4: // modern concrete block
        groundFloor(cx, cz, w, d, 0x5a6672, 0xcfe8ff);
        pilasters(cx, cz, w, d, h, 0x5a6672);
        floorBands(cx, cz, w, d, h, 6, 0x5a6672);
        crown(cx, cz, w, d, h, 0x8a939c);
        facadeAC(cx, cz, w, d, h, rng);
        rooftopProps(cx, cz, w, d, h, rng);
        break;
      case 5: // low shop row
        groundFloor(cx, cz, w, d, 0x3d4149, 0xffffff);
        awnings(cx, cz, w, d, rng.pick([0xff6b6b, 0x4ecdc4, 0xffd166, 0x95d5b2]));
        signPlane(rng.pick(['TACOS', 'CUTS', 'PIZZA', 'LAUNDRY']), '#20242c', '#ffd166', 4, 1.4, cx - w * 0.22, 4.6, cz + d / 2 + 0.06);
        signPlane(rng.pick(['DONUTS', 'TATTOO', 'FLOWERS', 'PHONES']), '#20242c', '#4ecdc4', 4, 1.4, cx + w * 0.22, 4.6, cz + d / 2 + 0.06);
        crown(cx, cz, w, d, h, 0x3d4149);
        break;
      case 6: // office slab
        groundFloor(cx, cz, w, d, 0x4a5a66, 0xcfe8ff);
        floorBands(cx, cz, w, d, h, 6.8, 0x6b7a86);
        canopy(cx, cz, d, 5, 0x4a5a66);
        crown(cx, cz, w, d, h, 0x6b7a86);
        facadeAC(cx, cz, w, d, h, rng);
        rooftopProps(cx, cz, w, d, h, rng);
        break;
      default: // pastel villa
        groundFloor(cx, cz, w, d, 0xf5efe4, 0xcfe8ff);
        porch(cx, cz, w, d);
        houseFront(cx, cz, w, d);
        break;
    }
  }

  function finishLandmark(cx, cz, w, d, h, key) {
    // Window grids on the blank side faces for every landmark.
    sideWindows(cx, cz, w, d, 4, Math.max(5, h - 2), '#3a5a7a', '#22303c', '#cfe8ff');
    switch (key) {
      case '4,2': // La Rosa's club
        sideWindows(cx, cz, w, d, 2, 8, '#6b2d8f', '#ff2e88', '#ffd6ec', true);
        pilasters(cx, cz, w, d, h, 0x2a1140);
        canopy(cx, cz, d, 6, 0xff2e88);
        add(box(6, 1.6, 1.2, emissiveMat(0xff2e88, 1.6), cx, h + 1.8, cz)); // rooftop neon block
        break;
      case '1,4': // Manny's garage
        add(box(2.2, 0.7, 2.2, std(0x1c1c22, 0.8), cx - w * 0.3, 0.35, cz + d / 2 + 1.5)); // tire stack
        add(box(2.2, 0.7, 2.2, std(0x1c1c22, 0.8), cx - w * 0.3, 1.05, cz + d / 2 + 1.5));
        canopy(cx, cz, d, 8, 0x3d4149);
        break;
      case '0,6': // old cannery warehouse
        add(box(w * 0.6, 0.5, 3, std(0x8a8f98, 0.9), cx, 0.25, cz + d / 2 + 1.5)); // loading dock
        add(box(5, 4.5, 0.2, std(0x3d4149, 0.9), cx, 2.25, cz + d / 2 + 0.08)); // sliding door
        break;
      case '6,0': { // La Vega General hospital: helipad + entrance canopy
        const pad = new THREE.Mesh(new THREE.CircleGeometry(3.2, 20), new THREE.MeshLambertMaterial({ color: 0x2c3240 }));
        pad.rotation.x = -Math.PI / 2;
        pad.position.set(cx + w * 0.32, h + 0.06, cz + d * 0.3);
        add(pad);
        const hSign = new THREE.Mesh(new THREE.PlaneGeometry(2.4, 2.4), new THREE.MeshLambertMaterial({ map: signTex('H', '#d92038', '#ffffff') }));
        hSign.rotation.x = -Math.PI / 2;
        hSign.position.set(cx + w * 0.32, h + 0.12, cz + d * 0.3); // 0.06 above the pad (was 0.04)
        add(hSign);
        canopy(cx, cz, d, 6, 0xffffff);
        break;
      }
      case '3,1': // Neon Palm casino
        add(box(1.5, 7.2, 0.9, std(0x12081c, 1), cx + w / 2 + 0.6, 8, cz + d / 2 - 2)); // blade sign backing
        { const bp = new THREE.Mesh(new THREE.PlaneGeometry(1.3, 6.8), new THREE.MeshLambertMaterial({ map: signTexV('CASINO', '#12081c', '#22e6ff'), emissive: 0xffffff, emissiveMap: signTexV('CASINO', '#12081c', '#22e6ff'), emissiveIntensity: 0.5 })); bp.position.set(cx + w / 2 + 1.38, 8, cz + d / 2 - 2); bp.rotation.y = Math.PI / 2; add(bp); } // blade plane 0.03 in front of the backing face (+1.35) — was +1.08, hidden inside the box
        sideWindows(cx, cz, w, d, 3, 10, '#2a1140', '#22e6ff', '#bff4ff', true);
        canopy(cx, cz, d, 8, 0x4a1d6e);
        break;
      case '5,5': // city hall: steps + flag poles
        add(box(8, 0.3, 2.4, std(0xd8d8d8, 0.9), cx, 0.15, cz + d / 2 + 2.2));
        add(box(7, 0.3, 1.8, std(0xd8d8d8, 0.9), cx, 0.45, cz + d / 2 + 1.8));
        for (const fx of [-5, 5]) {
          add(cyl(0.07, 0.09, 7, std(0x3d4149, 0.8), cx + fx, 3.5, cz + d / 2 + 2.6, 6));
          const flag = new THREE.Mesh(new THREE.PlaneGeometry(1.4, 0.9), new THREE.MeshBasicMaterial({ color: 0xffd166, side: THREE.DoubleSide }));
          flag.position.set(cx + fx + 0.75, 6.4, cz + d / 2 + 2.6);
          add(flag);
        }
        break;
      case '2,4': // mall
        canopy(cx, cz, d, 10, 0xe2725b);
        add(box(8, 1.8, 1, std(0xe2725b, 0.8), cx, h + 0.9, cz)); // roof sign block
        signPlane('MALL', '#e2725b', '#ffffff', 7, 1.6, cx, h + 0.9, cz + 0.55);
        break;
      case '5,1': // cinema
        add(box(1.3, 6.2, 0.9, std(0x1d1426, 1), cx - w / 2 - 0.6, 7, cz + d / 2 + 1)); // blade sign backing
        { const bp = new THREE.Mesh(new THREE.PlaneGeometry(1.1, 5.8), new THREE.MeshLambertMaterial({ map: signTexV('CINEMA', '#1d1426', '#ffd166'), emissive: 0xffffff, emissiveMap: signTexV('CINEMA', '#1d1426', '#ffd166'), emissiveIntensity: 0.5 })); bp.position.set(cx - w / 2 - 1.28, 7, cz + d / 2 + 1); bp.rotation.y = -Math.PI / 2; add(bp); } // blade plane 0.03 west of the backing face (-1.25) — was -1.08, hidden inside the box
        for (const px of [-w * 0.28, w * 0.28]) {
          add(box(2.2, 3, 0.15, std(0xffd166, 0.9), cx + px, 2.2, cz + d / 2 + 0.1)); // posters
        }
        break;
      case '1,2': // car dealer
        add(box(w * 0.8, 0.15, 6, std(0x8a939c, 0.9), cx, 0.08, cz + d / 2 + 4)); // forecourt pad
        canopy(cx, cz, d, 8, 0x4a6a8a);
        break;
      case '6,4': // construction site: scaffolding
        for (const sx of [-w / 2 - 1, w / 2 + 1]) {
          add(box(0.3, 10, 0.3, std(0xf7c948, 0.7), cx + sx, 5, cz + d / 2 + 1));
        }
        add(box(w + 2.6, 0.3, 0.3, std(0xf7c948, 0.7), cx, 10, cz + d / 2 + 1));
        break;
      case '3,5': // drive-thru
        add(box(2.4, 3, 0.3, std(0x20242c, 0.9), cx - w * 0.3, 1.8, cz + d / 2 + 2.5)); // menu board
        signPlane('MENU', '#20242c', '#ffd166', 2, 1, cx - w * 0.3, 2.6, cz + d / 2 + 2.7); // 0.05 in front of the board face (+2.65) — was 0.01, z-fought at distance
        break;
      default:
        break;
    }
  }

  // ---- Blocks ------------------------------------------------------------
  const parkingLots = [];
  for (let ix = 0; ix < ROADS.length - 1; ix += 1) {
    for (let iy = 0; iy < ROADS.length - 1; iy += 1) {
      const x0 = ROADS[ix] + WORLD.roadWidth / 2 + WORLD.sidewalk + 0.8;
      const z0 = ROADS[iy] + WORLD.roadWidth / 2 + WORLD.sidewalk + 0.8;
      const x1 = ROADS[ix + 1] - WORLD.roadWidth / 2 - WORLD.sidewalk - 0.8;
      const z1 = ROADS[iy + 1] - WORLD.roadWidth / 2 - WORLD.sidewalk - 0.8;
      const key = `${ix},${iy}`;
      const cx = (x0 + x1) / 2, cz = (z0 + z1) / 2;
      const w = x1 - x0, d = z1 - z0;
      if (key === '2,1') continue; // park handled below
      const builder = special[key];
      if (builder) {
        const lh = builder(cx, cz, w, d);
        finishLandmark(cx, cz, w, d, lh, key);
        addCollider(cx, cz, w, d, lh);
        mapBuildings.push({ x: cx, z: cz, w, d, color: '#b06fd6' });
        continue;
      }
      if (rng.chance(0.12)) { parkingLots.push({ x0, z0, x1, z1 }); continue; }
      if (rng.chance(0.08)) continue; // empty plaza
      const styleIdx = rng.int(0, styles.length - 1);
      if (rng.chance(0.5)) {
        // Two buildings side by side, different styles.
        const split = rng.range(0.42, 0.58);
        const w1 = w * split - 0.8, w2 = w * (1 - split) - 0.8;
        const c1x = x0 + w1 / 2, c2x = x0 + w * split + 0.8 + w2 / 2;
        const h1 = styles[styleIdx](c1x, cz, w1, d);
        const s2 = rng.int(0, styles.length - 1);
        const h2 = styles[s2](c2x, cz, w2, d);
        finishGeneric(c1x, cz, w1, d, h1, styleIdx);
        finishGeneric(c2x, cz, w2, d, h2, s2);
        addCollider(c1x, cz, w1, d, h1);
        addCollider(c2x, cz, w2, d, h2);
        mapBuildings.push({ x: c1x, z: cz, w: w1, d, color: '#8a939c' });
        mapBuildings.push({ x: c2x, z: cz, w: w2, d, color: '#8a939c' });
      } else {
        const bx = cx + rng.range(-1, 1), bz = cz + rng.range(-1, 1);
        const bw = w - rng.range(0, 3), bd = d - rng.range(0, 2);
        const bh = styles[styleIdx](bx, bz, bw, bd);
        finishGeneric(bx, bz, bw, bd, bh, styleIdx);
        addCollider(cx, cz, w, d, bh);
        mapBuildings.push({ x: cx, z: cz, w, d, color: '#8a939c' });
      }
    }
  }

  // ---- Gas station (Petro Vega) on the first parking lot -----------------
  let gasStation = { x: PLACES.gas.x, z: PLACES.gas.y };
  if (parkingLots.length > 0) {
    const lot = parkingLots[0];
    const gx = (lot.x0 + lot.x1) / 2, gz = (lot.z0 + lot.z1) / 2;
    gasStation = { x: gx, z: gz };
    PLACES.gas.x = gx; PLACES.gas.y = gz;
    // Canopy on pillars.
    add(box(12, 0.6, 8, std(0xe01e37, 0.8), gx, 5.2, gz));
    for (const [px, pz] of [[-5, -3], [5, -3], [-5, 3], [5, 3]]) {
      add(box(0.5, 5.2, 0.5, std(0xf5f5f5, 0.8), gx + px, 2.6, gz + pz));
    }
    // Pumps.
    for (const px of [-2.5, 0, 2.5]) {
      add(box(0.9, 1.5, 0.7, std(0xf2f2f2, 0.7), gx + px, 0.75, gz));
      add(box(0.95, 0.3, 0.75, std(0xd92038, 0.7), gx + px, 1.6, gz));
      addCollider(gx + px, gz, 1, 0.8);
    }
    signPlane('PETRO VEGA', '#d92038', '#ffffff', 10, 2.2, gx, 6.4, gz + 4.1, 0, 'FUEL • 24H');
    // Small kiosk — MUST stay inside the lot: the block is only ~9.4 m wide
    // after the road widening, so gx+8 (the old offset) put the kiosk's
    // collider ON the road, where traffic wedged against it forever.
    add(box(4, 3, 3, std(0xf5efe4, 0.9), gx + 2, 1.5, gz + 2));
    addCollider(gx + 2, gz + 2, 4, 3);
  }

  // ---- Palm Court Park ----------------------------------------------------
  const parkX0 = ROADS[2] + WORLD.roadWidth / 2 + WORLD.sidewalk;
  const parkZ0 = ROADS[1] + WORLD.roadWidth / 2 + WORLD.sidewalk;
  const parkX1 = ROADS[3] - WORLD.roadWidth / 2 - WORLD.sidewalk;
  const parkZ1 = ROADS[2] - WORLD.roadWidth / 2 - WORLD.sidewalk;
  const park = new THREE.Mesh(new THREE.PlaneGeometry(parkX1 - parkX0, parkZ1 - parkZ0), std(PALETTE.park, 1));
  park.rotation.x = -Math.PI / 2;
  park.position.set((parkX0 + parkX1) / 2, 0.015, (parkZ0 + parkZ1) / 2);
  park.receiveShadow = true;
  add(park);
  const pond = new THREE.Mesh(new THREE.CircleGeometry(4.5, 24), new THREE.MeshLambertMaterial({ color: PALETTE.pond }));
  pond.rotation.x = -Math.PI / 2;
  pond.position.set((parkX0 + parkX1) / 2 + 3, 0.04, (parkZ0 + parkZ1) / 2 - 2);
  add(pond);
  // Park furniture (M3c): benches + lamps + a gravel path + a small fountain.
  {
    const pcx = (parkX0 + parkX1) / 2, pcz = (parkZ0 + parkZ1) / 2;
    const path = new THREE.Mesh(new THREE.PlaneGeometry(parkX1 - parkX0 - 4, 2.2), std(0xd8c8a8, 1));
    path.rotation.x = -Math.PI / 2; path.position.set(pcx, 0.03, pcz + 6); path.receiveShadow = true; add(path);
    for (const [bx, bz, ry] of [[pcx - 8, pcz + 4.5, 0], [pcx + 6, pcz + 4.5, 0], [pcx - 2, pcz - 8, Math.PI / 2], [pcx + 10, pcz - 6, -Math.PI / 2]]) {
      const bench = box(2.2, 0.12, 0.6, std(0x8a6a42, 0.95), bx, 0.45, bz); bench.rotation.y = ry; add(bench);
      const back = box(2.2, 0.6, 0.1, std(0x8a6a42, 0.95), bx, 0.8, bz + (ry ? 0 : 0.3)); back.rotation.y = ry; add(back);
      for (const lo of [-0.9, 0.9]) add(box(0.12, 0.45, 0.5, std(0x3d4149, 0.9), bx + lo * Math.cos(ry), 0.22, bz + lo * Math.sin(ry)));
    }
    for (const [lx, lz] of [[parkX0 + 3, parkZ0 + 3], [parkX1 - 3, parkZ0 + 3], [parkX0 + 3, parkZ1 - 3], [parkX1 - 3, parkZ1 - 3]]) {
      add(cyl(0.07, 0.09, 3.2, std(0x2c3240, 0.8), lx, 1.6, lz, 6));
      const lamp = new THREE.Mesh(new THREE.SphereGeometry(0.28, 10, 8), emissiveMat(0xfff2b0, 1.0));
      lamp.position.set(lx, 3.35, lz); add(lamp);
    }
    add(cyl(1.4, 1.6, 0.45, std(0xd8d8d8, 0.9), pcx - 6, 0.22, pcz - 4, 16));
    add(cyl(1.2, 1.2, 0.1, new THREE.MeshLambertMaterial({ color: 0x2fb7d9 }), pcx - 6, 0.45, pcz - 4, 16));
    add(cyl(0.2, 0.25, 0.8, std(0xd8d8d8, 0.9), pcx - 6, 0.85, pcz - 4, 8));
  }

  // ---- Trees & palms ------------------------------------------------------
  const trunkMat = std(0x7a5a3a, 1);
  const trunkMat2 = std(0x8a6a42, 1);
  const leafMat = std(0x4e9e3f, 1);
  const leafMat2 = std(0x5aa84a, 1);
  const palmMat = std(0x3f9e4d, 1);
  const palmMat2 = std(0x55b45a, 1);
  const treeSpots = []; // {x, z, r} canopy spots — the follow camera avoids them
  // Claude-style palm: leaning two-segment trunk, flat drooping leaf boxes
  // (geometry pre-tilted, one shared geo), coconuts. Regular trees get a
  // 3-sphere canopy in two greens.
  const palmLeafGeo = new THREE.BoxGeometry(2.1, 0.08, 0.5);
  palmLeafGeo.rotateZ(-0.4); // droop baked in
  palmLeafGeo.translate(1.0, 0, 0); // extends +X from the trunk top
  function tree(x, z, s, palm) {
    treeSpots.push({ x, z, r: palm ? 1.6 * s : 2.0 * s });
    // GLB palm (Quaternius, CC0): real drooping fronds, not flat boards.
    // ~2.7 m tall in the file, x1.67 -> ~4.5 m. Falls back to procedural.
    if (palm && Q.trees && Q.trees.palm) {
      const g = Q.trees.palm.scene.clone(true);
      g.traverse((o) => { if (o.isMesh) { o.castShadow = true; o.receiveShadow = true; } });
      g.scale.setScalar(1.67 * s);
      g.position.set(x, 0, z);
      g.rotation.y = rng.range(0, Math.PI * 2);
      g.updateMatrixWorld(true);
      const bb = new THREE.Box3().setFromObject(g);
      if (Math.abs(bb.min.y) > 0.01) g.position.y -= bb.min.y;
      add(g);
      return;
    }
    if (palm) {
      const lean = rng.range(-0.16, 0.16);
      const t1 = cyl(0.15 * s, 0.21 * s, 2.4 * s, trunkMat, x, 1.2 * s, z, 8);
      t1.rotation.z = lean * 0.5;
      add(t1);
      const t2 = cyl(0.12 * s, 0.15 * s, 2.2 * s, trunkMat2, x + lean * 1.2 * s, 3.2 * s, z, 8);
      t2.rotation.z = lean;
      add(t2);
      const topX = x + lean * 2.2 * s, topY = 4.3 * s;
      for (let i = 0; i < 6; i += 1) {
        const leaf = new THREE.Mesh(palmLeafGeo, i % 2 ? palmMat2 : palmMat);
        leaf.scale.setScalar(s);
        leaf.position.set(topX, topY, z);
        leaf.rotation.y = (i / 6) * Math.PI * 2 + rng.range(-0.15, 0.15);
        leaf.castShadow = true;
        add(leaf);
      }
      for (const [ox, oz] of [[-0.3, 0.1], [0.3, -0.1]]) {
        const nut = new THREE.Mesh(new THREE.SphereGeometry(0.18 * s, 8, 6), std(0x6e4a2e, 1));
        nut.position.set(topX + ox * s, topY - 0.25 * s, z + oz * s);
        nut.castShadow = true;
        add(nut);
      }
    } else {
      // Broadleaf tree: thicker tapered trunk + a dense, irregular 5-blob
      // canopy (was 3 perfect spheres on a thin 0.16 trunk = a lollipop).
      add(cyl(0.22 * s, 0.32 * s, 1.8 * s, trunkMat, x, 0.9 * s, z, 8));
      const blobs = [
        [0, 2.6, 0, 1.5, leafMat], [0.9, 2.1, 0.3, 1.0, leafMat2],
        [-0.7, 2.3, -0.3, 0.9, leafMat], [0.2, 3.4, -0.2, 0.9, leafMat2],
        [-0.3, 3.0, 0.6, 0.7, leafMat],
      ];
      for (const [ox, oy, oz, r, m] of blobs) {
        const c = new THREE.Mesh(new THREE.SphereGeometry(r * s, 10, 8), m);
        c.position.set(x + ox * s, oy * s, z + oz * s); c.castShadow = true; add(c);
      }
    }
  }
  // Trees must NEVER stand in the middle of a road. A roadside tree's
  // along-coordinate can coincide with a perpendicular road (intersection),
  // and forest trees can land on the city roads that run through the biome
  // — both are filtered here.
  const nearCrossRoad = (v) => ROADS.some((r) => Math.abs(v - r) < WORLD.roadWidth / 2 + 1.0);
  const onRoad = (x, z) => ROADS.some((r) => Math.abs(x - r) < WORLD.roadWidth / 2 + 0.5)
    || ROADS.some((r) => Math.abs(z - r) < WORLD.roadWidth / 2 + 0.5);
  for (const road of ROADS) {
    for (let t = 32; t < WORLD.size - 4; t += 11) {
      if (rng.chance(0.4)) {
        const tt = t + rng.range(-2, 2);
        if (!nearCrossRoad(tt)) tree(road + WORLD.roadWidth / 2 + WORLD.sidewalk + 1.2, tt, rng.range(0.85, 1.2), false);
      }
      if (rng.chance(0.4)) {
        const tt = t + rng.range(-2, 2);
        if (!nearCrossRoad(tt)) tree(tt, road + WORLD.roadWidth / 2 + WORLD.sidewalk + 1.2, rng.range(0.85, 1.2), false);
      }
    }
  }
  for (let i = 0; i < 26; i += 1) {
    const px = rng.range(parkX0 + 2, parkX1 - 2), pz = rng.range(parkZ0 + 2, parkZ1 - 2);
    if (Math.hypot(px - 110, pz - 83) < 4.5) continue; // keep the Palm Court Jump ramp clear
    tree(px, pz, rng.range(0.9, 1.35), rng.chance(0.4));
  }
  // Beach palms: dense along the shoreline (Lucas P0: 16 -> 30+). The strip
  // x 17.5..28.5 is sand; horizontal roads cross it at z = ROADS, filtered
  // by onRoad so no palm ever stands in a road. 48 attempts -> ~35 kept
  // after the road filter (probe-verified: 32 attempts gave only 22).
  for (let i = 0; i < 48; i += 1) {
    const px = rng.range(17.5, 28.5), pz = rng.range(12, 395);
    if (onRoad(px, pz)) continue; // beach palms must not stand on a road crossing the sand
    tree(px, pz, rng.range(0.9, 1.3), true);
  }

  // ---- Street lamps --------------------------------------------------------
  const lampPole = std(0x2c3240, 0.6, 0.4);
  for (const rx of ROADS) {
    for (const ry of ROADS) {
      if (rx === 247 && (ry === 195 || ry === 221)) continue; // tunnel ends: no lamps inside the tube
      for (const [dx, dz] of [[-1, -1], [1, 1]]) {
        const lx = rx + dx * (WORLD.roadWidth / 2 + 1), lz = ry + dz * (WORLD.roadWidth / 2 + 1);
        add(cyl(0.09, 0.12, 5.2, lampPole, lx, 2.6, lz, 8));
        const head = new THREE.Mesh(new THREE.SphereGeometry(0.28, 10, 8), emissiveMat(0xfff2b0, 0.6));
        head.position.set(lx, 5.3, lz);
        add(head);
      }
    }
  }

  // ---- Power poles, Corrupt Estate style (Lucas P0) ----------------------
  // 10 m wooden mast, 2 crossarms, 5 insulators, transformer on 1 in 3
  // poles, 3 black wires pole-to-pole. All InstancedMesh (1 draw call per
  // part) — ~200 individual pole meshes would cost ~200 draw calls on a
  // phone. Poles stand on the OUTER edge of the sidewalk
  // (roadWidth/2 + sidewalk - 0.4 = 7.1 m from the road centre), never in
  // the middle where NPCs walk, spaced ~24 m, never near an intersection.
  const poleOff = WORLD.roadWidth / 2 + WORLD.sidewalk - 0.4; // 7.1
  const nearCross = (v) => ROADS.some((r) => Math.abs(v - r) < 8);
  const poles = []; // {x, z, along: 'z'|'x', side}
  for (const road of ROADS) {
    for (const side of [-1, 1]) {
      for (let t = 12; t < WORLD.size - 8; t += 24) {
        if (nearCross(t)) continue;
        poles.push({ x: road + side * poleOff, z: t, along: 'z' });
        poles.push({ x: t, z: road + side * poleOff, along: 'x' });
      }
    }
  }
  const poleRy = (p) => (p.along === 'z' ? 0 : Math.PI / 2); // crossarm perpendicular to the road
  const wood = std(0x6b4a2b, 1), woodDark = std(0x4a3a2a, 1), grey = std(0x8a8f98, 1);
  instanced(new THREE.CylinderGeometry(0.17, 0.19, 10, 8), wood,
    poles.map((p) => ({ x: p.x, y: 5, z: p.z })), true); // mast
  instanced(new THREE.CylinderGeometry(0.26, 0.3, 0.36, 8), grey,
    poles.map((p) => ({ x: p.x, y: 0.18, z: p.z }))); // base foot
  instanced(new THREE.BoxGeometry(2.6, 0.14, 0.14), woodDark,
    poles.map((p) => ({ x: p.x, y: 9.3, z: p.z, ry: poleRy(p) })), true); // top crossarm
  instanced(new THREE.BoxGeometry(1.8, 0.12, 0.12), woodDark,
    poles.map((p) => ({ x: p.x, y: 8.5, z: p.z, ry: poleRy(p) }))); // lower crossarm
  // Insulators: 3 on the top crossarm (x -1.1/0/+1.1, y 9.5), 2 on the
  // lower one (x +/-0.7, y 8.65) — offsets run along the crossarm.
  const insTop = [], insLow = [];
  for (const p of poles) {
    const dx = p.along === 'z' ? 1 : 0, dz = p.along === 'z' ? 0 : 1;
    for (const o of [-1.1, 0, 1.1]) insTop.push({ x: p.x + dx * o, y: 9.5, z: p.z + dz * o });
    for (const o of [-0.7, 0.7]) insLow.push({ x: p.x + dx * o, y: 8.65, z: p.z + dz * o });
  }
  const pale = std(0xdadce2, 0.9);
  instanced(new THREE.CylinderGeometry(0.07, 0.07, 0.22, 6), pale, insTop);
  instanced(new THREE.CylinderGeometry(0.06, 0.06, 0.18, 6), pale, insLow);
  // Transformer on every 3rd pole: grey can + dark cap, hugging the mast
  // (offset 0.28 m — the old 0.42 m left the can visibly floating beside
  // the pole at the pier) + a mounting bracket so it reads as attached.
  const trafos = poles.filter((_, i) => i % 3 === 0);
  instanced(new THREE.CylinderGeometry(0.34, 0.34, 0.95, 10), std(0x7d8288, 0.9),
    trafos.map((p) => ({ x: p.x + (p.along === 'z' ? 0 : 0.28), y: 7.3, z: p.z + (p.along === 'z' ? 0.28 : 0) })));
  instanced(new THREE.CylinderGeometry(0.1, 0.1, 0.2, 6), std(0x2a2d31, 0.9),
    trafos.map((p) => ({ x: p.x + (p.along === 'z' ? 0 : 0.28), y: 7.85, z: p.z + (p.along === 'z' ? 0.28 : 0) })));
  instanced(new THREE.BoxGeometry(0.5, 0.12, 0.12), woodDark,
    trafos.map((p) => ({ x: p.x + (p.along === 'z' ? 0 : 0.14), y: 7.3, z: p.z + (p.along === 'z' ? 0.14 : 0), ry: p.along === 'z' ? Math.PI / 2 : 0 })));
  // Wires: 3 black lines per span, at the top-insulator offsets, y 9.4.
  // Only between poles <= 30 m apart, so no wire hangs across an
  // intersection. One LineSegments = 1 draw call.
  {
    const pts = [];
    const byLine = new Map(); // road side -> sorted pole list
    for (const p of poles) {
      const key = p.along === 'z' ? `v${Math.round(p.x)}` : `h${Math.round(p.z)}`;
      if (!byLine.has(key)) byLine.set(key, []);
      byLine.get(key).push(p);
    }
    for (const list of byLine.values()) {
      list.sort((a, b) => (a.along === 'z' ? a.z - b.z : a.x - b.x));
      for (let i = 0; i + 1 < list.length; i += 1) {
        const A = list[i], B = list[i + 1];
        const gap = A.along === 'z' ? B.z - A.z : B.x - A.x;
        if (gap > 30) continue;
        for (const o of [-1.1, 0, 1.1]) {
          const ox = A.along === 'z' ? o : 0, oz = A.along === 'z' ? 0 : o;
          pts.push(A.x + ox, 9.4, A.z + oz, B.x + ox, 9.4, B.z + oz);
        }
      }
    }
    const wireGeo = new THREE.BufferGeometry();
    wireGeo.setAttribute('position', new THREE.Float32BufferAttribute(pts, 3));
    add(new THREE.LineSegments(wireGeo, new THREE.LineBasicMaterial({ color: 0x15161a })));
  }

  // ---- Traffic lights: 4 per intersection (visual; the 6 s red-light
  // logic already exists) -------------------------------------------------
  // Corners at roadWidth/2 + 2.0 = 7.0 m — outside the street-lamp ring
  // (6.0 m) so poles never clash. One InstancedMesh per part.
  const lightOff = WORLD.roadWidth / 2 + 2.0;
  const lightPoles = [], lightHeads = [], lightGreen = [], lightRed = [];
  // Only at the 4 zebra-crossing intersections (ilham 19:30 WIB: no lights
  // along every road). The red-light STOP logic is global (6 s cycle in
  // stepTrafficCar) and does not read these meshes, so it keeps working.
  const LIGHT_SPOTS = [[91, 65], [117, 143], [143, 117], [39, 143]];
  for (const [rx, ry] of LIGHT_SPOTS) {
    {
      for (const [dx, dz] of [[-1, -1], [1, -1], [-1, 1], [1, 1]]) {
        const lx = rx + dx * lightOff, lz = ry + dz * lightOff;
        lightPoles.push({ x: lx, y: 2.5, z: lz });
        lightHeads.push({ x: lx, y: 5.7, z: lz });
        // Green/red faces look toward the intersection centre.
        const face = Math.atan2(rx - lx, ry - lz);
        const fx = Math.sin(face) * 0.29, fz = Math.cos(face) * 0.29;
        lightGreen.push({ x: lx + fx, y: 5.85, z: lz + fz, ry: face });
        lightRed.push({ x: lx + fx, y: 5.55, z: lz + fz, ry: face });
      }
    }
  }
  const darkPole = std(0x2a2d33, 0.6, 0.4);
  instanced(new THREE.CylinderGeometry(0.1, 0.13, 5, 8), darkPole, lightPoles);
  instanced(new THREE.BoxGeometry(0.55, 0.55, 0.55), darkPole, lightHeads);
  instanced(new THREE.BoxGeometry(0.3, 0.26, 0.06), emissiveMat(0x22dd55, 1.6), lightGreen);
  instanced(new THREE.BoxGeometry(0.3, 0.26, 0.06), emissiveMat(0xdd2222, 1.6), lightRed);

  // ---- Road markings: zebra crossings + manholes -------------------------
  // Zebra: one canvas texture on a 10 x 3.5 m plane, one InstancedMesh for
  // all 4 approaches of every intersection.
  const zebraTex = canvasTex(128, 64, (g, w, h) => {
    g.fillStyle = '#2c2c30'; g.fillRect(0, 0, w, h);
    g.fillStyle = '#f2f2f2';
    for (let i = 0; i < 5; i += 1) g.fillRect(8 + i * 24, 4, 12, h - 8);
  });
  const zebraMat = new THREE.MeshBasicMaterial({ map: zebraTex });
  const zebraGeo = new THREE.PlaneGeometry(10, 3.5);
  zebraGeo.rotateX(-Math.PI / 2);
  const zebras = [];
  const crossOff = WORLD.roadWidth / 2 + 2.5; // 7.5
  // Only 4 crossings in the whole city (ilham 19:18 WIB: no zebras along
  // every road) — park, mall, downtown, harbour approach.
  const ZEBRA_SPOTS = [
    { x: 91, z: 65 - crossOff, ry: 0 }, // Palm Court Park
    { x: 117, z: 143 + crossOff, ry: 0 }, // mall (south approach)
    { x: 143 - crossOff, z: 117, ry: Math.PI / 2 }, // downtown
    { x: 39, z: 143 - crossOff, ry: 0 }, // harbour approach
  ];
  for (const s of ZEBRA_SPOTS) zebras.push({ x: s.x, y: 0.045, z: s.z, ry: s.ry });
  instanced(zebraGeo, zebraMat, zebras);
  // Manholes: dark discs, one per road segment, off-centre in a lane.
  const manholes = [];
  for (const r of ROADS) {
    for (let i = 0; i < ROADS.length - 1; i += 1) {
      const mid = (ROADS[i] + ROADS[i + 1]) / 2;
      manholes.push({ x: r + rng.pick([-2.5, 2.5]), y: 0.045, z: mid + rng.range(-4, 4) });
      manholes.push({ x: mid + rng.range(-4, 4), y: 0.045, z: r + rng.pick([-2.5, 2.5]) });
    }
  }
  const manGeo = new THREE.CircleGeometry(0.5, 12);
  manGeo.rotateX(-Math.PI / 2);
  instanced(manGeo, new THREE.MeshBasicMaterial({ color: 0x2a2d31 }), manholes);

  // ---- Roadside props: hydrant, trash can, mailbox, bollard, planter ----
  // Outer sidewalk edge (7.1 m), clear of intersections and power poles —
  // NPCs walk the sidewalk centre (6.25 m) and never hit them.
  const nearPole = (x, z) => poles.some((p) => Math.abs(p.x - x) < 2 && Math.abs(p.z - z) < 2);
  const propSpots = { hydrant: [], trash: [], mailbox: [], bollard: [], planter: [] };
  for (const road of ROADS) {
    for (const side of [-1, 1]) {
      for (let t = 20; t < WORLD.size - 8; t += 34) {
        const tt = t + rng.range(-6, 6);
        if (nearCross(tt)) continue;
        const px = road + side * poleOff, pz = tt;
        const qx = tt, qz = road + side * poleOff;
        for (const [x, z] of [[px, pz], [qx, qz]]) {
          if (nearPole(x, z)) continue;
          if (x < 32) continue; // never a mailbox/hydrant on the beach sand (ilham: blue box + red object on the beach)
          const roll = rng.next();
          if (roll < 0.18) propSpots.hydrant.push({ x, y: 0.35, z });
          else if (roll < 0.48) propSpots.trash.push({ x, y: 0.4, z });
          else if (roll < 0.62) propSpots.mailbox.push({ x, y: 0.55, z });
          else if (roll < 0.82) propSpots.bollard.push({ x, y: 0.45, z });
          else propSpots.planter.push({ x, y: 0.25, z });
        }
      }
    }
  }
  instanced(new THREE.CylinderGeometry(0.22, 0.26, 0.7, 10), std(0xd92038, 0.9), propSpots.hydrant);
  instanced(new THREE.CylinderGeometry(0.1, 0.1, 0.12, 8), std(0x8a8f98, 0.9),
    propSpots.hydrant.map((p) => ({ x: p.x, y: 0.76, z: p.z }))); // hydrant cap
  instanced(new THREE.CylinderGeometry(0.32, 0.28, 0.8, 10), std(0x2e5a3a, 0.9), propSpots.trash);
  instanced(new THREE.BoxGeometry(0.55, 1.1, 0.45), std(0x2a5a9a, 0.9), propSpots.mailbox);
  instanced(new THREE.CylinderGeometry(0.12, 0.14, 0.9, 8), std(0xf7c948, 0.9), propSpots.bollard);
  instanced(new THREE.BoxGeometry(1.2, 0.5, 0.6), std(0x8a6a42, 0.95), propSpots.planter);
  instanced(new THREE.SphereGeometry(0.5, 8, 6), std(0x3f8f3a, 1),
    propSpots.planter.map((p) => ({ x: p.x, y: 0.65, z: p.z, s: 1.1 }))); // planter shrub
  // Bus stops: bench + roof + poles + sign, 4 of them (mall, hospital,
  // city hall, club). On the OUTER sidewalk edge at MID-BLOCK — the old
  // spots at (135.9,91), (239.9,65) and (176.1,195) sat exactly on top of
  // zebra crossings (ilham 19:28 WIB). Bench runs parallel to the road,
  // back on the side AWAY from the road, so sitters face the road
  // (the old bench faced north with its back south, no matter the road).
  // side: +1 = stop east of its road, -1 = west of its road.
  for (const [bx, bz, side] of [[91 + 7.1, 130, 1], [247 - 7.1, 78, -1], [169 + 7.1, 208, 1], [143 - 7.1, 104, -1]]) {
    add(box(0.6, 0.12, 2.2, std(0x8a6a42, 0.9), bx, 0.55, bz)); // bench seat (long axis along the road)
    add(box(0.12, 0.7, 2.2, std(0x8a6a42, 0.9), bx + side * 0.3, 0.95, bz)); // bench back, away from the road
    add(box(1.4, 0.14, 2.6, std(0x2a5a9a, 0.85), bx, 2.5, bz)); // roof
    add(cyl(0.06, 0.06, 2.5, darkPole, bx + side * 0.6, 1.25, bz - 1.2, 6));
    add(cyl(0.06, 0.06, 2.5, darkPole, bx + side * 0.6, 1.25, bz + 1.2, 6));
    signPlane('BUS STOP', '#2a5a9a', '#ffffff', 1.8, 0.9, bx - side * 0.62, 2.1, bz, side > 0 ? -Math.PI / 2 : Math.PI / 2); // faces the road
  }

  // ---- Pier 9 (into the sea) ----------------------------------------------
  const pierGroup = new THREE.Group();
  const pierMat = std(PALETTE.pier, 0.95);
  for (let z = 118; z <= 146; z += 2.2) {
    pierGroup.add(box(10, 0.3, 2, pierMat, 10, 0.6, z));
  }
  for (const [px, pz] of [[5.5, 120], [14.5, 120], [5.5, 132], [14.5, 132], [5.5, 144], [14.5, 144]]) {
    pierGroup.add(cyl(0.3, 0.35, 2.2, std(0x8a5f3c, 1), px, -0.3, pz, 8));
  }
  // shack at the pier end
  pierGroup.add(box(4, 3, 3.4, std(0xa97c50, 0.95), 10, 2.1, 146));
  const shackRoof = new THREE.Mesh(new THREE.ConeGeometry(3.4, 1.4, 4), std(0x6e4a2e, 0.95));
  shackRoof.position.set(10, 4.3, 146); shackRoof.rotation.y = Math.PI / 4; shackRoof.castShadow = true;
  pierGroup.add(shackRoof);
  group.add(pierGroup);

  // ---- Crates (warehouse + docks) ------------------------------------------
  const crateMat = std(0xb08d4f, 0.95);
  const crates = [];
  // Warehouse crates: on the sidewalk strip WEST of the cannery (x 44.8..46.2),
  // clear of road 39's surface (ends x=44) and of the warehouse block. The
  // old range (x 43..61, z 218..226) put crates ON roads 65/221, where
  // traffic wedged against them forever.
  for (let i = 0; i < 7; i += 1) crates.push({ x: rng.range(44.8, 46.2), z: rng.range(204, 212), s: rng.range(1.2, 2.0) });
  // Dock crates: on the sand, clear of the horizontal roads 117/143 that
  // cross the beach (their surfaces are z 112..122 and 138..148).
  for (let i = 0; i < 5; i += 1) crates.push({ x: rng.range(19, 28), z: rng.range(124, 136), s: rng.range(1.6, 2.6) });
  for (const c of crates) {
    add(box(c.s, c.s, c.s, crateMat, c.x, c.s / 2, c.z));
    addCollider(c.x, c.z, c.s, c.s);
  }

  // ---- Biomes: forest / desert / rocky hills (chunk-loaded props) ---------
  // Chunk loading: props live in per-100m chunk groups; the game hides chunks
  // far from the player (see game.updateChunks) so phones stay at 30fps.
  const chunkMap = new Map();
  function chunkAt(x, z) {
    const key = `${Math.floor(x / 100)},${Math.floor(z / 100)}`;
    if (!chunkMap.has(key)) {
      const g = new THREE.Group();
      scene.add(g);
      chunkMap.set(key, { group: g, cx: Math.floor(x / 100) * 100 + 50, cz: Math.floor(z / 100) * 100 + 50 });
    }
    return chunkMap.get(key).group;
  }
  function dirtRoad(x1, z1, x2, z2, w, color) {
    const len = Math.hypot(x2 - x1, z2 - z1);
    const m = new THREE.Mesh(new THREE.BoxGeometry(len, 0.08, w), std(color, 1));
    m.position.set((x1 + x2) / 2, 0.04, (z1 + z2) / 2);
    m.rotation.y = -Math.atan2(z2 - z1, x2 - x1);
    m.receiveShadow = true;
    add(m);
  }
  const dirtMat = 0x8a6a42;
  // Forest dirt roads: one east-west track + a connector into the city.
  dirtRoad(20, 330, 255, 330, 6, dirtMat);
  dirtRoad(130, 247, 130, 330, 6, dirtMat);
  dirtRoad(60, 330, 60, 395, 5, dirtMat);
  // Desert highway: long, empty, straight — and a connector into the city.
  dirtRoad(247, 130, 395, 130, 7, 0x3d4149);
  dirtRoad(300, 130, 300, 250, 5, dirtMat);
  // Hills winding road: climbs through the rocks.
  dirtRoad(265, 275, 300, 300, 5, dirtMat);
  dirtRoad(300, 300, 335, 325, 5, dirtMat);
  dirtRoad(335, 325, 305, 355, 5, dirtMat);
  dirtRoad(305, 355, 350, 385, 5, dirtMat);

  const pineMat = std(0x2e5a26, 1);
  const darkLeaf = std(0x3a6e2e, 1);
  const cactusMat = std(0x3f8a4a, 1);
  const rockMat = std(0x7a7a72, 1);
  const rockMat2 = std(0x9a8a72, 1);
  function biomeTree(x, z, s, pine) {
    const g = chunkAt(x, z);
    if (pine) {
      const trunk = cyl(0.14 * s, 0.2 * s, 1.6 * s, trunkMat, x, 0.8 * s, z, 6);
      g.add(trunk);
      const c1 = new THREE.Mesh(new THREE.ConeGeometry(1.5 * s, 3.2 * s, 7), pineMat);
      c1.position.set(x, 3 * s, z); c1.castShadow = true; g.add(c1);
      const c2 = new THREE.Mesh(new THREE.ConeGeometry(1.0 * s, 2.2 * s, 7), pineMat);
      c2.position.set(x, 4.6 * s, z); c2.castShadow = true; g.add(c2);
    } else {
      const trunk = cyl(0.16 * s, 0.22 * s, 2 * s, trunkMat, x, 1 * s, z, 6);
      g.add(trunk);
      const c1 = new THREE.Mesh(new THREE.SphereGeometry(1.7 * s, 8, 6), darkLeaf);
      c1.position.set(x, 3 * s, z); c1.castShadow = true; g.add(c1);
    }
  }
  // FOREST: dense trees (avoid the dirt roads AND the city roads that run
  // through the biome — a tree in the middle of a road blocks traffic).
  for (let i = 0; i < 130; i += 1) {
    const x = rng.range(8, 255), z = rng.range(265, 395);
    if (Math.abs(z - 330) < 5 || Math.abs(x - 130) < 5 || Math.abs(x - 60) < 4) continue;
    if (onRoad(x, z)) continue;
    biomeTree(x, z, rng.range(0.9, 1.5), rng.chance(0.55));
  }
  // DESERT: cacti, rocks, two abandoned shacks.
  function cactus(x, z, s) {
    const g = chunkAt(x, z);
    const t = cyl(0.3 * s, 0.35 * s, 2.6 * s, cactusMat, x, 1.3 * s, z, 8);
    g.add(t);
    const arm = cyl(0.16 * s, 0.16 * s, 1.1 * s, cactusMat, x + 0.55 * s, 1.5 * s, z, 6);
    arm.rotation.z = Math.PI / 2;
    g.add(arm);
    const up = cyl(0.16 * s, 0.16 * s, 0.8 * s, cactusMat, x + 1.05 * s, 1.9 * s, z, 6);
    g.add(up);
  }
  for (let i = 0; i < 35; i += 1) {
    const x = rng.range(268, 392), z = rng.range(10, 250);
    if (Math.abs(z - 130) < 6) continue;
    if (x > 270 && ((z > 110 && z < 150) || (x < 342 && z >= 150 && z < 192))) continue; // airport zone
    if (onRoad(x, z)) continue; // city roads run through the desert too
    cactus(x, z, rng.range(0.8, 1.4));
  }
  function boulder(x, z, r, mat, chunked = true) {
    const g = chunked ? chunkAt(x, z) : group;
    const b = new THREE.Mesh(new THREE.DodecahedronGeometry(r, 0), mat);
    b.position.set(x, r * 0.55, z);
    b.rotation.set(rng.range(0, 3), rng.range(0, 3), rng.range(0, 3));
    b.castShadow = true; b.receiveShadow = true;
    g.add(b);
    if (r > 1.6) addCollider(x, z, r * 1.6, r * 1.6);
    return b;
  }
  for (let i = 0; i < 30; i += 1) {
    const x = rng.range(268, 392), z = rng.range(10, 250);
    if (Math.abs(z - 130) < 6) continue;
    if (x > 270 && ((z > 110 && z < 150) || (x < 342 && z >= 150 && z < 192))) continue; // airport zone
    if (onRoad(x, z)) continue; // city roads run through the desert too
    boulder(x, z, rng.range(0.7, 2.2), rng.chance(0.5) ? rockMat : rockMat2);
  }
  // Desert dunes + dry bushes + sand-tone patches (the flat tan ground
  // read as empty in ilham's BUSTED screenshot).
  for (let i = 0; i < 14; i += 1) {
    const x = rng.range(268, 392), z = rng.range(10, 250);
    if (Math.abs(z - 130) < 8) continue;
    if (x > 270 && ((z > 110 && z < 150) || (x < 342 && z >= 150 && z < 192))) continue; // airport zone
    if (onRoad(x, z)) continue;
    const dune = new THREE.Mesh(new THREE.ConeGeometry(rng.range(4, 8), rng.range(1.4, 2.4), 9), std(rng.pick([0xe8c87a, 0xdfc078, 0xf0d090]), 1));
    dune.position.set(x, 0.5, z); dune.scale.y = 0.55; dune.rotation.y = rng.range(0, 3);
    dune.castShadow = true; dune.receiveShadow = true; chunkAt(x, z).add(dune);
  }
  for (let i = 0; i < 24; i += 1) {
    const x = rng.range(268, 392), z = rng.range(10, 250);
    if (Math.abs(z - 130) < 6) continue;
    if (x > 270 && ((z > 110 && z < 150) || (x < 342 && z >= 150 && z < 192))) continue;
    if (onRoad(x, z)) continue;
    const bush = new THREE.Mesh(new THREE.SphereGeometry(rng.range(0.5, 0.9), 8, 6), std(rng.pick([0x6a7a3a, 0x7a8a42, 0x5a6e30]), 1));
    bush.position.set(x, 0.35, z); bush.scale.y = 0.6; bush.castShadow = true; chunkAt(x, z).add(bush);
  }
  for (let i = 0; i < 8; i += 1) {
    const x = rng.range(270, 390), z = rng.range(12, 248);
    if (Math.abs(z - 130) < 8) continue;
    if (onRoad(x, z)) continue;
    const patch = new THREE.Mesh(new THREE.PlaneGeometry(rng.range(18, 34), rng.range(14, 26)), std(rng.pick([0xdfc078, 0xd8b868, 0xecd090]), 1));
    patch.rotation.x = -Math.PI / 2; patch.position.set(x, 0.015, z); patch.receiveShadow = true; chunkAt(x, z).add(patch);
  }
  for (const [sx, sz] of [[320, 90], [360, 180]]) {
    const sg = chunkAt(sx, sz);
    sg.add(box(5, 3, 4, std(0x9a7a52, 1), sx, 1.5, sz));
    const roof = new THREE.Mesh(new THREE.ConeGeometry(4, 1.6, 4), std(0x6e4a2e, 1));
    roof.position.set(sx, 3.8, sz); roof.rotation.y = Math.PI / 4; roof.castShadow = true;
    sg.add(roof);
    addCollider(sx, sz, 5, 4);
  }
  // ROCKY HILLS: boulders, cliffs, dead trees.
  for (let i = 0; i < 28; i += 1) {
    const x = rng.range(268, 392), z = rng.range(268, 392);
    boulder(x, z, rng.range(1.2, 3.4), rng.chance(0.5) ? rockMat : rockMat2);
  }
  for (const [cx2, cz2, w2, h2, d2] of [[388, 300, 10, 12, 18], [390, 360, 12, 16, 14], [300, 392, 18, 10, 10], [360, 392, 14, 13, 10]]) {
    const cliff = box(w2, h2, d2, std(0x6e6258, 1), cx2, h2 / 2, cz2);
    chunkAt(cx2, cz2).add(cliff);
    addCollider(cx2, cz2, w2, d2);
  }
  for (let i = 0; i < 8; i += 1) {
    const x = rng.range(270, 390), z = rng.range(270, 390);
    const g = chunkAt(x, z);
    const t = cyl(0.1, 0.16, 2.6, std(0x4a3524, 1), x, 1.3, z, 6);
    t.rotation.z = rng.range(-0.25, 0.25);
    g.add(t);
  }

  // ---- Forest cabin (on the dirt road, 130,330) + campfire ---------------
  {
    const cg = chunkAt(130, 330);
    cg.add(box(6, 3, 5, std(0x8a6a42, 1), 130, 1.5, 330));
    const cabinRoof = new THREE.Mesh(new THREE.ConeGeometry(4.6, 1.8, 4), std(0x5d4630, 1));
    cabinRoof.position.set(130, 3.9, 330); cabinRoof.rotation.y = Math.PI / 4; cabinRoof.castShadow = true; cg.add(cabinRoof);
    add(cyl(0.3, 0.3, 1.4, std(0x7a3b2e, 1), 132, 4.4, 329, 8));
    // Campfire: stone ring + emissive fire.
    for (let fi = 0; fi < 6; fi += 1) {
      const st = new THREE.Mesh(new THREE.DodecahedronGeometry(0.3, 0), rockMat);
      const fa = (fi / 6) * Math.PI * 2;
      st.position.set(136 + Math.cos(fa) * 0.8, 0.15, 334 + Math.sin(fa) * 0.8); cg.add(st);
    }
    const fire = new THREE.Mesh(new THREE.ConeGeometry(0.5, 1.1, 6), emissiveMat(0xff7a2e, 2));
    fire.position.set(136, 0.55, 334); cg.add(fire);
    add(box(1.6, 0.3, 0.5, std(0x6e4a2e, 1), 138, 0.15, 332)); // log seat
    addCollider(130, 330, 6, 5);
  }
  // ---- Fishing village (south beach, x 20..60, z 300..360) -----------------
  for (const [hx, hz, hc] of [[30, 320, 0x9a7a52], [44, 335, 0x8a6a42], [36, 352, 0xa87a4a]]) {
    const hg = chunkAt(hx, hz);
    hg.add(box(5, 2.6, 4, std(hc, 1), hx, 1.3, hz));
    const hRoof = new THREE.Mesh(new THREE.ConeGeometry(3.8, 1.6, 4), std(0x6e4a2e, 1));
    hRoof.position.set(hx, 3.4, hz); hRoof.rotation.y = Math.PI / 4; hRoof.castShadow = true; hg.add(hRoof);
    addCollider(hx, hz, 5, 4);
  }
  for (const [bx, bz, br] of [[14, 325, 0.3], [12, 348, -0.2]]) {
    const bg = chunkAt(bx, bz);
    const hull = new THREE.Mesh(new THREE.BoxGeometry(5, 1, 2), std(0x7a4a2a, 1));
    hull.position.set(bx, 0.5, bz); hull.rotation.y = br; hull.castShadow = true; bg.add(hull);
    add(cyl(0.06, 0.06, 3, std(0x6e4a2e, 1), bx, 2, bz, 6));
  }
  // ---- Hills viewpoint (330,330): flat rock + sign + bench -----------------
  {
    const vg = chunkAt(330, 330);
    const vRock = new THREE.Mesh(new THREE.DodecahedronGeometry(4, 0), rockMat2);
    vRock.position.set(330, 1.2, 330); vRock.scale.set(1.6, 0.4, 1.4); vRock.castShadow = true; vg.add(vRock);
    const vSign = new THREE.Mesh(new THREE.PlaneGeometry(3, 1.2), new THREE.MeshLambertMaterial({ map: signTex('VIEWPOINT', '#20242c', '#ffd166') }));
    vSign.position.set(330, 2.2, 326); vSign.rotation.y = Math.PI; vg.add(vSign);
    add(box(0.15, 2.2, 0.15, std(0x3d4149, 0.9), 330, 1.1, 326));
    add(box(2.2, 0.12, 0.6, std(0x8a6a42, 0.95), 332, 0.45, 332));
  }

  // ---- La Vega Airport (desert east, on the z=130 highway) --------------
  // Runway sits on the desert highway corridor; terminal + tower + apron
  // face it from the south. All procedural, La Vega's own.
  const runwayMat = std(0x4a505c); // match the lightened road
  const concreteMat = std(0x9a9a92);
  const whiteMat = std(0xf2f5f7);
  function groundPlane(x, z, w, d, mat, y = 0.05) {
    const m = new THREE.Mesh(new THREE.PlaneGeometry(w, d), mat);
    m.rotation.x = -Math.PI / 2;
    m.position.set(x, y, z);
    m.receiveShadow = true;
    group.add(m);
    return m;
  }
  groundPlane(337, 130, 120, 24, runwayMat, 0.05); // runway 27/09
  for (let i = 0; i < 6; i += 1) groundPlane(292 + i * 18, 130, 8, 0.8, whiteMat, 0.06); // centre dashes
  groundPlane(337, 118.5, 120, 0.5, whiteMat, 0.06); // edge lines
  groundPlane(337, 141.5, 120, 0.5, whiteMat, 0.06);
  groundPlane(282, 130, 2, 20, whiteMat, 0.06); // threshold bar west
  groundPlane(392, 130, 2, 20, whiteMat, 0.06); // threshold bar east
  groundPlane(300, 147, 10, 28, concreteMat, 0.04); // taxiway to the apron
  groundPlane(300, 168, 70, 30, concreteMat, 0.03); // apron (widened: planes park clear of the road)
  // Terminal: glass front, gold roof band, airport sign.
  group.add(box(40, 8, 12, std(0xd8d2c4, 1), 300, 4, 180));
  group.add(box(40, 1, 12.4, std(0xffd166, 1), 300, 8.4, 180)); // gold roof band
  const termGlass = new THREE.Mesh(new THREE.PlaneGeometry(36, 5),
    new THREE.MeshLambertMaterial({ color: 0x9fd8ff }));
  termGlass.position.set(300, 4, 173.9); termGlass.rotation.y = Math.PI; group.add(termGlass);
  const termSign = new THREE.Mesh(new THREE.PlaneGeometry(12, 4.5),
    new THREE.MeshBasicMaterial({ map: signTex('LA VEGA AIR', '#0e1a2a', '#ffd166', 'INTERNATIONAL') }));
  termSign.position.set(300, 5.5, 173.8); termSign.rotation.y = Math.PI; group.add(termSign);
  addCollider(300, 180, 40, 12);
  // Control tower.
  group.add(cyl(1.5, 2, 22, std(0xd8d2c4, 1), 335, 11, 178, 12));
  group.add(cyl(4, 3.2, 3.5, new THREE.MeshLambertMaterial({ color: 0x9fd8ff }), 335, 23.5, 178, 12));
  group.add(cyl(0.1, 0.1, 3, std(0x20242c, 1), 335, 26.5, 178, 6));
  const towerBeacon = new THREE.Mesh(new THREE.SphereGeometry(0.4, 8, 8), emissiveMat(0xff2233, 1.6));
  towerBeacon.position.set(335, 28.2, 178); group.add(towerBeacon);
  addCollider(335, 178, 4, 4);
  // Two parked planes on the apron.
  function parkedPlane(x, z, ry, bodyColor) {
    const g = new THREE.Group();
    const body = new THREE.Mesh(new THREE.CylinderGeometry(1.6, 1.6, 18, 12), std(bodyColor));
    body.rotation.z = Math.PI / 2; body.position.y = 2.2; body.castShadow = true; g.add(body);
    const nose = new THREE.Mesh(new THREE.ConeGeometry(1.6, 3, 12), std(bodyColor));
    nose.rotation.z = -Math.PI / 2; nose.position.set(10.5, 2.2, 0); nose.castShadow = true; g.add(nose);
    const wing = new THREE.Mesh(new THREE.BoxGeometry(4, 0.25, 17), std(bodyColor));
    wing.position.y = 2.0; wing.castShadow = true; g.add(wing);
    const fin = new THREE.Mesh(new THREE.BoxGeometry(2.5, 3.5, 0.3), std(0xff2e88));
    fin.position.set(-8.2, 4.2, 0); fin.castShadow = true; g.add(fin);
    const stripe = new THREE.Mesh(new THREE.BoxGeometry(18.2, 0.4, 3.24), std(0xffd166));
    stripe.position.y = 2.2; g.add(stripe);
    g.position.set(x, 0, z); g.rotation.y = ry;
    group.add(g);
    addCollider(x, z, 19, 6);
    return g;
  }
  // Planes park PARALLEL to the runway on the apron edges, clear of the
  // x=300 connector road (the old spots put the nose/fuselage ON the road —
  // ilham's "pesawat di tengah jalan"). ry=0 keeps the 19 m fuselage along
  // the apron, wings clear of the taxiway.
  parkedPlane(278, 160, 0, 0xf2f5f7);
  parkedPlane(322, 175, 0, 0xe8eef7);
  // Windsock.
  group.add(cyl(0.08, 0.1, 6, std(0x8a8a8a, 1), 270, 3, 118, 6));
  const sock = new THREE.Mesh(new THREE.ConeGeometry(0.5, 2.2, 8), std(0xff7a2e));
  sock.rotation.z = -Math.PI / 2; sock.position.set(271.2, 5.8, 118); group.add(sock);

  // ---- La Vega Harbor (the dock, x 0..60, z 100..170) ---------------------
  // Concrete quay + stacked containers + gantry crane + warehouse + a cargo
  // ship anchored in the sea. This is the Harbor Heist location (M3c).
  groundPlane(20, 130, 50, 50, concreteMat, 0.04); // quay
  {
    const contCols = [0xd94f3d, 0x2a6fd6, 0x4e7a51, 0xf7c948, 0x7a5a8a, 0xe2725b];
    const contSpots = [[8, 112, 0], [14, 112, 0], [11, 112, 1], [8, 122, 0], [38, 145, 1], [44, 145, 0], [41, 145, 1], [30, 152, 0]];
    for (const [ccx, ccz, stack] of contSpots) {
      const col = contCols[(ccx + ccz) % contCols.length];
      group.add(box(6, 2.6, 2.6, std(col, 0.95), ccx, 1.3, ccz));
      if (stack) group.add(box(6, 2.6, 2.6, std(contCols[(ccx * 2 + ccz) % contCols.length], 0.95), ccx, 3.9, ccz));
      addCollider(ccx, ccz, 6, 2.6);
    }
    // Gantry crane: 2 legs + top beam + jib + hook cable.
    for (const sx of [-3, 3]) group.add(box(1.2, 14, 1.2, std(0xf7c948, 0.9), 10 + sx, 7, 130));
    group.add(box(9, 1.4, 1.4, std(0xf7c948, 0.9), 10, 14.5, 130));
    group.add(box(12, 1, 1, std(0x2a2d33, 0.9), 4, 14.5, 130));
    add(cyl(0.04, 0.04, 5, std(0x2a2d33, 0.9), 0, 11.5, 130, 4));
    group.add(box(1.6, 1.2, 1.6, std(0xd94f3d, 0.9), 0, 8.6, 130));
    addCollider(10, 130, 8, 3);
    // Harbor warehouse.
    group.add(box(18, 8, 12, std(0x8a7a52, 0.95), 45, 4, 130));
    group.add(box(18, 0.8, 12.4, std(0x5d4a3a, 0.9), 45, 8.4, 130));
    signPlane('HARBOR', '#5d3a1e', '#ffd166', 10, 2.2, 45, 6, 130 - 6.06, Math.PI, 'WAREHOUSE');
    addCollider(45, 130, 18, 12);
    // Cargo ship anchored in the sea (x -25, z 130): hull + containers + bridge.
    const ship = new THREE.Group();
    const hull = new THREE.Mesh(new THREE.BoxGeometry(26, 3, 8), std(0x2c3240, 0.95));
    hull.position.y = 0.8; hull.castShadow = true; ship.add(hull);
    const bow = new THREE.Mesh(new THREE.ConeGeometry(4, 6, 4), std(0x2c3240, 0.95));
    bow.rotation.z = -Math.PI / 2; bow.rotation.y = Math.PI / 4; bow.position.set(16, 0.8, 0); ship.add(bow);
    for (let ci = 0; ci < 4; ci += 1) {
      const cc = new THREE.Mesh(new THREE.BoxGeometry(5, 2.4, 7), std(contCols[ci % contCols.length], 0.95));
      cc.position.set(-6 + ci * 5.5, 3.4, 0); cc.castShadow = true; ship.add(cc);
    }
    const bridge = new THREE.Mesh(new THREE.BoxGeometry(4, 4, 7), std(0xe8e8e8, 0.9));
    bridge.position.set(-11, 4.2, 0); bridge.castShadow = true; ship.add(bridge);
    ship.position.set(-25, -0.2, 130); ship.rotation.y = 0.08;
    group.add(ship);
    addCollider(-25, 130, 26, 8);
  }

  // ---- Tunnel (road x=247, z 195..221) ------------------------------------
  // Concrete tube over the road, a grassy hill rising on the desert side —
  // the road stays clear through the tube, cars drive through. (No hill on
  // the city side: it would clip the buildings there.)
  const tubeMat = new THREE.MeshLambertMaterial({ color: 0x9a9a92, side: THREE.DoubleSide });
  const tube = new THREE.Mesh(new THREE.CylinderGeometry(8, 8, 26, 24, 1, true, Math.PI / 2, Math.PI), tubeMat);
  tube.rotation.x = Math.PI / 2; // cylinder axis Y -> Z; theta PI/2..3PI/2 is the upper half
  tube.position.set(247, 0, 208);
  tube.castShadow = true; tube.receiveShadow = true;
  group.add(tube);
  for (const pz of [195, 221]) group.add(box(17.2, 1.2, 1.2, concreteMat, 247, 8.6, pz)); // portal brows
  // Portal frames: concrete pillars + top beam + TUNNEL sign on each end,
  // so the tube reads as a tunnel entrance, not a blank grey wall.
  for (const pz of [195, 221]) {
    for (const sx of [-8.8, 8.8]) group.add(box(1.6, 9, 1.6, concreteMat, 247 + sx, 4.5, pz));
    group.add(box(19.2, 1.6, 1.6, std(0x8a8a82, 1), 247, 9.2, pz));
    signPlane('TUNNEL', '#20242c', '#ffd166', 7, 1.6, 247, 9.2, pz + (pz === 195 ? -0.85 : 0.85), pz === 195 ? Math.PI : 0);
    // Hazard stripes (yellow/black) on the portal pillars.
    for (const sx of [-8.8, 8.8]) {
      for (let hy = 0; hy < 4; hy += 1) {
        group.add(box(1.7, 0.9, 0.1, std(hy % 2 ? 0x20242c : 0xf7c948, 1), 247 + sx, 1 + hy * 1.8, pz + (pz === 195 ? -0.85 : 0.85)));
      }
    }
  }
  // Interior lights: a row of warm lights under the tube roof (the inside
  // was pitch dark) + a darker inner ceiling strip so the bore reads deep.
  for (const lz of [200, 206, 212, 218]) {
    const tl = new THREE.Mesh(new THREE.BoxGeometry(1.2, 0.25, 0.5), emissiveMat(0xffe9a8, 1.8));
    tl.position.set(247, 7.4, lz); group.add(tl);
  }
  // Retaining walls flanking the tunnel, so the tube ends look grounded.
  for (const sx of [-9.5, 9.5]) group.add(box(1, 3, 26, concreteMat, 247 + sx, 1.5, 208));
  // Natural rocky hill over the tunnel (was ONE smooth green cone — read as
  // a giant pyramid). A cluster of overlapping boulders in rock + grass
  // tones, with grass tufts on top, so the silhouette is irregular.
  const hillBase = new THREE.Mesh(new THREE.DodecahedronGeometry(9, 0), rockMat);
  hillBase.position.set(266, 3.0, 208); hillBase.scale.set(1.35, 0.55, 1.1); hillBase.rotation.set(0.2, 0.5, 0.1); hillBase.castShadow = true; group.add(hillBase);
  const hillTop = new THREE.Mesh(new THREE.DodecahedronGeometry(6, 0), rockMat2);
  hillTop.position.set(264, 6.2, 206); hillTop.scale.set(1.1, 0.6, 1); hillTop.rotation.set(0.4, 1.2, 0.3); hillTop.castShadow = true; group.add(hillTop);
  const hillSide = new THREE.Mesh(new THREE.DodecahedronGeometry(5, 0), std(0x6e7a52));
  hillSide.position.set(270, 2.4, 212); hillSide.scale.set(1, 0.6, 1.2); hillSide.rotation.set(0.1, 0.8, 0.2); hillSide.castShadow = true; group.add(hillSide);
  for (const [gx, gy, gz, gs] of [[262, 8.6, 205, 1.1], [267, 8.2, 209, 0.9], [265, 7.8, 211, 0.8]]) {
    const tuft = new THREE.Mesh(new THREE.ConeGeometry(0.9 * gs, 1.6 * gs, 6), std(0x4e9e3f, 1));
    tuft.position.set(gx, gy, gz); tuft.castShadow = true; group.add(tuft);
  }
  addCollider(266, 208, 22, 22); // hill base (x 255..277) — clear of the road

  // ---- Hill mounds (visual terrain, rocky hills biome) ---------------------
  // Flattened rock cones with colliders — the ground stays flat (no
  // heightfield physics), but the hills read as elevation. Kept clear of
  // the dirt roads and the big cliffs.
  for (const [mx, mz, mr, mh, mat] of [
    [285, 335, 12, 8, rockMat], [370, 290, 10, 7, rockMat2],
    [368, 358, 12, 9, rockMat], [278, 378, 11, 8, rockMat2],
    [340, 275, 9, 6, rockMat],
  ]) {
    const mound = new THREE.Mesh(new THREE.ConeGeometry(mr, mh, 10), mat);
    mound.position.set(mx, mh / 2, mz);
    mound.scale.set(1.25, 0.85, 0.9); // irregular footprint (was a perfect cone = pyramid)
    mound.rotation.y = rng.range(0, 3);
    mound.castShadow = true; mound.receiveShadow = true;
    group.add(mound);
    for (let bi = 0; bi < 3; bi += 1) {
      const br = rng.range(1.2, 2.6);
      const bx = mx + rng.range(-mr * 0.8, mr * 0.8), bz = mz + rng.range(-mr * 0.8, mr * 0.8);
      if (onRoad(bx, bz)) continue;
      boulder(bx, bz, br, rng.chance(0.5) ? rockMat : rockMat2);
    }
    addCollider(mx, mz, mr * 1.4, mr * 1.4);
  }

  // ---- Mission marker beacon (reused, moved by the game) --------------------
  const beacon = new THREE.Group();
  const beam = new THREE.Mesh(
    new THREE.CylinderGeometry(1.6, 1.6, 60, 16, 1, true),
    new THREE.MeshBasicMaterial({ color: 0xffd166, transparent: true, opacity: 0.28, side: THREE.DoubleSide, depthWrite: false }),
  );
  beam.position.y = 30;
  beacon.add(beam);
  const ring = new THREE.Mesh(new THREE.TorusGeometry(2.2, 0.18, 8, 32), emissiveMat(0xffd166, 1.4));
  ring.rotation.x = -Math.PI / 2;
  ring.position.y = 0.3;
  beacon.add(ring);
  // Mission arrow: big yellow chevron floating above the target, bobbing —
  // the player finds the objective without opening the map (Karimbu P0).
  // 4-sided pyramid, tip down, emissive so it reads at dusk and night.
  const arrow = new THREE.Mesh(
    new THREE.ConeGeometry(1.1, 2.2, 4),
    new THREE.MeshLambertMaterial({ color: 0xffd166, emissive: 0xffd166, emissiveIntensity: 0.7 }),
  );
  arrow.rotation.x = Math.PI; // tip points down
  arrow.rotation.y = Math.PI / 4;
  arrow.position.y = 6.5;
  arrow.castShadow = true;
  beacon.add(arrow);
  beacon.visible = false;
  group.add(beacon);

  return { colliders, treeSpots, mapBuildings, parkingLots, beacon, beaconArrow: arrow, waves, gasStation, chunkGroups: [...chunkMap.values()], park: { x0: parkX0, z0: parkZ0, x1: parkX1, z1: parkZ1 } };
}
