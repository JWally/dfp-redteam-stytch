#!/usr/bin/env node
/**
 * stytch-dfp-heapdump-at-encrypt.mjs — patch the wasm2js to dump HEAPU8 at the
 * exact moment of AES key expansion (right before encryption), so the plaintext
 * zlib stream + marker values are captured in memory. Serves the beautified
 * (but functionally identical) bundle in flight.
 */
import { chromium } from 'playwright';
import { createServer } from 'node:http';
import { writeFileSync, mkdirSync } from 'node:fs';

const base = (await import('node:fs')).readFileSync('/tmp/opencode/st-beautified.js','utf8');
const needle = 'de((c + 224) | 0, b, (c + 592) | 0);';
const inject = needle + '\nif (window.__oscDumpHeap) { window.__oscDumpHeap(); }';
const src = base.split(needle).join(inject);

const html = `<!doctype html><html><body><button id="go">go</button>
<script src="https://elements.stytch.com/telemetry.js"></script>
<script>
window.__res=null;
document.getElementById('go').onclick=async()=>{
 try{const m=await window.telemetryjs();await m.Ready;m.rids=[];let r=null;
  await m.GetTID({a:'public-token-test',b:'http://127.0.0.1:8824/submit',c:'UNKNOWN',d:(v)=>{r=v;}});
  window.__res={ok:true};
 }catch(e){window.__res={err:String(e)};}
};
</script></body></html>`;
const server=createServer((q,r)=>{r.writeHead(200,{'content-type':'text/html'});r.end(html);});
await new Promise(r=>server.listen(8824,'127.0.0.1',r));

const MK={ua:'MARKERUA31337QQQ',platform:'MARKERPLATFORM31337',w:31337,h:41337};
const INIT=`(() => {
 const W=window,MK=${JSON.stringify(MK)};
 const def=(p,k,g)=>{try{Object.defineProperty(p,k,{configurable:true,get:g});}catch(e){}};
 def(Navigator.prototype,'userAgent',()=>MK.ua);def(Navigator.prototype,'platform',()=>MK.platform);
 def(Screen.prototype,'width',()=>MK.w);def(Screen.prototype,'height',()=>MK.h);
 const b64=(u8)=>{const CH=8192,p=[];for(let i=0;i<u8.length;i+=CH)p.push(String.fromCharCode.apply(null,u8.subarray(i,i+CH)));return btoa(p.join(''));};
 W.__dumps=[];
 W.__oscDumpHeap=function(){ try{ if(W.__m&&W.__m.HEAPU8&&W.__dumps.length<4) W.__dumps.push(b64(W.__m.HEAPU8)); }catch(e){} };
 // capture module ref
 const _orig=W.telemetryjs;
 W.telemetryjs=function(...a){ const r=_orig.apply(this,a);
   if(r&&typeof r.then==='function') return r.then(m=>{W.__m=m;return m;});
   W.__m=r; return r; };
})();`;

const b=await chromium.launch({headless:true});
const ctx=await b.newContext(); await ctx.addInitScript({content:INIT});
const p=await ctx.newPage();
let blob=null;
await p.route('**/telemetry.js',r=>r.fulfill({status:200,contentType:'application/javascript',body:src}));
await p.route('**/submit',async r=>{const q=r.request();const buf=q.postDataBuffer();blob=buf;await r.fulfill({status:200,contentType:'text/plain',body:'00000000-0000-4000-8000-000000000000'});});
await p.route('**/errors',r=>r.fulfill({status:200,contentType:'text/plain',body:'ok'}));
await p.goto('http://127.0.0.1:8824/',{waitUntil:'load'});
await p.waitForFunction(()=>typeof window.telemetryjs==='function',{timeout:15000}).catch(()=>{});
await p.click('#go'); await p.waitForTimeout(18000);
const dumps=await p.evaluate(()=>window.__dumps).catch(()=>null);
const res=await p.evaluate(()=>window.__res).catch(()=>null);
mkdirSync('/tmp/opencode/stytch/heaps',{recursive:true});
for(let i=0;i<(dumps||[]).length;i++) writeFileSync(`/tmp/opencode/stytch/heaps/enc-${i}.bin`,Buffer.from(dumps[i],'base64'));
if(blob) writeFileSync('/tmp/opencode/stytch/enc-blob.bin',Buffer.from(blob.toString('utf8'),'base64'));
console.log('res',JSON.stringify(res),'dumps',dumps&&dumps.length,'blob',blob&&Buffer.from(blob.toString('utf8'),'base64').length);
await b.close();server.close();
