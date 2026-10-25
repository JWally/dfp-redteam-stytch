#!/usr/bin/env node
/** Exhaustive property hook on Navigator/Screen/Document prototypes -> field schema. */
import { chromium } from 'playwright';
import { createServer } from 'node:http';
import { writeFileSync, mkdirSync } from 'node:fs';
const html=`<!doctype html><html><body><button id="go">go</button>
<script src="https://elements.stytch.com/telemetry.js"></script>
<script>
window.__m=null;window.__res=null;window.__log=[];
document.getElementById('go').onclick=async()=>{
 try{const m=await window.telemetryjs();window.__m=m;await m.Ready;m.rids=[];let r=null;
  const ret=await m.GetTID({a:'public-token-test',b:'http://127.0.0.1:8817/submit',c:'UNKNOWN',d:(v)=>{r=v;}});
  window.__res={ret,r};
 }catch(e){window.__res={err:String(e),stack:e&&e.stack};}
};
</script></body></html>`;
const server=createServer((q,r)=>{r.writeHead(200,{'content-type':'text/html'});r.end(html);});
await new Promise(r=>server.listen(8817,'127.0.0.1',r));
const INIT=`(() => {
  const W=window, log=[];
  const hook=(proto,name,objName)=>{
    const keys=[...new Set([...Object.getOwnPropertyNames(proto||{}), ...Object.keys(proto||{})])];
    for(const k of keys){
      if(k==='constructor')continue;
      try{
        const d=Object.getOwnPropertyDescriptor(proto,k);
        if(d&&typeof d.get==='function'){
          Object.defineProperty(proto,k,{configurable:true,get:function(){try{log.push([objName,'get',k,typeof d.get.call(this)]);}catch(e){}return d.get.call(this);}});
        } else if(d&&typeof d.value==='function'){
          Object.defineProperty(proto,k,{configurable:true,value:function(...a){try{log.push([objName,'call',k,a.map(x=>typeof x==='string'?x.slice(0,60):typeof x)]);}catch(e){}return d.value.apply(this,a);}});
        }
      }catch(e){}
    }
  };
  try{
    hook(Navigator.prototype,'navigator');
    hook(Screen.prototype,'screen');
    hook(Document.prototype,'document');
    hook(HTMLElement.prototype,'HTMLElement');
    hook(HTMLCanvasElement.prototype,'canvas');
    hook(CanvasRenderingContext2D&&CanvasRenderingContext2D.prototype,'ctx2d');
    hook(WebGLRenderingContext&&WebGLRenderingContext.prototype,'webgl');
    hook(WebGL2RenderingContext&&WebGL2RenderingContext.prototype,'webgl2');
    hook(OfflineAudioContext&&OfflineAudioContext.prototype,'offlineaudio');
    hook(AudioContext&&AudioContext.prototype,'audio');
    hook(Intl.DateTimeFormat&&Intl.DateTimeFormat.prototype,'intl');
    hook(Navigator.prototype.userAgentData&&Object.getPrototypeOf(navigator.userAgentData),'uaData');
    hook(W&&Object.getPrototypeOf(W),'window');
    W.__log=log;
  }catch(e){ W.__log=[['ERR',String(e)]]; }
})();`;
const b=await chromium.launch({headless:true});const ctx=await b.newContext();await ctx.addInitScript({content:INIT});const p=await ctx.newPage();
await p.route('**/submit',r=>r.fulfill({status:200,contentType:'text/plain',body:'00000000-0000-4000-8000-000000000000'}));
await p.route('**/errors',r=>r.fulfill({status:200,contentType:'text/plain',body:'ok'}));
await p.goto('http://127.0.0.1:8817/',{waitUntil:'load'});await p.waitForFunction(()=>typeof window.telemetryjs==='function',{timeout:15000}).catch(()=>{});
await p.click('#go');await p.waitForTimeout(15000);
const log=await p.evaluate(()=>window.__log).catch(()=>null);
const res=await p.evaluate(()=>window.__res).catch(()=>null);
mkdirSync('/tmp/opencode/stytch',{recursive:true});writeFileSync('/tmp/opencode/stytch/fields.json',JSON.stringify({res,log},null,2));
console.log('res',JSON.stringify(res));
const byObj={};
for(const [obj,op,prop] of (log||[])){ const k=obj; (byObj[k]=byObj[k]||new Set()).add(prop); }
for(const [k,v] of Object.entries(byObj)){ console.log(`\n### ${k} (${v.size})`); console.log([...v].sort().join(', ')); }
console.log('\ntotal',log&&log.length);
await b.close();server.close();
