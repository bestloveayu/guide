// 飛行模擬引擎：階段時間軸、任務佇列、移動、評分、組員分派
import { PHASES, RANKS, rankOf, DEFAULT_CREW, ANNOUNCEMENTS, PRIORITY, PILOTS, MEALS, DRINKS } from './data.js';
import { BAG_COLORS } from './art.js';
import { buildGrid, findPath, approachPoint, findSeat, findFixture, rowsOf, walkable, slideMove, roomLayout, binDoors, collides, lavLayout, binCapacity, binSpot, ROW_R, BODY_R } from './layout.js';

const WALK_SPEED = 1.7; // m/s
const lerp = (a, b, t) => a + (b - a) * Math.max(0, Math.min(1, t));

export class Flight {
  constructor({ aircraft, scenario, profile, hooks }) {
    this.ac = aircraft;
    this.sc = scenario;
    this.profile = profile;
    this.hooks = hooks || {};
    this.rank = rankOf(profile.xp);
    this.occupied = new Set(scenario.passengers.map((p) => p.seat));
    this.grid = buildGrid(aircraft, {}, this.occupied);
    this.rows = rowsOf(aircraft).filter((r) => r.seats.some((s) => !s.removed));
    this.timeScale = scenario.timeScale || 1;
    this.phaseIdx = 0;
    this.phaseT = 0;
    this.totalT = 0;
    this.paused = false;
    this.ended = false;
    this.modalOpen = false;
    this.log = [];
    this.stats = { priorityMistakes: 0, safety: 0, delegated: 0 };
    this.mood = {};
    scenario.passengers.forEach((p) => { if (findSeat(aircraft, p.seat)) this.mood[p.seat] = p.mood ?? 70; });

    const door = findFixture(aircraft, 'L1') || findFixture(aircraft, 'door') || aircraft.fixtures[0];
    let start = door ? approachPoint(aircraft, this.grid, door) : { x: 3, y: 0 };
    if (door && walkable(this.grid, door.x, 0)) start = { x: door.x, y: 0 }; // 站在艙門旁的走道中央
    this.player = { x: start.x, y: start.y, heading: Math.PI, path: [], seated: false, seatedFixture: null };

    // NPC：見習~資深時有學姊與座艙長；擔任座艙長時改為可分派的組員
    const galley = findFixture(aircraft, 'galley', start) || door;
    const gp = galley ? approachPoint(aircraft, this.grid, galley) : start;
    if (this.rank >= 3) {
      this.npcs = DEFAULT_CREW.map((c, i) => ({ ...c, x: gp.x + 0.4 * i, y: gp.y, home: { x: gp.x + 0.4 * i, y: gp.y }, path: [], task: null, work: 0 }));
    } else {
      this.npcs = [
        { id: 'senior', name: scenario.npc.senior, color: '#d97a8c', x: gp.x + 0.5, y: gp.y, home: { x: gp.x + 0.5, y: gp.y }, path: [], task: null },
        { id: 'purser', name: scenario.npc.purser, color: '#c9a227', x: walkable(this.grid, start.x - 0.7, start.y) ? start.x - 0.7 : start.x, y: start.y, home: { x: walkable(this.grid, start.x - 0.7, start.y) ? start.x - 0.7 : start.x, y: start.y }, heading: 0, path: [], task: null },
      ];
    }

    this.tasks = scenario.tasks
      .filter((t) => (t.minRank || 0) <= this.rank && (t.maxRank == null || t.maxRank >= this.rank))
      .filter((t) => !(t.target && t.target.seat) || findSeat(aircraft, t.target.seat)) // 座位已不存在的旅客任務略過
      .map((def) => ({ def, status: 'waiting', remaining: def.limit, quality: 0, assignee: null, covered: new Set(), activeSince: 0 }));
    this.env = { alt: 0, speed: 0, pitch: 0, shake: 0, lights: 1, seatbelt: true, doorsOpen: true, ground: true, turbulence: 0, groundScroll: 0 };
    this.initProps();
    this.initService();
    this.initBins();
    this.initBoarding();
    this.calls = {}; this.spills = []; this.binJobs = {};
  }

  get phase() { return PHASES[this.phaseIdx]; }
  judgeName(kind) {
    if (kind === 'purser' && this.rank < 3) return this.sc.npc.purser;
    if (this.rank >= 3) return this.sc.npc.inspector || '客艙督導';
    return this.sc.npc.senior;
  }
  say(speaker, text, tone = 'info') { this.log.push({ t: this.totalT, speaker, text }); this.hooks.onToast && this.hooks.onToast(speaker, text, tone); }

  // ---- 任務目標座標 ----
  targetPos(task) {
    const tg = task.def.target || {};
    if (tg.seat) { const s = findSeat(this.ac, tg.seat); return s ? { x: s.x, y: s.y, seat: s } : null; }
    if (tg.fixture) { const f = findFixture(this.ac, tg.fixture, this.player); return f ? { x: f.x, y: f.y, fixture: f } : null; }
    return null;
  }
  inRange(task, who = this.player) {
    const k = task.def.kind;
    if (k === 'announce' || k === 'manage' || k === 'walk' || k === 'service' || k === 'bins') return true;
    const p = this.targetPos(task);
    if (!p) return true; // 找不到目標（例如座位已被移除）就不限制距離
    if (p.seat) return Math.abs(who.x - p.x) <= 0.85 && Math.abs(who.y - p.y) <= 2.6;
    const f = p.fixture;
    const dx = Math.max(0, Math.abs(who.x - f.x) - f.w / 2), dy = Math.max(0, Math.abs(who.y - f.y) - f.d / 2);
    return Math.hypot(dx, dy) <= 1.1;
  }

  activeTasks() {
    return this.tasks.filter((t) => t.status === 'active' || t.status === 'delegated')
      .sort((a, b) => a.def.priority - b.def.priority || a.remaining - b.remaining);
  }
  interactables() { return this.activeTasks().filter((t) => t.status === 'active' && t.def.kind !== 'walk' && t.def.kind !== 'service' && t.def.kind !== 'bins' && !(t.def.kind === 'cart' && this.cart.state === 'out') && this.inRange(t)); }

  // ---- 移動 ----
  goTo(task) {
    if (!task) return;
    if (task.def.kind === 'bins') {
      const open = this.binsInfo.doors.filter((d) => this.binOpen[d.id] && !this.binJobs[d.id]).sort((a, c) => Math.abs(a.x - this.player.x) - Math.abs(c.x - this.player.x))[0];
      if (open) this.walkTo(binSpot(open, 0.4));
      return;
    }
    if (task.def.kind === 'service') {
      if (this.cart.state !== 'out') { const g = this.galleyFixture(); if (g) this.walkTo(approachPoint(this.ac, this.grid, g)); return; }
      const row = this.rows.find((r) => r.seats.some((s) => this.mood[s.id] != null && !this.service.served[s.id]));
      if (row) this.walkTo({ x: row.x, y: this.player.y });
      return;
    }
    if (task.def.kind === 'walk') { // 巡查：走到最後一排
      const last = this.rows[this.rows.length - 1], first = this.rows[0];
      const far = Math.abs(this.player.x - first.x) < Math.abs(this.player.x - last.x) ? last : first;
      return this.walkTo(approachPoint(this.ac, this.grid, { x: far.x, y: 0 }));
    }
    const p = this.targetPos(task);
    if (p) this.walkTo(approachPoint(this.ac, this.grid, p));
  }
  walkTo(pt) {
    if (this.arresting) return;
    if (this.player.belted) { this.hint('你正繫著安全帶坐在組員座椅上，請先解開安全帶。', 'belt'); return; }
    this.standUp();
    this.player.path = findPath(this.grid, this.player, pt);
  }
  moveManual(dx, dy) { // 第一人稱移動（公尺），碰到座位或牆面時沿表面滑動
    if (this.arresting) return;
    if ((dx || dy) && this.binView) this.exitBinView();
    if ((dx || dy) && this.player.belted) { this.hint('你正繫著安全帶坐在組員座椅上，請先解開安全帶（按 E）。', 'belt'); return; }
    if (dx || dy) this.standUp();
    if (dx || dy) this.player.path = [];
    const ox = this.player.x, oy = this.player.y;
    if (this.cart.state === 'out') { dx *= 0.6; dy *= 0.6; }
    const bx = this.player.x, by = this.player.y;
    slideMove(this.grid, this.player, dx, dy);
    // 走道外的空座位排：側身、雙腳併攏才擠得進去（推餐車時不行）
    if (this.player.x === bx && this.player.y === by && this.cart.state !== 'out' && (dx || dy)) slideMove(this.grid, this.player, dx * 0.5, dy * 0.5, ROW_R);
    // 不能穿過其他人（登機中的旅客、組員）
    const people = [...Object.values(this.boarding || {}).filter((o) => ['walk', 'stow', 'sit'].includes(o.state)), ...this.npcs];
    if (people.some((o) => Math.hypot(o.x - this.player.x, o.y - this.player.y) < 0.42 && Math.hypot(o.x - bx, o.y - by) >= Math.hypot(o.x - this.player.x, o.y - this.player.y))) { this.player.x = bx; this.player.y = by; this.hint('前面有人，請稍候或換個方向。', 'people'); }
    this.player.inRow = collides(this.grid, this.player.x, this.player.y, BODY_R);
    if (this.cart.state === 'out') {
      const mdx = this.player.x - ox, mdy = this.player.y - oy;
      const dir = Math.abs(mdx) > 0.002 && Math.abs(mdx) > Math.abs(mdy) ? Math.sign(mdx) : this.cart.dir;
      if (collides(this.grid, this.player.x + dir * 0.62, this.player.y, 0.15)) { this.player.x = ox; this.player.y = oy; this.hint('餐車卡住了，換個方向或先推回廚房。', 'cart'); }
      else this.updateCart(false, mdx, mdy);
    }
    if (dx || dy) this.player.heading = Math.atan2(dy, dx);
  }
  standUp() {
    if (!this.player.seated) return;
    this.player.seated = false; this.player.belted = false;
    const back = this.player.seatReturn && walkable(this.grid, this.player.seatReturn.x, this.player.seatReturn.y) ? this.player.seatReturn : approachPoint(this.ac, this.grid, this.player);
    this.player.x = back.x; this.player.y = back.y;
    const ph = this.phase.id;
    if ((ph === 'takeoff' || ph === 'landing') && !this.ended) {
      this.stats.safety++;
      this.say(this.judgeName('purser'), '起降階段組員必須坐在組員座椅上！這是安全違規。', 'bad');
    }
  }
  stepActor(a, dt) {
    if (!a.path || !a.path.length) return false;
    let move = WALK_SPEED * dt * (a === this.player && this.cart && this.cart.state === 'out' ? 0.6 : 1);
    const ax0 = a.x, ay0 = a.y;
    while (move > 0 && a.path.length) {
      const t = a.path[0];
      const dx = t.x - a.x, dy = t.y - a.y, d = Math.hypot(dx, dy);
      if (d < 1e-3) { a.path.shift(); continue; }
      a.heading = Math.atan2(dy, dx);
      if (d <= move) { a.x = t.x; a.y = t.y; a.path.shift(); move -= d; } else { a.x += (dx / d) * move; a.y += (dy / d) * move; move = 0; }
    }
    if (a === this.player && this.cart) this.updateCart(false, a.x - ax0, a.y - ay0);
    return true;
  }

