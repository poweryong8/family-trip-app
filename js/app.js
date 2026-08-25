// 메인 앱: 일정 편집 · 지도/마커 · 경로 · 시간표 · 맛집 검색 · 사진 · 리포트 · 설정
(function () {
  const $ = s => document.querySelector(s);
  const D = FTA_DATA, S = FTStore, M = FTMap;

  let activeDay = 0;          // 0=전체, 1..n=일차
  let routeMode = 'DRIVING';
  let routeSelection = null;  // { dayIdx, placeIds: [...] } — 경로에 선택한 장소
  let routeModeOn = false;    // 인라인 경로 모드 (지도 화면 일정 패널)
  let routeDrawTimer = null;  // 체크 변경 디바운스
  let view = 'map';           // 'map' | 'list' (지도/일정)
  let mapsReady = false;
  let pendingPhoto = null;    // { tripId, dayIdx, pIdx, placeId }
  let lightboxCtx = null;
  let toastTimer = null;

  function esc(s) {
    return String(s == null ? '' : s).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  }
  function catInfo(p) { return D.CATEGORIES[p.category] || D.CATEGORIES.other; }
  function dayColor(i) { return D.DAY_COLORS[i % D.DAY_COLORS.length]; }

  function boot() {
    S.ensureSeed();
    const st = S.getState();
    // 시드 장소에 id 부여 (사진 연결용)
    st.trips.forEach(t => t.days.forEach(d => d.places.forEach(p => { if (!p.id) p.id = S.uid(); })));
    S.saveState(st);

    wire();
    renderTrips();
    renderTabs();
    refreshDay();
    M.init();

    window.addEventListener('ftmapsready', () => { mapsReady = true; refreshDay(); });
    window.addEventListener('ftmapsfail', e => toast(e.detail || '지도를 불러오지 못했어요'));
  }

  /* ================= 이벤트 연결 ================= */
  function wire() {
    $('#tripSelect').addEventListener('change', e => {
      S.setActiveTrip(e.target.value);
      activeDay = 0;
      routeSelection = null;
      routeModeOn = false;
      hideRoute();
      applyRouteMode();
      renderTabs();
      refreshDay();
    });
    $('#dayTabs').addEventListener('click', e => {
      const b = e.target.closest('.day-tab'); if (!b) return;
      activeDay = Number(b.dataset.day);
      routeSelection = null;
      hideRoute();
      renderTabs();
      refreshDay();
      if (routeModeOn) scheduleRouteDraw();
    });
    $('#btnAddPlace').addEventListener('click', () => openPlaceModal(null));
    $('#btnEmptySearch').addEventListener('click', () => openSearchModal('search'));
    $('#btnTransport').addEventListener('click', openTransportModal);
    $('#btnReport').addEventListener('click', openReport);
    $('#btnSettings').addEventListener('click', openSettings);
    $('#btnSearch').addEventListener('click', () => openSearchModal('search'));
    $('#btnNearby').addEventListener('click', () => openSearchModal('nearby'));
    $('#btnRoute').addEventListener('click', () => {
      if (activeDay === 0) { drawAllDays(); return; }
      routeModeOn = !routeModeOn;
      applyRouteMode();
    });
    $('#viewSwitch').addEventListener('click', e => {
      const b = e.target.closest('[data-view]'); if (!b) return;
      if (b.dataset.view === view) return;
      view = b.dataset.view;
      if (view === 'list') hideRoute();
      applyView();
    });
    $('#photoInput').addEventListener('change', onPhotoFile);
    $('#importInput').addEventListener('change', onImportFile);

    function onPlaceListClick(e) {
      const btn = e.target.closest('[data-act]');
      const thumb = e.target.closest('.thumb');
      if (thumb) { openLightbox(thumb.dataset.place, thumb.dataset.ph); return; }
      if (!btn) return;
      const dayIdx = Number(btn.dataset.day);
      const pIdx = Number(btn.dataset.idx);
      const act = btn.dataset.act;
      if (act === 'photo') { pendingPhoto = { dayIdx, pIdx, placeId: btn.dataset.place }; $('#photoInput').click(); }
      else if (act === 'edit') openPlaceModal({ dayIdx, pIdx });
      else if (act === 'del') deletePlace(dayIdx, pIdx);
    }
    // 하단 시트 + 일정 보기 공통 행 액션
    $('#placeList').addEventListener('click', onPlaceListClick);
    $('#itinerary').addEventListener('click', onPlaceListClick);
    // 일정 보기: 일자별 경로 버튼
    $('#itinerary').addEventListener('click', e => {
      const rb = e.target.closest('[data-itroute]');
      if (!rb) return;
      activeDay = Number(rb.dataset.itroute) + 1;
      routeSelection = null;
      hideRoute();
      renderTabs();
      refreshDay();
      openRouteSelectModal();
    });

    // 경로 패널: 모드 전환 / 닫기
    $('#routeInfo').addEventListener('click', e => {
      if (e.target.closest('#routeClose')) { hideRoute(); return; }
      const seg = e.target.closest('[data-mode]');
      if (seg) {
        routeMode = seg.dataset.mode;
        drawDayRoute();
      }
    });

    // 인라인 경로 모드: 체크박스 변경 → 자동 경로, 이동수단/종료
    $('#placeList').addEventListener('change', e => {
      if (e.target.classList.contains('pcheck')) scheduleRouteDraw();
    });
    $('#routeBar').addEventListener('click', e => {
      const seg = e.target.closest('[data-mode]');
      if (seg) {
        routeMode = seg.dataset.mode;
        document.querySelectorAll('#routeBarSeg [data-mode]').forEach(b => b.classList.toggle('on', b === seg));
        scheduleRouteDraw();
        return;
      }
      if (e.target.closest('#rbExit')) {
        routeModeOn = false;
        applyRouteMode();
      }
    });

    // 모달 공통: 배경/✕/Esc
    $('#modalRoot').addEventListener('click', e => {
      if (e.target.classList.contains('modal-overlay')) closeModal();
      if (e.target.closest('.modal-x')) closeModal();
      const go = e.target.closest('[data-srgo]');
      if (go) { const v = $('#srQuery').value.trim(); v ? runSearch(v) : toast('검색어를 입력해 주세요'); }
      const det = e.target.closest('[data-srdetail]');
      if (det) { openPlaceDetail(det.dataset.idx); return; }
      const add = e.target.closest('[data-sradd]');
      if (add) addSearchResult(add.dataset.idx, add);
      const pan = e.target.closest('[data-srpan]');
      if (pan) { const idx = Number(pan.dataset.idx); const it = lastSearchResults[idx]; if (it) { closeModal(); M.panTo(it.lat, it.lng); } }
    });
    document.addEventListener('keydown', e => { if (e.key === 'Escape') { closeModal(); closeLightbox(); } });
  }

  /* ================= 렌더링 ================= */
  function currentTrip() { return S.activeTrip(); }

  function renderTrips() {
    const st = S.getState();
    const sel = $('#tripSelect');
    sel.innerHTML = st.trips.map(t => '<option value="' + t.id + '"' + (t.id === st.activeTripId ? ' selected' : '') + '>' + esc(t.name) + '</option>').join('');
  }

  function renderTabs() {
    const trip = currentTrip(); if (!trip) return;
    let h = '<button class="day-tab' + (activeDay === 0 ? ' active' : '') + '" data-day="0" style="--tab-color:#2F6D80">' +
      '<span class="d">전체</span><span class="t">지도</span></button>';
    trip.days.forEach((d, i) => {
      const short = d.date ? d.date.slice(5).replace('-', '/') : (i + 1) + '일';
      h += '<button class="day-tab' + (activeDay === i + 1 ? ' active' : '') + '" data-day="' + (i + 1) + '" style="--tab-color:' + dayColor(i) + '">' +
        '<span class="d">' + short + '</span><span class="t">' + esc(d.title) + '</span></button>';
    });
    $('#dayTabs').innerHTML = h;
  }

  function placeRows() {
    const trip = currentTrip(); if (!trip) return [];
    const rows = [];
    if (activeDay === 0) {
      trip.days.forEach((d, i) => d.places.forEach((p, j) => rows.push({ dayIdx: i, pIdx: j, place: p })));
    } else if (trip.days[activeDay - 1]) {
      trip.days[activeDay - 1].places.forEach((p, j) => rows.push({ dayIdx: activeDay - 1, pIdx: j, place: p }));
    }
    return rows;
  }

  async function renderRowsInto(container, rows, rm) {
    container.innerHTML = '';
    const trip = currentTrip(); if (!trip) return;
    const tripId = trip.id;
    for (const r of rows) {
      const p = r.place;
      const cat = catInfo(p);
      const photos = await S.getPhotos(tripId, p.id);
      const thumbs = photos.length
        ? photos.map(ph => '<img class="thumb" src="' + ph.dataUrl + '" data-place="' + p.id + '" data-ph="' + ph.id + '" alt="사진">').join('')
        : '';
      const tags = (p.tags || []).map(t => '<span class="tag">#' + esc(t) + '</span>').join('');
      const row = document.createElement('div');
      row.className = 'place-row' + (rm ? ' rm' : '');
      if (rm) {
        // 인라인 경로 모드: 체크박스 행 (자동 경로 탐색)
        row.innerHTML =
          '<input type="checkbox" class="pcheck" data-pcheck="' + p.id + '" checked>' +
          '<div class="pmain">' +
            '<div class="pname">' + cat.emoji + ' ' + esc(p.name) + ' <span class="cat">' + cat.label + '</span></div>' +
            (p.note ? '<div class="pnote">' + esc(p.note) + '</div>' : '') +
            tags +
          '</div>';
      } else {
        row.innerHTML =
          '<span class="pdot" style="background:' + dayColor(r.dayIdx) + '"></span>' +
          '<div class="pmain">' +
            '<div class="pname">' + cat.emoji + ' ' + esc(p.name) + ' <span class="cat">' + cat.label + '</span></div>' +
            (p.note ? '<div class="pnote">' + esc(p.note) + '</div>' : '') +
            tags +
            '<div class="thumbs">' + thumbs +
              '<button class="thumb-add" data-act="photo" data-day="' + r.dayIdx + '" data-idx="' + r.pIdx + '" data-place="' + p.id + '" title="사진 추가">📷</button>' +
            '</div>' +
          '</div>' +
          '<div class="pacts">' +
            '<button data-act="edit" data-day="' + r.dayIdx + '" data-idx="' + r.pIdx + '" title="수정">✏️</button>' +
            '<button data-act="del" data-day="' + r.dayIdx + '" data-idx="' + r.pIdx + '" title="삭제">🗑️</button>' +
          '</div>';
      }
      container.appendChild(row);
    }
  }

  async function renderItinerary() {
    const trip = currentTrip(); if (!trip) return;
    const wrap = $('#itinerary');
    wrap.innerHTML = '';
    const dayIdxs = activeDay === 0 ? trip.days.map((d, i) => i) : [activeDay - 1];
    for (const di of dayIdxs) {
      const day = trip.days[di];
      if (!day) continue;
      const sec = document.createElement('section');
      sec.className = 'it-day';
      const rows = day.places.map((p, j) => ({ dayIdx: di, pIdx: j, place: p }));
      sec.innerHTML =
        '<div class="it-day-head">' +
          '<span class="r-dot" style="background:' + dayColor(di) + '"></span>' +
          '<div style="flex:1"><h3>' + (di + 1) + '일차 · ' + esc(day.title) + '</h3>' +
          '<div class="it-date">' + FTReport.fmtDate(day.date) + (day.places.length ? ' · ' + day.places.length + '곳' : '') + '</div></div>' +
          (day.places.length >= 2 ? '<button class="btn btn-ghost" style="min-height:40px;font-size:13.5px" data-itroute="' + di + '">🚗 경로</button>' : '') +
        '</div>' +
        (day.transport ? '<div class="it-transport">🚌 ' + esc(day.transport) + '</div>' : '') +
        '<div class="place-list it-places"></div>';
      wrap.appendChild(sec);
      const listEl = sec.querySelector('.it-places');
      if (!rows.length) listEl.innerHTML = '<div class="empty"><p>아직 장소가 없어요. 지도 탭에서 검색으로 추가해 보세요.</p></div>';
      else await renderRowsInto(listEl, rows);
    }
  }

  function applyView() {
    const isMap = view === 'map';
    $('#split').classList.toggle('hidden', !isMap);
    $('#mapWrap').classList.toggle('hidden', !isMap);
    $('#sheet').classList.toggle('hidden', !isMap);
    $('#itinerary').classList.toggle('hidden', isMap);
    document.querySelectorAll('#viewSwitch [data-view]').forEach(b => b.classList.toggle('on', b.dataset.view === view));
    if (!isMap) renderItinerary();
  }

  async function refreshDay() {
    const trip = currentTrip(); if (!trip) return;
    const title = $('#sheetDayTitle');
    if (activeDay === 0) title.innerHTML = '<span style="color:#2F6D80">●</span> 전체 일정 (' + trip.days.reduce((a, d) => a + d.places.length, 0) + '곳)';
    else {
      const day = trip.days[activeDay - 1];
      title.innerHTML = '<span style="color:' + dayColor(activeDay - 1) + '">●</span> ' + activeDay + '일차 · ' + esc(day.title);
    }

    const rows = placeRows();
    const listEl = $('#placeList');
    const emptyEl = $('#sheetEmpty');
    if (!rows.length) {
      listEl.innerHTML = '';
      listEl.classList.add('hidden');
      emptyEl.classList.remove('hidden');
    } else {
      emptyEl.classList.add('hidden');
      listEl.classList.remove('hidden');
      await renderRowsInto(listEl, rows, routeModeOn);
    }

    // 지도 마커
    if (mapsReady) {
      const items = rows.map(r => ({ place: r.place, color: dayColor(r.dayIdx) }));
      M.setMarkers(items, p => { const hit = rows.find(r => r.place.id === p.id); if (hit) openPlaceModal({ dayIdx: hit.dayIdx, pIdx: hit.pIdx }); });
      M.fitBounds(rows.map(r => ({ lat: r.place.lat, lng: r.place.lng })));
    }

    // 일정 보기 화면일 때 함께 갱신
    if (view === 'list') await renderItinerary();
  }

  /* ================= 장소 추가/수정/삭제 ================= */
  function openPlaceModal(ctx) {
    const trip = currentTrip(); if (!trip) return;
    let dayIdx = 0, pIdx = null, p = null;
    if (ctx) { dayIdx = ctx.dayIdx; pIdx = ctx.pIdx; p = trip.days[dayIdx].places[pIdx]; }
    const catOpts = Object.keys(D.CATEGORIES).map(k =>
      '<option value="' + k + '"' + (p && p.category === k ? ' selected' : '') + '>' + D.CATEGORIES[k].emoji + ' ' + D.CATEGORIES[k].label + '</option>').join('');
    const body =
      '<div class="field"><label>이름</label><input type="text" id="pmName" placeholder="예: 오타루 운하" value="' + esc(p ? p.name : '') + '"></div>' +
      '<div class="field"><label>종류</label><select id="pmCat">' + catOpts + '</select></div>' +
      '<div class="field"><div style="display:flex;gap:8px"><div style="flex:1"><label>위도</label><input type="text" id="pmLat" value="' + (p ? p.lat : '') + '" inputmode="decimal"></div>' +
      '<div style="flex:1"><label>경도</label><input type="text" id="pmLng" value="' + (p ? p.lng : '') + '" inputmode="decimal"></div></div>' +
      '<div class="hint">위치를 모르면 지도에서 마커를 클릭해 수정하거나, 검색 기능으로 추가하세요.</div></div>' +
      '<div class="field"><label>메모</label><textarea id="pmNote" placeholder="운영시간, 예약, 아이 팁 등">' + esc(p ? p.note : '') + '</textarea></div>' +
      '<div class="field"><label>태그 (쉼표 구분)</label><input type="text" id="pmTags" placeholder="아이 좋아함, 야경" value="' + esc(p && p.tags ? p.tags.join(', ') : '') + '"></div>' +
      '<div class="field"><label>공식 사이트 (선택)</label><input type="text" id="pmLink" placeholder="https://..." value="' + esc(p && p.links ? (p.links.official || '') : '') + '"></div>' +
      '<button id="pmSave" class="btn btn-primary btn-block">' + (p ? '저장' : '일정에 추가') + '</button>';
    showModal(p ? '장소 수정' : '장소 추가', body);
    $('#pmSave').addEventListener('click', () => {
      const name = $('#pmName').value.trim();
      if (!name) { toast('이름을 입력해 주세요'); return; }
      const lat = parseFloat($('#pmLat').value), lng = parseFloat($('#pmLng').value);
      if (isNaN(lat) || isNaN(lng)) { toast('위도/경도를 확인해 주세요 (숫자)'); return; }
      const place = {
        id: p ? p.id : S.uid(),
        name: name,
        category: $('#pmCat').value,
        lat: lat, lng: lng,
        note: $('#pmNote').value.trim(),
        tags: $('#pmTags').value.split(',').map(t => t.trim()).filter(Boolean),
        links: $('#pmLink').value.trim() ? { official: $('#pmLink').value.trim() } : {}
      };
      const day = trip.days[dayIdx];
      if (pIdx == null) day.places.push(place); else day.places[pIdx] = place;
      S.saveTrip(trip);
      closeModal();
      refreshDay();
      toast(pIdx == null ? '일정에 추가했어요' : '수정했어요');
    });
  }

  function deletePlace(dayIdx, pIdx) {
    const trip = currentTrip(); if (!trip) return;
    const p = trip.days[dayIdx].places[pIdx];
    if (!confirm('「' + p.name + '」을(를) 삭제할까요? (사진도 함께 삭제됩니다)')) return;
    trip.days[dayIdx].places.splice(pIdx, 1);
    S.saveTrip(trip);
    refreshDay();
  }

  /* ================= 검색 (장소/주변 맛집) ================= */
  let lastSearchResults = [];
  function openSearchModal(mode) {
    const trip = currentTrip(); if (!trip) return;
    const body =
      '<div class="field"><input type="text" id="srQuery" placeholder="' +
      (mode === 'nearby'
        ? (activeDay > 0 ? '선택한 일자 첫 장소 주변 맛집 — 반경 약 1.2km' : '지도 중심 주변 맛집 — 반경 약 1.2km (일자 탭 선택 시 그날 첫 장소 기준)')
        : '예: 오타루 초밥, 삿포로 스프카레') + '"></div>' +
      '<button class="btn btn-primary btn-block" data-srgo>' + (mode === 'nearby' ? '🍜 주변 맛집 찾기' : '🔍 검색') + '</button>' +
      '<div id="srResults" style="margin-top:12px"></div>' +
      '<div class="hint">결과의 [추가]는 현재 선택한 일자 맨 뒤에 넣어요. ' +
      (activeDay === 0 ? '<b>일자 탭을 먼저 선택하면 그날 일정에 추가됩니다.</b>' : '') + '</div>';
    showModal(mode === 'nearby' ? '주변 맛집' : '장소 검색', body);
    const q = $('#srQuery');
    q.addEventListener('keydown', e => { if (e.key === 'Enter') { const v = q.value.trim(); v ? runSearch(v) : toast('검색어를 입력해 주세요'); } });
    if (mode === 'nearby') {
      if (!M.isReady()) { toast('지도를 기다리는 중이에요'); return; }
      runNearby();
    } else {
      q.focus();
    }
  }

  async function runSearch(query) {
    if (!M.isReady()) { toast('지도를 기다리는 중이에요'); return; }
    const c = M.getCenter();
    const resEl = $('#srResults');
    resEl.innerHTML = '<div class="hint">검색 중…</div>';
    const r = await M.searchText(query, c);
    lastSearchResults = r.results;
    if (!r.ok) {
      resEl.innerHTML = '<div class="empty"><p>검색 실패 (' + esc(r.status) + ')</p>' +
        '<p class="hint">잠시 후 다시 시도해 주세요. 계속되면 Google Cloud 할당량을 확인해 보세요.</p></div>';
      return;
    }
    renderSearchResults(r.results, resEl);
  }

  async function runNearby() {
    const resEl = $('#srResults');
    resEl.innerHTML = '<div class="hint">주변 맛집 찾는 중…</div>';
    const trip = currentTrip();
    let center = M.getCenter();
    // 일자 선택 시 그날 첫 장소 기준으로 (지도 중심은 홋카이도 전체라 빈 결과 나오기 쉬움)
    if (activeDay > 0 && trip && trip.days[activeDay - 1] && trip.days[activeDay - 1].places.length) {
      const p = trip.days[activeDay - 1].places[0];
      center = { lat: p.lat, lng: p.lng };
    }
    const r = await M.nearbyFood(center, 1200);
    lastSearchResults = r.results;
    if (!r.ok) {
      resEl.innerHTML = '<div class="empty"><p>검색 실패 (' + esc(r.status) + ')</p>' +
        '<p class="hint">잠시 후 다시 시도해 주세요. 계속되면 Google Cloud 할당량을 확인해 보세요.</p></div>';
      return;
    }
    renderSearchResults(r.results, resEl);
  }

  function renderSearchResults(results, resEl) {
    if (!results.length) { resEl.innerHTML = '<div class="empty"><p>결과가 없어요. 검색어를 바꾸거나 지도를 이동해 보세요.</p></div>'; return; }
    resEl.innerHTML = results.map((r, i) => {
      const star = r.rating ? '<span class="star">★ ' + r.rating + '</span> <span style="color:var(--muted)">(' + r.reviews + ')</span>' : '';
      const open = r.open == null ? '' : (r.open ? ' · 영업 중' : ' · 영업 종료');
      const price = r.price ? ' · ' + '$'.repeat(r.price) : '';
      return '<div class="sr-row">' +
        '<div class="sr-main"><button class="sr-name-btn" data-srdetail="' + i + '" data-idx="' + i + '" title="상세 정보 보기">' + esc(r.name) + '</button>' +
        '<div class="sr-meta">' + star + open + price + '<br>' + esc(r.address) + '</div></div>' +
        '<div style="display:flex;gap:6px;flex-direction:column">' +
        '<button class="btn btn-primary" style="min-height:40px;padding:0 12px;font-size:13.5px" data-sradd="' + i + '" data-idx="' + i + '">추가</button>' +
        '<button class="btn btn-ghost" style="min-height:40px;padding:0 12px;font-size:13.5px" data-srpan="' + i + '" data-idx="' + i + '">지도</button>' +
        '</div></div>';
    }).join('');
  }

  function addSearchResult(idx, btn) {
    const trip = currentTrip(); const r = lastSearchResults[idx];
    if (!trip || !r) return;
    if (activeDay === 0) { openPlaceDetail(idx); return; } // 전체 탭 → 상세(일자 선택)로 안내
    addSearchResultToDay(r, activeDay - 1);
    if (btn) { btn.textContent = '✓ 추가됨'; btn.disabled = true; btn.classList.add('added'); }
  }

  function addSearchResultToDay(r, dayIdx) {
    const trip = currentTrip(); if (!trip) return;
    const day = trip.days[dayIdx]; if (!day) return;
    const cat = (r.name || '').includes('카페') || (r.name || '').toLowerCase().includes('cafe') ? 'cafe' : 'restaurant';
    day.places.push({
      id: S.uid(), name: r.name, category: cat, lat: r.lat, lng: r.lng,
      note: (r.rating ? '★ ' + r.rating + ' (리뷰 ' + r.reviews + ')' : '') + (r.open == null ? '' : (r.open ? ' · 영업 중' : ' · 영업 종료')),
      tags: ['검색 추가'], links: {}
    });
    S.saveTrip(trip);
    refreshDay();
  }

  // 가게 상세: 이름 클릭 시 영업시간·전화·웹사이트 + 일자 선택 추가
  async function openPlaceDetail(idx) {
    const r = lastSearchResults[idx];
    if (!r) return;
    const trip = currentTrip();
    const dayOpts = trip ? trip.days.map((d, i) =>
      '<option value="' + i + '">' + (i + 1) + '일차 · ' + esc(d.title) + '</option>').join('') : '';
    const defaultDay = activeDay > 0 ? activeDay - 1 : 0;
    const body =
      '<div style="font-size:18px;font-weight:900;margin-bottom:2px">' + esc(r.name) + '</div>' +
      '<div class="sr-meta">' + (r.rating ? '<span class="star">★ ' + r.rating + '</span> (' + r.reviews + ')' : '') +
        (r.open == null ? '' : (r.open ? ' · 영업 중' : ' · 영업 종료')) +
        (r.price ? ' · ' + '$'.repeat(r.price) : '') + '</div>' +
      '<div style="font-size:14px;color:var(--muted);margin:4px 0 8px">' + esc(r.address) + '</div>' +
      '<div id="pdExtra" class="hint">상세 정보 불러오는 중…</div>' +
      '<div class="field" style="margin-top:12px"><label>일정에 추가할 날짜</label>' +
        '<select id="pdDay">' + dayOpts + '</select></div>' +
      '<div style="display:flex;gap:8px;margin-top:4px">' +
        '<button id="pdAdd" class="btn btn-primary" style="flex:1">일정에 추가</button>' +
        '<button id="pdMap" class="btn btn-ghost" style="flex:1">지도</button>' +
      '</div>' +
      '<a class="tp-link" style="margin-top:10px" href="' + r.url + '" target="_blank" rel="noopener">📍 Google 지도에서 열기</a>';
    showModal('가게 정보', body);
    const sel = $('#pdDay');
    if (sel && trip) sel.value = String(defaultDay);
    // 상세 정보 비동기 로드 (영업시간·전화·웹사이트)
    const extra = await M.placeDetails(r.placeId);
    const ex = $('#pdExtra');
    if (extra && ex) {
      let h = '';
      if (extra.hours && extra.hours.length) h += '<div style="margin-top:6px">🕐 ' + extra.hours.join('<br>🕐 ') + '</div>';
      if (extra.phone) h += '<div style="margin-top:6px">📞 ' + esc(extra.phone) + '</div>';
      if (extra.website) h += '<div style="margin-top:6px">🌐 <a href="' + esc(extra.website) + '" target="_blank" rel="noopener">' + esc(extra.website.replace(/^https?:\/\//, '')) + '</a></div>';
      ex.innerHTML = h || '<span class="hint">추가 정보 없음</span>';
    } else if (ex) {
      ex.textContent = '추가 정보를 불러오지 못했어요 (네트워크/할당량 확인)';
    }
    $('#pdAdd').addEventListener('click', () => {
      const dayIdx = Number($('#pdDay').value);
      addSearchResultToDay(r, dayIdx);
      closeModal();
      toast('「' + r.name + '」 ' + (dayIdx + 1) + '일차에 추가했어요');
    });
    $('#pdMap').addEventListener('click', () => { closeModal(); M.panTo(r.lat, r.lng); });
  }

  /* ================= 경로 ================= */
  function openRouteSelectModal() {
    const trip = currentTrip(); if (!trip) return;
    if (activeDay === 0) { toast('일자 탭을 먼저 선택해 주세요'); return; }
    const day = trip.days[activeDay - 1];
    if (!day || day.places.length < 2) { toast('경로를 보려면 장소가 2개 이상 필요해요'); return; }
    const prevSel = routeSelection && routeSelection.dayIdx === activeDay - 1 ? routeSelection.placeIds : null;
    const seg = '<div class="seg">' + Object.keys(MODE_LABEL).map(m =>
      '<button data-rmode="' + m + '" class="' + (routeMode === m ? 'on' : '') + '">' + MODE_LABEL[m] + '</button>').join('') + '</div>';
    const items = day.places.map((p, i) => {
      const cat = catInfo(p);
      const checked = !prevSel || prevSel.indexOf(p.id) >= 0;
      return '<label class="rs-row"><input type="checkbox" data-ridx="' + i + '"' + (checked ? ' checked' : '') + '><span>' + cat.emoji + ' ' + esc(p.name) + '</span></label>';
    }).join('');
    const body =
      '<div class="field"><label>이동 수단</label>' + seg + '</div>' +
      '<div class="field"><label>경로에 포함할 장소 (일정 순서대로 연결)</label>' +
      '<div class="rs-list">' + items + '</div></div>' +
      '<div class="hint">숙소 → 식당처럼 필요한 곳만 골라 보세요. 순서는 일정 순서를 따릅니다.</div>' +
      '<button id="rsGo" class="btn btn-primary btn-block" style="margin-top:12px">🚗 경로 그리기</button>';
    showModal('경로 장소 선택', body);
    const segBtns = document.querySelectorAll('#modalRoot [data-rmode]');
    segBtns.forEach(b => b.addEventListener('click', () => {
      routeMode = b.dataset.mode;
      segBtns.forEach(x => x.classList.toggle('on', x === b));
    }));
    $('#rsGo').addEventListener('click', () => {
      const ids = [];
      document.querySelectorAll('#modalRoot [data-ridx]:checked').forEach(c => ids.push(day.places[Number(c.dataset.ridx)].id));
      closeModal();
      if (ids.length < 2) { toast('경로에 포함할 장소를 2개 이상 선택해 주세요'); return; }
      routeSelection = { dayIdx: activeDay - 1, placeIds: ids };
      view = 'map';
      applyView();
      drawDayRoute(day.places.filter(p => ids.indexOf(p.id) >= 0));
    });
  }

  function drawDayRoute(placesOverride) {
    const trip = currentTrip(); if (!trip) return;
    if (activeDay === 0) { drawAllDays(); return; }
    const day = trip.days[activeDay - 1];
    if (!M.isReady()) { toast('지도를 기다리는 중이에요'); return; }
    let places = placesOverride;
    if (!places && routeSelection && routeSelection.dayIdx === activeDay - 1) {
      places = day.places.filter(p => routeSelection.placeIds.indexOf(p.id) >= 0);
    }
    if (!places) places = day.places;
    if (places.length < 2) { toast('경로에 선택한 장소가 2개 이상이어야 해요'); return; }
    showRoutePanel(null);
    const color = dayColor(activeDay - 1);
    // 안전 가드: 어떤 경우에도 '계산 중' 무한 대기 방지
    let guard = setTimeout(() => renderRouteResult({ error: '경로 계산이 오래 걸리고 있어요. 네트워크를 확인하고 다시 시도해 주세요.' }), 45000);
    const finish = (r) => { clearTimeout(guard); renderRouteResult(r); };
    try {
      if (routeMode === 'TRANSIT') M.drawTransit(places, color, finish);
      else M.drawRoute(places, routeMode, color, finish);
    } catch (e) { clearTimeout(guard); renderRouteResult({ error: '경로 요청 오류: ' + e.message }); }
  }

  // 전체 보기: 5일 동선을 일자별 색으로 한 지도에 표시
  async function drawAllDays() {
    const trip = currentTrip(); if (!trip) return;
    if (!M.isReady()) { toast('지도를 기다리는 중이에요'); return; }
    const days = trip.days.map((d, i) => ({ d, i }))
      .filter(x => x.d.places.filter(p => isFinite(p.lat) && isFinite(p.lng)).length >= 2);
    if (!days.length) { toast('경로를 보려면 장소가 2개 이상인 일자가 필요해요'); return; }
    M.clearRoute();
    showRoutePanel(null);
    const el = $('#routeInfo');
    const hint = el.querySelector('.hint');
    hint.textContent = '일자별 동선 계산 중…';
    const mode = routeMode;
    let done = 0;
    for (const { d, i } of days) {
      const places = d.places.filter(p => isFinite(p.lat) && isFinite(p.lng));
      const line = document.createElement('div');
      line.className = 'leg';
      line.innerHTML = '<b>' + (i + 1) + '일차 · ' + esc(d.title) + '</b> <span class="tm">계산 중…</span>';
      hint.insertAdjacentElement('beforebegin', line);
      let res = null;
      try {
        res = await new Promise(cb => {
          if (mode === 'TRANSIT') M.drawTransit(places, dayColor(i), cb, { keep: true });
          else M.drawRoute(places, mode, dayColor(i), cb, { keep: true });
        });
      } catch (e) { res = { error: e.message }; }
      const tm = line.querySelector('.tm');
      if (!res || res.error) tm.textContent = res && res.error ? '실패 (' + res.error + ')' : '실패';
      else if (res.transit) tm.textContent = '구간 ' + res.legs.length + '개';
      else tm.textContent = res.dist + 'km · 약 ' + res.time + '분';
      done++;
    }
    hint.textContent = '전체 동선 완료 — ' + done + '개 일자 · 색상은 일자별';
  }

  /* ================= 인라인 경로 모드 ================= */
  function applyRouteMode() {
    const bar = $('#routeBar');
    const seg = $('#routeBarSeg');
    bar.classList.toggle('hidden', !routeModeOn);
    if (routeModeOn) {
      seg.innerHTML = Object.keys(MODE_LABEL).map(m =>
        '<button data-mode="' + m + '" class="' + (routeMode === m ? 'on' : '') + '">' + MODE_LABEL[m] + '</button>').join('');
      refreshDay();
      scheduleRouteDraw();
    } else {
      clearTimeout(routeDrawTimer);
      hideRoute();
      refreshDay();
    }
  }

  function scheduleRouteDraw() {
    clearTimeout(routeDrawTimer);
    routeDrawTimer = setTimeout(drawFromInlineSelection, 700);
  }

  function drawFromInlineSelection() {
    const trip = currentTrip(); if (!trip) return;
    if (activeDay === 0 || !routeModeOn) return;
    const day = trip.days[activeDay - 1];
    if (!day) return;
    const ids = Array.from(document.querySelectorAll('#placeList .pcheck:checked')).map(c => c.dataset.pcheck);
    $('#rbCount').textContent = ids.length + '곳 선택';
    const places = day.places.filter(p => ids.indexOf(p.id) >= 0);
    if (places.length < 2) { hideRoute(); return; }
    routeSelection = { dayIdx: activeDay - 1, placeIds: ids };
    drawDayRoute(places);
  }

  const MODE_LABEL = { DRIVING: '🚗 차', TRANSIT: '🚌 대중교통', WALKING: '🚶 도보' };

  function showRoutePanel(active) {
    const el = $('#routeInfo');
    el.classList.remove('hidden');
    const seg = '<div class="seg">' + Object.keys(MODE_LABEL).map(m =>
      '<button data-mode="' + m + '" class="' + (routeMode === m ? 'on' : '') + '">' + MODE_LABEL[m] + '</button>').join('') + '</div>';
    const close = '<div style="text-align:right"><button id="routeClose" style="color:var(--muted);font-size:13px">✕ 닫기</button></div>';
    if (active == null) el.innerHTML = seg + '<div class="hint">경로 계산 중…</div>' + close;
    else el.innerHTML = seg + active + close;
  }

  function renderRouteResult(r) {
    if (r.error) { showRoutePanel('<div style="color:var(--danger)">' + esc(r.error) + '</div>'); return; }
    if (r.transit) {
      let h = '';
      r.legs.forEach((leg, i) => {
        h += '<div class="leg"><b>' + (i + 1) + '. ' + esc(leg.from) + ' → ' + esc(leg.to) + '</b>' +
          '<span class="tm">' + esc(leg.dur) + (leg.dist ? ' · ' + esc(leg.dist) : '') + '</span>';
        if (leg.noTransit) {
          h += '<div class="tt-note">🚌 대중교통 정보 없음(구글 미지원 구간) — [시간표 · 이동]의 공식 사이트에서 확인해 주세요</div>';
        } else if (leg.walkOnly) {
          h += '<div class="tt-note">🚶 도보 이동 (대중교통 구간 없음)</div>';
        } else {
          leg.transit.forEach(t => {
            h += '<div class="tt-row">' +
              '<span class="tt-line">' + (t.vehicle === 'BUS' ? '🚌' : '🚄') + ' ' + esc(t.line) + '</span>' +
              (t.depT ? '<span class="tt-time">' + esc(t.depT) + '</span>' : '') +
              '<span class="tt-stops">' + esc(t.dep) + ' → ' + esc(t.arr) + '</span>' +
              (t.arrT ? '<span class="tt-time">' + esc(t.arrT) + '</span>' : '') +
              '<span class="tm">' + esc(t.dur) + '</span></div>';
          });
        }
        h += '</div>';
      });
      showRoutePanel(h);
    } else {
      let h = '<div class="leg" style="border-top:none"><b>전체 ' + esc(r.dist) + 'km · 약 ' + esc(r.time) + '분</b></div>';
      r.legs.forEach((leg, i) => {
        h += '<div class="leg"><b>' + (i + 1) + '. ' + esc(leg.from) + ' → ' + esc(leg.to) + '</b>' +
          '<span class="tm">' + esc(leg.dur) + ' · ' + esc(leg.dist) + '</span>' +
          (leg.line ? '<div><span class="line">' + esc(leg.vehicle === 'BUS' ? '🚌' : '🚄') + ' ' + esc(leg.line) + '</span></div>' : '') +
          '</div>';
      });
      showRoutePanel(h);
    }
  }

  function hideRoute() { $('#routeInfo').classList.add('hidden'); M.clearRoute(); }

  /* ================= 이동/시간표 ================= */
  function openTransportModal() {
    const trip = currentTrip(); if (!trip) return;
    let guides;
    if (activeDay === 0) {
      guides = trip.days.map((d, i) => '<div class="tp-guide"><b>' + (i + 1) + '일차 · ' + esc(d.title) + '</b>\n' + esc(d.transport || '이동 정보 없음') + '</div>').join('');
    } else {
      const day = trip.days[activeDay - 1];
      guides = '<div class="tp-guide">' + esc(day.transport || '이동 정보 없음') + '</div>';
    }
    const links = D.TRANSPORT_LINKS.map(l =>
      '<a class="tp-link" href="' + l.url + '" target="_blank" rel="noopener">' + l.emoji + ' ' + esc(l.name) + '</a>').join('');
    const body =
      '<div class="tp-list">' + guides + '</div>' +
      '<h4 style="margin:14px 0 8px;font-size:15px">📅 공식 시간표 · 예약 사이트</h4>' +
      links +
      '<div class="tp-guide" style="margin-top:14px">💡 팁: 지도 오른쪽 [경로] → [대중교통]을 누르면 구간별 버스·열차와 출발/도착 시간을 바로 보여줘요. (구글 데이터 기준)</div>';
    showModal('이동 · 시간표', body);
  }

  /* ================= 리포트 ================= */
  async function openReport() {
    const trip = currentTrip(); if (!trip) return;
    const res = await FTReport.build(trip);
    const body =
      '<div class="no-print" style="display:flex;gap:8px;margin-bottom:14px">' +
      '<button id="rpPrint" class="btn btn-primary" style="flex:1">🖨️ PDF로 저장</button>' +
      '<button id="rpClose" class="btn btn-ghost" style="flex:1">닫기</button></div>' +
      '<div class="hint no-print" style="margin-bottom:12px">사진 ' + res.photoCount + '장 · 리포트는 인쇄 미리보기에서 PDF로 저장할 수 있어요.</div>' +
      res.html;
    showModal('여행 리포트', body);
    $('#rpPrint').addEventListener('click', () => window.print());
    $('#rpClose').addEventListener('click', closeModal);
  }

  /* ================= 설정 ================= */
  async function openSettings() {
    const trip = currentTrip();
    const photoCount = await S.countPhotos();
    const body =
      '<div class="field"><label>새 여행 추가</label>' +
      '<input type="text" id="stName" placeholder="여행 이름 (예: 도쿄 가족여행)"><div style="display:flex;gap:8px;margin-top:8px">' +
      '<input type="date" id="stStart" style="flex:1"><input type="date" id="stEnd" style="flex:1"></div>' +
      '<button id="stAdd" class="btn btn-primary btn-block" style="margin-top:10px">여행 추가</button></div>' +
      '<div class="set-row"><span>현재 여행: <b>' + esc(trip ? trip.name : '') + '</b></span>' +
      '<button id="stDel" class="btn btn-danger" style="min-height:40px">삭제</button></div>' +
      '<div class="set-row"><span>데이터 백업 (일정·메모)</span>' +
      '<button id="stExport" class="btn btn-ghost" style="min-height:40px">내보내기</button></div>' +
      '<div class="set-row"><span>백업 불러오기</span>' +
      '<button id="stImport" class="btn btn-ghost" style="min-height:40px">가져오기</button></div>' +
      '<div class="set-row"><span>저장된 사진</span><span>' + photoCount + '장 <span class="hint">(이 기기에만 저장)</span></span></div>' +
      '<div class="set-row"><span>모든 데이터 초기화</span>' +
      '<button id="stReset" class="btn btn-danger" style="min-height:40px">초기화</button></div>' +
      '<div class="hint" style="margin-top:12px">사진은 기기 안에만 저장돼요. 리포트 PDF 저장으로 보존하세요. 일정·메모는 백업 파일로 옮길 수 있어요.</div>';
    showModal('설정', body);
    $('#stAdd').addEventListener('click', () => {
      const name = $('#stName').value.trim();
      const s = $('#stStart').value, e = $('#stEnd').value;
      if (!name || !s || !e) { toast('이름과 날짜를 입력해 주세요'); return; }
      if (e < s) { toast('종료일이 시작일보다 빠를 수 없어요'); return; }
      S.addTrip(name, s, e);
      activeDay = 0;
      renderTrips(); renderTabs(); refreshDay();
      closeModal();
      toast('여행을 추가했어요');
    });
    $('#stDel').addEventListener('click', () => {
      if (!confirm('현재 여행을 삭제할까요? (사진 제외, 일정만 삭제)')) return;
      S.deleteTrip(trip.id);
      activeDay = 0;
      renderTrips(); renderTabs(); refreshDay();
      closeModal();
      toast('여행을 삭제했어요');
    });
    $('#stExport').addEventListener('click', () => { S.exportJSON(); toast('백업 파일을 저장했어요'); });
    $('#stImport').addEventListener('click', () => $('#importInput').click());
    $('#stReset').addEventListener('click', () => {
      if (!confirm('모든 여행·일정·사진을 지우고 기본 예시로 되돌릴까요?')) return;
      localStorage.removeItem('ft-state-v1');
      indexedDB.deleteDatabase('ft-photos');
      S.ensureSeed();
      activeDay = 0;
      renderTrips(); renderTabs(); refreshDay();
      closeModal();
      toast('초기화했어요');
    });
  }

  function onImportFile(e) {
    const f = e.target.files[0]; e.target.value = '';
    if (!f) return;
    S.importJSON(f).then(r => {
      activeDay = 0;
      renderTrips(); renderTabs(); refreshDay();
      closeModal();
      toast('백업을 불러왔어요 (' + r.trips + '개 여행)');
    }).catch(err => toast('불러오기 실패: ' + err.message));
  }

  /* ================= 사진 ================= */
  async function onPhotoFile(e) {
    const f = e.target.files[0]; e.target.value = '';
    if (!f || !pendingPhoto) return;
    const ctx = pendingPhoto; pendingPhoto = null;
    try {
      const dataUrl = await S.compressImage(f);
      const trip = currentTrip();
      const place = trip.days[ctx.dayIdx].places[ctx.pIdx];
      await S.addPhoto(trip.id, place.id, { id: S.uid(), dataUrl, ts: Date.now() });
      refreshDay();
      toast('사진을 저장했어요');
    } catch (err) {
      toast(err.message || '사진 저장 실패');
    }
  }

  function openLightbox(placeId, photoId) {
    const trip = currentTrip(); if (!trip) return;
    const rows = placeRows();
    const r = rows.find(x => x.place.id === placeId);
    if (!r) return;
    const place = r.place;
    S.getPhotos(trip.id, placeId).then(photos => {
      const ph = photos.find(x => x.id === photoId);
      if (!ph) return;
      lightboxCtx = { tripId: trip.id, placeId, photoId };
      const lb = document.createElement('div');
      lb.id = 'lightbox';
      lb.innerHTML = '<img src="' + ph.dataUrl + '" alt="">';
      lb.addEventListener('click', e => {
        if (e.target.id !== 'lightbox') return;
        closeLightbox();
      });
      document.body.appendChild(lb);
      const del = document.createElement('button');
      del.textContent = '🗑️ 사진 삭제';
      del.style.cssText = 'position:fixed;bottom:28px;left:50%;transform:translateX(-50%);background:#C0453E;color:#fff;border:none;border-radius:12px;padding:12px 20px;font-size:15px;font-weight:700';
      del.addEventListener('click', async () => {
        await S.deletePhoto(lightboxCtx.tripId, lightboxCtx.placeId, lightboxCtx.photoId);
        closeLightbox();
        refreshDay();
        toast('사진을 삭제했어요');
      });
      lb.appendChild(del);
    });
  }
  function closeLightbox() { const lb = document.getElementById('lightbox'); if (lb) lb.remove(); lightboxCtx = null; }

  /* ================= 공통 ================= */
  function showModal(title, bodyHtml) {
    closeModal();
    const overlay = document.createElement('div');
    overlay.className = 'modal-overlay';
    overlay.innerHTML = '<div class="modal"><div class="modal-head"><h3>' + esc(title) + '</h3>' +
      '<button class="modal-x" type="button">✕</button></div><div class="modal-body">' + bodyHtml + '</div></div>';
    $('#modalRoot').appendChild(overlay);
  }
  function closeModal() { $('#modalRoot').innerHTML = ''; }

  function toast(msg) {
    const el = $('#mapMsg');
    el.textContent = msg;
    el.classList.remove('hidden');
    clearTimeout(toastTimer);
    toastTimer = setTimeout(() => el.classList.add('hidden'), 2600);
  }

  document.addEventListener('DOMContentLoaded', boot);
})();
