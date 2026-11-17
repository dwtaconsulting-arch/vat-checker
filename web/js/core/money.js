/*
 * 금액 변환과 단수처리.
 *
 * 원칙
 * - 소수가 있는 number(0.1 등)는 받지 않는다 (2진 부동소수점 오차 원천 차단).
 * - 금액은 원 단위 정수(Number.isSafeInteger)로만 주고받는다.
 * - 내부 나눗셈·곱셈은 BigInt 분수(Frac)로 오차 없이 하고,
 *   단수처리는 이 파일의 roundWon()에서만 한 번 한다.
 */
(function (VAT) {
  "use strict";

  const abs = (x) => (x < 0n ? -x : x);
  const gcd = (a, b) => {
    a = abs(a);
    b = abs(b);
    while (b) [a, b] = [b, a % b];
    return a || 1n;
  };

  class Frac {
    constructor(n, d = 1n) {
      n = BigInt(n);
      d = BigInt(d);
      if (d === 0n) throw new RangeError("분모가 0입니다");
      if (d < 0n) {
        n = -n;
        d = -d;
      }
      const g = gcd(n, d);
      this.n = n / g;
      this.d = d / g;
      Object.freeze(this);
    }
    add(o) { o = toFrac(o); return new Frac(this.n * o.d + o.n * this.d, this.d * o.d); }
    sub(o) { o = toFrac(o); return new Frac(this.n * o.d - o.n * this.d, this.d * o.d); }
    mul(o) { o = toFrac(o); return new Frac(this.n * o.n, this.d * o.d); }
    div(o) { o = toFrac(o); return new Frac(this.n * o.d, this.d * o.n); }
    neg() { return new Frac(-this.n, this.d); }
    cmp(o) { o = toFrac(o); const l = this.n * o.d, r = o.n * this.d; return l < r ? -1 : l > r ? 1 : 0; }
    eq(o) { return this.cmp(o) === 0; }
    get isInt() { return this.d === 1n; }
    get sign() { return this.n < 0n ? -1 : this.n > 0n ? 1 : 0; }
    toNumber() { return Number(this.n) / Number(this.d); } // 표시용 근삿값 — 계산에 쓰지 말 것
    toString() { return this.d === 1n ? `${this.n}` : `${this.n}/${this.d}`; }
  }

  const NEGATIVE_MARKS = ["△", "▲", "-"];

  /** 금액·비율 입력을 정확한 분수로 변환. 문자열은 쉼표, 공백, 음수표기(-, △, ▲, 괄호) 허용. */
  function toFrac(value) {
    if (value instanceof Frac) return value;
    if (typeof value === "boolean") throw new TypeError("boolean은 금액으로 쓸 수 없습니다");
    if (typeof value === "bigint") return new Frac(value);
    if (typeof value === "number") {
      if (!Number.isFinite(value)) throw new RangeError(`유한한 수가 아닙니다: ${value}`);
      if (!Number.isInteger(value)) {
        throw new TypeError(`소수 number는 오차 위험으로 금지합니다. 문자열로 넘기세요: ${value}`);
      }
      if (!Number.isSafeInteger(value)) throw new RangeError(`안전한 정수 범위를 넘습니다: ${value}`);
      return new Frac(BigInt(value));
    }
    if (typeof value === "string") return parseDecimalString(value);
    throw new TypeError(`지원하지 않는 금액 형식: ${typeof value}`);
  }

  function parseDecimalString(raw) {
    let s = raw.trim().replace(/[,\s]/g, "");
    let negative = false;
    if (s.startsWith("(") && s.endsWith(")")) {
      negative = true;
      s = s.slice(1, -1);
    }
    for (const mark of NEGATIVE_MARKS) {
      if (s.startsWith(mark)) {
        negative = !negative;
        s = s.slice(mark.length);
        break;
      }
    }
    if (s === "") throw new RangeError(`빈 금액입니다: ${JSON.stringify(raw)}`);
    const m = /^(\d+)(?:\.(\d+))?$/.exec(s);
    if (!m) throw new RangeError(`숫자로 읽을 수 없습니다: ${JSON.stringify(raw)}`);
    const frac = m[2] || "";
    const f = new Frac(BigInt(m[1] + frac), 10n ** BigInt(frac.length));
    return negative ? f.neg() : f;
  }

  const Rounding = Object.freeze({ TRUNCATE: "절사", HALF_UP: "반올림", UP: "절상" });
  const SplitBasis = Object.freeze({ TAX: "세액 먼저", SUPPLY: "공급가액 먼저" });

  function toSafeNumber(big) {
    const n = Number(big);
    if (!Number.isSafeInteger(n)) throw new RangeError(`결과가 안전한 정수 범위를 넘습니다: ${big}`);
    return n;
  }

  /** 원 단위(unit=10이면 10원 단위)로 단수처리 → Number(정수). 음수는 절댓값 기준. */
  function roundWon(value, rounding = Rounding.TRUNCATE, unit = 1) {
    if (!Number.isInteger(unit) || unit <= 0) throw new RangeError("unit은 양의 정수여야 합니다");
    const q = toFrac(value).div(unit);
    const sign = q.n < 0n ? -1n : 1n;
    const n = abs(q.n), d = q.d;
    let r;
    if (rounding === Rounding.TRUNCATE) r = n / d;
    else if (rounding === Rounding.UP) r = n / d + (n % d ? 1n : 0n);
    else if (rounding === Rounding.HALF_UP) r = (2n * n + d) / (2n * d);
    else throw new RangeError(`알 수 없는 단수처리: ${rounding}`);
    return toSafeNumber(sign * r * BigInt(unit));
  }

  /** 공급가액 × 세율 → 세액 */
  function taxOnSupply(supply, rate, rounding = Rounding.TRUNCATE) {
    return roundWon(toFrac(supply).mul(toFrac(rate)), rounding);
  }

  /**
   * 공급대가(부가세 포함)를 [공급가액, 세액]으로 나눈다. 항상 공급가액 + 세액 = 공급대가.
   * 기본값(세액 먼저·절사) = 공급대가 × 10/110. 프로그램별 실제 방식은 샘플 대사로 확정.
   */
  function splitGross(gross, rate, basis = SplitBasis.TAX, rounding = Rounding.TRUNCATE) {
    const g = toFrac(gross);
    if (!g.isInt) throw new RangeError(`공급대가는 원 단위 정수여야 합니다: ${gross}`);
    const r = toFrac(rate);
    if (r.sign < 0) throw new RangeError("세율은 음수일 수 없습니다");
    const total = toSafeNumber(g.n);
    if (basis === SplitBasis.TAX) {
      const tax = roundWon(g.mul(r).div(r.add(1)), rounding);
      return [total - tax, tax];
    }
    const supply = roundWon(g.div(r.add(1)), rounding);
    return [supply, total - supply];
  }

  /** 정수 금액 문자열 → Number. 소수가 있으면 오류. */
  function toWon(text) {
    const f = toFrac(text);
    if (!f.isInt) throw new RangeError(`정수 금액이 아닙니다: ${text}`);
    return toSafeNumber(f.n);
  }

  const fmt = (v) => (v === null || v === undefined ? "" : v.toLocaleString("ko-KR"));

  VAT.money = { Frac, toFrac, Rounding, SplitBasis, roundWon, taxOnSupply, splitGross, toWon, fmt };
})((globalThis.VAT = globalThis.VAT || {}));
