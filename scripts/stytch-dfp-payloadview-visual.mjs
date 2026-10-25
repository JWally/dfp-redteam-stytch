#!/usr/bin/env node
/**
 * stytch-dfp-payloadview-visual.mjs — HEADED demo: show the READABLE telemetry
 * payload (the browser tells) in a visible browser window.
 *
 * Runs the real telemetry.js bundle (patched only with read-only sa()/dd()
 * capture hooks), lets the SDK build + POST its payload to a LOCAL /submit
 * (intercepted, never forwarded), decrypts the real blob with the recovered
 * per-session AES-256 key, and renders the readable (name → value) payload on
 * screen — grouped, with the bot/headless tells highlighted.
 *
 * Usage:
 *   node bots/stytch-dfp-payloadview-visual.mjs
 *   (close the window to exit)
 */
import { chromium } from 'playwright';
import { createServer } from 'node:http';
import { createDecipheriv } from 'node:crypto';
import { readFileSync, mkdirSync, writeFileSync } from 'node:fs';

const PATCHED = readFileSync('/tmp/opencode/st-beautified-sa.js', 'utf8');
const PORT = 8880;

// ---------------------------------------------------------------------------
// Page: terminal-style control panel, auto-runs, renders the readable payload
// ---------------------------------------------------------------------------
const html = `<!doctype html>
<html><head><meta charset="utf-8"><title>Stytch DFP — readable payload (live)</title>
<style>
  body{background:#0d1117;color:#e6edf3;font-family:ui-monospace,Menlo,Consolas,monospace;margin:0}
  #wrap{max-width:1000px;margin:0 auto;padding:24px}
  h1{font-size:18px;color:#58a6ff;margin:0 0 4px}
  .sub{color:#8b949e;font-size:12px;margin:0 0 14px}
  #log{background:#010409;border:1px solid #30363d;border-radius:8px;padding:14px 16px;
       font-size:12.5px;line-height:1.55;max-height:260px;overflow-y:auto;white-space:pre-wrap;word-break:break-all;margin-bottom:16px}
  .ok{color:#3fb950}.warn{color:#d29922}.bad{color:#f85149}.dim{color:#8b949e}.acc{color:#58a6ff}.hex{color:#d2a8ff}
  table{border-collapse:collapse;width:100%;font-size:12.5px;margin:6px 0 18px}
  th,td{border:1px solid #30363d;padding:4px 10px;text-align:left;vertical-align:top;word-break:break-all}
  th{background:#161b22;color:#8b949e;font-weight:normal;text-transform:uppercase;font-size:11px;letter-spacing:.5px}
  tr.tell td{background:#3a1414} tr.tell td.name{color:#ff7b72;font-weight:bold}
  h2{font-size:13px;color:#58a6ff;margin:18px 0 4px;letter-spacing:.5px}
  .name{color:#a5d6ff;white-space:nowrap} .dim{color:#8b949e}
</style></head>
<body><div id="wrap">
  <h1>Stytch Device Fingerprinting — decrypted, readable payload</h1>
  <p class="sub">real telemetry.js (patched with read-only sa()/dd() hooks) · SDK posts to LOCAL /submit (intercepted, never forwarded)</p>
  <div id="log"></div>
  <div id="out"></div>
</div>
<script src="https://elements.stytch.com/telemetry.js"></script>
<script>
window.__m=null; window.__saLog=[]; window.__ddLog=[];
window.__log=function(cls,line){ const el=document.getElementById('log');
  const d=document.createElement('div'); d.className=cls||'';
  const t=String(new Date().getTime()).slice(-6); d.textContent='['+t+'] '+line;
  el.appendChild(d); el.scrollTop=el.scrollHeight; };
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
const _orig=window.telemetryjs;
window.telemetryjs=function(...a){ const r=_orig.apply(this,a);
  if(r&&typeof r.then==='function') return r.then(m=>{window.__m=m;return m;});
  window.__m=r; return r; };
window.__run=async()=>{ try{
  window.__log('acc','[*] telemetryjs() -> resolving module (C++/Emscripten wasm2js) …');
  const m=await window.telemetryjs(); window.__m=m;
  window.__log('ok','[+] module resolved; awaiting Ready …');
  await m.Ready; m.rids=[];
  window.__log('acc','[*] GetTID() -> SDK collects signals and POSTs blob to local /submit');
  await m.GetTID({a:'public-token-test',b:'http://127.0.0.1:'+${PORT}+'/submit',c:'UNKNOWN',d:v=>{window.__tid=v;}});
  window.__log('ok','[+] GetTID returned; '+window.__saLog.length+' signal records captured; POST intercepted (not forwarded)');
  window.__done=true;
}catch(e){ window.__err=String(e); window.__log('bad','[!] '+String(e).slice(0,200)); } };
window.__render=function(rows){
  const out=document.getElementById('out');
  const esc=s=>String(s).replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;');
  const group=r=>/^fp_/.test(r.name)?'FINGERPRINT HASHES (/fp_/)':
    /^x_/.test(r.name)?'PLATFORM / UA-CH':
    /^screen_/.test(r.name)?'SCREEN':
    /^tz/.test(r.name)||r.name==='utc'?'TIMEZONE':
    (r.name==='webdriver'||r.name==='webgl'||r.name==='UA'||r.name==='brand'||r.name==='x_fvlist')?'BOT / HEADLESS TELLS':'SIGNALS';
  const order=['FINGERPRINT HASHES (/fp_/)','BOT / HEADLESS TELLS','SCREEN','PLATFORM / UA-CH','TIMEZONE','SIGNALS'];
  const by=new Map(); for(const r of rows){const g=group(r);if(!by.has(g))by.set(g,[]);by.get(g).push(r);}
  for(const g of order){ const list=by.get(g); if(!list) continue;
    const h=document.createElement('h2'); h.textContent=g+' ('+list.length+')'; out.appendChild(h);
    const t=document.createElement('table');
    t.innerHTML='<tr><th>field</th><th>bytes</th><th>value</th></tr>';
    for(const r of list){
      const tell=(g==='BOT / HEADLESS TELLS');
      const val=r.hex?('<span class="hex">0x'+esc(r.val.slice(0,64))+(r.val.length>64?'…':'')+'</span>')
                     :esc(r.val.slice(0,180));
      t.insertAdjacentHTML('beforeend','<tr'+(tell?' class="tell"':'')+'><td class="name">'+esc(r.name)+
        '</td><td class="dim">'+r.vlen+'</td><td>'+val+'</td></tr>');
    }
    out.appendChild(t);
  }
};
</script></body></html>`;

