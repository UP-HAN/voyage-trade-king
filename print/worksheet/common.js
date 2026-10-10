// 학습지 공통 장식: 아이콘 모음(SVG symbol)과 머리띠 그림을 각 쪽에 채워 넣는다.
// 인쇄 전 브라우저(Playwright chromium)에서 실행된다. 문항 내용은 HTML에 그대로 있다.
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

  // 머리띠 장식: 나침반·구름·물결·배·해·갈매기
  const deco = (slim, cmp) => {
    const k = cmp ? 0.82 : slim ? 0.72 : 1;
    const mm = (v) => (v * k).toFixed(2) + 'mm';
    return `
<svg class="deco" style="left:${mm(6)};top:${mm(5)};width:${mm(15)};height:${mm(15)}" viewBox="0 0 40 40">
  <circle cx="20" cy="20" r="17" fill="#f3c65d" stroke="#23364d" stroke-width="2"/>
  <circle cx="20" cy="20" r="12" fill="#fff" stroke="#23364d" stroke-width="1.6"/>
  <path d="M20 9 L23 20 L20 31 L17 20 Z" fill="#e98a6a" stroke="#23364d" stroke-width="1.4" stroke-linejoin="round"/>
  <path d="M20 20 L23 20 L20 31 L17 20 Z" fill="#7fb6d6" stroke="#23364d" stroke-width="1.4" stroke-linejoin="round"/>
</svg>
${cmp ? '' : `<svg class="deco" style="left:${mm(24)};top:${mm(3.5)};width:${mm(14)};height:${mm(6)}" viewBox="0 0 56 24">
  <path d="M8 20 Q2 20 3 14 Q4 9 10 10 Q12 3 20 4 Q27 1 31 8 Q38 6 40 12 Q46 12 46 17 Q46 20 41 20 Z" fill="#fff" stroke="#23364d" stroke-width="1.8" stroke-linejoin="round"/>
</svg>`}
${cmp ? '' : `<svg class="deco" style="right:${mm(7)};top:${mm(4)};width:${mm(11)};height:${mm(11)}" viewBox="0 0 30 30">
  <circle cx="15" cy="15" r="12" fill="#f3c65d" stroke="#23364d" stroke-width="1.8"/>
</svg>
<svg class="deco" style="right:${mm(22)};top:${mm(5)};width:${mm(12)};height:${mm(5)}" viewBox="0 0 48 20">
  <path d="M2 10 Q7 4 12 10 Q17 4 22 10 M28 14 Q32 9 36 14 Q40 9 44 14" fill="none" stroke="#23364d" stroke-width="1.8" stroke-linecap="round"/>
</svg>
<svg class="deco" style="right:${mm(12)};bottom:${mm(5)};width:${mm(17)};height:${mm(16)}" viewBox="0 0 48 44">
  <path d="M24 3 V32" stroke="#23364d" stroke-width="2"/>
  <path d="M25 6 L39 27 H25 Z" fill="#fff" stroke="#23364d" stroke-width="1.8" stroke-linejoin="round"/>
  <path d="M23 9 L12 27 H23 Z" fill="#fff" stroke="#23364d" stroke-width="1.8" stroke-linejoin="round"/>
  <path d="M24 3 L31 5 L24 7" fill="#e98a6a" stroke="#23364d" stroke-width="1.4" stroke-linejoin="round"/>
  <path d="M5 32 H43 L37 41 H11 Z" fill="#e98a6a" stroke="#23364d" stroke-width="1.8" stroke-linejoin="round"/>
  <circle cx="18" cy="36" r="1.6" fill="#fff"/><circle cx="24" cy="36" r="1.6" fill="#fff"/><circle cx="30" cy="36" r="1.6" fill="#fff"/>
</svg>`}
<svg class="waves" viewBox="0 0 400 30" preserveAspectRatio="none">
  <path d="M0 10 Q12.5 2 25 10 T50 10 T75 10 T100 10 T125 10 T150 10 T175 10 T200 10 T225 10 T250 10 T275 10 T300 10 T325 10 T350 10 T375 10 T400 10 V30 H0 Z" fill="#8cc3df"/>
  <path d="M0 10 Q12.5 2 25 10 T50 10 T75 10 T100 10 T125 10 T150 10 T175 10 T200 10 T225 10 T250 10 T275 10 T300 10 T325 10 T350 10 T375 10 T400 10" fill="none" stroke="#23364d" stroke-width="1.6" vector-effect="non-scaling-stroke"/>
  <path d="M0 21 Q15 15 30 21 T60 21 T90 21 T120 21 T150 21 T180 21 T210 21 T240 21 T270 21 T300 21 T330 21 T360 21 T390 21 T420 21" fill="none" stroke="#5ea6cb" stroke-width="1.4" vector-effect="non-scaling-stroke"/>
</svg>`;
  };
  document.querySelectorAll('.mast').forEach((m) => m.insertAdjacentHTML('afterbegin', deco(m.classList.contains('slim'), m.classList.contains('cmp'))));

  // <i data-ic="market"> → 아이콘
  document.querySelectorAll('[data-ic]').forEach((el) => {
    el.innerHTML = `<svg viewBox="0 0 48 48"><use href="#i-${el.dataset.ic}"/></svg>`;
  });
  // <span class="stars"> → 별 3개
  document.querySelectorAll('.stars').forEach((el) => {
    el.innerHTML = '<svg viewBox="0 0 24 24"><use href="#i-star"/></svg>'.repeat(3);
  });
  // 두 자리 번호
  document.querySelectorAll('.num').forEach((el) => { const t = el.textContent.trim(); if (t.length > 1) { el.classList.add('two'); el.innerHTML = `<span>${t}</span>`; } });
  // 쓰기 줄: <div class="wbox" data-lines="2">
  document.querySelectorAll('[data-lines]').forEach((el) => {
    el.insertAdjacentHTML('beforeend', '<div class="ln"></div>'.repeat(Number(el.dataset.lines)));
  });
  document.documentElement.dataset.ready = '1';
})();
