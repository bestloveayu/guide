// 2D 平面圖：編輯器與模擬時的俯視圖
import { FIXTURE_TYPES, SEAT_CLASS, PAX_TYPES, PRIORITY } from './data.js';
import { rowsOf } from './layout.js';

export class View2D {
  constructor(canvas, app) {
    this.cv = canvas;
    this.ctx = canvas.getContext('2d');
    this.app = app;
    this.scale = 40; // px / m
    this.ox = 40; this.oy = 0;
    this.tool = 'select';
    this.selSeats = new Set();
    this.selFixture = null;
    this.drag = null;
    this.hover = null;
    this.underlayImg = null;
    this.underlaySrc = null;
    this.bind();
  }

  get ac() { return this.app.aircraft(); }
  w2s(x, y) { return [this.ox + x * this.scale, this.oy - y * this.scale]; } // 左舷(y<0)在畫面下方
  s2w(px, py) { return { x: (px - this.ox) / this.scale, y: -(py - this.oy) / this.scale }; }

  fit() {
    const r = this.cv.getBoundingClientRect();
    const ac = this.ac;
    if (!ac || !r.width) return;
    const RO = ac.width / 2 + 0.3, nose = RO * 2.1, tail = RO * 3.2;
    const total = ac.length + nose + tail;
    this.scale = Math.max(6, Math.min((r.width - 60) / total, (r.height - 140) / (ac.width + 1.5)));
    this.ox = (r.width - total * this.scale) / 2 + nose * this.scale;
    this.oy = r.height / 2;
  }

  resize() {
    const r = this.cv.getBoundingClientRect();
    const dpr = window.devicePixelRatio || 1;
    this.cv.width = Math.round(r.width * dpr);
    this.cv.height = Math.round(r.height * dpr);
    this.ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  }

  hitSeat(w) {
    return this.ac.seats.find((s) => Math.abs(w.x - s.x) <= s.d / 2 + 0.03 && Math.abs(w.y - s.y) <= s.w / 2 + 0.03);
  }
  hitFixture(w) {
    return [...this.ac.fixtures].reverse().find((f) => Math.abs(w.x - f.x) <= f.w / 2 && Math.abs(w.y - f.y) <= f.d / 2);
  }
  hitRowLabel(px, py) {
    const ac = this.ac;
    const [, top] = this.w2s(0, ac.width / 2 + 0.3);
    if (py > top - 4 || py < top - 24) return null;
    const w = this.s2w(px, py);
    const r = rowsOf(ac).find((r) => Math.abs(r.x - w.x) < (r.seats[0].pitch || 0.8) / 2);
    return r ? r.row : null;
  }

