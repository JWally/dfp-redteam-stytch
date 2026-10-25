#!/usr/bin/env node
/**
 * stytch-dfp-diffxor.mjs — force getRandomValues to fixed values, run twice
 * differing ONLY in screen width, capture both blobs. XOR them to determine
 * cipher type (stream vs block) and locate the width in the plaintext layout.
 */
import { chromium } from 'playwright';
import { createServer } from 'node:http';
import { writeFileSync, mkdirSync } from 'node:fs';

const html = `<!doctype html><html><body><button id="go">go</button>
<script src="https://elements.stytch.com/telemetry.js"></script>
<script>
window.__res=null;
document.getElementById('go').onclick=async()=>{
 try{const m=await window.telemetryjs();await m.Ready;m.rids=[];let r=null;
  await m.GetTID({a:'public-token-test',b:'http://127.0.0.1:8822/submit',c:'UNKNOWN',d:(v)=>{r=v;}});
  window.__res={ok:true};
 }catch(e){window.__res={err:String(e)};}
};
</script></body></html>`;
const server=createServer((q,r)=>{r.writeHead(200,{'content-type':'text/html'});r.end(html);});
await new Promise(r=>server.listen(8822,'127.0.0.1',r));

const FIXED = Array.from({length:1024},(_,i)=>i%256);
const FIXED4 = [1,2,3,4];
const FIXED16 = [5,6,7,8,9,10,11,12,13,14,15,16,17,18,19,20];

async function run(width){
  const INIT=`(() => {
    const W=window, WIDTH=${width};
    const def=(p,k,g)=>{try{Object.defineProperty(p,k,{configurable:true,get:g});}catch(e){}};
    def(Screen.prototype,'width',()=>WIDTH);
    const FIXED=${JSON.stringify(FIXED)}, F4=${JSON.stringify(FIXED4)}, F16=${JSON.stringify(FIXED16)};
    let c4=0,c16=0;
    const oGRV=crypto.getRandomValues;
    crypto.getRandomValues=function(a){ const v=oGRV.call(crypto,a);
      if(a.length===1024){ for(let i=0;i<a.length;i++)a[i]=FIXED[i]; }
      else if(a.length===4){ for(let i=0;i<a.length;i++)a[i]=F4[(c4++)%4]; }
      else if(a.length===16){ for(let i=0;i<a.length;i++)a[i]=F16[(c16++)%16]; }
      return a;
    };
  })();`;
  const b=await chromium.launch({headless:true});
  const ctx=await b.newContext(); await ctx.addInitScript({content:INIT});
  const p=await ctx.newPage();
  let blob=null;
  await p.route('**/submit',async r=>{const q=r.request();const buf=q.postDataBuffer();blob=buf;await r.fulfill({status:200,contentType:'text/plain',body:'00000000-0000-4000-8000-000000000000'});});
  await p.route('**/errors',r=>r.fulfill({status:200,contentType:'text/plain',body:'ok'}));
  await p.goto('http://127.0.0.1:8822/',{waitUntil:'load'});
  await p.waitForFunction(()=>typeof window.telemetryjs==='function',{timeout:15000}).catch(()=>{});
  await p.click('#go'); await p.waitForTimeout(16000);
  await b.close();
  return blob ? Buffer.from(blob.toString('utf8'),'base64') : null;
}

const a=await run(31337);
const b_=await run(41337);
mkdirSync('/tmp/opencode/stytch',{recursive:true});
writeFileSync('/tmp/opencode/stytch/diff-w31337.bin',a||Buffer.alloc(0));
writeFileSync('/tmp/opencode/stytch/diff-w41337.bin',b_||Buffer.alloc(0));
console.log('blob A (31337) len',a&&a.length,'head',a&&a.slice(0,16).toString('hex'));
console.log('blob B (41337) len',b_&&b_.length,'head',b_&&b_.slice(0,16).toString('hex'));
if(a&&b_){
  const x=Buffer.alloc(Math.min(a.length,b_.length));
  for(let i=0;i<x.length;i++)x[i]=a[i]^b_[i];
  writeFileSync('/tmp/opencode/stytch/diff-xor.bin',x);
  console.log('XOR len',x.length);
  const diffidx=[];
  for(let i=0;i<x.length;i++) if(x[i]!==0) diffidx.push(i);
  console.log('non-zero XOR bytes:',diffidx.length);
  console.log('first 32 diff offsets:',diffidx.slice(0,32));
  // chunk into runs
  const runs=[]; let start=null,prev=-2;
  for(const i of diffidx){ if(i!==prev+1){ if(start!==null)runs.push([start,prev]); start=i;} prev=i; }
  if(start!==null)runs.push([start,prev]);
  console.log('diff runs:',runs.slice(0,20));
  // first 64 bytes of each + xor
  console.log('A head:',a.slice(0,64).toString('hex'));
  console.log('B head:',b_.slice(0,64).toString('hex'));
  console.log('X head:',x.slice(0,64).toString('hex'));
}
server.close();
