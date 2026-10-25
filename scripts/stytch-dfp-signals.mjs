#!/usr/bin/env node
/** Hook the JS APIs the Stytch DFP wasm2js module touches. */
import { chromium } from 'playwright';
import { createServer } from 'node:http';
import { readFileSync } from 'node:fs';

const html = `<!doctype html><html><head><meta charset="utf-8"></head><body><button id="go">go</button>
<script src="https://elements.stytch.com/telemetry.js"></script>
<script>
window.__stResult=null;
document.getElementById('go').onclick=()=>{GetTelemetryID({publicToken:'public-token-test',submitURL:'http://127.0.0.1:8806/submit'}).then(id=>window.__stResult={ok:id}).catch(e=>window.__stResult={err:String(e)});};
</script></body></html>`;
const server = createServer((req,res)=>{res.writeHead(200,{'content-type':'text/html'});res.end(html);});
await new Promise(r=>server.listen(8806,'127.0.0.1',r));

const INIT = `(() => {
  const W=window,S=W.__sig={navigator:[],screen:[],canvas:[],webgl:[],audio:[],intl:[],misc:[],fetch:[],elements:[],random:[],b64:[]};
  const cap=(a,o,n=200)=>{if(a.length<n)a.push(o);};
  const logNav=(p)=>{try{const d=Object.getOwnPropertyDescriptor(Navigator.prototype,p);if(d&&d.get){Object.defineProperty(Navigator.prototype,p,{configurable:true,get(){const v=d.get.call(this);cap(S.navigator,{p,v:typeof v==='object'?JSON.stringify(v).slice(0,120):String(v)},300);return v;}});}}catch(e){}};
  ['userAgent','appVersion','platform','vendor','vendorSub','product','productSub','language','languages','hardwareConcurrency','deviceMemory','maxTouchPoints','webdriver','cookieEnabled','doNotTrack','pdfViewerEnabled','plugins','mimeTypes'].forEach(logNav);
  const logScr=(p)=>{try{const d=Object.getOwnPropertyDescriptor(Screen.prototype,p);if(d&&d.get){Object.defineProperty(Screen.prototype,p,{configurable:true,get(){const v=d.get.call(this);cap(S.screen,{p,v:String(v)},100);return v;}});}}catch(e){}};
  ['width','height','availWidth','availHeight','colorDepth','pixelDepth','orientation'].forEach(logScr);
  const oGC=HTMLCanvasElement.prototype.getContext; HTMLCanvasElement.prototype.getContext=function(t,...a){try{cap(S.canvas,{op:'getContext',t});}catch(e){} return oGC.call(this,t,...a);};
  const oTD=HTMLCanvasElement.prototype.toDataURL; HTMLCanvasElement.prototype.toDataURL=function(...a){const v=oTD.apply(this,a);try{cap(S.canvas,{op:'toDataURL',len:v.length,prefix:v.slice(0,80)});}catch(e){} return v;};
  const oGI=CanvasRenderingContext2D.prototype.getImageData; CanvasRenderingContext2D.prototype.getImageData=function(...a){try{cap(S.canvas,{op:'getImageData',w:a[2],h:a[3]});}catch(e){} return oGI.apply(this,a);};
  const oMT=CanvasRenderingContext2D.prototype.measureText; CanvasRenderingContext2D.prototype.measureText=function(t){const v=oMT.call(this,t);try{cap(S.canvas,{op:'measureText',t:String(t).slice(0,80)});}catch(e){} return v;};
  const oGP=WebGLRenderingContext.prototype.getParameter; WebGLRenderingContext.prototype.getParameter=function(p){const v=oGP.call(this,p);try{cap(S.webgl,{op:'getParameter',p,out:typeof v==='string'?v.slice(0,120):String(v)});}catch(e){} return v;};
  const oGE=WebGLRenderingContext.prototype.getExtension; WebGLRenderingContext.prototype.getExtension=function(n){try{cap(S.webgl,{op:'getExtension',n:String(n)});}catch(e){} return oGE.call(this,n);};
  const oRP=WebGLRenderingContext.prototype.readPixels; WebGLRenderingContext.prototype.readPixels=function(...a){try{cap(S.webgl,{op:'readPixels',w:a[2],h:a[3]});}catch(e){} return oRP.apply(this,a);};
  for(const C of ['AudioContext','OfflineAudioContext','webkitAudioContext']){const O=W[C];if(O){W[C]=function(...a){try{cap(S.audio,{op:C,args:a.slice(0,3)});}catch(e){} return new O(...a);};}}
  const oDTF=Intl.DateTimeFormat; W.Intl.DateTimeFormat=function(...a){try{cap(S.intl,{op:'DateTimeFormat',args:a.slice(0,2)});}catch(e){} return new oDTF(...a);};
  const oRes=Intl.DateTimeFormat.prototype.resolvedOptions; Intl.DateTimeFormat.prototype.resolvedOptions=function(){const v=oRes.call(this);try{cap(S.intl,{op:'resolvedOptions',v:JSON.stringify(v).slice(0,200)});}catch(e){} return v;};
  const oPerm=navigator.permissions&&navigator.permissions.query; if(oPerm){navigator.permissions.query=function(d){try{cap(S.misc,{op:'permissions.query',d:String(d&&d.name)});}catch(e){} return oPerm.call(navigator.permissions,d);};}
  const oFonts=document.fonts&&document.fonts.check; if(oFonts){document.fonts.check=function(...a){try{cap(S.misc,{op:'fonts.check',args:a.slice(0,2)});}catch(e){} return oFonts.apply(document.fonts,a);};}
  const oRTC=W.RTCPeerConnection; if(oRTC){W.RTCPeerConnection=function(...a){try{cap(S.misc,{op:'RTCPeerConnection'});}catch(e){} return new oRTC(...a);};}
  const oGRV=crypto.getRandomValues; crypto.getRandomValues=function(a){try{cap(S.random,{len:a&&a.length});}catch(e){} return oGRV.call(crypto,a);};
  const oBtoa=W.btoa, oAtob=W.atob; W.btoa=function(s){const v=oBtoa.call(this,s);try{cap(S.b64,{op:'btoa',inLen:String(s).length,outLen:v.length});}catch(e){} return v;}; W.atob=function(s){const v=oAtob.call(this,s);try{cap(S.b64,{op:'atob',inLen:String(s).length,outLen:v.length});}catch(e){} return v;};
  const oCreate=document.createElement.bind(document); document.createElement=function(t,...a){const el=oCreate(t,...a);try{cap(S.elements,{tag:t});}catch(e){} return el;};
  const oFetch=W.fetch; W.fetch=function(input,init){try{const u=typeof input==='string'?input:(input&&input.url)||'';cap(S.fetch,{url:u,method:(init&&init.method)||'GET',bodyLen:init&&typeof init.body==='string'?init.body.length:null});}catch(e){} return oFetch.apply(this,arguments);};
})();`;