  // ---- 互動 ----
  interact(task) {
    if (!task || task.status !== 'active') return;
    if (!this.inRange(task)) { this.goTo(task); return; }
    if (task.def.target && task.def.target.seat) this.clearCall(task.def.target.seat);
    const k = task.def.kind;
    if (k === 'goto') this.complete(task, Math.round(lerp(70, 100, task.remaining / task.def.limit)));
    else if (k === 'cart') this.pushCart();
    else if (k === 'seated') {
      const f = this.targetPos(task)?.fixture;
      if (f) this.sitAt(f); else { this.player.path = []; this.player.seated = true; }
      this.player.belted = true;
      this.complete(task, 100, '就座並繫好安全帶與肩帶，開始靜默檢查。');
    } else if (k === 'talk') { this.modalOpen = true; this.hooks.onDialog && this.hooks.onDialog(task); }
    else if (k === 'announce') { this.modalOpen = true; this.hooks.onAnnounce && this.hooks.onAnnounce(task); }
    else if (k === 'manage') this.say(this.sc.npc.inspector || '客艙督導', '請在任務卡上按「指派」把工作交給組員。');
  }
  resolveTalk(task, opt) {
    this.modalOpen = false;
    const seat = task.def.target && task.def.target.seat;
    if (seat && this.mood[seat] != null) this.mood[seat] = Math.max(0, Math.min(100, this.mood[seat] + (opt.mood || 0)));
    this.complete(task, opt.score, opt.reply);
  }
  resolveAnnounce(task, result) {
    this.modalOpen = false;
    this.complete(task, result.score, null);
    // 廣播會影響全艙旅客心情
    const delta = result.score >= 80 ? 3 : result.score < 50 ? -4 : 0;
    Object.keys(this.mood).forEach((k) => { this.mood[k] = Math.max(0, Math.min(100, this.mood[k] + delta)); });
  }
  cancelModal() { this.modalOpen = false; }

  complete(task, quality, reply) {
    if (task.status !== 'active' && task.status !== 'delegated') return;
    // 優先順序判斷：有更緊急的任務已等待超過 6 秒卻先處理較不緊急者
    if (task.status === 'active') {
      const urgent = this.activeTasks().find((t) => t !== task && t.status === 'active' && t.def.priority < task.def.priority && this.totalT - t.activeSince > 6);
      if (urgent) {
        this.stats.priorityMistakes++;
        quality = Math.round(quality * 0.8);
        this.say(this.judgeName('senior'), `先處理「${urgent.def.title}」（${PRIORITY[urgent.def.priority].name}），優先順序要注意喔！`, 'warn');
      }
    }
    task.status = 'done';
    task.quality = quality;
    const tone = quality >= 80 ? 'good' : quality >= 50 ? 'info' : 'bad';
    if (reply) this.say(task.def.kind === 'talk' ? '旅客' : this.judgeName('senior'), reply, tone);
    this.hooks.onTaskChange && this.hooks.onTaskChange();
  }
  fail(task) {
    task.status = 'failed';
    task.quality = 0;
    const seat = task.def.target && task.def.target.seat;
    if (seat && this.mood[seat] != null) this.mood[seat] = Math.max(0, this.mood[seat] - 20);
    if (task.def.priority === 1) this.stats.safety += task.def.kind === 'seated' || task.def.kind === 'walk' ? 1 : 0;
    this.say(this.judgeName('senior'), `「${task.def.title}」超時未完成！`, 'bad');
    if (task.assignee) this.releaseNpc(task);
    this.hooks.onTaskChange && this.hooks.onTaskChange();
  }

  // ---- 座艙長：分派組員 ----
  canDelegate(task) { return this.rank >= 3 && task.status === 'active' && ['goto', 'talk', 'walk', 'announce'].includes(task.def.kind); }
  freeCrew() { return this.rank >= 3 ? this.npcs.filter((n) => !n.task && !n.special) : []; }
  delegate(task, crewId) {
    const c = this.npcs.find((n) => n.id === crewId);
    if (!c || c.task || !this.canDelegate(task)) return;
    task.status = 'delegated';
    task.assignee = c.id;
    c.task = task;
    c.work = 3 + Math.random() * 3;
    const p = task.def.kind === 'walk' ? { x: this.rows[this.rows.length - 1].x, y: 0 } : this.targetPos(task);
    c.path = p ? findPath(this.grid, c, approachPoint(this.ac, this.grid, p)) : [];
    this.stats.delegated++;
    this.say(c.name, `收到，我去處理「${task.def.title}」。`, 'info');
    const mg = this.tasks.find((t) => t.def.kind === 'manage' && t.status === 'active');
    if (mg) this.complete(mg, 100, null);
    this.hooks.onTaskChange && this.hooks.onTaskChange();
  }
  releaseNpc(task) {
    const c = this.npcs.find((n) => n.id === task.assignee);
    if (c) { c.task = null; c.path = findPath(this.grid, c, c.home); }
  }


  // =================== 物件互動與規範 ===================
  initProps() {
    this.doorOpen = {};               // 洗手間 / 休息室 / 駕駛艙門
    this.binsInfo = binDoors(this.ac);
    this.binOpen = {};                // 行李櫃門
    this.oxygen = {};                 // 已落下氧氣面罩的排號
    this.lavChecked = {};
    this.player.belted = false;
    this.cockpit = { insist: 0, open: false, lastAsk: -99 };
    this.pax = {};
    Object.keys(this.mood).forEach((seat) => { this.pax[seat] = { patience: 75 + Math.random() * 20, lastChat: -999, chats: 0 }; });
    this.stats.violations = [];
    this.warnT = {};
  }
  critical() { return ['takeoff', 'landing'].includes(this.phase.id); }
  movingPhase() { return ['pushback', 'taxi', 'takeoff', 'landing'].includes(this.phase.id); }
  violation(msg, key) {
    if (key && this.warnT[key] != null && this.totalT - this.warnT[key] < 8) return; // 同一違規 8 秒內不重複計
    if (key) this.warnT[key] = this.totalT;
    this.stats.safety++;
    this.stats.violations.push(msg);
    this.say(this.judgeName('purser'), `違反規定：${msg}`, 'bad');
    this.hooks.onTaskChange && this.hooks.onTaskChange();
  }
  hint(msg, key) { if (this.warnT['h' + key] != null && this.totalT - this.warnT['h' + key] < 3) return; this.warnT['h' + key] = this.totalT; this.say('系統', msg, 'warn'); }
  rebuildGrid() { this.grid = buildGrid(this.ac, this.doorOpen, this.occupied); }
  fixtureDist(f, who = this.player) { const dx = Math.max(0, Math.abs(who.x - f.x) - f.w / 2), dy = Math.max(0, Math.abs(who.y - f.y) - f.d / 2); return Math.hypot(dx, dy); }

  nearestPassenger(maxDx = 0.85, maxDy = 2.6) {
    let best = null, bd = 1e9;
    for (const seat of Object.keys(this.mood)) {
      if (!this.isSeated(seat)) continue;
      const s = findSeat(this.ac, seat); if (!s) continue;
      const dx = Math.abs(this.player.x - s.x), dy = Math.abs(this.player.y - s.y);
      if (dx > maxDx || dy > maxDy) continue;
      const d = dx * 2 + dy;
      if (d < bd) { bd = d; best = s; }
    }
    return best;
  }
  passengerInRange(seat) { const s = findSeat(this.ac, seat); return s && Math.abs(this.player.x - s.x) <= 0.85 && Math.abs(this.player.y - s.y) <= 2.6; }

