import * as THREE from 'three';
import { EffectComposer } from '../vendor/postprocessing/EffectComposer.js';
import { RenderPass } from '../vendor/postprocessing/RenderPass.js';
import { UnrealBloomPass } from '../vendor/postprocessing/UnrealBloomPass.js';

/* ----------------------------------------------------------------------
   1FPS — minimal browser FPS prototype
   Scene / level / player controller / weapon / targets / HUD
---------------------------------------------------------------------- */

const blocker = document.getElementById('blocker');
const blockerTitle = document.getElementById('blockerTitle');
const blockerSub = document.getElementById('blockerSub');
const hud = {
  ammo: document.getElementById('ammo'),
  reserve: document.getElementById('reserve'),
  hp: document.getElementById('hp'),
  weaponName: document.getElementById('weaponName'),
  healthbarFill: document.getElementById('healthbarFill'),
  crosshair: document.getElementById('crosshair'),
  scopeOverlay: document.getElementById('scopeOverlay'),
  hitmarker: document.getElementById('hitmarker'),
  flash: document.getElementById('flash'),
  killfeed: document.getElementById('killfeedList'),
  round: document.getElementById('roundLine'),
  killBanner: document.getElementById('killBanner'),
  armor: document.getElementById('armor'),
  armorLine: document.getElementById('armorLine'),
  credits: document.getElementById('credits'),
  creditsLine: document.getElementById('creditsLine'),
  buyCredits: document.getElementById('buyCredits'),
  ability: document.getElementById('abilityLine'),
};

// ----- renderer / scene / camera -----------------------------------
const renderer = new THREE.WebGLRenderer({ antialias: true, powerPreference: 'high-performance' });
renderer.setSize(window.innerWidth, window.innerHeight);
// cap at 2.5x — uncapped devicePixelRatio on some displays (3x+) tanks fill-rate
// for no visible benefit, capping keeps text/edges sharp without the cost
renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2.5));
renderer.shadowMap.enabled = true;
renderer.shadowMap.type = THREE.PCFSoftShadowMap;
renderer.toneMapping = THREE.ACESFilmicToneMapping;
renderer.toneMappingExposure = 1.15;
renderer.outputColorSpace = THREE.SRGBColorSpace;
// light contrast/saturation lift on the canvas itself — a cheap stand-in for a
// color-grading post-process pass since no postprocessing pipeline is wired up
renderer.domElement.style.filter = 'contrast(1.06) saturate(1.1)';
document.body.appendChild(renderer.domElement);
const maxAnisotropy = renderer.capabilities.getMaxAnisotropy();

const scene = new THREE.Scene();
scene.background = new THREE.Color(0x2b3850);
scene.fog = new THREE.Fog(0x2b3850, 25, 80);

const camera = new THREE.PerspectiveCamera(78, window.innerWidth / window.innerHeight, 0.1, 1000);

// bloom pass picks up emissive surfaces (visor glow, muzzle flash, ability
// effects) and blooms them — strength/radius/threshold tuned low so it
// stays a subtle glow instead of washing out the whole scene
const composer = new EffectComposer(renderer);
composer.addPass(new RenderPass(scene, camera));
const bloomPass = new UnrealBloomPass(
  new THREE.Vector2(window.innerWidth, window.innerHeight),
  0.45, 0.4, 0.86
);
composer.addPass(bloomPass);

// yawObject (turns left/right) holds pitchObject (tilts up/down) holds camera
const pitchObject = new THREE.Object3D();
pitchObject.add(camera);
const yawObject = new THREE.Object3D();
yawObject.position.set(0, 1.7, 8);
yawObject.add(pitchObject);
scene.add(yawObject);

// ----- lighting -------------------------------------------------------
scene.add(new THREE.HemisphereLight(0xbfd4ff, 0x3a3f4e, 1.05));
scene.add(new THREE.AmbientLight(0xffffff, 0.28));
const sun = new THREE.DirectionalLight(0xfff3d8, 2.6);
sun.position.set(20, 30, 10);
sun.castShadow = true;
sun.shadow.mapSize.set(4096, 4096);
sun.shadow.camera.left = -40;
sun.shadow.camera.right = 40;
sun.shadow.camera.top = 40;
sun.shadow.camera.bottom = -40;
sun.shadow.bias = -0.0006;
sun.shadow.normalBias = 0.02;
scene.add(sun);

// soft cool rim light from the opposite side so shadow-facing surfaces
// aren't a flat black — no shadow casting (purely fill, keeps the sun as
// the only shadow source) so it's nearly free for a noticeable depth boost
const fillLight = new THREE.DirectionalLight(0x8fb4ff, 0.45);
fillLight.position.set(-18, 14, -16);
scene.add(fillLight);

// ----- level: ground + walls + cover boxes -----------------------------
const colliders = []; // meshes used for AABB collision checks

// procedural tiled texture: subtle per-tile noise/grout lines so flat
// ground/wall surfaces aren't a single dead-flat color under the sun light
function makeNoiseTexture(baseHex, { tile = 256, grid = 8, noise = 14 } = {}) {
  const canvas = document.createElement('canvas');
  canvas.width = canvas.height = tile;
  const ctx2d = canvas.getContext('2d');
  const base = new THREE.Color(baseHex);
  ctx2d.fillStyle = `rgb(${base.r * 255}, ${base.g * 255}, ${base.b * 255})`;
  ctx2d.fillRect(0, 0, tile, tile);
  const imgData = ctx2d.getImageData(0, 0, tile, tile);
  for (let i = 0; i < imgData.data.length; i += 4) {
    const n = (Math.random() - 0.5) * noise;
    imgData.data[i] = Math.max(0, Math.min(255, imgData.data[i] + n));
    imgData.data[i + 1] = Math.max(0, Math.min(255, imgData.data[i + 1] + n));
    imgData.data[i + 2] = Math.max(0, Math.min(255, imgData.data[i + 2] + n));
  }
  ctx2d.putImageData(imgData, 0, 0);
  ctx2d.strokeStyle = 'rgba(0,0,0,0.18)';
  ctx2d.lineWidth = 1;
  for (let i = 0; i <= tile; i += tile / grid) {
    ctx2d.beginPath(); ctx2d.moveTo(i, 0); ctx2d.lineTo(i, tile); ctx2d.stroke();
    ctx2d.beginPath(); ctx2d.moveTo(0, i); ctx2d.lineTo(tile, i); ctx2d.stroke();
  }
  const texture = new THREE.CanvasTexture(canvas);
  texture.wrapS = texture.wrapT = THREE.RepeatWrapping;
  texture.colorSpace = THREE.SRGBColorSpace;
  if (maxAnisotropy) texture.anisotropy = maxAnisotropy;
  return texture;
}

// grayscale height-map companion to makeNoiseTexture's color map: same tile
// grid (recessed grout lines) plus per-pixel noise, so lit surfaces show
// actual micro-relief instead of a perfectly flat-shaded color texture
function makeBumpTexture({ tile = 256, grid = 8, noise = 22 } = {}) {
  const canvas = document.createElement('canvas');
  canvas.width = canvas.height = tile;
  const ctx2d = canvas.getContext('2d');
  ctx2d.fillStyle = 'rgb(128,128,128)';
  ctx2d.fillRect(0, 0, tile, tile);
  const imgData = ctx2d.getImageData(0, 0, tile, tile);
  for (let i = 0; i < imgData.data.length; i += 4) {
    const n = 128 + (Math.random() - 0.5) * noise;
    imgData.data[i] = imgData.data[i + 1] = imgData.data[i + 2] = Math.max(0, Math.min(255, n));
  }
  ctx2d.putImageData(imgData, 0, 0);
  ctx2d.strokeStyle = 'rgba(0,0,0,0.5)';
  ctx2d.lineWidth = 2;
  for (let i = 0; i <= tile; i += tile / grid) {
    ctx2d.beginPath(); ctx2d.moveTo(i, 0); ctx2d.lineTo(i, tile); ctx2d.stroke();
    ctx2d.beginPath(); ctx2d.moveTo(0, i); ctx2d.lineTo(tile, i); ctx2d.stroke();
  }
  const texture = new THREE.CanvasTexture(canvas);
  texture.wrapS = texture.wrapT = THREE.RepeatWrapping;
  if (maxAnisotropy) texture.anisotropy = maxAnisotropy;
  return texture;
}

function makeBoxMesh(w, h, d, color, texRepeat) {
  const material = new THREE.MeshStandardMaterial({ color, roughness: 0.85, metalness: 0.05 });
  if (texRepeat) {
    const tex = makeNoiseTexture(color);
    tex.repeat.set(texRepeat[0], texRepeat[1]);
    material.map = tex;
    material.color.set(0xffffff);
    const bump = makeBumpTexture();
    bump.repeat.set(texRepeat[0], texRepeat[1]);
    material.bumpMap = bump;
    material.bumpScale = 0.04;
  }
  const mesh = new THREE.Mesh(new THREE.BoxGeometry(w, h, d), material);
  mesh.castShadow = true;
  mesh.receiveShadow = true;
  return mesh;
}

function addCollider(mesh) {
  mesh.geometry.computeBoundingBox();
  colliders.push(mesh);
}

const ARENA = 60;
const wallHeight = 6;

// generates boundary wall segments for a rectangular room, with an optional
// door gap (a [start, end] range) on any of its four sides so rooms can be
// stitched together into corridors instead of always being sealed boxes
function roomWalls(x1, x2, z1, z2, doors = {}) {
  const h = wallHeight, t = 0.8;
  const segs = [];
  const addH = (zFixed, xa, xb, gap) => {
    if (gap) {
      const [ga, gb] = gap;
      if (ga > xa) segs.push([ga - xa, h, t, (xa + ga) / 2, h / 2, zFixed]);
      if (xb > gb) segs.push([xb - gb, h, t, (gb + xb) / 2, h / 2, zFixed]);
    } else segs.push([xb - xa, h, t, (xa + xb) / 2, h / 2, zFixed]);
  };
  const addV = (xFixed, za, zb, gap) => {
    if (gap) {
      const [ga, gb] = gap;
      if (ga > za) segs.push([t, h, ga - za, xFixed, h / 2, (za + ga) / 2]);
      if (zb > gb) segs.push([t, h, zb - gb, xFixed, h / 2, (gb + zb) / 2]);
    } else segs.push([t, h, zb - za, xFixed, h / 2, (za + zb) / 2]);
  };
  addH(z1, x1, x2, doors.z1);
  addH(z2, x1, x2, doors.z2);
  addV(x1, z1, z2, doors.x1);
  addV(x2, z1, z2, doors.x2);
  return segs;
}

// a corridor is just two parallel side walls with no end caps — the ends
// open straight into whichever rooms it connects
function corridorWalls(x1, x2, z1, z2) {
  const h = wallHeight, t = 0.8;
  const wide = (x2 - x1) >= (z2 - z1);
  if (wide) {
    return [
      [x2 - x1, h, t, (x1 + x2) / 2, h / 2, z1],
      [x2 - x1, h, t, (x1 + x2) / 2, h / 2, z2],
    ];
  }
  return [
    [t, h, z2 - z1, x1, h / 2, (z1 + z2) / 2],
    [t, h, z2 - z1, x2, h / 2, (z1 + z2) / 2],
  ];
}

