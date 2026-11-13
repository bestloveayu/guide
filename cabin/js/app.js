// 主程式：狀態、介面面板、模式切換、模擬流程
import { PHASES, RANKS, rankOf, PRIORITY, PAX_TYPES, FIXTURE_TYPES, SEAT_CLASS, AIRLINES, AIRCRAFT_SPECS, ANNOUNCEMENTS, phaseName, defaultScenario } from './data.js';
import { buildTemplate, buildFromSpec, findSeat, rowsOf, removeRows, insertRowAfter, generateInRect, newId, buildGrid, walkable, approachPoint, findFixture, slideMove, findPath } from './layout.js';
import { load, save, download, readFile, resetAll } from './store.js';
import { View2D } from './view2d.js';
import { View3D } from './view3d.js';
import { Flight, announcementFor } from './sim.js';
import { speechSupported, startRecognition, scoreAnnouncement, speak, scoreLocal, testEndpoint } from './speech.js';

// ---- 小型 DOM 工具 ----
const $ = (s) => document.querySelector(s);
function h(tag, attrs = {}, ...kids) {
  const el = document.createElement(tag);
  for (const [k, v] of Object.entries(attrs || {})) {
    if (v == null || v === false) continue;
    if (k.startsWith('on')) el.addEventListener(k.slice(2), v);
    else if (k === 'class') el.className = v;
    else if (k === 'style') el.style.cssText = v;
    else if (k === 'html') el.innerHTML = v;
    else if (k in el && k !== 'list') { try { el[k] = v; } catch (e) { el.setAttribute(k, v); } }
    else el.setAttribute(k, v);
  }
  kids.flat(Infinity).forEach((c) => { if (c != null && c !== false) el.append(c.nodeType ? c : document.createTextNode(c)); });
  return el;
}
const field = (label, input) => h('div', {}, h('label', {}, label), input);
const esc = (s) => String(s ?? '').replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
const fmtT = (s) => `${Math.floor(Math.max(0, s) / 60)}:${String(Math.floor(Math.max(0, s) % 60)).padStart(2, '0')}`;

class App {
  constructor() {
    this.state = load();
    this.mode = 'edit';
    this.view = '2d';
    this.tab = 'aircraft';
    this.sim = null;
    this.selPax = null;
    this.selTask = null;
    this.walker = null; // 編輯模式的第一人稱漫遊者
    this.v2 = new View2D($('#cv2d'), this);
    this.v3 = new View3D($('#three'), this);
    this.bindTop();
    window.addEventListener('resize', () => this.resize());
    this.resize();
    this.v2.fit();
    this.v3.focusCabin();
    this.setView('2d');
    this.renderPanel();
    this.renderProfile();
    let last = performance.now();
    const loop = (now) => {
      const dt = Math.min(0.1, (now - last) / 1000); last = now;
      this.frame(dt);
      requestAnimationFrame(loop);
    };
    requestAnimationFrame(loop);
  }

  // ---- 存取 ----
  aircraft() { return this.state.aircraft.find((a) => a.id === this.state.currentAircraft) || this.state.aircraft[0]; }
  scenario() { return this.state.scenarios.find((s) => s.id === this.state.currentScenario) || this.state.scenarios[0]; }
  changed(kind) {
    if (kind === 'layout') { this.walker = null; const ac = this.aircraft(); if (ac) ac.edited = true; }
    save(this.state);
    if (kind === 'panel') this.renderPanel();
  }

  resize() { this.v2.resize(); this.v3.resize(); }

  onQualityAuto(q) {
    this.state.settings.quality = q; save(this.state);
    this.toast('系統', '畫面較不流暢，已自動改為中畫質（可在「設定」調整）。', 'warn');
  }

  // ---- 上方列 ----
  bindTop() {
    $('#modeSeg').addEventListener('click', (e) => { const m = e.target.closest('button')?.dataset.mode; if (!m || m === this.mode) return; m === 'play' ? this.briefing() : this.exitPlay(); });
    $('#viewSeg').addEventListener('click', (e) => { const v = e.target.closest('button')?.dataset.view; if (v) this.setView(v); });
    $('#tabs').addEventListener('click', (e) => { const t = e.target.closest('button')?.dataset.tab; if (t) { this.tab = t; this.renderPanel(); } });
    $('#profileChip').addEventListener('click', () => { if (this.mode === 'edit') { this.tab = 'career'; this.renderPanel(); } });
    $('#btnPause').addEventListener('click', () => this.togglePause());
    $('#speedSel').addEventListener('change', (e) => { if (this.sim) this.sim.timeScale = +e.target.value; });
    $('#btnEnd').addEventListener('click', async () => { if (this.sim && await this.ask('確定要提前結束航班嗎？未完成任務將視為失敗。')) this.sim.finish(); });
    window.addEventListener('keydown', (e) => {
      if (/INPUT|TEXTAREA|SELECT/.test(document.activeElement.tagName)) return;
      if (this.sim && !this.sim.ended) {
        if (e.code === 'KeyE' && !this.sim.modalOpen) { const a = this.sim.availableActions()[0]; if (a) a.run(); }
        if (e.code === 'KeyP') this.togglePause();
        if (this.sim.modalOpen && /^Digit[1-9]$/.test(e.code)) { const b = document.querySelectorAll('.opt')[+e.code.slice(5) - 1]; if (b) b.click(); }
      }
      if (this.mode === 'edit' && this.view === '2d' && (e.code === 'Delete' || e.code === 'Backspace')) this.removeSelectedSeats();
    });
  }

  setView(v) {
    this.view = v;
    document.querySelectorAll('#viewSeg button').forEach((b) => b.classList.toggle('on', b.dataset.view === v));
    $('#cv2d').style.display = v === '2d' ? 'block' : 'none';
    $('#three').style.display = v === '2d' ? 'none' : 'block';
    this.v3.setMode(v === 'fp' ? 'fp' : 'orbit');
    if (v === 'fp' && this.mode === 'edit' && !this.walker) this.makeWalker();
    this.resize();
    this.renderToolbar();
    this.updateHint();
  }

  makeWalker() {
    const ac = this.aircraft();
    const grid = buildGrid(ac);
    const door = findFixture(ac, 'L1') || findFixture(ac, 'door');
    let p = door ? approachPoint(ac, grid, door) : { x: ac.length / 2, y: 0 };
    if (door && walkable(grid, door.x, 0)) p = { x: door.x, y: 0 };
    this.walker = { x: p.x, y: p.y, heading: Math.PI, path: [], grid };
  }

  updateHint() {
    const map = {
      '2d': this.mode === 'play' ? '點擊地板或座位移動角色｜滾輪縮放、右鍵拖曳平移｜E 互動｜P 暫停' : '點選座位、Shift 多選、拖曳框選；點排號選整排｜滾輪縮放、右鍵拖曳平移｜Delete 移除座位',
      orbit: this.mode === 'play' ? '左鍵拖曳旋轉、右鍵/Shift 拖曳平移、滾輪縮放｜點人物對話、點地板移動｜E 互動' : '左鍵拖曳旋轉、右鍵/Shift 拖曳平移、滾輪縮放',
      fp: '按住左鍵拖曳轉動視角｜點人物對話、點地板走過去｜WASD 移動、Shift 快走｜E 互動',
    };
    $('#hint').textContent = map[this.view];
  }

  renderToolbar() {
    const tb = $('#toolbar');
    tb.innerHTML = '';
    if (this.view === '2d') tb.append(h('button', { onclick: () => this.v2.fit(), title: '縮放至全機' }, '⤢ 全機'));
    else if (this.view === 'orbit') tb.append(h('button', { onclick: () => this.v3.focusCabin() }, '⤢ 全機'));
    if (this.mode === 'play' && this.view === 'orbit') tb.append(h('button', { onclick: () => { this.v3.orbit.manual = false; this.v3.orbit.dist = 7; } }, '🎯 跟隨角色'));
  }

  renderProfile() {
    const p = this.state.profile, r = rankOf(p.xp);
    const next = RANKS[r + 1];
    const pct = next ? ((p.xp - RANKS[r].xp) / (next.xp - RANKS[r].xp)) * 100 : 100;
    $('#profileChip').innerHTML = `<span>🧑‍✈️ ${esc(p.name)}・<b>${RANKS[r].name}</b></span><span class="bar"><i style="width:${pct}%"></i></span><span class="muted">${p.xp}${next ? '/' + next.xp : ''} XP</span>`;
  }

  // ---- 每幀 ----
  frame(dt) {
    const sim = this.sim;
    if (sim && !sim.ended) {
      const mv = this.v3.fpMove(dt);
      if (mv) sim.moveManual(mv.dx, mv.dy);
      sim.update(dt);
      // 點選旅客後自動走過去，抵達時開始互動
      const pt = this.pendingTask;
      if (pt && !sim.player.path.length) { this.pendingTask = null; if (pt.status === 'active' && sim.inRange(pt) && !sim.modalOpen) sim.interact(pt); }
      this.updateHud(dt);
    } else if (this.walker && this.view === 'fp') {
      const mv = this.v3.fpMove(dt);
      if (mv) {
        this.walker.path = [];
        slideMove(this.walker.grid, this.walker, mv.dx, mv.dy);
        this.walker.heading = Math.atan2(mv.dy, mv.dx);
      }
    }
    if (!sim && this.walker && this.walker.path && this.walker.path.length) {
      const w = this.walker; let mv = 1.6 * dt;
      while (mv > 0 && w.path.length) { const t = w.path[0], dx = t.x - w.x, dy = t.y - w.y, d = Math.hypot(dx, dy); if (d < 1e-3) { w.path.shift(); continue; } w.heading = Math.atan2(dy, dx); if (d <= mv) { w.x = t.x; w.y = t.y; w.path.shift(); mv -= d; } else { w.x += dx / d * mv; w.y += dy / d * mv; mv = 0; } }
    }
    const walker = sim ? sim.player : (this.view === 'fp' || this.tab === 'crew') ? this.walker : null;
    if (this.view === '2d') this.v2.draw(sim);
    else this.v3.render(sim, walker, dt);
  }

