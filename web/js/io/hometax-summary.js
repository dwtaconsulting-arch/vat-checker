/*
 * 홈택스 「부가가치세 신고자료 통합조회」(세무대리인) 화면을 PDF로 저장한 파일 해석.
 * 입력: VAT.pdfText.readPdf() 결과
 *
 * 화면 구조: 왼쪽 = 매출항목·공제항목, 오른쪽 = 매입항목·부속서류 제출대상·기공제.
 * 칸 이름이 두 줄로 나뉘고 금액은 그 사이 높이에 있어서(예: "사업용 / 신용카드"),
 * 금액 줄마다 같은 쪽 칸 이름 중 세로 거리 ROW_TOL 안에 있는 것을 이어 붙여 이름으로 쓴다.
 * 좌표는 쪽 너비 비율로 잡는다 (2026-11 홈택스 화면, A4 인쇄 샘플로 확인).
 */
(function (VAT) {
  "use strict";
  const { toWon } = VAT.money;
  const { groupRows } = VAT.pdfText;

  const MARKER = "부가가치세신고자료통합조회";
  const INT = /^-?\d{1,3}(,\d{3})*$|^-?\d+$/;
  const FLAG = /^[YN]$/;
  const ROW_TOL = 8.5; // 금액 줄과 칸 이름 줄의 세로 거리(pt) 허용치
  const compact = (s) => s.replace(/\s/g, "");

  // 쪽 너비 비율: [구분 칸 끝, 칸 이름 끝] — 칸 이름 끝보다 오른쪽은 값
  const ZONES = {
    left: { from: 0, to: 0.5, label: [0.11, 0.27] },
    right: { from: 0.5, to: 1, label: [0.56, 0.73] },
  };

  // 붙여 쓴 칸 이름에 포함된 말 → [구역, 키]. 위에서부터 먼저 맞는 것을 쓴다(긴 이름 먼저).
  const NAMES = {
    left: [
      ["신용카드사를통한", "credits", "신용카드사대리납부세액"],
      ["매입자납부특례", "credits", "매입자납부특례기납부세액"],
      ["예정신고미환급세액", "credits", "예정신고미환급세액"],
      ["예정고지세액", "credits", "예정고지세액"],
      ["예정부과세액", "credits", "예정부과세액"],
      ["예정신고세액", "credits", "예정신고세액"],
      ["전자세금계산서", "sales", "전자세금계산서"],
      ["전자계산서", "sales", "전자계산서"],
      ["판매(결제)대행", "sales", "판매결제대행"],
      ["현금영수증", "sales", "현금영수증"],
      ["신용카드", "sales", "신용카드"],
    ],
    right: [
      ["발급세액공제", "credits", "전자세금계산서발급세액공제기공제"],
      ["발행세액공제", "credits", "신용카드발행세액공제기공제"],
      ["현금매출명세서", "attachments", "현금매출명세서"],
      ["부동산임대공급가액", "attachments", "부동산임대공급가액명세서"],
      ["전자세금계산서", "purchases", "전자세금계산서"],
      ["전자계산서", "purchases", "전자계산서"],
      ["사업용신용카드", "purchases", "사업용신용카드"],
      ["현금영수증", "purchases", "현금영수증"],
      ["화물운전자복지카드", "purchases", "화물운전자복지카드"],
    ],
  };

  // 화면에 항상 있는 칸 — 못 읽으면 missing 으로 알린다
  const EXPECTED = [
    ...NAMES.left.map(([, sec, key]) => `${sec}.${key}`),
    ...NAMES.right.map(([, sec, key]) => `${sec}.${key}`),
  ];

  class HometaxSummary {
    constructor() {
      this.year = null;
      this.half = null;
      this.start = null; // "YYYY-MM-DD"
      this.end = null;
      this.bizNo = null;
      this.filerType = null; // 신고유형 (법인/개인/간이…)
      this.industryCode = null; // 주업종코드
      this.preliminaryNoticeTarget = null; // 법인예정고지대상 Y/N
      this.sales = {}; // 키 → {amount, tax}
      this.purchases = {};
      this.credits = {};
      this.attachments = {}; // 키 → "Y" | "N"
      this.missing = []; // 읽지 못한 칸
    }
    get(section, key) {
      return this[section][key] ?? { amount: 0, tax: 0 };
    }
  }

  const isHometaxSummary = (pages) => pages.some((p) => compact(p.lines.join("")).includes(MARKER));

  function parseHometaxSummary(pages) {
    const page = pages.find((p) => compact(p.lines.join("")).includes(MARKER));
    if (!page) return null;
    const h = new HometaxSummary();
    const c = compact(page.lines.join("\n"));

    let m = /과세기간\(년\/기\)(\d{4})년(\d)기/.exec(c);
    if (m) [h.year, h.half] = [+m[1], +m[2]];
    m = /과세기간(\d{4})(\d{2})(\d{2})-(\d{4})(\d{2})(\d{2})/.exec(c);
    if (m) [h.start, h.end] = [`${m[1]}-${m[2]}-${m[3]}`, `${m[4]}-${m[5]}-${m[6]}`];
    h.bizNo = (/사업자등록번호(\d{3}-\d{2}-\d{5})/.exec(c) || [])[1] || null;
    h.filerType = (/신고유형(.+?)주업종코드/.exec(c) || [])[1] || null;
    h.industryCode = (/주업종코드(\d{6})/.exec(c) || [])[1] || null;
    h.preliminaryNoticeTarget = (/법인예정고지대상([YN])/.exec(c) || [])[1] || null;

    // 표는 "공급가액(원)" 머리글 줄부터
    const head = page.words.find((w) => w.text.startsWith("공급가액"));
    const tableTop = head ? head.top - 2 : 0;
    const W = page.width;
    for (const [side, z] of Object.entries(ZONES)) {
      const inSide = page.words.filter((w) => w.top >= tableTop && w.x0 >= z.from * W && w.x0 < z.to * W);
      // 이름과 금액이 한 텍스트 조각에 들어 있으면 글자 폭을 균등 배분해 x가 어긋나므로,
      // 값/이름은 위치가 아니라 모양(숫자·Y/N 여부)으로 나눈다.
      const isValue = (w) => INT.test(w.text) || FLAG.test(w.text);
      const labels = inSide.filter((w) => !isValue(w) && w.x0 >= z.label[0] * W && w.x0 < z.label[1] * W);
      const values = inSide.filter((w) => isValue(w) && w.x0 >= z.label[0] * W);
      const taxHead = inSide.filter((w) => w.text.startsWith("세액(원)")).map((w) => w.x0); // "관련 세액" 같은 칸 이름 제외
      const taxFrom = taxHead.length ? Math.min(...taxHead) : (side === "left" ? 0.43 : 0.89) * W;

      for (const row of groupRows(values)) {
        const y = row[0].bottom;
        const name = compact(labels.filter((w) => Math.abs(w.bottom - y) <= ROW_TOL)
          .sort((a, b) => a.bottom - b.bottom || a.x0 - b.x0).map((w) => w.text).join(""));
        const hit = NAMES[side].find(([k]) => name.includes(k));
        if (!hit) continue;
        const [, sec, key] = hit;
        if (sec === "attachments") {
          const f = row.find((w) => FLAG.test(w.text));
          if (f) h.attachments[key] = f.text;
          continue;
        }
        const item = { amount: 0, tax: 0 };
        for (const w of row) {
          if (!INT.test(w.text)) continue;
          if (w.x1 > taxFrom) item.tax = toWon(w.text);
          else item.amount = toWon(w.text);
        }
        h[sec][key] = item;
      }
    }
    h.missing = EXPECTED.filter((k) => {
      const [sec, key] = k.split(".");
      return !(key in h[sec]);
    });
    return h;
  }

  VAT.hometax = { parseHometaxSummary, isHometaxSummary, HometaxSummary, MARKER };
})((globalThis.VAT = globalThis.VAT || {}));