const b=await chromium.launch({headless:true});const ctx=await b.newContext();await ctx.addInitScript({content:INIT});const page=await ctx.newPage();
const submits=[];
await page.route('**/submit', async r=>{const q=r.request();const buf=q.postDataBuffer();submits.push({len:buf?buf.length:0,b64:buf?buf.toString('base64'):''});await r.fulfill({status:200,contentType:'text/plain',body:'00000000-0000-4000-8000-000000000000'});});
await page.route('**/errors', r=>r.fulfill({status:200,contentType:'text/plain',body:'ok'}));
await page.goto('http://127.0.0.1:8806/',{waitUntil:'load'});
await page.waitForFunction(()=>typeof window.GetTelemetryID==='function',{timeout:15000}).catch(()=>{});
await page.click('#go'); await page.waitForTimeout(15000);
const res=await page.evaluate(()=>window.__stResult).catch(()=>null);
const sig=await page.evaluate(()=>window.__sig).catch(()=>null);
const mod=await page.evaluate(async()=>{try{const m=await window.telemetryjs();const keys=Object.keys(m).filter(k=>/HEAP|memory|asm|wasm|GetTID|GetPID/i.test(k));let mem=null;try{const h=m.HEAPU8||(m.wasmMemory&&new Uint8Array(m.wasmMemory.buffer));if(h){const str=[];const re=/[\x20-\x7e]{5,}/g;const s=Buffer.from?null:null;const txt=new TextDecoder('latin1').decode(h);let mm;while((mm=re.exec(txt))&&str.length<500)str.push(mm[0]);mem={len:h.length,strings:str};}}catch(e){} return {keys,mem};}catch(e){return {err:String(e)}}});
console.log('result',JSON.stringify(res));console.log('submit',submits.map(s=>({len:s.len})));
for(const k of Object.keys(sig||{})) console.log(k, sig[k].length, JSON.stringify(sig[k].slice(0,6)).slice(0,500));
console.log('module',JSON.stringify(mod).slice(0,2000));
await b.close();server.close();
