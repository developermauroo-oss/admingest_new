"""Supabase Cloud persistence. No image or embedding plaintext is transmitted."""
import hashlib
import hmac
import json
import os
import secrets
import time
from datetime import datetime, timezone
import httpx


class Cloud:
    def __init__(self):
        url = os.environ["NEXT_PUBLIC_SUPABASE_URL"].rstrip("/")
        project = os.environ["BIOMETRIC_TEST_SUPABASE_PROJECT_REF"]
        if url != f"https://{project}.supabase.co":
            raise ValueError("Development project mismatch")
        key = os.environ["SUPABASE_SERVICE_ROLE_KEY"]
        self.client = httpx.Client(base_url=url + "/rest/v1/", headers={"apikey": key, "Authorization": f"Bearer {key}"}, timeout=20)

    def request(self, method, path, **kwargs):
        response = self.client.request(method, path, **kwargs)
        if response.status_code >= 400:
            if "TOO_MANY_SESSIONS" in response.text:
                raise ValueError("Too many sessions; wait before retrying")
            if "SESSION_EXPIRED_OR_EXHAUSTED" in response.text:
                raise ValueError("Expired session or attempts exhausted")
            raise ValueError(f"Cloud persistence rejected request ({response.status_code})")
        return response.json() if response.content else None

    def audit(self, action, person=None, actor=None):
        self.request("POST", "biometric_audit_v2", json={"action": action, "persona_id": person, "actor_id": actor})

    def template(self, person, model):
        rows = self.request("GET", "biometric_templates_v2", params={"persona_id": f"eq.{person}", "model": f"eq.{model}", "expires_at": f"gt.{datetime.now(timezone.utc).isoformat()}", "select": "*"})
        return rows[0] if rows else None

    def save_template(self, person, model, ciphertext, actor=None):
        now = time.time()
        days = int(os.environ.get("BIOMETRIC_RETENTION_DAYS", "365"))
        if not 1 <= days <= 3650:
            raise ValueError("Invalid retention configuration")
        self.request("POST", "biometric_templates_v2", params={"on_conflict": "persona_id,model"}, headers={"Prefer": "resolution=merge-duplicates"}, json={"persona_id": person, "model": model, "ciphertext": ciphertext.decode(), "trusted": False, "consented_by": actor, "consented_at": datetime.now(timezone.utc).isoformat() if actor else None, "created_at": datetime.fromtimestamp(now,timezone.utc).isoformat(), "expires_at": datetime.fromtimestamp(now+days*86400,timezone.utc).isoformat()})
        self.audit("experimental_enroll", person, actor)


class CloudSessions:
    def __init__(self, cloud, key):
        self.cloud, self.key = cloud, key

    def create(self, bound):
        return self.cloud.request("POST", "rpc/biometric_session_start", json={"p_id": secrets.token_urlsafe(32), "p_binding": json.loads(bound), "p_challenge": secrets.choice(["turn_left_then_center", "turn_right_then_center"])})

    def attempt(self, sid, bound):
        self.cloud.request("POST", "rpc/biometric_session_attempt", json={"p_id": sid, "p_binding": json.loads(bound)})

    def challenge(self, sid, bound):
        rows = self.cloud.request("GET", "biometric_sessions_v2", params={"id": f"eq.{sid}", "select": "binding,challenge,expires_at"})
        if not rows or rows[0]["binding"] != json.loads(bound) or datetime.fromisoformat(rows[0]["expires_at"]).timestamp() <= time.time():
            raise ValueError("Invalid session")
        return rows[0]["challenge"]

    def claim_captures(self, images):
        hashes = [hashlib.sha256(image).hexdigest() for image in images]
        if len(set(hashes)) != len(hashes):
            raise ValueError("Repeated capture")
        self.cloud.request("POST", "biometric_capture_hashes", json=[{"digest": digest} for digest in hashes])

    def _issue_after_validated_evidence(self, sid, bound):
        self.challenge(sid, bound)
        gid = secrets.token_urlsafe(32)
        token = gid + "." + hmac.new(self.key, gid.encode(), hashlib.sha256).hexdigest()
        user, person, store, login = json.loads(bound)
        self.cloud.request("POST", "biometric_grants", json={"token_hash": hashlib.sha256(token.encode()).hexdigest(), "user_id": user, "persona_id": person, "tienda_id": store, "login_session": login, "biometric_session_id": sid, "expires_at": datetime.fromtimestamp(time.time()+30,timezone.utc).isoformat()})
        return token

    def inspect_grant(self, token, bound):
        parts = token.split(".")
        if len(parts) != 2 or not hmac.compare_digest(parts[1], hmac.new(self.key, parts[0].encode(), hashlib.sha256).hexdigest()):
            raise ValueError("Invalid authorization")
        digest = hashlib.sha256(token.encode()).hexdigest()
        rows = self.cloud.request("GET", "biometric_grants", params={"token_hash": f"eq.{digest}", "consumed_at": "is.null", "select": "*"})
        if not rows:
            raise ValueError("Invalid authorization")
        row = rows[0]
        expiry = datetime.fromisoformat(row["expires_at"]).timestamp()
        if [row["user_id"],row["persona_id"],row["tienda_id"],row["login_session"]] != json.loads(bound) or expiry <= time.time():
            raise ValueError("Invalid authorization")
        return {"token_hash": digest, "expires_at": expiry}

    def revoke_person(self, person):
        self.cloud.request("POST", "rpc/biometric_revoke", json={"p_persona": person})