const MAPS = {
  urban: {
    name: '도심 폐허',
    sky: 0x2b3850, fogNear: 25, fogFar: 80,
    ground: 0x2a3038, wall: 0x394452, cover: 0x55483a,
    coverPositions: [
      [4, -10], [-6, -4], [8, 5], [-10, 10], [0, 15], [-14, -14], [12, -16], [16, 6], [-4, 20], [6, -22],
    ],
  },
  desert: {
    name: '사막 협곡',
    sky: 0xd9c79e, fogNear: 20, fogFar: 70,
    ground: 0xc2a878, wall: 0x8a7152, cover: 0x6b5636,
    coverPositions: [
      [6, -8], [-8, -2], [10, 8], [-12, 12], [2, 18], [-16, -10], [14, -18], [18, 4], [-6, 22], [8, -24],
    ],
  },
  snow: {
    name: '설상 기지',
    sky: 0xc7d6e6, fogNear: 18, fogFar: 65,
    ground: 0xdfe8f0, wall: 0x8fa6bb, cover: 0x5c6b78,
    coverPositions: [
      [3, -9], [-7, -3], [9, 6], [-9, 11], [-1, 16], [-13, -13], [13, -15], [15, 7], [-3, 19], [5, -21],
    ],
  },
  arena: {
    name: '아레나',
    sky: 0x55667a, fogNear: 22, fogFar: 60,
    ground: 0x4a525c, wall: 0x6c7a8a, cover: 0x394048,
    coverPositions: [
      [-10, -10], [10, 10], [-10, 10], [10, -10], [0, -18], [0, 18],
    ],
    // four short wall stubs around the center, each with open gaps between
    // them so the middle stays fully walkable instead of a sealed room
    interiorWalls: [
      [1, wallHeight, 8, -9, wallHeight / 2, 0],
      [1, wallHeight, 8, 9, wallHeight / 2, 0],
      [8, wallHeight, 1, 0, wallHeight / 2, -9],
      [8, wallHeight, 1, 0, wallHeight / 2, 9],
    ],
  },
  backrooms: {
    name: '백룸',
    sky: 0x4a4322, fogNear: 12, fogFar: 38,
    ground: 0xb6a356, wall: 0xcdba6a, cover: 0x8c7b3d,
    coverPositions: [
      [-20, -20], [20, 20], [0, -22], [0, 22], [-20, 20], [20, -20],
    ],
    // short partition stubs spaced apart so every room stays reachable
    // (previous layout's segments lined up edge-to-edge into a closed maze)
    interiorWalls: [
      [1, wallHeight, 10, -12, wallHeight / 2, -8],
      [1, wallHeight, 10, -12, wallHeight / 2, 10],
      [1, wallHeight, 10, 12, wallHeight / 2, -10],
      [1, wallHeight, 10, 12, wallHeight / 2, 8],
      [10, wallHeight, 1, -5, wallHeight / 2, 0],
      [10, wallHeight, 1, 8, wallHeight / 2, -2],
    ],
  },
  onyx: {
    name: '오닉스',
    sky: 0x130d10, fogNear: 16, fogFar: 55,
    ground: 0x16121a, wall: 0x221a26, cover: 0x2a1f28,
    coverPositions: [
      [0, -20], [0, 20], [-20, 0], [20, 0],
    ],
    hazards: [
      [-15, -15, 10, 10], [15, 15, 10, 10], [-15, 15, 8, 8], [15, -15, 8, 8],
    ],
  },
  callout: {
    // laid out after the Venetian lagoon reference (45°26'N 12°20'E) — terracotta
    // brick walls, sandstone floor, and a narrow canal+footbridge through Market
    name: '베네치아 수로',
    width: 80, depth: 96,
    sky: 0xd9b97a, fogNear: 26, fogFar: 90,
    ground: 0x9c8a6a, wall: 0x7a4632, cover: 0x5c4a36,
    spawn: [0, 1.7, 40],
    // Attacker Spawn (south) -> Mid Top -> Mid Plaza -> A/B Lobby+Main -> A/B Site,
    // plus a Market corridor (canal crossing) down to Defender Spawn (north)
    interiorWalls: [
      ...roomWalls(-14, 14, 26, 46, { z1: [-2, 2] }),               // Attacker Spawn
      ...corridorWalls(-2, 2, 12, 26),                              // Mid Top (narrow alley)
      ...roomWalls(-16, 16, -8, 12, {                               // Mid Plaza (hub)
        z2: [-2, 2], z1: [-2, 2], x2: [1, 8], x1: [1, 8],
      }),
      ...corridorWalls(16, 28, 1, 8),                               // A Lobby/Main
      ...roomWalls(12, 34, -34, -2, { z2: [16, 28] }),              // A Site
      ...corridorWalls(-28, -16, 1, 8),                             // B Lobby/Main
      ...roomWalls(-34, -12, -34, -2, { z2: [-28, -16] }),          // B Site
      ...corridorWalls(-2, 2, -22, -8),                             // Market (canal alley)
      ...roomWalls(-14, 14, -46, -22, { z2: [-2, 2] }),             // Defender Spawn
    ],
    // narrow canal cutting across the Market alley, crossed by a single
    // wooden footbridge — purely cosmetic, doesn't block or damage movement
    water: [[0, -15, 4, 6]],
    bridges: [[4, 0.15, 6, 0, 0.08, -15]],
    coverPositions: [
      [22, -10], [28, -26], [18, -28],   // A Window / A Garden / A Raftars
      [-22, -10], [-28, -26],            // B Boat House
      [-8, 2], [8, 2], [0, -16],         // Mid Catwalk / Cubby / Market crates
    ],
  },
};

let currentMapKey = 'urban';
let levelMeshes = [];
let currentHazards = [];

function clearLevel() {
  for (const mesh of levelMeshes) scene.remove(mesh);
  levelMeshes = [];
  colliders.length = 0;
  currentHazards = [];
  clearAbilityEffects();
}

function buildLevel(key) {
  clearLevel();
  const cfg = MAPS[key];
  currentMapKey = key;

  scene.background = new THREE.Color(cfg.sky);
  scene.fog = new THREE.Fog(cfg.sky, cfg.fogNear, cfg.fogFar);

  const mapW = cfg.width || ARENA;
  const mapD = cfg.depth || ARENA;

  const ground = makeBoxMesh(mapW, 1, mapD, cfg.ground, [mapW / 3, mapD / 3]);
  ground.position.y = -0.5;
  ground.receiveShadow = true;
  scene.add(ground);
  levelMeshes.push(ground);

  const wallDefs = [
    [mapW, wallHeight, 1, 0, wallHeight / 2, -mapD / 2],
    [mapW, wallHeight, 1, 0, wallHeight / 2, mapD / 2],
    [1, wallHeight, mapD, -mapW / 2, wallHeight / 2, 0],
    [1, wallHeight, mapD, mapW / 2, wallHeight / 2, 0],
  ];
  for (const [w, h, d, x, y, z] of wallDefs) {
    const wall = makeBoxMesh(w, h, d, cfg.wall, [Math.max(w, d) / 6, wallHeight / 3]);
    wall.position.set(x, y, z);
    scene.add(wall);
    addCollider(wall);
    levelMeshes.push(wall);

    // dark baseboard trim where the wall meets the floor — grounds the
    // boundary visually instead of color-matched wall/floor bleeding together
    const trim = makeBoxMesh(w + 0.05, 0.25, d + 0.05, 0x14161a);
    trim.position.set(x, 0.12, z);
    scene.add(trim);
    levelMeshes.push(trim);
  }

  // corner support pillars: tall accent beams at all four boundary corners
  // give the arena a readable skyline silhouette instead of just flat walls
  const pillarColor = new THREE.Color(cfg.wall).multiplyScalar(0.65).getHex();
  const pillarHeight = wallHeight + 2.5;
  for (const sx of [-1, 1]) {
    for (const sz of [-1, 1]) {
      const pillar = makeBoxMesh(1.4, pillarHeight, 1.4, pillarColor);
      pillar.material.metalness = 0.35;
      pillar.material.roughness = 0.5;
      pillar.position.set(sx * (mapW / 2 - 0.6), pillarHeight / 2, sz * (mapD / 2 - 0.6));
      scene.add(pillar);
      addCollider(pillar);
      levelMeshes.push(pillar);
    }
  }

  for (const [x, z] of cfg.coverPositions) {
    const size = 1.6 + Math.random() * 1.2;
    const crate = makeBoxMesh(size, size, size, cfg.cover, [1, 1]);
    crate.position.set(x, size / 2, z);
    crate.rotation.y = Math.random() * Math.PI * 2;
    scene.add(crate);
    addCollider(crate);
    levelMeshes.push(crate);
  }

  for (const [w, h, d, x, y, z] of cfg.interiorWalls || []) {
    const wall = makeBoxMesh(w, h, d, cfg.wall, [Math.max(w, d) / 6, h / 3]);
    wall.position.set(x, y, z);
    scene.add(wall);
    addCollider(wall);
    levelMeshes.push(wall);
  }

  for (const [x, z, w, d] of cfg.hazards || []) {
    const lavaTex = makeNoiseTexture(0xff5522, { noise: 40 });
    lavaTex.repeat.set(w / 3, d / 3);
    const lava = new THREE.Mesh(
      new THREE.BoxGeometry(w, 0.1, d),
      new THREE.MeshStandardMaterial({
        map: lavaTex, color: 0xffffff,
        emissive: 0xff3300, emissiveIntensity: 1.2, roughness: 0.5,
      })
    );
    lava.position.set(x, 0.05, z);
    scene.add(lava);
    levelMeshes.push(lava);
    currentHazards.push({ x, z, w, d, mesh: lava });
  }

  for (const [x, z, w, d] of cfg.water || []) {
    const water = new THREE.Mesh(
      new THREE.BoxGeometry(w, 0.08, d),
      new THREE.MeshStandardMaterial({
        color: 0x2f5d6b, emissive: 0x163a44, emissiveIntensity: 0.4,
        roughness: 0.15, metalness: 0.2, transparent: true, opacity: 0.85,
      })
    );
    water.position.set(x, 0.03, z);
    scene.add(water);
    levelMeshes.push(water);
  }

  for (const [w, h, d, x, y, z] of cfg.bridges || []) {
    // flush with the floor and walked straight over, so it's purely
    // cosmetic — not a collider, since collision here is a flat XZ check
    // that ignores height and would otherwise block the crossing
    const plank = makeBoxMesh(w, h, d, 0x6b4a32, [w / 2, d / 2]);
    plank.position.set(x, y, z);
    scene.add(plank);
    levelMeshes.push(plank);
  }
}

function spawnPoint() {
  return (MAPS[currentMapKey] && MAPS[currentMapKey].spawn) || [0, 1.7, 8];
}

function hazardAt(x, z) {
  for (const h of currentHazards) {
    if (Math.abs(x - h.x) < h.w / 2 && Math.abs(z - h.z) < h.d / 2) return true;
  }
  return false;
}

// ----- targets (simple enemies) ---------------------------------------
const targets = [];
const HEALTH_BAR_WIDTH = 0.8;

function updateTargetHealthBar(target) {
  const { barFill, hp, maxHp } = target.userData;
  const frac = Math.max(0, hp / maxHp);
  const w = HEALTH_BAR_WIDTH * frac;
  barFill.scale.x = Math.max(0.0001, w);
  barFill.position.x = -(HEALTH_BAR_WIDTH - w) / 2;
  barFill.material.color.setHex(frac > 0.5 ? 0xff3b3b : frac > 0.25 ? 0xff9d3b : 0xff2222);
}

// combat-android look (gunmetal chassis + glowing visor) instead of a plain
// humanoid dummy — higher-segment geometry throughout so the curved armor
// plates and barrel actually read as round instead of faceted up close
function spawnTarget(x, z) {
  const group = new THREE.Group();
  // lower metalness than a "real" gunmetal finish so the chassis still picks up
  // ambient/sky light and doesn't render near-black in shadowed corners
  const chassisMat = new THREE.MeshStandardMaterial({ color: 0x6b7480, roughness: 0.4, metalness: 0.55 });
  const jointMat = new THREE.MeshStandardMaterial({ color: 0x363b42, roughness: 0.5, metalness: 0.45 });
  const visorColor = 0x4fd8ff;

  const body = new THREE.Mesh(
    new THREE.CapsuleGeometry(0.45, 1.2, 10, 24),
    chassisMat
  );
  body.position.y = 1.1;
  body.castShadow = true;

  // chest/back armor plating — a clearer silhouette and a readable hitbox
  const vest = new THREE.Mesh(
    new THREE.CylinderGeometry(0.48, 0.42, 0.72, 20, 1, true, 0, Math.PI),
    new THREE.MeshStandardMaterial({ color: 0x282c32, roughness: 0.4, metalness: 0.7, side: THREE.DoubleSide })
  );
  vest.rotation.y = -Math.PI / 2;
  vest.position.y = 1.35;
  vest.castShadow = true;

  // boxy armored shoulder pauldrons read clearly at a distance
  const shoulderGeo = new THREE.BoxGeometry(0.26, 0.16, 0.3);
  const shoulderL = new THREE.Mesh(shoulderGeo, jointMat);
  shoulderL.position.set(-0.42, 1.78, 0);
  shoulderL.castShadow = true;
  const shoulderR = new THREE.Mesh(shoulderGeo, jointMat);
  shoulderR.position.set(0.42, 1.78, 0);
  shoulderR.castShadow = true;

  const head = new THREE.Mesh(
    new THREE.SphereGeometry(0.3, 24, 24),
    chassisMat
  );
  head.position.y = 2.0;
  head.castShadow = true;

  // glowing blue visor band wraps most of the face, like a HUD strip
  const visor = new THREE.Mesh(
    new THREE.SphereGeometry(0.27, 20, 20, 0, Math.PI * 2, 0.35 * Math.PI, 0.5 * Math.PI),
    new THREE.MeshStandardMaterial({ color: visorColor, emissive: visorColor, emissiveIntensity: 1.8, roughness: 0.3, metalness: 0.1 })
  );
  visor.position.set(0, 2.0, 0);
  const visorGlow = new THREE.PointLight(visorColor, 1.4, 4, 2);
  visorGlow.position.set(0, 2.0, -0.2);

  // procedural rifle held at hip height, built the same way as the
  // player's own weapon viewmodels (receiver + barrel + stock + mag)
  const gun = new THREE.Group();
  const gunReceiver = new THREE.Mesh(
    new THREE.BoxGeometry(0.1, 0.13, 0.46),
    new THREE.MeshStandardMaterial({ color: 0x16181c, roughness: 0.35, metalness: 0.65 })
  );
  const gunBarrel = new THREE.Mesh(
    new THREE.CylinderGeometry(0.022, 0.022, 0.28, 16),
    new THREE.MeshStandardMaterial({ color: 0x0e0f11, roughness: 0.25, metalness: 0.85 })
  );
  gunBarrel.rotation.x = Math.PI / 2;
  gunBarrel.position.set(0, 0.01, -0.35);
  const gunMag = new THREE.Mesh(
    new THREE.BoxGeometry(0.05, 0.2, 0.08),
    new THREE.MeshStandardMaterial({ color: 0x1a1c20, roughness: 0.4, metalness: 0.6 })
  );
  gunMag.position.set(0, -0.15, 0.04);
  gunMag.rotation.x = 0.12;
  const gunStock = new THREE.Mesh(
    new THREE.BoxGeometry(0.06, 0.07, 0.18),
    new THREE.MeshStandardMaterial({ color: 0x1a1c20, roughness: 0.45, metalness: 0.55 })
  );
  gunStock.position.set(0, 0.0, 0.3);
  gun.add(gunReceiver, gunBarrel, gunMag, gunStock);
  gun.position.set(0.32, 1.25, -0.1);
  gun.rotation.y = -0.05;
  for (const part of gun.children) part.castShadow = true;

  const muzzleLight = new THREE.PointLight(0xffaa55, 0, 5, 2);
  muzzleLight.position.set(0.32, 1.25, -0.42);

  // separate lower-body hitbox: a slightly-forward box so low shots register
  // as a leg hit (reduced damage) instead of always counting as a body hit
  const leg = new THREE.Mesh(
    new THREE.BoxGeometry(0.5, 0.7, 0.5),
    jointMat
  );
  leg.position.set(0, 0.35, 0.03);
  leg.castShadow = true;

  group.add(body, vest, shoulderL, shoulderR, head, visor, visorGlow, gun, muzzleLight, leg);
  group.position.set(x, 0, z);

  // floating health bar (kept as a separate top-level object so the
  // enemy's facing rotation doesn't drag the bar's fill offset around)
  const barBack = new THREE.Sprite(
    new THREE.SpriteMaterial({ color: 0x1a1a1a, opacity: 0.75, transparent: true, depthTest: false })
  );
  barBack.scale.set(HEALTH_BAR_WIDTH + 0.06, 0.16, 1);
  const barFill = new THREE.Sprite(
    new THREE.SpriteMaterial({ color: 0xff3b3b, depthTest: false })
  );
  barFill.scale.set(HEALTH_BAR_WIDTH, 0.1, 1);
  barFill.renderOrder = 1;
  const healthBar = new THREE.Group();
  healthBar.add(barBack, barFill);
  healthBar.position.set(x, 2.55, z);
  scene.add(healthBar);

  group.userData = {
    hp: 100, maxHp: 100, alive: true, body, head, gun, muzzleLight, leg,
    healthBar, barFill,
    baseY: 0, t: Math.random() * Math.PI * 2,
    attackCooldown: 1 + Math.random() * 1.5,
    attackRange: 22,
    strafeTimer: 0, strafeSign: 1,
    ammo: 20, maxAmmo: 20, reloading: false, reloadTimer: 0,
  };
  scene.add(group);
  targets.push(group);
  updateTargetHealthBar(group);
}
const MAX_TARGETS = 8;
const SPAWN_MIN_DIST_FROM_PLAYER = 10;