  bind() {
    const cv = this.cv;
    cv.addEventListener('contextmenu', (e) => e.preventDefault());
    cv.addEventListener('wheel', (e) => {
      e.preventDefault();
      const r = cv.getBoundingClientRect();
      const px = e.clientX - r.left, py = e.clientY - r.top;
      const w = this.s2w(px, py);
      const f = Math.exp(-e.deltaY * 0.0015);
      this.scale = Math.max(5, Math.min(220, this.scale * f));
      this.ox = px - w.x * this.scale;
      this.oy = py + w.y * this.scale;
    }, { passive: false });

    cv.addEventListener('pointerdown', (e) => {
      const r = cv.getBoundingClientRect();
      const px = e.clientX - r.left, py = e.clientY - r.top;
      const w = this.s2w(px, py);
      cv.setPointerCapture(e.pointerId);
      if (e.button === 1 || e.button === 2 || this.tool === 'pan') { this.drag = { kind: 'pan', px, py, ox: this.ox, oy: this.oy }; return; }
      if (this.app.mode === 'play') { this.app.onPlayClick(w); return; }
      if (this.tool === 'underlay' && this.ac.underlay) {
        this.drag = { kind: 'underlay', px, py, ux: this.ac.underlay.x, uy: this.ac.underlay.y }; return;
      }
      if (this.tool === 'region') { this.drag = { kind: 'region', x0: w.x, y0: w.y, x1: w.x, y1: w.y }; return; }
      if (this.tool === 'pax') {
        const s = this.hitSeat(w);
        if (s && !s.removed) this.app.editPassenger(s.id);
        return;
      }
      if (this.tool.startsWith('fx:')) {
        this.app.addFixture(this.tool.slice(3), w);
        return;
      }
      // select 工具
      const row = this.hitRowLabel(px, py);
      if (row != null) {
        const ids = this.ac.seats.filter((s) => s.row === row).map((s) => s.id);
        if (!e.shiftKey) this.selSeats.clear();
        ids.forEach((id) => this.selSeats.add(id));
        this.selFixture = null; this.app.onSelection(); return;
      }
      const s = this.hitSeat(w);
      if (s) {
        if (!e.shiftKey) this.selSeats.clear();
        this.selSeats.has(s.id) && e.shiftKey ? this.selSeats.delete(s.id) : this.selSeats.add(s.id);
        this.selFixture = null; this.app.onSelection(); return;
      }
      const f = this.hitFixture(w);
      if (f) {
        this.selSeats.clear(); this.selFixture = f;
        this.drag = { kind: 'fixture', f, dx: w.x - f.x, dy: w.y - f.y, moved: false };
        this.app.onSelection(); return;
      }
      if (!e.shiftKey) { this.selSeats.clear(); this.selFixture = null; }
      this.drag = { kind: 'box', x0: w.x, y0: w.y, x1: w.x, y1: w.y };
      this.app.onSelection();
    });

    cv.addEventListener('pointermove', (e) => {
      const r = cv.getBoundingClientRect();
      const px = e.clientX - r.left, py = e.clientY - r.top;
      const w = this.s2w(px, py);
      this.hover = w;
      const d = this.drag;
      if (!d) return;
      if (d.kind === 'pan') { this.ox = d.ox + (px - d.px); this.oy = d.oy + (py - d.py); }
      else if (d.kind === 'underlay') { this.ac.underlay.x = d.ux + (px - d.px) / this.scale; this.ac.underlay.y = d.uy - (py - d.py) / this.scale; }
      else if (d.kind === 'fixture') {
        const snap = (v) => Math.round(v * 20) / 20;
        d.f.x = snap(w.x - d.dx); d.f.y = snap(w.y - d.dy); d.moved = true;
      } else if (d.kind === 'box' || d.kind === 'region') { d.x1 = w.x; d.y1 = w.y; }
    });

    cv.addEventListener('pointerup', () => {
      const d = this.drag;
      this.drag = null;
      if (!d) return;
      if (d.kind === 'box') {
        const xa = Math.min(d.x0, d.x1), xb = Math.max(d.x0, d.x1), ya = Math.min(d.y0, d.y1), yb = Math.max(d.y0, d.y1);
        if (xb - xa > 0.1 || yb - ya > 0.1) {
          this.ac.seats.forEach((s) => { if (s.x >= xa && s.x <= xb && s.y >= ya && s.y <= yb) this.selSeats.add(s.id); });
          this.app.onSelection();
        }
      } else if (d.kind === 'region') {
        if (Math.abs(d.x1 - d.x0) > 0.3 && Math.abs(d.y1 - d.y0) > 0.3) this.app.onRegion({ x0: d.x0, y0: d.y0, x1: d.x1, y1: d.y1 });
      } else if (d.kind === 'fixture' && d.moved) this.app.changed('layout');
      else if (d.kind === 'underlay') this.app.changed();
    });
  }

