/*
 * 신고서 내부 정합성 검사 — 본표 산식, 본표 ↔ 2쪽 명세, 본표 ↔ 부속서류.
 *   OK    일치
 *   ERROR 서식상 반드시 같아야 하는 값이 다름
 *   WARN  다를 수 있으나 확인 필요 (예: 건별 세액 합계 ≠ 합계×10%)
 *   SKIP  해당 서류·값이 없어 검사 불가
 */
(function (VAT) {
  "use strict";
  const { Frac, Rounding, roundWon, fmt } = VAT.money;
  const S = Object.freeze({ OK: "OK", ERROR: "ERROR", WARN: "WARN", SKIP: "SKIP" });

  const result = (group, name, status, expected = null, actual = null, detail = "") => ({
    group, name, status, expected, actual, detail, showDetail: detail === "참고",
    diff: expected === null || actual === null || actual === undefined ? null : actual - expected,
  });
  const eq = (group, name, expected, actual, detail = "", mismatch = S.ERROR) =>
    result(group, name, expected === actual ? S.OK : mismatch, expected, actual ?? null, detail);
  const sum = (arr) => arr.reduce((a, b) => a + b, 0);
  const range = (lo, hi) => Array.from({ length: hi - lo + 1 }, (_, i) => lo + i);
  const tenPct = (v) => roundWon(new Frac(BigInt(v), 10n), Rounding.TRUNCATE);

  function checkReturn(r) {
    return [...mainFormulas(r), ...mainVsPage2(r), ...invoiceSummary(r), ...cardReceipts(r), ...zeroRate(r)];
  }

  // 1. 본표 산식
  function mainFormulas(r) {
    const G = "1. 본표 산식";
    const a = (k) => r.amount(k), t = (k) => r.tax(k);
    const res = [
      eq(G, "(9) 과세표준 = (1)~(7) 금액 합", sum(range(1, 7).map(a)), a(9), "(8) 대손세액가감은 세액만 있음"),
      eq(G, "(9) 매출세액 ㉮ = (1)~(8) 세액 합", sum(range(1, 8).map(t)), t(9)),
      eq(G, "(16) 금액 = (10)+(12)+(13)+(14)+(15)", a(10) + a(12) + a(13) + a(14) + a(15), a(16), "(11)은 세액만"),
      eq(G, "(16) 세액 = (10)-(11)+(12)+(13)+(14)+(15)", t(10) - t(11) + t(12) + t(13) + t(14) + t(15), t(16)),
      eq(G, "(18) 금액 = (16)-(17)", a(16) - a(17), a(18)),
      eq(G, "(18) 매입세액 ㉯ = (16)-(17)", t(16) - t(17), t(18)),
      eq(G, "㉰ 납부(환급)세액 = ㉮-㉯", t(9) - t(18), t("다")),
      eq(G, "(21) 경감·공제 ㉱ = (19)+(20)", t(19) + t(20), t(21)),
      eq(G, "(30) 차가감 납부세액 = ㉰-㉱-㉲-㉳-㉴-㉵-㉶-㉷-㉸+㉹", t("다") - t(21) - sum(range(22, 28).map(t)) + t(29), t(30)),
      eq(G, "(5) 영세율 세액 = 0", 0, t(5)),
      eq(G, "(6) 영세율 세액 = 0", 0, t(6)),
    ];
    for (const [n, label] of [[1, "세금계산서 발급분"], [2, "매입자발행"], [3, "신용카드·현금영수증"], [4, "기타"], [10, "세금계산서 일반매입"], [12, "고정자산 매입"]]) {
      res.push(eq(G, `(${n}) ${label} 세액 ≈ 금액×10%`, tenPct(a(n)), t(n),
        "세액은 건별 세액 합계라 합계×10%와 다를 수 있음 (건수만큼 단수 차이 가능)", S.WARN));
    }
    return res;
  }

  // 2. 본표 ↔ 2쪽 명세
  function mainVsPage2(r) {
    const G = "2. 본표 ↔ 2쪽 명세";
    if (!r.foundForms["본표2"]) return [result(G, "2쪽(제2장) 없음", S.SKIP)];
    const a = (k) => r.amount(k), t = (k) => r.tax(k);
    return [
      eq(G, "(40) 예정누락 매출 금액 = (36)~(39)", sum(range(36, 39).map(a)), a(40)),
      eq(G, "(40) 예정누락 매출 세액 = (36)~(39)", sum(range(36, 39).map(t)), t(40)),
      eq(G, "본표 (7) 금액 = (40)", a(40), a(7)),
      eq(G, "본표 (7) 세액 = (40)", t(40), t(7)),
      eq(G, "(43) 예정누락 매입 금액 = (41)+(42)", a(41) + a(42), a(43)),
      eq(G, "(43) 예정누락 매입 세액 = (41)+(42)", t(41) + t(42), t(43)),
      eq(G, "본표 (13) 금액 = (43)", a(43), a(13)),
      eq(G, "본표 (13) 세액 = (43)", t(43), t(13)),
      eq(G, "(52) 그 밖의 공제매입 금액 = (44)~(51)", sum(range(44, 51).map(a)), a(52)),
      eq(G, "(52) 그 밖의 공제매입 세액 = (44)~(51)", sum(range(44, 51).map(t)), t(52)),
      eq(G, "본표 (15) 금액 = (52)", a(52), a(15)),
      eq(G, "본표 (15) 세액 = (52)", t(52), t(15)),
      eq(G, "(56) 불공제 금액 = (53)~(55)", sum(range(53, 55).map(a)), a(56)),
      eq(G, "(56) 불공제 세액 = (53)~(55)", sum(range(53, 55).map(t)), t(56)),
      eq(G, "본표 (17) 금액 = (56)", a(56), a(17)),
      eq(G, "본표 (17) 세액 = (56)", t(56), t(17)),
      eq(G, "(63) 그 밖의 경감·공제 = (57)~(62)", sum(range(57, 62).map(t)), t(63)),
      eq(G, "본표 (19) = (63)", t(63), t(19)),
      eq(G, "(84) 가산세 합계 = (64)~(83)", sum(range(64, 83).map(t)), t(84)),
      eq(G, "본표 (29) = (84)", t(84), t(29)),
    ];
  }

  // 3. 세금계산서·계산서 합계표
  function invoiceSummary(r) {
    const G = "3. 본표 ↔ 세금계산서·계산서 합계표";
    const a = (k) => r.amount(k), t = (k) => r.tax(k);
    const res = [];
    const s = r.purchaseInvoiceTotal;
    if (!s) {
      const empty = a(10) === 0 && a(12) === 0;
      res.push(result(G, "매입처별 합계표 없음", empty ? S.SKIP : S.ERROR, a(10) + a(12), null,
        "본표 (10)(12)에 금액이 있으면 합계표가 있어야 함"));
    } else {
      res.push(
        eq(G, "매입 공급가액 합계 = 본표 (10)+(12)", a(10) + a(12), s.공급가액),
        eq(G, "매입 세액 합계 = 본표 (10)+(12)", t(10) + t(12), s.세액),
        result(G, `매입처 ${s.매입처수}곳, ${s.매수}매`, S.OK, null, null, "참고"),
      );
    }
    const sales = r.salesInvoiceTotal;
    if (sales) {
      res.push(
        eq(G, "매출 공급가액 합계 = 본표 (1)+(5)", a(1) + a(5), sales.공급가액),
        eq(G, "매출 세액 합계 = 본표 (1)", t(1), sales.세액),
        result(G, `매출처 ${sales.매출처수}곳, ${sales.매수}매`, S.OK, null, null, "참고"),
      );
    } else if (a(1) + a(5) !== 0) {
      res.push(result(G, "매출처별 합계표 없음", S.WARN, a(1) + a(5), null, "본표 (1)(5)에 금액이 있음 — PDF에 합계표가 빠졌는지 확인"));
    }
    const bill = r.purchaseBillTotal;
    const billAmt = a(90) || t(90);
    if (bill) {
      res.push(
        eq(G, "계산서 매입금액 합계 = 본표 2쪽 (90)", billAmt, bill.매입금액),
        result(G, `계산서 매입처 ${bill.매입처수}곳, ${bill.매수}매`, S.OK, null, null, "참고"),
      );
    } else if (billAmt) {
      res.push(result(G, "매입처별 계산서합계표 없음", S.WARN, billAmt, null, "(90) 계산서 수취금액이 있음 — PDF에 합계표가 빠졌는지 확인"));
    }
    return res;
  }

  // 4. 신용카드매출전표등 수령명세서
  function cardReceipts(r) {
    const G = "4. 본표 ↔ 신용카드매출전표등 수령명세서";
    const a = (k) => r.amount(k), t = (k) => r.tax(k);
    const total = r.cardSummary["합계"];
    if (!total) {
      const empty = a(44) === 0 && a(45) === 0;
      return [result(G, "수령명세서 없음", empty ? S.SKIP : S.ERROR, a(44) + a(45), null)];
    }
    const parts = ["현금영수증", "화물운전자복지카드", "사업용신용카드", "그밖의신용카드등"].map((k) => r.cardSummary[k]).filter(Boolean);
    const res = [
      eq(G, "⑤ 합계 공급가액 = 본표 (44)+(45)", a(44) + a(45), total.supply),
      eq(G, "⑤ 합계 세액 = 본표 (44)+(45)", t(44) + t(45), total.tax),
      eq(G, "⑤ 합계 건수 = ⑥~⑨", sum(parts.map((p) => p.count)), total.count),
      eq(G, "⑤ 합계 공급가액 = ⑥~⑨", sum(parts.map((p) => p.supply)), total.supply),
      eq(G, "⑤ 합계 세액 = ⑥~⑨", sum(parts.map((p) => p.tax)), total.tax),
    ];
    const others = r.cardSummary["그밖의신용카드등"];
    if (others && (others.count || r.cardRows.length)) {
      const rows = r.cardRows;
      const missing = missingSeqs(rows.map((x) => x.seq));
      res.push(
        eq(G, `⑨ 건수 = 명세 ${rows.length}행 합`, sum(rows.map((x) => x.count)), others.count),
        eq(G, `⑨ 공급가액 = 명세 ${rows.length}행 합`, sum(rows.map((x) => x.supply)), others.supply),
        eq(G, `⑨ 세액 = 명세 ${rows.length}행 합`, sum(rows.map((x) => x.tax)), others.tax),
        result(G, "명세 일련번호 연속(읽기 누락 없음)", missing.length ? S.ERROR : S.OK, null, null,
          missing.length ? `빠진 번호: ${missing.join(", ")}` : `1~${rows.length}`),
      );
      const bad = rows.filter((x) => x.tax !== tenPct(x.supply));
      res.push(result(G, "명세 행별 세액 = 공급가액×10% (절사)", bad.length ? S.WARN : S.OK, null, null,
        bad.length
          ? bad.map((x) => `${x.seq}번: 공급가액 ${fmt(x.supply)} + 세액 ${fmt(x.tax)} = ${fmt(x.supply + x.tax)} (10%면 ${fmt(tenPct(x.supply))})`).join(" / ") +
              " — 합계가 딱 떨어지면 가맹점이 부가세 포함 금액을 나눈 것으로 정상"
          : "모든 행 일치"));
    }
    return res;
  }

  // 5. 영세율
  function zeroRate(r) {
    const G = "5. 본표 ↔ 영세율 매출명세서·첨부서류";
    const a = (k) => r.amount(k);
    const res = [];
    const tot = r.zeroRateTotals;
    if (!Object.keys(tot).length) {
      const empty = a(5) === 0 && a(6) === 0;
      res.push(result(G, "영세율 매출명세서 없음", empty ? S.SKIP : S.ERROR, a(5) + a(6), null));
    } else {
      res.push(
        eq(G, "⑪ 부가가치세법 합계 = 항목 합", sum(r.zeroRateItemsVatAct.map((x) => x[1])), tot["⑪"]),
        eq(G, "⑫ 조특법 등 합계 = 항목 합", sum(r.zeroRateItemsSpecial.map((x) => x[1])), tot["⑫"]),
        eq(G, "⑬ 총합계 = ⑪+⑫", (tot["⑪"] ?? 0) + (tot["⑫"] ?? 0), tot["⑬"]),
        eq(G, "⑬ 총합계 = 본표 (5)+(6)", a(5) + a(6), tot["⑬"]),
      );
    }
    const docs = r.zeroRateDocs;
    if (!docs.length) {
      res.push(result(G, "영세율 첨부서류 제출명세서 없음", a(6) === 0 ? S.SKIP : S.WARN, null, null,
        "영세율 유형에 따라 첨부서류 명세가 없을 수 있음"));
      return res;
    }
    const seqs = docs.map((d) => d.seq);
    const missing = missingSeqs(seqs);
    const dup = seqs.length - new Set(seqs).size;
    res.push(result(G, "첨부서류 일련번호 연속(읽기 누락 없음)", missing.length || dup ? S.ERROR : S.OK, null, null,
      missing.length || dup ? `빠진 번호 ${missing.join(", ") || "없음"}, 중복 ${dup}` : `1~${docs.length}`));
    const reportSum = sum(docs.map((d) => d.krwReport));
    res.push(eq(G, `첨부서류 당기신고해당분 원화 합(${docs.length}행) = 본표 (6)`, a(6), reportSum,
      "영세율 기타 전부가 첨부서류 대상일 때만 같아야 함", S.WARN));
    res.push(eq(G, "첨부서류 당기제출 원화 합 = 당기신고해당분 원화 합", reportSum, sum(docs.map((d) => d.krwSubmit)), "", S.WARN));
    res.push(fxRounding(G, docs));
    return res;
  }

  /** 원화 = 외화 × 환율 의 단수처리 방식 확인 */
  function fxRounding(G, docs) {
    let exact = 0, trunc = 0;
    const halfOnly = [], mismatch = [];
    for (const d of docs) {
      const raw = d.fxReport.mul(d.rate);
      if (raw.isInt && Number(raw.n) === d.krwReport) exact++;
      else if (d.krwReport === roundWon(raw, Rounding.TRUNCATE)) trunc++;
      else if (d.krwReport === roundWon(raw, Rounding.HALF_UP)) halfOnly.push(d);
      else mismatch.push({ d, raw });
    }
    let detail = `정확히 나누어떨어짐 ${exact}행, 절사로 설명됨 ${trunc}행`;
    if (halfOnly.length) detail += `, 반올림이어야만 맞는 행 ${halfOnly.length}개: ${halfOnly.slice(0, 10).map((d) => d.seq).join(", ")}`;
    if (mismatch.length) detail += `; 불일치: ${mismatch.slice(0, 10).map(({ d, raw }) => `${d.seq}번 ${raw.toNumber().toFixed(3)}→${fmt(d.krwReport)}`).join(", ")}`;
    const status = mismatch.length ? S.ERROR : halfOnly.length ? S.WARN : S.OK;
    return result(G, "첨부서류 원화 = 외화×환율 (원 미만 절사)", status, null, null, detail);
  }

  function missingSeqs(seqs) {
    const have = new Set(seqs);
    const max = seqs.length ? Math.max(...seqs) : 0;
    return range(1, max).filter((n) => !have.has(n));
  }

  VAT.checks = { checkReturn, Status: S };
})((globalThis.VAT = globalThis.VAT || {}));