function spawnRandomTarget() {
  if (targets.length >= MAX_TARGETS) return;
  const half = ARENA / 2 - 3;
  for (let attempt = 0; attempt < 20; attempt++) {
    const x = (Math.random() * 2 - 1) * half;
    const z = (Math.random() * 2 - 1) * half;
    if (yawObject.position.distanceTo(new THREE.Vector3(x, 0, z)) < SPAWN_MIN_DIST_FROM_PLAYER) continue;
    if (collidesAt(x, z)) continue;
    if (hazardAt(x, z)) continue;
    spawnTarget(x, z);
    return;
  }
}

// the duel opponent is a single tougher, more aggressive bot rather than a
// wave of weak dummies — boosted hp/accuracy/fire-rate flagged via isDuelist
function spawnDuelOpponent() {
  const half = ARENA / 2 - 3;
  let x = 0, z = -10;
  for (let attempt = 0; attempt < 20; attempt++) {
    const tx = (Math.random() * 2 - 1) * half;
    const tz = (Math.random() * 2 - 1) * half;
    if (yawObject.position.distanceTo(new THREE.Vector3(tx, 0, tz)) < 14) continue;
    if (collidesAt(tx, tz)) continue;
    if (hazardAt(tx, tz)) continue;
    x = tx; z = tz;
    break;
  }
  spawnTarget(x, z);
  const ai = targets[targets.length - 1];
  ai.userData.hp = ai.userData.maxHp = 150;
  ai.userData.attackRange = 35;
  ai.userData.isDuelist = true;
  updateTargetHealthBar(ai);
}

// ----- agent abilities ------------------------------------------------------
// a Valorant-style "agent" pick: one ability per agent, bound to a single key
// (E), separate from the weapon system entirely — picking an agent never
// changes your guns, it only changes what E does
const AGENTS = {
  fire: { name: '블레이즈', color: 0xff6a2b, cooldown: 8, desc: '화염벽 — 전방에 화염 장벽을 세워 닿는 적을 태운다' },
  ice: { name: '프로스트', color: 0x6ad8ff, cooldown: 10, desc: '얼음벽 — 전방에 단단한 얼음 장벽을 세워 시야와 이동을 막는다' },
  electric: { name: '볼트', color: 0xfff066, cooldown: 7, desc: '전기 충격 — 전방 범위에 즉발 전기 피해를 입힌다' },
  teleport: { name: '노바', color: 0xb673ff, cooldown: 6, desc: '순간이동 — 보고 있는 방향으로 짧게 블링크한다' },
};
let currentAgent = 'fire';
let abilityCooldown = 0;
const abilityEffects = [];

function forwardDir() {
  return new THREE.Vector3(0, 0, -1).applyAxisAngle(new THREE.Vector3(0, 1, 0), yaw);
}

function damageTarget(target, amount) {
  if (!target.userData.alive) return;
  target.userData.hp -= amount;
  updateTargetHealthBar(target);
  if (target.userData.hp <= 0) killTarget(target, false);
}

function spawnWallEffect(type, color, durationSec, blocks) {
  const fwd = forwardDir();
  const cx = yawObject.position.x + fwd.x * 4;
  const cz = yawObject.position.z + fwd.z * 4;
  const angle = Math.atan2(fwd.x, fwd.z);
  const width = 6, depth = 0.4, height = 2.6;
  const mesh = new THREE.Mesh(
    new THREE.BoxGeometry(width, height, depth),
    new THREE.MeshStandardMaterial({
      color, emissive: color, emissiveIntensity: type === 'fire' ? 1.4 : 0.6,
      transparent: true, opacity: type === 'fire' ? 0.85 : 0.55, roughness: 0.4,
    })
  );
  mesh.position.set(cx, height / 2, cz);
  mesh.rotation.y = angle;
  scene.add(mesh);
  const light = new THREE.PointLight(color, 2.2, 9, 2);
  light.position.set(cx, height / 2, cz);
  scene.add(light);

  const effect = {
    type, mesh, light, life: durationSec, maxLife: durationSec,
    x: cx, z: cz, angle, halfWidth: width / 2, halfDepth: depth / 2 + 0.6,
    tickTimer: 0, collider: null,
  };
  if (blocks) {
    addCollider(mesh);
    effect.collider = mesh;
  }
  abilityEffects.push(effect);
}

function withinWallFootprint(effect, x, z) {
  const dx = x - effect.x, dz = z - effect.z;
  const cosA = Math.cos(effect.angle), sinA = Math.sin(effect.angle);
  const lx = dx * cosA - dz * sinA;
  const lz = dx * sinA + dz * cosA;
  return Math.abs(lx) < effect.halfWidth && Math.abs(lz) < effect.halfDepth;
}

function spawnBurstEffect(color) {
  const fwd = forwardDir();
  const cx = yawObject.position.x + fwd.x * 5;
  const cz = yawObject.position.z + fwd.z * 5;
  const radius = 5;
  const mesh = new THREE.Mesh(
    new THREE.SphereGeometry(0.6, 16, 16),
    new THREE.MeshBasicMaterial({ color, transparent: true, opacity: 0.8 })
  );
  mesh.position.set(cx, 1.2, cz);
  scene.add(mesh);
  const light = new THREE.PointLight(color, 4, 14, 2);
  light.position.set(cx, 1.2, cz);
  scene.add(light);
  abilityEffects.push({ type: 'burstFx', mesh, light, life: 0.4, maxLife: 0.4 });

  for (const target of targets) {
    if (!target.userData.alive) continue;
    const dx = target.position.x - cx, dz = target.position.z - cz;
    if (Math.hypot(dx, dz) <= radius) damageTarget(target, 40);
  }
}

function spawnBlinkEffect(color, x0, z0, x1, z1) {
  for (const [x, z] of [[x0, z0], [x1, z1]]) {
    const mesh = new THREE.Mesh(
      new THREE.RingGeometry(0.3, 0.7, 24),
      new THREE.MeshBasicMaterial({ color, transparent: true, opacity: 0.9, side: THREE.DoubleSide })
    );
    mesh.position.set(x, 1.0, z);
    mesh.rotation.x = -Math.PI / 2;
    scene.add(mesh);
    abilityEffects.push({ type: 'burstFx', mesh, light: null, life: 0.35, maxLife: 0.35 });
  }
}

function useAbility() {
  if (!locked || gameOver || abilityCooldown > 0) return;
  const agent = AGENTS[currentAgent];
  abilityCooldown = agent.cooldown;

  if (currentAgent === 'fire') {
    spawnWallEffect('fire', agent.color, 4, false);
  } else if (currentAgent === 'ice') {
    spawnWallEffect('ice', agent.color, 6, true);
  } else if (currentAgent === 'electric') {
    spawnBurstEffect(agent.color);
  } else if (currentAgent === 'teleport') {
    const fwd = forwardDir();
    const maxDist = 8;
    const step = 0.25;
    const x0 = yawObject.position.x, z0 = yawObject.position.z;
    // walk outward from the player (not inward from maxDist) so a thin wall
    // close to the start can't be skipped over by checking only the far endpoint
    let dist = 0;
    for (let d = step; d <= maxDist; d += step) {
      if (collidesAt(x0 + fwd.x * d, z0 + fwd.z * d)) break;
      dist = d;
    }
    const x1 = x0 + fwd.x * dist, z1 = z0 + fwd.z * dist;
    spawnBlinkEffect(agent.color, x0, z0, x1, z1);
    yawObject.position.x = x1;
    yawObject.position.z = z1;
  }
  updateAbilityHud();
}

function updateAbilityEffects(dt) {
  for (let i = abilityEffects.length - 1; i >= 0; i--) {
    const fx = abilityEffects[i];
    fx.life -= dt;

    if (fx.type === 'fire' || fx.type === 'ice') {
      const t = Math.max(0, fx.life / fx.maxLife);
      fx.mesh.material.opacity = (fx.type === 'fire' ? 0.85 : 0.55) * Math.min(1, t * 2);
      if (fx.light) fx.light.intensity = 2.2 * t;
      if (fx.type === 'fire') {
        fx.tickTimer -= dt;
        if (fx.tickTimer <= 0) {
          fx.tickTimer = 0.5;
          for (const target of targets) {
            if (target.userData.alive && withinWallFootprint(fx, target.position.x, target.position.z)) {
              damageTarget(target, 10);
            }
          }
        }
      }
    } else if (fx.type === 'burstFx') {
      const t = Math.max(0, fx.life / fx.maxLife);
      fx.mesh.scale.setScalar(1 + (1 - t) * 3);
      fx.mesh.material.opacity = 0.9 * t;
      if (fx.light) fx.light.intensity = 4 * t;
    }

    if (fx.life <= 0) {
      scene.remove(fx.mesh);
      if (fx.light) scene.remove(fx.light);
      if (fx.collider) {
        const idx = colliders.indexOf(fx.collider);
        if (idx !== -1) colliders.splice(idx, 1);
      }
      abilityEffects.splice(i, 1);
    }
  }
}

function clearAbilityEffects() {
  for (const fx of abilityEffects) {
    scene.remove(fx.mesh);
    if (fx.light) scene.remove(fx.light);
    if (fx.collider) {
      const idx = colliders.indexOf(fx.collider);
      if (idx !== -1) colliders.splice(idx, 1);
    }
  }
  abilityEffects.length = 0;
}

function updateAbilityHud() {
  const agent = AGENTS[currentAgent];
  hud.ability.textContent = abilityCooldown > 0
    ? `E 능력 [${agent.name}] 재사용 ${abilityCooldown.toFixed(1)}s`
    : `E 능력 [${agent.name}] 준비됨`;
}

function selectAgent(key) {
  if (!AGENTS[key]) return;
  currentAgent = key;
  for (const btn of agentButtons) btn.classList.toggle('active', btn.dataset.agent === key);
  updateAbilityHud();
}

document.addEventListener('keydown', (e) => { if (e.code === 'KeyE') useAbility(); });

const agentButtons = document.querySelectorAll('.agentBtn');
for (const btn of agentButtons) {
  btn.addEventListener('click', (e) => {
    e.stopPropagation();
    selectAgent(btn.dataset.agent);
  });
}
for (const btn of agentButtons) btn.classList.toggle('active', btn.dataset.agent === currentAgent);
updateAbilityHud();

// ----- weapon viewmodels ---------------------------------------------------
// Valorant has a unique mesh per gun; here every one of the 19 weapons gets
// its own small procedural model built from boxes/cylinders, distinguished
// by silhouette (barrel length, mag/drum shape, scope, stock) and material.
function buildMuzzle(parent, pos) {
  const light = new THREE.PointLight(0xffcc66, 0, 6, 2);
  light.position.copy(pos);
  parent.add(light);
  const sprite = new THREE.Mesh(
    new THREE.PlaneGeometry(0.18, 0.18),
    new THREE.MeshBasicMaterial({ color: 0xffdd88, transparent: true, opacity: 0 })
  );
  sprite.position.copy(pos);
  parent.add(sprite);
  return { light, sprite };
}

