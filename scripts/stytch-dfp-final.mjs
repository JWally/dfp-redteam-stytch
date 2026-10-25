#!/usr/bin/env node
/** Capture C+96 (raw), table@8304, full blob in one run; then decrypt AES-256-CBC. */
import { chromium } from 'playwright';
import { createServer } from 'node:http';
import { writeFileSync, mkdirSync } from 'node:fs';

const html = `<!doctype html><html><body><button id="go">go</button>
<script src="https://elements.stytch.com/telemetry.js"></script>
<script>
window.__m=null;window.__res=null;
document.getElementById('go').onclick=async()=>{
 try{const m=await window.telemetryjs();window.__m=m;await m.Ready;m.rids=[];let r=null;
  await m.GetTID({a:'public-token-test',b:'http://127.0.0.1:8832/submit',c:'UNKNOWN',d:(v)=>{r=v;}});
  window.__res={ok:true};
 }catch(e){window.__res={err:String(e)};}
};
</script></body></html>`;
const server=createServer((q,r)=>{r.writeHead(200,{'content-type':'text/html'});r.end(html);});
await new Promise(r=>server.listen(8832,'127.0.0.1',r));

const MK={ua:'MARKERUA31337QQQ',platform:'MARKERPLATFORM31337',w:31337,h:41337,aw:31338,ah:41338,depth:33,hc:47,dm:79,mt:97};
const FIXED=Array.from({length:1024},(_,i)=>i%256), F4=[1,2,3,4], F16=[5,6,7,8,9,10,11,12,13,14,15,16,17,18,19,20];
const INIT=`(() => {
 const W=window,MK=${JSON.stringify(MK)},FIXED=${JSON.stringify(FIXED)},F4=${JSON.stringify(F4)},F16=${JSON.stringify(F16)};
 const def=(p,k,g)=>{try{Object.defineProperty(p,k,{configurable:true,get:g});}catch(e){}};
 def(Navigator.prototype,'userAgent',()=>MK.ua);def(Navigator.prototype,'appVersion',()=>MK.ua);
 def(Navigator.prototype,'platform',()=>MK.platform);def(Navigator.prototype,'hardwareConcurrency',()=>MK.hc);
 def(Navigator.prototype,'deviceMemory',()=>MK.dm);def(Navigator.prototype,'maxTouchPoints',()=>MK.mt);
 def(Screen.prototype,'width',()=>MK.w);def(Screen.prototype,'height',()=>MK.h);
 def(Screen.prototype,'availWidth',()=>MK.aw);def(Screen.prototype,'availHeight',()=>MK.ah);
 def(Screen.prototype,'colorDepth',()=>MK.depth);def(Screen.prototype,'pixelDepth',()=>MK.depth);
 let c4=0,c16=0;
 const oGRV=crypto.getRandomValues;
 crypto.getRandomValues=function(a){ const v=oGRV.call(crypto,a);
   if(a.length===1024){ for(let i=0;i<a.length;i++)a[i]=FIXED[i]; }
   else if(a.length===4){ for(let i=0;i<a.length;i++)a[i]=F4[(c4++)%4]; }
   else if(a.length===16){ for(let i=0;i<a.length;i++)a[i]=F16[(c16++)%16]; }
   return a;
 };
 const b64=(u8)=>{const CH=8192,p=[];for(let i=0;i<u8.length;i+=CH)p.push(String.fromCharCode.apply(null,u8.subarray(i,i+CH)));return btoa(p.join(''));};
 const _orig=W.telemetryjs;
 W.telemetryjs=function(...a){ const r=_orig.apply(this,a);
   if(r&&typeof r.then==='function') return r.then(m=>{W.__m=m;return m;});
   W.__m=r; return r; };
 W.__caps={};
 // capture after run
 W.__capture=function(){ try{
   const u8=W.__m.HEAPU8;
   const u32=(o)=>u8[o]|(u8[o+1]<<8)|(u8[o+2]<<16)|(u8[o+3]<<24);
   const C=u32(17349*4);
   W.__caps={ C, c96:b64(u8.slice(C+96,C+128)), table8304:b64(u8.slice(8304,8336)), head:b64(u8.slice(C,C+128)) };
 }catch(e){ W.__caps={err:String(e)}; } };
})();`;

const b=await chromium.launch({headless:true});
const ctx=await b.newContext(); await ctx.addInitScript({content:INIT});
const p=await ctx.newPage();
let blob=null;
await p.route('**/submit',async r=>{const q=r.request();const buf=q.postDataBuffer();blob=buf;await r.fulfill({status:200,contentType:'text/plain',body:'00000000-0000-4000-8000-000000000000'});});
await p.route('**/errors',r=>r.fulfill({status:200,contentType:'text/plain',body:'ok'}));
await p.goto('http://127.0.0.1:8832/',{waitUntil:'load'});
await p.waitForFunction(()=>typeof window.telemetryjs==='function',{timeout:15000}).catch(()=>{});
await p.click('#go'); await p.waitForTimeout(25000);
await p.evaluate(()=>window.__capture());
const caps=await p.evaluate(()=>window.__caps).catch(()=>null);
const res=await p.evaluate(()=>window.__res).catch(()=>null);
mkdirSync('/tmp/opencode/stytch',{recursive:true});
if(blob) writeFileSync('/tmp/opencode/stytch/final-blob.bin',Buffer.from(blob.toString('utf8'),'base64'));
writeFileSync('/tmp/opencode/stytch/final-caps.json',JSON.stringify({res,caps},null,2));
console.log('res',JSON.stringify(res));
console.log('C',caps&&caps.C);
console.log('c96',caps&&caps.c96);
console.log('table8304[0:32]',caps&&caps.table8304);
console.log('blob decoded len',blob&&Buffer.from(blob.toString('utf8'),'base64').length);
await b.close();server.close();