  // =================== 編輯器面板 ===================
  renderPanel() {
    document.querySelectorAll('#tabs button').forEach((b) => b.classList.toggle('on', b.dataset.tab === this.tab));
    const body = $('#panelBody');
    body.innerHTML = '';
    const fn = { aircraft: this.panelAircraft, pax: this.panelPax, tasks: this.panelTasks, story: this.panelStory, crew: this.panelCrew, career: this.panelCareer, settings: this.panelSettings }[this.tab];
    body.append(fn.call(this));
  }

  panelAircraft() {
    const ac = this.aircraft();
    const st = this.state;
    const wrap = h('div');
    const seats = ac.seats.filter((s) => !s.removed);
    const byCls = {};
    seats.forEach((s) => { byCls[s.cls] = (byCls[s.cls] || 0) + 1; });

    const sel = h('select', { onchange: (e) => { st.currentAircraft = e.target.value; this.afterAircraftSwitch(); } },
      st.aircraft.map((a) => h('option', { value: a.id, selected: a.id === ac.id }, a.name)));
    const tplSel = h('select', {}, AIRCRAFT_SPECS.map((s) => h('option', { value: s.id }, s.name)));
    wrap.append(
      h('h3', {}, '機型庫 ', h('small', {}, '可建立多個機艙並隨時切換')),
      field('目前編輯的機艙', sel),
      field('名稱', h('input', { value: ac.name, onchange: (e) => { ac.name = e.target.value; this.changed('panel'); } })),
      h('div', { class: 'stat' },
        h('div', {}, h('b', {}, seats.length), '座位'),
        h('div', {}, h('b', {}, rowsOf(ac).filter((r) => r.seats.some((s) => !s.removed)).length), '排'),
        h('div', {}, h('b', {}, ac.length.toFixed(1) + 'm'), '客艙長')),
      h('p', { class: 'muted' }, Object.entries(byCls).map(([k, v]) => `${SEAT_CLASS[k]?.name || k} ${v}`).join('・')),
      h('div', { class: 'row' }, tplSel, h('button', { onclick: () => { const a = buildTemplate(tplSel.value); st.aircraft.push(a); st.currentAircraft = a.id; this.afterAircraftSwitch(); } }, '＋ 由範本新增')),
      h('div', { class: 'btns' },
        h('button', { onclick: () => { const a = JSON.parse(JSON.stringify(ac)); a.id = newId('ac'); a.name += '（複本）'; st.aircraft.push(a); st.currentAircraft = a.id; this.afterAircraftSwitch(); } }, '複製'),
        h('button', { onclick: async () => { if (st.aircraft.length > 1 && await this.ask(`刪除「${ac.name}」？`)) { st.aircraft = st.aircraft.filter((a) => a !== ac); st.currentAircraft = st.aircraft[0].id; this.afterAircraftSwitch(); } } }, '刪除'),
        h('button', { onclick: () => download(`${ac.name}.aircraft.json`, ac) }, '匯出 JSON'),
        h('label', { class: 'filebtn', style: 'display:inline-block;margin:0' }, h('span', { class: 'btnlike', style: 'border:1px solid var(--line);border-radius:6px;padding:5px 10px;cursor:pointer;display:inline-block;color:var(--text)' }, '匯入 JSON'),
          h('input', { type: 'file', accept: '.json,application/json', style: 'display:none', onchange: (e) => this.importAircraft(e.target.files[0]) }))),
    );

    // 工具
    const tools = [['select', '↖ 選取'], ['pan', '✋ 平移'], ['pax', '🧍 放置旅客'], ['region', '▭ 框選產生座位'], ['underlay', '🖼 移動底圖']];
    const fxSel = h('select', { onchange: (e) => { this.v2.tool = 'fx:' + e.target.value; this.renderPanel(); } }, h('option', { value: '' }, '＋ 放置設施…'),
      Object.entries(FIXTURE_TYPES).map(([k, v]) => h('option', { value: k, selected: this.v2.tool === 'fx:' + k }, v.name)));
    wrap.append(h('h3', {}, '編輯工具 ', h('small', {}, '於「平面圖」視角操作')),
      h('div', { class: 'tool-grid' }, tools.map(([k, n]) => h('button', { class: this.v2.tool === k ? 'on' : '', onclick: () => { this.v2.tool = k; if (this.view !== '2d') this.setView('2d'); this.renderPanel(); } }, n))),
      h('div', { style: 'margin-top:6px' }, fxSel));

    // 選取內容
    const selSeats = [...this.v2.selSeats].map((id) => ac.seats.find((s) => s.id === id)).filter(Boolean);
    const box = h('div', { class: 'card' });
    if (selSeats.length) {
      const rows = [...new Set(selSeats.map((s) => s.row))].sort((a, b) => a - b);
      const clsSel = h('select', { onchange: (e) => { selSeats.forEach((s) => { s.cls = e.target.value; }); this.changed('panel'); } },
        h('option', { value: '' }, '變更艙等…'), Object.entries(SEAT_CLASS).map(([k, v]) => h('option', { value: k }, v.name)));
      box.append(h('b', {}, `已選 ${selSeats.length} 個座位`), h('div', { class: 'muted' }, `排：${rows.join(', ')}`),
        h('div', { class: 'btns' },
          h('button', { onclick: () => this.removeSelectedSeats() }, '移除座位'),
          h('button', { onclick: () => { selSeats.forEach((s) => { s.removed = false; }); this.changed('layout'); this.renderPanel(); } }, '復原座位'),
          h('button', { onclick: async () => { if (await this.ask(`刪除第 ${rows.join(', ')} 排（含排號）？`)) { removeRows(ac, rows); this.v2.selSeats.clear(); this.changed('layout'); this.renderPanel(); } } }, '刪除整排'),
          h('button', { onclick: () => { const nr = insertRowAfter(ac, rows[rows.length - 1]); this.toast('編輯器', nr ? `已在第 ${rows[rows.length - 1]} 排後插入第 ${nr} 排，後方排號與設施已順移。` : '插入失敗'); this.changed('layout'); this.renderPanel(); } }, '後方插入一排')),
        clsSel);
    } else if (this.v2.selFixture) {
      const f = this.v2.selFixture;
      box.append(h('b', {}, `設施：${FIXTURE_TYPES[f.type]?.name || f.type}`),
        field('標籤（任務以此辨識，例如 L1、前廚房）', h('input', { value: f.label, onchange: (e) => { f.label = e.target.value; this.changed(); } })),
        h('div', { class: 'row' },
          field('長 (m)', h('input', { type: 'number', step: 0.1, value: f.w, onchange: (e) => { f.w = +e.target.value; this.changed('layout'); } })),
          field('寬 (m)', h('input', { type: 'number', step: 0.1, value: f.d, onchange: (e) => { f.d = +e.target.value; this.changed('layout'); } }))),
        h('div', { class: 'btns' }, h('button', { class: 'danger', onclick: () => { ac.fixtures = ac.fixtures.filter((x) => x !== f); this.v2.selFixture = null; this.changed('layout'); this.renderPanel(); } }, '刪除設施')));
    } else box.append(h('span', { class: 'muted' }, '點選座位、排號或設施以編輯。拖曳設施可移動位置。'));
    wrap.append(h('h3', {}, '選取內容'), box);

    // 平面圖匯入
    const u = ac.underlay;
    wrap.append(h('h3', {}, '匯入機型平面圖 ', h('small', {}, '描圖產生座位與動線')),
      h('p', { class: 'muted' }, '1. 匯入平面圖圖片作為底圖並調整比例；2. 用「框選產生座位」框出每個艙等區塊，輸入排數與座位配置（如 ABC-DEF），系統會自動排出座位並計算走道；3. 再細部移除或插入座位排。'),
      h('label', {}, h('span', { style: 'border:1px solid var(--line);border-radius:6px;padding:5px 10px;cursor:pointer;display:inline-block;color:var(--text)' }, '🖼 選擇平面圖圖片'),
        h('input', { type: 'file', accept: 'image/*', style: 'display:none', onchange: (e) => this.importUnderlay(e.target.files[0]) })),
      h('div', { class: 'btns' }, h('button', { onclick: () => this.newBlankAircraft() }, '＋ 建立空白機艙（搭配平面圖描圖）')));
    if (u) {
      wrap.append(
        h('div', { class: 'row' },
          field('底圖寬度 (m)', h('input', { type: 'number', step: 0.5, value: u.widthM, onchange: (e) => { u.widthM = +e.target.value; this.changed(); } })),
          field('透明度', h('input', { type: 'range', min: 0.1, max: 1, step: 0.05, value: u.opacity, oninput: (e) => { u.opacity = +e.target.value; this.changed(); } }))),
        h('div', { class: 'btns' }, h('button', { onclick: () => { ac.underlay = null; this.changed('panel'); } }, '移除底圖')));
    }
    wrap.append(h('h3', {}, '客艙尺寸'), h('div', { class: 'row' },
      field('長度 (m)', h('input', { type: 'number', step: 0.5, value: +ac.length.toFixed(2), onchange: (e) => { ac.length = +e.target.value; this.changed('layout'); } })),
      field('寬度 (m)', h('input', { type: 'number', step: 0.1, value: ac.width, onchange: (e) => { ac.width = +e.target.value; this.changed('layout'); } }))));
    return wrap;
  }

