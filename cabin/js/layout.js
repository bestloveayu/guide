// 機艙佈局：由規格產生座位與設施、編輯操作、走道網格與尋路
import { AIRCRAFT_SPECS } from './data.js';

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

function obstacleRects(ac) {
  const rects = [];
  activeSeats(ac).forEach((s) => rects.push({ x0: s.x - s.d / 2, x1: s.x + s.d / 2, y0: s.y - s.w / 2, y1: s.y + s.w / 2 }));
  ac.fixtures.forEach((f) => { if (f.type !== 'door') rects.push({ x0: f.x - f.w / 2, x1: f.x + f.w / 2, y0: f.y - f.d / 2, y1: f.y + f.d / 2 }); });
  return rects;
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

export function buildGrid(ac) {
  const W = ac.width;
  const nx = Math.ceil(ac.length / CELL) + 1;
  const ny = Math.round(W / CELL) + 1;
  const g = new Uint8Array(nx * ny); // 1 = 阻擋
  const grid = { nx, ny, g, W, L: ac.length, rects: obstacleRects(ac) };
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
