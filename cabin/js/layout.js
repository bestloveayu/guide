// 機艙佈局：由規格產生座位與設施、編輯操作、走道網格與尋路
import { AIRCRAFT_SPECS, TEMPLATE_VERSION } from './data.js';

const WALL_MARGIN = 0.12;
let uid = 0;
export const newId = (p = 'id') => `${p}_${Date.now().toString(36)}${(uid++).toString(36)}`;

// 'ABC-DEF' → [['A','B','C'],['D','E','F']]
export function parsePattern(pattern) {
  return pattern.split('-').map((g) => g.trim().toUpperCase().split('').filter(Boolean)).filter((g) => g.length);
}

// 計算一排座位的橫向座標與走道中心
export function rowLayout(pattern, width, seatW) {
  const groups = parsePattern(pattern);
  const n = groups.reduce((s, g) => s + g.length, 0);
  const inner = width - WALL_MARGIN * 2;
  let sw = seatW || 0.46;
  let aisle = groups.length > 1 ? (inner - n * sw) / (groups.length - 1) : 0;
  if (groups.length > 1 && aisle < 0.45) { // 座位太寬時自動縮小
    aisle = 0.45;
    sw = (inner - aisle * (groups.length - 1)) / n;
  }
  const cols = [];
  const aisles = [];
  let y = -width / 2 + WALL_MARGIN;
  if (groups.length === 1) y = -(n * sw) / 2;
  groups.forEach((g, gi) => {
    g.forEach((letter) => { cols.push({ letter, y: y + sw / 2 }); y += sw; });
    if (gi < groups.length - 1) { aisles.push(y + aisle / 2); y += aisle; }
  });
  return { cols, aisles, seatW: sw };
}

function fixtureFromItem(item, x0, width) {
  const [type, side, at, w, d, label] = item;
  let y = 0;
  if (side === 'L') y = -width / 2 + d / 2;
  else if (side === 'R') y = width / 2 - d / 2;
  return { id: newId('fx'), type, label: label || '', x: x0 + at + w / 2, y, w, d: side === 'F' ? width : d };
}

export function buildFromSpec(spec) {
  const ac = { id: spec.id || newId('ac'), name: spec.name, width: spec.width, length: 0, seats: [], fixtures: [], underlay: null };
  let x = 0;
  for (const seg of spec.segments) {
    if (seg.type === 'fixtures') {
      seg.items.forEach((it) => ac.fixtures.push(fixtureFromItem(it, x, spec.width)));
      x += seg.len;
    } else {
      const { cols, seatW } = rowLayout(seg.pattern, spec.width, seg.seatW);
      const pitch = seg.pitch || 0.8;
      const skip = new Set(seg.skip || []);
      for (let r = seg.from; r <= seg.to; r++) {
        if (skip.has(r)) continue;
        const cx = x + pitch / 2;
        cols.forEach((c) => ac.seats.push(makeSeat(r, c.letter, cx, c.y, seatW, pitch, seg.cls)));
        x += pitch;
      }
    }
  }
  ac.length = x;
  return ac;
}

export function makeSeat(row, letter, x, y, w, pitch, cls) {
  return { id: `${row}${letter}`, row, letter, x, y, w: w * 0.92, d: Math.min(pitch * 0.68, 0.9), pitch, cls, removed: false };
}

export function buildTemplate(id) {
  const spec = AIRCRAFT_SPECS.find((s) => s.id === id) || AIRCRAFT_SPECS[0];
  const ac = buildFromSpec(spec);
  ac.id = newId(spec.id);
  ac.templateId = spec.id;
  ac.templateVersion = TEMPLATE_VERSION;
  return ac;
}

// ---- 查詢 ----
export const activeSeats = (ac) => ac.seats.filter((s) => !s.removed);
export const findSeat = (ac, id) => ac.seats.find((s) => s.id === id && !s.removed);
export function rowsOf(ac) {
  const m = new Map();
  ac.seats.forEach((s) => { if (!m.has(s.row)) m.set(s.row, []); m.get(s.row).push(s); });
  return [...m.entries()].sort((a, b) => a[0] - b[0]).map(([row, seats]) => ({ row, seats, x: seats[0].x }));
}

