/*
 * 일반과세자 부가가치세 신고서 PDF(본표 + 부속서류) 해석.
 * 입력: VAT.pdfText.readPdf() 결과(쪽별 words/lines)
 *
 * 지원 서식 (2026. 3. 20. 개정 서식 샘플로 확인):
 * - 본표 1쪽 (1)~(30), ㉰ / 2쪽 (36)~(84)
 * - 매출처별·매입처별 세금계산서합계표(갑) 총합계, 매입처별 계산서합계표(갑) 총합계
 * - 신고기간, 사업자등록번호, 과세표준명세 업종코드
 * - 신용카드매출전표등 수령명세서(갑)(을)
 * - 영세율 매출명세서 / 영세율 첨부서류 제출명세서(이어지는 쪽 포함)
 */
(function (VAT) {
  "use strict";
  const { toFrac, toWon } = VAT.money;
  const { groupRows } = VAT.pdfText;

  // "(90)" 또는 "(90)계산서수취금액"처럼 이름이 붙은 경우. "(16)-(17)" 같은 계산식은 제외
  const LABEL = /^\((\d{1,2})\)(?![\d)+\-])/;
  const INT = /^-?\d{1,3}(,\d{3})*$|^-?\d+$/;
  const TAX_COL_MIN_X1 = 450; // 이보다 오른쪽에서 끝나는 숫자는 세액 칸
  const compact = (s) => s.replace(/\s/g, "");

  const FORM_MARKERS = {
    본표1: ["일반과세자부가가치세"],
    본표2: ["(제2장앞쪽)", "(2장앞쪽)"],
    매입처별세금계산서합계표: ["매입처별세금계산서합계표"],
    매출처별세금계산서합계표: ["매출처별세금계산서합계표"],
    매입처별계산서합계표: ["매입처별계산서합계표(갑)"], // 다른 서식 안내문에도 이 이름이 나오므로 (갑)까지 확인
    신용카드수령명세서: ["신용카드매출전표등수령명세서(갑)", "신용카드매출전표등수령명세서(을)"],
    영세율매출명세서: ["영세율매출명세서"],
    영세율첨부서류제출명세서: ["영세율첨부서류제출명세서"],
  };

  class ReturnPdf {
    constructor() {
      this.lines = {}; // "1"~"90", "다"(㉰) → {amount, tax}
      this.period = null; // {year, half, start: "YYYY-MM-DD", end}
      this.bizNo = null; // 사업자등록번호 "000-00-00000"
      this.industryCodes = []; // 과세표준명세 (31)~(34) 업종코드
      this.purchaseInvoiceTotal = null; // {매입처수, 매수, 공급가액, 세액}
      this.salesInvoiceTotal = null; // {매출처수, 매수, 공급가액, 세액}
      this.purchaseBillTotal = null; // 매입처별 계산서합계표 {매입처수, 매수, 매입금액}
      this.cardSummary = {}; // 합계/현금영수증/... → {count, supply, tax}
      this.cardRows = [];
      this.zeroRateItemsVatAct = [];
      this.zeroRateItemsSpecial = [];
      this.zeroRateTotals = {}; // ⑪ ⑫ ⑬
      this.zeroRateDocs = [];
      this.foundForms = {}; // 서식명 → [쪽번호]
    }
    amount(key) { return this.lines[String(key)]?.amount ?? 0; }
    tax(key) { return this.lines[String(key)]?.tax ?? 0; }
  }

  function parseReturn(pages) {
    const r = new ReturnPdf();
    for (const page of pages) {
      const text = page.lines.join("\n");
      const c = compact(text);
      const forms = Object.entries(FORM_MARKERS).filter(([, marks]) => marks.some((m) => c.includes(m))).map(([n]) => n);
      for (const f of forms) (r.foundForms[f] ||= []).push(page.num);

      if (forms.includes("본표1")) {
        parseMainLines(page.words, r, 1, 30);
        parseCircledDa(page.words, r);
        parseHeader(page.lines, c, r);
      }
      if (forms.includes("본표2")) {
        parseMainLines(page.words, r, 36, 90);
        r.bizNo ||= (/사업자등록번호(\d{3}-\d{2}-\d{5})/.exec(c) || [])[1] || null;
      }
      if (forms.includes("매입처별세금계산서합계표") && !r.purchaseInvoiceTotal) r.purchaseInvoiceTotal = parseInvoiceSummary(page.words, "매입처수");
      if (forms.includes("매출처별세금계산서합계표") && !r.salesInvoiceTotal) r.salesInvoiceTotal = parseInvoiceSummary(page.words, "매출처수");
      if (forms.includes("매입처별계산서합계표") && !r.purchaseBillTotal) r.purchaseBillTotal = parseBillSummary(page.words);
      if (forms.includes("신용카드수령명세서")) parseCardPage(page.lines, page.num, r);
      if (forms.includes("영세율매출명세서")) parseZeroRateSummary(page.lines, r);
      if (r.foundForms["영세율첨부서류제출명세서"]) parseZeroRateDocs(page.lines, page.num, r);
    }
    return r;
  }

  function parseMainLines(words, r, lo, hi) {
    for (const row of groupRows(words)) {
      for (let i = 0; i < row.length; i++) {
        const m = LABEL.exec(row[i].text);
        if (!m || +m[1] < lo || +m[1] > hi) continue;
        const lv = { amount: null, tax: null };
        for (const x of row.slice(i + 1)) {
          if (!INT.test(x.text)) continue;
          if (x.x1 >= TAX_COL_MIN_X1) lv.tax = toWon(x.text);
          else if (lv.amount === null) lv.amount = toWon(x.text);
        }
        r.lines[m[1]] = lv;
        break;
      }
    }
  }

  /** 본표 1쪽 머리: 신고기간, 사업자등록번호(첫 번째 = 신고인), 과세표준명세 업종코드 */
  function parseHeader(lines, c, r) {
    const m = /신고기간(\d{4})년제(\d)기\((\d{2})월(\d{2})일[~∼〜～](\d{2})월(\d{2})일\)/.exec(c);
    if (m) r.period = { year: +m[1], half: +m[2], start: `${m[1]}-${m[3]}-${m[4]}`, end: `${m[1]}-${m[5]}-${m[6]}` };
    r.bizNo = (/사업자등록번호(\d{3}-\d{2}-\d{5})/.exec(c) || [])[1] || null;
    for (const line of lines) {
      if (!/^\((3[1-4])\)/.test(line.trim())) continue;
      const code = industryCode(line.trim().split(/\s+/));
      if (code) r.industryCodes.push(code);
    }
  }

  /** 업종코드: "181201" 한 단어, 또는 칸마다 한 자리씩 "5 5 2 1 1 7" */
  function industryCode(tokens) {
    const whole = tokens.find((w) => /^\d{6}$/.test(w));
    if (whole) return whole;
    for (let i = 0; i + 6 <= tokens.length; i++) {
      const run = tokens.slice(i, i + 6);
      if (run.every((w) => /^\d$/.test(w))) return run.join("");
    }
    return null;
  }

  function parseCircledDa(words, r) {
    for (const row of groupRows(words)) {
      const i = row.findIndex((w) => w.text === "㉰");
      if (i < 0) continue;
      const nums = row.slice(i + 1).filter((x) => INT.test(x.text));
      if (nums.length) r.lines["다"] = { amount: null, tax: toWon(nums[nums.length - 1].text) };
      return;
    }
  }

  /**
   * 합계표 총합계의 "합계" 줄: [처수, 매수, 금액 칸들…]
   * 프로그램마다 "합 계"/"합계", 숫자 칸이 세 자리 묶음(조·십억·백만·천·일) 또는 한 칸 한 자리로 다르다.
   * 라벨과 숫자의 밑선이 몇 pt 어긋나는 출력도 있어 같은 줄 대신 세로 거리로 찾는다.
   */
  function totalRowNumbers(words, name = "합계", nth = 0) {
    const [a, b] = [...name];
    let seen = 0;
    for (const row of groupRows(words)) {
      const i = row.findIndex((w, k) => w.text === name || (w.text === a && row[k + 1]?.text === b));
      if (i < 0) continue;
      const label = row[row[i].text === "합" ? i + 1 : i];
      const nums = words.filter((w) => /^\d+$/.test(w.text) && w.x0 > label.x1 && Math.abs(w.bottom - label.bottom) <= 6)
        .sort((a, b) => a.x0 - b.x0);
      if (nums.length >= 3 && seen++ === nth) return nums;
    }
    return null;
  }

  /** 금액 칸들을 숫자로: 한 칸 한 자리면 그대로 잇고, 세 자리 묶음이면 joinGroups */
  function joinCells(tokens) {
    if (!tokens.length) return 0;
    return tokens.every((t) => t.length === 1) ? toWon(tokens.join("")) : joinGroups(tokens);
  }

  function parseInvoiceSummary(words, countKey) {
    const taxHead = words.find((w) => w.text.startsWith("⑩"));
    const nums = totalRowNumbers(words);
    if (!taxHead || !nums) return null;
    const split = taxHead.x0 - 5;
    const read = (row) => {
      const [vendors, sheets, ...money] = row;
      return {
        [countKey]: +vendors.text,
        매수: +sheets.text,
        공급가액: joinCells(money.filter((w) => w.x1 < split).map((w) => w.text)),
        세액: joinCells(money.filter((w) => w.x1 >= split).map((w) => w.text)),
      };
    };
    const out = read(nums);
    // 소계 두 줄: 첫째 = 기한 내 전송된 전자세금계산서분, 둘째 = 그 외(종이·지연전송 등) 발급분
    const nonE = totalRowNumbers(words, "소계", 1);
    if (nonE) out.전자외 = read(nonE);
    return out;
  }

  /** 매입처별 계산서합계표(갑) 총합계: 합계 | 매입처수 | 매수 | 매입금액 */
  function parseBillSummary(words) {
    const nums = totalRowNumbers(words);
    if (!nums) return null;
    const [vendors, sheets, ...money] = nums;
    return { 매입처수: +vendors.text, 매수: +sheets.text, 매입금액: joinCells(money.map((w) => w.text)) };
  }

  /** 조·십억·백만·천·일 칸으로 나뉜 숫자를 합친다 (첫 칸 외에는 3자리). */
  function joinGroups(groups) {
    if (!groups.length) return 0;
    return toWon(groups[0] + groups.slice(1).map((g) => g.padStart(3, "0")).join(""));
  }

  // 2019 서식은 ④합계~⑧, 2026 서식은 ⑤합계~⑨ — 번호가 판마다 달라 항목 이름으로 구분한다
  const CARD_SUMMARY = /^([④⑤⑥⑦⑧⑨])\s*(.+?)\s+(\d+)\s+(-?[\d,]+)\s+(-?[\d,]+)$/;
  const CARD_ROW = /^(\d+)\s+\S+\s+\S+\s+(\d+)\s+(-?[\d,]+)\s+(-?[\d,]+)$/;
  const CARD_KEYS = ["합계", "현금영수증", "화물운전자복지카드", "사업용신용카드", "그밖의신용카드등"];

  function parseCardPage(lines, pageNum, r) {
    for (const raw of lines) {
      const line = raw.trim();
      let m = CARD_SUMMARY.exec(line);
      if (m) {
        const key = CARD_KEYS.find((k) => compact(m[2]).startsWith(k));
        if (key) {
          r.cardSummary[key] = { count: +m[3], supply: toWon(m[4]), tax: toWon(m[5]) };
          continue;
        }
      }
      m = CARD_ROW.exec(line);
      if (m) r.cardRows.push({ seq: +m[1], count: +m[2], supply: toWon(m[3]), tax: toWon(m[4]), page: pageNum });
    }
  }

  const TRAILING_AMOUNT = /(?:^|\s)(-?\d{1,3}(?:,\d{3})*|0)$/;

  function parseZeroRateSummary(lines, r) {
    const start = lines.findIndex((l) => compact(l).includes("영세율적용공급실적합계"));
    if (start < 0) return;
    let bucket = r.zeroRateItemsVatAct;
    for (const raw of lines.slice(start + 1)) {
      const l = raw.trim();
      const m = TRAILING_AMOUNT.exec(l);
      if (l.startsWith("⑪")) {
        if (m) r.zeroRateTotals["⑪"] = toWon(m[1]);
        bucket = r.zeroRateItemsSpecial;
      } else if (l.startsWith("⑫")) {
        if (m) r.zeroRateTotals["⑫"] = toWon(m[1]);
      } else if (l.startsWith("⑬")) {
        if (m) r.zeroRateTotals["⑬"] = toWon(m[1]);
        break;
      } else if (m) {
        bucket.push([l.slice(0, m.index).trim() || "(앞줄 항목)", toWon(m[1])]);
      }
    }
  }

  // 일련번호 … 통화 환율 외화 원화 외화 원화. 서류명·발급자는 같은 줄에 없을 수 있다
  // (두 줄짜리 "Credit / Memo" 칸은 세로 가운데 정렬이라 위아래 줄로 갈라진다).
  const DOC_ROW = new RegExp(
    String.raw`^(\d+)\s+(.*?)\b([A-Z]{3})\s+` +
      String.raw`(-?[\d,]+\.\d+)\s+(-?[\d,]+\.\d+)\s+(-?[\d,]+)\s+(-?[\d,]+\.\d+)\s+(-?[\d,]+)$`
  );
  const WORD = /^[A-Za-z]+$/;

  function docName(lines, i, middle) {
    const own = middle.trim().split(/\s+/)[0];
    if (own && WORD.test(own)) return own;
    const above = (lines[i - 1] || "").trim().split(/\s+/)[0];
    const below = (lines[i + 1] || "").trim().split(/\s+/)[0];
    return [above, below].filter((w) => w && WORD.test(w)).join(" ") || "(서류명 없음)";
  }

  function parseZeroRateDocs(lines, pageNum, r) {
    for (let i = 0; i < lines.length; i++) {
      const m = DOC_ROW.exec(lines[i].trim());
      if (!m) continue;
      r.zeroRateDocs.push({
        seq: +m[1],
        doc: docName(lines, i, m[2]),
        currency: m[3],
        rate: toFrac(m[4]),
        fxSubmit: toFrac(m[5]),
        krwSubmit: toWon(m[6]),
        fxReport: toFrac(m[7]),
        krwReport: toWon(m[8]),
        page: pageNum,
      });
    }
  }

  VAT.returnPdf = { parseReturn, ReturnPdf, joinGroups, FORM_MARKERS };
})((globalThis.VAT = globalThis.VAT || {}));
