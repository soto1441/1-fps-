import * as THREE from 'three';

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
};

// ----- renderer / scene / camera -----------------------------------
const renderer = new THREE.WebGLRenderer({ antialias: true });
renderer.setSize(window.innerWidth, window.innerHeight);
renderer.shadowMap.enabled = true;
renderer.shadowMap.type = THREE.PCFSoftShadowMap;
renderer.toneMapping = THREE.ACESFilmicToneMapping;
renderer.toneMappingExposure = 1.1;
renderer.outputColorSpace = THREE.SRGBColorSpace;
document.body.appendChild(renderer.domElement);

const scene = new THREE.Scene();
scene.background = new THREE.Color(0x2b3850);
scene.fog = new THREE.Fog(0x2b3850, 25, 80);

const camera = new THREE.PerspectiveCamera(78, window.innerWidth / window.innerHeight, 0.1, 1000);

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
sun.shadow.mapSize.set(2048, 2048);
sun.shadow.camera.left = -40;
sun.shadow.camera.right = 40;
sun.shadow.camera.top = 40;
sun.shadow.camera.bottom = -40;
sun.shadow.bias = -0.0006;
sun.shadow.normalBias = 0.02;
scene.add(sun);

// ----- level: ground + walls + cover boxes -----------------------------
const colliders = []; // meshes used for AABB collision checks

// procedural tiled texture: subtle per-tile noise/grout lines so flat
// ground/wall surfaces aren't a single dead-flat color under the sun light
function makeNoiseTexture(baseHex, { tile = 64, grid = 8, noise = 14 } = {}) {
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
  return texture;
}

