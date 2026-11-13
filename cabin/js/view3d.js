// 3D 機艙：預設環繞視角 / 第一人稱視角、起降環境
import * as THREE from 'three';
import { SEAT_CLASS, PAX_TYPES, FIXTURE_TYPES, PRIORITY } from './data.js';
import { activeSeats } from './layout.js';

const H = { floor: 0, wall: 2.05, bin0: 1.62, eye: 1.62 };
// 座標換算：模擬 (x 沿機身, y 橫向 左負) → three (x, 高, z = -y)
const P = (x, y, h = 0) => new THREE.Vector3(x, h, -y);

export class View3D {
  constructor(container, app) {
    this.app = app;
    this.container = container;
    this.renderer = new THREE.WebGLRenderer({ antialias: true });
    this.renderer.setPixelRatio(Math.min(2, window.devicePixelRatio || 1));
    this.renderer.outputColorSpace = THREE.SRGBColorSpace;
    container.appendChild(this.renderer.domElement);
    this.scene = new THREE.Scene();
    this.camera = new THREE.PerspectiveCamera(60, 1, 0.05, 4000);
    this.mode = 'orbit';
    this.orbit = { yaw: -2.3, pitch: 0.75, dist: 18, target: new THREE.Vector3(10, 0, 0) };
    this.fp = { yaw: 0, pitch: -0.05 };
    this.keys = {};
    this.layoutKey = null;
    this.paxMeshes = new Map();
    this.markers = new Map();

    this.scene.fog = new THREE.Fog(0x9cc4e8, 60, 900);
    this.hemi = new THREE.HemisphereLight(0xffffff, 0x445066, 0.9);
    this.scene.add(this.hemi);
    this.sun = new THREE.DirectionalLight(0xffffff, 1.4);
    this.sun.position.set(20, 40, 10);
    this.scene.add(this.sun);
    this.cabinLight = new THREE.PointLight(0xfff1d6, 0, 30);

    this.cabin = new THREE.Group(); // 隨俯仰角傾斜
    this.scene.add(this.cabin);
    this.eye = new THREE.Object3D();
    this.cabin.add(this.eye);

    this.buildEnvironment();
    this.bind();
  }

  // ---- 外部環境：地面、跑道、雲 ----
  buildEnvironment() {
    const c = document.createElement('canvas'); c.width = 256; c.height = 256;
    const g = c.getContext('2d');
    g.fillStyle = '#4c5a43'; g.fillRect(0, 0, 256, 256);
    g.fillStyle = '#3d3f44'; g.fillRect(0, 88, 256, 80);
    g.fillStyle = '#e8e8e8'; for (let x = 0; x < 256; x += 64) g.fillRect(x, 124, 34, 6);
    g.fillRect(0, 92, 256, 3); g.fillRect(0, 161, 256, 3);
    this.groundTex = new THREE.CanvasTexture(c);
    this.groundTex.wrapS = this.groundTex.wrapT = THREE.RepeatWrapping;
    this.groundTex.repeat.set(40, 1);
    this.groundTex.colorSpace = THREE.SRGBColorSpace;
    const ground = new THREE.Mesh(new THREE.PlaneGeometry(4000, 100), new THREE.MeshLambertMaterial({ map: this.groundTex }));
    ground.rotation.x = -Math.PI / 2;
    this.ground = ground;
    const grass = new THREE.Mesh(new THREE.PlaneGeometry(8000, 8000), new THREE.MeshLambertMaterial({ color: 0x55704a }));
    grass.rotation.x = -Math.PI / 2; grass.position.y = -0.05;
    this.groundGroup = new THREE.Group();
    this.groundGroup.add(grass, ground);
    this.scene.add(this.groundGroup);

    this.clouds = new THREE.Group();
    const cm = new THREE.MeshLambertMaterial({ color: 0xffffff, transparent: true, opacity: 0.85 });
    for (let i = 0; i < 40; i++) {
      const m = new THREE.Mesh(new THREE.SphereGeometry(8 + Math.random() * 14, 10, 8), cm);
      m.scale.y = 0.35;
      m.position.set(Math.random() * 1600 - 800, -30 - Math.random() * 40, (Math.random() - 0.5) * 900);
      this.clouds.add(m);
    }
    this.scene.add(this.clouds);

    // 窗外景色：共用 canvas 材質
    this.winCanvas = document.createElement('canvas'); this.winCanvas.width = 32; this.winCanvas.height = 64;
    this.winTex = new THREE.CanvasTexture(this.winCanvas);
    this.winTex.colorSpace = THREE.SRGBColorSpace;
    this.winMat = new THREE.MeshBasicMaterial({ map: this.winTex });
  }

