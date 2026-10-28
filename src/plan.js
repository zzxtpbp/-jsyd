// 通勤唤醒候选计算（纯函数，无 DOM / 无网络依赖）
// 对应计划：B05 固定候选、B06 智能候选、B07 合并、B08 备用方式、B09 耗时来源、B10 结构化解释，
// 以及 A04 / A06 / A08 的界面消费字段。
//
// 三条不许违反的规则：
//   1. 天气触发只看概率门槛，见 docs/weather-rules.md
//   2. 超过智能上限只提前到上限，差额写进 gapMinutes，绝不静默突破
//   3. 结果缺失一律为 null，不用 0 或「已完成」顶替
import { windowVerdict, isSnow, isSevere } from './schedule.js';

// S02 约定的两套枚举。代码中只允许使用这里定义的值，不再用自由文本代替。
export const PLAN_STATUS = Object.freeze({
  READY: 'ready',
  WEATHER_UNKNOWN: 'weather_unknown',
  ROUTE_FAILED: 'route_failed',
  CAPPED: 'capped',
  NEEDS_CONFIRMATION: 'needs_confirmation',
  UNAVAILABLE: 'unavailable',
});

export const EXECUTION_STATE = Object.freeze({
  SUGGESTED: 'suggested',
  SAVED: 'saved',
  SYNCED: 'synced',
  FAILED: 'failed',
});

// 给界面用的中文说明。缺失字段一律显示「未知」，不显示 0，也不显示「已完成」。
const STATUS_TEXT = {
  ready: '按天气与路况正常计算',
  weather_unknown: '天气数据缺失，未做提前判断',
  route_failed: '路线获取失败，智能候选不可用',
  capped: '需要的提前量超过智能上限',
  needs_confirmation: '超过提前上限，需本次确认',
  unavailable: '数据不足，暂无法计算',
};

const CANDIDATE_KIND = { FIXED: 'fixed', SMART: 'smart' };

export function statusText(status) {
  return STATUS_TEXT[status] || STATUS_TEXT.unavailable;
}

const isMinute = (n) => Number.isInteger(n) && n >= 0 && n <= 240;
const num = (n) => (Number.isFinite(n) ? n : null);

// 固定候选（B05）：基础闹钟时间减去固定提前量。
// 不需要路线，不需要天气，也不看阈值——这是用户手动指定的提前量，天气不影响它。
// 边界：固定提前量为 0 时不生成候选（否则就是「和基础闹钟一样早的提前闹钟」，没有意义）。
export function fixedCandidate({ baseAlarmAt, fixedMinutes, enabled, now = null }) {
  if (!enabled) return null;
  if (!Number.isFinite(baseAlarmAt)) return null;
  if (!isMinute(fixedMinutes) || fixedMinutes === 0) return null;
  const at = baseAlarmAt - fixedMinutes * 60000;
  if (Number.isFinite(now) && at <= now) {
    return { kind: CANDIDATE_KIND.FIXED, at, advance: fixedMinutes, gapMinutes: 0, expired: true };
  }
  return { kind: CANDIDATE_KIND.FIXED, at, advance: fixedMinutes, gapMinutes: 0, expired: false };
}

// 雨雪备用方式（B08）：只有用户显式配置过 mode 才切换，否则只加 extra，不擅自改交通方式。
// preferences 为 null 时退回旧口径：直接使用调用方传入的 extra（兼容没迁移到 v2 的调用）。
export function weatherFallback({ snow, preferences, extra = 0 }) {
  const key = snow ? 'snow' : 'rain';
  if (!preferences) {
    return { kind: key, switched: false, mode: null, extra: Number.isFinite(extra) ? extra : 0, authorized: false, configured: false };
  }
  const row = preferences?.[key] || {};
  const mode = typeof row.mode === 'string' && row.mode ? row.mode : null;
  // 没配过这一档的 extra 时沿用单层 extra（v1 用户 / 只在通勤页改过「雨雪额外准备」的人），
  // 不能悄悄归零 —— 那等于把用户填过的准备时间删了。
  const value = Number.isFinite(row.extra) ? row.extra : (Number.isFinite(extra) ? extra : 0);
  return {
    kind: key,
    switched: mode != null,
    mode,
    extra: value,
    authorized: mode != null,
    configured: Number.isFinite(row.extra),
  };
}

