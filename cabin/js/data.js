// 靜態資料：飛行階段、職級、旅客類型、機型範本、預設劇本
// 座標系：x 沿機身由機頭(0)往機尾增加（公尺）；y 橫向，左側(A 座位，左舷)為負值。

export const PHASES = [
  { id: 'boarding', name: '登機', dur: 90 },
  { id: 'pushback', name: '關門與推出', dur: 45 },
  { id: 'taxi', name: '滑行', dur: 55 },
  { id: 'takeoff', name: '起飛', dur: 25 },
  { id: 'climb', name: '爬升', dur: 35 },
  { id: 'cruise', name: '巡航', dur: 200 },
  { id: 'descent', name: '下降', dur: 70 },
  { id: 'landing', name: '落地', dur: 25 },
  { id: 'deplane', name: '下機', dur: 60 },
];
export const phaseName = (id) => (PHASES.find((p) => p.id === id) || {}).name || id;

export const RANKS = [
  { name: '見習空服員', xp: 0, desc: '由學姊帶飛，熟悉登機、安全檢查與基本服務。' },
  { name: '空服員', xp: 300, desc: '開始負責安全示範與下降廣播，處理更多旅客需求。' },
  { name: '資深空服員', xp: 900, desc: '負責亂流廣播、醫療事件等高壓情境，帶領新人。' },
  { name: '座艙長', xp: 1800, desc: '管理組員：分派任務、處理組員衝突、向機長報告客艙狀態。' },
];
export const rankOf = (xp) => {
  let r = 0;
  RANKS.forEach((k, i) => { if (xp >= k.xp) r = i; });
  return r;
};

export const PRIORITY = {
  1: { name: '緊急', color: '#e5484d' },
  2: { name: '高', color: '#f5a623' },
  3: { name: '一般', color: '#3e8ed0' },
  4: { name: '低', color: '#8a94a6' },
};

export const PAX_TYPES = {
  normal: { name: '一般旅客', icon: '🙂', color: '#7aa2c8' },
  vip: { name: 'VIP / 會員', icon: '⭐', color: '#d4a72c' },
  elder: { name: '年長旅客', icon: '👴', color: '#a58a6b' },
  child: { name: '兒童 / 家庭', icon: '🧒', color: '#6cc18d' },
  meal: { name: '特殊餐', icon: '🥗', color: '#7fb04f' },
  mobility: { name: '行動不便', icon: '♿', color: '#5aa0a8' },
  anxious: { name: '飛行焦慮', icon: '😰', color: '#9b7ad1' },
  drunk: { name: '飲酒過量', icon: '🍺', color: '#d1785a' },
  medical: { name: '身體不適', icon: '🤒', color: '#e06c75' },
};

export const FIXTURE_TYPES = {
  cockpit: { name: '駕駛艙', color: '#3a4256' },
  door: { name: '艙門', color: '#e0b84a' },
  galley: { name: '廚房', color: '#9aa4b5' },
  lav: { name: '洗手間', color: '#7a8db0' },
  jumpseat: { name: '組員座椅', color: '#c7604f' },
  closet: { name: '衣帽櫃', color: '#8e8a7d' },
  bulkhead: { name: '隔板', color: '#5d6578' },
  crewrest: { name: '組員休息室', color: '#7d6b8f' },
};

export const SEAT_CLASS = {
  J: { name: '商務艙', color: '#6a5596' },
  W: { name: '豪華經濟艙', color: '#2f8090' },
  Y: { name: '經濟艙', color: '#3b64a0' },
};

export const AIRLINES = [
  { name: '星嵐航空', accent: '#c8102e', jacket: '#1d2f5c' },
  { name: '海峽航空', accent: '#0f9d8a', jacket: '#16454f' },
  { name: '晨曦航空', accent: '#e58a1f', jacket: '#4a2f22' },
  { name: '雲杉航空', accent: '#7a4fc2', jacket: '#2b2440' },
];

