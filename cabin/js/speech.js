// 廣播詞：語音辨識、評分、NPC 回饋
const SR = window.SpeechRecognition || window.webkitSpeechRecognition;
export const speechSupported = !!SR;

export function startRecognition(lang, onText, onEnd) {
  if (!SR) return null;
  const rec = new SR();
  rec.lang = lang || 'zh-TW';
  rec.continuous = true;
  rec.interimResults = true;
  let finalText = '';
  rec.onresult = (e) => {
    let interim = '';
    for (let i = e.resultIndex; i < e.results.length; i++) {
      const t = e.results[i][0].transcript;
      if (e.results[i].isFinal) finalText += t; else interim += t;
    }
    onText(finalText + interim);
  };
  rec.onerror = (e) => onEnd && onEnd(e.error);
  rec.onend = () => onEnd && onEnd();
  rec.start();
  return rec;
}

const norm = (s) => (s || '').toLowerCase().replace(/[\s，。、；：！？,.;:!?「」『』（）()…\-—"'“”]/g, '');

function lcs(a, b) {
  const m = a.length, n = b.length;
  if (!m || !n) return 0;
  let prev = new Uint16Array(n + 1), cur = new Uint16Array(n + 1);
  for (let i = 1; i <= m; i++) {
    for (let j = 1; j <= n; j++) cur[j] = a[i - 1] === b[j - 1] ? prev[j - 1] + 1 : Math.max(prev[j], cur[j - 1]);
    [prev, cur] = [cur, prev];
  }
  return prev[n];
}

// 本機評分：字元 LCS 的 F1（內容完整度與準確度）+ 關鍵詞涵蓋率
export function scoreLocal(reference, transcript, keywords = []) {
  const r = norm(reference), t = norm(transcript);
  if (!t) return { score: 0, recall: 0, precision: 0, missing: keywords.slice(), hit: [], lengthRatio: 0 };
  const l = lcs(r, t);
  const recall = l / r.length, precision = l / t.length;
  const f1 = recall + precision ? (2 * recall * precision) / (recall + precision) : 0;
  const hit = keywords.filter((k) => t.includes(norm(k)));
  const missing = keywords.filter((k) => !t.includes(norm(k)));
  const kw = keywords.length ? hit.length / keywords.length : f1;
  const score = Math.round(Math.min(100, (f1 * 0.55 + kw * 0.45) * 100));
  return { score, recall, precision, hit, missing, lengthRatio: t.length / r.length };
}

// 由學姊 / 座艙長口吻產生回饋
export function npcFeedback(npcName, res) {
  const lines = [];
  if (res.score >= 90) lines.push('很好！咬字清楚、內容完整，旅客都聽得懂。');
  else if (res.score >= 75) lines.push('整體不錯，但還有幾個地方可以再加強。');
  else if (res.score >= 55) lines.push('廣播內容不太完整，旅客可能會漏掉重要資訊喔。');
  else lines.push('這樣的廣播旅客會很困惑，回去要再多練習標準廣播詞。');
  if (res.missing && res.missing.length) lines.push(`你漏掉了「${res.missing.join('」、「')}」。`);
  if (res.lengthRatio && res.lengthRatio < 0.6) lines.push('內容太短了，別省略段落。');
  else if (res.lengthRatio > 1.5) lines.push('加了太多額外的話，廣播要簡潔。');
  if (res.precision && res.precision < 0.6 && res.score < 75) lines.push('有些用詞跟標準廣播詞差很多，要背熟喔。');
  return { speaker: npcName, text: lines.join(''), score: res.score };
}

// 可選：外部 AI 評分端點（例如你本機的伺服器）。
// POST { reference, transcript, keywords, speaker, rank } → 期望回傳 { score:0-100, feedback:'...' }
export async function scoreAnnouncement({ reference, transcript, keywords, speaker, rank, endpoint }) {
  const local = scoreLocal(reference, transcript, keywords);
  if (endpoint) {
    try {
      const ctrl = new AbortController();
      const timer = setTimeout(() => ctrl.abort(), 20000);
      const resp = await fetch(endpoint, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ reference, transcript, keywords, speaker, rank, localScore: local.score }),
        signal: ctrl.signal,
      });
      clearTimeout(timer);
      if (resp.ok) {
        const j = await resp.json();
        if (typeof j.score === 'number') return { speaker, text: j.feedback || '', score: Math.round(j.score), source: 'ai', local };
      }
    } catch (e) { console.warn('AI 評分端點失敗，改用本機評分', e); }
  }
  return { ...npcFeedback(speaker, local), source: 'local', local };
}

export function speak(text, enabled = true) {
  if (!enabled || !window.speechSynthesis) return;
  try {
    window.speechSynthesis.cancel();
    const u = new SpeechSynthesisUtterance(text);
    u.lang = 'zh-TW';
    u.rate = 1.05;
    window.speechSynthesis.speak(u);
  } catch (e) { /* ignore */ }
}

// 設定頁「測試連線」：直接呼叫端點並回報實際錯誤（不做本機備援）
export async function testEndpoint(endpoint) {
  if (!endpoint) return { ok: false, error: '尚未填入端點網址' };
  const t0 = performance.now();
  try {
    const ctrl = new AbortController();
    const timer = setTimeout(() => ctrl.abort(), 20000);
    const resp = await fetch(endpoint, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ reference: '各位貴賓，請繫好安全帶，謝謝。', transcript: '各位貴賓請繫好安全帶謝謝', keywords: ['安全帶'], speaker: '學姊', rank: '見習空服員', localScore: 95 }),
      signal: ctrl.signal,
    });
    clearTimeout(timer);
    const text = await resp.text();
    if (!resp.ok) return { ok: false, error: `伺服器回應 ${resp.status}：${text.slice(0, 200)}` };
    let j;
    try { j = JSON.parse(text); } catch (e) { return { ok: false, error: `回應不是 JSON：${text.slice(0, 200)}` }; }
    if (typeof j.score !== 'number') return { ok: false, error: `回應缺少數字 score：${text.slice(0, 200)}` };
    return { ok: true, score: j.score, feedback: j.feedback || '', ms: Math.round(performance.now() - t0) };
  } catch (e) {
    const msg = e.name === 'AbortError' ? '逾時（20 秒）' : `無法連線（${e.message}）。請確認 3012 伺服器已啟動、路由已掛上，且允許跨來源（CORS）`;
    return { ok: false, error: msg };
  }
}
