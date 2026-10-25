#!/usr/bin/env node
/** Proxy globals to log every property/method the Stytch C++ collector reads. */
import { chromium } from 'playwright';
import { createServer } from 'node:http';
import { writeFileSync, mkdirSync } from 'node:fs';
const html=`<!doctype html><html><body><button id="go">go</button>
<script src="https://elements.stytch.com/telemetry.js"></script>
<script>
window.__m=null;window.__res=null;window.__log=[];
document.getElementById('go').onclick=async()=>{
 try{const m=await window.telemetryjs();window.__m=m;await m.Ready;m.rids=[];let r=null;
  const ret=await m.GetTID({a:'public-token-test',b:'http://127.0.0.1:8816/submit',c:'UNKNOWN',d:(v)=>{r=v;}});
  window.__res={ret,r};
 }catch(e){window.__res={err:String(e),stack:e&&e.stack};}
};
</script></body></html>`;
const server=createServer((q,r)=>{r.writeHead(200,{'content-type':'text/html'});r.end(html);});
await new Promise(r=>server.listen(8816,'127.0.0.1',r));
const INIT=`(() => {
  const W=window, log=[];
  const mk=(name, target, wrapMethods)=>{
    return new Proxy(target, {
      get(t,prop,recv){
        try{
          if(typeof prop==='string'&&prop!=='constructor'&&prop[0]!=='_'&&log.length<2000){
            const v=Reflect.get(t,prop,recv);
            log.push([name,'get',prop,typeof v]);
            if(wrapMethods&&typeof v==='function') return function(...a){ log.push([name,'call',prop, a.map(x=>typeof x==='string'?x.slice(0,80):typeof x)]); return Reflect.apply(v,t,a); };
            return v;
          }
        }catch(e){}
        return Reflect.get(t,prop,recv);
      }
    });
  };
  try{
    const nav=navigator, scr=screen, doc=document, perf=performance;
    const navP=mk('navigator',nav,false);
    const scrP=mk('screen',scr,false);
    const docP=mk('document',doc,false);
    const perfP=mk('performance',perf,false);
    try{Object.defineProperty(W,'navigator',{configurable:true,get(){return navP;}});}catch(e){}
    try{Object.defineProperty(W,'screen',{configurable:true,get(){return scrP;}});}catch(e){}
    try{Object.defineProperty(W,'document',{configurable:true,get(){return docP;}});}catch(e){}
    try{Object.defineProperty(W,'performance',{configurable:true,get(){return perfP;}});}catch(e){}
    try{Object.defineProperty(navP,'userAgentData',{configurable:true,get(){return mk('uaData', nav.userAgentData,false);}});}catch(e){}
    W.__log=log;
  }catch(e){ W.__log=[['ERR',String(e)]]; }
})();`;
const b=await chromium.launch({headless:true});const ctx=await b.newContext();await ctx.addInitScript({content:INIT});const p=await ctx.newPage();
await p.route('**/submit',r=>r.fulfill({status:200,contentType:'text/plain',body:'00000000-0000-4000-8000-000000000000'}));
await p.route('**/errors',r=>r.fulfill({status:200,contentType:'text/plain',body:'ok'}));
await p.goto('http://127.0.0.1:8816/',{waitUntil:'load'});await p.waitForFunction(()=>typeof window.telemetryjs==='function',{timeout:15000}).catch(()=>{});
await p.click('#go');await p.waitForTimeout(15000);
const log=await p.evaluate(()=>window.__log).catch(()=>null);
const res=await p.evaluate(()=>window.__res).catch(()=>null);
mkdirSync('/tmp/opencode/stytch',{recursive:true});writeFileSync('/tmp/opencode/stytch/proxy-log.json',JSON.stringify({res,log},null,2));
console.log('res',JSON.stringify(res));
// summarize property names per object
const byObj={};
for(const [obj,op,prop] of (log||[])){ (byObj[obj]=byObj[obj]||new Set()).add((op==='get'?'':op+' ')+prop); }
for(const [k,v] of Object.entries(byObj)){ console.log(`\n### ${k} (${v.size})`); console.log([...v].sort().join(', ')); }
console.log('\ntotal log entries',log&&log.length);
await b.close();server.close();
