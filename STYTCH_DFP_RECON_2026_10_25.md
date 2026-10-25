# Stytch Device Fingerprinting (DFP) — client-side drill-down

**Date:** 2026-10-25
**Context:** Twilio acquired Stytch (announced 2025-10-30, completed
2025-11-14). Stytch DFP is the C++→WASM device-intelligence product.
**Scope:** public client assets + public docs. `GetTelemetryID()` was run
against a **local submit URL**, so no signals were sent to Stytch.
**Artifacts:** `bots/stytch-dfp-probe.mjs`, `stytch-dfp-signals.mjs`,
`stytch-dfp-heap.mjs`; captures under `/tmp/opencode/stytch/`.

---

## 1. Executive summary

Stytch DFP is a **C++/Emscripten** device-intelligence bundle exposed as a
single global, `GetTelemetryID()`. The public `telemetry.js` is **386 KB** and
contains the compiled module as **wasm2js** (plus the Emscripten runtime and
encrypted data segments); in our run it did **not** fetch a separate `.wasm`
(`g.wasm` returns 403; only `telemetry.js` and the submit POST were requested).

The flow is clean and server-centric:

```
<script src="https://elements.stytch.com/telemetry.js"></script>
GetTelemetryID({ publicToken }) 
   → C++/WASM collects signals
   → one ~1.4 KB encrypted/encoded base64 blob
   → POST https://telemetry.stytch.com/submit
   → 36-char telemetry_id

backend:
POST https://telemetry.stytch.com/v1/fingerprint/lookup
   Authorization: project_id:secret
   { "telemetry_id": "..." }
   → fingerprints (visitor/browser/hardware/network)
   → verdict { action: ALLOW|BLOCK|CHALLENGE, reasons, is_authentic_device, ... }
```

The client **never sees the verdict**. The public token is client-side; the
project secret stays backend. That is a much stronger trust split than
Oscilar's client-visible `beaconIDs`/`d` model.

Observed client-side signals: UA/platform/device memory/touch, screen, canvas
2D, WebGL renderer/extensions/readPixels, OfflineAudioContext, Intl/timezone,
random seeds, an iframe/canvas. The payload is **1,376 bytes at 7.86 entropy**,
base64, no zlib/gzip/brotli header — opaque/encrypted. No native
`crypto.subtle`, no JSON.stringify payload, no workers observed.

The docs claim “tamper-resistant design: encryption, obfuscation, proprietary
tamper detection,” verdicts/reasons for `HEADLESS_BROWSER_AUTOMATION`,
`VIRTUAL_MACHINE`, `SMART_RATE_LIMIT_WARNING`, and user-agent spoofing. The
client only gets a telemetry ID; the server computes the fingerprints and
verdict.

---

## 2. Where it lives / docs

- Script: `https://elements.stytch.com/telemetry.js` (S3/CloudFront,
  `access-control-allow-origin: *`, `cache-control: max-age=3600`, 386,109 B).
- Submit: `https://telemetry.stytch.com/submit` (POST `text/plain`, base64).
- Lookup: `POST https://telemetry.stytch.com/v1/fingerprint/lookup`
  (basic auth `PROJECT_ID:SECRET`).
- Docs:
  - `https://stytch.com/docs/fraud-risk/device-fingerprinting/overview`
  - `.../fingerprints`
  - `.../verdict/overview`
  - `https://stytch.com/docs/fraud-risk/get-started/using-dfp-api`
- Trial: `https://offers.stytch.com/dfp-30-day-trial` — a **HubSpot form**
  (“demo with an auth expert”), i.e. sales-assisted, not instant self-service.
  The Stytch dashboard `start-now` is self-service for the auth product; DFP
  needs access/trial.

---

## 3. The client bundle (how it feels)

`telemetry.js` starts as an Emscripten module:

```js
var telemetryjs = (() => { ... })();
...
(()=>{ const e = telemetryjs();
  window.GetTelemetryID = async function(t="66ea…", n="https://telemetry.stytch.com/submit") { ... }
})()
```

Emscripten/C++ fingerprints in the bundle:

- `emscripten::val`, `emscripten::memory_view<...>`, `std::string`,
  `std::wstring`, `__cxa`, `dynCall_*`, `HEAP8/16/32/U8/U16/U32/F32/F64`,
  `BindingError`, `UnboundTypeError`.
- WASM/wasm2js exports: `GetTID`, `GetPID`, `GetVS`, `GetIS`, `_main`,
  `Ready`, `rids`, `HEAPU8` (1 MB).
- Data segments are emitted as
  `F(E, offset, "base64…")`; 228 segments, ~77 KB of base64. The runtime data
  is mostly zlib/C++ runtime strings; app strings are obfuscated/encrypted
  (heap scan at rest found only 281 strings, essentially `GetTID`).
- `wasmBinary`/`g.wasm` references exist, but `https://elements.stytch.com/g.wasm`
  is **403** and no `.wasm` request occurs at runtime. The public bundle runs
  the **wasm2js** module. The docs say “WebAssembly binary”; the observed
  delivery is the JS fallback/single-file build.

The C++ module uses JavaScript through `emscripten::val`; the global wrapper
handles the public token, submit URL, 16 s timeout, error reporting, and a
fallback UUID.

### `GetTelemetryID()` wrapper details

- `publicToken` must be a string starting with `public-token`.
- `submitURL` can be overridden; the code accepts `http` as well as `https`,
  appends `/submit` if needed.
- Calls `s.GetTID({ a: publicToken, b: submitURL, c: platform, d: resolve })`.
- Expects a 36-char response; only checks `o.length != 36` — no signature or
  server-authenticity check on the returned telemetry ID.
- On any error it:
  - collects `_GetPID()`, `_GetVS()`, `_GetIS()`, `rids`, timing, platform,
    UA, origin, public token, `exvers:"1.19.0"`;
  - POSTs `btoa(JSON.stringify(...))` to `https://<submit-host>/errors`;
  - returns the **hardcoded fallback UUID**
    `4fd394a2-bc99-47c5-86d2-64414ee3d1db`.
- The default public token `66ea1e87-…` is a placeholder that fails the
  `public-token` prefix check if used without arguments.

---

## 4. Runtime flow (observed)

Local page + public `telemetry.js`; `GetTelemetryID({publicToken:
'public-token-test', submitURL:'http://127.0.0.1:8805/submit'})`:

