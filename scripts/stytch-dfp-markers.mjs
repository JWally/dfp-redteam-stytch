#!/usr/bin/env node
/** Marker-based heap hunt: unique UA/platform/screen/canvas/WebGL values,
 *  scan HEAPU8 at every getRandomValues + fetch. */
import { chromium } from 'playwright';
import { createServer } from 'node:http';
import { writeFileSync, mkdirSync } from 'node:fs';

const html = `<!doctype html><html><head><meta charset="utf-8"></head><body><button id="go">go</button>
<script src="https://elements.stytch.com/telemetry.js"></script>
<script>
window.__stResult=null; window.__m=null; window.__hits=[]; window.__body=null; window.__iframes=[];
document.getElementById('go').onclick=async()=>{
  try{
    const m=await window.telemetryjs(); window.__m=m; await m.Ready; m.rids=[];
    let resolved=null;
    const r=await m.GetTID({a:'public-token-test', b:'http://127.0.0.1:8811/submit', c:'UNKNOWN', d:(v)=>{resolved=v;}});
    window.__stResult={ret:r,resolved};
  }catch(e){window.__stResult={err:String(e),stack:e&&e.stack};}
  try{ window.__iframes=[...document.querySelectorAll('iframe')].map(f=>({src:f.src,srcdoc:(f.srcdoc||'').slice(0,300),hasWin:!!f.contentWindow,keys:f.contentWindow?Object.keys(f.contentWindow).filter(k=>/HEAP|telemetry|wasm|Module/i.test(k)).slice(0,20):[]})); }catch(e){}
};
</script></body></html>`;
const server=createServer((q,r)=>{r.writeHead(200,{'content-type':'text/html'});r.end(html);});
await new Promise(r=>server.listen(8811,'127.0.0.1',r));

const MARK = {
  ua: 'MARKERUA_ABC123_XYZ789',
  platform: 'MARKERPLATFORM_QQQ',
  screenW: 12345, screenH: 54321,
  canvas: 'MARKERCANVAS_DEADBEEF',
  webglVendor: 'MARKERVENDOR_CAFE',
  webglRenderer: 'MARKERRENDERER_BABE',
};
const INIT = `(() => {
  const W=window;
  const MK=${JSON.stringify(MARK)};
  const def=(proto,prop,get)=>{try{Object.defineProperty(proto,prop,{configurable:true,get});}catch(e){}};
  def(Navigator.prototype,'userAgent',()=>MK.ua);
  def(Navigator.prototype,'appVersion',()=>MK.ua);
  def(Navigator.prototype,'platform',()=>MK.platform);
  def(Navigator.prototype,'hardwareConcurrency',()=>42);
  def(Navigator.prototype,'deviceMemory',()=>77);
  def(Navigator.prototype,'maxTouchPoints',()=>9);
  def(Screen.prototype,'width',()=>MK.screenW);
  def(Screen.prototype,'height',()=>MK.screenH);
  def(Screen.prototype,'availWidth',()=>MK.screenW-1);
  def(Screen.prototype,'availHeight',()=>MK.screenH-1);
  def(Screen.prototype,'colorDepth',()=>33);
  def(Screen.prototype,'pixelDepth',()=>33);
  const oTD=HTMLCanvasElement.prototype.toDataURL;
  HTMLCanvasElement.prototype.toDataURL=function(...a){ try{ return 'data:image/png;base64,'+btoa(MK.canvas); }catch(e){ return oTD.apply(this,a); } };
  const oGI=CanvasRenderingContext2D.prototype.getImageData;
  CanvasRenderingContext2D.prototype.getImageData=function(x,y,w,h){ const v=oGI.call(this,x,y,w,h); try{ const s=new TextEncoder().encode(MK.canvas); v.data.set(s.subarray(0,Math.min(s.length,v.data.length))); }catch(e){} return v; };
  const oGP=WebGLRenderingContext.prototype.getParameter;
  WebGLRenderingContext.prototype.getParameter=function(p){ if(p===37445) return MK.webglVendor; if(p===37446) return MK.webglRenderer; return oGP.call(this,p); };
  const oRP=WebGLRenderingContext.prototype.readPixels;
  WebGLRenderingContext.prototype.readPixels=function(x,y,w,h,fmt,type,px){ try{ const s=new TextEncoder().encode(MK.canvas); new Uint8Array(px.buffer||px).set(s.subarray(0,Math.min(s.length,px.length||s.length))); }catch(e){} return oRP.apply(this,arguments); };

  const scan=(m,where)=>{
    try{
      if(!m||!m.HEAPU8) return;
      const h=m.HEAPU8; const txt=new TextDecoder('latin1').decode(h);
      const markers=[MK.ua,MK.platform,MK.canvas,MK.webglVendor,MK.webglRenderer,String(MK.screenW),String(MK.screenH)];
      for(const mk of markers){
        let i=txt.indexOf(mk);
        while(i!==-1 && W.__hits.length<200){
          W.__hits.push({where,mk,at:i,ctx:txt.slice(Math.max(0,i-300),i+500)});
          i=txt.indexOf(mk,i+mk.length);
        }
      }
    }catch(e){ W.__hits.push({where,err:String(e)}); }
  };
  const oGRV=crypto.getRandomValues;
  crypto.getRandomValues=function(a){ try{ scan(W.__m,'pre-getRandomValues'); }catch(e){} const v=oGRV.call(crypto,a); try{ scan(W.__m,'post-getRandomValues'); }catch(e){} return v; };
  const oFetch=W.fetch;
  W.fetch=function(input,init){ try{ if(String(input).includes('/submit')){ scan(W.__m,'fetch'); if(init&&typeof init.body==='string') W.__body=init.body.slice(0,4000); } }catch(e){} return oFetch.apply(this,arguments); };
})();`;

const b=await chromium.launch({headless:true});const ctx=await b.newContext();await ctx.addInitScript({content:INIT});const p=await ctx.newPage();
await p.route('**/submit', r=>r.fulfill({status:200,contentType:'text/plain',body:'00000000-0000-4000-8000-000000000000'}));
await p.route('**/errors', r=>r.fulfill({status:200,contentType:'text/plain',body:'ok'}));
await p.goto('http://127.0.0.1:8811/',{waitUntil:'load'});
await p.waitForFunction(()=>typeof window.telemetryjs==='function',{timeout:15000}).catch(()=>{});
await p.click('#go'); await p.waitForTimeout(15000);
const out=await p.evaluate(()=>({res:window.__stResult,hits:window.__hits,body:window.__body,iframes:window.__iframes})).catch(()=>null);
mkdirSync('/tmp/opencode/stytch',{recursive:true}); writeFileSync('/tmp/opencode/stytch/markers.json',JSON.stringify(out,null,2));
console.log('result',JSON.stringify(out&&out.res));
console.log('hits',out&&out.hits&&out.hits.length);
for(const h of (out&&out.hits||[]).slice(0,30)) console.log(' HIT',h.where,h.mk,'@',h.at,JSON.stringify(h.ctx||h.err).slice(0,600));
console.log('bodyLen',out&&out.body&&out.body.length,'head',out&&out.body&&out.body.slice(0,40));
console.log('iframes',JSON.stringify(out&&out.iframes));
await b.close();server.close();
