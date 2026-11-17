/*
 * pdf.js로 PDF를 읽어 쪽별 "단어"(좌표 포함)와 "줄" 텍스트를 만든다.
 * 좌표계: 왼쪽 위 원점, 단위 pt (pdfplumber와 같은 방향).
 *   word = { text, x0, x1, top, bottom }
 * 파일은 브라우저 안에서만 읽고 어디에도 전송하지 않는다.
 */
(function (VAT) {
  "use strict";

  const X_TOL = 3; // 같은 단어로 이을 가로 간격(pt) — pdfplumber 기본값과 동일
  const Y_TOL = 3; // 같은 줄로 볼 세로 오차(pt)

  async function readPdf(data) {
    const lib = globalThis.pdfjsLib;
    if (!lib) throw new Error("pdf.js를 불러오지 못했습니다 (js/vendor/pdf.min.js)");
    const doc = await lib.getDocument({ data, isEvalSupported: false, disableFontFace: true }).promise;
    const pages = [];
    for (let num = 1; num <= doc.numPages; num++) {
      const page = await doc.getPage(num);
      const vp = page.getViewport({ scale: 1 });
      const content = await page.getTextContent();
      const glyphs = toGlyphs(content.items, vp);
      const words = toWords(glyphs);
      pages.push({ num, width: vp.width, height: vp.height, words, lines: toLines(words) });
    }
    await doc.destroy();
    return pages;
  }

  /** 텍스트 조각을 공백 기준 토큰으로 쪼갠다 (폭은 글자 수 비율로 배분). */
  function toGlyphs(items, vp) {
    const out = [];
    for (const it of items) {
      if (!it.str || !it.str.trim()) continue;
      const [x, y] = vp.convertToViewportPoint(it.transform[4], it.transform[5]);
      const size = Math.hypot(it.transform[2], it.transform[3]) || it.height || 1;
      const upright = Math.abs(it.transform[1]) < 1e-6 && Math.abs(it.transform[2]) < 1e-6;
      if (!upright) continue; // 회전된 글자는 금액 칸에 쓰이지 않음
      const chars = [...it.str];
      const cw = (it.width || size * chars.length * 0.5) / chars.length;
      let start = -1;
      for (let i = 0; i <= chars.length; i++) {
        const isSpace = i === chars.length || /\s/.test(chars[i]);
        if (!isSpace && start < 0) start = i;
        if (isSpace && start >= 0) {
          out.push({
            text: chars.slice(start, i).join(""),
            x0: x + start * cw,
            x1: x + i * cw,
            top: y - size,
            bottom: y,
          });
          start = -1;
        }
      }
    }
    return out;
  }

  /** 줄 단위로 묶은 뒤, 가로 간격이 X_TOL 이하인 토큰을 한 단어로 잇는다. */
  function toWords(glyphs) {
    const words = [];
    for (const row of groupRows(glyphs)) {
      let cur = null;
      for (const g of row) {
        if (cur && g.x0 - cur.x1 <= X_TOL && g.x0 >= cur.x0) {
          cur.text += g.text;
          cur.x1 = Math.max(cur.x1, g.x1);
          cur.top = Math.min(cur.top, g.top);
          cur.bottom = Math.max(cur.bottom, g.bottom);
        } else {
          if (cur) words.push(cur);
          cur = { ...g };
        }
      }
      if (cur) words.push(cur);
    }
    return words;
  }

  /** 글자 밑선(baseline=bottom) 기준으로 줄을 묶는다 — 글자 크기가 달라도 같은 줄이면 밑선이 같다. */
  function groupRows(items) {
    const rows = [];
    for (const w of [...items].sort((a, b) => a.bottom - b.bottom || a.x0 - b.x0)) {
      const last = rows[rows.length - 1];
      if (last && Math.abs(w.bottom - last[0].bottom) <= Y_TOL) last.push(w);
      else rows.push([w]);
    }
    return rows.map((r) => r.sort((a, b) => a.x0 - b.x0));
  }

  function toLines(words) {
    return groupRows(words).map((row) => row.map((w) => w.text).join(" "));
  }

  VAT.pdfText = { readPdf, groupRows, toWords, toGlyphs };
})((globalThis.VAT = globalThis.VAT || {}));