function gunMat(color, roughness = 0.4, metalness = 0.6) {
  return new THREE.MeshStandardMaterial({ color, roughness, metalness });
}
function gunBox(w, h, d, mat, pos, rotX) {
  const m = new THREE.Mesh(new THREE.BoxGeometry(w, h, d), mat);
  if (pos) m.position.copy(pos);
  if (rotX) m.rotation.x = rotX;
  return m;
}
// cylinder barrel/scope, axis along z by default — 20 radial segments
// (up from 12) so barrels/scopes/mags read as round instead of faceted
// when the weapon fills a good chunk of the screen
function gunCyl(rad, len, mat, pos, axis = 'z') {
  const m = new THREE.Mesh(new THREE.CylinderGeometry(rad, rad, len, 20), mat);
  if (axis === 'z') m.rotation.x = Math.PI / 2;
  else if (axis === 'x') m.rotation.z = Math.PI / 2;
  if (pos) m.position.copy(pos);
  return m;
}

const weaponModels = {};
const weaponMuzzles = {};
const weaponRestZ = {};
function registerGun(key, parts, restPos, muzzlePos) {
  const group = new THREE.Group();
  for (const part of parts) group.add(part);
  group.position.copy(restPos);
  group.visible = false;
  camera.add(group);
  weaponModels[key] = group;
  weaponRestZ[key] = restPos.z;
  weaponMuzzles[key] = muzzlePos ? buildMuzzle(group, muzzlePos) : null;
}
const V3 = (x, y, z) => new THREE.Vector3(x, y, z);

// ----- sidearms -----
registerGun('classic', [
  gunBox(0.1, 0.16, 0.32, gunMat(0x2a2c30, 0.35, 0.65)),
  gunBox(0.08, 0.18, 0.1, gunMat(0x16171a, 0.6, 0.3), V3(0, -0.15, 0.08)),
], V3(0.26, -0.22, -0.42), V3(0, 0.03, -0.18));

registerGun('shorty', [
  gunBox(0.13, 0.14, 0.2, gunMat(0x4a3a26, 0.55, 0.3)),
  gunCyl(0.025, 0.18, gunMat(0x1a1a1c, 0.3, 0.8), V3(-0.03, 0.0, -0.18)),
  gunCyl(0.025, 0.18, gunMat(0x1a1a1c, 0.3, 0.8), V3(0.03, 0.0, -0.18)),
  gunBox(0.08, 0.16, 0.09, gunMat(0x2a2018, 0.6, 0.2), V3(0, -0.13, 0.05)),
], V3(0.26, -0.22, -0.35), V3(0, 0.0, -0.27));

registerGun('frenzy', [
  gunBox(0.1, 0.15, 0.28, gunMat(0x33405a, 0.4, 0.6)),
  gunBox(0.04, 0.12, 0.05, gunMat(0x1c2230, 0.5, 0.4), V3(0, -0.17, 0.02)),
  gunBox(0.08, 0.16, 0.09, gunMat(0x20262e, 0.6, 0.3), V3(0, -0.15, 0.07)),
], V3(0.26, -0.22, -0.4), V3(0, 0.03, -0.16));

registerGun('ghost', [
  gunBox(0.1, 0.15, 0.3, gunMat(0x2d3a30, 0.4, 0.5)),
  gunCyl(0.022, 0.22, gunMat(0x1a1a1a, 0.3, 0.6), V3(0, 0.0, -0.28)),
  gunBox(0.08, 0.17, 0.09, gunMat(0x16201a, 0.6, 0.3), V3(0, -0.15, 0.07)),
], V3(0.26, -0.22, -0.46), V3(0, 0.02, -0.4));

registerGun('sheriff', [
  gunBox(0.1, 0.14, 0.22, gunMat(0xc9ccd0, 0.25, 0.85)),
  gunCyl(0.06, 0.1, gunMat(0x9a9da2, 0.3, 0.8), V3(0, 0.0, -0.04), 'x'),
  gunCyl(0.025, 0.22, gunMat(0x4a4d52, 0.3, 0.8), V3(0, 0.0, -0.18)),
  gunBox(0.08, 0.18, 0.1, gunMat(0x5a4030, 0.6, 0.2), V3(0, -0.15, 0.06)),
], V3(0.27, -0.22, -0.4), V3(0, 0.0, -0.3));

// ----- SMGs -----
registerGun('stinger', [
  gunBox(0.11, 0.14, 0.4, gunMat(0x6b5d44, 0.5, 0.4)),
  gunCyl(0.025, 0.2, gunMat(0x1a1a1c, 0.3, 0.8), V3(0, 0.02, -0.42)),
  gunBox(0.05, 0.18, 0.07, gunMat(0x3a3226, 0.6, 0.3), V3(0, -0.17, -0.05)),
], V3(0.27, -0.23, -0.45), V3(0, 0.02, -0.5));

registerGun('spectre', [
  gunBox(0.12, 0.15, 0.42, gunMat(0x2c2e32, 0.45, 0.55)),
  gunCyl(0.028, 0.22, gunMat(0x141416, 0.3, 0.8), V3(0, 0.02, -0.44)),
  gunBox(0.05, 0.2, 0.08, gunMat(0x1a1b1d, 0.6, 0.3), V3(0, -0.18, -0.04), 0.1),
  gunBox(0.04, 0.06, 0.22, gunMat(0x1a1b1d, 0.6, 0.3), V3(0, 0.0, 0.28)),
], V3(0.28, -0.23, -0.46), V3(0, 0.02, -0.53));

// ----- shotguns -----
registerGun('bucky', [
  gunBox(0.15, 0.16, 0.36, gunMat(0x4a3a26, 0.55, 0.3)),
  gunCyl(0.035, 0.34, gunMat(0x1a1a1c, 0.3, 0.8), V3(-0.035, 0.02, -0.34)),
  gunCyl(0.035, 0.34, gunMat(0x1a1a1c, 0.3, 0.8), V3(0.035, 0.02, -0.34)),
  gunBox(0.1, 0.08, 0.14, gunMat(0x2a2018, 0.6, 0.2), V3(0, -0.05, -0.2)),
], V3(0.28, -0.26, -0.42), V3(0, 0.02, -0.5));

registerGun('judge', [
  gunBox(0.13, 0.15, 0.26, gunMat(0x2a2a2c, 0.4, 0.5)),
  gunCyl(0.07, 0.11, gunMat(0x1f1f21, 0.3, 0.7), V3(0, 0.0, -0.02), 'x'),
  gunCyl(0.04, 0.22, gunMat(0x161618, 0.3, 0.8), V3(0, 0.0, -0.2)),
], V3(0.28, -0.25, -0.36), V3(0, 0.0, -0.28));

// ----- rifles -----
registerGun('bulldog', [
  gunBox(0.12, 0.15, 0.5, gunMat(0x4b5240, 0.45, 0.45)),
  gunCyl(0.025, 0.26, gunMat(0x111214, 0.3, 0.8), V3(0, 0.02, -0.42)),
  gunBox(0.06, 0.22, 0.09, gunMat(0x2c2f24, 0.5, 0.3), V3(0, -0.19, -0.05), 0.15),
  gunBox(0.06, 0.1, 0.16, gunMat(0x2c2f24, 0.5, 0.3), V3(0, 0.0, 0.32)),
], V3(0.28, -0.25, -0.54), V3(0, 0.02, -0.62));

registerGun('guardian', [
  gunBox(0.11, 0.14, 0.6, gunMat(0x3a3d42, 0.4, 0.55)),
  gunCyl(0.022, 0.36, gunMat(0x111214, 0.3, 0.8), V3(0, 0.02, -0.5)),
  gunBox(0.05, 0.18, 0.08, gunMat(0x222428, 0.5, 0.3), V3(0, -0.17, -0.05)),
  gunCyl(0.025, 0.16, gunMat(0x0c0c0d, 0.2, 0.9), V3(0, 0.09, -0.1)),
], V3(0.29, -0.24, -0.62), V3(0, 0.02, -0.74));

registerGun('phantom', [
  gunBox(0.12, 0.15, 0.46, gunMat(0x23262e, 0.4, 0.6)),
  gunCyl(0.03, 0.26, gunMat(0x15161a, 0.3, 0.7), V3(0, 0.02, -0.46)),
  gunBox(0.055, 0.22, 0.085, gunMat(0x181a1e, 0.5, 0.3), V3(0, -0.19, -0.04), 0.15),
], V3(0.28, -0.25, -0.5), V3(0, 0.02, -0.62));

registerGun('vandal', [
  gunBox(0.12, 0.15, 0.52, gunMat(0x2a2520, 0.45, 0.45)),
  gunCyl(0.025, 0.3, gunMat(0xd4af50, 0.3, 0.9), V3(0, 0.02, -0.46)),
  gunBox(0.06, 0.22, 0.09, gunMat(0x2a2520, 0.5, 0.3), V3(0, -0.19, -0.04), 0.15),
], V3(0.28, -0.25, -0.56), V3(0, 0.02, -0.64));

// ----- sniper rifles -----
registerGun('marshal', [
  gunBox(0.1, 0.13, 0.62, gunMat(0x4a3c2c, 0.5, 0.3)),
  gunCyl(0.02, 0.36, gunMat(0x111214, 0.3, 0.8), V3(0, 0.02, -0.5)),
  gunCyl(0.025, 0.18, gunMat(0x0c0c0d, 0.2, 0.9), V3(0, 0.09, -0.08)),
], V3(0.3, -0.24, -0.6), V3(0, 0.02, -0.7));

registerGun('outlaw', [
  gunBox(0.11, 0.14, 0.58, gunMat(0x1f2024, 0.4, 0.55)),
  gunCyl(0.022, 0.34, gunMat(0x111214, 0.3, 0.8), V3(0, 0.02, -0.46)),
  gunBox(0.05, 0.14, 0.06, gunMat(0x15161a, 0.5, 0.3), V3(0, -0.15, -0.05)),
  gunCyl(0.026, 0.2, gunMat(0x0c0c0d, 0.2, 0.9), V3(0, 0.095, -0.1)),
], V3(0.3, -0.24, -0.58), V3(0, 0.02, -0.66));

registerGun('operator', [
  gunBox(0.1, 0.13, 0.78, gunMat(0x23262a, 0.4, 0.6)),
  gunCyl(0.02, 0.46, gunMat(0x111214, 0.3, 0.8), V3(0, 0.02, -0.6)),
  gunCyl(0.03, 0.26, gunMat(0x0c0c0d, 0.2, 0.9), V3(0, 0.1, -0.12)),
  gunBox(0.02, 0.16, 0.02, gunMat(0x111214, 0.5, 0.5), V3(-0.05, -0.1, -0.5), 0.4),
  gunBox(0.02, 0.16, 0.02, gunMat(0x111214, 0.5, 0.5), V3(0.05, -0.1, -0.5), -0.4),
], V3(0.3, -0.22, -0.7), V3(0, 0.02, -0.84));

// ----- heavy -----
registerGun('ares', [
  gunBox(0.13, 0.16, 0.5, gunMat(0x3c4632, 0.5, 0.4)),
  gunCyl(0.03, 0.3, gunMat(0x111214, 0.3, 0.8), V3(0, 0.02, -0.42)),
  gunCyl(0.09, 0.07, gunMat(0x20261a, 0.5, 0.3), V3(0, -0.2, -0.02), 'x'),
], V3(0.29, -0.26, -0.54), V3(0, 0.02, -0.62));

registerGun('odin', [
  gunBox(0.15, 0.18, 0.64, gunMat(0x2a2c28, 0.5, 0.4)),
  gunCyl(0.035, 0.4, gunMat(0x111214, 0.3, 0.8), V3(0, 0.02, -0.54)),
  gunCyl(0.12, 0.09, gunMat(0x16180f, 0.5, 0.3), V3(0, -0.24, -0.04), 'x'),
  gunBox(0.02, 0.16, 0.02, gunMat(0x111214, 0.5, 0.5), V3(-0.06, -0.12, -0.42), 0.4),
  gunBox(0.02, 0.16, 0.02, gunMat(0x111214, 0.5, 0.5), V3(0.06, -0.12, -0.42), -0.4),
], V3(0.3, -0.27, -0.66), V3(0, 0.02, -0.78));

// ----- melee -----
registerGun('knife', [
  gunBox(0.035, 0.32, 0.05, gunMat(0xcfd6dc, 0.25, 0.9), V3(0, 0.18, 0)),
  gunBox(0.045, 0.14, 0.06, gunMat(0x3a2c20, 0.7, 0.1)),
], V3(0.24, -0.22, -0.4), null);
weaponModels.knife.rotation.x = -0.5;

weaponModels.vandal.visible = true; // matches the default currentWeaponKey below
const SNIPER_KEYS = ['marshal', 'outlaw', 'operator'];

// ----- input / pointer lock --------------------------------------------
const keys = {};
let yaw = 0, pitch = 0;
let locked = false;

document.addEventListener('keydown', (e) => (keys[e.code] = true));
document.addEventListener('keyup', (e) => (keys[e.code] = false));