  // 目前位置可執行的動作（第一個為按 E 的預設動作）
  availableActions() {
    if (this.binView) return this.binActions();
    const acts = [];
    const pl = this.player;
    this.interactables().forEach((t) => acts.push({ id: 'task:' + t.def.id, label: t.def.title, run: () => this.interact(t), task: true }));
    // 組員座椅
    if (pl.seated) {
      if (pl.belted) acts.push({ id: 'unbelt', label: '解開安全帶', run: () => this.setBelt(false) });
      else { acts.push({ id: 'belt', label: '繫上安全帶', run: () => this.setBelt(true) }); acts.push({ id: 'stand', label: '從組員座椅站起來', run: () => this.standFromSeat() }); }
      return acts;
    }
    for (const f of this.ac.fixtures) {
      const d = this.fixtureDist(f);
      if (f.type === 'jumpseat' && d < 0.95) acts.push({ id: 'sit:' + f.id, label: `坐上組員座椅（${f.label || '組員座'}）`, run: () => this.sitAt(f) });
      if (f.type === 'lav') {
        const lr = lavLayout(f, this.ac);
        const inside = this.inLav(f);
        if (inside || Math.hypot(pl.x - lr.door.x, pl.y - lr.door.y) < 0.95) {
          const open = this.doorOpen[f.id];
          acts.push({ id: 'lav:' + f.id, label: open ? '關上洗手間門' : '打開洗手間門', run: () => this.toggleDoor(f) });
          if (open && !inside) acts.push({ id: 'lavin:' + f.id, label: '走進洗手間', run: () => this.walkTo(lr.inside) });
          if (inside) acts.push({ id: 'lavchk:' + f.id, label: '檢查洗手間（煙霧偵測器、垃圾桶、備品）', run: () => this.checkLav(f) });
          if (inside && open) acts.push({ id: 'lavout:' + f.id, label: '走出洗手間', run: () => this.walkTo({ x: lr.door.x, y: lr.door.y }) });
        }
      }
      if (f.type === 'crewrest') {
        const r = roomLayout(f, this.ac);
        const nearDoor = Math.hypot(pl.x - r.door.x, pl.y - r.door.y) < 1.1 || this.insideRoom(f);
        if (nearDoor) acts.push({ id: 'rest:' + f.id, label: this.doorOpen[f.id] ? '關上組員休息室門' : '打開組員休息室門', run: () => this.toggleDoor(f) });
        if (this.insideRoom(f)) acts.push({ id: 'nap:' + f.id, label: '在休息室稍作休息', run: () => this.restInRoom() });
      }
      if (f.type === 'cockpit') {
        const r = roomLayout(f, this.ac);
        if (Math.hypot(pl.x - r.door.x, pl.y - r.door.y) < 1.2 || this.insideRoom(f)) {
          const inside = this.insideRoom(f);
          if (this.doorOpen[f.id]) acts.push({ id: 'ckclose', label: '關上駕駛艙門', run: () => this.closeCockpit(f) });
          else if (inside) acts.push({ id: 'ckleave', label: '開門離開駕駛艙', run: () => this.leaveCockpit(f) });
          else acts.push({ id: 'ckask', label: '請求進入駕駛艙', run: () => { this.modalOpen = true; this.hooks.onCockpit && this.hooks.onCockpit(); } });
          if (inside && !this.arresting) acts.push({ id: 'cktouch', label: '操作駕駛艙設備（推力桿、儀表按鈕）', run: () => this.touchCockpitControls() });
        }
      }
    }
    // 推餐車到駕駛艙詢問駕駛員
    const ckf = this.cockpitFixture();
    if (ckf && this.cart.state === 'out') {
      const r = roomLayout(ckf, this.ac);
      if (Math.hypot(pl.x - r.door.x, pl.y - r.door.y) < 1.4 || this.insideRoom(ckf)) acts.unshift({ id: 'pilotsvc', label: '詢問機長與副駕駛要不要用餐、喝飲料', run: () => this.pilotServiceStart(ckf), task: true });
    }
    // 餐車
    const gal = this.galleyFixture();
    if (gal && this.cart.state === 'stowed' && this.fixtureDist(gal) < 1.3) acts.push({ id: 'cart:' + gal.id, label: '推出餐車', run: () => this.pushCart() });
    if (this.cart.state === 'out') {
      if (this.cart.home && Math.hypot(pl.x - this.cart.home.x, pl.y - this.cart.home.y) < 1.6) acts.push({ id: 'stow', label: '推回廚房並固定餐車', run: () => this.stowCart() });
      const srow = this.rows.find((r) => Math.abs(r.x - pl.x) < 0.6 && this.rowUnserved(r).length);
      if (srow) acts.unshift({ id: 'serve:' + srow.row, label: `為第 ${srow.row} 排旅客送餐（${this.rowUnserved(srow).length} 位）`, run: () => this.openService(srow), task: true });
    }
    // 行李櫃（伸手可及：同側、前後 0.8 m 內）
    const reach = this.binsInfo.doors.filter((b) => pl.x > b.x0 - 0.3 && pl.x < b.x1 + 0.3 && Math.abs(pl.y - b.edgeY) < 1.45 && (pl.y - b.edgeY) * b.face > -0.2)
      .sort((a, b) => Math.abs(pl.x - a.x) + Math.abs(pl.y - a.side * 2) * 0.1 - (Math.abs(pl.x - b.x) + Math.abs(pl.y - b.side * 2) * 0.1));
    reach.slice(0, 2).forEach((b) => {
      const side = b.center ? `中間${b.side < 0 ? '左' : '右'}` : b.side < 0 ? '左' : '右';
      if (this.binOpen[b.id]) {
        const n = this.messyBags(b.id);
        acts.push({ id: b.id, label: `整理${side}側行李櫃${n ? `（${n} 件沒放好）` : ''}`, run: () => this.enterBinView(b) });
        acts.push({ id: 'close:' + b.id, label: `把${side}側行李櫃往上推關上`, run: () => this.toggleBin(b) });
      } else acts.push({ id: b.id, label: `打開${side}側行李櫃`, run: () => this.enterBinView(b) });
    });
    // 地上的掉落物
    this.spills.forEach((sp) => { if (Math.hypot(pl.x - sp.x, pl.y - sp.y) < 1.1) acts.unshift({ id: 'clean:' + sp.id, label: '清理地上的飲料與杯子', run: () => this.cleanSpill(sp), task: true }); });
    // 氧氣面罩（站在該排走道上）
    const row = this.rows.find((r) => Math.abs(r.x - pl.x) < 0.45);
    if (row && !this.oxygen[row.row]) acts.push({ id: 'oxy:' + row.row, label: `拉下第 ${row.row} 排氧氣面罩`, run: () => this.dropOxygen(row) });
    // 旅客交談
    const s = this.nearestPassenger();
    if (s && !acts.some((a) => a.task)) acts.push({ id: 'chat:' + s.id, label: `與 ${s.id} 旅客交談`, run: () => this.openChat(s.id) });
    return acts.slice(0, 6);
  }

  inLav(f) { const r = lavLayout(f, this.ac).rect(-0.5, 0.5, -0.5, 0.5); const b = { x0: f.x - f.w / 2, x1: f.x + f.w / 2, y0: f.y - f.d / 2, y1: f.y + f.d / 2 }; return this.player.x > b.x0 && this.player.x < b.x1 && this.player.y > b.y0 && this.player.y < b.y1; }
  currentLav() { return this.ac.fixtures.find((f) => f.type === 'lav' && this.inLav(f)); }
  insideRoom(f) {
    const r = roomLayout(f, this.ac), pl = this.player;
    if (f.type === 'cockpit') return pl.x < f.x + f.w / 2;
    return r.inside && pl.x > r.inside.x0 - 0.05 && pl.x < r.inside.x1 + 0.05 && pl.y > r.inside.y0 - 0.05 && pl.y < r.inside.y1 + 0.05;
  }

  // ---- 組員座椅 ----
  sitAt(f) {
    this.player.path = [];
    this.player.seatReturn = { x: this.player.x, y: this.player.y };
    this.player.x = f.x; this.player.y = f.y;
    this.player.seated = true; this.player.seatedFixture = f.id;
    this.say('系統', '已坐上組員座椅。記得繫上安全帶與肩帶。', 'info');
  }
  setBelt(on) {
    if (!this.player.seated) return;
    if (!on && this.critical() && !this.ended) this.violation(`${this.phase.name}期間解開安全帶`, 'unbelt');
    this.player.belted = on;
    if (on) this.say('系統', '安全帶與肩帶已繫好。', 'good');
    this.hooks.onTaskChange && this.hooks.onTaskChange();
  }
  standFromSeat() {
    if (this.player.belted) { this.hint('請先解開安全帶再起身。', 'belt'); return; }
    this.standUp();
  }

  // ---- 門 ----
  toggleDoor(f) {
    const open = !this.doorOpen[f.id];
    if (f.type === 'lav' && open && this.critical()) this.violation(`${this.phase.name}期間在客艙走動並開啟洗手間`, 'lav');
    this.doorOpen[f.id] = open;
    this.rebuildGrid();
    // 關門時若站在門板位置，往門外或門內讓開
    if (!open && collides(this.grid, this.player.x, this.player.y)) {
      if (f.type === 'lav') { const lr = lavLayout(f, this.ac); const toIn = Math.hypot(this.player.x - lr.inside.x, this.player.y - lr.inside.y) < Math.hypot(this.player.x - lr.door.x, this.player.y - lr.door.y); Object.assign(this.player, toIn ? lr.inside : { x: lr.door.x, y: lr.door.y }); }
      else { const p = approachPoint(this.ac, this.grid, this.player); this.player.x = p.x; this.player.y = p.y; }
    }
  }
  checkLav(f) {
    this.lavChecked[f.id] = this.totalT;
    const occupied = this.phase.id === 'cruise' && Math.random() < 0.15;
    this.say('系統', occupied ? '洗手間有人使用中，稍後再來檢查。' : '洗手間檢查完成：煙霧偵測器正常、無異味、備品充足。', occupied ? 'info' : 'good');
  }
  restInRoom() {
    if (this.phase.id !== 'cruise') { this.say(this.judgeName('senior'), '現在不是休息時間，巡航時才能輪休喔。', 'warn'); return; }
    const urgent = this.activeTasks().find((t) => t.status === 'active' && t.def.priority <= 2);
    if (urgent) { this.say(this.judgeName('senior'), `還有「${urgent.def.title}」要處理，先別休息！`, 'warn'); return; }
    this.say('系統', '你在休息室喝了口水，稍作休息。輪休時間請留意客艙呼叫。', 'good');
  }

  // ---- 駕駛艙 ----
  cockpitFixture() { return this.ac.fixtures.find((f) => f.type === 'cockpit'); }
  cockpitRequest(choice) {
    this.modalOpen = false;
    const f = this.cockpitFixture(); if (!f) return { speaker: '', text: '' };
    const ph = this.phase.id;
    const sterile = ['pushback', 'taxi', 'takeoff', 'climb', 'descent', 'landing'].includes(ph);
    let speaker = PILOTS.captain, text = '', tone = 'info';
    if (choice === 'procedure') {
      if (sterile) { text = `現在是${this.phase.name}階段，駕駛艙保持淨空（Sterile Cockpit），不能開門。有緊急狀況請直接用內線報告。`; tone = 'warn'; }
      else if (this.cockpit.insist >= 2) { text = '你剛剛的行為已經被記錄，這次不開門，請回客艙。'; tone = 'warn'; }
      else {
        text = '收到，已確認客艙與走道淨空，開門。請盡快完成，進出後確實關門。';
        this.doorOpen[f.id] = true; this.rebuildGrid(); tone = 'good';
      }
    } else if (choice === 'noreason') {
      this.cockpit.insist += 1;
      text = this.cockpit.insist >= 2 ? '沒有正當理由不能開門。再這樣我會通報座艙長。' : '請問有什麼事？沒有必要請不要進來，有事用內線電話說明。';
      tone = 'warn';
    } else if (choice === 'force') {
      this.cockpit.insist += 2;
      if (this.cockpit.insist >= 4) { this.arrest(); return { speaker: PILOTS.captain, text: '我已經通報空安人員與座艙長，請立刻離開駕駛艙門！', tone: 'bad' }; }
      text = '請立刻停止！這是最後警告，再強行要求進入，我會通報空安人員。'; tone = 'bad';
      this.violation('沒有正當理由強行要求進入駕駛艙', 'cockpit');
    } else text = '好的。';
    this.say(speaker, text, tone);
    return { speaker, text, tone };
  }
  closeCockpit(f) { this.doorOpen[f.id] = false; this.rebuildGrid(); if (collides(this.grid, this.player.x, this.player.y)) { const p = approachPoint(this.ac, this.grid, { x: f.x + f.w / 2 + 0.5, y: 0 }); this.player.x = p.x; this.player.y = p.y; } this.say(PILOTS.fo, '駕駛艙門已關閉上鎖，謝謝。', 'good'); }
  arrest(fromInside) {
    if (this.arresting) return;
    const pl = this.player, ck = this.cockpitFixture();
    const inside = ck && this.insideRoom(ck);
    this.arresting = { t: 0, inside };
    if (inside) { this.doorOpen[ck.id] = true; this.rebuildGrid(); }
    const r = ck ? roomLayout(ck, this.ac) : null;
    const base = r ? { x: r.door.x + 2.4, y: 0 } : { x: pl.x + 2.5, y: 0 };
    const mk = (id, name, color, dx) => {
      const st = approachPoint(this.ac, this.grid, { x: base.x + dx, y: 0 });
      const n = { id, name, color, x: st.x, y: st.y, path: [], task: { def: { title: '制止' } }, special: true, rush: true };
      n.path = findPath(this.grid, n, pl);
      this.npcs.push(n);
      return n;
    };
    mk('security', '空安人員', '#1c1f26', 0);
    mk('purser2', this.sc.npc.purser || '座艙長', '#c9a227', 0.9);
    this.say('空安人員', inside ? '駕駛艙發生狀況！開門！不要動，把手放在我看得到的地方！' : '不要動！把手放在我看得到的地方！', 'bad');
    this.hooks.onArrest && this.hooks.onArrest();
  }
  failFlight(reason) {
    if (this.ended) return;
    this.ended = true;
    const r = this.finish(true);
    r.failed = true; r.reason = reason; r.grade = 'F'; r.xp = 0;
    this.hooks.onEnd && this.hooks.onEnd(r);
  }

