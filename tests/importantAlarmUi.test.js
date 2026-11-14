import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import vm from 'node:vm';
import {createImportantAlarm,transitionImportantAlarm} from '../src/importantAlarm.js';
// 用标准EventTarget测试控制器生命周期；不替代真实浏览器/安卓验收。
function harness(){
 class Element extends EventTarget {disabled=false;hidden=false;value='';checked=true;textContent='';setPointerCapture(){} }
 const ids=['settings','label','target','permission','sensor','start','phase','steps','goal','progress','status','audio','step','duplicate','dismiss','snooze','hold','new','confirm','json','taskName','confirmExit','cancelExit','resume'];
 const elements=Object.fromEntries(ids.map(id=>[id,new Element()]));elements.target.value='3';elements.label.value='赶车';elements.resume.hidden=true;
 let clock=100000,created=0;
 class Audio {state='running';currentTime=0;destination={};constructor(){created++;}resume(){this.state='running';return Promise.resolve();}close(){this.state='closed';return Promise.resolve();}createOscillator(){return {type:'',frequency:{value:0},connect(){},start(){},stop(){},disconnect(){}};}createGain(){return {gain:{setValueAtTime(){},linearRampToValueAtTime(){}},connect(){},disconnect(){}};}}
 const win=new EventTarget();win.AudioContext=Audio;
 const source=readFileSync(new URL('../tools/important-alarm-lab.js',import.meta.url),'utf8').replace(/^import .*;\r?\n/,'');
 const context=vm.createContext({window:win,document:{getElementById:id=>elements[id]},createImportantAlarm,transitionImportantAlarm,
  Date:class extends Date{static now(){return clock;}},crypto:{randomUUID:()=>`test-${clock}`},setInterval:()=>1,clearInterval(){},setTimeout:()=>2,clearTimeout(){}});
 vm.runInContext(source,context);
 const fire=(target,type,props={})=>{const e=new Event(type,{cancelable:true});for(const [k,v] of Object.entries(props))Object.defineProperty(e,k,{value:v});target.dispatchEvent(e);};
 return {el:elements,win,fire,advance:ms=>{clock+=ms;},contexts:()=>created,flush:()=>new Promise(resolve=>setImmediate(resolve))};
}
test('失焦取消键盘长按，不得复用8秒授权',async()=>{
 const h=harness();h.fire(h.el.settings,'submit');await h.flush();h.fire(h.el.hold,'keydown',{key:' ',repeat:false});
 h.fire(h.el.hold,'blur');h.advance(9000);h.fire(h.el.hold,'pointerdown',{button:0,pointerId:1});h.fire(h.el.hold,'pointerup');
 assert.equal(h.el.confirm.hidden,true);assert.equal(h.el.phase.textContent,'正常响铃 · 步数任务中');
});
test('返回页面后如实显示声音中断并提供恢复入口',async()=>{
 const h=harness();h.fire(h.el.settings,'submit');await h.flush();h.fire(h.win,'pagehide');h.fire(h.win,'pageshow');
 assert.equal(h.el.resume.hidden,false);assert.match(h.el.audio.textContent,/播放不可用/);
 h.fire(h.el.resume,'click');await h.flush();assert.equal(h.el.resume.hidden,true);assert.match(h.el.audio.textContent,/正常播放/);
});
test('连续提交不会并发创建两套音频',async()=>{
 const h=harness();h.fire(h.el.settings,'submit');h.fire(h.el.settings,'submit');await h.flush();assert.equal(h.contexts(),1);
});
