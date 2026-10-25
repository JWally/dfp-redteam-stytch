#!/usr/bin/env node
/**
 * stytch-dfp-payloadview.mjs — show the READABLE telemetry payload.
 *
 * The wire serialization is a custom binary format, so instead of parsing it
 * blindly we hook the module's OWN serializer `sa(name, value)` — every
 * (field name → value) the SDK appends to the payload is captured directly
 * from the module heap at call time, with names decoded via the `dd()` hook.
 *
 * This yields the actual browser tells the SDK collected and shipped:
 * fingerprint hashes (fp_*), screen, platform/UA-CH, timezone, bot/tamper
 * signals, fonts, canvas probe, WebGL info, etc.
 *
 * Nothing is sent to Stytch — the SDK posts to a LOCAL /submit that is
 * intercepted and never forwarded. telemetry.js bundle is the real public
 * asset, patched only to add the two read-only capture hooks.
 *
 * Usage:
 *   node bots/stytch-dfp-payloadview.mjs            # dump readable payload
 *   node bots/stytch-dfp-payloadview.mjs --dump     # also dump raw decrypted bytes
 */
import { chromium } from 'playwright';
import { createServer } from 'node:http';
import { createDecipheriv } from 'node:crypto';
import { mkdirSync, writeFileSync } from 'node:fs';
import { readFileSync } from 'node:fs';

const PATCHED = readFileSync('/tmp/opencode/st-beautified-sa.js', 'utf8');
const PORT = 8870;

const html = `<!doctype html><html><body><button id="go">run</button>
<script src="https://elements.stytch.com/telemetry.js"></script>
<script>
window.__m=null; window.__saLog=[]; window.__ddLog=[]; window.__saDbgLog=[];
window.__saDbg=function(dbg){ try{ window.__saDbgLog.push(dbg); if(window.__saDbgLog.length>400) window.__saDbgLog.shift(); }catch(_){} };
window.__saHook=function(cap){ try{
  const nm=Array.from(cap.nm); const vl=Array.from(cap.vl);
  window.__saLog.push({nmB64:btoa(String.fromCharCode.apply(null,nm)), vlen:cap.vlen, vlB64:btoa(String.fromCharCode.apply(null,vl))});
}catch(e){ window.__saLog.push({err:String(e)}); } };
window.__ddHook=function(b,ret){ try{
  const u8=window.__m&&window.__m.HEAPU8;
  const cB=u8?Array.from(u8.slice(b,b+64)):[];
  let s=''; if(ret&&u8){let i=ret,c=[];while(i<u8.length&&u8[i]!==0&&c.length<200){c.push(u8[i]);i++;}s=new TextDecoder('latin1').decode(new Uint8Array(c));}
  window.__ddLog.push({cb:btoa(String.fromCharCode.apply(null,cB)),out:s});
}catch(e){ window.__ddLog.push({err:String(e)}); } };
window.__run=async()=>{ try{
  const m=await window.telemetryjs(); window.__m=m; await m.Ready; m.rids=[];
  await m.GetTID({a:'public-token-test',b:'http://127.0.0.1:${PORT}/submit',c:'UNKNOWN',d:v=>{window.__tid=v;}});
  window.__done=true;
}catch(e){ window.__err=String(e);} };
document.getElementById('go').onclick=window.__run;
</script></body></html>`;

const server = createServer((req,res)=>{
  if (req.url === '/') { res.writeHead(200,{'content-type':'text/html'}); res.end(html); }
  else if (req.url === '/submit') {
    let b=[]; req.on('data',c=>b.push(c));
    req.on('end',()=>{ res.writeHead(200,{'content-type':'text/plain'}); res.end('00000000-0000-4000-8000-000000000000'); });
  } else { res.writeHead(200,{'content-type':'text/plain'}); res.end('ok'); }
});
await new Promise(r=>server.listen(PORT,'127.0.0.1',r));

const browser = await chromium.launch({ headless:true });
const ctx = await browser.newContext();
const page = await ctx.newPage();

let captured = null;
await page.route('**/telemetry.js', r=>r.fulfill({ status:200, contentType:'application/javascript', body:PATCHED }));
await page.route('**/submit', async route => { captured = route.request().postDataBuffer(); await route.fulfill({ status:200, contentType:'text/plain', body:'00000000-0000-4000-8000-000000000000' }); });
await page.route('**/errors', r => r.fulfill({ status:200, contentType:'text/plain', body:'ok' }));

await page.goto(`http://127.0.0.1:${PORT}/`, { waitUntil:'load' });
await page.waitForFunction(()=>typeof window.telemetryjs==='function', { timeout:15000 }).catch(()=>{});
await page.click('#go');
await page.waitForTimeout(25000);

const saLog = await page.evaluate(()=>window.__saLog).catch(()=>[]);
const saDbg = await page.evaluate(()=>window.__saDbgLog).catch(()=>[]);
const ddLog = await page.evaluate(()=>window.__ddLog).catch(()=>[]);
const state = await page.evaluate(()=>({done:window.__done,err:window.__err})).catch(()=>null);
const caps = await page.evaluate(()=>{ const u8=window.__m&&window.__m.HEAPU8; if(!u8) return null;
  const u32=o=>u8[o]|(u8[o+1]<<8)|(u8[o+2]<<16)|(u8[o+3]<<24); const C=u32(17349*4);
  const b64=a=>{const CH=8192,p=[];for(let i=0;i<a.length;i+=CH)p.push(String.fromCharCode.apply(null,a.subarray(i,i+CH)));return btoa(p.join(''));};
  return {C,c96:b64(u8.slice(C+96,C+128)),tab:b64(u8.slice(8304,8336))}; }).catch(()=>null);

