"""신고서 내부 정합성 검사 — 본표 산식, 본표 ↔ 2쪽 명세, 본표 ↔ 부속서류.

판정
- OK    : 일치
- ERROR : 서식상 반드시 같아야 하는 값이 다름
- WARN  : 다를 수 있으나 확인이 필요함 (예: 건별 세액 합계 ≠ 합계×10%)
- SKIP  : 해당 서류·값이 없어 검사 불가
"""
from __future__ import annotations

from dataclasses import dataclass
from fractions import Fraction

from ..core.money import Rounding, round_won
from ..io.return_pdf import ReturnPdf

OK, ERROR, WARN, SKIP = "OK", "ERROR", "WARN", "SKIP"


@dataclass(frozen=True)
class CheckResult:
    group: str
    name: str
    status: str
    expected: int | None = None  # 산식으로 계산한 값
    actual: int | None = None  # 신고서에 적힌 값
    detail: str = ""

    @property
    def diff(self) -> int | None:
        if self.expected is None or self.actual is None:
            return None
        return self.actual - self.expected


def _eq(group, name, expected, actual, detail="", mismatch=ERROR) -> CheckResult:
    return CheckResult(group, name, OK if expected == actual else mismatch, expected, actual, detail)


def check_return(r: ReturnPdf) -> list[CheckResult]:
    out: list[CheckResult] = []
    out += _main_formulas(r)
    out += _main_vs_page2(r)
    out += _invoice_summary(r)
    out += _card_receipts(r)
    out += _zero_rate(r)
    return out


# ── 1. 본표 산식 ──────────────────────────────────────────────
def _main_formulas(r: ReturnPdf) -> list[CheckResult]:
    G = "1. 본표 산식"
    a, t = r.amount, r.tax
    res = [
        _eq(G, "(9) 과세표준 = (1)~(7) 금액 합", sum(a(i) for i in range(1, 8)), a(9), "(8) 대손세액가감은 세액만 있음"),
        _eq(G, "(9) 매출세액 ㉮ = (1)~(8) 세액 합", sum(t(i) for i in range(1, 9)), t(9)),
        _eq(G, "(16) 금액 = (10)+(12)+(13)+(14)+(15)", a(10) + a(12) + a(13) + a(14) + a(15), a(16), "(11)은 세액만"),
        _eq(G, "(16) 세액 = (10)-(11)+(12)+(13)+(14)+(15)", t(10) - t(11) + t(12) + t(13) + t(14) + t(15), t(16)),
        _eq(G, "(18) 금액 = (16)-(17)", a(16) - a(17), a(18)),
        _eq(G, "(18) 매입세액 ㉯ = (16)-(17)", t(16) - t(17), t(18)),
        _eq(G, "㉰ 납부(환급)세액 = ㉮-㉯", t(9) - t(18), t("다")),
        _eq(G, "(21) 경감·공제 ㉱ = (19)+(20)", t(19) + t(20), t(21)),
        _eq(
            G,
            "(30) 차가감 납부세액 = ㉰-㉱-㉲-㉳-㉴-㉵-㉶-㉷-㉸+㉹",
            t("다") - t(21) - sum(t(i) for i in range(22, 29)) + t(29),
            t(30),
        ),
    ]
    for n in (5, 6):
        res.append(_eq(G, f"({n}) 영세율 세액 = 0", 0, t(n)))
    for n, label in ((1, "세금계산서 발급분"), (2, "매입자발행"), (3, "신용카드·현금영수증"), (4, "기타")):
        res.append(_rate_check(G, f"({n}) {label}", a(n), t(n)))
    res.append(_rate_check(G, "(10) 세금계산서 일반매입", a(10), t(10)))
    res.append(_rate_check(G, "(12) 고정자산 매입", a(12), t(12)))
    return res


def _rate_check(group, label, amount, tax) -> CheckResult:
    """세액은 건별 세액의 합이므로 합계×10%와 몇 원 다를 수 있다 → 차이는 WARN."""
    expected = round_won(Fraction(amount) / 10, Rounding.TRUNCATE)
    detail = "세액은 건별 세액 합계라 합계×10%와 다를 수 있음 (건수만큼 단수 차이 가능)"
    return _eq(group, f"{label} 세액 ≈ 금액×10%", expected, tax, detail, mismatch=WARN)


