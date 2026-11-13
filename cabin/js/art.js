// 美術資產（程序化產生）：PBR 材質、布料/皮革/地毯貼圖、平滑的座椅與人物模型
import * as THREE from 'three';
import { RoundedBoxGeometry } from 'three/addons/geometries/RoundedBoxGeometry.js';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';

// ---------- 小工具 ----------
const _q = new THREE.Quaternion(), _e = new THREE.Euler(), _v = new THREE.Vector3(), _s = new THREE.Vector3();
export function M(x, y, z, rx = 0, ry = 0, rz = 0, sx = 1, sy = 1, sz = 1) {
  return new THREE.Matrix4().compose(_v.set(x, y, z), _q.setFromEuler(_e.set(rx, ry, rz)), _s.set(sx, sy, sz));
}
export const hash = (s) => { let x = 2166136261; for (const ch of String(s)) x = Math.imul(x ^ ch.charCodeAt(0), 16777619) >>> 0; return x; };
function rng(seed) { let s = seed >>> 0 || 1; return () => ((s = Math.imul(s ^ (s >>> 15), 2246822507) ^ Math.imul(s ^ (s >>> 13), 3266489909)) >>> 0) / 4294967296; }
const canvas = (w, h = w) => { const c = document.createElement('canvas'); c.width = w; c.height = h; return c; };

// 平滑雜訊（值雜訊 + 多層）
function valueNoise(size, cells, seed) {
  const r = rng(seed);
  const g = new Float32Array((cells + 1) * (cells + 1));
  for (let i = 0; i < g.length; i++) g[i] = r();
  for (let i = 0; i <= cells; i++) { g[i * (cells + 1) + cells] = g[i * (cells + 1)]; g[cells * (cells + 1) + i] = g[i]; }
  const out = new Float32Array(size * size);
  const sm = (t) => t * t * (3 - 2 * t);
  for (let y = 0; y < size; y++) for (let x = 0; x < size; x++) {
    const fx = (x / size) * cells, fy = (y / size) * cells;
    const ix = Math.floor(fx), iy = Math.floor(fy), tx = sm(fx - ix), ty = sm(fy - iy);
    const a = g[iy * (cells + 1) + ix], b = g[iy * (cells + 1) + ix + 1], c = g[(iy + 1) * (cells + 1) + ix], d = g[(iy + 1) * (cells + 1) + ix + 1];
    out[y * size + x] = (a + (b - a) * tx) * (1 - ty) + (c + (d - c) * tx) * ty;
  }
  return out;
}
function fbm(size, seed, octaves = [[4, 0.5], [8, 0.25], [16, 0.15], [32, 0.1]]) {
  const out = new Float32Array(size * size);
  octaves.forEach(([cells, amp], k) => { const n = valueNoise(size, cells, seed + k * 101); for (let i = 0; i < out.length; i++) out[i] += n[i] * amp; });
  return out;
}

// 高度圖 → 法線貼圖（可無縫平鋪）
function normalFromHeight(h, size, strength = 2) {
  const c = canvas(size), g = c.getContext('2d');
  const img = g.createImageData(size, size);
  const at = (x, y) => h[((y + size) % size) * size + ((x + size) % size)];
  for (let y = 0; y < size; y++) for (let x = 0; x < size; x++) {
    const dx = (at(x + 1, y) - at(x - 1, y)) * strength, dy = (at(x, y + 1) - at(x, y - 1)) * strength;
    const nz = 1 / Math.hypot(dx, dy, 1);
    const i = (y * size + x) * 4;
    img.data[i] = (-dx * nz * 0.5 + 0.5) * 255; img.data[i + 1] = (dy * nz * 0.5 + 0.5) * 255; img.data[i + 2] = nz * 255; img.data[i + 3] = 255;
  }
  g.putImageData(img, 0, 0);
  const t = new THREE.CanvasTexture(c);
  t.wrapS = t.wrapT = THREE.RepeatWrapping; t.anisotropy = 4;
  return t;
}
function grayMap(h, size, lo, hi, tint = [1, 1, 1]) {
  const c = canvas(size), g = c.getContext('2d');
  const img = g.createImageData(size, size);
  for (let i = 0; i < size * size; i++) {
    const v = (lo + (hi - lo) * h[i]) * 255;
    img.data[i * 4] = v * tint[0]; img.data[i * 4 + 1] = v * tint[1]; img.data[i * 4 + 2] = v * tint[2]; img.data[i * 4 + 3] = 255;
  }
  g.putImageData(img, 0, 0);
  const t = new THREE.CanvasTexture(c);
  t.wrapS = t.wrapT = THREE.RepeatWrapping; t.colorSpace = THREE.SRGBColorSpace; t.anisotropy = 4;
  return t;
}
const rep = (t, x, y = x) => { const c = t.clone(); c.repeat.set(x, y); c.needsUpdate = true; return c; };