  // ---- 機艙幾何 ----
  rebuild(force = false) {
    const ac = this.app.aircraft();
    const sc = this.app.scenario();
    const uni = this.app.state.profile;
    const key = JSON.stringify([ac.id, ac.length, ac.width, ac.seats.length, ac.seats.filter((s) => s.removed).length, ac.fixtures.map((f) => [f.x, f.y, f.w, f.d, f.type]),
      ac.seats.map((s) => s.cls + s.x.toFixed(2)).join(''), sc && sc.passengers.map((p) => p.seat + p.type).join(','), JSON.stringify(uni.uniform), uni.airline]);
    if (!force && key === this.layoutKey) return;
    this.layoutKey = key;
    this.cabin.clear();
    this.cabin.add(this.eye);
    this.cabin.add(this.cabinLight);
    this.paxMeshes.clear();
    this.markers.clear();
    const L = ac.length, W = ac.width;
    this.cabin.position.set(0, 0, 0);

    // 地板
    const floor = new THREE.Mesh(new THREE.BoxGeometry(L, 0.1, W), new THREE.MeshLambertMaterial({ color: 0x5b6378 }));
    floor.position.set(L / 2, -0.05, 0);
    this.cabin.add(floor);
    // 走道地毯
    const carpet = new THREE.Mesh(new THREE.PlaneGeometry(L, W * 0.98), new THREE.MeshLambertMaterial({ color: 0x31405e }));
    carpet.rotation.x = -Math.PI / 2; carpet.position.set(L / 2, 0.005, 0);
    this.cabin.add(carpet);

    // 側牆與窗戶
    const wallMat = new THREE.MeshLambertMaterial({ color: 0xe9ecf1, side: THREE.DoubleSide });
    for (const side of [-1, 1]) {
      const wall = new THREE.Mesh(new THREE.PlaneGeometry(L, H.wall), wallMat);
      wall.position.set(L / 2, H.wall / 2, side * W / 2);
      this.cabin.add(wall);
      const bins = new THREE.Mesh(new THREE.BoxGeometry(L - 4, 0.38, 0.55), new THREE.MeshLambertMaterial({ color: 0xf6f7f9 }));
      bins.position.set(L / 2 + 1.5, H.bin0 + 0.19, side * (W / 2 - 0.3));
      bins.userData.ceiling = true;
      this.cabin.add(bins);
      const winGeo = new THREE.PlaneGeometry(0.24, 0.34);
      for (let x = 3.2; x < L - 1.5; x += 0.53) {
        const w = new THREE.Mesh(winGeo, this.winMat);
        w.position.set(x, 1.15, side * (W / 2 - 0.01));
        w.rotation.y = side > 0 ? Math.PI : 0;
        this.cabin.add(w);
      }
    }
    // 天花板（第一人稱才顯示）
    const ceil = new THREE.Mesh(new THREE.PlaneGeometry(L, W), new THREE.MeshLambertMaterial({ color: 0xf2f3f6, side: THREE.DoubleSide }));
    ceil.rotation.x = Math.PI / 2; ceil.position.set(L / 2, H.wall + 0.15, 0); ceil.userData.ceiling = true;
    this.cabin.add(ceil);
    // 機身外殼（環繞視角下方的弧形）
    const shell = new THREE.Mesh(new THREE.CylinderGeometry(W / 2 + 0.25, W / 2 + 0.25, L, 32, 1, true, Math.PI, Math.PI),
      new THREE.MeshLambertMaterial({ color: 0xffffff, side: THREE.DoubleSide }));
    shell.rotation.z = Math.PI / 2; shell.position.set(L / 2, 0.9, 0); shell.scale.set(1, 1, 1);
    this.cabin.add(shell);
    const nose = new THREE.Mesh(new THREE.SphereGeometry(W / 2 + 0.25, 24, 16, -Math.PI / 2, Math.PI, 0, Math.PI / 2), new THREE.MeshLambertMaterial({ color: 0xffffff, side: THREE.DoubleSide }));
    nose.rotation.z = Math.PI / 2; nose.position.set(0, 0.9, 0); nose.scale.set(1, 1.6, 1);
    this.cabin.add(nose);
    // 航空公司塗裝條紋
    for (const side of [-1, 1]) {
      const stripe = new THREE.Mesh(new THREE.BoxGeometry(L, 0.14, 0.04), new THREE.MeshLambertMaterial({ color: uni.uniform.scarf }));
      stripe.position.set(L / 2, 0.75, side * (W / 2 + 0.27));
      this.cabin.add(stripe);
    }

    // 座位
    const seatGeo = new THREE.BoxGeometry(1, 1, 1);
    const mats = {};
    Object.entries(SEAT_CLASS).forEach(([k, v]) => { mats[k] = new THREE.MeshLambertMaterial({ color: v.color }); });
    const seats = activeSeats(ac);
    const cushion = new THREE.InstancedMesh(seatGeo, new THREE.MeshLambertMaterial({ color: 0xffffff }), seats.length);
    const back = new THREE.InstancedMesh(seatGeo, new THREE.MeshLambertMaterial({ color: 0xffffff }), seats.length);
    const m = new THREE.Matrix4(), q = new THREE.Quaternion(), col = new THREE.Color();
    seats.forEach((s, i) => {
      m.compose(P(s.x - s.d * 0.05, s.y, 0.42), q, new THREE.Vector3(s.d * 0.85, 0.14, s.w * 0.92));
      cushion.setMatrixAt(i, m);
      m.compose(P(s.x + s.d * 0.42, s.y, 0.8), q, new THREE.Vector3(0.12, 0.85, s.w * 0.92));
      back.setMatrixAt(i, m);
      col.set((SEAT_CLASS[s.cls] || SEAT_CLASS.Y).color);
      cushion.setColorAt(i, col); back.setColorAt(i, col.clone().multiplyScalar(0.8));
    });
    this.cabin.add(cushion, back);

    // 設施
    ac.fixtures.forEach((f) => {
      const t = FIXTURE_TYPES[f.type] || { color: '#888' };
      let h = 2.0, y0 = 0;
      if (f.type === 'door') { h = 1.9; }
      if (f.type === 'jumpseat') { h = 0.5; y0 = 0.25; }
      if (f.type === 'cockpit') { h = 2.1; }
      const mesh = new THREE.Mesh(new THREE.BoxGeometry(f.w, h, f.d), new THREE.MeshLambertMaterial({ color: t.color, transparent: f.type === 'cockpit', opacity: f.type === 'cockpit' ? 0.55 : 1 }));
      mesh.position.copy(P(f.x, f.y, y0 + h / 2));
      this.cabin.add(mesh);
      if (f.type === 'jumpseat') {
        const b = new THREE.Mesh(new THREE.BoxGeometry(f.w, 0.7, 0.08), new THREE.MeshLambertMaterial({ color: t.color }));
        b.position.copy(P(f.x, f.y + (f.y < 0 ? -f.d / 2 : f.d / 2), 0.85));
        this.cabin.add(b);
      }
      if (f.label && f.type !== 'jumpseat') this.cabin.add(this.label(f.label, P(f.x, f.y, h + 0.25), 0.9));
    });

    // 安全帶指示燈
    this.signs = [];
    for (let x = 4; x < L - 2; x += 6) {
      const sgn = new THREE.Mesh(new THREE.BoxGeometry(0.25, 0.08, 0.4), new THREE.MeshBasicMaterial({ color: 0x333333 }));
      sgn.position.set(x, H.wall + 0.08, 0); sgn.userData.ceiling = false;
      this.cabin.add(sgn); this.signs.push(sgn);
    }

    // 旅客
    if (sc) sc.passengers.forEach((p) => {
      const s = seats.find((z) => z.id === p.seat);
      if (!s) return;
      const g = makePassenger(p);
      g.position.copy(P(s.x, s.y, 0.45));
      this.cabin.add(g);
      this.paxMeshes.set(p.seat, g);
    });

    // 組員角色（玩家 + NPC）
    this.player = makeCrew(uni.uniform);
    this.cabin.add(this.player);
    this.npcMeshes = new Map();

    this.cabin.userData.L = L;
    this.applyCeiling();
  }

