// 通勤设置结构。version 2 相对 1 的改动（B08）：
//   - 新增 preferences.rain / preferences.snow：雨雪备用方式与额外准备，mode 为 null 表示「不改交通方式」
//   - 新增 taxiWait：打车等车分钟数，由用户自己填，默认 0（不再由代码按天气猜）
// v1 的本地记录必须能原样读出来，缺的字段用默认值补齐。
export const COMMUTE_VERSION = 2;

export const TRANSPORTS = ['自驾', '打车', '公交', '地铁', '骑行', '步行'];
// 交通方式到路线接口 modes key 的映射。自驾与打车共用驾车路线，但是两种不同的方式。
export const TRANSPORT_MODE = { 自驾: 'drive', 打车: 'taxi', 公交: 'bus', 地铁: 'subway', 骑行: 'bike', 步行: 'walk' };

export const DEFAULT_COMMUTE = Object.freeze({
  version: COMMUTE_VERSION,
  fixedEnabled: false, smartEnabled: false, fixedMinutes: 20,
  transport: '自驾', arrivalRule: '指定日期时间', preparation: 40,
  buffer: 15, extra: 15, maxAdvance: 30, threshold: 30,
  taxiWait: 0,
  recheckTime: '05:30', fallback: '保留基础闹钟',
  sound: { ambientEnabled: false, ambientOffset: 5, ambientDuration: 2, ambientVolume: 35 },
  preferences: {
    rain: { mode: null, extra: 15 },
    snow: { mode: null, extra: 20 },
  },
});
const minuteKeys = ['fixedMinutes', 'preparation', 'buffer', 'extra', 'maxAdvance', 'taxiWait'];
const soundKeys = ['ambientOffset', 'ambientDuration', 'ambientVolume'];
const preferenceKeys = ['rain', 'snow'];

// v1 → v2：v1 只有单层 extra，拆成雨/雪两档时沿用旧值，避免用户设置凭空变化。
// 唯一定义：设置页的「雨雪额外准备 / 分钟」(commute.extra) === preferences.rain.extra。
// 之所以保留顶层 extra，是为了让老的调用点（plan.js 的 weatherFallback 兜底、smartWake）
// 在没读 preferences 时也拿到同一个数；写入统一走 withExtra()。
function mergePreferences(saved, legacyExtra) {
  const out = {};
  for (const key of preferenceKeys) {
    const fallback = DEFAULT_COMMUTE.preferences[key];
    const row = saved?.[key] || {};
    out[key] = {
      mode: row.mode ?? fallback.mode,
      extra: Number.isFinite(row.extra) ? row.extra : (Number.isFinite(legacyExtra) ? legacyExtra : fallback.extra),
    };
  }
  return out;
}

// 改「雨雪额外准备」时同时写 preferences.rain.extra 与顶层 extra，防止两处显示不同数字。
export function withExtra(settings, value) {
  return {
    ...settings,
    extra: value,
    preferences: { ...settings.preferences, rain: { ...settings.preferences?.rain, extra: value } },
  };
}

// 改某一档雨/雪的备用方式或额外准备。
export function withPreference(settings, key, field, value) {
  const next = { ...settings, preferences: { ...settings.preferences, [key]: { ...settings.preferences?.[key], [field]: value } } };
  return key === 'rain' && field === 'extra' ? { ...next, extra: value } : next;
}

export function restoreCommute(saved = {}) {
  const legacy = saved.commute || {};
  const sound = { ...DEFAULT_COMMUTE.sound, ...(legacy.sound || {}) };
  const extra = legacy.extra ?? saved.extra ?? DEFAULT_COMMUTE.extra;
  return {
    ...DEFAULT_COMMUTE, ...legacy, sound,
    version: COMMUTE_VERSION,
    preferences: mergePreferences(legacy.preferences, extra),
    taxiWait: legacy.taxiWait ?? DEFAULT_COMMUTE.taxiWait,
    preparation: legacy.preparation ?? saved.preparation ?? DEFAULT_COMMUTE.preparation,
    buffer: legacy.buffer ?? saved.buffer ?? DEFAULT_COMMUTE.buffer,
    extra,
    maxAdvance: legacy.maxAdvance ?? saved.maxAdvance ?? DEFAULT_COMMUTE.maxAdvance,
    threshold: legacy.threshold ?? saved.prefs?.threshold ?? DEFAULT_COMMUTE.threshold,
  };
}

