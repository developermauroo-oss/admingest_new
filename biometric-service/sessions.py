"""Persistent session and one-use grant primitives for the local laboratory."""
import hashlib
import hmac
import json
import secrets
import sqlite3
import time


class Sessions:
    def __init__(self, path, signing_key):
        if len(signing_key) < 32:
            raise ValueError("Signing key must contain at least 32 bytes")
        self.path, self.key = str(path), signing_key
        with self.connection() as db:
            db.executescript("""
            CREATE TABLE IF NOT EXISTS sessions (
              id TEXT PRIMARY KEY, binding TEXT NOT NULL, challenge TEXT NOT NULL,
              expires REAL NOT NULL, attempts INTEGER NOT NULL DEFAULT 0);
            CREATE TABLE IF NOT EXISTS grants (
              id TEXT PRIMARY KEY, session TEXT UNIQUE NOT NULL, binding TEXT NOT NULL,
              expires REAL NOT NULL, consumed INTEGER NOT NULL DEFAULT 0);
            CREATE TABLE IF NOT EXISTS attendance_lab (
              grant_id TEXT PRIMARY KEY, binding TEXT NOT NULL, created REAL NOT NULL);
            CREATE TABLE IF NOT EXISTS capture_hashes (
              digest TEXT PRIMARY KEY, created REAL NOT NULL);
            """)

    def connection(self):
        return sqlite3.connect(self.path, timeout=10)

    def create(self, binding):
        now = time.time()
        with self.connection() as db:
            db.execute("BEGIN IMMEDIATE")
            identity = json.loads(binding)
            count = db.execute("SELECT count(*) FROM sessions WHERE json_extract(binding,'$[0]')=? AND json_extract(binding,'$[1]')=? AND json_extract(binding,'$[2]')=? AND expires>?", (*identity[:3], now - 600)).fetchone()[0]
            if count >= 3:
                raise ValueError("Too many sessions; wait before retrying")
            sid = secrets.token_urlsafe(32)
            challenge = secrets.choice(["turn_left_then_center", "turn_right_then_center"])
            db.execute("INSERT INTO sessions(id,binding,challenge,expires) VALUES(?,?,?,?)", (sid, binding, challenge, now + 120))
        return {"id": sid, "challenge": challenge, "expires_at": now + 120}

    def attempt(self, sid, binding):
        with self.connection() as db:
            db.execute("BEGIN IMMEDIATE")
            changed = db.execute("UPDATE sessions SET attempts=attempts+1 WHERE id=? AND binding=? AND expires>? AND attempts<3", (sid, binding, time.time())).rowcount
            if changed != 1:
                raise ValueError("Expired session or attempts exhausted")

    def challenge(self, sid, binding):
        with self.connection() as db:
            row = db.execute("SELECT challenge FROM sessions WHERE id=? AND binding=? AND expires>?", (sid, binding, time.time())).fetchone()
        if not row:
            raise ValueError("Invalid or expired session")
        return row[0]

    def claim_captures(self, images):
        digests = [hashlib.sha256(image).hexdigest() for image in images]
        if len(set(digests)) != len(digests):
            raise ValueError("Repeated capture")
        try:
            with self.connection() as db:
                db.execute("BEGIN IMMEDIATE")
                db.execute("DELETE FROM capture_hashes WHERE created<?", (time.time() - 86400,))
                db.executemany("INSERT INTO capture_hashes VALUES(?,?)", [(digest, time.time()) for digest in digests])
        except sqlite3.IntegrityError as exc:
            raise ValueError("Capture was previously used") from exc

    def _issue_after_validated_evidence(self, sid, binding):
        # Not exposed by API. Production issuer must validate PAD and calibration.
        gid, expiry = secrets.token_urlsafe(32), time.time() + 30
        with self.connection() as db:
            db.execute("BEGIN IMMEDIATE")
            if not db.execute("SELECT 1 FROM sessions WHERE id=? AND binding=? AND expires>? AND attempts BETWEEN 1 AND 3", (sid, binding, time.time())).fetchone():
                raise ValueError("Invalid session")
            db.execute("INSERT INTO grants VALUES(?,?,?,?,0)", (gid, sid, binding, expiry))
        signature = hmac.new(self.key, gid.encode(), hashlib.sha256).hexdigest()
        return gid + "." + signature

    def consume_and_record(self, token, binding):
        parts = token.split(".")
        if len(parts) != 2 or not hmac.compare_digest(parts[1], hmac.new(self.key, parts[0].encode(), hashlib.sha256).hexdigest()):
            raise ValueError("Invalid authorization")
        with self.connection() as db:
            db.execute("BEGIN IMMEDIATE")
            if db.execute("UPDATE grants SET consumed=1 WHERE id=? AND binding=? AND expires>? AND consumed=0", (parts[0], binding, time.time())).rowcount != 1:
                raise ValueError("Authorization expired or already used")
            db.execute("INSERT INTO attendance_lab VALUES(?,?,?)", (parts[0], binding, time.time()))

    def inspect_grant(self, token, binding):
        parts = token.split(".")
        if len(parts) != 2 or not hmac.compare_digest(parts[1], hmac.new(self.key, parts[0].encode(), hashlib.sha256).hexdigest()):
            raise ValueError("Invalid authorization")
        with self.connection() as db:
            row = db.execute("SELECT expires FROM grants WHERE id=? AND binding=? AND expires>? AND consumed=0", (parts[0], binding, time.time())).fetchone()
        if not row:
            raise ValueError("Authorization expired or invalid")
        return {"token_hash": hashlib.sha256(token.encode()).hexdigest(), "expires_at": row[0]}

    def revoke_person(self, person_id):
        with self.connection() as db:
            db.execute("BEGIN IMMEDIATE")
            db.execute("UPDATE grants SET consumed=1 WHERE json_extract(binding,'$[1]')=?", (person_id,))
            db.execute("UPDATE sessions SET expires=0 WHERE json_extract(binding,'$[1]')=?", (person_id,))


def binding(user, person, store, login_session):
    return json.dumps([user, person, store, login_session], separators=(",", ":"))
