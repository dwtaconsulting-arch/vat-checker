"""과세기간·신고기간·신고기한.

- 1기: 1/1~6/30 (예정신고기간 1/1~3/31)
- 2기: 7/1~12/31 (예정신고기간 7/1~9/30)
- 신고기한: 각 기간 종료일이 속한 달의 다음 달 25일
- 기한이 토요일·일요일·공휴일이면 다음 영업일 (국세기본법 제5조)
  공휴일 목록은 호출하는 쪽에서 넘긴다 (파라미터 파일로 관리 예정).
"""
from __future__ import annotations

from collections.abc import Iterable
from dataclasses import dataclass
from datetime import date, timedelta
from enum import Enum, IntEnum


class Half(IntEnum):
    FIRST = 1
    SECOND = 2


class ReturnKind(Enum):
    PRELIMINARY = "예정"
    FINAL = "확정"


@dataclass(frozen=True)
class TaxPeriod:
    year: int
    half: Half
    kind: ReturnKind

    def __post_init__(self) -> None:
        object.__setattr__(self, "half", Half(self.half))

    @property
    def label(self) -> str:
        return f"{self.year}년 {self.half.value}기 {self.kind.value}"

    # 과세기간 전체 (6개월)
    @property
    def taxable_start(self) -> date:
        return date(self.year, 1 if self.half is Half.FIRST else 7, 1)

    @property
    def taxable_end(self) -> date:
        return date(self.year, 6, 30) if self.half is Half.FIRST else date(self.year, 12, 31)

    # 예정신고기간 (앞 3개월)
    @property
    def preliminary_end(self) -> date:
        return date(self.year, 3, 31) if self.half is Half.FIRST else date(self.year, 9, 30)

    def reporting_range(self, *, preliminary_filed: bool = True) -> tuple[date, date]:
        """이번 신고서에 담을 거래 기간.

        확정신고에서 예정신고를 하지 않은 경우(예: 예정고지 받은 개인)는
        과세기간 6개월 전체를 신고한다.
        """
        if self.kind is ReturnKind.PRELIMINARY:
            return self.taxable_start, self.preliminary_end
        if preliminary_filed:
            return self.preliminary_end + timedelta(days=1), self.taxable_end
        return self.taxable_start, self.taxable_end

    @property
    def statutory_due_date(self) -> date:
        """법정 신고기한 (휴일 조정 전)."""
        end = self.preliminary_end if self.kind is ReturnKind.PRELIMINARY else self.taxable_end
        if end.month == 12:
            return date(end.year + 1, 1, 25)
        return date(end.year, end.month + 1, 25)

    def due_date(self, holidays: Iterable[date] = ()) -> date:
        """휴일 조정 후 신고·납부기한."""
        return next_business_day(self.statutory_due_date, holidays)


def next_business_day(d: date, holidays: Iterable[date] = ()) -> date:
    """d가 토·일·공휴일이면 그 다음 영업일, 아니면 d."""
    off = set(holidays)
    while d.weekday() >= 5 or d in off:
        d += timedelta(days=1)
    return d
