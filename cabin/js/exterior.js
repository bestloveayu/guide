// 機外細節：翼型斷面的機翼（含可動襟翼、擾流板、翼尖小翼、航行燈）、發動機艙、跑道與地景
import * as THREE from 'three';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';

function canvasTex(w, h, draw, srgb = true) {
  const c = document.createElement('canvas'); c.width = w; c.height = h;
  draw(c.getContext('2d'), w, h);
  const t = new THREE.CanvasTexture(c); if (srgb) t.colorSpace = THREE.SRGBColorSpace; t.anisotropy = 8;
  return t;
}
const rng = (seed) => { let s = seed >>> 0; return () => { s = (s * 1664525 + 1013904223) >>> 0; return s / 4294967296; }; };

// NACA 四位數翼型（彎度 2%），x 為弦長比例
function airfoil(x, tc) {
  const yt = 5 * tc * (0.2969 * Math.sqrt(x) - 0.126 * x - 0.3516 * x * x + 0.2843 * x ** 3 - 0.1036 * x ** 4);
  const m = 0.02, p = 0.4;
  const yc = x < p ? m / (p * p) * (2 * p * x - x * x) : m / ((1 - p) ** 2) * (1 - 2 * p + 2 * p * x - x * x);
  return [yc + yt, yc - yt];
}

// 機翼面板貼圖：鋁皮接縫、鉚釘線、翼根走道線、NO STEP 字樣、前緣金屬
function wingTexture() {
  return canvasTex(1024, 1024, (g, w, h) => {
    const gr = g.createLinearGradient(0, 0, w, 0);
    gr.addColorStop(0, '#c9ced4'); gr.addColorStop(0.07, '#dfe3e8'); gr.addColorStop(0.5, '#e4e7eb'); gr.addColorStop(1, '#d6dade');
    g.fillStyle = gr; g.fillRect(0, 0, w, h);
    const r = rng(7);
    // 淡淡的使用痕跡
    for (let i = 0; i < 260; i++) { g.fillStyle = `rgba(${90 + r() * 40},${95 + r() * 40},${100 + r() * 40},${0.02 + r() * 0.04})`; g.fillRect(r() * w, r() * h, 10 + r() * 80, 3 + r() * 30); }
    // 弦向接縫（翼肋）
    g.strokeStyle = 'rgba(70,76,86,0.35)'; g.lineWidth = 1.5;
    for (let y = 0; y < h; y += 48 + Math.floor(r() * 10)) { g.beginPath(); g.moveTo(0, y); g.lineTo(w, y); g.stroke(); }
    // 展向接縫（翼樑）
    for (const fx of [0.08, 0.18, 0.42, 0.62, 0.74]) { g.beginPath(); g.moveTo(fx * w, 0); g.lineTo(fx * w, h); g.stroke(); }
    // 鉚釘
    g.fillStyle = 'rgba(60,66,76,0.32)';
    for (const fx of [0.085, 0.185, 0.425, 0.625]) for (let y = 0; y < h; y += 6) g.fillRect(fx * w + 3, y, 1.5, 1.5);
    // 前緣（縫翼）金屬色
    g.fillStyle = 'rgba(170,176,184,0.55)'; g.fillRect(0, 0, w * 0.075, h);
    // 翼根走道線與 NO STEP
    g.strokeStyle = 'rgba(25,28,34,0.8)'; g.lineWidth = 4;
    g.beginPath(); g.moveTo(w * 0.22, 0); g.lineTo(w * 0.22, h * 0.16); g.lineTo(w * 0.58, h * 0.16); g.lineTo(w * 0.58, 0); g.stroke();
    g.fillStyle = 'rgba(30,34,40,0.75)'; g.font = '700 22px system-ui'; g.save();
    for (const [x, y] of [[0.3, 0.3], [0.5, 0.52], [0.36, 0.72]]) { g.translate(x * w, y * h); g.rotate(Math.PI / 2); g.fillText('NO STEP', 0, 0); g.setTransform(1, 0, 0, 1, 0, 0); }
    g.restore();
  });
}
function wingRoughness() {
  return canvasTex(256, 256, (g, w, h) => {
    g.fillStyle = '#6b6b6b'; g.fillRect(0, 0, w, h);
    const r = rng(11);
    for (let i = 0; i < 400; i++) { const v = 80 + r() * 90; g.fillStyle = `rgba(${v},${v},${v},0.25)`; g.fillRect(r() * w, r() * h, 4 + r() * 30, 2 + r() * 10); }
  }, false);
}