// 機型規格。segments 依序沿 x 方向排列：fixtures（設施區）或 seats（座位區）。
// fixture 項目：[type, side(L/R/C/F), at(段內起點), w(沿機身長), d(橫向深), label]
export const TEMPLATE_VERSION = 2; // 範本有變動時遞增（未編輯過的範本機艙會自動更新）

export const AIRCRAFT_SPECS = [
  {
    id: 'a321',
    name: 'A321 單走道（2-2 / 3-3）',
    width: 3.7,
    segments: [
      { type: 'fixtures', len: 2.4, items: [['cockpit', 'F', 0, 2.2, 3.7, '駕駛艙']] },
      {
        type: 'fixtures', len: 2.6, items: [
          ['door', 'L', 0.2, 0.9, 0.25, 'L1'], ['door', 'R', 0.2, 0.9, 0.25, 'R1'],
          ['jumpseat', 'L', 1.2, 0.5, 0.5, 'L1 組員座'], ['galley', 'R', 1.2, 1.3, 0.9, '前廚房'],
          ['lav', 'L', 1.75, 0.8, 0.9, '洗手間'],
        ],
      },
      { type: 'seats', cls: 'J', from: 1, to: 3, pattern: 'AC-DF', pitch: 1.0, seatW: 0.62 },
      { type: 'seats', cls: 'Y', from: 5, to: 31, skip: [13], pattern: 'ABC-DEF', pitch: 0.79, seatW: 0.46 },
      { type: 'fixtures', len: 2.2, items: [['crewrest', 'L', 0.15, 1.9, 1.42, '組員休息室'], ['closet', 'R', 0.6, 0.9, 0.6, '衣帽櫃']] },
      {
        type: 'fixtures', len: 2.8, items: [
          ['lav', 'L', 0.1, 0.9, 0.9, '洗手間'], ['lav', 'R', 0.1, 0.9, 0.9, '洗手間'],
          ['door', 'L', 1.2, 0.9, 0.25, 'L2'], ['door', 'R', 1.2, 0.9, 0.25, 'R2'],
          ['galley', 'F', 2.15, 0.6, 3.0, '後廚房'], ['jumpseat', 'R', 1.2, 0.5, 0.5, 'R2 組員座'],
        ],
      },
    ],
  },
  {
    id: 'b789',
    name: 'B787-9 雙走道（1-2-1 / 2-3-2 / 3-3-3）',
    width: 5.5,
    segments: [
      { type: 'fixtures', len: 2.6, items: [['cockpit', 'F', 0, 2.4, 5.5, '駕駛艙']] },
      {
        type: 'fixtures', len: 3.0, items: [
          ['door', 'L', 0.2, 1.0, 0.25, 'L1'], ['door', 'R', 0.2, 1.0, 0.25, 'R1'],
          ['galley', 'C', 0.3, 1.8, 1.6, '前廚房'], ['jumpseat', 'L', 1.4, 0.5, 0.5, 'L1 組員座'],
          ['lav', 'R', 1.6, 1.0, 1.0, '洗手間'],
        ],
      },
      { type: 'fixtures', len: 2.4, items: [['crewrest', 'L', 0.1, 2.2, 1.9, '組員休息室'], ['closet', 'R', 0.6, 1.0, 0.7, '衣帽櫃']] },
      { type: 'seats', cls: 'J', from: 1, to: 7, pattern: 'A-DG-K', pitch: 1.55, seatW: 0.85 },
      {
        type: 'fixtures', len: 2.4, items: [
          ['door', 'L', 0.3, 1.0, 0.25, 'L2'], ['door', 'R', 0.3, 1.0, 0.25, 'R2'],
          ['lav', 'C', 0.2, 1.0, 1.2, '洗手間'], ['jumpseat', 'R', 1.4, 0.5, 0.5, 'R2 組員座'],
        ],
      },
      { type: 'seats', cls: 'W', from: 20, to: 24, pattern: 'AC-DFG-HK', pitch: 0.97, seatW: 0.55 },
      { type: 'seats', cls: 'Y', from: 30, to: 44, pattern: 'ABC-DEG-HJK', pitch: 0.81, seatW: 0.46 },
      {
        type: 'fixtures', len: 2.6, items: [
          ['door', 'L', 0.3, 1.0, 0.25, 'L3'], ['door', 'R', 0.3, 1.0, 0.25, 'R3'],
          ['galley', 'C', 0.2, 1.4, 1.6, '中廚房'], ['jumpseat', 'L', 1.5, 0.5, 0.5, 'L3 組員座'],
        ],
      },
      { type: 'seats', cls: 'Y', from: 45, to: 58, pattern: 'ABC-DEG-HJK', pitch: 0.81, seatW: 0.46 },
      {
        type: 'fixtures', len: 3.0, items: [
          ['lav', 'L', 0.1, 1.0, 1.0, '洗手間'], ['lav', 'R', 0.1, 1.0, 1.0, '洗手間'],
          ['door', 'L', 1.3, 1.0, 0.25, 'L4'], ['door', 'R', 1.3, 1.0, 0.25, 'R4'],
          ['galley', 'F', 2.3, 0.7, 4.6, '後廚房'], ['jumpseat', 'R', 1.4, 0.5, 0.5, 'R4 組員座'],
        ],
      },
    ],
  },
  {
    id: 'atr72',
    name: 'ATR 72 螺旋槳（2-2）',
    width: 2.57,
    segments: [
      { type: 'fixtures', len: 2.0, items: [['cockpit', 'F', 0, 1.8, 2.57, '駕駛艙']] },
      {
        type: 'fixtures', len: 1.6, items: [
          ['galley', 'L', 0.1, 1.2, 0.7, '前廚房'], ['closet', 'R', 0.1, 1.0, 0.6, '行李櫃'],
        ],
      },
      { type: 'seats', cls: 'Y', from: 1, to: 18, pattern: 'AC-DF', pitch: 0.76, seatW: 0.45 },
      {
        type: 'fixtures', len: 2.4, items: [
          ['lav', 'R', 0.1, 1.0, 0.8, '洗手間'], ['door', 'L', 0.4, 0.9, 0.25, 'L1 登機門'],
          ['jumpseat', 'L', 1.5, 0.5, 0.5, '組員座'], ['door', 'R', 1.4, 0.8, 0.25, 'R1 服務門'],
        ],
      },
    ],
  },
];

