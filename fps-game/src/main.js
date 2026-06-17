import * as THREE from 'three';

/* ----------------------------------------------------------------------
   1FPS — minimal browser FPS prototype
   Scene / level / player controller / weapon / targets / HUD
---------------------------------------------------------------------- */

const blocker = document.getElementById('blocker');
const hud = {
  ammo: document.getElementById('ammo'),
  reserve: document.getElementById('reserve'),
  hp: document.getElementById('hp'),
  crosshair: document.getElementById('crosshair'),
  hitmarker: document.getElementById('hitmarker'),
  flash: document.getElementById('flash'),
  killfeed: document.getElementById('killfeedList'),
};

// ----- renderer / scene / camera -----------------------------------
const renderer = new THREE.WebGLRenderer({ antialias: true });
renderer.setSize(window.innerWidth, window.innerHeight);
renderer.shadowMap.enabled = true;
document.body.appendChild(renderer.domElement);

const scene = new THREE.Scene();
scene.background = new THREE.Color(0x0b0e14);
scene.fog = new THREE.Fog(0x0b0e14, 15, 70);

const camera = new THREE.PerspectiveCamera(78, window.innerWidth / window.innerHeight, 0.1, 1000);

// yawObject (turns left/right) holds pitchObject (tilts up/down) holds camera
const pitchObject = new THREE.Object3D();
pitchObject.add(camera);
const yawObject = new THREE.Object3D();
yawObject.position.set(0, 1.7, 8);
yawObject.add(pitchObject);
scene.add(yawObject);

// ----- lighting -------------------------------------------------------
scene.add(new THREE.HemisphereLight(0x8899aa, 0x222233, 0.9));
const sun = new THREE.DirectionalLight(0xffffff, 1.1);
sun.position.set(20, 30, 10);
sun.castShadow = true;
sun.shadow.mapSize.set(2048, 2048);
sun.shadow.camera.left = -40;
sun.shadow.camera.right = 40;
sun.shadow.camera.top = 40;
sun.shadow.camera.bottom = -40;
scene.add(sun);

// ----- level: ground + walls + cover boxes -----------------------------
const colliders = []; // { box: THREE.Box3 }

function makeBoxMesh(w, h, d, color) {
  const mesh = new THREE.Mesh(
    new THREE.BoxGeometry(w, h, d),
    new THREE.MeshStandardMaterial({ color, roughness: 0.85, metalness: 0.05 })
  );
  mesh.castShadow = true;
  mesh.receiveShadow = true;
  return mesh;
}

function addCollider(mesh) {
  mesh.geometry.computeBoundingBox();
  colliders.push(mesh);
}

const ARENA = 60;
const ground = makeBoxMesh(ARENA, 1, ARENA, 0x2a3038);
ground.position.y = -0.5;
ground.receiveShadow = true;
scene.add(ground);

const wallMat = 0x394452;
const wallHeight = 6;
const wallDefs = [
  [ARENA, wallHeight, 1, 0, wallHeight / 2, -ARENA / 2],
  [ARENA, wallHeight, 1, 0, wallHeight / 2, ARENA / 2],
  [1, wallHeight, ARENA, -ARENA / 2, wallHeight / 2, 0],
  [1, wallHeight, ARENA, ARENA / 2, wallHeight / 2, 0],
];
for (const [w, h, d, x, y, z] of wallDefs) {
  const wall = makeBoxMesh(w, h, d, wallMat);
  wall.position.set(x, y, z);
  scene.add(wall);
  addCollider(wall);
}

// scattered cover crates
const coverPositions = [
  [4, -10], [-6, -4], [8, 5], [-10, 10], [0, 15], [-14, -14], [12, -16], [16, 6], [-4, 20], [6, -22],
];
for (const [x, z] of coverPositions) {
  const size = 1.6 + Math.random() * 1.2;
  const crate = makeBoxMesh(size, size, size, 0x55483a);
  crate.position.set(x, size / 2, z);
  crate.rotation.y = Math.random() * Math.PI;
  scene.add(crate);
  addCollider(crate);
}