// 智能候选（B06）：从「到达时间」往回推需要的总提前量。
// 需要的提前量超过智能上限时只提前到上限，并把差额写成 gapMinutes。
// wet 由阈值得出：传到的是 probability，本函数自己比对 threshold，避免调用方各算一套。
export function smartCandidate({
  baseAlarmAt, arrivalAt, durationMinutes, buffer, preparation, extra, maxAdvance,
  // B03/B02：打车等车时间必须进这个函数，否则它只出现在通勤方案页、进不了首页的提前唤醒。
  taxiWait = 0,
  wet, probability, threshold = 30, enabled, now = null,
}) {
  if (!enabled) return null;
  if (![arrivalAt, durationMinutes, buffer, preparation, extra, maxAdvance].every(Number.isFinite)) return null;
  const wait = Number.isFinite(taxiWait) && taxiWait > 0 ? taxiWait : 0;

  const verdict = typeof wet === 'boolean' ? wet : (Number.isFinite(probability) ? probability >= threshold : null);
  const rainExtra = verdict === true ? extra : 0;
  // 行程总耗时 = 路上时间 + 到达余量 + 起床准备 + 雨雪额外准备 + 打车等车
  const commuteMinutes = durationMinutes + buffer + preparation + rainExtra + wait;

  // 需要提前多少分钟 = 基础闹钟 − (到达时间 − 行程总耗时)。
  // 注意：Math.max 必须作用在「分钟差」上，不能写成 Math.max(0, 毫秒差)/60000 ——
  // 那会先把负的毫秒截成 0，再除以 60000，结果恒为 0（原实现的真实 bug）。
  const requiredAdvance = Number.isFinite(baseAlarmAt)
    ? Math.max(0, (baseAlarmAt - (arrivalAt - commuteMinutes * 60000)) / 60000)
    : null;

  // 智能算出来的时间晚于基础闹钟，说明「不需要提前」——
  // 绝不能因此生成一个比基础闹钟还晚的「提前闹钟」。
  if (requiredAdvance === 0 || requiredAdvance === null) {
    return { kind: CANDIDATE_KIND.SMART, at: null, advance: 0, gapMinutes: 0, requiredMinutes: Math.round(commuteMinutes), skipped: true, wet: verdict };
  }

  const advance = Math.min(requiredAdvance, maxAdvance);
  const gapMinutes = Math.max(0, Math.round(requiredAdvance - advance));
  const at = baseAlarmAt - advance * 60000;
  if (Number.isFinite(now) && at <= now) {
    return {
      kind: CANDIDATE_KIND.SMART, at, advance, gapMinutes, requiredMinutes: Math.round(commuteMinutes),
      expired: true, wet: verdict, requiredAdvance: Math.round(requiredAdvance),
    };
  }
  return {
    kind: CANDIDATE_KIND.SMART, at, advance, gapMinutes,
    requiredMinutes: Math.round(commuteMinutes),
    requiredAdvance: Math.round(requiredAdvance),
    expired: false,
    wet: verdict,
  };
}

