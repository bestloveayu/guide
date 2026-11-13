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

// ---------- 材質（依真實客艙照片調整：帶灰的白、深藍布料、淺灰塑膠椅背） ----------
export const SEAT_FABRIC = { J: '#3e3550', W: '#2a4d58', Y: '#23345a' };
let MATS = null;
export function materials() {
  if (MATS) return MATS;
  const T = textures();
  const fabric = (color, sheen = '#8fa3c8') => new THREE.MeshPhysicalMaterial({ color, map: rep(T.fabricMap, 9), normalMap: rep(T.fabricN, 9), normalScale: new THREE.Vector2(0.55, 0.55), roughness: 0.95, sheen: 0.8, sheenRoughness: 0.55, sheenColor: new THREE.Color(sheen) });
  MATS = {
    fabric: { Y: fabric(SEAT_FABRIC.Y), W: fabric(SEAT_FABRIC.W, '#9cc8d0'), J: new THREE.MeshPhysicalMaterial({ color: SEAT_FABRIC.J, map: rep(T.leatherMap, 6), normalMap: rep(T.leatherN, 6), normalScale: new THREE.Vector2(0.35, 0.35), roughness: 0.5, clearcoat: 0.2, clearcoatRoughness: 0.5 }) },
    headrest: new THREE.MeshPhysicalMaterial({ color: '#dedcd5', map: rep(T.fabricMap, 14), normalMap: rep(T.fabricN, 14), normalScale: new THREE.Vector2(0.35, 0.35), roughness: 0.97, sheen: 0.5, sheenColor: new THREE.Color('#ffffff') }),
    shell: new THREE.MeshStandardMaterial({ color: '#b9bec6', roughness: 0.48, normalMap: rep(T.plasticN, 6), normalScale: new THREE.Vector2(0.12, 0.12) }),
    tray: new THREE.MeshStandardMaterial({ color: '#a9aeb7', roughness: 0.5 }),
    shellDark: new THREE.MeshStandardMaterial({ color: '#3a3f48', roughness: 0.55 }),
    metal: new THREE.MeshStandardMaterial({ color: '#8d939c', metalness: 0.8, roughness: 0.38 }),
    screen: new THREE.MeshPhysicalMaterial({ color: '#06080c', roughness: 0.1, clearcoat: 1, emissive: '#16304f', emissiveIntensity: 0.45 }),
    wood: new THREE.MeshStandardMaterial({ color: '#b39b7a', roughness: 0.55 }),
    wall: new THREE.MeshStandardMaterial({ color: '#dcddda', roughness: 0.6, side: THREE.DoubleSide }),
    bin: new THREE.MeshStandardMaterial({ color: '#d9dad7', roughness: 0.38, side: THREE.DoubleSide }),
    binUnder: new THREE.MeshStandardMaterial({ color: '#b8bcbf', roughness: 0.6, side: THREE.DoubleSide }),
    ceiling: new THREE.MeshStandardMaterial({ color: '#e2e2de', roughness: 0.75, side: THREE.DoubleSide }),
    kick: new THREE.MeshStandardMaterial({ color: '#6f7682', roughness: 0.65, side: THREE.DoubleSide }),
    carpet: new THREE.MeshStandardMaterial({ map: T.carpet, normalMap: T.carpetN, normalScale: new THREE.Vector2(0.7, 0.7), roughness: 1 }),
    steel: new THREE.MeshStandardMaterial({ color: '#bfc5ce', metalness: 0.75, roughness: 0.38, map: rep(T.brushMap, 1), normalMap: rep(T.brushN, 1), normalScale: new THREE.Vector2(0.08, 0.08) }),
    hull: new THREE.MeshPhysicalMaterial({ color: '#f2f4f7', roughness: 0.32, clearcoat: 0.7, clearcoatRoughness: 0.2, side: THREE.DoubleSide }),
    curtain: new THREE.MeshPhysicalMaterial({ color: '#1d2a48', roughness: 0.95, sheen: 0.6, sheenColor: new THREE.Color('#6d84b8'), side: THREE.DoubleSide }),
    rubber: new THREE.MeshStandardMaterial({ color: '#1e2026', roughness: 0.9 }),
  };
  return MATS;
}

// ---------- 座椅 ----------
const ni = (g) => (g.index ? g.toNonIndexed() : g);
function keep(g) { const out = ni(g); for (const k of Object.keys(out.attributes)) if (!['position', 'normal', 'uv'].includes(k)) out.deleteAttribute(k); return out; }

