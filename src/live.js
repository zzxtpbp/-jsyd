import { wetVerdict, isSnow, isSevere } from './schedule.js';

export async function getJSON(url) {
  const response = await fetch(url, { signal: AbortSignal.timeout(15000) });
  if (!response.ok) throw new Error(`服务暂不可用 (${response.status})`);
  return response.json();
}
export function coordinate(text) {
  // 这里以前直接 text.split(',')，请求体缺少 location 时 text 是 undefined，
  // 服务端就抛 "Cannot read properties of undefined (reading 'split')"，
  // 前端只能看到一个堆栈片段，根本不知道是哪个参数没传。
  if (typeof text !== 'string' || !text.trim()) throw new Error('缺少坐标参数，请传入 location=经度,纬度（WGS84）');
  const parts = text.split(',').map(x => x.trim());
  const [lon, lat] = parts.map(Number);
  if (parts.length !== 2 || parts.some(x => !x) || !Number.isFinite(lon) || !Number.isFinite(lat) || Math.abs(lon) > 180 || Math.abs(lat) > 90) throw new Error('坐标格式为 经度,纬度，使用 WGS84 坐标');
  return { lon, lat };
}
export function weatherName(code) {
  if (code === 0) return '晴';
  if ([1, 2, 3].includes(code)) return '多云 / 阴';
  if ([45, 48].includes(code)) return '雾';
  if (isSnow(code)) return '雪';
  if (code >= 95) return '雷暴';
  if (code >= 51) return '雨';
  return '未知';
}
// 出发时段的天气裁决。阈值由调用方传入（见 docs/weather-rules.md 决定 4），
// 这里不再写死 50，也不再因为天气代码或降水量本身而绕过用户门槛。
// 概率缺失时返回 unknown，由上层显示「天气未知」，不当作「不下」。
export function assess(weather, route, departure, extra, maxAdvance, threshold = 30) {
  const stamp = (d) => `${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,'0')}-${String(d.getDate()).padStart(2,'0')}T${String(d.getHours()).padStart(2,'0')}:00`;
  const time = stamp(departure);
  const index = weather?.hourly?.time?.indexOf(time) ?? -1;
  // 超出预报范围属于「查不到」，与「查到了但没数据」分开表达，前者让用户调整时间，后者按未知处理。
  if (index < 0) throw new Error('出发时间超出当前预报范围，请刷新数据或调整日期');
  const code = weather.hourly.weather_code?.[index];
  const probability = Number.isFinite(weather.hourly.precipitation_probability?.[index])
    ? weather.hourly.precipitation_probability[index] : null;
  const precipitation = Number.isFinite(weather.hourly.precipitation?.[index])
    ? weather.hourly.precipitation[index] : null;
  const routeMinutes = Number.isFinite(route?.duration) ? route.duration : null;
  if (routeMinutes == null) throw new Error('路线耗时缺失，不自动调整');

  const wet = wetVerdict({ probability }, threshold);
  const unknown = wet === null;
  // 只有确认触发时才加额外准备；未知时不加，也不声称「不会下雨」。
  const advance = wet === true ? extra : 0;
  return {
    time, code, probability, precipitation, threshold,
    wet, unknown,
    advance,
    approval: advance > maxAdvance,
    snow: isSnow(code),
    severe: isSevere(code),
  };
}