  afterAircraftSwitch() {
    this.v2.selSeats.clear(); this.v2.selFixture = null; this.walker = null;
    const sc = this.scenario();
    if (sc) sc.aircraftId = this.state.currentAircraft;
    this.changed('panel'); this.v2.fit(); this.v3.focusCabin();
  }

  removeSelectedSeats() {
    const ac = this.aircraft();
    if (!this.v2.selSeats.size) return;
    ac.seats.forEach((s) => { if (this.v2.selSeats.has(s.id)) s.removed = true; });
    this.changed('layout'); this.renderPanel();
  }

  addFixture(type, w) {
    const ac = this.aircraft();
    const sz = { door: [0.9, 0.25], galley: [1.2, 0.9], lav: [0.9, 0.9], jumpseat: [0.5, 0.5], closet: [0.8, 0.6], bulkhead: [0.1, 1.2], cockpit: [2, ac.width] }[type] || [1, 1];
    const f = { id: newId('fx'), type, label: FIXTURE_TYPES[type].name, x: Math.round(w.x * 20) / 20, y: Math.round(w.y * 20) / 20, w: sz[0], d: sz[1] };
    ac.fixtures.push(f);
    this.v2.selFixture = f; this.v2.selSeats.clear(); this.v2.tool = 'select';
    this.changed('layout'); this.renderPanel();
  }

  onSelection() { if (this.mode === 'edit' && this.tab === 'aircraft') this.renderPanel(); }

  onRegion(rect) {
    const ac = this.aircraft();
    const pattern = h('input', { value: 'ABC-DEF' });
    const from = h('input', { type: 'number', value: 10 }), to = h('input', { type: 'number', value: 20 });
    const skip = h('input', { placeholder: '例如 13' });
    const cls = h('select', {}, Object.entries(SEAT_CLASS).map(([k, v]) => h('option', { value: k, selected: k === 'Y' }, v.name)));
    this.openModal(h('div', {},
      h('h2', {}, '在框選區域產生座位'),
      h('p', { class: 'muted' }, `區域：${Math.abs(rect.x1 - rect.x0).toFixed(1)}m × ${Math.abs(rect.y1 - rect.y0).toFixed(1)}m。用「-」表示走道，例如 AC-DF、ABC-DEF、ABC-DEFG-HJK。`),
      field('座位配置', pattern), h('div', { class: 'row' }, field('起始排號', from), field('結束排號', to)), field('略過排號（逗號分隔）', skip), field('艙等', cls),
      h('div', { class: 'btns', style: 'justify-content:flex-end;margin-top:14px' },
        h('button', { onclick: () => this.closeModal() }, '取消'),
        h('button', { class: 'primary', onclick: () => {
          const n = generateInRect(ac, rect, { pattern: pattern.value, from: +from.value, to: +to.value, cls: cls.value, skip: skip.value.split(/[,，\s]+/).filter(Boolean).map(Number) });
          this.closeModal(); this.toast('編輯器', `已產生 ${n} 個座位。`); this.changed('layout'); this.renderPanel();
        } }, '產生'))));
  }

  async importUnderlay(file) {
    if (!file) return;
    const src = await readFile(file, true);
    const ac = this.aircraft();
    ac.underlay = { src, x: 0, y: ac.width / 2 + 1, widthM: Math.max(ac.length, 10), opacity: 0.5 };
    this.v2.tool = 'underlay';
    this.setView('2d');
    this.toast('編輯器', '底圖已匯入：用「移動底圖」工具拖曳對齊，調整寬度讓比例尺吻合，再用「框選產生座位」描出座位區。');
    this.changed('panel');
  }

  async newBlankAircraft() {
    const len = +await this.askValue('客艙長度（公尺），可之後再調整', '40');
    if (!len) return;
    const wid = +await this.askValue('客艙寬度（公尺）：單走道約 3.7、雙走道約 5.5', '3.7') || 3.7;
    const ac = { id: newId('ac'), name: '自訂機艙', width: wid, length: len, seats: [], fixtures: [
      { id: newId('fx'), type: 'cockpit', label: '駕駛艙', x: 1, y: 0, w: 2, d: wid },
      { id: newId('fx'), type: 'door', label: 'L1', x: 2.8, y: -wid / 2 + 0.12, w: 0.9, d: 0.25 },
      { id: newId('fx'), type: 'galley', label: '前廚房', x: 3, y: wid / 2 - 0.45, w: 1.2, d: 0.9 },
      { id: newId('fx'), type: 'jumpseat', label: '組員座', x: 3.8, y: -wid / 2 + 0.25, w: 0.5, d: 0.5 },
    ], underlay: null };
    this.state.aircraft.push(ac);
    this.state.currentAircraft = ac.id;
    this.afterAircraftSwitch();
  }

  async importAircraft(file) {
    if (!file) return;
    try {
      const j = JSON.parse(await readFile(file));
      let ac;
      if (j.segments) ac = buildFromSpec(j); // 規格格式
      else if (j.seats && j.fixtures) ac = j;
      else throw new Error('格式不符：需要 seats/fixtures 或 segments 欄位');
      ac.id = newId('ac');
      this.state.aircraft.push(ac);
      this.state.currentAircraft = ac.id;
      this.afterAircraftSwitch();
      this.toast('編輯器', `已匯入「${ac.name}」`);
    } catch (e) { this.toast('系統', '匯入失敗：' + e.message, 'bad'); }
  }

  // ---- 旅客 ----
  panelPax() {
    const sc = this.scenario(), ac = this.aircraft();
    const wrap = h('div');
    const valid = sc.passengers.filter((p) => findSeat(ac, p.seat));
    wrap.append(h('h3', {}, `旅客名單（${valid.length}）`, h('small', {}, `・劇本「${sc.title}」`)),
      h('p', { class: 'muted' }, '選擇「放置旅客」工具後點座位即可新增/編輯旅客。任務可指定座位上的旅客作為對象。'),
      h('div', { class: 'btns' },
        h('button', { onclick: () => { this.v2.tool = 'pax'; this.setView('2d'); this.toast('編輯器', '點擊座位以放置旅客'); } }, '🧍 放置旅客工具'),
        h('button', { onclick: () => this.fillPassengers() }, '隨機填滿'),
        h('button', { class: 'danger', onclick: async () => { if (await this.ask('清空全部旅客？')) { sc.passengers = []; this.changed('panel'); } } }, '清空')));
    if (this.selPax) {
      const p = sc.passengers.find((x) => x.seat === this.selPax);
      if (p) {
        wrap.append(h('div', { class: 'card' },
          h('b', {}, `座位 ${p.seat}`),
          field('稱呼', h('input', { value: p.name, onchange: (e) => { p.name = e.target.value; this.changed('panel'); } })),
          field('類型', h('select', { onchange: (e) => { p.type = e.target.value; this.changed('panel'); } }, Object.entries(PAX_TYPES).map(([k, v]) => h('option', { value: k, selected: p.type === k }, `${v.icon} ${v.name}`)))),
          field(`初始心情：${p.mood}`, h('input', { type: 'range', min: 0, max: 100, value: p.mood, onchange: (e) => { p.mood = +e.target.value; this.changed('panel'); } })),
          field('備註（劇情設定）', h('textarea', { value: p.note || '', onchange: (e) => { p.note = e.target.value; this.changed(); } })),
          h('div', { class: 'btns' },
            h('button', { onclick: () => this.newTaskFor(p.seat) }, '＋ 為此旅客新增任務'),
            h('button', { class: 'danger', onclick: () => { sc.passengers = sc.passengers.filter((x) => x !== p); this.selPax = null; this.changed('panel'); } }, '移除旅客'))));
      }
    }
    const list = h('div');
    valid.sort((a, b) => parseInt(a.seat) - parseInt(b.seat)).forEach((p) => {
      const t = PAX_TYPES[p.type] || PAX_TYPES.normal;
      list.append(h('div', { class: 'list-item' + (this.selPax === p.seat ? ' on' : ''), onclick: () => { this.selPax = p.seat; this.v2.selSeats = new Set([p.seat]); this.renderPanel(); } },
        h('span', {}, t.icon), h('b', { style: 'width:40px' }, p.seat), h('span', {}, p.name), h('span', { class: 'muted', style: 'margin-left:auto' }, t.name)));
    });
    const orphan = sc.passengers.length - valid.length;
    if (orphan) wrap.append(h('p', { class: 'muted' }, `⚠ 有 ${orphan} 位旅客的座位在此機艙不存在（切換機型或移除座位所致），模擬時會略過。`));
    wrap.append(list);
    return wrap;
  }

  editPassenger(seatId) {
    const sc = this.scenario();
    let p = sc.passengers.find((x) => x.seat === seatId);
    if (!p) { p = { seat: seatId, type: 'normal', name: '旅客', mood: 70, note: '' }; sc.passengers.push(p); this.changed(); }
    this.selPax = seatId;
    this.tab = 'pax';
    this.v2.selSeats = new Set([seatId]);
    this.renderPanel();
  }

  async fillPassengers() {
    const pct = +await this.askValue('載客率（%）', '80');
    if (!pct) return;
    const sc = this.scenario(), ac = this.aircraft();
    const taken = new Set(sc.passengers.map((p) => p.seat));
    const free = ac.seats.filter((s) => !s.removed && !taken.has(s.id));
    const want = Math.round(ac.seats.filter((s) => !s.removed).length * pct / 100) - taken.size;
    free.sort(() => Math.random() - 0.5).slice(0, Math.max(0, want)).forEach((s) => {
      const r = Math.random();
      const type = r < 0.82 ? 'normal' : r < 0.86 ? 'child' : r < 0.9 ? 'elder' : r < 0.93 ? 'meal' : r < 0.96 ? 'anxious' : 'vip';
      sc.passengers.push({ seat: s.id, type, name: '旅客', mood: 60 + Math.round(Math.random() * 30), note: '' });
    });
    this.changed('panel');
  }

