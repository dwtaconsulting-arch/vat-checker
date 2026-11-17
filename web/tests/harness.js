/* 아주 작은 브라우저 테스트 러너. 결과는 #out에 텍스트로, 끝나면 document.title = "DONE ..." */
(function () {
  "use strict";
  const tests = [];
  globalThis.test = (name, fn) => tests.push({ name, fn });
  globalThis.cases = (name, rows, fn) => rows.forEach((row, i) => test(`${name} [${i}] ${JSON.stringify(row, (k, v) => (typeof v === "bigint" ? `${v}n` : v))}`, () => fn(...row)));

  const show = (v) => (typeof v === "bigint" ? `${v}n` : JSON.stringify(v));
  globalThis.eq = (actual, expected, msg = "") => {
    if (JSON.stringify(actual, (k, v) => (typeof v === "bigint" ? `${v}n` : v)) !==
        JSON.stringify(expected, (k, v) => (typeof v === "bigint" ? `${v}n` : v))) {
      throw new Error(`${msg} 기대 ${show(expected)} / 실제 ${show(actual)}`);
    }
  };
  globalThis.ok = (cond, msg = "조건 불만족") => { if (!cond) throw new Error(msg); };
  globalThis.throws = (fn, pattern) => {
    try { fn(); } catch (e) {
      if (pattern && !pattern.test(e.message)) throw new Error(`오류 메시지 불일치: ${e.message}`);
      return;
    }
    throw new Error("오류가 나야 하는데 나지 않음");
  };

  globalThis.runTests = async () => {
    const out = document.getElementById("out");
    const lines = [];
    let pass = 0, fail = 0;
    for (const t of tests) {
      try {
        await t.fn();
        pass++;
      } catch (e) {
        fail++;
        lines.push(`FAIL ${t.name}\n     ${e.message}`);
      }
    }
    lines.unshift(`RESULT pass=${pass} fail=${fail}`);
    out.textContent = lines.join("\n");
    document.title = `DONE pass=${pass} fail=${fail}`;
  };
})();
