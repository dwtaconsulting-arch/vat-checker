/*
 * 계산근거(trace) 기록. 모든 신고서 칸은 record()를 거쳐 값을 확정한다.
 * 결과마다 산식·입력값·적용 파라미터·법령 근거가 남아 대사 시 역추적이 가능하다.
 */
(function (VAT) {
  "use strict";

  class Trace {
    constructor() { this._entries = new Map(); }

    record(key, label, value, { formula = "", inputs = {}, params = {}, basis = "" } = {}) {
      if (typeof value !== "number" || !Number.isSafeInteger(value)) {
        throw new TypeError(`${key}: 확정 금액은 원 단위 정수여야 합니다 (${typeof value} ${value})`);
      }
      if (this._entries.has(key)) throw new Error(`이미 기록된 항목입니다: ${key}`);
      this._entries.set(key, Object.freeze({ key, label, value, formula, inputs: { ...inputs }, params: { ...params }, basis }));
      return value;
    }
    get(key) {
      const e = this._entries.get(key);
      if (!e) throw new Error(`기록 없음: ${key}`);
      return e;
    }
    has(key) { return this._entries.has(key); }
    value(key) { return this.get(key).value; }
    get size() { return this._entries.size; }
    [Symbol.iterator]() { return this._entries.values(); }
  }

  VAT.trace = { Trace };
})((globalThis.VAT = globalThis.VAT || {}));