// ---- 廣播詞 ----
export const ANNOUNCEMENTS = {
  welcome: {
    title: '迎賓廣播',
    script: '各位貴賓您好，歡迎搭乘本班機，本班機由台北飛往東京成田，預計飛行時間約三小時。請將隨身行李放置於上方置物櫃或前方座椅下方，並請您回到座位繫好安全帶，謝謝。',
    keywords: ['歡迎搭乘', '飛往', '飛行時間', '行李', '安全帶'],
  },
  safety: {
    title: '安全示範廣播',
    script: '各位貴賓，現在為您介紹本機的安全設備。請將安全帶扣上並拉緊；本機緊急出口位於客艙前方及後方；當客艙失壓時氧氣面罩會自動落下，請先戴好自己的再協助他人；救生衣位於您的座椅下方。謝謝。',
    keywords: ['安全帶', '緊急出口', '氧氣面罩', '先戴好自己', '救生衣'],
  },
  turbulence: {
    title: '亂流廣播',
    script: '各位貴賓，我們目前正通過不穩定氣流，請您儘速回到座位並繫好安全帶，洗手間暫停使用，謝謝您的合作。',
    keywords: ['不穩定氣流', '回到座位', '安全帶', '洗手間'],
  },
  doctor: {
    title: '徵求醫護人員廣播',
    script: '各位貴賓，機上有一位旅客身體不適，如果您是醫師或護理人員，請按服務鈴或告知空服員，謝謝。',
    keywords: ['身體不適', '醫師', '護理人員', '服務鈴'],
  },
  descent: {
    title: '下降廣播',
    script: '各位貴賓，本班機即將開始下降，請您回到座位繫好安全帶，豎直椅背、收起餐桌、打開遮光板，電子用品請切換至飛航模式，謝謝。',
    keywords: ['下降', '安全帶', '豎直椅背', '收起餐桌', '遮光板', '飛航模式'],
  },
  arrival: {
    title: '落地廣播',
    script: '各位貴賓，歡迎來到東京成田機場。飛機仍在滑行，請您留在座位上並繫好安全帶，直到安全帶指示燈熄滅。打開置物櫃時請小心物品滑落，感謝您的搭乘。',
    keywords: ['歡迎來到', '留在座位', '安全帶指示燈', '置物櫃', '感謝'],
  },
};