// ---- decode helpers -------------------------------------------------------
const dec = bytes => { // utf8 with replacement; fall back to latin1
  try { return new TextDecoder('utf-8', {fatal:false}).decode(bytes); } catch(_) { return bytes.toString('latin1'); }
};
const printable = bytes => {
  let ok=0; for (const b of bytes){ if (b>=32 && b<127) ok++; }
  return bytes.length>0 && ok >= bytes.length*0.85;
};

// ---- name decoder: sa names are plaintext ASCII; dd decodes encoded consts --
const ddMap = new Map();
for (const d of ddLog) if (d.out && d.cb && !ddMap.has(d.cb)) ddMap.set(d.cb, d.out);

const nameStr = buf => {
  const s = dec(buf);
  if (/^[\x20-\x7e]{1,64}$/.test(s)) return s;          // plaintext
  const b64 = buf.toString('base64');
  return ddMap.get(b64) || s;                            // encoded const -> decoded
};

// ---- build the readable payload -------------------------------------------
const rows = [];
for (const s of saLog) {
  if (s.err) continue;
  const name = nameStr(Buffer.from(s.nmB64,'base64'));
  const valBuf = Buffer.from(s.vlB64,'base64');
  const val = printable(valBuf) ? dec(valBuf) : valBuf.toString('hex');
  rows.push({ name, vlen: s.vlen, val, hex: !printable(valBuf) });
}

// ---- decrypt the real blob too (correlate) --------------------------------
let decrypted = null, keyHex = null, magic = null;
if (captured && caps) {
  const blob = Buffer.from(captured.toString('utf8'),'base64');
  const key = Buffer.alloc(32);
  { const c96 = Buffer.from(caps.c96,'base64'), tab = Buffer.from(caps.tab,'base64');
    for (let i=0;i<32;i++) key[i] = c96[i]^tab[i]; }
  keyHex = key.toString('hex');
  const d = createDecipheriv('aes-256-cbc', key, blob.subarray(64,80));
  const pt = Buffer.concat([d.update(blob.subarray(80)), d.final()]);
  const pad = pt[pt.length-1];
  decrypted = pad && pad<=16 ? pt.subarray(0, pt.length-pad) : pt;
  magic = decrypted.subarray(0,4).toString('hex');
}

// ---- output ---------------------------------------------------------------
console.log('state:', JSON.stringify(state));
console.log('sa() calls:', saLog.length, ' saDbg entries:', saDbg.length, ' dd() calls:', ddLog.length, ' magic:', magic || 'n/a');
if (saDbg.length) {
  const kinds = {};
  for (const d of saDbg) { kinds[d.kind] = (kinds[d.kind]||0)+1; }
  console.log('saDbg kinds:', JSON.stringify(kinds));
  const firstErr = saDbg.find(d=>d.kind==='err'||d.kind==='hookerr');
  if (firstErr) console.log('first sa error:', JSON.stringify(firstErr));
  const firstRead = saDbg.find(d=>d.kind==='read');
  if (firstRead) console.log('first sa read:', JSON.stringify(firstRead));
}
mkdirSync('/tmp/opencode/stytch',{recursive:true});
writeFileSync('/tmp/opencode/stytch/payloadview.json', JSON.stringify({state, magic, key:keyHex, rows}, null, 2));

console.log('\n==================== READABLE TELEMETRY PAYLOAD ====================');
if (!rows.length) console.log('(no sa() captures — check bundle hook)');
const group = r => /^fp_/.test(r.name) ? 'FINGERPRINT-HASH' :
  /^x_/.test(r.name) ? 'PLATFORM/UA-CH' :
  /^screen_/.test(r.name) ? 'SCREEN' :
  /^tz/.test(r.name)||r.name==='utc' ? 'TIMEZONE' : 'SIGNAL';
const order = ['FINGERPRINT-HASH','SCREEN','PLATFORM/UA-CH','TIMEZONE','SIGNAL'];
const byGroup = new Map();
for (const r of rows){ const g=group(r); if(!byGroup.has(g)) byGroup.set(g,[]); byGroup.get(g).push(r); }
for (const g of order) {
  const list = byGroup.get(g);
  if (!list) continue;
  console.log(`\n--- ${g} (${list.length}) ---`);
  for (const r of list) {
    const v = r.hex ? `0x${r.val.slice(0,96)}${r.val.length>96?'…':''}` : JSON.stringify(r.val.slice(0,160));
    console.log(`  ${r.name.padEnd(26)} ${String(r.vlen).padStart(5)}B  ${v}`);
  }
}
console.log('\n[+] full JSON: /tmp/opencode/stytch/payloadview.json');
if (process.argv.includes('--dump') && decrypted) {
  console.log('\n---- raw decrypted body (magic '+magic+') ----');
  console.log('  session[4:68]:', decrypted.subarray(4,68).toString('hex'));
  console.log('  serialized[68:120]:', decrypted.subarray(68,120).toString('hex'));
}
await browser.close(); server.close();
