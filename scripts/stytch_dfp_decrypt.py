#!/usr/bin/env python3
"""
stytch_dfp_decrypt.py — decrypt Stytch DFP telemetry wire blobs.

Wire format (from RE):
  blob[0:64]   per-session public-key/session material (XOR-obfuscated)
  blob[64:80]  16-byte nonce = AES-256-CBC IV (PLAINTEXT)
  blob[80:end] AES-256-CBC ciphertext of the payload

AES key (per module load / per page session):
  raw = HEAPU8[C+96 .. C+128] where C = u32(HEAPU8[17349*4])
  key = raw[i] ^ table8304[i]  for i in 0..31
  table8304 = the 256-byte XOR table at heap offset 8304
  (i.e. the module stores the AES key XOR-obfuscated; un-XOR it to get the key)

Plaintext layout:
  [0:4]    magic 8E 34 21 F0
  [4:68]   64 bytes per-session material (from the PoW/key-derivation)
  [68:..]  serialized telemetry payload (field names/values still obfuscated)
  [..end]  PKCS#7 padding

Usage:
  python3 stytch_dfp_decrypt.py <blob.bin> <c96_hex> <table8304_hex>
  # or: pass a JSON capture file {blob_b64, c96, table8304}
"""
import sys, base64, json
from Crypto.Cipher import AES

def decrypt(blob: bytes, c96: bytes, table: bytes) -> bytes:
    assert len(c96) >= 32 and len(table) >= 32
    key = bytes(c96[i] ^ table[i] for i in range(32))
    if len(blob) < 80:
        raise ValueError("blob too small")
    iv = blob[64:80]
    ct = blob[80:]
    if len(ct) % 16:
        raise ValueError("ciphertext not block aligned")
    pt = AES.new(key, AES.MODE_CBC, iv).decrypt(ct)
    pad = pt[-1]
    body = pt[:-pad] if 0 < pad <= 16 else pt
    return body, key

def main():
    if len(sys.argv) >= 4:
        blob = open(sys.argv[1], 'rb').read()
        c96 = bytes.fromhex(sys.argv[2])
        table = bytes.fromhex(sys.argv[3])
    else:
        cap = json.load(open(sys.argv[1] if len(sys.argv) > 1 else 'final-caps.json'))
        c = cap['caps'] if 'caps' in cap else cap
        blob = base64.b64decode(open('final-blob.bin','rb').read()) if False else open('final-blob.bin','rb').read()
        c96 = base64.b64decode(c['c96'])
        table = base64.b64decode(c['table8304'])
    body, key = decrypt(blob, c96, table)
    print("AES-256 key:", key.hex())
    print("magic      :", body[:4].hex(), "(expect 8e3421f0)")
    print("session(64):", body[4:68].hex())
    print("payload len:", len(body) - 68)
    open('decrypted_body.bin', 'wb').write(body)
    open('aes_key.hex', 'w').write(key.hex())
    print("wrote decrypted_body.bin and aes_key.hex")
    # dump serialized payload region
    open('serialized_payload.bin','wb').write(body[68:])

if __name__ == '__main__':
    main()
