/* 화면: PDF 선택 → 읽기 → 해석 → 정합성 검사 → 결과 표 */
(function (VAT) {
  "use strict";
  const { fmt } = VAT.money;
  const S = VAT.checks.Status;
  const LABEL = { OK: "✅ 일치", WARN: "⚠️ 확인필요", ERROR: "❌ 오류", SKIP: "➖ 해당없음" };
  const $ = (id) => document.getElementById(id);

  const el = (tag, attrs = {}, ...children) => {
    const node = document.createElement(tag);
    for (const [k, v] of Object.entries(attrs)) {
      if (k === "class") node.className = v;
      else node.setAttribute(k, v);
    }
    for (const c of children) if (c !== null && c !== undefined) node.append(c);
    return node;
  };

  function setStatus(msg, isError = false) {
    const s = $("status");
    s.hidden = !msg;
    s.textContent = msg || "";
    s.classList.toggle("error", isError);
  }

  // 넣은 파일: 신고서 1개 + 통합조회 1개. 같은 종류를 다시 넣으면 바꿔 끼운다.
  const state = { ret: null, ht: null };

  async function handleFiles(files) {
    files = [...files].filter(Boolean);
    if (!files.length) return;
    const errors = [];
    for (const file of files) {
      if (!/\.pdf$/i.test(file.name) && file.type !== "application/pdf") {
        errors.push(`${file.name}: PDF 파일만 읽을 수 있습니다.`);
        continue;
      }
      setStatus(`읽는 중… ${file.name}`);
      try {
        const pages = await VAT.pdfText.readPdf(new Uint8Array(await file.arrayBuffer()));
        if (!pages.reduce((n, p) => n + p.words.length, 0)) {
          errors.push(`${file.name}: 글자를 찾지 못했습니다. 스캔(이미지) PDF는 읽을 수 없습니다 — 홈택스나 신고 프로그램에서 출력한 PDF를 넣어 주세요.`);
          continue;
        }
        if (VAT.hometax.isHometaxSummary(pages)) {
          state.ht = { name: file.name, h: VAT.hometax.parseHometaxSummary(pages) };
          continue;
        }
        const r = VAT.returnPdf.parseReturn(pages);
        if (!r.foundForms["본표1"]) {
          errors.push(`${file.name}: 신고서 본표도, 홈택스 신고자료 통합조회도 아닙니다.`);
          continue;
        }
        state.ret = { name: file.name, pageCount: pages.length, r };
      } catch (e) {
        console.error(e);
        errors.push(`${file.name}: 읽기 실패 — ${e.message}`);
      }
    }
    if (state.ret) render();
    else if (state.ht) setStatus(`통합조회를 읽었습니다 (${state.ht.name}). 같은 기간의 신고서 PDF도 넣어 주세요.`);
    if (errors.length) setStatus(errors.join("\n"), true);
    else if (state.ret) setStatus("");
  }

  function render() {
    const { name, pageCount, r } = state.ret;
    const results = VAT.checks.checkReturn(r);
    if (state.ht) results.push(...VAT.hometaxCompare.compareHometax(r, state.ht.h));
    $("file-name").textContent = `${name} (${pageCount}쪽)`;
    $("sources").replaceChildren(
      "홈택스 통합조회: ",
      state.ht ? el("b", {}, state.ht.name)
        : el("span", { class: "need" }, "없음 — 통합조회 PDF를 같이 넣으면 홈택스 자료와의 대사가 추가됩니다"));

    const t = (k) => r.tax(k), a = (k) => r.amount(k);
    const cards = [
      ["과세표준 (9)", a(9)],
      ["매출세액 ㉮", t(9)],
      ["매입세액 ㉯", t(18)],
      [t(30) < 0 ? "환급받을 세액 (30)" : "납부할 세액 (30)", t(30)],
    ];
    $("totals").replaceChildren(...cards.map(([k, v]) =>
      el("div", { class: "card" }, el("div", { class: "k" }, k), el("div", { class: `v${v < 0 ? " neg" : ""}` }, `${fmt(v)}원`))));

    const counts = Object.fromEntries(Object.values(S).map((s) => [s, results.filter((x) => x.status === s).length]));
    $("counts").replaceChildren(...[S.OK, S.WARN, S.ERROR, S.SKIP].filter((s) => counts[s])
      .map((s) => el("span", { class: `pill ${s}` }, `${LABEL[s]} ${counts[s]}`)));

    $("forms").textContent = "인식한 서식: " + Object.entries(r.foundForms)
      .map(([k, pages]) => `${k} (${pages.join("·")}쪽)`).join(", ");

    const groups = new Map();
    for (const x of results) {
      if (!groups.has(x.group)) groups.set(x.group, []);
      groups.get(x.group).push(x);
    }
    $("groups").replaceChildren(...[...groups].map(([g, rows]) => renderGroup(g, rows)));
    $("report").hidden = false;
  }

  function renderGroup(title, rows) {
    const issues = rows.filter((x) => x.status === S.WARN || x.status === S.ERROR).length;
    const isHometax = title === VAT.hometaxCompare.GROUP;
    const head = el("tr", {},
      el("th", {}, "결과"), el("th", {}, "항목"),
      el("th", { class: "num exp" }, isHometax ? "홈택스 값" : "산식 계산값"), el("th", { class: "num" }, "신고서 값"), el("th", { class: "num" }, "차이"));
    const body = rows.map((x) => {
      const diffCls = x.diff ? (x.diff < 0 ? "neg" : "pos") : "";
      const showDetail = x.detail && (x.status !== S.OK || x.showDetail || /^1~|나누어떨어짐|참고/.test(x.detail));
      return el("tr", { class: x.status },
        el("td", {}, el("span", { class: `badge ${x.status}` }, LABEL[x.status])),
        el("td", {}, x.name, showDetail ? el("span", { class: "detail" }, x.detail) : null),
        el("td", { class: "num exp" }, fmt(x.expected)),
        el("td", { class: "num" }, fmt(x.actual)),
        el("td", { class: `num diff ${diffCls}` }, x.diff ? (x.diff > 0 ? "+" : "") + fmt(x.diff) : ""));
    });
    return el("section", { class: `group${issues ? "" : " all-ok"}` },
      el("h3", {}, title, el("small", {}, issues ? `확인 ${issues}건` : "모두 일치")),
      el("div", { class: "table-scroll" }, el("table", {},
        el("colgroup", {}, el("col", { class: "c-status" }), el("col"), el("col", { class: "c-num" }),
          el("col", { class: "c-num" }), el("col", { class: "c-diff" })),
        el("thead", {}, head), el("tbody", {}, ...body))));
  }

  // 이벤트
  const drop = $("drop");
  $("file").addEventListener("change", (e) => { handleFiles(e.target.files); e.target.value = ""; });
  drop.addEventListener("keydown", (e) => { if (e.key === "Enter" || e.key === " ") { e.preventDefault(); $("file").click(); } });
  for (const ev of ["dragenter", "dragover"]) drop.addEventListener(ev, (e) => { e.preventDefault(); drop.classList.add("over"); });
  for (const ev of ["dragleave", "drop"]) drop.addEventListener(ev, () => drop.classList.remove("over"));
  drop.addEventListener("drop", (e) => { e.preventDefault(); handleFiles(e.dataTransfer.files); });
  window.addEventListener("dragover", (e) => e.preventDefault());
  window.addEventListener("drop", (e) => e.preventDefault());
  $("only-issues").addEventListener("change", (e) => $("groups").classList.toggle("hide-ok", e.target.checked));
  $("print").addEventListener("click", () => window.print());

  // 개발용 미리보기: index.html?file=상대경로&file=상대경로 (헤드리스 브라우저 화면 확인용, 일반 실행에서는 브라우저가 막음)
  const previews = new URLSearchParams(location.search).getAll("file");
  if (previews.length) {
    Promise.all(previews.map((p) => fetch(p).then((res) => res.blob())
      .then((b) => new File([b], p.split("/").pop(), { type: "application/pdf" }))))
      .then(handleFiles)
      .catch((e) => setStatus(`미리보기 파일을 열 수 없습니다: ${e.message}`, true));
  }

  if (!globalThis.pdfjsLib) setStatus("PDF 읽기 도구(js/vendor/pdf.min.js)를 불러오지 못했습니다. 폴더 구성을 확인해 주세요.", true);
})(globalThis.VAT);
