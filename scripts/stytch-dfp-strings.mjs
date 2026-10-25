#!/usr/bin/env node
/** Patch telemetry.js to log Emscripten std::string JS->C++ and C++->JS conversions. */
import { chromium } from 'playwright';
import { createServer } from 'node:http';
import { readFileSync, writeFileSync, mkdirSync } from 'node:fs';
const src=readFileSync('/tmp/opencode/st-telemetry-patched.js','utf8');
const html=`<!doctype html><html><body><button id="go">go</button>
<script src="https://elements.stytch.com/telemetry.js"></script>
<script>
window.__m=null;window.__stStrings=[];window.__stOut=[];window.__res=null;window.__body=null;
document.getElementById('go').onclick=async()=>{
 try{const m=await window.telemetryjs();window.__m=m;await m.Ready;m.rids=[];let r=null;
  const ret=await m.GetTID({a:'public-token-test',b:'http://127.0.0.1:8815/submit',c:'UNKNOWN',d:(v)=>{r=v;}});
  window.__res={ret,r};
 }catch(e){window.__res={err:String(e),stack:e&&e.stack};}
};
</script></body></html>`;
const server=createServer((q,r)=>{r.writeHead(200,{'content-type':'text/html'});r.end(html);});
await new Promise(r=>server.listen(8815,'127.0.0.1',r));
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
 const oFetch=W.fetch;W.fetch=function(input,init){try{if(String(input).includes('/submit')&&init&&typeof init.body==='string')W.__body=init.body;}catch(e){}return oFetch.apply(this,arguments);};
})();`;
const b=await chromium.launch({headless:true});const ctx=await b.newContext();await ctx.addInitScript({content:INIT});const p=await ctx.newPage();
await p.route('**/telemetry.js',r=>r.fulfill({status:200,contentType:'application/javascript',body:src}));
await p.route('**/submit',r=>r.fulfill({status:200,contentType:'text/plain',body:'00000000-0000-4000-8000-000000000000'}));
await p.route('**/errors',r=>r.fulfill({status:200,contentType:'text/plain',body:'ok'}));
await p.goto('http://127.0.0.1:8815/',{waitUntil:'load'});await p.waitForFunction(()=>typeof window.telemetryjs==='function',{timeout:15000}).catch(()=>{});
await p.click('#go');await p.waitForTimeout(15000);
const out=await p.evaluate(()=>({res:window.__res,body:window.__body,strings:window.__stStrings,outs:window.__stOut})).catch(()=>null);
mkdirSync('/tmp/opencode/stytch',{recursive:true});writeFileSync('/tmp/opencode/stytch/strings.json',JSON.stringify(out,null,2));
console.log('res',JSON.stringify(out&&out.res),'bodyLen',out&&out.body&&out.body.length);
const ss=(out&&out.strings||[]), oo=(out&&out.outs||[]);
console.log('js->c++ count',ss.length,'c++->js count',oo.length);
const uniq=(arr)=>[...new Set(arr.filter(Boolean))];
const sU=uniq(ss.map(x=>x.s)), oU=uniq(oo);
console.log('\nJS->C++ unique',sU.length);
for(const s of sU.filter(x=>/MARKER|userAgent|platform|screen|canvas|webgl|WebGL|SwiftShader|ANGLE|Google|timezone|America|canvas|data:image|UA|Linux|hardware|deviceMemory|touch/i.test(x)).slice(0,80)) console.log('  ',JSON.stringify(s).slice(0,300));
console.log('\nC++->JS unique',oU.length);
for(const s of oU.filter(x=>/^(userAgent|appVersion|platform|screen|width|height|avail|colorDepth|pixelDepth|devicePixelRatio|navigator|document|window|canvas|webgl|WebGL|getContext|toDataURL|getParameter|readPixels|getImageData|measureText|font|timezone|Intl|audio|OfflineAudioContext|fetch|POST|submit|userAgentData|hardwareConcurrency|deviceMemory|maxTouchPoints|language|vendor|plugins|mimeTypes|permissions|battery|RTCPeer|location|href|origin|referrer|public-token|rids|GetTID)$/i.test(s)).sort().slice(0,200)) console.log('  ',JSON.stringify(s));
console.log('\nlong/jsout samples',oU.filter(x=>x.length>40).slice(0,30).map(x=>x.slice(0,200)));
await b.close();server.close();
