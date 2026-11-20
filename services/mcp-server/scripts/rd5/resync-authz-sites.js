// Resync docs/authz-sites.json after a source edit: shift file:line citations by the git line map, then recompute counts from the scans.
const fs=require("fs"),path=require("path"),cp=require("child_process");
const root=process.cwd();
const scan=require(path.join(root,"dist/authz/scan.js")), rules=require(path.join(root,"dist/authz/rules.js")), render=require(path.join(root,"dist/authz/render.js"));
const docPath="docs/authz-sites.json";
const doc=JSON.parse(fs.readFileSync(docPath,"utf8"));
const base=process.env.RESYNC_BASE||"HEAD";
const changed=cp.execSync(`git diff --name-only ${base} -- src`,{encoding:"utf8"}).split("\n").filter(f=>f.startsWith("services/mcp-server/src/")).map(f=>f.replace("services/mcp-server/src/","")).filter(f=>!f.startsWith("__tests__"));
const maps={};
for(const f of changed){
  const d=cp.execSync(`git diff -U0 ${base} -- src/${f}`,{encoding:"utf8"});
  const hs=[...d.matchAll(/^@@ -(\d+)(?:,(\d+))? \+(\d+)(?:,(\d+))? @@/gm)].map(m=>({a:+m[1],b:m[2]===undefined?1:+m[2],c:+m[3],d:m[4]===undefined?1:+m[4]}));
  maps[f]=n=>{let off=0;for(const h of hs){const o=h.b===0?h.a+1:h.a;if(n<o)break;if(n<o+h.b)return h.c+(h.b===0?0:0)+Math.max(0,Math.min(n-o,h.d-1));off+=h.d-h.b;}return n+off;};
}
const resolve=(cite)=>{const c=Object.keys(maps).filter(f=>f===cite||f.endsWith("/"+cite)||(!cite.includes("/")&&path.basename(f)===cite));return c.length===1?c[0]:null;};
let shifted=0;
const fixStr=(s)=>s.replace(/((?:[\w.\-]+\/)*[\w.\-]+\.ts):(\d+)(?:-(\d+))?((?:, :\d+(?:-\d+)?)*)/g,(m,f,a,b,rest)=>{
  const k=resolve(f);if(!k)return m;const mp=maps[k];
  const one=(x,y)=>y?`${mp(+x)}-${mp(+y)}`:`${mp(+x)}`;
  const r=rest.replace(/, :(\d+)(?:-(\d+))?/g,(mm,x,y)=>", :"+one(x,y));
  shifted++;return `${f}:${one(a,b)}${r}`;});
const walk=(o)=>{
  if(typeof o==="string")return fixStr(o);
  if(Array.isArray(o))return o.map(walk);
  if(o&&typeof o==="object"){
    const out={};
    for(const [k,v] of Object.entries(o)){
      if(typeof v==="string")out[k]=fixStr(v);
      else if((k==="line"||k==="line_at_base")&&typeof v==="number"&&typeof o.file==="string"){const key=resolve(o.file);out[k]=key?maps[key](v):v;}
      else out[k]=walk(v);
    }
    return out;
  }
  return o;
};
const nd=walk(doc);
// recompute from the scans
const src=path.join(root,"src");
const hits=scan.scanSrc(src), groups=scan.groupHits(hits);
const byKey=new Map(groups.map(g=>[`${scan.siteKey(g.file,g.handler,g.expr)}|${g.regex}`,g]));
for(const s of nd.sites){ if(s.regex==="none")continue; const g=byKey.get(`${scan.siteKey(s.file,s.handler,s.expr)}|${s.regex}`); if(g){s.occurrences=g.occurrences;s.line_at_base=g.line_at_base;} else console.log("NO HIT",s.id); }
const a=hits.filter(h=>h.regex==="a"),c=hits.filter(h=>h.regex==="c");
const bl=new Set(hits.filter(h=>h.regex==="b").map(h=>`${h.file}:${h.line}`));
Object.assign(nd.regex_counts,{a_occurrences:a.length,a_lines:new Set(a.map(h=>`${h.file}:${h.line}`)).size,a_files:new Set(a.map(h=>h.file)).size,b_lines_beyond_a:bl.size,c_lines:c.length});
const {program,files}=rules.buildSrcProgram(src,[]);
const cur=rules.groupViolations(rules.checkProgram(program,files,(abs)=>path.relative(src,abs).split(path.sep).join("/")));
const k=(r)=>[r.rule,r.file,r.handler,r.expr].join("|");
const curMap=new Map(cur.map(r=>[k(r),r]));
const before=nd.ast_baseline.length;
nd.ast_baseline=nd.ast_baseline.filter(r=>curMap.has(k(r))).map(r=>({...r,occurrences:curMap.get(k(r)).occurrences,line_at_base:curMap.get(k(r)).line_at_base}));
for(const r of cur) if(!nd.ast_baseline.some(x=>k(x)===k(r))) console.log("NEW AST VIOLATION",k(r),r.occurrences);
fs.writeFileSync(docPath,JSON.stringify(nd,null,2)+"\n");
fs.writeFileSync("docs/authz-enumeration-checklist.md",render.renderChecklist(nd));
console.log("citations shifted",shifted,"ast baseline",before,"->",nd.ast_baseline.length);
