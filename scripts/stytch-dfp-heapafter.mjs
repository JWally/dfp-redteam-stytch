#!/usr/bin/env node
/**
 * stytch-dfp-heapafter.mjs — dump the wasm2js linear memory immediately after
 * each signal-collection API fires, so the C++-stored plaintext (length-prefixed
 * strings) is captured BEFORE compression/encryption.
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
  const ret=await m.GetTID({a:'public-token-test',b:'http://127.0.0.1:8818/submit',c:'UNKNOWN',d:(v)=>{r=v;}});
  window.__res={ret,r};
 }catch(e){window.__res={err:String(e),stack:e&&e.stack};}
};
</script></body></html>`;
const server = createServer((q,r)=>{r.writeHead(200,{'content-type':'text/html'});r.end(html);});
await new Promise(r=>server.listen(8818,'127.0.0.1',r));

const MK = { ua:'MARKERUA31337QQQ', platform:'MARKERPLATFORM31337', w:31337, h:41337, aw:31338, ah:41338, depth:33, hc:47, dm:79, mt:97, canvas:'MARKERCANVAS_CAFEBABE', vg:'MARKERVENDOR_CAFE', gr:'MARKERRENDERER_BABE' };

const INIT = `(() => {
  const W=window, MK=${JSON.stringify(MK)};
  const dumps=[];
  const b64=(u8)=>{const CH=8192,p=[];for(let i=0;i<u8.length;i+=CH)p.push(String.fromCharCode.apply(null,u8.subarray(i,i+CH)));return btoa(p.join(''));};
  const save=(tag)=>{try{
    if(!W.__m||!W.__m.HEAPU8)return;
    if(dumps.length>=14)return;
    const h=W.__m.HEAPU8;
    dumps.push({tag,at:Date.now(),b64:b64(h)});
  }catch(e){}};
  W.__dumps=dumps;

  const def=(p,k,g)=>{try{Object.defineProperty(p,k,{configurable:true,get:function(){const v=g.call(this);save(k);return v;}});}catch(e){}};
  def(Navigator.prototype,'userAgent',()=>MK.ua);
  def(Navigator.prototype,'appVersion',()=>MK.ua);
  def(Navigator.prototype,'platform',()=>MK.platform);
  def(Navigator.prototype,'hardwareConcurrency',()=>MK.hc);
  def(Navigator.prototype,'deviceMemory',()=>MK.dm);
  def(Navigator.prototype,'maxTouchPoints',()=>MK.mt);
  def(Screen.prototype,'width',()=>MK.w);
  def(Screen.prototype,'height',()=>MK.h);
  def(Screen.prototype,'availWidth',()=>MK.aw);
  def(Screen.prototype,'availHeight',()=>MK.ah);
  def(Screen.prototype,'colorDepth',()=>MK.depth);
  def(Screen.prototype,'pixelDepth',()=>MK.depth);

  const oTD=HTMLCanvasElement.prototype.toDataURL;
  HTMLCanvasElement.prototype.toDataURL=function(...a){const v=oTD.apply(this,a);save('toDataURL');return v;};
  const oGI=CanvasRenderingContext2D.prototype.getImageData;
  CanvasRenderingContext2D.prototype.getImageData=function(...a){const v=oGI.apply(this,a);save('getImageData');return v;};
  const oMT=CanvasRenderingContext2D.prototype.measureText;
  CanvasRenderingContext2D.prototype.measureText=function(t){const v=oMT.apply(this,t);save('measureText');return v;};
  const oGP=WebGLRenderingContext.prototype.getParameter;
  WebGLRenderingContext.prototype.getParameter=function(p){const v=oGP.apply(this,arguments);save('getParameter');return v;};
  const oRP=WebGLRenderingContext.prototype.readPixels;
  WebGLRenderingContext.prototype.readPixels=function(...a){const v=oRP.apply(this,arguments);save('readPixels');return v;};
  const oAC=W.OfflineAudioContext; W.OfflineAudioContext=function(...a){const v=new oAC(...a);save('OfflineAudioContext');return v;};
  const oGRV=crypto.getRandomValues; crypto.getRandomValues=function(a){save('grv-pre');const v=oGRV.call(crypto,a);save('grv-post');return v;};
  const oFetch=W.fetch; W.fetch=function(input,init){save('fetch');return oFetch.apply(this,arguments);};
})();`;

const b=await chromium.launch({headless:true});
const ctx=await b.newContext();
await ctx.addInitScript({content:INIT});
const p=await ctx.newPage();
await p.route('**/submit',r=>r.fulfill({status:200,contentType:'text/plain',body:'00000000-0000-4000-8000-000000000000'}));
await p.route('**/errors',r=>r.fulfill({status:200,contentType:'text/plain',body:'ok'}));
await p.goto('http://127.0.0.1:8818/',{waitUntil:'load'});
await p.waitForFunction(()=>typeof window.telemetryjs==='function',{timeout:15000}).catch(()=>{});
await p.click('#go');
await p.waitForTimeout(15000);
const dumps=await p.evaluate(()=>window.__dumps).catch(()=>null);
const res=await p.evaluate(()=>window.__res).catch(()=>null);
mkdirSync('/tmp/opencode/stytch/heaps',{recursive:true});
for(const d of (dumps||[])) writeFileSync(`/tmp/opencode/stytch/heaps/after-${d.tag}-${d.at}.bin`,Buffer.from(d.b64,'base64'));
writeFileSync('/tmp/opencode/stytch/heaps/after-meta.json',JSON.stringify({res,dumps:(dumps||[]).map(d=>({tag:d.tag,at:d.at,len:d.b64.length}))},null,2));
console.log('res',JSON.stringify(res));
console.log('dumps',(dumps||[]).map(d=>d.tag+'@'+d.at).join('\n'));
await b.close();
server.close();