// ---------- 程序化貼圖 ----------
let TEX = null;
export function textures() {
  if (TEX) return TEX;
  const N = 256;
  // 布料：斜紋編織
  const weave = new Float32Array(N * N), fn = fbm(N, 11, [[32, 0.6], [64, 0.4]]);
  for (let y = 0; y < N; y++) for (let x = 0; x < N; x++) {
    const tx = Math.sin(((x + y) / 4) * Math.PI) * 0.5 + 0.5;
    const ty = Math.sin(((x - y) / 4) * Math.PI) * 0.5 + 0.5;
    weave[y * N + x] = (((Math.floor(x / 4) + Math.floor(y / 4)) % 2 ? tx : ty) * 0.6 + fn[y * N + x] * 0.4);
  }
  // 皮革：顆粒紋
  const grain = fbm(N, 23, [[16, 0.3], [48, 0.4], [96, 0.3]]);
  // 塑膠：細微砂面
  const sand = fbm(N, 37, [[64, 0.5], [128, 0.5]]);
  // 拉絲金屬：橫向條紋
  const brush = new Float32Array(N * N), bn = fbm(N, 41, [[128, 1]]);
  for (let y = 0; y < N; y++) for (let x = 0; x < N; x++) brush[y * N + x] = bn[y * N + ((x * 7) % N)] * 0.3 + bn[(y % N) * N + 3] * 0.7;
  // 地毯：絨毛
  const pile = fbm(N, 53, [[64, 0.5], [128, 0.5]]);

  // 地毯花色：深藍底 + 航空公司圖騰菱格
  const cc = canvas(512), cg = cc.getContext('2d');
  cg.fillStyle = '#2b3856'; cg.fillRect(0, 0, 512, 512);
  const pn = fbm(512, 61, [[16, 0.5], [64, 0.5]]);
  const im = cg.getImageData(0, 0, 512, 512);
  for (let i = 0; i < 512 * 512; i++) { const k = 0.82 + pn[i] * 0.3; im.data[i * 4] *= k; im.data[i * 4 + 1] *= k; im.data[i * 4 + 2] *= k; }
  cg.putImageData(im, 0, 0);
  cg.strokeStyle = 'rgba(120,150,210,0.18)'; cg.lineWidth = 3;
  for (let i = -512; i < 1024; i += 64) { cg.beginPath(); cg.moveTo(i, 0); cg.lineTo(i + 512, 512); cg.stroke(); cg.beginPath(); cg.moveTo(i, 512); cg.lineTo(i + 512, 0); cg.stroke(); }
  cg.fillStyle = 'rgba(200,170,110,0.22)';
  for (let y = 32; y < 512; y += 64) for (let x = 0; x < 512; x += 64) { cg.beginPath(); cg.arc(x + ((y / 64) % 2) * 32, y, 4, 0, 7); cg.fill(); }
  const carpet = new THREE.CanvasTexture(cc); carpet.wrapS = carpet.wrapT = THREE.RepeatWrapping; carpet.colorSpace = THREE.SRGBColorSpace; carpet.anisotropy = 8;

  TEX = {
    fabricMap: grayMap(weave, N, 0.78, 1.0), fabricN: normalFromHeight(weave, N, 3),
    leatherMap: grayMap(grain, N, 0.86, 1.0), leatherN: normalFromHeight(grain, N, 4),
    plasticN: normalFromHeight(sand, N, 0.8),
    brushN: normalFromHeight(brush, N, 0.6), brushMap: grayMap(brush, N, 0.93, 1.0),
    carpet, carpetN: normalFromHeight(pile, N, 2.5),
  };
  return TEX;
}