  // ---- 任務 ----
  panelTasks() {
    const sc = this.scenario();
    const wrap = h('div');
    wrap.append(h('h3', {}, `任務與事件（${sc.tasks.length}）`),
      h('p', { class: 'muted' }, '每個任務有觸發階段與時間、優先順序、時間限制、對象（座位/設施）與回應選項。職級限制讓不同職級看到不同任務。'),
      h('div', { class: 'btns' }, h('button', { class: 'primary', onclick: () => this.newTaskFor(null) }, '＋ 新增任務'),
        h('button', { onclick: async () => { if (await this.ask('恢復成預設任務？')) { sc.tasks = defaultScenario().tasks; this.selTask = null; this.changed('panel'); } } }, '恢復預設')));
    if (this.selTask) {
      const t = sc.tasks.find((x) => x.id === this.selTask);
      if (t) wrap.append(this.taskForm(t));
    }
    PHASES.forEach((ph) => {
      const ts = sc.tasks.filter((t) => t.phase === ph.id).sort((a, b) => a.at - b.at);
      if (!ts.length) return;
      wrap.append(h('div', { class: 'muted', style: 'margin-top:10px' }, `■ ${ph.name}`));
      ts.forEach((t) => wrap.append(h('div', { class: 'list-item' + (this.selTask === t.id ? ' on' : ''), onclick: () => { this.selTask = t.id; this.renderPanel(); } },
        h('span', { class: 'pill', style: `background:${PRIORITY[t.priority].color}` }, PRIORITY[t.priority].name),
        h('span', {}, t.title),
        h('span', { class: 'muted', style: 'margin-left:auto;white-space:nowrap' }, (t.minRank ? `${RANKS[t.minRank].name.slice(0, 2)}+ ` : '') + `${t.at}s`))));
    });
    return wrap;
  }

  newTaskFor(seat) {
    const sc = this.scenario();
    const t = {
      id: newId('T'), title: seat ? `${seat} 旅客需求` : '新任務', kind: seat ? 'talk' : 'goto', phase: 'cruise', at: 30, priority: 3, limit: 60, xp: 15, minRank: 0,
      target: seat ? { seat } : { fixture: 'galley' }, prompt: '（旅客的話）', options: [{ text: '得體的回應', score: 100, reply: '旅客很滿意。', mood: 10 }, { text: '不恰當的回應', score: 20, reply: '旅客不太高興。', mood: -10 }],
    };
    sc.tasks.push(t);
    this.selTask = t.id; this.tab = 'tasks';
    this.changed('panel');
  }

  taskForm(t) {
    const sc = this.scenario();
    const up = (k, conv = (v) => v, rerender = false) => (e) => { t[k] = conv(e.target.value); this.changed(rerender ? 'panel' : undefined); };
    const card = h('div', { class: 'card' });
    const kinds = { talk: '對話（旅客/組員）', goto: '前往定點操作', walk: '客艙巡查', announce: '廣播', seated: '回組員座椅就座', manage: '組員管理（座艙長）' };
    card.append(
      field('任務名稱', h('input', { value: t.title, onchange: up('title', String, true) })),
      h('div', { class: 'row' },
        field('類型', h('select', { onchange: up('kind', String, true) }, Object.entries(kinds).map(([k, v]) => h('option', { value: k, selected: t.kind === k }, v)))),
        field('觸發階段', h('select', { onchange: up('phase', String, true) }, PHASES.map((p) => h('option', { value: p.id, selected: t.phase === p.id }, p.name))))),
      h('div', { class: 'row' },
        field('觸發秒數', h('input', { type: 'number', value: t.at, onchange: up('at', Number, true) })),
        field('時間限制(秒)', h('input', { type: 'number', value: t.limit, onchange: up('limit', Number) })),
        field('經驗值', h('input', { type: 'number', value: t.xp, onchange: up('xp', Number) }))),
      h('div', { class: 'row' },
        field('優先順序', h('select', { onchange: up('priority', Number, true) }, Object.entries(PRIORITY).map(([k, v]) => h('option', { value: k, selected: +k === t.priority }, `${k} ${v.name}`)))),
        field('最低職級', h('select', { onchange: up('minRank', Number, true) }, RANKS.map((r, i) => h('option', { value: i, selected: (t.minRank || 0) === i }, r.name))))),
    );
    if (['talk', 'goto', 'seated'].includes(t.kind)) {
      t.target = t.target || {};
      const isSeat = !!t.target.seat;
      const typeSel = h('select', { onchange: (e) => { t.target = e.target.value === 'seat' ? { seat: '' } : { fixture: 'galley' }; this.changed('panel'); } },
        h('option', { value: 'seat', selected: isSeat }, '座位（旅客）'), h('option', { value: 'fixture', selected: !isSeat }, '設施'));
      const fixtureKeys = [...new Set(this.aircraft().fixtures.map((f) => f.label).filter(Boolean)), ...Object.keys(FIXTURE_TYPES)];
      const val = isSeat
        ? h('input', { value: t.target.seat, placeholder: '例如 12C', onchange: (e) => { t.target.seat = e.target.value.toUpperCase(); this.changed(); } })
        : h('select', { onchange: (e) => { t.target.fixture = e.target.value; this.changed(); } }, fixtureKeys.map((k) => h('option', { value: k, selected: t.target.fixture === k }, FIXTURE_TYPES[k] ? `任一${FIXTURE_TYPES[k].name}` : k)));
      card.append(h('div', { class: 'row' }, field('對象類型', typeSel), field('對象', val)));
    }
    card.append(field('任務說明', h('textarea', { value: t.desc || '', onchange: up('desc') })));
    if (t.kind === 'talk') {
      card.append(field('對方台詞（劇情）', h('textarea', { value: t.prompt || '', onchange: up('prompt') })));
      t.options = t.options || [];
      card.append(h('label', {}, '回應選項（分數 0-100、心情變化）'));
      t.options.forEach((o, i) => card.append(h('div', { class: 'card', style: 'background:#121a2a' },
        h('input', { value: o.text, placeholder: '選項文字', onchange: (e) => { o.text = e.target.value; this.changed(); } }),
        h('div', { class: 'row', style: 'margin-top:4px' },
          h('input', { type: 'number', value: o.score, title: '分數', onchange: (e) => { o.score = +e.target.value; this.changed(); } }),
          h('input', { type: 'number', value: o.mood || 0, title: '心情變化', onchange: (e) => { o.mood = +e.target.value; this.changed(); } }),
          h('button', { onclick: () => { t.options.splice(i, 1); this.changed('panel'); } }, '✕')),
        h('input', { value: o.reply || '', placeholder: '選擇後的反應', style: 'margin-top:4px', onchange: (e) => { o.reply = e.target.value; this.changed(); } }))));
      card.append(h('button', { onclick: () => { t.options.push({ text: '新選項', score: 50, reply: '', mood: 0 }); this.changed('panel'); } }, '＋ 選項'));
    }
    if (t.kind === 'announce') {
      const custom = !ANNOUNCEMENTS[t.announce];
      card.append(h('div', { class: 'row' },
        field('廣播詞', h('select', { onchange: (e) => { t.announce = e.target.value; this.changed('panel'); } },
          Object.entries(ANNOUNCEMENTS).map(([k, v]) => h('option', { value: k, selected: t.announce === k }, v.title)), h('option', { value: 'custom', selected: custom }, '自訂…'))),
        field('評分者', h('select', { onchange: up('judge') }, h('option', { value: 'senior', selected: t.judge !== 'purser' }, '學姊'), h('option', { value: 'purser', selected: t.judge === 'purser' }, '座艙長')))));
      if (custom) card.append(
        field('標準廣播詞', h('textarea', { value: t.script || '', onchange: up('script') })),
        field('關鍵詞（逗號分隔）', h('input', { value: (t.keywords || []).join(','), onchange: (e) => { t.keywords = e.target.value.split(/[,，]/).map((s) => s.trim()).filter(Boolean); this.changed(); } })));
      else card.append(h('div', { class: 'script', style: 'font-size:12px' }, ANNOUNCEMENTS[t.announce].script));
    }
    card.append(h('div', { class: 'btns', style: 'margin-top:8px' },
      h('button', { onclick: () => { const c = JSON.parse(JSON.stringify(t)); c.id = newId('T'); c.title += '（複本）'; sc.tasks.push(c); this.selTask = c.id; this.changed('panel'); } }, '複製'),
      h('button', { class: 'danger', onclick: () => { sc.tasks = sc.tasks.filter((x) => x !== t); this.selTask = null; this.changed('panel'); } }, '刪除任務'),
      h('button', { onclick: () => { this.selTask = null; this.renderPanel(); } }, '收合')));
    return card;
  }

