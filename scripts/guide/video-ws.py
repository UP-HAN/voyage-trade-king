"""작업 154 — 설명 영상 v2용 학습지 쪽 그림(①~⑧)과 글자 상자.

원본: print/dist/대항해무역왕_항해일지_학생용.pdf (고치지 않고 읽기만)
결과: tmp/video/ws/W01.png ~ W08.png (200dpi) + tmp/video/ws/ws.json
  쪽마다 {w, h, dpi, page, find:{...}} — 상자는 [x, y, w, h] 그림 px(200dpi 기준), 없으면 null.
  찾는 것: 번호 배지, 활동 제목 줄, "교과서 n쪽", 문항 번호 "1." "2." "3."(줄 시작 위치와 문항 글 상자),
  [내 기록], 항해 퀴즈, 체크!, 이름 칸, 그리고 지금 게임과 안 맞는 글 '★ 지금 써요'·'두 섬'(있으면 warn).
쪽 번호는 고정하지 않는다: 쪽 위쪽의 활동 번호 배지 글자(1~8) + '항해 기록' 줄로 찾는다.
실행(프로젝트 루트): python -I scripts/guide/video-ws.py   (VIDEO_OUT으로 결과 폴더를 바꿀 수 있다)
"""
import json
import os
import re
import sys

import pymupdf

sys.stdout.reconfigure(encoding='utf-8')
ROOT = os.path.abspath(os.path.join(os.path.dirname(__file__), '..', '..'))
PDF = os.path.join(ROOT, 'print', 'dist', '대항해무역왕_항해일지_학생용.pdf')
OUT = os.path.join(os.environ.get('VIDEO_OUT') or os.path.join(ROOT, 'tmp', 'video'), 'ws')
DPI = 200
K = DPI / 72
CIRCLED = '①②③④⑤⑥⑦⑧'


def box(r):
    if r is None:
        return None
    return [round(r.x0 * K, 1), round(r.y0 * K, 1), round((r.x1 - r.x0) * K, 1), round((r.y1 - r.y0) * K, 1)]


def union(rects):
    rects = [r for r in rects if r is not None]
    if not rects:
        return None
    u = pymupdf.Rect(rects[0])
    for r in rects[1:]:
        u |= r
    return u


def lines_of(page):
    """보이는 줄 목록: (텍스트, Rect, 조각들). 이 PDF는 글자마다 span이 따로라서 높이(y 가운데)로 줄을 묶고,
    줄 안에서 같은 글자 크기로 붙어 있는 글자들을 '조각'(텍스트, Rect, 크기)으로 묶는다."""
    spans = []
    for b in page.get_text('dict')['blocks']:
        for ln in b.get('lines', []):
            for s in ln['spans']:
                if s['text'] == '':
                    continue
                r = pymupdf.Rect(s['bbox'])
                spans.append((s['text'], r, round(s['size'], 1)))
    rows = []
    for sp in sorted(spans, key=lambda x: ((x[1].y0 + x[1].y1) / 2, x[1].x0)):
        yc = (sp[1].y0 + sp[1].y1) / 2
        for row in rows:
            if abs(row['yc'] - yc) < 3:
                row['spans'].append(sp)
                break
        else:
            rows.append({'yc': yc, 'spans': [sp]})
    out = []
    for row in rows:
        ss = sorted(row['spans'], key=lambda x: x[1].x0)
        segs = []
        for sp in ss:
            if segs and segs[-1][2] == sp[2] and sp[1].x0 - segs[-1][1].x1 < sp[2] * 0.9 and not re.fullmatch(r'[1-9]\.', segs[-1][0].strip()):
                t, r, z = segs[-1]
                segs[-1] = (t + sp[0], r | sp[1], z)
            else:
                segs.append((sp[0], pymupdf.Rect(sp[1]), sp[2]))
        segs = [(t.strip(), r, z) for t, r, z in segs if t.strip()]
        if segs:
            out.append((' '.join(x[0] for x in segs), union([x[1] for x in segs]), segs))
    return out


def find_page(doc, n):
    """활동 번호 배지 n(큰 글자)과 '항해 기록' 조각이 같은 줄에 있는 쪽"""
    for i, p in enumerate(doc):
        for text, r, segs in lines_of(p):
            hs = [s for s in segs if s[0].startswith('항해 기록')]
            if not hs:
                continue
            badge = [s for s in segs if s[0] == str(n) and s[2] >= 16 and s[1].x1 <= hs[0][1].x0 + 2]
            if badge:
                return i, badge[0][1], (text, r, segs), hs[0]
    return None


def first(page, needle):
    r = page.search_for(needle)
    return r[0] if r else None


def all_boxes(page, needle):
    return [box(r) for r in page.search_for(needle)]