function clearInputState() {
  for (const key in keys) keys[key] = false;
  mouseDown = false;
}
window.addEventListener('blur', clearInputState);

blocker.addEventListener('click', () => renderer.domElement.requestPointerLock());
document.addEventListener('pointerlockchange', () => {
  locked = document.pointerLockElement === renderer.domElement;
  if (!buyMenuOpen) blocker.classList.toggle('hidden', locked);
  if (!locked) { clearInputState(); setZoom(false); }
});

document.addEventListener('mousemove', (e) => {
  if (!locked) return;
  const sensitivity = zoomed ? 0.0022 * 0.3 : 0.0022;
  yaw -= e.movementX * sensitivity;
  pitch -= e.movementY * sensitivity;
  pitch = Math.max(-Math.PI / 2 + 0.01, Math.min(Math.PI / 2 - 0.01, pitch));
});

// ----- audio (simple synthesized FX, no external assets) ----------------
let audioCtx = null;
function ctx() {
  if (!audioCtx) audioCtx = new (window.AudioContext || window.webkitAudioContext)();
  return audioCtx;
}
function playShot() {
  const c = ctx();
  const osc = c.createOscillator();
  const gain = c.createGain();
  osc.type = 'square';
  osc.frequency.setValueAtTime(180, c.currentTime);
  osc.frequency.exponentialRampToValueAtTime(60, c.currentTime + 0.08);
  gain.gain.setValueAtTime(0.35, c.currentTime);
  gain.gain.exponentialRampToValueAtTime(0.001, c.currentTime + 0.12);
  osc.connect(gain).connect(c.destination);
  osc.start();
  osc.stop(c.currentTime + 0.12);
}
function playDry() {
  const c = ctx();
  const osc = c.createOscillator();
  const gain = c.createGain();
  osc.type = 'triangle';
  osc.frequency.setValueAtTime(400, c.currentTime);
  gain.gain.setValueAtTime(0.2, c.currentTime);
  gain.gain.exponentialRampToValueAtTime(0.001, c.currentTime + 0.05);
  osc.connect(gain).connect(c.destination);
  osc.start();
  osc.stop(c.currentTime + 0.05);
}
function playHit() {
  const c = ctx();
  const osc = c.createOscillator();
  const gain = c.createGain();
  osc.type = 'sine';
  osc.frequency.setValueAtTime(900, c.currentTime);
  gain.gain.setValueAtTime(0.25, c.currentTime);
  gain.gain.exponentialRampToValueAtTime(0.001, c.currentTime + 0.08);
  osc.connect(gain).connect(c.destination);
  osc.start();
  osc.stop(c.currentTime + 0.08);
}

// ----- weapon state -------------------------------------------------------
// fixed up-then-side spray pattern (deg), CS/Valorant-style, shared by the
// two full-auto rifles (applied in shot order instead of pure randomness
// while sustaining automatic fire)
const RIFLE_SPRAY = [
  [0, 0.3], [0, 0.6], [0, 0.9], [0.1, 1.2], [0.3, 1.4],
  [0.6, 1.5], [1.0, 1.4], [1.4, 1.2], [1.7, 0.9], [1.9, 0.6],
  [2.0, 0.3], [2.0, 0.1],
];

// moveSpeedMult scales base walk/sprint speed (heavier guns slow you down,
// like Valorant's hip-fire-vs-weight tradeoff); baseSpreadDeg is the
// inherent hip-fire bullet-spread cone applied to every shot regardless of
// auto-bloom/spray-pattern/pellet spread, so even single-fire guns differ
const WEAPONS = {
  // ----- sidearms -----
  classic: {
    name: 'CLASSIC', melee: false, auto: false,
    magSize: 12, ammo: 12, reserve: 36,
    fireRate: 0.2, reloadTime: 1300, dmgBody: 18, dmgHead: 55, dmgLeg: 12,
    recoil: 0.02, reloading: false, cost: 0,
    moveSpeedMult: 1.0, baseSpreadDeg: 0.15,
  },
  shorty: {
    name: 'SHORTY', melee: false, auto: false,
    magSize: 2, ammo: 2, reserve: 6,
    fireRate: 0.6, reloadTime: 1600, dmgBody: 10, dmgHead: 18, dmgLeg: 7,
    pellets: 5, spreadDeg: 7,
    recoil: 0.05, reloading: false, cost: 200,
    moveSpeedMult: 0.98, baseSpreadDeg: 0.3,
  },
  frenzy: {
    name: 'FRENZY', melee: false, auto: true,
    magSize: 13, ammo: 13, reserve: 39,
    fireRate: 0.1, reloadTime: 1300, dmgBody: 16, dmgHead: 45, dmgLeg: 10,
    recoil: 0.04, reloading: false, cost: 450,
    moveSpeedMult: 1.0, baseSpreadDeg: 0.5,
  },
  ghost: {
    name: 'GHOST', melee: false, auto: false,
    magSize: 15, ammo: 15, reserve: 30,
    fireRate: 0.18, reloadTime: 1300, dmgBody: 20, dmgHead: 78, dmgLeg: 13,
    recoil: 0.025, reloading: false, cost: 500,
    moveSpeedMult: 1.0, baseSpreadDeg: 0.1,
  },
  sheriff: {
    name: 'SHERIFF', melee: false, auto: false,
    magSize: 6, ammo: 6, reserve: 12,
    fireRate: 0.35, reloadTime: 1600, dmgBody: 28, dmgHead: 100, dmgLeg: 18,
    recoil: 0.05, reloading: false, cost: 800,
    moveSpeedMult: 0.97, baseSpreadDeg: 0.2,
  },
  // ----- SMGs -----
  stinger: {
    name: 'STINGER', melee: false, auto: true,
    magSize: 20, ammo: 20, reserve: 60,
    fireRate: 0.08, reloadTime: 1500, dmgBody: 18, dmgHead: 50, dmgLeg: 12,
    recoil: 0.035, reloading: false, cost: 1000,
    moveSpeedMult: 0.96, baseSpreadDeg: 0.6,
    bloomGrowDeg: 0.35, maxSpreadDeg: 2.6,
  },
  spectre: {
    name: 'SPECTRE', melee: false, auto: true,
    magSize: 22, ammo: 22, reserve: 66,
    fireRate: 0.09, reloadTime: 1700, dmgBody: 20, dmgHead: 58, dmgLeg: 13,
    recoil: 0.03, reloading: false, cost: 1600,
    moveSpeedMult: 0.94, baseSpreadDeg: 0.45,
    bloomGrowDeg: 0.3, maxSpreadDeg: 2.3,
  },
  // ----- shotguns -----
  bucky: {
    name: 'BUCKY', melee: false, auto: false,
    magSize: 5, ammo: 5, reserve: 15,
    fireRate: 0.8, reloadTime: 2000, dmgBody: 12, dmgHead: 20, dmgLeg: 9,
    pellets: 10, spreadDeg: 7,
    recoil: 0.08, reloading: false, cost: 850,
    moveSpeedMult: 0.9, baseSpreadDeg: 0.3,
  },
  judge: {
    name: 'JUDGE', melee: false, auto: false,
    magSize: 7, ammo: 7, reserve: 21,
    fireRate: 0.55, reloadTime: 2000, dmgBody: 11, dmgHead: 18, dmgLeg: 8,
    pellets: 9, spreadDeg: 6,
    recoil: 0.07, reloading: false, cost: 1850,
    moveSpeedMult: 0.92, baseSpreadDeg: 0.35,
  },
  // ----- rifles -----
  bulldog: {
    name: 'BULLDOG', melee: false, auto: false,
    magSize: 24, ammo: 24, reserve: 72,
    fireRate: 0.15, reloadTime: 1500, dmgBody: 26, dmgHead: 78, dmgLeg: 17,
    recoil: 0.035, reloading: false, cost: 2050,
    moveSpeedMult: 0.9, baseSpreadDeg: 0.25,
  },
  guardian: {
    name: 'GUARDIAN', melee: false, auto: false,
    magSize: 12, ammo: 12, reserve: 36,
    fireRate: 0.25, reloadTime: 1700, dmgBody: 36, dmgHead: 130, dmgLeg: 24,
    recoil: 0.03, reloading: false, cost: 2250,
    moveSpeedMult: 0.88, baseSpreadDeg: 0.1,
  },
  phantom: {
    name: 'PHANTOM', melee: false, auto: true,
    magSize: 30, ammo: 30, reserve: 90,
    fireRate: 0.1, reloadTime: 1800, dmgBody: 32, dmgHead: 88, dmgLeg: 21,
    recoil: 0.04, reloading: false, cost: 2900,
    bloomGrowDeg: 0.45, maxSpreadDeg: 3.2,
    sprayPattern: RIFLE_SPRAY,
    moveSpeedMult: 0.87, baseSpreadDeg: 0.15,
  },
  vandal: {
    name: 'VANDAL', melee: false, auto: true,
    magSize: 25, ammo: 25, reserve: 75,
    fireRate: 0.12, reloadTime: 1900, dmgBody: 34, dmgHead: 100, dmgLeg: 22,
    recoil: 0.045, reloading: false, cost: 2900,
    bloomGrowDeg: 0.45, maxSpreadDeg: 3.2,
    sprayPattern: RIFLE_SPRAY,
    moveSpeedMult: 0.87, baseSpreadDeg: 0.18,
  },
  // ----- sniper rifles -----
  marshal: {
    name: 'MARSHAL', melee: false, auto: false,
    magSize: 5, ammo: 5, reserve: 15,
    fireRate: 1.1, reloadTime: 1800, dmgBody: 60, dmgHead: 200, dmgLeg: 40,
    recoil: 0.07, reloading: false, cost: 1100,
    moveSpeedMult: 0.85, baseSpreadDeg: 0.03,
  },
  outlaw: {
    name: 'OUTLAW', melee: false, auto: false,
    magSize: 2, ammo: 2, reserve: 6,
    fireRate: 1.3, reloadTime: 2200, dmgBody: 70, dmgHead: 240, dmgLeg: 45,
    recoil: 0.08, reloading: false, cost: 2400,
    moveSpeedMult: 0.83, baseSpreadDeg: 0.05,
  },
  operator: {
    name: 'OPERATOR', melee: false, auto: false,
    magSize: 4, ammo: 4, reserve: 12,
    fireRate: 1.5, reloadTime: 2000, dmgBody: 80, dmgHead: 300, dmgLeg: 50,
    recoil: 0.09, reloading: false, cost: 4700,
    moveSpeedMult: 0.8, baseSpreadDeg: 0.02,
  },
  // ----- heavy -----
  ares: {
    name: 'ARES', melee: false, auto: true,
    magSize: 40, ammo: 40, reserve: 80,
    fireRate: 0.1, reloadTime: 2500, dmgBody: 22, dmgHead: 65, dmgLeg: 15,
    recoil: 0.05, reloading: false, cost: 1600,
    moveSpeedMult: 0.78, baseSpreadDeg: 0.5,
    bloomGrowDeg: 0.3, maxSpreadDeg: 3.0,
  },
  odin: {
    name: 'ODIN', melee: false, auto: true,
    magSize: 60, ammo: 60, reserve: 120,
    fireRate: 0.08, reloadTime: 3000, dmgBody: 24, dmgHead: 70, dmgLeg: 16,
    recoil: 0.055, reloading: false, cost: 3200,
    moveSpeedMult: 0.72, baseSpreadDeg: 0.7,
    bloomGrowDeg: 0.35, maxSpreadDeg: 3.6,
  },
  // ----- melee -----
  knife: {
    name: 'KNIFE', melee: true, auto: false,
    range: 2.4, fireRate: 0.45, dmgBody: 60, dmgHead: 60, dmgLeg: 60,
    recoil: 0, reloading: false, cost: 0,
    moveSpeedMult: 1.05, baseSpreadDeg: 0,
  },
};

const ARMOR_TIERS = { light: { cost: 400, value: 25 }, heavy: { cost: 1000, value: 50 } };
const STARTING_CREDITS = 800;
const KILL_REWARD = 200;
const ROUND_WIN_REWARD = 3000;
const ROUND_LOSS_REWARD = 1900;
const ROUND_LOSS_STEP = 500; // +500 per consecutive loss, capped at 3 losses in a row
const CREDIT_CAP = 9000;
const ROUNDS_PER_HALF = 12; // sides swap after round 12; round 13 starts the second half
const ROUNDS_TO_WIN_MATCH = 13; // first to 13 round wins takes the match
const MAX_REGULAR_ROUNDS = 24; // round 25 is a single overtime round if still tied 12-12
const OVERTIME_CREDITS = 5000;
const BUY_PHASE_SECONDS = 30;
const PISTOL_BUY_PHASE_SECONDS = 45; // round 1 / round 13 (and the overtime round) get extra time
const ROUND_PREP_SECONDS = 7; // pause after the round is decided, before the next buy phase

let gameMode = 'range';
// 사격장(range)은 에임 연습이라 무한탄, 1대1 경쟁전(duel)/5vs5 섬멸전(squad)은
// 둘 다 같은 라운드제 크레딧 경제를 쓰는 "매치" 모드라 진짜 탄약/재장전이 의미 있게 작동
function infiniteAmmo() { return gameMode === 'range'; }
function isMatchMode() { return gameMode === 'duel' || gameMode === 'squad'; }
const WEAPON_DEFAULTS = JSON.parse(JSON.stringify(WEAPONS));

