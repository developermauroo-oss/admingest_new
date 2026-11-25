"""Local experimental SFace service. No attendance authorization without PAD."""
import base64
import hashlib
import hmac
import os
import sqlite3
import threading
from pathlib import Path

import cv2
import numpy as np
from cryptography.hazmat.primitives.ciphers.aead import AESGCM
from fastapi import FastAPI, Header, HTTPException
from fastapi.responses import FileResponse
from pydantic import BaseModel, Field
from sessions import Sessions, binding
from keyring import KeyRing
import json
import time
from datetime import datetime, timezone
from contextlib import asynccontextmanager
import asyncio
import logging
from antispoof import AntiSpoof
from cloud import Cloud, CloudSessions

ROOT = Path(__file__).resolve().parent
MODEL_VERSION = "opencv-sface-2021dec-yunet-2023mar"
app = FastAPI(title="AdminGes biometric laboratory", docs_url=None, redoc_url=None)
lock = threading.Lock()
_models = None
_pad = None
_cloud = None


def cloud_store():
    global _cloud
    if os.environ.get("BIOMETRIC_STORAGE") != "cloud":
        return None
    if _cloud is None:
        _cloud = Cloud()
    return _cloud


def memory_bytes():
    if os.name != "nt":
        return None
    import ctypes
    from ctypes import wintypes
    class Counters(ctypes.Structure):
        _fields_ = [("cb", wintypes.DWORD), ("PageFaultCount", wintypes.DWORD)] + [(name, ctypes.c_size_t) for name in ["PeakWorkingSetSize", "WorkingSetSize", "QuotaPeakPagedPoolUsage", "QuotaPagedPoolUsage", "QuotaPeakNonPagedPoolUsage", "QuotaNonPagedPoolUsage", "PagefileUsage", "PeakPagefileUsage"]]
    counters = Counters()
    counters.cb = ctypes.sizeof(counters)
    if ctypes.windll.psapi.GetProcessMemoryInfo(ctypes.c_void_p(-1), ctypes.byref(counters), counters.cb):
        return counters.WorkingSetSize
    return None


def pad_engine():
    global _pad
    manifest = os.environ.get("BIOMETRIC_PAD_MANIFEST")
    if not manifest:
        return None
    if _pad is None:
        _pad = AntiSpoof(manifest)
    return _pad


def settings():
    token = os.environ.get("BIOMETRIC_SERVICE_TOKEN", "")
    key = os.environ.get("BIOMETRIC_ENCRYPTION_KEY", "")
    try:
        decoded = base64.b64decode(key, validate=True)
    except ValueError as exc:
        raise RuntimeError("Invalid encryption key") from exc
    if len(token) < 32 or len(decoded) != 32:
        raise RuntimeError("A service token and 32-byte encryption key are required")
    return token, decoded


def authorize(header: str | None):
    try:
        token, _ = settings()
    except RuntimeError:
        raise HTTPException(503, "Service not configured")
    if not header or not hmac.compare_digest(header, f"Bearer {token}"):
        raise HTTPException(401, "Unauthorized")


def db():
    path = Path(os.environ.get("BIOMETRIC_TEST_DB", str(ROOT / "data" / "biometrics.sqlite3"))).resolve()
    path.parent.mkdir(parents=True, exist_ok=True)
    con = sqlite3.connect(path, timeout=10)
    con.execute("CREATE TABLE IF NOT EXISTS templates (person_id TEXT PRIMARY KEY, model TEXT NOT NULL, ciphertext BLOB NOT NULL)")
    con.execute("CREATE TABLE IF NOT EXISTS template_versions (person_id TEXT NOT NULL, model TEXT NOT NULL, ciphertext BLOB NOT NULL, created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP, PRIMARY KEY(person_id,model))")
    con.execute("CREATE TABLE IF NOT EXISTS trusted_enrollments(person_id TEXT NOT NULL, model TEXT NOT NULL, PRIMARY KEY(person_id,model))")
    con.execute("CREATE TABLE IF NOT EXISTS biometric_audit(id INTEGER PRIMARY KEY,action TEXT NOT NULL,person_id TEXT,created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP)")
    return con


