"""일반과세자 부가가치세 신고서 PDF(본표 + 부속서류) 읽기.

글자 좌표를 이용해 칸 번호별 금액·세액을 뽑는다. 텍스트 흐름만으로는
금액 칸과 세액 칸이 구분되지 않는 경우가 있기 때문이다.

지원 서식 (2026. 3. 20. 개정 서식 기준 샘플로 확인):
- 본표 1쪽 (1)~(30), ㉰ / 2쪽 (36)~(84)
- 매입처별 세금계산서합계표(갑) 총합계
- 신용카드매출전표등 수령명세서(갑)(을)
- 영세율 매출명세서
- 영세율 첨부서류 제출명세서 (이어지는 쪽 포함)
"""
from __future__ import annotations

import re
from dataclasses import dataclass, field
from fractions import Fraction
from pathlib import Path

import pdfplumber

from ..core.money import to_fraction

_LABEL = re.compile(r"^\((\d{1,2})\)$")
_INT = re.compile(r"^-?\d{1,3}(,\d{3})*$|^-?\d+$")
_ROW_TOL = 3.0  # 같은 줄로 볼 세로 오차(pt)
_TAX_COL_MIN_X1 = 450.0  # 이보다 오른쪽에서 끝나는 숫자는 세액 칸


def to_int(text: str) -> int:
    v = to_fraction(text)
    if v.denominator != 1:
        raise ValueError(f"정수 금액이 아닙니다: {text!r}")
    return int(v)


def _compact(s: str) -> str:
    return re.sub(r"\s", "", s)


@dataclass
class LineValue:
    amount: int | None = None
    tax: int | None = None


@dataclass
class Triple:
    count: int
    supply: int
    tax: int


@dataclass
class CardRow:
    seq: int
    count: int
    supply: int
    tax: int
    page: int


@dataclass
class ZeroRateDocRow:
    seq: int
    doc: str
    currency: str
    rate: Fraction
    fx_submit: Fraction
    krw_submit: int
    fx_report: Fraction
    krw_report: int
    page: int


@dataclass
class ReturnPdf:
    lines: dict[str, LineValue] = field(default_factory=dict)  # "1"~"84", "다"(㉰)
    purchase_invoice_total: dict[str, int] | None = None  # 매입처수, 매수, 공급가액, 세액
    card_summary: dict[str, Triple] = field(default_factory=dict)
    card_rows: list[CardRow] = field(default_factory=list)
    zero_rate_items_vat_act: list[tuple[str, int]] = field(default_factory=list)
    zero_rate_items_special: list[tuple[str, int]] = field(default_factory=list)
    zero_rate_totals: dict[str, int] = field(default_factory=dict)  # ⑪ ⑫ ⑬
    zero_rate_docs: list[ZeroRateDocRow] = field(default_factory=list)
    found_forms: dict[str, list[int]] = field(default_factory=dict)  # 서식명 → 쪽번호

    def amount(self, key: str | int) -> int:
        return self.lines.get(str(key), LineValue()).amount or 0

    def tax(self, key: str | int) -> int:
        return self.lines.get(str(key), LineValue()).tax or 0


FORM_MARKERS = {  # 서식명 → 쪽 판별 문구(공백 제거 기준, 하나라도 있으면 해당)
    "본표1": ("일반과세자부가가치세",),
    "본표2": ("(제2장앞쪽)",),
    "매입처별세금계산서합계표": ("매입처별세금계산서합계표",),
    "매출처별세금계산서합계표": ("매출처별세금계산서합계표",),
    "신용카드수령명세서": ("신용카드매출전표등수령명세서(갑)", "신용카드매출전표등수령명세서(을)"),
    "영세율매출명세서": ("영세율매출명세서",),
    "영세율첨부서류제출명세서": ("영세율첨부서류제출명세서",),
}


def parse_return_pdf(path: str | Path) -> ReturnPdf:
    r = ReturnPdf()
    with pdfplumber.open(path) as pdf:
        for pno, page in enumerate(pdf.pages, 1):
            text = page.extract_text() or ""
            compact = _compact(text)
            forms = [name for name, marks in FORM_MARKERS.items() if any(m in compact for m in marks)]
            for name in forms:
                r.found_forms.setdefault(name, []).append(pno)
            words = page.extract_words()
            if "본표1" in forms:
                _parse_main_lines(words, r, accept=range(1, 31))
                _parse_circled_da(words, r)
            if "본표2" in forms:
                _parse_main_lines(words, r, accept=range(36, 85))
            if "매입처별세금계산서합계표" in forms and r.purchase_invoice_total is None:
                r.purchase_invoice_total = _parse_invoice_summary(words)
            if "신용카드수령명세서" in forms:
                _parse_card_page(text, pno, r)
            if "영세율매출명세서" in forms:
                _parse_zero_rate_summary(text, r)
            if "영세율첨부서류제출명세서" in r.found_forms:  # 첫 쪽 이후 이어지는 쪽 포함
                _parse_zero_rate_docs(text, pno, r)
    return r


def _rows(words):
    """단어를 세로 위치 기준으로 줄 단위로 묶는다."""
    rows: list[list[dict]] = []
    for w in sorted(words, key=lambda w: (w["top"], w["x0"])):
        if rows and abs(w["top"] - rows[-1][0]["top"]) <= _ROW_TOL:
            rows[-1].append(w)
        else:
            rows.append([w])
    return [sorted(row, key=lambda w: w["x0"]) for row in rows]


