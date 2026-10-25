#!/usr/bin/env node
/**
 * stytch-dfp-probe.mjs — load Stytch's public DFP telemetry.js, call
 * GetTelemetryID() with a dummy public token and a local submit URL, and
 * capture the payload/native API surface. Nothing is sent to Stytch.
 */
import { chromium } from 'playwright';
import { createServer } from 'node:http';
import { readFileSync, writeFileSync, mkdirSync } from 'node:fs';

const html = `<!doctype html><html><head><meta charset="utf-8"><title>stytch dfp</title></head>
<body><h1>stytch dfp</h1><button id="go">go</button>
<script src="https://elements.stytch.com/telemetry.js"></script>
<script>
window.__stResult = null;
document.getElementById('go').onclick = () => {
  if (typeof GetTelemetryID !== 'function') { window.__stResult = {err:'GetTelemetryID missing'}; return; }
  GetTelemetryID({ publicToken: 'public-token-test', submitURL: 'http://127.0.0.1:8805/submit' })
    .then(id => { window.__stResult = { ok: id }; })
    .catch(e => { window.__stResult = { err: String(e), stack: e && e.stack }; });
};
</script></body></html>`;
const server = createServer((req,res)=>{ res.writeHead(200,{'content-type':'text/html'}); res.end(html); });
await new Promise(r=>server.listen(8805,'127.0.0.1',r));

const INIT = `(() => {
  const W = window, S = W.__st = { fetch: [], xhr: [], render: [], json: [], subtle: [], wasm: [], workers: [], errors: [] };
  const cap=(a,o,n=200)=>{ if(a.length<n) a.push(o); };
  const b64=(u8)=>{ try { const CH=8192,p=[]; for(let i=0;i<u8.length;i+=CH)p.push(String.fromCharCode.apply(null,u8.subarray(i,i+CH))); return btoa(p.join('')); } catch(e){ return ''; } };
  const safe=(v,n=2000)=>{ try { const s=typeof v==='string'?v:JSON.stringify(v); return (s||String(v)).slice(0,n); } catch(e){ return String(v).slice(0,n); } };
  const oFetch=W.fetch;
  W.fetch=function(input,init){ try { const u=typeof input==='string'?input:(input&&input.url)||''; const rec={url:u,method:(init&&init.method)||'GET',headers:(init&&init.headers)||null}; if(init&&typeof init.body==='string'){rec.bodyLen=init.body.length;rec.body=init.body.slice(0,5000);} else if(init&&init.body&&init.body.byteLength!==undefined){rec.bodyLen=init.body.byteLength;rec.bodyB64=b64(new Uint8Array(init.body));} cap(S.fetch,rec); } catch(e){cap(S.errors,{w:'fetch',e:String(e)});} return oFetch.apply(this,arguments); };
  const oOpen=XMLHttpRequest.prototype.open, oSend=XMLHttpRequest.prototype.send;
  XMLHttpRequest.prototype.open=function(m,u){ this.__st={m,u}; return oOpen.apply(this,arguments); };
  XMLHttpRequest.prototype.send=function(b){ try { cap(S.xhr,{m:this.__st&&this.__st.m,u:this.__st&&this.__st.u,body:typeof b==='string'?b.slice(0,5000):(b&&b.byteLength!==undefined?b64(new Uint8Array(b)):null)}); } catch(e){} return oSend.apply(this,arguments); };
  const oStr=JSON.stringify; JSON.stringify=function(v,r,s){ const out=oStr.call(this,v,r,s); try{ if(typeof out==='string'&&out.length>30) cap(S.json,{len:out.length,sample:out.slice(0,3000)}); }catch(e){} return out; };
  const SC=W.SubtleCrypto&&SubtleCrypto.prototype;
  if(SC){ for(const n of ['encrypt','decrypt','digest','sign','verify','deriveBits','deriveKey','generateKey','importKey','exportKey']){ const o=SC[n]; if(typeof o!=='function')continue; SC[n]=function(...a){ const r={op:n,algo:a[0]&&(a[0].name||a[0])}; try{ if(a[2]&&a[2].byteLength!==undefined){const u=new Uint8Array(a[2]);r.dataLen=u.length;r.dataB64=b64(u).slice(0,2000);r.dataText=new TextDecoder().decode(u).slice(0,1500);} if(a[1]&&a[1].algorithm)r.key={type:a[1].type,name:a[1].algorithm.name,extractable:a[1].extractable}; }catch(e){} cap(S.subtle,r); return o.apply(this,a); }; } }
  const oCreate=document.createElement.bind(document);
  document.createElement=function(tag,...a){ const el=oCreate(tag,...a); try{ if(/canvas|iframe|script|img/i.test(tag)) cap(S.render,{tag}); }catch(e){} return el; };
  if(W.WebAssembly){ const oi=WebAssembly.instantiate; if(oi)WebAssembly.instantiate=function(...a){ try{ cap(S.wasm,{op:'instantiate',byteLen:a[0]&&a[0].byteLength}); }catch(e){} return oi.apply(this,a); }; }
  const ow=W.Worker; if(ow)W.Worker=function(u,o){ try{cap(S.workers,{url:String(u)});}catch(e){} return new ow(u,o); };
})();`;

