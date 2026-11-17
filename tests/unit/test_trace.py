import pytest

from vat_calculator.core.trace import Trace


def test_record_returns_value_and_keeps_detail():
    t = Trace()
    v = t.record(
        "output.invoice.tax",
        "과세 세금계산서 발급분 세액",
        100,
        formula="공급가액 × 10% (원 미만 절사)",
        inputs={"공급가액": 1_005},
        params={"standard_rate": "0.10"},
        basis="부가가치세법 제30조",
    )
    assert v == 100
    e = t["output.invoice.tax"]
    assert e.inputs == {"공급가액": 1_005}
    assert e.basis == "부가가치세법 제30조"
    assert "output.invoice.tax" in t and len(t) == 1


def test_duplicate_key_rejected():
    t = Trace()
    t.record("a", "A", 1)
    with pytest.raises(KeyError):
        t.record("a", "A", 2)


@pytest.mark.parametrize("bad", [1.0, "100", True])
def test_value_must_be_int(bad):
    with pytest.raises(TypeError):
        Trace().record("a", "A", bad)