// ---- 預設組員（座艙長可分派） ----
export const DEFAULT_CREW = [
  { id: 'c1', name: '林雅婷', skill: 0.9, color: '#d97a8c' },
  { id: 'c2', name: '陳志明', skill: 0.7, color: '#6f9bd1' },
  { id: 'c3', name: '王小安（新人）', skill: 0.5, color: '#8fc79a' },
];

const opt = (text, score, reply, mood = 0) => ({ text, score, reply, mood });

// 預設劇本中的任務。kind: talk 對話 / goto 前往定點 / walk 客艙巡查 / announce 廣播 / seated 就座 / manage 組員管理
export function defaultTasks() {
  return [
    // 登機
    { id: 'T01', title: 'L1 門口迎賓', kind: 'goto', phase: 'boarding', at: 0, priority: 3, limit: 50, target: { fixture: 'L1' }, xp: 10, minRank: 0, desc: '到 L1 艙門向登機旅客問候、協助確認登機證。' },
    { id: 'T02', title: '迎賓廣播', kind: 'announce', phase: 'boarding', at: 15, priority: 3, limit: 80, announce: 'welcome', xp: 20, minRank: 0, judge: 'senior' },
    {
      id: 'T03', title: '行李放不進置物櫃', kind: 'talk', phase: 'boarding', at: 20, priority: 2, limit: 45, target: { seat: '7C' }, xp: 15, minRank: 0,
      prompt: '小姐，我的登機箱塞不進上面的櫃子，可以放走道嗎？',
      options: [
        opt('好的，先放走道沒關係，等一下再處理。', 0, '旅客把行李箱擋在走道上……學姊皺起眉頭：走道不能堆放任何物品！', -5),
        opt('我幫您看看其他置物櫃的空間，若都滿了會協助您放到前方衣帽櫃或托運。', 100, '旅客鬆了一口氣：謝謝你，太好了。', 10),
        opt('那您自己想辦法塞進去吧。', 10, '旅客臉色不太好看。', -15),
      ],
    },
    {
      id: 'T04', title: '協助年長旅客入座', kind: 'talk', phase: 'boarding', at: 40, priority: 2, limit: 50, target: { seat: '22A' }, xp: 15, minRank: 0,
      prompt: '（年長旅客拿著登機證，看起來有點找不到座位）',
      options: [
        opt('主動上前：「您好，我帶您到座位，行李我幫您放上去。」', 100, '旅客笑著說：年輕人真貼心。', 12),
        opt('指著後面說：「22 排在後面喔。」', 40, '旅客慢慢地往後走，差點跌倒。', -5),
      ],
    },
    { id: 'T05', title: '確認組員就位與區域分配', kind: 'manage', phase: 'boarding', at: 5, priority: 2, limit: 60, xp: 25, minRank: 3, desc: '座艙長任務：把下方待辦任務指派給組員，或親自處理。完成一次指派即達成。' },
    // 推出
    { id: 'T06', title: '滑梯預位（Arm）與交互檢查', kind: 'goto', phase: 'pushback', at: 0, priority: 1, limit: 35, target: { fixture: 'L1' }, xp: 25, minRank: 0, desc: '艙門關閉後，將艙門滑梯設定為預位並與對側組員交互檢查。' },
    { id: 'T07', title: '安全示範廣播', kind: 'announce', phase: 'pushback', at: 10, priority: 1, limit: 60, announce: 'safety', xp: 35, minRank: 1, judge: 'purser' },
    // 滑行
    { id: 'T08', title: '起飛前客艙安全檢查', kind: 'walk', phase: 'taxi', at: 0, priority: 1, limit: 50, xp: 30, minRank: 0, desc: '從前走到後：確認安全帶、椅背豎直、桌板收起、遮光板打開、走道淨空。' },
    {
      id: 'T09', title: '滑行中旅客要去洗手間', kind: 'talk', phase: 'taxi', at: 15, priority: 2, limit: 30, target: { seat: '28C' }, xp: 15, minRank: 0,
      prompt: '我現在很急，可以去一下洗手間嗎？',
      options: [
        opt('好，快去快回。', 0, '旅客起身時飛機轉彎，差點跌倒！滑行中旅客必須就座。', -5),
        opt('很抱歉，飛機正在滑行，為了您的安全請先留在座位，起飛後安全帶燈熄滅就可以使用。', 100, '旅客點點頭：好，我再忍一下。', 5),
        opt('不行。', 30, '旅客不太高興。', -10),
      ],
    },
    { id: 'T10', title: '向機長報告客艙準備完成', kind: 'goto', phase: 'taxi', at: 20, priority: 1, limit: 30, target: { fixture: '駕駛艙' }, xp: 30, minRank: 3, desc: '確認所有組員回報後，通知駕駛艙客艙已準備好起飛。' },
    // 起飛
    { id: 'T11', title: '回到組員座椅就座', kind: 'seated', phase: 'takeoff', at: 0, priority: 1, limit: 20, target: { fixture: 'jumpseat' }, xp: 20, minRank: 0, desc: '起飛時必須坐在組員座椅並繫好安全帶與肩帶，進行「靜默檢查」(30 秒複習)。起飛中不可解開安全帶、站起或開啟行李櫃。' },
    // 巡航
    { id: 'T12', title: '推出餐車', kind: 'cart', phase: 'cruise', at: 0, priority: 3, limit: 60, target: { fixture: 'galley' }, xp: 15, minRank: 0, desc: '到廚房確認餐點與飲料數量、特殊餐名單，打開煞車後推出餐車。' },
    { id: 'T26', title: '餐飲服務', kind: 'service', phase: 'cruise', at: 5, priority: 3, limit: 175, xp: 45, minRank: 0, desc: '推著餐車沿走道詢問旅客餐點與飲料並送上；注意特殊餐名單、存量、飲酒過量旅客。遇亂流須停止服務並收回餐車，下降前餐車必須收回固定。' },
    {
      id: 'T13', title: '特殊餐確認', kind: 'talk', phase: 'cruise', at: 15, priority: 3, limit: 60, target: { seat: '9A' }, xp: 15, minRank: 0,
      prompt: '你好，我有預訂素食餐，剛剛發的好像是雞肉的？',
      options: [
        opt('真的很抱歉！我馬上確認特殊餐名單，替您換上預訂的素食餐。', 100, '旅客：謝謝你這麼快處理。', 10),
        opt('今天可能沒有上機，您挑配菜吃吧。', 20, '旅客很失望。', -15),
        opt('我幫您問問看……（沒有回來）', 0, '旅客等了很久。', -20),
      ],
    },
    {
      id: 'T14', title: '旅客身體不適', kind: 'talk', phase: 'cruise', at: 45, priority: 1, limit: 40, target: { seat: '18B' }, xp: 40, minRank: 0,
      prompt: '（旁邊的旅客按服務鈴）她突然臉色發白、冒冷汗！',
      options: [
        opt('先詢問意識與症狀、讓旅客平躺或放低椅背，立刻通知座艙長並準備氧氣瓶，必要時廣播徵求醫護人員。', 100, '座艙長：處理得很好，我來廣播徵求醫護人員。', 15),
        opt('給她一杯水，請她休息一下。', 35, '症狀沒有改善……要記得通報與評估！', -5),
        opt('等餐車服務完再過來看。', 0, '延誤處理醫療事件是非常嚴重的錯誤！', -25),
      ],
    },
    { id: 'T15', title: '亂流廣播', kind: 'announce', phase: 'cruise', at: 80, priority: 1, limit: 40, announce: 'turbulence', xp: 35, minRank: 2, judge: 'purser' },
    {
      id: 'T16', title: '要求再來一杯酒', kind: 'talk', phase: 'cruise', at: 95, priority: 2, limit: 50, target: { seat: '26D' }, xp: 20, minRank: 0,
      prompt: '欸！再給我一杯威士忌！快點！',
      options: [
        opt('先生，為了您的舒適，我先為您送上溫水和點心，稍後再看看您的狀況。', 100, '旅客嘟囔了幾句，但接受了。', 5),
        opt('好的，馬上來！', 0, '旅客越來越大聲，影響到周圍旅客。', -20),
        opt('你喝太多了，不准再喝！', 30, '旅客生氣地拍桌。', -15),
      ],
    },
    {
      id: 'T17', title: '小朋友哭鬧', kind: 'talk', phase: 'cruise', at: 120, priority: 4, limit: 70, target: { seat: '12E' }, xp: 10, minRank: 0,
      prompt: '（小朋友一直哭，家長很尷尬）',
      options: [
        opt('蹲下來跟小朋友打招呼，送上兒童禮品並詢問家長是否需要溫水或毛毯。', 100, '小朋友停止哭泣，家長連聲道謝。', 10),
        opt('提醒家長請小孩安靜一點。', 30, '家長更尷尬了。', -5),
      ],
    },
    {
      id: 'T18', title: '組員衝突調解', kind: 'talk', phase: 'cruise', at: 60, priority: 2, limit: 60, target: { fixture: 'galley' }, xp: 40, minRank: 3,
      prompt: '陳志明：「座艙長，她每次都比我早休息，這不公平！」林雅婷：「明明是你自己換班的！」',
      options: [
        opt('先把兩人帶離旅客視線，各自聽完說法，依排班表重新確認休息時間，落地後再做記錄。', 100, '兩人冷靜下來，服務恢復正常。', 0),
        opt('都別吵了，誰也不准休息！', 20, '組員士氣低落。', 0),
        opt('不處理，讓他們自己解決。', 0, '爭執被旅客聽見，客訴上門。', 0),
      ],
    },
    // 下降
    { id: 'T19', title: '下降廣播', kind: 'announce', phase: 'descent', at: 0, priority: 1, limit: 45, announce: 'descent', xp: 30, minRank: 1, judge: 'senior' },
    { id: 'T20', title: '落地前客艙安全檢查', kind: 'walk', phase: 'descent', at: 15, priority: 1, limit: 50, xp: 30, minRank: 0 },
    {
      id: 'T21', title: '旅客不願豎直椅背', kind: 'talk', phase: 'descent', at: 30, priority: 2, limit: 35, target: { seat: '15F' }, xp: 15, minRank: 0,
      prompt: '我在睡覺，椅背放著就好了吧？',
      options: [
        opt('不好意思打擾您，飛機準備降落了，為了您和後方旅客的安全，請豎直椅背，謝謝您的配合。', 100, '旅客揉揉眼睛照做了。', 5),
        opt('那好吧，您繼續睡。', 0, '緊急撤離時，傾倒的椅背會阻礙後方旅客逃生！', -5),
      ],
    },
    // 落地
    { id: 'T22', title: '回到組員座椅就座', kind: 'seated', phase: 'landing', at: 0, priority: 1, limit: 20, target: { fixture: 'jumpseat' }, xp: 20, minRank: 0, desc: '落地前坐好並繫上安全帶，停妥前不可解開。' },
    // 下機
    { id: 'T23', title: '落地廣播', kind: 'announce', phase: 'deplane', at: 0, priority: 2, limit: 40, announce: 'arrival', xp: 25, minRank: 0, judge: 'senior' },
    { id: 'T24', title: '解除滑梯預位（Disarm）', kind: 'goto', phase: 'deplane', at: 5, priority: 1, limit: 35, target: { fixture: 'L1' }, xp: 25, minRank: 0 },
    { id: 'T25', title: '門口送客', kind: 'goto', phase: 'deplane', at: 30, priority: 3, limit: 30, target: { fixture: 'L1' }, xp: 10, minRank: 0 },
  ];
}