  label(text, pos, size = 1) {
    const c = document.createElement('canvas'); c.width = 256; c.height = 64;
    const g = c.getContext('2d');
    g.fillStyle = 'rgba(15,20,30,0.75)'; g.fillRect(0, 8, 256, 48);
    g.fillStyle = '#fff'; g.font = 'bold 30px system-ui, sans-serif'; g.textAlign = 'center'; g.textBaseline = 'middle';
    g.fillText(text, 128, 33);
    const tex = new THREE.CanvasTexture(c); tex.colorSpace = THREE.SRGBColorSpace;
    const sp = new THREE.Sprite(new THREE.SpriteMaterial({ map: tex, depthTest: false }));
    sp.scale.set(1.6 * size, 0.4 * size, 1); sp.position.copy(pos); sp.renderOrder = 10;
    return sp;
  }

  applyCeiling() {
    this.cabin.traverse((o) => { if (o.userData.ceiling) o.visible = this.mode === 'fp'; });
  }

  setMode(mode) {
    this.mode = mode;
    this.applyCeiling();
    if (mode !== 'fp' && document.pointerLockElement) document.exitPointerLock();
  }

  // ---- 操作 ----
  bind() {
    const el = this.renderer.domElement;
    let drag = null;
    el.addEventListener('contextmenu', (e) => e.preventDefault());
    el.addEventListener('pointerdown', (e) => {
      if (this.mode === 'fp') {
        if (!document.pointerLockElement) el.requestPointerLock && el.requestPointerLock();
        return;
      }
      drag = { x: e.clientX, y: e.clientY, btn: e.button, moved: false };
    });
    window.addEventListener('pointermove', (e) => {
      if (this.mode === 'fp' && document.pointerLockElement === el) {
        this.fp.yaw -= e.movementX * 0.0025;
        this.fp.pitch = Math.max(-1.2, Math.min(1.2, this.fp.pitch - e.movementY * 0.0025));
        return;
      }
      if (!drag) return;
      const dx = e.clientX - drag.x, dy = e.clientY - drag.y;
      if (Math.abs(dx) + Math.abs(dy) > 3) drag.moved = true;
      drag.x = e.clientX; drag.y = e.clientY;
      if (drag.btn === 2 || e.shiftKey) {
        const right = new THREE.Vector3(Math.sin(this.orbit.yaw), 0, -Math.cos(this.orbit.yaw));
        this.orbit.target.addScaledVector(right, -dx * this.orbit.dist * 0.002);
        this.orbit.target.x += dy * this.orbit.dist * 0.002 * Math.cos(this.orbit.yaw);
        this.orbit.manual = true;
      } else {
        this.orbit.yaw -= dx * 0.006;
        this.orbit.pitch = Math.max(0.08, Math.min(1.5, this.orbit.pitch + dy * 0.005));
      }
    });
    window.addEventListener('pointerup', (e) => {
      if (drag && !drag.moved && drag.btn === 0 && this.mode === 'orbit') this.pick(e);
      drag = null;
    });
    el.addEventListener('wheel', (e) => {
      e.preventDefault();
      if (this.mode === 'orbit') this.orbit.dist = Math.max(2.5, Math.min(90, this.orbit.dist * Math.exp(e.deltaY * 0.001)));
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
    // 與機艙地板平面相交（轉回機艙座標）
    const inv = new THREE.Matrix4().copy(this.cabin.matrixWorld).invert();
    const local = ray.ray.clone().applyMatrix4(inv);
    const hit = new THREE.Vector3();
    if (local.intersectPlane(new THREE.Plane(new THREE.Vector3(0, 1, 0), -0.45), hit)) {
      this.app.onPlayClick({ x: hit.x, y: -hit.z });
    }
  }

  // 第一人稱移動向量（模擬座標）
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
    // 機艙局部座標：前進方向 (cos yaw, 0, -sin yaw)
    const fx = Math.cos(yaw), fz = -Math.sin(yaw);
    const rx = -fz, rz = fx; // 右方
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
    this.orbit.target.set(ac.length / 2, 0, 0);
    this.orbit.dist = Math.max(10, ac.length * 0.8); this.orbit.pitch = 0.85;
    this.orbit.manual = false;
  }

  // ---- 每幀更新 ----
  render(sim, walker, dt) {
    this.rebuild();
    const ac = this.app.aircraft();
    const env = sim ? sim.env : { alt: 0, speed: 0, pitch: 0, shake: 0, lights: 1, seatbelt: false, ground: true, groundScroll: 0, doorsOpen: true };
    const t = performance.now() / 1000;

    // 機身俯仰與震動（樞紐在機艙中央）
    const pitch = THREE.MathUtils.degToRad(env.pitch);
    const sh = env.shake * 0.012;
    this.cabin.rotation.set(Math.sin(t * 37) * sh * 0.5, 0, -pitch + Math.sin(t * 23) * sh * 0.4);
    const L = ac.length;
    const piv = new THREE.Vector3(L / 2, 0, 0);
    this.cabin.position.copy(piv).sub(piv.clone().applyEuler(this.cabin.rotation));
    this.cabin.position.y += Math.sin(t * 41) * sh;

    // 地面隨高度下降、跑道捲動
    const altM = env.alt * 0.3048;
    this.groundGroup.position.y = -1.2 - Math.min(altM, 2500) * 0.6;
    this.groundGroup.visible = altM < 4000;
    this.groundTex.offset.x = (env.groundScroll / 100) % 1;
    this.clouds.visible = env.alt > 8000;
    this.clouds.position.y = env.alt > 30000 ? -40 : 0;
    this.clouds.children.forEach((c) => { c.position.x -= env.speed * 0.02 * dt * 10; if (c.position.x < -800) c.position.x += 1600; });
    const skyTop = new THREE.Color().setHSL(0.58, 0.6, THREE.MathUtils.lerp(0.72, 0.45, Math.min(1, env.alt / 35000)));
    this.scene.background = skyTop;
    this.scene.fog.color.copy(skyTop);
    this.scene.fog.far = env.alt > 10000 ? 3000 : 900;

    // 燈光
    this.hemi.intensity = 0.55 + 0.45 * env.lights;
    this.cabinLight.intensity = 0;
    if (this.signs) this.signs.forEach((s) => s.material.color.set(env.seatbelt ? 0xffa531 : 0x333333));

    // 窗外畫面
    this.drawWindow(env);

    // 旅客心情 / 任務標記
    if (sim) {
      const targets = new Map();
      sim.activeTasks().forEach((tk) => { if (tk.def.target && tk.def.target.seat) targets.set(tk.def.target.seat, tk); });
      this.paxMeshes.forEach((g, seat) => {
        const mood = sim.mood[seat] ?? 70;
        const ind = g.userData.ind;
        if (ind) ind.material.color.set(mood >= 70 ? 0x45c46b : mood >= 40 ? 0xf5c542 : 0xe5484d);
        const tk = targets.get(seat);
        let mk = this.markers.get(seat);
        if (tk && !mk) {
          mk = new THREE.Mesh(new THREE.ConeGeometry(0.12, 0.3, 4), new THREE.MeshBasicMaterial({ color: PRIORITY[tk.def.priority].color }));
          mk.rotation.x = Math.PI; g.add(mk); this.markers.set(seat, mk);
        }
        if (!tk && mk) { g.remove(mk); this.markers.delete(seat); }
        if (mk) mk.position.y = 1.55 + Math.sin(t * 5) * 0.08;
      });
    }

    // 角色
    if (walker) {
      this.player.visible = this.mode !== 'fp';
      this.player.position.copy(P(walker.x, walker.y, walker.seated ? 0.25 : 0));
      this.player.rotation.y = walker.seated ? 0 : (walker.heading ?? Math.PI);
      if (walker.path && walker.path.length) this.player.position.y += Math.abs(Math.sin(t * 9)) * 0.04;
    } else if (this.player) this.player.visible = false;
    if (sim) {
      sim.npcs.forEach((n) => {
        let m = this.npcMeshes.get(n.id);
        if (!m) {
          m = makeCrew({ ...this.app.state.profile.uniform, jacket: n.color, bottom: n.color });
          m.add(this.label(n.name.replace(/^(學姊|座艙長)\s*/, ''), new THREE.Vector3(0, 2.05, 0), 0.6));
          this.cabin.add(m); this.npcMeshes.set(n.id, m);
        }
        m.position.copy(P(n.x, n.y, 0));
        if (n.heading != null) m.rotation.y = n.heading;
      });
    }

    // 相機
    if (this.mode === 'fp' && walker) {
      const eyeH = walker.seated ? 1.15 : H.eye;
      this.eye.position.copy(P(walker.x, walker.y, eyeH));
      this.eye.rotation.set(0, 0, 0, 'YXZ');
      this.eye.rotation.y = this.fp.yaw - Math.PI / 2;
      this.eye.rotation.x = this.fp.pitch;
      this.cabin.updateMatrixWorld(true);
      this.camera.position.setFromMatrixPosition(this.eye.matrixWorld);
      this.camera.quaternion.setFromRotationMatrix(this.eye.matrixWorld);
      this.camera.fov = 70;
    } else {
      if (sim && walker && !this.orbit.manual) {
        const tgt = P(walker.x, walker.y, 0.8);
        this.orbit.target.lerp(tgt, Math.min(1, dt * 3));
      }
      const o = this.orbit;
      const cp = new THREE.Vector3(
        o.target.x + o.dist * Math.cos(o.pitch) * Math.cos(o.yaw),
        o.target.y + o.dist * Math.sin(o.pitch),
        o.target.z + o.dist * Math.cos(o.pitch) * Math.sin(o.yaw));
      this.cabin.updateMatrixWorld(true);
      this.camera.position.copy(cp);
      this.camera.lookAt(o.target);
      this.camera.fov = 55;
    }
    this.camera.updateProjectionMatrix();
    this.renderer.render(this.scene, this.camera);
  }

  drawWindow(env) {
    const c = this.winCanvas, g = c.getContext('2d');
    const w = c.width, h = c.height;
    const altF = Math.min(1, env.alt / 35000);
    const horizon = h * (0.55 + altF * 0.3) + env.pitch * 2.2;
    const sky = g.createLinearGradient(0, 0, 0, horizon);
    sky.addColorStop(0, `hsl(210,70%,${55 - altF * 25}%)`);
    sky.addColorStop(1, `hsl(205,60%,${82 - altF * 10}%)`);
    g.fillStyle = sky; g.fillRect(0, 0, w, h);
    if (env.alt > 8000) { g.fillStyle = 'rgba(255,255,255,0.9)'; g.fillRect(0, horizon - 3, w, h); }
    else {
      g.fillStyle = env.ground ? '#5d7350' : '#5b7a8f'; g.fillRect(0, horizon, w, h - horizon);
      if (env.ground) {
        g.fillStyle = '#3c3e43'; g.fillRect(0, horizon + 6, w, 14);
        g.fillStyle = '#eee';
        const off = (env.groundScroll * 3) % 16;
        for (let x = -16; x < w + 16; x += 16) g.fillRect(x - off, horizon + 12, 7, 2);
      }
    }
    this.winTex.needsUpdate = true;
  }
}

// ---- 角色模型 ----
export function makeCrew(u) {
  const g = new THREE.Group();
  const mat = (c) => new THREE.MeshLambertMaterial({ color: c });
  const legs = u.bottomType === 'pants'
    ? (() => { const lg = new THREE.Group(); for (const s of [-1, 1]) { const l = new THREE.Mesh(new THREE.CylinderGeometry(0.08, 0.07, 0.85, 10), mat(u.bottom)); l.position.set(0, 0.43, s * 0.1); lg.add(l); } return lg; })()
    : (() => {
      const lg = new THREE.Group();
      const sk = new THREE.Mesh(new THREE.CylinderGeometry(0.17, 0.26, 0.5, 14), mat(u.bottom)); sk.position.y = 0.68; lg.add(sk);
      for (const s of [-1, 1]) { const l = new THREE.Mesh(new THREE.CylinderGeometry(0.05, 0.045, 0.45, 8), mat(u.skin)); l.position.set(0, 0.22, s * 0.08); lg.add(l); }
      return lg;
    })();
  g.add(legs);
  const torso = new THREE.Mesh(new THREE.CylinderGeometry(0.2, 0.18, 0.62, 14), mat(u.jacket)); torso.position.y = 1.22; g.add(torso);
  const shirt = new THREE.Mesh(new THREE.BoxGeometry(0.06, 0.25, 0.12), mat(u.shirt)); shirt.position.set(0.18, 1.4, 0); g.add(shirt);
  const scarf = new THREE.Mesh(new THREE.TorusGeometry(0.1, 0.035, 8, 16), mat(u.scarf)); scarf.rotation.x = Math.PI / 2; scarf.position.y = 1.55; g.add(scarf);
  const knot = new THREE.Mesh(new THREE.ConeGeometry(0.06, 0.16, 8), mat(u.scarf)); knot.position.set(0.12, 1.47, 0.03); knot.rotation.z = Math.PI; g.add(knot);
  for (const s of [-1, 1]) { const arm = new THREE.Mesh(new THREE.CylinderGeometry(0.055, 0.05, 0.58, 8), mat(u.jacket)); arm.position.set(0, 1.2, s * 0.25); g.add(arm); }
  const head = new THREE.Mesh(new THREE.SphereGeometry(0.15, 16, 12), mat(u.skin)); head.position.y = 1.73; g.add(head);
  const hair = new THREE.Mesh(new THREE.SphereGeometry(0.158, 16, 12, 0, Math.PI * 2, 0, Math.PI / 1.9), mat(u.hair)); hair.position.set(-0.02, 1.75, 0); hair.rotation.z = 0.35; g.add(hair);
  const bun = new THREE.Mesh(new THREE.SphereGeometry(0.075, 10, 8), mat(u.hair)); bun.position.set(-0.15, 1.7, 0); g.add(bun);
  if (u.hat) {
    const hat = new THREE.Mesh(new THREE.CylinderGeometry(0.12, 0.14, 0.1, 16), mat(u.jacket)); hat.position.set(0.02, 1.9, 0); hat.rotation.z = -0.15; g.add(hat);
    const band = new THREE.Mesh(new THREE.CylinderGeometry(0.142, 0.142, 0.03, 16), mat(u.scarf)); band.position.set(0.02, 1.87, 0); band.rotation.z = -0.15; g.add(band);
  }
  return g;
}

function makePassenger(p) {
  const g = new THREE.Group();
  const t = PAX_TYPES[p.type] || PAX_TYPES.normal;
  const small = p.type === 'child';
  const body = new THREE.Mesh(new THREE.CapsuleGeometry(small ? 0.13 : 0.17, small ? 0.25 : 0.4, 4, 10), new THREE.MeshLambertMaterial({ color: t.color }));
  body.position.y = small ? 0.35 : 0.45; g.add(body);
  const head = new THREE.Mesh(new THREE.SphereGeometry(small ? 0.11 : 0.13, 12, 10), new THREE.MeshLambertMaterial({ color: 0xe9c09a }));
  head.position.y = small ? 0.72 : 0.92; g.add(head);
  const ind = new THREE.Mesh(new THREE.SphereGeometry(0.05, 8, 6), new THREE.MeshBasicMaterial({ color: 0x45c46b }));
  ind.position.y = small ? 0.95 : 1.18; g.add(ind);
  g.userData.ind = ind;
  return g;
}
