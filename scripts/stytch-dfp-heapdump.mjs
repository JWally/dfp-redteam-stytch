#!/usr/bin/env node
/** Catch the Stytch DFP module heap at the fetch boundary and scan for plaintext. */
import { chromium } from 'playwright';
import { createServer } from 'node:http';
import { writeFileSync, mkdirSync } from 'node:fs';

const html = `<!doctype html><html><head><meta charset="utf-8"></head><body><button id="go">go</button>
<script src="https://elements.stytch.com/telemetry.js"></script>
<script>
window.__stModule=null;
const _origT = window.telemetryjs;
window.telemetryjs = function(...a){
  const r = _origT.apply(this,a);
  if (r && typeof r.then === 'function') return r.then(m => { window.__stModule = m; return m; });
  window.__stModule = r; return r;
};
window.__stResult=null;
document.getElementById('go').onclick=()=>{GetTelemetryID({publicToken:'public-token-test',submitURL:'http://127.0.0.1:8808/submit'}).then(id=>window.__stResult={ok:id}).catch(e=>window.__stResult={err:String(e)});};
</script></body></html>`;
const server = createServer((q,r)=>{r.writeHead(200,{'content-type':'text/html'});r.end(html);});
await new Promise(r=>server.listen(8808,'127.0.0.1',r));

const INIT = `(() => {
  const W=window;
  const oFetch=W.fetch;
  W.__heap=null;
  const kw=/Mozilla|Linux|Windows|Macintosh|platform|userAgent|screen|width|height|timezone|America|Europe|Asia|canvas|webgl|WebGL|SwiftShader|ANGLE|Google Inc|audio|OfflineAudioContext|hardwareConcurrency|deviceMemory|maxTouchPoints|colorDepth|pixelDepth|devicePixelRatio|fingerprint|visitor|hardware|network|public-token|submit|GetTID|rids|challenge|verdict|ALLOW|BLOCK|tamper|headless/i;
  const scan=(m) => {
    try {
      const h=m && m.HEAPU8;
      if(!h) return {err:'no HEAPU8'};
      const txt=new TextDecoder('latin1').decode(h);
      const re=/[\\x20-\\x7e]{4,}/g; let mm; const hits=[]; const all=[];
      while((mm=re.exec(txt)) && all.length<20000){
        const s=mm[0];
        if(s.length>6) all.push(s);
        if(kw.test(s)){ const i=mm.index; hits.push({at:i,s:s.slice(0,300),ctx:txt.slice(Math.max(0,i-160),i+400)}); if(hits.length>400) break; }
      }
      const u16=[]; const re16=/(?:[\\x20-\\x7e]\\x00){4,}/g; let m16;
      while((m16=re16.exec(txt)) && u16.length<2000){ const s=m16[0].replace(/\\x00/g,''); if(kw.test(s)) u16.push({at:m16.index,s:s.slice(0,200)}); }
      return {len:h.length, hits, u16, sample:all.slice(0,300)};
    } catch(e){ return {err:String(e)}; }
  };
  W.fetch=function(input,init){
    try{
      const u=typeof input==='string'?input:(input&&input.url)||'';
      if(/\\/submit/.test(u)){
        W.__heap={url:u, at:Date.now(), module:W.__stModule?true:false, scan:W.__stModule?scan(W.__stModule):null, body:init&&typeof init.body==='string'?init.body.slice(0,4000):null};
      }
    }catch(e){ W.__heap={err:String(e)}; }
    return oFetch.apply(this,arguments);
  };
})();`;

const b=await chromium.launch({headless:true});const ctx=await b.newContext();await ctx.addInitScript({content:INIT});const p=await ctx.newPage();
await p.route('**/submit', async r=>{const q=r.request();const buf=q.postDataBuffer();if(!(await p.evaluate(()=>window.__heap))){/* noop */} await r.fulfill({status:200,contentType:'text/plain',body:'00000000-0000-4000-8000-000000000000'});});
await p.route('**/errors', r=>r.fulfill({status:200,contentType:'text/plain',body:'ok'}));
await p.goto('http://127.0.0.1:8808/',{waitUntil:'load'});
await p.waitForFunction(()=>typeof window.GetTelemetryID==='function',{timeout:15000}).catch(()=>{});
await p.click('#go'); await p.waitForTimeout(12000);
const heap=await p.evaluate(()=>window.__heap).catch(()=>null);
const res=await p.evaluate(()=>window.__stResult).catch(()=>null);
mkdirSync('/tmp/opencode/stytch',{recursive:true});
writeFileSync('/tmp/opencode/stytch/heap.json',JSON.stringify({heap,res},null,2));
console.log('result',JSON.stringify(res));
console.log('heap module?',heap&&heap.module,'scan keys',heap&&heap.scan&&Object.keys(heap.scan));
if(heap&&heap.scan){ console.log('hits',heap.scan.hits&&heap.scan.hits.length,'u16',heap.scan.u16&&heap.scan.u16.length); for(const h of (heap.scan.hits||[]).slice(0,40)) console.log(' HIT',h.s); for(const h of (heap.scan.u16||[]).slice(0,20)) console.log(' U16',h.s); console.log('sample',JSON.stringify((heap.scan.sample||[]).slice(0,60))); }
await b.close();server.close();