// ---------- 材質 ----------
export const SEAT_FABRIC = { J: '#4a3a5c', W: '#2b5f6b', Y: '#2d4269' };
let MATS = null;
export function materials() {
  if (MATS) return MATS;
  const T = textures();
  const fabric = (color, sheen = '#9fb2d6') => new THREE.MeshPhysicalMaterial({ color, map: rep(T.fabricMap, 7), normalMap: rep(T.fabricN, 7), normalScale: new THREE.Vector2(0.5, 0.5), roughness: 0.92, sheen: 0.7, sheenRoughness: 0.6, sheenColor: new THREE.Color(sheen) });
  MATS = {
    fabric: { Y: fabric(SEAT_FABRIC.Y), W: fabric(SEAT_FABRIC.W, '#9fd0d6'), J: new THREE.MeshPhysicalMaterial({ color: SEAT_FABRIC.J, map: rep(T.leatherMap, 5), normalMap: rep(T.leatherN, 5), normalScale: new THREE.Vector2(0.35, 0.35), roughness: 0.48, clearcoat: 0.25, clearcoatRoughness: 0.5 }) },
    headrest: new THREE.MeshPhysicalMaterial({ color: '#ebe6da', map: rep(T.fabricMap, 9), normalMap: rep(T.fabricN, 9), normalScale: new THREE.Vector2(0.4, 0.4), roughness: 0.95, sheen: 0.4, sheenColor: new THREE.Color('#ffffff') }),
    shell: new THREE.MeshStandardMaterial({ color: '#cdd2d9', roughness: 0.42, normalMap: rep(T.plasticN, 4), normalScale: new THREE.Vector2(0.15, 0.15) }),
    shellDark: new THREE.MeshStandardMaterial({ color: '#3c4350', roughness: 0.5 }),
    metal: new THREE.MeshStandardMaterial({ color: '#b4bac4', metalness: 0.85, roughness: 0.32 }),
    screen: new THREE.MeshPhysicalMaterial({ color: '#05070b', roughness: 0.08, clearcoat: 1, emissive: '#1d3d66', emissiveIntensity: 0.6 }),
    wood: new THREE.MeshStandardMaterial({ color: '#b39b7a', roughness: 0.55 }),
    wall: new THREE.MeshStandardMaterial({ color: '#eceef2', roughness: 0.55, normalMap: rep(T.plasticN, 6), normalScale: new THREE.Vector2(0.12, 0.12), side: THREE.DoubleSide }),
    bin: new THREE.MeshPhysicalMaterial({ color: '#f5f5f2', roughness: 0.32, clearcoat: 0.35, clearcoatRoughness: 0.3, side: THREE.DoubleSide }),
    ceiling: new THREE.MeshStandardMaterial({ color: '#f3f4f7', roughness: 0.7, side: THREE.DoubleSide }),
    kick: new THREE.MeshStandardMaterial({ color: '#7c8494', roughness: 0.6, side: THREE.DoubleSide }),
    carpet: new THREE.MeshStandardMaterial({ map: T.carpet, normalMap: T.carpetN, normalScale: new THREE.Vector2(0.6, 0.6), roughness: 1 }),
    steel: new THREE.MeshStandardMaterial({ color: '#bfc5ce', metalness: 0.75, roughness: 0.38, map: rep(T.brushMap, 1), normalMap: rep(T.brushN, 1), normalScale: new THREE.Vector2(0.08, 0.08) }),
    hull: new THREE.MeshPhysicalMaterial({ color: '#f6f8fb', roughness: 0.3, clearcoat: 0.8, clearcoatRoughness: 0.15, side: THREE.DoubleSide }),
    rubber: new THREE.MeshStandardMaterial({ color: '#1e2026', roughness: 0.9 }),
  };
  return MATS;
}

