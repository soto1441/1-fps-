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
  hitmarker: document.getElementById('hitmarker'),
  flash: document.getElementById('flash'),
  killfeed: document.getElementById('killfeedList'),
};

// ----- renderer / scene / camera -----------------------------------
const renderer = new THREE.WebGLRenderer({ antialias: true });
renderer.setSize(window.innerWidth, window.innerHeight);
renderer.shadowMap.enabled = true;
renderer.toneMapping = THREE.ACESFilmicToneMapping;
renderer.toneMappingExposure = 1.6;
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
scene.add(new THREE.HemisphereLight(0xbfd4ff, 0x33384a, 1.6));
scene.add(new THREE.AmbientLight(0xffffff, 0.5));
const sun = new THREE.DirectionalLight(0xffffff, 2.4);
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

  const gun = new THREE.Mesh(
    new THREE.BoxGeometry(0.08, 0.08, 0.4),
    new THREE.MeshStandardMaterial({ color: 0x14151a, roughness: 0.4, metalness: 0.6 })
  );
  gun.position.set(0.32, 1.25, -0.1);
  const muzzleLight = new THREE.PointLight(0xffaa55, 0, 5, 2);
  muzzleLight.position.set(0.32, 1.25, -0.3);

  group.add(body, head, gun, muzzleLight);
  group.position.set(x, 0, z);
  group.userData = {
    hp: 100, alive: true, body, head, gun, muzzleLight,
    baseY: 0, t: Math.random() * Math.PI * 2,
    attackCooldown: 1 + Math.random() * 1.5,
    attackRange: 22,
  };
  scene.add(group);
  targets.push(group);
}
const MAX_TARGETS = 8;
const SPAWN_INTERVAL = 4;
const SPAWN_MIN_DIST_FROM_PLAYER = 10;
let spawnTimer = SPAWN_INTERVAL;

function spawnRandomTarget() {
  if (targets.length >= MAX_TARGETS) return;
  const half = ARENA / 2 - 3;
  for (let attempt = 0; attempt < 20; attempt++) {
    const x = (Math.random() * 2 - 1) * half;
    const z = (Math.random() * 2 - 1) * half;
    if (yawObject.position.distanceTo(new THREE.Vector3(x, 0, z)) < SPAWN_MIN_DIST_FROM_PLAYER) continue;
    if (collidesAt(x, z)) continue;
    spawnTarget(x, z);
    return;
  }
}


// ----- weapon viewmodels ---------------------------------------------------
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

// rifle
const weaponRifle = new THREE.Group();
{
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
  weaponRifle.add(gunBody, gunBarrel);
}
weaponRifle.position.set(0.28, -0.25, -0.55);
camera.add(weaponRifle);
const rifleMuzzle = buildMuzzle(weaponRifle, new THREE.Vector3(0, 0.02, -0.62));

// pistol
const weaponPistol = new THREE.Group();
{
  const gunBody = new THREE.Mesh(
    new THREE.BoxGeometry(0.1, 0.16, 0.32),
    new THREE.MeshStandardMaterial({ color: 0x2a2c30, roughness: 0.35, metalness: 0.65 })
  );
  const grip = new THREE.Mesh(
    new THREE.BoxGeometry(0.08, 0.18, 0.1),
    new THREE.MeshStandardMaterial({ color: 0x16171a, roughness: 0.6 })
  );
  grip.position.set(0, -0.15, 0.08);
  weaponPistol.add(gunBody, grip);
}
weaponPistol.position.set(0.26, -0.22, -0.42);
weaponPistol.visible = false;
camera.add(weaponPistol);
const pistolMuzzle = buildMuzzle(weaponPistol, new THREE.Vector3(0, 0.03, -0.18));