| Step | Observed |
|---|---|
| GET | `https://elements.stytch.com/telemetry.js` 200 (386,109 B) |
| POST | `http://127.0.0.1:8805/submit` `text/plain;charset=UTF-8`, **1,836 chars / 1,376 bytes** |
| Response | `00000000-0000-4000-8000-000000000000` → resolved as the telemetry ID |
| Other network | none (`g.wasm` not fetched; no XHR; no workers) |

Submit body: base64 text, decoded entropy **7.86**, no zlib/gzip/brotli
header, first bytes `fc c5 7b 1f a7 07 27 40…`, tail high-entropy. It is
opaque/encrypted; not JSON, not MessagePack, not plaintext.

No native `crypto.subtle` calls; no `JSON.stringify` payload; no
`TextEncoder`; no `WebAssembly` runtime calls (wasm2js).

---

## 5. Signal surface observed

Hooked JS APIs during the run:

| Area | Observed |
|---|---|
| `navigator` | `cookieEnabled`, `platform` (`Linux x86_64`), `userAgent` (`HeadlessChrome/148`), `hardwareConcurrency` (12), `deviceMemory` (32), `maxTouchPoints` (0) |
| `screen` | `width` 1280, `height` 720, `colorDepth` 24 |
| Canvas 2D | `getContext('2d')`, `toDataURL` (~20,334 chars), second 2D canvas `toDataURL` (~622 chars), `getImageData`/`measureText` available |
| WebGL | `getContext('webgl')` twice; `WEBGL_debug_renderer_info`; vendor `Google Inc. (Google)`; renderer `ANGLE (Google, Vulkan 1.3.0 (SwiftShader…))`; `readPixels(256×128)` |
| Audio | `OfflineAudioContext(1, 5000, 44100)` twice; `OfflineAudioContext(1, 256, 44100)` |
| Intl | `Intl.DateTimeFormat()` (timezone/locale) |
| Elements | `details`, `input`, `iframe`, `canvas`, `div`, `canvas` |
| Random | `crypto.getRandomValues`: 1024, 4, 16 bytes |
| Misc | `fetch` 1×; XHR 0; `sendBeacon` 0; `crypto.subtle` 0; workers 0 |

The iframe is likely the C++/Emscripten realm/sandbox helper; the two canvases
and two OfflineAudioContexts are the classic 2D/WebGL/audio fingerprint set.

The docs summarize the categories as browser type, screen size, OS, time zone,
IP/geo, plus “industry-standard and proprietary signals,” warning flags, and
deterministic fingerprints.

---

## 6. Docs: IDs, fingerprints, verdicts

**IDs/fingerprints (lookup response):**

- `visitor_id` — stateful cookie; guaranteed unique.
- `browser_id` — visitor ID + hardware fingerprint; stolen-session detection.
- `visitor_fingerprint` — highly unique diverse signals; 99.9% unique.
- `browser_fingerprint` — browser on a device class.
- `hardware_fingerprint` — OS/architecture.
- `network_fingerprint` — TLS fingerprint; blocks Go/Curl/Node.

**Verdict:**

```json
{
  "verdict": {
    "action": "ALLOW | BLOCK | CHALLENGE",
    "detected_device_type": "APPLE_CHROME",
    "is_authentic_device": true,
    "reasons": ["HEADLESS_BROWSER_AUTOMATION", "VIRTUAL_MACHINE", ...]
  }
}
```

- `ALLOW` — no warning flags / known-good configuration.
- `BLOCK` — automation/spoofing undesirable.
- `CHALLENGE` — unusual configuration; add 2FA/verification.
- Reasons include headless automation (Puppeteer), VM, Intelligent Rate
  Limiting, UA spoofing.
- `is_authentic_device` is false if browser deception is detected.
- Multiple reasons → strictest action (`BLOCK` > `CHALLENGE` > `ALLOW`).

**Protected Auth:** if you use Stytch auth, DFP verdicts can be enforced
automatically (allow/block/challenge) with no-code changes.

---

## 7. Twilio / Stytch context

- Twilio announced the Stytch acquisition 2025-10-30; completed 2025-11-14.
- Stytch is positioned as an identity platform for AI agents: verification,
  permissions, access controls, delegation, audit actions.
- DFP is a standalone fraud/risk product and integrates with Stytch auth via
  Protected Auth.
- The DFP 30-day trial is a **HubSpot demo form**, not instant self-service;
  the core Stytch dashboard signup is self-service for auth.
- Public Twilio login still loads the legacy `login-ui` bundle, not
  `elements.stytch.com/telemetry.js` in our check. The new identity flows are
  where Stytch is likely to appear.

---

## 8. How it compares to Oscilar

| | Stytch DFP | Oscilar `zqp` |
|---|---|---|
| Core | C++ → Emscripten/wasm2js | AssemblyScript/WASM |
| Public bundle | 386 KB `telemetry.js` (no separate `.wasm` observed) | 570–671 KB JS + 266–325 KB WASM |
| Client API | `GetTelemetryID()` → 36-char ID | loader config + `{beaconID,data}` |
| Payload | ~1.4 KB encrypted base64 | 12–16 KB encrypted binary |
| Client verdict? | **No** — only telemetry ID | No risk verdict, but `beaconIDs`/`d` |
| Backend | `POST /v1/fingerprint/lookup` with project secret → fingerprints + verdict | merchant decision plane |
| Crypto | opaque/encrypted blob; no `crypto.subtle` observed | ChaCha20 state leak, fixed key |
| Identity | server-side visitor/browser/hardware/network fingerprints | client-asserted `browserFingerPrint`, `device_id` |
| Tamper posture | compact/obfuscated/encrypted; server-side verdict; docs claim tamper resistance | WASM memory readable; key leak; client-asserted signals |
| Self-service | DFP trial via HubSpot/demo; auth dashboard self-service | sales-led; no public signup |

The Stytch model is cleaner: the client gets a telemetry ID, not a verdict;
the backend lookup requires the secret. The client still controls the
signals — the server-side tamper detection/verdict is the boundary. The
C++/wasm2js + encrypted blob raises reverse-engineering cost compared with
Oscilar's exposed AssemblyScript memory.

---

## 9. Interview talking points / questions

**Architecture**

- The public script is a C++/Emscripten single-file wasm2js bundle with a tiny
  global API; the logic is in the compiled module, not readable JS.
- The submit payload is compact and opaque; the client only receives a
  telemetry ID; the verdict/fingerprints are server-side.
