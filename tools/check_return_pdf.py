"""신고서 PDF 내부 정합성 점검 실행.

사용: python tools/check_return_pdf.py 신고서.pdf
종료코드: ERROR가 있으면 1, 아니면 0
"""
from __future__ import annotations

import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent.parent))

from vat_calculator.checks.return_consistency import ERROR, OK, SKIP, WARN, check_return  # noqa: E402
from vat_calculator.io.return_pdf import parse_return_pdf  # noqa: E402

MARK = {OK: "✅", ERROR: "❌", WARN: "⚠️", SKIP: "➖"}


def fmt(v):
    return "" if v is None else f"{v:,}"


def main() -> None:
    path = Path(sys.argv[1])
    r = parse_return_pdf(path)
    print(f"파일: {path.name}")
    print("인식한 서식(쪽):", ", ".join(f"{k} {v}" for k, v in r.found_forms.items()))
    results = check_return(r)
    group = None
    for c in results:
        if c.group != group:
            group = c.group
            print(f"\n[{group}]")
        nums = ""
        if c.expected is not None or c.actual is not None:
            nums = f"  산식 {fmt(c.expected)} / 신고서 {fmt(c.actual)}"
            if c.diff:
                nums += f"  (차이 {c.diff:+,})"
        print(f" {MARK[c.status]} {c.name}{nums}")
        if c.detail and c.status != OK or c.detail.startswith("1~") or "나누어떨어짐" in c.detail:
            print(f"     └ {c.detail}")
    counts = {s: sum(1 for c in results if c.status == s) for s in (OK, WARN, ERROR, SKIP)}
    print(f"\n요약: 일치 {counts[OK]} · 확인필요 {counts[WARN]} · 오류 {counts[ERROR]} · 해당없음 {counts[SKIP]}")
    sys.exit(1 if counts[ERROR] else 0)


if __name__ == "__main__":
    main()
