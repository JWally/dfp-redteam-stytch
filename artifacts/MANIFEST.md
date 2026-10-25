# Artifacts manifest — Stytch DFP drill-down (2026-10-25)

Curated outputs committed with this repo. The **full raw capture data** (heap
dumps, frame series, de()/sched logs, diff blobs) lives under
`/tmp/opencode/stytch/` on the original machine — not committed (large /
noisy). All values below are from **forced-randomness / dummy-token / local
submit** runs; nothing was sent to Stytch.

## Crypto / key material
| File | What |
|---|---|
| `final-blob.bin` | wire blob captured in one run (base64-decoded) |
| `final-caps.json` | `C` (struct ptr), `C+96` raw key bytes, `table8304` — the key material |
| `aes_key.hex` | recovered per-session AES-256 key = `C+96 XOR table8304[0..31]` |
| `keyread.json` | static AES-256 key + crypto-struct bytes (earlier extraction) |

## Decrypted payload
| File | What |
|---|---|
| `decrypted_body.bin` | decrypted body: `magic 8e3421f0 \| session(64) \| serialized \| pad` |
| `FINAL_PLAINTEXT.bin` | same plaintext (first verified run) |
| `FINAL_BODY.bin` | un-padded body |

## Readable payload / schema
| File | What |
|---|---|
| `payloadview.json` | **72 captured (name → value) records** — the readable payload |
| `input-stream.json` | the ordered input stream (97 events / 2 rounds) fed into the wasm |
| `stytch_schema_names.txt` | 301 decoded field-name strings (via `dd()` hook) |

## Tamper PoC run
| File | What |
|---|---|
| `tamper-real-blob.bin` | the SDK's real blob (intercepted) |
| `tamper-decrypted.bin` | its decrypted body |
| `tamper-tampered-body.bin` | body after `TAMPERED_PAYLOAD!` stamp + byte flip |
| `tamper-tampered-blob.bin` | re-encrypted blob with a FRESH nonce (same key) |
| `tamper-key.hex` | the per-session key for that run |

## Visible-browser run
| File | What |
|---|---|
| `vis2-blob.bin` | blob from the headed `payloadview-visual` run |
| `vis2-key.hex` | its per-session key |

## Full raw captures (not committed)
- `/tmp/opencode/stytch/heaps/*.bin` — heap dumps (`after-*`, `pe-*`, `fr-*`,
  `sd-*`, `dx-*`)
- `/tmp/opencode/stytch/kiv-log.json` + `kiv-blob.bin` — per-`de()` (key, IV)
  pairs + same-run payload
- `/tmp/opencode/stytch/sched-log.json` + `sched-blob.bin` — key schedules +
  payload
- `/tmp/opencode/stytch/dx*.json` / `de-log.json` — de() call logs
- `/tmp/opencode/stytch/segments/` — decoded `F(E,offset,"base64")` data segments
- `/tmp/opencode/stytch/diff-*.bin` — clean-vs-tamper differential blobs
- `/tmp/opencode/stytch/dd-log.json` — the dd() (constant → decoded) capture log