  // ---- 繪製 ----
  draw(sim) {
    const ctx = this.ctx, ac = this.ac;
    const r = this.cv.getBoundingClientRect();
    const S = this.scale;
    ctx.clearRect(0, 0, r.width, r.height);
    // 背景：藍圖網格（每 1 m 細線、每 5 m 粗線）
    ctx.fillStyle = '#0e1626';
    ctx.fillRect(0, 0, r.width, r.height);
    if (S > 9) {
      const step = S;
      const x0 = ((this.ox % step) + step) % step, y0 = ((this.oy % step) + step) % step;
      ctx.lineWidth = 1;
      for (let x = x0, i = Math.round((x0 - this.ox) / step); x < r.width; x += step, i++) { ctx.strokeStyle = i % 5 ? 'rgba(90,120,170,0.07)' : 'rgba(90,120,170,0.16)'; ctx.beginPath(); ctx.moveTo(x + 0.5, 0); ctx.lineTo(x + 0.5, r.height); ctx.stroke(); }
      for (let y = y0, i = Math.round((y0 - this.oy) / step); y < r.height; y += step, i++) { ctx.strokeStyle = i % 5 ? 'rgba(90,120,170,0.07)' : 'rgba(90,120,170,0.16)'; ctx.beginPath(); ctx.moveTo(0, y + 0.5); ctx.lineTo(r.width, y + 0.5); ctx.stroke(); }
    }
    if (!ac) return;

    // 平面圖底圖
    const u = ac.underlay;
    if (u && u.src && !sim) {
      if (this.underlaySrc !== u.src) { this.underlayImg = new Image(); this.underlayImg.src = u.src; this.underlaySrc = u.src; }
      if (this.underlayImg.complete && this.underlayImg.naturalWidth) {
        const [ux, uy] = this.w2s(u.x, u.y);
        ctx.globalAlpha = u.opacity ?? 0.5;
        const wm = u.widthM || ac.length;
        const hm = wm * (this.underlayImg.naturalHeight / this.underlayImg.naturalWidth);
        ctx.drawImage(this.underlayImg, ux, uy, wm * S, hm * S);
        ctx.globalAlpha = 1;
      }
    }
    const tracing = u && u.src && !sim;

    // 機身外形（外殼比客艙寬 0.3 m）、機翼與尾翼
    const W = ac.width, L = ac.length, RO = W / 2 + 0.3;
    const [cx0, cyTop] = this.w2s(0, RO);
    const [cx1, cyBot] = this.w2s(L, -RO);
    const mid = (cyTop + cyBot) / 2, half = (cyBot - cyTop) / 2;
    const noseL = RO * 2.1 * S, tailL = RO * 3.2 * S;
    const span = Math.max(W * 3.2, 10) * S, chord = Math.max(4, L * 0.16) * S;
    const [wx] = this.w2s(L * 0.42, 0);
    ctx.save();
    ctx.globalAlpha = tracing ? 0.35 : 1;
    ctx.fillStyle = '#1b2842'; ctx.strokeStyle = '#33476d'; ctx.lineWidth = 1.5;
    for (const s of [-1, 1]) { // 主翼
      ctx.beginPath();
      ctx.moveTo(wx, mid + s * half * 0.6); ctx.lineTo(wx + chord, mid + s * half * 0.6);
      ctx.lineTo(wx + chord + span * 0.55, mid + s * (half + span)); ctx.lineTo(wx + chord * 0.35 + span * 0.55, mid + s * (half + span));
      ctx.closePath(); ctx.fill(); ctx.stroke();
      // 引擎
      const ex = wx + chord * 0.15 + span * 0.12, ez = mid + s * (half + span * 0.28 * (S ? 1 : 0));
      ctx.fillStyle = '#24355a'; ctx.beginPath(); ctx.roundRect(ex - chord * 0.375, ez - RO * 0.38 * S, chord * 0.75, RO * 0.76 * S, RO * 0.3 * S); ctx.fill(); ctx.stroke();
      ctx.fillStyle = '#1b2842';
      // 水平尾翼
      const tx = cx1 + tailL * 0.25;
      ctx.beginPath();
      ctx.moveTo(tx, mid + s * half * 0.3); ctx.lineTo(tx + tailL * 0.55, mid + s * half * 0.3);
      ctx.lineTo(tx + tailL * 0.7, mid + s * (half * 0.3 + RO * 2.4 * S)); ctx.lineTo(tx + tailL * 0.5, mid + s * (half * 0.3 + RO * 2.4 * S));
      ctx.closePath(); ctx.fill(); ctx.stroke();
    }
    // 機身
    ctx.shadowColor = 'rgba(0,0,0,0.45)'; ctx.shadowBlur = 18; ctx.shadowOffsetY = 6;
    ctx.beginPath();
    ctx.moveTo(cx0, cyTop);
    ctx.lineTo(cx1, cyTop);
    ctx.bezierCurveTo(cx1 + tailL * 0.6, cyTop + half * 0.15, cx1 + tailL, mid - half * 0.25, cx1 + tailL, mid);
    ctx.bezierCurveTo(cx1 + tailL, mid + half * 0.25, cx1 + tailL * 0.6, cyBot - half * 0.15, cx1, cyBot);
    ctx.lineTo(cx0, cyBot);
    ctx.bezierCurveTo(cx0 - noseL * 0.55, cyBot, cx0 - noseL, mid + half * 0.45, cx0 - noseL, mid);
    ctx.bezierCurveTo(cx0 - noseL, mid - half * 0.45, cx0 - noseL * 0.55, cyTop, cx0, cyTop);
    ctx.closePath();
    ctx.fillStyle = '#d7dde7'; ctx.fill();
    ctx.shadowColor = 'transparent';
    ctx.lineWidth = 2; ctx.strokeStyle = '#8994a8'; ctx.stroke();
    // 客艙地板
    const [fx0, fyTop] = this.w2s(0, W / 2), [fx1, fyBot] = this.w2s(L, -W / 2);
    ctx.fillStyle = '#c6cedb'; ctx.fillRect(fx0, fyTop, fx1 - fx0, fyBot - fyTop);
    // 駕駛艙風擋
    ctx.fillStyle = '#3d5a85';
    ctx.beginPath(); ctx.moveTo(cx0 - noseL * 0.62, mid - half * 0.42); ctx.quadraticCurveTo(cx0 - noseL * 0.8, mid, cx0 - noseL * 0.62, mid + half * 0.42);
    ctx.lineTo(cx0 - noseL * 0.5, mid + half * 0.5); ctx.quadraticCurveTo(cx0 - noseL * 0.66, mid, cx0 - noseL * 0.5, mid - half * 0.5); ctx.closePath(); ctx.fill();
    ctx.restore();

    // 窗戶
    ctx.fillStyle = '#5aa7e6';
    for (let x = 3.2; x < L - 1.6; x += 0.53) {
      if (ac.fixtures.some((f) => f.type === 'door' && Math.abs(f.x - x) < f.w / 2 + 0.2)) continue;
      const [wxp] = this.w2s(x, 0);
      const ww = Math.max(2, 0.22 * S);
      ctx.fillRect(wxp - ww / 2, fyTop - Math.max(2, 0.12 * S), ww, Math.max(2, 0.08 * S));
      ctx.fillRect(wxp - ww / 2, fyBot + Math.max(2, 0.04 * S), ww, Math.max(2, 0.08 * S));
    }

    // 設施
    ac.fixtures.forEach((f) => this.drawFixture(f, sim));

    // 座位
    const paxBySeat = {};
    const sc = this.app.scenario();
    if (sc) sc.passengers.forEach((p) => { paxBySeat[p.seat] = p; });
    const activeTargets = new Map();
    if (sim) sim.activeTasks().forEach((t) => { if (t.def.target && t.def.target.seat) activeTargets.set(t.def.target.seat, t); });
    const showDetail = S > 22;
    ac.seats.forEach((s) => {
      const [sx, sy] = this.w2s(s.x - s.d / 2, s.y + s.w / 2);
      const w = s.d * S, h = s.w * S;
      const base = (SEAT_CLASS[s.cls] || SEAT_CLASS.Y).color;
      if (s.removed) {
        ctx.strokeStyle = 'rgba(120,130,150,0.7)'; ctx.setLineDash([3, 3]); ctx.lineWidth = 1;
        roundRect(ctx, sx + 1, sy + 1, w - 2, h - 2, Math.min(4, w * 0.2)); ctx.stroke(); ctx.setLineDash([]);
      } else {
        // 座墊
        ctx.fillStyle = base;
        roundRect(ctx, sx, sy + h * 0.06, w * 0.8, h * 0.88, Math.min(5, w * 0.25)); ctx.fill();
        // 椅背（面向機頭→椅背在機尾側）
        ctx.fillStyle = shade(base, 0.72);
        roundRect(ctx, sx + w * 0.68, sy, w * 0.32, h, Math.min(4, w * 0.15)); ctx.fill();
        if (showDetail) {
          ctx.fillStyle = 'rgba(236,230,216,0.85)';
          ctx.fillRect(sx + w * 0.76, sy + h * 0.22, w * 0.16, h * 0.56); // 頭枕套
          ctx.fillStyle = 'rgba(255,255,255,0.12)';
          ctx.fillRect(sx + w * 0.06, sy + h * 0.14, w * 0.5, Math.max(1, h * 0.1));
        }
      }
      if (this.selSeats.has(s.id)) { ctx.strokeStyle = '#f2b45a'; ctx.lineWidth = 2.5; roundRect(ctx, sx - 2, sy - 2, w + 4, h + 4, 5); ctx.stroke(); }
      const p = paxBySeat[s.id];
      if (p && !s.removed && (!sim || !sim.isSeated || sim.isSeated(s.id))) this.drawPassenger(s, p, sim);
      if (sim && sim.calls && sim.calls[s.id]) { const [cx, cy] = this.w2s(s.x, s.y); const pulse = 0.5 + 0.5 * Math.sin(performance.now() / 180); ctx.fillStyle = `rgba(90,167,230,${0.25 + 0.35 * pulse})`; ctx.beginPath(); ctx.arc(cx, cy, Math.max(10, S * 0.55), 0, Math.PI * 2); ctx.fill(); ctx.font = `${Math.max(12, S * 0.32)}px system-ui`; ctx.textAlign = 'center'; ctx.textBaseline = 'middle'; ctx.fillText('🔔', cx, cy - Math.max(14, S * 0.6)); }
      const at = activeTargets.get(s.id);
      if (at) {
        const [cx, cy] = this.w2s(s.x, s.y);
        const pulse = 0.5 + 0.5 * Math.sin(performance.now() / 200);
        ctx.beginPath(); ctx.arc(cx, cy, Math.max(9, S * 0.5) + pulse * 4, 0, Math.PI * 2);
        ctx.strokeStyle = PRIORITY[at.def.priority].color; ctx.lineWidth = 3; ctx.stroke();
        ctx.fillStyle = PRIORITY[at.def.priority].color;
        ctx.beginPath(); ctx.arc(cx + Math.max(9, S * 0.5) * 0.7, cy - Math.max(9, S * 0.5) * 0.7, Math.max(4, S * 0.12), 0, Math.PI * 2); ctx.fill();
      }
    });

    // 排號（膠囊標籤）與座位字母
    if (S > 10) {
      ctx.font = `600 ${Math.max(9, Math.min(12, S * 0.28))}px "JetBrains Mono", ui-monospace, monospace`;
      ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
      rowsOf(ac).forEach((rw) => {
        if (rw.seats.every((s) => s.removed)) return;
        if (!(S > 18 || rw.row % 5 === 0 || rw.row === 1)) return;
        const [rx] = this.w2s(rw.x, 0);
        const ly = cyTop - 14;
        const tw = ctx.measureText(String(rw.row)).width + 10;
        ctx.fillStyle = rw.seats.every((s) => this.selSeats.has(s.id)) ? '#f2b45a' : 'rgba(30,43,69,0.9)';
        roundRect(ctx, rx - tw / 2, ly - 8, tw, 16, 8); ctx.fill();
        ctx.fillStyle = rw.seats.every((s) => this.selSeats.has(s.id)) ? '#1f1404' : '#c5cfe2';
        ctx.fillText(String(rw.row), rx, ly + 0.5);
      });
      if (S > 26) {
        const firstRow = rowsOf(ac).find((rw) => rw.seats.length);
        if (firstRow) {
          ctx.fillStyle = '#7f8aa3';
          const [lx] = this.w2s(-RO * 2.1 - 0.4, 0);
          firstRow.seats.forEach((s) => { const [, ly] = this.w2s(0, s.y); ctx.fillText(s.letter, lx, ly); });
        }
      }
    }

    // 拖曳框
    const d = this.drag;
    if (d && (d.kind === 'box' || d.kind === 'region')) {
      const [a, b] = this.w2s(d.x0, d.y0), [c, e] = this.w2s(d.x1, d.y1);
      ctx.strokeStyle = d.kind === 'region' ? '#4cc38a' : '#f2b45a'; ctx.setLineDash([6, 4]); ctx.lineWidth = 1.5;
      ctx.strokeRect(Math.min(a, c), Math.min(b, e), Math.abs(c - a), Math.abs(e - b)); ctx.setLineDash([]);
      ctx.fillStyle = d.kind === 'region' ? 'rgba(76,195,138,0.12)' : 'rgba(242,180,90,0.08)';
      ctx.fillRect(Math.min(a, c), Math.min(b, e), Math.abs(c - a), Math.abs(e - b));
    }

    // 比例尺
    ctx.strokeStyle = '#8e9ab3'; ctx.lineWidth = 2;
    const sbY = r.height - 18;
    ctx.beginPath(); ctx.moveTo(16, sbY - 4); ctx.lineTo(16, sbY); ctx.lineTo(16 + S * 2, sbY); ctx.lineTo(16 + S * 2, sbY - 4); ctx.stroke();
    ctx.fillStyle = '#8e9ab3'; ctx.textAlign = 'left'; ctx.textBaseline = 'alphabetic'; ctx.font = '11px "JetBrains Mono", monospace'; ctx.fillText('2 m', 22 + S * 2, sbY + 3);

    // 模擬中：路徑、組員、玩家
    if (sim) {
      const pl = sim.player;
      if (pl.path.length) {
        ctx.strokeStyle = 'rgba(242,180,90,0.85)'; ctx.setLineDash([5, 5]); ctx.lineWidth = 2; ctx.beginPath();
        let [px, py] = this.w2s(pl.x, pl.y); ctx.moveTo(px, py);
        pl.path.forEach((p) => { [px, py] = this.w2s(p.x, p.y); ctx.lineTo(px, py); }); ctx.stroke(); ctx.setLineDash([]);
        const last = pl.path[pl.path.length - 1]; const [lx, ly] = this.w2s(last.x, last.y);
        ctx.fillStyle = '#f2b45a'; ctx.beginPath(); ctx.arc(lx, ly, 4, 0, Math.PI * 2); ctx.fill();
      }
      if (sim.boarding) for (const [seat, b] of Object.entries(sim.boarding)) {
        if (!['walk', 'stow', 'sit'].includes(b.state)) continue;
        const [bx, by] = this.w2s(b.x, b.y), rr = Math.max(4, S * 0.18);
        ctx.fillStyle = '#9fb7d3'; ctx.beginPath(); ctx.arc(bx, by, rr, 0, Math.PI * 2); ctx.fill();
        if (b.bag && b.state === 'walk') { const [qx, qy] = this.w2s(b.x - Math.cos(b.heading) * 0.42, b.y - Math.sin(b.heading) * 0.42); ctx.fillStyle = b.col; ctx.fillRect(qx - rr * 0.6, qy - rr * 0.6, rr * 1.2, rr * 1.2); }
      }
      (sim.spills || []).forEach((sp) => { const [qx, qy] = this.w2s(sp.x, sp.y); ctx.fillStyle = 'rgba(120,70,30,0.7)'; ctx.beginPath(); ctx.arc(qx, qy, Math.max(5, S * 0.2), 0, Math.PI * 2); ctx.fill(); });
      sim.npcs.forEach((n) => this.drawPerson(n.x, n.y, n.heading, n.color, n.name.replace(/^(學姊|座艙長)\s*/, '').slice(0, 4)));
      const uni = this.app.state.profile.uniform;
      this.drawPerson(pl.x, pl.y, pl.heading, uni.jacket, '我', uni.scarf, true);
    }
  }

