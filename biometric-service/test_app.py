import base64
import numpy as np
from fastapi.testclient import TestClient
import app


def configure(monkeypatch, tmp_path):
    monkeypatch.setenv("BIOMETRIC_SERVICE_TOKEN", "t" * 32)
    monkeypatch.setenv("BIOMETRIC_ENCRYPTION_KEY", base64.b64encode(b"k" * 32).decode())
    monkeypatch.setenv("BIOMETRIC_TEST_DB", str(tmp_path / "test.sqlite3"))
    monkeypatch.setattr(app, "extract", lambda _: np.array([1, 0], dtype=np.float32))
    return TestClient(app.app)


def test_auth_and_no_attendance_authorization(monkeypatch, tmp_path):
    client = configure(monkeypatch, tmp_path)
    body = {"person_id": "person-1", "image": "AA=="}
    enrollment = {"person_id": "person-1", "images": ["AQ==", "Ag==", "Aw=="]}
    assert client.post("/experimental/enroll", json=enrollment).status_code == 401
    headers = {"Authorization": "Bearer " + "t" * 32}
    assert client.post("/experimental/enroll", json={**enrollment, "images": ["AQ=="]}, headers=headers).status_code == 422
    assert client.post("/experimental/enroll", json={**enrollment, "images": ["AQ=="] * 3}, headers=headers).status_code == 422
    assert client.post("/experimental/enroll", json=enrollment, headers=headers).status_code == 200
    response = client.post("/experimental/compare", json=body, headers=headers)
    assert response.status_code == 200
    assert response.json()["attendance_authorized"] is False
    assert response.json()["calibrated"] is False
    assert client.post("/experimental/compare", json={**body, "person_id": "other"}, headers=headers).status_code == 404
    assert b"\x00\x00\x80\x3f\x00\x00\x00\x00" not in (tmp_path / "test.sqlite3").read_bytes()


def test_invalid_image_fails_closed(monkeypatch, tmp_path):
    client = configure(monkeypatch, tmp_path)
    monkeypatch.undo()
    try:
        app.extract("not-base64")
        assert False
    except Exception as exc:
        assert getattr(exc, "status_code", None) == 400


def test_maintenance_rotation_retention_revocation(monkeypatch, tmp_path):
    import json
    client = configure(monkeypatch, tmp_path)
    headers = {"Authorization": "Bearer " + "t" * 32}
    enrollment = {"person_id": "person-1", "images": ["AQ==", "Ag==", "Aw=="]}
    assert client.post("/experimental/enroll", json=enrollment, headers=headers).status_code == 200
    monkeypatch.setenv("BIOMETRIC_KEYRING_JSON", json.dumps({"v1": base64.b64encode(b"k" * 32).decode(), "v2": base64.b64encode(b"n" * 32).decode()}))
    monkeypatch.setenv("BIOMETRIC_ACTIVE_KEY_ID", "v2")
    rotated = client.post("/maintenance/rotate", headers=headers)
    assert rotated.status_code == 200 and rotated.json()["rotated"] == 1
    assert client.post("/experimental/compare", json={"person_id": "person-1", "image": "AA=="}, headers=headers).status_code == 200
    assert client.post("/maintenance/rotate").status_code == 401
    assert client.delete("/experimental/templates/person-1", headers=headers).status_code == 200
    assert client.get("/experimental/status/person-1", headers=headers).json()["status"] == "pending"
    client.post("/experimental/enroll", json=enrollment, headers=headers)
    with app.db() as con:
        con.execute("UPDATE template_versions SET created_at='2000-01-01'")
    assert client.post("/maintenance/retention", headers=headers).json()["deleted"] == 1
    with app.db() as con:
        assert con.execute("SELECT count(*) FROM biometric_audit").fetchone()[0] == 5