// ----- targets (simple enemies) ---------------------------------------
const targets = [];
function spawnTarget(x, z) {
  const group = new THREE.Group();
  const body = new THREE.Mesh(
    new THREE.CapsuleGeometry(0.45, 1.2, 6, 12),
    new THREE.MeshStandardMaterial({ color: 0xb0392f, roughness: 0.6 })
  );
  body.position.y = 1.1;
  body.castShadow = true;
  const head = new THREE.Mesh(
    new THREE.SphereGeometry(0.3, 16, 16),
    new THREE.MeshStandardMaterial({ color: 0xd9a374, roughness: 0.6 })
  );
  head.position.y = 2.0;
  head.castShadow = true;
  group.add(body, head);
  group.position.set(x, 0, z);
  group.userData = { hp: 100, alive: true, body, head, baseY: 0, t: Math.random() * Math.PI * 2 };
  scene.add(group);
  targets.push(group);
}
[[3, -6], [-5, -2], [7, 8], [-9, -10], [2, 14], [-3, 18]].forEach(([x, z]) => spawnTarget(x, z));

// ----- weapon viewmodel --------------------------------------------------
const weapon = new THREE.Group();
const gunBody = new THREE.Mesh(
  new THREE.BoxGeometry(0.12, 0.14, 0.55),
  new THREE.MeshStandardMaterial({ color: 0x1d1f22, roughness: 0.4, metalness: 0.6 })
);
const gunBarrel = new THREE.Mesh(
  new THREE.CylinderGeometry(0.025, 0.025, 0.3, 12),
  new THREE.MeshStandardMaterial({ color: 0x111214, roughness: 0.3, metalness: 0.8 })
);
gunBarrel.rotation.x = Math.PI / 2;
gunBarrel.position.set(0, 0.02, -0.45);
weapon.add(gunBody, gunBarrel);
weapon.position.set(0.28, -0.25, -0.55);
camera.add(weapon);

const muzzleFlash = new THREE.PointLight(0xffcc66, 0, 6, 2);
muzzleFlash.position.set(0, 0.02, -0.62);
weapon.add(muzzleFlash);

const flashSprite = new THREE.Mesh(
  new THREE.PlaneGeometry(0.18, 0.18),
  new THREE.MeshBasicMaterial({ color: 0xffdd88, transparent: true, opacity: 0 })
);
flashSprite.position.set(0, 0.02, -0.63);
weapon.add(flashSprite);

// ----- input / pointer lock --------------------------------------------
const keys = {};
let yaw = 0, pitch = 0;
let locked = false;

document.addEventListener('keydown', (e) => (keys[e.code] = true));
document.addEventListener('keyup', (e) => (keys[e.code] = false));

blocker.addEventListener('click', () => renderer.domElement.requestPointerLock());
document.addEventListener('pointerlockchange', () => {
  locked = document.pointerLockElement === renderer.domElement;
  blocker.classList.toggle('hidden', locked);
});