  drawFixture(f, sim) {
    const ctx = this.ctx, S = this.scale;
    const [fx, fy] = this.w2s(f.x - f.w / 2, f.y + f.d / 2);
    const w = f.w * S, h = f.d * S;
    const [cx, cy] = this.w2s(f.x, f.y);
    const sel = this.selFixture === f;
    const t = f.type;
    if (t === 'door') {
      const open = sim && sim.env.doorsOpen;
      ctx.fillStyle = open ? '#f2b45a' : '#c9862c';
      roundRect(ctx, fx, fy, w, h, 2); ctx.fill();
      // 門的開啟弧線
      const inward = f.y < 0 ? -1 : 1; // 螢幕上：左舷在下方，門朝內 = 往上
      const hy = f.y < 0 ? fy : fy + h;
      ctx.strokeStyle = 'rgba(242,180,90,0.55)'; ctx.lineWidth = 1; ctx.setLineDash([3, 3]);
      ctx.beginPath(); ctx.arc(fx, hy, w, inward < 0 ? -Math.PI / 2 : 0, inward < 0 ? 0 : Math.PI / 2); ctx.stroke(); ctx.setLineDash([]);
    } else if (t === 'cockpit') {
      ctx.fillStyle = '#2b3a58'; roundRect(ctx, fx, fy, w, h, 4); ctx.fill();
      ctx.fillStyle = '#3d4f74';
      for (const s of [-1, 1]) { roundRect(ctx, cx - w * 0.15, cy + s * h * 0.2 - h * 0.1, w * 0.3, h * 0.2, 3); ctx.fill(); }
    } else {
      const col = { galley: '#9aa6ba', lav: '#7f97c2', jumpseat: '#d06a55', closet: '#a69e8a', bulkhead: '#5d6578' }[t] || '#8a94a6';
      ctx.fillStyle = col; roundRect(ctx, fx, fy, w, h, Math.min(5, w * 0.15)); ctx.fill();
      ctx.strokeStyle = 'rgba(255,255,255,0.25)'; ctx.lineWidth = 1;
      if (t === 'galley' && S > 14) { // 餐車格
        const n = Math.max(1, Math.round(Math.max(w, h) / (0.35 * S)));
        for (let i = 1; i < n; i++) { ctx.beginPath(); if (w > h) { ctx.moveTo(fx + (w * i) / n, fy + 3); ctx.lineTo(fx + (w * i) / n, fy + h - 3); } else { ctx.moveTo(fx + 3, fy + (h * i) / n); ctx.lineTo(fx + w - 3, fy + (h * i) / n); } ctx.stroke(); }
      }
    }
    if (sel) { ctx.strokeStyle = '#f2b45a'; ctx.lineWidth = 2.5; roundRect(ctx, fx - 2, fy - 2, w + 4, h + 4, 5); ctx.stroke(); }
    if (S > 14) {
      const icon = { galley: '☕', lav: 'WC', jumpseat: '◆', closet: '▤', door: '', cockpit: '✈' }[t];
      const label = f.label || (FIXTURE_TYPES[t] || {}).name || t;
      ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
      if (t === 'door') {
        ctx.font = `700 ${Math.max(9, Math.min(12, S * 0.26))}px "JetBrains Mono", monospace`;
        ctx.fillStyle = '#f2b45a';
        ctx.fillText(label, cx, f.y < 0 ? fy + h + 10 : fy - 9);
      } else {
        const fs = Math.max(9, Math.min(12, S * 0.24));
        ctx.font = `600 ${fs}px "Noto Sans TC", system-ui, sans-serif`;
        ctx.fillStyle = t === 'jumpseat' ? '#fff' : '#0e1626';
        if (h > fs * 2.4 && w > fs * 2) {
          if (icon) { ctx.font = `700 ${fs * 1.1}px system-ui`; ctx.fillText(icon, cx, cy - fs * 0.6); ctx.font = `600 ${fs}px "Noto Sans TC", system-ui`; }
          ctx.fillText(label, cx, cy + (icon ? fs * 0.7 : 0));
        } else if (t !== 'jumpseat') ctx.fillText(icon && w < fs * 3 ? icon : label, cx, cy);
      }
    }
  }

