// 학습지 공통 스크립트 (작업 139): 아이콘 모음, 쪽 틀(머리띠·학생 정보·꼬리말), 쓰기 줄, 남는 공간 채우기, 교사용 쪽 나누기.
// 인쇄 전 브라우저(Playwright chromium)에서 실행된다. 문항 문구는 HTML에 그대로 있다.
(function () {
  const S = 'stroke="#23364d" stroke-width="2.2" stroke-linejoin="round" stroke-linecap="round"';
  const sprite = `
<svg xmlns="http://www.w3.org/2000/svg" style="position:absolute;width:0;height:0" aria-hidden="true">
  <!-- ① 시장 가판대 -->
  <symbol id="i-market" viewBox="0 0 48 48">
    <rect x="9" y="22" width="30" height="18" rx="1.5" fill="#f6e3b8" ${S}/>
    <path d="M6 22 L10 10 H38 L42 22 Z" fill="#e98a6a" ${S}/>
    <path d="M16 10 L14 22 M24 10 V22 M32 10 L34 22" ${S} fill="none"/>
    <rect x="14" y="28" width="8" height="12" fill="#fff" ${S}/>
    <circle cx="31" cy="31" r="3.2" fill="#7fb6d6" ${S}/>
  </symbol>
  <!-- ② 비행기 -->
  <symbol id="i-plane" viewBox="0 0 48 48">
    <path d="M6 27 L42 13 Q46 12 44 16 L24 30 L22 41 L18 41 L18 32 L9 35 L7 32 Z" fill="#cfe4f2" ${S}/>
    <path d="M14 22 L22 26" ${S} fill="none"/>
    <circle cx="38" cy="36" r="5" fill="#f3c65d" ${S}/>
    <path d="M38 33 V36.5 M38 38.6 V38.8" ${S} fill="none"/>
  </symbol>
  <!-- ③ 두 섬 -->
  <symbol id="i-islands" viewBox="0 0 48 48">
    <path d="M3 32 Q9 22 17 32 Z" fill="#9fcf7a" ${S}/>
    <path d="M25 32 Q34 18 45 32 Z" fill="#e7c27a" ${S}/>
    <path d="M10 27 V17 M10 17 Q6 15 4 17 M10 17 Q14 14 16 17" ${S} fill="none"/>
    <path d="M4 38 Q8 35 12 38 T20 38 T28 38 T36 38 T44 38" ${S} fill="none" stroke="#5ea6cb"/>
    <path d="M18 12 Q24 7 30 12 M27 9 L30 12 L27 14" ${S} fill="none"/>
  </symbol>
  <!-- ④ 연필(흑연) -->
  <symbol id="i-pencil" viewBox="0 0 48 48">
    <path d="M10 38 L13 29 L33 9 L39 15 L19 35 Z" fill="#f3c65d" ${S}/>
    <path d="M10 38 L13 29 L19 35 Z" fill="#f6e3b8" ${S}/>
    <path d="M10 38 L11.3 34.3 L13.7 36.7 Z" fill="#555" ${S}/>
    <path d="M29 13 L35 19" ${S} fill="none"/>
  </symbol>
  <!-- ⑤ 게시판 -->
  <symbol id="i-board" viewBox="0 0 48 48">
    <rect x="9" y="8" width="30" height="34" rx="2" fill="#fff" ${S}/>
    <rect x="17" y="5" width="14" height="6" rx="1.5" fill="#7fb6d6" ${S}/>
    <path d="M15 19 H33 M15 26 H33 M15 33 H27" ${S} fill="none"/>
  </symbol>
  <!-- ⑥ 공장 -->
  <symbol id="i-factory" viewBox="0 0 48 48">
    <path d="M5 40 V24 L15 18 V24 L25 18 V24 L35 18 V40 Z" fill="#cfe4f2" ${S}/>
    <rect x="36" y="9" width="6" height="31" fill="#e98a6a" ${S}/>
    <path d="M3 40 H45" ${S}/>
    <rect x="10" y="30" width="5" height="5" fill="#fff" ${S}/><rect x="20" y="30" width="5" height="5" fill="#fff" ${S}/>
    <path d="M39 6 Q41 3 44 4" ${S} fill="none"/>
  </symbol>
  <!-- ⑦ 지구본 -->
  <symbol id="i-globe" viewBox="0 0 48 48">
    <circle cx="24" cy="22" r="15" fill="#cfe4f2" ${S}/>
    <path d="M14 15 Q20 18 18 24 Q22 28 20 33 M29 9 Q27 15 32 17 Q37 18 36 25" ${S} fill="#9fcf7a"/>
    <path d="M24 37 V43 M17 43 H31" ${S} fill="none"/>
  </symbol>
  <!-- ⑧ 닻(항구) -->
  <symbol id="i-anchor" viewBox="0 0 48 48">
    <circle cx="24" cy="9" r="4" fill="#fff" ${S}/>
    <path d="M24 13 V41 M16 20 H32" ${S} fill="none"/>
    <path d="M9 28 Q11 41 24 41 Q37 41 39 28" ${S} fill="none"/>
    <path d="M6 31 L9 27 L13 30 M42 31 L39 27 L35 30" ${S} fill="none"/>
  </symbol>
  <!-- ⑨ 악수(협력) -->
  <symbol id="i-hands" viewBox="0 0 48 48">
    <path d="M4 18 L12 14 L22 20 L30 16 L44 20 L44 30 L36 34 L24 40 L18 36 L8 30 L4 30 Z" fill="#f6e3b8" ${S}/>
    <path d="M22 20 L16 26 Q19 29 24 25 L30 23 L38 30 M20 30 L26 34 M17 33 L22 37" ${S} fill="none"/>
  </symbol>
  <!-- ⑩ 스마트폰 -->
  <symbol id="i-phone" viewBox="0 0 48 48">
    <rect x="14" y="5" width="20" height="38" rx="3.5" fill="#cfe4f2" ${S}/>
    <rect x="17" y="10" width="14" height="24" rx="1" fill="#fff" ${S}/>
    <circle cx="24" cy="38.5" r="1.6" fill="#23364d"/>
    <path d="M20 16 H28 M20 21 H28 M20 26 H25" ${S} fill="none" stroke-width="1.6"/>
  </symbol>
  <!-- ⑪ 트로피(경쟁) -->
  <symbol id="i-trophy" viewBox="0 0 48 48">
    <path d="M15 7 H33 V17 Q33 28 24 28 Q15 28 15 17 Z" fill="#f3c65d" ${S}/>
    <path d="M15 11 H8 Q8 21 16 21 M33 11 H40 Q40 21 32 21" ${S} fill="none"/>
    <path d="M24 28 V35" ${S}/>
    <rect x="15" y="35" width="18" height="6" rx="1" fill="#e98a6a" ${S}/>
  </symbol>
  <!-- ⑫ 오르는 막대 -->
  <symbol id="i-chart" viewBox="0 0 48 48">
    <rect x="8" y="30" width="7" height="11" fill="#cfe4f2" ${S}/>
    <rect x="20" y="23" width="7" height="18" fill="#9fcf7a" ${S}/>
    <rect x="32" y="15" width="7" height="26" fill="#f3c65d" ${S}/>
    <path d="M6 24 L16 16 L24 19 L38 7 M32 7 H38 V13" ${S} fill="none"/>
  </symbol>
  <!-- ⑬ 투표함 -->
  <symbol id="i-ballot" viewBox="0 0 48 48">
    <rect x="8" y="22" width="32" height="20" rx="1.5" fill="#cfe4f2" ${S}/>
    <path d="M8 22 L12 16 H36 L40 22" ${S} fill="#fff"/>
    <path d="M18 19 H30" ${S} stroke-width="3"/>
    <rect x="19" y="5" width="12" height="14" fill="#fff" ${S} transform="rotate(8 25 12)"/>
    <path d="M22 11 L24.5 13.5 L28.5 8.5" ${S} fill="none"/>
  </symbol>
  <!-- ⑭ 공장과 잎 -->
  <symbol id="i-ecofactory" viewBox="0 0 48 48">
    <path d="M4 41 V25 L14 19 V25 L24 19 V41 Z" fill="#f6e3b8" ${S}/>
    <path d="M2 41 H46" ${S}/>
    <path d="M30 41 Q26 26 42 22 Q44 38 30 41 Z" fill="#9fcf7a" ${S}/>
    <path d="M31 39 Q34 31 39 27" ${S} fill="none"/>
    <rect x="8" y="31" width="5" height="5" fill="#fff" ${S}/>
  </symbol>
  <!-- ⑮ 도장(관세사) -->
  <symbol id="i-stamp" viewBox="0 0 48 48">
    <rect x="6" y="30" width="36" height="12" rx="1.5" fill="#fff" ${S}/>
    <path d="M18 24 H30 L32 30 H16 Z" fill="#e98a6a" ${S}/>
    <path d="M21 24 V15 M27 24 V15" ${S}/>
    <circle cx="24" cy="11" r="5.5" fill="#e98a6a" ${S}/>
    <path d="M12 36 H36" ${S} stroke-width="1.6"/>
  </symbol>
  <!-- ⑯ 컨테이너 -->
  <symbol id="i-container" viewBox="0 0 48 48">
    <rect x="5" y="16" width="38" height="20" rx="1" fill="#e98a6a" ${S}/>
    <path d="M12 16 V36 M19 16 V36 M26 16 V36 M33 16 V36" ${S} stroke-width="1.6"/>
    <path d="M24 4 V11 M17 11 H31 L24 16 Z" ${S} fill="#cfe4f2"/>
    <path d="M4 41 Q10 38 16 41 T28 41 T40 41" ${S} fill="none" stroke="#5ea6cb"/>
  </symbol>
  <!-- ⑰ 잡지 -->
  <symbol id="i-magazine" viewBox="0 0 48 48">
    <rect x="10" y="5" width="28" height="38" rx="1.5" fill="#fff" ${S}/>
    <rect x="10" y="5" width="28" height="9" fill="#7fb6d6" ${S}/>
    <circle cx="24" cy="26" r="6" fill="#f3c65d" ${S}/>
    <path d="M15 37 H33" ${S} stroke-width="1.6"/>
  </symbol>
  <!-- ⑱ 메달(되돌아보기) -->
  <symbol id="i-medal" viewBox="0 0 48 48">
    <path d="M14 4 L20 18 M34 4 L28 18" ${S} stroke="#5ea6cb" stroke-width="5"/>
    <path d="M14 4 L20 18 M34 4 L28 18" ${S} fill="none"/>
    <circle cx="24" cy="29" r="12" fill="#f3c65d" ${S}/>
    <path d="M24 22 L26.2 26.6 L31 27.1 L27.4 30.3 L28.5 35 L24 32.6 L19.5 35 L20.6 30.3 L17 27.1 L21.8 26.6 Z" fill="#fff" ${S} stroke-width="1.5"/>
  </symbol>
  <!-- ⑲ 돋보기 -->
  <symbol id="i-loupe" viewBox="0 0 48 48">
    <circle cx="20" cy="20" r="12" fill="#cfe4f2" ${S}/>
    <path d="M29 29 L42 42" ${S} stroke-width="5"/>
    <path d="M14 17 Q16 12 21 12" ${S} fill="none" stroke="#fff"/>
  </symbol>
  <!-- ⑳ 박람회 부스 -->
  <symbol id="i-booth" viewBox="0 0 48 48">
    <path d="M6 18 L24 8 L42 18 Z" fill="#e98a6a" ${S}/>
    <rect x="9" y="18" width="30" height="22" fill="#fff" ${S}/>
    <rect x="15" y="24" width="18" height="9" fill="#f3c65d" ${S}/>
    <path d="M24 8 V3 L30 5 L24 7" ${S} fill="#7fb6d6"/>
  </symbol>
  <!-- 별(칠하기) -->
  <symbol id="i-star" viewBox="0 0 24 24">
    <path d="M12 2 L14.9 8.6 L22 9.2 L16.6 13.9 L18.2 21 L12 17.3 L5.8 21 L7.4 13.9 L2 9.2 L9.1 8.6 Z" fill="#fff" stroke="#23364d" stroke-width="1.5" stroke-linejoin="round"/>
  </symbol>
</svg>`;
  document.body.insertAdjacentHTML('afterbegin', sprite);

  // ---------- 단위 ----------
  const MM = 96 / 25.4; // CSS px / mm
  const COURSE = '대항해 무역왕 항해 일지 · 6학년 사회 세계 속의 무역';

  // ---------- 머리띠 그림(136 그림 유지): 나침반·구름·물결·배·해·갈매기 ----------
  const deco = (lead) => {
    const k = lead ? 0.82 : 0.6;
    const mm = (v) => (v * k).toFixed(2) + 'mm';
    const compass = `<svg class="deco" style="left:${mm(6)};top:${lead ? mm(4) : mm(3)};width:${mm(15)};height:${mm(15)}" viewBox="0 0 40 40">
  <circle cx="20" cy="20" r="17" fill="#f3c65d" stroke="#23364d" stroke-width="2"/>
  <circle cx="20" cy="20" r="12" fill="#fff" stroke="#23364d" stroke-width="1.6"/>
  <path d="M20 9 L23 20 L20 31 L17 20 Z" fill="#e98a6a" stroke="#23364d" stroke-width="1.4" stroke-linejoin="round"/>
  <path d="M20 20 L23 20 L20 31 L17 20 Z" fill="#7fb6d6" stroke="#23364d" stroke-width="1.4" stroke-linejoin="round"/>
</svg>`;
    const rest = lead ? `<svg class="deco" style="left:${mm(26)};top:${mm(4)};width:${mm(14)};height:${mm(6)}" viewBox="0 0 56 24">
  <path d="M8 20 Q2 20 3 14 Q4 9 10 10 Q12 3 20 4 Q27 1 31 8 Q38 6 40 12 Q46 12 46 17 Q46 20 41 20 Z" fill="#fff" stroke="#23364d" stroke-width="1.8" stroke-linejoin="round"/>
</svg>
<svg class="deco" style="right:${mm(7)};top:${mm(3)};width:${mm(11)};height:${mm(11)}" viewBox="0 0 30 30">
  <circle cx="15" cy="15" r="12" fill="#f3c65d" stroke="#23364d" stroke-width="1.8"/>
</svg>
<svg class="deco" style="right:${mm(22)};top:${mm(4)};width:${mm(12)};height:${mm(5)}" viewBox="0 0 48 20">
  <path d="M2 10 Q7 4 12 10 Q17 4 22 10 M28 14 Q32 9 36 14 Q40 9 44 14" fill="none" stroke="#23364d" stroke-width="1.8" stroke-linecap="round"/>
</svg>
<svg class="deco" style="right:${mm(12)};bottom:${mm(5)};width:${mm(17)};height:${mm(16)}" viewBox="0 0 48 44">
  <path d="M24 3 V32" stroke="#23364d" stroke-width="2"/>
  <path d="M25 6 L39 27 H25 Z" fill="#fff" stroke="#23364d" stroke-width="1.8" stroke-linejoin="round"/>
  <path d="M23 9 L12 27 H23 Z" fill="#fff" stroke="#23364d" stroke-width="1.8" stroke-linejoin="round"/>
  <path d="M24 3 L31 5 L24 7" fill="#e98a6a" stroke="#23364d" stroke-width="1.4" stroke-linejoin="round"/>
  <path d="M5 32 H43 L37 41 H11 Z" fill="#e98a6a" stroke="#23364d" stroke-width="1.8" stroke-linejoin="round"/>
  <circle cx="18" cy="36" r="1.6" fill="#fff"/><circle cx="24" cy="36" r="1.6" fill="#fff"/><circle cx="30" cy="36" r="1.6" fill="#fff"/>
</svg>` : '';
    return `${compass}${rest}
<svg class="waves" viewBox="0 0 400 30" preserveAspectRatio="none">
  <path d="M0 10 Q12.5 2 25 10 T50 10 T75 10 T100 10 T125 10 T150 10 T175 10 T200 10 T225 10 T250 10 T275 10 T300 10 T325 10 T350 10 T375 10 T400 10 V30 H0 Z" fill="#8cc3df"/>
  <path d="M0 10 Q12.5 2 25 10 T50 10 T75 10 T100 10 T125 10 T150 10 T175 10 T200 10 T225 10 T250 10 T275 10 T300 10 T325 10 T350 10 T375 10 T400 10" fill="none" stroke="#23364d" stroke-width="1.6" vector-effect="non-scaling-stroke"/>
  <path d="M0 21 Q15 15 30 21 T60 21 T90 21 T120 21 T150 21 T180 21 T210 21 T240 21 T270 21 T300 21 T330 21 T360 21 T390 21 T420 21" fill="none" stroke="#5ea6cb" stroke-width="1.4" vector-effect="non-scaling-stroke"/>
</svg>`;
  };

  // ---------- 쪽 틀: 머리띠 → (학생 정보) → 본문 → 꼬리말 ----------
  function frame(page) {
    const lead = page.hasAttribute('data-lead');
    const teacher = page.classList.contains('tpage');
    const label = page.dataset.label || (page.dataset.sheet === '선택활동' ? '선택 활동' : page.dataset.sheet);
    const h = document.createElement('header');
    h.className = `mast ${lead ? 'lead' : 'slim'}`;
    h.innerHTML = deco(lead) + (lead
      ? `<div class="t"><h1>대항해 무역왕 항해 일지</h1><div class="sub"><span class="pill">${label}</span>${page.dataset.title || ''} <span class="pages">${page.dataset.pages ? `(${page.dataset.pages})` : ''}</span></div></div>`
      : `<div class="t"><h1>대항해 무역왕 항해 일지</h1><span class="pill">${label}</span></div>${teacher ? '' : '<div class="namebox">이름</div>'}`);
    page.prepend(h);
    const info = page.querySelector('.info[data-auto]');
    if (info) {
      info.innerHTML = `<div class="rows">
  <div class="a-line">6학년 <span class="f s"></span> 반 <span class="f s"></span> 번 <span>이름</span> <span class="f"></span></div>
  <div class="a-line">우리 회사 이름 <span class="f"></span></div>
</div><div class="flag"><span>깃발 그리기</span></div>`;
    }
    const f = document.createElement('footer');
    f.className = 'foot';
    f.innerHTML = `<span>${teacher ? '대항해 무역왕 항해 일지 · 교사용 예시 답' : COURSE}</span><b></b>`;
    page.append(f);
  }
  function numberPages() {
    const pages = [...document.querySelectorAll('.page')];
    const bySheet = {};
    pages.forEach((p) => { (bySheet[p.dataset.sheet] ||= []).push(p); });
    pages.forEach((p) => {
      const list = bySheet[p.dataset.sheet];
      const i = list.indexOf(p) + 1;
      const name = p.classList.contains('tpage') ? '' : `${p.dataset.sheet === '선택활동' ? '선택 활동' : p.dataset.sheet} · `;
      p.querySelector('.foot b').textContent = `${name}${i} / ${list.length}`;
    });
  }

  // ---------- 쓰기 줄 ----------
  function setLines(el, n) {
    el.dataset.lines = String(n);
    if (el.matches('.steps')) { el.style.setProperty('--lines', String(n)); return; }
    const targets = el.matches('.a-box, td.w') ? [el] : [...el.querySelectorAll('.a-box, td.w:not(.has-text):not(.gray)')];
    targets.forEach((t) => {
      t.querySelectorAll(':scope > .ln').forEach((x) => x.remove());
      t.insertAdjacentHTML('beforeend', '<div class="ln"></div>'.repeat(n));
    });
  }

  // ---------- 남는 공간 채우기: ① 답 칸 줄 늘리기 → ② 블록 간격 늘리기 → ③ 그래도 크게 남으면 바다 그림 ----------
  const seaArt = (tall) => `<svg class="sea" viewBox="0 0 400 60" preserveAspectRatio="none">
  <path d="M0 22 Q12.5 14 25 22 T50 22 T75 22 T100 22 T125 22 T150 22 T175 22 T200 22 T225 22 T250 22 T275 22 T300 22 T325 22 T350 22 T375 22 T400 22 V60 H0 Z" fill="#e4f2fa"/>
  <path d="M0 22 Q12.5 14 25 22 T50 22 T75 22 T100 22 T125 22 T150 22 T175 22 T200 22 T225 22 T250 22 T275 22 T300 22 T325 22 T350 22 T375 22 T400 22" fill="none" stroke="#8cc3df" stroke-width="1.4" vector-effect="non-scaling-stroke"/>
  <path d="M0 38 Q15 32 30 38 T60 38 T90 38 T120 38 T150 38 T180 38 T210 38 T240 38 T270 38 T300 38 T330 38 T360 38 T390 38 T400 38" fill="none" stroke="#b9dcee" stroke-width="1.2" vector-effect="non-scaling-stroke"/>
</svg><img class="ship" src="img/ship.png" alt="">${tall ? `<img class="gull" src="img/seagull.png" alt="">
<svg class="cloud" style="left:20%;top:12%" viewBox="0 0 56 24"><path d="M8 20 Q2 20 3 14 Q4 9 10 10 Q12 3 20 4 Q27 1 31 8 Q38 6 40 12 Q46 12 46 17 Q46 20 41 20 Z" fill="#fff" stroke="#b9dcee" stroke-width="1.8" stroke-linejoin="round"/></svg>
<svg class="cloud" style="right:32%;top:4%" viewBox="0 0 56 24"><path d="M8 20 Q2 20 3 14 Q4 9 10 10 Q12 3 20 4 Q27 1 31 8 Q38 6 40 12 Q46 12 46 17 Q46 20 41 20 Z" fill="#fff" stroke="#b9dcee" stroke-width="1.8" stroke-linejoin="round"/></svg>` : ''}`;

  // 쪽 채움 규칙(DESIGN.md 7장) — 질문 블록 사이 간격은 늘 8mm. 남는 공간은 답 칸 줄 수가 흡수한다.
  //  ① 답 칸 줄을 고르게 늘린다(data-max까지).
  //  ② 그래도 60mm 넘게 비면(내용이 쪽의 절반이 안 되는 쪽) 줄 수를 처음으로 되돌리고, 질문 블록 아래에
  //     '자유 메모 · 그림 칸 (선택)' 상자(여러 줄 쓰기 상자)를 넣는다. 다른 답 칸은 처음보다 2줄까지만 늘리고,
  //     메모 상자가 바다 띠(24mm) 위까지 채운다. 구름·갈매기는 넣지 않는다.
  //  ③ 그 밖의 쪽은 상한을 6줄 더 풀어 남은 공간을 마저 흡수한다. 그래도 30mm 넘게 남으면 바다 그림.
  const SEA_STRIP = 24; // 메모 상자 아래 바다 띠 높이(mm, --sp-6)
  const SPARSE = 90;    // 칸 상한까지 늘려도 이만큼(mm) 넘게 비면(쪽의 약 1/3) 메모 상자를 넣는다
  const EXTRA = 6;      // ③에서 더 풀어 주는 줄 수
  function fill(page) {
    const body = page.querySelector('.body');
    const act = body && body.querySelector('.act');
    if (!act) return;
    const main = act.querySelector('.act-main');
    const free = () => (body.getBoundingClientRect().bottom - main.getBoundingClientRect().bottom) / MM;
    // 늘릴 수 있는 칸 묶음: 같은 표의 행(tr[data-grow])은 한 묶음으로 함께 늘린다(행 높이가 같게).
    // 칸 종류별 상한(CAP): 질문에 비해 칸이 지나치게 커지지 않게 한다. 남는 공간은 쪽 아래 자투리로.
    const CAP = (el) => (el.matches('tr') ? 4 : el.matches('.steps') ? 3 : 6);
    const growers = () => {
      const list = [];
      const byTable = new Map();
      act.querySelectorAll('[data-grow]').forEach((el) => {
        const base = Number(el.dataset.base || el.dataset.lines || 1);
        el.dataset.base = String(base);
        const t = el.matches('tr') ? el.closest('table') : null;
        if (t && byTable.has(t)) { byTable.get(t).els.push(el); return; }
        const g = { els: [el], base, n: Number(el.dataset.lines || base), cap: CAP(el), done: false };
        g.max = Math.min(Number(el.dataset.max || base + 3), g.cap);
        if (t) byTable.set(t, g);
        list.push(g);
      });
      return list;
    };
    const setG = (g, n) => g.els.forEach((el) => setLines(el, n));
    const grow = (gs, reserve) => {
      for (let guard = 0; guard < 400; guard++) {
        if (free() < 10.5 + reserve) break;
        const open = gs.filter((g) => !g.done && g.n < g.max);
        const pool = open.some((g) => !g.last) ? open.filter((g) => !g.last) : open;
        const c = pool.sort((a, b) => (a.n - a.base) - (b.n - b.base) || a.n - b.n)[0];
        if (!c) break;
        setG(c, c.n + 1); // 묶음 전체(모든 행)에 1줄씩 — 자리가 없으면 되돌린다
        if (free() < reserve) { setG(c, c.n); c.done = true; continue; }
        c.n++;
      }
    };
    grow(growers(), 0);
    page.dataset.empty = free().toFixed(0);
    const noart = page.hasAttribute('data-noart');
    const sparse = !noart && free() >= SPARSE;
    if (sparse) {
      const reserve = SEA_STRIP + 4; // 바다 띠 + 띠 위 간격 4mm
      const gs = growers();
      gs.forEach((g) => { setG(g, g.base); g.n = g.base; g.max = Math.min(g.max, g.base + 2); });
      const memo = document.createElement('div');
      memo.className = 'q memo';
      memo.innerHTML = '<p class="q-text memo-title"><span class="tag opt">선택</span>자유 메모 · 그림 칸</p><div class="a-box"></div>';
      main.append(memo);
      const box = memo.querySelector('.a-box');
      setLines(box, 2);
      gs.push({ els: [box], base: 2, n: 2, max: 99, done: false, last: true });
      grow(gs, reserve);
      const art = document.createElement('div');
      art.className = 'sea-art strip';
      art.innerHTML = seaArt(false);
      act.append(art);
    } else {
      const gs = growers();
      gs.forEach((g) => { g.max = Math.min(g.max + EXTRA, g.cap); });
      grow(gs, 0);
      if (!noart && free() >= 30) {
        const art = document.createElement('div');
        art.className = 'sea-art';
        art.innerHTML = seaArt(free() > 70);
        act.append(art);
      }
    }
    page.dataset.free = free().toFixed(1);
  }

  // 두 자리 번호 원: 자간을 좁혀 원 안쪽 여백 2mm 이상
  function numbers() {
    document.querySelectorAll('.act-num').forEach((el) => {
      const t = el.textContent.trim();
      el.innerHTML = `<span>${t}</span>`;
      if (t.length > 1) el.classList.add('two');
    });
  }

  // ---------- 교사용: 흐름(#flow)을 쪽으로 나누기 ----------
  function paginate() {
    const flow = document.getElementById('flow');
    if (!flow) return;
    const secs = [...flow.children];
    let page; let body; let first = true;
    const over = () => body.scrollHeight > body.clientHeight + 1;
    const newPage = () => {
      page = document.createElement('div');
      page.className = 'page tpage';
      page.dataset.sheet = '교사용';
      page.dataset.label = '교사용';
      if (first) {
        page.setAttribute('data-lead', '');
        page.dataset.title = flow.dataset.title;
        page.dataset.pages = flow.dataset.pages;
      }
      first = false;
      body = document.createElement('div');
      body.className = 'body';
      page.append(body);
      flow.before(page);
      frame(page);
    };
    newPage();
    for (const sec of secs) {
      const h2 = sec.querySelector('h2');
      const list = sec.querySelector('ol, ul, table');
      const items = list.matches('table') ? [...list.tBodies[0].rows] : [...list.children];
      let shell; let box; let started = 0;
      const openShell = (cont) => {
        shell = document.createElement('section');
        shell.className = sec.className;
        const t = h2.cloneNode(true);
        if (cont) t.insertAdjacentText('beforeend', ' (이어서)');
        shell.append(t);
        const l = list.cloneNode(false);
        if (list.matches('table')) {
          [...list.children].forEach((c) => { if (c.tagName !== 'TBODY') l.append(c.cloneNode(true)); });
          box = document.createElement('tbody');
          l.append(box);
        } else {
          box = l;
          if (list.tagName === 'OL') l.setAttribute('start', String(started + 1));
        }
        shell.append(l);
        body.append(shell);
      };
      openShell(false);
      if (over()) { shell.remove(); newPage(); openShell(false); }
      for (const it of items) {
        box.append(it);
        if (over()) {
          it.remove();
          if (!box.children.length) { shell.remove(); newPage(); openShell(false); box.append(it); started++; continue; }
          newPage(); openShell(true); box.append(it);
        }
        started++;
      }
    }
    flow.remove();
  }

  // ---------- 실행 ----------
  document.querySelectorAll('.page').forEach(frame);
  document.querySelectorAll('[data-ic]').forEach((el) => {
    el.innerHTML = `<svg viewBox="0 0 48 48"><use href="#i-${el.dataset.ic}"/></svg>`;
  });
  document.querySelectorAll('.stars').forEach((el) => {
    el.innerHTML = '<svg viewBox="0 0 24 24"><use href="#i-star"/></svg>'.repeat(3);
  });
  document.querySelectorAll('[data-lines]').forEach((el) => setLines(el, Number(el.dataset.lines)));
  numbers();
  // 빈칸 '( ___ )조사'가 줄 끝에서 갈라지지 않게 한 덩어리로 묶는다(글자는 그대로)
  document.querySelectorAll('.bl').forEach((bl) => {
    const prev = bl.previousSibling; const next = bl.nextSibling;
    if (!prev || prev.nodeType !== 3 || !prev.data.endsWith('(')) return;
    if (!next || next.nodeType !== 3 || !next.data.startsWith(')')) return;
    const wrap = document.createElement('span');
    wrap.className = 'nw';
    prev.data = prev.data.slice(0, -1);
    const m = next.data.match(/^\)[^\s,.]*[,.]?/)[0];
    next.data = next.data.slice(m.length);
    bl.replaceWith(wrap);
    wrap.append('(', bl, m);
  });
  document.fonts.ready.then(() => {
    paginate();
    numberPages();
    document.querySelectorAll('.page').forEach(fill);
    document.documentElement.dataset.ready = '1';
  });
})();
