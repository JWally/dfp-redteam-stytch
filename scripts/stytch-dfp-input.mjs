#!/usr/bin/env node
/**
 * stytch-dfp-input.mjs — capture the COMPLETE ordered "input stream" the C++
 * wasm2js collector pulls from the browser: every JS API it calls, the args,
 * the returned values, and how it lands in HEAPU8. Marker values label each
 * signal. Local submit URL; nothing sent to Stytch.
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
  const ret=await m.GetTID({a:'public-token-test',b:'http://127.0.0.1:8820/submit',c:'UNKNOWN',d:(v)=>{r=v;}});
  window.__res={ret,r};
 }catch(e){window.__res={err:String(e),stack:e&&e.stack};}
};
</script></body></html>`;
const server=createServer((q,r)=>{r.writeHead(200,{'content-type':'text/html'});r.end(html);});
await new Promise(r=>server.listen(8820,'127.0.0.1',r));

const MK={ua:'MARKERUA31337QQQ',platform:'MARKERPLATFORM31337',w:31337,h:41337,aw:31338,ah:41338,depth:33,hc:47,dm:79,mt:97};
const INIT=`(() => {
  const W=window, MK=${JSON.stringify(MK)}, ev=[];
  const t0=performance.now();
  const push=(e)=>{try{ev.push({ms:Math.round((performance.now()-t0)*10)/10,...e});}catch(_){}};
  const str=(v,n=300)=>{try{if(typeof v==='string')return v.slice(0,n);if(typeof v==='number'||typeof v==='boolean')return String(v);if(v===undefined)return 'undefined';if(v===null)return 'null';if(typeof v==='object'){const s=JSON.stringify(v);return (s||Object.prototype.toString.call(v)).slice(0,n);}return String(v).slice(0,n);}catch(_){return String(v);}};
  const def=(p,k,label)=>{try{Object.defineProperty(p,k,{configurable:true,get:function(){const v=Reflect.get(Object.getOwnPropertyDescriptor(p,k).get? p: (Object.getPrototypeOf(this)||{}), k) ; /* placeholder */}});}catch(e){}};
  // Simpler & safe: wrap existing getters by re-defining with capture
  const navGet=(k,fake)=>{const d=Object.getOwnPropertyDescriptor(Navigator.prototype,k);if(!d||typeof d.get!=='function')return;Object.defineProperty(Navigator.prototype,k,{configurable:true,get(){const v=fake!==undefined?fake:d.get.call(this);push({t:'navigator.'+k,v:str(v)});return v;}});};
  const scrGet=(k,fake)=>{const d=Object.getOwnPropertyDescriptor(Screen.prototype,k);if(!d||typeof d.get!=='function')return;Object.defineProperty(Screen.prototype,k,{configurable:true,get(){const v=fake!==undefined?fake:d.get.call(this);push({t:'screen.'+k,v:str(v)});return v;}});};
  navGet('userAgent',MK.ua);navGet('appVersion',MK.ua);navGet('platform',MK.platform);
  navGet('hardwareConcurrency',MK.hc);navGet('deviceMemory',MK.dm);navGet('maxTouchPoints',MK.mt);
  navGet('cookieEnabled');navGet('language');navGet('languages');navGet('vendor');navGet('vendorSub');
  navGet('product');navGet('productSub');navGet('appCodeName');navGet('appName');navGet('onLine');
  navGet('pdfViewerEnabled');navGet('doNotTrack');navGet('webdriver');
  scrGet('width',MK.w);scrGet('height',MK.h);scrGet('availWidth',MK.aw);scrGet('availHeight',MK.ah);
  scrGet('colorDepth',MK.depth);scrGet('pixelDepth',MK.depth);scrGet('devicePixelRatio');scrGet('orientation');

  const wrap=(proto,names,label)=>{for(const n of names){const d=Object.getOwnPropertyDescriptor(proto,n);if(!d||typeof d.value!=='function')continue;Object.defineProperty(proto,n,{configurable:true,value:function(...a){const ret=d.value.apply(this,a);push({t:label+'.'+n,args:str(a).slice(0,200),ret:str(ret)});return ret;}});}};
  wrap(HTMLCanvasElement.prototype,['getContext','toDataURL','toBlob','toDataURL'],'canvas');
  wrap(CanvasRenderingContext2D.prototype,['getImageData','measureText','fillText','strokeText','getLineDash','createLinearGradient'],'ctx2d');
  wrap(WebGLRenderingContext.prototype,['getParameter','getExtension','readPixels','getShaderPrecisionFormat','getSupportedExtensions','getContextAttributes','getProgramInfoLog','getShaderInfoLog'],'webgl');
  wrap(AudioContext&&AudioContext.prototype,['createOscillator','createAnalyser','createBuffer','createDynamicsCompressor'],'audioctx');
  wrap(Intl.DateTimeFormat.prototype,['resolvedOptions','format'],'intl');

  // AudioContext construction
  const oAC=W.OfflineAudioContext, oACr=W.AudioContext;
  if(oAC){W.OfflineAudioContext=function(...a){push({t:'new OfflineAudioContext',args:str(a)});return new oAC(...a);};W.OfflineAudioContext.prototype=oAC.prototype;}
  if(oACr){W.AudioContext=function(...a){push({t:'new AudioContext',args:str(a)});return new oACr(...a);};W.AudioContext.prototype=oACr.prototype;}

  // getRandomValues (seeds/nonce)
  const oGRV=crypto.getRandomValues; crypto.getRandomValues=function(a){const v=oGRV.call(crypto,a);push({t:'crypto.getRandomValues',len:a.length,vals:Array.from(a).slice(0,8)});return v;};

  // fetch / submit
  const oFetch=W.fetch; W.fetch=function(input,init){push({t:'fetch',url:str(input),method:init&&init.method,bodyLen:init&&typeof init.body==='string'?init.body.length:null});return oFetch.apply(this,arguments);};

  // element creation
  const oCE=document.createElement.bind(document); document.createElement=function(t,...a){const el=oCE(t,...a);push({t:'createElement',tag:String(t)});return el;};
  const oGI=document.getElementById.bind(document); document.getElementById=function(id){push({t:'getElementById',id:String(id)});return oGI(id);};

  W.__ev=ev;
})();`;

const b=await chromium.launch({headless:true});
const ctx=await b.newContext();
await ctx.addInitScript({content:INIT});
const p=await ctx.newPage();
const subs=[];
await p.route('**/submit',async r=>{const q=r.request();const buf=q.postDataBuffer();subs.push(buf);await r.fulfill({status:200,contentType:'text/plain',body:'00000000-0000-4000-8000-000000000000'});});
await p.route('**/errors',r=>r.fulfill({status:200,contentType:'text/plain',body:'ok'}));
await p.goto('http://127.0.0.1:8820/',{waitUntil:'load'});
await p.waitForFunction(()=>typeof window.telemetryjs==='function',{timeout:15000}).catch(()=>{});
await p.click('#go');
await p.waitForTimeout(18000);
const ev=await p.evaluate(()=>window.__ev).catch(()=>null);
const res=await p.evaluate(()=>window.__res).catch(()=>null);
mkdirSync('/tmp/opencode/stytch',{recursive:true});
writeFileSync('/tmp/opencode/stytch/input-stream.json',JSON.stringify({res,subs:(subs||[]).map(s=>s.length),ev},null,2));
console.log('res',JSON.stringify(res));
console.log('submit lengths',(subs||[]).map(s=>s.length));
console.log('events',ev&&ev.length);
for(const e of (ev||[])) console.log(JSON.stringify(e));
await b.close();server.close();