def main():
    os.makedirs(OUT, exist_ok=True)
    doc = pymupdf.open(PDF)
    res = {'source': os.path.relpath(PDF, ROOT).replace('\\', '/'), 'dpi': DPI, 'unit': 'px at 200dpi (PDF pt × 200/72)', 'pages': {}, 'warn': []}
    for n in range(1, 9):
        wid = f'W0{n}'
        hit = find_page(doc, n)
        if not hit:
            res['warn'].append(f'{wid}: 쪽을 못 찾음')
            print(wid, '쪽을 못 찾음')
            continue
        pno, badge, (row_text, row_rect, row_segs), head = hit
        p = doc[pno]
        pix = p.get_pixmap(dpi=DPI)
        pix.save(os.path.join(OUT, f'{wid}.png'))
        ls = lines_of(p)
        # 활동 제목: '항해 기록' 오른쪽의 큰 글자 조각
        tsegs = [x for x in row_segs if x[1].x0 >= head[1].x1 - 1 and x[2] >= 13 and not x[0].startswith('교과서')]
        title_box = union([x[1] for x in tsegs])
        title = ' '.join(x[0] for x in tsegs)
        if head[0] != '항해 기록':  # '항해 기록'과 제목이 한 조각으로 붙은 경우
            title = title or head[0].replace('항해 기록', '').strip()
        # 교과서 n쪽(머리 줄)
        tbs = [x for x in row_segs if re.fullmatch(r'교과서 ?[\d~, 쪽]+쪽', x[0])]
        tb = tbs[0][1] if tbs else None
        tb_text = tbs[0][0] if tbs else None
        # 문항 번호 "1." "2." "3." — 줄 시작 위치 + 같은 줄 오른쪽 글(문항 글)
        qs = []
        for text, r, segs in ls:
            for k, x in enumerate(segs):
                if re.fullmatch(r'[1-9]\.', x[0]):
                    rest = [y for y in segs[k + 1:]]
                    tbox = union([y[1] for y in rest])
                    qs.append({'no': x[0], 'num': box(x[1]), 'lineStart': [round(x[1].x0 * K, 1), round(x[1].y0 * K, 1)], 'text': box(tbox),
                               'textStr': ' '.join(y[0] for y in rest)[:80] or None})
        qs.sort(key=lambda q: (q['num'][1], q['num'][0]))
        # 문항 번호는 쪽 왼쪽 여백 줄에 있는 것만(표 안의 '1. 혼자 살 때' 같은 단계 번호는 뺀다)
        if qs:
            x0 = min(q['num'][0] for q in qs)
            qs = [q for q in qs if q['num'][0] - x0 < 30]
        # 이름 칸(첫 쪽: 6학년 반 번이름 + 우리 회사 이름 / 다른 쪽: '이름')
        name_parts = [first(p, w) for w in ('6학년', '번이름', '우리 회사 이름')]
        if all(name_parts):
            name_box = box(union(name_parts))
            name_kind = 'student-info'
        else:
            nm = None
            for text, r, segs in ls:
                for x in segs:
                    if x[0] == '이름':
                        nm = x[1]
            name_box = box(nm)
            name_kind = 'name' if nm else None
        star = all_boxes(p, '★ 지금 써요') or all_boxes(p, '지금 써요')
        isl = all_boxes(p, '두 섬')
        find = {
            'badge': box(badge),
            'badgeText': CIRCLED[n - 1],
            'title': box(title_box),
            'titleText': title,
            'textbook': box(tb),
            'textbookText': tb_text,
            'questions': qs,
            'myRecord': all_boxes(p, '[내 기록]') or None,
            'quiz': box(first(p, '항해 퀴즈')),
            'check': box(first(p, '체크!')),
            'name': name_box,
            'nameKind': name_kind,
            'starNow': star or None,
            'twoIslands': isl or None,
        }
        res['pages'][wid] = {'w': pix.width, 'h': pix.height, 'dpi': DPI, 'page': pno + 1, 'file': f'{wid}.png', 'find': find}
        if star:
            res['warn'].append(f"{wid}({pno + 1}쪽): '★ 지금 써요' 글자 있음 {len(star)}곳 — 지금 게임(차시 한 판)과 안 맞음")
        if isl:
            res['warn'].append(f"{wid}({pno + 1}쪽): '두 섬' 글자 있음 {len(isl)}곳 — 지금 게임 제목은 '㉮ 나라와 ㉯ 나라 이야기'")
        print(wid, f'{pno + 1}쪽', title, f'{pix.width}x{pix.height}', '문항', [q['no'] for q in qs], '★' if star else '', '두섬' if isl else '')
    with open(os.path.join(OUT, 'ws.json'), 'w', encoding='utf-8') as f:
        json.dump(res, f, ensure_ascii=False, indent=1)
    for w in res['warn']:
        print('경고:', w)


if __name__ == '__main__':
    main()
