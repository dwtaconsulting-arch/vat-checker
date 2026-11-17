"""PDF 개인정보 마스킹 사본 생성 (원본은 읽기만 한다).

원본 위에 검은 사각형을 덧그리지 않는다. pdfplumber로 글자 좌표와 표 괘선만 읽어
reportlab으로 PDF를 새로 그리므로, 가린 글자는 사본에 아예 존재하지 않는다.

사용:
    python -I tools/pii/mask_pii.py 원본.pdf -o 출력.pdf --terms 용어파일.txt

용어파일 형식 (원본과 같은 비공개 폴더에 둔다):
    # 주석
    ○○상사              ← 가릴 상호·성명·주소 구성요소 (한 줄에 하나, 공백 무시)
    @region 8-8 135 172 360   ← 쪽범위 x0 x1 top_min : 이 영역의 한글 글자는 모두 가림
"""
from __future__ import annotations

import argparse
import collections
import math
import re
import sys
from pathlib import Path

import pdfplumber
from reportlab.pdfbase import pdfmetrics
from reportlab.pdfbase.ttfonts import TTFont
from reportlab.pdfgen import canvas

FONT_DIR = Path("C:/Windows/Fonts")
FONTS = [("Malgun", "malgun.ttf"), ("SegoeSym", "seguisym.ttf")]

PATTERNS = [  # (태그, 정규식) — 단어 단위 검색, 걸리면 단어 전체를 가림
    ("등록번호", re.compile(r"\d{6}-\d{7}")),
    ("카드번호", re.compile(r"\d{4}-\d{4}-\d{4}-\d{4}")),
    ("사업자번호", re.compile(r"\d{3}-\d{2}-\d{5}")),
    ("전화번호", re.compile(r"0\d{1,2}-\d{3,4}-\d{4}")),
    ("이메일", re.compile(r"[\w.+-]+@[\w-]+\.[\w.]+")),
    ("관리번호", re.compile(r"^[A-Z]{1,2}-?\d{4,6}$")),
    ("생년월일", re.compile(r"^19\d{6}$")),
]
_STRIP = re.compile(r"[\s,()\[\]·.:;]")
_HANGUL = re.compile(r"[가-힣]")


def norm(s: str) -> str:
    return _STRIP.sub("", s)


def load_terms(path: Path):
    terms, regions = [], []
    for raw in path.read_text(encoding="utf-8").splitlines():
        line = raw.strip()
        if not line or line.startswith("#"):
            continue
        if line.startswith("@region"):
            _, pages, x0, x1, top = line.split()
            a, _, b = pages.partition("-")
            regions.append((int(a), int(b or a), float(x0), float(x1), float(top)))
        else:
            terms.append(norm(line))
    return terms, regions


def term_hit(word: str, terms: list[str]) -> bool:
    w = norm(word)
    if len(w) < 2 or w.isdigit():
        return False
    return any(w in t or (len(t) >= 3 and t in w) for t in terms)


class Fonts:
    def __init__(self) -> None:
        self.faces = []
        for name, file in FONTS:
            p = FONT_DIR / file
            if p.exists():
                f = TTFont(name, str(p))
                pdfmetrics.registerFont(f)
                self.faces.append((name, f.face.charToGlyph))
        if not self.faces:
            sys.exit("한글 글꼴(malgun.ttf)을 찾을 수 없습니다")
        self.main = self.faces[0][0]

    def pick(self, ch: str) -> str | None:
        for name, cmap in self.faces:
            if ord(ch) in cmap:
                return name
        return None


def stroke_color(c, color) -> None:
    if not color:
        c.setStrokeGray(0)
    elif len(color) == 1:
        c.setStrokeGray(color[0])
    elif len(color) == 3:
        c.setStrokeColorRGB(*color)
    elif len(color) == 4:
        c.setStrokeColorCMYK(*color)
    else:
        c.setStrokeGray(0)


def draw_tag(c, fonts, tag, x0, x1, baseline, size):
    label = f"[{tag}]"
    natural = pdfmetrics.stringWidth(label, fonts.main, size)
    width = max(x1 - x0, 1)
    c.saveState()
    c.setFillGray(0.4)
    c.setFont(fonts.main, size)
    c.translate(x0, baseline)
    if natural > width:
        c.scale(width / natural, 1)
    c.drawString(0, 0, label)
    c.restoreState()