  // ---- 劇情 ----
  panelStory() {
    const st = this.state, sc = this.scenario();
    const up = (k, conv = String) => (e) => { sc[k] = conv(e.target.value); this.changed(); };
    const wrap = h('div');
    wrap.append(h('h3', {}, '劇本'),
      field('目前劇本', h('select', { onchange: (e) => { st.currentScenario = e.target.value; const s = this.scenario(); if (st.aircraft.some((a) => a.id === s.aircraftId)) st.currentAircraft = s.aircraftId; this.afterAircraftSwitch(); } },
        st.scenarios.map((s) => h('option', { value: s.id, selected: s.id === sc.id }, s.title)))),
      h('div', { class: 'btns' },
        h('button', { onclick: () => { const s = defaultScenario(this.aircraft().id); s.title = '新劇本'; s.passengers = []; s.tasks = s.tasks.filter((t) => t.kind !== 'talk'); st.scenarios.push(s); st.currentScenario = s.id; this.changed('panel'); } }, '＋ 新劇本（僅標準流程）'),
        h('button', { onclick: () => { const s = JSON.parse(JSON.stringify(sc)); s.id = newId('sc'); s.title += '（複本）'; st.scenarios.push(s); st.currentScenario = s.id; this.changed('panel'); } }, '複製'),
        h('button', { class: 'danger', onclick: async () => { if (st.scenarios.length > 1 && await this.ask('刪除此劇本？')) { st.scenarios = st.scenarios.filter((s) => s !== sc); st.currentScenario = st.scenarios[0].id; this.changed('panel'); } } }, '刪除'),
        h('button', { onclick: () => download(`${sc.title}.scenario.json`, sc) }, '匯出'),
        h('label', { style: 'margin:0' }, h('span', { style: 'border:1px solid var(--line);border-radius:6px;padding:5px 10px;cursor:pointer;display:inline-block;color:var(--text)' }, '匯入'),
          h('input', { type: 'file', accept: '.json', style: 'display:none', onchange: async (e) => { try { const s = JSON.parse(await readFile(e.target.files[0])); if (!s.tasks) throw new Error('缺少 tasks'); s.id = newId('sc'); st.scenarios.push(s); st.currentScenario = s.id; this.changed('panel'); } catch (er) { this.toast('系統', '匯入失敗：' + er.message, 'bad'); } } }))),
      field('劇本名稱', h('input', { value: sc.title, onchange: (e) => { sc.title = e.target.value; this.changed('panel'); } })),
      h('div', { class: 'row' }, field('航班編號', h('input', { value: sc.flightNo, onchange: up('flightNo') })), field('航線', h('input', { value: sc.route, onchange: up('route') }))),
      field('使用機艙', h('select', { onchange: (e) => { sc.aircraftId = e.target.value; st.currentAircraft = e.target.value; this.afterAircraftSwitch(); } }, st.aircraft.map((a) => h('option', { value: a.id, selected: a.id === sc.aircraftId }, a.name)))),
      field('開場劇情', h('textarea', { value: sc.intro, rows: 5, onchange: up('intro') })),
      h('h3', {}, '劇中人物'),
      h('div', { class: 'row' }, field('學姊', h('input', { value: sc.npc.senior, onchange: (e) => { sc.npc.senior = e.target.value; this.changed(); } })), field('座艙長', h('input', { value: sc.npc.purser, onchange: (e) => { sc.npc.purser = e.target.value; this.changed(); } }))),
      field('客艙督導（座艙長職級時的考核者）', h('input', { value: sc.npc.inspector || '', onchange: (e) => { sc.npc.inspector = e.target.value; this.changed(); } })),
      field('時間倍率（越大航班越快）', h('select', { onchange: up('timeScale', Number) }, [0.5, 1, 1.5, 2].map((v) => h('option', { value: v, selected: (sc.timeScale || 1) === v }, v + '×')))),
      h('h3', {}, '飛行階段'),
      h('div', { class: 'muted' }, PHASES.map((p) => `${p.name} ${p.dur}s`).join(' → ')));
    return wrap;
  }

  // ---- 角色（制服） ----
  panelCrew() {
    const p = this.state.profile, u = p.uniform;
    const up = (k) => (e) => { u[k] = e.target.type === 'checkbox' ? e.target.checked : e.target.value; this.changed(); };
    const wrap = h('div');
    wrap.append(h('h3', {}, '空服員角色'),
      field('姓名', h('input', { value: p.name, onchange: (e) => { p.name = e.target.value; this.changed(); this.renderProfile(); } })),
      field('航空公司', h('input', { value: p.airline, onchange: (e) => { p.airline = e.target.value; this.changed(); } })),
      h('label', {}, '制服預設樣式'),
      h('div', { class: 'btns' }, AIRLINES.map((a) => h('button', { style: `border-left:6px solid ${a.accent}`, onclick: () => { p.airline = a.name; Object.assign(u, { jacket: a.jacket, bottom: a.jacket, scarf: a.accent }); this.changed('panel'); } }, a.name))),
      h('div', { class: 'row' }, field('外套', h('input', { type: 'color', value: u.jacket, oninput: up('jacket') })), field('裙/褲', h('input', { type: 'color', value: u.bottom, oninput: up('bottom') })), field('絲巾/領帶', h('input', { type: 'color', value: u.scarf, oninput: up('scarf') }))),
      h('div', { class: 'row' }, field('襯衫', h('input', { type: 'color', value: u.shirt, oninput: up('shirt') })), field('髮色', h('input', { type: 'color', value: u.hair, oninput: up('hair') })), field('膚色', h('input', { type: 'color', value: u.skin, oninput: up('skin') }))),
      h('div', { class: 'row' },
        field('下身', h('select', { onchange: up('bottomType') }, h('option', { value: 'skirt', selected: u.bottomType === 'skirt' }, '窄裙'), h('option', { value: 'pants', selected: u.bottomType === 'pants' }, '長褲'))),
        field('帽子', h('label', { style: 'color:var(--text)' }, h('input', { type: 'checkbox', checked: u.hat, onchange: up('hat') }), ' 配戴'))),
      h('div', { class: 'btns', style: 'margin-top:10px' }, h('button', { class: 'primary', onclick: () => this.previewCrew() }, '在 3D 中預覽')),
      h('p', { class: 'muted' }, '制服顏色也會套用到機身塗裝條紋。'));
    return wrap;
  }

  previewCrew() {
    this.makeWalker();
    this.setView('orbit');
    const w = this.walker;
    this.v3.orbit.target.set(w.x, 1, -w.y);
    this.v3.orbit.dist = 4.2; this.v3.orbit.pitch = 0.42; this.v3.orbit.yaw = -2.6; this.v3.orbit.manual = true;
    this.previewing = true;
  }

  // ---- 生涯 ----
  panelCareer() {
    const p = this.state.profile, r = rankOf(p.xp);
    const next = RANKS[r + 1];
    const wrap = h('div');
    wrap.append(h('h3', {}, '職級與經驗值'),
      h('div', { class: 'stat' }, h('div', {}, h('b', {}, RANKS[r].name), '目前職級'), h('div', {}, h('b', {}, p.xp), 'XP'), h('div', {}, h('b', {}, p.flights), '飛行次數')),
      h('p', {}, next ? `距離晉升「${next.name}」還需 ${next.xp - p.xp} XP。` : '你已達到最高職級！'),
      h('ul', { class: 'ranks' }, RANKS.map((k, i) => h('li', { class: i === r ? 'cur' : '' }, `${i <= r ? '✔' : '○'} ${k.name}（${k.xp} XP）— ${k.desc}`))),
      h('p', { class: 'muted' }, '每完成一次航班依任務品質、旅客滿意度、優先順序判斷與安全表現獲得經驗值。晉升後會解鎖新的任務（例如安全示範廣播、亂流廣播、醫療事件；座艙長可分派組員、調解組員衝突、向機長報告）。'),
      h('div', { class: 'btns' },
        h('button', { onclick: async () => { const v = await this.askValue('設定經驗值（測試用）', p.xp); if (v != null && !isNaN(+v)) { p.xp = Math.max(0, +v); this.changed('panel'); this.renderProfile(); } } }, '調整 XP（測試）'),
        h('button', { class: 'danger', onclick: async () => { if (await this.ask('重設生涯紀錄？')) { p.xp = 0; p.flights = 0; p.history = []; this.changed('panel'); this.renderProfile(); } } }, '重設生涯')),
      h('h3', {}, '飛行紀錄'));
    if (!p.history.length) wrap.append(h('p', { class: 'muted' }, '尚無紀錄。切換到「模擬飛行」開始第一趟航班吧！'));
    p.history.slice().reverse().forEach((f) => wrap.append(h('div', { class: 'card' },
      h('b', {}, `${f.grade}｜${f.flight} ${f.route}`), h('div', { class: 'muted' }, `${new Date(f.date).toLocaleString()}・${f.aircraft}・${f.rank}`),
      h('div', {}, `完成 ${f.done}/${f.total}・品質 ${f.avgQuality}・滿意度 ${f.satisfaction}・+${f.xp} XP`))));
    return wrap;
  }

