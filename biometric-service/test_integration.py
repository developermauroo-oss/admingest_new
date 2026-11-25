import base64
from fastapi.testclient import TestClient
import app


def test_session_api_bound_attempt_limit(monkeypatch, tmp_path):
    monkeypatch.setenv("BIOMETRIC_SERVICE_TOKEN", "t" * 32)
    monkeypatch.setenv("BIOMETRIC_ENCRYPTION_KEY", base64.b64encode(b"k" * 32).decode())
    monkeypatch.setenv("BIOMETRIC_TEST_DB", str(tmp_path / "test.db"))
    client = TestClient(app.app)
    headers = {"Authorization": "Bearer " + "t" * 32}
    bound = {"user": "user", "person_id": "person", "store": "store", "login_session": "session"}
    created = client.post("/sessions", json=bound, headers=headers)
    assert created.status_code == 200
    evidence = {**bound, "session_id": created.json()["id"], "images": ["AA=="] * 3, "mode": "verify"}
    assert client.post("/sessions/evidence", json={**evidence, "person_id": "other"}, headers=headers).status_code == 429
    for _ in range(3):
        assert client.post("/sessions/evidence", json=evidence, headers=headers).status_code == 422
    assert client.post("/sessions/evidence", json=evidence, headers=headers).status_code == 429
    assert client.post("/sessions", json=bound).status_code == 401