- The public token is not a secret; the project secret is backend-only. This
  is the right split.

**Security/design questions**

1. The client accepts any 36-char string from the configured `submitURL` as a
   telemetry ID. What prevents a compromised/misconfigured submit URL (or a
   MITM if `http` is used) from returning a fake ID? The backend lookup is the
   real check — how does the app fail if the lookup returns unknown/expired?
2. On error, `GetTelemetryID` returns a hardcoded fallback UUID. Is that
   treated as “no signal” / fail-open by Protected Auth? What should
   integrators do?
3. `submitURL` can be `http://` and is caller-configurable. Do you enforce
   HTTPS/allowlist in the SDK or docs?
4. The client signals are still spoofable (UA/platform/canvas/WebGL/audio).
   Which tamper detection is server-side vs client-side? How do you use
   TLS/JA3, UA-CH, IP/ASN, and cross-signal consistency?
5. The error path posts base64 JSON with platform, UA, origin, public token,
   request IDs, and timing to `/errors`. What is retained, and what is the
   privacy story?
6. How does DFP interact with Protected Auth / Stytch sessions? Is the
   telemetry ID bound to a session/user, and what is the replay window?
7. The docs say “WebAssembly binary,” but the public bundle runs wasm2js and
   `g.wasm` is 403. Is that a packaging/fallback detail, a CDN issue, or a
   deliberate single-file build?
8. How does Stytch DFP compare with Fingerprint (Oscilar’s partner) and other
   device-intel vendors on stability, uniqueness, and tamper resistance?

**Twilio/company**

- How does DFP fit the “identity for AI agents” story (agent identity,
  delegation, audit)?
- What changes for Stytch customers post-acquisition (API/branding/support,
  Twilio identity bundling)?
- Where is DFP enforced in Twilio’s own flows vs customer flows?

---

## 9b. Deeper dig: marker + field-schema attempts (2026-10-25)

Follow-up passes on the payload/schema question.

### Marker test — the signals are NOT shipped in plaintext

Injected unique marker values into the signal sources and hooked the JS
getters (so we know the C++ collector *read* them), then scanned the wire
blob:

- `navigator.userAgent` → `"MARKERUA31337QQQ"`
- `navigator.platform` → `"MARKERPLATFORM31337"`
- `navigator.hardwareConcurrency` → 47, `deviceMemory` → 79, `maxTouchPoints` → 97
- `screen.width/height` → 31337 / 41337, `colorDepth` → 33

Result: the getters **fired** (returned the markers), but **none** of the
markers appeared in the decoded blob — not as ASCII, UTF-16, or base64. The
blob is high-entropy from byte 0 (no magic, no length prefix, no gzip/zlib/
OpenSSL header). Conclusion: **the C++ module compresses/encrypts the signals
before shipping.** The exact serialized field names/values are not recoverable
from the wire blob or the heap at the `fetch` boundary (heap at rest contained
only C++/zlib runtime strings, not the signal values).

### Payload size is not fixed (correcting an earlier note)

- `GetTelemetryID()` clean/diff runs → base64 1,836 chars → **1,376 bytes**.
- `m.GetTID()` direct + marker-spoofed inputs → base64 1,624 chars →
  **1,216 bytes**.

So the payload has variable length depending on content/compression (the
marker-spoofed UA/platform/screen were shorter than the real ones). The
`crypto.getRandomValues` calls are 1024, 4, and 16 bytes — consistent with
"1024 B random padding + 4 B counter + 16 B nonce/IV" around a smaller
compressed+encrypted signal envelope, but this is not confirmed.

### String bridge only carries config

Patching the Emscripten `std::string` JS→C++ `toWireType` bridge logged only
**three** strings for a `GetTID` call: the public token, the submit URL, and
the platform string (the `{a,b,c}` config). The fingerprint signals do **not**
cross the `std::string` bridge — they travel through the minified
`emscripten::val` / `_emval_*` path (which was stripped to bare minified
symbols; only the string `_emval_take_value` survived).

### Field-schema attempts (Proxy / exhaustive prototype hooks)

- A `Proxy` over `window.navigator/screen/document/performance` logged **zero**
  accesses — the collector resolves the objects directly rather than through
  the `window` getter.
- An exhaustive wrap of every own property on `Navigator`/`Screen`/`Document`
  prototypes also logged zero, because the collector holds references that
  bypass those prototype objects (same-origin iframe or direct native refs).

The reliable, observed signal surface (from the earlier working hooks) remains:

```
navigator: cookieEnabled, platform, userAgent, hardwareConcurrency,
           deviceMemory, maxTouchPoints
screen:    width, height, colorDepth
canvas2d:  getContext('2d'), toDataURL, getImageData, measureText
webgl:     getContext('webgl'), getExtension('WEBGL_debug_renderer_info'),
           getParameter(UNMASKED_VENDOR/RENDERER), readPixels(256x128)
audio:     OfflineAudioContext (5000 and 256 samples)
intl:      Intl.DateTimeFormat (timezone/locale)
random:    crypto.getRandomValues (1024, 4, 16 bytes)
network:   one POST /submit
```

### Bottom line on "what are they shipping"

- **Definitely shipped:** a compact, compressed/encrypted, high-entropy
  blob (~1.2–1.4 KB) whose plaintext contains the UA/platform/screen/canvas/
  WebGL/audio/timezone signals. `POST` `text/plain` base64 to `/submit`.
- **Not shipped in plaintext:** any signal value or field name; the envelope
  is opaque. Recovering the exact schema requires reverse-engineering the
  minified C++/wasm2js module (zlib + a stream/AEAD cipher + custom padding),
  which is a real effort — exactly the "tamper-resistant design" the docs
  advertise.

## 9c. Reverse-engineering pass — what we recovered (2026-10-25)

Pushed the dig with heap dumps taken **immediately after each signal API
fired** (14 dumps across navigator/screen/canvas/WebGL/audio/random/fetch).
Findings:

### It is definitely C++, running as wasm2js

- `emscripten::val`, `std::string`/`std::wstring`, `emscripten::memory_view<*>`,
  `__cxa*`, `dynCall_*`, `BindingError`, `HEAP8/16/32/U8/U16/U32/F32/F64`,
  and data segments written as `F(E, offset, "base64")`.
- No AssemblyScript markers (`__new`/`__pin`/`__collect`/`__rtti_base`), no
  separate `.wasm` fetched (`g.wasm` is 403). Single-file wasm2js.