// ---------- 經濟/豪經艙座椅：由側面輪廓擠出，圓角平滑 ----------
function seatProfile() {
  const s = new THREE.Shape();
  s.moveTo(-0.25, 0.37);
  s.quadraticCurveTo(-0.29, 0.40, -0.28, 0.46);
  s.quadraticCurveTo(-0.26, 0.52, -0.18, 0.52);
  s.lineTo(0.10, 0.50);
  s.quadraticCurveTo(0.15, 0.50, 0.16, 0.56);
  s.lineTo(0.22, 1.02);
  s.quadraticCurveTo(0.24, 1.17, 0.31, 1.17);
  s.quadraticCurveTo(0.35, 1.16, 0.34, 1.08);
  s.lineTo(0.28, 0.48);
  s.quadraticCurveTo(0.26, 0.38, 0.16, 0.37);
  s.lineTo(-0.25, 0.37);
  return s;
}
function shellProfile() {
  const s = new THREE.Shape();
  s.moveTo(0.30, 0.42); s.lineTo(0.355, 1.06); s.quadraticCurveTo(0.36, 1.12, 0.33, 1.13); s.lineTo(0.315, 1.13); s.lineTo(0.26, 0.42); s.lineTo(0.30, 0.42);
  return s;
}
const ni = (g) => (g.index ? g.toNonIndexed() : g);
function keep(g) { const out = ni(g); for (const k of Object.keys(out.attributes)) if (!['position', 'normal', 'uv'].includes(k)) out.deleteAttribute(k); return out; }

// 回傳 { geometry（含材質群組）, materials }，原點在地板、面向 -x
export function seatAsset(cls, w, d) {
  const m = materials();
  const groups = { fabric: [], head: [], shell: [], metal: [], screen: [], dark: [] };
  const sx = d / 0.6; // 依座位深度縮放
  const cw = w * 0.86;
  if (cls === 'J') {
    const pf = new THREE.Shape();
    pf.moveTo(-0.32, 0.36); pf.quadraticCurveTo(-0.38, 0.42, -0.34, 0.5); pf.lineTo(0.12, 0.5);
    pf.quadraticCurveTo(0.2, 0.5, 0.22, 0.6); pf.lineTo(0.3, 1.25); pf.quadraticCurveTo(0.33, 1.38, 0.42, 1.36); pf.lineTo(0.42, 0.5); pf.quadraticCurveTo(0.4, 0.36, 0.3, 0.36); pf.lineTo(-0.32, 0.36);
    const body = new THREE.ExtrudeGeometry(pf, { depth: cw * 0.86, bevelEnabled: true, bevelThickness: 0.04, bevelSize: 0.035, bevelSegments: 4, curveSegments: 10 });
    body.translate(0, 0, -cw * 0.43); body.scale(sx * 0.95, 1, 1);
    groups.fabric.push(body);
    for (const side of [-1, 1]) {
      const wall = new RoundedBoxGeometry(d * 1.15, 1.05, 0.08, 3, 0.03); wall.translate(0.02, 0.52, side * (w / 2 - 0.04)); groups.shell.push(wall);
      const top = new RoundedBoxGeometry(d * 0.7, 0.04, 0.2, 2, 0.015); top.translate(-0.05, 0.72, side * (w / 2 - 0.13)); groups.dark.push(top);
    }
    const ott = new RoundedBoxGeometry(0.3, 0.32, w * 0.5, 3, 0.05); ott.translate(-d * 0.68, 0.16, 0); groups.shell.push(ott);
    const head = new RoundedBoxGeometry(0.1, 0.24, cw * 0.55, 3, 0.04); head.rotateZ(-0.12); head.translate(sx * 0.95 * 0.31, 1.26, 0); groups.head.push(head);
    const scr = new THREE.PlaneGeometry(0.42, 0.26); scr.rotateY(Math.PI / 2); scr.translate(-d * 0.95, 1.0, 0); groups.screen.push(scr);
  } else {
    const body = new THREE.ExtrudeGeometry(seatProfile(), { depth: cw - 0.06, bevelEnabled: true, bevelThickness: 0.03, bevelSize: 0.028, bevelSegments: 4, curveSegments: 10 });
    body.translate(0, 0, -(cw - 0.06) / 2); body.scale(sx, 1, 1);
    groups.fabric.push(body);
    const shell = new THREE.ExtrudeGeometry(shellProfile(), { depth: cw, bevelEnabled: true, bevelThickness: 0.012, bevelSize: 0.012, bevelSegments: 2, curveSegments: 6 });
    shell.translate(0, 0, -cw / 2); shell.scale(sx, 1, 1);
    groups.shell.push(shell);
    // 頭枕套
    const head = new RoundedBoxGeometry(0.03, 0.2, cw * 0.68, 2, 0.012); head.rotateZ(-0.13); head.translate(0.215 * sx, 1.02, 0); groups.head.push(head);
    // 椅背螢幕與餐桌
    const scr = new THREE.PlaneGeometry(0.16, 0.24); scr.rotateZ(0.13); scr.rotateY(Math.PI / 2); scr.translate(0.348 * sx + 0.004, 0.95, 0); groups.screen.push(scr);
    const tray = new RoundedBoxGeometry(0.012, 0.22, cw * 0.82, 2, 0.005); tray.rotateZ(0.1); tray.translate(0.326 * sx + 0.006, 0.7, 0); groups.dark.push(tray);
    const pocket = new RoundedBoxGeometry(0.03, 0.14, cw * 0.7, 2, 0.01); pocket.translate(0.3 * sx, 0.5, 0); groups.dark.push(pocket);
    // 扶手
    for (const side of [-1, 1]) {
      const arm = new RoundedBoxGeometry(0.4, 0.045, 0.05, 2, 0.02); arm.translate(-0.02, 0.655, side * (w / 2 - 0.01)); groups.dark.push(arm);
      const post = new THREE.CylinderGeometry(0.012, 0.012, 0.18, 8); post.translate(0.08, 0.56, side * (w / 2 - 0.01)); groups.metal.push(post);
    }
    // 椅腳與橫桿
    for (const lx of [-0.18 * sx, 0.18 * sx]) {
      const leg = new THREE.CylinderGeometry(0.018, 0.022, 0.38, 8); leg.translate(lx, 0.19, w * 0.32); groups.metal.push(leg);
      const leg2 = leg.clone(); leg2.translate(0, 0, -w * 0.64); groups.metal.push(leg2);
    }
    const rail = new THREE.CylinderGeometry(0.02, 0.02, w * 0.95, 8); rail.rotateX(Math.PI / 2); rail.translate(0, 0.36, 0); groups.metal.push(rail);
  }
  const order = [['fabric', m.fabric[cls] || m.fabric.Y], ['head', m.headrest], ['shell', m.shell], ['metal', m.metal], ['screen', m.screen], ['dark', m.shellDark]];
  const geos = [], mats = [];
  order.forEach(([k, mat]) => { if (groups[k].length) { geos.push(mergeGeometries(groups[k].map(keep), false)); mats.push(mat); } });
  return { geometry: mergeGeometries(geos, true), materials: mats };
}

