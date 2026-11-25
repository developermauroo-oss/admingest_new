"""AES-GCM key ring. Active key seals; retained keys decrypt during rotation."""
import base64
import json
import os
from cryptography.hazmat.primitives.ciphers.aead import AESGCM


class KeyRing:
    def __init__(self, keys, active):
        if active not in keys or any(len(value) != 32 for value in keys.values()):
            raise ValueError("Invalid encryption key ring")
        self.keys, self.active = keys, active

    def seal(self, plaintext, context):
        nonce = os.urandom(12)
        return json.dumps({"v": 1, "kid": self.active, "data": base64.b64encode(nonce + AESGCM(self.keys[self.active]).encrypt(nonce, plaintext, context)).decode()}).encode()

    def open(self, payload, context):
        record = json.loads(payload)
        if record["v"] != 1 or record["kid"] not in self.keys:
            raise ValueError("Encryption key unavailable")
        data = base64.b64decode(record["data"], validate=True)
        return AESGCM(self.keys[record["kid"]]).decrypt(data[:12], data[12:], context)

    def rotate(self, payload, context):
        return self.seal(self.open(payload, context), context)