  // ---- 行李櫃 ----
  toggleBin(b) {
    const open = !this.binOpen[b.id];
    if (!open && this.messyBags(b.id)) { this.hint(`櫃內有 ${this.messyBags(b.id)} 件行李突出，櫃門關不上，先把行李推到底擺正。`, 'binmessy'); return; }
    if (open) {
      if (this.movingPhase()) this.violation(`${this.phase.name}期間開啟行李櫃`, 'bin');
      else if (this.env.turbulence > 0) this.violation('亂流期間開啟行李櫃', 'bin');
    }
    this.binOpen[b.id] = open;
    if (!open) { this.stats.binsClosed = (this.stats.binsClosed || 0) + 1; delete this.binJobs[b.id]; }
  }
  // ---- 氧氣面罩 ----
  dropOxygen(row) {
    this.oxygen[row.row] = true;
    this.violation(`在沒有失壓的情況下拉下第 ${row.row} 排氧氣面罩，造成旅客恐慌`, 'oxy' + row.row);
    row.seats.forEach((s) => { if (this.mood[s.id] != null) this.mood[s.id] = Math.max(0, this.mood[s.id] - 18); });
    this.say('旅客', '怎麼了？！是不是出事了？', 'bad');
  }

  // 起降開始時的客艙狀態檢查
  checkCabinSecured() {
    const name = this.phase.name;
    if (this.phase.id !== 'descent') {
      const openBins = Object.values(this.binOpen).filter(Boolean).length;
      if (openBins) this.violation(`${name}時仍有 ${openBins} 個行李櫃未關閉`, 'binsec');
      const lavs = this.ac.fixtures.filter((f) => f.type === 'lav' && this.doorOpen[f.id]).length;
      if (lavs) this.violation(`${name}時洗手間門未關閉`, 'lavsec');
    }
    if (this.cart && this.cart.state === 'out') { this.violation(`${name}時餐車未收回固定`, 'cartsec'); this.stowCart(); }
    if (this.phase.id === 'descent') return;
    const ck = this.cockpitFixture();
    if (ck && this.doorOpen[ck.id]) { this.violation(`${name}時駕駛艙門未關閉`, 'cksec'); this.doorOpen[ck.id] = false; this.rebuildGrid(); }
  }

  // 3D 點選物件：在範圍內直接執行，太遠則先走過去
  actOnProp(id) {
    if (id.startsWith('bag|')) {
      const [, doorId, idx] = id.split('|');
      if (this.binView === doorId) { this.tidyBag(doorId, +idx); return; }
      const d = this.binDoor(doorId);
      const a = d && this.availableActions().find((x) => x.id === d.id);
      if (a) { this.enterBinView(d); return; }
      if (d) { this.walkTo(binSpot(d, 0.4)); this.pendingProp = d.id; }
      return;
    }
    const f = this.ac.fixtures.find((x) => x.id === id);
    const keys = [id, 'lav:' + id, 'rest:' + id, 'sit:' + id];
    if (f && f.type === 'cockpit') keys.push('ckask', 'ckclose');
    const a = this.availableActions().find((x) => keys.includes(x.id));
    if (a) { this.pendingProp = null; a.run(); return; }
    if (this.pendingProp === id && !this.player.path.length) { this.pendingProp = null; this.hint('距離太遠或目前無法操作。', 'prop'); return; }
    let target = null;
    const b = this.binsInfo.doors.find((d) => d.id === id);
    if (b) target = binSpot(b, 0.4);
    if (f) target = f.type === 'lav' ? (() => { const r = lavLayout(f, this.ac); return { x: r.door.x, y: r.door.y }; })() : (f.type === 'cockpit' || f.type === 'crewrest') ? (() => { const r = roomLayout(f, this.ac); return { x: r.door.x, y: r.door.y }; })() : approachPoint(this.ac, this.grid, f);
    if (target) { this.walkTo(target); this.pendingProp = id; }
  }

  // ---- 旅客交談（沒有任務時也能互動） ----
  openChat(seat) {
    if (!this.isSeated(seat)) { this.say(`旅客（${seat}）`, '我還在找座位，等一下喔。', 'info'); return; }
    if (!this.passengerInRange(seat)) { const s = findSeat(this.ac, seat); this.walkTo(approachPoint(this.ac, this.grid, s)); this.pendingChat = seat; return; }
    this.modalOpen = true;
    const call = this.calls[seat]; this.clearCall(seat);
    const info = this.chatOptions(seat);
    if (call && call.reason) { info.call = call.reason; info.options.unshift({ text: `（關掉服務鈴）「您好，請問有什麼需要？」`, mood: 6, patience: 8, reply: `謝謝你這麼快就來了，我${call.reason}。`, }); }
    this.hooks.onChat && this.hooks.onChat(seat, info);
  }
  chatOptions(seat) {
    const p = this.sc.passengers.find((x) => x.seat === seat) || { type: 'normal' };
    const ph = this.phase.id, belt = this.env.seatbelt, serviceOk = (ph === 'cruise' || ph === 'climb') && !belt;
    const st = this.pax[seat] || { patience: 70, lastChat: -999 };
    const recent = this.totalT - st.lastChat < 40;
    const O = (text, mood, patience, reply, extra = {}) => ({ text, mood, patience, reply, ...extra });
    const opts = [];
    opts.push(recent ? O('「不好意思，再跟您確認一下……」', -6, -15, '你剛剛不是才問過嗎？讓我休息一下好嗎。') : O('「您好，旅途還舒適嗎？」', 4, 2, '還不錯，謝謝。'));
    if (ph === 'boarding') opts.push(O('「需要我幫您放置行李嗎？」', ['elder', 'mobility', 'child'].includes(p.type) ? 12 : 5, 4, '太好了，謝謝你！'));
    if (belt && ph !== 'boarding' && ph !== 'deplane') opts.push(O('「安全帶指示燈亮著，請您繫好安全帶。」', 1, 0, '好的，已經繫好了。'));
    else if (!belt) opts.push(O('「提醒您入座時請繫好安全帶。」', -1, -2, '燈不是熄了嗎？好啦好啦。'));
    if (serviceOk) {
      opts.push(O('「請問需要飲料或點心嗎？」', 8, 6, '給我一杯水就好，謝謝。'));
      opts.push(O('「需要毛毯或枕頭嗎？」', 6, 4, '好啊，有點冷，謝謝。'));
    } else if (['taxi', 'takeoff', 'landing', 'pushback'].includes(ph)) {
      opts.push(O('「現在幫您送一杯飲料。」', 2, 0, '現在可以嗎？飛機還在動耶……', { violation: `${this.phase.name}期間提供餐飲服務` }));
    }
    if (p.type === 'anxious') opts.push(O('「別擔心，這是正常的聲音和氣流，我就在附近，有需要隨時按服務鈴。」', 14, 10, '……謝謝你，我好多了。'));
    if (p.type === 'child') opts.push(O('「小朋友，送你一份兒童禮品，要乖乖繫好安全帶喔！」', 12, 8, '（開心地拆禮物）謝謝姊姊！'));
    if (p.type === 'elder' || p.type === 'mobility') opts.push(O('「需要協助您去洗手間或調整座椅嗎？」', serviceOk ? 10 : 3, 6, serviceOk ? '麻煩你了，真是貼心。' : '等安全帶燈熄了再麻煩你。'));
    if (p.type === 'meal') opts.push(O('「跟您確認，您預訂的是素食餐，對嗎？」', 7, 4, '對，謝謝你記得。'));
    if (p.type === 'vip') opts.push(O('「感謝您長期支持，有任何需要隨時告訴我。」', 7, 4, '服務很周到，我會記得的。'));
    if (p.type === 'medical') opts.push(O('「您看起來有點不舒服，需要溫水或讓我幫您看看嗎？」', 10, 8, '有點頭暈……謝謝你注意到。'));
    if (p.type === 'drunk') {
      if (serviceOk) opts.push(O('「再為您送一杯威士忌。」', 6, 4, '這才對嘛！', { violation: '對已飲酒過量的旅客繼續提供酒精' }));
      opts.push(O('「先生，我先為您送上溫水，休息一下好嗎？」', 3, 2, '……好啦，水也行。'));
    }
    opts.push(O('（不耐煩）「又有什麼事？」', -18, -25, '你這是什麼態度？我要客訴！'));
    opts.push(O('「打擾了，有需要請按服務鈴。」', 0, 0, '好的。'));
    return { passenger: p, mood: this.mood[seat] ?? 70, patience: Math.round(st.patience), options: opts };
  }
  resolveChat(seat, opt) {
    this.modalOpen = false;
    const st = this.pax[seat] || (this.pax[seat] = { patience: 70, lastChat: -999, chats: 0 });
    const low = st.patience < 30;
    let dm = opt.mood || 0;
    if (low && dm > 0) dm = Math.round(dm * 0.5);
    if (low && dm < 0) dm *= 2;
    this.mood[seat] = Math.max(0, Math.min(100, (this.mood[seat] ?? 70) + dm));
    st.patience = Math.max(0, Math.min(100, st.patience + (opt.patience || 0)));
    st.lastChat = this.totalT; st.chats++;
    if (opt.violation) this.violation(opt.violation, 'chat:' + opt.violation);
    const reply = low && dm <= 0 ? '（嘆氣）我已經等很久了……' : opt.reply;
    this.say(`旅客（${seat}）`, reply, dm > 0 ? 'good' : dm < 0 ? 'bad' : 'info');
    return { reply, mood: this.mood[seat], patience: Math.round(st.patience) };
  }