// 依標籤或類型找設施；離 near 最近者優先
export function findFixture(ac, key, near) {
  let list = ac.fixtures.filter((f) => f.label === key);
  if (!list.length) list = ac.fixtures.filter((f) => f.type === key);
  if (!list.length) list = ac.fixtures.filter((f) => f.label && f.label.includes(key));
  if (!list.length) return null;
  if (near) list.sort((a, b) => Math.hypot(a.x - near.x, a.y - near.y) - Math.hypot(b.x - near.x, b.y - near.y));
  return list[0];
}

// ---- 編輯操作 ----
export function removeRows(ac, rows) {
  const set = new Set(rows);
  ac.seats = ac.seats.filter((s) => !set.has(s.row));
}

// 在 afterRow 後插入一排：複製該排配置，後方所有物件往後移一個 pitch
export function insertRowAfter(ac, afterRow) {
  const rows = rowsOf(ac);
  const ref = rows.find((r) => r.row === afterRow);
  if (!ref) return null;
  const pitch = ref.seats[0].pitch || 0.8;
  const shiftFrom = ref.x + 0.01;
  ac.seats.forEach((s) => { if (s.x > shiftFrom) s.x += pitch; });
  ac.fixtures.forEach((f) => { if (f.x > shiftFrom) f.x += pitch; });
  ac.length += pitch;
  // 新排號：若 afterRow+1 已存在，後面所有排號 +1
  const newRow = afterRow + 1;
  if (ac.seats.some((s) => s.row === newRow)) {
    ac.seats.forEach((s) => { if (s.row >= newRow) { s.row += 1; s.id = `${s.row}${s.letter}`; } });
  }
  ref.seats.forEach((s) => {
    const ns = { ...s, row: newRow, id: `${newRow}${s.letter}`, x: s.x + pitch, removed: false };
    ac.seats.push(ns);
  });
  return newRow;
}

// 在矩形區域內依座位樣式產生座位（平面圖描圖用）
export function generateInRect(ac, rect, opts) {
  const { pattern, from, to, cls, skip = [] } = opts;
  const groups = parsePattern(pattern);
  const letters = groups.flat();
  const rowNums = [];
  for (let r = from; r <= to; r++) if (!skip.includes(r)) rowNums.push(r);
  if (!rowNums.length || !letters.length) return 0;
  const x0 = Math.min(rect.x0, rect.x1), x1 = Math.max(rect.x0, rect.x1);
  const y0 = Math.min(rect.y0, rect.y1), y1 = Math.max(rect.y0, rect.y1);
  const pitch = (x1 - x0) / rowNums.length;
  const widthAvail = y1 - y0;
  const aisleCount = groups.length - 1;
  const aisleW = aisleCount ? Math.max(0.45, widthAvail * 0.12) : 0;
  const seatW = (widthAvail - aisleW * aisleCount) / letters.length;
  // 移除區域內原有座位
  ac.seats = ac.seats.filter((s) => !(s.x >= x0 && s.x <= x1 && s.y >= y0 && s.y <= y1));
  const ids = new Set(ac.seats.map((s) => s.id));
  let count = 0;
  rowNums.forEach((r, i) => {
    let y = y0;
    const cx = x0 + pitch * (i + 0.5);
    groups.forEach((g, gi) => {
      g.forEach((letter) => {
        const s = makeSeat(r, letter, cx, y + seatW / 2, seatW, pitch, cls);
        if (ids.has(s.id)) s.id = `${r}${letter}*`;
        ac.seats.push(s); count++;
        y += seatW;
      });
      if (gi < groups.length - 1) y += aisleW;
    });
  });
  ac.length = Math.max(ac.length, x1 + 1);
  return count;
}