def encryption_ring():
    _, legacy = settings()
    configured = os.environ.get("BIOMETRIC_KEYRING_JSON")
    if not configured:
        return KeyRing({"v1": legacy}, "v1")
    keys = {name: base64.b64decode(value, validate=True) for name, value in json.loads(configured).items()}
    return KeyRing(keys, os.environ["BIOMETRIC_ACTIVE_KEY_ID"])


@app.post("/maintenance/rotate")
def rotate_keys(authorization: str | None = Header(default=None)):
    authorize(authorization)
    ring = encryption_ring()
    _, legacy = settings()
    cloud = cloud_store()
    if cloud:
        rows = cloud.request("GET", "biometric_templates_v2", params={"select": "persona_id,model,ciphertext"})
        for row in rows:
            context = f"{row['persona_id']}:{row['model']}".encode()
            replacement = ring.rotate(row["ciphertext"].encode(), context).decode()
            cloud.request("PATCH", "biometric_templates_v2", params={"persona_id": f"eq.{row['persona_id']}", "model": f"eq.{row['model']}", "ciphertext": f"eq.{row['ciphertext']}"}, json={"ciphertext": replacement})
        cloud.audit("key_rotation")
        return {"rotated": len(rows), "key_id": ring.active}
    with db() as con:
        con.execute("BEGIN IMMEDIATE")
        rows = con.execute("SELECT person_id,model,ciphertext FROM template_versions").fetchall()
        for person, model, payload in rows:
            context = f"{person}:{model}".encode()
            plain = ring.open(payload, context) if payload.startswith(b'{') else AESGCM(legacy).decrypt(payload[:12], payload[12:], context)
            con.execute("UPDATE template_versions SET ciphertext=? WHERE person_id=? AND model=?", (ring.seal(plain, context), person, model))
        con.execute("INSERT INTO biometric_audit(action) VALUES('key_rotation')")
    return {"rotated": len(rows), "key_id": ring.active}


@app.post("/maintenance/retention")
def retention(authorization: str | None = Header(default=None)):
    authorize(authorization)
    days = int(os.environ.get("BIOMETRIC_RETENTION_DAYS", "365"))
    if days < 1 or days > 3650:
        raise HTTPException(503, "Invalid retention configuration")
    cloud = cloud_store()
    if cloud:
        now = datetime.now(timezone.utc).isoformat()
        rows = cloud.request("DELETE", "biometric_templates_v2", params={"expires_at": f"lt.{now}"}, headers={"Prefer": "return=representation"})
        cutoff = datetime.fromtimestamp(time.time()-86400,timezone.utc).isoformat()
        cloud.request("DELETE", "biometric_capture_hashes", params={"created_at": f"lt.{cutoff}"})
        evaluation_cutoff = datetime.fromtimestamp(time.time()-days*86400,timezone.utc).isoformat()
        cloud.request("DELETE", "biometric_evaluations", params={"created_at": f"lt.{evaluation_cutoff}"})
        cloud.audit("retention")
        return {"deleted": len(rows), "retention_days": days}
    with db() as con:
        con.execute("BEGIN IMMEDIATE")
        deleted = con.execute("DELETE FROM template_versions WHERE created_at < datetime('now',?)", (f"-{days} days",)).rowcount
        con.execute("DELETE FROM trusted_enrollments WHERE NOT EXISTS(SELECT 1 FROM template_versions t WHERE t.person_id=trusted_enrollments.person_id AND t.model=trusted_enrollments.model)")
        con.execute("INSERT INTO biometric_audit(action) VALUES('retention')")
    return {"deleted": deleted, "retention_days": days}


def models():
    global _models
    if _models is None:
        manifest = json.loads((ROOT / "models.json").read_text(encoding="utf8"))
        for filename, metadata in manifest.items():
            path = ROOT / "models" / filename
            if not path.exists() or hashlib.sha256(path.read_bytes()).hexdigest() != metadata["sha256"]:
                raise HTTPException(503, "Face model integrity check failed")
        detector_path = ROOT / "models" / "face_detection_yunet_2023mar.onnx"
        recognizer_path = ROOT / "models" / "face_recognition_sface_2021dec.onnx"
        if not detector_path.exists() or not recognizer_path.exists():
            raise HTTPException(503, "Models are not installed")
        try:
            _models = (cv2.FaceDetectorYN.create(str(detector_path), "", (320, 320), 0.9), cv2.FaceRecognizerSF.create(str(recognizer_path), ""))
        except cv2.error as exc:
            raise HTTPException(503, "Models could not be loaded") from exc
    return _models