  // =================== 餐車與餐飲服務 ===================
  initService() {
    const galley = findFixture(this.ac, 'galley', this.player);
    this.cart = { state: 'stowed', dir: 1, x: 0, y: 0, turbT: 0 };
    if (galley) {
      const W = this.ac.width;
      let fx = 0, fy = 0;
      if (Math.abs(galley.y) > 0.3 && galley.d < W * 0.8) fy = galley.y < 0 ? 1 : -1; else fx = galley.x < this.ac.length / 2 ? 1 : -1;
      this.cart.home = { x: galley.x + fx * (galley.w / 2 + 0.17), y: galley.y + fy * (galley.d / 2 + 0.17) };
      this.cart.galleyId = galley.id;
      Object.assign(this.cart, this.cart.home);
    }
    const seats = Object.keys(this.mood);
    const count = (t) => this.sc.passengers.filter((p) => seats.includes(p.seat) && p.type === t).length;
    const n = seats.length;
    this.service = {
      served: {}, correct: 0, total: 0, errors: [], prefs: {},
      stock: { beef: Math.ceil(n * 0.42), chicken: Math.ceil(n * 0.6), veg: count('meal'), kids: count('child') },
      target: Math.max(4, Math.min(18, Math.ceil(n * 0.55))),
    };
    const drinksW = [['water', 3], ['oj', 2], ['apple', 1], ['coke', 2], ['coffee', 2], ['tea', 2], ['beer', 1], ['wine', 1]];
    seats.forEach((seat) => {
      const p = this.sc.passengers.find((x) => x.seat === seat) || { type: 'normal' };
      let hh = 0; for (const ch of seat + (p.name || '')) hh = (hh * 31 + ch.charCodeAt(0)) >>> 0;
      const r = () => { hh = (hh * 1103515245 + 12345) >>> 0; return (hh >>> 8) / 16777216; };
      let meal, drink;
      if (p.type === 'meal') meal = 'veg';
      else if (p.type === 'child') meal = 'kids';
      else if (p.type === 'drunk') meal = 'any';
      else { const x = r(); meal = x < 0.1 ? 'none' : x < 0.62 ? 'beef' : 'chicken'; }
      if (p.type === 'drunk') drink = 'beer';
      else if (p.type === 'child') drink = r() < 0.5 ? 'oj' : 'apple';
      else if (p.type === 'elder') drink = 'tea';
      else if (p.type === 'anxious' || p.type === 'medical') drink = 'water';
      else { let x = r() * 14; drink = drinksW.find(([, w]) => (x -= w) < 0)[0]; }
      this.service.prefs[seat] = { meal, drink, saysSpecial: r() < 0.5 };
    });
  }
  galleyFixture() { return this.ac.fixtures.find((f) => f.id === this.cart.galleyId); }
  pushCart() {
    if (this.cart.state === 'out') return;
    if (this.movingPhase()) this.violation(`${this.phase.name}期間推出餐車`, 'cartphase');
    else if (this.env.seatbelt && this.phase.id !== 'boarding') this.violation('安全帶指示燈亮著時推出餐車', 'cartbelt');
    this.cart.state = 'out';
    const mid = this.rows[Math.floor(this.rows.length / 2)];
    this.cart.dir = mid && mid.x < this.player.x ? -1 : 1;
    this.updateCart(true);
    this.say('系統', '餐車已推出（煞車放開）。推車時移動較慢；走到每一排旁按 E 開始詢問旅客。', 'info');
    const t = this.tasks.find((k) => k.status === 'active' && k.def.kind === 'cart');
    if (t) this.complete(t, 100, null);
  }
  stowCart() {
    this.cart.state = 'stowed'; Object.assign(this.cart, this.cart.home); this.cart.turbT = 0; this.cart.lost = 0;
    this.say('系統', '餐車已推回廚房並踩下煞車固定。', 'good');
  }
  updateCart(force, movedDx = 0, movedDy = 0) {
    if (this.cart.state !== 'out') return;
    if (Math.abs(movedDx) > 0.002 && Math.abs(movedDx) > Math.abs(movedDy)) this.cart.dir = Math.sign(movedDx);
    this.cart.x = this.player.x + this.cart.dir * 0.62; this.cart.y = this.player.y;
  }
  rowUnserved(row) {
    return row.seats.filter((s) => this.mood[s.id] != null && this.isSeated(s.id) && !this.service.served[s.id] && this.passengerInRange(s.id));
  }
  openService(row) {
    const list = this.rowUnserved(row);
    if (!list.length) return;
    this.modalOpen = true;
    this.hooks.onService && this.hooks.onService({ row: row.row, seats: list.map((s) => s.id) });
  }
  // 送餐時機是否恰當
  serviceTiming() {
    const id = this.phase.id;
    if (this.env.turbulence > 0) return { key: 'turb', what: '亂流中', pax: '飛機晃成這樣你還在送餐？湯灑出來怎麼辦！', scold: '亂流中還在送餐？！熱湯、熱飲會燙傷旅客，立刻停止服務、把餐車收回去固定！' };
    if (['descent', 'landing'].includes(id)) return { key: 'desc', what: '下降階段', pax: '不是快降落了嗎？現在發餐我也來不及吃啊。', scold: '都已經開始下降了還在發餐！要收餐盤、做落地前檢查了，快把餐車推回去！' };
    if (['pushback', 'taxi', 'takeoff'].includes(id)) return { key: 'ground', what: `${this.phase.name}期間`, pax: '飛機還在動耶，現在可以吃東西嗎？', scold: `${this.phase.name}期間怎麼可以送餐？組員應該要就座或做安全檢查！` };
    if (this.env.seatbelt && id !== 'boarding' && id !== 'deplane') return { key: 'belt', what: '安全帶燈亮著時', pax: '安全帶燈還亮著，現在吃東西沒關係嗎？', scold: '安全帶燈還沒熄就開始服務，要等機長通知可以服務才行！' };
    return null;
  }
  pauseServiceAt(seat) {
    const bad = this.serviceTiming();
    const st = this.pax[seat]; if (st) st.patience = Math.max(0, st.patience - 3);
    this.say(`旅客（${seat}）`, '好的，那我等一下。', 'info');
    if (bad) this.say(this.judgeName('senior'), '判斷正確，先暫停服務，等狀況解除再繼續。', 'good');
    return bad;
  }
  serviceRequest(seat) {
    const pr = this.service.prefs[seat];
    const p = this.sc.passengers.find((x) => x.seat === seat) || {};
    const dn = (DRINKS.find((d) => d.id === pr.drink) || {}).name;
    const mn = (MEALS.find((m) => m.id === pr.meal) || {}).name;
    let text;
    if (pr.meal === 'none') text = `我不用餐，謝謝。給我一杯${dn}就好。`;
    else if (pr.meal === 'veg') text = pr.saysSpecial ? `我有預訂素食餐喔。飲料要${dn}。` : `今天有什麼可以選？飲料給我${dn}。`;
    else if (pr.meal === 'kids') text = `（家長）小朋友有預訂兒童餐，飲料要${dn}。`;
    else if (pr.meal === 'any') text = '吃什麼都好啦！給我一罐啤酒！快點！';
    else text = `請給我${mn}，飲料要${dn}。`;
    const bad = this.serviceTiming();
    if (bad) text = bad.pax + ' ……' + text;
    return { seat, name: p.name || '旅客', type: p.type || 'normal', note: p.note || '', text, bad };
  }
  servePassenger(seat, meal, drink, apologized) {
    this.modalOpen = true;
    const pr = this.service.prefs[seat], st = this.service.stock;
    const p = this.sc.passengers.find((x) => x.seat === seat) || {};
    let dm = 0, ok = true; const notes = [];
    const special = (id) => (MEALS.find((m) => m.id === id) || {}).special;
    // 餐點
    if (pr.meal === 'none') { if (meal !== 'none') { dm -= 2; notes.push('我說不用餐了。'); } }
    else if (special(pr.meal)) {
      if (meal === pr.meal) { dm += 9; notes.push('謝謝，特殊餐沒有弄錯。'); }
      else { dm -= 18; ok = false; notes.push(`這不是我預訂的${(MEALS.find((m) => m.id === pr.meal) || {}).name}！`); this.service.errors.push(`${seat} 特殊餐送錯`); }
    } else if (pr.meal === 'any') { if (meal === 'none' || special(meal)) { dm -= 3; ok = special(meal) ? false : ok; } else dm += 3; }
    else if (meal === pr.meal) { dm += 6; }
    else if (meal !== 'none' && (st[pr.meal] || 0) <= 0) {
      if (apologized) { dm -= 1; notes.push(pr.meal === 'beef' ? '牛肉麵送完了啊？好吧，雞肉飯也可以。' : '雞肉飯送完了啊？好吧，牛肉麵也可以。'); }
      else { dm -= 8; ok = false; notes.push('我要的不是這個，也不先說一聲？'); }
    } else { dm -= 10; ok = false; notes.push('我點的不是這個。'); }
    if (meal !== 'none' && special(meal) && meal !== pr.meal) { this.service.errors.push(`把${(MEALS.find((m) => m.id === meal) || {}).name}給了 ${seat}`); ok = false; }
    if (meal !== 'none') st[meal] = Math.max(0, (st[meal] || 0) - 1);
    // 飲料
    const d = DRINKS.find((x) => x.id === drink) || {};
    if (p.type === 'drunk' && d.alcohol) { this.violation('對飲酒過量的旅客提供酒精飲料', 'drunkbeer'); dm += 2; ok = false; }
    else if (p.type === 'drunk' && !d.alcohol) { dm -= 1; notes.push('……水？好吧。'); }
    else if (drink === pr.drink) dm += 4;
    else { dm -= 4; ok = false; notes.push('飲料好像拿錯了。'); }
    if (d.hot && this.env.turbulence > 0) this.violation('亂流期間提供熱飲', 'hotdrink');
    const bad = this.serviceTiming();
    if (bad) {
      dm -= 6; ok = false;
      notes.unshift(bad.key === 'turb' ? '（餐盤在桌上滑動）小心一點！' : bad.key === 'desc' ? '要降落了我還吃得完嗎……' : '這時候送餐真的可以嗎？');
      this.violation(`${bad.what}送餐`, 'servebad' + bad.key);
      this.say(this.judgeName('senior'), bad.scold, 'bad');
    }
    if (!bad && meal !== 'none' && special(meal) && meal !== pr.meal) this.say(this.judgeName('senior'), '特殊餐一定要先核對名單和座位！送錯會引起客訴，甚至過敏問題。', 'bad');
    if (p.type === 'drunk' && d.alcohol) this.say(this.judgeName('senior'), '他已經喝醉了你還給酒？出事要負責的是我們！', 'bad');
    this.mood[seat] = Math.max(0, Math.min(100, (this.mood[seat] ?? 70) + dm));
    this.service.served[seat] = { meal, drink };
    (this.serveEvents || (this.serveEvents = [])).push({ seat, meal, drink });
    this.service.total++; if (ok) this.service.correct++;
    const reply = notes.length ? notes.join(' ') : (dm > 0 ? '謝謝你！' : '嗯。');
    this.say(`旅客（${seat}）`, reply, dm > 0 ? 'good' : dm < 0 ? 'bad' : 'info');
    return { reply, ok, mood: this.mood[seat], dm };
  }