let currentWeaponKey = 'vandal';
let fireCooldown = 0;

function currentWeapon() {
  return WEAPONS[currentWeaponKey];
}

function updateAmmoHud() {
  const w = currentWeapon();
  hud.weaponName.textContent = w.name;
  if (w.melee || infiniteAmmo()) {
    hud.ammo.textContent = '∞';
    hud.reserve.textContent = '-';
  } else {
    hud.ammo.textContent = w.ammo;
    hud.reserve.textContent = w.reserve;
  }
}

function setWeapon(key) {
  if (!WEAPONS[key] || key === currentWeaponKey) return;
  currentWeaponKey = key;
  fireCooldown = 0.15;
  kickTimer = 0;
  weaponBloom = 0;
  weaponShotCount = 0;
  inspectTimer = 0;
  const slot = slotOf(key);
  if (slot) lastEquippedInSlot[slot] = key;
  for (const k in weaponModels) weaponModels[k].visible = k === key;
  updateAmmoHud();
  if (!SNIPER_KEYS.includes(key)) setZoom(false);
}

// weapon categories à la Valorant: slot 1 cycles primaries (SMG/shotgun/
// rifle/sniper/heavy), slot 2 is the sidearm, slot 3 is melee
const WEAPON_SLOTS = {
  primary: ['stinger', 'spectre', 'bucky', 'judge', 'bulldog', 'guardian', 'phantom', 'vandal', 'marshal', 'outlaw', 'operator', 'ares', 'odin'],
  secondary: ['classic', 'shorty', 'frenzy', 'ghost', 'sheriff'],
  melee: ['knife'],
};
// duel mode gates weapons behind the buy menu like Valorant's economy: you
// only start owning the classic pistol + knife and must buy everything else.
// range mode (aim practice) keeps every weapon unlocked since there's no economy
let ownedWeapons = new Set(['classic', 'knife']);

function slotOf(key) {
  for (const slotKey in WEAPON_SLOTS) {
    if (WEAPON_SLOTS[slotKey].includes(key)) return slotKey;
  }
  return null;
}
const lastEquippedInSlot = { primary: null, secondary: null, melee: 'knife' };

// Valorant has one equipped weapon per slot (no cycling among owned guns) —
// 1/2/3 re-equips whichever weapon you most recently had active in that
// slot (falling back to the first owned weapon if you never equipped one
// this life), instead of always jumping to a fixed-priority weapon — e.g.
// owning both Phantom and Vandal shouldn't force Phantom every time you
// press 1, and a purchased sidearm other than Classic must stay reachable
// via 2 even though Classic is always owned.
function pickSlot(slotKey) {
  const list = isMatchMode() ? WEAPON_SLOTS[slotKey].filter((k) => ownedWeapons.has(k)) : WEAPON_SLOTS[slotKey];
  if (list.length === 0) return;
  const preferred = lastEquippedInSlot[slotKey];
  setWeapon(preferred && list.includes(preferred) ? preferred : list[0]);
}

document.addEventListener('keydown', (e) => {
  if (e.code === 'Digit1') pickSlot('primary');
  if (e.code === 'Digit2') pickSlot('secondary');
  if (e.code === 'Digit3') pickSlot('melee');
});

updateAmmoHud();

// ----- buy menu (B): swap any equipped slot's weapon, Valorant/Rivals style -
const buyMenu = document.getElementById('buyMenu');
const buyButtons = document.querySelectorAll('.buyBtn');
let buyMenuOpen = false;

function refreshBuyMenu() {
  const unlimitedCredits = !isMatchMode();
  hud.buyCredits.textContent = unlimitedCredits ? '무제한' : playerCredits;
  for (const btn of buyButtons) {
    const weaponKey = btn.dataset.weapon;
    const armorKey = btn.dataset.armor;
    const costEl = btn.querySelector('.buyCost');
    if (weaponKey) {
      const owned = ownedWeapons.has(weaponKey);
      const cost = WEAPONS[weaponKey].cost;
      if (costEl) costEl.textContent = owned ? '보유중' : cost > 0 ? `${cost} CR` : 'FREE';
      btn.classList.toggle('unaffordable', !unlimitedCredits && !owned && cost > playerCredits);
      btn.classList.toggle('active', weaponKey === currentWeaponKey);
    } else if (armorKey) {
      const tier = ARMOR_TIERS[armorKey];
      if (costEl) costEl.textContent = `${tier.cost} CR`;
      btn.classList.toggle('unaffordable', !unlimitedCredits && tier.cost > playerCredits);
      btn.classList.toggle('active', playerArmor === tier.value);
    }
  }
}

function toggleBuyMenu(force) {
  if (gameOver) return;
  buyMenuOpen = force !== undefined ? force : !buyMenuOpen;
  buyMenu.classList.toggle('hidden', !buyMenuOpen);
  if (buyMenuOpen) {
    setZoom(false);
    document.exitPointerLock();
    refreshBuyMenu();
  } else {
    renderer.domElement.requestPointerLock();
  }
}

document.addEventListener('keydown', (e) => {
  if (e.code === 'KeyB') toggleBuyMenu();
});

// ----- buy phase: countdown before each duel round, like Unity GameManager ---
let buyPhaseActive = false;
let buyPhaseTimer = 0;
let buyPhaseCallback = null;

function startBuyPhase(callback, seconds) {
  buyPhaseActive = true;
  buyPhaseTimer = seconds || BUY_PHASE_SECONDS;
  buyPhaseCallback = callback;
  toggleBuyMenu(true);
}

function updateBuyPhase(dt) {
  if (!buyPhaseActive) return;
  buyPhaseTimer -= dt;
  hud.round.textContent = `다음 라운드까지 ${Math.max(0, Math.ceil(buyPhaseTimer))}s`;
  if (buyPhaseTimer <= 0) {
    buyPhaseActive = false;
    toggleBuyMenu(false);
    updateRoundHud();
    const cb = buyPhaseCallback;
    buyPhaseCallback = null;
    if (cb) cb();
  }
}

for (const btn of buyButtons) {
  btn.addEventListener('click', (e) => {
    e.stopPropagation();
    // 사격장은 무기 연습용이라 크레드 제한 없이 아무 무기/방어구나 바로 받을 수 있다
    const unlimitedCredits = !isMatchMode();
    const weaponKey = btn.dataset.weapon;
    const armorKey = btn.dataset.armor;
    if (weaponKey) {
      const alreadyOwned = ownedWeapons.has(weaponKey);
      const cost = alreadyOwned ? 0 : WEAPONS[weaponKey].cost;
      if (!unlimitedCredits && cost > playerCredits) return;
      if (!unlimitedCredits) playerCredits -= cost;
      ownedWeapons.add(weaponKey);
      setWeapon(weaponKey);
      updateCreditsHud();
      refreshBuyMenu();
    } else if (armorKey) {
      const tier = ARMOR_TIERS[armorKey];
      if (tier.value <= playerArmor) return;
      if (!unlimitedCredits && tier.cost > playerCredits) return;
      if (!unlimitedCredits) playerCredits -= tier.cost;
      playerArmor = tier.value;
      updateCreditsHud();
      updateArmorHud();
      refreshBuyMenu();
    }
  });
}

// ----- sniper scope zoom (right click) -------------------------------------
let zoomed = false;
const DEFAULT_FOV = camera.fov;
const SNIPER_ZOOM_FOV = 18;
function setZoom(on) {
  if (on === zoomed) return;
  zoomed = on;
  camera.fov = zoomed ? SNIPER_ZOOM_FOV : DEFAULT_FOV;
  camera.updateProjectionMatrix();
  hud.scopeOverlay.classList.toggle('show', zoomed);
  hud.crosshair.classList.toggle('zoomed', zoomed);
}
document.addEventListener('mousedown', (e) => {
  if (e.button === 2 && locked && SNIPER_KEYS.includes(currentWeaponKey)) setZoom(true);
});
document.addEventListener('mouseup', (e) => {
  if (e.button === 2) setZoom(false);
});

function reload() {
  if (!locked || infiniteAmmo()) return;
  const w = currentWeapon();
  if (w.melee || w.reloading || w.ammo === w.magSize || w.reserve <= 0) return;
  w.reloading = true;
  setTimeout(() => {
    const need = w.magSize - w.ammo;
    const take = Math.min(need, w.reserve);
    w.ammo += take;
    w.reserve -= take;
    w.reloading = false;
    if (w === currentWeapon()) updateAmmoHud();
  }, w.reloadTime);
}

// recoil / view-kick state
let recoilPitch = 0;
let recoilYaw = 0;
let kickTimer = 0;
let kickBaseZ = 0;
let weaponBloom = 0; // grows with sustained auto-fire, decays when not firing
let weaponShotCount = 0; // resets when firing stops; drives sprayPattern index

// V-key weapon inspect: a brief non-combat flourish, blocked while reloading
const INSPECT_DURATION = 1.1;
let inspectTimer = 0;
document.addEventListener('keydown', (e) => {
  if (e.code === 'KeyV' && locked && inspectTimer <= 0 && !currentWeapon().reloading) {
    inspectTimer = INSPECT_DURATION;
  }
});

const raycaster = new THREE.Raycaster();
const shootables = () => targets.flatMap((t) => [t.userData.body, t.userData.head, t.userData.leg]);

let mouseDown = false;
document.addEventListener('mousedown', (e) => {
  if (e.button === 0 && locked) {
    mouseDown = true;
    tryShoot();
  }
});
document.addEventListener('mouseup', (e) => { if (e.button === 0) { mouseDown = false; weaponShotCount = 0; } });
document.addEventListener('keydown', (e) => { if (e.code === 'KeyR') reload(); });
document.addEventListener('contextmenu', (e) => e.preventDefault());

function tryShoot() {
  if (gameOver) return;
  const w = currentWeapon();
  if (fireCooldown > 0 || w.reloading || inspectTimer > 0) return;

  if (!w.melee && !infiniteAmmo()) {
    if (w.ammo <= 0) { playDry(); return; }
    w.ammo--;
    updateAmmoHud();
  }
  fireCooldown = w.fireRate;
  if (w.auto) {
    weaponBloom = Math.min(w.maxSpreadDeg || 0, weaponBloom + (w.bloomGrowDeg || 0));
    weaponShotCount++;
  }
  playShot();

  // visual recoil + camera kick
  recoilPitch += w.recoil;
  recoilYaw += (Math.random() - 0.5) * w.recoil * 0.45;
  const activeWeapon = weaponModels[currentWeaponKey];
  const baseZ = weaponRestZ[currentWeaponKey];
  activeWeapon.position.z = baseZ + 0.1;
  kickTimer = 0.08;
  kickBaseZ = baseZ;

  // muzzle flash
  const muzzle = weaponMuzzles[currentWeaponKey];
  if (muzzle) {
    muzzle.light.intensity = 4;
    muzzle.sprite.material.opacity = 1;
  }

  hud.crosshair.classList.add('shoot');
  setTimeout(() => hud.crosshair.classList.remove('shoot'), 60);

  // raycast from camera center (pellet weapons fire multiple raycasts with spread)
  const range = w.melee ? w.range : 100;
  const shotCount = w.pellets || 1;
  let anyHit = false;
  const damageByTarget = new Map();
  const headshotByTarget = new Map();
  for (let i = 0; i < shotCount; i++) {
    let ndcX = 0, ndcY = 0;
    // every gun has some inherent hip-fire inaccuracy on top of its
    // pellet-cone/spray-pattern/bloom mechanics, scaled per weapon
    const base = (w.baseSpreadDeg || 0) * Math.PI / 180;
    if (base > 0) {
      ndcX += (Math.random() - 0.5) * base;
      ndcY += (Math.random() - 0.5) * base;
    }
    if (w.pellets) {
      const spread = (w.spreadDeg * Math.PI / 180);
      ndcX += (Math.random() - 0.5) * spread;
      ndcY += (Math.random() - 0.5) * spread;
    } else if (w.auto && w.sprayPattern && w.sprayPattern.length > 0) {
      // fixed recoil-pattern climb (CS/Valorant-style) instead of pure
      // randomness, indexed by how many shots have landed this burst
      const idx = Math.min(weaponShotCount - 1, w.sprayPattern.length - 1);
      const [yawDeg, pitchDeg] = w.sprayPattern[Math.max(0, idx)];
      ndcX += yawDeg * Math.PI / 180;
      ndcY += pitchDeg * Math.PI / 180;
    } else if (w.auto && weaponBloom > 0) {
      const spread = (weaponBloom * Math.PI / 180);
      ndcX += (Math.random() - 0.5) * spread;
      ndcY += (Math.random() - 0.5) * spread;
    }
    raycaster.setFromCamera(new THREE.Vector2(ndcX, ndcY), camera);
    raycaster.far = range;
    // include level colliders so walls/cover block shots instead of being
    // transparent to hitscan (previously only target meshes were tested)
    const hits = raycaster.intersectObjects(colliders.concat(shootables()), false);
    if (hits.length > 0) {
      const hit = hits[0];
      const target = targets.find((t) => t.userData.body === hit.object || t.userData.head === hit.object || t.userData.leg === hit.object);
      if (target && target.userData.alive) {
        anyHit = true;
        const headshot = hit.object === target.userData.head;
        const legshot = hit.object === target.userData.leg;
        if (headshot) headshotByTarget.set(target, true);
        // headshots are always a guaranteed kill, regardless of weapon/range falloff
        const dmg = headshot ? target.userData.hp : legshot ? (w.dmgLeg != null ? w.dmgLeg : w.dmgBody) : w.dmgBody;
        damageByTarget.set(target, (damageByTarget.get(target) || 0) + dmg);
      }
    }
  }
  raycaster.far = Infinity;

  if (anyHit) {
    playHit();
    hud.hitmarker.classList.add('show');
    setTimeout(() => hud.hitmarker.classList.remove('show'), 90);
    for (const [target, dmg] of damageByTarget) {
      target.userData.hp -= dmg;
      updateTargetHealthBar(target);
      if (target.userData.hp <= 0) killTarget(target, headshotByTarget.get(target) || false);
    }
  }
}

