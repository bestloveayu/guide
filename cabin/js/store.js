// 狀態與儲存：機型庫、劇本、玩家檔案、設定
import { buildTemplate } from './layout.js';
import { defaultScenario, AIRLINES } from './data.js';

const KEY = 'cabinSim.v1';

export function defaultProfile() {
  const a = AIRLINES[0];
  return {
    name: '新進空服員',
    airline: a.name,
    xp: 0,
    flights: 0,
    history: [],
    uniform: { jacket: a.jacket, bottom: a.jacket, shirt: '#f4f4f2', scarf: a.accent, hat: true, bottomType: 'skirt', hair: '#2b1b12', skin: '#f1c9a5' },
  };
}

export function defaultState() {
  const aircraft = ['a321', 'b789', 'atr72'].map(buildTemplate);
  const sc = defaultScenario(aircraft[0].id);
  return {
    aircraft,
    scenarios: [sc],
    currentAircraft: aircraft[0].id,
    currentScenario: sc.id,
    profile: defaultProfile(),
    settings: { aiEndpoint: '', tts: true, speechLang: 'zh-TW', quality: 'high' },
  };
}

export function load() {
  try {
    const raw = localStorage.getItem(KEY);
    if (raw) {
      const s = JSON.parse(raw);
      if (s && s.aircraft && s.aircraft.length && s.scenarios && s.scenarios.length) {
        const d = defaultState();
        s.profile = { ...d.profile, ...s.profile, uniform: { ...d.profile.uniform, ...(s.profile || {}).uniform } };
        s.settings = { ...d.settings, ...s.settings };
        return s;
      }
    }
  } catch (e) { console.warn('讀取存檔失敗', e); }
  return defaultState();
}

let saveTimer = null;
export function save(state) {
  clearTimeout(saveTimer);
  saveTimer = setTimeout(() => {
    try { localStorage.setItem(KEY, JSON.stringify(state)); } catch (e) {
      // 平面圖底圖可能太大；去掉底圖後再存
      try {
        const lite = { ...state, aircraft: state.aircraft.map((a) => ({ ...a, underlay: null })) };
        localStorage.setItem(KEY, JSON.stringify(lite));
      } catch (e2) { console.warn('存檔失敗', e2); }
    }
  }, 300);
}

export function resetAll() { try { localStorage.removeItem(KEY); } catch (e) { /* ignore */ } }

export function download(filename, obj) {
  const blob = new Blob([JSON.stringify(obj, null, 2)], { type: 'application/json' });
  const a = document.createElement('a');
  a.href = URL.createObjectURL(blob);
  a.download = filename;
  a.click();
  setTimeout(() => URL.revokeObjectURL(a.href), 2000);
}

export function readFile(file, asDataURL = false) {
  return new Promise((res, rej) => {
    const r = new FileReader();
    r.onload = () => res(r.result);
    r.onerror = rej;
    asDataURL ? r.readAsDataURL(file) : r.readAsText(file);
  });
}