// ---------- 人物：頂點色 + 平滑法線 ----------
function colored(geo, color, matrix) {
  const g = ni(geo).clone();
  if (matrix) g.applyMatrix4(matrix);
  const c = new THREE.Color(color), n = g.attributes.position.count, col = new Float32Array(n * 3);
  for (let i = 0; i < n; i++) { col[i * 3] = c.r; col[i * 3 + 1] = c.g; col[i * 3 + 2] = c.b; }
  g.setAttribute('color', new THREE.BufferAttribute(col, 3));
  for (const k of Object.keys(g.attributes)) if (!['position', 'normal', 'color'].includes(k)) g.deleteAttribute(k);
  return g;
}
const cap = (r, l, seg = 10) => new THREE.CapsuleGeometry(r, l, 6, seg);
const sph = (r, ws = 18, hs = 14) => new THREE.SphereGeometry(r, ws, hs);
const torsoLathe = (pts, seg = 20) => new THREE.LatheGeometry(pts.map(([r, y]) => new THREE.Vector2(r, y)), seg);

const SHIRTS = ['#b8664c', '#466d99', '#6f8f73', '#c99b45', '#7c66a3', '#c98597', '#525f6d', '#d9d0bd', '#3b7f7a', '#a24f3e', '#e8e6e1', '#2f3a4c'];
const PANTS = ['#2b2f39', '#43474f', '#5a4b3b', '#2f405a', '#6a6e76', '#3a3530'];
const SKINS = ['#f0c8a4', '#deab80', '#c48a61', '#8e5d3f', '#f5d6bd', '#e9b994'];
const HAIRS = ['#1d1510', '#36261b', '#5f432c', '#9a7449', '#252525', '#4a3626'];

export const PAX_MAT = new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.78 });

