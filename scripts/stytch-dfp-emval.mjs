#!/usr/bin/env node
/**
 * stytch-dfp-emval.mjs — log every value flowing from JS into the C++ wasm2js
 * collector by patching the Emscripten emval bridge (get_global, get_property,
 * methodCaller). Uses marker inputs to label the signals.
 */
import { chromium } from 'playwright';
import { createServer } from 'node:http';
import { readFileSync, writeFileSync, mkdirSync } from 'node:fs';

const src = readFileSync('/tmp/opencode/st-telemetry-emval.js','utf8');
const html = `<!doctype html><html><body><button id="go">go</button>
<script src="https://elements.stytch.com/telemetry.js"></script>
<script>
window.__m=null;window.__res=null;
document.getElementById('go').onclick=async()=>{
 try{const m=await window.telemetryjs();window.__m=m;await m.Ready;m.rids=[];let r=null;
  const ret=await m.GetTID({a:'public-token-test',b:'http://127.0.0.1:8819/submit',c:'UNKNOWN',d:(v)=>{r=v;}});
  window.__res={ret,r};
 }catch(e){window.__res={err:String(e),stack:e&&e.stack};}
};
</script></body></html>`;
const server=createServer((q,r)=>{r.writeHead(200,{'content-type':'text/html'});r.end(html);});
await new Promise(r=>server.listen(8819,'127.0.0.1',r));

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
})();`;

const b=await chromium.launch({headless:true});
const ctx=await b.newContext();
await ctx.addInitScript({content:INIT});
const p=await ctx.newPage();
await p.route('**/telemetry.js',r=>r.fulfill({status:200,contentType:'application/javascript',body:src}));
await p.route('**/submit',r=>r.fulfill({status:200,contentType:'text/plain',body:'00000000-0000-4000-8000-000000000000'}));
await p.route('**/errors',r=>r.fulfill({status:200,contentType:'text/plain',body:'ok'}));
await p.goto('http://127.0.0.1:8819/',{waitUntil:'load'});
await p.waitForFunction(()=>typeof window.telemetryjs==='function',{timeout:15000}).catch(()=>{});
await p.click('#go');
await p.waitForTimeout(18000);
const emval=await p.evaluate(()=>window.__emval).catch(()=>null);
const res=await p.evaluate(()=>window.__res).catch(()=>null);
mkdirSync('/tmp/opencode/stytch',{recursive:true});
writeFileSync('/tmp/opencode/stytch/emval.json',JSON.stringify({res,emval},null,2));
console.log('res',JSON.stringify(res));
console.log('emval entries',emval&&emval.length);
for(const e of (emval||[])) console.log(JSON.stringify(e));
await b.close();server.close();