  drawPassenger(s, p, sim) {
    const ctx = this.ctx, S = this.scale;
    const [cx, cy] = this.w2s(s.x - s.d * 0.05, s.y);
    const rad = Math.max(3, Math.min(s.w, s.d) * S * 0.3);
    const hsh = [...(p.seat + p.name)].reduce((a, c) => (a * 31 + c.charCodeAt(0)) >>> 0, 0);
    const shirts = ['#c96b4b', '#4f7cac', '#7a9e7e', '#d4a34a', '#8a6fb3', '#d98aa0', '#5c6b7a', '#e0d6c2', '#3f8f8a', '#b5543f'];
    const hairs = ['#1f1611', '#3b2a1e', '#6b4a2f', '#a07a4a', '#2a2a2a'];
    const r2 = p.type === 'child' ? rad * 0.75 : rad;
    // 肩膀
    ctx.fillStyle = shirts[hsh % shirts.length];
    ctx.beginPath(); ctx.ellipse(cx + r2 * 0.35, cy, r2 * 0.75, r2 * 1.35, 0, 0, Math.PI * 2); ctx.fill();
    // 頭（俯視：頭髮）
    ctx.fillStyle = p.type === 'elder' ? '#d6d3cc' : hairs[(hsh >>> 7) % hairs.length];
    ctx.beginPath(); ctx.arc(cx + r2 * 0.2, cy, r2 * 0.72, 0, Math.PI * 2); ctx.fill();
    const mood = sim ? sim.mood[s.id] ?? p.mood : p.mood;
    if (sim && mood < 70) {
      ctx.strokeStyle = mood >= 40 ? '#f5c542' : '#ec5d5d'; ctx.lineWidth = 2;
      ctx.beginPath(); ctx.arc(cx + r2 * 0.2, cy, r2 * 1.2, 0, Math.PI * 2); ctx.stroke();
    }
    if (p.type !== 'normal' && S > 24) {
      const t = PAX_TYPES[p.type] || {};
      const bx = cx - s.d * S * 0.32, by = cy - s.w * S * 0.3, br = Math.max(6, S * 0.13);
      ctx.fillStyle = 'rgba(255,255,255,0.95)'; ctx.beginPath(); ctx.arc(bx, by, br, 0, Math.PI * 2); ctx.fill();
      ctx.font = `${br * 1.25}px system-ui`; ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
      ctx.fillText(t.icon || '', bx, by + 1);
    }
  }

