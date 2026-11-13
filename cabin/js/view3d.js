// 3D 機艙（精緻低多邊形風格）：預設環繞視角（剖面）/ 第一人稱視角、起降環境、角色
import * as THREE from 'three';
import { SEAT_CLASS, PAX_TYPES, PRIORITY } from './data.js';
import { activeSeats } from './layout.js';

// 座標換算：模擬 (x 沿機身, y 橫向 左負) → three (x, 高, z = -y)
const P = (x, y, h = 0) => new THREE.Vector3(x, h, -y);
const CUT_H = 1.45; // 環繞視角的剖面高度（公尺）
const EYE_H = 1.62;

// ---------- 低多邊形工具：頂點色合併 ----------
const _q = new THREE.Quaternion(), _e = new THREE.Euler(), _v = new THREE.Vector3(), _s = new THREE.Vector3();
function M(x, y, z, rx = 0, ry = 0, rz = 0, sx = 1, sy = 1, sz = 1) {
  return new THREE.Matrix4().compose(_v.set(x, y, z), _q.setFromEuler(_e.set(rx, ry, rz)), _s.set(sx, sy, sz));
}
function part(geo, color, matrix) {
  const g = geo.index ? geo.toNonIndexed() : geo.clone();
  if (matrix) g.applyMatrix4(matrix);
  const c = new THREE.Color(color);
  const n = g.attributes.position.count;
  const col = new Float32Array(n * 3);
  for (let i = 0; i < n; i++) { col[i * 3] = c.r; col[i * 3 + 1] = c.g; col[i * 3 + 2] = c.b; }
  g.setAttribute('color', new THREE.BufferAttribute(col, 3));
  if (g.attributes.uv) g.deleteAttribute('uv');
  return g;
}
function merge(parts) {
  let n = 0;
  parts.forEach((p) => { n += p.attributes.position.count; });
  const pos = new Float32Array(n * 3), col = new Float32Array(n * 3);
  let o = 0;
  parts.forEach((p) => { pos.set(p.attributes.position.array, o * 3); col.set(p.attributes.color.array, o * 3); o += p.attributes.position.count; });
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.BufferAttribute(pos, 3));
  g.setAttribute('color', new THREE.BufferAttribute(col, 3));
  g.computeVertexNormals();
  return g;
}
const box = (w, h, d) => new THREE.BoxGeometry(w, h, d);
const shade = (hex, k) => '#' + new THREE.Color(hex).multiplyScalar(k).getHexString();
const hash = (s) => { let x = 0; for (const ch of String(s)) x = (x * 31 + ch.charCodeAt(0)) >>> 0; return x; };

// 圓角矩形 Shape
function roundRect(w, h, r) {
  const s = new THREE.Shape();
  const x = -w / 2, y = -h / 2;
  s.moveTo(x + r, y); s.lineTo(x + w - r, y); s.quadraticCurveTo(x + w, y, x + w, y + r);
  s.lineTo(x + w, y + h - r); s.quadraticCurveTo(x + w, y + h, x + w - r, y + h);
  s.lineTo(x + r, y + h); s.quadraticCurveTo(x, y + h, x, y + h - r);
  s.lineTo(x, y + r); s.quadraticCurveTo(x, y, x + r, y);
  return s;
}

