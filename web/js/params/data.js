/*
 * 적용기간별 세법 파라미터.
 * value는 반드시 문자열("0.10") 또는 정수 (소수 number 금지).
 * to를 생략하면 무기한. 같은 이름의 기간이 겹치면 로드 시 오류.
 * 모든 항목에 법령 근거(basis)를 적는다.
 */
(function (VAT) {
  "use strict";
  VAT.paramData = {
    standard_rate: [
      { value: "0.10", from: "1977-07-01", basis: "부가가치세법 제30조 (일반세율 10%)" },
    ],
    zero_rate: [
      { value: 0, from: "1977-07-01", basis: "부가가치세법 제21조~제25조 (영세율)" },
    ],
  };
})((globalThis.VAT = globalThis.VAT || {}));