// 第一层：与「基础闹钟」无关的结构合法性。
// 单独拆出来是因为落盘判断需要区分两件事 ——
//   「参数本身写错了」→ 绝不能存进 localStorage；
//   「参数没问题、只是暂时还没有有效的基础闹钟」→ 必须存，否则用户刚设的值会被丢掉。
export function validateCommuteShape(settings) {
  if (!settings.fixedEnabled && !settings.smartEnabled) return '请至少开启固定或智能模式';
  for (const key of minuteKeys) if (!Number.isInteger(settings[key]) || settings[key] < 0 || settings[key] > 240) return '时间参数需为 0 到 240 的整数分钟';
  if (!Number.isInteger(settings.threshold) || settings.threshold < 1 || settings.threshold > 100) return '降水概率阈值需为 1% 到 100%';
  if (!TRANSPORTS.includes(settings.transport)) return '请选择交通方式';
  if (!/^([01]\d|2[0-3]):[0-5]\d$/.test(settings.recheckTime)) return '请选择有效的复查时间';
  for (const key of soundKeys) if (!Number.isInteger(settings.sound[key]) || settings.sound[key] < 0 || settings.sound[key] > (key === 'ambientVolume' ? 100 : 60)) return '环境音参数超出范围';
  if (settings.sound.ambientEnabled && settings.sound.ambientOffset === 0) return '环境音应在主铃之前播放';
  for (const key of preferenceKeys) {
    const row = settings.preferences?.[key] || {};
    if (row.mode != null && !TRANSPORTS.includes(row.mode)) return '雨雪备用方式需为有效交通方式';
    if (row.mode != null && row.mode === settings.transport) return '雨雪备用方式不应与当前交通方式相同';
    if (!Number.isInteger(row.extra) || row.extra < 0 || row.extra > 240) return '雨雪额外准备需为 0 到 240 的整数分钟';
  }
  return null;
}

// 第二层：结构 + 与基础闹钟的时序冲突。设置页「确认并保存」必须用这一层。
export function validateCommute(settings, baseAt) {
  const shape = validateCommuteShape(settings);
  if (shape) return shape;
  if (!Number.isFinite(baseAt) || baseAt <= Date.now()) return '请先设置未来的基础闹钟';
  const base = new Date(baseAt);
  const [hour, minute] = settings.recheckTime.split(':').map(Number);
  const recheck = new Date(base); recheck.setHours(hour, minute, 0, 0);
  const earliest = baseAt - Math.max(settings.fixedEnabled ? settings.fixedMinutes : 0, settings.smartEnabled ? settings.maxAdvance : 0) * 60000 - (settings.sound.ambientEnabled ? settings.sound.ambientOffset * 60000 : 0);
  if (settings.smartEnabled && recheck.getTime() >= earliest && settings.fallback !== '仅按固定模式') return '复查晚于最早可能发声时间；请提前复查，或选择“仅按固定模式”作为有效备用方式';
  if (settings.smartEnabled && settings.fallback === '仅按固定模式' && !settings.fixedEnabled) return '固定模式未开启，不能作为备用方式';
  return null;
}

// 打车等车时间只对打车生效，自驾一律为 0（B03 的核心修正）。
export function effectiveTaxiWait(settings, transport = settings?.transport) {
  if (transport !== '打车') return 0;
  const n = Number(settings?.taxiWait);
  return Number.isInteger(n) && n >= 0 && n <= 240 ? n : 0;
}
