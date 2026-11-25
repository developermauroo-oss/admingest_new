import pytest
from calibrate import evaluate


def test_rates_are_empirical_and_do_not_approve_production():
    report = evaluate([{"same_person": "1", "cosine_score": "0.8", "latency_ms": "10"}, {"same_person": "0", "cosine_score": "0.2", "latency_ms": "20"}], 0.5)
    assert report["far"] == report["frr"] == 0
    assert report["production_approved"] is False
    with pytest.raises(ValueError):
        evaluate([], 0.5)