// 合并（B07）：只保留开启、有效、未过期的候选，取较早的一个。
export function mergeCandidates({ fixed, smart, baseAlarmAt }) {
  const list = [fixed, smart].filter(c => c && Number.isFinite(c.at) && !c.expired && !c.skipped);
  if (!list.length) {
    return { plan: null, status: PLAN_STATUS.UNAVAILABLE, candidates: { fixed, smart }, gapMinutes: 0 };
  }
  const winner = list.slice().sort((a, b) => a.at - b.at)[0];
  // 候选不早于基础闹钟没有意义：那等于把用户叫醒得更晚，不如保留基础闹钟。
  if (Number.isFinite(baseAlarmAt) && winner.at >= baseAlarmAt) {
    return { plan: null, status: PLAN_STATUS.UNAVAILABLE, candidates: { fixed, smart }, gapMinutes: 0 };
  }
  // 缺口只表示「按最理想的口径算，仍达不到目标」。
  // 关键前提：赢家必须正是「最理想口径」的那个候选。
  //
  // 误报场景（验收 B02 第③条）：固定提前 20 已给出 06:40，智能被上限压到 06:50，
  // 旧实现取 Math.max(赢家缺口, 智能缺口) = 10，于是首页弹「还差 10 分钟，不能保证准时」——
  // 但实际方案 06:40 完全没问题。固定候选早一步就把问题解决了，缺口不该再冒出来。
  //
  // 反过来，如果赢家就是智能候选（固定没开或不够早），那它的缺口就是真缺口，必须如实说。
  const gapMinutes = winner === smart ? (smart.gapMinutes || 0) : 0;
  return { plan: winner, status: gapMinutes > 0 ? PLAN_STATUS.CAPPED : PLAN_STATUS.READY, candidates: { fixed, smart }, gapMinutes };
}

// 依据可用数据推导状态。优先级：不可用 > 数据缺失 > 超限 > 待确认 > 正常。
// requiredWeather / requiredRoute 由调用方按模式决定：只开固定模式时两者都不是必需项，
// 不能因为天气或路线缺失就把一个本来就正确的固定候选降级。
export function deriveStatus({ plan, weatherUnknown, requiredWeather, weatherKnown, requiredRoute, routeKnown, gapMinutes, approval }) {
  if (!plan) return PLAN_STATUS.UNAVAILABLE;
  // 天气未知时，只要智能模式参与判断，就不能给出「已就绪」的结论 ——
  // 哪怕最后胜出的是固定候选：用户开智能是为了按天气算，此时固定候选只是「没算成」的残值，
  // 把它标成 ready 会让人误以为天气已经确认过了。
  if (weatherUnknown && requiredWeather) return PLAN_STATUS.WEATHER_UNKNOWN;
  if (requiredWeather && !weatherKnown) return PLAN_STATUS.WEATHER_UNKNOWN;
  if (requiredRoute && !routeKnown && plan.kind === CANDIDATE_KIND.SMART) return PLAN_STATUS.ROUTE_FAILED;
  if (gapMinutes > 0) return PLAN_STATUS.CAPPED;
  if (approval) return PLAN_STATUS.NEEDS_CONFIRMATION;
  return PLAN_STATUS.READY;
}

const clock = (ms) => {
  const d = new Date(ms);
  return `${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`;
};

