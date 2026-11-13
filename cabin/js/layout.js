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

// ---- 走道網格（A* 尋路與碰撞） ----
export const CELL = 0.2;
export function buildGrid(ac) {
  const W = ac.width;
  const nx = Math.ceil(ac.length / CELL) + 1;
  const ny = Math.ceil(W / CELL);
  const g = new Uint8Array(nx * ny); // 1 = 阻擋
  const block = (cx, cy, w, d, pad = 0.04) => {
    const xa = Math.floor((cx - w / 2 - pad) / CELL), xb = Math.floor((cx + w / 2 + pad) / CELL);
    const ya = Math.floor((cy - d / 2 - pad + W / 2) / CELL), yb = Math.floor((cy + d / 2 + pad + W / 2) / CELL);
    for (let i = Math.max(0, xa); i <= Math.min(nx - 1, xb); i++)
      for (let j = Math.max(0, ya); j <= Math.min(ny - 1, yb); j++) g[j * nx + i] = 1;
  };
  for (let j = 0; j < ny; j++) { g[j * nx] = 1; g[j * nx + nx - 1] = 1; }
  for (let i = 0; i < nx; i++) { g[i] = 1; g[(ny - 1) * nx + i] = 1; }
  activeSeats(ac).forEach((s) => block(s.x, s.y, s.d + 0.12, s.w));
  ac.fixtures.forEach((f) => { if (f.type !== 'door') block(f.x, f.y, f.w, f.d); });
  return { nx, ny, g, W };
}
export const toCell = (grid, x, y) => [Math.round(x / CELL), Math.round((y + grid.W / 2) / CELL)];
export const fromCell = (grid, i, j) => ({ x: i * CELL, y: j * CELL - grid.W / 2 });
export function walkable(grid, x, y) {
  const [i, j] = toCell(grid, x, y);
  if (i < 0 || j < 0 || i >= grid.nx || j >= grid.ny) return false;
  return grid.g[j * grid.nx + i] === 0;
}

function nearestFree(grid, i, j) {
  if (grid.g[j * grid.nx + i] === 0) return [i, j];
  for (let r = 1; r < 25; r++) {
    let best = null, bd = 1e9;
    for (let di = -r; di <= r; di++) for (let dj = -r; dj <= r; dj++) {
      const a = i + di, b = j + dj;
      if (a < 0 || b < 0 || a >= grid.nx || b >= grid.ny) continue;
      if (grid.g[b * grid.nx + a] === 0) { const d = Math.abs(di) * 1.5 + Math.abs(dj); if (d < bd) { bd = d; best = [a, b]; } }
    }
    if (best) return best;
  }
  return [i, j];
}

export function findPath(grid, from, to) {
  const [si, sj] = nearestFree(grid, ...toCell(grid, from.x, from.y));
  const [ti, tj] = nearestFree(grid, ...toCell(grid, to.x, to.y));
  const { nx, ny, g } = grid;
  const idx = (i, j) => j * nx + i;
  const cost = new Float32Array(nx * ny).fill(Infinity);
  const prev = new Int32Array(nx * ny).fill(-1);
  const open = [[0, si, sj]];
  cost[idx(si, sj)] = 0;
  const dirs = [[1, 0, 1], [-1, 0, 1], [0, 1, 1], [0, -1, 1], [1, 1, 1.414], [1, -1, 1.414], [-1, 1, 1.414], [-1, -1, 1.414]];
  let found = false, iter = 0;
  while (open.length && iter++ < 60000) {
    // 小型網格：線性取最小值即可
    let bi = 0;
    for (let k = 1; k < open.length; k++) if (open[k][0] < open[bi][0]) bi = k;
    const [, i, j] = open.splice(bi, 1)[0];
    if (i === ti && j === tj) { found = true; break; }
    const c = cost[idx(i, j)];
    for (const [di, dj, w] of dirs) {
      const a = i + di, b = j + dj;
      if (a < 0 || b < 0 || a >= nx || b >= ny || g[idx(a, b)]) continue;
      if (di && dj && (g[idx(i + di, j)] || g[idx(i, j + dj)])) continue;
      const nc = c + w;
      if (nc < cost[idx(a, b)]) {
        cost[idx(a, b)] = nc; prev[idx(a, b)] = idx(i, j);
        open.push([nc + Math.hypot(ti - a, tj - b), a, b]);
      }
    }
  }
  if (!found) return [to];
  const pts = [];
  let k = idx(ti, tj);
  while (k !== -1) { pts.push(fromCell(grid, k % nx, Math.floor(k / nx))); k = prev[k]; }
  pts.reverse();
  // 簡化：只保留轉折點
  const out = [];
  for (let n = 0; n < pts.length; n++) {
    if (n === 0 || n === pts.length - 1) { out.push(pts[n]); continue; }
    const a = pts[n - 1], b = pts[n], c = pts[n + 1];
    if (Math.abs((b.x - a.x) * (c.y - b.y) - (b.y - a.y) * (c.x - b.x)) > 1e-6) out.push(b);
  }
  return out;
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
