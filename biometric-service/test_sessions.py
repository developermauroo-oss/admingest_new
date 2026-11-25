from concurrent.futures import ThreadPoolExecutor
import sqlite3
import pytest
from sessions import Sessions, binding


def test_limits_binding_and_concurrency(tmp_path):
    manager = Sessions(tmp_path / "sessions.db", b"x" * 32)
    bound = binding("user", "employee", "store", "login-session")
    sid = manager.create(bound)["id"]
    def attempt(_):
        try:
            manager.attempt(sid, bound)
            return True
        except ValueError:
            return False
    with ThreadPoolExecutor(max_workers=8) as pool:
        assert sum(pool.map(attempt, range(8))) == 3
    token = manager._issue_after_validated_evidence(sid, bound)
    with pytest.raises(ValueError):
        manager.consume_and_record(token, binding("other", "employee", "store", "login-session"))
    def consume(_):
        try:
            manager.consume_and_record(token, bound)
            return True
        except ValueError:
            return False
    with ThreadPoolExecutor(max_workers=8) as pool:
        assert sum(pool.map(consume, range(8))) == 1
    with manager.connection() as db:
        assert db.execute("SELECT count(*) FROM attendance_lab").fetchone()[0] == 1
    with pytest.raises(ValueError):
        manager.consume_and_record(token + "tampered", bound)


def test_expiration_and_repeat_sessions(tmp_path):
    manager = Sessions(tmp_path / "sessions.db", b"x" * 32)
    bound = binding("user", "employee", "store", "session")
    sid = manager.create(bound)["id"]
    manager.attempt(sid, bound)
    token = manager._issue_after_validated_evidence(sid, bound)
    with manager.connection() as db:
        db.execute("UPDATE grants SET expires=0")
        db.execute("UPDATE sessions SET expires=0")
    with pytest.raises(ValueError):
        manager.consume_and_record(token, bound)
    with pytest.raises(ValueError):
        manager.attempt(sid, bound)
    for _ in range(3):
        manager.create(bound)
    with pytest.raises(ValueError):
        manager.create(bound)


def test_revocation_invalidates_outstanding_grants(tmp_path):
    manager = Sessions(tmp_path / "sessions.db", b"x" * 32)
    bound = binding("user", "employee", "store", "login")
    sid = manager.create(bound)["id"]
    manager.attempt(sid, bound)
    grant = manager._issue_after_validated_evidence(sid, bound)
    assert manager.inspect_grant(grant, bound)["token_hash"]
    manager.revoke_person("employee")
    with pytest.raises(ValueError):
        manager.inspect_grant(grant, bound)
    with pytest.raises(ValueError):
        manager.attempt(sid, bound)