// ---- 碰撞與走道網格（A* 尋路） ----
// 碰撞以「圓形角色 vs 座位/設施矩形」直接計算；尋路網格的格子中心與碰撞判定使用同一套規則，
// 避免格子對齊誤差讓走道變窄、角色卡住。
export const CELL = 0.1;
export const BODY_R = 0.16; // 角色碰撞半徑（公尺）

// ---- 可進入的房間（組員休息室、駕駛艙）：牆面、門、內部家具 ----
// 回傳 { walls: [rect], door: { rect, x, y, nx, ny }, furniture: [rect] }；rect = {x0,x1,y0,y1}
export function roomLayout(f, ac) {
  const t = 0.06;
  const x0 = f.x - f.w / 2, x1 = f.x + f.w / 2, y0 = f.y - f.d / 2, y1 = f.y + f.d / 2;
  if (f.type === 'cockpit') {
    // 駕駛艙：後方隔板（中央有門），內部儀表板與兩張駕駛座
    const bx = x1, dw = 0.42, W = ac.width;
    return {
      walls: [{ x0: bx - t, x1: bx, y0: -W / 2, y1: -dw }, { x0: bx - t, x1: bx, y0: dw, y1: W / 2 }],
      door: { rect: { x0: bx - t, x1: bx, y0: -dw, y1: dw }, x: bx + 0.35, y: 0, hingeY: -dw, w: dw * 2, plane: 'x', at: bx - t / 2 },
      furniture: [
        { x0, x1: x0 + 0.55, y0: -W / 2, y1: W / 2 },
        { x0: f.x - 0.05, x1: f.x + 0.45, y0: 0.2, y1: 0.7 }, { x0: f.x - 0.05, x1: f.x + 0.45, y0: -0.7, y1: -0.2 },
        { x0: x0 + 0.5, x1: f.x + 0.3, y0: -0.17, y1: 0.17 }, // 中央操縱台
      ],
      seats: [{ x: f.x + 0.2, y: 0.45 }, { x: f.x + 0.2, y: -0.45 }],
    };
  }
  // 組員休息室：靠窗側放上下舖，門開在朝走道的一側
  const inner = f.y < 0 ? y1 : y0, outer = f.y < 0 ? y0 : y1, sgn = f.y < 0 ? 1 : -1;
  const dw = 0.4, dx = f.x;
  const walls = [
    { x0, x1: x0 + t, y0, y1 }, { x0: x1 - t, x1, y0, y1 },
    { x0, x1: dx - dw, y0: Math.min(inner, inner - sgn * t), y1: Math.max(inner, inner - sgn * t) },
    { x0: dx + dw, x1, y0: Math.min(inner, inner - sgn * t), y1: Math.max(inner, inner - sgn * t) },
  ];
  const bunkD = Math.min(0.72, f.d * 0.48);
  return {
    walls,
    door: { rect: { x0: dx - dw, x1: dx + dw, y0: Math.min(inner, inner - sgn * t), y1: Math.max(inner, inner - sgn * t) }, x: dx, y: inner + sgn * 0.45, hingeX: dx - dw, w: dw * 2, plane: 'y', at: inner - sgn * t / 2, sgn },
    furniture: [{ x0: x0 + t, x1: x1 - t, y0: Math.min(outer, outer + sgn * bunkD), y1: Math.max(outer, outer + sgn * bunkD) }],
    inside: { x0: x0 + t, x1: x1 - t, y0: Math.min(outer + sgn * bunkD, inner - sgn * t), y1: Math.max(outer + sgn * bunkD, inner - sgn * t) },
    bunk: { outer, sgn, depth: bunkD },
  };
}

