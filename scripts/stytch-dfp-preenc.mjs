#!/usr/bin/env node
/**
 * stytch-dfp-preenc.mjs — dump the FULL heap right BEFORE the 16-byte
 * getRandomValues (encryption nonce) and right after, to catch the plaintext
 * (if encrypted-not-compressed) or the compressed data. Same run captures blob.
 */
import { chromium } from 'playwright';
import { createServer } from 'node:http';
import { writeFileSync, mkdirSync } from 'node:fs';

const html = `<!doctype html><html><body><button id="go">go</button>
<script src="https://elements.stytch.com/telemetry.js"></script>
<script>
window.__m=null;window.__res=null;
document.getElementById('go').onclick=async()=>{
 try{const m=await window.telemetryjs();window.__m=m;await m.Ready;m.rids=[];let r=null;
  await m.GetTID({a:'public-token-test',b:'http://127.0.0.1:8830/submit',c:'UNKNOWN',d:(v)=>{r=v;}});
  window.__res={ok:true};
 }catch(e){window.__res={err:String(e)};}
};
</script></body></html>`;
const server=createServer((q,r)=>{r.writeHead(200,{'content-type':'text/html'});r.end(html);});
await new Promise(r=>server.listen(8830,'127.0.0.1',r));

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
 let c4=0,c16=0, saw16=false;
 const oGRV=crypto.getRandomValues;
 const b64=(u8)=>{const CH=8192,p=[];for(let i=0;i<u8.length;i+=CH)p.push(String.fromCharCode.apply(null,u8.subarray(i,i+CH)));return btoa(p.join(''));};
 W.__dumps=[];
 crypto.getRandomValues=function(a){ const v=oGRV.call(crypto,a);
   if(a.length===16){ if(!saw16){ saw16=true; try{ if(W.__m) W.__dumps.push({tag:'pre16',b64:b64(W.__m.HEAPU8)});}catch(e){} }
     for(let i=0;i<a.length;i++)a[i]=F16[(c16++)%16];
     try{ if(W.__m) W.__dumps.push({tag:'post16',b64:b64(W.__m.HEAPU8)});}catch(e){}
   }
   else if(a.length===1024){ for(let i=0;i<a.length;i++)a[i]=FIXED[i]; }
   else if(a.length===4){ for(let i=0;i<a.length;i++)a[i]=F4[(c4++)%4]; }
   return a;
 };
 const _orig=W.telemetryjs;
 W.telemetryjs=function(...a){ const r=_orig.apply(this,a);
   if(r&&typeof r.then==='function') return r.then(m=>{W.__m=m;return m;});
   W.__m=r; return r; };
 const oFetch=W.fetch;
 W.fetch=function(input,init){ try{ if(String(input).includes('/submit')&&W.__m) W.__dumps.push({tag:'fetch',b64:b64(W.__m.HEAPU8)});}catch(e){} return oFetch.apply(this,arguments); };
})();`;

const b=await chromium.launch({headless:true});
const ctx=await b.newContext(); await ctx.addInitScript({content:INIT});
const p=await ctx.newPage();
let blob=null;
await p.route('**/submit',async r=>{const q=r.request();const buf=q.postDataBuffer();blob=buf;await r.fulfill({status:200,contentType:'text/plain',body:'00000000-0000-4000-8000-000000000000'});});
await p.route('**/errors',r=>r.fulfill({status:200,contentType:'text/plain',body:'ok'}));
await p.goto('http://127.0.0.1:8830/',{waitUntil:'load'});
await p.waitForFunction(()=>typeof window.telemetryjs==='function',{timeout:15000}).catch(()=>{});
await p.click('#go'); await p.waitForTimeout(25000);
const dumps=await p.evaluate(()=>window.__dumps).catch(()=>null);
const res=await p.evaluate(()=>window.__res).catch(()=>null);
mkdirSync('/tmp/opencode/stytch/heaps',{recursive:true});
for(const d of (dumps||[])) writeFileSync(`/tmp/opencode/stytch/heaps/pe-${d.tag}.bin`,Buffer.from(d.b64,'base64'));
if(blob) writeFileSync('/tmp/opencode/stytch/pe-blob.bin',Buffer.from(blob.toString('utf8'),'base64'));
console.log('res',JSON.stringify(res));
console.log('dumps',(dumps||[]).map(d=>d.tag),'blob',blob&&Buffer.from(blob.toString('utf8'),'base64').length);
await b.close();server.close();