let shared = null;
function mats(env) {
  if (shared) return shared;
  const map = wingTexture(), rough = wingRoughness();
  const ext = (m) => { m.envMap = env; m.envMapIntensity = 1; m.userData.ext = true; return m; };
  shared = {
    wing: ext(new THREE.MeshPhysicalMaterial({ map, roughnessMap: rough, color: '#ffffff', roughness: 1, metalness: 0.25, clearcoat: 0.25, clearcoatRoughness: 0.4 })),
    flap: ext(new THREE.MeshPhysicalMaterial({ color: '#cfd4da', roughness: 0.5, metalness: 0.3 })),
    flapInner: ext(new THREE.MeshStandardMaterial({ color: '#8b929b', roughness: 0.6, metalness: 0.4 })),
    nacelle: ext(new THREE.MeshPhysicalMaterial({ color: '#eef1f4', roughness: 0.28, metalness: 0.05, clearcoat: 0.9, clearcoatRoughness: 0.12 })),
    lip: ext(new THREE.MeshStandardMaterial({ color: '#c9ced4', roughness: 0.22, metalness: 0.95 })),
    duct: ext(new THREE.MeshStandardMaterial({ color: '#2a2e35', roughness: 0.55, metalness: 0.5, side: THREE.BackSide })),
    fan: ext(new THREE.MeshStandardMaterial({ color: '#4a5059', roughness: 0.3, metalness: 0.85, side: THREE.DoubleSide })),
    spinner: ext(new THREE.MeshStandardMaterial({ color: '#30343b', roughness: 0.25, metalness: 0.9 })),
    exhaust: ext(new THREE.MeshStandardMaterial({ color: '#7b7570', roughness: 0.45, metalness: 0.9 })),
    pylon: ext(new THREE.MeshPhysicalMaterial({ color: '#e3e6ea', roughness: 0.32, clearcoat: 0.6 })),
    fairing: ext(new THREE.MeshPhysicalMaterial({ color: '#d7dbe0', roughness: 0.35, clearcoat: 0.5 })),
  };
  return shared;
}

/**
 * 依機身尺寸生成一側機翼。座標：x 往機尾為正，y 向上，z = s × 翼展方向。
 * 回傳 { group, flaps, spoilers, fans, strobe, nav }
 */