// B10：结构化解释。text 由模板生成，不依赖千问；千问的建议单独放 advice。
function buildReason({
  status, plan, weather, route, advance, threshold, gapMinutes, fallback, snow, severe,
}) {
  const parts = [];
  if (status === PLAN_STATUS.WEATHER_UNKNOWN) {
    parts.push('出发时段的降水概率没有数据，本次没有按天气提前，也不能据此判断「不会下雨」。');
  } else if (status === PLAN_STATUS.ROUTE_FAILED) {
    parts.push('高德路线没有取到，智能候选无法计算，已保留基础闹钟。');
  } else if (weather && Number.isFinite(weather.probability)) {
    // 只有「窗口内所有小时都有概率」时，才敢用最高概率说「达到/未达到门槛」。
    if (weather.unknown) {
      parts.push(`出发时段有小时的降水概率缺失，已知部分最高 ${weather.probability}%，不足以判定是否达到 ${threshold}% 门槛。`);
    } else {
      const relation = weather.probability >= threshold ? '达到' : '未达到';
      parts.push(`出发时段降水概率 ${weather.probability}%，${relation}你设的 ${threshold}% 门槛。`);
    }
  }
  if (snow) parts.push('时段内有降雪。');
  if (severe) parts.push('时段内有强降水或雷暴，是否需要临时降低门槛由你决定。');
  if (fallback) {
    const label = fallback.kind === 'snow' ? '雪天' : '雨天';
    if (fallback.switched) parts.push(`已按你设置的${label}方案改乘${fallback.mode}。`);
    else if (fallback.extra > 0) parts.push(`未配置${label}备用交通方式，保持原交通方式，只增加 ${fallback.extra} 分钟准备。`);
    else parts.push(`未配置${label}备用方案，本次不额外增加准备时间。`);
  }
  if (route && Number.isFinite(route.durationMinutes)) {
    parts.push(`行程约 ${route.durationMinutes} 分钟（${route.durationSource === 'amap' ? '高德估算' : '你填写'}）。`);
  }
  if (Number.isFinite(advance) && advance > 0) parts.push(`比基础闹钟提前 ${advance} 分钟。`);
  if (gapMinutes > 0) parts.push(`需要的提前量超过上限，仍缺 ${gapMinutes} 分钟，不能保证准时。`);
  if (!parts.length) parts.push(statusText(status));
  return {
    weather: weather ? { probability: num(weather.probability), threshold, code: num(weather.code), snow, severe, unknown: !!weather.unknown } : null,
    route: route ? { durationMinutes: num(route.durationMinutes), source: route.durationSource || null, alternateUsed: !!fallback?.switched } : null,
    advance: { required: plan ? num(plan.requiredAdvance) ?? (plan.advance || 0) : null, allowed: num(advance), gap: gapMinutes },
    text: parts.join(''),
  };
}

