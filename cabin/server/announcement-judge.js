// 廣播評分路由：掛到你現有的 3012 Express 伺服器上
//
// 用法（在 3012 伺服器的主程式中）：
//   const mountAnnouncementJudge = require('./announcement-judge');
//   mountAnnouncementJudge(app, askAI);
//
// askAI 是你伺服器「現有」呼叫 AI 的函式：輸入一段提示文字，回傳 AI 的回覆文字（Promise<string>）。
// 這樣就沿用你伺服器原本的 AI 服務與 API 金鑰，不需要另外設定。
//
// 端點：POST /api/judge-announcement
//   請求 { reference, transcript, keywords, speaker, rank, localScore }
//   回應 { score: 0-100, feedback: '學姊/座艙長口吻的講評' }

function buildPrompt({ reference, transcript, keywords = [], speaker = '學姊', rank = '空服員', localScore }) {
  return [
    `你是航空公司的「${speaker}」，正在考核一位職級為「${rank}」的空服員所做的機上廣播。`,
    '請比較「標準廣播詞」與「空服員實際廣播內容」（實際內容來自語音辨識，可能有少量錯字或同音字，請不要因此扣分）。',
    '評分重點：1. 重要資訊是否完整（尤其是關鍵詞）；2. 用詞是否正確、專業、有禮貌；3. 是否有多餘或錯誤的資訊；4. 語句是否通順。',
    '',
    `標準廣播詞：${reference}`,
    `關鍵詞：${keywords.join('、') || '（無）'}`,
    `空服員實際廣播內容：${transcript || '（沒有內容）'}`,
    localScore != null ? `（參考：系統文字比對分數為 ${localScore} 分）` : '',
    '',
    `請用「${speaker}」對學弟妹說話的口吻，以繁體中文給出 2～3 句具體講評（指出做得好的地方與需要改進的地方）。`,
    '只輸出 JSON，不要有其他文字，格式：{"score": 0到100的整數, "feedback": "講評"}',
  ].join('\n');
}

function parseResult(text, fallbackScore) {
  const m = String(text || '').match(/\{[\s\S]*\}/);
  if (m) {
    try {
      const j = JSON.parse(m[0]);
      const score = Math.max(0, Math.min(100, Math.round(Number(j.score))));
      if (Number.isFinite(score)) return { score, feedback: String(j.feedback || '').trim() };
    } catch (e) { /* 落到下方 */ }
  }
  // AI 沒有回傳 JSON 時：用文字當講評、沿用本機分數
  return { score: fallbackScore ?? 60, feedback: String(text || '').trim().slice(0, 300) };
}

module.exports = function mountAnnouncementJudge(app, askAI, path = '/api/judge-announcement') {
  if (typeof askAI !== 'function') throw new Error('mountAnnouncementJudge: 需要傳入 askAI(prompt) 函式');

  // 允許從其他埠開啟的機艙頁面呼叫（例如用 8080 開 cabin、AI 在 3012）
  const cors = (res) => {
    res.set('Access-Control-Allow-Origin', '*');
    res.set('Access-Control-Allow-Methods', 'POST, OPTIONS');
    res.set('Access-Control-Allow-Headers', 'Content-Type');
  };
  app.options(path, (req, res) => { cors(res); res.sendStatus(204); });

  app.post(path, async (req, res) => {
    cors(res);
    const body = req.body || {};
    if (typeof body.reference !== 'string') {
      return res.status(400).json({ error: '缺少 reference（標準廣播詞）。請確認伺服器有 app.use(express.json())' });
    }
    try {
      const reply = await askAI(buildPrompt(body));
      res.json(parseResult(reply, body.localScore));
    } catch (e) {
      console.error('[judge-announcement] AI 呼叫失敗：', e);
      res.status(502).json({ error: 'AI 呼叫失敗', detail: String(e.message || e) });
    }
  });
};

module.exports.buildPrompt = buildPrompt;
module.exports.parseResult = parseResult;