### Signal values ARE in the heap as C++ strings (length-prefixed)

Reading `HEAPU8` right after the getters fired shows the collector storing
each value as a C++ `std::string` (SSO/length-prefixed) in linear memory:

- After `getParameter`: the **full font-detection list** is present:
  `|Arial Baltic|Arial Black|Arial CE|Arial CYR|Arial Greek|Arial TUR|Arial|Batang|Baty\n…`
  adjacent to our marker UA `MARKERUA31337QQQ`.
- The **font-detection mechanism is a C++-driven CSS probe**; the heap contains
  the template:
  `display:inline !important; width:auto !important; font:normal 10px/1 '%s',sans-serif !important">wwmmllii`
  plus `: absolute; visibility: hidden; display: block !importan…`.
  That's the classic "draw `wwmmllii` in a font, measure width" detector,
  reimplemented in C++, driven via `emscripten::val` against a hidden element.
- The property-name strings the C++ queries via `emscripten::val` are visible:
  `userAgent`, `platform`, `width`, `height`, `colorDepth`, `deviceMemory`,
  `hardwareConcurrency`, `maxTouchPoints`, `UNMASKED_RENDERER_WEBGL`,
  `getParameter`, plus `OfflineAudio`/`OfflineAudioContext` artifacts.

### Confirmed signal surface (observed in hooks + heap)

```
navigator: userAgent, appVersion, platform, hardwareConcurrency,
           deviceMemory, maxTouchPoints, cookieEnabled
screen:    width, height, colorDepth
canvas2d:  getContext('2d'), toDataURL, getImageData, measureText
webgl:     getContext('webgl'), getExtension('WEBGL_debug_renderer_info'),
           getParameter(UNMASKED_VENDOR/RENDERER_WEBGL), readPixels(256x128)
audio:     OfflineAudioContext (5000 and 256 samples)
intl:      Intl.DateTimeFormat (timezone/locale)
fonts:     CSS width-probe font detector → pipe-delimited available-font list
random:    crypto.getRandomValues (1024, 4, 16 bytes)
network:   one POST /submit (base64)
```

### Where the schema stops being readable

- The **C++ string constants are obfuscated**: most 3-char strings in the data
  section are junk (encrypted/obfuscated literals), so the **JSON field names**
  the C++ uses to serialize are not plaintext in the heap.
- No JSON object (`{...}` with readable keys) appears in any heap capture; the
  serialized form is a **binary/length-prefixed structure**, compressed and
  encrypted before `fetch`. Markers injected into UA/platform/screen were in
  the heap but **never** in the wire blob (confirmed earlier).
- Recovering the exact wire schema requires decrypting the C++ data section
  / decompiling the wasm2js crypto path — a multi-hour job on 386 KB of
  optimized wasm2js. This is the "tamper-resistant design" the docs advertise.

### Bottom line for the interview

We can prove: (1) real C++/Emscripten wasm2js, (2) the exact collector
mechanism including the CSS font probe and WebGL/canvas/audio reads, (3) the
values live in linear memory as plaintext C++ strings until serialization,
(4) the shipped blob is opaque/compressed/encrypted with no readable keys, and
(5) the client never sees the verdict. That's a strong, concrete RE story
without needing the full schema — and it demonstrates exactly the
"understand C++ and RE" skill the JD wants.

## 9d. The input stream — what actually goes INTO the wasm (2026-10-25)

Hooked every JS API the C++ touches (navigator/screen/canvas/WebGL/audio/
Intl/random/fetch/DOM), with markers, and captured the **complete ordered
input stream** (97 events). The collector runs **two full rounds** before
shipping. Here's the exact shape of what flows in, in order:

```
ROUND 1 (then ROUND 2 repeats)
 1. navigator.cookieEnabled                      = true
 2. crypto.getRandomValues(1024)                  <- 1024 random bytes (seed/padding)
 3. navigator.platform / userAgent /
    hardwareConcurrency / deviceMemory /
    maxTouchPoints / language / languages / webdriver
 4. screen.width / height / colorDepth
 5. Intl.DateTimeFormat().resolvedOptions()
      -> {locale, calendar, numberingSystem,
          timeZone:"America/Chicago", year, month, day}
 6. new OfflineAudioContext(1, 5000, 44100)      <- audio probe #1 (x2)
 7. DOM: createElement('details'), ('input'),
    navigator.userAgent (again), createElement('iframe')
 8. CANVAS 2D:
      createElement('canvas'); getContext('2d')
      fillText("i9asdm..$#po((^@KbXrww!~cz", 2, 15)   <- fixed noise string
      fillText(same, 4, 17)
      toDataURL()  -> 20 KB base64 PNG (canvas hash)
 9. createElement('div')
10. WEBGL:
      createElement('canvas'); getContext('webgl')
      navigator.userAgent (again)
      getExtension('WEBGL_debug_renderer_info')
      getParameter(37445) UNMASKED_VENDOR_WEBGL   -> "Google Inc. (Google)"
      getParameter(37446) UNMASKED_RENDERER_WEBGL -> "ANGLE (Google, Vulkan 1.3.0 (SwiftShader...))"
      (second canvas) getContext('webgl')
      readPixels(0,0,256,128, 6408, 5121)         <- RGBA 256x128 read
11. navigator.userAgent (again)
12. DOM: createElement('style'), ('div') x2
13. new OfflineAudioContext(1, 256, 44100)        <- audio probe #2
14. CANVAS 2D round 2:
      createElement('canvas'); getContext('2d', {willReadFrequently:true})
      toDataURL('image/png')                       <- smaller canvas (622 B PNG)
      getImageData(0,0,64,64)                      <- pixel read
15. crypto.getRandomValues(4)
   ... round 2 repeats 1-15 ...
16. crypto.getRandomValues(16)                     <- 16-byte nonce/IV
17. fetch(POST /submit)  body = base64 blob (1624 chars)
```

### Key takeaways on the shape

- **Scalar signals** (UA/platform/hardware/deviceMemory/touch/screen/colorDepth)
  read via `emscripten::val` and stored in `HEAPU8` as C++ `std::string`s.
- **Timezone** comes from `Intl.DateTimeFormat().resolvedOptions()` —
  locale, calendar, numberingSystem, timeZone, plus the format fields.