// knife
const weaponKnife = new THREE.Group();
{
  const blade = new THREE.Mesh(
    new THREE.BoxGeometry(0.035, 0.32, 0.05),
    new THREE.MeshStandardMaterial({ color: 0xcfd6dc, roughness: 0.25, metalness: 0.9 })
  );
  blade.position.set(0, 0.18, 0);
  const handle = new THREE.Mesh(
    new THREE.BoxGeometry(0.045, 0.14, 0.06),
    new THREE.MeshStandardMaterial({ color: 0x3a2c20, roughness: 0.7 })
  );
  weaponKnife.add(blade, handle);
  weaponKnife.rotation.x = -0.5;
}
weaponKnife.position.set(0.24, -0.22, -0.4);
weaponKnife.visible = false;
camera.add(weaponKnife);

const weaponModels = { rifle: weaponRifle, pistol: weaponPistol, knife: weaponKnife };
const weaponMuzzles = { rifle: rifleMuzzle, pistol: pistolMuzzle, knife: null };
const weaponRestZ = { rifle: weaponRifle.position.z, pistol: weaponPistol.position.z, knife: weaponKnife.position.z };

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
const WEAPONS = {
  rifle: {
    name: 'RIFLE', melee: false, auto: true,
    magSize: 12, ammo: 12, reserve: 48,
    fireRate: 0.14, reloadTime: 1200, dmgBody: 34, dmgHead: 100,
    recoil: 0.045,
  },
  pistol: {
    name: 'PISTOL', melee: false, auto: false,
    magSize: 8, ammo: 8, reserve: 32,
    fireRate: 0.28, reloadTime: 900, dmgBody: 22, dmgHead: 70,
    recoil: 0.03,
  },
  knife: {
    name: 'KNIFE', melee: true, auto: false,
    range: 2.4, fireRate: 0.45, dmgBody: 60, dmgHead: 60,
    recoil: 0,
  },
};

let currentWeaponKey = 'rifle';
let reloading = false;
let fireCooldown = 0;

function currentWeapon() {
  return WEAPONS[currentWeaponKey];
}

function updateAmmoHud() {
  const w = currentWeapon();
  hud.weaponName.textContent = w.name;
  if (w.melee) {
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
  reloading = false;
  fireCooldown = 0.15;
  kickTimer = 0;
  for (const k in weaponModels) weaponModels[k].visible = k === key;
  updateAmmoHud();
}

document.addEventListener('keydown', (e) => {
  if (e.code === 'Digit1') setWeapon('rifle');
  if (e.code === 'Digit2') setWeapon('pistol');
  if (e.code === 'Digit3') setWeapon('knife');
});

updateAmmoHud();

function reload() {
  const w = currentWeapon();
  if (w.melee || reloading || w.ammo === w.magSize || w.reserve <= 0) return;
  reloading = true;
  setTimeout(() => {
    const need = w.magSize - w.ammo;
    const take = Math.min(need, w.reserve);
    w.ammo += take;
    w.reserve -= take;
    reloading = false;
    updateAmmoHud();
  }, w.reloadTime);
}

// recoil / view-kick state
let recoilPitch = 0;
let recoilYaw = 0;
let kickTimer = 0;
let kickBaseZ = 0;

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
  if (gameOver) return;
  const w = currentWeapon();
  if (fireCooldown > 0 || reloading) return;

  if (!w.melee) {
    if (w.ammo <= 0) { playDry(); return; }
    w.ammo--;
    updateAmmoHud();
  }
  fireCooldown = w.fireRate;
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

  // raycast from camera center
  const range = w.melee ? w.range : 100;
  raycaster.setFromCamera(new THREE.Vector2(0, 0), camera);
  raycaster.far = range;
  const hits = raycaster.intersectObjects(shootables(), false);
  if (hits.length > 0) {
    const hit = hits[0];
    const target = targets.find((t) => t.userData.body === hit.object || t.userData.head === hit.object);
    if (target && target.userData.alive) {
      const headshot = hit.object === target.userData.head;
      const dmg = headshot ? w.dmgHead : w.dmgBody;
      target.userData.hp -= dmg;
      playHit();
      hud.hitmarker.classList.add('show');
      setTimeout(() => hud.hitmarker.classList.remove('show'), 90);
      if (target.userData.hp <= 0) {
        killTarget(target, headshot);
      }
    }
  }
  raycaster.far = Infinity;
}