// 椅背正面輪廓（寬 × 高，在 z-y 平面），上緣圓角、肩部略收
function backShape(bw, y0, y1, rTop = 0.085, taper = 0.03) {
  const s = new THREE.Shape();
  const hb = bw / 2, ht = bw / 2 - taper;
  s.moveTo(-hb, y0);
  s.lineTo(hb, y0);
  s.lineTo(ht, y1 - rTop);
  s.quadraticCurveTo(ht, y1, ht - rTop, y1);
  s.lineTo(-ht + rTop, y1);
  s.quadraticCurveTo(-ht, y1, -ht, y1 - rTop);
  s.lineTo(-hb, y0);
  return s;
}
// 將 z-y 平面的形狀沿 +x 擠出（厚度 t），回傳幾何
function slab(shape, t, bevel = 0.02, segs = 4) {
  const g = new THREE.ExtrudeGeometry(shape, { depth: t, bevelEnabled: bevel > 0, bevelThickness: bevel, bevelSize: bevel * 0.9, bevelSegments: segs, curveSegments: 12 });
  g.rotateY(Math.PI / 2); // 擠出方向 → +x，形狀 x → -z
  return g;
}
// 繞座位樞紐（後傾）
function recline(g, pivotX, pivotY, ang) { g.translate(-pivotX, -pivotY, 0); g.rotateZ(-ang); g.translate(pivotX, pivotY, 0); return g; }