export function defaultPassengers() {
  const p = (seat, type, name, note = '') => ({ seat, type, name, mood: 70, note });
  return [
    p('1A', 'vip', '黃先生', '白金卡會員'), p('2D', 'vip', '鈴木小姐'),
    p('5B', 'normal', '旅客'), p('7C', 'normal', '張先生', '大型登機箱'), p('8D', 'normal', '旅客'),
    p('9A', 'meal', '李小姐', '預訂素食餐'), p('10E', 'normal', '旅客'), p('11F', 'normal', '旅客'),
    p('12E', 'child', '陳小弟', '5 歲，與媽媽同行'), p('12F', 'normal', '陳太太'),
    p('14B', 'normal', '旅客'), p('15F', 'normal', '吳先生', '喜歡睡覺'), p('16C', 'normal', '旅客'),
    p('17D', 'anxious', '林小姐', '第一次搭飛機'), p('18B', 'medical', '周小姐', '有低血糖病史'),
    p('19E', 'normal', '旅客'), p('20A', 'normal', '旅客'), p('21D', 'normal', '旅客'),
    p('22A', 'elder', '王奶奶', '82 歲，行動較慢'), p('23C', 'normal', '旅客'), p('24F', 'normal', '旅客'),
    p('25A', 'normal', '旅客'), p('26D', 'drunk', '劉先生', '登機前已飲酒'), p('27B', 'normal', '旅客'),
    p('28C', 'normal', '趙先生'), p('29E', 'mobility', '何先生', '需輪椅協助'), p('30A', 'normal', '旅客'),
    p('31D', 'normal', '旅客'),
  ];
}

