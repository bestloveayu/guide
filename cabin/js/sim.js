// 飛行模擬引擎：階段時間軸、任務佇列、移動、評分、組員分派
import { PHASES, RANKS, rankOf, DEFAULT_CREW, ANNOUNCEMENTS, PRIORITY, PILOTS } from './data.js';
import { buildGrid, findPath, approachPoint, findSeat, findFixture, rowsOf, walkable, slideMove, roomLayout, binDoors } from './layout.js';

const WALK_SPEED = 1.7; // m/s
const lerp = (a, b, t) => a + (b - a) * Math.max(0, Math.min(1, t));

export class Flight {
  constructor({ aircraft, scenario, profile, hooks }) {
    this.ac = aircraft;
    this.sc = scenario;
    this.profile = profile;
    this.hooks = hooks || {};
    this.rank = rankOf(profile.xp);
    this.grid = buildGrid(aircraft);
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
        { id: 'senior', name: scenario.npc.senior, color: '#d97a8c', x: gp.x + 0.5, y: gp.y, path: [], task: null },
        { id: 'purser', name: scenario.npc.purser, color: '#c9a227', x: walkable(this.grid, start.x - 0.7, start.y) ? start.x - 0.7 : start.x, y: start.y, heading: 0, path: [], task: null },
      ];
    }

    this.tasks = scenario.tasks
      .filter((t) => (t.minRank || 0) <= this.rank && (t.maxRank == null || t.maxRank >= this.rank))
      .filter((t) => !(t.target && t.target.seat) || findSeat(aircraft, t.target.seat)) // 座位已不存在的旅客任務略過
      .map((def) => ({ def, status: 'waiting', remaining: def.limit, quality: 0, assignee: null, covered: new Set(), activeSince: 0 }));
    this.env = { alt: 0, speed: 0, pitch: 0, shake: 0, lights: 1, seatbelt: true, doorsOpen: true, ground: true, turbulence: 0, groundScroll: 0 };
    this.initProps();
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
    if (k === 'announce' || k === 'manage' || k === 'walk') return true;
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
  interactables() { return this.activeTasks().filter((t) => t.status === 'active' && t.def.kind !== 'walk' && this.inRange(t)); }

  // ---- 移動 ----
  goTo(task) {
    if (!task) return;
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
    if ((dx || dy) && this.player.belted) { this.hint('你正繫著安全帶坐在組員座椅上，請先解開安全帶（按 E）。', 'belt'); return; }
    if (dx || dy) this.standUp();
    if (dx || dy) this.player.path = [];
    slideMove(this.grid, this.player, dx, dy);
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
    let move = WALK_SPEED * dt;
    while (move > 0 && a.path.length) {
      const t = a.path[0];
      const dx = t.x - a.x, dy = t.y - a.y, d = Math.hypot(dx, dy);
      if (d < 1e-3) { a.path.shift(); continue; }
      a.heading = Math.atan2(dy, dx);
      if (d <= move) { a.x = t.x; a.y = t.y; a.path.shift(); move -= d; } else { a.x += (dx / d) * move; a.y += (dy / d) * move; move = 0; }
    }
    return true;
  }

  // ---- 互動 ----
  interact(task) {
    if (!task || task.status !== 'active') return;
    if (!this.inRange(task)) { this.goTo(task); return; }
    const k = task.def.kind;
    if (k === 'goto') this.complete(task, Math.round(lerp(70, 100, task.remaining / task.def.limit)));
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
  rebuildGrid() { this.grid = buildGrid(this.ac, this.doorOpen); }
  fixtureDist(f, who = this.player) { const dx = Math.max(0, Math.abs(who.x - f.x) - f.w / 2), dy = Math.max(0, Math.abs(who.y - f.y) - f.d / 2); return Math.hypot(dx, dy); }

  nearestPassenger(maxDx = 0.85, maxDy = 2.6) {
    let best = null, bd = 1e9;
    for (const seat of Object.keys(this.mood)) {
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
      if (f.type === 'lav' && d < 1.15) {
        const open = this.doorOpen[f.id];
        acts.push({ id: 'lav:' + f.id, label: open ? '關上洗手間門' : '打開洗手間門', run: () => this.toggleDoor(f) });
        if (open) acts.push({ id: 'lavchk:' + f.id, label: '檢查洗手間（煙霧偵測器、垃圾桶、備品）', run: () => this.checkLav(f) });
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
          if (this.doorOpen[f.id]) acts.push({ id: 'ckclose', label: '關上駕駛艙門', run: () => this.closeCockpit(f) });
          else acts.push({ id: 'ckask', label: '請求進入駕駛艙', run: () => { this.modalOpen = true; this.hooks.onCockpit && this.hooks.onCockpit(); } });
        }
      }
    }
    // 行李櫃（伸手可及：同側、前後 0.8 m 內）
    const reach = this.binsInfo.doors.filter((b) => pl.x > b.x0 - 0.3 && pl.x < b.x1 + 0.3 && Math.abs(pl.y - b.side * this.binsInfo.inner) < 1.45)
      .sort((a, b) => Math.abs(pl.x - a.x) + Math.abs(pl.y - a.side * 2) * 0.1 - (Math.abs(pl.x - b.x) + Math.abs(pl.y - b.side * 2) * 0.1));
    reach.slice(0, 2).forEach((b) => acts.push({ id: b.id, label: `${this.binOpen[b.id] ? '關上' : '打開'}${b.side < 0 ? '左' : '右'}側行李櫃`, run: () => this.toggleBin(b) }));
    // 氧氣面罩（站在該排走道上）
    const row = this.rows.find((r) => Math.abs(r.x - pl.x) < 0.45);
    if (row && !this.oxygen[row.row]) acts.push({ id: 'oxy:' + row.row, label: `拉下第 ${row.row} 排氧氣面罩`, run: () => this.dropOxygen(row) });
    // 旅客交談
    const s = this.nearestPassenger();
    if (s && !acts.some((a) => a.task)) acts.push({ id: 'chat:' + s.id, label: `與 ${s.id} 旅客交談`, run: () => this.openChat(s.id) });
    return acts.slice(0, 6);
  }

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
    if (f.type !== 'lav') {
      // 關門時若有人站在門口，先把他移出門的位置
      this.rebuildGrid();
      if (!open && !walkable(this.grid, this.player.x, this.player.y)) { const p = approachPoint(this.ac, this.grid, this.player); this.player.x = p.x; this.player.y = p.y; }
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
  closeCockpit(f) { this.doorOpen[f.id] = false; this.rebuildGrid(); if (!walkable(this.grid, this.player.x, this.player.y)) { const p = approachPoint(this.ac, this.grid, { x: f.x + f.w / 2 + 0.5, y: 0 }); this.player.x = p.x; this.player.y = p.y; } this.say(PILOTS.fo, '駕駛艙門已關閉上鎖，謝謝。', 'good'); }
  arrest() {
    if (this.arresting) return;
    const pl = this.player;
    this.arresting = { t: 0 };
    const start = approachPoint(this.ac, this.grid, { x: pl.x + 2.5, y: 0 });
    const guard = { id: 'security', name: '空安人員', color: '#1c1f26', x: start.x, y: start.y, path: [], task: { def: { title: '制止' } }, special: true };
    guard.path = findPath(this.grid, guard, pl);
    this.npcs.push(guard);
    this.say('空安人員', '不要動！把手放在我看得到的地方！', 'bad');
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
    if (open) {
      if (this.movingPhase()) this.violation(`${this.phase.name}期間開啟行李櫃`, 'bin');
      else if (this.env.turbulence > 0) this.violation('亂流期間開啟行李櫃', 'bin');
    }
    this.binOpen[b.id] = open;
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
    const openBins = Object.values(this.binOpen).filter(Boolean).length;
    if (openBins) this.violation(`${name}時仍有 ${openBins} 個行李櫃未關閉`, 'binsec');
    const lavs = this.ac.fixtures.filter((f) => f.type === 'lav' && this.doorOpen[f.id]).length;
    if (lavs) this.violation(`${name}時洗手間門未關閉`, 'lavsec');
    const ck = this.cockpitFixture();
    if (ck && this.doorOpen[ck.id]) { this.violation(`${name}時駕駛艙門未關閉`, 'cksec'); this.doorOpen[ck.id] = false; this.rebuildGrid(); }
  }

  // 3D 點選物件：在範圍內直接執行，太遠則先走過去
  actOnProp(id) {
    const f = this.ac.fixtures.find((x) => x.id === id);
    const keys = [id, 'lav:' + id, 'rest:' + id, 'sit:' + id];
    if (f && f.type === 'cockpit') keys.push('ckask', 'ckclose');
    const a = this.availableActions().find((x) => keys.includes(x.id));
    if (a) { this.pendingProp = null; a.run(); return; }
    if (this.pendingProp === id && !this.player.path.length) { this.pendingProp = null; this.hint('距離太遠或目前無法操作。', 'prop'); return; }
    let target = null;
    const b = this.binsInfo.doors.find((d) => d.id === id);
    if (b) target = { x: b.x, y: b.side * 0.15 };
    if (f) target = (f.type === 'cockpit' || f.type === 'crewrest') ? (() => { const r = roomLayout(f, this.ac); return { x: r.door.x, y: r.door.y }; })() : approachPoint(this.ac, this.grid, f);
    if (target) { this.walkTo(target); this.pendingProp = id; }
  }

  // ---- 旅客交談（沒有任務時也能互動） ----
  openChat(seat) {
    if (!this.passengerInRange(seat)) { const s = findSeat(this.ac, seat); this.walkTo(approachPoint(this.ac, this.grid, s)); this.pendingChat = seat; return; }
    this.modalOpen = true;
    this.hooks.onChat && this.hooks.onChat(seat, this.chatOptions(seat));
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
        if ((t.status === 'active' || t.status === 'delegated') && t.remaining <= 0) this.fail(t);
      }
    }
    // 組員 NPC
    for (const c of this.npcs) {
      const moving = this.stepActor(c, dt);
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
    if (this.env.turbulence > 0) this.env.turbulence -= gdt;
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
      if (g && !g.path.length && Math.hypot(g.x - this.player.x, g.y - this.player.y) > 0.8) g.path = findPath(this.grid, g, this.player);
      if (this.arresting.t > 4 || (g && Math.hypot(g.x - this.player.x, g.y - this.player.y) < 0.7 && this.arresting.t > 1.5)) {
        return this.failFlight('多次在沒有正當理由下強行要求進入駕駛艙，違反航空保安規定，遭空安人員制止並逮捕。');
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
      pushback: [P, '艙門關閉，各艙門預位並交互檢查。'],
      taxi: [P, '飛機開始滑行，請完成客艙安全檢查。'],
      takeoff: ['機長', '組員請就座，準備起飛。'],
      climb: [this.rank >= 3 ? this.npcs[0].name : S, '起飛完成，安全帶燈熄滅後可以開始準備服務。'],
      cruise: [P, '進入巡航高度，開始餐飲服務。'],
      descent: ['機長', '飛機開始下降，預計 20 分鐘後落地。'],
      landing: ['機長', '組員請就座，準備落地。'],
      deplane: [P, '飛機已停妥，各艙門解除預位並交互檢查。'],
    };
    if (lines[id]) this.say(lines[id][0], lines[id][1], 'info');
    if (id === 'takeoff' || id === 'landing') this.checkCabinSecured();
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
