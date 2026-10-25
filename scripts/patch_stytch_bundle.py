#!/usr/bin/env python3
"""
patch_stytch_bundle.py — apply read-only capture hooks to the prettier-formatted
Stytch DFP telemetry.js bundle (wasm2js).

Two hooks (both read-only; they only log, they do not alter data flow):

  1. dd()  — the module's string/constant decoder. Hooks every decode so the
             (encoded constant -> decoded name) mapping can be captured.
  2. sa()  — the serializer append function `sa(output, name, value)`. The
             wrapper decodes the name via dd() and captures (name, value) so
             the READABLE payload can be reconstructed.

Outputs (next to the input):
  <input>.dd.js   -> base + dd hook     (used by stytch-dfp-dd.mjs)
  <input>.sa.js   -> base + dd + sa hook (used by stytch-dfp-payloadview*.mjs)

Usage:
  python3 scripts/patch_stytch_bundle.py [/tmp/opencode/st-beautified.js]

The scripts in this repo reference the outputs at
/tmp/opencode/st-beautified-dd.js and /tmp/opencode/st-beautified-sa.js.
"""
import sys, os

def main():
    src = sys.argv[1] if len(sys.argv) > 1 else '/tmp/opencode/st-beautified.js'
    s = open(src, encoding='utf-8').read()

    # ---- 1. dd() decode hook ------------------------------------------------
    needle = """            z = (d + 624) | 0;
            return c;
          }
          function $d(b, c, d, e) {"""
    if s.count(needle) != 1:
        raise SystemExit('[!] dd() anchor not found (wrong bundle/format?) — got %d matches' % s.count(needle))
    repl = """            z = (d + 624) | 0;
            try { if (window.__ddHook) window.__ddHook(b, c); } catch (_) {}
            return c;
          }
          function $d(b, c, d, e) {"""
    s_dd = s.replace(needle, repl, 1)

    # ---- 2. sa() serializer hook -------------------------------------------
    needle2 = "function sa(b, c, d) {\n            var e, f;"
    if s_dd.count(needle2) != 1:
        raise SystemExit('[!] sa() anchor not found — got %d matches' % s_dd.count(needle2))
    s_sa = s_dd.replace(needle2, "function sa_orig(b, c, d) {\n            var e, f;", 1)
    i = s_sa.find('\n          function Rd(', s_sa.find('function sa_orig'))
    if i < 0:
        raise SystemExit('[!] could not locate insertion point after sa_orig')
    wrapper = '''
          function sa(b, c, d) {
            var _cap = null;
            try {
              if (window.__saHook) {
                var _dec = dd(c);            /* decode the encoded name constant */
                if (_dec) {
                  var _nmLen = Sa(_dec);
                  var _vlLen = Sa(d);
                  if (_vlLen < 0x10000 && _nmLen < 0x400) {
                    _cap = { nm: new Uint8Array(p.subarray(_dec, _dec + _nmLen)),
                             vlen: _vlLen,
                             vl: new Uint8Array(p.subarray(d, d + _vlLen)) };
                  }
                }
              }
            } catch (_) {}
            var _r = sa_orig(b, c, d);
            if (_cap) { try { window.__saHook(_cap); } catch (_2) {} }
            return _r;
          }
'''
    s_sa = s_sa[:i] + wrapper + s_sa[i:]

    base = os.path.splitext(src)[0]
    out_dd = base + '-dd.js'
    out_sa = base + '-sa.js'
    open(out_dd, 'w', encoding='utf-8').write(s_dd)
    open(out_sa, 'w', encoding='utf-8').write(s_sa)
    print('[+] wrote %s' % out_dd)
    print('[+] wrote %s' % out_sa)

    # syntax check
    import subprocess
    for f in (out_dd, out_sa):
        r = subprocess.run(['node', '--check', f], capture_output=True)
        if r.returncode != 0:
            print('[!] syntax check FAILED for %s: %s' % (f, r.stderr.decode()[:300]))
        else:
            print('[+] syntax OK: %s' % f)

if __name__ == '__main__':
    main()