class Capture(BaseModel):
    person_id: str = Field(min_length=1, max_length=100, pattern=r"^[a-zA-Z0-9-]+$")
    image: str = Field(max_length=8_000_000)
    evaluation_only: bool = False


class Enrollment(BaseModel):
    person_id: str = Field(min_length=1, max_length=100, pattern=r"^[a-zA-Z0-9-]+$")
    images: list[str] = Field(min_length=3, max_length=5)
    evaluation_only: bool = False


class BoundSession(BaseModel):
    user: str = Field(min_length=1, max_length=100)
    person_id: str = Field(min_length=1, max_length=100)
    store: str = Field(min_length=1, max_length=100)
    login_session: str = Field(min_length=1, max_length=200)


class Evidence(BoundSession):
    session_id: str = Field(max_length=100)
    images: list[str] = Field(min_length=3, max_length=5)
    mode: str = Field(pattern="^(enroll|verify)$")
    evaluation: bool = False
    kind: str = Field(default="genuine", pattern="^(genuine|impostor|photo|screen|video)$")
    lighting: str = Field(default="sin especificar", max_length=100)
    device: str = Field(default="sin especificar", max_length=100)


class GrantCheck(BoundSession):
    grant: str = Field(min_length=1, max_length=500)


@app.post("/grants/inspect")
def inspect_grant(body: GrantCheck, authorization: str | None = Header(default=None)):
    authorize(authorization)
    try:
        return session_manager().inspect_grant(body.grant, binding(body.user, body.person_id, body.store, body.login_session))
    except ValueError as exc:
        raise HTTPException(403, str(exc)) from exc


def session_manager():
    _, key = settings()
    cloud = cloud_store()
    if cloud:
        return CloudSessions(cloud, hashlib.sha256(key + b"session-signing-v1").digest())
    path = Path(os.environ.get("BIOMETRIC_TEST_DB", str(ROOT / "data" / "biometrics.sqlite3"))).resolve()
    path.parent.mkdir(parents=True, exist_ok=True)
    return Sessions(path, hashlib.sha256(key + b"session-signing-v1").digest())


@app.post("/sessions")
def start_session(body: BoundSession, authorization: str | None = Header(default=None)):
    authorize(authorization)
    try:
        return session_manager().create(binding(body.user, body.person_id, body.store, body.login_session))
    except ValueError as exc:
        raise HTTPException(429, str(exc)) from exc


