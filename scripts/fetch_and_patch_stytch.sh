#!/usr/bin/env bash
# fetch_and_patch_stytch.sh — download the real Stytch DFP telemetry.js,
# pretty-print it, then apply the read-only dd()/sa() capture hooks.
#
# Produces:
#   /tmp/opencode/st-beautified.js     (prettier-formatted bundle)
#   /tmp/opencode/st-beautified-dd.js  (+ dd() decode hook)
#   /tmp/opencode/st-beautified-sa.js  (+ dd() + sa() serializer hook)
#
# Usage: bash scripts/fetch_and_patch_stytch.sh
set -euo pipefail

URL="https://elements.stytch.com/telemetry.js"
OUT="/tmp/opencode/st-beautified.js"
mkdir -p /tmp/opencode

echo "[*] fetching $URL"
curl -fsSL "$URL" -o /tmp/opencode/telemetry.js
echo "[+] raw bundle: $(wc -c < /tmp/opencode/telemetry.js) bytes"

echo "[*] pretty-printing (npx prettier)"
if command -v npx >/dev/null 2>&1; then
  npx --yes prettier --parser babel /tmp/opencode/telemetry.js > "$OUT"
else
  echo "[!] npx not found — copying raw bundle (patch anchors need the beautified form)"
  cp /tmp/opencode/telemetry.js "$OUT"
fi
echo "[+] beautified: $(wc -l < "$OUT") lines"

echo "[*] applying dd()/sa() hooks"
python3 scripts/patch_stytch_bundle.py "$OUT"
echo "[+] done: st-beautified-dd.js and st-beautified-sa.js"