export function makeWing(o) {
  const { s, rootX, rootY, rootZ, c0, b, env, accent } = o;
  const m = mats(env);
  const c1 = c0 * 0.26, sweep = Math.tan(THREE.MathUtils.degToRad(28)), dih = Math.tan(THREE.MathUtils.degToRad(5.5));
  // 翼面站位：主翼（eta 0..1）+ 翼尖小翼（彎折上翹）
  const st = [];
  const N = 16;
  for (let j = 0; j <= N; j++) {
    const e = j / N;
    // 翼根附近後緣加寬（yehudi），讓內側襟翼更大
    const kink = Math.max(0, 1 - e / 0.32);
    const c = THREE.MathUtils.lerp(c0, c1, e) + kink * c0 * 0.18;
    st.push({ x: rootX + e * b * sweep, y: rootY + e * b * dih, z: rootZ + e * b, c, tc: THREE.MathUtils.lerp(0.135, 0.095, e), phi: Math.atan(dih), e });
  }
  const tip = st[st.length - 1];
  const wlH = Math.max(1.4, b * 0.13), rr = wlH * 0.35;
  for (let k = 1; k <= 6; k++) {
    const t = k / 6;
    const ang = Math.atan(dih) + t * (Math.PI / 2 - 0.22 - Math.atan(dih));
    const along = k <= 3 ? rr * Math.sin(ang - Math.atan(dih)) : rr + (wlH - rr) * ((k - 3) / 3);
    const up = k <= 3 ? rr * (1 - Math.cos(ang - Math.atan(dih))) : rr + (wlH - rr) * ((k - 3) / 3) * 0.96;
    st.push({ x: tip.x + t * tip.c * 0.55, y: tip.y + up, z: tip.z + along * (k <= 3 ? 1 : 0.25) + (k > 3 ? rr * 0.75 : 0), c: tip.c * THREE.MathUtils.lerp(1, 0.4, t), tc: 0.09, phi: ang, e: 1 + t * 0.1 });
  }

  // 依站位與弦長區段建構封閉的翼型蒙皮
  const loft = (stations, cf0, cf1, K = 18, scaleT = 1) => {
    const pos = [], uv = [], idx = [];
    const ring = [];
    for (let i = 0; i <= K; i++) { const u = 0.5 - 0.5 * Math.cos(Math.PI * i / K); ring.push(cf0 + (cf1 - cf0) * u); }
    const pts = []; // 上表面 cf1→cf0，再下表面 cf0→cf1
    for (let i = K; i >= 0; i--) pts.push([ring[i], 0]);
    for (let i = 1; i < K; i++) pts.push([ring[i], 1]);
    const P = pts.length;
    stations.forEach((q) => {
      const nd = new THREE.Vector3(0, Math.cos(q.phi), -Math.sin(q.phi) * s); // 厚度方向
      pts.forEach(([x, lower]) => {
        const [yu, yl] = airfoil(Math.max(0.0005, x), q.tc * scaleT);
        const yy = (lower ? yl : yu) * q.c;
        pos.push(q.x + x * q.c + nd.x * yy, q.y + nd.y * yy, q.z * s + nd.z * yy);
        uv.push(x, q.e);
      });
    });
    for (let j = 0; j < stations.length - 1; j++) {
      for (let i = 0; i < P; i++) {
        const a = j * P + i, b2 = j * P + (i + 1) % P, c = (j + 1) * P + i, d = (j + 1) * P + (i + 1) % P;
        if (s > 0) idx.push(a, c, b2, b2, c, d); else idx.push(a, b2, c, b2, d, c);
      }
    }
    // 兩端封口
    const cap = (j, flip) => {
      const base = pos.length / 3; let cx = 0, cy = 0, cz = 0;
      for (let i = 0; i < P; i++) { cx += pos[(j * P + i) * 3]; cy += pos[(j * P + i) * 3 + 1]; cz += pos[(j * P + i) * 3 + 2]; }
      pos.push(cx / P, cy / P, cz / P); uv.push(0.5, 0);
      for (let i = 0; i < P; i++) { const a = j * P + i, b2 = j * P + (i + 1) % P; (flip !== (s > 0)) ? idx.push(base, a, b2) : idx.push(base, b2, a); }
    };
    cap(0, true); cap(stations.length - 1, false);
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
    g.setAttribute('uv', new THREE.Float32BufferAttribute(uv, 2));
    g.setIndex(idx); g.computeVertexNormals();
    return g;
  };
  // 取站位的子集（eta 範圍內，並在兩端插值）
  const span = (e0, e1) => {
    const lerpSt = (e) => {
      const main = st.slice(0, N + 1);
      const f = e * N, i = Math.min(N - 1, Math.floor(f)), t = f - i, a = main[i], b2 = main[i + 1];
      return { x: THREE.MathUtils.lerp(a.x, b2.x, t), y: THREE.MathUtils.lerp(a.y, b2.y, t), z: THREE.MathUtils.lerp(a.z, b2.z, t), c: THREE.MathUtils.lerp(a.c, b2.c, t), tc: THREE.MathUtils.lerp(a.tc, b2.tc, t), phi: a.phi, e };
    };
    const out = [lerpSt(e0)];
    st.slice(0, N + 1).forEach((q) => { if (q.e > e0 + 1e-3 && q.e < e1 - 1e-3) out.push(q); });
    out.push(lerpSt(e1));
    return out;
  };

  const group = new THREE.Group();
  const wing = new THREE.Mesh(loft(st, 0, 1, 22), m.wing); wing.castShadow = true; group.add(wing);

  // 襟翼（富勒式：放下時向後滑出並下偏）與副翼
  const flaps = [];
  const mkFlap = (e0, e1, maxDeg, slide, isAileron) => {
    const sts = span(e0, e1);
    const flapSt = sts.map((q) => ({ ...q, x: q.x + q.c * 0.7, c: q.c * 0.3, tc: q.tc * 2.2 }));
    const g2 = loft(flapSt, 0, 1, 10, 0.95);
    const a = flapSt[0], z = flapSt[flapSt.length - 1];
    const hingeA = new THREE.Vector3(a.x + a.c * 0.05, a.y, a.z * s), hingeB = new THREE.Vector3(z.x + z.c * 0.05, z.y, z.z * s);
    g2.translate(-hingeA.x, -hingeA.y, -hingeA.z);
    const pv = new THREE.Group(); pv.position.copy(hingeA);
    const mesh = new THREE.Mesh(g2, isAileron ? m.wing : m.flap); mesh.castShadow = true; pv.add(mesh);
    group.add(pv);
    const axis = hingeB.clone().sub(hingeA).normalize();
    const aft = new THREE.Vector3(1, -0.12, 0).normalize();
    flaps.push({ pv, axis: s > 0 ? axis : axis.negate(), maxDeg, slide: slide * a.c, base: hingeA.clone(), aft, aileron: isAileron, cur: 0 });
  };
  mkFlap(0.04, 0.3, 32, 0.32, false);
  mkFlap(0.32, 0.7, 26, 0.26, false);
  mkFlap(0.72, 0.93, 6, 0, true);
  // 擾流板：上表面薄板，落地時立起
  const spoilers = [];
  for (let k = 0; k < 5; k++) {
    const e0 = 0.14 + k * 0.1, e1 = e0 + 0.095;
    const sts = span(e0, e1).map((q) => ({ ...q, x: q.x + q.c * 0.56, c: q.c * 0.15, tc: q.tc * 0.25 }));
    sts.forEach((q) => { q.y += airfoil(0.62, q.tc / 0.25)[0] * q.c / 0.15 * 0.98 - 0.004; });
    const g2 = loft(sts, 0, 1, 6, 1);
    const a = sts[0], z = sts[sts.length - 1];
    const h0 = new THREE.Vector3(a.x, a.y, a.z * s), h1 = new THREE.Vector3(z.x, z.y, z.z * s);
    g2.translate(-h0.x, -h0.y, -h0.z);
    const pv = new THREE.Group(); pv.position.copy(h0);
    const mesh = new THREE.Mesh(g2, m.flap); pv.add(mesh); group.add(pv);
    const axis = h1.clone().sub(h0).normalize();
    spoilers.push({ pv, axis: s > 0 ? axis.negate() : axis, cur: 0 });
  }
  // 襟翼滑軌整流罩（獨木舟形）
  const fairGeo = new THREE.SphereGeometry(1, 16, 10); fairGeo.scale(1, 0.32, 0.22);
  [0.18, 0.36, 0.56, 0.74].forEach((e) => {
    const q = span(e, e + 0.01)[0];
    const len = q.c * 0.42;
    const f = new THREE.Mesh(fairGeo, m.fairing);
    f.scale.set(len, len, len * 1.1); f.position.set(q.x + q.c * 0.86, q.y - q.c * 0.05, q.z * s); f.castShadow = true; group.add(f);
  });

  // 發動機：吊架 + 發動機艙（進氣唇口、風扇、整流錐、尾噴口）
  const fans = [];
  const q = span(0.33, 0.34)[0];
  const nR = Math.max(0.85, c0 * 0.2), nL = nR * 3.6;
  const nx = q.x - nL * 0.62, ny = q.y - nR * 1.5, nz = q.z * s;
  const eng = new THREE.Group(); eng.position.set(nx, ny, nz);
  const prof = [[0.86, 0], [0.97, 0.03], [1.0, 0.1], [1.01, 0.3], [0.97, 0.55], [0.86, 0.78], [0.7, 0.92], [0.62, 1]].map(([r, l]) => new THREE.Vector2(r * nR, l * nL));
  const shell = new THREE.Mesh(new THREE.LatheGeometry(prof, 64), m.nacelle); shell.castShadow = true;
  const lip = new THREE.Mesh(new THREE.TorusGeometry(nR * 0.92, nR * 0.08, 12, 64), m.lip); lip.rotation.x = Math.PI / 2; lip.position.y = nL * 0.01;
  const duct = new THREE.Mesh(new THREE.CylinderGeometry(nR * 0.86, nR * 0.84, nL * 0.32, 48, 1, true), m.duct); duct.position.y = nL * 0.16;
  // 風扇：葉片 + 整流錐（白色螺旋標記）
  const fan = new THREE.Group(); fan.position.y = nL * 0.2;
  const blades = []; const nb = 22;
  for (let i = 0; i < nb; i++) { const bg = new THREE.BoxGeometry(nR * 0.7, 0.025, nR * 0.2); bg.translate(nR * 0.47, 0, 0); bg.rotateX(0.5); bg.rotateY(i / nb * Math.PI * 2); blades.push(bg); }
  fan.add(new THREE.Mesh(mergeGeometries(blades), m.fan));
  const spin = new THREE.Mesh(new THREE.ConeGeometry(nR * 0.26, nR * 0.55, 32), m.spinner); spin.rotation.x = Math.PI; spin.position.y = -nR * 0.2; fan.add(spin);
  const swirl = new THREE.Mesh(new THREE.TorusGeometry(nR * 0.12, nR * 0.012, 6, 24, Math.PI * 1.2), new THREE.MeshBasicMaterial({ color: '#f4f4f4' })); swirl.rotation.x = Math.PI / 2; swirl.position.y = -nR * 0.3; fan.add(swirl);
  fans.push(fan);
  // 尾噴口與中心錐
  const core = new THREE.Mesh(new THREE.CylinderGeometry(nR * 0.58, nR * 0.5, nL * 0.22, 40, 1, true), m.exhaust); core.position.y = nL * 1.08;
  const plug = new THREE.Mesh(new THREE.ConeGeometry(nR * 0.3, nL * 0.3, 32), m.exhaust); plug.position.y = nL * 1.3;
  const inner = new THREE.Mesh(new THREE.CircleGeometry(nR * 0.86, 40), m.duct); inner.rotation.x = -Math.PI / 2; inner.position.y = nL * 0.34; inner.material = m.spinner;
  // 機身色條紋（航空公司色）
  const band = new THREE.Mesh(new THREE.CylinderGeometry(nR * 1.012, nR * 1.016, nL * 0.05, 64, 1, true), new THREE.MeshPhysicalMaterial({ color: accent || '#c0392b', roughness: 0.3, clearcoat: 0.8 }));
  band.position.y = nL * 0.42;
  const nac = new THREE.Group(); nac.add(shell, lip, duct, fan, core, plug, inner, band);
  nac.rotation.z = -Math.PI / 2; // 長度方向 = +x（往機尾）
  eng.add(nac);
  // 吊架
  const pyShape = new THREE.Shape();
  const top = q.y - ny;
  pyShape.moveTo(nL * 0.25, nR * 0.8); pyShape.lineTo(nL * 0.95, nR * 0.75); pyShape.lineTo(nL * 1.15, nR * 0.5); pyShape.lineTo(nL * 0.62 + q.c * 0.55, top + 0.05); pyShape.lineTo(nL * 0.52, top + 0.05); pyShape.lineTo(nL * 0.25, nR * 0.8);
  const py = new THREE.Mesh(new THREE.ExtrudeGeometry(pyShape, { depth: nR * 0.32, bevelEnabled: true, bevelThickness: 0.05, bevelSize: 0.05, bevelSegments: 2 }), m.pylon);
  py.position.z = -nR * 0.16; py.castShadow = true; eng.add(py);
  group.add(eng);

  // 航行燈與頻閃燈（左紅右綠）
  const navCol = s > 0 ? new THREE.Color(6, 0.25, 0.2) : new THREE.Color(0.2, 5, 1.2);
  const tipQ = st[N];
  const nav = new THREE.Mesh(new THREE.SphereGeometry(0.07, 12, 8), new THREE.MeshBasicMaterial({ color: navCol, toneMapped: false }));
  nav.position.set(tipQ.x + tipQ.c * 0.1, tipQ.y, tipQ.z * s + s * 0.05); group.add(nav);
  const strobe = new THREE.Mesh(new THREE.SphereGeometry(0.08, 12, 8), new THREE.MeshBasicMaterial({ color: new THREE.Color(9, 9, 9), toneMapped: false }));
  strobe.position.set(tipQ.x + tipQ.c * 0.9, tipQ.y, tipQ.z * s + s * 0.03); group.add(strobe);

  return { group, flaps, spoilers, fans, strobe, nav };
}

