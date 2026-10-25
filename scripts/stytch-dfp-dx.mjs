#!/usr/bin/env node
/** Full GetTelemetryID + de-hook: capture full blob, all key-expansion keys, heap dumps. */
import { chromium } from 'playwright';
import { createServer } from 'node:http';
import { writeFileSync, mkdirSync } from 'node:fs';

const base = (await import('node:fs')).readFileSync('/tmp/opencode/st-beautified-dehook.js','utf8');
const html = `<!doctype html><html><body><button id="go">go</button>
<script src="https://elements.stytch.com/telemetry.js"></script>
<script>
window.__res=null;
document.getElementById('go').onclick=async()=>{
 try{const m=await window.telemetryjs();window.__m=m;await m.Ready;m.rids=[];let r=null;
  const ret=await GetTelemetryID({publicToken:'public-token-test',submitURL:'http://127.0.0.1:8826/submit'});
  window.__res={ok:true,ret};
 }catch(e){window.__res={err:String(e)};}
};
</script></body></html>`;
const server=createServer((q,r)=>{r.writeHead(200,{'content-type':'text/html'});r.end(html);});
await new Promise(r=>server.listen(8826,'127.0.0.1',r));

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
 W.__deLog=[]; W.__heapDumps=[];
 const _orig=W.telemetryjs;
 W.telemetryjs=function(...a){ const r=_orig.apply(this,a);
   if(r&&typeof r.then==='function') return r.then(m=>{W.__m=m;return m;});
   W.__m=r; return r; };
 W.__deHook=function(b,c,d){
   try{
     const u8=W.__m&&W.__m.HEAPU8;
     const key=u8?Array.from(u8.slice(c,c+32)):[];
     W.__deLog.push({b,c,d,keyHex:key.map(x=>x.toString(16).padStart(2,'0')).join(''),at:Date.now()});
     if(u8&&W.__heapDumps.length<6) W.__heapDumps.push(b64(u8));
   }catch(e){ try{W.__deLog.push({err:String(e)});}catch(_){} }
 };
})();`;

const b=await chromium.launch({headless:true});
const ctx=await b.newContext(); await ctx.addInitScript({content:INIT});
const p=await ctx.newPage();
let blob=null;
await p.route('**/telemetry.js',r=>r.fulfill({status:200,contentType:'application/javascript',body:base}));
await p.route('**/submit',async r=>{const q=r.request();const buf=q.postDataBuffer();blob=buf;await r.fulfill({status:200,contentType:'text/plain',body:'00000000-0000-4000-8000-000000000000'});});
await p.route('**/errors',r=>r.fulfill({status:200,contentType:'text/plain',body:'ok'}));
await p.goto('http://127.0.0.1:8826/',{waitUntil:'load'});
await p.waitForFunction(()=>typeof window.telemetryjs==='function',{timeout:15000}).catch(()=>{});
await p.click('#go'); await p.waitForTimeout(25000);
const deLog=await p.evaluate(()=>window.__deLog).catch(()=>null);
const dumps=await p.evaluate(()=>window.__heapDumps).catch(()=>null);
const res=await p.evaluate(()=>window.__res).catch(()=>null);
mkdirSync('/tmp/opencode/stytch/heaps',{recursive:true});
for(let i=0;i<(dumps||[]).length;i++) writeFileSync(`/tmp/opencode/stytch/heaps/dx-${i}.bin`,Buffer.from(dumps[i],'base64'));
if(blob) writeFileSync('/tmp/opencode/stytch/dx-blob.bin',Buffer.from(blob.toString('utf8'),'base64'));
writeFileSync('/tmp/opencode/stytch/dx-log.json',JSON.stringify({res,deLog},null,2));
console.log('res',JSON.stringify(res));
console.log('blob decoded len',blob&&Buffer.from(blob.toString('utf8'),'base64').length,'de calls',deLog&&deLog.length,'dumps',dumps&&dumps.length);
await b.close();server.close();