def mask_pdf(src: Path, out: Path, terms, regions):
    fonts = Fonts()
    stats = collections.Counter()
    term_words = collections.Counter()
    missing = collections.Counter()
    c = canvas.Canvas(str(out), pageCompression=1)
    c.setAuthor("")
    c.setTitle("")
    c.setCreator("")
    c.setProducer("")
    with pdfplumber.open(src) as pdf:
        for pno, page in enumerate(pdf.pages, 1):
            if page.rotation:
                sys.exit(f"{pno}쪽이 회전되어 있습니다({page.rotation}) — 처리 규칙 추가 필요")
            W, H = float(page.width), float(page.height)
            c.setPageSize((W, H))

            for ln in page.lines:
                stroke_color(c, ln.get("stroking_color"))
                c.setLineWidth(ln.get("linewidth") or 0.5)
                pts = ln["pts"]
                for (xa, ya), (xb, yb) in zip(pts, pts[1:]):
                    c.line(xa, H - ya, xb, H - yb)

            masked_ids: set[int] = set()
            # 1) 영역 규칙: 지정 칸의 한글 글자 전부
            for a, b, x0, x1, top in regions:
                if not (a <= pno <= b):
                    continue
                hits = [ch for ch in page.chars
                        if _HANGUL.fullmatch(ch["text"]) and x0 <= ch["x0"] < x1 and ch["top"] >= top]
                for ch in hits:
                    masked_ids.add(id(ch))
                for group in _cluster_rows(hits):
                    gx0 = min(ch["x0"] for ch in group)
                    gx1 = max(ch["x1"] for ch in group)
                    base = max(ch["matrix"][5] for ch in group)
                    draw_tag(c, fonts, "발급자", gx0, gx1, base, group[0]["size"])
                    stats["발급자(영역)"] += 1

            # 2) 단어 규칙: 패턴 + 용어
            for w in page.extract_words(return_chars=True):
                chars = [ch for ch in w["chars"] if id(ch) not in masked_ids]
                if not chars:
                    continue
                tag = next((t for t, rx in PATTERNS if rx.search(w["text"])), None)
                if tag is None and term_hit(w["text"], terms):
                    tag = "인적사항"
                    term_words[w["text"]] += 1
                if tag is None:
                    continue
                for ch in chars:
                    masked_ids.add(id(ch))
                draw_tag(c, fonts, tag, chars[0]["x0"], chars[-1]["x1"],
                         chars[0]["matrix"][5], chars[0]["size"])
                stats[tag] += 1

            # 3) 남은 글자 다시 그리기
            for ch in page.chars:
                if id(ch) in masked_ids or not ch["text"].strip():
                    continue
                text = ch["text"]
                font = fonts.pick(text)
                if font is None:
                    missing[text] += 1
                    font, text = fonts.main, "?"
                a, b, _, _, e, f = ch["matrix"]
                size = ch["size"]
                natural = pdfmetrics.stringWidth(text, font, size) or 1
                adv = ch["x1"] - ch["x0"] if ch["upright"] else ch["bottom"] - ch["top"]
                c.saveState()
                c.setFillGray(0)
                c.translate(e, f)  # 원본 글자의 기준점(baseline 시작)
                angle = math.degrees(math.atan2(b, a))
                if abs(angle) > 0.5:
                    c.rotate(angle)
                c.scale(min(max(adv / natural, 0.2), 3.0), 1)  # 원본 글자 폭에 맞춤
                c.setFont(font, size)
                c.drawString(0, 0, text)
                c.restoreState()
            c.showPage()
    c.save()
    return stats, term_words, missing


def _cluster_rows(chars, gap=8.0):
    groups: list[list] = []
    for ch in sorted(chars, key=lambda x: x["top"]):
        if groups and ch["top"] - groups[-1][-1]["top"] <= gap:
            groups[-1].append(ch)
        else:
            groups.append([ch])
    return groups


def write_text(pdf_path: Path, txt_path: Path) -> None:
    with pdfplumber.open(pdf_path) as pdf:
        parts = [f"=== {i} 쪽 ===\n{p.extract_text() or ''}" for i, p in enumerate(pdf.pages, 1)]
    txt_path.write_text("\n\n".join(parts), encoding="utf-8")


def main() -> None:
    ap = argparse.ArgumentParser()
    ap.add_argument("src", type=Path)
    ap.add_argument("-o", "--out", type=Path, required=True)
    ap.add_argument("--terms", type=Path, required=True)
    ap.add_argument("--show-term-words", action="store_true", help="용어로 가린 단어 목록 출력(로컬 점검용)")
    args = ap.parse_args()
    if args.out.resolve() == args.src.resolve():
        sys.exit("출력 파일이 원본과 같습니다 — 원본은 덮어쓰지 않습니다")
    terms, regions = load_terms(args.terms)
    args.out.parent.mkdir(parents=True, exist_ok=True)
    stats, term_words, missing = mask_pdf(args.src, args.out, terms, regions)
    write_text(args.out, args.out.with_suffix(".txt").with_name(args.out.stem + ".txt"))
    print("가린 항목:", dict(stats))
    if missing:
        print("글꼴에 없어 ?로 그린 글자:", dict(missing))
    if args.show_term_words:
        print("용어 규칙으로 가린 단어:", dict(term_words))


if __name__ == "__main__":
    main()