  panelSettings() {
    const s = this.state.settings;
    const wrap = h('div');
    wrap.append(h('h3', {}, '畫面品質'),
      field('3D 畫質', h('select', { id: 'qualitySel', onchange: (e) => { s.quality = e.target.value; this.v3.setQuality(s.quality); this.changed(); } },
        [['high', '高（環境光遮蔽、光暈、柔和陰影）'], ['medium', '中（光暈、陰影）'], ['low', '低（適合較舊的電腦）']].map(([v, n]) => h('option', { value: v, selected: (s.quality || 'high') === v }, n)))),
      h('p', { class: 'muted' }, '高畫質下若畫面持續低於約 24 FPS，會自動改為中畫質。'),
      h('h3', {}, '廣播評分'),
      h('p', { class: 'muted' }, `語音辨識：${speechSupported ? '✅ 此瀏覽器支援（建議使用 Chrome / Edge）' : '❌ 此瀏覽器不支援，可改用文字輸入'}`),
      field('語音辨識語言', h('select', { onchange: (e) => { s.speechLang = e.target.value; this.changed(); } }, [['zh-TW', '中文（台灣）'], ['en-US', 'English'], ['ja-JP', '日本語']].map(([v, n]) => h('option', { value: v, selected: s.speechLang === v }, n)))),
      field('AI 評分端點（選填）', h('input', { value: s.aiEndpoint, placeholder: '例如 http://127.0.0.1:3012/api/judge-announcement', onchange: (e) => { s.aiEndpoint = e.target.value.trim(); this.changed(); } })),
      h('div', { class: 'btns' },
        h('button', { onclick: () => { s.aiEndpoint = '/api/judge-announcement'; this.changed('panel'); } }, '使用本機測試伺服器'),
        h('button', { onclick: () => { s.aiEndpoint = location.port === '3012' ? '/api/judge-announcement' : 'http://127.0.0.1:3012/api/judge-announcement'; this.changed('panel'); } }, '填入 3012 預設網址'),
        h('button', { class: 'primary', onclick: async (e) => {
          const out = e.target.closest('div').nextElementSibling;
          out.textContent = '測試中…';
          const r = await testEndpoint(s.aiEndpoint);
          out.innerHTML = r.ok ? `✅ 連線成功（${r.ms} ms）：${esc(r.score)} 分－「${esc(r.feedback)}」` : `❌ ${esc(r.error)}`;
        } }, '測試連線')),
      h('p', { class: 'muted' }, '尚未測試'),
      h('p', { class: 'muted' }, '留空則使用本機評分（文字相似度＋關鍵詞）。填入端點後會以 POST 傳送 { reference, transcript, keywords, speaker, rank, localScore }，期望回傳 { score, feedback }，由學姊/座艙長說出回饋。AI 連不上時會自動改用本機評分。'),
      h('label', { style: 'color:var(--text)' }, h('input', { type: 'checkbox', checked: s.tts, onchange: (e) => { s.tts = e.target.checked; this.changed(); } }), ' 學姊/座艙長以語音唸出回饋'),
      h('h3', {}, '資料'),
      h('div', { class: 'btns' },
        h('button', { onclick: () => download('cabin-sim-backup.json', this.state) }, '匯出全部'),
        h('label', { style: 'margin:0' }, h('span', { style: 'border:1px solid var(--line);border-radius:6px;padding:5px 10px;cursor:pointer;display:inline-block;color:var(--text)' }, '匯入全部'),
          h('input', { type: 'file', accept: '.json', style: 'display:none', onchange: async (e) => { try { const j = JSON.parse(await readFile(e.target.files[0])); if (!j.aircraft || !j.scenarios) throw new Error('格式不符'); this.state = j; save(j); location.reload(); } catch (er) { this.toast('系統', '匯入失敗：' + er.message, 'bad'); } } })),
        h('button', { class: 'danger', onclick: async () => { if (await this.ask('清除所有資料並恢復預設？')) { resetAll(); location.reload(); } } }, '恢復預設')));
    return wrap;
  }

  // =================== 模擬飛行 ===================
  briefing() {
    const sc = this.scenario();
    const ac = this.state.aircraft.find((a) => a.id === sc.aircraftId) || this.aircraft();
    this.state.currentAircraft = ac.id;
    const r = rankOf(this.state.profile.xp);
    const count = sc.tasks.filter((t) => (t.minRank || 0) <= r).length;
    this.openModal(h('div', {},
      h('h2', {}, `✈ ${sc.flightNo}｜${sc.route}`),
      h('div', { class: 'muted' }, `${ac.name}・你的職級：${RANKS[r].name}・本航班任務 ${count} 項`),
      h('div', { class: 'speaker' }, h('div', { class: 'ava' }, '👩‍✈️'), h('div', { class: 'bubble' }, h('b', {}, r >= 3 ? sc.npc.inspector : sc.npc.purser), sc.intro)),
      h('div', { class: 'card' }, h('b', {}, '操作說明'),
        h('ul', { style: 'margin:4px 0;padding-left:18px' },
          h('li', {}, '右側任務佇列依優先順序排列，點「前往」自動走到目標，靠近後按 E 或點畫面下方按鈕互動。'),
          h('li', {}, '先處理緊急（紅色）任務：處理順序錯誤會被扣分。'),
          h('li', {}, '起飛、落地時必須回到組員座椅就座；起降中起身算安全違規。'),
          h('li', {}, '廣播任務可用麥克風或文字輸入，由學姊／座艙長評分。'),
          r >= 3 ? h('li', {}, '座艙長：可在任務卡上把工作「指派」給組員，組員能力不同、完成品質不同。') : null,
          h('li', {}, '視角：平面圖 / 3D 預設 / 第一人稱（WASD 移動）。'))),
      h('div', { class: 'btns', style: 'justify-content:flex-end' },
        h('button', { onclick: () => this.closeModal() }, '取消'),
        h('button', { class: 'primary', onclick: () => { this.closeModal(); this.startFlight(); } }, '開始航班'))));
  }

  startFlight() {
    const sc = this.scenario();
    this.mode = 'play';
    document.querySelectorAll('#modeSeg button').forEach((b) => b.classList.toggle('on', b.dataset.mode === 'play'));
    $('#leftPanel').hidden = true; $('#rightPanel').hidden = false; $('#hud').hidden = false;
    $('#logBox').innerHTML = '';
    this.v2.selSeats.clear(); this.v2.selFixture = null;
    this.sim = new Flight({
      aircraft: this.aircraft(), scenario: sc, profile: this.state.profile,
      hooks: {
        onToast: (sp, tx, tone) => { this.toast(sp, tx, tone); this.logLine(sp, tx); },
        onDialog: (t) => this.showDialog(t),
        onAnnounce: (t) => this.showAnnounce(t),
        onChat: (seat, info) => this.showChat(seat, info),
        onCockpit: () => this.showCockpit(),
        onEnd: (r) => this.endFlight(r),
        onTaskChange: () => { this.taskListDirty = true; },
        onPhase: () => { this.taskListDirty = true; },
      },
    });
    $('#speedSel').value = String(sc.timeScale || 1);
    this.sim.timeScale = sc.timeScale || 1;
    this.v3.fp.yaw = 0;
    this.v3.orbit.manual = false; this.v3.orbit.dist = 9; this.v3.orbit.pitch = 0.9;
    this.taskListDirty = true;
    if (this.view === '2d') this.v2.fit();
    this.renderToolbar(); this.updateHint();
    this.say(sc.npc.purser, '各位組員，登機開始，請就各自崗位。');
  }

  say(sp, tx) { this.toast(sp, tx); this.logLine(sp, tx); }

  async exitPlay() {
    if (this.sim && !this.sim.ended && !await this.ask('離開模擬將放棄本次航班，確定？')) return;
    this.sim = null;
    this.mode = 'edit';
    document.querySelectorAll('#modeSeg button').forEach((b) => b.classList.toggle('on', b.dataset.mode === 'edit'));
    $('#leftPanel').hidden = false; $('#rightPanel').hidden = true; $('#hud').hidden = true;
    this.closeModal();
    this.v3.layoutKey = null;
    this.resize(); this.renderToolbar(); this.updateHint(); this.renderPanel();
  }

  togglePause() {
    if (!this.sim) return;
    this.sim.paused = !this.sim.paused;
    $('#btnPause').textContent = this.sim.paused ? '▶ 繼續' : '⏸ 暫停';
  }

  // 3D 視角中的點選（人物 / 地板）
  onPick(h) {
    if (h.type === 'floor') return this.onPlayClick(h);
    if (h.type === 'pax') return this.onPersonClick(h.seat);
    if (h.type === 'prop') { if (this.mode === 'play' && this.sim && !this.sim.ended && !this.sim.modalOpen) this.sim.actOnProp(h.id); return; }
    if (h.type === 'npc' && this.sim) {
      const n = this.sim.npcs.find((z) => z.id === h.id);
      if (n) this.toast(n.name, n.task ? `我正在處理「${n.task.def.title}」。` : this.sim.rank >= 3 ? '座艙長，有什麼需要我協助的嗎？可以在任務卡上指派給我。' : '有問題隨時問我喔！');
    }
  }

  onPersonClick(seat) {
    const p = this.scenario().passengers.find((x) => x.seat === seat);
    if (this.mode !== 'play' || !this.sim || this.sim.ended) { if (p) this.editPassenger(seat); return; }
    const sim = this.sim;
    const t = sim.activeTasks().find((k) => k.status === 'active' && k.def.target && k.def.target.seat === seat);
    if (t) {
      if (sim.inRange(t)) sim.interact(t);
      else { sim.goTo(t); this.pendingTask = t; this.toast('系統', `前往 ${seat}，抵達後會自動開始對話。`); }
      return;
    }
    sim.openChat(seat); // 沒有任務時也能交談；太遠會先走過去
  }

