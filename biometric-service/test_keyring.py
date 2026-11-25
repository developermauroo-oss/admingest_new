import pytest
from keyring import KeyRing


def test_rotation_and_context_binding():
    old = KeyRing({"old": b"a" * 32}, "old")
    payload = old.seal(b"private-template", b"employee:model")
    new = KeyRing({"old": b"a" * 32, "new": b"b" * 32}, "new")
    rotated = new.rotate(payload, b"employee:model")
    assert KeyRing({"new": b"b" * 32}, "new").open(rotated, b"employee:model") == b"private-template"
    with pytest.raises(Exception):
        new.open(rotated, b"other-employee:model")
    with pytest.raises(Exception):
        old.open(rotated, b"employee:model")
