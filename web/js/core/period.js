/*
 * 과세기간·신고기간·신고기한.
 * - 1기 1/1~6/30 (예정 1/1~3/31), 2기 7/1~12/31 (예정 7/1~9/30)
 * - 신고기한: 기간 종료일이 속한 달의 다음 달 25일
 * - 기한이 토·일·공휴일이면 다음 영업일 (국세기본법 제5조). 공휴일은 호출 측에서 넘긴다.
 * 날짜는 'YYYY-MM-DD' 문자열로 주고받는다 (시간대 문제 회피).
 */
(function (VAT) {
  "use strict";

  const ReturnKind = Object.freeze({ PRELIMINARY: "예정", FINAL: "확정" });

  const pad = (n) => String(n).padStart(2, "0");
  const iso = (y, m, d) => `${y}-${pad(m)}-${pad(d)}`;
  const parse = (s) => s.split("-").map(Number);
  const toUTC = (s) => { const [y, m, d] = parse(s); return new Date(Date.UTC(y, m - 1, d)); };
  const fromUTC = (dt) => iso(dt.getUTCFullYear(), dt.getUTCMonth() + 1, dt.getUTCDate());
  const addDays = (s, n) => { const dt = toUTC(s); dt.setUTCDate(dt.getUTCDate() + n); return fromUTC(dt); };
  const weekday = (s) => toUTC(s).getUTCDay(); // 0=일 ... 6=토

  class TaxPeriod {
    constructor(year, half, kind) {
      if (!Number.isInteger(year)) throw new TypeError("연도는 정수");
      if (half !== 1 && half !== 2) throw new RangeError("기수는 1 또는 2");
      if (!Object.values(ReturnKind).includes(kind)) throw new RangeError(`신고구분 오류: ${kind}`);
      Object.assign(this, { year, half, kind });
      Object.freeze(this);
    }
    get label() { return `${this.year}년 ${this.half}기 ${this.kind}`; }
    get taxableStart() { return iso(this.year, this.half === 1 ? 1 : 7, 1); }
    get taxableEnd() { return this.half === 1 ? iso(this.year, 6, 30) : iso(this.year, 12, 31); }
    get preliminaryEnd() { return this.half === 1 ? iso(this.year, 3, 31) : iso(this.year, 9, 30); }

    /** 이번 신고서에 담을 거래 기간. 예정신고를 안 한 확정신고(예정고지 개인 등)는 6개월 전체. */
    reportingRange({ preliminaryFiled = true } = {}) {
      if (this.kind === ReturnKind.PRELIMINARY) return [this.taxableStart, this.preliminaryEnd];
      if (preliminaryFiled) return [addDays(this.preliminaryEnd, 1), this.taxableEnd];
      return [this.taxableStart, this.taxableEnd];
    }

    /** 법정 신고기한 (휴일 조정 전) */
    get statutoryDueDate() {
      const end = this.kind === ReturnKind.PRELIMINARY ? this.preliminaryEnd : this.taxableEnd;
      const [y, m] = parse(end);
      return m === 12 ? iso(y + 1, 1, 25) : iso(y, m + 1, 25);
    }

    dueDate(holidays = []) { return nextBusinessDay(this.statutoryDueDate, holidays); }
  }

  function nextBusinessDay(d, holidays = []) {
    const off = new Set(holidays);
    while (weekday(d) === 0 || weekday(d) === 6 || off.has(d)) d = addDays(d, 1);
    return d;
  }

  VAT.period = { ReturnKind, TaxPeriod, nextBusinessDay, addDays };
})((globalThis.VAT = globalThis.VAT || {}));