function killTarget(target, headshot, silent) {
  target.userData.alive = false;
  scene.remove(target);
  scene.remove(target.userData.healthBar);
  targets.splice(targets.indexOf(target), 1);
  if (!silent) {
    addKillFeed(headshot ? '헤드샷 ✕' : '제거 ✕');
    if (isMatchMode()) {
      playerKills++;
      playerCredits = Math.min(CREDIT_CAP, playerCredits + KILL_REWARD);
      updateCreditsHud();
      checkRoundEnd();
    } else {
      checkWaveClear();
    }
  }
}

// ----- game modes: 사격장(range) clears waves of weak dummies for points.
// 1대1 경쟁전(duel)과 5vs5 섬멸전(squad)은 같은 발로란트식 라운드/크레딧 경제를
// 공유한다 — 25라운드(전/후반 12라운드씩), 13승 선취 시 매치 승리, 12라운드
// 종료 후 진영/크레딧 초기화, 24라운드까지도 12-12면 단판 연장. duel은 적이
// 1명, squad는 적이 5명이며 둘 다 "적 전멸 = 라운드 승리"로 판정한다 -------
const ROUNDS_TO_WIN = 5; // 사격장(range) wave-clear target, unrelated to match modes
let roundScore = 0;
let roundTransition = false;

let roundNumber = 1;
let teamScore = 0;
let enemyScore = 0;
let lossStreak = 0;
let isSecondHalf = false;
let inOvertime = false;
let matchTransition = false;
let playerKills = 0;
let playerDeaths = 0;
// the enemy team's credits aren't simulated per-bot — mirrored symmetrically
// from the same win/loss rewards the player would get, so the scoreboard can
// show a plausible "적 팀 보유 크레딧" without modeling 5 separate AI wallets
let enemyCredits = STARTING_CREDITS;

function isPistolRound(n) {
  return n === 1 || n === ROUNDS_PER_HALF + 1 || n > MAX_REGULAR_ROUNDS;
}

function updateRoundHud() {
  if (isMatchMode()) {
    hud.round.textContent = inOvertime
      ? `연장 라운드 · YOU ${teamScore} - ${enemyScore} ENEMY`
      : `R${roundNumber} · YOU ${teamScore} - ${enemyScore} ENEMY`;
  } else {
    hud.round.textContent = `ROUND ${roundScore}/${ROUNDS_TO_WIN}`;
  }
}

// ----- Tab scoreboard: KDA, credits, weapon — 적 팀 크레딧은 라운드 시작
// 시점에 갱신된 enemyCredits 값을 그대로 보여준다(실제 명세처럼 라운드 중
// 적 구매 내역까지는 추적하지 않음) -------------------------------------
const scoreboardEl = document.getElementById('scoreboard');
const scoreTitleEl = document.getElementById('scoreTitle');
const sbKDEl = document.getElementById('sbKD');
const sbCreditsEl = document.getElementById('sbCredits');
const sbWeaponEl = document.getElementById('sbWeapon');
const sbEnemyListEl = document.getElementById('sbEnemyList');
let scoreboardOpen = false;

function updateScoreboard() {
  if (!isMatchMode()) {
    scoreTitleEl.textContent = `사격장 · 클리어 ${roundScore}/${ROUNDS_TO_WIN}`;
  } else {
    scoreTitleEl.textContent = inOvertime
      ? `연장 라운드 · YOU ${teamScore} - ${enemyScore} ENEMY`
      : `R${roundNumber} · YOU ${teamScore} - ${enemyScore} ENEMY`;
  }
  sbKDEl.textContent = `${playerKills}K / ${playerDeaths}D`;
  sbCreditsEl.textContent = `${playerCredits} CR`;
  sbWeaponEl.textContent = currentWeapon().name;

  sbEnemyListEl.innerHTML = '';
  const aliveCount = targets.filter((t) => t.userData.isDuelist).length;
  const totalCount = gameMode === 'squad' ? 5 : 1;
  for (let i = 0; i < totalCount; i++) {
    const row = document.createElement('div');
    row.className = 'scoreRow';
    const alive = i < aliveCount;
    row.innerHTML = `<span>적 ${i + 1}</span><span>${alive ? '생존' : '사망'}</span><span>${enemyCredits} CR</span>`;
    sbEnemyListEl.appendChild(row);
  }
}

document.addEventListener('keydown', (e) => {
  if (e.code === 'Tab') {
    e.preventDefault();
    if (!scoreboardOpen) {
      scoreboardOpen = true;
      scoreboardEl.classList.remove('hidden');
      updateScoreboard();
    }
  }
});
document.addEventListener('keyup', (e) => {
  if (e.code === 'Tab') {
    scoreboardOpen = false;
    scoreboardEl.classList.add('hidden');
  }
});

function checkWaveClear() {
  if (roundTransition || gameOver || targets.length > 0) return;
  roundTransition = true;
  roundScore++;
  updateRoundHud();
  addKillFeed(`라운드 클리어 ${roundScore}/${ROUNDS_TO_WIN}`);
  if (roundScore >= ROUNDS_TO_WIN) {
    setTimeout(winGame, 600);
  } else {
    setTimeout(() => {
      roundTransition = false;
      for (let i = 0; i < 4; i++) spawnRandomTarget();
    }, 1200);
  }
}

// spawn the right number of enemies for a fresh match-mode round
function spawnRoundOpponents() {
  const count = gameMode === 'squad' ? 5 : 1;
  for (let i = 0; i < count; i++) spawnDuelOpponent();
}

function checkRoundEnd() {
  if (matchTransition || gameOver || targets.length > 0) return;
  awardRoundResult('player');
}

function awardRoundResult(winner) {
  if (matchTransition || gameOver) return;
  matchTransition = true;
  if (winner === 'player') {
    teamScore++;
    lossStreak = 0;
    playerCredits = Math.min(CREDIT_CAP, playerCredits + ROUND_WIN_REWARD);
    enemyCredits = Math.min(CREDIT_CAP, enemyCredits + ROUND_LOSS_REWARD);
    addKillFeed(`라운드 승리! ${teamScore}-${enemyScore}`);
    showKillBanner('YOU', 'ENEMY');
  } else {
    enemyScore++;
    playerDeaths++;
    lossStreak = Math.min(lossStreak + 1, 3);
    playerCredits = Math.min(CREDIT_CAP, playerCredits + ROUND_LOSS_REWARD + (lossStreak - 1) * ROUND_LOSS_STEP);
    enemyCredits = Math.min(CREDIT_CAP, enemyCredits + ROUND_WIN_REWARD);
    addKillFeed(`라운드 패배... ${teamScore}-${enemyScore}`);
    showKillBanner('ENEMY', 'YOU');
  }
  updateCreditsHud();
  updateRoundHud();

  if (teamScore >= ROUNDS_TO_WIN_MATCH) { setTimeout(winGame, 600); return; }
  if (enemyScore >= ROUNDS_TO_WIN_MATCH) { setTimeout(loseDuel, 600); return; }
  if (inOvertime) {
    // overtime is sudden-death — any decisive round result ends the match
    setTimeout(teamScore > enemyScore ? winGame : loseDuel, 600);
    return;
  }

  setTimeout(startNextRound, ROUND_PREP_SECONDS * 1000);
}

function startNextRound() {
  if (gameOver) return;
  matchTransition = false;
  roundNumber++;

  if (roundNumber > MAX_REGULAR_ROUNDS && teamScore === enemyScore) {
    inOvertime = true;
  }
  const pistol = isPistolRound(roundNumber);
  // 12라운드/24라운드(전·후반 마지막 라운드) 종료 후, 그리고 연장 라운드 진입
  // 시에는 진영이 바뀐 것처럼 무기 소지 효력이 사라져 다시 사야 한다
  if (pistol) {
    if (roundNumber === ROUNDS_PER_HALF + 1) isSecondHalf = true;
    playerCredits = inOvertime ? OVERTIME_CREDITS : STARTING_CREDITS;
    enemyCredits = playerCredits;
    lossStreak = 0;
    ownedWeapons = new Set(['classic', 'knife']);
    currentWeaponKey = 'knife';
    setWeapon('classic');
  }

  playerHp = PLAYER_MAX_HP;
  playerArmor = 0;
  updateHealthHud();
  updateArmorHud();
  updateCreditsHud();
  refillAmmo();
  abilityCooldown = 0;
  updateAbilityHud();
  updateRoundHud();
  startBuyPhase(spawnRoundOpponents, pistol ? PISTOL_BUY_PHASE_SECONDS : BUY_PHASE_SECONDS);
}

function winGame() {
  gameOver = true;
  mouseDown = false;
  document.exitPointerLock();
  blockerTitle.textContent = 'VICTORY';
  blockerSub.textContent = isMatchMode()
    ? `${teamScore}승으로 매치 승리! (${teamScore}-${enemyScore}) 클릭해서 다시 시작`
    : `${ROUNDS_TO_WIN}라운드 클리어! 클릭해서 다시 시작`;
  blocker.classList.remove('hidden');
}

let killBannerTimer = null;
function showKillBanner(killer, victim) {
  hud.killBanner.textContent = `${killer}  ▶  ${victim}`;
  hud.killBanner.classList.add('show');
  clearTimeout(killBannerTimer);
  killBannerTimer = setTimeout(() => hud.killBanner.classList.remove('show'), 2000);
}

function addKillFeed(text) {
  const el = document.createElement('div');
  el.textContent = text;
  el.style.opacity = '1';
  el.style.transition = 'opacity .6s';
  hud.killfeed.appendChild(el);
  setTimeout(() => (el.style.opacity = '0'), 1200);
  setTimeout(() => el.remove(), 1900);
}

// ----- player movement / simple collision -------------------------------
const velocity = new THREE.Vector3();
const PLAYER_RADIUS = 0.5;
let canJump = true;
let verticalVelocity = 0;
let lavaTickTimer = 0;
const GRAVITY = 24;
const JUMP_SPEED = 8.2;

function collidesAt(x, z) {
  const half = PLAYER_RADIUS;
  for (const mesh of colliders) {
    const box = new THREE.Box3().setFromObject(mesh);
    if (x + half > box.min.x && x - half < box.max.x && z + half > box.min.z && z - half < box.max.z) {
      return true;
    }
  }
  return false;
}

let headBobTime = 0;

// ----- player health -------------------------------------------------------
const PLAYER_MAX_HP = 150;
let playerHp = PLAYER_MAX_HP;
let playerArmor = 0;
const ARMOR_DAMAGE_REDUCTION = 0.5;
let gameOver = false;

function updateHealthHud() {
  hud.hp.textContent = Math.max(0, Math.round(playerHp));
  hud.healthbarFill.style.width = `${Math.max(0, (playerHp / PLAYER_MAX_HP) * 100)}%`;
}
updateHealthHud();

function updateArmorHud() {
  hud.armor.textContent = Math.max(0, Math.round(playerArmor));
  hud.armorLine.classList.toggle('hidden', !isMatchMode());
}
updateArmorHud();

let playerCredits = STARTING_CREDITS;
function updateCreditsHud() {
  hud.credits.textContent = playerCredits;
  hud.buyCredits.textContent = playerCredits;
  hud.creditsLine.classList.toggle('hidden', !isMatchMode());
}
updateCreditsHud();

function damagePlayer(amount) {
  if (gameOver) return;
  let final = amount;
  if (playerArmor > 0) {
    let absorbed = Math.round(amount * ARMOR_DAMAGE_REDUCTION);
    absorbed = Math.min(absorbed, playerArmor);
    final = Math.max(0, amount - absorbed);
    playerArmor -= absorbed;
    updateArmorHud();
  }
  playerHp = Math.max(0, playerHp - final);
  updateHealthHud();
  hud.flash.classList.add('show');
  setTimeout(() => hud.flash.classList.remove('show'), 120);
  if (playerHp <= 0) killPlayer();
}

function killPlayer() {
  if (isMatchMode()) {
    // no simulated teammates yet, so the player going down counts as the
    // whole team being wiped — matches the "적 팀 전멸" win condition in
    // reverse, since the player is the only combatant on their side
    yawObject.position.set(...spawnPoint());
    for (const target of targets.slice()) killTarget(target, false, true);
    awardRoundResult('enemy');
    return;
  }
  gameOver = true;
  mouseDown = false;
  document.exitPointerLock();
  blockerTitle.textContent = 'YOU DIED';
  blockerSub.textContent = '클릭해서 다시 시작';
  blocker.classList.remove('hidden');
}