  // =================== 行李櫃內行李與整理 ===================
  initBins() {
    this.binBags = {}; this.binVersion = 0; this.binView = null; this.tidyEvents = [];
    this.binsInfo.doors.forEach((d) => { this.binOpen[d.id] = true; }); // 登機前行李櫃全部打開
    this.stats.tidied = 0;
    let k = 0;
    this.binsInfo.doors.forEach((d) => {
      this.binBags[d.id] = [];
      if ((k++ * 7) % 5 === 0) this.binBags[d.id].push({ tidy: true, col: BAG_COLORS[k % BAG_COLORS.length], seed: k });
    });
  }
  binDoor(id) { return this.binsInfo.doors.find((d) => d.id === id); }
  messyBags(id) { return (this.binBags[id] || []).filter((b) => !b.tidy).length; }
  enterBinView(b) {
    if (!this.binOpen[b.id]) this.toggleBin(b);
    if (!this.binOpen[b.id]) return;
    this.binView = b.id; this.player.path = [];
    const spot = binSpot(b, 0.35);
    if (!collides(this.grid, spot.x, spot.y)) Object.assign(this.player, spot);
    const n = this.messyBags(b.id);
    this.say('系統', n ? `櫃內有 ${n} 件行李沒放好。用滑鼠抓住行李：左鍵＝左手、右鍵＝右手，往上拖把行李推進去，左右拖把它擺正。` : '行李都放好了，可以把櫃門往上推關上。', 'info');
  }
  exitBinView() { this.binView = null; }
  // 滑鼠操作行李：push 0→1 往櫃內推、skew 歪斜程度（0 為擺正）
  handleBag(doorId, idx, dPush, dSkew) {
    const bag = (this.binBags[doorId] || [])[idx];
    if (!bag || bag.tidy) return;
    if (bag.push == null) { bag.push = 0; bag.skew = idx % 2 ? 1 : -1; }
    bag.push = Math.max(0, Math.min(1, bag.push + dPush));
    bag.skew = Math.max(-1.2, Math.min(1.2, bag.skew + dSkew));
    if (bag.push >= 1 && Math.abs(bag.skew) < 0.22) this.tidyBag(doorId, idx);
    else if (bag.push >= 1 && !bag.warned) { bag.warned = true; this.hint('行李還歪著，左右拖曳把它擺正。', 'skew'); }
  }
  tidyBag(doorId, idx) {
    const bag = (this.binBags[doorId] || [])[idx];
    if (!bag || bag.tidy) return;
    bag.tidy = true; this.binVersion++; this.stats.tidied++;
    this.tidyEvents.push({ doorId, idx });
    if (!this.messyBags(doorId)) this.say('系統', '這格行李都擺好了，可以關上櫃門。', 'good');
  }
  binActions() {
    const id = this.binView, b = this.binDoor(id), acts = [];
    (this.binBags[id] || []).forEach((bag, i) => { if (!bag.tidy) acts.push({ id: `tidy|${i}`, label: `直接整理第 ${i + 1} 件行李`, run: () => this.tidyBag(id, i), task: true }); });
    acts.push({ id: 'binclose', label: '把櫃門往上推關上', run: () => { this.toggleBin(b); if (!this.binOpen[id]) this.exitBinView(); } });
    acts.push({ id: 'binexit', label: '離開（不關門）', run: () => this.exitBinView() });
    return acts;
  }

  // =================== 登機：旅客拖著登機箱入座 ===================
  initBoarding() {
    this.boardStart = { x: this.player.x, y: this.player.y };
    this.boardDoor = findFixture(this.ac, 'L1') || this.ac.fixtures.find((f) => f.type === 'door');
    const seats = Object.keys(this.mood);
    const rowOf = (s) => parseInt(s, 10) || 0;
    const order = seats.slice().sort((a, b) => rowOf(b) - rowOf(a) + (Math.random() - 0.5) * 8); // 大致由後往前登機
    const n = Math.max(1, order.length);
    const taskSeats = {};
    this.tasks.forEach((t) => { if (t.def.phase === 'boarding' && t.def.target && t.def.target.seat) taskSeats[t.def.target.seat] = t.def.at || 0; });
    this.boarding = {};
    // 不規則的登機間隔：有時一群人（同行、家庭）緊接著上，有時隔很久才一位
    const gaps = order.map(() => { const r = Math.random(); return r < 0.25 ? 0.4 + Math.random() * 0.6 : r < 0.85 ? 1.2 + Math.random() * 2.6 : 4 + Math.random() * 5; });
    const total = gaps.reduce((a, b) => a + b, 0) || 1;
    let acc = 3;
    order.forEach((seat, i) => {
      const p = this.sc.passengers.find((x) => x.seat === seat) || {};
      acc += (gaps[i] / total) * 66;
      let t = acc;
      if (taskSeats[seat] != null) t = Math.min(t, Math.max(1, taskSeats[seat] - 16));
      const bagP = p.type === 'child' ? 0 : ['elder', 'mobility'].includes(p.type) ? 0.45 : 0.78;
      const slow = ['elder', 'mobility'].includes(p.type) ? 0.62 : p.type === 'child' ? 0.85 : 1;
      this.boarding[seat] = {
        state: 'wait', t, x: this.boardStart.x, y: this.boardStart.y, path: [], heading: 0, bag: Math.random() < bagP, col: BAG_COLORS[(i * 3 + (Math.random() * 5 | 0)) % BAG_COLORS.length], waitT: 0, said: false,
        speed: (0.68 + Math.random() * 0.42) * slow, lat: (Math.random() - 0.5) * 0.12, phase: Math.random() * 6,
        pauseAt: Math.random() < 0.45 ? 0.25 + Math.random() * 0.5 : -1, pauseT: 0, stowDur: 2.2 + Math.random() * 2.8, travelled: 0,
      };
    });
  }
  isSeated(seat) { return !this.boarding || !this.boarding[seat] || this.phaseIdx > 0 || this.boarding[seat].state === 'seated'; }
  seatAllBoarding() {
    if (!this.boarding) return;
    for (const [seat, b] of Object.entries(this.boarding)) {
      if (b.state === 'seated') continue;
      if (b.bag && b.state !== 'sit') { const d = this.findBinFor(seat); if (d) this.binBags[d.id].push({ tidy: true, col: b.col, seed: seat.length }); }
      b.state = 'seated';
    }
    this.binVersion++;
  }
  findBinFor(seat) {
    const s = findSeat(this.ac, seat); if (!s) return null;
    return this.binsInfo.doors.filter((d) => Math.abs(d.x - s.x) < 2.6 && (this.binBags[d.id] || []).length < binCapacity(d))
      .sort((a, b) => Math.abs(a.x - s.x) + Math.abs(a.bagY - s.y) * 1.5 - Math.abs(b.x - s.x) - Math.abs(b.bagY - s.y) * 1.5)[0] || null;
  }
  updateBoarding(gdt) {
    if (!this.boarding || this.phase.id !== 'boarding') return;
    for (const [seat, b] of Object.entries(this.boarding)) {
      if (b.state === 'wait') {
        if (this.phaseT < b.t) continue;
        // 艙門口還有人時先等一下，避免疊在一起
        if (Object.values(this.boarding).some((o) => o !== b && o.state === 'walk' && (Math.hypot(o.x - this.boardStart.x, o.y - this.boardStart.y) < 0.9 || Math.abs(o.y) > this.ac.width / 2 - 0.5))) continue;
        const s = findSeat(this.ac, seat);
        b.state = 'walk'; Object.assign(b, this.boardStart);
        b.dest = approachPoint(this.ac, this.grid, s);
        b.path = findPath(this.grid, b, b.dest);
        // 從艙門外的空橋走進來，再轉進走道
        const bd = this.boardDoor;
        if (bd) {
          const sg = Math.sign(bd.y) || -1, R = this.ac.width / 2;
          Object.assign(b, { x: bd.x, y: sg * (R + 0.7) });
          b.path.unshift({ x: bd.x, y: sg * (R - 0.35) }, { x: this.boardStart.x, y: this.boardStart.y });
          b.heading = Math.atan2(-sg, 0);
        }
      } else if (b.state === 'walk') {
        // 被擋住：玩家站在前方走道上
        const nx = b.path[0];
        if (nx) {
          const dx = nx.x - b.x, dy = nx.y - b.y, d = Math.hypot(dx, dy) || 1;
          const px = this.player.x - b.x, py = this.player.y - b.y, pd = Math.hypot(px, py);
          if (pd < 0.75 && (px * dx + py * dy) / d > 0.2) {
            b.waitT += gdt;
            if (b.waitT > 2.2 && !b.said) { b.said = true; this.say(`旅客（${seat}）`, '不好意思，可以借過一下嗎？', 'warn'); if (this.pax[seat]) this.pax[seat].patience -= 6; }
            continue;
          }
          b.waitT = 0;
          // 跟在前面停下來（放行李、找座位）的旅客後面排隊
          const ux = dx / d, uy = dy / d;
          const blocked = Object.entries(this.boarding).some(([s2, o]) => s2 !== seat && (o.state === 'walk' || o.state === 'stow') && (() => { const ox = o.x - b.x, oy = o.y - b.y, along = ox * ux + oy * uy; return along > 0.05 && along < 0.85 && Math.abs(ox * uy - oy * ux) < 0.35; })());
          if (blocked) { b.queued = true; continue; }
          b.queued = false;
        }
        // 偶爾停下來看座位號、整理手上的東西
        if (b.pauseAt > 0 && !b.pauseDone && b.dest && b.travelled > b.pauseAt * Math.hypot(b.dest.x - this.boardStart.x, b.dest.y - this.boardStart.y)) {
          b.pauseT += gdt; b.paused = true;
          if (b.pauseT < 1 + (b.phase % 1.5)) continue;
          b.pauseDone = true; b.paused = false;
        }
        let move = (b.speed || 0.9) * gdt * (0.85 + 0.15 * Math.sin(this.totalT * 2.3 + (b.phase || 0)));
        b.travelled = (b.travelled || 0) + move;
        while (move > 0 && b.path.length) {
          const t = b.path[0], dx = t.x - b.x, dy = t.y - b.y, d = Math.hypot(dx, dy);
          if (d < 1e-3) { b.path.shift(); continue; }
          b.heading = Math.atan2(dy, dx);
          if (d <= move) { b.x = t.x; b.y = t.y; b.path.shift(); move -= d; } else { b.x += (dx / d) * move; b.y += (dy / d) * move; move = 0; }
        }
        if (!b.path.length) {
          const s = findSeat(this.ac, seat);
          b.heading = Math.atan2(s.y - b.y, s.x - b.x);
          const door = b.bag ? this.findBinFor(seat) : null;
          if (door) { b.state = 'stow'; b.stowT = 0; b.door = door.id; if (!this.binOpen[door.id]) { this.binOpen[door.id] = true; } }
          else { if (b.bag) { b.bag = false; } b.state = 'sit'; b.sitT = 0; }
        }
      } else if (b.state === 'stow') {
        b.stowT += gdt;
        if (b.stowT > (b.stowDur || 1.8)) {
          const bags = this.binBags[b.door];
          bags.push({ tidy: Math.random() < 0.5, col: b.col, seed: bags.length + seat.length, spawn: { x: b.x, y: b.y } });
          this.binVersion++;
          b.bag = false; b.state = 'sit'; b.sitT = 0;
        }
      } else if (b.state === 'sit') {
        b.sitT += gdt;
        if (b.sitT > 0.8) b.state = 'seated';
      }
    }
  }