// ---- 洗手間：與 3D 共用的局部座標（x 沿門寬、z 朝門外） ----
export const LAV = { T: 0.035, toilet: { x: (W) => -W / 2 + 0.26, z: (D) => -D / 2 + 0.24, w: 0.34, d: 0.36, colD: 0.3 }, sink: { x: (W) => W / 2 - 0.2, z: (D) => -D / 2 + 0.3, w: 0.36, d: 0.42, colD: 0.32 } };
export function lavFrame(f, ac) {
  const side = Math.abs(f.y) > 0.3 && f.d < ac.width * 0.8;
  const face = side ? { x: 0, y: f.y < 0 ? 1 : -1 } : { x: f.x < ac.length / 2 ? 1 : -1, y: 0 };
  const tan = { x: -face.y, y: face.x };
  const W = side ? f.w : f.d, D = side ? f.d : f.w;
  const toSim = (lx, lz) => ({ x: f.x + face.x * lz + tan.x * lx, y: f.y + face.y * lz + tan.y * lx });
  const rect = (lx0, lx1, lz0, lz1) => { const a = toSim(lx0, lz0), b = toSim(lx1, lz1); return { x0: Math.min(a.x, b.x), x1: Math.max(a.x, b.x), y0: Math.min(a.y, b.y), y1: Math.max(a.y, b.y) }; };
  return { face, tan, W, D, toSim, rect, dw: W * 0.86 };
}
export function lavLayout(f, ac) {
  const fr = lavFrame(f, ac), { W, D, dw, rect, toSim } = fr, T = LAV.T;
  const tl = LAV.toilet, sk = LAV.sink;
  return {
    ...fr,
    walls: [rect(-W / 2, W / 2, -D / 2, -D / 2 + T), rect(-W / 2, -W / 2 + T, -D / 2, D / 2), rect(W / 2 - T, W / 2, -D / 2, D / 2),
      rect(-W / 2, -dw / 2, D / 2 - T, D / 2), rect(dw / 2, W / 2, D / 2 - T, D / 2)],
    door: { rect: rect(-dw / 2, dw / 2, D / 2 - T, D / 2), ...toSim(0, D / 2 + 0.45) },
    furniture: [rect(tl.x(W) - tl.w / 2, tl.x(W) + tl.w / 2, -D / 2, -D / 2 + tl.colD + 0.03), rect(sk.x(W) - sk.w / 2, sk.x(W) + sk.w / 2, -D / 2, -D / 2 + sk.colD)],
    inside: toSim(-0.04, D / 2 - T - 0.2),
    mirror: toSim(W / 2 - T - 0.003, sk.z(D)),
  };
}

// doorOpen: { [fixtureId]: true } 表示該房門開啟（可通行）
function obstacleRects(ac, doorOpen = {}, occupied = null) {
  const rects = [];
  activeSeats(ac).forEach((s) => {
    // 空座位：只有椅背擋路（可以從腿部空間橫向走進一排）
    // 座椅實際佔用：椅墊前緣到椅背後殼；有旅客的座位再加上膝蓋佔用的腿部空間
    const knee = occupied && occupied.has(s.id) ? 0.2 : 0;
    rects.push({ x0: s.x - s.d / 2 - 0.01 - knee, x1: s.x + s.d / 2 + 0.04, y0: s.y - s.w / 2, y1: s.y + s.w / 2, seat: true });
  });
  ac.fixtures.forEach((f) => {
    if (f.type === 'door') return;
    if (f.type === 'lav') {
      const r = lavLayout(f, ac);
      rects.push(...r.walls, ...r.furniture);
      if (!doorOpen[f.id]) rects.push(r.door.rect);
      return;
    }
    if (f.type === 'cockpit' || f.type === 'crewrest') {
      const r = roomLayout(f, ac);
      rects.push(...r.walls, ...r.furniture);
      if (!doorOpen[f.id]) rects.push(r.door.rect);
      return;
    }
    rects.push({ x0: f.x - f.w / 2, x1: f.x + f.w / 2, y0: f.y - f.d / 2, y1: f.y + f.d / 2 });
  });
  return rects;
}