- **Canvas fingerprint** = draw a fixed pseudo-random string
  (`i9asdm..$#po((^@KbXrww!~cz`) at two positions, then `toDataURL()` (big PNG),
  plus a second canvas (`willReadFrequently`) with `toDataURL` + `getImageData(0,0,64,64)`.
- **WebGL** = vendor + renderer via `getParameter(UNMASKED_*)` + a
  `readPixels(0,0,256,128, RGBA, UNSIGNED_BYTE)` of the WebGL canvas.
- **Audio** = two `OfflineAudioContext` probes (5000 and 256 samples at 44.1 kHz).
- **Fonts** = the CSS width-probe (template in section 9c), driven by C++ via a
  hidden element; produces the pipe-delimited font list.
- **iframe + details/input/style/div elements** are created — likely a
  hidden/sandboxed realm for some checks.
- **`crypto.getRandomValues`: 1024 + 4 + 16 bytes** — the 16 bytes fire right
  before the POST (consistent with an encryption nonce/IV).
- **It collects twice** (two identical rounds) before POSTing — consistent with
  an initial "baseline" pass and a re-profile, or a deliberate redundancy.

This is the definitive answer to "what goes into the WASM": the full ordered
set of browser reads above. The **output schema** (how C++ names/orders these
in the final blob) is still hidden by the compressed/encrypted envelope, but
every input is now observed and labeled.

## 9e. Compiled internals + wire-format RE (2026-10-25)

Citizen Lab–style deep-dive on the compiled module. What we definitively
recovered, and where the real boundary is.

### The compiled artifact

- **C++/Emscripten, wasm2js** (single file, no `.wasm` fetched). `emscripten::val`,
  `std::string`/`std::wstring`, `__cxa*`, `dynCall_*`, `HEAPU8`, data segments
  `F(E, offset, "base64")`.
- **The runtime data section (decoded into the heap) contains a complete AES
  implementation:**
  - AES S-box (256 B) at `0x8450` — exact match
  - AES inverse S-box (256 B) at `0x8560` — exact match
  - AES key-schedule Rcon (`01 02 04 08 10 20 40 80 1b 36`)
  - CRC32 table (`edb88320`) at `0x9110`
  - zlib inflate/deflate error strings (decompression present)
- No standard-crypto constants in the **raw bundle** — the data section is
  obfuscated/encrypted and decodes at runtime (that's why the S-box only
  appears in the heap).

### Wire format (from a differential: two runs, fixed randomness, width 31337→41337)

- Two blobs were **identical for the first 112 bytes**, differing from byte 112
  in long contiguous runs.
- `1328 − 112 = 1216` bytes payload — **block-aligned (76 AES blocks)**.
- The **16-byte `getRandomValues` nonce is embedded in PLAINTEXT at header
  offset 64** (`05 06 07 08 09 0a 0b 0c 0d 0e 0f 10 11 12 13 14` when forced).
- Encryption is **deterministic under fixed randomness** ⇒ static key + the
  embedded nonce. The key is not a raw heap value (heap-window AES key scan
  produced only 1-in-65536 false positives).

So the wire envelope is:

```
[112-byte header: 64 B config/hash | 16 B NONCE (plaintext!) | 32 B hash]
[1216-byte AES-CTR(zlib(serialized_signals)) payload]
```

### What this means

- **The nonce ships in the clear.** That's a real, concrete finding: the
  per-request IV is visible at a fixed header offset, so anyone who recovers
  the static key (or captures it) can decrypt/replay.
- **AES + zlib + CRC32 are all present in the compiled binary** — we identified
  the exact primitives from the recovered tables.
- **The payload schema is one layer deeper**: the key is derived or stored in
  the encrypted/obfuscated data section, so recovering it requires
  decompiling the wasm2js encryption function (data-section decrypt + key
  schedule) — a multi-hour Ghidra/wasm2js RE step. That's the honest boundary
  of this pass.

### How this answers the Citizen Lab question

Yes — this is exactly how a compiled-RE review proceeds: confirm the toolchain
(C++/wasm2js), map the inputs (full ordered signal stream), recover the
embedded crypto constants (AES S-box/inv-S-box/Rcon, CRC32, zlib), reverse the
wire envelope (112-byte header + 1216-byte payload, plaintext nonce at
offset 64), and stop at the key-derivation inside the obfuscated section. The
findings are concrete (AES, clear nonce, block-aligned payload, deterministic
under fixed randomness) even though full plaintext recovery needs the next
RE step.

### Final verdict on the key

The static AES key is **not recoverable by scanning the runtime heap** (16-byte
and 32-byte window scans with ~10 IV candidates and CBC/CTR all produced only
1-in-65536 false positives). The key is **derived or stored inside the
encrypted/obfuscated data section**, so recovering it requires statically
decompiling the wasm2js AES key-schedule/encrypt function (the ~3,000-line
minified function referenced by the S-box at `0x8450`) and tracing how the
key bytes are produced. That is the genuine Citizen Lab boundary: a
multi-hour Ghidra/`wasm2js` decompilation step.

What this means for an interview: **do not claim the key was recovered.** The
credible, impressive story is precisely what we did:

1. Confirmed it is C++/Emscripten wasm2js (not TS→WASM) from
   `emscripten::val`, `std::string`, `__cxa*`, `HEAPU8`, `F(E,offset,b64)`.
2. Mapped the **full ordered input stream** (every signal the collector reads,
   twice) with marker-spoofed values.
3. Recovered the **crypto primitives from the binary's runtime data section**:
   AES S-box + inverse S-box + Rcon, CRC32 table, zlib inflate/deflate.
4. Reverse-engineered the **wire envelope** by differential analysis
   (fixed randomness, one-field change): `[112-byte header][1216-byte
   block-aligned payload]`, with the **16-byte nonce shipped in plaintext at
   header offset 64**.
5. Proved the encryption is **deterministic under fixed randomness** ⇒ a
   static key, and that the payload is **compressed before encryption**
   (single-field change → long-run ciphertext differences).
6. Showed the key is **not a raw heap value** and identified exactly where it
   hides (derived/obfuscated data section), which is the decompile-the-
   encrypt-function step.

That is a complete, honest Citizen Lab–style pass with real, concrete
findings — and it's a much stronger interview answer than overstating.

## 9f. Key extraction + exhaustive crypto attempts — final honest state (2026-10-25)

### Extracted

- **Static AES-256 key** from the module's own global pointer (`a[17349]` → struct `C`, key at `C+96`):
  `10601075439fb856977addbebd93ff8b654a804a0ff3292bd2365882ecb0e6d8`
  (captured by reading `HEAPU8[17349*4]` as the struct pointer, then the 32 bytes at `+96`).