// 每幀：襟翼 0..1、擾流板 0..1、風扇轉速
export function animateWing(w, flap, spoiler, rpm, t, dt) {
  w.flaps.forEach((f) => {
    const target = f.aileron ? Math.sin(t * 0.7) * 0.15 : flap;
    f.cur += (target - f.cur) * Math.min(1, dt * 0.8);
    f.pv.quaternion.setFromAxisAngle(f.axis, THREE.MathUtils.degToRad(f.maxDeg) * f.cur);
    f.pv.position.copy(f.base).addScaledVector(f.aft, f.slide * Math.min(1, f.cur * 1.4));
  });
  w.spoilers.forEach((sp) => {
    sp.cur += (spoiler - sp.cur) * Math.min(1, dt * 3);
    sp.pv.quaternion.setFromAxisAngle(sp.axis, THREE.MathUtils.degToRad(48) * sp.cur);
  });
  w.fans.forEach((f) => { f.rotation.y += rpm * dt; });
  w.strobe.visible = (t % 1.2) < 0.06 || ((t % 1.2) > 0.16 && (t % 1.2) < 0.2);
}

// ===== 地景 =====
function terrainTexture() {
  return canvasTex(1024, 1024, (g, w, h) => {
    const r = rng(42);
    g.fillStyle = '#6f7a4c'; g.fillRect(0, 0, w, h);
    const cols = ['#7d8a52', '#8f8a55', '#a59a62', '#5f7342', '#6c7d48', '#9a8f5c', '#56683c', '#b0a46f', '#738456'];
    // 田地拼貼：不規則的旋轉四邊形
    for (let i = 0; i < 420; i++) {
      const x = r() * w, y = r() * h, sw = 30 + r() * 110, sh = 20 + r() * 80, a = (r() - 0.5) * 0.5;
      g.save(); g.translate(x, y); g.rotate(a);
      g.fillStyle = cols[Math.floor(r() * cols.length)]; g.globalAlpha = 0.85; g.fillRect(-sw / 2, -sh / 2, sw, sh);
      // 耕作條紋
      g.globalAlpha = 0.12; g.fillStyle = '#2e3420'; for (let k = -sw / 2; k < sw / 2; k += 4) g.fillRect(k, -sh / 2, 1, sh);
      g.restore();
    }
    g.globalAlpha = 1;
    // 樹林
    for (let i = 0; i < 90; i++) {
      const x = r() * w, y = r() * h, rad = 8 + r() * 30;
      for (let k = 0; k < 30; k++) { g.fillStyle = `rgba(${40 + r() * 20},${60 + r() * 20},${32 + r() * 10},0.55)`; g.beginPath(); g.arc(x + (r() - 0.5) * rad * 2, y + (r() - 0.5) * rad, 3 + r() * 5, 0, 7); g.fill(); }
    }
    // 道路與村落
    g.strokeStyle = 'rgba(190,184,170,0.75)'; g.lineWidth = 2.5;
    for (let i = 0; i < 7; i++) { g.beginPath(); g.moveTo(r() * w, 0); g.bezierCurveTo(r() * w, h * 0.3, r() * w, h * 0.7, r() * w, h); g.stroke(); }
    for (let i = 0; i < 25; i++) {
      const x = r() * w, y = r() * h;
      for (let k = 0; k < 14; k++) { g.fillStyle = r() > 0.5 ? '#c9bfae' : '#a35a43'; g.fillRect(x + (r() - 0.5) * 40, y + (r() - 0.5) * 40, 3 + r() * 4, 3 + r() * 4); }
    }
  });
}
function grassTexture() {
  return canvasTex(512, 512, (g, w, h) => {
    const r = rng(5);
    g.fillStyle = '#6c7f49'; g.fillRect(0, 0, w, h);
    for (let i = 0; i < 6000; i++) { const v = r(); g.fillStyle = `rgba(${70 + v * 60},${90 + v * 50},${45 + v * 25},0.35)`; g.fillRect(r() * w, r() * h, 2, 2 + r() * 3); }
    // 割草條紋
    g.fillStyle = 'rgba(255,255,230,0.05)'; for (let x = 0; x < w; x += 64) g.fillRect(x, 0, 32, h);
  });
}
function asphaltTexture() {
  return canvasTex(256, 512, (g, w, h) => {
    const r = rng(9);
    g.fillStyle = '#4b4e53'; g.fillRect(0, 0, w, h);
    for (let i = 0; i < 9000; i++) { const v = 50 + r() * 50; g.fillStyle = `rgba(${v},${v},${v + 3},0.5)`; g.fillRect(r() * w, r() * h, 1.5, 1.5); }
    // 輪胎痕（中線附近）
    for (let i = 0; i < 30; i++) { g.fillStyle = `rgba(20,20,22,${0.05 + r() * 0.1})`; g.fillRect(w * 0.38 + r() * w * 0.24, r() * h, 4 + r() * 10, 40 + r() * 160); }
    // 中線虛線與邊線
    g.fillStyle = '#ecebe6'; g.fillRect(w / 2 - 2, 0, 4, h * 0.55);
    g.fillRect(6, 0, 5, h); g.fillRect(w - 11, 0, 5, h);
  });
}
function glowSprite() {
  return canvasTex(64, 64, (g) => {
    const gr = g.createRadialGradient(32, 32, 0, 32, 32, 32);
    gr.addColorStop(0, 'rgba(255,255,255,1)'); gr.addColorStop(0.18, 'rgba(255,240,210,0.9)'); gr.addColorStop(0.5, 'rgba(255,200,140,0.18)'); gr.addColorStop(1, 'rgba(255,200,140,0)');
    g.fillStyle = gr; g.fillRect(0, 0, 64, 64);
  });
}

