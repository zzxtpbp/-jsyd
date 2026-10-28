import test from 'node:test';
import assert from 'node:assert/strict';
import {tomorrowRisk,nextDaily,tickAlarms,commuteWeatherWindow,daySummary} from '../src/schedule.js';
test('多个到期闹钟独立触发，其他闹钟保持不变',()=>{
 const alarms=[{id:'a',at:1000,enabled:true},{id:'b',at:1000,enabled:true},{id:'c',at:20000,enabled:true},{id:'d',at:1000,enabled:false}];
 const next=tickAlarms(alarms,2000);
 assert.equal(next[0].state,'ringing');assert.equal(next[1].state,'ringing');assert.equal(next[2],alarms[2]);assert.equal(next[3],alarms[3]);
});
test('错过的一次性闹钟关闭，每日闹钟保留原定时间并顺延',()=>{
 const t=+new Date(2026,9,16,7,0),now=t+10*60000;
 const rows=tickAlarms([{at:t,enabled:true,repeat:'once'},{at:t+5*60000,baseAt:t,enabled:true,repeat:'daily'}],now+60000);
 assert.equal(rows[0].enabled,false);assert.equal(rows[0].state,'missed');assert.equal(new Date(rows[1].at).getHours(),7);assert.equal(new Date(rows[1].at).getMinutes(),0);assert.ok(rows[1].at>now);
});
 test('明日雨雪风险仅取第二天，有降水或超过用户阈值才提醒',()=>{
 const now=new Date(2026,9,16,20);
 const weather={hourly:{time:['2026-10-16T22:00','2026-10-17T08:00','2026-10-17T09:00'],weather_code:[61,3,73],precipitation_probability:[100,20,60],precipitation:[5,0,1]}};
 const r=tomorrowRisk(weather,now,30);assert.equal(r.day,'2026-10-17');assert.equal(r.probability,60);assert.equal(r.snow,true);assert.deepEqual(r.hours,['09:00']);
 assert.equal(tomorrowRisk(null,now),null);
 assert.ok(nextDaily(+now,+now)>+now);
});
test('上海场景：明天下午有雨但早高峰无雨，通勤窗口不判雨、不提前',()=>{
 // 模拟用户反馈：明日 15:00–18:00 降水 5%~11%，早高峰 06:00–09:00 无降水
 const times=[],codes=[],probs=[],amounts=[];
 for(let h=0;h<24;h++){
  times.push(`2026-10-17T${String(h).padStart(2,'0')}:00`);
  if(h>=15&&h<=18){codes.push(61);probs.push([0,0,0,0,5,10,10,11,5][h]||5);amounts.push(0.2);}
  else{codes.push(1);probs.push(3);amounts.push(0);}
 }
 const weather={hourly:{time:times,weather_code:codes,precipitation_probability:probs,precipitation:amounts}};
 // 全天口径：门槛 30 时，下午 5%~11% 的概率与代码 61 都不达标 ——
 // 旧实现因为 amount>0 或 code>=51 把全天判成 wet，那正是 B01 修掉的绕过路径。
 const full=daySummary(weather,'2026-10-17',30);
 assert.equal(full.affected,false);
 // 把下午概率提到 60%，全天口径才应当受下午降水影响。
 const heavy={hourly:{time:times,weather_code:codes,precipitation_probability:probs.map((p,i)=>i>=15&&i<=18?60:p),precipitation:amounts}};
 assert.equal(daySummary(heavy,'2026-10-17',30).affected,true);
 // 通勤窗口口径：07:00 出发 → 07:35 抵达 → 无降水、不提前
 const dep=new Date(2026,9,17,7,0),arr=new Date(2026,9,17,7,35);
 const win=commuteWeatherWindow(weather,dep,arr,30);
 assert.equal(win.affected,false);
 assert.equal(win.probability,3);
 assert.equal(win.hours.length,1);
});
test('通勤窗口跨小时、跨天都能取全，时段内有雨才提前',()=>{
 const weather={hourly:{time:['2026-10-16T22:00','2026-10-17T06:00','2026-10-17T07:00','2026-10-17T08:00'],weather_code:[1,1,61,3],precipitation_probability:[5,10,70,20],precipitation:[0,0,1.5,0]}};
 const dep=new Date(2026,9,16,23,30),arr=new Date(2026,9,17,8,10);
 const win=commuteWeatherWindow(weather,dep,arr,30);
 // 覆盖 17 日 06:00~08:00；16 日 22/23 点在预报里不存在（48h 窗口外），正确跳过
 assert.equal(win.hours.length,3);
 assert.equal(win.affected,true);
 assert.deepEqual(win.wetHours,['07:00']);
 assert.equal(win.snow,false);
 // 抵达早于出发的非法输入返回空
 assert.equal(commuteWeatherWindow(weather,arr,dep,30),null);
});
