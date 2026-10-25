#!/usr/bin/env node
/** Save first 256KB of HEAPU8 at getRandomValues/fetch with marker inputs. */
import { chromium } from 'playwright';
import { createServer } from 'node:http';
import { writeFileSync, mkdirSync } from 'node:fs';
const html=`<!doctype html><html><body><button id="go">go</button>
<script src="https://elements.stytch.com/telemetry.js"></script>
<script>
window.__m=null;window.__heaps=[];window.__body=null;window.__res=null;
document.getElementById('go').onclick=async()=>{
 try{const m=await window.telemetryjs();window.__m=m;await m.Ready;m.rids=[];let r=null;
  const ret=await m.GetTID({a:'public-token-test',b:'http://127.0.0.1:8813/submit',c:'UNKNOWN',d:(v)=>{r=v;}});
  window.__res={ret,r};
 }catch(e){window.__res={err:String(e),stack:e&&e.stack};}
};
</script></body></html>`;
const server=createServer((q,r)=>{r.writeHead(200,{'content-type':'text/html'});r.end(html);});
await new Promise(r=>server.listen(8813,'127.0.0.1',r));
const MK={ua:'MARKERUA31337QQQ',platform:'MARKERPLATFORM31337',w:31337,h:41337,aw:31338,ah:41338,depth:33,hc:47,dm:79,mt:97};
const INIT=`(() => {
 const W=window,MK=${JSON.stringify(MK)};
 const def=(p,k,g)=>{try{Object.defineProperty(p,k,{configurable:true,get:g});}catch(e){}};
 def(Navigator.prototype,'userAgent',()=>MK.ua);def(Navigator.prototype,'appVersion',()=>MK.ua);
 def(Navigator.prototype,'platform',()=>MK.platform);def(Navigator.prototype,'hardwareConcurrency',()=>MK.hc);
 def(Navigator.prototype,'deviceMemory',()=>MK.dm);def(Navigator.prototype,'maxTouchPoints',()=>MK.mt);
 def(Screen.prototype,'width',()=>MK.w);def(Screen.prototype,'height',()=>MK.h);
 def(Screen.prototype,'availWidth',()=>MK.aw);def(Screen.prototype,'availHeight',()=>MK.ah);
 def(Screen.prototype,'colorDepth',()=>MK.depth);def(Screen.prototype,'pixelDepth',()=>MK.depth);
 const b64=(u8)=>{const CH=8192,p=[];for(let i=0;i<u8.length;i+=CH)p.push(String.fromCharCode.apply(null,u8.subarray(i,i+CH)));return btoa(p.join(''));};
 const save=(where)=>{try{if(!W.__m||!W.__m.HEAPU8||W.__heaps.length>8)return;const h=W.__m.HEAPU8;W.__heaps.push({where,at:Date.now(),len:h.length,b64:b64(h.subarray(0,262144))});}catch(e){}};
 const oGRV=crypto.getRandomValues;crypto.getRandomValues=function(a){save('pre-grv');const v=oGRV.call(crypto,a);save('post-grv');return v;};
 const oFetch=W.fetch;W.fetch=function(input,init){try{if(String(input).includes('/submit')){save('fetch');if(init&&typeof init.body==='string')W.__body=init.body;}}catch(e){}return oFetch.apply(this,arguments);};
})();`;
const b=await chromium.launch({headless:true});const ctx=await b.newContext();await ctx.addInitScript({content:INIT});const p=await ctx.newPage();
await p.route('**/submit',r=>r.fulfill({status:200,contentType:'text/plain',body:'00000000-0000-4000-8000-000000000000'}));
await p.route('**/errors',r=>r.fulfill({status:200,contentType:'text/plain',body:'ok'}));
await p.goto('http://127.0.0.1:8813/',{waitUntil:'load'});
await p.waitForFunction(()=>typeof window.telemetryjs==='function',{timeout:15000}).catch(()=>{});
await p.click('#go');await p.waitForTimeout(15000);
const out=await p.evaluate(()=>({res:window.__res,heaps:window.__heaps,body:window.__body})).catch(()=>null);
mkdirSync('/tmp/opencode/stytch/heaps',{recursive:true});writeFileSync('/tmp/opencode/stytch/heaps/meta.json',JSON.stringify({res:out&&out.res,bodyLen:out&&out.body&&out.body.length,body:out&&out.body,heaps:(out&&out.heaps||[]).map(h=>({where:h.where,at:h.at,len:h.len}))},null,2));
for(const h of (out&&out.heaps||[]))writeFileSync(`/tmp/opencode/stytch/heaps/${h.where}-${h.at}.bin`,Buffer.from(h.b64,'base64'));
console.log('res',JSON.stringify(out&&out.res),'bodyLen',out&&out.body&&out.body.length,'heaps',out&&out.heaps&&out.heaps.length);
await b.close();server.close();