/**
 * 機場與地景。回傳 { group, update(scroll, onRunway) }。
 * x 沿跑道（飛機往 -x 前進，地面往 +x 移動）。
 */
export function makeGround(env) {
  const PERIOD = 4000, RW = 45;
  const group = new THREE.Group();
  const ext = (mm) => { mm.envMap = env; mm.envMapIntensity = 1; mm.userData.ext = true; return mm; };
  const terrainTex = terrainTexture(); terrainTex.wrapS = terrainTex.wrapT = THREE.RepeatWrapping; terrainTex.repeat.set(9, 9);
  const terrain = new THREE.Mesh(new THREE.PlaneGeometry(18000, 18000), ext(new THREE.MeshStandardMaterial({ map: terrainTex, roughness: 1 })));
  terrain.rotation.x = -Math.PI / 2; terrain.position.y = -0.3; terrain.receiveShadow = true; group.add(terrain);
  const grassTex = grassTexture(); grassTex.wrapS = grassTex.wrapT = THREE.RepeatWrapping; grassTex.repeat.set(60, 6);
  const grass = new THREE.Mesh(new THREE.PlaneGeometry(PERIOD * 1.5, 700), ext(new THREE.MeshStandardMaterial({ map: grassTex, roughness: 1 })));
  grass.rotation.x = -Math.PI / 2; grass.position.y = -0.08; grass.receiveShadow = true; group.add(grass);
  const asph = asphaltTexture(); asph.wrapS = asph.wrapT = THREE.RepeatWrapping; asph.rotation = Math.PI / 2; asph.repeat.set(1, PERIOD * 1.5 / 60);
  asph.center.set(0.5, 0.5);
  const runway = new THREE.Mesh(new THREE.PlaneGeometry(PERIOD * 1.5, RW), ext(new THREE.MeshStandardMaterial({ map: asph, roughness: 0.88 })));
  runway.rotation.x = -Math.PI / 2; runway.receiveShadow = true;
  const rwGroup = new THREE.Group(); rwGroup.add(runway); group.add(rwGroup);
  // 滑行道（與跑道平行）與停機坪
  const taxi = new THREE.Mesh(new THREE.PlaneGeometry(PERIOD * 1.5, 23), ext(new THREE.MeshStandardMaterial({ color: '#55585d', roughness: 0.9 })));
  taxi.rotation.x = -Math.PI / 2; taxi.position.set(0, 0.01, 160); rwGroup.add(taxi);
  const tLine = new THREE.Mesh(new THREE.PlaneGeometry(PERIOD * 1.5, 0.3), new THREE.MeshBasicMaterial({ color: '#d9b43c' }));
  tLine.rotation.x = -Math.PI / 2; tLine.position.set(0, 0.03, 160); rwGroup.add(tLine);

  // 跑道上的獨特標線（跑道頭斑馬線、接地區、瞄準點、跑道編號），隨地面捲動並在週期內換位
  const scrollers = [];
  const white = new THREE.MeshStandardMaterial({ color: '#efeee9', roughness: 0.7 });
  const addMark = (geo, x, z, mat = white) => {
    const mm = new THREE.Mesh(geo, mat); mm.rotation.x = -Math.PI / 2; mm.position.set(x, 0.02, z); group.add(mm); scrollers.push({ o: mm, base: x });
  };
  const markRuns = (x0, dir) => {
    for (let k = -6; k <= 6; k++) if (k) addMark(new THREE.PlaneGeometry(45, 1.8), x0, k * 3.1 - Math.sign(k) * 1.4);
    // 編號
    const numTex = canvasTex(256, 128, (g) => { g.fillStyle = '#efeee9'; g.font = '700 110px system-ui'; g.textAlign = 'center'; g.fillText(dir > 0 ? '27' : '09', 128, 105); });
    const numMat = new THREE.MeshStandardMaterial({ map: numTex, transparent: true, roughness: 0.7 });
    const nm = new THREE.Mesh(new THREE.PlaneGeometry(20, 10), numMat); nm.rotation.set(-Math.PI / 2, 0, dir > 0 ? -Math.PI / 2 : Math.PI / 2); nm.position.set(x0 + dir * 50, 0.02, 0); group.add(nm); scrollers.push({ o: nm, base: x0 + dir * 50 });
    // 接地區（成對條紋）與瞄準點
    for (let k = 1; k <= 6; k++) for (const z of [-1, 1]) {
      const n = k <= 2 ? 3 : k <= 4 ? 2 : 1;
      for (let i = 0; i < n; i++) addMark(new THREE.PlaneGeometry(22, 1.8), x0 + dir * (150 + k * 150), z * (6 + i * 3));
    }
    for (const z of [-1, 1]) addMark(new THREE.PlaneGeometry(45, 9), x0 + dir * 400, z * 8);
  };
  markRuns(-1700, 1); markRuns(1700, -1);

  // 跑道燈：邊燈（白）、中線燈（白），以 Points + 光暈貼圖表現
  const glow = glowSprite();
  const mkLights = (spacing, zs, color, size) => {
    const n = Math.ceil(PERIOD * 1.5 / spacing);
    const pos = new Float32Array(n * zs.length * 3); let o = 0;
    for (let i = 0; i < n; i++) zs.forEach((z) => { pos[o++] = -PERIOD * 0.75 + i * spacing; pos[o++] = 0.35; pos[o++] = z; });
    const g = new THREE.BufferGeometry(); g.setAttribute('position', new THREE.BufferAttribute(pos, 3));
    const pts = new THREE.Points(g, new THREE.PointsMaterial({ map: glow, color, size, sizeAttenuation: true, transparent: true, depthWrite: false, blending: THREE.AdditiveBlending, toneMapped: false }));
    pts.userData.spacing = spacing;
    group.add(pts); return pts;
  };
  const edge = mkLights(60, [-RW / 2 - 1.5, RW / 2 + 1.5], new THREE.Color(3.2, 2.9, 2.4), 3.2);
  const center = mkLights(15, [0], new THREE.Color(2.4, 2.4, 2.4), 1.6);
  const taxiL = mkLights(30, [160 - 13, 160 + 13], new THREE.Color(0.4, 0.8, 3.6), 2.4);
  const periodic = [edge, center, taxiL];

  // 航廈、塔台、停機坪上的飛機剪影、樹與遠山
  const bm = ext(new THREE.MeshStandardMaterial({ color: '#d4d6d9', roughness: 0.8 }));
  const gm = ext(new THREE.MeshPhysicalMaterial({ color: '#5e7a99', roughness: 0.08, metalness: 0.6, clearcoat: 1 }));
  for (let i = 0; i < 7; i++) {
    const b = new THREE.Mesh(new THREE.BoxGeometry(70 + (i % 3) * 30, 14 + (i % 2) * 8, 40), i % 2 ? gm : bm);
    const x = -700 + i * 220; b.position.set(x, 7 + (i % 2) * 4, 290 + (i % 3) * 25); group.add(b); scrollers.push({ o: b, base: x });
    const roof = new THREE.Mesh(new THREE.BoxGeometry(b.geometry.parameters.width + 4, 1.2, 44), bm); roof.position.set(x, b.position.y * 2 + 0.6, b.position.z); group.add(roof); scrollers.push({ o: roof, base: x });
  }
  const tower = new THREE.Group();
  tower.add(new THREE.Mesh(new THREE.CylinderGeometry(3.5, 5, 46, 24), bm));
  const cab = new THREE.Mesh(new THREE.CylinderGeometry(8, 6, 7, 24), gm); cab.position.y = 26; tower.add(cab);
  tower.position.set(420, 23, 360); group.add(tower); scrollers.push({ o: tower, base: 420 });
  // 樹（合併為少量網格）
  const r = rng(3);
  const treeGeos = [];
  for (let i = 0; i < 260; i++) {
    const tg = new THREE.IcosahedronGeometry(3 + r() * 3, 1); tg.scale(1, 1.3, 1);
    const side = r() > 0.35 ? 1 : -1;
    tg.translate(-PERIOD / 2 + r() * PERIOD, 4, side * (420 + r() * 900)); treeGeos.push(tg);
  }
  const trees = new THREE.Mesh(mergeGeometries(treeGeos), ext(new THREE.MeshStandardMaterial({ color: '#46623a', roughness: 1, flatShading: true })));
  group.add(trees);
  // 遠山：環形噪聲山脊（被霧氣染成藍灰）
  const hillGeo = new THREE.CylinderGeometry(5200, 5200, 1, 180, 6, true);
  const hp = hillGeo.attributes.position;
  for (let i = 0; i < hp.count; i++) {
    const x = hp.getX(i), z = hp.getZ(i), yv = hp.getY(i) + 0.5;
    const a = Math.atan2(z, x);
    const hgt = 120 + 260 * Math.abs(Math.sin(a * 3.1) * Math.sin(a * 7.3 + 1) + 0.4 * Math.sin(a * 17.7));
    const rad = 5200 - yv * 900;
    hp.setXYZ(i, Math.cos(a) * rad, yv * hgt - 20, Math.sin(a) * rad);
  }
  hillGeo.computeVertexNormals();
  const hills = new THREE.Mesh(hillGeo, ext(new THREE.MeshStandardMaterial({ color: '#56634e', roughness: 1, side: THREE.DoubleSide })));
  group.add(hills);

  const wrap = (v) => ((v % PERIOD) + PERIOD * 1.5) % PERIOD - PERIOD / 2;
  return {
    group, terrain,
    update(scroll, lateral) {
      rwGroup.position.z = lateral; // 滑行時跑道在右側，起降時在正下方
      scrollers.forEach((sc) => { if (sc.zBase === undefined) sc.zBase = sc.o.position.z; sc.o.position.x = wrap(sc.base + scroll); sc.o.position.z = sc.zBase + lateral; });
      trees.position.set(wrap(scroll), 0, lateral);
      periodic.forEach((p) => { p.position.set(scroll % p.userData.spacing, 0, lateral); });
      terrainTex.offset.set(-scroll / 2000, -lateral / 2000);
      grass.position.z = lateral; grassTex.offset.x = -scroll / 100;
      asph.offset.y = scroll / 60;
    },
  };
}

