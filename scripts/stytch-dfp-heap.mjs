#!/usr/bin/env node
import { chromium } from 'playwright';
import { createServer } from 'node:http';
const html=`<!doctype html><html><body><script src="https://elements.stytch.com/telemetry.js"></script></body></html>`;
const server=createServer((q,r)=>{r.writeHead(200,{'content-type':'text/html'});r.end(html);});
await new Promise(r=>server.listen(8807,'127.0.0.1',r));
const b=await chromium.launch({headless:true});const p=await b.newPage();
await p.goto('http://127.0.0.1:8807/',{waitUntil:'load'});
await p.waitForFunction(()=>typeof window.telemetryjs==='function',{timeout:15000}).catch(()=>{});
const out=await p.evaluate(async()=>{
  try{
    const m=await window.telemetryjs();
    const h=m.HEAPU8;
    const info={type:typeof h, ctor:h&&h.constructor&&h.constructor.name, len:h&&h.length, keys:Object.keys(m).slice(0,40)};
    if(h){
      const s=new TextDecoder('latin1').decode(h);
      const re=/[\x20-\x7e]{5,}/g; const arr=[]; let mm;
      while((mm=re.exec(s))&&arr.length<4000) arr.push(mm[0]);
      info.strings=arr.length; info.sample=arr.filter(x=>/canvas|webgl|audio|navigator|screen|timezone|fingerprint|tamper|headless|public|submit|GetTID|crypto|aes|chacha|zlib|platform|hardware|font|iframe|worker/i.test(x)).slice(0,120);
    }
    return info;
  }catch(e){return {err:String(e),stack:e.stack}}
});
console.log(JSON.stringify(out,null,1).slice(0,5000));
await b.close();server.close();