// 统一出口：给界面和后续 B/C 对接用的完整 plan 结果对象。
export function buildPlan({
  baseAlarmAt = null,
  arrivalAt = null,
  departureAt = null,
  durationMinutes = null,
  buffer = null,
  preparation = null,
  extra = null,
  maxAdvance = null,
  // B03：打车等车时间。只对「打车」生效，由调用方用 effectiveTaxiWait() 算好后传入。
  taxiWait = 0,
  fixedMinutes = null,
  fixedEnabled = false,
  smartEnabled = false,
  weatherKnown = false,
  routeKnown = false,
  wet = undefined,
  probability = null,
  threshold = 30,
  // B08：雨雪备用方式。传了 preferences 就按它算，否则退回单层 extra。
  preferences = null,
  snow = false,
  severe = false,
  weather = null,
  // B09：各项耗时的来源，'amap' = 接口估算，'user' = 用户填写。
  durationSource = 'amap',
  // B08/B09：备用方式自己的耗时（该交通方式单独查到的，不能复用驾车耗时）。
  // 没传 = 这条备用路线没查过，则切换后 routeKnown=false，绝不拿驾车耗时冒充。
  alternateDurationMinutes = null,
  alternateDurationSource = 'amap',
  source = '',
  now = Date.now(),
  validForMs = 15 * 60000,
  executionState = EXECUTION_STATE.SUGGESTED,
  advice = null,
  dataVersion = null,
}) {
  // B06：wet 不在外部算，直接由 probability 与 threshold 对比得出，保证阈值只有一个来源。
  // 但必须接受 null：调用方用 null 明确表示「概率缺失」，
  // 如果这里只看 typeof === 'boolean'，null 会掉进概率分支被重算成 false，
  // 于是「未知」被悄悄改成「确定不下雨」—— B01 的语义在这一层被击穿过一次。
  const verdict = wet === null || typeof wet === 'boolean'
    ? wet
    : (Number.isFinite(probability) ? probability >= threshold : null);

  // B08：只有确认有雨雪时才走备用方案；未知天气不切换交通方式。
  const fallback = verdict === true ? weatherFallback({ snow, preferences, extra }) : null;

  // B08/B09：备用方式不能只换名字。
  // 验收里的问题是：改成公交后仍写「公交路线耗时约 40 分钟（高德估算）」—— 那是驾车耗时。
  // 所以这里允许调用方传 alternateDurationMinutes（该备用方式自己查到的耗时）；
  // 没传就说明「这条路线没查」→ 结果是 routeKnown=false、routeNote 如实说明未使用接口估算，
  // 绝不拿驾车耗时冒充公交耗时。
  const useAlternate = !!(fallback?.switched);
  const alternateDuration = Number.isFinite(alternateDurationMinutes) ? alternateDurationMinutes : null;
  const effectiveDuration = useAlternate ? alternateDuration : durationMinutes;
  // 切换后如果没拿到备用方式的耗时，就不能再声称「耗时由高德估算」。
  const effectiveDurationSource = useAlternate
    ? (alternateDuration != null ? (alternateDurationSource || 'amap') : 'user')
    : durationSource;
  const effectiveRouteKnown = useAlternate ? alternateDuration != null : routeKnown;

  const fixed = fixedCandidate({ baseAlarmAt, fixedMinutes, enabled: fixedEnabled, now });

  const extraMinutes = fallback ? fallback.extra : (Number.isFinite(extra) ? extra : 0);
  const smart = smartEnabled
    ? smartCandidate({
        baseAlarmAt, arrivalAt, durationMinutes: effectiveDuration, buffer, preparation,
        extra: extraMinutes, maxAdvance, taxiWait, wet: verdict, threshold, enabled: true, now,
      })
    : null;

  const merged = mergeCandidates({ fixed, smart, baseAlarmAt });
  const flag = merged.status === PLAN_STATUS.CAPPED ? merged.gapMinutes : 0;

  const status = deriveStatus({
    plan: merged.plan,
    // 注意：只有「智能模式开着」才关心天气未知。只开固定模式时天气无关，不该降级。
    weatherUnknown: smartEnabled && verdict === null,
    requiredWeather: smartEnabled,
    weatherKnown,
    requiredRoute: smartEnabled,
    routeKnown: effectiveRouteKnown,
    gapMinutes: flag,
    approval: false,
  });

  const wakeAt = merged.plan ? merged.plan.at : null;
  // A06/B04：出发时间 = 唤醒 + 起床准备 + 雨雪额外准备 + 打车等车。
  // 以前只加了 preparation，于是「唤醒 06:40 + 准备 40 → 07:20」，
  // 而通勤方案页是 07:35（含雨天额外准备与到达余量），两个页面差 15 分钟。
  const extraPrepMinutes = fallback ? fallback.extra : 0;
  const waitMinutes = Number.isFinite(taxiWait) && taxiWait > 0 ? taxiWait : 0;
  const departAt = (() => {
    if (merged.plan && Number.isFinite(effectiveDuration)) {
      return merged.plan.at + (preparation + extraPrepMinutes + waitMinutes) * 60000;
    }
    // 没有提前唤醒时退回「到达时间 − 行程耗时」，口径与上面保持一致。
    if (Number.isFinite(arrivalAt) && Number.isFinite(effectiveDuration)) {
      const total = effectiveDuration + buffer + preparation + extraPrepMinutes + waitMinutes;
      return arrivalAt - total * 60000;
    }
    return departureAt ?? null;
  })();

  // 实际使用的交通方式：配置了备用方案就写备用方式，否则保持原方式（由调用方传入 route.mode）。
  const effectiveTransport = fallback?.switched ? fallback.mode : null;

  const reason = buildReason({
    status, plan: merged.plan,
    weather: weather || (Number.isFinite(probability) ? { probability, threshold, unknown: verdict === null } : null),
    route: Number.isFinite(effectiveDuration) ? { durationMinutes: effectiveDuration, durationSource: effectiveDurationSource } : null,
    advance: merged.plan ? merged.plan.advance : null,
    threshold, gapMinutes: flag, fallback, snow, severe,
  });

  return {
    status,
    statusText: statusText(status),
    executionState,
    mode: merged.plan ? merged.plan.kind : null,
    baseAlarmAt,
    wakeAt,
    departAt,
    gapMinutes: flag,
    // B10 之前 reason 是字符串，B10 改成了结构化对象，但界面里还有几处
    // `${plan.reason}` 按字符串用 —— 直接塞对象给 React 会抛 error #31（Objects are
    // not valid as a React child），整个组件树崩掉 → 白屏。
    // 这里把字符串形态保留在 reason 上，结构化数据另放 reasonDetail。
    reason: reason.text,
    reasonDetail: reason,
    // 兼容旧字段：以前 reason 是字符串，界面与千问都按字符串读过。
    reasonText: reason.text,
    validUntil: now + validForMs,
    updatedAt: now,
    source: source || null,
    threshold: Number.isFinite(threshold) ? threshold : 30,
    // B04：这条计划基于哪一版数据。任一项变化（新天气、新路线、改阈值）都应让旧结论失效。
    dataVersion: dataVersion || [num(effectiveDuration) ?? '-', threshold, weatherKnown ? 1 : 0, effectiveRouteKnown ? 1 : 0].join('|'),
    // B09：哪几项来自接口估算、哪几项由用户填写。
    sources: {
      // 行程耗时默认记在高德头上（这是常态），只有调用方明确说是手填才记 user。
      duration: effectiveDurationSource || 'amap',
      buffer: 'user',
      preparation: 'user',
      extra: 'user',
    },
    transport: effectiveTransport,
    // B09：耗时到底是怎么来的，必须能一句话说清，不能让人以为所有数字都是接口给的。
    routeNote: buildRouteNote({ durationSource: effectiveDurationSource, durationMinutes: effectiveDuration, transport: effectiveTransport, routeKnown: effectiveRouteKnown, alternatePending: useAlternate && alternateDuration == null }),
    fallback: fallback ? { kind: fallback.kind, switched: fallback.switched, mode: fallback.mode, extra: fallback.extra } : null,
    // B10：千问建议单独放，失败时为 null，不影响计算与保存。
    advice: advice || null,
    candidates: merged.candidates,
  };
}