// 坐姿旅客（面向 -x）
export function passengerGeometry(p) {
  const h = hash(p.seat + p.name);
  const shirt = SHIRTS[h % SHIRTS.length], pants = PANTS[(h >>> 4) % PANTS.length];
  let skin = SKINS[(h >>> 8) % SKINS.length], hair = HAIRS[(h >>> 12) % HAIRS.length];
  if (p.type === 'elder') hair = '#d9d6cf';
  if (p.type === 'drunk') skin = '#e8a08e';
  if (p.type === 'medical') skin = '#e9e3d8';
  const longHair = (h >>> 16) % 3 === 0;
  const parts = [];
  // 腿
  for (const z of [-0.09, 0.09]) {
    parts.push(colored(cap(0.075, 0.3), pants, M(-0.1, 0.58, z, 0, 0, Math.PI / 2)));
    parts.push(colored(cap(0.058, 0.32), pants, M(-0.3, 0.32, z)));
    parts.push(colored(new RoundedBoxGeometry(0.22, 0.07, 0.09, 2, 0.03), '#23252b', M(-0.34, 0.05, z)));
  }
  parts.push(colored(sph(0.16, 16, 10), pants, M(0.1, 0.6, 0, 0, 0, 0, 0.9, 0.6, 1.2)));
  // 軀幹（略向後靠）
  parts.push(colored(torsoLathe([[0.0, 0], [0.15, 0.02], [0.14, 0.18], [0.17, 0.36], [0.18, 0.44], [0.12, 0.52], [0.0, 0.54]]), shirt, M(0.12, 0.6, 0, 0, 0, -0.12, 0.72, 1, 1.12)));
  // 手臂（前臂放在扶手上）
  for (const s of [-1, 1]) {
    parts.push(colored(cap(0.048, 0.22), shirt, M(0.13, 0.9, s * 0.2, s * 0.08, 0, 0.25)));
    parts.push(colored(cap(0.042, 0.22), shirt, M(-0.02, 0.72, s * 0.21, 0, 0, Math.PI / 2 - 0.15)));
    parts.push(colored(sph(0.045, 10, 8), skin, M(-0.17, 0.7, s * 0.21, 0, 0, 0, 1.2, 0.8, 1)));
  }
  // 頭頸
  parts.push(colored(cap(0.045, 0.06), skin, M(0.15, 1.17, 0)));
  parts.push(colored(sph(0.105), skin, M(0.13, 1.31, 0, 0, 0, -0.08, 0.95, 1.12, 0.92)));
  parts.push(colored(sph(0.02, 8, 6), skin, M(0.03, 1.3, 0)));
  for (const s of [-1, 1]) parts.push(colored(sph(0.016, 8, 6), '#2a2220', M(0.04, 1.34, s * 0.035)));
  parts.push(colored(new THREE.SphereGeometry(0.113, 18, 12, 0, Math.PI * 2, 0, Math.PI * 0.58), hair, M(0.15, 1.33, 0, 0, 0, 0.35, 1, 1.05, 0.98)));
  if (longHair) parts.push(colored(cap(0.085, 0.16), hair, M(0.22, 1.2, 0, 0, 0, 0.15, 0.7, 1, 1.15)));
  if (p.type === 'vip') parts.push(colored(new RoundedBoxGeometry(0.02, 0.24, 0.05, 2, 0.008), '#b38d2c', M(0.02, 0.98, 0, 0, 0, -0.1)));
  if (p.type === 'elder') for (const s of [-1, 1]) parts.push(colored(new THREE.TorusGeometry(0.022, 0.004, 6, 14), '#8a8f99', M(0.03, 1.34, s * 0.035, 0, Math.PI / 2, 0)));
  const g = mergeGeometries(parts, false);
  if (p.type === 'child') { g.translate(0.1, 0, 0); g.scale(0.7, 0.7, 0.7); g.translate(-0.1, 0.12, 0); }
  return g;
}