function cloudDeckTexture() {
  return canvasTex(1024, 1024, (g, w, h) => {
    g.fillStyle = 'rgba(0,0,0,0)'; g.clearRect(0, 0, w, h);
    const r = rng(77);
    for (let i = 0; i < 2600; i++) {
      const x = r() * w, y = r() * h, rad = 10 + r() * 46;
      const gr = g.createRadialGradient(x, y, 0, x, y, rad);
      const a = 0.08 + r() * 0.16;
      gr.addColorStop(0, `rgba(255,255,255,${a})`); gr.addColorStop(1, 'rgba(255,255,255,0)');
      g.fillStyle = gr;
      for (const dx of [-w, 0, w]) for (const dy of [-h, 0, h]) { g.beginPath(); g.arc(x + dx, y + dy, rad, 0, 7); g.fill(); }
    }
  });
}

// 雲：每朵雲合併成單一網格（減少繪製呼叫）＋ 巡航高度下方的雲海
export function makeClouds(env) {
  const group = new THREE.Group();
  const deckTex = cloudDeckTexture(); deckTex.wrapS = deckTex.wrapT = THREE.RepeatWrapping; deckTex.repeat.set(10, 10);
  const deckMat = new THREE.MeshStandardMaterial({ map: deckTex, color: '#ffffff', roughness: 1, transparent: true, depthWrite: false });
  deckMat.envMap = env; deckMat.envMapIntensity = 1.4; deckMat.userData.ext = true;
  const under = new THREE.Mesh(new THREE.PlaneGeometry(20000, 20000), new THREE.MeshStandardMaterial({ color: '#8d9db3', roughness: 1 }));
  under.material.envMap = env; under.material.userData.ext = true;
  under.rotation.x = -Math.PI / 2; under.position.y = -900;
  const deck = new THREE.Mesh(new THREE.PlaneGeometry(20000, 20000), deckMat);
  deck.rotation.x = -Math.PI / 2; deck.position.y = -520;
  const deck2 = deck.clone(); deck2.position.y = -560; deck2.material = deckMat.clone(); deck2.material.map = deckTex.clone(); deck2.material.map.repeat.set(6, 6); deck2.material.map.needsUpdate = true;
  group.userData.deck = [deckTex, deck2.material.map];
  group.add(under, deck2, deck);
  const mat = new THREE.MeshStandardMaterial({ color: '#ffffff', roughness: 1, transparent: true, opacity: 0.93 });
  mat.envMap = env; mat.envMapIntensity = 1.2; mat.userData.ext = true;
  const r = rng(21);
  for (let i = 0; i < 50; i++) {
    const n = 4 + Math.floor(r() * 6), parts = [];
    for (let k = 0; k < n; k++) {
      const sg = new THREE.IcosahedronGeometry(6 + r() * 10, 2); sg.scale(1, 0.5, 1);
      sg.translate(k * 8 - n * 4, r() * 4, r() * 10 - 5); parts.push(sg);
    }
    const cl = new THREE.Mesh(mergeGeometries(parts), mat); cl.userData.puff = true;
    cl.position.set(r() * 2000 - 1000, -25 - r() * 50, (r() - 0.5) * 1200);
    group.add(cl);
  }
  return group;
}
