import test from 'node:test';
import assert from 'node:assert/strict';
import {scenarios,makeScenario} from '../examples/commuteScenarios.js';
import {calculateCommuteWorkflow} from '../src/commuteWorkflow.js';
for(const s of scenarios)test(`演示页共用计算链：${s.name}`,()=>{
 const input=makeScenario(s.id), before=structuredClone(input),r=calculateCommuteWorkflow(input);
 assert.equal(r.write.action,s.expected.action);assert.equal(r.summary.selectedMode,s.expected.mode);
 assert.equal(r.summary.gapMinutes,s.expected.gap);assert.deepEqual(input,before);
});