  // ---- 一般旅客交談 ----
  showChat(seat, info) {
    const sim = this.sim;
    const p = info.passenger || {};
    const t = PAX_TYPES[p.type] || PAX_TYPES.normal;
    const bar = (label, v, col) => h('div', { class: 'meter' }, h('span', {}, label), h('i', {}, h('b', { style: `width:${Math.round(v)}%;background:${col}` })), h('em', {}, Math.round(v)));
    const mcol = (v) => (v >= 70 ? 'var(--good)' : v >= 40 ? 'var(--warn)' : 'var(--bad)');
    const result = h('div');
    const close = h('button', { onclick: () => { this.closeModal(); sim.cancelModal(); } }, '離開');
    const optsBox = h('div', {}, info.options.map((o, i) => h('button', { class: 'opt', onclick: () => {
      const r = sim.resolveChat(seat, o);
      optsBox.remove();
      result.append(h('div', { class: 'speaker' }, h('div', { class: 'ava' }, t.icon), h('div', { class: 'bubble' }, h('b', {}, `${p.name || '旅客'}（${seat}）`), r.reply)),
        bar('滿意度', r.mood, mcol(r.mood)), bar('耐心', r.patience, mcol(r.patience)));
      close.textContent = '完成'; close.className = 'primary';
    } }, h('kbd', {}, i + 1), o.text)));
    this.openModal(h('div', {},
      h('h2', {}, `${t.icon} ${p.name || '旅客'}（${seat}）`),
      h('div', { class: 'muted' }, [t.name, p.note].filter(Boolean).join('・')),
      bar('滿意度', info.mood, mcol(info.mood)), bar('耐心', info.patience, mcol(info.patience)),
      h('div', { class: 'muted', style: 'margin-top:8px' }, `你要對旅客說什麼？（${sim.phase.name}階段・安全帶燈${sim.env.seatbelt ? '亮' : '熄'}）`),
      optsBox, result,
      h('div', { class: 'btns', style: 'justify-content:flex-end' }, close)), true);
  }

  // ---- 駕駛艙門內線 ----
  showCockpit() {
    const sim = this.sim;
    const out = h('div');
    const choose = (c) => {
      const r = sim.cockpitRequest(c);
      box.remove();
      out.append(h('div', { class: 'speaker' }, h('div', { class: 'ava' }, '👨‍✈️'), h('div', { class: 'bubble' }, h('b', {}, r.speaker), r.text)));
      done.textContent = '確定'; done.className = 'primary';
      if (sim.arresting) { done.textContent = '……'; }
    };
    const box = h('div', {},
      h('button', { class: 'opt', onclick: () => choose('procedure') }, h('kbd', {}, 1), '使用內線電話，依程序說明來意（送餐、報告客艙狀況）並請求開門'),
      h('button', { class: 'opt', onclick: () => choose('noreason') }, h('kbd', {}, 2), '敲門要求開門，不說明原因'),
      h('button', { class: 'opt', onclick: () => choose('force') }, h('kbd', {}, 3), '堅持要進去，用力拍門要求立刻開門'));
    const done = h('button', { onclick: () => { this.closeModal(); sim.cancelModal(); } }, '取消');
    this.openModal(h('div', {},
      h('h2', {}, '🔒 駕駛艙門'),
      h('p', { class: 'muted' }, '駕駛艙門平時保持上鎖。進入前必須以內線電話聯絡駕駛員、說明來意並確認客艙走道淨空；起降與滑行等關鍵階段駕駛艙不開放進入。'),
      box, out, h('div', { class: 'btns', style: 'justify-content:flex-end' }, done)), true);
  }

  onPlayClick(w) {
    if (this.mode === 'edit' && this.walker && this.view === 'fp') { this.walker.path = findPath(this.walker.grid, this.walker, w); return; }
    if (this.mode !== 'play' || !this.sim || this.sim.ended) return;
    this.pendingTask = null;
    // 點到座位旁：走到該排走道；否則走到點擊位置
    const ac = this.aircraft();
    const s = ac.seats.find((z) => !z.removed && Math.abs(w.x - z.x) <= z.d / 2 + 0.05 && Math.abs(w.y - z.y) <= z.w / 2 + 0.05);
    this.sim.walkTo(s ? approachPoint(ac, this.sim.grid, s) : w);
  }

  updateHud() {
    const sim = this.sim;
    // 階段列
    const pb = $('#phaseBar');
    if (!pb.children.length) { PHASES.forEach((p) => pb.append(h('div', {}, p.name, h('i')))); pb.append(h('span', { class: 'plane' }, '✈')); }
    pb.querySelector('.plane').style.left = `calc(6px + (100% - 12px) * ${sim.progress().toFixed(4)})`;
    [...pb.querySelectorAll('div')].forEach((d, i) => {
      d.className = i < sim.phaseIdx ? 'past' : i === sim.phaseIdx ? 'cur' : '';
      d.querySelector('i').style.width = i === sim.phaseIdx ? `${(sim.phaseT / sim.phase.dur) * 100}%` : '';
    });
    const e = sim.env;
    const ins = (label, val, unit) => `<div class="ins">${label}<b>${val}</b><small>${unit}</small></div>`;
    $('#envBox').innerHTML = ins('高度 ALT', Math.round(e.alt).toLocaleString(), 'ft') + ins('空速 IAS', Math.max(0, Math.round(e.speed)), 'kt') + ins('航班時間', fmtT(sim.totalT), sim.paused ? '暫停中' : `×${sim.timeScale}`)
      + `<div class="chips"><span class="sign ${e.seatbelt ? 'on' : ''}">繫緊安全帶</span><span class="sign ${e.doorsOpen ? '' : 'good'}">${e.doorsOpen ? '艙門開啟' : '艙門關閉'}</span>`
      + `${e.turbulence > 0 ? '<span class="sign bad">亂流</span>' : ''}${sim.player.seated ? '<span class="sign good">已就座</span>' : ''}</div>`;
    // 互動按鈕
    const ib = $('#interactBox');
    const acts = sim.modalOpen || sim.ended ? [] : sim.availableActions();
    const key = acts.map((a) => a.id + a.label).join(',');
    if (ib.dataset.key !== key) {
      ib.dataset.key = key; ib.innerHTML = '';
      acts.forEach((a, i) => ib.append(h('button', { class: a.task ? 'task-act' : '', onclick: () => a.run() }, i === 0 ? h('kbd', {}, 'E') : null, a.label)));
    }
    // 任務列表（每 0.25 秒或狀態改變時重繪）
    this.hudT = (this.hudT || 0) + 1;
    if (this.taskListDirty || this.hudT % 15 === 0) { this.renderTaskList(); this.taskListDirty = false; }
  }

  renderTaskList() {
    const sim = this.sim, sc = this.scenario();
    const r = sim.rank;
    $('#flightInfo').innerHTML = `<b>${esc(sc.flightNo)}</b> ${esc(sc.route)}<br><span class="muted">${esc(sim.ac.name)}・${RANKS[r].name}・${esc(this.state.profile.name)}</span>`;
    const list = $('#taskList');
    list.innerHTML = '';
    const act = sim.activeTasks();
    if (!act.length) list.append(h('p', { class: 'muted' }, '目前沒有待辦任務。可以巡視客艙或觀察旅客。'));
    act.forEach((t) => {
      const pr = PRIORITY[t.def.priority];
      const pct = Math.max(0, t.remaining / t.def.limit) * 100;
      const tg = t.def.target ? (t.def.target.seat ? `座位 ${t.def.target.seat}` : (FIXTURE_TYPES[t.def.target.fixture]?.name || t.def.target.fixture)) : '';
      const pax = t.def.target && t.def.target.seat ? sc.passengers.find((p) => p.seat === t.def.target.seat) : null;
      const acts = h('div', { class: 'acts' });
      if (t.status === 'delegated') acts.append(h('span', { class: 'muted' }, `👥 ${sim.npcs.find((n) => n.id === t.assignee)?.name || ''} 處理中…`));
      else {
        if (t.def.kind !== 'announce' && t.def.kind !== 'manage') acts.append(h('button', { onclick: () => sim.goTo(t) }, t.def.kind === 'walk' ? '開始巡查' : '前往'));
        if (t.def.kind !== 'walk' && t.def.kind !== 'manage') acts.append(h('button', { class: sim.inRange(t) ? 'primary' : '', disabled: !sim.inRange(t), onclick: () => sim.interact(t) }, t.def.kind === 'announce' ? '🎙 廣播' : '互動'));
        if (sim.canDelegate(t)) {
          const free = sim.freeCrew();
          if (free.length) acts.append(h('select', { onchange: (e) => { if (e.target.value) sim.delegate(t, e.target.value); } }, h('option', { value: '' }, '指派給…'), free.map((c) => h('option', { value: c.id }, `${c.name}（能力 ${Math.round(c.skill * 100)}）`))));
        }
      }
      let extra = '';
      if (t.def.kind === 'walk') extra = `・已巡查 ${t.covered.size}/${sim.rows.length} 排`;
      list.append(h('div', { class: 'task', style: `border-left-color:${pr.color}` },
        h('div', { class: 'top' }, h('span', { class: 't' }, t.def.title), h('span', { class: 'pill', style: `background:${pr.color}` }, pr.name)),
        h('div', { class: 'meta' }, [tg, pax ? `${(PAX_TYPES[pax.type] || {}).icon || ''} ${pax.name}` : '', `剩 ${Math.ceil(t.remaining)}s`].filter(Boolean).join('・') + extra),
        t.def.desc ? h('div', { class: 'meta' }, t.def.desc) : null,
        h('div', { class: 'timer' }, h('i', { style: `width:${pct}%;background:${pct < 30 ? 'var(--bad)' : pr.color}` })),
        acts));
    });
    const recent = sim.tasks.filter((t) => t.status === 'done' || t.status === 'failed').slice(-4).reverse();
    recent.forEach((t) => list.append(h('div', { class: 'task ' + t.status }, h('div', { class: 'top' }, h('span', {}, t.def.title), h('span', {}, t.status === 'done' ? `✔ ${t.quality}` : '✘ 超時')))));
    const cb = $('#crewBox');
    cb.innerHTML = '';
    if (r >= 3) {
      cb.append(h('h3', {}, '組員狀態'));
      sim.npcs.forEach((n) => cb.append(h('div', { class: 'list-item' }, h('span', { style: `color:${n.color}` }, '●'), n.name, h('span', { class: 'muted', style: 'margin-left:auto' }, n.task ? `處理：${n.task.def.title}` : '待命'))));
    }
  }