function loseDuel() {
  gameOver = true;
  mouseDown = false;
  document.exitPointerLock();
  blockerTitle.textContent = 'DEFEAT';
  blockerSub.textContent = `${enemyScore}승으로 매치 패배... (${teamScore}-${enemyScore}) 클릭해서 다시 시작`;
  blocker.classList.remove('hidden');
}

function refillAmmo() {
  for (const key in WEAPONS) {
    const w = WEAPONS[key];
    if (!w.melee) { w.ammo = WEAPON_DEFAULTS[key].magSize; w.reserve = WEAPON_DEFAULTS[key].reserve; }
    w.reloading = false;
  }
  updateAmmoHud();
}

function startMatch() {
  for (const target of targets.slice()) killTarget(target, false, true);
  refillAmmo();
  abilityCooldown = 0;
  clearAbilityEffects();
  updateAbilityHud();
  if (isMatchMode()) {
    roundNumber = 1;
    teamScore = 0;
    enemyScore = 0;
    lossStreak = 0;
    isSecondHalf = false;
    inOvertime = false;
    matchTransition = false;
    playerKills = 0;
    playerDeaths = 0;
    playerArmor = 0;
    playerCredits = STARTING_CREDITS;
    enemyCredits = STARTING_CREDITS;
    ownedWeapons = new Set(['classic', 'knife']);
    currentWeaponKey = 'knife'; // force setWeapon below to actually switch
    setWeapon('classic');
    updateArmorHud();
    updateCreditsHud();
    updateRoundHud();
    spawnRoundOpponents();
  } else {
    roundScore = 0;
    roundTransition = false;
    playerArmor = 0;
    updateArmorHud();
    updateCreditsHud();
    updateRoundHud();
    for (let i = 0; i < 4; i++) spawnRandomTarget();
  }
}

function respawnPlayer() {
  playerHp = PLAYER_MAX_HP;
  gameOver = false;
  yawObject.position.set(...spawnPoint());
  verticalVelocity = 0;
  updateHealthHud();
  blockerTitle.textContent = '1FPS';
  blockerSub.textContent = '클릭해서 게임 시작 (마우스 잠금)';
  startMatch();
}

blocker.addEventListener('click', () => {
  if (gameOver) respawnPlayer();
});

// ----- map selection ----------------------------------------------------
const mapButtons = document.querySelectorAll('.mapBtn');
function selectMap(key) {
  if (!MAPS[key] || key === currentMapKey) return;
  buildLevel(key);
  yawObject.position.set(...spawnPoint());
  startMatch();
  for (const btn of mapButtons) btn.classList.toggle('active', btn.dataset.map === key);
}
for (const btn of mapButtons) {
  btn.addEventListener('click', (e) => {
    e.stopPropagation();
    selectMap(btn.dataset.map);
  });
}
for (const btn of mapButtons) btn.classList.toggle('active', btn.dataset.map === currentMapKey);

// ----- mode selection -----------------------------------------------------
const modeButtons = document.querySelectorAll('.modeBtn');
function selectMode(mode) {
  if (mode === gameMode) return;
  gameMode = mode;
  startMatch();
  for (const btn of modeButtons) btn.classList.toggle('active', btn.dataset.mode === mode);
}
for (const btn of modeButtons) {
  btn.addEventListener('click', (e) => {
    e.stopPropagation();
    selectMode(btn.dataset.mode);
  });
}
for (const btn of modeButtons) btn.classList.toggle('active', btn.dataset.mode === gameMode);

function updateMovement(dt) {
  const forward = (keys['KeyW'] ? 1 : 0) - (keys['KeyS'] ? 1 : 0);
  const strafe = (keys['KeyD'] ? 1 : 0) - (keys['KeyA'] ? 1 : 0);
  const sprinting = keys['ShiftLeft'] || keys['ShiftRight'];
  const speed = (sprinting ? 7.5 : 4.6) * (currentWeapon().moveSpeedMult ?? 1);

  const dir = new THREE.Vector3(strafe, 0, -forward);
  const moving = dir.lengthSq() > 0;
  if (moving) dir.normalize();
  dir.applyAxisAngle(new THREE.Vector3(0, 1, 0), yaw);

  const nextX = yawObject.position.x + dir.x * speed * dt;
  const nextZ = yawObject.position.z + dir.z * speed * dt;
  if (!collidesAt(nextX, yawObject.position.z)) yawObject.position.x = nextX;
  if (!collidesAt(yawObject.position.x, nextZ)) yawObject.position.z = nextZ;

  // lava hazard damage (onyx map)
  if (hazardAt(yawObject.position.x, yawObject.position.z)) {
    lavaTickTimer -= dt;
    if (lavaTickTimer <= 0) {
      lavaTickTimer = 0.5;
      damagePlayer(8);
    }
  } else {
    lavaTickTimer = 0;
  }

  // jump / gravity
  if (keys['Space'] && canJump) {
    verticalVelocity = JUMP_SPEED;
    canJump = false;
  }
  verticalVelocity -= GRAVITY * dt;
  yawObject.position.y += verticalVelocity * dt;
  if (yawObject.position.y <= 1.7) {
    yawObject.position.y = 1.7;
    verticalVelocity = 0;
    canJump = true;
  }

  // head bob
  if (moving && canJump) {
    headBobTime += dt * (sprinting ? 14 : 9);
    pitchObject.position.y = Math.sin(headBobTime) * 0.035;
    camera.position.x = Math.cos(headBobTime / 2) * 0.02;
  } else {
    pitchObject.position.y *= 0.85;
    camera.position.x *= 0.85;
  }
}

function updateRecoilRecovery(dt) {
  weaponBloom = Math.max(0, weaponBloom - dt * 3);
  recoilPitch *= Math.max(0, 1 - dt * 8);
  recoilYaw *= Math.max(0, 1 - dt * 8);
  pitchObject.rotation.x = pitch + recoilPitch;
  yawObject.rotation.y = yaw + recoilYaw;

  const activeWeapon = weaponModels[currentWeaponKey];
  if (kickTimer > 0) {
    kickTimer -= dt;
    activeWeapon.position.z = kickBaseZ + 0.1 * (kickTimer / 0.08);
  } else {
    activeWeapon.position.z = kickBaseZ;
  }

  if (inspectTimer > 0) {
    inspectTimer = Math.max(0, inspectTimer - dt);
    const wobble = Math.sin((1 - inspectTimer / INSPECT_DURATION) * Math.PI);
    activeWeapon.rotation.y = wobble * 0.5;
    activeWeapon.rotation.x = wobble * 0.25;
  } else {
    activeWeapon.rotation.y = 0;
    activeWeapon.rotation.x = 0;
  }

  for (const key in weaponMuzzles) {
    const muzzle = weaponMuzzles[key];
    if (!muzzle) continue;
    muzzle.light.intensity *= Math.max(0, 1 - dt * 18);
    muzzle.sprite.material.opacity *= Math.max(0, 1 - dt * 18);
  }
}

function updateHazards(t) {
  for (const h of currentHazards) {
    if (h.mesh) h.mesh.material.emissiveIntensity = 1.0 + Math.sin(t * 3) * 0.3;
  }
}

function updateTargets(dt, t) {
  for (const target of targets) {
    target.userData.t += dt;
    // duelist movement is driven entirely by updateTargetAI; range dummies
    // just sway gently in place for a readable, stationary practice target
    if (!target.userData.isDuelist) {
      target.position.x += Math.sin(target.userData.t * 0.6) * dt * 0.4;
    }
    target.position.y = 0;
    target.userData.healthBar.position.x = target.position.x;
    target.userData.healthBar.position.z = target.position.z;
  }
}

function playEnemyShot() {
  const c = ctx();
  const osc = c.createOscillator();
  const gain = c.createGain();
  osc.type = 'sawtooth';
  osc.frequency.setValueAtTime(140, c.currentTime);
  osc.frequency.exponentialRampToValueAtTime(50, c.currentTime + 0.1);
  gain.gain.setValueAtTime(0.16, c.currentTime);
  gain.gain.exponentialRampToValueAtTime(0.001, c.currentTime + 0.14);
  osc.connect(gain).connect(c.destination);
  osc.start();
  osc.stop(c.currentTime + 0.14);
}

const aiRaycaster = new THREE.Raycaster();

function hasLineOfSight(from, to) {
  const dir = new THREE.Vector3().subVectors(to, from);
  const dist = dir.length();
  dir.normalize();
  aiRaycaster.set(from, dir);
  aiRaycaster.far = dist;
  const hits = aiRaycaster.intersectObjects(colliders, false);
  return hits.length === 0;
}

function updateTargetAI(dt) {
  if (gameOver) return;
  // 사격장(range) bots are pure aim-practice dummies and never shoot back —
  // only the 1대1 AI 대결(duel) opponent fights, and now actually maneuvers:
  // closes distance when out of range/sight, strafes side-to-side while
  // trading shots, and breaks off to create space when low on hp
  if (!isMatchMode()) return;
  const playerPos = new THREE.Vector3();
  camera.getWorldPosition(playerPos);

  for (const target of targets) {
    if (!target.userData.alive) continue;
    const ud = target.userData;
    const toPlayer = new THREE.Vector3().subVectors(yawObject.position, target.position);
    toPlayer.y = 0;
    const dist = toPlayer.length();
    ud.attackCooldown -= dt;
    ud.strafeTimer -= dt;
    if (ud.reloading) {
      ud.reloadTimer -= dt;
      if (ud.reloadTimer <= 0) { ud.reloading = false; ud.ammo = ud.maxAmmo; }
    }

    const eyePos = target.position.clone();
    eyePos.y = 1.25;
    const hasLOS = hasLineOfSight(eyePos, playerPos);

    const lowHp = ud.isDuelist && ud.hp / ud.maxHp < 0.3;
    const moveDir = new THREE.Vector3();
    if (lowHp) {
      moveDir.copy(toPlayer).multiplyScalar(-1); // fall back to create space
    } else if (dist > ud.attackRange * 0.85 || !hasLOS) {
      moveDir.copy(toPlayer); // close the distance / hunt for an angle
    } else if (ud.isDuelist) {
      if (ud.strafeTimer <= 0) {
        ud.strafeTimer = 0.7 + Math.random() * 1.1;
        ud.strafeSign = Math.random() < 0.5 ? 1 : -1;
      }
      moveDir.set(-toPlayer.z, 0, toPlayer.x).multiplyScalar(ud.strafeSign); // strafe while shooting
    }
    if (moveDir.lengthSq() > 0.0001) {
      moveDir.normalize();
      const speed = ud.isDuelist ? 3.6 : 1.8;
      const nx = target.position.x + moveDir.x * speed * dt;
      const nz = target.position.z + moveDir.z * speed * dt;
      if (!collidesAt(nx, target.position.z)) target.position.x = nx;
      if (!collidesAt(target.position.x, nz)) target.position.z = nz;
    }

    if (dist < ud.attackRange) {
      const lookTarget = new THREE.Vector3(yawObject.position.x, eyePos.y, yawObject.position.z);
      target.lookAt(lookTarget);

      if (ud.attackCooldown <= 0 && hasLOS && !ud.reloading) {
        if (ud.ammo <= 0) {
          ud.reloading = true;
          ud.reloadTimer = 1.6;
        } else {
          ud.attackCooldown = ud.isDuelist
            ? 0.5 + Math.random() * 0.6
            : 1.2 + Math.random() * 1.4;
          ud.ammo--;
          ud.muzzleLight.intensity = 3;
          setTimeout(() => { if (ud.muzzleLight) ud.muzzleLight.intensity = 0; }, 80);
          playEnemyShot();

          const accuracy = Math.max(0.25, 1 - dist / ud.attackRange);
          const hitChance = ud.isDuelist ? accuracy : accuracy * 0.7;
          if (Math.random() < hitChance) {
            damagePlayer(ud.isDuelist ? 10 + Math.random() * 8 : 6 + Math.random() * 6);
          }
        }
      }
    }
  }
}

// ----- resize -------------------------------------------------------------
window.addEventListener('resize', () => {
  camera.aspect = window.innerWidth / window.innerHeight;
  camera.updateProjectionMatrix();
  renderer.setSize(window.innerWidth, window.innerHeight);
  composer.setSize(window.innerWidth, window.innerHeight);
});

// ----- main loop ------------------------------------------------------------
const clock = new THREE.Clock();
function animate() {
  requestAnimationFrame(animate);
  const dt = Math.min(0.05, clock.getDelta());

  if (locked && !gameOver) {
    updateMovement(dt);
    if (mouseDown && currentWeapon().auto) tryShoot();
    if (fireCooldown > 0) fireCooldown -= dt;
    if (abilityCooldown > 0) {
      abilityCooldown = Math.max(0, abilityCooldown - dt);
      updateAbilityHud();
    }
    updateTargetAI(dt);
  }
  updateRecoilRecovery(dt);
  updateTargets(dt, clock.elapsedTime);
  updateHazards(clock.elapsedTime);
  updateBuyPhase(dt);
  updateAbilityEffects(dt);
  if (scoreboardOpen) updateScoreboard();

  composer.render();
}
buildLevel(currentMapKey);
for (let i = 0; i < 4; i++) spawnRandomTarget();
updateRoundHud();
animate();
