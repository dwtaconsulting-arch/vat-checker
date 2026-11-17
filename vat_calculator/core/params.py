"""적용기간별 세법 파라미터.

params/*.toml 형식:

    [[standard_rate]]
    value = "0.10"            # 반드시 문자열 또는 정수 (float 금지)
    effective_from = 1977-07-01
    effective_to = 9999-12-31 # 생략 가능 (생략 시 무기한)
    basis = "부가가치세법 제30조"

같은 이름의 기간이 겹치면 로드 단계에서 오류를 낸다.
"""
from __future__ import annotations

import tomllib
from dataclasses import dataclass
from datetime import date
from fractions import Fraction
from pathlib import Path

from .money import to_fraction

DEFAULT_PARAMS_DIR = Path(__file__).resolve().parent.parent / "params"
_OPEN_END = date(9999, 12, 31)


@dataclass(frozen=True)
class ParamValue:
    name: str
    value: Fraction
    effective_from: date
    effective_to: date
    basis: str

    def covers(self, d: date) -> bool:
        return self.effective_from <= d <= self.effective_to


class ParamTable:
    def __init__(self, values: dict[str, list[ParamValue]]) -> None:
        self._values = values

    @classmethod
    def load_dir(cls, directory: Path = DEFAULT_PARAMS_DIR) -> "ParamTable":
        values: dict[str, list[ParamValue]] = {}
        for path in sorted(Path(directory).glob("*.toml")):
            with path.open("rb") as f:
                data = tomllib.load(f)
            for name, rows in data.items():
                if name in values:
                    raise ValueError(f"파라미터 '{name}'가 여러 파일에 정의됨 ({path.name})")
                values[name] = [_parse_row(name, row, path) for row in rows]
        for name, rows in values.items():
            _check_no_overlap(name, rows)
        return cls(values)

    def get(self, name: str, on: date) -> ParamValue:
        rows = self._values.get(name)
        if rows is None:
            raise KeyError(f"정의되지 않은 파라미터: {name}")
        for row in rows:
            if row.covers(on):
                return row
        raise LookupError(f"'{name}'에 {on.isoformat()} 적용값이 없습니다")

    def names(self) -> list[str]:
        return sorted(self._values)


def _parse_row(name: str, row: dict, path: Path) -> ParamValue:
    where = f"{path.name} [{name}]"
    for required in ("value", "effective_from", "basis"):
        if required not in row:
            raise ValueError(f"{where}: '{required}' 누락")
    start = row["effective_from"]
    end = row.get("effective_to", _OPEN_END)
    if not isinstance(start, date) or not isinstance(end, date):
        raise ValueError(f"{where}: 적용일은 날짜(YYYY-MM-DD)여야 합니다")
    if start > end:
        raise ValueError(f"{where}: 시작일이 종료일보다 늦습니다")
    try:
        value = to_fraction(row["value"])
    except TypeError as e:
        raise ValueError(f"{where}: {e}") from None
    return ParamValue(name, value, start, end, str(row["basis"]))


def _check_no_overlap(name: str, rows: list[ParamValue]) -> None:
    ordered = sorted(rows, key=lambda r: r.effective_from)
    for prev, cur in zip(ordered, ordered[1:]):
        if cur.effective_from <= prev.effective_to:
            raise ValueError(
                f"'{name}' 적용기간 겹침: {prev.effective_from}~{prev.effective_to} / "
                f"{cur.effective_from}~{cur.effective_to}"
            )
