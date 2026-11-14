// 3D 機艙（寫實風格）：PBR 材質、環境光照、環境光遮蔽、光暈、平滑第一人稱
import * as THREE from 'three';
import { RoomEnvironment } from 'three/addons/environments/RoomEnvironment.js';
import { EffectComposer } from 'three/addons/postprocessing/EffectComposer.js';
import { RenderPass } from 'three/addons/postprocessing/RenderPass.js';
import { GTAOPass } from 'three/addons/postprocessing/GTAOPass.js';
import { UnrealBloomPass } from 'three/addons/postprocessing/UnrealBloomPass.js';
import { OutputPass } from 'three/addons/postprocessing/OutputPass.js';
import { SMAAPass } from 'three/addons/postprocessing/SMAAPass.js';
import { RoundedBoxGeometry } from 'three/addons/geometries/RoundedBoxGeometry.js';
import { RectAreaLightUniformsLib } from 'three/addons/lights/RectAreaLightUniformsLib.js';
import { Reflector } from 'three/addons/objects/Reflector.js';
RectAreaLightUniformsLib.init();
import { PAX_TYPES, PRIORITY } from './data.js';
import { activeSeats, binDoors, roomLayout, LAV, lavLayout, bagPose, binCapacity } from './layout.js';
import { M, materials, textures, seatAsset, passengerGeometry, PAX_MAT, makeCrew as buildCrew, makeCart, makeMealTray, makeSuitcase, makeBinBag, makePaxWalker } from './art.js';

export const makeCrew = buildCrew;
const P = (x, y, h = 0) => new THREE.Vector3(x, h, -y); // 模擬座標 → three
const CUT_H = 1.45;
const EYE_H = 1.64;

