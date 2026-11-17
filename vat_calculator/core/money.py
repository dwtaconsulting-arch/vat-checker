"""금액 변환과 단수처리.

원칙
- float는 받지 않는다 (2진 부동소수점 오차 원천 차단).
- 내부 계산은 Fraction(유리수)으로 해서 나눗셈도 오차 없이 하고,
  단수처리는 이 모듈의 함수에서만 한 번 한다.
- 단수처리 결과는 항상 원 단위 int.
"""
from __future__ import annotations

from decimal import Decimal, InvalidOperation
from enum import Enum
from fractions import Fraction
import math

Number = int | str | Decimal | Fraction


class Rounding(Enum):
    TRUNCATE = "절사"  # 0 방향으로 버림 (음수도 절댓값 기준 버림)
    HALF_UP = "반올림"  # 0.5는 0에서 멀어지는 쪽으로
    UP = "절상"  # 0에서 멀어지는 쪽으로 올림


class SplitBasis(Enum):
    TAX = "세액 먼저"  # 세액 = 공급대가 × 세율/(1+세율) 단수처리, 공급가액 = 공급대가 − 세액
    SUPPLY = "공급가액 먼저"  # 공급가액 = 공급대가 ÷ (1+세율) 단수처리, 세액 = 공급대가 − 공급가액


_NEGATIVE_MARKS = ("△", "▲", "-")


def to_fraction(value: Number) -> Fraction:
    """금액·비율 입력을 정확한 유리수로 변환한다.

    문자열은 천 단위 쉼표, 앞뒤 공백, 음수 표기(-, △, ▲, 괄호)를 허용한다.
    """
    if isinstance(value, bool):
        raise TypeError("bool은 금액으로 쓸 수 없습니다")
    if isinstance(value, float):
        raise TypeError(f"float는 오차 위험으로 금지합니다. 문자열이나 Decimal로 넘기세요: {value!r}")
    if isinstance(value, Fraction):
        return value
    if isinstance(value, int):
        return Fraction(value)
    if isinstance(value, Decimal):
        if not value.is_finite():
            raise ValueError(f"유한한 수가 아닙니다: {value!r}")
        return Fraction(value)
    if isinstance(value, str):
        return Fraction(_parse_decimal_str(value))
    raise TypeError(f"지원하지 않는 금액 형식: {type(value).__name__}")


def _parse_decimal_str(raw: str) -> Decimal:
    s = raw.strip().replace(",", "").replace(" ", "")
    negative = False
    if s.startswith("(") and s.endswith(")"):
        negative, s = True, s[1:-1]
    for mark in _NEGATIVE_MARKS:
        if s.startswith(mark):
            negative, s = not negative, s[len(mark):]
            break
    if not s:
        raise ValueError(f"빈 금액입니다: {raw!r}")
    try:
        d = Decimal(s)
    except InvalidOperation:
        raise ValueError(f"숫자로 읽을 수 없습니다: {raw!r}") from None
    if not d.is_finite():
        raise ValueError(f"유한한 수가 아닙니다: {raw!r}")
    return -d if negative else d


def round_won(value: Number, rounding: Rounding = Rounding.TRUNCATE, unit: int = 1) -> int:
    """원 단위(unit=10이면 10원 단위)로 단수처리한다."""
    if unit <= 0:
        raise ValueError("unit은 양수여야 합니다")
    q = to_fraction(value) / unit
    sign = -1 if q < 0 else 1
    a = abs(q)
    if rounding is Rounding.TRUNCATE:
        n = math.floor(a)
    elif rounding is Rounding.UP:
        n = math.ceil(a)
    elif rounding is Rounding.HALF_UP:
        n = math.floor(a + Fraction(1, 2))
    else:  # pragma: no cover
        raise ValueError(rounding)
    return sign * n * unit


def tax_on_supply(supply: Number, rate: Number, rounding: Rounding = Rounding.TRUNCATE) -> int:
    """공급가액 × 세율 → 세액."""
    return round_won(to_fraction(supply) * to_fraction(rate), rounding)


def split_gross(
    gross: Number,
    rate: Number,
    basis: SplitBasis = SplitBasis.TAX,
    rounding: Rounding = Rounding.TRUNCATE,
) -> tuple[int, int]:
    """공급대가(부가세 포함)를 (공급가액, 세액)으로 나눈다.

    어떤 방식이든 공급가액 + 세액 = 공급대가가 항상 성립한다.
    기본값(세액 먼저·절사)은 '공급대가 × 10/110' 방식이다.
    실무 프로그램별 방식은 샘플 대사로 확정한다.
    """
    g = to_fraction(gross)
    if g.denominator != 1:
        raise ValueError(f"공급대가는 원 단위 정수여야 합니다: {gross!r}")
    r = to_fraction(rate)
    if r < 0:
        raise ValueError("세율은 음수일 수 없습니다")
    total = int(g)
    if basis is SplitBasis.TAX:
        tax = round_won(g * r / (1 + r), rounding)
        return total - tax, tax
    supply = round_won(g / (1 + r), rounding)
    return supply, total - supply