const b = await chromium.launch({headless:true});
const ctx = await b.newContext();
await ctx.addInitScript({ content: INIT });
const page = await ctx.newPage();
const submits = [], errors = [], nets = [];
await page.route('**/submit', async route => {
  const req = route.request();
  const buf = req.postDataBuffer();
  submits.push({ url: req.url(), method: req.method(), headers: req.headers(), len: buf ? buf.length : 0, b64: buf ? buf.toString('base64') : '', text: buf ? buf.toString('latin1').slice(0,3000) : '' });
  await route.fulfill({ status: 200, contentType: 'text/plain', body: '00000000-0000-4000-8000-000000000000' });
});
await page.route('**/errors', async route => {
  const req = route.request();
  const buf = req.postDataBuffer();
  errors.push({ url: req.url(), len: buf ? buf.length : 0, text: buf ? buf.toString('latin1').slice(0,3000) : '' });
  await route.fulfill({ status: 200, contentType: 'text/plain', body: 'ok' });
});
page.on('request', r => { const u=r.url(); if (/stytch|\.wasm|\/submit|\/errors/.test(u)) nets.push({method:r.method(), url:u.slice(0,240)}); });
page.on('response', r => { const u=r.url(); if (/stytch|\.wasm/.test(u)) nets.push({status:r.status(), url:u.slice(0,240)}); });
page.on('pageerror', e => console.log('pageerror', String(e).slice(0,300)));
await page.goto('http://127.0.0.1:8805/', {waitUntil:'load'});
await page.waitForFunction(() => typeof window.GetTelemetryID === 'function', {timeout:15000}).catch(()=>{});
await page.click('#go');
await page.waitForTimeout(18000);
const res = await page.evaluate(() => window.__stResult).catch(()=>null);
const cap = await page.evaluate(() => window.__st).catch(()=>null);
mkdirSync('/tmp/opencode/stytch',{recursive:true});
writeFileSync('/tmp/opencode/stytch/submits.json', JSON.stringify(submits,null,2));
writeFileSync('/tmp/opencode/stytch/errors.json', JSON.stringify(errors,null,2));
writeFileSync('/tmp/opencode/stytch/captures.json', JSON.stringify({nets,res,cap},null,2));
console.log('result', JSON.stringify(res));
console.log('nets', JSON.stringify(nets.filter((v,i,a)=>a.findIndex(x=>x.url===v.url&&x.status===v.status)===i),null,1).slice(0,2000));
for (const s of submits) { console.log('SUBMIT', s.method, s.url, 'len', s.len, 'headers', JSON.stringify(s.headers).slice(0,300)); console.log(' bodyText', JSON.stringify(s.text.slice(0,800))); }
for (const e of errors) console.log('ERROR', e.url, 'len', e.len, JSON.stringify(e.text.slice(0,500)));
console.log('captures', JSON.stringify({fetch:cap?.fetch?.length,xhr:cap?.xhr?.length,json:cap?.json?.length,subtle:cap?.subtle?.length,wasm:cap?.wasm?.length,workers:cap?.workers?.length,render:cap?.render?.length}).slice(0,500));
await b.close(); server.close();
