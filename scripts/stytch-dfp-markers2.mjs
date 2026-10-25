#!/usr/bin/env node
/** Isolate UA/platform/screen markers; scan main heap + frames + body. */
import { chromium } from 'playwright';
import { createServer } from 'node:http';
import { writeFileSync, mkdirSync } from 'node:fs';
const html=`<!doctype html><html><body><button id="go">go</button>
<script src="https://elements.stytch.com/telemetry.js"></script>
<script>
window.__m=null;window.__hits=[];window.__body=null;window.__frames=[];window.__res=null;
document.getElementById('go').onclick=async()=>{
 try{const m=await window.telemetryjs();window.__m=m;await m.Ready;m.rids=[];let r=null;
  const ret=await m.GetTID({a:'public-token-test',b:'http://127.0.0.1:8812/submit',c:'UNKNOWN',d:(v)=>{r=v;}});
  window.__res={ret,r};
 }catch(e){window.__res={err:String(e),stack:e&&e.stack};}
};
</script></body></html>`;
const server=createServer((q,r)=>{r.writeHead(200,{'content-type':'text/html'});r.end(html);});
await new Promise(r=>server.listen(8812,'127.0.0.1',r));
const MK={ua:'MARKERUA31337QQQ',platform:'MARKERPLATFORM31337',w:31337,h:41337,aw:31338,ah:41338,depth:33,hc:47,dm:79,mt:11};
const INIT=`(() => {
 const W=window,MK=${JSON.stringify(MK)};
 const def=(p,k,g)=>{try{Object.defineProperty(p,k,{configurable:true,get:g});}catch(e){}};
 def(Navigator.prototype,'userAgent',()=>MK.ua); def(Navigator.prototype,'appVersion',()=>MK.ua);
 def(Navigator.prototype,'platform',()=>MK.platform); def(Navigator.prototype,'hardwareConcurrency',()=>MK.hc);
 def(Navigator.prototype,'deviceMemory',()=>MK.dm); def(Navigator.prototype,'maxTouchPoints',()=>MK.mt);
 def(Screen.prototype,'width',()=>MK.w); def(Screen.prototype,'height',()=>MK.h);
 def(Screen.prototype,'availWidth',()=>MK.aw); def(Screen.prototype,'availHeight',()=>MK.ah);
 def(Screen.prototype,'colorDepth',()=>MK.depth); def(Screen.prototype,'pixelDepth',()=>MK.depth);
 const markers=[MK.ua,MK.platform,String(MK.w),String(MK.h),String(MK.aw),String(MK.ah),String(MK.hc),String(MK.dm),String(MK.mt)];
 const scan=(m,where)=>{try{if(!m||!m.HEAPU8)return;const h=m.HEAPU8;const txt=new TextDecoder('latin1').decode(h);const u16=new TextDecoder('utf-16le').decode(h);const b64=markers.map(x=>btoa(x));const all=[...markers,...b64];
   for(const mk of markers){let i=txt.indexOf(mk);while(i!==-1&&W.__hits.length<300){W.__hits.push({where,mk,enc:'ascii',at:i,ctx:txt.slice(Math.max(0,i-250),i+450)});i=txt.indexOf(mk,i+mk.length);} let j=u16.indexOf(mk);while(j!==-1&&W.__hits.length<300){W.__hits.push({where,mk,enc:'utf16',at:j,ctx:JSON.stringify(u16.slice(Math.max(0,j-120),j+220))});j=u16.indexOf(mk,j+mk.length);} }
   for(const b of b64){let i=txt.indexOf(b);while(i!==-1&&W.__hits.length<300){W.__hits.push({where,mk:b,enc:'b64',at:i,ctx:txt.slice(Math.max(0,i-200),i+300)});i=txt.indexOf(b,i+b.length);} }
 }catch(e){W.__hits.push({where,err:String(e)});}};
 W.__scan=scan;
 const oGRV=crypto.getRandomValues; crypto.getRandomValues=function(a){try{scan(W.__m,'pre-grv');}catch(e){}const v=oGRV.call(crypto,a);try{scan(W.__m,'post-grv');}catch(e){}return v;};
 const oFetch=W.fetch; W.fetch=function(input,init){try{if(String(input).includes('/submit')){scan(W.__m,'fetch');if(init&&typeof init.body==='string')W.__body=init.body; for(const f of W.__frames){try{scan(f.contentWindow,'frame');}catch(e){}}} }catch(e){}return oFetch.apply(this,arguments);};
 const oCreate=document.createElement.bind(document); document.createElement=function(t,...a){const el=oCreate(t,...a);try{if(String(t).toLowerCase()==='iframe'){W.__frames.push(el);} }catch(e){}return el;};
})();`;
const b=await chromium.launch({headless:true});const ctx=await b.newContext();await ctx.addInitScript({content:INIT});const p=await ctx.newPage();
await p.route('**/submit',r=>r.fulfill({status:200,contentType:'text/plain',body:'00000000-0000-4000-8000-000000000000'}));
await p.route('**/errors',r=>r.fulfill({status:200,contentType:'text/plain',body:'ok'}));
await p.goto('http://127.0.0.1:8812/',{waitUntil:'load'});await p.waitForFunction(()=>typeof window.telemetryjs==='function',{timeout:15000}).catch(()=>{});
await p.click('#go');await p.waitForTimeout(15000);
const out=await p.evaluate(()=>({res:window.__res,hits:window.__hits,body:window.__body,frames:window.__frames.length})).catch(()=>null);
mkdirSync('/tmp/opencode/stytch',{recursive:true});writeFileSync('/tmp/opencode/stytch/markers2.json',JSON.stringify(out,null,2));
console.log('res',JSON.stringify(out&&out.res),'frames',out&&out.frames,'bodyLen',out&&out.body&&out.body.length,'hits',out&&out.hits&&out.hits.length);
for(const h of (out&&out.hits||[]).slice(0,40))console.log(' HIT',h.where,h.enc,h.mk,'@',h.at,JSON.stringify(h.ctx||h.err).slice(0,700));
if(out&&out.body){const raw=Buffer.from(out.body,'base64');console.log('body raw len',raw.length,'head',raw.slice(0,32).toString('hex'));for(const mk of [MK.ua,MK.platform,String(MK.w),String(MK.h),String(MK.aw),String(MK.ah)]){const s=Buffer.from(mk);console.log(' body has',mk,s.length,'ascii',raw.includes(s),'b64',raw.includes(Buffer.from(Buffer.from(mk).toString('base64'))));}}
await b.close();server.close();