def _parse_main_lines(words, r: ReturnPdf, accept: range) -> None:
    for row in _rows(words):
        for i, w in enumerate(row):
            m = _LABEL.match(w["text"])
            if not m or int(m.group(1)) not in accept:
                continue
            nums = [x for x in row[i + 1:] if _INT.match(x["text"])]
            lv = LineValue()
            for x in nums:
                if x["x1"] >= _TAX_COL_MIN_X1:
                    lv.tax = to_int(x["text"])
                elif lv.amount is None:
                    lv.amount = to_int(x["text"])
            r.lines[m.group(1)] = lv
            break


def _parse_circled_da(words, r: ReturnPdf) -> None:
    for row in _rows(words):
        texts = [w["text"] for w in row]
        if "㉰" in texts:
            i = texts.index("㉰")
            nums = [x for x in row[i + 1:] if _INT.match(x["text"])]
            if nums:
                r.lines["다"] = LineValue(tax=to_int(nums[-1]["text"]))
            return


def _parse_invoice_summary(words) -> dict[str, int] | None:
    """총합계 줄: 매입처수, 매수, 공급가액(조~일 칸), 세액(조~일 칸)."""
    tax_head = next((w for w in words if w["text"].startswith("⑩세")), None)
    if tax_head is None:
        return None
    for row in _rows(words):
        texts = [w["text"] for w in row]
        if "합" in texts and "계" in texts:
            nums = [w for w in row if re.fullmatch(r"\d+", w["text"])]
            if len(nums) < 3:
                continue
            counts, money = nums[:2], nums[2:]
            supply = [w["text"] for w in money if w["x1"] < tax_head["x0"] - 5]
            tax = [w["text"] for w in money if w["x1"] >= tax_head["x0"] - 5]
            return {
                "매입처수": int(counts[0]["text"]),
                "매수": int(counts[1]["text"]),
                "공급가액": _join_groups(supply),
                "세액": _join_groups(tax),
            }
    return None


def _join_groups(groups: list[str]) -> int:
    """조·십억·백만·천·일 칸으로 나뉜 숫자를 합친다 (앞 칸 외에는 3자리)."""
    if not groups:
        return 0
    return int(groups[0] + "".join(g.zfill(3) for g in groups[1:]))


_CARD_SUMMARY = re.compile(r"^([⑤⑥⑦⑧⑨])\s*(.+?)\s+(\d+)\s+(-?[\d,]+)\s+(-?[\d,]+)$")
_CARD_ROW = re.compile(r"^(\d+)\s+\S+\s+\S+\s+(\d+)\s+(-?[\d,]+)\s+(-?[\d,]+)$")
_CARD_KEYS = {"⑤": "합계", "⑥": "현금영수증", "⑦": "화물운전자복지카드", "⑧": "사업용신용카드", "⑨": "그밖의신용카드등"}


def _parse_card_page(text: str, pno: int, r: ReturnPdf) -> None:
    for line in text.splitlines():
        line = line.strip()
        m = _CARD_SUMMARY.match(line)
        if m:
            r.card_summary[_CARD_KEYS[m.group(1)]] = Triple(int(m.group(3)), to_int(m.group(4)), to_int(m.group(5)))
            continue
        m = _CARD_ROW.match(line)
        if m:
            r.card_rows.append(CardRow(int(m.group(1)), int(m.group(2)), to_int(m.group(3)), to_int(m.group(4)), pno))


_TRAILING_AMOUNT = re.compile(r"(?:^|\s)(-?\d{1,3}(?:,\d{3})*|0)$")


def _parse_zero_rate_summary(text: str, r: ReturnPdf) -> None:
    lines = [l.strip() for l in text.splitlines()]
    try:
        start = next(i for i, l in enumerate(lines) if "영세율 적용 공급실적 합계" in l or "영세율적용공급실적합계" in _compact(l))
    except StopIteration:
        return
    bucket = r.zero_rate_items_vat_act
    for l in lines[start + 1:]:
        m = _TRAILING_AMOUNT.search(l)
        if l.startswith("⑪"):
            if m:
                r.zero_rate_totals["⑪"] = to_int(m.group(1))
            bucket = r.zero_rate_items_special
            continue
        if l.startswith("⑫"):
            if m:
                r.zero_rate_totals["⑫"] = to_int(m.group(1))
            continue
        if l.startswith("⑬"):
            if m:
                r.zero_rate_totals["⑬"] = to_int(m.group(1))
            break
        if m:
            bucket.append((l[: m.start()].strip() or "(앞줄 항목)", to_int(m.group(1))))


_DOC_ROW = re.compile(
    r"^(\d+)\s+(\S+)\s+.*?\b([A-Z]{3})\s+"
    r"(-?[\d,]+\.\d+)\s+(-?[\d,]+\.\d+)\s+(-?[\d,]+)\s+(-?[\d,]+\.\d+)\s+(-?[\d,]+)$"
)


def _parse_zero_rate_docs(text: str, pno: int, r: ReturnPdf) -> None:
    for line in text.splitlines():
        m = _DOC_ROW.match(line.strip())
        if m:
            r.zero_rate_docs.append(
                ZeroRateDocRow(
                    seq=int(m.group(1)),
                    doc=m.group(2),
                    currency=m.group(3),
                    rate=to_fraction(m.group(4)),
                    fx_submit=to_fraction(m.group(5)),
                    krw_submit=to_int(m.group(6)),
                    fx_report=to_fraction(m.group(7)),
                    krw_report=to_int(m.group(8)),
                    page=pno,
                )
            )