export function defaultScenario(aircraftId = 'a321') {
  return {
    id: 'sc_' + Math.random().toString(36).slice(2, 8),
    title: '台北 → 東京成田 晨間航班',
    flightNo: 'SA 102',
    route: 'TPE → NRT',
    aircraftId,
    intro: '今天是你在星嵐航空的飛行任務。座艙長已經完成簡報，學姊會在一旁觀察你的表現。旅客陸續登機，請依照標準作業程序完成每個階段的任務，並妥善處理旅客需求。記住：安全第一、服務第二，判斷優先順序是空服員最重要的能力。',
    npc: { senior: '學姊 美玲', purser: '座艙長 Grace', inspector: '客艙督導 陳經理' },
    timeScale: 1,
    passengers: defaultPassengers(),
    tasks: defaultTasks(),
  };
}

// 駕駛艙組員（駕駛艙門互動時回應）
export const PILOTS = { captain: '機長 王志遠', fo: '副駕駛 林佳穎' };

// ---- 餐飲服務 ----
export const MEALS = [
  { id: 'beef', name: '紅燒牛肉麵' },
  { id: 'chicken', name: '照燒雞肉飯' },
  { id: 'veg', name: '素食餐（特殊餐）', special: true },
  { id: 'kids', name: '兒童餐（特殊餐）', special: true },
];
export const DRINKS = [
  { id: 'water', name: '礦泉水' }, { id: 'oj', name: '柳橙汁' }, { id: 'apple', name: '蘋果汁' }, { id: 'coke', name: '可樂' },
  { id: 'coffee', name: '熱咖啡', hot: true }, { id: 'tea', name: '熱茶', hot: true }, { id: 'beer', name: '啤酒', alcohol: true }, { id: 'wine', name: '紅酒', alcohol: true },
];
export const SCENARIO_VERSION = 2;