const server = createServer((req,res)=>{
  if (req.url === '/') { res.writeHead(200,{'content-type':'text/html'}); res.end(html); }
  else if (req.url === '/submit') {
    let b=[]; req.on('data',c=>b.push(c));
    req.on('end',()=>{ res.writeHead(200,{'content-type':'text/plain'}); res.end('00000000-0000-4000-8000-000000000000'); });
  } else { res.writeHead(200,{'content-type':'text/plain'}); res.end('ok'); }
});
await new Promise(r=>server.listen(PORT,'127.0.0.1',r));

const browser = await chromium.launch({ headless:false, args:['--window-size=1060,920'] });
const ctx = await browser.newContext({ viewport:{ width:1000, height:900 } });
const page = await ctx.newPage();

const L = cls => txt => page.evaluate(([c,t])=>window.__log(c,t), [cls,txt]).catch(()=>{});
const step = async (cls, txt)=>{ await L(cls)(txt); await new Promise(r=>setTimeout(r,500)); };
const sleep = ms => new Promise(r=>setTimeout(r,ms));

let captured = null;
await page.route('**/telemetry.js', r=>r.fulfill({ status:200, contentType:'application/javascript', body:PATCHED }));
await page.route('**/submit', async route => { captured = route.request().postDataBuffer(); await route.fulfill({ status:200, contentType:'text/plain', body:'00000000-0000-4000-8000-000000000000' }); });
await page.route('**/errors', r => r.fulfill({ status:200, contentType:'text/plain', body:'ok' }));