// 空服員（可動畫，面向 +x）
export function makeCrew(u) {
  const fabricN = rep(textures().fabricN, 4);
  const mat = (c, extra = {}) => new THREE.MeshPhysicalMaterial({ color: c, roughness: 0.7, ...extra });
  const cloth = (c) => mat(c, { normalMap: fabricN, normalScale: new THREE.Vector2(0.25, 0.25), sheen: 0.5, sheenColor: new THREE.Color('#ffffff'), sheenRoughness: 0.7 });
  const skinM = mat(u.skin, { roughness: 0.55, sheen: 0.3, sheenColor: new THREE.Color('#ffd9c4') });
  const hairM = mat(u.hair, { roughness: 0.45, sheen: 0.8, sheenColor: new THREE.Color('#8a6a50') });
  const gold = mat('#d6b25a', { metalness: 0.9, roughness: 0.25 });
  const g = new THREE.Group();
  const pants = u.bottomType === 'pants';
  const legs = [];
  for (const s of [-1, 1]) {
    const pivot = new THREE.Group();
    pivot.position.set(0, 0.88, s * 0.08);
    const thigh = new THREE.Mesh(cap(pants ? 0.07 : 0.06, 0.34, 12), pants ? cloth(u.bottom) : skinM);
    thigh.position.y = -0.22;
    const shin = new THREE.Mesh(cap(pants ? 0.06 : 0.048, 0.36, 12), pants ? cloth(u.bottom) : mat(shadeHex(u.skin, 0.92), { roughness: 0.4, sheen: 0.6, sheenColor: new THREE.Color('#ffffff') }));
    shin.position.y = -0.62;
    const shoe = new THREE.Mesh(new RoundedBoxGeometry(0.23, 0.07, 0.085, 3, 0.03), mat('#15161a', { roughness: 0.25, clearcoat: 0.8 }));
    shoe.position.set(0.05, -0.86, 0);
    pivot.add(thigh, shin, shoe);
    g.add(pivot); legs.push(pivot);
  }
  if (!pants) {
    const skirt = new THREE.Mesh(torsoLathe([[0.17, 0.5], [0.185, 0.3], [0.2, 0.0]], 24), cloth(u.bottom));
    skirt.position.y = 0.48; skirt.scale.set(0.82, 1, 1.05); g.add(skirt);
  } else {
    const hip = new THREE.Mesh(sph(0.17, 20, 12), cloth(u.bottom)); hip.position.y = 0.92; hip.scale.set(0.8, 0.6, 1.05); g.add(hip);
  }
  const torso = new THREE.Mesh(torsoLathe([[0.16, 0], [0.145, 0.12], [0.165, 0.3], [0.19, 0.44], [0.17, 0.52], [0.09, 0.58], [0.0, 0.59]], 24), cloth(u.jacket));
  torso.position.y = 0.96; torso.scale.set(0.78, 1, 1.05); g.add(torso);
  const shirt = new THREE.Mesh(new THREE.ConeGeometry(0.07, 0.2, 3, 1, true), mat(u.shirt, { side: THREE.DoubleSide }));
  shirt.position.set(0.135, 1.45, 0); shirt.rotation.set(0, Math.PI / 2, Math.PI); shirt.scale.set(1, 1, 0.4); g.add(shirt);
  for (const y of [1.22, 1.1]) { const b = new THREE.Mesh(sph(0.014, 10, 8), gold); b.position.set(0.145, y, 0); g.add(b); }
  const wing = new THREE.Mesh(new RoundedBoxGeometry(0.012, 0.022, 0.1, 2, 0.005), gold); wing.position.set(0.15, 1.42, -0.09); g.add(wing);
  const scarf = new THREE.Mesh(new THREE.TorusGeometry(0.068, 0.026, 10, 20), cloth(u.scarf)); scarf.rotation.x = Math.PI / 2; scarf.position.y = 1.535; g.add(scarf);
  for (const s of [-1, 1]) { const bow = new THREE.Mesh(sph(0.045, 12, 8), cloth(u.scarf)); bow.position.set(0.09, 1.5, s * 0.045); bow.scale.set(0.5, 0.8, 1.2); bow.rotation.x = s * 0.6; g.add(bow); }
  const arms = [];
  for (const s of [-1, 1]) {
    const pivot = new THREE.Group();
    pivot.position.set(0, 1.46, s * 0.19);
    const upper = new THREE.Mesh(cap(0.05, 0.24, 12), cloth(u.jacket)); upper.position.y = -0.16;
    const fore = new THREE.Mesh(cap(0.043, 0.22, 12), cloth(u.jacket)); fore.position.set(0.015, -0.44, 0);
    const cuff = new THREE.Mesh(new THREE.CylinderGeometry(0.044, 0.044, 0.025, 14), cloth(u.shirt)); cuff.position.set(0.02, -0.59, 0);
    const hand = new THREE.Mesh(sph(0.042, 12, 10), skinM); hand.position.set(0.025, -0.64, 0); hand.scale.set(0.9, 1.3, 0.6);
    pivot.add(upper, fore, cuff, hand);
    pivot.rotation.x = s * -0.07;
    g.add(pivot); arms.push(pivot);
  }
  const neck = new THREE.Mesh(cap(0.042, 0.06, 12), skinM); neck.position.y = 1.6; g.add(neck);
  const head = new THREE.Mesh(sph(0.112, 28, 20), skinM); head.position.y = 1.74; head.scale.set(0.95, 1.13, 0.88); g.add(head);
  const nose = new THREE.Mesh(sph(0.018, 10, 8), skinM); nose.position.set(0.105, 1.73, 0); nose.scale.set(1, 1.3, 0.8); g.add(nose);
  for (const s of [-1, 1]) {
    const eye = new THREE.Mesh(sph(0.013, 10, 8), mat('#1b1512', { roughness: 0.1, clearcoat: 1 })); eye.position.set(0.094, 1.765, s * 0.038); g.add(eye);
    const brow = new THREE.Mesh(new RoundedBoxGeometry(0.01, 0.008, 0.04, 1, 0.003), hairM); brow.position.set(0.1, 1.795, s * 0.04); g.add(brow);
    const ear = new THREE.Mesh(sph(0.02, 8, 6), skinM); ear.position.set(0.0, 1.74, s * 0.098); ear.scale.set(0.6, 1.2, 0.5); g.add(ear);
  }
  const lips = new THREE.Mesh(cap(0.008, 0.03, 8), mat('#b8574f', { roughness: 0.35 })); lips.rotation.x = Math.PI / 2; lips.position.set(0.1, 1.69, 0); g.add(lips);
  const hair = new THREE.Mesh(new THREE.SphereGeometry(0.122, 28, 16, 0, Math.PI * 2, 0, Math.PI * 0.6), hairM);
  hair.position.set(-0.012, 1.765, 0); hair.rotation.z = 0.32; hair.scale.set(1, 1.08, 0.97); g.add(hair);
  if (!pants) { const bun = new THREE.Mesh(sph(0.065, 18, 14), hairM); bun.position.set(-0.13, 1.71, 0); g.add(bun); }
  if (u.hat) {
    const hat = new THREE.Mesh(new THREE.CylinderGeometry(0.098, 0.112, 0.085, 28), cloth(u.jacket)); hat.position.set(0.02, 1.91, 0); hat.rotation.z = -0.12; g.add(hat);
    const band = new THREE.Mesh(new THREE.CylinderGeometry(0.114, 0.114, 0.022, 28), cloth(u.scarf)); band.position.set(0.02, 1.885, 0); band.rotation.z = -0.12; g.add(band);
    const badge = new THREE.Mesh(sph(0.016, 10, 8), gold); badge.position.set(0.125, 1.905, 0); badge.scale.set(0.4, 1, 1.4); g.add(badge);
  }
  g.traverse((o) => { if (o.isMesh) { o.castShadow = true; o.receiveShadow = true; } });
  let blend = 0;
  g.userData.animate = (t, moving, seated, dt = 0.016) => {
    blend += ((moving ? 1 : 0) - blend) * Math.min(1, dt * 8);
    const sw = Math.sin(t * 8.5) * 0.5 * blend;
    legs[0].rotation.z = seated ? 1.45 : sw; legs[1].rotation.z = seated ? 1.45 : -sw;
    arms[0].rotation.z = seated ? 0.45 : -sw * 0.7; arms[1].rotation.z = seated ? 0.45 : sw * 0.7;
    head.position.y = 1.74 + (seated ? 0 : Math.abs(Math.cos(t * 8.5)) * 0.012 * blend);
  };
  return g;
}
function shadeHex(hex, k) { return '#' + new THREE.Color(hex).multiplyScalar(k).getHexString(); }
