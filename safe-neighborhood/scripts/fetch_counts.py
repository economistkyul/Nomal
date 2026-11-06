#!/usr/bin/env python3
"""공공데이터포털 '성범죄자 신상정보 공개고지 관리 주요시도상태 정보'(지역별 등록 개수)를
data/counts.json 으로 저장한다.

개인정보 보호 원칙:
  - 저장하는 필드는 시도·시군구·읍면동·개수 4개뿐이다(허용목록 방식).
  - 원본 응답에 성명·주소·사진 등 다른 항목이 있어도 버리고, 개인 단위로 보이는 응답이면 중단한다.

사용 예:
  export DATA_GO_KR_KEY="인증키(Decoding)"
  export SEXOFFENDER_API_URL="https://apis.data.go.kr/...(상세화면의 요청주소)"
  python3 scripts/fetch_counts.py --basis-date 2026-11-01
  python3 scripts/fetch_counts.py --csv 내려받은파일.csv
표준 라이브러리만 사용한다(Python 3.8+).
"""
import argparse
import csv
import io
import json
import os
import re
import sys
import urllib.parse
import urllib.request
from datetime import datetime, timezone
from pathlib import Path

HERE = Path(__file__).resolve().parent
OUT = HERE.parent / "data" / "counts.json"
SOURCE = "성평등가족부 「성범죄자 신상정보 공개고지 관리 주요시도상태 정보」(공공데이터포털)"

# 필드 자동 인식용 후보 (대소문자 무시). --map 으로 덮어쓸 수 있다.
CANDIDATES = {
    "sido": [r"^시도", r"시[·.]?도명?$", r"^(sido|ctpv|ctprvn)", r"sido", r"ctpv"],
    "sgg": [r"시군구|구군", r"^(sgg|signgu|gugun|sigungu)", r"sgg|signgu|gugun"],
    "emd": [r"읍면동", r"^(emd|dong|umd)", r"emd|dong"],
    "count": [r"개수|인원|건수|등록수", r"(cnt|count|num)$", r"cnt|count"],
}
# 이런 이름의 필드가 보이면 개인 단위 데이터로 간주하고 중단
PERSONAL = re.compile(r"성명|이름|사진|생년|나이|몸무게|신장|죄명|형량|실제거주지|도로명|건물번호|"
                      r"^name$|^age$|photo|birth|height|weight|crime|sentence|road|bldg", re.I)


def find_field(keys, kind, override):
    if override.get(kind):
        return override[kind] if override[kind] in keys else None
    for pat in CANDIDATES[kind]:
        for k in keys:
            if re.search(pat, k, re.I):
                return k
    return None


def to_rows(records, override):
    if not records:
        return []
    keys = list({k for r in records for k in r.keys()})
    fields = {kind: find_field(keys, kind, override) for kind in CANDIDATES}
    if not fields["sido"] or not fields["count"]:
        sys.exit(f"[중단] 시도/개수 필드를 찾지 못했습니다. 응답 필드: {sorted(keys)}\n"
                 f"       --map sido=필드명,sgg=필드명,emd=필드명,count=필드명 으로 지정하세요.")
    used = {v for v in fields.values() if v}
    risky = [k for k in keys if k not in used and PERSONAL.search(k)]
    if risky:
        sys.exit(f"[중단] 개인 단위 항목으로 보이는 필드가 있습니다: {risky}\n"
                 f"       이 도구는 지역별 집계 데이터만 다룹니다. 다른 데이터셋인지 확인하세요.")
    print(f"필드 매핑: {fields}", file=sys.stderr)
    out = []
    for r in records:
        try:
            cnt = int(float(str(r.get(fields["count"], "")).replace(",", "").strip()))
        except ValueError:
            continue
        sido = str(r.get(fields["sido"], "") or "").strip()
        if not sido or sido in ("전국", "합계", "계"):
            continue
        out.append({
            "sido": sido,
            "sgg": str(r.get(fields["sgg"], "") or "").strip() if fields["sgg"] else "",
            "emd": str(r.get(fields["emd"], "") or "").strip() if fields["emd"] else "",
            "count": cnt,
        })
    return dedupe_levels(out)


def dedupe_levels(rows):
    """시도 합계·시군구 합계 행과 읍면동 행이 함께 오면 가장 세부 단위만 남긴다(이중 집계 방지)."""
    has_emd = {(r["sido"], r["sgg"]) for r in rows if r["emd"]}
    has_sgg = {r["sido"] for r in rows if r["sgg"]}
    kept = []
    for r in rows:
        if not r["emd"] and r["sgg"] and (r["sido"], r["sgg"]) in has_emd:
            continue
        if not r["sgg"] and r["sido"] in has_sgg:
            continue
        kept.append(r)
    return kept