document.addEventListener('mousemove', (e) => {
  if (!locked) return;
  const sensitivity = 0.0022;
  yaw -= e.movementX * sensitivity;
  pitch -= e.movementY * sensitivity;
  pitch = Math.max(-Math.PI / 2 + 0.01, Math.min(Math.PI / 2 - 0.01, pitch));
  yawObject.rotation.y = yaw;
  pitchObject.rotation.x = pitch;
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
const weaponState = {
  magSize: 12,
  ammo: 12,
  reserve: 48,
  reloading: false,
  fireCooldown: 0,
  fireRate: 0.14,
};

function updateAmmoHud() {
  hud.ammo.textContent = weaponState.ammo;
  hud.reserve.textContent = weaponState.reserve;
}
updateAmmoHud();

function reload() {
  if (weaponState.reloading || weaponState.ammo === weaponState.magSize || weaponState.reserve <= 0) return;
  weaponState.reloading = true;
  setTimeout(() => {
    const need = weaponState.magSize - weaponState.ammo;
    const take = Math.min(need, weaponState.reserve);
    weaponState.ammo += take;
    weaponState.reserve -= take;
    weaponState.reloading = false;
    updateAmmoHud();
  }, 1200);
}

// recoil / view-kick state
let recoilPitch = 0;
let recoilYaw = 0;
let kickTimer = 0;

const raycaster = new THREE.Raycaster();
const shootables = () => targets.flatMap((t) => [t.userData.body, t.userData.head]);

let mouseDown = false;
document.addEventListener('mousedown', (e) => {
  if (e.button === 0 && locked) {
    mouseDown = true;
    tryShoot();
  }
});
document.addEventListener('mouseup', (e) => { if (e.button === 0) mouseDown = false; });
document.addEventListener('keydown', (e) => { if (e.code === 'KeyR') reload(); });
document.addEventListener('contextmenu', (e) => e.preventDefault());

function tryShoot() {
  if (weaponState.fireCooldown > 0 || weaponState.reloading) return;
  if (weaponState.ammo <= 0) { playDry(); return; }

  weaponState.ammo--;
  weaponState.fireCooldown = weaponState.fireRate;
  updateAmmoHud();
  playShot();

  // visual recoil + camera kick
  recoilPitch += 0.045;
  recoilYaw += (Math.random() - 0.5) * 0.02;
  weapon.position.z = -0.45;
  kickTimer = 0.08;

  // muzzle flash
  muzzleFlash.intensity = 4;
  flashSprite.material.opacity = 1;

  hud.crosshair.classList.add('shoot');
  setTimeout(() => hud.crosshair.classList.remove('shoot'), 60);

  // raycast from camera center
  raycaster.setFromCamera(new THREE.Vector2(0, 0), camera);
  const hits = raycaster.intersectObjects(shootables(), false);
  if (hits.length > 0) {
    const hit = hits[0];
    const target = targets.find((t) => t.userData.body === hit.object || t.userData.head === hit.object);
    if (target && target.userData.alive) {
      const headshot = hit.object === target.userData.head;
      const dmg = headshot ? 100 : 34;
      target.userData.hp -= dmg;
      playHit();
      hud.hitmarker.classList.add('show');
      setTimeout(() => hud.hitmarker.classList.remove('show'), 90);
      if (target.userData.hp <= 0) {
        killTarget(target, headshot);
      }
    }
  }
}

function killTarget(target, headshot) {
  target.userData.alive = false;
  scene.remove(target);
  targets.splice(targets.indexOf(target), 1);
  addKillFeed(headshot ? '헤드샷 ✕' : '제거 ✕');
  setTimeout(() => {
    const x = (Math.random() - 0.5) * 40;
    const z = (Math.random() - 0.5) * 40;
    spawnTarget(x, z);
  }, 1500);
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
let playerHp = 100;

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
  recoilPitch *= Math.max(0, 1 - dt * 8);
  recoilYaw *= Math.max(0, 1 - dt * 8);
  pitchObject.rotation.x = pitch + recoilPitch;
  yawObject.rotation.y = yaw + recoilYaw;

  if (kickTimer > 0) {
    kickTimer -= dt;
    weapon.position.z = -0.45 + 0.06 * (kickTimer / 0.08);
  } else {
    weapon.position.z = -0.55;
  }

  muzzleFlash.intensity *= Math.max(0, 1 - dt * 18);
  flashSprite.material.opacity *= Math.max(0, 1 - dt * 18);
}

function updateTargets(dt, t) {
  for (const target of targets) {
    target.userData.t += dt;
    target.position.x += Math.sin(target.userData.t * 0.6) * dt * 0.4;
    target.position.y = 0;
  }
}

// ----- damage feedback when too close to a target (simple melee danger) -
function updateDangerFeedback() {
  for (const target of targets) {
    const dist = yawObject.position.distanceTo(target.position);
    if (dist < 1.4) {
      playerHp = Math.max(0, playerHp - 0.4);
      hud.flash.classList.add('show');
      hud.hp.textContent = Math.round(playerHp);
      setTimeout(() => hud.flash.classList.remove('show'), 100);
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

  if (locked) {
    updateMovement(dt);
    if (mouseDown) tryShoot();
    if (weaponState.fireCooldown > 0) weaponState.fireCooldown -= dt;
    updateDangerFeedback();
  }
  updateRecoilRecovery(dt);
  updateTargets(dt, clock.elapsedTime);

  renderer.render(scene, camera);
}
animate();
