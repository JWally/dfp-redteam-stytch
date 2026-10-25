# Stytch Device Fingerprinting — client-side drill-down (Twilio)

Authorized red-team on the **user's own stack**. Public SDK only
(`https://elements.stytch.com/telemetry.js`), dummy token
(`public-token-test`), local submit URLs — **no telemetry was ever sent to
Stytch**, no customer/auth/prod traffic touched.

## What we recovered (full chain)

The Stytch DFP SDK is C++/Emscripten compiled to **wasm2js** (no separate
`.wasm`). Client collects ~97 ordered events → serializes → encrypts with
**AES-256-CBC** → posts `text/plain` base64 to `/submit`.

```
wire blob   = [ 64B session material ][ 16B nonce = AES-256-CBC IV (plaintext) ][ AES-256-CBC ciphertext ]
AES-256 key = HEAPU8[C+96..C+128] XOR HEAPU8[8304..8336]   where C = u32(HEAPU8[17349*4])
plaintext   = magic(8e3421f0) | 64B session block | serialized telemetry | PKCS#7
```

Verified on many runs (magic `8e3421f0` always matches). The key is
**per-session** (recovered from the run's own module memory) — it is not a
static server secret.

### Readable payload (the browser tells)
Hooked the module's own serializer `sa(name, value)` + decoder `dd()` → the
actual shipped payload, field by field: `fp_*` hashes (audio/canvas/fonts/
webgl/gpu), `webdriver`, `webgl` (SwiftShader=headless), `UA`, `brand`,
`x_*` UA-CH, screen, timezone, bot/tamper signals.
See `STYTCH_DFP_RECON_2026_10_25.md` §9i and `artifacts/payloadview.json`.

### Tamper-and-reseal PoC
`scripts/stytch-dfp-tamper.mjs` — intercept `/submit`, read the key from the
heap, decrypt, modify the plaintext, re-encrypt with a **fresh** random nonce,
reship. `--dump` prints the would-be-sent payload instead of shipping.

```
node scripts/stytch-dfp-tamper.mjs            # attack mode (reship to local)
node scripts/stytch-dfp-tamper.mjs --dump     # print payload instead of shipping
```

## Honest boundary (interview framing)
The per-request nonce blocks **verbatim replay** of a captured blob, but not
**live tamper-and-reseal** — the key lives in the page's own memory and the
nonce isn't secret. The durable defense is **server-side**: cross-check
TLS/JA3/IP/UA/header consistency against the claimed payload, and bind each
request to server-issued state.

## Reproduce / run

```bash
# 1. fetch + pretty-print the real telemetry.js, then apply read-only dd()/sa() hooks
bash scripts/fetch_and_patch_stytch.sh
python3 scripts/patch_stytch_bundle.py        # → st-beautified-sa.js / -dd.js

# 2. capture key material + blob in one run
node scripts/stytch-dfp-final.mjs             # writes final-caps.json + final-blob.bin

# 3. decrypt
python3 scripts/stytch_dfp_decrypt.py         # key = C+96 XOR table8304, AES-256-CBC

# 4. readable payload
node scripts/stytch-dfp-payloadview.mjs
```

The `stytch-dfp-*.mjs` scripts reference the patched bundle at
`/tmp/opencode/st-beautified-sa.js` (edit the path at the top if you keep it
elsewhere). Requires `node` + `playwright` (+ chromium) and
`pycryptodome`/`Crypto`.

## Key files
- `STYTCH_DFP_RECON_2026_10_25.md` — the full writeup (§9g decrypt, §9h tamper
  PoC, §9i readable payload, §10 honest limitations)
- `scripts/stytch_dfp_decrypt.py` — verified decrypt (uses `aes_correct.py` /
  `pycryptodome`; the bundled `aes256.py` is the buggy earlier version, kept
  for reference only)
- `scripts/stytch-dfp-tamper.mjs` / `-tamper-visual.mjs` — reship PoC (headless
  / visible-browser variants)
- `scripts/stytch-dfp-payloadview.mjs` / `-payloadview-visual.mjs` — readable
  payload dump (headless / visible-browser variants)
- `scripts/stytch-dfp-dd.mjs` — 301 decoded field-name schema via `dd()` hook
- `scripts/stytch-dfp-input.mjs` — the ordered 97-event input stream capture
- `artifacts/MANIFEST.md` — curated artifacts + where full raw captures live

## Scope & honesty
- Authorized, own-stack only; public bundle; dummy token; local submit.
- **Do not overstate:** the key is per-session, replay is blocked by the nonce,
  and the readable payload is from a headless test browser (the tells are the
  point of the demo, not "real user" data).