def extract_items(payload):
    """data.go.kr 의 다양한 JSON 응답 형태에서 레코드 목록과 전체 건수를 꺼낸다."""
    total = None
    node = payload
    for key in ("response", "body"):
        if isinstance(node, dict) and key in node:
            node = node[key]
    if isinstance(node, dict):
        total = node.get("totalCount") or node.get("matchCount")
        for key in ("items", "item", "data", "list"):
            if key in node:
                node = node[key]
                if isinstance(node, dict) and "item" in node:
                    node = node["item"]
                break
    if isinstance(node, dict):
        node = [node]
    if not isinstance(node, list):
        node = []
    return node, (int(total) if total not in (None, "") else None)


def fetch_api(url, key, rows_per_page, extra):
    records, page = [], 1
    while True:
        params = {"serviceKey": key, "pageNo": page, "numOfRows": rows_per_page, "type": "json", "_type": "json"}
        params.update(extra)
        full = url + ("&" if "?" in url else "?") + urllib.parse.urlencode(params)
        req = urllib.request.Request(full, headers={"Accept": "application/json", "User-Agent": "safe-neighborhood/1.0"})
        with urllib.request.urlopen(req, timeout=30) as resp:
            body = resp.read().decode("utf-8", "replace")
        try:
            payload = json.loads(body)
        except json.JSONDecodeError:
            sys.exit(f"[중단] JSON 응답이 아닙니다(인증키·요청주소 확인). 응답 앞부분:\n{body[:300]}")
        items, total = extract_items(payload)
        records.extend(items)
        print(f"  {page}쪽: {len(items)}건 (누계 {len(records)}{'/' + str(total) if total else ''})", file=sys.stderr)
        if not items or len(items) < rows_per_page or (total and len(records) >= total) or page >= 500:
            break
        page += 1
    return records


def read_csv(path):
    raw = Path(path).read_bytes()
    for enc in ("utf-8-sig", "cp949"):
        try:
            text = raw.decode(enc)
            break
        except UnicodeDecodeError:
            continue
    return list(csv.DictReader(io.StringIO(text)))


def main():
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("--csv", help="API 대신 내려받은 CSV 파일을 변환")
    ap.add_argument("--url", default=os.environ.get("SEXOFFENDER_API_URL"), help="API 요청주소(환경변수 SEXOFFENDER_API_URL)")
    ap.add_argument("--key", default=os.environ.get("DATA_GO_KR_KEY"), help="인증키(환경변수 DATA_GO_KR_KEY)")
    ap.add_argument("--rows", type=int, default=1000, help="쪽당 건수")
    ap.add_argument("--param", action="append", default=[], help="추가 요청변수 k=v (여러 번 가능)")
    ap.add_argument("--map", default="", help="필드 지정: sido=..,sgg=..,emd=..,count=..")
    ap.add_argument("--basis-date", help="자료 기준일(YYYY-MM-DD)")
    ap.add_argument("--out", default=str(OUT))
    a = ap.parse_args()

    override = dict(p.split("=", 1) for p in a.map.split(",") if "=" in p)
    if a.csv:
        records = read_csv(a.csv)
    else:
        if not a.url or not a.key:
            sys.exit("[중단] --url/--key 또는 환경변수 SEXOFFENDER_API_URL, DATA_GO_KR_KEY 가 필요합니다.")
        extra = dict(p.split("=", 1) for p in a.param if "=" in p)
        records = fetch_api(a.url, a.key, a.rows, extra)

    rows = to_rows(records, override)
    if not rows:
        sys.exit("[중단] 변환된 행이 없습니다.")
    data = {
        "meta": {
            "sample": False,
            "source": SOURCE,
            "basis_date": a.basis_date,
            "fetched_at": datetime.now(timezone.utc).astimezone().strftime("%Y-%m-%d %H:%M"),
        },
        "rows": sorted(rows, key=lambda r: (r["sido"], r["sgg"], r["emd"])),
    }
    out = Path(a.out)
    out.parent.mkdir(parents=True, exist_ok=True)
    out.write_text(json.dumps(data, ensure_ascii=False, indent=1), encoding="utf-8")
    print(f"저장: {out} ({len(rows)}개 지역, 합계 {sum(r['count'] for r in rows)}명)", file=sys.stderr)


if __name__ == "__main__":
    main()
