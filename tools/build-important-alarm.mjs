import {build} from 'vite';
import {readFileSync,writeFileSync} from 'node:fs';
const result=await build({configFile:false,build:{write:false,minify:true,lib:{entry:'tools/important-alarm-lab.js',name:'JishiImportantAlarm',formats:['iife']}}});
const output=(Array.isArray(result)?result:[result]).flatMap(r=>r.output);
const code=output.find(item=>item.type==='chunk').code;
const html=readFileSync('tools/important-alarm-lab.html','utf8').replace('<script type="module" src="./important-alarm-lab.js"></script>',()=>'<script>'+code.replaceAll('</script','<\\/script')+'</script>');
const target=process.argv[2]||'important-alarm-standalone.html';writeFileSync(target,html);console.log(target);
