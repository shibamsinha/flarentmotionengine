import { readFile } from 'node:fs/promises';
const scenes = JSON.parse(await readFile(process.argv[2],'utf8'));
const port = process.argv[3] ?? '5274';
const base = `http://localhost:${port}`;
const s = await (await fetch(base+'/api/render',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({scenes,palette:'forest'})})).json();
if(!s.jobId){console.error(s);process.exit(1);}
let last='';
for(;;){await new Promise(r=>setTimeout(r,700));
  const j=await (await fetch(`${base}/api/render/${s.jobId}`)).json();
  const line=`${j.status} ${Math.round((j.progress||0)*100)}%`;
  if(line!==last){process.stderr.write(line+'\n');last=line;}
  if(j.status==='done'){console.log(j.filename);break;}
  if(j.status==='error'){console.error(j.message);process.exit(1);}}
