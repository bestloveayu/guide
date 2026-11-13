// 本機測試伺服器：不需安裝任何套件、不需要 API 金鑰
//   node cabin/server/test-server.js        （預設埠 3013，可用 PORT=xxxx 改）
// 1. 提供機艙網頁：http://localhost:3013/cabin/
// 2. 提供模擬的 AI 廣播評分：POST /api/judge-announcement
//    請求 / 回應格式與正式版（announcement-judge.js）完全相同，
//    之後接上真正的 3012 AI 伺服器時，只要改「設定」裡的網址即可。
const http = require('http');
const fs = require('fs');
const path = require('path');
const { buildPrompt, parseResult } = require('./announcement-judge');

const PORT = Number(process.env.PORT) || 3013;
const ROOT = path.resolve(__dirname, '..', '..'); // repo 根目錄（含 cabin/）
const TYPES = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.css': 'text/css; charset=utf-8', '.json': 'application/json', '.png': 'image/png', '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg', '.svg': 'image/svg+xml', '.mp3': 'audio/mpeg', '.md': 'text/plain; charset=utf-8' };

// ---- 模擬 AI：用文字比對評分，再以學姊/座艙長口吻產生講評 ----
const norm = (s) => String(s || '').toLowerCase().replace(/[\s，。、；：！？,.;:!?「」『』（）()…\-—"'“”]/g, '');
function lcs(a, b) {
  let prev = new Array(b.length + 1).fill(0);
  for (let i = 1; i <= a.length; i++) {
    const cur = [0];
    for (let j = 1; j <= b.length; j++) cur[j] = a[i - 1] === b[j - 1] ? prev[j - 1] + 1 : Math.max(prev[j], cur[j - 1]);
    prev = cur;
  }
  return prev[b.length];
}
const pick = (arr) => arr[Math.floor(Math.random() * arr.length)];

async function mockAskAI(prompt, body) {
  const ref = norm(body.reference), said = norm(body.transcript);
  const keywords = body.keywords || [];
  const hit = keywords.filter((k) => said.includes(norm(k)));
  const missing = keywords.filter((k) => !said.includes(norm(k)));
  const l = said ? lcs(ref, said) : 0;
  const recall = ref.length ? l / ref.length : 0, precision = said.length ? l / said.length : 0;
  const f1 = recall + precision ? (2 * recall * precision) / (recall + precision) : 0;
  const kw = keywords.length ? hit.length / keywords.length : f1;
  const score = Math.round(Math.min(100, (f1 * 0.5 + kw * 0.5) * 100));

  const parts = [];
  if (!said) parts.push('你什麼都沒講耶，旅客會以為廣播系統壞了。');
  else if (score >= 90) parts.push(pick(['很好，內容完整又清楚，旅客一聽就懂。', '這次廣播很穩，保持這個水準！', '不錯喔，聽起來很專業。']));
  else if (score >= 75) parts.push(pick(['整體不錯，有幾個地方再注意一下就更好了。', '大致正確，但還可以更完整。']));
  else if (score >= 55) parts.push(pick(['重點漏了一些，旅客可能會錯過重要資訊。', '內容不太完整，要再熟悉標準廣播詞。']));
  else parts.push(pick(['這樣的廣播旅客會很困惑，回去要多練習。', '跟標準廣播詞差很多，下次先看著講稿練熟。']));
  if (said && hit.length) parts.push(`「${hit.slice(0, 2).join('」、「')}」有講到，很好。`);
  if (said && missing.length) parts.push(`但是漏了「${missing.join('」、「')}」，這是一定要提醒旅客的。`);
  if (said && said.length < ref.length * 0.6) parts.push('內容太短了，別省略段落。');
  if (said.length > ref.length * 1.5) parts.push('多加了太多自己的話，廣播要簡潔。');

  await new Promise((r) => setTimeout(r, 500 + Math.random() * 700)); // 模擬 AI 思考時間
  return JSON.stringify({ score, feedback: parts.join('') });
}

function sendJSON(res, status, obj) {
  res.writeHead(status, { 'Content-Type': 'application/json; charset=utf-8', 'Access-Control-Allow-Origin': '*' });
  res.end(JSON.stringify(obj));
}

const server = http.createServer((req, res) => {
  const url = new URL(req.url, `http://${req.headers.host}`);

  if (url.pathname === '/api/judge-announcement') {
    if (req.method === 'OPTIONS') {
      res.writeHead(204, { 'Access-Control-Allow-Origin': '*', 'Access-Control-Allow-Methods': 'POST, OPTIONS', 'Access-Control-Allow-Headers': 'Content-Type' });
      return res.end();
    }
    if (req.method !== 'POST') return sendJSON(res, 405, { error: '請用 POST' });
    let raw = '';
    req.on('data', (c) => { raw += c; if (raw.length > 1e6) req.destroy(); });
    req.on('end', async () => {
      let body;
      try { body = JSON.parse(raw || '{}'); } catch (e) { return sendJSON(res, 400, { error: '請求不是 JSON' }); }
      if (typeof body.reference !== 'string') return sendJSON(res, 400, { error: '缺少 reference（標準廣播詞）' });
      const reply = await mockAskAI(buildPrompt(body), body); // 正式版在這裡呼叫真正的 AI
      const result = parseResult(reply, body.localScore);
      console.log(`[評分] ${body.speaker || ''}｜${result.score} 分｜「${String(body.transcript || '').slice(0, 30)}…」`);
      sendJSON(res, 200, result);
    });
    return;
  }

  // 靜態檔案
  let p = decodeURIComponent(url.pathname);
  if (p === '/') { res.writeHead(302, { Location: '/cabin/' }); return res.end(); }
  if (p.endsWith('/')) p += 'index.html';
  const file = path.join(ROOT, p);
  if (!file.startsWith(ROOT)) { res.writeHead(403); return res.end(); }
  fs.readFile(file, (err, data) => {
    if (err) { res.writeHead(404, { 'Content-Type': 'text/plain; charset=utf-8' }); return res.end('找不到檔案'); }
    res.writeHead(200, { 'Content-Type': TYPES[path.extname(file).toLowerCase()] || 'application/octet-stream' });
    res.end(data);
  });
});

server.on('error', (e) => {
  if (e.code === 'EADDRINUSE') console.error(`埠 ${PORT} 已被使用，請改用其他埠，例如：PORT=3014 node cabin/server/test-server.js`);
  else console.error(e);
  process.exit(1);
});

server.listen(PORT, () => {
  console.log('========================================');
  console.log(' 虛擬機艙・本機測試伺服器已啟動');
  console.log(` 開啟網頁：http://localhost:${PORT}/cabin/`);
  console.log(' 評分端點：/api/judge-announcement（模擬 AI）');
  console.log(' 按 Ctrl+C 結束');
  console.log('========================================');
});