- **Wire format** (differential, fixed randomness): `[112-byte header][block-aligned payload]`,
  with the **16-byte nonce in plaintext at header offset 64**; deterministic under fixed randomness.
- **Crypto primitives in the binary**: AES-256 S-box/inv-S-box/Rcon, CRC32, zlib.
- **Key-expansion (`de`) hook**: ~1,600 AES-256 key expansions during one telemetry run, with 303 distinct derived keys and 440 distinct IVs — the module runs many independent AES operations (string-section decrypt, PRNG, MAC, etc.), not one simple CBC chain.

### Decryption attempts (all with AES verified against PyCryptodome)

Tested against the payload (multiple consistent runs, known markers):

| keys | modes | IVs | result |
|---|---|---|---|
| static key (32B) | CBC, CTR, ECB, CFB, OFB, GCM | nonce, all 7 header words, zeros, embedded | no |
| 303 `de()` keys (32B) | CBC, CTR, GCM | header words, zeros, embedded | no |
| 608 × 16-byte subkeys | CBC, CTR, CFB, OFB | header words, nonce | no |
| all (key, IV) pairs from `de()` hook | CBC, CTR | their own struct IVs | no |
| all `de()` schedules | CBC | header words | no |
| codec scan | zlib/gzip/brotli/zstd/LZ4 | any offset | no |

### Conclusion

The payload is **not** decryptable with standard AES (any extracted key) or standard compression. It uses either a **custom cipher / custom compression**, or a key derived via a KDF hidden inside the obfuscated data section. Recovering it requires **full static decompilation of the wasm2js transform function** (the ~2,000-line function referenced by the S-box at `0x8450`), tracing the exact serialization → compression → key-derivation → encryption. That is the genuine Citizen Lab boundary: a multi-hour Ghidra/`wasm2js` job.

**Do not claim the payload was decrypted or the payload key recovered.** The credible story is exactly what was done:

1. Real C++/Emscripten wasm2js confirmed (emscripten::val, std::string, __cxa, HEAPU8).
2. Full ordered input stream mapped with markers (all signal sources, twice).
3. Crypto primitives recovered from the binary (AES-256 tables, CRC32, zlib).
4. A real static AES-256 key extracted from the module's own memory.
5. Wire format reversed: 112-byte header + block-aligned payload, **nonce in plaintext at offset 64**.
6. Encryption proven deterministic under fixed randomness (⇒ static key material) — but not standard-AES with any extractable key.
7. Exhaustive, correct crypto analysis showing exactly what was tried and where the boundary is.

## 9g. ✅ DECRYPTED — full key + payload + schema (2026-10-25)

After extensive RE (including a parallel static-analysis pass), the telemetry
wire blob is **fully decrypted**. This is the complete result.

### The wire format (verified by decryption)

```
blob[0:64]   64 bytes per-session public-key/session material (XOR-obfuscated)
blob[64:80]  16-byte nonce = AES-256-CBC IV (PLAINTEXT)
blob[80:end] AES-256-CBC ciphertext, PKCS#7 padded
```

Decrypted plaintext:

```
[0:4]    magic 8E 34 21 F0
[4:68]   64 bytes per-session material (from the module's key-derivation/ECDH-like step)
[68:..]  serialized telemetry payload (opaque field records, decoded names below)
[..end]  PKCS#7 padding
```

### The AES key (per page session)

The module stores the AES key **XOR-obfuscated** in its crypto-context struct:

```
C    = u32(HEAPU8[17349*4])          // struct pointer
raw  = HEAPU8[C+96 .. C+128]         // XOR-obfuscated key material
tab  = HEAPU8[8304 .. 8336]          // 256-byte XOR table at heap offset 8304
AES-256 key = raw[i] XOR tab[i]  for i in 0..31
```

For the captured session (forced randomness):

```
raw = 1e6ad4c4a6a88a6ef9ebd24733d7f1650a39e26c544ea04f1d421a84a4a1ce28
tab = c681363a7569370b1eb59f19124456d0747c9a44f8b5bdf95264b66a0618cc8e
KEY = d8ebe2fed3c1bd65e75e4d5e2193a7b57e457828acfb1db64f26aceea2b902a6
IV  = blob[64..80] (nonce)
```

Decrypt with AES-256-CBC. Verified on multiple runs (magic `8e3421f0` matches).

### The decrypted payload schema (301 decoded field-name strings via `dd()` hook)

The serialized payload fields are name/values with the names decoded by the
module's `dd()` string decoder. Captured decoded constants reveal the full
schema:

**Fingerprint hash fields** (the "fp_*" records, 16-byte values):

```
fp_audio, fp_canvas, fp_feats, fp_feats2, fp_fonts, fp_gpu, fp_plugins, fp_webgl
```

**Screen / device fields**:

```
screen_width, screen_height, screen_depth, screen_dpr, touch_points,
webdriver, userAgent, if_flags, tms
```

**Platform / UA-CH fields**:

```
x_arch, x_bits, x_ffs, x_fvlist, x_model, x_platform, x_pvers, x_uavers,
brand, brands, architecture, bitness, formFactors, fullVersionList,
model, platformVersion, uaFullVersion, wow64
```

**Timezone fields**:

```
tz, tz_offset, utc
```

**Bot / tamper detection signals** (values/probes decoded):

```
webdriver, Brave, __uiPathDriver, __uiPathSalesForce, __uiPathSapFiori,
__uiPathSapWebGui, oldAlert, oldConfirm, oldPrompt, openDatabase,
requestAdapter, getHighEntropyValues
```

**Anti-headless CSS probes** (decoded):

```
@keyframes _cfxt { from { left:0px } to { left:1px } }
position:fixed;top:-9999px;width:0;height:0;overflow:hidden;pointer-events:none;animation:_cfxt 2s linear infinite
```

**Canvas probe**:

```
i9asdm..$#po((^@KbXrww!~cz            (test string drawn via fillText)
rgba(102, 200, 0, 0.7)                  (fill style)
```

**WebGL shaders** (decoded source):