// 行李櫃：只在座位區上方，每 ~1.5 m 一片櫃門（sim 與 3D 共用同一份編號）
export function binDoors(ac) {
  const rows = [...new Map(activeSeats(ac).map((st) => [st.row, st])).values()].sort((a, b) => a.x - b.x);
  const zones = [];
  rows.forEach((rw) => {
    const half = (rw.pitch || 0.8) / 2, last = zones[zones.length - 1];
    if (last && rw.x - half - last[1] < 0.9) last[1] = rw.x + half + 0.05;
    else zones.push([rw.x - half - 0.05, rw.x + half + 0.05]);
  });
  const doors = [];
  const R = ac.width / 2, inner = R - 0.74, wide = ac.width > 4.6;
  zones.forEach(([a, b], zi) => {
    const n = Math.max(1, Math.round((b - a) / 1.52)), w = (b - a) / n;
    for (let k = 0; k < n; k++) {
      const base = { x0: a + k * w, x1: a + (k + 1) * w, x: a + (k + 0.5) * w };
      // 兩側行李櫃：櫃門邊緣在 side*inner，面向走道（face = -side）
      for (const side of [-1, 1]) doors.push({ id: `bin:${zi}:${k}:${side}`, side, center: false, face: -side, edgeY: side * inner, bagY: side * (R - 0.45), ...base });
      // 雙走道機型的中央行李櫃：左右兩半各面向一條走道
      if (wide) for (const side of [-1, 1]) doors.push({ id: `bin:${zi}:${k}:c${side}`, side, center: true, face: side, edgeY: side * 0.75, bagY: side * 0.4, ...base });
    }
  });
  return { zones, doors, inner };
}

// 圓形 (x, y, r) 是否與任何障礙或機身側牆重疊
export function collides(grid, x, y, r = BODY_R) {
  const W = grid.W;
  // 側牆在頭部高度向內收（約 0.17 m），留出頭部空間，避免第一人稱鏡頭貼牆
  if (y - r < -W / 2 + 0.22 || y + r > W / 2 - 0.22 || x - r < 0 || x + r > grid.L) return true;
  for (const q of grid.rects) {
    const dx = Math.max(q.x0 - x, 0, x - q.x1), dy = Math.max(q.y0 - y, 0, y - q.y1);
    if (dx * dx + dy * dy < r * r) return true;
  }
  return false;
}

export function buildGrid(ac, doorOpen = {}, occupied = null) {
  const W = ac.width;
  const nx = Math.ceil(ac.length / CELL) + 1;
  const ny = Math.round(W / CELL) + 1;
  const g = new Uint8Array(nx * ny); // 1 = 阻擋
  const grid = { nx, ny, g, W, L: ac.length, rects: obstacleRects(ac, doorOpen, occupied) };
  for (let i = 0; i < nx; i++) for (let j = 0; j < ny; j++) {
    const p = fromCell(grid, i, j);
    if (collides(grid, p.x, p.y, BODY_R + 0.02)) g[j * nx + i] = 1;
  }
  return grid;
}
export const toCell = (grid, x, y) => [Math.round(x / CELL), Math.round((y + grid.W / 2) / CELL)];
export const fromCell = (grid, i, j) => ({ x: i * CELL, y: j * CELL - grid.W / 2 });
export function walkable(grid, x, y) {
  const [i, j] = toCell(grid, x, y);
  if (i < 0 || j < 0 || i >= grid.nx || j >= grid.ny) return false;
  return grid.g[j * grid.nx + i] === 0;
}

function nearestFree(grid, i, j) {
  i = Math.max(0, Math.min(grid.nx - 1, i)); j = Math.max(0, Math.min(grid.ny - 1, j));
  if (grid.g[j * grid.nx + i] === 0) return [i, j];
  for (let r = 1; r < 60; r++) {
    let best = null, bd = 1e9;
    for (let di = -r; di <= r; di++) for (let dj = -r; dj <= r; dj++) {
      if (Math.max(Math.abs(di), Math.abs(dj)) !== r) continue;
      const a = i + di, b = j + dj;
      if (a < 0 || b < 0 || a >= grid.nx || b >= grid.ny) continue;
      if (grid.g[b * grid.nx + a] === 0) { const d = Math.hypot(di, dj); if (d < bd) { bd = d; best = [a, b]; } }
    }
    if (best) return best;
  }
  return [i, j];
}

