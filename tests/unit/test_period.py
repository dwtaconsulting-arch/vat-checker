from datetime import date

import pytest

from vat_calculator.core.period import Half, ReturnKind, TaxPeriod, next_business_day

P, F = ReturnKind.PRELIMINARY, ReturnKind.FINAL


@pytest.mark.parametrize(
    "half, kind, due",
    [
        (1, P, date(2026, 4, 25)),
        (1, F, date(2026, 7, 25)),
        (2, P, date(2026, 10, 25)),
        (2, F, date(2027, 1, 25)),  # 2기 확정은 다음 해 1월
    ],
)
def test_statutory_due_date(half, kind, due):
    assert TaxPeriod(2026, half, kind).statutory_due_date == due


@pytest.mark.parametrize(
    "half, kind, preliminary_filed, expected",
    [
        (1, P, True, (date(2026, 1, 1), date(2026, 3, 31))),
        (1, F, True, (date(2026, 4, 1), date(2026, 6, 30))),
        (1, F, False, (date(2026, 1, 1), date(2026, 6, 30))),  # 예정고지 개인
        (2, P, True, (date(2026, 7, 1), date(2026, 9, 30))),
        (2, F, True, (date(2026, 10, 1), date(2026, 12, 31))),
        (2, F, False, (date(2026, 7, 1), date(2026, 12, 31))),
    ],
)
def test_reporting_range(half, kind, preliminary_filed, expected):
    assert TaxPeriod(2026, half, kind).reporting_range(preliminary_filed=preliminary_filed) == expected


def test_due_date_weekend_shift():
    # 2026-04-25 토요일 → 4-27 월요일
    assert TaxPeriod(2026, 1, P).due_date() == date(2026, 4, 27)
    # 2026-07-25 토요일 → 7-27 월요일
    assert TaxPeriod(2026, 1, F).due_date() == date(2026, 7, 27)


def test_due_date_holiday_shift():
    # 월요일이 공휴일이면 화요일
    assert TaxPeriod(2026, 1, P).due_date(holidays=[date(2026, 4, 27)]) == date(2026, 4, 28)


def test_next_business_day_weekday_unchanged():
    assert next_business_day(date(2026, 11, 17)) == date(2026, 11, 17)  # 화요일


def test_label_and_half_coercion():
    p = TaxPeriod(2026, 2, F)
    assert p.half is Half.SECOND
    assert p.label == "2026년 2기 확정"
