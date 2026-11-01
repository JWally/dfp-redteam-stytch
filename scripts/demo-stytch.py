#!/usr/bin/env python3
"""demo-stytch.py — print the FULL decrypted Stytch DFP telemetry field tree."""
import json, sys

def main():
    src = sys.argv[1] if len(sys.argv) > 1 else '/home/justin/Dev/dfp-redteam-stytch-2026-10-25/artifacts/payloadview.json'
    d = json.load(open(src))
    print('=' * 74)
    print('STYTCH DFP — FULL DECRYPTED TELEMETRY (field tree)')
    print('key: ' + d.get('key', '?'))
    print('magic: ' + d.get('magic', '?'))
    print('=' * 74)
    rows = d.get('rows', [])
    for r in rows:
        v = str(r.get('val', ''))
        print(f'{r.get("name")}: {v[:110]}{" ..." if len(v)>110 else ""}')
    print('=' * 74)
    print(f'FIELDS DECRYPTED: {len(rows)}')

if __name__ == '__main__':
    main()