// 二元堆積（A* 開放列表）
class Heap {
  constructor() { this.a = []; }
  push(n) { const a = this.a; a.push(n); let i = a.length - 1; while (i > 0) { const p = (i - 1) >> 1; if (a[p][0] <= a[i][0]) break; [a[p], a[i]] = [a[i], a[p]]; i = p; } }
  pop() {
    const a = this.a, top = a[0], last = a.pop();
    if (a.length) { a[0] = last; let i = 0; for (;;) { const l = i * 2 + 1, r = l + 1; let m = i; if (l < a.length && a[l][0] < a[m][0]) m = l; if (r < a.length && a[r][0] < a[m][0]) m = r; if (m === i) break; [a[m], a[i]] = [a[i], a[m]]; i = m; } }
    return top;
  }
  get size() { return this.a.length; }
}

export function findPath(grid, from, to) {
  const [si, sj] = nearestFree(grid, ...toCell(grid, from.x, from.y));
  const [ti, tj] = nearestFree(grid, ...toCell(grid, to.x, to.y));
  const { nx, ny, g } = grid;
  const idx = (i, j) => j * nx + i;
  const cost = new Float32Array(nx * ny).fill(Infinity);
  const prev = new Int32Array(nx * ny).fill(-1);
  const open = new Heap();
  open.push([0, si, sj]);
  cost[idx(si, sj)] = 0;
  const dirs = [[1, 0, 1], [-1, 0, 1], [0, 1, 1], [0, -1, 1], [1, 1, 1.414], [1, -1, 1.414], [-1, 1, 1.414], [-1, -1, 1.414]];
  let found = false;
  while (open.size) {
    const [f, i, j] = open.pop();
    if (i === ti && j === tj) { found = true; break; }
    const c = cost[idx(i, j)];
    if (f - Math.hypot(ti - i, tj - j) > c + 1e-4) continue; // 過期節點
    for (const [di, dj, w] of dirs) {
      const a = i + di, b = j + dj;
      if (a < 0 || b < 0 || a >= nx || b >= ny || g[idx(a, b)]) continue;
      if (di && dj && (g[idx(i + di, j)] || g[idx(i, j + dj)])) continue;
      const nc = c + w;
      if (nc < cost[idx(a, b)]) { cost[idx(a, b)] = nc; prev[idx(a, b)] = idx(i, j); open.push([nc + Math.hypot(ti - a, tj - b), a, b]); }
    }
  }
  if (!found) return [to];
  const pts = [];
  let k = idx(ti, tj);
  while (k !== -1) { pts.push(fromCell(grid, k % nx, Math.floor(k / nx))); k = prev[k]; }
  pts.reverse();
  // 拉直：能直線走到的點就略過中間點
  const out = [pts[0]];
  let anchor = 0;
  for (let n = 2; n < pts.length; n++) {
    if (!lineClear(grid, pts[anchor], pts[n])) { out.push(pts[n - 1]); anchor = n - 1; }
  }
  if (pts.length > 1) out.push(pts[pts.length - 1]);
  return out.length > 1 ? out.slice(1) : out;
}

function lineClear(grid, a, b) {
  const d = Math.hypot(b.x - a.x, b.y - a.y);
  const n = Math.ceil(d / (CELL * 0.5));
  for (let k = 1; k < n; k++) { const t = k / n; if (!walkable(grid, a.x + (b.x - a.x) * t, a.y + (b.y - a.y) * t)) return false; }
  return true;
}

