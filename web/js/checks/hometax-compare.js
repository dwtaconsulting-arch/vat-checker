/*
 * 홈택스 신고자료 통합조회 ↔ 신고서 대사.
 * 홈택스 자료는 "국세청에 모인 전자자료"라서 신고서와 달라도 정상인 경우가 많다
 * (종이 세금계산서, 지연전송, 불공제 판단, 세금계산서와 겹친 카드매출 등).
 * 그래서 금액 차이는 모두 WARN(확인필요)으로 두고 차이의 방향에 맞는 확인 포인트를 적는다.
 * 사업자등록번호·과세기간이 다르면 다른 자료를 넣은 것이므로 ERROR.
 */
(function (VAT) {
  "use strict";
  const S = VAT.checks.Status;
  const { fmt } = VAT.money;
  const G = "6. 홈택스 통합조회 ↔ 신고서";

  const result = (name, status, expected = null, actual = null, detail = "", showDetail = false) => ({
    group: G, name, status, expected, actual, detail, showDetail,
    diff: expected === null || actual === null ? null : actual - expected,
  });
  /** 홈택스 값(expected)과 신고서 값(actual) 비교. 다르면 WARN + 방향별 설명 */
  const cmp = (name, ht, ret, { more = "", less = "", note = "" } = {}) => {
    if (ht === ret) return result(name, S.OK, ht, ret, note, !!note);
    const why = ret > ht ? more : less;
    return result(name, S.WARN, ht, ret, [why, note].filter(Boolean).join(" "));
  };

  /** 신고 − 홈택스 차이가 합계표의 "전자세금계산서 외 발급분"과 정확히 같으면 설명된 차이로 본다 */
  const cmpInvoice = (name, ht, ret, nonE, field, help) => {
    const extra = nonE ? nonE[field] : 0;
    if (ht !== ret && extra && ret - ht === extra) {
      return result(name, S.OK, ht, ret,
        `차이 ${fmt(extra)}원 = 합계표의 "전자세금계산서 외 발급분"(종이·전송기한 후 전송 등, ${nonE.매수}매)과 정확히 같음`, true);
    }
    return cmp(name, ht, ret, help);
  };

  function compareHometax(r, h) {
    const res = [];
    const a = (k) => r.amount(k), t = (k) => r.tax(k);
    const salesNonE = r.salesInvoiceTotal?.전자외, purchNonE = r.purchaseInvoiceTotal?.전자외;

    // 기본 사항 — 다른 자료를 넣은 경우를 먼저 걸러낸다
    if (h.bizNo && r.bizNo) {
      res.push(result("사업자등록번호", h.bizNo === r.bizNo ? S.OK : S.ERROR, null, null,
        h.bizNo === r.bizNo ? h.bizNo : `홈택스 ${h.bizNo} / 신고서 ${r.bizNo} — 다른 사업자 자료입니다`, true));
    } else {
      res.push(result("사업자등록번호", S.SKIP, null, null, "한쪽에서 번호를 읽지 못함 (마스킹된 자료일 수 있음)", true));
    }
    const p = r.period;
    let samePeriod = false;
    if (p && h.year) {
      const sameHalf = p.year === h.year && p.half === h.half;
      samePeriod = sameHalf && p.start === h.start && p.end === h.end;
      res.push(result("과세기간", !sameHalf ? S.ERROR : samePeriod ? S.OK : S.WARN, null, null,
        `홈택스 ${h.year}년 ${h.half}기 ${h.start ?? "?"}~${h.end ?? "?"} / 신고서 ${p.year}년 ${p.half}기 ${p.start}~${p.end}` +
          (!sameHalf ? " — 다른 기간 자료입니다" : samePeriod ? "" :
            " — 조회 기간이 다릅니다. 통합조회 신고구분(예정/확정/예정+확정)을 신고서와 같게 다시 조회하세요"), true));
    }
    if (h.industryCode) {
      const codes = r.industryCodes;
      res.push(result("주업종코드", codes.includes(h.industryCode) ? S.OK : S.WARN, null, null,
        `홈택스 ${h.industryCode} / 신고서 과세표준명세 ${codes.join(", ") || "(없음)"}` +
          (codes.includes(h.industryCode) ? "" : " — 신고서 업종코드가 등록 업종과 다릅니다"), true));
    }
    const periodNote = samePeriod ? "" : "(기간이 달라 차이가 날 수 있음)";

    // 매출
    const es = h.get("sales", "전자세금계산서");
    res.push(cmpInvoice("전자세금계산서 매출 공급가액 = 신고서 (1)+(5)", es.amount, a(1) + a(5), salesNonE, "공급가액", {
      more: "신고가 더 많음 — 종이 세금계산서·전송기한 후 전송분이 있는지 확인.",
      less: "신고가 더 적음 — 매출 세금계산서 누락 여부 확인 (예정신고분이면 (7) 확인).",
      note: periodNote,
    }));
    res.push(cmpInvoice("전자세금계산서 매출 세액 = 신고서 (1)", es.tax, t(1), salesNonE, "세액", {
      more: "신고가 더 많음 — 종이·지연전송분 확인.", less: "신고가 더 적음 — 매출 누락 확인.", note: periodNote,
    }));
    const card = h.get("sales", "신용카드"), cash = h.get("sales", "현금영수증"), pg = h.get("sales", "판매결제대행");
    const cardTotal = card.amount + card.tax + cash.amount + cash.tax + pg.amount + pg.tax;
    res.push(cmp("신용카드·현금영수증·판매대행 매출(공급대가) = 신고서 (3) 금액+세액", cardTotal, a(3) + t(3), {
      more: "신고가 더 많음 — 카드 외 매출(간편결제 등)을 (3)에 넣었는지 확인.",
      less: "신고가 더 적음 — 세금계산서를 함께 발급한 카드매출은 (1)로 신고하므로 정상일 수 있음. 아니면 카드매출 누락 확인.",
      note: "홈택스 카드매출은 부가세 포함 금액이라 (3) 금액+세액과 비교. " + periodNote,
    }));
    const ebs = h.get("sales", "전자계산서");
    res.push(cmp("전자계산서 매출 = 신고서 (89) 계산서 발급금액", ebs.amount, a(89) || t(89), { note: periodNote }));

    // 매입
    const ep = h.get("purchases", "전자세금계산서");
    res.push(cmpInvoice("전자세금계산서 매입 공급가액 = 신고서 (10)+(12)", ep.amount, a(10) + a(12), purchNonE, "공급가액", {
      more: "신고가 더 많음 — 종이 세금계산서·지연수취분 확인 (지연수취 가산세 (66) 대상인지).",
      less: "신고가 더 적음 — 공제 누락 여부 확인. 불공제분은 (10)(12)에 넣고 (17)로 빼는 것이 원칙.",
      note: periodNote,
    }));
    res.push(cmpInvoice("전자세금계산서 매입 세액 = 신고서 (10)+(12)", ep.tax, t(10) + t(12), purchNonE, "세액", {
      more: "신고가 더 많음 — 종이·지연수취분 확인.", less: "신고가 더 적음 — 공제 누락 확인.", note: periodNote,
    }));
    const cardHelp = {
      more: "신고가 홈택스보다 많음 — 홈택스는 공제대상으로 분류한 금액만 줍니다. 홈택스에서 불공제로 분류된 건을 공제로 바꿨는지, 그 판단이 맞는지 확인하세요 (접대비·업무무관·면세사업 관련 등은 불공제).",
      less: "신고가 홈택스보다 적음 — 공제 누락이 아닌지, 일부러 뺀 것이면 그 사유를 확인하세요.",
      note: periodNote,
    };
    const cs = r.cardSummary;
    const pairs = [
      ["사업용신용카드", "사업용 신용카드"],
      ["현금영수증", "현금영수증"],
      ["화물운전자복지카드", "화물운전자복지카드"],
    ];
    for (const [key, label] of pairs) {
      const hv = h.get("purchases", key), rv = cs[key] ?? { supply: 0, tax: 0 };
      res.push(cmp(`${label} 매입 공급가액 = 수령명세서 ${label}`, hv.amount, rv.supply, cardHelp));
      res.push(cmp(`${label} 매입 세액 = 수령명세서 ${label}`, hv.tax, rv.tax, cardHelp));
    }
    const ebp = h.get("purchases", "전자계산서");
    res.push(cmp("전자계산서 매입 = 신고서 (90) 계산서 수취금액", ebp.amount, a(90) || t(90), {
      more: "신고가 더 많음 — 종이 계산서 수취분 확인.", less: "신고가 더 적음 — 계산서 합계표 누락 확인.", note: periodNote,
    }));

    // 기납부·공제
    const cr = (k) => h.get("credits", k).amount || h.get("credits", k).tax;
    res.push(cmp("예정고지세액 = 신고서 (24)", cr("예정고지세액"), t(24), {
      more: "신고가 고지액보다 많음 — 고지서 금액 확인.", less: "신고가 고지액보다 적음 — 고지 취소·일부 납부 여부 확인.",
    }));
    res.push(cmp("예정신고 미환급세액 = 신고서 (23)", cr("예정신고미환급세액"), t(23)));
    res.push(cmp("매입자납부특례 기납부세액 = 신고서 (27)", cr("매입자납부특례기납부세액"), t(27)));
    res.push(cmp("신용카드사 대리납부세액 = 신고서 (28)", cr("신용카드사대리납부세액"), t(28)));
    for (const k of ["예정부과세액", "예정신고세액"]) {
      const v = cr(k);
      if (v) res.push(result(`${k}(간이) ${fmt(v)}원`, S.WARN, v, null, "간이과세자 항목 — 일반과세자 신고서와 대사하지 않음"));
    }
    for (const [k, label] of [["신용카드발행세액공제기공제", "신용카드매출전표 발행세액공제"], ["전자세금계산서발급세액공제기공제", "전자세금계산서 발급세액공제"]]) {
      const v = cr(k);
      if (v) res.push(result(`${label} 기공제 ${fmt(v)}원`, S.OK, null, null, "참고 — 올해 연간 한도에서 이미 공제받은 세액", true));
    }

    // 부속서류 제출대상
    for (const [k, label] of [["현금매출명세서", "현금매출명세서"], ["부동산임대공급가액명세서", "부동산임대공급가액명세서"]]) {
      const f = h.attachments[k];
      if (!f) continue;
      res.push(result(`${label} 제출대상 ${f}`, f === "Y" ? S.WARN : S.OK, null, null,
        f === "Y" ? "제출대상 — 신고서에 첨부했는지 확인" : "제출대상 아님", true));
    }

    if (h.missing.length) {
      res.push(result("통합조회 칸 읽기", S.WARN, null, null, `읽지 못한 칸: ${h.missing.join(", ")} — 0으로 보고 비교함`, true));
    }
    return res;
  }

  VAT.hometaxCompare = { compareHometax, GROUP: G };
})((globalThis.VAT = globalThis.VAT || {}));