# ── 2. 본표 ↔ 2쪽 명세 ────────────────────────────────────────
def _main_vs_page2(r: ReturnPdf) -> list[CheckResult]:
    G = "2. 본표 ↔ 2쪽 명세"
    if "본표2" not in r.found_forms:
        return [CheckResult(G, "2쪽(제2장) 없음", SKIP)]
    a, t = r.amount, r.tax
    return [
        _eq(G, "(40) 예정누락 매출 금액 = (36)~(39)", sum(a(i) for i in range(36, 40)), a(40)),
        _eq(G, "(40) 예정누락 매출 세액 = (36)~(39)", sum(t(i) for i in range(36, 40)), t(40)),
        _eq(G, "본표 (7) 금액 = (40)", a(40), a(7)),
        _eq(G, "본표 (7) 세액 = (40)", t(40), t(7)),
        _eq(G, "(43) 예정누락 매입 = (41)+(42) 금액", a(41) + a(42), a(43)),
        _eq(G, "(43) 예정누락 매입 = (41)+(42) 세액", t(41) + t(42), t(43)),
        _eq(G, "본표 (13) 금액 = (43)", a(43), a(13)),
        _eq(G, "본표 (13) 세액 = (43)", t(43), t(13)),
        _eq(G, "(52) 그 밖의 공제매입 금액 = (44)~(51)", sum(a(i) for i in range(44, 52)), a(52)),
        _eq(G, "(52) 그 밖의 공제매입 세액 = (44)~(51)", sum(t(i) for i in range(44, 52)), t(52)),
        _eq(G, "본표 (15) 금액 = (52)", a(52), a(15)),
        _eq(G, "본표 (15) 세액 = (52)", t(52), t(15)),
        _eq(G, "(56) 불공제 금액 = (53)~(55)", sum(a(i) for i in range(53, 56)), a(56)),
        _eq(G, "(56) 불공제 세액 = (53)~(55)", sum(t(i) for i in range(53, 56)), t(56)),
        _eq(G, "본표 (17) 금액 = (56)", a(56), a(17)),
        _eq(G, "본표 (17) 세액 = (56)", t(56), t(17)),
        _eq(G, "(63) 그 밖의 경감·공제 = (57)~(62)", sum(t(i) for i in range(57, 63)), t(63)),
        _eq(G, "본표 (19) = (63)", t(63), t(19)),
        _eq(G, "(84) 가산세 합계 = (64)~(83)", sum(t(i) for i in range(64, 84)), t(84)),
        _eq(G, "본표 (29) = (84)", t(84), t(29)),
    ]


# ── 3. 매입처별 세금계산서합계표 ────────────────────────────────
def _invoice_summary(r: ReturnPdf) -> list[CheckResult]:
    G = "3. 본표 ↔ 매입처별 세금계산서합계표"
    s = r.purchase_invoice_total
    a, t = r.amount, r.tax
    if s is None:
        status = SKIP if a(10) == a(12) == 0 else ERROR
        return [CheckResult(G, "매입처별 합계표 없음", status, a(10) + a(12), None, "본표 (10)(12)에 금액이 있으면 합계표가 있어야 함")]
    return [
        _eq(G, "공급가액 합계 = 본표 (10)+(12)", a(10) + a(12), s["공급가액"]),
        _eq(G, "세액 합계 = 본표 (10)+(12)", t(10) + t(12), s["세액"]),
        CheckResult(G, f"매입처 {s['매입처수']}곳, {s['매수']}매", OK, detail="참고"),
    ]


# ── 4. 신용카드매출전표등 수령명세서 ─────────────────────────────
def _card_receipts(r: ReturnPdf) -> list[CheckResult]:
    G = "4. 본표 ↔ 신용카드매출전표등 수령명세서"
    a, t = r.amount, r.tax
    total = r.card_summary.get("합계")
    if total is None:
        status = SKIP if a(44) == a(45) == 0 else ERROR
        return [CheckResult(G, "수령명세서 없음", status, a(44) + a(45), None)]
    parts = [r.card_summary.get(k) for k in ("현금영수증", "화물운전자복지카드", "사업용신용카드", "그밖의신용카드등")]
    parts = [p for p in parts if p]
    others = r.card_summary.get("그밖의신용카드등")
    res = [
        _eq(G, "⑤ 합계 공급가액 = 본표 (44)+(45)", a(44) + a(45), total.supply),
        _eq(G, "⑤ 합계 세액 = 본표 (44)+(45)", t(44) + t(45), total.tax),
        _eq(G, "⑤ 합계 건수 = ⑥~⑨", sum(p.count for p in parts), total.count),
        _eq(G, "⑤ 합계 공급가액 = ⑥~⑨", sum(p.supply for p in parts), total.supply),
        _eq(G, "⑤ 합계 세액 = ⑥~⑨", sum(p.tax for p in parts), total.tax),
    ]
    if others is not None:
        rows = r.card_rows
        seqs = [x.seq for x in rows]
        missing = sorted(set(range(1, max(seqs, default=0) + 1)) - set(seqs))
        res += [
            _eq(G, f"⑨ 건수 = 명세 {len(rows)}행 합", sum(x.count for x in rows), others.count),
            _eq(G, f"⑨ 공급가액 = 명세 {len(rows)}행 합", sum(x.supply for x in rows), others.supply),
            _eq(G, f"⑨ 세액 = 명세 {len(rows)}행 합", sum(x.tax for x in rows), others.tax),
            CheckResult(G, "명세 일련번호 연속(읽기 누락 없음)", ERROR if missing else OK,
                        detail=f"빠진 번호: {missing}" if missing else f"1~{len(rows)}"),
        ]
        bad = [x for x in rows if x.tax != round_won(Fraction(x.supply) / 10)]
        res.append(CheckResult(
            G, "명세 행별 세액 = 공급가액×10% (절사)", WARN if bad else OK,
            detail=("다른 행: " + ", ".join(f"{x.seq}번({x.count}건) 공급가액 {x.supply:,} 세액 {x.tax:,} / 10% {round_won(Fraction(x.supply) / 10):,}" for x in bad)
                    + " — 여러 건 합산 행은 건별 단수 차이 가능") if bad else "모든 행 일치",
        ))
    return res


