"""마스킹 사본 잔여 개인정보 검사.

검사 범위: 추출 텍스트 + 압축 해제한 내부 스트림 + 문서 정보/XMP 메타데이터 + 주석.
원본 대조(--terms): 용어파일의 값이 사본에 남아 있는지 센다 (값 자체는 출력하지 않음).
--control: 같은 검사를 원본에도 돌려 검사기가 실제로 잡는지 확인한다.

종료코드: 사본 잔여 0건이면 0, 아니면 1.
"""
from __future__ import annotations

import argparse
import collections
import re
import sys
from pathlib import Path

import pdfplumber
import pikepdf

sys.path.insert(0, str(Path(__file__).resolve().parent))
from mask_pii import load_terms, norm  # noqa: E402

CHECKS = {
    "주민·법인등록번호": re.compile(r"\d{6}\s?-\s?[1-4]\d{6}|\d{6}-\d{7}"),
    "여권번호": re.compile(r"\b[MSRODG]\d{8}\b|\b[MSRODG]\d{3}[A-Z]\d{4}\b"),
    "사업자번호": re.compile(r"\d{3}-\d{2}-\d{5}"),
    "카드번호": re.compile(r"\d{4}-\d{4}-\d{4}-\d{4}"),
    "계좌번호": re.compile(r"\b\d{3,6}-\d{2,6}-\d{2,6}(-\d{1,6})?\b"),
    "전화번호": re.compile(r"0\d{1,2}-\d{3,4}-\d{4}"),
    "이메일": re.compile(r"[\w.+-]+@[\w-]+\.[a-zA-Z]{2,}"),
    "확인·관리번호형": re.compile(r"\b[A-Z]{1,2}-?\d{4,6}\b"),
    "주소형": re.compile(r"[가-힣]{2,}(특별시|광역시|특별자치시|도)\s?[가-힣]{1,4}(시|군|구)|[가-힣0-9]{1,10}(로|길)\s?\d{1,4}(-\d+)?\s?[,(]"),
}
DATE_LIKE = re.compile(r"^\d{4}-\d{2}-\d{2}$")


def collect(pdf_path: Path) -> dict[str, str]:
    out = {}
    with pdfplumber.open(pdf_path) as pdf:
        out["추출텍스트"] = "\n".join(p.extract_text() or "" for p in pdf.pages)
    with pikepdf.open(pdf_path) as pdf:
        streams = []
        for obj in pdf.objects:
            if isinstance(obj, pikepdf.Stream):
                try:
                    streams.append(obj.read_bytes().decode("latin-1"))
                except Exception:
                    pass
        out["내부스트림"] = "\n".join(streams)
        meta = [f"{k}={v}" for k, v in pdf.docinfo.items()]
        try:
            with pdf.open_metadata() as xmp:
                meta += [f"{k}={v}" for k, v in xmp.items()]
        except Exception:
            pass
        out["메타데이터"] = "\n".join(meta)
        annots = []
        for page in pdf.pages:
            for a in page.get("/Annots", []) or []:
                annots.append(str(a.get("/Contents", "")))
        out["주석"] = "\n".join(annots)
    return out


def scan(pdf_path: Path, terms: list[str]) -> collections.Counter:
    found = collections.Counter()
    for where, text in collect(pdf_path).items():
        for name, rx in CHECKS.items():
            n = sum(1 for m in rx.finditer(text) if not DATE_LIKE.match(m.group(0)))
            if n:
                found[f"{where}/{name}"] += n
        if where == "추출텍스트" and terms:
            compact = norm(text)
            for i, t in enumerate(terms, 1):
                n = compact.count(t)
                if n:
                    found[f"원본대조/용어#{i}"] += n
    return found


def main() -> None:
    ap = argparse.ArgumentParser()
    ap.add_argument("masked", type=Path)
    ap.add_argument("--src", type=Path)
    ap.add_argument("--terms", type=Path)
    ap.add_argument("--control", action="store_true")
    args = ap.parse_args()
    terms = load_terms(args.terms)[0] if args.terms else []

    result = scan(args.masked, terms)
    print("[사본] 잔여:", sum(result.values()), "건", dict(result) if result else "")
    if args.control:
        if not args.src:
            sys.exit("--control에는 --src가 필요합니다")
        ctrl = scan(args.src, terms)
        print("[대조군·원본] 검출:", sum(ctrl.values()), "건", dict(ctrl))
        if not ctrl:
            print("⚠ 원본에서도 0건 — 검사기가 헛돌고 있을 수 있습니다. 결과를 믿지 마세요.")
            sys.exit(2)
    sys.exit(0 if not result else 1)


if __name__ == "__main__":
    main()