  logLine(sp, tx) {
    const lb = $('#logBox');
    if (!lb) return;
    lb.prepend(h('p', {}, h('b', {}, sp + '：'), tx));
  }

  toast(speaker, text, tone = 'info') {
    const box = $('#toasts');
    const el = h('div', { class: 'toast ' + tone, 'data-ini': String(speaker).replace(/^(學姊|座艙長|客艙督導)\s*/, '').slice(0, 1) }, h('b', {}, speaker), h('span', {}, text));
    box.append(el);
    while (box.children.length > 4) box.firstChild.remove();
    setTimeout(() => el.remove(), 6000);
  }

  // ---- 對話 ----
  showDialog(task) {
    const sc = this.scenario();
    const seat = task.def.target && task.def.target.seat;
    const pax = seat ? sc.passengers.find((p) => p.seat === seat) : null;
    const t = pax ? PAX_TYPES[pax.type] || PAX_TYPES.normal : { icon: '👥' };
    const who = pax ? `${pax.name}（${seat}）` : '組員';
    const opts = task.def.options || [];
    this.openModal(h('div', {},
      h('h2', {}, task.def.title),
      pax && pax.note ? h('div', { class: 'muted' }, `旅客資料：${pax.note}`) : null,
      h('div', { class: 'speaker' }, h('div', { class: 'ava' }, t.icon), h('div', { class: 'bubble' }, h('b', {}, who), task.def.prompt || '')),
      h('div', { class: 'muted' }, `你要怎麼回應？（剩 ${Math.ceil(task.remaining)} 秒，對話時時間暫停）`),
      opts.map((o, i) => h('button', { class: 'opt', onclick: () => { this.closeModal(); this.sim.resolveTalk(task, o); } }, h('kbd', {}, i + 1), o.text)),
      h('div', { class: 'btns', style: 'justify-content:flex-end' }, h('button', { onclick: () => { this.closeModal(); this.sim.cancelModal(); } }, '稍後處理'))), true);
  }

  // ---- 廣播 ----
  showAnnounce(task) {
    const sim = this.sim, st = this.state;
    const a = announcementFor(task);
    const judge = sim.judgeName(task.def.judge);
    let rec = null;
    const ta = h('textarea', { rows: 4, placeholder: speechSupported ? '按「🎙 開始廣播」用麥克風講，或直接在這裡輸入廣播內容' : '此瀏覽器不支援語音辨識，請輸入你要廣播的內容' });
    const scriptBox = h('div', { class: 'script' }, a.script);
    const hideCb = h('input', { type: 'checkbox', onchange: (e) => scriptBox.classList.toggle('blur', e.target.checked) });
    const mic = h('button', { class: 'mic', disabled: !speechSupported, onclick: () => {
      if (rec) { rec.stop(); return; }
      rec = startRecognition(st.settings.speechLang, (txt) => { ta.value = txt; }, (err) => { rec = null; mic.classList.remove('rec'); mic.textContent = '🎙 開始廣播'; if (err && err !== 'no-speech' && err !== 'aborted') this.toast('系統', '語音辨識錯誤：' + err, 'bad'); });
      if (rec) { mic.classList.add('rec'); mic.textContent = '⏹ 停止'; }
    } }, '🎙 開始廣播');
    const result = h('div');
    const submit = h('button', { class: 'primary', onclick: async () => {
      if (rec) rec.stop();
      submit.disabled = true; submit.textContent = '評分中…';
      const memorized = hideCb.checked;
      const res = await scoreAnnouncement({ reference: a.script, transcript: ta.value, keywords: a.keywords, speaker: judge, rank: RANKS[sim.rank].name, endpoint: st.settings.aiEndpoint });
      let score = res.score;
      if (memorized && score >= 60) score = Math.min(100, score + 8);
      const local = res.local || scoreLocal(a.script, ta.value, a.keywords);
      result.innerHTML = '';
      result.append(
        h('div', { class: 'speaker' }, h('div', { class: 'ava' }, '👩‍✈️'), h('div', { class: 'bubble' }, h('b', {}, `${judge}・${score} 分${memorized ? '（背誦加分）' : ''}${res.source === 'ai' ? '・AI 評分' : ''}`), res.text)),
        h('div', {}, a.keywords.map((k) => h('span', { class: 'kw ' + (local.hit.includes(k) ? 'hit' : 'miss') }, k))));
      speak(`${res.text}`, st.settings.tts);
      submit.textContent = '完成'; submit.disabled = false;
      submit.onclick = () => { this.closeModal(); sim.resolveAnnounce(task, { score }); };
    } }, '送出評分');
    this.openModal(h('div', {},
      h('h2', {}, `🎙 ${a.title}`),
      h('div', { class: 'muted' }, `由 ${judge} 評分。請用標準廣播詞廣播，語速平穩、內容完整。`),
      h('label', { style: 'color:var(--text)' }, hideCb, ' 背誦模式（隱藏廣播詞，分數 +8）'),
      scriptBox,
      h('div', { class: 'btns' }, mic, h('span', { class: 'muted' }, speechSupported ? '' : '（不支援語音辨識）')),
      ta, result,
      h('div', { class: 'btns', style: 'justify-content:flex-end' },
        h('button', { onclick: () => { if (rec) rec.stop(); this.closeModal(); sim.cancelModal(); } }, '稍後'), submit)), true);
  }

  // ---- 結算 ----
  endFlight(r) {
    const p = this.state.profile;
    const before = rankOf(p.xp);
    p.xp += r.xp;
    p.flights += 1;
    p.history.push(r);
    if (p.history.length > 50) p.history.shift();
    const after = rankOf(p.xp);
    save(this.state);
    this.renderProfile();
    const next = RANKS[after + 1];
    this.openModal(h('div', {},
      h('h2', {}, r.failed ? `任務失敗｜${r.flight} ${r.route}` : `航班結束｜${r.flight} ${r.route}`),
      r.failed ? h('div', { class: 'card', style: 'border-color:var(--bad);color:#ffb3b3' }, h('b', {}, '🚨 遊戲失敗：'), r.reason) : null,
      h('div', { class: 'grade', style: r.failed ? 'color:var(--bad)' : '' }, r.grade),
      h('div', { class: 'stat' },
        h('div', {}, h('b', {}, `${r.done}/${r.total}`), '完成任務'), h('div', {}, h('b', {}, r.avgQuality), '平均品質'), h('div', {}, h('b', {}, r.satisfaction), '旅客滿意度')),
      h('div', { class: 'stat', style: 'margin-top:6px' },
        h('div', {}, h('b', {}, r.safety), '安全違規'), h('div', {}, h('b', {}, r.priorityMistakes), '順序失誤'), h('div', {}, h('b', { style: 'color:var(--accent-2)' }, '+' + r.xp), '經驗值')),
      after > before ? h('div', { class: 'card', style: 'border-color:var(--accent-2);margin-top:10px' },
        h('b', { style: 'color:var(--accent-2);font-size:16px' }, `🎉 晉升為「${RANKS[after].name}」！`), h('div', {}, RANKS[after].desc)) : null,
      h('p', { class: 'muted' }, next ? `目前 ${p.xp} XP，距離「${next.name}」還差 ${next.xp - p.xp} XP。` : `目前 ${p.xp} XP，已達最高職級。`),
      r.violations && r.violations.length ? h('details', { open: true }, h('summary', {}, `違規紀錄（${r.violations.length}）`), h('ul', {}, r.violations.map((v) => h('li', { style: 'color:#ffb3b3' }, v)))) : null,
      h('details', {}, h('summary', {}, '任務明細'), h('ul', {}, r.tasks.map((t) => h('li', {}, `${t.status === 'done' ? '✔' : '✘'} ${t.title}${t.status === 'done' ? `（${t.quality}）` : ''}`)))),
      h('div', { class: 'btns', style: 'justify-content:flex-end' },
        h('button', { onclick: () => { this.closeModal(); this.sim = null; this.exitPlay(); } }, '回到編輯器'),
        h('button', { class: 'primary', onclick: () => { this.closeModal(); this.sim = null; this.briefing(); } }, '再飛一次'))));
  }

  // ---- 頁內確認 / 輸入框（取代 confirm / prompt，在 Artifact 等環境也能用） ----
  ask(message) {
    return new Promise((resolve) => {
      const done = (v) => { this.closeModal(); resolve(v); };
      this.openModal(h('div', {}, h('h2', {}, '請確認'), h('p', {}, message),
        h('div', { class: 'btns', style: 'justify-content:flex-end' },
          h('button', { onclick: () => done(false) }, '取消'),
          h('button', { class: 'primary', onclick: () => done(true) }, '確定'))), true);
    });
  }
  askValue(message, def = '') {
    return new Promise((resolve) => {
      const input = h('input', { id: 'askValueInput', value: def });
      const done = (v) => { this.closeModal(); resolve(v); };
      input.addEventListener('keydown', (e) => { if (e.key === 'Enter') done(input.value); });
      this.openModal(h('div', {}, h('h2', {}, message), input,
        h('div', { class: 'btns', style: 'justify-content:flex-end;margin-top:12px' },
          h('button', { onclick: () => done(null) }, '取消'),
          h('button', { class: 'primary', onclick: () => done(input.value) }, '確定'))), true);
      setTimeout(() => input.focus(), 0);
    });
  }

  // ---- 對話框 ----
  openModal(content, blocking = false) {
    const m = $('#modal'), c = $('#modalCard');
    c.innerHTML = ''; c.append(content);
    m.hidden = false;
    m.onclick = blocking ? null : (e) => { if (e.target === m) this.closeModal(); };
    if (document.pointerLockElement) document.exitPointerLock();
  }
  closeModal() { $('#modal').hidden = true; }
}

window.app = new App();