@app.post("/sessions/evidence")
def verify_evidence(body: Evidence, authorization: str | None = Header(default=None)):
    authorize(authorization)
    started = time.perf_counter()
    cpu_started = time.process_time()
    try:
        session_manager().attempt(body.session_id, binding(body.user, body.person_id, body.store, body.login_session))
    except ValueError as exc:
        raise HTTPException(429, str(exc)) from exc
    if len(set(body.images)) != len(body.images):
        raise HTTPException(422, "Repeated capture")
    try:
        challenge = session_manager().challenge(body.session_id, binding(body.user, body.person_id, body.store, body.login_session))
        session_manager().claim_captures([base64.b64decode(image, validate=True) for image in body.images])
    except ValueError as exc:
        raise HTTPException(422, str(exc)) from exc
    try:
        observations = [extract(image, with_pose=True) for image in body.images]
    except HTTPException as exc:
        if not body.evaluation:
            raise
        elapsed = (time.perf_counter()-started)*1000
        cloud = cloud_store()
        if cloud:
            cloud.request("POST", "biometric_evaluations", json={"persona_id": body.person_id, "actor_id": body.user, "kind": body.kind, "lighting": body.lighting, "device": body.device, "latency_ms": elapsed, "result": {"mode": body.mode, "authorized": False, "capture_rejected": True, "reason": str(exc.detail)}})
        return {"evaluation": True, "authorized": False, "capture_rejected": True, "reason": str(exc.detail), "latency_ms": elapsed}
    features = [item[0] for item in observations]
    poses = [item[1] for item in observations]
    if body.evaluation:
        if body.mode == "enroll":
            result = enroll(Enrollment(person_id=body.person_id, images=body.images, evaluation_only=True), authorization)
        else:
            result = compare(Capture(person_id=body.person_id, image=body.images[-1], evaluation_only=True), authorization)
        cloud = cloud_store()
        if cloud:
            if body.mode == "enroll":
                cloud.request("PATCH", "biometric_templates_v2", params={"persona_id": f"eq.{body.person_id}", "model": f"eq.{MODEL_VERSION}:evaluation"}, json={"consented_by": body.user, "consented_at": datetime.now(timezone.utc).isoformat()})
            cloud.request("POST", "biometric_evaluations", json={"persona_id": body.person_id, "actor_id": body.user, "kind": body.kind, "lighting": body.lighting, "device": body.device, "cosine_score": result.get("cosine_score"), "pad_score": min((item[2] for item in observations if item[2] is not None), default=None), "latency_ms": (time.perf_counter()-started)*1000, "result": {"mode": body.mode, "authorized": False, "process_cpu_ms": (time.process_time()-cpu_started)*1000, "working_set_bytes": memory_bytes()}})
        return {**result, "authorized": False, "evaluation": True, "latency_ms": (time.perf_counter()-started)*1000}
    if any(float(np.dot(first, second)) < 0.5 for first in features for second in features):
        raise HTTPException(422, "Face continuity could not be established")
    direction = -1 if challenge == "turn_left_then_center" else 1
    challenge_ok = abs(poses[0]) < 0.18 and abs(poses[-1]) < 0.18 and any(direction * pose > 0.20 for pose in poses[1:-1])
    if not challenge_ok:
        raise HTTPException(422, "Complete the requested turn and return to center")
    if body.mode == "enroll":
        result = enroll(Enrollment(person_id=body.person_id, images=body.images), authorization)
    else:
        result = compare(Capture(person_id=body.person_id, image=body.images[-1]), authorization)
    scores = [item[2] for item in observations]
    policy_path = os.environ.get("BIOMETRIC_VALIDATED_POLICY")
    policy = json.loads(Path(policy_path).read_text(encoding="utf8")) if policy_path else {}
    approved_capture = (policy.get("validated_with_authorized_subjects") is True
                and policy.get("pad_attack_evaluation_passed") is True and policy.get("model") == MODEL_VERSION
                and isinstance(policy.get("cosine_threshold"), (int, float))
                and isinstance(policy.get("pad_threshold"), (int, float))
                and all(score is not None and score >= policy["pad_threshold"] for score in scores))
    cloud = cloud_store()
    if cloud:
        if body.mode == "enroll":
            cloud.request("PATCH", "biometric_templates_v2", params={"persona_id": f"eq.{body.person_id}", "model": f"eq.{MODEL_VERSION}"}, json={"trusted": bool(approved_capture), "consented_by": body.user, "consented_at": datetime.now(timezone.utc).isoformat()})
        template = cloud.template(body.person_id, MODEL_VERSION)
        trusted = template and template["trusted"]
    else:
        with db() as con:
            if body.mode == "enroll" and approved_capture:
                con.execute("INSERT OR REPLACE INTO trusted_enrollments VALUES(?,?)", (body.person_id, MODEL_VERSION))
            trusted = con.execute("SELECT 1 FROM trusted_enrollments WHERE person_id=? AND model=?", (body.person_id, MODEL_VERSION)).fetchone()
    eligible = body.mode == "verify" and approved_capture and bool(trusted) and result["cosine_score"] >= policy["cosine_threshold"]
    grant = session_manager()._issue_after_validated_evidence(body.session_id, binding(body.user, body.person_id, body.store, body.login_session)) if eligible else None
    return {**result, "authorized": bool(grant), "grant": grant, "challenge_verified": True,
            "pad_scores": scores, "reason": None if eligible else "PAD or calibration validation pending"}