  // =================== 服務鈴 ===================
  pressCall(seat, reason) {
    if (!this.isSeated(seat) || this.calls[seat]) return;
    this.calls[seat] = { t: this.totalT, reason };
    this.hooks.onCallBell && this.hooks.onCallBell(seat);
  }
  clearCall(seat) { if (this.calls[seat]) { delete this.calls[seat]; } }
  randomCalls(gdt) {
    if (this.phase.id !== 'cruise' || this.env.turbulence > 0) return;
    this.callTimer = (this.callTimer || 0) + gdt;
    if (this.callTimer < 22) return;
    this.callTimer = 0;
    const seats = Object.keys(this.mood).filter((s) => this.isSeated(s) && !this.calls[s]);
    if (!seats.length || Object.keys(this.calls).length >= 3) return;
    const seat = seats[Math.floor(Math.random() * seats.length)];
    const reasons = ['想要一杯水', '想要一條毛毯', '詢問還有多久抵達', '耳機好像沒有聲音', '想要一點零食'];
    this.pressCall(seat, reasons[Math.floor(Math.random() * reasons.length)]);
  }

  // =================== 推餐車奔跑：物品掉落 ===================
  cartRush(dt, rushing) {
    if (!this.cart || this.cart.state !== 'out') { this.cartRushT = 0; return; }
    this.spillCD = Math.max(0, (this.spillCD || 0) - dt);
    if (rushing) this.cartRushT = (this.cartRushT || 0) + dt; else this.cartRushT = Math.max(0, (this.cartRushT || 0) - dt * 2);
    if (this.cartRushT > 0.35 && this.spillCD <= 0) this.cartSpill();
  }
  cartSpill() {
    this.spillCD = 4; this.cartRushT = 0;
    const id = 'spill' + (this.spillSeq = (this.spillSeq || 0) + 1);
    const n = 2 + Math.floor(Math.random() * 2);
    this.spills.push({ id, x: this.cart.x + this.cart.dir * (0.2 + Math.random() * 0.3), y: this.cart.y + (Math.random() - 0.5) * 0.35, n });
    this.cart.lost = (this.cart.lost || 0) + n;
    this.violation('推餐車時奔跑，造成餐車上的物品掉落', 'spill');
    this.say(this.judgeName('senior'), '推餐車不可以跑！飲料、杯子都掉了，熱咖啡潑到旅客怎麼辦？趕快清理乾淨！', 'bad');
    Object.keys(this.mood).forEach((seat) => { const s = findSeat(this.ac, seat); if (s && Math.hypot(s.x - this.cart.x, s.y - this.cart.y) < 1.8) this.mood[seat] = Math.max(0, this.mood[seat] - 6); });
  }
  cleanSpill(sp) {
    this.spills = this.spills.filter((x) => x !== sp);
    this.say('系統', '已清理地上的飲料與杯子。', 'good');
  }

  // =================== 駕駛艙餐飲 ===================
  pilotServiceStart(f) {
    const r = roomLayout(f, this.ac), bx = f.x + f.w / 2;
    const sterile = ['pushback', 'taxi', 'takeoff', 'climb', 'descent', 'landing'].includes(this.phase.id);
    if (this.cart.x < bx - 0.05) {
      this.violation('把餐車推進駕駛艙', 'cartck');
      this.say(PILOTS.captain, '餐車不准推進駕駛艙！擋住出入口太危險了，立刻推出去！', 'bad');
      this.say(this.judgeName('senior'), '駕駛艙的餐點要用托盤送，餐車停在外面並踩好煞車！', 'bad');
      return;
    }
    if (sterile) { this.violation(`${this.phase.name}期間打擾駕駛艙`, 'ckserve'); this.say(PILOTS.captain, `現在是${this.phase.name}階段，駕駛艙淨空，不要來打擾！`, 'bad'); return; }
    if (!this.doorOpen[f.id]) { this.say(PILOTS.fo, '（內線）請先打內線說明來意，我們確認後才會開門。', 'warn'); this.hint('先選「請求進入駕駛艙」依程序請求開門。', 'ckphone'); return; }
    this.modalOpen = true;
    this.hooks.onPilotService && this.hooks.onPilotService();
  }
  pilotServe(capMeal, foMeal, capDrink, foDrink) {
    this.modalOpen = false;
    const notes = [], name = (id) => (MEALS.find((m) => m.id === id) || DRINKS.find((d) => d.id === id) || {}).name || id;
    let ok = true;
    if (capMeal !== 'none' && capMeal === foMeal) {
      ok = false; this.violation('機長與副駕駛吃同一種餐點', 'samemeal');
      notes.push([PILOTS.captain, '我們兩個不能吃同一種餐，萬一食物有問題兩個駕駛都會倒下！換一份。', 'bad']);
      this.say(this.judgeName('senior'), '機長和副駕駛的餐點一定要不同，這是基本常識！', 'bad');
    }
    for (const [who, d] of [[PILOTS.captain, capDrink], [PILOTS.fo, foDrink]]) {
      const dd = DRINKS.find((x) => x.id === d) || {};
      if (dd.alcohol) { ok = false; this.violation('提供酒精飲料給駕駛員', 'pilotalc'); notes.push([who, '你在開玩笑嗎？值勤中的駕駛員絕對不能喝酒！', 'bad']); }
    }
    if (ok) notes.push([PILOTS.captain, `謝謝，我要${name(capMeal)}和${name(capDrink)}，放在中央操縱台旁邊就好，小心別碰到儀表。`, 'good']);
    notes.forEach(([w, t, tone]) => this.say(w, t, tone));
    if (ok) this.stats.pilotServed = true;
    return { ok, notes };
  }

  // =================== 駕駛艙：離開、動用設備 ===================
  touchCockpitControls() {
    this.cockpit.touch = (this.cockpit.touch || 0) + 1;
    if (this.cockpit.touch >= 2) {
      this.violation('擅自操作駕駛艙設備', 'cktouch');
      this.say(PILOTS.captain, '住手！不要碰任何設備！我要求立即支援！', 'bad');
      this.arrest(true);
    } else {
      this.say(PILOTS.captain, '請不要碰駕駛艙裡的任何設備！再碰我就通報空安人員。', 'warn');
      this.violation('觸碰駕駛艙設備', 'cktouch1');
    }
  }
  leaveCockpit(f) {
    const r = roomLayout(f, this.ac);
    this.doorOpen[f.id] = true; this.rebuildGrid();
    this.walkTo({ x: r.door.x, y: r.door.y });
    this.say(PILOTS.fo, '我幫你開門，出去後記得把門關上。', 'info');
  }

  // ---- 主迴圈 ----
  update(realDt) {
    if (this.ended) return;
    const dt = Math.min(realDt, 0.1);
    this.stepActor(this.player, dt); // 移動不受暫停影響以外的時間倍率
    if (!this.player.path.length && !this.modalOpen) {
      if (this.pendingProp) { const id = this.pendingProp; this.actOnProp(id); this.pendingProp = null; }
      if (this.pendingChat) { const seat = this.pendingChat; this.pendingChat = null; if (this.passengerInRange(seat)) this.openChat(seat); }
    }
    if (this.paused || this.modalOpen) { this.computeEnv(0); return; }
    const gdt = dt * this.timeScale;
    this.phaseT += gdt;
    this.totalT += gdt;

    // 任務啟動
    for (const t of this.tasks) {
      if (t.status === 'waiting' && t.def.phase === this.phase.id && this.phaseT >= (t.def.at || 0)) {
        t.status = 'active';
        t.activeSince = this.totalT;
        if (t.def.kind === 'talk' && t.def.target && t.def.target.seat && this.phase.id !== 'boarding') this.pressCall(t.def.target.seat, '');
        t.remaining = t.def.limit;
        if (t.def.announce === 'turbulence') this.env.turbulence = 30;
        if (t.def.priority === 1) this.say('系統', `緊急任務：${t.def.title}`, 'warn');
        this.hooks.onTaskChange && this.hooks.onTaskChange();
      }
    }
    // 倒數、巡查覆蓋
    for (const t of this.tasks) {
      if (t.status === 'active' || t.status === 'delegated') {
        t.remaining -= gdt;
        if (t.def.kind === 'walk' && t.status === 'active') {
          this.rows.forEach((r) => { if (Math.abs(r.x - this.player.x) < 0.6) t.covered.add(r.row); });
          if (t.covered.size >= Math.ceil(this.rows.length * 0.9)) this.complete(t, Math.round(lerp(75, 100, t.remaining / t.def.limit)), '客艙檢查完成：安全帶、椅背、桌板、遮光板都確認了。');
        }
        if (t.status === 'active' && t.def.kind === 'seated' && this.player.seated && this.player.belted) this.complete(t, 100, null);
        if (t.status === 'active' && t.def.kind === 'cart' && this.cart.state === 'out') this.complete(t, 100, null);
        if (t.status === 'active' && t.def.kind === 'bins') {
          const left = this.binsInfo.doors.filter((d) => this.binOpen[d.id]).length;
          t.progress = `尚有 ${left} 個未關（你關了 ${this.stats.binsClosed || 0} 個）`;
          if (!left) { const mine = this.stats.binsClosed || 0, all = this.binsInfo.doors.length; this.complete(t, Math.round(60 + 40 * Math.min(1, mine / Math.max(1, all * 0.4))), '所有行李櫃都已關閉並確認鎖好。'); }
        }
        if (t.status === 'active' && t.def.kind === 'service' && this.service.total >= this.service.target) {
          const q = Math.round((this.service.correct / Math.max(1, this.service.total)) * 100);
          this.complete(t, q, `餐飲服務完成：送出 ${this.service.total} 份，正確 ${this.service.correct} 份。記得把餐車推回廚房。`);
        }
        if ((t.status === 'active' || t.status === 'delegated') && t.remaining <= 0) this.fail(t);
      }
    }
    // 組員 NPC
    // 其他組員協助關行李櫃（推出、滑行階段）
    if (['pushback', 'taxi'].includes(this.phase.id)) {
      for (const c of this.npcs) {
        if (c.special || c.task) continue;
        if (c.binJob) {
          if (!this.binOpen[c.binJob]) { c.binJob = null; continue; }
          if (c.path.length) continue;
          c.binT = (c.binT || 0) + gdt; c.reaching = true;
          if (c.binT > 2.2) {
            (this.binBags[c.binJob] || []).forEach((bg) => { bg.tidy = true; }); this.binVersion++;
            this.binOpen[c.binJob] = false; delete this.binJobs[c.binJob]; c.binJob = null; c.binT = 0; c.reaching = false;
          }
          continue;
        }
        if (this.phase.id === 'pushback' && this.phaseT < (c.id === 'purser' ? 12 : 4)) continue;
        const d = this.binsInfo.doors.filter((x) => this.binOpen[x.id] && !this.binJobs[x.id] && Math.abs(x.x - this.player.x) > 1.2).sort((a, b2) => Math.abs(a.x - c.x) - Math.abs(b2.x - c.x))[0];
        if (!d) { if (!c.path.length && c.home && Math.hypot(c.x - c.home.x, c.y - c.home.y) > 0.5) c.path = findPath(this.grid, c, c.home); continue; }
        c.binJob = d.id; this.binJobs[d.id] = c.id; c.binT = 0;
        c.path = findPath(this.grid, c, binSpot(d, 0.4));
      }
    } else this.npcs.forEach((c) => { if (c.binJob) { delete this.binJobs[c.binJob]; c.binJob = null; c.reaching = false; } });
    for (const c of this.npcs) {
      const moving = this.stepActor(c, dt * (c.binJob ? 0.75 : 1));
      if (c.task && !moving) {
        c.work -= gdt;
        if (c.work <= 0) {
          const t = c.task;
          const q = Math.round(Math.min(100, (c.skill || 0.7) * 100 * (0.85 + Math.random() * 0.25)));
          if (t.status === 'delegated') {
            t.status = 'done'; t.quality = q;
            this.say(c.name, `「${t.def.title}」已完成。`, q >= 70 ? 'good' : 'info');
            this.hooks.onTaskChange && this.hooks.onTaskChange();
          }
          this.releaseNpc(t);
        }
      }
    }
    this.updateBoarding(gdt);
    this.randomCalls(gdt);
    for (const [seat, c] of Object.entries(this.calls)) { if (this.pax[seat]) this.pax[seat].patience = Math.max(0, this.pax[seat].patience - 0.5 * gdt); if (this.totalT - c.t > 60 && !c.warned) { c.warned = true; this.say(this.judgeName('senior'), `${seat} 的服務鈴已經亮很久了，快去看看！`, 'warn'); } }
    if (this.env.turbulence > 0) {
      if (this.cart.state === 'out') {
        if (this.cart.turbT === 0) this.say(this.judgeName('senior'), '亂流！立刻停止服務、踩煞車，把餐車推回廚房固定！', 'warn');
        this.cart.turbT += gdt;
        if (this.cart.turbT > 20) { this.violation('亂流期間餐車未收回固定', 'cartturb'); this.cart.turbT = -999; }
      }
      this.env.turbulence -= gdt;
    }
    // 旅客耐心：有待處理需求時下降，平時慢慢恢復；耐心耗盡會影響心情
    const waiting = new Set(this.activeTasks().filter((t) => t.def.target && t.def.target.seat).map((t) => t.def.target.seat));
    for (const [seat, st] of Object.entries(this.pax)) {
      st.patience = Math.max(0, Math.min(100, st.patience + (waiting.has(seat) ? -0.7 : 0.12) * gdt));
      if (st.patience <= 0 && this.mood[seat] != null) this.mood[seat] = Math.max(0, this.mood[seat] - 0.4 * gdt);
    }
    // 駕駛艙門：離開駕駛艙後自動關閉上鎖
    const ck = this.cockpitFixture();
    if (ck && this.doorOpen[ck.id] && this.player.x > ck.x + ck.w / 2 + 1.6) { this.doorOpen[ck.id] = false; this.rebuildGrid(); this.say(PILOTS.fo, '駕駛艙門已關閉上鎖。', 'info'); }
    // 逮捕流程
    if (this.arresting) {
      this.arresting.t += dt;
      const g = this.npcs.find((n) => n.id === 'security');
      this.npcs.filter((n) => n.rush).forEach((n) => { if (!n.path.length && Math.hypot(n.x - this.player.x, n.y - this.player.y) > 0.8) n.path = findPath(this.grid, n, this.player); this.stepActor(n, dt * 0.8); });
      if (this.arresting.t > 6 || (g && Math.hypot(g.x - this.player.x, g.y - this.player.y) < 0.75 && this.arresting.t > 2.5)) {
        return this.failFlight(this.arresting.inside ? '在駕駛艙內擅自操作設備，危及飛航安全，遭空安人員與座艙長衝入駕駛艙制止並逮捕。' : '多次在沒有正當理由下強行要求進入駕駛艙，違反航空保安規定，遭空安人員制止並逮捕。');
      }
    }

    // 階段推進
    if (this.phaseT >= this.phase.dur) {
      if (this.phaseIdx >= PHASES.length - 1) return this.finish();
      this.phaseIdx++;
      this.phaseT = 0;
      this.onPhaseStart();
    }
    this.computeEnv(gdt);
  }

