#!/usr/bin/env node
/**
 * stytch-dfp-decrypt.mjs — capture the final 16-byte crypto nonce, the wire
 * blob, and the heap right after nonce generation, then attempt AES decrypt
 * with candidate keys to recover the plaintext schema.
 */
import { chromium } from 'playwright';
import { createServer } from 'node:http';
import { writeFileSync, mkdirSync } from 'node:fs';

const html = `<!doctype html><html><body><button id="go">go</button>
<script src="https://elements.stytch.com/telemetry.js"></script>
<script>
window.__m=null;window.__res=null;window.__nonce=null;window.__heapAfter=null;
document.getElementById('go').onclick=async()=>{
 try{const m=await window.telemetryjs();window.__m=m;await m.Ready;m.rids=[];let r=null;
  const ret=await m.GetTID({a:'public-token-test',b:'http://127.0.0.1:8821/submit',c:'UNKNOWN',d:(v)=>{r=v;}});
  window.__res={ret,r};
 }catch(e){window.__res={err:String(e),stack:e&&e.stack};}
};
</script></body></html>`;
const server=createServer((q,r)=>{r.writeHead(200,{'content-type':'text/html'});r.end(html);});
await new Promise(r=>server.listen(8821,'127.0.0.1',r));

const MK={ua:'MARKERUA31337QQQ',platform:'MARKERPLATFORM31337',w:31337,h:41337};
const INIT=`(() => {
 const W=window,MK=${JSON.stringify(MK)};
 const def=(p,k,g)=>{try{Object.defineProperty(p,k,{configurable:true,get:g});}catch(e){}};
 def(Navigator.prototype,'userAgent',()=>MK.ua);def(Navigator.prototype,'platform',()=>MK.platform);
 def(Screen.prototype,'width',()=>MK.w);def(Screen.prototype,'height',()=>MK.h);
 const b64=(u8)=>{const CH=8192,p=[];for(let i=0;i<u8.length;i+=CH)p.push(String.fromCharCode.apply(null,u8.subarray(i,i+CH)));return btoa(p.join(''));};
 const oGRV=crypto.getRandomValues;
 crypto.getRandomValues=function(a){
   if(a.length===16){ const v=oGRV.call(crypto,a); W.__nonce=Array.from(a);
     try{ W.__heapAfter={b64:b64(W.__m.HEAPU8.subarray(0,524288))}; }catch(e){}
     return v;
   }
   return oGRV.call(crypto,a);
 };
 const oFetch=W.fetch; W.fetch=function(input,init){ if(String(input).includes('/submit')) W.__body=(init&&init.body)||null; return oFetch.apply(this,arguments); };
})();`;

const b=await chromium.launch({headless:true});
const ctx=await b.newContext();
await ctx.addInitScript({content:INIT});
const p=await ctx.newPage();
let blob=null;
await p.route('**/submit',async r=>{const q=r.request();const buf=q.postDataBuffer();blob=buf;await r.fulfill({status:200,contentType:'text/plain',body:'00000000-0000-4000-8000-000000000000'});});
await p.route('**/errors',r=>r.fulfill({status:200,contentType:'text/plain',body:'ok'}));
await p.goto('http://127.0.0.1:8821/',{waitUntil:'load'});
await p.waitForFunction(()=>typeof window.telemetryjs==='function',{timeout:15000}).catch(()=>{});
await p.click('#go');
await p.waitForTimeout(18000);
const nonce=await p.evaluate(()=>window.__nonce).catch(()=>null);
const heapAfter=await p.evaluate(()=>window.__heapAfter).catch(()=>null);
const res=await p.evaluate(()=>window.__res).catch(()=>null);
mkdirSync('/tmp/opencode/stytch',{recursive:true});
if(heapAfter&&heapAfter.b64) writeFileSync('/tmp/opencode/stytch/heaps/after-nonce.bin',Buffer.from(heapAfter.b64,'base64'));
writeFileSync('/tmp/opencode/stytch/blob.bin',blob||Buffer.alloc(0));
writeFileSync('/tmp/opencode/stytch/decrypt-meta.json',JSON.stringify({res,nonce,blobLen:blob&&blob.length,body:(await p.evaluate(()=>window.__body).catch(()=>null)||'').length},null,2));
console.log('res',JSON.stringify(res));
console.log('nonce16',nonce&&nonce.map(x=>x.toString(16).padStart(2,'0')).join(''));
console.log('blob len',blob&&blob.length,'blob head',blob&&blob.slice(0,24).toString('hex'));
await b.close();server.close();