def extract(image: str, with_pose=False):
    try:
        raw = base64.b64decode(image, validate=True)
        if len(raw) > 5_000_000:
            raise ValueError("Image too large")
        pixels = cv2.imdecode(np.frombuffer(raw, dtype=np.uint8), cv2.IMREAD_COLOR)
        if pixels is None or pixels.shape[0] * pixels.shape[1] > 12_000_000:
            raise ValueError("Invalid image")
    except (ValueError, cv2.error) as exc:
        raise HTTPException(400, "Invalid capture") from exc
    gray = cv2.cvtColor(pixels, cv2.COLOR_BGR2GRAY)
    if gray.mean() < 45 or gray.mean() > 225:
        raise HTTPException(422, "Adjust lighting")
    with lock:
        detector, recognizer = models()
        detector.setInputSize((pixels.shape[1], pixels.shape[0]))
        _, faces = detector.detect(pixels)
        if faces is None or len(faces) != 1:
            raise HTTPException(422, "Exactly one face is required")
        face = faces[0]
        if min(face[2], face[3]) < 100:
            raise HTTPException(422, "Move closer to the camera")
        aligned = recognizer.alignCrop(pixels, face)
        if cv2.Laplacian(cv2.cvtColor(aligned, cv2.COLOR_BGR2GRAY), cv2.CV_64F).var() < 30:
            raise HTTPException(422, "Image is too blurry")
        feature = recognizer.feature(aligned).astype(np.float32).reshape(-1)
        pad = pad_engine() if with_pose else None
        pad_score = pad.score(pixels, face) if pad else None
    norm = np.linalg.norm(feature)
    if not np.isfinite(norm) or norm == 0:
        raise HTTPException(422, "Invalid face descriptor")
    # YuNet: eyes at indices 4..7, nose at 8..9. Signed horizontal ratio.
    eye_midpoint = (float(face[4]) + float(face[6])) / 2
    eye_span = max(1.0, abs(float(face[6]) - float(face[4])))
    pose = (float(face[8]) - eye_midpoint) / eye_span
    return (feature / norm, pose, pad_score) if with_pose else feature / norm


@app.get("/health")
def health():
    return {"status": "experimental", "storage": "cloud" if cloud_store() else "sqlite-test", "liveness": "configured-unvalidated" if os.environ.get("BIOMETRIC_PAD_MANIFEST") else "unavailable", "attendance_authorization": False}


@app.post("/experimental/enroll")
def enroll(body: Enrollment, authorization: str | None = Header(default=None)):
    authorize(authorization)
    if len(set(body.images)) != len(body.images):
        raise HTTPException(422, "Captures must be distinct")
    features = [extract(image) for image in body.images]
    if any(float(np.dot(first, second)) < 0.5 for index, first in enumerate(features) for second in features[index + 1:]):
        raise HTTPException(422, "Samples do not have consistent identity")
    feature = np.mean(features, axis=0)
    norm = np.linalg.norm(feature)
    if not np.isfinite(norm) or norm == 0:
        raise HTTPException(422, "Invalid enrollment samples")
    feature = (feature / norm).astype(np.float32)
    _, key = settings()
    model = MODEL_VERSION + (":evaluation" if body.evaluation_only else "")
    ciphertext = encryption_ring().seal(feature.tobytes(), f"{body.person_id}:{model}".encode())
    cloud = cloud_store()
    if cloud:
        cloud.save_template(body.person_id, model, ciphertext)
        return {"status": "experimental_enrolled", "model": MODEL_VERSION, "liveness_verified": False}
    with db() as con:
        con.execute("DELETE FROM trusted_enrollments WHERE person_id=? AND model=?", (body.person_id, model))
        con.execute("INSERT INTO template_versions(person_id,model,ciphertext) VALUES (?,?,?) ON CONFLICT(person_id,model) DO UPDATE SET ciphertext=excluded.ciphertext,created_at=CURRENT_TIMESTAMP", (body.person_id, model, ciphertext))
        con.execute("INSERT INTO biometric_audit(action,person_id) VALUES('experimental_enroll',?)", (body.person_id,))
    return {"status": "experimental_enrolled", "model": MODEL_VERSION, "liveness_verified": False}