function makeBoxMesh(w, h, d, color, texRepeat) {
  const material = new THREE.MeshStandardMaterial({ color, roughness: 0.85, metalness: 0.05 });
  if (texRepeat) {
    const tex = makeNoiseTexture(color);
    tex.repeat.set(texRepeat[0], texRepeat[1]);
    material.map = tex;
    material.color.set(0xffffff);
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
};

let currentMapKey = 'urban';
let levelMeshes = [];
let currentHazards = [];

function clearLevel() {
  for (const mesh of levelMeshes) scene.remove(mesh);
  levelMeshes = [];
  colliders.length = 0;
  currentHazards = [];
}

function buildLevel(key) {
  clearLevel();
  const cfg = MAPS[key];
  currentMapKey = key;

  scene.background = new THREE.Color(cfg.sky);
  scene.fog = new THREE.Fog(cfg.sky, cfg.fogNear, cfg.fogFar);

  const ground = makeBoxMesh(ARENA, 1, ARENA, cfg.ground, [ARENA / 3, ARENA / 3]);
  ground.position.y = -0.5;
  ground.receiveShadow = true;
  scene.add(ground);
  levelMeshes.push(ground);

  const wallDefs = [
    [ARENA, wallHeight, 1, 0, wallHeight / 2, -ARENA / 2],
    [ARENA, wallHeight, 1, 0, wallHeight / 2, ARENA / 2],
    [1, wallHeight, ARENA, -ARENA / 2, wallHeight / 2, 0],
    [1, wallHeight, ARENA, ARENA / 2, wallHeight / 2, 0],
  ];
  for (const [w, h, d, x, y, z] of wallDefs) {
    const wall = makeBoxMesh(w, h, d, cfg.wall, [Math.max(w, d) / 6, wallHeight / 3]);
    wall.position.set(x, y, z);
    scene.add(wall);
    addCollider(wall);
    levelMeshes.push(wall);
  }

  for (const [x, z] of cfg.coverPositions) {
    const size = 1.6 + Math.random() * 1.2;
    const crate = makeBoxMesh(size, size, size, cfg.cover, [1, 1]);
    crate.position.set(x, size / 2, z);
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

function spawnTarget(x, z) {
  const group = new THREE.Group();
  const body = new THREE.Mesh(
    new THREE.CapsuleGeometry(0.45, 1.2, 6, 12),
    new THREE.MeshStandardMaterial({ color: 0xb0392f, roughness: 0.55, metalness: 0.05 })
  );
  body.position.y = 1.1;
  body.castShadow = true;

  // chest vest accent for a clearer silhouette / readable hitbox
  const vest = new THREE.Mesh(
    new THREE.CylinderGeometry(0.46, 0.4, 0.7, 12, 1, true, 0, Math.PI),
    new THREE.MeshStandardMaterial({ color: 0x2c2c30, roughness: 0.7, side: THREE.DoubleSide })
  );
  vest.rotation.y = -Math.PI / 2;
  vest.position.y = 1.35;
  vest.castShadow = true;

  const head = new THREE.Mesh(
    new THREE.SphereGeometry(0.3, 16, 16),
    new THREE.MeshStandardMaterial({ color: 0xd9a374, roughness: 0.55 })
  );
  head.position.y = 2.0;
  head.castShadow = true;

  const visor = new THREE.Mesh(
    new THREE.BoxGeometry(0.42, 0.12, 0.1),
    new THREE.MeshStandardMaterial({ color: 0x171a1f, roughness: 0.3, metalness: 0.4 })
  );
  visor.position.set(0, 2.04, -0.24);

  const gun = new THREE.Mesh(
    new THREE.BoxGeometry(0.08, 0.08, 0.4),
    new THREE.MeshStandardMaterial({ color: 0x14151a, roughness: 0.4, metalness: 0.6 })
  );
  gun.position.set(0.32, 1.25, -0.1);
  const muzzleLight = new THREE.PointLight(0xffaa55, 0, 5, 2);
  muzzleLight.position.set(0.32, 1.25, -0.3);

  // separate lower-body hitbox: a slightly-forward box so low shots register
  // as a leg hit (reduced damage) instead of always counting as a body hit
  const leg = new THREE.Mesh(
    new THREE.BoxGeometry(0.5, 0.7, 0.5),
    new THREE.MeshStandardMaterial({ color: 0x232328, roughness: 0.7 })
  );
  leg.position.set(0, 0.35, 0.03);
  leg.castShadow = true;

  group.add(body, vest, head, visor, gun, muzzleLight, leg);
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
// cylinder barrel/scope, axis along z by default
function gunCyl(rad, len, mat, pos, axis = 'z') {
  const m = new THREE.Mesh(new THREE.CylinderGeometry(rad, rad, len, 12), mat);
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

const WEAPONS = {
  // ----- sidearms -----
  classic: {
    name: 'CLASSIC', melee: false, auto: false,
    magSize: 12, ammo: 12, reserve: 36,
    fireRate: 0.2, reloadTime: 1300, dmgBody: 18, dmgHead: 55, dmgLeg: 12,
    recoil: 0.02, reloading: false, cost: 0,
  },
  shorty: {
    name: 'SHORTY', melee: false, auto: false,
    magSize: 2, ammo: 2, reserve: 6,
    fireRate: 0.6, reloadTime: 1600, dmgBody: 10, dmgHead: 18, dmgLeg: 7,
    pellets: 5, spreadDeg: 7,
    recoil: 0.05, reloading: false, cost: 200,
  },
  frenzy: {
    name: 'FRENZY', melee: false, auto: true,
    magSize: 13, ammo: 13, reserve: 39,
    fireRate: 0.1, reloadTime: 1300, dmgBody: 16, dmgHead: 45, dmgLeg: 10,
    recoil: 0.04, reloading: false, cost: 450,
  },
  ghost: {
    name: 'GHOST', melee: false, auto: false,
    magSize: 15, ammo: 15, reserve: 30,
    fireRate: 0.18, reloadTime: 1300, dmgBody: 20, dmgHead: 78, dmgLeg: 13,
    recoil: 0.025, reloading: false, cost: 500,
  },
  sheriff: {
    name: 'SHERIFF', melee: false, auto: false,
    magSize: 6, ammo: 6, reserve: 12,
    fireRate: 0.35, reloadTime: 1600, dmgBody: 28, dmgHead: 100, dmgLeg: 18,
    recoil: 0.05, reloading: false, cost: 800,
  },
  // ----- SMGs -----
  stinger: {
    name: 'STINGER', melee: false, auto: true,
    magSize: 20, ammo: 20, reserve: 60,
    fireRate: 0.08, reloadTime: 1500, dmgBody: 18, dmgHead: 50, dmgLeg: 12,
    recoil: 0.035, reloading: false, cost: 1000,
  },
  spectre: {
    name: 'SPECTRE', melee: false, auto: true,
    magSize: 22, ammo: 22, reserve: 66,
    fireRate: 0.09, reloadTime: 1700, dmgBody: 20, dmgHead: 58, dmgLeg: 13,
    recoil: 0.03, reloading: false, cost: 1600,
  },
  // ----- shotguns -----
  bucky: {
    name: 'BUCKY', melee: false, auto: false,
    magSize: 5, ammo: 5, reserve: 15,
    fireRate: 0.8, reloadTime: 2000, dmgBody: 12, dmgHead: 20, dmgLeg: 9,
    pellets: 10, spreadDeg: 7,
    recoil: 0.08, reloading: false, cost: 850,
  },
  judge: {
    name: 'JUDGE', melee: false, auto: false,
    magSize: 7, ammo: 7, reserve: 21,
    fireRate: 0.55, reloadTime: 2000, dmgBody: 11, dmgHead: 18, dmgLeg: 8,
    pellets: 9, spreadDeg: 6,
    recoil: 0.07, reloading: false, cost: 1850,
  },
  // ----- rifles -----
  bulldog: {
    name: 'BULLDOG', melee: false, auto: false,
    magSize: 24, ammo: 24, reserve: 72,
    fireRate: 0.15, reloadTime: 1500, dmgBody: 26, dmgHead: 78, dmgLeg: 17,
    recoil: 0.035, reloading: false, cost: 2050,
  },
  guardian: {
    name: 'GUARDIAN', melee: false, auto: false,
    magSize: 12, ammo: 12, reserve: 36,
    fireRate: 0.25, reloadTime: 1700, dmgBody: 36, dmgHead: 130, dmgLeg: 24,
    recoil: 0.03, reloading: false, cost: 2250,
  },
  phantom: {
    name: 'PHANTOM', melee: false, auto: true,
    magSize: 30, ammo: 30, reserve: 90,
    fireRate: 0.1, reloadTime: 1800, dmgBody: 32, dmgHead: 88, dmgLeg: 21,
    recoil: 0.04, reloading: false, cost: 2900,
    bloomGrowDeg: 0.45, maxSpreadDeg: 3.2,
    sprayPattern: RIFLE_SPRAY,
  },
  vandal: {
    name: 'VANDAL', melee: false, auto: true,
    magSize: 25, ammo: 25, reserve: 75,
    fireRate: 0.12, reloadTime: 1900, dmgBody: 34, dmgHead: 100, dmgLeg: 22,
    recoil: 0.045, reloading: false, cost: 2900,
    bloomGrowDeg: 0.45, maxSpreadDeg: 3.2,
    sprayPattern: RIFLE_SPRAY,
  },
  // ----- sniper rifles -----
  marshal: {
    name: 'MARSHAL', melee: false, auto: false,
    magSize: 5, ammo: 5, reserve: 15,
    fireRate: 1.1, reloadTime: 1800, dmgBody: 60, dmgHead: 200, dmgLeg: 40,
    recoil: 0.07, reloading: false, cost: 1100,
  },
  outlaw: {
    name: 'OUTLAW', melee: false, auto: false,
    magSize: 2, ammo: 2, reserve: 6,
    fireRate: 1.3, reloadTime: 2200, dmgBody: 70, dmgHead: 240, dmgLeg: 45,
    recoil: 0.08, reloading: false, cost: 2400,
  },
  operator: {
    name: 'OPERATOR', melee: false, auto: false,
    magSize: 4, ammo: 4, reserve: 12,
    fireRate: 1.5, reloadTime: 2000, dmgBody: 80, dmgHead: 300, dmgLeg: 50,
    recoil: 0.09, reloading: false, cost: 4700,
  },
  // ----- heavy -----
  ares: {
    name: 'ARES', melee: false, auto: true,
    magSize: 40, ammo: 40, reserve: 80,
    fireRate: 0.1, reloadTime: 2500, dmgBody: 22, dmgHead: 65, dmgLeg: 15,
    recoil: 0.05, reloading: false, cost: 1600,
  },
  odin: {
    name: 'ODIN', melee: false, auto: true,
    magSize: 60, ammo: 60, reserve: 120,
    fireRate: 0.08, reloadTime: 3000, dmgBody: 24, dmgHead: 70, dmgLeg: 16,
    recoil: 0.055, reloading: false, cost: 3200,
  },
  // ----- melee -----
  knife: {
    name: 'KNIFE', melee: true, auto: false,
    range: 2.4, fireRate: 0.45, dmgBody: 60, dmgHead: 60, dmgLeg: 60,
    recoil: 0, reloading: false, cost: 0,
  },
};

const ARMOR_TIERS = { light: { cost: 400, value: 25 }, heavy: { cost: 1000, value: 50 } };
const STARTING_CREDITS = 800;
const KILL_REWARD = 200;
const ROUND_WIN_REWARD = 3000;
const ROUND_LOSS_REWARD = 1900;

let gameMode = 'range';
// 사격장(range)은 에임 연습이라 무한탄, 1대1 대결(duel)은 진짜 탄약/재장전이 의미 있게 작동
function infiniteAmmo() { return gameMode === 'range'; }
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

// Valorant has one equipped weapon per slot (no cycling among owned guns) —
// 1/2/3 just re-equips whatever you currently own in that slot, chosen at
// the buy menu
function pickSlot(slotKey) {
  const list = gameMode === 'duel' ? WEAPON_SLOTS[slotKey].filter((k) => ownedWeapons.has(k)) : WEAPON_SLOTS[slotKey];
  if (list.length === 0) return;
  setWeapon(list[0]);
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
  hud.buyCredits.textContent = playerCredits;
  for (const btn of buyButtons) {
    const weaponKey = btn.dataset.weapon;
    const armorKey = btn.dataset.armor;
    const costEl = btn.querySelector('.buyCost');
    if (weaponKey) {
      const owned = ownedWeapons.has(weaponKey);
      const cost = WEAPONS[weaponKey].cost;
      if (costEl) costEl.textContent = owned ? '보유중' : cost > 0 ? `${cost} CR` : 'FREE';
      btn.classList.toggle('unaffordable', !owned && cost > playerCredits);
      btn.classList.toggle('active', weaponKey === currentWeaponKey);
    } else if (armorKey) {
      const tier = ARMOR_TIERS[armorKey];
      if (costEl) costEl.textContent = `${tier.cost} CR`;
      btn.classList.toggle('unaffordable', tier.cost > playerCredits);
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
  if (e.code === 'KeyB' && !buyPhaseActive) toggleBuyMenu();
});

// ----- buy phase: countdown before each duel round, like Unity GameManager ---
let buyPhaseActive = false;
let buyPhaseTimer = 0;
let buyPhaseCallback = null;
const BUY_PHASE_SECONDS = 5;

function startBuyPhase(callback) {
  buyPhaseActive = true;
  buyPhaseTimer = BUY_PHASE_SECONDS;
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
    const weaponKey = btn.dataset.weapon;
    const armorKey = btn.dataset.armor;
    if (weaponKey) {
      const alreadyOwned = ownedWeapons.has(weaponKey);
      const cost = alreadyOwned ? 0 : WEAPONS[weaponKey].cost;
      if (cost > playerCredits) return;
      playerCredits -= cost;
      ownedWeapons.add(weaponKey);
      setWeapon(weaponKey);
      updateCreditsHud();
      refreshBuyMenu();
    } else if (armorKey) {
      const tier = ARMOR_TIERS[armorKey];
      if (tier.cost > playerCredits) return;
      playerCredits -= tier.cost;
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
  let headshotAny = false;
  for (let i = 0; i < shotCount; i++) {
    let ndcX = 0, ndcY = 0;
    if (w.pellets) {
      const spread = (w.spreadDeg * Math.PI / 180);
      ndcX = (Math.random() - 0.5) * spread;
      ndcY = (Math.random() - 0.5) * spread;
    } else if (w.auto && w.sprayPattern && w.sprayPattern.length > 0) {
      // fixed recoil-pattern climb (CS/Valorant-style) instead of pure
      // randomness, indexed by how many shots have landed this burst
      const idx = Math.min(weaponShotCount - 1, w.sprayPattern.length - 1);
      const [yawDeg, pitchDeg] = w.sprayPattern[Math.max(0, idx)];
      ndcX = yawDeg * Math.PI / 180;
      ndcY = pitchDeg * Math.PI / 180;
    } else if (w.auto && weaponBloom > 0) {
      const spread = (weaponBloom * Math.PI / 180);
      ndcX = (Math.random() - 0.5) * spread;
      ndcY = (Math.random() - 0.5) * spread;
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
        if (headshot) headshotAny = true;
        const dmg = headshot ? w.dmgHead : legshot ? (w.dmgLeg != null ? w.dmgLeg : w.dmgBody) : w.dmgBody;
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
      if (target.userData.hp <= 0) killTarget(target, headshotAny);
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
    if (gameMode === 'duel') onDuelKill();
    else checkWaveClear();
  }
}

// ----- game modes: 사격장(range) clears waves of weak dummies for points,
// 1대1 AI 대결(duel) is a single tougher bot fought best-of-5, both modeled
// after RIVALS/Valorant-style match scoring (first to N round wins) -------
const ROUNDS_TO_WIN = 5;
let roundScore = 0;
let roundTransition = false;

const DUEL_ROUNDS_TO_WIN = 5;
let playerScore = 0;
let aiScore = 0;

function updateRoundHud() {
  hud.round.textContent = gameMode === 'duel'
    ? `YOU ${playerScore} - ${aiScore} AI`
    : `ROUND ${roundScore}/${ROUNDS_TO_WIN}`;
}

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

function onDuelKill() {
  if (gameOver) return;
  playerScore++;
  updateRoundHud();
  addKillFeed(`AI 제거! ${playerScore}-${aiScore}`);
  showKillBanner('YOU', 'AI');
  playerCredits += ROUND_WIN_REWARD;
  updateCreditsHud();
  if (playerScore >= DUEL_ROUNDS_TO_WIN) {
    setTimeout(winGame, 600);
  } else {
    setTimeout(() => {
      playerHp = PLAYER_MAX_HP;
      playerArmor = 0;
      updateHealthHud();
      updateArmorHud();
      refillAmmo();
      startBuyPhase(spawnDuelOpponent);
    }, 1200);
  }
}

function winGame() {
  gameOver = true;
  mouseDown = false;
  document.exitPointerLock();
  blockerTitle.textContent = 'VICTORY';
  blockerSub.textContent = gameMode === 'duel'
    ? `AI와의 1대1에서 ${DUEL_ROUNDS_TO_WIN}승 달성! 클릭해서 다시 시작`
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
  hud.armorLine.classList.toggle('hidden', gameMode !== 'duel');
}
updateArmorHud();

let playerCredits = STARTING_CREDITS;
function updateCreditsHud() {
  hud.credits.textContent = playerCredits;
  hud.buyCredits.textContent = playerCredits;
  hud.creditsLine.classList.toggle('hidden', gameMode !== 'duel');
}
updateCreditsHud();

function damagePlayer(amount) {
  if (gameOver) return;
  let final = amount;
  if (playerArmor > 0) {
    let absorbed = Math.round(amount * ARMOR_DAMAGE_REDUCTION * (playerArmor / 100));
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
  if (gameMode === 'duel') {
    aiScore++;
    updateRoundHud();
    addKillFeed(`사망! ${playerScore}-${aiScore}`);
    showKillBanner('AI', 'YOU');
    playerCredits += ROUND_LOSS_REWARD;
    updateCreditsHud();
    if (aiScore >= DUEL_ROUNDS_TO_WIN) {
      loseDuel();
    } else {
      setTimeout(() => {
        playerHp = PLAYER_MAX_HP;
        playerArmor = 0;
        updateHealthHud();
        updateArmorHud();
        yawObject.position.set(0, 1.7, 8);
        for (const target of targets.slice()) killTarget(target, false, true);
        // dying loses your loadout for the round, like Valorant — fall back
        // to classic + knife and force a rebuy, unlike surviving a round
        // (handled in onDuelKill) which keeps your gun
        ownedWeapons = new Set(['classic', 'knife']);
        currentWeaponKey = 'knife';
        setWeapon('classic');
        refillAmmo();
        startBuyPhase(spawnDuelOpponent);
      }, 1200);
    }
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
  blockerSub.textContent = `AI ${DUEL_ROUNDS_TO_WIN}승! 클릭해서 다시 시작`;
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
  if (gameMode === 'duel') {
    playerScore = 0;
    aiScore = 0;
    playerArmor = 0;
    playerCredits = STARTING_CREDITS;
    ownedWeapons = new Set(['classic', 'knife']);
    currentWeaponKey = 'knife'; // force setWeapon below to actually switch
    setWeapon('classic');
    updateArmorHud();
    updateCreditsHud();
    updateRoundHud();
    spawnDuelOpponent();
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
  yawObject.position.set(0, 1.7, 8);
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
  yawObject.position.set(0, 1.7, 8);
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
  const speed = sprinting ? 7.5 : 4.6;

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
  if (gameMode !== 'duel') return;
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
    updateTargetAI(dt);
  }
  updateRecoilRecovery(dt);
  updateTargets(dt, clock.elapsedTime);
  updateHazards(clock.elapsedTime);
  updateBuyPhase(dt);

  renderer.render(scene, camera);
}
buildLevel(currentMapKey);
for (let i = 0; i < 4; i++) spawnRandomTarget();
updateRoundHud();
animate();