// 回傳 { geometry（含材質群組）, materials }，原點在地板、面向 -x
export function seatAsset(cls, w, d, opts = {}) {
  const m = materials();
  const groups = { fabric: [], head: [], shell: [], tray: [], metal: [], screen: [], dark: [] };
  const bw = w * 0.9;
  const backX = d * 0.36; // 椅背前緣 x
  const ang = cls === 'J' ? 0.2 : 0.16;
  if (cls === 'J') {
    // 商務艙：寬大皮椅 + 側邊殼體 + 腳凳
    const back = slab(backShape(bw * 0.86, 0.5, 1.32, 0.12, 0.04), 0.14, 0.04); back.translate(backX - 0.02, 0, 0); recline(back, backX, 0.5, ang); groups.fabric.push(back);
    const cush = new RoundedBoxGeometry(d * 0.9, 0.16, bw * 0.84, 4, 0.06); cush.translate(-0.02, 0.46, 0); groups.fabric.push(cush);
    const head = slab(backShape(bw * 0.88, 1.08, 1.34, 0.12, 0.04), 0.18, 0.02); head.translate(backX - 0.04, 0, 0); recline(head, backX, 0.5, ang); groups.head.push(head);
    for (const side of [-1, 1]) {
      const wall = new RoundedBoxGeometry(d * 1.15, 1.05, 0.07, 3, 0.03); wall.translate(0.02, 0.52, side * (w / 2 - 0.035)); groups.shell.push(wall);
      const top = new RoundedBoxGeometry(d * 0.75, 0.04, 0.18, 2, 0.015); top.translate(-0.05, 0.72, side * (w / 2 - 0.12)); groups.dark.push(top);
    }
    const ott = new RoundedBoxGeometry(0.3, 0.3, w * 0.5, 3, 0.05); ott.translate(-d * 0.7, 0.15, 0); groups.shell.push(ott);
    const base = new RoundedBoxGeometry(d * 0.8, 0.36, bw * 0.7, 2, 0.03); base.translate(0, 0.18, 0); groups.shell.push(base);
    const scr = new THREE.PlaneGeometry(0.4, 0.25); scr.rotateY(Math.PI / 2); scr.translate(-d * 0.98, 1.0, 0); groups.screen.push(scr);
  } else {
    // 經濟/豪經艙：薄型椅背（布面）+ 後側淺灰塑膠殼 + 大片頭枕套（照片中最明顯的特徵）
    const fabT = 0.075, shellT = 0.022;
    const back = slab(backShape(bw, 0.5, 1.12), fabT, 0.025); back.translate(backX, 0, 0); recline(back, backX, 0.5, ang); groups.fabric.push(back);
    // 腰靠鼓起
    const lumbar = new RoundedBoxGeometry(0.05, 0.22, bw * 0.8, 3, 0.022); lumbar.translate(backX - 0.01, 0.66, 0); recline(lumbar, backX, 0.5, ang); groups.fabric.push(lumbar);
    // 後殼：比椅背略寬，涵蓋下 3/4
    const sx0 = backX + fabT + 0.045;
    const shell = slab(backShape(bw + 0.02, 0.42, 1.0, 0.06, 0.02), shellT, 0.012, 3); shell.translate(sx0, 0, 0); recline(shell, backX, 0.5, ang); groups.shell.push(shell);
    // 餐桌（淺凹的圓角板）與扣鎖
    const trayS = new THREE.Shape(); const tw = bw * 0.78, th = 0.26; const rr = 0.03;
    trayS.moveTo(-tw / 2 + rr, 0); trayS.lineTo(tw / 2 - rr, 0); trayS.quadraticCurveTo(tw / 2, 0, tw / 2, rr); trayS.lineTo(tw / 2, th - rr); trayS.quadraticCurveTo(tw / 2, th, tw / 2 - rr, th); trayS.lineTo(-tw / 2 + rr, th); trayS.quadraticCurveTo(-tw / 2, th, -tw / 2, th - rr); trayS.lineTo(-tw / 2, rr); trayS.quadraticCurveTo(-tw / 2, 0, -tw / 2 + rr, 0);
    const tray = slab(trayS, 0.008, 0.004, 2); tray.translate(sx0 + shellT + 0.012, 0.6, 0); recline(tray, backX, 0.5, ang); groups.tray.push(tray);
    const latch = new RoundedBoxGeometry(0.014, 0.018, 0.06, 2, 0.006); latch.translate(sx0 + shellT + 0.028, 0.885, 0); recline(latch, backX, 0.5, ang); groups.dark.push(latch);
    // 椅背置物袋
    const pocket = new RoundedBoxGeometry(0.025, 0.13, bw * 0.74, 2, 0.01); pocket.translate(sx0 + shellT + 0.02, 0.5, 0); recline(pocket, backX, 0.5, ang); groups.fabric.push(pocket);
    if (opts.screen || cls === 'W') {
      const scr = new RoundedBoxGeometry(0.012, 0.16, 0.25, 2, 0.006); scr.translate(sx0 + shellT + 0.02, 0.93, 0); recline(scr, backX, 0.5, ang); groups.screen.push(scr);
      const bez = new RoundedBoxGeometry(0.012, 0.19, 0.29, 2, 0.01); bez.translate(sx0 + shellT + 0.014, 0.93, 0); recline(bez, backX, 0.5, ang); groups.dark.push(bez);
    }
    // 頭枕套：覆蓋椅背上段正反兩面
    const coverT = fabT + 0.045 + shellT + 0.03;
    const cover = slab(backShape(bw + 0.06, 0.9, 1.16, 0.1, 0.028), coverT + 0.02, 0.01, 2); cover.translate(backX - 0.03, 0, 0); recline(cover, backX, 0.5, ang); groups.head.push(cover);
    // 椅墊（前緣略高）
    const cush = new RoundedBoxGeometry(d * 0.86, 0.12, bw * 0.98, 4, 0.045); cush.rotateZ(0.04); cush.translate(-0.03, 0.455, 0); groups.fabric.push(cush);
    const pan = new RoundedBoxGeometry(d * 0.8, 0.05, bw * 0.92, 2, 0.015); pan.translate(-0.02, 0.385, 0); groups.shell.push(pan);
    // 扶手（深灰）與扶手側板
    for (const side of [-1, 1]) {
      const arm = new RoundedBoxGeometry(0.42, 0.05, 0.05, 3, 0.022); arm.translate(-0.03, 0.66, side * (w / 2)); groups.dark.push(arm);
      const post = new RoundedBoxGeometry(0.05, 0.25, 0.035, 2, 0.012); post.translate(0.12, 0.53, side * (w / 2)); groups.dark.push(post);
    }
    // 椅腳、橫桿
    for (const lx of [-d * 0.28, d * 0.22]) {
      for (const lz of [w * 0.38, -w * 0.38]) { const leg = new THREE.CylinderGeometry(0.016, 0.02, 0.37, 10); leg.translate(lx, 0.185, lz); groups.metal.push(leg); }
    }
    for (const lx of [-d * 0.2, d * 0.15]) { const rail = new THREE.CylinderGeometry(0.018, 0.018, w * 1.0, 10); rail.rotateX(Math.PI / 2); rail.translate(lx, 0.35, 0); groups.metal.push(rail); }
    const bag = new RoundedBoxGeometry(0.36, 0.05, w * 0.6, 2, 0.02); bag.translate(-0.02, 0.33, 0); groups.dark.push(bag); // 救生衣袋
  }
  const order = [['fabric', m.fabric[cls] || m.fabric.Y], ['head', m.headrest], ['shell', m.shell], ['tray', m.tray], ['metal', m.metal], ['screen', m.screen], ['dark', m.shellDark]];
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

const SHIRTS = ['#e9e8e3', '#9fb7d3', '#1e2128', '#5a6170', '#2c3b57', '#c9b79a', '#8f2f35', '#e8dfd0', '#46525f', '#b8c4b0', '#d7d4cc', '#3a3a40'];
const PANTS = ['#2b2f39', '#43474f', '#5a4b3b', '#2f405a', '#6a6e76', '#3a3530'];
const SKINS = ['#d9ad8c', '#cf9e7b', '#c08966', '#a8724f', '#e2b897', '#bf8f70'];
const HAIRS = ['#151110', '#1f1814', '#2b211b', '#3d2c20', '#4a3626', '#121212'];

export const PAX_MAT = new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.72 });

