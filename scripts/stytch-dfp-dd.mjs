#!/usr/bin/env node
/** Capture dd() constant->decoded-name mapping + blob + C+96 + table, so we can map the serialized payload schema. */
import { chromium } from 'playwright';
import { createServer } from 'node:http';
import { writeFileSync, mkdirSync } from 'node:fs';

const base = (await import('node:fs')).readFileSync('/tmp/opencode/st-beautified-dd.js','utf8');
const html = `<!doctype html><html><body><button id="go">go</button>
<script src="https://elements.stytch.com/telemetry.js"></script>
<script>
window.__res=null;
document.getElementById('go').onclick=async()=>{
 try{const m=await window.telemetryjs();window.__m=m;await m.Ready;m.rids=[];let r=null;
  await m.GetTID({a:'public-token-test',b:'http://127.0.0.1:8833/submit',c:'UNKNOWN',d:(v)=>{r=v;}});
  window.__res={ok:true};
 }catch(e){window.__res={err:String(e)};}
};
</script></body></html>`;
const server=createServer((q,r)=>{r.writeHead(200,{'content-type':'text/html'});r.end(html);});
await new Promise(r=>server.listen(8833,'127.0.0.1',r));

const MK={ua:'MARKERUA31337QQQ',platform:'MARKERPLATFORM31337',w:31337,h:41337,aw:31338,ah:41338,depth:33,hc:47,dm:79,mt:97};
const FIXED=Array.from({length:1024},(_,i)=>i%256), F4=[1,2,3,4], F16=[5,6,7,8,9,10,11,12,13,14,15,16,17,18,19,20];
const INIT=`(() => {
 const W=window,MK=${JSON.stringify(MK)},FIXED=${JSON.stringify(FIXED)},F4=${JSON.stringify(F4)},F16=${JSON.stringify(F16)};
 const def=(p,k,g)=>{try{Object.defineProperty(p,k,{configurable:true,get:g});}catch(e){}};
 def(Navigator.prototype,'userAgent',()=>MK.ua);def(Navigator.prototype,'appVersion',()=>MK.ua);
 def(Navigator.prototype,'platform',()=>MK.platform);def(Navigator.prototype,'hardwareConcurrency',()=>MK.hc);
 def(Navigator.prototype,'deviceMemory',()=>MK.dm);def(Navigator.prototype,'maxTouchPoints',()=>MK.mt);
 def(Screen.prototype,'width',()=>MK.w);def(Screen.prototype,'height',()=>MK.h);
 def(Screen.prototype,'availWidth',()=>MK.aw);def(Screen.prototype,'availHeight',()=>MK.ah);
 def(Screen.prototype,'colorDepth',()=>MK.depth);def(Screen.prototype,'pixelDepth',()=>MK.depth);
 let c4=0,c16=0;
 const oGRV=crypto.getRandomValues;
 crypto.getRandomValues=function(a){ const v=oGRV.call(crypto,a);
   if(a.length===1024){ for(let i=0;i<a.length;i++)a[i]=FIXED[i]; }
   else if(a.length===4){ for(let i=0;i<a.length;i++)a[i]=F4[(c4++)%4]; }
   else if(a.length===16){ for(let i=0;i<a.length;i++)a[i]=F16[(c16++)%16]; }
   return a;
 };
 const b64=(u8)=>{const CH=8192,p=[];for(let i=0;i<u8.length;i+=CH)p.push(String.fromCharCode.apply(null,u8.subarray(i,i+CH)));return btoa(p.join(''));};
 const _orig=W.telemetryjs;
 W.telemetryjs=function(...a){ const r=_orig.apply(this,a);
   if(r&&typeof r.then==='function') return r.then(m=>{W.__m=m;return m;});
   W.__m=r; return r; };
 W.__ddLog=[];
 W.__ddHook=function(b,ret){
   try{
     const u8=W.__m&&W.__m.HEAPU8;
     const constBytes=u8?Array.from(u8.slice(b,b+64)):[];
     let outStr='';
     if(ret && u8){ let i=ret; const c=[]; while(i<u8.length && u8[i]!==0 && c.length<200){ c.push(u8[i]); i++; } outStr=new TextDecoder('latin1').decode(new Uint8Array(c)); }
     W.__ddLog.push({constB64:(()=>{const CH=8192,p=[];for(let i=0;i<constBytes.length;i+=CH)p.push(String.fromCharCode.apply(null,constBytes.subarray?constBytes.subarray(i,i+CH):constBytes.slice(i,i+CH)));try{return btoa(p.join(''));}catch(e){return '';}})(), out:outStr});
   }catch(e){ try{W.__ddLog.push({err:String(e)});}catch(_){} }
 };
})();`;

const b=await chromium.launch({headless:true});
const ctx=await b.newContext(); await ctx.addInitScript({content:INIT});
const p=await ctx.newPage();
let blob=null;
await p.route('**/telemetry.js',r=>r.fulfill({status:200,contentType:'application/javascript',body:base}));
await p.route('**/submit',async r=>{const q=r.request();const buf=q.postDataBuffer();blob=buf;await r.fulfill({status:200,contentType:'text/plain',body:'00000000-0000-4000-8000-000000000000'});});
await p.route('**/errors',r=>r.fulfill({status:200,contentType:'text/plain',body:'ok'}));
await p.goto('http://127.0.0.1:8833/',{waitUntil:'load'});
await p.waitForFunction(()=>typeof window.telemetryjs==='function',{timeout:15000}).catch(()=>{});
await p.click('#go'); await p.waitForTimeout(25000);
const ddLog=await p.evaluate(()=>window.__ddLog).catch(()=>null);
const res=await p.evaluate(()=>window.__res).catch(()=>null);
const caps=await p.evaluate(()=>{ const u8=window.__m.HEAPU8; const u32=(o)=>u8[o]|(u8[o+1]<<8)|(u8[o+2]<<16)|(u8[o+3]<<24); const C=u32(17349*4); const b64=(u8)=> {const CH=8192,p=[];for(let i=0;i<u8.length;i+=CH)p.push(String.fromCharCode.apply(null,u8.subarray(i,i+CH)));return btoa(p.join(''));}; return {C,c96:b64(u8.slice(C+96,C+128)),table8304:b64(u8.slice(8304,8336))}; }).catch(()=>null);
mkdirSync('/tmp/opencode/stytch',{recursive:true});
if(blob) writeFileSync('/tmp/opencode/stytch/dd-blob.bin',Buffer.from(blob.toString('utf8'),'base64'));
writeFileSync('/tmp/opencode/stytch/dd-log.json',JSON.stringify({res,caps,ddLog},null,2));
console.log("res",JSON.stringify(res));console.log("dd",ddLog&&ddLog.length);console.log("blob",blob&&Buffer.from(blob.toString("utf8"),"base64").length);
await b.close();server.close();