function roundRect(w, h, r) {
  const s = new THREE.Shape(), x = -w / 2, y = -h / 2;
  s.moveTo(x + r, y); s.lineTo(x + w - r, y); s.quadraticCurveTo(x + w, y, x + w, y + r);
  s.lineTo(x + w, y + h - r); s.quadraticCurveTo(x + w, y + h, x + w - r, y + h);
  s.lineTo(x + r, y + h); s.quadraticCurveTo(x, y + h, x, y + h - r);
  s.lineTo(x, y + r); s.quadraticCurveTo(x, y, x + r, y);
  return s;
}
// 沿機身掃掠剖面（含 UV：u = 機身方向公尺、v = 剖面長度公尺）
function sweep(points, x0, x1, side) {
  const pos = [], uv = [];
  const lens = [0];
  for (let i = 1; i < points.length; i++) lens.push(lens[i - 1] + Math.hypot(points[i][0] - points[i - 1][0], points[i][1] - points[i - 1][1]));
  for (let i = 0; i < points.length - 1; i++) {
    const [r0, h0] = points[i], [r1, h1] = points[i + 1];
    const a = [x0, h0, side * r0], b = [x1, h0, side * r0], c = [x1, h1, side * r1], d = [x0, h1, side * r1];
    const ua = [x0, lens[i]], ub = [x1, lens[i]], uc = [x1, lens[i + 1]], ud = [x0, lens[i + 1]];
    if (side > 0) { pos.push(...a, ...b, ...c, ...a, ...c, ...d); uv.push(...ua, ...ub, ...uc, ...ua, ...uc, ...ud); }
    else { pos.push(...a, ...c, ...b, ...a, ...d, ...c); uv.push(...ua, ...uc, ...ub, ...ua, ...ud, ...uc); }
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  g.setAttribute('uv', new THREE.Float32BufferAttribute(uv, 2));
  // 平滑法線：同一剖面點共用法線
  const normals = new Float32Array(pos.length);
  const pn = points.map((p, i) => {
    const a = points[Math.max(0, i - 1)], b = points[Math.min(points.length - 1, i + 1)];
    const tr = b[0] - a[0], th = b[1] - a[1];
    const l = Math.hypot(tr, th) || 1;
    return [-th / l, tr / l]; // (r, h) 方向的法線
  });
  let o = 0;
  for (let i = 0; i < points.length - 1; i++) {
    for (const k of (side > 0 ? [i, i, i + 1, i, i + 1, i + 1] : [i, i + 1, i, i, i + 1, i + 1])) { const [nr, nh] = pn[k]; normals[o++] = 0; normals[o++] = nh; normals[o++] = side * nr; }
  }
  g.setAttribute('normal', new THREE.BufferAttribute(normals, 3));
  return g;
}
function smoothProfile(pts, n = 6) {
  const curve = new THREE.SplineCurve(pts.map(([r, h]) => new THREE.Vector2(r, h)));
  return curve.getPoints(pts.length * n).map((v) => [v.x, v.y]);
}
function canvasTex(w, h, draw) {
  const c = document.createElement('canvas'); c.width = w; c.height = h;
  draw(c.getContext('2d'), w, h);
  const t = new THREE.CanvasTexture(c); t.colorSpace = THREE.SRGBColorSpace; t.anisotropy = 4;
  return t;
}
function facadeTexture(type, label, accent) {
  return canvasTex(512, 512, (g) => {
    const rr = (x, y, w, h, r) => { g.beginPath(); g.roundRect(x, y, w, h, r); };
    if (type === 'galley') {
      g.fillStyle = '#b9bfc8'; g.fillRect(0, 0, 512, 512);
      for (let i = 0; i < 4; i++) { const gr = g.createLinearGradient(0, 30, 0, 170); gr.addColorStop(0, '#dfe3e8'); gr.addColorStop(1, '#c4cad2'); g.fillStyle = gr; rr(16 + i * 124, 28, 110, 140, 8); g.fill(); g.fillStyle = '#7d8693'; rr(52 + i * 124, 92, 38, 8, 4); g.fill(); }
      for (let i = 0; i < 3; i++) {
        const gr = g.createLinearGradient(0, 210, 0, 500); gr.addColorStop(0, '#e6e9ed'); gr.addColorStop(1, '#c9ced5');
        g.fillStyle = gr; rr(20 + i * 164, 206, 148, 290, 10); g.fill();
        g.fillStyle = accent; g.fillRect(20 + i * 164, 228, 148, 10);
        g.fillStyle = '#6d7684'; rr(70 + i * 164, 276, 48, 12, 6); g.fill();
        g.fillStyle = '#2b2f36'; g.fillRect(30 + i * 164, 470, 22, 14); g.fillRect(136 + i * 164, 470, 22, 14);
      }
    } else if (type === 'lav') {
      g.fillStyle = '#e1e4e9'; g.fillRect(0, 0, 512, 512);
      const gr = g.createLinearGradient(0, 0, 512, 0); gr.addColorStop(0, '#eceef2'); gr.addColorStop(1, '#f6f7f9');
      g.fillStyle = gr; rr(90, 26, 332, 476, 18); g.fill(); g.strokeStyle = '#c3c9d1'; g.lineWidth = 6; g.stroke();
      g.fillStyle = '#26324a'; rr(186, 110, 140, 72, 10); g.fill();
      g.fillStyle = '#ffffff'; g.font = '600 46px system-ui'; g.textAlign = 'center'; g.fillText('WC', 256, 162);
      g.fillStyle = '#3fb37f'; g.beginPath(); g.arc(256, 228, 10, 0, 7); g.fill();
      g.fillStyle = '#8d96a4'; rr(360, 260, 16, 70, 8); g.fill();
    } else if (type === 'door') {
      g.fillStyle = '#e6e9ee'; g.fillRect(0, 0, 512, 512);
      g.strokeStyle = '#aab1bc'; g.lineWidth = 10; rr(36, 14, 440, 484, 60); g.stroke();
      const gr = g.createRadialGradient(256, 130, 10, 256, 130, 60); gr.addColorStop(0, '#d7ecff'); gr.addColorStop(1, '#7fa9d6');
      g.fillStyle = '#c3cad4'; g.beginPath(); g.arc(256, 130, 62, 0, 7); g.fill();
      g.fillStyle = gr; g.beginPath(); g.arc(256, 130, 50, 0, 7); g.fill();
      g.fillStyle = '#6e7684'; rr(300, 250, 130, 26, 13); g.fill();
      g.fillStyle = '#d3d8df'; rr(66, 360, 380, 118, 14); g.fill();
      g.fillStyle = '#c0392b'; rr(86, 380, 90, 22, 4); g.fill();
      g.fillStyle = '#4e5664'; g.font = '700 38px system-ui'; g.textAlign = 'center'; g.fillText(label || 'DOOR', 310, 438);
    } else if (type === 'cockpit') {
      g.fillStyle = '#d5d9e0'; g.fillRect(0, 0, 512, 512);
      g.fillStyle = '#c8cdd5'; rr(140, 30, 232, 470, 12); g.fill(); g.strokeStyle = '#aeb5bf'; g.lineWidth = 5; g.stroke();
      g.fillStyle = '#1f252e'; g.beginPath(); g.arc(256, 150, 16, 0, 7); g.fill();
      g.fillStyle = '#7f8896'; rr(320, 260, 18, 70, 9); g.fill();
    } else {
      g.fillStyle = '#c7c0b1'; g.fillRect(0, 0, 512, 512); g.strokeStyle = '#a8a193'; g.lineWidth = 8; g.strokeRect(30, 30, 452, 452);
    }
  });
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
    this.renderer = new THREE.WebGLRenderer({ antialias: false, powerPreference: 'high-performance' });
    this.renderer.outputColorSpace = THREE.SRGBColorSpace;
    this.renderer.toneMapping = THREE.AgXToneMapping;
    this.renderer.toneMappingExposure = 1.0;
    this.renderer.shadowMap.enabled = true;
    this.renderer.shadowMap.type = THREE.PCFSoftShadowMap;
    this.renderer.localClippingEnabled = true;
    container.appendChild(this.renderer.domElement);
    this.scene = new THREE.Scene();
    this.camera = new THREE.PerspectiveCamera(55, 1, 0.05, 6000);
    this.mode = 'orbit';
    this.orbit = { yaw: -2.25, pitch: 0.8, dist: 18, target: new THREE.Vector3(10, 0, 0) };
    this.fp = { yaw: 0, pitch: -0.05 };
    this.fpView = { yaw: 0, pitch: -0.05 };
    this.vel = new THREE.Vector2();
    this.bob = 0;
    this.keys = {};
    this.layoutKey = null;
    this.paxMeshes = new Map();
    this.markers = new Map();
    this.clipLocal = new THREE.Plane(new THREE.Vector3(0, -1, 0), CUT_H);
    this.clipWorld = new THREE.Plane();
    this.clipMats = [];
    this.lastWalker = null;
    this.quality = (app.state.settings && app.state.settings.quality) || 'high';
    this.frameTimes = [];

    const pmrem = new THREE.PMREMGenerator(this.renderer);
    this.envTex = pmrem.fromScene(new RoomEnvironment(this.renderer), 0.04).texture;
    this.scene.environment = this.envTex;

    this.scene.fog = new THREE.Fog(0xbfd6ee, 80, 1400);
    this.hemi = new THREE.HemisphereLight(0xe8eeff, 0xc9bfb3, 0.35);
    this.scene.add(this.hemi);
    this.sun = new THREE.DirectionalLight(0xfff1dc, 1.7);
    this.sun.castShadow = true;
    this.sun.shadow.mapSize.set(2048, 2048);
    this.sun.shadow.bias = -0.0003;
    this.sun.shadow.normalBias = 0.025;
    this.scene.add(this.sun, this.sun.target);

    this.cabin = new THREE.Group();
    this.scene.add(this.cabin);
    this.eye = new THREE.Object3D();
    this.cabin.add(this.eye);

    this.skyCanvas = document.createElement('canvas'); this.skyCanvas.width = 4; this.skyCanvas.height = 256;
    this.skyTex = new THREE.CanvasTexture(this.skyCanvas); this.skyTex.colorSpace = THREE.SRGBColorSpace;
    this.scene.background = this.skyTex;
    this.skyKey = '';

    this.composer = new EffectComposer(this.renderer);
    this.renderPass = new RenderPass(this.scene, this.camera);
    this.gtao = new GTAOPass(this.scene, this.camera, 1, 1);
    this.gtao.blendIntensity = 0.9;
    this.gtao.updateGtaoMaterial({ radius: 0.45, distanceExponent: 1.6, thickness: 1.5, scale: 1.15, samples: 16 });
    this.bloom = new UnrealBloomPass(new THREE.Vector2(256, 256), 0.22, 0.45, 1.3);
    this.outputPass = new OutputPass();
    this.smaa = new SMAAPass(1, 1);
    this.composer.addPass(this.renderPass);
    this.composer.addPass(this.gtao);
    this.composer.addPass(this.bloom);
    this.composer.addPass(this.outputPass);
    this.composer.addPass(this.smaa);

    this.buildEnvironment();
    this.bind();
    this.setQuality(this.quality);
  }

  setQuality(q) {
    this.quality = q;
    this.renderer.setPixelRatio(Math.min(q === 'high' ? 2 : q === 'medium' ? 1.25 : 1, window.devicePixelRatio || 1));
    this.renderer.shadowMap.enabled = q !== 'low';
    this.resize();
    this.applyMode();
  }

  clipped(mat) {
    const m = mat.clone();
    m.clippingPlanes = this.mode === 'fp' ? [] : [this.clipWorld];
    this.clipMats.push(m);
    return m;
  }

  buildEnvironment() {
    const rt = canvasTex(512, 256, (g) => {
      g.fillStyle = '#6d7a5c'; g.fillRect(0, 0, 512, 256);
      g.fillStyle = '#4a4d55'; g.fillRect(0, 70, 512, 116);
      g.fillStyle = 'rgba(255,255,255,0.03)'; for (let i = 0; i < 300; i++) g.fillRect(Math.random() * 512, 70 + Math.random() * 116, 20 + Math.random() * 30, 1);
      g.fillStyle = '#f2f2f2'; for (let x = 0; x < 512; x += 64) g.fillRect(x, 125, 34, 6);
      g.fillRect(0, 76, 512, 4); g.fillRect(0, 176, 512, 4);
      g.fillStyle = '#e0c25a'; for (let x = 20; x < 512; x += 128) { g.beginPath(); g.arc(x, 74, 2.5, 0, 7); g.fill(); g.beginPath(); g.arc(x, 182, 2.5, 0, 7); g.fill(); }
    });
    rt.wrapS = rt.wrapT = THREE.RepeatWrapping; rt.repeat.set(30, 1); rt.anisotropy = 8;
    this.groundTex = rt;
    const runway = new THREE.Mesh(new THREE.PlaneGeometry(6000, 90), new THREE.MeshStandardMaterial({ map: rt, roughness: 0.92 }));
    runway.rotation.x = -Math.PI / 2; runway.receiveShadow = true;
    const grass = new THREE.Mesh(new THREE.PlaneGeometry(12000, 12000), new THREE.MeshStandardMaterial({ color: 0x6c8256, roughness: 1 }));
    grass.rotation.x = -Math.PI / 2; grass.position.y = -0.05; grass.receiveShadow = true;
    this.groundGroup = new THREE.Group();
    this.groundGroup.add(grass, runway);
    const bm = new THREE.MeshStandardMaterial({ color: 0xd0d5dc, roughness: 0.8 });
    const gm = new THREE.MeshPhysicalMaterial({ color: 0x86a9cf, roughness: 0.1, metalness: 0.3, clearcoat: 1 });
    for (let i = 0; i < 6; i++) {
      const b = new THREE.Mesh(new RoundedBoxGeometry(40 + i * 7, 10 + (i % 3) * 5, 22, 2, 1.5), i % 2 ? gm : bm);
      b.position.set(-200 + i * 70, 6, -140 - (i % 2) * 20); this.groundGroup.add(b);
    }
    const tower = new THREE.Mesh(new THREE.CylinderGeometry(3, 4, 40, 24), bm); tower.position.set(160, 20, -170); this.groundGroup.add(tower);
    const cab = new THREE.Mesh(new THREE.CylinderGeometry(7, 5, 6, 24), gm); cab.position.set(160, 42, -170); this.groundGroup.add(cab);
    const tm = new THREE.MeshStandardMaterial({ color: 0x4d7448, roughness: 1 });
    for (let i = 0; i < 60; i++) {
      const t = new THREE.Mesh(new THREE.SphereGeometry(3 + Math.random() * 2.5, 12, 10), tm);
      t.scale.y = 1.4; t.position.set(Math.random() * 1600 - 800, 5, (Math.random() > 0.5 ? 1 : -1) * (90 + Math.random() * 300)); this.groundGroup.add(t);
    }
    this.scene.add(this.groundGroup);

    this.clouds = new THREE.Group();
    const cm = new THREE.MeshStandardMaterial({ color: 0xffffff, roughness: 1, transparent: true, opacity: 0.92 });
    for (let i = 0; i < 45; i++) {
      const cl = new THREE.Group();
      const n = 4 + Math.floor(Math.random() * 5);
      for (let k = 0; k < n; k++) {
        const m = new THREE.Mesh(new THREE.SphereGeometry(6 + Math.random() * 9, 16, 12), cm);
        m.position.set(k * 8 - n * 4, Math.random() * 4, Math.random() * 8 - 4); m.scale.y = 0.55;
        cl.add(m);
      }
      cl.position.set(Math.random() * 1800 - 900, -25 - Math.random() * 50, (Math.random() - 0.5) * 1000);
      this.clouds.add(cl);
    }
    this.scene.add(this.clouds);

    this.winCanvas = document.createElement('canvas'); this.winCanvas.width = 64; this.winCanvas.height = 96;
    this.winTex = new THREE.CanvasTexture(this.winCanvas);
    this.winTex.colorSpace = THREE.SRGBColorSpace;
    this.winMat = new THREE.MeshBasicMaterial({ map: this.winTex, toneMapped: false, color: new THREE.Color(1.45, 1.45, 1.45) });
  }

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
    this.npcMeshes = new Map();
    this.glow = [];
    this.oxyBuilt = new Map();
    this.cockpitPanel = null;
    this.mirrors = [];
    this.serveAnim = null; this.serveQueue = [];
    this.cabinDoors = []; this.doorGaps = {};
    this.bagMeshes = new Map(); this.walkers = new Map(); this.callMarks = new Map(); this.spillMeshes = new Map(); this.binBlend = 0;
    const m = materials();
    const L = ac.length, W = ac.width, R = W / 2;
    const uni = prof.uniform;
    const accent = uni.scarf;

    // 地板
    const carpet = m.carpet.clone();
    carpet.map = textures().carpet.clone(); carpet.map.repeat.set(L / 1.6, W / 1.6); carpet.map.needsUpdate = true;
    carpet.normalMap = textures().carpetN.clone(); carpet.normalMap.repeat.set(L / 0.5, W / 0.5); carpet.normalMap.needsUpdate = true;
    const floor = new THREE.Mesh(new THREE.PlaneGeometry(L, W), carpet);
    floor.rotation.x = -Math.PI / 2; floor.position.set(L / 2, 0.002, 0); floor.receiveShadow = true;
    this.cabin.add(floor);
    // 走道地板緊急照明條
    const pathMat = new THREE.MeshBasicMaterial({ color: new THREE.Color(1.6, 1.2, 0.6), toneMapped: false });
    const ys = [...new Set(activeSeats(ac).map((s) => +s.y.toFixed(2)))].sort((a, b) => a - b);
    const edges = [];
    for (let i = 0; i < ys.length - 1; i++) if (ys[i + 1] - ys[i] > 0.75) edges.push(ys[i] + 0.28, ys[i + 1] - 0.28);
    edges.slice(0, 4).forEach((yy) => { const st = new THREE.Mesh(new THREE.BoxGeometry(L - 6, 0.004, 0.012), pathMat); st.position.set(L / 2 + 0.5, 0.006, -yy); this.cabin.add(st); });

    // ===== 客艙內裝（依照片：側牆內襯板、圓形窗框凹槽、大型行李櫃、間接照明天花板） =====
    // 行李櫃區段與櫃門（與模擬共用編號，才能逐片開關）
    const bd = binDoors(ac);
    const binZones = bd.zones;
    this.binZones = binZones; this.binInner = R - 0.74;
    this.pivots = new Map(); this.propMeshes = [];
    const binX0 = binZones.length ? binZones[0][0] : 2.4, binX1 = binZones.length ? binZones[binZones.length - 1][1] : L - 1.6;
    // 側牆貼圖：每兩扇窗一道內襯板接縫、下方腳踢板回風格柵
    const wallTex = canvasTex(256, 512, (g) => {
      const gr = g.createLinearGradient(0, 0, 0, 512); gr.addColorStop(0, '#e6e6e3'); gr.addColorStop(1, '#d6d7d4');
      g.fillStyle = gr; g.fillRect(0, 0, 256, 512);
      g.fillStyle = 'rgba(70,74,80,0.35)'; g.fillRect(0, 0, 2, 512); g.fillStyle = 'rgba(255,255,255,0.5)'; g.fillRect(2, 0, 1, 512);
      g.fillStyle = 'rgba(0,0,0,0.06)'; for (let i = 0; i < 6; i++) g.fillRect(0, 300 + i * 30, 256, 1);
    });
    wallTex.wrapS = THREE.RepeatWrapping; wallTex.repeat.set(1 / 1.06, 1 / 1.6); wallTex.offset.x = -3.2 / 1.06 + 0.25;
    const wall = this.clipped(m.wall); wall.map = wallTex; wall.color = new THREE.Color('#ffffff');
    const dadoTex = canvasTex(256, 64, (g) => { g.fillStyle = '#b9bcc0'; g.fillRect(0, 0, 256, 64); g.fillStyle = '#5c6068'; for (let x = 10; x < 256; x += 8) g.fillRect(x, 18, 4, 30); });
    dadoTex.wrapS = THREE.RepeatWrapping; dadoTex.repeat.set(1 / 0.53, 1 / 0.25);
    const kick = this.clipped(m.kick); kick.map = dadoTex; kick.color = new THREE.Color('#ffffff');
    const bin = this.clipped(m.bin);
    const binUnder = this.clipped(m.binUnder);
    const ceilTex = canvasTex(512, 256, (g) => {
      g.fillStyle = '#e4e4e0'; g.fillRect(0, 0, 512, 256);
      g.fillStyle = 'rgba(60,64,70,0.28)'; g.fillRect(0, 0, 3, 256);
      g.fillStyle = 'rgba(0,0,0,0.05)'; g.fillRect(250, 0, 12, 256);
      g.fillStyle = '#c9cbcd'; g.beginPath(); g.arc(380, 128, 14, 0, 7); g.fill(); g.fillStyle = '#9da1a6'; for (let k = -8; k <= 8; k += 4) g.fillRect(372, 128 + k, 16, 1.5);
    });
    ceilTex.wrapS = THREE.RepeatWrapping; ceilTex.repeat.set(1 / 1.52, 1 / 3);
    const ceil = this.clipped(m.ceiling); ceil.map = ceilTex; ceil.color = new THREE.Color('#ffffff');
    const glowMat = new THREE.MeshBasicMaterial({ color: new THREE.Color(1.1, 0.98, 0.8), toneMapped: false });
    this.glowMats = [glowMat];
    for (const s of [-1, 1]) {
      // 側牆（下方腳踢板 + 弧形內襯板）
      const ix = R - 0.74; // 行李櫃內緣（離中線距離）
      // 艙門處牆面斷開，改成垂直的門區（艙門高約 1.95 m）
      const gaps = ac.fixtures.filter((f) => f.type === 'door' && -Math.sign(f.y) === s).map((f) => [f.x - f.w / 2 - 0.14, f.x + f.w / 2 + 0.14]).sort((a, b) => a[0] - b[0]);
      const spans = []; let cur = 0; gaps.forEach(([a, b]) => { if (a > cur) spans.push([cur, a]); cur = Math.max(cur, b); }); if (cur < L) spans.push([cur, L]);
      this.doorGaps = this.doorGaps || {}; this.doorGaps[s] = gaps;
      const wallProf = smoothProfile([[R + 0.015, 0.25], [R + 0.05, 0.75], [R + 0.03, 1.15], [R - 0.05, 1.45], [R - 0.17, 1.64]], 8);
      const shProf = smoothProfile([[R - 0.17, 1.64], [R - 0.3, 1.86], [R - 0.48, 2.02], [ix + 0.3, 2.1]], 6);
      spans.forEach(([a, b]) => {
        this.cabin.add(new THREE.Mesh(sweep([[R, 0], [R + 0.015, 0.25]], a, b, s), kick));
        this.cabin.add(new THREE.Mesh(sweep(wallProf, a, b, s), wall));
        const sh = new THREE.Mesh(sweep(shProf, a, b, s), ceil); sh.userData.ceiling = true; this.cabin.add(sh);
      });
      gaps.forEach(([a, b]) => {
        const hd = new THREE.Mesh(sweep([[R - 0.03, 2.03], [R - 0.3, 2.08], [ix + 0.3, 2.1]], a, b, s), ceil); this.cabin.add(hd);
        this.cabin.add(new THREE.Mesh(sweep([[R - 0.03, 0], [R - 0.03, 0.06]], a, b, s), kick));
        // 斷面封板
        for (const ex of [a, b]) {
          const pts = [[R - 0.03, 1.25], ...wallProf.filter(([r, h]) => h > 1.3), ...shProf.slice(1), [R - 0.03, 2.1]];
          const sh = new THREE.Shape(); sh.moveTo(pts[0][0], pts[0][1]); pts.slice(1).forEach(([r, h]) => sh.lineTo(r, h));
          const cg = new THREE.ShapeGeometry(sh); cg.rotateY(-Math.PI / 2);
          const cm = new THREE.Mesh(cg, wall); cm.position.x = ex; cm.scale.z = s; this.cabin.add(cm);
        }
      });
      // 牆頂到天花板的弧形過渡板（全長；門區、廚房上方沒有行李櫃時可見）
      // 天花板（從照明槽往中央拱起）
      const cl = new THREE.Mesh(sweep(smoothProfile([[ix + 0.3, 2.1], [ix * 0.55, 2.24], [ix * 0.25, 2.29], [0, 2.3]], 6), 0, L, s), ceil); cl.userData.ceiling = true; this.cabin.add(cl);
      // 行李櫃：只裝在座位區上方（艙門、廚房區沒有行李櫃，與真實機艙相同）
      for (const [bx0, bx1] of binZones) {
        const under = new THREE.Mesh(sweep([[R - 0.17, 1.64], [ix + 0.03, 1.64]], bx0, bx1, s), binUnder); under.userData.ceiling = true; this.cabin.add(under);
        const lip = new THREE.Mesh(sweep(smoothProfile([[ix + 0.03, 1.64], [ix - 0.005, 1.655], [ix - 0.012, 1.7], [ix, 1.72]], 4), bx0, bx1, s), this.clipped(m.shellDark)); lip.userData.ceiling = true; this.cabin.add(lip);
        const cove = new THREE.Mesh(new THREE.BoxGeometry(bx1 - bx0, 0.006, 0.05), glowMat); cove.position.set((bx0 + bx1) / 2, 2.075, s * (ix + 0.29)); cove.userData.ceiling = true; this.cabin.add(cove);
        const top = new THREE.Mesh(sweep([[ix + 0.24, 2.08], [ix + 0.3, 2.1]], bx0, bx1, s), bin); top.userData.ceiling = true; this.cabin.add(top);
        // 兩端封板
        for (const ex of [bx0, bx1]) {
          const capS = new THREE.Shape(); const pts = [[R - 0.17, 1.64], [ix + 0.03, 1.64], [ix - 0.012, 1.7], [ix, 1.84], [ix + 0.12, 2.04], [ix + 0.3, 2.1], [R - 0.48, 2.02], [R - 0.3, 1.86]];
          capS.moveTo(pts[0][0], pts[0][1]); pts.slice(1).forEach(([a2, b2]) => capS.lineTo(a2, b2));
          const cg = new THREE.ShapeGeometry(capS); cg.rotateY(s > 0 ? -Math.PI / 2 : Math.PI / 2);
          const capm = new THREE.Mesh(cg, binUnder); capm.position.x = ex; if (s < 0) capm.scale.z = 1; capm.userData.ceiling = true; this.cabin.add(capm);
        }
      }
      // 櫃門：每片獨立，以上緣為鉸鏈向上開啟；櫃內放幾件行李
      const seamMat = this.clipped(m.shellDark); seamMat.color = new THREE.Color('#8b9097');
      const doorProfile = smoothProfile([[ix, 1.72], [ix - 0.02, 1.84], [ix + 0.02, 1.96], [ix + 0.12, 2.04], [ix + 0.24, 2.08]], 8);
      const hz = s * (ix + 0.24), hy = 2.08;
      const bagCols = ['#2a2d33', '#5b3b2a', '#30445e', '#6b6f78', '#7a2f35', '#1f3a33'];
      const bagMats = bagCols.map((c) => this.clipped(new THREE.MeshStandardMaterial({ color: c, roughness: 0.6 })));
      // 下翻式行李櫃（pivot bin）：開啟時櫃體前緣往下翻，關閉時要由下往上推
      bd.doors.filter((d) => d.side === -s && !d.center).forEach((d) => {
        const hy2 = 2.05, hz2 = s * (R - 0.2);
        const pivot = new THREE.Group(); pivot.position.set(0, hy2, hz2);
        const dg = sweep(doorProfile, d.x0 + 0.004, d.x1 - 0.004, s); dg.translate(0, -hy2, -hz2);
        const dm = new THREE.Mesh(dg, bin); dm.userData.propId = d.id;
        const handle = new THREE.Mesh(new RoundedBoxGeometry(0.22, 0.022, 0.03, 2, 0.01), seamMat); handle.position.set(d.x, 1.7 - hy2, s * (ix - 0.014) - hz2); handle.userData.propId = d.id;
        pivot.add(dm, handle); pivot.userData.ceiling = true;
        this.cabin.add(pivot); this.propMeshes.push(dm, handle);
        this.pivots.set(d.id, { pivot, axis: 'x', base: 0, dir: this.downSign(new THREE.Vector3(0, 1.72 - hy2, s * ix - hz2)), max: 0.48, cur: 0 });
      });
      const seams = new THREE.InstancedMesh(new THREE.BoxGeometry(0.006, 0.34, 0.012), seamMat, bd.doors.length);
      bd.doors.forEach((d, k) => seams.setMatrixAt(k, d.center ? M(0, -20, 0) : M(d.x0, 1.88, s * (ix - 0.012), s > 0 ? 0.1 : -0.1, 0, 0)));
      seams.userData.ceiling = true;
      this.cabin.add(seams);
    }
    if (W > 4.6) {
      // 中央行李櫃：每段有底板、頂板、中隔板與兩端封板，兩側各一排可開的櫃門
      const binU = this.clipped(m.binUnder);
      binZones.forEach(([a, b]) => {
        const len = b - a, cx = (a + b) / 2;
        const add = (geo, mat, x, y, z) => { const o = new THREE.Mesh(geo, mat); o.position.set(x, y, z); o.userData.ceiling = true; this.cabin.add(o); return o; };
        add(new RoundedBoxGeometry(len, 0.03, 1.5, 2, 0.01), binU, cx, 1.715, 0);
        add(new RoundedBoxGeometry(len, 0.03, 1.24, 2, 0.01), bin, cx, 2.17, 0);
        add(new THREE.BoxGeometry(len, 0.44, 0.02), binU, cx, 1.94, 0);
        for (const ex of [a, b]) add(new THREE.BoxGeometry(0.02, 0.46, 1.5), binU, ex, 1.94, 0);
        // 底面的閱讀燈面板（中間座位用）
        add(new THREE.BoxGeometry(len, 0.012, 1.0), this.clipped(m.shell), cx, 1.698, 0);
      });
      const cProfile = smoothProfile([[0.75, 1.73], [0.775, 1.85], [0.765, 1.98], [0.71, 2.1], [0.62, 2.17]], 6);
      bd.doors.filter((d) => d.center).forEach((d) => {
        const ts = -d.side; // three.js z 方向
        const hy2 = 2.17, hz2 = ts * 0.45;
        const pivot = new THREE.Group(); pivot.position.set(0, hy2, hz2);
        const dg = sweep(cProfile, d.x0 + 0.004, d.x1 - 0.004, ts); dg.translate(0, -hy2, -hz2);
        const dm = new THREE.Mesh(dg, bin); dm.userData.propId = d.id;
        const handle = new THREE.Mesh(new RoundedBoxGeometry(0.22, 0.022, 0.03, 2, 0.01), this.clipped(m.shellDark)); handle.position.set(d.x, 1.76 - hy2, ts * 0.765 - hz2); handle.userData.propId = d.id;
        pivot.add(dm, handle); pivot.userData.ceiling = true;
        this.cabin.add(pivot); this.propMeshes.push(dm, handle);
        this.pivots.set(d.id, { pivot, axis: 'x', base: 0, dir: this.downSign(new THREE.Vector3(0, 1.73 - hy2, ts * 0.75 - hz2)), max: 0.42, cur: 0 });
      });
    }

    // 窗戶：牆面上的凹槽窗框（漸層陰影烘焙在貼圖上）+ 窗景 + 隨機半拉的遮光板
    const revealTex = canvasTex(256, 336, (g, w, hh) => {
      g.clearRect(0, 0, w, hh);
      const rr = (x, y, ww, h2, r) => { g.beginPath(); g.roundRect(x, y, ww, h2, r); };
      // 外框：與牆同色、邊緣淡出
      for (let i = 0; i < 18; i++) { g.fillStyle = `rgba(222,223,220,${(i + 1) / 18})`; rr(8 + i * 1.2, 8 + i * 1.2, w - 16 - i * 2.4, hh - 16 - i * 2.4, 80 - i); g.fill(); }
      // 斜面：上方暗、下方亮（模擬凹陷）
      const gr = g.createLinearGradient(0, 30, 0, hh - 30); gr.addColorStop(0, '#9fa3a8'); gr.addColorStop(0.5, '#c8cacb'); gr.addColorStop(1, '#eceded');
      g.fillStyle = gr; rr(44, 44, w - 88, hh - 88, 62); g.fill();
      g.strokeStyle = 'rgba(80,84,90,0.35)'; g.lineWidth = 2; rr(44, 44, w - 88, hh - 88, 62); g.stroke();
      // 窗洞（透明）
      g.globalCompositeOperation = 'destination-out'; rr(66, 70, w - 132, hh - 140, 48); g.fill(); g.globalCompositeOperation = 'source-over';
    });
    const revealMat = this.clipped(new THREE.MeshStandardMaterial({ map: revealTex, transparent: true, roughness: 0.55, depthWrite: false }));
    const paneShape = roundRect(0.2, 0.3, 0.075);
    const xs = []; for (let x = 3.2; x < L - 1.6; x += 0.53) if (!ac.fixtures.some((f) => f.type === 'door' && Math.abs(f.x - x) < f.w / 2 + 0.2)) xs.push(x);
    const shadeMat = this.clipped(new THREE.MeshStandardMaterial({ color: '#d5d6d3', roughness: 0.6 }));
    const rnd = (k) => { const v = Math.sin(k * 127.1 + 311.7) * 43758.5453; return v - Math.floor(v); };
    const WY = 1.1, wr = R + 0.036, tilt = 0.24; // 窗戶中心高度 / 該高度的牆面半徑
    for (const s of [-1, 1]) {
      const rv = new THREE.InstancedMesh(new THREE.PlaneGeometry(0.4, 0.525).rotateX(tilt), revealMat, xs.length);
      const pn = new THREE.InstancedMesh(new THREE.ShapeGeometry(paneShape, 8).rotateX(tilt), this.winMat, xs.length);
      const sh = new THREE.InstancedMesh(new THREE.PlaneGeometry(0.21, 1).rotateX(tilt), shadeMat, xs.length);
      xs.forEach((x, i) => {
        const ry = s > 0 ? Math.PI : 0;
        rv.setMatrixAt(i, M(x, WY, s * (wr - 0.014), 0, ry, 0));
        pn.setMatrixAt(i, M(x, WY, s * (wr - 0.006), 0, ry, 0));
        const down = rnd(x * 3 + s) < 0.3 ? 0.12 + rnd(x + s * 7) * 0.18 : 0.004; // 約三成窗戶遮光板拉下一部分
        sh.setMatrixAt(i, M(x, WY + 0.15 - down / 2, s * (wr - 0.01), 0, ry, 0, 1, down, 1));
      });
      rv.renderOrder = 2;
      this.cabin.add(pn, sh, rv);
    }

    // 艙等分隔布簾（收在走道兩側）
    const rowsByX = [...new Map(activeSeats(ac).map((s) => [s.row, s])).values()].sort((a, b) => a.x - b.x);
    for (let i = 0; i < rowsByX.length - 1; i++) {
      if (rowsByX[i].cls === rowsByX[i + 1].cls) continue;
      const cx = (rowsByX[i].x + rowsByX[i + 1].x) / 2;
      const ys2 = [...new Set(activeSeats(ac).filter((s) => s.row === rowsByX[i + 1].row).map((s) => s.y))].sort((a, b) => a - b);
      for (let k = 0; k < ys2.length - 1; k++) {
        if (ys2[k + 1] - ys2[k] < 0.75) continue;
        for (const yy of [ys2[k] + 0.12, ys2[k + 1] - 0.12]) {
          // 收束的布簾：上寬下窄、波浪皺褶
          const cg = new THREE.PlaneGeometry(0.16, 1.62, 16, 12);
          const cp = cg.attributes.position;
          for (let v = 0; v < cp.count; v++) { const yv = (cp.getY(v) + 0.81) / 1.62; const xv = cp.getX(v) * (0.55 + 0.45 * yv); cp.setX(v, xv); cp.setZ(v, Math.sin(xv * 90) * 0.022); }
          cg.computeVertexNormals();
          const cm = new THREE.Mesh(cg, this.clipped(m.curtain));
          cm.position.set(cx, 0.83, -yy); cm.rotation.y = Math.PI / 2; cm.castShadow = true;
          this.cabin.add(cm);
        }
      }
    }

    // 外殼
    const RO = R + 0.32, CY = 1.0;
    const hull = this.clipped(m.hull);
    const tube = new THREE.Mesh(new THREE.CylinderGeometry(RO, RO, L, 64, 1, true), hull);
    tube.rotation.z = Math.PI / 2; tube.position.set(L / 2, CY, 0); this.cabin.add(tube);
    const bellyMat = this.clipped(m.hull); bellyMat.color = new THREE.Color('#c7cfda');
    const belly = new THREE.Mesh(new THREE.CylinderGeometry(RO + 0.004, RO + 0.004, L, 64, 1, true, Math.PI * 1.25, Math.PI * 0.5), bellyMat);
    belly.rotation.z = Math.PI / 2; belly.position.set(L / 2, CY, 0); this.cabin.add(belly);
    const cutMat = new THREE.MeshStandardMaterial({ color: 0x353c4b, roughness: 0.9 });
    const stripeMat = this.clipped(m.hull); stripeMat.color = new THREE.Color(accent);
    for (const s of [-1, 1]) {
      const capm = new THREE.Mesh(new THREE.BoxGeometry(L, 0.02, RO - R - 0.02), cutMat);
      capm.position.set(L / 2, CUT_H - 0.01, s * (R + (RO - R) / 2 + 0.01)); capm.userData.cutaway = true; this.cabin.add(capm);
      const a0 = Math.asin((0.5 - CY) / RO), a1 = Math.asin((0.72 - CY) / RO);
      const stripe = new THREE.Mesh(new THREE.CylinderGeometry(RO + 0.008, RO + 0.008, L, 64, 1, true, s > 0 ? a0 : Math.PI - a1, a1 - a0), stripeMat);
      stripe.rotation.z = Math.PI / 2; stripe.position.set(L / 2, CY, 0); this.cabin.add(stripe);
    }
    const subfloor = new THREE.Mesh(new THREE.BoxGeometry(L, 0.12, W + 0.1), new THREE.MeshStandardMaterial({ color: 0x8a919c, roughness: 0.9 }));
    subfloor.position.set(L / 2, -0.07, 0); this.cabin.add(subfloor);
    const noseLen = RO * 2.1;
    const nosePts = []; for (let i = 0; i <= 24; i++) { const t = i / 24; nosePts.push(new THREE.Vector2(RO * Math.sqrt(Math.max(0, 1 - t * t)) * (1 - 0.08 * t), t * noseLen)); }
    const nose = new THREE.Mesh(new THREE.LatheGeometry(nosePts, 64), hull);
    nose.rotation.z = Math.PI / 2; nose.position.set(0, CY, 0); this.cabin.add(nose);
    const tailLen = RO * 3.2;
    const tailPts = []; for (let i = 0; i <= 24; i++) { const t = i / 24; tailPts.push(new THREE.Vector2(RO * (1 - Math.pow(t, 1.3) * 0.85), t * tailLen)); }
    const tailGeo = new THREE.LatheGeometry(tailPts, 48);
    tailGeo.rotateZ(-Math.PI / 2);
    const tp = tailGeo.attributes.position;
    for (let i = 0; i < tp.count; i++) tp.setY(i, tp.getY(i) + Math.pow(Math.max(0, tp.getX(i)) / tailLen, 1.6) * RO * 0.75);
    tailGeo.computeVertexNormals();
    const tail = new THREE.Mesh(tailGeo, m.hull); tail.position.set(L, CY, 0); this.cabin.add(tail);
    const fh = RO * 2.6;
    const finShape = new THREE.Shape();
    finShape.moveTo(0, 0); finShape.lineTo(tailLen * 0.75, 0); finShape.lineTo(tailLen * 1.02, fh); finShape.lineTo(tailLen * 0.78, fh); finShape.lineTo(0, 0);
    const finMat = new THREE.MeshPhysicalMaterial({ color: uni.jacket, roughness: 0.3, clearcoat: 0.8 });
    const fin = new THREE.Mesh(new THREE.ExtrudeGeometry(finShape, { depth: 0.14, bevelEnabled: true, bevelThickness: 0.03, bevelSize: 0.03, bevelSegments: 3 }), finMat);
    fin.position.set(L + tailLen * 0.05, CY + RO * 0.85, -0.07); this.cabin.add(fin);
    const { tex: logoTex, aspect } = pillTexture(prof.airline || '', 'rgba(0,0,0,0)', '#ffffff');
    for (const s of [-1, 1]) {
      const lh = fh * 0.13;
      const logo = new THREE.Mesh(new THREE.PlaneGeometry(lh * aspect, lh), new THREE.MeshBasicMaterial({ map: logoTex, transparent: true }));
      logo.position.set(L + tailLen * 0.62, CY + RO * 0.85 + fh * 0.42, s * 0.11); logo.rotation.y = s > 0 ? 0 : Math.PI; this.cabin.add(logo);
      const disc = new THREE.Mesh(new THREE.CircleGeometry(fh * 0.13, 40), new THREE.MeshPhysicalMaterial({ color: accent, roughness: 0.3, clearcoat: 1 }));
      disc.position.set(L + tailLen * 0.8, CY + RO * 0.85 + fh * 0.72, s * 0.11); disc.rotation.y = s > 0 ? 0 : Math.PI; this.cabin.add(disc);
    }
    const wingMat = new THREE.MeshPhysicalMaterial({ color: 0xdfe4ea, roughness: 0.35, clearcoat: 0.5, side: THREE.DoubleSide });
    const stabShape = new THREE.Shape();
    stabShape.moveTo(0, 0); stabShape.lineTo(tailLen * 0.55, 0); stabShape.lineTo(tailLen * 0.7, RO * 2.4); stabShape.lineTo(tailLen * 0.5, RO * 2.4); stabShape.lineTo(0, 0);
    for (const s of [-1, 1]) {
      const st = new THREE.Mesh(new THREE.ExtrudeGeometry(stabShape, { depth: 0.1, bevelEnabled: true, bevelThickness: 0.02, bevelSize: 0.02, bevelSegments: 2 }), wingMat);
      st.rotation.x = Math.PI / 2 * s; st.position.set(L + tailLen * 0.25, CY + RO * 0.6, s * RO * 0.3); this.cabin.add(st);
    }
    const span = Math.max(W * 3.2, 10), chord = Math.max(4, L * 0.16);
    const wingShape = new THREE.Shape();
    wingShape.moveTo(0, 0); wingShape.lineTo(chord, 0); wingShape.lineTo(chord + span * 0.55, span); wingShape.lineTo(chord * 0.35 + span * 0.55, span); wingShape.lineTo(0, 0);
    const wx = L * 0.42;
    for (const s of [-1, 1]) {
      const wg = new THREE.Mesh(new THREE.ExtrudeGeometry(wingShape, { depth: 0.2, bevelEnabled: true, bevelThickness: 0.05, bevelSize: 0.05, bevelSegments: 3 }), wingMat);
      wg.rotation.x = Math.PI / 2 * s; wg.position.set(wx, -0.55, s * RO * 0.6); wg.castShadow = true; this.cabin.add(wg);
      const engPts = [[0.0, 0], [RO * 0.38, 0.05], [RO * 0.43, chord * 0.2], [RO * 0.42, chord * 0.55], [RO * 0.3, chord * 0.8], [RO * 0.12, chord * 0.86], [0, chord * 0.9]].map(([r, y]) => new THREE.Vector2(r, y));
      const eng = new THREE.Mesh(new THREE.LatheGeometry(engPts, 48), new THREE.MeshPhysicalMaterial({ color: 0xe9edf2, roughness: 0.25, clearcoat: 0.8 }));
      eng.rotation.z = -Math.PI / 2; eng.position.set(wx + span * 0.1 - chord * 0.3, -1.2, s * (RO + span * 0.28)); eng.castShadow = true; this.cabin.add(eng);
      const intake = new THREE.Mesh(new THREE.CircleGeometry(RO * 0.34, 40), new THREE.MeshStandardMaterial({ color: 0x23262d, metalness: 0.6, roughness: 0.4 }));
      intake.rotation.y = -Math.PI / 2; intake.position.set(eng.position.x + 0.06, -1.2, eng.position.z); this.cabin.add(intake);
    }

    // 座位
    const seats = activeSeats(ac);
    const groups = new Map();
    seats.forEach((s) => { const k = `${s.cls}|${(s.w / 0.92).toFixed(2)}|${s.d.toFixed(2)}`; if (!groups.has(k)) groups.set(k, []); groups.get(k).push(s); });
    groups.forEach((list, k) => {
      const [cls, w, d] = k.split('|');
      const asset = seatAsset(cls, +w, +d, { screen: W > 4.6 });
      const im = new THREE.InstancedMesh(asset.geometry, asset.materials, list.length);
      list.forEach((s, i) => im.setMatrixAt(i, M(s.x, 0, -s.y)));
      im.castShadow = true; im.receiveShadow = true;
      this.cabin.add(im);
    });
    // PSU 面板：每排一組（閱讀燈、空調出風口、安全帶燈），貼在行李櫃底面
    const rowXs = [...new Set(seats.map((s) => +s.x.toFixed(2)))];
    const psuMat = this.clipped(m.shell);
    this.signMat = new THREE.MeshBasicMaterial({ color: 0x333333, toneMapped: false });
    const lampMat = new THREE.MeshStandardMaterial({ color: '#cfd2d6', emissive: '#fff2d6', emissiveIntensity: 0.1, roughness: 0.3 });
    const gasperMat = new THREE.MeshStandardMaterial({ color: '#8d939b', roughness: 0.35, metalness: 0.4 });
    const psu = new THREE.InstancedMesh(new RoundedBoxGeometry(0.32, 0.02, 0.52, 2, 0.008), psuMat, rowXs.length * 2);
    const lamps = new THREE.InstancedMesh(new THREE.CylinderGeometry(0.022, 0.022, 0.012, 20), lampMat, rowXs.length * 6);
    const gasp = new THREE.InstancedMesh(new THREE.CylinderGeometry(0.02, 0.026, 0.024, 20), gasperMat, rowXs.length * 6);
    const signs = new THREE.InstancedMesh(new THREE.PlaneGeometry(0.06, 0.035), this.signMat, rowXs.length * 2);
    let li = 0;
    rowXs.forEach((x, i) => {
      [-1, 1].forEach((s, k) => {
        const zc = s * (R - 0.46);
        psu.setMatrixAt(i * 2 + k, M(x - 0.02, 1.628, zc));
        for (let j = 0; j < 3; j++) {
          lamps.setMatrixAt(li, M(x - 0.09, 1.616, zc + s * (-0.16 + j * 0.16)));
          gasp.setMatrixAt(li, M(x + 0.04, 1.612, zc + s * (-0.16 + j * 0.16)));
          li++;
        }
        signs.setMatrixAt(i * 2 + k, M(x + 0.12, 1.616, zc, Math.PI / 2, 0, 0));
      });
    });
    [psu, lamps, gasp, signs].forEach((o) => { o.userData.ceiling = true; this.cabin.add(o); });

    // 光源：照明槽打向天花板、櫃底洗牆光、窗戶日光（面光源，柔和不刺眼）
    this.areaLights = [];
    const len = binX1 - binX0, mid = (binX0 + binX1) / 2;
    for (const s of [-1, 1]) {
      const ix = R - 0.74;
      const coveL = new THREE.RectAreaLight(0xffe7c9, 7, len, 0.12);
      coveL.position.set(mid, 2.09, s * (ix + 0.27)); coveL.lookAt(mid, 2.6, s * (ix - 0.4));
      const wash = new THREE.RectAreaLight(0xfff1df, 3.2, len, 0.1);
      wash.position.set(mid, 1.62, s * (ix + 0.05)); wash.lookAt(mid, 0.2, s * (R + 0.2));
      const day = new THREE.RectAreaLight(0xdfe9ff, 1.4, L - 5, 0.4);
      day.position.set(L / 2 + 0.6, 1.13, s * (R - 0.02)); day.lookAt(L / 2 + 0.6, 0.8, 0);
      [coveL, wash, day].forEach((l) => { this.cabin.add(l); this.areaLights.push(l); });
      day.userData.daylight = true; coveL.userData.base = 7; wash.userData.base = 3.2; day.userData.base = 1.4;
    }
    const aisle = new THREE.RectAreaLight(0xfff0dc, 3.2, len, 0.9);
    aisle.position.set(mid, 2.28, 0); aisle.lookAt(mid, 0, 0); aisle.userData.base = 3.2;
    this.cabin.add(aisle); this.areaLights.push(aisle);

    ac.fixtures.forEach((f) => this.addFixture(f, ac, accent));

    // 旅客
    if (sc) sc.passengers.forEach((p) => {
      const s = seats.find((z) => z.id === p.seat);
      if (!s) return;
      const g = new THREE.Group();
      const pm = passengerGeometry(p);
      const body = new THREE.Mesh(pm.body, PAX_MAT);
      const face = new THREE.Mesh(pm.face, pm.faceMat);
      body.castShadow = true; body.receiveShadow = true; face.castShadow = true;
      g.add(body, face);
      const ind = new THREE.Mesh(new THREE.TorusGeometry(0.07, 0.016, 8, 24), new THREE.MeshBasicMaterial({ color: 0xf5c542, toneMapped: false }));
      ind.rotation.x = Math.PI / 2; ind.position.set(0.12, p.type === 'child' ? 1.2 : 1.62, 0); ind.visible = false;
      g.add(ind);
      const t = PAX_TYPES[p.type];
      if (p.type !== 'normal' && t) {
        const tx = canvasTex(64, 64, (eg) => { eg.fillStyle = 'rgba(255,255,255,0.92)'; eg.beginPath(); eg.arc(32, 32, 30, 0, 7); eg.fill(); eg.font = '36px system-ui'; eg.textAlign = 'center'; eg.textBaseline = 'middle'; eg.fillText(t.icon, 32, 35); });
        const sp = new THREE.Sprite(new THREE.SpriteMaterial({ map: tx, depthTest: false }));
        sp.scale.set(0.26, 0.26, 1); sp.position.set(0.12, (p.type === 'child' ? 1.2 : 1.62) + 0.22, 0); sp.renderOrder = 9; sp.userData.label = true;
        g.add(sp);
      }
      g.position.copy(P(s.x, s.y, 0));
      g.userData.ind = ind; g.userData.seat = p.seat;
      this.cabin.add(g);
      this.paxMeshes.set(p.seat, g);
    });

    this.player = makeCrew(uni);
    this.cabin.add(this.player);
    // 餐車
    this.cart = makeCart(accent, prof.airline);
    this.cabin.add(this.cart);
    const gal = ac.fixtures.find((ff) => ff.type === 'galley');
    if (gal) {
      let fx = 0, fy = 0;
      if (Math.abs(gal.y) > 0.3 && gal.d < W * 0.8) fy = gal.y < 0 ? 1 : -1; else fx = gal.x < L / 2 ? 1 : -1;
      this.cartHome = { x: gal.x + fx * (gal.w / 2 + 0.17), y: gal.y + fy * (gal.d / 2 + 0.17) };
    }
    this.trays = new Map();
    this.cabin.traverse((o) => { if (o.isMesh && !(o.material && o.material.isMeshBasicMaterial)) o.receiveShadow = true; });
    this.applyMode();
  }

  // 環境反射強度：棚燈環境貼圖很亮，依視角調低，避免白色表面過曝
  applyEnvIntensity() {
    const v = this.mode === 'fp' ? 0.18 : 0.45;
    if (this.envI === v && this.envDirty === false) return;
    this.envI = v; this.envDirty = false;
    this.scene.traverse((o) => {
      if (!o.material) return;
      (Array.isArray(o.material) ? o.material : [o.material]).forEach((mm) => { if ('envMapIntensity' in mm) mm.envMapIntensity = v; });
    });
  }

  addFixture(f, ac, accent) {
    const m = materials();
    const pos = P(f.x, f.y, 0);
    const R = ac.width / 2;
    let face;
    if (Math.abs(f.y) > 0.3 && f.d < ac.width * 0.8) face = new THREE.Vector3(0, 0, f.y < 0 ? -1 : 1);
    else face = new THREE.Vector3(f.x < ac.length / 2 ? 1 : -1, 0, 0);
    const lookY = Math.atan2(face.x, face.z);
    const frontW = Math.abs(face.x) > 0.5 ? f.d : f.w, depth = Math.abs(face.x) > 0.5 ? f.w : f.d;
    const addFront = (w, h, tex, mat) => {
      const mm = this.clipped(mat); mm.map = tex; mm.color = new THREE.Color('#ffffff'); mm.normalMap = null;
      const pl = new THREE.Mesh(new THREE.PlaneGeometry(w, h), mm);
      pl.position.copy(pos).addScaledVector(face, depth / 2 + 0.004); pl.position.y = h / 2 + 0.02;
      pl.rotation.y = lookY;
      this.cabin.add(pl);
    };
    if (f.type === 'galley' || f.type === 'lav' || f.type === 'closet') {
      const h = 2.0;
      const mat = this.clipped(f.type === 'galley' ? m.steel : f.type === 'lav' ? m.bin : m.wood);
      if (f.type !== 'lav') {
        const body = new THREE.Mesh(new RoundedBoxGeometry(f.w, h, f.d, 3, 0.04), mat);
        body.position.copy(pos); body.position.y = h / 2; body.castShadow = true;
        this.cabin.add(body);
      }
      if (f.type === 'lav') this.addLavDoor(f, pos, face, lookY, frontW, depth, h, accent);
      else addFront(frontW * 0.94, h * 0.94, facadeTexture(f.type, f.label, accent), f.type === 'galley' ? m.steel : m.bin);
      if (f.type === 'galley') {
        const top = new THREE.Mesh(new RoundedBoxGeometry(f.w + 0.02, 0.04, f.d + 0.02, 2, 0.015), this.clipped(m.steel));
        top.position.copy(pos); top.position.y = 1.05; this.cabin.add(top);
        const lamp = new THREE.Mesh(new THREE.BoxGeometry(frontW * 0.8, 0.02, 0.02), new THREE.MeshBasicMaterial({ color: new THREE.Color(2, 1.8, 1.5), toneMapped: false }));
        lamp.position.copy(pos).addScaledVector(face, depth / 2 + 0.03); lamp.position.y = 1.62; lamp.rotation.y = lookY; this.cabin.add(lamp);
      }
    } else if (f.type === 'door') {
      const h = 1.95, sideZ = Math.sign(pos.z || 1), zw = sideZ * (R - 0.03);
      // 門區牆板（開口兩側與上方）
      const bayM = this.clipped(m.wall);
      for (const dx of [-1, 1]) { const st = new THREE.Mesh(new THREE.BoxGeometry(0.14, 2.05, 0.04), bayM); st.position.set(pos.x + dx * (f.w / 2 + 0.07), 1.025, zw + sideZ * 0.02); this.cabin.add(st); }
      const top = new THREE.Mesh(new THREE.BoxGeometry(f.w + 0.28, 0.1, 0.04), bayM); top.position.set(pos.x, h + 0.05, zw + sideZ * 0.02); this.cabin.add(top);
      // 門框
      const fm = this.clipped(m.shell);
      for (const dx of [-1, 1]) { const fr = new THREE.Mesh(new RoundedBoxGeometry(0.05, h, 0.06, 2, 0.015), fm); fr.position.set(pos.x + dx * (f.w / 2 + 0.02), h / 2, zw); this.cabin.add(fr); }
      const ft = new THREE.Mesh(new RoundedBoxGeometry(f.w + 0.09, 0.05, 0.06, 2, 0.015), fm); ft.position.set(pos.x, h + 0.01, zw); this.cabin.add(ft);
      const sill = new THREE.Mesh(new THREE.BoxGeometry(f.w + 0.09, 0.02, 0.2), this.clipped(m.steel)); sill.position.set(pos.x, 0.01, zw); this.cabin.add(sill);
      // 門外：空橋（開門時看得到）
      const jb = canvasTex(256, 512, (g) => {
        const gr = g.createLinearGradient(0, 0, 0, 512); gr.addColorStop(0, '#c9ced6'); gr.addColorStop(1, '#8f949c'); g.fillStyle = gr; g.fillRect(0, 0, 256, 512);
        g.fillStyle = '#fbf6e8'; g.beginPath(); g.moveTo(70, 140); g.lineTo(186, 140); g.lineTo(186, 330); g.lineTo(70, 330); g.fill();
        g.strokeStyle = '#7d838c'; g.lineWidth = 3; [[0, 0, 70, 140], [256, 0, 186, 140], [0, 512, 70, 330], [256, 512, 186, 330]].forEach(([a, b2, c, d]) => { g.beginPath(); g.moveTo(a, b2); g.lineTo(c, d); g.stroke(); });
        g.fillStyle = '#5b616b'; g.beginPath(); g.moveTo(0, 512); g.lineTo(70, 330); g.lineTo(186, 330); g.lineTo(256, 512); g.fill();
        g.fillStyle = 'rgba(255,255,255,0.6)'; for (let i = 0; i < 4; i++) g.fillRect(20 + i * 6, 40 + i * 25, 6, 60 - i * 10);
      });
      const portal = new THREE.Mesh(new THREE.PlaneGeometry(f.w + 0.1, h + 0.05), new THREE.MeshBasicMaterial({ map: jb, toneMapped: false, color: new THREE.Color(1.15, 1.15, 1.15) }));
      portal.position.set(pos.x, h / 2, sideZ * (R + 0.08)); portal.rotation.y = sideZ > 0 ? Math.PI : 0; portal.visible = false; this.cabin.add(portal);
      // 艙門板（往外推開後沿機身方向滑開）
      const dm = this.clipped(m.bin); dm.map = facadeTexture('door', f.label, accent); dm.color = new THREE.Color('#ffffff'); dm.side = THREE.DoubleSide;
      const door = new THREE.Mesh(new RoundedBoxGeometry(f.w, h - 0.02, 0.05, 2, 0.02), dm);
      door.position.set(pos.x, h / 2, zw + sideZ * 0.005); this.cabin.add(door);
      const handleD = new THREE.Mesh(new RoundedBoxGeometry(0.28, 0.05, 0.05, 2, 0.02), this.clipped(m.shellDark)); handleD.position.set(0.1, 0.15, -sideZ * 0.04); door.add(handleD);
      this.cabinDoors.push({ f, door, portal, sideZ, base: door.position.clone(), cur: 0, boarding: /^L1/.test(f.label || '') });
      const exitTex = canvasTex(256, 96, (g) => { g.fillStyle = '#0d6b3a'; g.fillRect(0, 0, 256, 96); g.fillStyle = '#ffffff'; g.font = '700 58px system-ui'; g.textAlign = 'center'; g.textBaseline = 'middle'; g.fillText('EXIT', 128, 50); });
      const exit = new THREE.Mesh(new THREE.PlaneGeometry(0.3, 0.11), new THREE.MeshBasicMaterial({ map: exitTex, toneMapped: false, color: new THREE.Color(1.6, 1.6, 1.6) }));
      exit.position.set(pos.x, 2.08, sideZ * (R - 0.2)); exit.rotation.y = sideZ > 0 ? Math.PI : 0; exit.userData.ceiling = true; this.cabin.add(exit);
    } else if (f.type === 'jumpseat') {
      const g = new THREE.Group();
      const seat = new THREE.Mesh(new RoundedBoxGeometry(0.42, 0.08, 0.38, 3, 0.03), m.fabric.Y); seat.position.y = 0.48;
      const back = new THREE.Mesh(new RoundedBoxGeometry(0.07, 0.62, 0.4, 3, 0.03), m.fabric.Y); back.position.set(0.2, 0.8, 0);
      const panel = new THREE.Mesh(new RoundedBoxGeometry(0.06, 1.25, 0.46, 3, 0.02), m.shell); panel.position.set(0.25, 0.62, 0);
      g.add(seat, back, panel);
      for (const z of [-0.12, 0.12]) { const strap = new THREE.Mesh(new THREE.BoxGeometry(0.015, 0.5, 0.045), new THREE.MeshStandardMaterial({ color: accent, roughness: 0.8 })); strap.position.set(0.16, 0.85, z); g.add(strap); }
      g.position.copy(pos); g.rotation.y = Math.PI;
      g.traverse((o) => { if (o.isMesh) o.castShadow = true; });
      this.cabin.add(g);
    } else if (f.type === 'cockpit') {
      this.addCockpit(f, ac, accent);
    } else if (f.type === 'crewrest') {
      this.addCrewRest(f, ac, accent);
    } else {
      const mm = new THREE.Mesh(new RoundedBoxGeometry(f.w, 1.3, f.d, 2, 0.02), this.clipped(m.shell));
      mm.position.copy(pos); mm.position.y = 0.65; this.cabin.add(mm);
    }
    if (f.label && f.type !== 'jumpseat') this.cabin.add(this.label(f.label, P(f.x, f.y, f.type === 'door' ? 2.2 : 2.35), 0.7));
  }

  // ---- 洗手間：中空隔間（牆、天花、地板）+ 馬桶、洗手台、鏡子、照明 + 可開關的門 ----
  addLavDoor(f, pos, face, lookY, frontW, depth, h, accent) {
    const m = materials();
    const g = new THREE.Group(); // 局部座標：+z 朝門、x 沿門寬
    g.position.copy(pos); g.rotation.y = lookY;
    const W = frontW, D = depth, T = 0.035;
    const shell = this.clipped(m.bin), inner = this.clipped(m.lavWall);
    const add = (geo, mat, x, y, z, ry = 0) => { const o = new THREE.Mesh(geo, mat); o.position.set(x, y, z); o.rotation.y = ry; o.castShadow = true; o.receiveShadow = true; g.add(o); return o; };
    // 外殼與內牆
    add(new THREE.BoxGeometry(W, h, T), shell, 0, h / 2, -D / 2 + T / 2);
    add(new THREE.BoxGeometry(T, h, D), shell, -W / 2 + T / 2, h / 2, 0);
    add(new THREE.BoxGeometry(T, h, D), shell, W / 2 - T / 2, h / 2, 0);
    add(new THREE.BoxGeometry(W, T, D), shell, 0, h - T / 2, 0);
    const dw = W * 0.86;
    add(new THREE.BoxGeometry((W - dw) / 2, h, T), shell, -W / 2 + (W - dw) / 4, h / 2, D / 2 - T / 2);
    add(new THREE.BoxGeometry((W - dw) / 2, h, T), shell, W / 2 - (W - dw) / 4, h / 2, D / 2 - T / 2);
    add(new THREE.BoxGeometry(dw, h - 1.95, T), shell, 0, 1.95 + (h - 1.95) / 2, D / 2 - T / 2);
    add(new THREE.PlaneGeometry(W - 2 * T, h - T), inner, 0, (h - T) / 2, -D / 2 + T + 0.001);
    add(new THREE.PlaneGeometry(D - 2 * T, h - T), inner, -W / 2 + T + 0.001, (h - T) / 2, 0, Math.PI / 2);
    add(new THREE.PlaneGeometry(D - 2 * T, h - T), inner, W / 2 - T - 0.001, (h - T) / 2, 0, -Math.PI / 2);
    const floor = add(new THREE.PlaneGeometry(W - 2 * T, D - 2 * T), this.clipped(new THREE.MeshStandardMaterial({ color: '#7b8088', roughness: 0.6 })), 0, 0.01, 0); floor.rotation.x = -Math.PI / 2;
    // 馬桶（左後角）
    const tx = LAV.toilet.x(W), tz = LAV.toilet.z(D);
    add(new RoundedBoxGeometry(LAV.toilet.w, 0.36, LAV.toilet.d, 4, 0.08), m.porcelain, tx, 0.18, tz);
    const rim = add(new THREE.TorusGeometry(0.15, 0.028, 12, 32), m.porcelain, tx, 0.39, tz + 0.03); rim.rotation.x = Math.PI / 2; rim.scale.set(1, 1.25, 1);
    const water = add(new THREE.CircleGeometry(0.12, 24), new THREE.MeshStandardMaterial({ color: '#9fb6c9', roughness: 0.05, metalness: 0.2 }), tx, 0.33, tz + 0.03); water.rotation.x = -Math.PI / 2; water.scale.set(1, 1.25, 1);
    const lid = add(new RoundedBoxGeometry(0.32, 0.4, 0.03, 3, 0.012), m.porcelain, tx, 0.6, -D / 2 + T + 0.04); lid.rotation.x = -0.12;
    add(new RoundedBoxGeometry(0.06, 0.06, 0.02, 2, 0.01), m.chrome, tx + 0.22, 1.0, -D / 2 + T + 0.012);
    // 洗手台（右側）與水龍頭
    const sx = LAV.sink.x(W), sz = LAV.sink.z(D);
    add(new RoundedBoxGeometry(LAV.sink.w, 0.86, LAV.sink.d, 3, 0.03), this.clipped(m.lavWall), sx, 0.43, sz);
    add(new RoundedBoxGeometry(LAV.sink.w + 0.02, 0.03, LAV.sink.d + 0.02, 3, 0.012), m.porcelain, sx, 0.875, sz);
    const basin = add(new THREE.SphereGeometry(0.11, 24, 12, 0, Math.PI * 2, Math.PI / 2, Math.PI / 2), m.porcelain, sx, 0.89, sz + 0.02); basin.scale.set(1, 0.55, 1.2);
    const tap = add(new THREE.CylinderGeometry(0.012, 0.014, 0.12, 12), m.chrome, sx + 0.12, 0.95, sz + 0.02);
    const spout = add(new THREE.CylinderGeometry(0.009, 0.009, 0.09, 10), m.chrome, sx + 0.08, 1.0, sz + 0.02); spout.rotation.z = Math.PI / 2;
    // 鏡子、紙巾盒、扶手、照明
    // 真實反射的鏡子（只有靠近時才計算反射，節省效能）
    const mw = Math.min(0.62, D * 0.72);
    const mir = new Reflector(new THREE.PlaneGeometry(mw, 0.78), { textureWidth: 1024, textureHeight: 1290, color: 0xdde2e7, clipBias: 0.002 });
    mir.position.set(W / 2 - T - 0.006, 1.5, sz); mir.rotation.y = -Math.PI / 2; mir.visible = false; g.add(mir);
    add(new THREE.BoxGeometry(0.012, 0.82, mw + 0.04), m.chrome, W / 2 - T - 0.0, 1.5, sz);
    const baseBR = mir.onBeforeRender.bind(mir);
    mir.onBeforeRender = (renderer, scene, camera) => {
      // 反射中要看得到自己（含頭部）
      const pl = this.player, vis = pl && pl.visible;
      if (pl) { pl.visible = true; pl.userData.setHead && pl.userData.setHead(true); }
      baseBR(renderer, scene, camera);
      if (pl) { pl.visible = vis; pl.userData.setHead && pl.userData.setHead(this.mode !== 'fp'); }
    };
    this.mirrors.push({ mesh: mir, f });
    add(new RoundedBoxGeometry(0.04, 0.24, 0.3, 2, 0.01), m.chrome, -W / 2 + T + 0.02, 1.1, tz + 0.3);
    const grab = add(new THREE.CylinderGeometry(0.012, 0.012, 0.35, 10), m.chrome, -W / 2 + T + 0.04, 0.95, tz + 0.05); grab.rotation.x = Math.PI / 2;
    const lightP = add(new THREE.PlaneGeometry(W * 0.6, 0.12), new THREE.MeshBasicMaterial({ color: new THREE.Color(1.8, 1.7, 1.5), toneMapped: false }), 0, h - T - 0.002, 0); lightP.rotation.x = Math.PI / 2;
    const smoke = add(new THREE.CylinderGeometry(0.04, 0.04, 0.02, 16), new THREE.MeshStandardMaterial({ color: '#f2f2f0' }), 0.15, h - T - 0.012, 0.1);
    const pl = null;
    this.cabin.add(g);
    // 門
    const pivot = new THREE.Group();
    const tangent = new THREE.Vector3(face.z, 0, -face.x);
    pivot.position.copy(pos).addScaledVector(face, D / 2 + 0.004).addScaledVector(tangent, -dw / 2);
    pivot.rotation.y = lookY;
    const dmat = this.clipped(m.bin); dmat.map = facadeTexture('lav', f.label, accent); dmat.color = new THREE.Color('#ffffff');
    const door = new THREE.Mesh(new RoundedBoxGeometry(dw, 1.93, 0.03, 2, 0.008), dmat);
    door.position.set(dw / 2, 0.98, 0); door.userData.propId = f.id; door.castShadow = true;
    pivot.add(door); this.cabin.add(pivot); this.propMeshes.push(door);
    this.pivots.set(f.id, { pivot, axis: 'y', base: lookY, dir: -1, max: 1.7, cur: 0, light: pl });
  }

  // ---- 組員休息室：牆、門、上下舖 ----
  addCrewRest(f, ac, accent) {
    const m = materials();
    const r = roomLayout(f, ac);
    const H = 2.05;
    const wallMat = this.clipped(m.bin);
    r.walls.forEach((q) => {
      const mm = new THREE.Mesh(new THREE.BoxGeometry(q.x1 - q.x0, H, q.y1 - q.y0), wallMat);
      mm.position.set((q.x0 + q.x1) / 2, H / 2, -(q.y0 + q.y1) / 2); mm.castShadow = true; this.cabin.add(mm);
    });
    const dq = r.door.rect;
    const header = new THREE.Mesh(new THREE.BoxGeometry(dq.x1 - dq.x0, H - 1.95, dq.y1 - dq.y0), wallMat);
    header.position.set((dq.x0 + dq.x1) / 2, 1.95 + (H - 1.95) / 2, -(dq.y0 + dq.y1) / 2); this.cabin.add(header);
    // 門（沿 x 方向的門板，鉸鏈在左端）
    const pivot = new THREE.Group();
    pivot.position.set(r.door.hingeX, 0, -r.door.at);
    const dmat = this.clipped(m.shell); dmat.color = new THREE.Color('#c9ccd2');
    const door = new THREE.Mesh(new RoundedBoxGeometry(r.door.w - 0.02, 1.93, 0.035, 2, 0.01), dmat);
    door.position.set(r.door.w / 2, 0.98, 0); door.userData.propId = f.id; door.castShadow = true;
    const plate = new THREE.Mesh(new THREE.PlaneGeometry(0.34, 0.09), new THREE.MeshBasicMaterial({ map: pillTexture('CREW ONLY', '#2b3242', '#ffffff').tex, toneMapped: false }));
    plate.position.set(r.door.w / 2, 1.5, r.door.sgn * -0.02); plate.rotation.y = r.door.sgn > 0 ? Math.PI : 0;
    pivot.add(door, plate); this.cabin.add(pivot); this.propMeshes.push(door);
    this.pivots.set(f.id, { pivot, axis: 'y', base: 0, dir: r.door.sgn, max: 1.55, cur: 0 });
    // 上下舖（床架、床墊、枕頭、隔簾）
    const b = r.furniture[0], bx = (b.x0 + b.x1) / 2, by = (b.y0 + b.y1) / 2, bl = b.x1 - b.x0, bdp = b.y1 - b.y0;
    const frame = this.clipped(m.shellDark), matt = this.clipped(m.headrest);
    for (const y of [0.42, 1.28]) {
      const base = new THREE.Mesh(new RoundedBoxGeometry(bl, 0.06, bdp, 2, 0.02), frame); base.position.set(bx, y, -by); this.cabin.add(base);
      const mt = new THREE.Mesh(new RoundedBoxGeometry(bl - 0.06, 0.12, bdp - 0.06, 3, 0.05), matt); mt.position.set(bx, y + 0.09, -by); this.cabin.add(mt);
      const pil = new THREE.Mesh(new RoundedBoxGeometry(0.4, 0.08, bdp * 0.6, 3, 0.035), matt); pil.position.set(b.x0 + 0.3, y + 0.18, -by); this.cabin.add(pil);
      const blanket = new THREE.Mesh(new RoundedBoxGeometry(bl * 0.55, 0.05, bdp - 0.1, 2, 0.02), this.clipped(m.curtain)); blanket.position.set(b.x1 - bl * 0.3, y + 0.16, -by); this.cabin.add(blanket);
    }
    const post = new THREE.Mesh(new THREE.BoxGeometry(0.05, 1.9, 0.05), frame); post.position.set(b.x1 - 0.03, 0.95, -(r.bunk.outer + r.bunk.sgn * bdp)); this.cabin.add(post);
    const lamp = new THREE.Mesh(new THREE.BoxGeometry(0.2, 0.03, 0.05), new THREE.MeshBasicMaterial({ color: new THREE.Color(1.6, 1.3, 0.9), toneMapped: false }));
    lamp.position.set(bx, 1.9, -(r.inside.y0 + r.inside.y1) / 2); this.cabin.add(lamp);
  }

  // ---- 駕駛艙：擋風玻璃、儀表板（動態飛航顯示器）、遮光罩、頂板、中央操縱台、側桿/駕駛盤、駕駛座、兩位駕駛員 ----
  addCockpit(f, ac, accent) {
    const m = materials();
    const r = roomLayout(f, ac);
    const W = ac.width, H = 2.25, bx = f.x + f.w / 2, x0 = f.x - f.w / 2;
    const airbus = (ac.templateId || '').startsWith('a3');
    const grey = this.clipped(m.cockpitGrey), dark = this.clipped(m.cockpitDark);
    const add = (geo, mat, x, y, z, rx = 0, ry = 0, rz = 0) => { const o = new THREE.Mesh(geo, mat); o.position.set(x, y, z); o.rotation.set(rx, ry, rz); o.castShadow = true; o.receiveShadow = true; this.cabin.add(o); return o; };
    // 後隔板（中央門）
    const wallMat = this.clipped(m.shell);
    r.walls.forEach((q) => add(new THREE.BoxGeometry(0.1, H, q.y1 - q.y0), wallMat, bx - 0.05, H / 2, -(q.y0 + q.y1) / 2));
    add(new THREE.BoxGeometry(0.1, H - 2.0, 0.84), wallMat, bx - 0.05, 2.0 + (H - 2.0) / 2, 0);
    // 隔板內側：斷路器面板
    const cbTex = canvasTex(512, 256, (g) => { g.fillStyle = '#3a404b'; g.fillRect(0, 0, 512, 256); for (let i = 0; i < 18; i++) for (let j = 0; j < 9; j++) { g.fillStyle = '#16191e'; g.beginPath(); g.arc(20 + i * 27, 22 + j * 26, 6, 0, 7); g.fill(); g.fillStyle = '#d7d9dc'; g.fillRect(17 + i * 27, 30 + j * 26, 6, 2); } });
    add(new THREE.PlaneGeometry(W * 0.32, 0.6), this.clipped(new THREE.MeshStandardMaterial({ map: cbTex, roughness: 0.6 })), bx - 0.102, 1.3, -(W / 2 - W * 0.2), 0, -Math.PI / 2);
    // 駕駛艙門
    const pivot = new THREE.Group(); pivot.position.set(bx - 0.03, 0, 0.42);
    const door = new THREE.Mesh(new RoundedBoxGeometry(0.06, 1.98, 0.82, 2, 0.01), dark); door.position.set(0, 0.99, -0.41); door.userData.propId = f.id;
    const fm = this.clipped(m.shell); fm.map = facadeTexture('cockpit'); fm.color = new THREE.Color('#ffffff');
    const face = new THREE.Mesh(new THREE.PlaneGeometry(0.8, 1.96), fm); face.position.set(0.032, 0.99, -0.41); face.rotation.y = Math.PI / 2; face.userData.propId = f.id;
    const peep = new THREE.Mesh(new THREE.CylinderGeometry(0.012, 0.012, 0.07, 12), m.chrome); peep.rotation.z = Math.PI / 2; peep.position.set(0, 1.55, -0.41);
    const handle = new THREE.Mesh(new RoundedBoxGeometry(0.03, 0.03, 0.14, 2, 0.01), m.chrome); handle.position.set(0.05, 1.0, -0.72);
    pivot.add(door, face, peep, handle); this.cabin.add(pivot); this.propMeshes.push(door, face);
    this.pivots.set(f.id, { pivot, axis: 'y', base: 0, dir: 1, max: 1.45, cur: 0 });
    // 地板、側牆內襯與側操縱台
    add(new THREE.BoxGeometry(f.w, 0.04, W * 0.95), new THREE.MeshStandardMaterial({ color: 0x3a3f4a, roughness: 0.9 }), f.x, 0.02, 0);
    for (const s of [-1, 1]) {
      add(new THREE.BoxGeometry(f.w - 0.5, 1.15, 0.04), grey, f.x + 0.15, 1.0, s * (W / 2 - 0.08));
      add(new RoundedBoxGeometry(f.w - 0.7, 0.12, 0.32, 3, 0.03), grey, f.x + 0.05, 0.72, s * (W / 2 - 0.25));
      const tray = add(new THREE.PlaneGeometry(0.3, 0.25), this.clipped(new THREE.MeshStandardMaterial({ color: '#1b1e23', roughness: 0.4 })), f.x - 0.25, 0.783, s * (W / 2 - 0.25), -Math.PI / 2);
      // 側窗與窗框
      const sw = add(new THREE.PlaneGeometry(0.6, 0.4), this.winMat, x0 + 0.95, 1.42, s * (W / 2 - 0.1), 0, s > 0 ? Math.PI : 0); sw.castShadow = false;
      add(new THREE.BoxGeometry(0.64, 0.03, 0.05), dark, x0 + 0.95, 1.63, s * (W / 2 - 0.12));
      add(new THREE.BoxGeometry(0.64, 0.03, 0.05), dark, x0 + 0.95, 1.21, s * (W / 2 - 0.12));
      if (airbus) {
        // 側桿
        add(new THREE.CylinderGeometry(0.03, 0.04, 0.06, 16), dark, f.x - 0.15, 0.8, s * (W / 2 - 0.22));
        const stick = add(new RoundedBoxGeometry(0.05, 0.18, 0.05, 3, 0.02), this.clipped(new THREE.MeshStandardMaterial({ color: '#202328', roughness: 0.5 })), f.x - 0.15, 0.9, s * (W / 2 - 0.22), 0, 0, 0.15);
        add(new THREE.SphereGeometry(0.012, 10, 8), new THREE.MeshStandardMaterial({ color: '#c0392b' }), f.x - 0.13, 0.99, s * (W / 2 - 0.22));
      }
    }
    // 擋風玻璃（V 形四片）與窗框
    [[-0.38, -0.32], [-0.12, -0.12], [0.12, 0.12], [0.38, 0.32]].forEach(([z, ry]) => {
      const wp = add(new THREE.PlaneGeometry(0.42, 0.42), this.winMat, x0 + 0.33 + Math.abs(z) * 0.35, 1.5, z * (W / 2.4), 0, Math.PI / 2 + ry, 0); wp.castShadow = false;
      add(new THREE.BoxGeometry(0.04, 0.46, 0.035), dark, x0 + 0.33 + Math.abs(z) * 0.35 + 0.005, 1.5, z * (W / 2.4) + (z > 0 ? 0.21 : -0.21) * Math.cos(ry), 0, ry, 0);
    });
    add(new THREE.BoxGeometry(0.06, 0.05, W * 0.8), dark, x0 + 0.38, 1.73, 0);
    // 主儀表板（面向駕駛員，貼上動態顯示器貼圖）
    const pw = W * 0.82;
    add(new RoundedBoxGeometry(0.42, 0.72, pw, 3, 0.04), grey, x0 + 0.45, 0.88, 0, 0, 0, -0.12);
    const panel = this.makeCockpitPanel(pw);
    const pp = add(new THREE.PlaneGeometry(pw, 0.62), panel.mat, x0 + 0.665, 0.92, 0, 0, Math.PI / 2, 0); pp.rotation.order = 'YXZ'; pp.rotation.x = -0.12; pp.castShadow = false;
    this.cockpitPanel = panel;
    // 遮光罩與自動駕駛控制面板
    add(new RoundedBoxGeometry(0.34, 0.08, pw * 0.98, 3, 0.03), dark, x0 + 0.62, 1.27, 0);
    const fcuTex = canvasTex(1024, 64, (g) => { g.fillStyle = '#2d323b'; g.fillRect(0, 0, 1024, 64); g.fillStyle = '#0c0d0f'; [140, 330, 520, 710].forEach((x) => g.fillRect(x, 12, 120, 34)); g.fillStyle = '#ffb547'; g.font = '700 26px monospace'; [['SPD 250', 145], ['HDG 095', 335], ['ALT 35000', 522], ['V/S ----', 715]].forEach(([t, x]) => g.fillText(t, x + 4, 39)); g.fillStyle = '#d7dadf'; for (let i = 0; i < 10; i++) { g.beginPath(); g.arc(60 + i * 95, 50, 7, 0, 7); g.fill(); } });
    add(new THREE.PlaneGeometry(pw * 0.7, 0.05), new THREE.MeshBasicMaterial({ map: fcuTex, toneMapped: false }), x0 + 0.792, 1.26, 0, 0, Math.PI / 2, 0);
    // 頂板（滿滿的開關）
    const ohTex = canvasTex(512, 512, (g) => {
      g.fillStyle = '#3c424d'; g.fillRect(0, 0, 512, 512);
      for (let i = 0; i < 8; i++) for (let j = 0; j < 10; j++) {
        g.fillStyle = '#272b32'; g.fillRect(14 + i * 62, 12 + j * 49, 50, 40);
        g.fillStyle = (i + j) % 5 === 0 ? '#e6b54a' : (i * j) % 7 === 1 ? '#3fae6b' : '#e9ecef'; g.fillRect(24 + i * 62, 18 + j * 49, 30, 12);
        g.fillStyle = '#9aa1ab'; g.fillRect(24 + i * 62, 36 + j * 49, 30, 3);
      }
    });
    add(new THREE.BoxGeometry(0.9, 0.06, W * 0.42), grey, f.x - 0.05, 2.0, 0, 0, 0, 0.25);
    add(new THREE.PlaneGeometry(0.88, W * 0.4), new THREE.MeshStandardMaterial({ map: ohTex, roughness: 0.55, emissive: '#1a1c20', emissiveMap: ohTex, emissiveIntensity: 0.25 }), f.x - 0.05, 1.965, 0, Math.PI / 2, 0, -0.25).rotation.order = 'ZXY';
    // 中央操縱台：推力桿、MCDU、無線電面板
    const pedX0 = x0 + 0.5, pedX1 = f.x + 0.3;
    add(new RoundedBoxGeometry(pedX1 - pedX0, 0.72, 0.34, 3, 0.03), grey, (pedX0 + pedX1) / 2, 0.36, 0);
    const pedTex = canvasTex(256, 512, (g) => { g.fillStyle = '#2f343c'; g.fillRect(0, 0, 256, 512); g.fillStyle = '#0f1a14'; g.fillRect(20, 30, 216, 150); g.fillStyle = '#5fe08c'; g.font = '16px monospace'; ['INIT  FPLN', 'TPE  RJAA', 'CRZ FL350', 'COST 30', 'EFOB 7.2'].forEach((t, i) => g.fillText(t, 32, 60 + i * 24)); g.fillStyle = '#d9dce0'; for (let i = 0; i < 5; i++) for (let j = 0; j < 6; j++) g.fillRect(28 + i * 42, 200 + j * 28, 30, 18); g.fillStyle = '#1c1f24'; g.fillRect(20, 380, 216, 110); g.fillStyle = '#ff9f43'; g.fillText('118.700  121.500', 34, 440); });
    add(new THREE.PlaneGeometry(0.33, pedX1 - pedX0 - 0.1), new THREE.MeshStandardMaterial({ map: pedTex, emissive: '#ffffff', emissiveMap: pedTex, emissiveIntensity: 0.25, roughness: 0.5 }), (pedX0 + pedX1) / 2, 0.722, 0, -Math.PI / 2, 0, Math.PI / 2);
    for (const z of [-0.05, 0.05]) {
      add(new RoundedBoxGeometry(0.03, 0.2, 0.02, 2, 0.008), m.chrome, pedX0 + 0.25, 0.83, z, 0, 0, -0.3);
      add(new RoundedBoxGeometry(0.06, 0.04, 0.05, 2, 0.015), dark, pedX0 + 0.21, 0.93, z);
    }
    if (!airbus) {
      // 駕駛盤（波音）
      r.seats.forEach((st) => {
        add(new THREE.CylinderGeometry(0.03, 0.035, 0.75, 12), dark, x0 + 0.78, 0.38, -st.y, 0, 0, 0.15);
        const yoke = add(new THREE.TorusGeometry(0.14, 0.018, 8, 24, Math.PI), dark, x0 + 0.82, 0.86, -st.y, 0, Math.PI / 2, Math.PI);
      });
    }
    // 駕駛座與駕駛員
    r.seats.forEach((st) => {
      const g = new THREE.Group();
      const mk = (geo, mat, x, y, z, rz = 0) => { const o = new THREE.Mesh(geo, mat); o.position.set(x, y, z); o.rotation.z = rz; o.castShadow = true; g.add(o); return o; };
      const leather = m.fabric.J;
      mk(new THREE.CylinderGeometry(0.05, 0.14, 0.3, 16), m.metal, 0, 0.15, 0);
      mk(new RoundedBoxGeometry(0.52, 0.1, 0.5, 3, 0.04), dark, 0, 0.33, 0);
      mk(new RoundedBoxGeometry(0.5, 0.13, 0.48, 4, 0.05), leather, -0.02, 0.45, 0);
      mk(new RoundedBoxGeometry(0.13, 0.78, 0.48, 4, 0.05), leather, 0.25, 0.9, 0, -0.14);
      mk(new RoundedBoxGeometry(0.11, 0.2, 0.3, 4, 0.05), leather, 0.32, 1.38, 0, -0.14);
      for (const s of [-1, 1]) mk(new RoundedBoxGeometry(0.34, 0.05, 0.06, 2, 0.02), dark, 0.0, 0.7, s * 0.26);
      g.position.set(st.x, 0, -st.y); this.cabin.add(g);
      const captain = st.y < 0; // 機長坐左座
      const pilot = makeCrew({ jacket: '#141b29', bottom: '#141b29', shirt: '#f4f4f2', scarf: '#141b29', hat: false, bottomType: 'pants', hair: captain ? '#3a3632' : '#1d1612', skin: captain ? '#cf9e7b' : '#e2b897', pilot: true, stripes: captain ? 4 : 3 });
      pilot.position.set(st.x - 0.02, -0.4, -st.y); pilot.rotation.y = Math.PI; pilot.userData.animate(0, false, true, 1); pilot.userData.setHarness(true);
      this.cabin.add(pilot);
    });
    // 觀察員座椅（摺疊在隔板上）
    add(new RoundedBoxGeometry(0.06, 0.4, 0.42, 2, 0.02), dark, bx - 0.14, 0.95, -(W / 2 - 0.45));
    // 駕駛艙微光（儀表反射）
    const cl = new THREE.PointLight(0x9cc4ff, 0.6, 2.5, 2); cl.position.set(x0 + 0.9, 1.2, 0); this.cabin.add(cl);
  }

  // 駕駛艙顯示器：左右各 PFD/ND，中央兩個 ECAM，每秒更新數次姿態、速度、高度
  makeCockpitPanel(pw) {
    const c = document.createElement('canvas'); c.width = 1536; c.height = 384;
    const tex = new THREE.CanvasTexture(c); tex.colorSpace = THREE.SRGBColorSpace;
    const mat = new THREE.MeshBasicMaterial({ map: tex, toneMapped: false, color: new THREE.Color(1.15, 1.15, 1.15) });
    const panel = { c, tex, mat, last: -1 };
    panel.draw = (env) => {
      const g = c.getContext('2d');
      g.fillStyle = '#2f343d'; g.fillRect(0, 0, 1536, 384);
      const D = 220, y0 = 70;
      const xs = [40, 290, 650, 900, 1250 - 0, 1500 - D];
      const screen = (x) => { g.fillStyle = '#16191e'; g.fillRect(x - 10, y0 - 10, D + 20, D + 20); g.fillStyle = '#05070a'; g.fillRect(x, y0, D, D); };
      const pfd = (x) => {
        screen(x);
        g.save(); g.beginPath(); g.rect(x, y0, D, D); g.clip();
        const cx = x + D / 2, cy = y0 + D / 2 + (env.pitch || 0) * 4;
        g.fillStyle = '#2f7ad8'; g.fillRect(x, y0, D, cy - y0); g.fillStyle = '#8a5a2b'; g.fillRect(x, cy, D, y0 + D - cy);
        g.strokeStyle = '#fff'; g.lineWidth = 2; g.beginPath(); g.moveTo(x, cy); g.lineTo(x + D, cy); g.stroke();
        for (let k = -2; k <= 2; k++) { if (!k) continue; g.beginPath(); g.moveTo(cx - 18, cy - k * 20); g.lineTo(cx + 18, cy - k * 20); g.stroke(); }
        g.fillStyle = '#ffd44a'; g.fillRect(cx - 50, y0 + D / 2 - 2, 34, 5); g.fillRect(cx + 16, y0 + D / 2 - 2, 34, 5); g.fillRect(cx - 3, y0 + D / 2 - 3, 6, 6);
        g.fillStyle = 'rgba(40,44,52,0.85)'; g.fillRect(x, y0, 38, D); g.fillRect(x + D - 46, y0, 46, D);
        g.fillStyle = '#ffffff'; g.font = '700 15px monospace';
        g.fillText(String(Math.round(Math.max(0, env.speed || 0))), x + 3, y0 + D / 2 + 5);
        g.fillText(String(Math.round(env.alt || 0)).slice(0, 5), x + D - 44, y0 + D / 2 + 5);
        g.restore();
      };
      const nd = (x) => {
        screen(x);
        const cx = x + D / 2, cy = y0 + D - 30;
        g.strokeStyle = '#ffffff'; g.lineWidth = 2; g.beginPath(); g.arc(cx, cy, 150, Math.PI * 1.2, Math.PI * 1.8); g.stroke();
        g.strokeStyle = '#e055e0'; g.beginPath(); g.moveTo(cx, cy); g.lineTo(cx + 30, y0 + 30); g.lineTo(cx + 60, y0 + 10); g.stroke();
        g.fillStyle = '#ffd44a'; g.beginPath(); g.moveTo(cx, cy - 12); g.lineTo(cx - 8, cy + 6); g.lineTo(cx + 8, cy + 6); g.fill();
        g.fillStyle = '#5fe08c'; g.font = '13px monospace'; g.fillText('GS 480  TAS 495', x + 8, y0 + 18); g.fillText('RJAA  1240NM', x + D - 110, y0 + 18);
      };
      const ecam = (x, lower) => {
        screen(x);
        g.strokeStyle = '#ffffff'; g.lineWidth = 3;
        for (const k of [0, 1]) {
          const cx = x + 60 + k * 100, cy = y0 + 70;
          g.beginPath(); g.arc(cx, cy, 36, Math.PI * 0.8, Math.PI * 2.2); g.stroke();
          const n1 = env.speed > 100 ? 0.75 : 0.3;
          g.strokeStyle = '#5fe08c'; g.beginPath(); g.moveTo(cx, cy); g.lineTo(cx + Math.cos(Math.PI * (0.8 + 1.4 * n1)) * 32, cy + Math.sin(Math.PI * (0.8 + 1.4 * n1)) * 32); g.stroke(); g.strokeStyle = '#ffffff';
          g.fillStyle = '#5fe08c'; g.font = '700 16px monospace'; g.fillText((n1 * 100).toFixed(1), cx - 22, cy + 30);
        }
        g.fillStyle = lower ? '#5fe08c' : '#ffd44a'; g.font = '14px monospace';
        (lower ? ['CAB PR  ALT 6000FT', 'TEMP  24 22 23', 'DOORS  ARMED', 'FOB  7200 KG'] : ['ENG 1  ENG 2', 'EGT   525  530', 'FF    2400 2380', 'SEAT BELTS ' + (env.seatbelt ? 'ON' : 'OFF')]).forEach((t, i) => g.fillText(t, x + 14, y0 + 130 + i * 22));
      };
      pfd(xs[0]); nd(xs[1]); ecam(xs[2], false); ecam(xs[3], true); nd(xs[4]); pfd(xs[5]);
      g.fillStyle = '#d7dadf'; for (let i = 0; i < 30; i++) g.fillRect(40 + i * 49, 330, 24, 10);
      tex.needsUpdate = true;
    };
    panel.draw({ pitch: 0, speed: 0, alt: 0 });
    return panel;
  }

  // 旋轉方向：讓櫃門前緣往下（開）
  downSign(v) { const a = v.clone().applyAxisAngle(new THREE.Vector3(1, 0, 0), 0.2); return a.y < v.y ? 1 : -1; }

  // =================== 動態場景：行李、登機旅客、服務鈴、掉落物、行李櫃視角 ===================
  updateDynamic(sim, walker, t, dt) {
    const ac = this.app.aircraft();
    const R = ac.width / 2;
    const k = 1 - Math.exp(-dt * 7);
    const fp = this.mode === 'fp';
    // --- 行李櫃內的行李 ---
    if (sim && sim.binBags) {
      for (const [doorId, bags] of Object.entries(sim.binBags)) {
        const d = sim.binDoor(doorId); if (!d) continue;
        bags.forEach((bag, i) => {
          const key = doorId + '#' + i;
          let mesh = this.bagMeshes.get(key);
          let pose = bagPose(d, i, bag.tidy, ac.width);
          if (!bag.tidy && bag.push != null) {
            const tp0 = bagPose(d, i, true, ac.width), e = bag.push;
            pose = { x: pose.x + (tp0.x - pose.x) * e, y: pose.y + (tp0.y - pose.y) * e, h: pose.h + (tp0.h - pose.h) * e, yaw: 0.5 * bag.skew * (i % 2 ? 1 : -1) * (i % 2 ? 1 : -1), roll: pose.roll * (1 - e) };
          }
          if (!mesh) {
            mesh = makeBinBag(bag.col, bag.seed || i);
            mesh.traverse((o) => { if (o.isMesh) { o.userData.propId = `bag|${doorId}|${i}`; this.propMeshes.push(o); } });
            const st = bag.spawn ? P(bag.spawn.x, bag.spawn.y, 1.5) : P(pose.x, pose.y, pose.h);
            mesh.position.copy(st);
            this.cabin.add(mesh); this.bagMeshes.set(key, mesh);
          }
          const pv = this.pivots.get(doorId);
          mesh.visible = (fp || !!sim.binView) && (!!sim.binOpen[doorId] || (pv && pv.cur > 0.04));
          const tp = P(pose.x, pose.y, pose.h);
          mesh.position.lerp(tp, k);
          mesh.rotation.y += (pose.yaw - mesh.rotation.y) * k;
          mesh.rotation.x += (-pose.roll - mesh.rotation.x) * k;
        });
      }
    }
    // --- 登機中的旅客 ---
    if (sim && sim.boarding) {
      for (const [seat, b] of Object.entries(sim.boarding)) {
        const seated = this.paxMeshes.get(seat);
        if (seated) seated.visible = b.state === 'seated';
        let w = this.walkers.get(seat);
        const active = b.state === 'walk' || b.state === 'stow' || b.state === 'sit';
        if (!active) { if (w) { this.cabin.remove(w.mesh); if (w.bag) this.cabin.remove(w.bag); this.walkers.delete(seat); } continue; }
        if (!w) {
          const p = this.app.scenario().passengers.find((x) => x.seat === seat) || { seat, name: '', type: 'normal' };
          w = { mesh: makePaxWalker(p), bag: b.bag ? makeSuitcase(b.col) : null, last: { x: b.x, y: b.y } };
          this.cabin.add(w.mesh); if (w.bag) this.cabin.add(w.bag);
          this.walkers.set(seat, w);
        }
        const moving = Math.hypot(b.x - w.last.x, b.y - w.last.y) > 0.0008; w.last = { x: b.x, y: b.y };
        const sway = moving ? Math.sin(t * 5.5 * (b.speed || 1) + (b.phase || 0)) * 0.025 : 0;
        w.mesh.position.copy(P(b.x, b.y + (b.lat || 0) + sway, 0));
        let dh = b.heading + (b.paused ? Math.sin(t * 1.3 + (b.phase || 0)) * 0.6 : 0) - w.mesh.rotation.y; dh = Math.atan2(Math.sin(dh), Math.cos(dh)); w.mesh.rotation.y += dh * Math.min(1, dt * 8);
        const stowK = b.state === 'stow' ? Math.min(1, b.stowT / Math.max(1.6, (b.stowDur || 1.8) - 0.4)) : 0;
        w.mesh.userData.setReach(b.state === 'stow' ? Math.sin(Math.min(1, stowK * 1.3) * Math.PI / 2) : 0);
        w.mesh.userData.animate(t * (b.speed || 1) + (b.phase || 0), moving, false, dt);
        if (w.bag) {
          if (b.state === 'walk') {
            // 拉在身後、略微傾斜
            const hx = Math.cos(b.heading), hy = Math.sin(b.heading);
            w.bag.position.copy(P(b.x - hx * 0.42, b.y - hy * 0.42, 0)); w.bag.rotation.set(0, b.heading, 0.32);
          } else if (b.state === 'stow') {
            const d = sim.binDoor(b.door);
            const n = (sim.binBags[b.door] || []).length;
            const pose = d ? bagPose(d, Math.min(n, binCapacity(d) - 1), true, ac.width) : { x: b.x, y: b.y, h: 1.8 };
            const lift = Math.min(1, stowK * 1.4);
            const from = P(b.x, b.y, 0.6), to = P(pose.x, pose.y, pose.h - 0.25);
            w.bag.position.lerpVectors(from, to, lift * lift * (3 - 2 * lift));
            w.bag.rotation.set(0, b.heading, lift * Math.PI / 2 * 0.95);
            w.bag.visible = stowK < 0.98;
          } else w.bag.visible = false;
        }
      }
    }
    // --- 服務鈴：座位上方的呼叫燈 + 座位亮起 ---
    if (sim && sim.calls) {
      for (const seat of Object.keys(sim.calls)) {
        if (this.callMarks.has(seat)) continue;
        const st = ac.seats.find((z) => z.id === seat); if (!st) continue;
        const g = new THREE.Group();
        const side = st.y < 0 ? -1 : 1;
        const lamp = new THREE.Mesh(new THREE.CylinderGeometry(0.03, 0.03, 0.012, 18), new THREE.MeshBasicMaterial({ color: new THREE.Color(0.6, 1.4, 3.2), toneMapped: false }));
        lamp.position.copy(P(st.x + 0.13, side * (R - 0.46), 1.608));
        const halo = new THREE.Mesh(new THREE.CircleGeometry(0.11, 24), new THREE.MeshBasicMaterial({ color: new THREE.Color(0.4, 0.9, 2.2), toneMapped: false, transparent: true, opacity: 0.35, depthWrite: false }));
        halo.rotation.x = Math.PI / 2; halo.position.copy(lamp.position).add(new THREE.Vector3(0, -0.008, 0));
        // 座位輪廓發光
        const glow = new THREE.Mesh(new THREE.BoxGeometry(st.d + 0.1, 1.3, st.w + 0.06), new THREE.MeshBasicMaterial({ color: new THREE.Color(0.35, 0.75, 1.8), toneMapped: false, transparent: true, opacity: 0.3, depthWrite: false, blending: THREE.AdditiveBlending }));
        glow.position.copy(P(st.x, st.y, 0.7));
        const ring = new THREE.Mesh(new THREE.TorusGeometry(0.34, 0.022, 8, 40), new THREE.MeshBasicMaterial({ color: new THREE.Color(0.6, 1.4, 3.2), toneMapped: false }));
        ring.rotation.x = Math.PI / 2; ring.position.copy(P(st.x, st.y, 0.03));
        const beacon = this.label('🔔 ' + seat, P(st.x, st.y, 1.75), 0.75); beacon.material.depthTest = true;
        g.add(lamp, halo, glow, ring, beacon);
        this.cabin.add(g); this.callMarks.set(seat, g);
      }
      for (const [seat, g] of this.callMarks) {
        if (!sim.calls[seat]) { this.cabin.remove(g); this.callMarks.delete(seat); continue; }
        const pulse = 0.5 + 0.5 * Math.sin(t * 5);
        g.children[1].material.opacity = 0.3 + 0.4 * pulse; g.children[2].material.opacity = 0.18 + 0.22 * pulse;
      }
    }
    // --- 推車奔跑：物品掉落 ---
    if (sim && this.cart && this.cart.userData.items) {
      const items = this.cart.userData.items;
      const lost = Math.min(items.length, sim.cart.lost || 0);
      if (!lost && this.spillMeshes.size === 0) items.forEach((o) => { o.visible = true; });
      for (const sp of sim.spills || []) {
        if (this.spillMeshes.has(sp.id)) continue;
        const g = new THREE.Group(); const falls = [];
        items.filter((o) => o.visible).slice(0, sp.n).forEach((o, i) => {
          o.visible = false;
          const c = o.clone(); const wp = new THREE.Vector3(); o.getWorldPosition(wp); this.cabin.worldToLocal(wp);
          c.position.copy(wp); g.add(c);
          const dest = P(sp.x + (i - 1) * 0.12, sp.y + (Math.random() - 0.5) * 0.2, 0.04);
          falls.push({ m: c, from: wp.clone(), to: dest, spin: (Math.random() - 0.5) * 8 });
        });
        const puddle = new THREE.Mesh(new THREE.CircleGeometry(0.22, 28), new THREE.MeshStandardMaterial({ color: '#5a3416', roughness: 0.05, metalness: 0.2, transparent: true, opacity: 0.75 }));
        puddle.rotation.x = -Math.PI / 2; puddle.position.copy(P(sp.x, sp.y, 0.008)); puddle.scale.setScalar(0.01); g.add(puddle);
        this.cabin.add(g); this.spillMeshes.set(sp.id, { g, falls, t0: t, puddle });
      }
      for (const [id, s] of this.spillMeshes) {
        if (!(sim.spills || []).some((x) => x.id === id)) { this.cabin.remove(s.g); this.spillMeshes.delete(id); continue; }
        const e = Math.min(1, (t - s.t0) / 0.7);
        s.falls.forEach((f) => { f.m.position.lerpVectors(f.from, f.to, e); f.m.position.y = f.from.y + (f.to.y - f.from.y) * e * e; f.m.rotation.z = e * Math.PI / 2; f.m.rotation.y = f.spin * e; });
        s.puddle.scale.setScalar(Math.max(0.01, Math.min(1, (t - s.t0 - 0.4) / 0.8)));
      }
    }
    // --- 整理行李時伸手 ---
    if (sim && sim.tidyEvents && sim.tidyEvents.length) { sim.tidyEvents.length = 0; this.tidyT = t; }
  }

  // 行李櫃視角：鏡頭移到走道上，抬頭看著打開的行李櫃
  binCamera(sim, dt) {
    const want = sim && sim.binView ? 1 : 0;
    this.binBlend = (this.binBlend || 0) + (want - (this.binBlend || 0)) * Math.min(1, dt * 4);
    if (this.binBlend < 0.002) return;
    const d = sim && sim.binView ? sim.binDoor(sim.binView) : this.lastBinDoor;
    if (!d) return;
    this.lastBinDoor = d;
    const R = this.app.aircraft().width / 2, inner = R - 0.74;
    const pos = P(d.x - 0.15, d.edgeY + d.face * 0.65, 1.6);
    const look = P(d.x, d.bagY, d.center ? 1.88 : 1.8);
    this.cabin.updateMatrixWorld(true);
    const wp = pos.clone().applyMatrix4(this.cabin.matrixWorld), wl = look.clone().applyMatrix4(this.cabin.matrixWorld);
    const tmp = this.tmpCam || (this.tmpCam = new THREE.PerspectiveCamera()); tmp.position.copy(wp); tmp.lookAt(wl);
    this.camera.position.lerp(wp, this.binBlend);
    this.camera.quaternion.slerp(tmp.quaternion, this.binBlend);
    this.camera.fov += (60 - this.camera.fov) * this.binBlend;
  }

  // ---- 送餐動作：轉向旅客、伸手把餐盤遞到桌板上 ----
  updateServe(sim, walker, t) {
    if (!sim) return;
    if (sim.serveEvents && sim.serveEvents.length) { this.serveQueue.push(...sim.serveEvents); sim.serveEvents.length = 0; }
    const DUR = 1.5;
    if (!this.serveAnim && this.serveQueue.length) {
      const ev = this.serveQueue.shift();
      const g = this.paxMeshes.get(ev.seat);
      const st = this.app.aircraft().seats.find((z) => z.id === ev.seat);
      if (!g || !st) return;
      const yaw = Math.atan2(st.y - walker.y, st.x - walker.x);
      const col = { coffee: '#4a2c1a', tea: '#a5652a', oj: '#f2a33a', apple: '#e3c45a', coke: '#3a1d10', water: '#cfe3ef', beer: '#e0b440', wine: '#6e1625' }[ev.drink];
      const tray = ev.meal === 'none' ? (() => { const c = new THREE.Group(); const cup = new THREE.Mesh(new THREE.CylinderGeometry(0.03, 0.025, 0.09, 16), new THREE.MeshStandardMaterial({ color: '#f4f4f2' })); const dr = new THREE.Mesh(new THREE.CylinderGeometry(0.027, 0.027, 0.005, 16), new THREE.MeshStandardMaterial({ color: col })); dr.position.y = 0.04; c.add(cup, dr); return c; })() : makeMealTray(col);
      this.cabin.add(tray);
      this.serveAnim = { ...ev, t0: t, yaw, tray, g };
      if (this.mode === 'fp') { this.fp.yaw = yaw; this.fp.pitch = -0.32; }
    }
    const a = this.serveAnim;
    if (!a) { this.player.userData.setReach && this.player.userData.setReach(0); return; }
    const k = this.serveDebugFreeze != null ? this.serveDebugFreeze : Math.min(1, (t - a.t0) / DUR);
    const reach = k < 0.65 ? Math.sin((k / 0.65) * Math.PI / 2) : k < 0.85 ? 1 : 1 - (k - 0.85) / 0.15;
    this.player.userData.setReach(reach);
    // 餐盤從手上移到旅客桌板
    const ry = this.player.rotation.y;
    const hand = P(walker.x, walker.y, 1.05).add(new THREE.Vector3(Math.cos(ry) * 0.42, 0, -Math.sin(ry) * 0.42));
    const dest = new THREE.Vector3(-0.42, 0.72, 0); a.g.localToWorld(dest); this.cabin.worldToLocal(dest);
    const m = Math.min(1, k / 0.75), e = m * m * (3 - 2 * m);
    a.tray.position.lerpVectors(hand, dest, e); a.tray.position.y += Math.sin(e * Math.PI) * 0.08;
    a.tray.rotation.y = ry;
    if (k >= 1) { this.cabin.remove(a.tray); this.serveAnim = null; }
  }

  // ---- 氧氣面罩（落下後懸掛擺動） ----
  ensureOxygen(sim) {
    this.oxyBuilt = this.oxyBuilt || new Map();
    const ac = this.app.aircraft();
    for (const row of Object.keys(sim.oxygen)) {
      if (this.oxyBuilt.has(row)) continue;
      const seats = activeSeats(ac).filter((s) => String(s.row) === String(row));
      const g = new THREE.Group();
      const cup = new THREE.MeshStandardMaterial({ color: '#f2c230', roughness: 0.5 });
      const tube = new THREE.MeshStandardMaterial({ color: '#e8e4d8', roughness: 0.6 });
      seats.forEach((s) => {
        const m1 = new THREE.Group();
        const c = new THREE.Mesh(new THREE.CylinderGeometry(0.045, 0.035, 0.06, 16), cup); c.position.y = -0.36;
        const strap = new THREE.Mesh(new THREE.TorusGeometry(0.05, 0.004, 4, 16), tube); strap.position.y = -0.36; strap.rotation.x = Math.PI / 2;
        const t = new THREE.Mesh(new THREE.CylinderGeometry(0.004, 0.004, 0.33, 6), tube); t.position.y = -0.165;
        m1.add(c, strap, t); m1.position.set(s.x - 0.12, 1.62, -s.y); m1.userData.phase = Math.random() * 6;
        g.add(m1);
      });
      g.userData.ceiling = false;
      this.cabin.add(g); this.oxyBuilt.set(row, g);
    }
  }

  label(text, pos, size = 1) {
    const { tex, aspect } = pillTexture(text);
    const sp = new THREE.Sprite(new THREE.SpriteMaterial({ map: tex, depthTest: false, transparent: true }));
    sp.scale.set(0.3 * aspect * size, 0.3 * size, 1); sp.position.copy(pos); sp.renderOrder = 10;
    sp.userData.label = true;
    return sp;
  }

  applyMode() {
    const fp = this.mode === 'fp';
    this.showBinsState = fp;
    this.clipMats.forEach((mm) => { mm.clippingPlanes = fp ? [] : [this.clipWorld]; mm.needsUpdate = true; });
    this.cabin.traverse((o) => {
      if (o.userData.ceiling) o.visible = fp;
      if (o.userData.cutaway) o.visible = !fp;
      if (o.isSprite && o.userData.label) o.visible = !fp;
    });
    // 環境光遮蔽只在第一人稱使用（剖面視角中被裁切的幾何會造成錯誤陰影）
    if (this.gtao) this.gtao.enabled = fp && this.quality === 'high';
    if (this.bloom) this.bloom.enabled = this.quality !== 'low';
    this.sun.castShadow = !fp && this.quality !== 'low';
    this.hemi.intensity = fp ? 0.2 : 0.75; // 補光：避免臉部下半部過暗
    this.sun.intensity = fp ? 0.0 : 1.7; // 機艙內不該有穿透機頂的直射陽光
  }

  setMode(mode) {
    this.mode = mode;
    this.applyMode();
    if (mode === 'fp') { this.fpView.yaw = this.fp.yaw; this.fpView.pitch = this.fp.pitch; }
    if (document.pointerLockElement) document.exitPointerLock();
    this.renderer.domElement.style.cursor = mode === 'fp' ? 'grab' : 'default';
  }

  bind() {
    const el = this.renderer.domElement;
    let drag = null;
    el.addEventListener('contextmenu', (e) => e.preventDefault());
    el.addEventListener('pointerdown', (e) => {
      const sim = this.app.sim;
      if (sim && sim.binView) {
        const h = this.hitTest(e, false);
        if (h && h.type === 'prop' && h.id.startsWith('bag|')) {
          const [, doorId, idx] = h.id.split('|');
          if (doorId === sim.binView) { this.bagDrag = { doorId, idx: +idx, hand: e.button === 2 ? 'R' : 'L', x: e.clientX, y: e.clientY }; el.style.cursor = 'grabbing'; return; }
        }
      }
      drag = { x: e.clientX, y: e.clientY, sx: e.clientX, sy: e.clientY, btn: e.button, moved: false };
      if (this.mode === 'fp') el.style.cursor = 'grabbing';
    });
    let hoverT = 0;
    window.addEventListener('pointermove', (e) => {
      if (this.bagDrag) {
        const bd = this.bagDrag, sim = this.app.sim;
        const dx = e.clientX - bd.x, dy = e.clientY - bd.y; bd.x = e.clientX; bd.y = e.clientY;
        if (sim) sim.handleBag(bd.doorId, bd.idx, -dy * 0.0045, (bd.hand === 'L' ? 1 : -1) * dx * 0.006 * (bd.idx % 2 ? -1 : 1));
        bd.active = performance.now();
        return;
      }
      if (!drag) {
        // 滑鼠移到可互動的人物上時顯示手指游標
        if (e.target === el && performance.now() - hoverT > 90) {
          hoverT = performance.now();
          const h = this.hitTest(e, false);
          el.style.cursor = h ? 'pointer' : this.mode === 'fp' ? 'grab' : 'default';
        }
        return;
      }
      const dx = e.clientX - drag.x, dy = e.clientY - drag.y;
      if (Math.abs(e.clientX - drag.sx) + Math.abs(e.clientY - drag.sy) > 4) drag.moved = true;
      drag.x = e.clientX; drag.y = e.clientY;
      if (!drag.moved) return;
      if (this.mode === 'fp') {
        // 按住滑鼠拖曳才轉動視角（不鎖定游標）
        this.fp.yaw -= dx * 0.0042;
        this.fp.pitch = Math.max(-1.2, Math.min(1.2, this.fp.pitch - dy * 0.0042));
        return;
      }
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
      if (this.bagDrag) { this.bagDrag = null; el.style.cursor = 'grab'; return; }
      if (drag && !drag.moved && drag.btn === 0 && e.target === el) {
        const h = this.hitTest(e, true);
        if (h) this.app.onPick(h);
      }
      if (this.mode === 'fp') el.style.cursor = 'grab';
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

  // 點選判定：人物（旅客 / 組員）優先，其次為地板位置
  hitTest(e, withFloor) {
    const r = this.renderer.domElement.getBoundingClientRect();
    const ndc = new THREE.Vector2(((e.clientX - r.left) / r.width) * 2 - 1, -((e.clientY - r.top) / r.height) * 2 + 1);
    const ray = new THREE.Raycaster();
    ray.setFromCamera(ndc, this.camera);
    ray.camera = this.camera;
    const people = [...this.paxMeshes.values(), ...(this.npcMeshes ? this.npcMeshes.values() : [])];
    const shown = (o) => { while (o) { if (!o.visible) return false; o = o.parent; } return true; };
    const hits = ray.intersectObjects([...people, ...(this.propMeshes || [])], true).filter((h) => !h.object.isSprite && h.distance < 30 && shown(h.object));
    if (hits.length && hits[0].object.userData.propId) return { type: 'prop', id: hits[0].object.userData.propId };
    // 被座椅、牆面擋住的人物不可點
    if (hits.length) {
      const blockers = ray.intersectObjects(this.cabin.children.filter((o) => !people.includes(o) && o.visible && o.isMesh), false).filter((h) => shown(h.object));
      const first = hits[0];
      if (!blockers.length || blockers[0].distance > first.distance - 0.05) {
        let o = first.object;
        while (o && !o.userData.seat && !o.userData.npcId) o = o.parent;
        if (o) return o.userData.seat ? { type: 'pax', seat: o.userData.seat } : { type: 'npc', id: o.userData.npcId };
      }
    }
    if (!withFloor) return null;
    const inv = new THREE.Matrix4().copy(this.cabin.matrixWorld).invert();
    const local = ray.ray.clone().applyMatrix4(inv);
    const hit = new THREE.Vector3();
    if (local.intersectPlane(new THREE.Plane(new THREE.Vector3(0, 1, 0), 0), hit)) return { type: 'floor', x: hit.x, y: -hit.z };
    return null;
  }

  // 第一人稱移動：加速與慣性
  fpMove(dt) {
    if (this.mode !== 'fp') { this.vel.set(0, 0); return null; }
    const k = this.keys;
    let f = 0, s = 0;
    if (k.KeyW || k.ArrowUp) f += 1;
    if (k.KeyS || k.ArrowDown) f -= 1;
    if (k.KeyA || k.ArrowLeft) s -= 1;
    if (k.KeyD || k.ArrowRight) s += 1;
    const speed = k.ShiftLeft || k.ShiftRight ? 2.4 : 1.35;
    const yaw = this.fpView.yaw;
    const fx = Math.cos(yaw), fz = -Math.sin(yaw), rx = -fz, rz = fx;
    const on = f || s ? 1 : 0;
    const len = Math.hypot(f, s) || 1;
    const tx = ((fx * f + rx * s) / len) * speed * on, tz = ((fz * f + rz * s) / len) * speed * on;
    const a = 1 - Math.exp(-dt * (on ? 7 : 10));
    this.vel.x += (tx - this.vel.x) * a; this.vel.y += (tz - this.vel.y) * a;
    if (this.vel.length() < 0.01) { this.vel.set(0, 0); return null; }
    return { dx: this.vel.x * dt, dy: -this.vel.y * dt };
  }

  resize() {
    const r = this.container.getBoundingClientRect();
    if (!r.width || !r.height) return;
    this.renderer.setSize(r.width, r.height, false);
    this.composer.setPixelRatio(this.renderer.getPixelRatio());
    this.composer.setSize(r.width, r.height);
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

  updateSky(env) {
    const a = Math.min(1, env.alt / 35000);
    const key = a.toFixed(2);
    if (key === this.skyKey) return;
    this.skyKey = key;
    const g = this.skyCanvas.getContext('2d');
    const top = new THREE.Color().setHSL(0.6, 0.55, THREE.MathUtils.lerp(0.6, 0.3, a));
    const hor = new THREE.Color().setHSL(0.58, 0.4, THREE.MathUtils.lerp(0.86, 0.8, a));
    const gr = g.createLinearGradient(0, 0, 0, 256);
    gr.addColorStop(0, '#' + top.getHexString()); gr.addColorStop(0.75, '#' + hor.getHexString()); gr.addColorStop(1, '#' + hor.getHexString());
    g.fillStyle = gr; g.fillRect(0, 0, 4, 256);
    this.skyTex.needsUpdate = true;
    this.scene.fog.color.copy(hor).convertSRGBToLinear();
  }

  render(sim, walker, dt) {
    const before = this.layoutKey;
    this.rebuild();
    if (before !== this.layoutKey || (this.npcMeshes && this.npcMeshes.size !== (this.npcCount || 0))) { this.envDirty = true; this.npcCount = this.npcMeshes ? this.npcMeshes.size : 0; }
    const ac = this.app.aircraft();
    const env = sim ? sim.env : { alt: 0, speed: 0, pitch: 0, shake: 0, lights: 1, seatbelt: false, ground: true, groundScroll: 0, doorsOpen: true };
    const t = performance.now() / 1000;
    const L = ac.length;

    const pitch = THREE.MathUtils.degToRad(env.pitch);
    const sh = env.shake * 0.01;
    this.cabin.rotation.set(Math.sin(t * 37) * sh * 0.5, 0, -pitch + Math.sin(t * 23) * sh * 0.4);
    const piv = new THREE.Vector3(L / 2, 0, 0);
    this.cabin.position.copy(piv).sub(piv.clone().applyEuler(this.cabin.rotation));
    this.cabin.position.y += Math.sin(t * 41) * sh;
    this.cabin.updateMatrixWorld(true);
    this.clipWorld.copy(this.clipLocal).applyMatrix4(this.cabin.matrixWorld);

    this.sun.position.set(L / 2 + 12, 30, 18);
    this.sun.target.position.set(L / 2, 0, 0);
    const scam = this.sun.shadow.camera, ext = L / 2 + 6;
    if (scam.right !== ext) { scam.left = -ext; scam.right = ext; scam.top = ext; scam.bottom = -ext; scam.near = 1; scam.far = 90; scam.updateProjectionMatrix(); }

    const altM = env.alt * 0.3048;
    this.groundGroup.position.y = -1.32 - Math.min(altM, 3000) * 0.6;
    this.groundGroup.visible = altM < 4500;
    this.groundTex.offset.x = (env.groundScroll / 200) % 1;
    this.clouds.visible = env.alt > 6000;
    this.clouds.position.y = env.alt > 30000 ? -40 : 10;
    this.clouds.children.forEach((c) => { c.position.x -= env.speed * 0.025 * dt * 10; if (c.position.x < -900) c.position.x += 1800; });
    this.updateSky(env);
    this.scene.fog.far = env.alt > 10000 ? 3500 : 1400;

    // 客艙燈光情境
    const mood = env.lights < 0.6 ? [0.55, 0.7, 1.35] : env.lights < 0.95 ? [1.0, 0.82, 0.62] : [1, 1, 1];
    const dim = env.lights < 0.6 ? 0.35 : env.lights < 0.95 ? 0.75 : 1;
    (this.areaLights || []).forEach((l) => {
      if (l.userData.daylight) l.intensity = l.userData.base * (env.alt > 6000 ? 1.4 : 1);
      else { l.intensity = l.userData.base * dim; l.color.setRGB(mood[0], mood[1] * (l.userData.base === 7 ? 0.92 : 0.96), mood[2] * (l.userData.base === 7 ? 0.82 : 0.9)); }
    });
    (this.glowMats || []).forEach((g) => g.color.setRGB(1.1 * dim * mood[0], 0.98 * dim * mood[1], 0.8 * dim * mood[2]));
    if (this.signMat) this.signMat.color.setRGB(...(env.seatbelt ? [2.2, 1.2, 0.2] : [0.15, 0.15, 0.15]));

    this.drawWindow(env);

    this.updateDynamic(sim, walker, t, dt);
    const showBins = this.mode === 'fp' || !!(sim && sim.binView);
    if (this.showBinsState !== showBins) { this.showBinsState = showBins; this.cabin.traverse((o) => { if (o.userData.ceiling) o.visible = showBins; }); this.clipMats.forEach((mm) => { mm.clippingPlanes = showBins ? [] : [this.clipWorld]; mm.needsUpdate = true; }); }
    // 登機門：登機與下機時開啟（L1）
    (this.cabinDoors || []).forEach((cd) => {
      const open = sim ? (sim.env.doorsOpen && (cd.boarding || this.cabinDoors.length === 1)) : cd.boarding;
      cd.cur += ((open ? 1 : 0) - cd.cur) * Math.min(1, dt * 1.5);
      const out = Math.min(1, cd.cur * 2), slide = Math.max(0, cd.cur * 2 - 1);
      cd.door.position.copy(cd.base).add(new THREE.Vector3(slide * (cd.f.w + 0.15), 0, cd.sideZ * out * 0.12));
      cd.portal.visible = cd.cur > 0.02;
    });
    // 可開關物件動畫（行李櫃、洗手間門、休息室門、駕駛艙門）
    if (this.pivots) this.pivots.forEach((pv, id) => {
      const target = sim ? ((sim.binOpen && sim.binOpen[id]) || (sim.doorOpen && sim.doorOpen[id]) ? 1 : 0) : 0;
      pv.cur += (target - pv.cur) * Math.min(1, dt * 6);
      if (pv.axis === 'x') pv.pivot.rotation.x = pv.dir * pv.max * pv.cur;
      else pv.pivot.rotation.y = pv.base + pv.dir * pv.max * pv.cur;
    });
    // 餐車位置
    if (this.cart) {
      const cp = sim && sim.cart ? sim.cart : this.cartHome;
      if (cp) { this.cart.visible = true; this.cart.position.copy(P(cp.x, cp.y, 0)); } else this.cart.visible = false;
    }
    // 已送餐旅客桌板上的餐點
    if (sim && sim.service) for (const [seat, sv] of Object.entries(sim.service.served)) {
      if (this.trays.has(seat) || sv.meal === 'none') continue;
      if ((this.serveAnim && this.serveAnim.seat === seat) || this.serveQueue.some((e) => e.seat === seat) || (sim.serveEvents || []).some((e) => e.seat === seat)) continue;
      const g = this.paxMeshes.get(seat); if (!g) continue;
      const col = { coffee: '#4a2c1a', tea: '#a5652a', oj: '#f2a33a', apple: '#e3c45a', coke: '#3a1d10', water: '#cfe3ef', beer: '#e0b440', wine: '#6e1625' }[sv.drink];
      const tr = makeMealTray(col); tr.position.set(-0.42, 0.72, 0); g.add(tr); this.trays.set(seat, tr);
    }
    // 駕駛艙顯示器
    if (this.cockpitPanel && (!this.cockpitPanel.t || t - this.cockpitPanel.t > 0.15)) { this.cockpitPanel.t = t; this.cockpitPanel.draw(env); }
    if (sim && sim.oxygen) {
      this.ensureOxygen(sim);
      this.oxyBuilt.forEach((g) => g.children.forEach((m1) => { m1.rotation.x = Math.sin(t * 1.7 + m1.userData.phase) * 0.12; m1.rotation.z = Math.cos(t * 1.3 + m1.userData.phase) * 0.1; }));
    }

    if (sim) {
      const targets = new Map();
      sim.activeTasks().forEach((tk) => { if (tk.def.target && tk.def.target.seat) targets.set(tk.def.target.seat, tk); });
      this.paxMeshes.forEach((g, seat) => {
        const md = sim.mood[seat] ?? 70;
        const ind = g.userData.ind;
        if (ind) { ind.visible = md < 70 && this.mode !== 'fp'; ind.material.color.set(md >= 40 ? 0xf5c542 : 0xe5484d); }
        const tk = targets.get(seat);
        let mk = this.markers.get(seat);
        if (tk && !mk) {
          mk = new THREE.Group();
          const col = new THREE.Color(PRIORITY[tk.def.priority].color);
          const cone = new THREE.Mesh(new THREE.ConeGeometry(0.08, 0.2, 24), new THREE.MeshBasicMaterial({ color: col.clone().multiplyScalar(1.6), toneMapped: false }));
          cone.rotation.x = Math.PI;
          const ring = new THREE.Mesh(new THREE.TorusGeometry(0.45, 0.012, 8, 48), new THREE.MeshBasicMaterial({ color: col.clone().multiplyScalar(1.4), toneMapped: false, transparent: true, opacity: 0.85 }));
          ring.rotation.x = Math.PI / 2; ring.position.y = -1.83;
          mk.add(cone, ring);
          g.add(mk); this.markers.set(seat, mk);
        }
        if (!tk && mk) { g.remove(mk); this.markers.delete(seat); }
        if (mk) { mk.position.set(0.12, 1.88 + Math.sin(t * 4) * 0.04, 0); mk.children[0].rotation.y = t * 2; mk.children[1].scale.setScalar(1 + 0.12 * Math.sin(t * 5)); }
      });
    } else this.paxMeshes.forEach((g) => { if (g.userData.ind) g.userData.ind.visible = false; });

    let moving = false;
    if (walker) {
      const moved = this.lastWalker ? Math.hypot(walker.x - this.lastWalker.x, walker.y - this.lastWalker.y) : 0;
      this.lastWalker = { x: walker.x, y: walker.y };
      moving = moved > 0.0015;
      // 第一人稱：保留身體（低頭看得到腿、安全帶、手），只隱藏頭部
      this.player.visible = true;
      this.player.userData.setHead && this.player.userData.setHead(this.mode !== 'fp');
      this.player.position.copy(P(walker.x, walker.y, walker.seated ? -0.4 : 0));
      if (walker.seated && !this.wasSeated && this.mode === 'fp') { this.fp.yaw = 0; this.fp.pitch = -0.95; }
      this.wasSeated = walker.seated;
      const serving = this.serveAnim && this.serveAnim.yaw != null;
      if (moving || walker.seated || this.mode === 'fp' || serving) {
        const target = walker.seated ? 0 : serving ? this.serveAnim.yaw : this.mode === 'fp' ? this.fpView.yaw : (walker.heading ?? 0);
        let d = target - this.player.rotation.y; d = Math.atan2(Math.sin(d), Math.cos(d));
        this.player.rotation.y += this.mode === 'fp' && !walker.seated && !serving ? d : d * Math.min(1, dt * 10);
      }
      this.updateServe(sim, walker, t);
      if (this.tidyT && t - this.tidyT < 0.8) this.player.userData.setReach(Math.sin(((t - this.tidyT) / 0.8) * Math.PI));
      this.player.userData.animate(t, moving, walker.seated, dt);
      if (this.player.userData.setHarness) this.player.userData.setHarness(!!(walker.seated && walker.belted));
    } else if (this.player) this.player.visible = false;
    if (sim) {
      sim.npcs.forEach((n) => {
        let mm = this.npcMeshes.get(n.id);
        if (!mm) {
          mm = makeCrew({ ...this.app.state.profile.uniform, jacket: n.color, bottom: n.color });
          const lb = this.label(n.name.replace(/^(學姊|座艙長)\s*/, ''), new THREE.Vector3(0, 2.2, 0), 0.6);
          lb.visible = this.mode !== 'fp';
          mm.add(lb);
          mm.userData.prev = { x: n.x, y: n.y }; mm.userData.npcId = n.id;
          this.cabin.add(mm); this.npcMeshes.set(n.id, mm);
        }
        const mv = Math.hypot(n.x - mm.userData.prev.x, n.y - mm.userData.prev.y) > 0.0015;
        mm.userData.prev = { x: n.x, y: n.y };
        mm.position.copy(P(n.x, n.y, 0));
        if (n.heading != null) { let d = n.heading - mm.rotation.y; d = Math.atan2(Math.sin(d), Math.cos(d)); mm.rotation.y += d * Math.min(1, dt * 8); }
        mm.userData.animate(t, mv, false, dt);
        if (mm.userData.setReach) mm.userData.setReach(n.reaching ? 0.6 + 0.4 * Math.sin(t * 3) : 0);
        if (n.reaching && n.binJob && sim.binDoor) { const d = sim.binDoor(n.binJob); if (d) { let dd = Math.atan2(d.side * 1.5 - n.y, 0.0001) - mm.rotation.y; dd = Math.atan2(Math.sin(dd), Math.cos(dd)); mm.rotation.y += dd * Math.min(1, dt * 6); } }
      });
    }

    if (this.mode === 'fp' && walker) {
      const k = 1 - Math.exp(-dt * 22);
      let dy = this.fp.yaw - this.fpView.yaw; dy = Math.atan2(Math.sin(dy), Math.cos(dy));
      this.fpView.yaw += dy * k; this.fpView.pitch += (this.fp.pitch - this.fpView.pitch) * k;
      const spd = this.vel.length();
      if (moving && spd > 0.1) this.bob += dt * spd * 5.2;
      const amp = Math.min(1, spd);
      const bobY = Math.sin(this.bob * 2) * 0.016 * amp, bobX = Math.cos(this.bob) * 0.01 * amp;
      let eyeH = walker.seated ? 1.33 : EYE_H;
      // 走到行李櫃下方時（例如靠窗走動）自動略為低頭，避免鏡頭穿進行李櫃
      const underBin = (this.binZones || []).some(([a, b]) => walker.x > a - 0.25 && walker.x < b + 0.25);
      if (underBin && !walker.seated) {
        const over = Math.abs(walker.y) - (this.binInner - 0.22);
        if (over > 0) eyeH = Math.min(eyeH, EYE_H - Math.min(1, over / 0.15) * (EYE_H - 1.52));
      }
      this.eyeH = this.eyeH == null ? eyeH : this.eyeH + (eyeH - this.eyeH) * Math.min(1, dt * 10);
      eyeH = this.eyeH;
      const right = new THREE.Vector3(Math.sin(this.fpView.yaw), 0, Math.cos(this.fpView.yaw));
      const ry = this.player.rotation.y, fwd = new THREE.Vector3(Math.cos(ry), 0, -Math.sin(ry));
      this.eye.position.copy(P(walker.x, walker.y, eyeH + bobY)).addScaledVector(right, bobX).addScaledVector(fwd, walker.seated ? 0.12 : 0.12);
      this.eye.rotation.set(0, 0, 0, 'YXZ');
      this.eye.rotation.y = this.fpView.yaw - Math.PI / 2;
      this.eye.rotation.x = this.fpView.pitch;
      this.eye.rotation.z = -bobX * 0.4;
      this.cabin.updateMatrixWorld(true);
      this.camera.position.setFromMatrixPosition(this.eye.matrixWorld);
      this.camera.quaternion.setFromRotationMatrix(this.eye.matrixWorld);
      this.camera.fov = 66; this.camera.near = 0.03;
    } else {
      if (sim && walker && !this.orbit.manual) this.orbit.target.lerp(P(walker.x, walker.y, 0.8), Math.min(1, dt * 3));
      const o = this.orbit;
      this.camera.position.set(o.target.x + o.dist * Math.cos(o.pitch) * Math.cos(o.yaw), o.target.y + o.dist * Math.sin(o.pitch), o.target.z + o.dist * Math.cos(o.pitch) * Math.sin(o.yaw));
      this.camera.lookAt(o.target);
      this.camera.fov = 45; this.camera.near = 0.1;
    }
    this.binCamera(sim, dt);
    // 行李櫃視角：隱藏自己的身體，只在整理時顯示伸出的雙手
    if (this.player) {
      const inBin = (this.binBlend || 0) > 0.3;
      if (inBin) {
        this.player.visible = false;
        if (!this.binHands) {
          this.binHands = new THREE.Group();
          const u = this.app.state.profile.uniform;
          const sleeve = new THREE.MeshStandardMaterial({ color: u.jacket, roughness: 0.8 }), skin = new THREE.MeshStandardMaterial({ color: u.skin, roughness: 0.6 });
          for (const z of [-0.14, 0.14]) {
            const arm = new THREE.Mesh(new THREE.CapsuleGeometry(0.045, 0.34, 6, 12), sleeve); arm.rotation.z = Math.PI / 2 - 0.5; arm.position.set(-0.12, -0.06, z);
            const hand = new THREE.Mesh(new THREE.SphereGeometry(0.045, 14, 10), skin); hand.scale.set(1.3, 0.7, 1); hand.position.set(0.06, 0.05, z);
            this.binHands.add(arm, hand);
          }
          this.scene.add(this.binHands);
        }
        const r = this.tidyT && t - this.tidyT < 0.8 ? Math.sin(((t - this.tidyT) / 0.8) * Math.PI) : 0;
        this.binHands.visible = r > 0.02 || !!this.bagDrag;
        if (this.bagDrag) {
          const mesh = this.bagMeshes.get(this.bagDrag.doorId + '#' + this.bagDrag.idx);
          if (mesh) {
            const wp = new THREE.Vector3(); mesh.getWorldPosition(wp);
            this.binHands.position.lerpVectors(this.camera.position, wp, 0.82);
            this.binHands.quaternion.copy(this.camera.quaternion); this.binHands.rotateY(Math.PI / 2);
            // 作用中的手往前伸
            const L = this.bagDrag.hand === 'L';
            this.binHands.children.forEach((c, i) => { const left = i < 2; c.position.x = (i % 2 ? 0.06 : -0.12) + ((left === L) ? 0.06 : -0.04); c.visible = true; });
            return void 0;
          }
        }
        const fwd = new THREE.Vector3(0, 0, -1).applyQuaternion(this.camera.quaternion);
        this.binHands.position.copy(this.camera.position).addScaledVector(fwd, 0.35 + 0.25 * r).add(new THREE.Vector3(0, -0.22 + 0.12 * r, 0));
        this.binHands.quaternion.copy(this.camera.quaternion); this.binHands.rotateY(Math.PI / 2);
      } else if (this.binHands) this.binHands.visible = false;
    }
    this.camera.updateProjectionMatrix();
    this.applyEnvIntensity();
    (this.mirrors || []).forEach((mr) => {
      const wp = new THREE.Vector3(); mr.mesh.getWorldPosition(wp);
      mr.mesh.visible = this.mode === 'fp' && this.camera.position.distanceTo(wp) < 2.6 && !!(sim && (sim.doorOpen[mr.f.id] || sim.inLav(mr.f)));
    });

    if (this.quality === 'low') this.renderer.render(this.scene, this.camera);
    else this.composer.render(dt);

    // 效能保護：高畫質持續低於約 24 FPS 時自動改為中畫質
    if (this.quality === 'high' && dt > 0) {
      this.frameTimes.push(dt); if (this.frameTimes.length > 90) this.frameTimes.shift();
      if (this.frameTimes.length === 90 && this.frameTimes.reduce((a, b) => a + b, 0) / 90 > 0.042 && !this.noAutoQuality) {
        this.frameTimes = []; this.setQuality('medium');
        if (this.app.onQualityAuto) this.app.onQualityAuto('medium');
      }
    }
  }

  drawWindow(env) {
    const c = this.winCanvas, g = c.getContext('2d');
    const w = c.width, h = c.height;
    const altF = Math.min(1, env.alt / 35000);
    const horizon = h * (0.7 + altF * 0.15) - env.pitch * 3;
    const sky = g.createLinearGradient(0, 0, 0, Math.max(1, horizon));
    sky.addColorStop(0, `hsl(214,62%,${60 - altF * 26}%)`);
    sky.addColorStop(1, `hsl(205,50%,${88 - altF * 8}%)`);
    g.fillStyle = sky; g.fillRect(0, 0, w, h);
    if (env.alt > 6000) {
      const cg = g.createLinearGradient(0, horizon - 4, 0, h); cg.addColorStop(0, 'rgba(255,255,255,0.98)'); cg.addColorStop(1, 'rgba(225,232,242,0.95)');
      g.fillStyle = cg; g.fillRect(0, horizon - 4, w, h);
    } else {
      g.fillStyle = env.ground ? '#6b7f58' : '#5f7d8f'; g.fillRect(0, horizon, w, h - horizon);
      if (env.ground) {
        g.fillStyle = '#4a4d55'; g.fillRect(0, horizon + 8, w, 18);
        g.fillStyle = '#f2f2f2';
        const off = (env.groundScroll * 4) % 20;
        for (let x = -20; x < w + 20; x += 20) g.fillRect(x - off, horizon + 16, 9, 2);
      }
    }
    this.winTex.needsUpdate = true;
  }
}