await page.goto(`http://127.0.0.1:${PORT}/`, { waitUntil:'load' });
await page.waitForFunction(()=>typeof window.telemetryjs==='function', { timeout:15000 }).catch(()=>{});
await L('dim')('[*] SDK loaded · auto-running collection …');
await page.evaluate(()=>window.__run());
await page.waitForFunction(()=>window.__done===true || window.__err, { timeout:60000 }).catch(()=>{});
await sleep(1500);

const saLog = await page.evaluate(()=>window.__saLog).catch(()=>[]);
const ddLog = await page.evaluate(()=>window.__ddLog).catch(()=>[]);
const caps = await page.evaluate(()=>{ const u8=window.__m&&window.__m.HEAPU8; if(!u8) return null;
  const u32=o=>u8[o]|(u8[o+1]<<8)|(u8[o+2]<<16)|(u8[o+3]<<24); const C=u32(17349*4);
  const b64=a=>{const CH=8192,p=[];for(let i=0;i<a.length;i+=CH)p.push(String.fromCharCode.apply(null,a.subarray(i,i+CH)));return btoa(p.join(''));};
  return {C,c96:b64(u8.slice(C+96,C+128)),tab:b64(u8.slice(8304,8336))}; }).catch(()=>null);

// decode helpers (same as payloadview.mjs)
const dec = bytes => { try { return new TextDecoder('utf-8',{fatal:false}).decode(bytes); } catch(_) { return Buffer.from(bytes).toString('latin1'); } };
const printable = bytes => { let ok=0; for (const b of bytes) if (b>=32 && b<127) ok++; return bytes.length>0 && ok>=bytes.length*0.85; };
const ddMap = new Map(); for (const d of ddLog) if (d.out && d.cb && !ddMap.has(d.cb)) ddMap.set(d.cb, d.out);
const nameStr = buf => { const s = dec(buf); if (/^[\x20-\x7e]{1,64}$/.test(s)) return s; return ddMap.get(buf.toString('base64')) || s; };

const rows = [];
for (const s of saLog) {
  if (s.err) continue;
  const name = nameStr(Buffer.from(s.nmB64,'base64'));
  const valBuf = Buffer.from(s.vlB64,'base64');
  const val = printable(valBuf) ? dec(valBuf) : valBuf.toString('hex');
  rows.push({ name, vlen: s.vlen, val, hex: !printable(valBuf) });
}
// dedupe (two serialization passes)
const seen = new Set(); const dedup = rows.filter(r=>{ const k=r.name+'|'+r.val; if (seen.has(k)) return false; seen.add(k); return true; });

// decrypt the real blob (correlate + show key/nonce)
if (captured && caps) {
  const blob = Buffer.from(captured.toString('utf8'),'base64');
  const key = Buffer.alloc(32);
  { const c96 = Buffer.from(caps.c96,'base64'), tab = Buffer.from(caps.tab,'base64');
    for (let i=0;i<32;i++) key[i] = c96[i]^tab[i]; }
  const d = createDecipheriv('aes-256-cbc', key, blob.subarray(64,80));
  const pt = Buffer.concat([d.update(blob.subarray(80)), d.final()]);
  const pad = pt[pt.length-1];
  const body = pad && pad<=16 ? pt.subarray(0, pt.length-pad) : pt;
  await step('ok','[+] decrypted real blob: magic '+body.subarray(0,4).toString('hex')+' (8e3421f0)');
  await L('dim')('    blob '+blob.length+'B · nonce '+blob.subarray(64,80).toString('hex'));
  await L('hex')('    AES-256 key = '+key.toString('hex'));
  mkdirSync('/tmp/opencode/stytch',{recursive:true});
  writeFileSync('/tmp/opencode/stytch/vis2-blob.bin', blob);
  writeFileSync('/tmp/opencode/stytch/vis2-key.hex', key.toString('hex')+'\n');
}
await step('acc','[*] rendering '+dedup.length+' readable records (deduped) …');
await page.evaluate(r=>window.__render(r), dedup);
await L('ok')('———— done · close the window to exit —————');

browser.on('disconnected', ()=> process.exit(0));
await new Promise(()=>{});