// 沿機身方向掃掠剖面（points: [[r, h], ...]，side: +1 / -1 為 three z 方向）
function sweep(points, x0, x1, side) {
  const pos = [];
  for (let i = 0; i < points.length - 1; i++) {
    const [r0, h0] = points[i], [r1, h1] = points[i + 1];
    const a = [x0, h0, side * r0], b = [x1, h0, side * r0], c = [x1, h1, side * r1], d = [x0, h1, side * r1];
    pos.push(...a, ...b, ...c, ...a, ...c, ...d);
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  g.computeVertexNormals();
  return g;
}

// ---------- 色票 ----------
const C = {
  carpet: '#33415f', carpet2: '#3c4c6e', wall: '#eceef2', wallLow: '#dfe3ea', bin: '#f6f6f3', binLine: '#c9cfd8',
  ceiling: '#f3f4f7', frame: '#d4d9e1', metal: '#9aa3b1', metalDark: '#5d6573', plastic: '#d9dde4',
  headrest: '#ece6d8', hull: '#f4f6f9', belly: '#c3ccd8', galley: '#c8cdd6', lav: '#e4e7ec', door: '#e9ebef',
};
const SEAT_FABRIC = { J: '#4a3a6a', W: '#2b6a77', Y: '#2f4a7a' };

// ---------- 座位模型（原點在地板、面向 -x） ----------
function seatGeometry(cls, w, d) {
  const fab = SEAT_FABRIC[cls] || SEAT_FABRIC.Y;
  const parts = [];
  if (cls === 'J') {
    parts.push(part(box(d * 1.05, 0.9, 0.06), '#d8d1c3', M(0.05, 0.45, w / 2 - 0.03)));
    parts.push(part(box(d * 1.05, 0.9, 0.06), '#d8d1c3', M(0.05, 0.45, -w / 2 + 0.03)));
    parts.push(part(box(d * 0.8, 0.2, w * 0.82), shade(fab, 0.7), M(-0.02, 0.28, 0)));
    parts.push(part(box(d * 0.82, 0.16, w * 0.8), fab, M(-0.04, 0.46, 0)));
    parts.push(part(box(0.18, 0.95, w * 0.8), fab, M(d * 0.42, 0.98, 0, 0, 0, -0.18)));
    parts.push(part(box(0.2, 0.22, w * 0.55), shade(fab, 1.25), M(d * 0.42 + 0.1, 1.42, 0, 0, 0, -0.18)));
    parts.push(part(box(d * 0.55, 0.06, 0.16), '#b9a98d', M(-0.05, 0.68, w / 2 - 0.14)));
    parts.push(part(box(0.32, 0.3, w * 0.5), '#cfc6b4', M(-d * 0.62, 0.15, 0)));
    return merge(parts);
  }
  const lw = w * 0.36;
  for (const z of [-lw, lw]) {
    parts.push(part(box(0.05, 0.36, 0.05), C.metalDark, M(-d * 0.25, 0.18, z)));
    parts.push(part(box(0.05, 0.36, 0.05), C.metalDark, M(d * 0.25, 0.18, z)));
  }
  parts.push(part(box(d * 0.78, 0.06, w * 0.9), C.metalDark, M(0, 0.38, 0)));
  parts.push(part(box(d * 0.8, 0.13, w * 0.86), fab, M(-0.04, 0.47, 0)));
  parts.push(part(box(0.13, 0.8, w * 0.88), shade(fab, 0.92), M(d * 0.4, 0.9, 0, 0, 0, -0.14)));
  parts.push(part(box(0.05, 0.78, w * 0.9), C.plastic, M(d * 0.4 + 0.08, 0.89, 0, 0, 0, -0.14)));
  parts.push(part(box(0.15, 0.2, w * 0.66), C.headrest, M(d * 0.4 + 0.06, 1.2, 0, 0, 0, -0.14)));
  parts.push(part(box(d * 0.62, 0.045, 0.045), C.plastic, M(-0.02, 0.66, w / 2 - 0.02)));
  parts.push(part(box(0.04, 0.2, 0.04), C.metal, M(-d * 0.25, 0.56, w / 2 - 0.02)));
  return merge(parts);
}

// ---------- 旅客（坐姿，面向 -x） ----------
const SHIRTS = ['#c96b4b', '#4f7cac', '#7a9e7e', '#d4a34a', '#8a6fb3', '#d98aa0', '#5c6b7a', '#e0d6c2', '#3f8f8a', '#b5543f'];
const PANTS = ['#2f3440', '#4a4e5a', '#5b4b3a', '#33465e', '#6b6f78'];
const SKINS = ['#f1c9a5', '#e0ac7e', '#c68a5e', '#8d5a3b', '#f6d7bd'];
const HAIRS = ['#1f1611', '#3b2a1e', '#6b4a2f', '#a07a4a', '#2a2a2a'];
function passengerGeometry(p) {
  const h = hash(p.seat + p.name);
  const shirt = SHIRTS[h % SHIRTS.length], pants = PANTS[(h >> 3) % PANTS.length];
  let skin = SKINS[(h >> 5) % SKINS.length], hair = HAIRS[(h >> 7) % HAIRS.length];
  if (p.type === 'elder') hair = '#d6d3cc';
  if (p.type === 'drunk') skin = '#e79a8a';
  if (p.type === 'medical') skin = '#e6e1d6';
  const parts = [];
  parts.push(part(box(0.42, 0.13, 0.32), pants, M(-0.14, 0.58, 0)));
  parts.push(part(box(0.12, 0.44, 0.28), pants, M(-0.36, 0.33, 0)));
  parts.push(part(box(0.2, 0.06, 0.3), '#2a2a30', M(-0.42, 0.08, 0)));
  parts.push(part(box(0.24, 0.52, 0.38), shirt, M(0.12, 0.9, 0, 0, 0, -0.1)));
  parts.push(part(box(0.2, 0.14, 0.3), shirt, M(0.14, 1.12, 0, 0, 0, -0.1)));
  for (const z of [-0.21, 0.21]) {
    parts.push(part(box(0.1, 0.3, 0.09), shirt, M(0.1, 0.86, z, 0, 0, 0.2)));
    parts.push(part(box(0.3, 0.08, 0.08), shirt, M(-0.08, 0.7, z)));
    parts.push(part(new THREE.IcosahedronGeometry(0.045, 0), skin, M(-0.25, 0.7, z)));
  }
  parts.push(part(new THREE.CylinderGeometry(0.05, 0.06, 0.08, 6), skin, M(0.13, 1.22, 0)));
  parts.push(part(new THREE.IcosahedronGeometry(0.12, 1), skin, M(0.12, 1.36, 0, 0, 0, 0, 1, 1.1, 1)));
  parts.push(part(new THREE.IcosahedronGeometry(0.128, 1), hair, M(0.15, 1.4, 0, 0, 0, 0, 1, 0.95, 1.02)));
  if (p.type === 'vip') parts.push(part(box(0.02, 0.22, 0.05), '#c9a227', M(0.0, 0.98, 0)));
  if (p.type === 'child') parts.push(part(new THREE.IcosahedronGeometry(0.08, 0), '#f2c14e', M(-0.2, 0.75, 0.1)));
  const g = merge(parts);
  if (p.type === 'child') g.scale(0.72, 0.72, 0.72);
  return g;
}

// ---------- 空服員（可動畫，面向 +x） ----------
export function makeCrew(u) {
  const mat = (c, extra = {}) => new THREE.MeshStandardMaterial({ color: c, roughness: 0.75, flatShading: true, ...extra });
  const g = new THREE.Group();
  const pants = u.bottomType === 'pants';
  const legMat = mat(pants ? u.bottom : u.skin);
  const legs = [];
  for (const s of [-1, 1]) {
    const pivot = new THREE.Group();
    pivot.position.set(0, 0.9, s * 0.085);
    const leg = new THREE.Mesh(new THREE.CylinderGeometry(pants ? 0.07 : 0.055, 0.05, 0.84, 7), legMat);
    leg.position.y = -0.42;
    const shoe = new THREE.Mesh(box(0.2, 0.07, 0.09), mat('#1c1d22'));
    shoe.position.set(0.04, -0.85, 0);
    pivot.add(leg, shoe);
    g.add(pivot); legs.push(pivot);
  }
  if (!pants) {
    const skirt = new THREE.Mesh(new THREE.CylinderGeometry(0.165, 0.22, 0.48, 9), mat(u.bottom));
    skirt.position.y = 0.76; g.add(skirt);
  } else {
    const hip = new THREE.Mesh(new THREE.CylinderGeometry(0.17, 0.17, 0.16, 9), mat(u.bottom));
    hip.position.y = 0.92; g.add(hip);
  }
  const torsoPts = [[0.165, 0], [0.15, 0.1], [0.185, 0.32], [0.2, 0.46], [0.13, 0.56], [0.06, 0.58]].map(([r, y]) => new THREE.Vector2(r, y));
  const torso = new THREE.Mesh(new THREE.LatheGeometry(torsoPts, 9), mat(u.jacket));
  torso.position.y = 0.96; torso.scale.set(0.85, 1, 1); g.add(torso);
  const shirt = new THREE.Mesh(box(0.04, 0.2, 0.12), mat(u.shirt));
  shirt.position.set(0.165, 1.38, 0); shirt.rotation.z = 0.15; g.add(shirt);
  for (const y of [1.2, 1.08]) { const b = new THREE.Mesh(new THREE.IcosahedronGeometry(0.018, 0), mat('#d4b04c', { metalness: 0.6, roughness: 0.3 })); b.position.set(0.17, y, 0); g.add(b); }
  const wing = new THREE.Mesh(box(0.02, 0.025, 0.1), mat('#d4b04c', { metalness: 0.6, roughness: 0.3 }));
  wing.position.set(0.17, 1.42, -0.09); g.add(wing);
  const scarf = new THREE.Mesh(new THREE.TorusGeometry(0.075, 0.03, 6, 12), mat(u.scarf));
  scarf.rotation.x = Math.PI / 2; scarf.position.y = 1.53; g.add(scarf);
  for (const s of [-1, 1]) { const bow = new THREE.Mesh(new THREE.ConeGeometry(0.045, 0.12, 5), mat(u.scarf)); bow.position.set(0.1, 1.5, s * 0.05); bow.rotation.x = s * 1.2; g.add(bow); }
  const arms = [];
  for (const s of [-1, 1]) {
    const pivot = new THREE.Group();
    pivot.position.set(0, 1.47, s * 0.2);
    const upper = new THREE.Mesh(new THREE.CylinderGeometry(0.052, 0.046, 0.32, 6), mat(u.jacket));
    upper.position.y = -0.16;
    const fore = new THREE.Mesh(new THREE.CylinderGeometry(0.045, 0.04, 0.28, 6), mat(u.jacket));
    fore.position.set(0.02, -0.44, 0);
    const hand = new THREE.Mesh(new THREE.IcosahedronGeometry(0.045, 0), mat(u.skin));
    hand.position.set(0.03, -0.62, 0);
    pivot.add(upper, fore, hand);
    pivot.rotation.x = s * -0.06;
    g.add(pivot); arms.push(pivot);
  }
  const neck = new THREE.Mesh(new THREE.CylinderGeometry(0.045, 0.05, 0.1, 6), mat(u.skin)); neck.position.y = 1.58; g.add(neck);
  const head = new THREE.Mesh(new THREE.IcosahedronGeometry(0.125, 1), mat(u.skin)); head.position.y = 1.72; head.scale.set(0.95, 1.1, 0.9); g.add(head);
  for (const s of [-1, 1]) { const eye = new THREE.Mesh(box(0.012, 0.025, 0.025), mat('#2a211c')); eye.position.set(0.112, 1.73, s * 0.045); g.add(eye); }
  const hair = new THREE.Mesh(new THREE.IcosahedronGeometry(0.135, 1), mat(u.hair)); hair.position.set(-0.025, 1.77, 0); hair.scale.set(1, 0.85, 0.98); g.add(hair);
  if (!pants) { const bun = new THREE.Mesh(new THREE.IcosahedronGeometry(0.07, 1), mat(u.hair)); bun.position.set(-0.14, 1.72, 0); g.add(bun); }
  if (u.hat) {
    const hat = new THREE.Mesh(new THREE.CylinderGeometry(0.105, 0.12, 0.09, 10), mat(u.jacket)); hat.position.set(0.02, 1.9, 0); hat.rotation.z = -0.12; g.add(hat);
    const band = new THREE.Mesh(new THREE.CylinderGeometry(0.122, 0.122, 0.025, 10), mat(u.scarf)); band.position.set(0.02, 1.87, 0); band.rotation.z = -0.12; g.add(band);
    const badge = new THREE.Mesh(box(0.015, 0.03, 0.04), mat('#d4b04c', { metalness: 0.6, roughness: 0.3 })); badge.position.set(0.13, 1.9, 0); g.add(badge);
  }
  g.traverse((o) => { if (o.isMesh) { o.castShadow = true; } });
  g.userData.animate = (t, moving, seated) => {
    const sw = moving ? Math.sin(t * 9) * 0.55 : 0;
    legs[0].rotation.z = seated ? 1.45 : sw; legs[1].rotation.z = seated ? 1.45 : -sw;
    arms[0].rotation.z = seated ? 0.5 : -sw * 0.8; arms[1].rotation.z = seated ? 0.5 : sw * 0.8;
  };
  return g;
}

// ---------- 設施正面貼圖 ----------
function facadeTexture(type, label, accent) {
  const c = document.createElement('canvas'); c.width = 256; c.height = 256;
  const g = c.getContext('2d');
  const rr = (x, y, w, h, r) => { g.beginPath(); g.roundRect(x, y, w, h, r); };
  if (type === 'galley') {
    g.fillStyle = '#c3c9d2'; g.fillRect(0, 0, 256, 256);
    g.fillStyle = '#d5dae1'; for (let i = 0; i < 4; i++) { rr(8 + i * 62, 14, 54, 70, 4); g.fill(); }
    g.fillStyle = '#9aa3b1'; for (let i = 0; i < 4; i++) g.fillRect(28 + i * 62, 44, 14, 4);
    for (let i = 0; i < 3; i++) { g.fillStyle = '#e1e5ea'; rr(10 + i * 82, 104, 74, 144, 6); g.fill(); g.fillStyle = accent; g.fillRect(10 + i * 82, 116, 74, 6); g.fillStyle = '#7d8693'; g.fillRect(36 + i * 82, 140, 22, 6); }
  } else if (type === 'lav') {
    g.fillStyle = '#e4e7ec'; g.fillRect(0, 0, 256, 256);
    g.fillStyle = '#f2f3f6'; rr(40, 14, 176, 236, 10); g.fill();
    g.strokeStyle = '#c8ced6'; g.lineWidth = 4; g.stroke();
    g.fillStyle = '#3b4a63'; rr(92, 60, 72, 40, 6); g.fill();
    g.fillStyle = '#fff'; g.font = 'bold 26px system-ui'; g.textAlign = 'center'; g.fillText('WC', 128, 89);
    g.fillStyle = '#8a93a2'; g.fillRect(180, 130, 10, 34);
  } else if (type === 'door') {
    g.fillStyle = '#e9ebef'; g.fillRect(0, 0, 256, 256);
    g.strokeStyle = '#b6bcc6'; g.lineWidth = 6; rr(20, 8, 216, 240, 26); g.stroke();
    g.fillStyle = '#9ec2e6'; g.beginPath(); g.arc(128, 66, 26, 0, Math.PI * 2); g.fill();
    g.fillStyle = '#7a8291'; rr(150, 120, 60, 14, 6); g.fill();
    g.fillStyle = '#d9dde4'; rr(34, 178, 188, 58, 8); g.fill();
    g.fillStyle = '#c0392b'; g.fillRect(44, 190, 46, 10);
    g.fillStyle = '#5d6573'; g.font = 'bold 22px system-ui'; g.textAlign = 'center'; g.fillText(label || 'DOOR', 150, 216);
  } else if (type === 'cockpit') {
    g.fillStyle = '#d8dce3'; g.fillRect(0, 0, 256, 256);
    g.fillStyle = '#cdd2da'; rr(70, 16, 116, 236, 6); g.fill();
    g.fillStyle = '#5d6573'; g.beginPath(); g.arc(128, 70, 9, 0, Math.PI * 2); g.fill();
    g.fillStyle = '#8a93a2'; g.fillRect(160, 130, 10, 30);
  } else {
    g.fillStyle = '#c9c4b8'; g.fillRect(0, 0, 256, 256);
    g.strokeStyle = '#a9a396'; g.lineWidth = 4; g.strokeRect(16, 16, 224, 224);
  }
  const t = new THREE.CanvasTexture(c); t.colorSpace = THREE.SRGBColorSpace; return t;
}

function pillTexture(text, bg = 'rgba(14,20,34,0.82)', fg = '#fff') {
  const c = document.createElement('canvas');
  const g = c.getContext('2d');
  g.font = '600 34px "Noto Sans TC", system-ui, sans-serif';
  const w = Math.ceil(g.measureText(text).width) + 40;
  c.width = w; c.height = 56;
  g.font = '600 34px "Noto Sans TC", system-ui, sans-serif';
  g.fillStyle = bg; g.beginPath(); g.roundRect(0, 4, w, 48, 24); g.fill();
  g.fillStyle = fg; g.textAlign = 'center'; g.textBaseline = 'middle'; g.fillText(text, w / 2, 29);
  const t = new THREE.CanvasTexture(c); t.colorSpace = THREE.SRGBColorSpace;
  return { tex: t, aspect: w / 56 };
}

export class View3D {
  constructor(container, app) {
    this.app = app;
    this.container = container;
    this.renderer = new THREE.WebGLRenderer({ antialias: true });
    this.renderer.setPixelRatio(Math.min(2, window.devicePixelRatio || 1));
    this.renderer.outputColorSpace = THREE.SRGBColorSpace;
    this.renderer.toneMapping = THREE.ACESFilmicToneMapping;
    this.renderer.toneMappingExposure = 1.05;
    this.renderer.shadowMap.enabled = true;
    this.renderer.shadowMap.type = THREE.PCFSoftShadowMap;
    this.renderer.localClippingEnabled = true;
    container.appendChild(this.renderer.domElement);
    this.scene = new THREE.Scene();
    this.camera = new THREE.PerspectiveCamera(55, 1, 0.05, 6000);
    this.mode = 'orbit';
    this.orbit = { yaw: -2.25, pitch: 0.8, dist: 18, target: new THREE.Vector3(10, 0, 0) };
    this.fp = { yaw: 0, pitch: -0.05 };
    this.keys = {};
    this.layoutKey = null;
    this.paxMeshes = new Map();
    this.markers = new Map();
    this.labels = [];
    this.clipLocal = new THREE.Plane(new THREE.Vector3(0, -1, 0), CUT_H);
    this.clipWorld = new THREE.Plane();
    this.clipMats = [];
    this.lastWalker = null;

    this.scene.fog = new THREE.Fog(0xbfd6ee, 80, 1400);
    this.hemi = new THREE.HemisphereLight(0xe8eeff, 0x9c938a, 1.0);
    this.scene.add(this.hemi);
    this.sun = new THREE.DirectionalLight(0xfff3e0, 2.2);
    this.sun.castShadow = true;
    this.sun.shadow.mapSize.set(2048, 2048);
    this.sun.shadow.bias = -0.0004;
    this.sun.shadow.normalBias = 0.02;
    this.scene.add(this.sun, this.sun.target);

    this.cabin = new THREE.Group(); // 隨俯仰角傾斜
    this.scene.add(this.cabin);
    this.eye = new THREE.Object3D();
    this.cabin.add(this.eye);

    this.skyCanvas = document.createElement('canvas'); this.skyCanvas.width = 4; this.skyCanvas.height = 256;
    this.skyTex = new THREE.CanvasTexture(this.skyCanvas); this.skyTex.colorSpace = THREE.SRGBColorSpace;
    this.scene.background = this.skyTex;
    this.skyKey = '';

    this.buildEnvironment();
    this.bind();
  }

  clipMat(params) {
    const m = new THREE.MeshStandardMaterial({ roughness: 0.8, side: THREE.DoubleSide, ...params });
    m.clippingPlanes = this.mode === 'fp' ? [] : [this.clipWorld];
    this.clipMats.push(m);
    return m;
  }

  // ---------- 外部環境：機場、跑道、雲 ----------
  buildEnvironment() {
    const c = document.createElement('canvas'); c.width = 512; c.height = 256;
    const g = c.getContext('2d');
    g.fillStyle = '#6d7a5c'; g.fillRect(0, 0, 512, 256);
    g.fillStyle = '#4a4d55'; g.fillRect(0, 70, 512, 116);
    g.fillStyle = '#545861'; for (let i = 0; i < 40; i++) g.fillRect(Math.random() * 512, 70 + Math.random() * 116, 30, 2);
    g.fillStyle = '#f2f2f2'; for (let x = 0; x < 512; x += 64) g.fillRect(x, 125, 34, 6);
    g.fillRect(0, 76, 512, 4); g.fillRect(0, 176, 512, 4);
    g.fillStyle = '#e0c25a'; for (let x = 20; x < 512; x += 128) { g.beginPath(); g.arc(x, 74, 2.5, 0, 7); g.fill(); g.beginPath(); g.arc(x, 182, 2.5, 0, 7); g.fill(); }
    this.groundTex = new THREE.CanvasTexture(c);
    this.groundTex.wrapS = this.groundTex.wrapT = THREE.RepeatWrapping;
    this.groundTex.repeat.set(30, 1);
    this.groundTex.colorSpace = THREE.SRGBColorSpace;
    this.groundTex.anisotropy = 4;
    const runway = new THREE.Mesh(new THREE.PlaneGeometry(6000, 90), new THREE.MeshStandardMaterial({ map: this.groundTex, roughness: 0.95 }));
    runway.rotation.x = -Math.PI / 2; runway.receiveShadow = true;
    const grass = new THREE.Mesh(new THREE.PlaneGeometry(12000, 12000), new THREE.MeshStandardMaterial({ color: 0x6f8457, roughness: 1 }));
    grass.rotation.x = -Math.PI / 2; grass.position.y = -0.05; grass.receiveShadow = true;
    this.groundGroup = new THREE.Group();
    this.groundGroup.add(grass, runway);
    // 遠方航廈與樹（低多邊形）
    const bm = new THREE.MeshStandardMaterial({ color: 0xc9cfd8, roughness: 0.9, flatShading: true });
    const gm = new THREE.MeshStandardMaterial({ color: 0x8fb3d9, roughness: 0.3, metalness: 0.2, flatShading: true });
    for (let i = 0; i < 6; i++) {
      const b = new THREE.Mesh(box(40 + i * 7, 10 + (i % 3) * 5, 22), i % 2 ? gm : bm);
      b.position.set(-200 + i * 70, 6, -140 - (i % 2) * 20); this.groundGroup.add(b);
    }
    const tower = new THREE.Mesh(new THREE.CylinderGeometry(3, 4, 40, 8), bm); tower.position.set(160, 20, -170); this.groundGroup.add(tower);
    const cab = new THREE.Mesh(new THREE.CylinderGeometry(7, 5, 6, 8), gm); cab.position.set(160, 42, -170); this.groundGroup.add(cab);
    const tm = new THREE.MeshStandardMaterial({ color: 0x4f7a4a, flatShading: true, roughness: 1 });
    for (let i = 0; i < 60; i++) {
      const t = new THREE.Mesh(new THREE.ConeGeometry(3 + Math.random() * 2, 8 + Math.random() * 6, 6), tm);
      t.position.set(Math.random() * 1600 - 800, 5, (Math.random() > 0.5 ? 1 : -1) * (90 + Math.random() * 300)); this.groundGroup.add(t);
    }
    this.scene.add(this.groundGroup);

    this.clouds = new THREE.Group();
    const cm = new THREE.MeshStandardMaterial({ color: 0xffffff, roughness: 1, flatShading: true, transparent: true, opacity: 0.95 });
    for (let i = 0; i < 45; i++) {
      const cl = new THREE.Group();
      const n = 3 + Math.floor(Math.random() * 4);
      for (let k = 0; k < n; k++) {
        const m = new THREE.Mesh(new THREE.IcosahedronGeometry(6 + Math.random() * 9, 0), cm);
        m.position.set(k * 9 - n * 4, Math.random() * 4, Math.random() * 8 - 4); m.scale.y = 0.6;
        cl.add(m);
      }
      cl.position.set(Math.random() * 1800 - 900, -25 - Math.random() * 50, (Math.random() - 0.5) * 1000);
      this.clouds.add(cl);
    }
    this.scene.add(this.clouds);

    this.winCanvas = document.createElement('canvas'); this.winCanvas.width = 48; this.winCanvas.height = 72;
    this.winTex = new THREE.CanvasTexture(this.winCanvas);
    this.winTex.colorSpace = THREE.SRGBColorSpace;
    this.winMat = new THREE.MeshBasicMaterial({ map: this.winTex });
  }

  // ---------- 機艙幾何 ----------
  rebuild(force = false) {
    const ac = this.app.aircraft();
    const sc = this.app.scenario();
    const prof = this.app.state.profile;
    const key = JSON.stringify([ac.id, ac.length, ac.width, ac.seats.length, ac.seats.filter((s) => s.removed).length, ac.fixtures.map((f) => [f.x, f.y, f.w, f.d, f.type, f.label]),
      ac.seats.map((s) => s.cls + s.x.toFixed(2) + s.y.toFixed(2)).join(''), sc && sc.passengers.map((p) => p.seat + p.type).join(','), prof.uniform, prof.airline]);
    if (!force && key === this.layoutKey) return;
    this.layoutKey = key;
    this.cabin.clear();
    this.cabin.add(this.eye);
    this.clipMats = [];
    this.paxMeshes.clear();
    this.markers.clear();
    this.labels = [];
    this.npcMeshes = new Map();
    this.lightStrips = [];
    const L = ac.length, W = ac.width, R = W / 2;
    const uni = prof.uniform;
    const accent = uni.scarf;

    // 地板與地毯
    const cc = document.createElement('canvas'); cc.width = 128; cc.height = 128;
    const cg = cc.getContext('2d');
    cg.fillStyle = C.carpet; cg.fillRect(0, 0, 128, 128);
    cg.fillStyle = C.carpet2; for (let i = 0; i < 128; i += 16) for (let j = (i / 16) % 2 * 8; j < 128; j += 16) cg.fillRect(i + 6, j + 6, 4, 4);
    const carpetTex = new THREE.CanvasTexture(cc); carpetTex.wrapS = carpetTex.wrapT = THREE.RepeatWrapping; carpetTex.repeat.set(L / 1.2, W / 1.2); carpetTex.colorSpace = THREE.SRGBColorSpace;
    const floor = new THREE.Mesh(new THREE.PlaneGeometry(L, W), new THREE.MeshStandardMaterial({ map: carpetTex, roughness: 1 }));
    floor.rotation.x = -Math.PI / 2; floor.position.set(L / 2, 0.002, 0); floor.receiveShadow = true;
    this.cabin.add(floor);

    // 側牆剖面（下段 + 上段曲面）、行李櫃、天花板
    const wallPts = [[R, 0], [R + 0.03, 0.3], [R + 0.04, 0.95], [R, 1.35], [R - 0.1, 1.6]];
    const glow = { emissive: '#fff4e2', emissiveIntensity: 0.22 };
    const wallMat = this.clipMat({ color: C.wall, ...glow });
    const kick = this.clipMat({ color: C.wallLow });
    const binMat = this.clipMat({ color: C.bin, flatShading: true, ...glow });
    const ceilMat = this.clipMat({ color: C.ceiling, ...glow });
    this.glowMats = [wallMat, binMat, ceilMat];
    for (const s of [-1, 1]) {
      this.cabin.add(new THREE.Mesh(sweep([[R, 0], [R + 0.03, 0.3]], 0, L, s), kick));
      this.cabin.add(new THREE.Mesh(sweep(wallPts.slice(1), 0, L, s), wallMat));
      const binPts = [[R - 0.1, 1.6], [R - 0.62, 1.66], [R - 0.68, 1.8], [R - 0.66, 1.98], [R - 0.5, 2.06]];
      this.cabin.add(new THREE.Mesh(sweep(binPts, 2.4, L - 1.6, s), binMat));
      const binFace = new THREE.Mesh(sweep([[R - 0.1, 1.6], [R - 0.1, 2.06], [R - 0.5, 2.06]], 2.4, L - 1.6, s), binMat);
      this.cabin.add(binFace);
      this.cabin.add(new THREE.Mesh(sweep([[R - 0.5, 2.06], [R * 0.45, 2.24], [0, 2.28]], 0, L, s), ceilMat));
      // 行李櫃分隔線
      const lineMat = this.clipMat({ color: C.binLine });
      for (let x = 3.2; x < L - 1.8; x += 1.6) {
        const line = new THREE.Mesh(box(0.012, 0.3, 0.02), lineMat);
        line.position.set(x, 1.82, s * (R - 0.675)); this.cabin.add(line);
      }
      // 頂燈燈帶
      const strip = new THREE.Mesh(box(L - 3, 0.025, 0.06), new THREE.MeshBasicMaterial({ color: 0xfff2d8 }));
      strip.position.set(L / 2 + 0.5, 2.12, s * (R - 0.48)); strip.userData.ceiling = true;
      this.cabin.add(strip);
      this.lightStrips.push(strip);
    }
    // 雙走道機型的中央行李櫃
    if (W > 4.6) {
      const cb = new THREE.Mesh(box(L - 8, 0.4, 1.4), binMat);
      cb.position.set(L / 2 + 1, 1.92, 0); this.cabin.add(cb);
    }

    // 窗戶（窗框 + 窗景）
    const frameShape = roundRect(0.32, 0.44, 0.12);
    frameShape.holes.push(roundRect(0.22, 0.33, 0.09));
    const frameGeo = new THREE.ExtrudeGeometry(frameShape, { depth: 0.03, bevelEnabled: false, curveSegments: 4 });
    const paneGeo = new THREE.ShapeGeometry(roundRect(0.22, 0.33, 0.09), 4);
    const shadeGeo = new THREE.PlaneGeometry(0.22, 0.08);
    const frameMat = this.clipMat({ color: C.frame });
    const shadeMat = this.clipMat({ color: '#e8e9ec' });
    const xs = []; for (let x = 3.2; x < L - 1.6; x += 0.53) if (!ac.fixtures.some((f) => f.type === 'door' && Math.abs(f.x - x) < f.w / 2 + 0.2)) xs.push(x);
    for (const s of [-1, 1]) {
      const fr = new THREE.InstancedMesh(frameGeo, frameMat, xs.length);
      const pn = new THREE.InstancedMesh(paneGeo, this.winMat, xs.length);
      const sh = new THREE.InstancedMesh(shadeGeo, shadeMat, xs.length);
      xs.forEach((x, i) => {
        const r = R + 0.035;
        fr.setMatrixAt(i, M(x, 1.15, s * (r - 0.03), 0, s > 0 ? Math.PI : 0, 0));
        pn.setMatrixAt(i, M(x, 1.15, s * (r - 0.005), 0, s > 0 ? Math.PI : 0, 0));
        sh.setMatrixAt(i, M(x, 1.28, s * (r - 0.012), 0, s > 0 ? Math.PI : 0, 0));
      });
      this.cabin.add(fr, pn, sh);
    }

    // 機身外殼（剖面）、機鼻、機尾、機翼、尾翼
    const RO = R + 0.32, CY = 1.0;
    const hullMat = this.clipMat({ color: C.hull, roughness: 0.45, metalness: 0.05, side: THREE.DoubleSide });
    const tube = new THREE.Mesh(new THREE.CylinderGeometry(RO, RO, L, 40, 1, true), hullMat);
    tube.rotation.z = Math.PI / 2; tube.position.set(L / 2, CY, 0);
    this.cabin.add(tube);
    const belly = new THREE.Mesh(new THREE.CylinderGeometry(RO + 0.005, RO + 0.005, L, 40, 1, true, Math.PI * 1.25, Math.PI * 0.5), this.clipMat({ color: C.belly, roughness: 0.5 }));
    belly.rotation.z = Math.PI / 2; belly.position.set(L / 2, CY, 0);
    this.cabin.add(belly);
    // 剖面切口（地板下貨艙與牆體厚度）
    const cutMat = new THREE.MeshStandardMaterial({ color: 0x3a4152, roughness: 0.9 });
    for (const s of [-1, 1]) {
      const cap = new THREE.Mesh(box(L, 0.02, RO - R - 0.02), cutMat);
      cap.position.set(L / 2, CUT_H - 0.01, s * (R + (RO - R) / 2 + 0.01)); cap.userData.cutaway = true;
      this.cabin.add(cap);
      const a0 = Math.asin((0.5 - CY) / RO), a1 = Math.asin((0.72 - CY) / RO);
      const stripe = new THREE.Mesh(new THREE.CylinderGeometry(RO + 0.01, RO + 0.01, L, 40, 1, true, s > 0 ? a0 : Math.PI - a1, a1 - a0), this.clipMat({ color: accent, roughness: 0.4 }));
      stripe.rotation.z = Math.PI / 2; stripe.position.set(L / 2, CY, 0);
      this.cabin.add(stripe);
    }
    const subfloor = new THREE.Mesh(box(L, 0.12, W + 0.1), new THREE.MeshStandardMaterial({ color: 0x8a919c, roughness: 0.9 }));
    subfloor.position.set(L / 2, -0.07, 0); this.cabin.add(subfloor);
    const noseLen = RO * 2.1;
    const nosePts = []; for (let i = 0; i <= 10; i++) { const t = i / 10; nosePts.push(new THREE.Vector2(RO * Math.sqrt(Math.max(0, 1 - t * t)) * (1 - 0.08 * t), t * noseLen)); }
    const nose = new THREE.Mesh(new THREE.LatheGeometry(nosePts, 40), hullMat);
    nose.rotation.z = Math.PI / 2; nose.position.set(0, CY, 0);
    this.cabin.add(nose);
    const tailLen = RO * 3.2;
    const tailPts = []; for (let i = 0; i <= 10; i++) { const t = i / 10; tailPts.push(new THREE.Vector2(RO * (1 - t * 0.85), t * tailLen)); }
    const tailGeo = new THREE.LatheGeometry(tailPts, 32);
    tailGeo.rotateZ(-Math.PI / 2);
    const tp = tailGeo.attributes.position;
    for (let i = 0; i < tp.count; i++) tp.setY(i, tp.getY(i) + Math.pow(Math.max(0, tp.getX(i)) / tailLen, 1.6) * RO * 0.75);
    tailGeo.computeVertexNormals();
    const tail = new THREE.Mesh(tailGeo, hullMat);
    tail.position.set(L, CY, 0);
    this.cabin.add(tail);
    // 尾翼（航空公司塗裝）
    const finShape = new THREE.Shape();
    const fh = RO * 2.6;
    finShape.moveTo(0, 0); finShape.lineTo(tailLen * 0.75, 0); finShape.lineTo(tailLen * 1.02, fh); finShape.lineTo(tailLen * 0.78, fh); finShape.lineTo(0, 0);
    const fin = new THREE.Mesh(new THREE.ExtrudeGeometry(finShape, { depth: 0.18, bevelEnabled: false }), new THREE.MeshStandardMaterial({ color: uni.jacket, roughness: 0.5, flatShading: true }));
    fin.position.set(L + tailLen * 0.05, CY + RO * 0.85, -0.09); this.cabin.add(fin);
    const { tex: logoTex, aspect } = pillTexture(prof.airline || '', 'rgba(0,0,0,0)', '#ffffff');
    for (const s of [-1, 1]) {
      const logo = new THREE.Mesh(new THREE.PlaneGeometry(fh * 0.38 * aspect * 0.35, fh * 0.38 * 0.35), new THREE.MeshBasicMaterial({ map: logoTex, transparent: true }));
      logo.position.set(L + tailLen * 0.62, CY + RO * 0.85 + fh * 0.45, s * 0.1); logo.rotation.y = s > 0 ? 0 : Math.PI; logo.rotation.z = 0.35 * s * 0;
      this.cabin.add(logo);
      const disc = new THREE.Mesh(new THREE.CircleGeometry(fh * 0.13, 20), new THREE.MeshBasicMaterial({ color: accent }));
      disc.position.set(L + tailLen * 0.78, CY + RO * 0.85 + fh * 0.72, s * 0.1); disc.rotation.y = s > 0 ? 0 : Math.PI;
      this.cabin.add(disc);
    }
    const stabShape = new THREE.Shape();
    stabShape.moveTo(0, 0); stabShape.lineTo(tailLen * 0.55, 0); stabShape.lineTo(tailLen * 0.7, RO * 2.4); stabShape.lineTo(tailLen * 0.5, RO * 2.4); stabShape.lineTo(0, 0);
    const wingMat = new THREE.MeshStandardMaterial({ color: 0xdfe4ea, roughness: 0.5, flatShading: true, side: THREE.DoubleSide });
    for (const s of [-1, 1]) {
      const st = new THREE.Mesh(new THREE.ExtrudeGeometry(stabShape, { depth: 0.12, bevelEnabled: false }), wingMat);
      st.rotation.x = Math.PI / 2 * s; st.position.set(L + tailLen * 0.25, CY + RO * 0.6, s * RO * 0.3); this.cabin.add(st);
    }
    // 主翼與引擎
    const span = Math.max(W * 3.2, 10), chord = Math.max(4, L * 0.16);
    const wingShape = new THREE.Shape();
    wingShape.moveTo(0, 0); wingShape.lineTo(chord, 0); wingShape.lineTo(chord + span * 0.55, span); wingShape.lineTo(chord * 0.35 + span * 0.55, span); wingShape.lineTo(0, 0);
    const wx = L * 0.42;
    for (const s of [-1, 1]) {
      const wg = new THREE.Mesh(new THREE.ExtrudeGeometry(wingShape, { depth: 0.25, bevelEnabled: false }), wingMat);
      wg.rotation.x = Math.PI / 2 * s; wg.position.set(wx, -0.55, s * RO * 0.6); wg.castShadow = true;
      this.cabin.add(wg);
      const eng = new THREE.Mesh(new THREE.CylinderGeometry(RO * 0.42, RO * 0.36, chord * 0.75, 16), new THREE.MeshStandardMaterial({ color: 0xe8ecf1, roughness: 0.4, flatShading: true }));
      eng.rotation.z = Math.PI / 2; eng.position.set(wx + chord * 0.15 + span * 0.12, -1.2, s * (RO + span * 0.28)); eng.castShadow = true;
      this.cabin.add(eng);
      const intake = new THREE.Mesh(new THREE.CircleGeometry(RO * 0.36, 16), new THREE.MeshStandardMaterial({ color: 0x2b2f38 }));
      intake.rotation.y = -Math.PI / 2; intake.position.set(eng.position.x - chord * 0.375 - 0.01, -1.2, eng.position.z);
      this.cabin.add(intake);
    }

    // 座位（依艙等與尺寸分組，用 InstancedMesh）
    const seats = activeSeats(ac);
    const groups = new Map();
    seats.forEach((s) => { const k = `${s.cls}|${s.w.toFixed(2)}|${s.d.toFixed(2)}`; if (!groups.has(k)) groups.set(k, []); groups.get(k).push(s); });
    const seatMat = new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.85, flatShading: true });
    groups.forEach((list, k) => {
      const [cls, w, d] = k.split('|');
      const im = new THREE.InstancedMesh(seatGeometry(cls, +w / 0.92, +d), seatMat, list.length);
      list.forEach((s, i) => im.setMatrixAt(i, M(s.x, 0, -s.y)));
      im.castShadow = true; im.receiveShadow = true;
      this.cabin.add(im);
    });
    // 每排的 PSU 與安全帶燈（第一人稱可見）
    this.signs = [];
    const signMat = new THREE.MeshBasicMaterial({ color: 0x333333 });
    const rowXs = [...new Set(seats.map((s) => s.x.toFixed(2)))].map(Number);
    rowXs.forEach((x, i) => {
      if (i % 3) return;
      for (const s of [-1, 1]) {
        const sg = new THREE.Mesh(box(0.1, 0.03, 0.16), signMat);
        sg.position.set(x, 1.645, s * (R - 0.42)); sg.userData.ceiling = true;
        this.cabin.add(sg);
      }
    });
    this.signMat = signMat;

    // 設施
    ac.fixtures.forEach((f) => this.addFixture(f, ac, accent));

    // 旅客
    const paxMat = new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.8, flatShading: true });
    if (sc) sc.passengers.forEach((p) => {
      const s = seats.find((z) => z.id === p.seat);
      if (!s) return;
      const g = new THREE.Group();
      const body = new THREE.Mesh(passengerGeometry(p), paxMat);
      body.castShadow = true;
      g.add(body);
      const ind = new THREE.Mesh(new THREE.TorusGeometry(0.07, 0.022, 6, 16), new THREE.MeshBasicMaterial({ color: 0x45c46b }));
      ind.rotation.x = Math.PI / 2; ind.position.set(0.12, p.type === 'child' ? 1.25 : 1.68, 0); ind.userData.label = true;
      g.add(ind);
      const t = PAX_TYPES[p.type];
      if (p.type !== 'normal' && t) {
        const em = document.createElement('canvas'); em.width = 64; em.height = 64;
        const eg = em.getContext('2d'); eg.fillStyle = 'rgba(255,255,255,0.92)'; eg.beginPath(); eg.arc(32, 32, 30, 0, 7); eg.fill();
        eg.font = '36px system-ui'; eg.textAlign = 'center'; eg.textBaseline = 'middle'; eg.fillText(t.icon, 32, 35);
        const tx = new THREE.CanvasTexture(em); tx.colorSpace = THREE.SRGBColorSpace;
        const sp = new THREE.Sprite(new THREE.SpriteMaterial({ map: tx, depthTest: false }));
        sp.scale.set(0.3, 0.3, 1); sp.position.set(0.12, (p.type === 'child' ? 1.25 : 1.68) + 0.25, 0); sp.renderOrder = 9; sp.userData.label = true;
        g.add(sp);
      }
      g.position.copy(P(s.x, s.y, 0));
      g.userData.ind = ind;
      this.cabin.add(g);
      this.paxMeshes.set(p.seat, g);
    });

    // 玩家角色
    this.player = makeCrew(uni);
    this.cabin.add(this.player);

    this.cabin.traverse((o) => { if (o.isMesh && o.userData.receive !== false && !o.material.isMeshBasicMaterial) o.receiveShadow = true; });
    this.applyMode();
  }

  addFixture(f, ac, accent) {
    const pos = P(f.x, f.y, 0);
    const R = ac.width / 2;
    // 正面朝向：靠牆的設施朝中線，置中的朝客艙中段
    let face; // three 空間的法向量
    if (Math.abs(f.y) > 0.3 && f.d < ac.width * 0.8) face = new THREE.Vector3(0, 0, f.y < 0 ? -1 : 1);
    else face = new THREE.Vector3(f.x < ac.length / 2 ? 1 : -1, 0, 0);
    const lookY = Math.atan2(face.x, face.z); // 讓 +z 朝向 face
    const addFront = (w, h, depth, tex) => {
      const pl = new THREE.Mesh(new THREE.PlaneGeometry(w, h), this.clipMat({ map: tex, side: THREE.FrontSide }));
      pl.position.copy(pos).addScaledVector(face, depth / 2 + 0.006); pl.position.y = h / 2;
      pl.rotation.y = lookY;
      this.cabin.add(pl);
    };
    const frontW = Math.abs(face.x) > 0.5 ? f.d : f.w, depth = Math.abs(face.x) > 0.5 ? f.w : f.d;
    if (f.type === 'galley' || f.type === 'lav' || f.type === 'closet') {
      const h = 2.0;
      const m = new THREE.Mesh(box(f.w, h, f.d), this.clipMat({ color: f.type === 'galley' ? C.galley : f.type === 'lav' ? C.lav : '#cdc6b6', flatShading: true }));
      m.position.copy(pos); m.position.y = h / 2; m.castShadow = true;
      this.cabin.add(m);
      addFront(frontW * 0.96, h * 0.96, depth, facadeTexture(f.type, f.label, accent));
      if (f.type === 'galley') {
        const top = new THREE.Mesh(box(f.w + 0.02, 0.04, f.d + 0.02), this.clipMat({ color: '#e9ecf0' }));
        top.position.copy(pos); top.position.y = 1.05; this.cabin.add(top);
      }
    } else if (f.type === 'door') {
      const h = 1.9;
      const fr = new THREE.Mesh(box(f.w + 0.16, h + 0.12, 0.06), this.clipMat({ color: '#c3c9d2' }));
      fr.position.copy(pos); fr.position.y = (h + 0.12) / 2; fr.position.z = Math.sign(pos.z || 1) * (R + 0.02);
      this.cabin.add(fr);
      const dt = facadeTexture('door', f.label, accent);
      const door = new THREE.Mesh(new THREE.PlaneGeometry(f.w, h), this.clipMat({ map: dt, side: THREE.FrontSide }));
      door.position.set(pos.x, h / 2, Math.sign(pos.z || 1) * (R - 0.015));
      door.rotation.y = pos.z > 0 ? Math.PI : 0;
      this.cabin.add(door);
      this.doors = this.doors || [];
    } else if (f.type === 'jumpseat') {
      const parts = [
        part(box(0.42, 0.08, 0.36), '#3c4558', M(0, 0.48, 0)),
        part(box(0.06, 0.62, 0.4), '#3c4558', M(0.2, 0.78, 0)),
        part(box(0.02, 0.5, 0.05), accent, M(-0.02, 0.8, 0.12)),
        part(box(0.02, 0.5, 0.05), accent, M(-0.02, 0.8, -0.12)),
        part(box(0.08, 1.2, 0.44), '#cfd4dc', M(0.25, 0.6, 0)),
      ];
      const m = new THREE.Mesh(merge(parts), this.clipMat({ vertexColors: true, flatShading: true }));
      m.position.copy(pos);
      m.rotation.y = Math.PI; // 面向機尾
      m.castShadow = true;
      this.cabin.add(m);
    } else if (f.type === 'cockpit') {
      // 駕駛艙：隔板與艙門、兩張駕駛座、儀表板
      const bulk = new THREE.Mesh(box(0.1, 2.25, ac.width), this.clipMat({ color: '#d8dce3' }));
      bulk.position.set(f.x + f.w / 2, 1.12, 0); this.cabin.add(bulk);
      const pl = new THREE.Mesh(new THREE.PlaneGeometry(1.0, 2.0), this.clipMat({ map: facadeTexture('cockpit'), side: THREE.FrontSide }));
      pl.position.set(f.x + f.w / 2 + 0.056, 1.0, 0); pl.rotation.y = Math.PI / 2; this.cabin.add(pl);
      const fl = new THREE.Mesh(box(f.w, 0.05, ac.width * 0.9), new THREE.MeshStandardMaterial({ color: 0x4a5266 }));
      fl.position.set(f.x, 0.02, 0); this.cabin.add(fl);
      for (const z of [-0.45, 0.45]) {
        const st = new THREE.Mesh(merge([part(box(0.5, 0.12, 0.5), '#6b6f7d', M(0, 0.5, 0)), part(box(0.1, 0.8, 0.5), '#6b6f7d', M(0.24, 0.95, 0, 0, 0, -0.1)), part(box(0.12, 0.25, 0.42), '#e6e1d6', M(0.26, 1.28, 0, 0, 0, -0.1)), part(box(0.3, 0.45, 0.2), '#9aa3b1', M(0, 0.22, 0))]),
          this.clipMat({ vertexColors: true, flatShading: true }));
        st.position.set(f.x + 0.2, 0, z); this.cabin.add(st);
      }
      const dash = new THREE.Mesh(box(0.5, 0.9, ac.width * 0.8), this.clipMat({ color: '#5a6378', flatShading: true }));
      dash.position.set(f.x - f.w / 2 + 0.25, 0.75, 0); this.cabin.add(dash);
      const scr = new THREE.Mesh(new THREE.PlaneGeometry(ac.width * 0.7, 0.3), new THREE.MeshBasicMaterial({ color: 0x3c7fd1 }));
      scr.position.set(f.x - f.w / 2 + 0.51, 1.0, 0); scr.rotation.y = Math.PI / 2; this.cabin.add(scr);
    } else {
      const m = new THREE.Mesh(box(f.w, 1.3, f.d), this.clipMat({ color: '#5d6578' }));
      m.position.copy(pos); m.position.y = 0.65; this.cabin.add(m);
    }
    if (f.label && f.type !== 'jumpseat') this.cabin.add(this.label(f.label, P(f.x, f.y, f.type === 'door' ? 2.15 : 2.3), 0.7));
  }

  label(text, pos, size = 1) {
    const { tex, aspect } = pillTexture(text);
    const sp = new THREE.Sprite(new THREE.SpriteMaterial({ map: tex, depthTest: false, transparent: true }));
    sp.scale.set(0.3 * aspect * size, 0.3 * size, 1); sp.position.copy(pos); sp.renderOrder = 10;
    sp.userData.label = true;
    this.labels.push(sp);
    return sp;
  }

  applyMode() {
    const fp = this.mode === 'fp';
    this.clipMats.forEach((m) => { m.clippingPlanes = fp ? [] : [this.clipWorld]; m.needsUpdate = true; });
    this.cabin.traverse((o) => {
      if (o.userData.ceiling) o.visible = fp;
      if (o.userData.cutaway) o.visible = !fp;
      if (o.isSprite && o.userData.label) o.visible = !fp;
    });
  }

  setMode(mode) {
    this.mode = mode;
    this.applyMode();
    if (mode !== 'fp' && document.pointerLockElement) document.exitPointerLock();
  }

  // ---------- 操作 ----------
  bind() {
    const el = this.renderer.domElement;
    let drag = null;
    el.addEventListener('contextmenu', (e) => e.preventDefault());
    el.addEventListener('pointerdown', (e) => {
      if (this.mode === 'fp') {
        if (!document.pointerLockElement && el.requestPointerLock) { try { const r = el.requestPointerLock(); if (r && r.catch) r.catch(() => {}); } catch (er) { /* 不支援時忽略 */ } }
        drag = { x: e.clientX, y: e.clientY, fpDrag: true };
        return;
      }
      drag = { x: e.clientX, y: e.clientY, btn: e.button, moved: false };
    });
    window.addEventListener('pointermove', (e) => {
      if (this.mode === 'fp') {
        if (document.pointerLockElement === el) {
          this.fp.yaw -= e.movementX * 0.0025;
          this.fp.pitch = Math.max(-1.2, Math.min(1.2, this.fp.pitch - e.movementY * 0.0025));
        } else if (drag && drag.fpDrag) { // 無法鎖定滑鼠時改用拖曳轉頭
          this.fp.yaw -= (e.clientX - drag.x) * 0.004;
          this.fp.pitch = Math.max(-1.2, Math.min(1.2, this.fp.pitch - (e.clientY - drag.y) * 0.004));
          drag.x = e.clientX; drag.y = e.clientY;
        }
        return;
      }
      if (!drag) return;
      const dx = e.clientX - drag.x, dy = e.clientY - drag.y;
      if (Math.abs(dx) + Math.abs(dy) > 3) drag.moved = true;
      drag.x = e.clientX; drag.y = e.clientY;
      if (drag.btn === 2 || e.shiftKey) {
        const right = new THREE.Vector3(Math.sin(this.orbit.yaw), 0, -Math.cos(this.orbit.yaw));
        const fwd = new THREE.Vector3(-Math.cos(this.orbit.yaw), 0, -Math.sin(this.orbit.yaw));
        this.orbit.target.addScaledVector(right, -dx * this.orbit.dist * 0.0018).addScaledVector(fwd, dy * this.orbit.dist * 0.0018);
        this.orbit.manual = true;
      } else {
        this.orbit.yaw -= dx * 0.006;
        this.orbit.pitch = Math.max(0.06, Math.min(1.5, this.orbit.pitch + dy * 0.005));
      }
    });
    window.addEventListener('pointerup', (e) => {
      if (drag && !drag.fpDrag && !drag.moved && drag.btn === 0 && this.mode === 'orbit') this.pick(e);
      drag = null;
    });
    el.addEventListener('wheel', (e) => {
      e.preventDefault();
      if (this.mode === 'orbit') this.orbit.dist = Math.max(2.5, Math.min(120, this.orbit.dist * Math.exp(e.deltaY * 0.001)));
    }, { passive: false });
    window.addEventListener('keydown', (e) => { if (!/INPUT|TEXTAREA|SELECT/.test(document.activeElement.tagName)) this.keys[e.code] = true; });
    window.addEventListener('keyup', (e) => { this.keys[e.code] = false; });
    window.addEventListener('blur', () => { this.keys = {}; });
  }

  pick(e) {
    const r = this.renderer.domElement.getBoundingClientRect();
    const ndc = new THREE.Vector2(((e.clientX - r.left) / r.width) * 2 - 1, -((e.clientY - r.top) / r.height) * 2 + 1);
    const ray = new THREE.Raycaster();
    ray.setFromCamera(ndc, this.camera);
    const inv = new THREE.Matrix4().copy(this.cabin.matrixWorld).invert();
    const local = ray.ray.clone().applyMatrix4(inv);
    const hit = new THREE.Vector3();
    if (local.intersectPlane(new THREE.Plane(new THREE.Vector3(0, 1, 0), -0.45), hit)) this.app.onPlayClick({ x: hit.x, y: -hit.z });
  }

  fpMove(dt) {
    if (this.mode !== 'fp') return null;
    const k = this.keys;
    let f = 0, s = 0;
    if (k.KeyW || k.ArrowUp) f += 1;
    if (k.KeyS || k.ArrowDown) f -= 1;
    if (k.KeyA || k.ArrowLeft) s -= 1;
    if (k.KeyD || k.ArrowRight) s += 1;
    if (!f && !s) return null;
    const sp = (k.ShiftLeft ? 2.6 : 1.6) * dt;
    const yaw = this.fp.yaw;
    const fx = Math.cos(yaw), fz = -Math.sin(yaw);
    const rx = -fz, rz = fx;
    const dx = (fx * f + rx * s) * sp, dz = (fz * f + rz * s) * sp;
    return { dx, dy: -dz };
  }

  resize() {
    const r = this.container.getBoundingClientRect();
    if (!r.width || !r.height) return;
    this.renderer.setSize(r.width, r.height, false);
    this.camera.aspect = r.width / r.height;
    this.camera.updateProjectionMatrix();
  }

  focusCabin() {
    const ac = this.app.aircraft();
    this.orbit.target.set(ac.length / 2, 0.4, 0);
    this.orbit.dist = Math.max(12, ac.length * 0.95);
    this.orbit.pitch = 0.78; this.orbit.yaw = -2.25;
    this.orbit.manual = false;
  }

  // ---------- 每幀更新 ----------
  updateSky(env) {
    const a = Math.min(1, env.alt / 35000);
    const key = a.toFixed(2);
    if (key === this.skyKey) return;
    this.skyKey = key;
    const g = this.skyCanvas.getContext('2d');
    const top = new THREE.Color().setHSL(0.6, 0.55, THREE.MathUtils.lerp(0.62, 0.32, a));
    const hor = new THREE.Color().setHSL(0.58, 0.45, THREE.MathUtils.lerp(0.86, 0.78, a));
    const gr = g.createLinearGradient(0, 0, 0, 256);
    gr.addColorStop(0, '#' + top.getHexString()); gr.addColorStop(0.75, '#' + hor.getHexString()); gr.addColorStop(1, '#' + hor.getHexString());
    g.fillStyle = gr; g.fillRect(0, 0, 4, 256);
    this.skyTex.needsUpdate = true;
    this.scene.fog.color.copy(hor).convertSRGBToLinear();
  }

  render(sim, walker, dt) {
    this.rebuild();
    const ac = this.app.aircraft();
    const env = sim ? sim.env : { alt: 0, speed: 0, pitch: 0, shake: 0, lights: 1, seatbelt: false, ground: true, groundScroll: 0, doorsOpen: true };
    const t = performance.now() / 1000;
    const L = ac.length;

    // 機身俯仰與震動
    const pitch = THREE.MathUtils.degToRad(env.pitch);
    const sh = env.shake * 0.012;
    this.cabin.rotation.set(Math.sin(t * 37) * sh * 0.5, 0, -pitch + Math.sin(t * 23) * sh * 0.4);
    const piv = new THREE.Vector3(L / 2, 0, 0);
    this.cabin.position.copy(piv).sub(piv.clone().applyEuler(this.cabin.rotation));
    this.cabin.position.y += Math.sin(t * 41) * sh;
    this.cabin.updateMatrixWorld(true);
    this.clipWorld.copy(this.clipLocal).applyMatrix4(this.cabin.matrixWorld);

    // 太陽與陰影範圍跟著機艙
    this.sun.position.set(L / 2 + 12, 30, 18);
    this.sun.target.position.set(L / 2, 0, 0);
    const sc = this.sun.shadow.camera;
    const ext = L / 2 + 6;
    if (sc.right !== ext) { sc.left = -ext; sc.right = ext; sc.top = ext; sc.bottom = -ext; sc.near = 1; sc.far = 90; sc.updateProjectionMatrix(); }

    // 環境
    const altM = env.alt * 0.3048;
    this.groundGroup.position.y = -1.32 - Math.min(altM, 3000) * 0.6;
    this.groundGroup.visible = altM < 4500;
    this.groundTex.offset.x = (env.groundScroll / 200) % 1;
    this.clouds.visible = env.alt > 6000;
    this.clouds.position.y = env.alt > 30000 ? -40 : 10;
    this.clouds.children.forEach((c) => { c.position.x -= env.speed * 0.025 * dt * 10; if (c.position.x < -900) c.position.x += 1800; });
    this.updateSky(env);
    this.scene.fog.far = env.alt > 10000 ? 3500 : 1400;

    // 燈光：起降時調暗、巡航時柔和
    this.hemi.intensity = 0.55 + 0.5 * env.lights;
    const stripCol = env.lights < 0.6 ? 0x8fa8ff : env.lights < 0.95 ? 0xffd9b0 : 0xfff2d8;
    (this.lightStrips || []).forEach((s) => s.material.color.setHex(stripCol));
    (this.glowMats || []).forEach((m) => { m.emissive.setHex(stripCol); m.emissiveIntensity = 0.08 + 0.12 * env.lights; });
    if (this.signMat) this.signMat.color.setHex(env.seatbelt ? 0xffa531 : 0x333333);

    this.drawWindow(env);

    // 旅客心情 / 任務標記
    if (sim) {
      const targets = new Map();
      sim.activeTasks().forEach((tk) => { if (tk.def.target && tk.def.target.seat) targets.set(tk.def.target.seat, tk); });
      this.paxMeshes.forEach((g, seat) => {
        const mood = sim.mood[seat] ?? 70;
        const ind = g.userData.ind;
        if (ind) { ind.visible = mood < 70; ind.material.color.set(mood >= 40 ? 0xf5c542 : 0xe5484d); }
        const tk = targets.get(seat);
        let mk = this.markers.get(seat);
        if (tk && !mk) {
          mk = new THREE.Group();
          const cone = new THREE.Mesh(new THREE.ConeGeometry(0.11, 0.26, 4), new THREE.MeshBasicMaterial({ color: PRIORITY[tk.def.priority].color }));
          cone.rotation.x = Math.PI;
          const ring = new THREE.Mesh(new THREE.TorusGeometry(0.45, 0.025, 6, 32), new THREE.MeshBasicMaterial({ color: PRIORITY[tk.def.priority].color, transparent: true, opacity: 0.8 }));
          ring.rotation.x = Math.PI / 2; ring.position.y = -1.85 + 0.02;
          mk.add(cone, ring);
          g.add(mk); this.markers.set(seat, mk);
        }
        if (!tk && mk) { g.remove(mk); this.markers.delete(seat); }
        if (mk) { mk.position.set(0.12, 1.95 + Math.sin(t * 5) * 0.06, 0); mk.children[0].rotation.y = t * 2; mk.children[1].scale.setScalar(1 + 0.15 * Math.sin(t * 6)); }
      });
    } else {
      this.paxMeshes.forEach((g) => { if (g.userData.ind) g.userData.ind.visible = false; });
    }

    // 角色
    if (walker) {
      const moved = this.lastWalker ? Math.hypot(walker.x - this.lastWalker.x, walker.y - this.lastWalker.y) : 0;
      this.lastWalker = { x: walker.x, y: walker.y };
      const moving = moved > 0.002;
      this.player.visible = this.mode !== 'fp';
      this.player.position.copy(P(walker.x, walker.y, walker.seated ? -0.42 : 0));
      this.player.rotation.y = walker.seated ? 0 : (walker.heading ?? 0);
      this.player.userData.animate(t, moving, walker.seated);
    } else if (this.player) this.player.visible = false;
    if (sim) {
      sim.npcs.forEach((n) => {
        let m = this.npcMeshes.get(n.id);
        if (!m) {
          m = makeCrew({ ...this.app.state.profile.uniform, jacket: n.color, bottom: n.color });
          const lb = this.label(n.name.replace(/^(學姊|座艙長)\s*/, ''), new THREE.Vector3(0, 2.2, 0), 0.6);
          lb.visible = this.mode !== 'fp';
          m.add(lb);
          m.userData.prev = { x: n.x, y: n.y };
          this.cabin.add(m); this.npcMeshes.set(n.id, m);
        }
        const mv = Math.hypot(n.x - m.userData.prev.x, n.y - m.userData.prev.y) > 0.002;
        m.userData.prev = { x: n.x, y: n.y };
        m.position.copy(P(n.x, n.y, 0));
        if (n.heading != null) m.rotation.y = n.heading;
        m.userData.animate(t, mv, false);
      });
    }

    // 相機
    if (this.mode === 'fp' && walker) {
      const eyeH = walker.seated ? 1.12 : EYE_H;
      this.eye.position.copy(P(walker.x, walker.y, eyeH + (walker.path && walker.path.length ? Math.abs(Math.sin(t * 9)) * 0.02 : 0)));
      this.eye.rotation.set(0, 0, 0, 'YXZ');
      this.eye.rotation.y = this.fp.yaw - Math.PI / 2;
      this.eye.rotation.x = this.fp.pitch;
      this.cabin.updateMatrixWorld(true);
      this.camera.position.setFromMatrixPosition(this.eye.matrixWorld);
      this.camera.quaternion.setFromRotationMatrix(this.eye.matrixWorld);
      this.camera.fov = 70;
      this.camera.near = 0.05;
    } else {
      if (sim && walker && !this.orbit.manual) this.orbit.target.lerp(P(walker.x, walker.y, 0.8), Math.min(1, dt * 3));
      const o = this.orbit;
      this.camera.position.set(
        o.target.x + o.dist * Math.cos(o.pitch) * Math.cos(o.yaw),
        o.target.y + o.dist * Math.sin(o.pitch),
        o.target.z + o.dist * Math.cos(o.pitch) * Math.sin(o.yaw));
      this.camera.lookAt(o.target);
      this.camera.fov = 45;
      this.camera.near = 0.1;
    }
    this.camera.updateProjectionMatrix();
    this.renderer.render(this.scene, this.camera);
  }

  drawWindow(env) {
    const c = this.winCanvas, g = c.getContext('2d');
    const w = c.width, h = c.height;
    const altF = Math.min(1, env.alt / 35000);
    const horizon = h * (0.55 + altF * 0.3) - env.pitch * 2.4;
    const sky = g.createLinearGradient(0, 0, 0, Math.max(1, horizon));
    sky.addColorStop(0, `hsl(214,62%,${56 - altF * 26}%)`);
    sky.addColorStop(1, `hsl(205,55%,${84 - altF * 8}%)`);
    g.fillStyle = sky; g.fillRect(0, 0, w, h);
    if (env.alt > 6000) {
      g.fillStyle = 'rgba(255,255,255,0.95)'; g.fillRect(0, horizon - 2, w, h);
      g.fillStyle = 'rgba(220,228,240,0.9)'; for (let i = 0; i < 4; i++) g.fillRect(((env.groundScroll * 0) + i * 17 + performance.now() / 60) % (w + 20) - 20, horizon + 4 + i * 5, 14, 3);
    } else {
      g.fillStyle = env.ground ? '#6b7f58' : '#5f7d8f'; g.fillRect(0, horizon, w, h - horizon);
      if (env.ground) {
        g.fillStyle = '#4a4d55'; g.fillRect(0, horizon + 6, w, 14);
        g.fillStyle = '#f2f2f2';
        const off = (env.groundScroll * 3) % 16;
        for (let x = -16; x < w + 16; x += 16) g.fillRect(x - off, horizon + 12, 7, 2);
      }
    }
    this.winTex.needsUpdate = true;
  }
}