@app.post("/experimental/compare")
def compare(body: Capture, authorization: str | None = Header(default=None)):
    authorize(authorization)
    model = MODEL_VERSION + (":evaluation" if body.evaluation_only else "")
    cloud = cloud_store()
    if cloud:
        template = cloud.template(body.person_id, model)
        row = (template["model"],template["ciphertext"].encode()) if template else None
    else:
        with db() as con:
            row = con.execute("SELECT model,ciphertext FROM template_versions WHERE person_id=? AND model=?", (body.person_id, model)).fetchone()
    if not row or row[0] != model:
        raise HTTPException(404, "Compatible template not found")
    _, key = settings()
    try:
        context = f"{body.person_id}:{model}".encode()
        plaintext = encryption_ring().open(row[1], context) if row[1].startswith(b'{') else AESGCM(key).decrypt(row[1][:12], row[1][12:], context)
        reference = np.frombuffer(plaintext, dtype=np.float32)
    except Exception as exc:
        raise HTTPException(503, "Template cannot be decrypted") from exc
    sample = extract(body.image)
    if reference.shape != sample.shape:
        raise HTTPException(503, "Incompatible template")
    return {"cosine_score": float(np.dot(reference, sample)), "calibrated": False, "attendance_authorized": False, "reason": "liveness_unavailable"}


@app.get("/lab")
def laboratory():
    return FileResponse(ROOT / "lab.html", headers={"Cache-Control": "no-store", "Content-Security-Policy": "default-src 'self'; script-src 'unsafe-inline'; style-src 'unsafe-inline'; connect-src 'self'; media-src blob:; img-src data: 'self'; frame-ancestors 'none'"})


@app.get("/experimental/status/{person_id}")
def template_status(person_id: str, authorization: str | None = Header(default=None), evaluation: bool = False):
    authorize(authorization)
    cloud = cloud_store()
    if cloud:
        template = cloud.template(person_id, MODEL_VERSION + (":evaluation" if evaluation else ""))
        return {"status": "registered" if template else "pending", "model": MODEL_VERSION if template else None, "liveness_verified": bool(template and template["trusted"])}
    with db() as con:
        row = con.execute("SELECT model,created_at FROM template_versions WHERE person_id=? AND model=?", (person_id, MODEL_VERSION)).fetchone()
    return {"status": "experimental_registered" if row else "pending", "model": row[0] if row else None, "liveness_verified": False}


@app.delete("/experimental/templates/{person_id}")
def revoke(person_id: str, authorization: str | None = Header(default=None), evaluation: bool = False):
    authorize(authorization)
    if evaluation and cloud_store():
        cloud_store().request("DELETE", "biometric_templates_v2", params={"persona_id": f"eq.{person_id}", "model": f"eq.{MODEL_VERSION}:evaluation"})
        cloud_store().request("DELETE", "biometric_evaluations", params={"persona_id": f"eq.{person_id}"})
        cloud_store().audit("evaluation_revocation", person_id)
        return {"status": "revoked"}
    session_manager().revoke_person(person_id)
    if cloud_store():
        return {"status": "revoked"}
    with db() as con:
        con.execute("DELETE FROM template_versions WHERE person_id=?", (person_id,))
        con.execute("DELETE FROM trusted_enrollments WHERE person_id=?", (person_id,))
        con.execute("INSERT INTO biometric_audit(action,person_id) VALUES('revocation',?)", (person_id,))
    return {"status": "revoked"}


@asynccontextmanager
async def lifespan(application):
    async def maintain():
        while True:
            try:
                token, _ = settings()
                await asyncio.to_thread(retention, f"Bearer {token}")
            except Exception:
                logging.getLogger("biometric").warning("Biometric retention maintenance failed; retrying later")
            await asyncio.sleep(3600)
    task = asyncio.create_task(maintain())
    yield
    task.cancel()
    try:
        await task
    except asyncio.CancelledError:
        pass


app.router.lifespan_context = lifespan