function killTarget(target, headshot) {
  target.userData.alive = false;
  scene.remove(target);
  targets.splice(targets.indexOf(target), 1);
  addKillFeed(headshot ? '헤드샷 ✕' : '제거 ✕');
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

// ----- player health -------------------------------------------------------
const PLAYER_MAX_HP = 150;
let playerHp = PLAYER_MAX_HP;
let gameOver = false;

function updateHealthHud() {
  hud.hp.textContent = Math.max(0, Math.round(playerHp));
  hud.healthbarFill.style.width = `${Math.max(0, (playerHp / PLAYER_MAX_HP) * 100)}%`;
}
updateHealthHud();

function damagePlayer(amount) {
  if (gameOver) return;
  playerHp = Math.max(0, playerHp - amount);
  updateHealthHud();
  hud.flash.classList.add('show');
  setTimeout(() => hud.flash.classList.remove('show'), 120);
  if (playerHp <= 0) killPlayer();
}

function killPlayer() {
  gameOver = true;
  mouseDown = false;
  document.exitPointerLock();
  blockerTitle.textContent = 'YOU DIED';
  blockerSub.textContent = '클릭해서 다시 시작';
  blocker.classList.remove('hidden');
}

function respawnPlayer() {
  playerHp = PLAYER_MAX_HP;
  gameOver = false;
  yawObject.position.set(0, 1.7, 8);
  verticalVelocity = 0;
  updateHealthHud();
  blockerTitle.textContent = '1FPS';
  blockerSub.textContent = '클릭해서 게임 시작 (마우스 잠금)';
  for (const target of targets.slice()) killTarget(target, false);
  for (let i = 0; i < 4; i++) spawnRandomTarget();
}

blocker.addEventListener('click', () => {
  if (gameOver) respawnPlayer();
});

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

  const activeWeapon = weaponModels[currentWeaponKey];
  if (kickTimer > 0) {
    kickTimer -= dt;
    activeWeapon.position.z = kickBaseZ + 0.1 * (kickTimer / 0.08);
  } else {
    activeWeapon.position.z = kickBaseZ;
  }

  for (const key in weaponMuzzles) {
    const muzzle = weaponMuzzles[key];
    if (!muzzle) continue;
    muzzle.light.intensity *= Math.max(0, 1 - dt * 18);
    muzzle.sprite.material.opacity *= Math.max(0, 1 - dt * 18);
  }
}

function updateTargets(dt, t) {
  for (const target of targets) {
    target.userData.t += dt;
    target.position.x += Math.sin(target.userData.t * 0.6) * dt * 0.4;
    target.position.y = 0;
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
  const playerPos = new THREE.Vector3();
  camera.getWorldPosition(playerPos);

  for (const target of targets) {
    if (!target.userData.alive) continue;
    const dist = target.position.distanceTo(yawObject.position);
    target.userData.attackCooldown -= dt;

    if (dist < target.userData.attackRange) {
      const eyePos = target.position.clone();
      eyePos.y = 1.25;
      const lookTarget = new THREE.Vector3(yawObject.position.x, eyePos.y, yawObject.position.z);
      target.lookAt(lookTarget);

      if (target.userData.attackCooldown <= 0 && hasLineOfSight(eyePos, playerPos)) {
        target.userData.attackCooldown = 1.2 + Math.random() * 1.4;
        target.userData.muzzleLight.intensity = 3;
        setTimeout(() => { if (target.userData.muzzleLight) target.userData.muzzleLight.intensity = 0; }, 80);
        playEnemyShot();

        const accuracy = Math.max(0.25, 1 - dist / target.userData.attackRange);
        if (Math.random() < accuracy * 0.7) {
          damagePlayer(6 + Math.random() * 6);
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

  spawnTimer -= dt;
  if (spawnTimer <= 0) {
    spawnTimer = SPAWN_INTERVAL;
    spawnRandomTarget();
  }

  renderer.render(scene, camera);
}
for (let i = 0; i < 4; i++) spawnRandomTarget();
animate();