```
attribute vec2 aPos; varying vec2 vPos; void main() { vPos = aPos; gl_Position = vec4(aPos, 0.0, 1.0); }
precision mediump float; varying vec2 vPos; void main() { ... gl_FragColor = ... }
UNMASKED_VENDOR_WEBGL, UNMASKED_RENDERER_WEBGL, WEBGL_debug_renderer_info,
RGBA, UNSIGNED_BYTE, readPixels, getParameter, getExtension, VERTEX_SHADER, FRAGMENT_SHADER
```

**Navigator/screen property probes**:

```
appCodeName|appName|appVersion|cookieEnabled|deviceMemory|hardwareConcurrency|language|languages|maxTouchPoints|platform|product|plugins|productSub|userAgent|vendor|vendorSub|webdriver
availHeight|availLeft|availTop|availWidth|colorDepth|height|pixelDepth|width
```

**Full font-availability list** (pipe-delimited; Abadi MT Condensed Light …
Arial Baltic … Wingdings etc.)

**Sample fingerprint hash values** captured (32-hex, from the same run):

```
2713ee21b7980069ea7c03540443339c
3a664343cf1666e0c032fd1d6a5dc69d
5314e6d9fe3b9c7889b631841562d838
9eba82dc1063190ea067d8ec89eceda7
abc57a768701d26134a4a4cb1e8d240b
ec6e6f0b64a20a17d7c5bbf8bce91bc3
fe0d53c359d5f92c4b09eaa6ab1fc5c0
```

### What this proves / how to decrypt

1. Run the SDK once, capture the blob **and** read `C+96` + `table8304` from
   `HEAPU8` (both are available to any page script — the key material is
   client-side).
2. Compute `key = C+96 XOR table8304[0..31]`, `iv = blob[64..80]`, `ct = blob[80:]`.
3. AES-256-CBC decrypt → magic `8e3421f0` + 64-byte session block + the
   serialized fingerprint payload (names decodable via the captured schema).

**Note on the nonce:** the nonce is per-request (fresh per submit), so a
decrypted payload from one session can't be replayed verbatim — each request
needs its own fresh nonce + valid header. That's the one thing that stops
out-of-the-box replay (and worth pointing out).

### Tools

- `bots/stytch-dfp-final.mjs` — capture C+96, table8304, blob in one run.
- `bots/stytch_dfp_decrypt.py` — decrypt (key = C+96 XOR table8304, CBC).
- `bots/stytch-dfp-dd.mjs` — hook `dd()` to dump the 301 decoded field names.
- `bots/stytch-dfp-tamper.mjs` — full tamper-and-reship PoC (below).
- `bots/STYTCH_DFP_RECON_2026_10_25.md` — this writeup.
- Artifacts under `/tmp/opencode/stytch/` (blobs, decrypted body, `aes_key.hex`,
  `stytch_schema_names.txt`, `tamper-*`).

## 9h. ✅ Tamper-and-reship PoC (2026-10-25)

With the crypto recovered, the end-to-end client-side attack works. A page-level
interceptor (Playwright) can read the key from the module's own heap, decrypt the
real telemetry, modify the plaintext, re-encrypt with a **fresh nonce**, and
substitute the tampered blob at the network layer.

**Attack chain (all client-side; nothing is sent to Stytch in the PoC):**

```
1. page loads telemetry.js; SDK builds + POSTs the blob to a LOCAL submit URL
2. Playwright reads the per-session AES-256 key straight from the module heap:
     C   = u32(HEAPU8[17349*4])
     key = HEAPU8[C+96..C+128] XOR HEAPU8[8304..8336]
3. route('**/submit') intercepts the real POST (base64 body) — never forwarded
4. decrypt: AES-256-CBC(key, iv=blob[64:80]) → magic 8e3421f0 + session-block +
   serialized payload (PKCS#7 padded)
5. TAMPER the plaintext (stamp marker, flip bytes — real field edits are
   possible via the 0xC0/0xC1 record layout + dd() schema)
6. re-encrypt with the SAME key + a FRESH random nonce
7. rebuild blob = [blob[0:64] session block (unchanged)] + [new nonce] + [new ct]
8. fulfill the intercepted request with the tampered blob (or dump it)
```

**Why it works:**

- The key material is client-side and readable: `C+96` and `table8304` are both
  in the page's own `HEAPU8`. No server secret exists in the client.
- `blob[0:64]` is per-**session** (not per-request), so it stays valid across
  submits and is reused unchanged.
- The nonce is not secret — it's plaintext at `blob[64:80]`, and re-encrypting
  with the same key + any nonce yields a valid blob (verified by re-decrypt).

**Verified output (default mode):**

```
[+] AES-256 key   : 886a7b38186c2f3911ae7026ec21a82d1c7847f23f884c2a36994d2e52f2ec16
[+] real nonce    : a651d345273517bbf0e620420f5aa997
[+] real blob len : 1344  magic: 8e3421f0
[+] NEW nonce     : e17b6fbdfd5ecad5118ed986938877e2  (fresh, per-request)
[+] server-side decrypt of tampered blob: magic 8e3421f0  payload[0:16]: TAMPERED_PAYLOAD
```

**Drive-it mode:** `--dump` prints the exact would-be-sent payload (base64 body +
decrypted body) to the console instead of shipping:

```
node bots/stytch-dfp-tamper.mjs            # attack mode (reship to local capture)
node bots/stytch-dfp-tamper.mjs --dump     # print the payload instead of shipping
```

**Artifacts:** `/tmp/opencode/stytch/tamper-real-blob.bin`,
`tamper-decrypted.bin`, `tamper-tampered-body.bin`, `tamper-tampered-blob.bin`,
`tamper-key.hex`.

**The honest boundary (interview framing):** the per-request nonce prevents
naive **replay** of a captured blob, but not **live tamper-and-reseal** — the
nonce isn't a secret and the key is in the page's own memory. The durable
defense has to be server-side: cross-checking TLS/JA3/IP/UA/header consistency
against the claimed payload, and binding each request to server-issued state.

## 9i. ✅ Readable payload — the actual browser tells (2026-10-25)

The serialized wire records are a custom binary format, so instead of parsing
them blindly we hooked the module's **own serializer `sa(name, value)`**. Every
(name → value) the SDK appends to the payload is captured straight from the
module heap at call time; names are decoded with the same `dd()` decoder the
module uses (`sa` internally calls `V(slot,c)` → `dd(c)` to decode the encoded
name constant). This gives the **actual, readable telemetry payload** that gets
shipped — verified against the AES-256-CBC decryption (magic `8e3421f0`).

### Decoded payload (this environment — headless Chromium 148)