  drawPerson(x, y, heading, color, label, ring, me) {
    const ctx = this.ctx, S = this.scale;
    const [px, py] = this.w2s(x, y);
    const rad = Math.max(6, S * 0.23);
    const hd = heading ?? Math.PI;
    const dx = Math.cos(hd), dy = -Math.sin(hd); // 螢幕座標（y 向下）
    // 陰影
    ctx.fillStyle = 'rgba(0,0,0,0.25)'; ctx.beginPath(); ctx.ellipse(px + 2, py + 3, rad * 1.1, rad * 1.1, 0, 0, Math.PI * 2); ctx.fill();
    // 身體（肩寬垂直於面向）
    ctx.save(); ctx.translate(px, py); ctx.rotate(Math.atan2(dy, dx));
    ctx.fillStyle = color; ctx.beginPath(); ctx.ellipse(0, 0, rad * 0.7, rad * 1.15, 0, 0, Math.PI * 2); ctx.fill();
    ctx.fillStyle = ring || '#ffffff'; ctx.fillRect(rad * 0.25, -rad * 0.22, rad * 0.35, rad * 0.44);
    ctx.fillStyle = '#2b1b12'; ctx.beginPath(); ctx.arc(0, 0, rad * 0.55, 0, Math.PI * 2); ctx.fill();
    // 面向箭頭
    ctx.fillStyle = me ? '#f2b45a' : 'rgba(255,255,255,0.8)';
    ctx.beginPath(); ctx.moveTo(rad * 1.55, 0); ctx.lineTo(rad * 1.05, -rad * 0.35); ctx.lineTo(rad * 1.05, rad * 0.35); ctx.closePath(); ctx.fill();
    ctx.restore();
    if (me) { ctx.strokeStyle = '#f2b45a'; ctx.lineWidth = 2; ctx.beginPath(); ctx.arc(px, py, rad * 1.45, 0, Math.PI * 2); ctx.stroke(); }
    // 名牌
    ctx.font = `600 ${Math.max(10, Math.min(12, S * 0.26))}px "Noto Sans TC", system-ui, sans-serif`;
    const tw = ctx.measureText(label).width + 12;
    ctx.fillStyle = me ? '#f2b45a' : 'rgba(14,22,38,0.88)';
    roundRect(ctx, px - tw / 2, py - rad * 1.5 - 20, tw, 17, 8.5); ctx.fill();
    ctx.fillStyle = me ? '#1f1404' : '#fff'; ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
    ctx.fillText(label, px, py - rad * 1.5 - 11.5);
  }
}

function shade(hex, k) {
  const n = parseInt(hex.slice(1), 16);
  const c = (v) => Math.max(0, Math.min(255, Math.round(v * k)));
  return `rgb(${c(n >> 16)},${c((n >> 8) & 255)},${c(n & 255)})`;
}

function roundRect(ctx, x, y, w, h, r) {
  r = Math.max(0, Math.min(r, w / 2, h / 2));
  ctx.beginPath();
  ctx.moveTo(x + r, y); ctx.lineTo(x + w - r, y); ctx.quadraticCurveTo(x + w, y, x + w, y + r);
  ctx.lineTo(x + w, y + h - r); ctx.quadraticCurveTo(x + w, y + h, x + w - r, y + h);
  ctx.lineTo(x + r, y + h); ctx.quadraticCurveTo(x, y + h, x, y + h - r);
  ctx.lineTo(x, y + r); ctx.quadraticCurveTo(x, y, x + r, y); ctx.closePath();
}
