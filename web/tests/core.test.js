/* Python tests/unit/* 를 옮긴 것 — 두 구현이 같은 규칙을 지키는지 확인 */
(function () {
  const { Frac, toFrac, Rounding, SplitBasis, roundWon, taxOnSupply, splitGross } = VAT.money;
  const { TaxPeriod, ReturnKind, nextBusinessDay } = VAT.period;
  const P = ReturnKind.PRELIMINARY, F = ReturnKind.FINAL;

  // ── money ──
  cases("toFrac 허용", [
    [1000, "1000"], ["1,234,567", "1234567"], ["  1,000 ", "1000"], ["-1,000", "-1000"],
    ["△1,000", "-1000"], ["▲500", "-500"], ["(2,000)", "-2000"], ["0.1", "1/10"], ["0.10", "1/10"],
  ], (raw, expected) => eq(toFrac(raw).toString(), expected));

  test("toFrac 소수 number 거부", () => throws(() => toFrac(0.1), /소수 number/));
  test("toFrac boolean 거부", () => throws(() => toFrac(true)));
  cases("toFrac 잘못된 문자열 거부", [[""], ["  "], ["abc"], ["1,0a0"], ["NaN"], ["Infinity"]],
    (raw) => throws(() => toFrac(raw)));

  cases("roundWon 방식별", [
    ["100.9", Rounding.TRUNCATE, 100], ["100.5", Rounding.HALF_UP, 101], ["100.49", Rounding.HALF_UP, 100],
    ["100.01", Rounding.UP, 101], ["100", Rounding.UP, 100],
    ["-100.9", Rounding.TRUNCATE, -100], ["-100.5", Rounding.HALF_UP, -101], ["-100.01", Rounding.UP, -101],
  ], (v, mode, expected) => eq(roundWon(v, mode), expected));

  test("roundWon 10원 단위", () => {
    eq(roundWon(12345, Rounding.TRUNCATE, 10), 12340);
    eq(roundWon(-12345, Rounding.TRUNCATE, 10), -12340);
  });
  test("분수 누적 오차 없음 (1/3 × 3 = 1)", () => {
    const third = new Frac(1n, 3n);
    eq(roundWon(third.add(third).add(third)), 1);
  });
  test("0.1 + 0.2 = 0.3 정확", () => ok(toFrac("0.1").add("0.2").eq("0.3")));

  cases("taxOnSupply 10% 절사", [[0, 0], [1, 0], [9, 0], [10, 1], [1005, 100], [123456789, 12345678], [-1005, -100]],
    (s, e) => eq(taxOnSupply(s, "0.1"), e));
  test("taxOnSupply 영세율", () => eq(taxOnSupply(50000000, 0), 0));

  const grosses = [0, 1, 10, 11, 109, 110, 111, 1000, 33000, 99999, 1234567, -55555];
  for (const basis of Object.values(SplitBasis)) for (const mode of Object.values(Rounding)) {
    test(`splitGross 합계 보존 ${basis}/${mode}`, () => {
      for (const g of grosses) { const [s, t] = splitGross(g, "0.1", basis, mode); eq(s + t, g, `gross ${g}`); }
    });
  }
  test("splitGross 세액 먼저·절사", () => eq(splitGross(10000, "0.1"), [9091, 909]));
  test("splitGross 공급가액 먼저·반올림", () => eq(splitGross(10000, "0.1", SplitBasis.SUPPLY, Rounding.HALF_UP), [9091, 909]));
  test("splitGross 공급가액 먼저·절사는 1원 다름", () => eq(splitGross(10000, "0.1", SplitBasis.SUPPLY, Rounding.TRUNCATE), [9090, 910]));
  test("splitGross 나누어떨어짐", () => eq(splitGross(110000, "0.1"), [100000, 10000]));
  test("splitGross 비정수 거부", () => throws(() => splitGross("100.5", "0.1")));

  // ── period ──
  cases("법정 신고기한", [[1, P, "2026-04-25"], [1, F, "2026-07-25"], [2, P, "2026-10-25"], [2, F, "2027-01-25"]],
    (h, k, d) => eq(new TaxPeriod(2026, h, k).statutoryDueDate, d));
  cases("신고 대상기간", [
    [1, P, true, ["2026-01-01", "2026-03-31"]], [1, F, true, ["2026-04-01", "2026-06-30"]],
    [1, F, false, ["2026-01-01", "2026-06-30"]], [2, P, true, ["2026-07-01", "2026-09-30"]],
    [2, F, true, ["2026-10-01", "2026-12-31"]], [2, F, false, ["2026-07-01", "2026-12-31"]],
  ], (h, k, filed, range) => eq(new TaxPeriod(2026, h, k).reportingRange({ preliminaryFiled: filed }), range));
  test("주말 기한 이월", () => {
    eq(new TaxPeriod(2026, 1, P).dueDate(), "2026-04-27");
    eq(new TaxPeriod(2026, 1, F).dueDate(), "2026-07-27");
  });
  test("공휴일 기한 이월", () => eq(new TaxPeriod(2026, 1, P).dueDate(["2026-04-27"]), "2026-04-28"));
  test("평일은 그대로", () => eq(nextBusinessDay("2026-11-17"), "2026-11-17"));
  test("라벨", () => eq(new TaxPeriod(2026, 2, F).label, "2026년 2기 확정"));

  // ── trace ──
  test("trace 기록·조회", () => {
    const t = new VAT.trace.Trace();
    eq(t.record("output.invoice.tax", "세액", 100, { inputs: { 공급가액: 1005 }, basis: "부가가치세법 제30조" }), 100);
    eq(t.get("output.invoice.tax").inputs, { 공급가액: 1005 });
    ok(t.has("output.invoice.tax") && t.size === 1);
  });
  test("trace 중복 키 거부", () => { const t = new VAT.trace.Trace(); t.record("a", "A", 1); throws(() => t.record("a", "A", 2)); });
  cases("trace 정수만", [[1.5], ["100"], [true]], (bad) => throws(() => new VAT.trace.Trace().record("a", "A", bad)));

  // ── params ──
  test("기본 파라미터 로드", () => {
    const p = VAT.params.load().get("standard_rate", "2026-06-30");
    ok(p.value.eq("0.1"));
    ok(p.basis.includes("제30조"));
  });
  test("적용일로 선택", () => {
    const t = new VAT.params.ParamTable({ credit: [
      { value: "0.013", from: "2019-01-01", to: "2026-12-31", basis: "old" },
      { value: "0.01", from: "2027-01-01", basis: "new" },
    ] });
    eq(t.get("credit", "2026-12-31").basis, "old");
    ok(t.get("credit", "2027-01-01").value.eq("0.01"));
    throws(() => t.get("credit", "2018-12-31"));
  });
  test("기간 겹침 거부", () => throws(() => new VAT.params.ParamTable({ x: [
    { value: 1, from: "2020-01-01", to: "2025-12-31", basis: "a" }, { value: 2, from: "2025-12-31", basis: "b" },
  ] }), /겹침/));
  test("소수 number 값 거부", () => throws(() => new VAT.params.ParamTable({ x: [{ value: 0.1, from: "2020-01-01", basis: "a" }] }), /소수/));
  test("필수값 누락 거부", () => throws(() => new VAT.params.ParamTable({ x: [{ value: 1, from: "2020-01-01" }] }), /basis/));
})();