**Fingerprint hashes (`fp_*`):**

```
fp_audio    "956.3163751662416"        ← audio-context sample hash
fp_feats    "267D5DF014358124B651A484AC018A95"   ← feature hash (32-hex)
fp_perf     "0.0999999046325684"       ← performance timing
fp_feats2   "D01ADD4D60E6B5BA0BEF3C6C83F1BBD4"
fp_canvas   "1174736476"               ← canvas fingerprint hash
fp_fonts    "-979314523"               ← font-detection hash
fp_plugins  "0"
fp_webgl    "-1057794494"              ← WebGL fingerprint hash
fp_gpu      "7D63950D9257302F22FA6E8EC8312DCE"
```

**The bot/headless tells:**

```
webdriver   "true"                     ← #1 bot tell (Playwright sets navigator.webdriver)
webgl       "Google Inc. (Google) / ANGLE (Google, Vulkan 1.3.0 (SwiftShader
             Device (Subzero) (0x0000C0DE)), SwiftShader driver)"  ← SwiftShader = headless
UA          "Mozilla/5.0 (X11; Linux x86_64) … HeadlessChrome/148.0.7778.96 …"
brand       "HeadlessChrome/148/Linux"
x_fvlist    "Chromium/148.0.7778.96;HeadlessChrome/148.0.7778.96;Not/A)Brand/99.0.0.0"
```

**Screen / device:**

```
screen_width 1280 · screen_height 720 · screen_depth 24 · screen_dpr 1
cpus 12 · memory 32 · touch_points 0 · language "en-US" · languages "en-US"
```

**Platform / UA-CH:**

```
x_platform "Linux" · x_arch "x86" · x_bits "64" · x_uavers "148.0.7778.96"
x_ffs "Desktop" · platform "Linux x86_64" · CV "1.19.0" (SDK version)
GLR "0.50"/"1.00" · PTL "407:12,411:7,…" (timing profile) · tms "556"/"180" (ms) · PM "3"
```

**Timezone:**

```
tz "America/Chicago" · tz_offset "300" (min, UTC-5 CDT) · utc "1792945717030" (ms)
```

**Config:** `API_PUBLIC_TOKEN "public-token-test"`, `DECLARED_PLATFORM "UNKNOWN"`,
`origin "http://127.0.0.1:8870"`, `if_flags "0"`.

(Some fields appear twice — the SDK runs two serialization passes / rounds.)

### Why this matters for tamper

The exact field names, values, and byte lengths are now known, so a targeted
tamper is not blind: you can flip `webdriver → false`, change `fp_webgl`, spoof
the `UA`, etc. The `sa()`/`dd()` hooks give the record mapping; the AES key +
fresh-nonce reseal from §9h ships the altered blob. Still pending (not done):
re-encoding an individual `sa()` record byte-for-byte into the custom wire
format — the PoC tampers at the plaintext level, which already proves the chain.

### Tools

- `bots/stytch-dfp-payloadview.mjs` — hooks `sa()` + `dd()`, dumps readable payload.
- `/tmp/opencode/stytch/payloadview.json` — 72 captured (name → value) records.
- Patched bundle: `/tmp/opencode/st-beautified-sa.js` (`sa` + `dd` hooks).

## 10. Limitations

- The readable (name → value) payload was recovered by hooking the module's own
  serializer `sa()` + decoder `dd()` (§9i), not by parsing the custom wire
  record format from the decrypted bytes. The wire-level `0xC0`/`0xC1` record
  layout is understood at the C++ level (`sa` writes `[0xC0][name_len][value_len
  2B][name][value]` and a `0xC1` variant for the 16-byte `fp_*` hashes), but
  byte-level **re-encoding** of an individual record into that format (for a
  *targeted* field tamper) is still pending — the PoC tampers at the plaintext
  level (marker stamp + byte flip), which proves the chain.
- We used a dummy `public-token-test` and a local submit URL; we did not
  obtain a real telemetry ID or call the lookup API (requires project secret).
- `g.wasm` is 403 in our environment; the public bundle ran the wasm2js
  fallback. A production browser may behave differently.
- The observed signal list is from JS API hooks; the C++ module may read more
  through `emscripten::val` paths that were not all instrumented (plugins,
  permissions, battery, media devices, WebRTC, fonts, WebGPU, etc. were
  probed, but only the listed ones fired).
- No customer site or Twilio auth flow was probed.

---

## 11. Artifacts

| File | Purpose |
|---|---|
| `bots/stytch-dfp-probe.mjs` | Loads `telemetry.js`, calls `GetTelemetryID()` against local `/submit`, captures payload/network |
| `bots/stytch-dfp-signals.mjs` | Hooks navigator/screen/canvas/WebGL/audio/Intl/random/fetch |
| `bots/stytch-dfp-heap.mjs` | Inspects the Emscripten module keys/HEAPU8 strings |
| `bots/stytch-dfp-final.mjs` | Captures C+96, table8304, blob in one run (key extraction) |
| `bots/stytch_dfp_decrypt.py` | Decrypts blobs (key = C+96 XOR table8304, AES-256-CBC) |
| `bots/stytch-dfp-dd.mjs` | Hooks `dd()` to dump the 301 decoded field names (schema) |
| `bots/stytch-dfp-tamper.mjs` | Tamper-and-reship PoC (`--dump` prints payload instead of shipping) |
| `bots/stytch-dfp-payloadview.mjs` | Hooks `sa()`+`dd()` to dump the readable payload (field names + values) |
| `/tmp/opencode/stytch/submits.json` | The 1,836-char base64 submit body |
| `/tmp/opencode/stytch/captures.json` | Network/native captures |
| `/tmp/opencode/stytch/segments/` | Decoded `F(E,offset,"base64")` data segments |
| `/tmp/opencode/stytch/decrypted_body.bin` | Decrypted payload (magic `8e3421f0` + session + serialized) |
| `/tmp/opencode/stytch/aes_key.hex` | Recovered per-session AES-256 key |
| `/tmp/opencode/stytch/stytch_schema_names.txt` | 301 decoded field-name strings |
| `/tmp/opencode/stytch/payloadview.json` | 72 captured (name → value) records — the readable payload |
| `/tmp/opencode/stytch/tamper-*` | Tamper PoC artifacts (real/tampered blob, decrypted body, key) |

---

*Prepared for interview preparation. Public assets/docs only; no signals were
sent to Stytch, and no customer or auth flow was probed.*
