// 飛行模擬引擎：階段時間軸、任務佇列、移動、評分、組員分派
import { PHASES, RANKS, rankOf, DEFAULT_CREW, ANNOUNCEMENTS, PRIORITY } from './data.js';
import { buildGrid, findPath, approachPoint, findSeat, findFixture, rowsOf, walkable } from './layout.js';

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
    this.standUp();
    this.player.path = findPath(this.grid, this.player, pt);
  }
  moveManual(dx, dy) { // 第一人稱移動（公尺）
    if (dx || dy) this.standUp();
    this.player.path = [];
    const r = 0.18;
    const nx = this.player.x + dx, ny = this.player.y + dy;
    const ok = (x, y) => walkable(this.grid, x + r, y) && walkable(this.grid, x - r, y) && walkable(this.grid, x, y + r) && walkable(this.grid, x, y - r);
    if (ok(nx, this.player.y)) this.player.x = nx;
    if (ok(this.player.x, ny)) this.player.y = ny;
  }
  standUp() {
    if (!this.player.seated) return;
    this.player.seated = false;
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
      if (f) { this.player.x = f.x; this.player.y = f.y; }
      this.player.path = [];
      this.player.seated = true;
      this.complete(task, 100, '就座並繫好肩帶，開始靜默檢查。');
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
  freeCrew() { return this.rank >= 3 ? this.npcs.filter((n) => !n.task) : []; }
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

  // ---- 主迴圈 ----
  update(realDt) {
    if (this.ended) return;
    const dt = Math.min(realDt, 0.1);
    this.stepActor(this.player, dt); // 移動不受暫停影響以外的時間倍率
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
        if (t.status === 'active' && t.def.kind === 'seated' && this.player.seated) this.complete(t, 100, null);
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
    if (id === 'climb' || id === 'cruise') this.player.seated = false;
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

  finish() {
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
    };
    this.hooks.onEnd && this.hooks.onEnd(result);
  }
}

export const announcementFor = (task) => {
  const a = ANNOUNCEMENTS[task.def.announce];
  if (a) return a;
  return { title: task.def.title, script: task.def.script || '', keywords: task.def.keywords || [] };
};
