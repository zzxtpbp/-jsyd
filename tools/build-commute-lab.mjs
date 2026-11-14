// 可选：把验收台打成可直接打开的单文件 HTML。只使用仓库已有 Vite。
import {build} from 'vite';
import {readFileSync,writeFileSync} from 'node:fs';
const result=await build({configFile:false,build:{write:false,minify:true,lib:{entry:'tools/commute-lab.js',name:'JishiLab',formats:['iife']}}});
const output=(Array.isArray(result)?result:[result]).flatMap(item=>item.output);
const code=output.find(item=>item.type==='chunk').code;
const html=readFileSync('tools/commute-lab.html','utf8').replace('<script type="module" src="./commute-lab.js"></script>',()=>'<script>'+code.replaceAll('</script','<\\/script')+'</script>');
const path=process.argv[2]||'commute-lab-standalone.html';
writeFileSync(path,html);console.log(path);
