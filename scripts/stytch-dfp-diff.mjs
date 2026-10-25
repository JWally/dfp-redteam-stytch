#!/usr/bin/env node
/** Does the Stytch DFP payload length depend on UA/screen? */
import { chromium } from 'playwright';
import { createServer } from 'node:http';
import { createHash } from 'node:crypto';
const html=`<!doctype html><html><body><button id="go">go</button>
<script src="https://elements.stytch.com/telemetry.js"></script>
<script>
window.__stResult=null;
document.getElementById('go').onclick=()=>{GetTelemetryID({publicToken:'public-token-test',submitURL:'http://127.0.0.1:8810/submit'}).then(id=>window.__stResult={ok:id}).catch(e=>window.__stResult={err:String(e)});};
</script></body></html>`;
const server=createServer((q,r)=>{r.writeHead(200,{'content-type':'text/html'});r.end(html);});
await new Promise(r=>server.listen(8810,'127.0.0.1',r));
const profiles=[
 {name:'default'},
 {name:'iphone-safari', ua:'Mozilla/5.0 (iPhone; CPU iPhone OS 17_4 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.4 Mobile/15E148 Safari/604.1', viewport:{width:390,height:844}},
 {name:'windows-1920', ua:'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/148.0.0.0 Safari/537.36', viewport:{width:1920,height:1080}},
];
const b=await chromium.launch({headless:true});
for(const p of profiles){
  const ctx=await b.newContext({...(p.ua?{userAgent:p.ua}:{}),...(p.viewport?{viewport:p.viewport}:{})});
  const page=await ctx.newPage(); const subs=[];
  await page.route('**/submit',async r=>{const q=r.request();const buf=q.postDataBuffer();subs.push(buf);await r.fulfill({status:200,contentType:'text/plain',body:'00000000-0000-4000-8000-000000000000'});});
  await page.route('**/errors',r=>r.fulfill({status:200,contentType:'text/plain',body:'ok'}));
  await page.goto('http://127.0.0.1:8810/',{waitUntil:'load'});
  await page.waitForFunction(()=>typeof window.GetTelemetryID==='function',{timeout:15000}).catch(()=>{});
  await page.click('#go'); await page.waitForTimeout(9000);
  const res=await page.evaluate(()=>window.__stResult).catch(()=>null);
  for(const s of subs) console.log(p.name,'len',s.length,'sha256',createHash('sha256').update(s).digest('hex').slice(0,16),'head',s.slice(0,24));
  if(!subs.length) console.log(p.name,'NO SUBMIT',JSON.stringify(res));
  await ctx.close();
}
await b.close();server.close();