// 第一人稱移動：碰到障礙時沿牆面滑動
export function slideMove(grid, p, dx, dy, r = BODY_R) {
  if (!collides(grid, p.x + dx, p.y + dy, r)) { p.x += dx; p.y += dy; return; }
  const len0 = Math.hypot(dx, dy);
  if (Math.abs(dx) > len0 * 0.3 && !collides(grid, p.x + dx, p.y, r)) { p.x += dx; return; }
  if (Math.abs(dy) > len0 * 0.3 && !collides(grid, p.x, p.y + dy, r)) { p.y += dy; return; }
  for (const s of [0.5, 0.25]) { if (!collides(grid, p.x + dx * s, p.y + dy * s, r)) { p.x += dx * s; p.y += dy * s; return; } }
  // 正面被擋住：找左右最近、可以繼續前進的通道，往那邊側移（例如雙走道機型各艙等走道位置不同）
  const len = Math.hypot(dx, dy);
  if (!len) return;
  const ux = dx / len, uy = dy / len, px = -uy, py = ux;
  const ahead = Math.max(len, 0.08);
  for (let o = 0.04; o <= 0.9; o += 0.04) {
    for (const sg of [1, -1]) {
      const lx = p.x + px * o * sg, ly = p.y + py * o * sg;
      if (collides(grid, lx, ly, r) || collides(grid, lx + ux * ahead, ly + uy * ahead, r)) continue;
      // 側移途中不可穿過障礙
      let clear = true;
      for (let k = 0.04; k < o; k += 0.04) if (collides(grid, p.x + px * k * sg, p.y + py * k * sg, r)) { clear = false; break; }
      if (!clear) continue;
      const step = Math.min(o, len);
      p.x += px * step * sg; p.y += py * step * sg;
      return;
    }
  }
}

// 走到座位旁：該排最近走道點
export function approachPoint(ac, grid, target) {
  // 沿 y 方向在 target.x 找最近的可走點
  let best = null, bd = 1e9;
  for (let dx = -0.2; dx <= 0.2; dx += 0.2) {
    for (let y = -ac.width / 2; y <= ac.width / 2; y += CELL) {
      if (walkable(grid, target.x + dx, y)) {
        const d = Math.abs(y - target.y) + Math.abs(dx) * 2;
        if (d < bd) { bd = d; best = { x: target.x + dx, y }; }
      }
    }
  }
  if (!best) { // 設施佔滿整個寬度時改找前後
    for (let dx = 0.2; dx < 4; dx += 0.2) {
      for (const sx of [-1, 1]) if (walkable(grid, target.x + dx * sx, 0)) return { x: target.x + dx * sx, y: 0 };
    }
  }
  return best || { x: target.x, y: 0 };
}

// ---- 行李櫃內的行李槽位（模擬與 3D 共用）----
export function binCapacity(door) { return Math.max(1, Math.floor((door.x1 - door.x0 - 0.12) / 0.42)); }
export const binSpot = (d, off = 0.35) => ({ x: d.x, y: d.edgeY + d.face * off });
// 回傳行李在模擬座標中的位置與姿態：tidy = 推到底擺正；否則斜放並突出櫃外
export function bagPose(door, idx, tidy, W) {
  const cap = binCapacity(door), slotW = (door.x1 - door.x0 - 0.12) / cap;
  const R = W / 2;
  const x = door.x0 + 0.06 + (idx + 0.5) * slotW;
  const by = door.bagY ?? door.side * (R - 0.45), ey = door.edgeY ?? door.side * (R - 0.74), face = door.face ?? -door.side;
  if (tidy) return { x, y: by, h: door.center ? 1.86 : 1.77, yaw: 0, roll: 0 };
  const k = idx % 2 ? 1 : -1;
  return { x: x + k * 0.04, y: ey - face * 0.08, h: door.center ? 1.9 : 1.81, yaw: 0.5 * k, roll: -0.22 * face };
}

// 側身擠進一排座位時使用的較小碰撞半徑（雙腿併攏、面向機頭）
export const ROW_R = 0.09;
