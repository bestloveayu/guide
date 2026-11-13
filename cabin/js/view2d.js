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
    this.scale = Math.max(8, Math.min((r.width - 80) / (ac.length + 1), (r.height - 100) / (ac.width + 1.5)));
    this.ox = (r.width - ac.length * this.scale) / 2;
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
    const [, top] = this.w2s(0, ac.width / 2);
    if (py > top - 4 || py < top - 22) return null;
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
    ctx.clearRect(0, 0, r.width, r.height);
    const css = getComputedStyle(document.documentElement);
    ctx.fillStyle = css.getPropertyValue('--canvas-bg').trim() || '#11151d';
    ctx.fillRect(0, 0, r.width, r.height);
    if (!ac) return;
    const S = this.scale;

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

    // 機身外形
    const [x0, yTop] = this.w2s(0, ac.width / 2);
    const [x1, yBot] = this.w2s(ac.length, -ac.width / 2);
    ctx.save();
    ctx.beginPath();
    const nose = ac.width * S * 0.9;
    ctx.moveTo(x0 + nose * 0.2, yTop);
    ctx.lineTo(x1, yTop);
    ctx.quadraticCurveTo(x1 + ac.width * S * 0.9, (yTop + yBot) / 2, x1, yBot);
    ctx.lineTo(x0 + nose * 0.2, yBot);
    ctx.quadraticCurveTo(x0 - nose * 0.6, (yTop + yBot) / 2, x0 + nose * 0.2, yTop);
    ctx.fillStyle = u && u.src ? 'rgba(220,226,236,0.25)' : '#d9dee7';
    ctx.fill();
    ctx.lineWidth = 2; ctx.strokeStyle = '#7d8798'; ctx.stroke();
    ctx.restore();

    // 窗戶
    ctx.fillStyle = '#9ec8ec';
    for (let x = 3; x < ac.length - 1; x += 0.53) {
      const [wx] = this.w2s(x, 0);
      ctx.fillRect(wx, yTop - 3, Math.max(2, 0.2 * S), 3);
      ctx.fillRect(wx, yBot, Math.max(2, 0.2 * S), 3);
    }

    // 設施
    ac.fixtures.forEach((f) => {
      const [fx, fy] = this.w2s(f.x - f.w / 2, f.y + f.d / 2);
      ctx.fillStyle = (FIXTURE_TYPES[f.type] || {}).color || '#888';
      if (f.type === 'door') ctx.fillStyle = sim && sim.env.doorsOpen ? '#f0d36a' : '#c99a2e';
      ctx.fillRect(fx, fy, f.w * S, f.d * S);
      if (this.selFixture === f) { ctx.strokeStyle = '#ffdd57'; ctx.lineWidth = 3; ctx.strokeRect(fx - 1, fy - 1, f.w * S + 2, f.d * S + 2); }
      if (S > 14) {
        ctx.fillStyle = f.type === 'door' ? '#3a2a00' : '#fff';
        ctx.font = `${Math.max(9, Math.min(13, S * 0.28))}px system-ui, sans-serif`;
        ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
        const [cx, cy] = this.w2s(f.x, f.y);
        ctx.fillText(f.label || (FIXTURE_TYPES[f.type] || {}).name || f.type, cx, f.type === 'door' ? cy + (f.y < 0 ? 12 : -12) : cy);
      }
    });

    // 座位
    const paxBySeat = {};
    const sc = this.app.scenario();
    if (sc) sc.passengers.forEach((p) => { paxBySeat[p.seat] = p; });
    const activeTargets = new Map();
    if (sim) sim.activeTasks().forEach((t) => { if (t.def.target && t.def.target.seat) activeTargets.set(t.def.target.seat, t); });

    ac.seats.forEach((s) => {
      const [sx, sy] = this.w2s(s.x - s.d / 2, s.y + s.w / 2);
      const w = s.d * S, h = s.w * S;
      if (s.removed) {
        ctx.strokeStyle = 'rgba(160,160,160,0.6)'; ctx.setLineDash([3, 3]); ctx.lineWidth = 1;
        ctx.strokeRect(sx, sy, w, h); ctx.setLineDash([]);
      } else {
        ctx.fillStyle = (SEAT_CLASS[s.cls] || SEAT_CLASS.Y).color;
        roundRect(ctx, sx, sy, w, h, Math.min(4, w * 0.2)); ctx.fill();
        ctx.fillStyle = 'rgba(255,255,255,0.18)';
        ctx.fillRect(sx + w * 0.72, sy + 1, w * 0.22, h - 2); // 椅背（面向機頭→椅背在後方）
      }
      if (this.selSeats.has(s.id)) { ctx.strokeStyle = '#ffdd57'; ctx.lineWidth = 2.5; ctx.strokeRect(sx - 1, sy - 1, w + 2, h + 2); }
      const p = paxBySeat[s.id];
      if (p && !s.removed) {
        const [cx, cy] = this.w2s(s.x, s.y);
        const mood = sim ? sim.mood[s.id] ?? p.mood : p.mood;
        ctx.beginPath(); ctx.arc(cx, cy, Math.max(3, Math.min(w, h) * 0.32), 0, Math.PI * 2);
        ctx.fillStyle = (PAX_TYPES[p.type] || PAX_TYPES.normal).color; ctx.fill();
        ctx.lineWidth = 2; ctx.strokeStyle = mood >= 70 ? '#45c46b' : mood >= 40 ? '#f5c542' : '#e5484d'; ctx.stroke();
        if (S > 30 && p.type !== 'normal') {
          ctx.font = `${Math.min(14, S * 0.3)}px system-ui`; ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
          ctx.fillText((PAX_TYPES[p.type] || {}).icon || '', cx, cy);
        }
      }
      const at = activeTargets.get(s.id);
      if (at) {
        const [cx, cy] = this.w2s(s.x, s.y);
        const pulse = 0.5 + 0.5 * Math.sin(performance.now() / 200);
        ctx.beginPath(); ctx.arc(cx, cy, Math.max(8, S * 0.45) + pulse * 4, 0, Math.PI * 2);
        ctx.strokeStyle = PRIORITY[at.def.priority].color; ctx.lineWidth = 3; ctx.stroke();
      }
    });

    // 排號
    if (S > 10) {
      ctx.fillStyle = '#9aa5b8'; ctx.font = `${Math.max(9, Math.min(12, S * 0.3))}px system-ui`; ctx.textAlign = 'center'; ctx.textBaseline = 'alphabetic';
      rowsOf(ac).forEach((r) => {
        if (r.seats.every((s) => s.removed)) return;
        const [rx] = this.w2s(r.x, 0);
        if (S > 18 || r.row % 5 === 0 || r.row === 1) ctx.fillText(String(r.row), rx, yTop - 8);
      });
      // 座位字母
      if (S > 26) {
        const firstRow = rowsOf(ac)[0];
        if (firstRow) firstRow.seats.forEach((s) => { const [, ly] = this.w2s(0, s.y); ctx.fillText(s.letter, x0 - 10, ly + 4); });
      }
    }

    // 拖曳框
    const d = this.drag;
    if (d && (d.kind === 'box' || d.kind === 'region')) {
      const [a, b] = this.w2s(d.x0, d.y0), [c, e] = this.w2s(d.x1, d.y1);
      ctx.strokeStyle = d.kind === 'region' ? '#4ade80' : '#ffdd57'; ctx.setLineDash([6, 4]); ctx.lineWidth = 1.5;
      ctx.strokeRect(Math.min(a, c), Math.min(b, e), Math.abs(c - a), Math.abs(e - b)); ctx.setLineDash([]);
      if (d.kind === 'region') { ctx.fillStyle = 'rgba(74,222,128,0.12)'; ctx.fillRect(Math.min(a, c), Math.min(b, e), Math.abs(c - a), Math.abs(e - b)); }
    }

    // 比例尺
    ctx.fillStyle = '#9aa5b8'; ctx.strokeStyle = '#9aa5b8'; ctx.lineWidth = 2;
    ctx.beginPath(); ctx.moveTo(16, r.height - 18); ctx.lineTo(16 + S * 2, r.height - 18); ctx.stroke();
    ctx.textAlign = 'left'; ctx.font = '11px system-ui'; ctx.fillText('2 m', 20 + S * 2, r.height - 14);

    // 模擬中：角色與路徑
    if (sim) {
      const pl = sim.player;
      if (pl.path.length) {
        ctx.strokeStyle = 'rgba(255,221,87,0.7)'; ctx.setLineDash([4, 4]); ctx.lineWidth = 2; ctx.beginPath();
        let [px, py] = this.w2s(pl.x, pl.y); ctx.moveTo(px, py);
        pl.path.forEach((p) => { [px, py] = this.w2s(p.x, p.y); ctx.lineTo(px, py); }); ctx.stroke(); ctx.setLineDash([]);
      }
      sim.npcs.forEach((n) => this.drawPerson(n.x, n.y, n.color, n.name.replace(/^(學姊|座艙長)\s*/, '').slice(0, 4)));
      const uni = this.app.state.profile.uniform;
      this.drawPerson(pl.x, pl.y, uni.jacket, '我', uni.scarf, true);
    }
  }

  drawPerson(x, y, color, label, ring, me) {
    const ctx = this.ctx;
    const [px, py] = this.w2s(x, y);
    const rad = Math.max(5, this.scale * 0.22);
    ctx.beginPath(); ctx.arc(px, py, rad, 0, Math.PI * 2);
    ctx.fillStyle = color; ctx.fill();
    ctx.lineWidth = me ? 3 : 1.5; ctx.strokeStyle = ring || '#fff'; ctx.stroke();
    ctx.fillStyle = '#fff'; ctx.font = `bold ${Math.max(10, Math.min(13, this.scale * 0.28))}px system-ui`; ctx.textAlign = 'center';
    ctx.fillText(label, px, py - rad - 4);
  }
}

function roundRect(ctx, x, y, w, h, r) {
  ctx.beginPath();
  ctx.moveTo(x + r, y); ctx.lineTo(x + w - r, y); ctx.quadraticCurveTo(x + w, y, x + w, y + r);
  ctx.lineTo(x + w, y + h - r); ctx.quadraticCurveTo(x + w, y + h, x + w - r, y + h);
  ctx.lineTo(x + r, y + h); ctx.quadraticCurveTo(x, y + h, x, y + h - r);
  ctx.lineTo(x, y + r); ctx.quadraticCurveTo(x, y, x + r, y); ctx.closePath();
}