  onPhaseStart() {
    const id = this.phase.id;
    const P = this.sc.npc.purser, S = this.sc.npc.senior;
    const lines = {
      pushback: [P, '艙門關閉，各艙門預位並交互檢查。請大家一起把行李櫃關好！'],
      taxi: [P, '飛機開始滑行，請完成客艙安全檢查。'],
      takeoff: ['機長', '組員請就座，準備起飛。'],
      climb: [this.rank >= 3 ? this.npcs[0].name : S, '起飛完成，安全帶燈熄滅後可以開始準備服務。'],
      cruise: [P, '進入巡航高度，開始餐飲服務。'],
      descent: ['機長', '飛機開始下降，預計 20 分鐘後落地。'],
      landing: ['機長', '組員請就座，準備落地。'],
      deplane: [P, '飛機已停妥，各艙門解除預位並交互檢查。'],
    };
    if (lines[id]) this.say(lines[id][0], lines[id][1], 'info');
    if (id === 'pushback') {
      const late = this.boarding ? Object.values(this.boarding).filter((b) => b.state !== 'seated').length : 0;
      this.seatAllBoarding();
      if (late) this.say(this.sc.npc.purser, `登機結束，最後 ${late} 位旅客已入座。`, 'info');
      if (this.binView) this.exitBinView();
    }
    if (id === 'takeoff' || id === 'landing' || id === 'descent') this.checkCabinSecured();
    if (id === 'descent' && this.spills.length) this.violation('走道上還有未清理的掉落物', 'spillleft');
    this.hooks.onPhase && this.hooks.onPhase(this.phase);
  }

  computeEnv(gdt) {
    const id = this.phase.id, t = this.phaseT / this.phase.dur, e = this.env;
    e.ground = ['boarding', 'pushback', 'taxi', 'takeoff', 'landing', 'deplane'].includes(id);
    e.doorsOpen = id === 'boarding' || (id === 'deplane' && t > 0.15);
    e.seatbelt = !(id === 'cruise' && e.turbulence <= 0) && id !== 'deplane';
    e.lights = ['takeoff', 'landing'].includes(id) ? 0.45 : id === 'cruise' ? 0.85 : 1;
    switch (id) {
      case 'boarding': e.speed = 0; e.alt = 0; e.pitch = 0; break;
      case 'pushback': e.speed = t > 0.3 ? -4 : 0; e.alt = 0; e.pitch = 0; break;
      case 'taxi': e.speed = 15 + Math.sin(this.totalT * 0.4) * 4; e.alt = 0; e.pitch = 0; break;
      case 'takeoff': e.speed = lerp(15, 165, t / 0.7); e.pitch = t > 0.62 ? lerp(0, 12, (t - 0.62) / 0.2) : 0; e.alt = t > 0.7 ? lerp(0, 600, (t - 0.7) / 0.3) : 0; break;
      case 'climb': e.speed = lerp(170, 300, t); e.pitch = lerp(12, 4, t); e.alt = lerp(600, 30000, t); break;
      case 'cruise': e.speed = 480; e.pitch = 1.5; e.alt = lerp(30000, 35000, Math.min(1, t * 4)); break;
      case 'descent': e.speed = lerp(450, 180, t); e.pitch = -2.5; e.alt = lerp(35000, 2500, t); break;
      case 'landing': e.speed = t < 0.5 ? lerp(160, 140, t * 2) : lerp(140, 25, (t - 0.5) * 2); e.pitch = t < 0.45 ? lerp(-1, 4, t / 0.45) : lerp(4, 0, (t - 0.45) * 5); e.alt = t < 0.5 ? lerp(2500, 0, t / 0.5) : 0; break;
      case 'deplane': e.speed = 0; e.alt = 0; e.pitch = 0; break;
    }
    let shake = 0;
    if (id === 'takeoff' && t < 0.7) shake = 0.3 + t;
    if (id === 'landing' && t > 0.48 && t < 0.62) shake = 1.4;
    if (id === 'taxi') shake = 0.15;
    if (e.turbulence > 0) shake = 1.0;
    e.shake = shake;
    if (e.ground) e.groundScroll += (e.speed * 0.514 * gdt);
  }

  progress() {
    const total = PHASES.reduce((s, p) => s + p.dur, 0);
    const done = PHASES.slice(0, this.phaseIdx).reduce((s, p) => s + p.dur, 0) + this.phaseT;
    return Math.min(1, done / total);
  }

  finish(asFailure = false) {
    this.ended = true;
    this.tasks.forEach((t) => { if (t.status === 'active' || t.status === 'delegated') { t.status = 'failed'; t.quality = 0; } });
    const counted = this.tasks.filter((t) => t.status !== 'waiting');
    const done = counted.filter((t) => t.status === 'done');
    const failed = counted.filter((t) => t.status === 'failed');
    const avgQ = done.length ? done.reduce((s, t) => s + t.quality, 0) / done.length : 0;
    const moods = Object.values(this.mood);
    const satisfaction = moods.length ? Math.round(moods.reduce((a, b) => a + b, 0) / moods.length) : 70;
    let xp = done.reduce((s, t) => s + (t.def.xp || 10) * (t.quality / 100), 0);
    xp += 30; // 完成航班
    xp += Math.max(0, satisfaction - 60);
    xp -= this.stats.safety * 25 + this.stats.priorityMistakes * 10 + failed.length * 5;
    if (this.rank >= 3) xp += Math.min(40, this.stats.delegated * 8);
    xp = Math.max(5, Math.round(xp));
    const grade = avgQ >= 90 && failed.length === 0 && this.stats.safety === 0 ? 'S' : avgQ >= 80 && this.stats.safety === 0 ? 'A' : avgQ >= 65 ? 'B' : avgQ >= 45 ? 'C' : 'D';
    const result = {
      flight: this.sc.flightNo, route: this.sc.route, aircraft: this.ac.name, rank: RANKS[this.rank].name,
      done: done.length, failed: failed.length, total: counted.length, avgQuality: Math.round(avgQ), satisfaction,
      safety: this.stats.safety, priorityMistakes: this.stats.priorityMistakes, delegated: this.stats.delegated, xp, grade,
      date: new Date().toISOString(),
      tasks: counted.map((t) => ({ title: t.def.title, status: t.status, quality: t.quality, priority: t.def.priority })),
      violations: this.stats.violations.slice(),
      service: this.service ? { served: this.service.total, correct: this.service.correct, errors: this.service.errors.slice() } : null,
    };
    if (asFailure) return result;
    this.hooks.onEnd && this.hooks.onEnd(result);
  }
}

export const announcementFor = (task) => {
  const a = ANNOUNCEMENTS[task.def.announce];
  if (a) return a;
  return { title: task.def.title, script: task.def.script || '', keywords: task.def.keywords || [] };
};