// B09：给用户一句人话，说明「这段路要多久」这个数是怎么来的。
// 不能用「预计 30 分钟」一句话糊过去 —— 接口估算和你手填的含义完全不同。
export function buildRouteNote({ durationSource = 'amap', durationMinutes = null, transport = null, routeKnown = false, alternatePending = false } = {}) {
  const minutes = Number.isFinite(durationMinutes) ? Math.round(durationMinutes) : null;
  // B08：已经换成备用方式，但这条备用路线还没查过。
  // 这时说「手填值」也不对（用户填的是驾车那条），必须直说「需要重新查一次」。
  if (alternatePending) {
    return `已改用${transport ? `${transport}，但` : ''}尚未按备用方式重新查询路线，出发时间需要再查一次才能确定。`;
  }
  if (!routeKnown) return '尚未查询路线，行程耗时为手填值，可能与实际不符。';
  if (durationSource === 'user' || minutes == null) {
    return `行程耗时由你填写${minutes != null ? `（${minutes} 分钟）` : ''}，未使用接口估算。`;
  }
  return `${transport ? `${transport}路线` : '路线'}耗时由高德接口估算${minutes != null ? `（${minutes} 分钟）` : ''}，为查询当时的实时路况，不代表明早。`;
}

// 通勤时段天气裁决：统一走 schedule.js 的 windowVerdict，避免首页与通勤页两套结论。
// affected 可能是 true / false / null —— null 表示概率未知，界面必须显示「天气未知」。
export function commuteVerdict({ weather, departureAt, arrivalAt, threshold = 30 }) {
  if (!weather || !Number.isFinite(departureAt) || !Number.isFinite(arrivalAt)) {
    return { known: false, wet: null, unknown: false, window: null };
  }
  const verdict = windowVerdict(weather, new Date(departureAt), new Date(arrivalAt), threshold);
  if (!verdict.known) return { known: false, wet: null, unknown: false, window: null };
  return {
    known: true,
    wet: verdict.affected,
    unknown: verdict.affected === null,
    probability: verdict.probability,
    snow: verdict.snow,
    severe: verdict.severe,
    wetHours: verdict.wetHours,
    window: verdict.window,
  };
}

export { CANDIDATE_KIND };
