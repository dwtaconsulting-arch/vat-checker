/* 적용기간별 파라미터 선택. 데이터는 js/params/data.js */
(function (VAT) {
  "use strict";
  const OPEN_END = "9999-12-31";
  const DATE = /^\d{4}-\d{2}-\d{2}$/;

  class ParamTable {
    constructor(data) {
      this._values = new Map();
      for (const [name, rows] of Object.entries(data)) {
        const parsed = rows.map((row) => parseRow(name, row)).sort((a, b) => (a.from < b.from ? -1 : 1));
        for (let i = 1; i < parsed.length; i++) {
          if (parsed[i].from <= parsed[i - 1].to) {
            throw new Error(`'${name}' 적용기간 겹침: ${parsed[i - 1].from}~${parsed[i - 1].to} / ${parsed[i].from}~${parsed[i].to}`);
          }
        }
        this._values.set(name, parsed);
      }
    }
    get(name, on) {
      const rows = this._values.get(name);
      if (!rows) throw new Error(`정의되지 않은 파라미터: ${name}`);
      const hit = rows.find((r) => r.from <= on && on <= r.to);
      if (!hit) throw new Error(`'${name}'에 ${on} 적용값이 없습니다`);
      return hit;
    }
    names() { return [...this._values.keys()].sort(); }
  }

  function parseRow(name, row) {
    for (const k of ["value", "from", "basis"]) {
      if (!(k in row)) throw new Error(`[${name}] '${k}' 누락`);
    }
    const to = row.to ?? OPEN_END;
    if (!DATE.test(row.from) || !DATE.test(to)) throw new Error(`[${name}] 적용일은 YYYY-MM-DD`);
    if (row.from > to) throw new Error(`[${name}] 시작일이 종료일보다 늦습니다`);
    let value;
    try {
      value = VAT.money.toFrac(row.value);
    } catch (e) {
      throw new Error(`[${name}] ${e.message}`);
    }
    return Object.freeze({ name, value, from: row.from, to, basis: String(row.basis) });
  }

  VAT.params = { ParamTable, load: () => new ParamTable(VAT.paramData) };
})((globalThis.VAT = globalThis.VAT || {}));