# ── 5. 영세율 ─────────────────────────────────────────────────
def _zero_rate(r: ReturnPdf) -> list[CheckResult]:
    G = "5. 본표 ↔ 영세율 매출명세서·첨부서류"
    a = r.amount
    res: list[CheckResult] = []
    tot = r.zero_rate_totals
    if not tot:
        status = SKIP if a(5) == a(6) == 0 else ERROR
        res.append(CheckResult(G, "영세율 매출명세서 없음", status, a(5) + a(6), None))
    else:
        res += [
            _eq(G, "⑪ 부가가치세법 합계 = 항목 합", sum(v for _, v in r.zero_rate_items_vat_act), tot.get("⑪")),
            _eq(G, "⑫ 조특법 등 합계 = 항목 합", sum(v for _, v in r.zero_rate_items_special), tot.get("⑫")),
            _eq(G, "⑬ 총합계 = ⑪+⑫", (tot.get("⑪") or 0) + (tot.get("⑫") or 0), tot.get("⑬")),
            _eq(G, "⑬ 총합계 = 본표 (5)+(6)", a(5) + a(6), tot.get("⑬")),
        ]
    docs = r.zero_rate_docs
    if not docs:
        res.append(CheckResult(G, "영세율 첨부서류 제출명세서 없음", SKIP if a(6) == 0 else WARN,
                               detail="영세율 유형에 따라 첨부서류 명세가 없을 수 있음"))
        return res
    seqs = [d.seq for d in docs]
    missing = sorted(set(range(1, max(seqs) + 1)) - set(seqs))
    dup = len(seqs) - len(set(seqs))
    res.append(CheckResult(G, "첨부서류 일련번호 연속(읽기 누락 없음)", ERROR if (missing or dup) else OK,
                           detail=f"빠진 번호 {missing}, 중복 {dup}" if (missing or dup) else f"1~{len(docs)}"))
    report_sum = sum(d.krw_report for d in docs)
    res.append(_eq(G, f"첨부서류 당기신고해당분 원화 합({len(docs)}행) = 본표 (6)", a(6), report_sum,
                   "영세율 기타 전부가 첨부서류 대상일 때만 같아야 함", mismatch=WARN))
    res.append(_eq(G, "첨부서류 당기제출 원화 합 = 당기신고해당분 원화 합", report_sum, sum(d.krw_submit for d in docs),
                   mismatch=WARN))
    res += _fx_rounding(G, docs)
    return res


def _fx_rounding(G, docs) -> list[CheckResult]:
    """원화 = 외화 × 환율 의 단수처리 방식 확인."""
    trunc = half = exact = 0
    bad = []
    for d in docs:
        raw = d.fx_report * d.rate
        if raw.denominator == 1 and int(raw) == d.krw_report:
            exact += 1
        elif d.krw_report == round_won(raw, Rounding.TRUNCATE):
            trunc += 1
            if d.krw_report == round_won(raw, Rounding.HALF_UP):
                half += 1
        elif d.krw_report == round_won(raw, Rounding.HALF_UP):
            half += 1
            bad.append((d, raw, "반올림"))
        else:
            bad.append((d, raw, "불일치"))
    mismatch = [b for b in bad if b[2] == "불일치"]
    half_only = [b for b in bad if b[2] == "반올림"]
    detail = f"정확히 나누어떨어짐 {exact}행, 절사로 설명됨 {trunc}행"
    if half_only:
        detail += f", 반올림이어야만 맞는 행 {len(half_only)}개: " + ", ".join(str(b[0].seq) for b in half_only[:10])
    if mismatch:
        detail += "; 불일치: " + ", ".join(f"{b[0].seq}번 {float(b[1]):,.3f}→{b[0].krw_report:,}" for b in mismatch[:10])
    status = ERROR if mismatch else (WARN if half_only else OK)
    return [CheckResult(G, "첨부서류 원화 = 외화×환율 (원 미만 절사)", status, detail=detail)]