// 坐姿旅客（面向 -x）：頭髮完整包覆後腦（從走道多半看到的是後腦與肩膀），部分旅客低頭看手機
export function passengerGeometry(p) {
  const h = hash(p.seat + p.name);
  const r = rng(h);
  const shirt = SHIRTS[h % SHIRTS.length], pants = PANTS[(h >>> 4) % PANTS.length];
  let skin = SKINS[(h >>> 8) % SKINS.length], hair = HAIRS[(h >>> 12) % HAIRS.length];
  if (p.type === 'elder') hair = r() > 0.5 ? '#c9c6bf' : '#8c8780';
  if (p.type === 'drunk') skin = '#d9927e';
  if (p.type === 'medical') skin = '#dcd3c6';
  const style = (h >>> 16) % 4; // 0 短髮 1 及肩 2 馬尾/長髮 3 平頭
  const reading = r() < 0.35;
  const glasses = r() < 0.3 || p.type === 'elder';
  const body = [], head = [];
  // 腿
  for (const z of [-0.095, 0.095]) {
    body.push(colored(cap(0.072, 0.3, 12), pants, M(-0.08, 0.57, z, 0, 0, Math.PI / 2)));
    body.push(colored(cap(0.056, 0.33, 12), pants, M(-0.3, 0.31, z)));
    body.push(colored(new RoundedBoxGeometry(0.24, 0.07, 0.095, 2, 0.03), '#1f2026', M(-0.34, 0.04, z)));
  }
  body.push(colored(sph(0.17, 18, 12), pants, M(0.08, 0.58, 0, 0, 0, 0, 0.85, 0.55, 1.15)));
  // 軀幹：肩寬約 0.42 m，靠在椅背上
  body.push(colored(torsoLathe([[0.0, 0], [0.14, 0.02], [0.135, 0.16], [0.16, 0.34], [0.175, 0.44], [0.15, 0.5], [0.07, 0.545], [0, 0.55]], 24), shirt, M(0.13, 0.6, 0, 0, 0, -0.16, 0.66, 1, 1.22)));
  body.push(colored(new THREE.TorusGeometry(0.055, 0.02, 8, 18), shadeHex(shirt, 1.12), M(0.16, 1.14, 0, Math.PI / 2, 0, 0)));
  // 手臂
  for (const s of [-1, 1]) {
    body.push(colored(cap(0.05, 0.22, 10), shirt, M(0.14, 0.92, s * 0.2, s * 0.06, 0, 0.22)));
    if (reading) {
      body.push(colored(cap(0.042, 0.2, 10), shirt, M(0.0, 0.8, s * 0.13, s * -0.5, 0, Math.PI / 2 - 0.6)));
      body.push(colored(sph(0.042, 12, 10), skin, M(-0.1, 0.88, s * 0.06, 0, 0, 0, 1.1, 0.8, 1)));
    } else {
      body.push(colored(cap(0.042, 0.22, 10), shirt, M(-0.02, 0.71, s * 0.205, 0, 0, Math.PI / 2 - 0.12)));
      body.push(colored(sph(0.042, 12, 10), skin, M(-0.17, 0.69, s * 0.205, 0, 0, 0, 1.2, 0.75, 1)));
    }
  }
  if (reading) body.push(colored(new RoundedBoxGeometry(0.075, 0.008, 0.15, 2, 0.004), '#15171c', M(-0.12, 0.9, 0, 0, 0, 0.9)));
  // 頸
  body.push(colored(cap(0.046, 0.07, 12), skin, M(0.16, 1.17, 0)));
  // 頭部（以頸部為樞紐可低頭）
  const HY = 1.32, HX = 0.15;
  head.push(colored(sph(0.1, 28, 20), skin, M(HX, HY, 0, 0, 0, 0, 0.98, 1.16, 0.8)));
  head.push(colored(sph(0.05, 14, 10), skin, M(HX - 0.03, HY - 0.075, 0, 0, 0, 0, 1.1, 0.7, 1.15))); // 下顎
  head.push(colored(cap(0.012, 0.03, 8), shadeHex(skin, 0.95), M(HX - 0.098, HY - 0.005, 0, 0, 0, 0.15)));  // 鼻
  for (const s of [-1, 1]) {
    head.push(colored(sph(0.011, 10, 8), '#1c1614', M(HX - 0.083, HY + 0.02, s * 0.034)));
    head.push(colored(new RoundedBoxGeometry(0.008, 0.007, 0.036, 1, 0.003), shadeHex(hair, 0.9), M(HX - 0.088, HY + 0.045, s * 0.035)));
    head.push(colored(sph(0.022, 10, 8), skin, M(HX + 0.005, HY - 0.0, s * 0.078, 0, 0, 0, 0.6, 1.2, 0.5)));
  }
  head.push(colored(cap(0.007, 0.026, 6), '#a85d55', M(HX - 0.09, HY - 0.045, 0, Math.PI / 2, 0, 0)));
  // 頭髮：頂部 + 後腦完整覆蓋，臉部留空
  const HR = 0.108;
  const front = 1.3;
  head.push(colored(new THREE.SphereGeometry(HR, 28, 16, front, Math.PI * 2 - front * 2, 0, Math.PI * (style === 3 ? 0.42 : 0.5)), hair, M(HX + 0.006, HY + 0.012, 0, 0, 0, 0, 1.0, 1.12, 0.84)));
  head.push(colored(new THREE.SphereGeometry(HR, 28, 16, 0, Math.PI * 2, 0, Math.PI * 0.32), hair, M(HX + 0.004, HY + 0.016, 0, 0, 0, 0.12, 1.0, 1.12, 0.84)));
  const backLen = style === 3 ? 0.55 : style === 0 ? 0.6 : 0.68;
  head.push(colored(new THREE.SphereGeometry(HR + 0.003, 24, 14, Math.PI - 0.78, 1.56, Math.PI * 0.3, Math.PI * (backLen - 0.3)), hair, M(HX + 0.01, HY + 0.01, 0, 0, 0, 0, 1.0, 1.15, 0.86)));
  if (style === 1) head.push(colored(new THREE.CylinderGeometry(0.1, 0.11, 0.12, 22, 1, true, -Math.PI / 2 - 1.2, Math.PI + 2.4), hair, M(HX + 0.015, HY - 0.08, 0, 0, 0, 0, 0.95, 1, 0.92)));
  if (style === 2) { head.push(colored(cap(0.04, 0.12, 10), hair, M(HX + 0.12, HY - 0.06, 0, 0, 0, 0.35))); head.push(colored(sph(0.03, 10, 8), shadeHex(hair, 0.8), M(HX + 0.11, HY + 0.02, 0))); }
  if (glasses) {
    for (const s of [-1, 1]) head.push(colored(new THREE.TorusGeometry(0.022, 0.0035, 6, 18), '#24262b', M(HX - 0.092, HY + 0.02, s * 0.034, 0, Math.PI / 2, 0)));
    head.push(colored(cap(0.003, 0.02, 4), '#24262b', M(HX - 0.094, HY + 0.022, 0, Math.PI / 2, 0, 0)));
  }
  const hg = mergeGeometries(head, false);
  hg.translate(-0.16, -1.2, 0);
  hg.rotateZ(reading ? 0.38 : (r() - 0.5) * 0.12); // 低頭
  hg.rotateY((r() - 0.5) * 0.35);
  hg.translate(0.16, 1.2, 0);
  const extras = [];
  if (p.type === 'vip') extras.push(colored(new RoundedBoxGeometry(0.02, 0.22, 0.05, 2, 0.008), '#a8842b', M(0.04, 0.98, 0, 0, 0, -0.16)));
  const g = mergeGeometries([...body, hg, ...extras], false);
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
