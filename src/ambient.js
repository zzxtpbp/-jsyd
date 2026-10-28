// 天气环境音：在主铃之前铺一层合成雨声 / 风声，主铃仍按原定时间响。
// 只负责发声与停止，不做计时；计时由调用方按主铃时间推算，便于测试。
const SNOW_CODES = [71, 73, 75, 77, 85, 86];

// 按天气代码挑音色：雪=低沉风声、雨=明亮雨声、未知=中性轻风。
export function ambientProfile(code) {
  if (SNOW_CODES.includes(code)) return { kind: 'snow', lowpass: 220, gain: 0.12, label: '风雪声' };
  if (Number.isFinite(code) && code >= 51) return { kind: 'rain', lowpass: 950, gain: 0.18, label: '雨声' };
  return { kind: 'wind', lowpass: 420, gain: 0.08, label: '轻风声' };
}

// 环境音应该响起的起止时间：主铃前 offset 分钟开始，主铃后 duration 分钟结束。
export function ambientWindow(alarmAt, { enabled, offsetMinutes, durationMinutes }) {
  if (!enabled || !Number.isFinite(alarmAt)) return null;
  if (!Number.isFinite(offsetMinutes) || offsetMinutes <= 0) return null;
  const duration = Number.isFinite(durationMinutes) ? durationMinutes : 0;
  return { start: alarmAt - offsetMinutes * 60000, end: alarmAt + duration * 60000 };
}

// 这个时刻是否应该正在发声；主铃已进入响铃状态时不再重复铺环境音。
export function shouldSound(now, window, ringing) {
  if (!window || ringing) return false;
  return now >= window.start && now < window.end;
}

export function createAmbient(ctx, volume = 35) {
  if (!ctx) return null;
  const seconds = 2;
  const buffer = ctx.createBuffer(1, ctx.sampleRate * seconds, ctx.sampleRate);
  const data = buffer.getChannelData(0);
  for (let i = 0; i < data.length; i++) data[i] = Math.random() * 2 - 1;
  const source = ctx.createBufferSource();
  const filter = ctx.createBiquadFilter();
  const gain = ctx.createGain();
  source.buffer = buffer;
  source.loop = true;
  filter.type = 'lowpass';
  filter.frequency.value = 420;
  gain.gain.value = Math.max(0, Math.min(1, volume / 100)) * 0.08;
  source.connect(filter);
  filter.connect(gain);
  gain.connect(ctx.destination);
  return {
    setProfile(code) {
      const p = ambientProfile(code);
      filter.frequency.value = p.lowpass;
      gain.gain.value = Math.max(0, Math.min(1, volume / 100)) * p.gain;
      return p;
    },
    start() { try { source.start(); } catch {} },
    stop() {
      try { gain.gain.setTargetAtTime(0.0001, ctx.currentTime, 0.05); } catch {}
      try { source.stop(ctx.currentTime + 0.3); } catch {}
      setTimeout(() => { try { source.disconnect(); filter.disconnect(); gain.disconnect(); } catch {} }, 500);
    },
  };
}
