from decimal import Decimal
from fractions import Fraction

import pytest

from vat_calculator.core.money import (
    Rounding,
    SplitBasis,
    round_won,
    split_gross,
    tax_on_supply,
    to_fraction,
)


class TestToFraction:
    @pytest.mark.parametrize(
        "raw, expected",
        [
            (1000, 1000),
            ("1,234,567", 1234567),
            ("  1,000 ", 1000),
            ("-1,000", -1000),
            ("△1,000", -1000),
            ("▲500", -500),
            ("(2,000)", -2000),
            ("0.1", Fraction(1, 10)),
            (Decimal("0.10"), Fraction(1, 10)),
        ],
    )
    def test_accepts(self, raw, expected):
        assert to_fraction(raw) == expected

    def test_rejects_float(self):
        with pytest.raises(TypeError, match="float"):
            to_fraction(0.1)

    def test_rejects_bool(self):
        with pytest.raises(TypeError):
            to_fraction(True)

    @pytest.mark.parametrize("raw", ["", "  ", "abc", "1,0a0", "NaN", "Infinity"])
    def test_rejects_bad_strings(self, raw):
        with pytest.raises(ValueError):
            to_fraction(raw)


class TestRoundWon:
    @pytest.mark.parametrize(
        "value, rounding, expected",
        [
            ("100.9", Rounding.TRUNCATE, 100),
            ("100.5", Rounding.HALF_UP, 101),
            ("100.49", Rounding.HALF_UP, 100),
            ("100.01", Rounding.UP, 101),
            ("100", Rounding.UP, 100),
            # 음수: 절댓값 기준 처리 (마이너스 세금계산서)
            ("-100.9", Rounding.TRUNCATE, -100),
            ("-100.5", Rounding.HALF_UP, -101),
            ("-100.01", Rounding.UP, -101),
        ],
    )
    def test_modes(self, value, rounding, expected):
        assert round_won(value, rounding) == expected

    def test_ten_won_unit(self):
        assert round_won(12_345, Rounding.TRUNCATE, unit=10) == 12_340
        assert round_won(-12_345, Rounding.TRUNCATE, unit=10) == -12_340

    def test_exact_fraction_no_drift(self):
        # 1/3을 세 번 더하면 정확히 1 (float이면 0.999...)
        third = Fraction(1, 3)
        assert round_won(third + third + third) == 1


class TestTaxOnSupply:
    @pytest.mark.parametrize(
        "supply, expected",
        [(0, 0), (1, 0), (9, 0), (10, 1), (1_005, 100), (123_456_789, 12_345_678), (-1_005, -100)],
    )
    def test_ten_percent_truncate(self, supply, expected):
        assert tax_on_supply(supply, "0.1") == expected

    def test_zero_rate(self):
        assert tax_on_supply(50_000_000, 0) == 0


class TestSplitGross:
    @pytest.mark.parametrize("gross", [0, 1, 10, 11, 109, 110, 111, 1_000, 33_000, 99_999, 1_234_567, -55_555])
    @pytest.mark.parametrize("basis", list(SplitBasis))
    @pytest.mark.parametrize("rounding", list(Rounding))
    def test_parts_always_sum_to_gross(self, gross, basis, rounding):
        supply, tax = split_gross(gross, "0.1", basis, rounding)
        assert supply + tax == gross

    def test_tax_first_truncate(self):
        # 10,000 × 10/110 = 909.09 → 909
        assert split_gross(10_000, "0.1") == (9_091, 909)

    def test_supply_first_half_up(self):
        # 10,000 ÷ 1.1 = 9,090.909 → 9,091
        assert split_gross(10_000, "0.1", SplitBasis.SUPPLY, Rounding.HALF_UP) == (9_091, 909)

    def test_supply_first_truncate_differs(self):
        # 같은 금액이라도 방식에 따라 1원 차이가 난다 → 프로그램별 방식 확정 필요
        assert split_gross(10_000, "0.1", SplitBasis.SUPPLY, Rounding.TRUNCATE) == (9_090, 910)

    def test_exact_division(self):
        assert split_gross(110_000, "0.1") == (100_000, 10_000)

    def test_rejects_non_integer_gross(self):
        with pytest.raises(ValueError):
            split_gross("100.5", "0.1")
