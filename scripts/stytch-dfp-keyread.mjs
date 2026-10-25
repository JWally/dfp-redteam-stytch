#!/usr/bin/env node
/**
 * stytch-dfp-keyread.mjs — read the AES-256 key straight from the module's
 * own global pointer. In the wasm2js, C = a[17349] (a pointer to the crypto
 * context struct), and the 32-byte key lives at C+96. a[17349] == HEAPU8[69396].
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
  await m.GetTID({a:'public-token-test',b:'http://127.0.0.1:8823/submit',c:'UNKNOWN',d:(v)=>{r=v;}});
  window.__res={ok:true};
 }catch(e){window.__res={err:String(e)};}
};
</script></body></html>`;
const server=createServer((q,r)=>{r.writeHead(200,{'content-type':'text/html'});r.end(html);});
await new Promise(r=>server.listen(8823,'127.0.0.1',r));

const MK={ua:'MARKERUA31337QQQ',platform:'MARKERPLATFORM31337',w:31337,h:41337};
const INIT=`(() => {
 const W=window,MK=${JSON.stringify(MK)};
 const def=(p,k,g)=>{try{Object.defineProperty(p,k,{configurable:true,get:g});}catch(e){}};
 def(Navigator.prototype,'userAgent',()=>MK.ua);def(Navigator.prototype,'platform',()=>MK.platform);
 def(Screen.prototype,'width',()=>MK.w);def(Screen.prototype,'height',()=>MK.h);
})();`;

const b=await chromium.launch({headless:true});
const ctx=await b.newContext(); await ctx.addInitScript({content:INIT});
const p=await ctx.newPage();
let blob=null;
await p.route('**/submit',async r=>{const q=r.request();const buf=q.postDataBuffer();blob=buf;await r.fulfill({status:200,contentType:'text/plain',body:'00000000-0000-4000-8000-000000000000'});});
await p.route('**/errors',r=>r.fulfill({status:200,contentType:'text/plain',body:'ok'}));
await p.goto('http://127.0.0.1:8823/',{waitUntil:'load'});
await p.waitForFunction(()=>typeof window.telemetryjs==='function',{timeout:15000}).catch(()=>{});
await p.click('#go'); await p.waitForTimeout(18000);

// read the key via the module's own HEAPU8
const out=await p.evaluate(()=>{
  const m=window.__m; if(!m||!m.HEAPU8) return {err:'no module'};
  const u8=m.HEAPU8;
  const u32=(o)=>u8[o]|(u8[o+1]<<8)|(u8[o+2]<<16)|(u8[o+3]<<24);
  const C=u32(17349*4);
  const g=u32(17350*4); // a[17350] adjacent globals
  const key=Array.from(u8.slice(C+96,C+128));
  const ctxBytes=Array.from(u8.slice(C, C+256));
  return {C, g, keyHex:key.map(x=>x.toString(16).padStart(2,'0')).join(''), key, ctxHex:ctxBytes.map(x=>x.toString(16).padStart(2,'0')).join(''), nonceCandidates:{C_plus_0:Array.from(u8.slice(C,C+16)),C_plus_80:Array.from(u8.slice(C+80,C+96)),C_plus_96:Array.from(u8.slice(C+96,C+112))}};
}).catch(e=>({err:String(e)}));
mkdirSync('/tmp/opencode/stytch',{recursive:true});
writeFileSync('/tmp/opencode/stytch/keyread.json',JSON.stringify(out,null,2));
if(blob) writeFileSync('/tmp/opencode/stytch/keyread-blob.bin',Buffer.from(blob.toString('utf8'),'base64'));
const res=await p.evaluate(()=>window.__res).catch(()=>null);
console.log('res',JSON.stringify(res));
console.log('C',out.C,'g',out.g);
console.log('KEY32',out.keyHex);
console.log('key b64',Buffer.from(out.key||[]).toString('base64'));
console.log('ctx bytes C+0..256:',out.ctxHex);
await b.close();server.close();
