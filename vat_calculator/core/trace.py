"""계산근거(trace) 기록.

모든 신고서 칸은 Trace.record()를 거쳐 값을 확정한다.
그래서 결과마다 '산식 / 입력값 / 적용 파라미터 / 법령 근거'가 남고,
대사표에서 차이 난 칸의 원인을 역추적할 수 있다.
"""
from __future__ import annotations

from dataclasses import dataclass, field
from typing import Any


@dataclass(frozen=True)
class TraceEntry:
    key: str  # 내부 식별자 (예: "output.taxable.invoice.tax")
    label: str  # 사람이 읽는 이름 (예: "과세 세금계산서 발급분 세액")
    value: int
    formula: str = ""  # 예: "공급가액 × 10% (원 미만 절사)"
    inputs: dict[str, Any] = field(default_factory=dict)
    params: dict[str, Any] = field(default_factory=dict)
    basis: str = ""  # 법령 근거 (예: "부가가치세법 제30조")


class Trace:
    def __init__(self) -> None:
        self._entries: dict[str, TraceEntry] = {}

    def record(
        self,
        key: str,
        label: str,
        value: int,
        *,
        formula: str = "",
        inputs: dict[str, Any] | None = None,
        params: dict[str, Any] | None = None,
        basis: str = "",
    ) -> int:
        """값을 기록하고 그대로 돌려준다. 같은 key를 두 번 기록하면 오류."""
        if isinstance(value, bool) or not isinstance(value, int):
            raise TypeError(f"{key}: 확정 금액은 원 단위 int여야 합니다 ({type(value).__name__})")
        if key in self._entries:
            raise KeyError(f"이미 기록된 항목입니다: {key}")
        self._entries[key] = TraceEntry(
            key, label, value, formula, dict(inputs or {}), dict(params or {}), basis
        )
        return value

    def __getitem__(self, key: str) -> TraceEntry:
        return self._entries[key]

    def __contains__(self, key: str) -> bool:
        return key in self._entries

    def __iter__(self):
        return iter(self._entries.values())

    def __len__(self) -> int:
        return len(self._entries)

    def value(self, key: str) -> int:
        return self._entries[key].value
