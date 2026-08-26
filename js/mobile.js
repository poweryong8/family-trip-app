// 모바일 전용 UI: 하단 탭 · 전체화면 지도 · 드래그 바텀시트 · FAB
// 데이터/지도 로직은 데스크톱과 공유 (data/storage/maps/report)
(function () {
  const $ = s => document.querySelector(s);
  const D = FTA_DATA, S = FTStore, M = FTMap;

  let activeDay = 0;          // 0=전체, 1..n=일차
  let tab = 'map';            // 'map' | 'list' | 'move' | 'more'
  let routeModeOn = false;    // 경로 모드 (출발지·도착지 선택)
  let routeMode = 'DRIVING';
  let routePick = null;       // { originId, destId }
  let routePickResults = [];  // 경로 모달 '다른 장소' 검색 결과
  let routePanelExpanded = false; // 경로 카드 구간 상세 펼침
  let lastRoutePanel = null;      // { summary, detail }
  let mapsReady = false;
  let pendingPhoto = null;
  let lightboxCtx = null;
  let toastTimer = null;
  let lastSearchResults = [];

  // 바텀시트 상태
  const SHEET_PEEK = 118;   // 일반 접힘 높이
  const ROUTE_PEEK = 236;   // 경로 모드 접힘 높이 (출발/도착 바 포함)
  let sheetState = 'half';    // 'peek' | 'half' | 'full'
  let drag = null;            // 시트 드래그 중 상태

  const MODE_LABEL = { DRIVING: '🚗 차', TRANSIT: '🚌 대중교통', WALKING: '🚶 도보' };

  function esc(s) {
    return String(s == null ? '' : s).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  }
  function catInfo(p) { return D.CATEGORIES[p.category] || D.CATEGORIES.other; }
  function dayColor(i) { return D.DAY_COLORS[i % D.DAY_COLORS.length]; }
  function currentTrip() { return S.activeTrip(); }

  /* ================= 부팅 ================= */
  function boot() {
    S.ensureSeed();
    const st = S.getState();
    st.trips.forEach(t => t.days.forEach(d => d.places.forEach(p => { if (!p.id) p.id = S.uid(); })));
    S.saveState(st);
    wire();
    renderTripName();
    renderChips();
    refreshDay();
    M.init();
    window.addEventListener('ftmapsready', () => { mapsReady = true; refreshDay(); });
    window.addEventListener('ftmapsfail', e => toast(e.detail || '지도를 불러오지 못했어요'));
  }

  /* ================= 이벤트 ================= */
  function wire() {
    $('#tabbar').addEventListener('click', e => {
      const b = e.target.closest('[data-tab]'); if (!b) return;
      switchTab(b.dataset.tab);
    });
    $('#btnSettings').addEventListener('click', () => switchTab('more'));
    $('#tripBtn').addEventListener('click', openTripModal);
    $('#btnAddPlace').addEventListener('click', () => openPlaceModal(null));
    $('#btnEmptySearch').addEventListener('click', () => openSearchModal('search'));
    $('#btnSearch').addEventListener('click', () => openSearchModal('search'));
    $('#btnNearby').addEventListener('click', () => openSearchModal('nearby'));
    $('#btnRoute').addEventListener('click', () => {
      if (routeModeOn) { exitRouteMode(); return; }
      if (activeDay === 0) { drawAllDays(); return; }
      enterRouteMode();
    });

    $('#dayChips').addEventListener('click', e => {
      const b = e.target.closest('.day-chip'); if (!b) return;
      activeDay = Number(b.dataset.day);
      if (routeModeOn) {
        if (activeDay === 0) exitRouteMode();
        else { routePick = { originId: null, destId: null }; hideRoute(); }
      }
      hideRoute();
      renderChips();
      refreshDay();
      if (tab === 'move') renderMove();
      if (routeModeOn) renderRoutePickBar();
    });

    function onPlaceListClick(e) {
      const thumb = e.target.closest('.thumb');
      if (thumb) { openLightbox(thumb.dataset.place, thumb.dataset.ph); return; }
      const pk = e.target.closest('[data-pick]');
      if (pk && routeModeOn) { tapEndpoint(pk.dataset.pick); return; }
      const btn = e.target.closest('[data-act]');
      if (!btn) return;
      const dayIdx = Number(btn.dataset.day);
      const pIdx = Number(btn.dataset.idx);
      const act = btn.dataset.act;
      if (act === 'photo') { pendingPhoto = { dayIdx, pIdx, placeId: btn.dataset.place }; $('#photoInput').click(); }
      else if (act === 'edit') openPlaceModal({ dayIdx, pIdx });
      else if (act === 'del') deletePlace(dayIdx, pIdx);
      else if (act === 'rtdel') {
        removeExtra(btn.dataset.rtid);
        refreshDay();
      }
    }
    $('#placeList').addEventListener('click', onPlaceListClick);
    $('#itinerary').addEventListener('click', onPlaceListClick);
    $('#itinerary').addEventListener('click', e => {
      const rb = e.target.closest('[data-itroute]');
      if (!rb) return;
      const di = Number(rb.dataset.itroute);
      activeDay = di + 1;
      hideRoute();
      renderChips();
      refreshDay();
      switchTab('map');
      enterRouteMode();
    });

    // 경로 패널 (지도 상단 카드 + 시트 내부 공용)
    const routePanelClick = e => {
      if (e.target.closest('#routeClose')) { hideRoute(); return; }
      if (e.target.closest('[data-rptoggle]')) { routePanelExpanded = !routePanelExpanded; renderRoutePanel(); return; }
      const seg = e.target.closest('[data-mode]');
      if (seg) setRouteMode(seg.dataset.mode);
    };
    $('#routeInfo').addEventListener('click', routePanelClick);
    $('#sheetRouteInfo').addEventListener('click', routePanelClick);

    $('#routeBar').addEventListener('click', e => {
      const seg = e.target.closest('[data-mode]');
      if (seg) { setRouteMode(seg.dataset.mode); return; }
      if (e.target.closest('#rbAdd')) { openRoutePicker(); return; }
      if (e.target.closest('#rbExit')) { exitRouteMode(); return; }
      const clr = e.target.closest('[data-pickclear]');
      if (clr) { clearEndpoint(clr.dataset.pickclear); return; }
      const pkb = e.target.closest('[data-pickbtn]');
      if (pkb) { openPickModal(pkb.dataset.pickbtn); return; }
    });

    // 모달 공통 (검색/상세/오버레이)
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
      if (pan) {
        const idx = Number(pan.dataset.idx); const it = lastSearchResults[idx];
        if (it) { closeModal(); switchTab('map'); M.panTo(it.lat, it.lng); }
      }
    });
    document.addEventListener('keydown', e => { if (e.key === 'Escape') { closeModal(); closeLightbox(); } });

    $('#photoInput').addEventListener('change', onPhotoFile);
    $('#importInput').addEventListener('change', onImportFile);

    // 더보기 탭: 카드 액션 (이벤트 위임)
    $('#moreView').addEventListener('click', async e => {
      const b = e.target.closest('[data-act]'); if (!b) return;
      const act = b.dataset.act;
      if (act === 'add-trip') {
        const name = $('#stName').value.trim();
        const s = $('#stStart').value, en = $('#stEnd').value;
        if (!name || !s || !en) { toast('이름과 날짜를 입력해 주세요'); return; }
        if (en < s) { toast('종료일이 시작일보다 빠를 수 없어요'); return; }
        S.addTrip(name, s, en);
        afterTripChange();
        toast('여행을 추가했어요');
      } else if (act === 'del-trip') {
        const trip = currentTrip();
        if (!trip || !confirm('현재 여행을 삭제할까요? (일정만 삭제, 사진 유지)')) return;
        S.deleteTrip(trip.id);
        afterTripChange();
        toast('여행을 삭제했어요');
      } else if (act === 'report') { openReport(); }
      else if (act === 'export') { S.exportJSON(); toast('백업 파일을 저장했어요'); }
      else if (act === 'import') { $('#importInput').click(); }
      else if (act === 'reset') {
        if (!confirm('모든 여행·일정·사진을 지우고 기본 예시로 되돌릴까요?')) return;
        localStorage.removeItem('ft-state-v1');
        indexedDB.deleteDatabase('ft-photos');
        S.ensureSeed();
        afterTripChange();
        toast('초기화했어요');
      }
    });

    // 바텀시트 드래그 (pointer events)
    const grip = $('#sheetGrip');
    grip.addEventListener('pointerdown', e => {
      drag = { y: e.clientY, h: $('#sheet').offsetHeight, moved: false };
      $('#sheet').classList.add('dragging');
      grip.setPointerCapture(e.pointerId);
    });
    grip.addEventListener('pointermove', e => {
      if (!drag) return;
      const dy = e.clientY - drag.y;
      if (Math.abs(dy) > 4) drag.moved = true;
      const stageH = $('#stage').offsetHeight;
      const h = Math.min(stageH, Math.max(SHEET_PEEK, drag.h - dy));
      $('#sheet').style.height = h + 'px';
      document.documentElement.style.setProperty('--sheet-h', h + 'px');
    });
    const endDrag = () => {
      if (!drag) return;
      $('#sheet').classList.remove('dragging');
      if (!drag.moved) setSheet(sheetState === 'peek' ? 'half' : 'peek'); // 탭: peek ↔ 절반
      else {
        const stageH = $('#stage').offsetHeight;
        const h = $('#sheet').offsetHeight;
        if (h > stageH * 0.72) setSheet('full');
        else if (h > stageH * 0.30) setSheet('half');
        else setSheet('peek');
      }
      drag = null;
    };
    grip.addEventListener('pointerup', endDrag);
    grip.addEventListener('pointercancel', endDrag);
  }

  /* ================= 탭 ================= */
  function switchTab(t) {
    if (t === tab) return;
    tab = t;
    if (t !== 'map' && routeModeOn) exitRouteMode();
    document.querySelectorAll('#tabbar [data-tab]').forEach(b => b.classList.toggle('on', b.dataset.tab === t));
    // 지도는 항상 렌더 유지 (display:none 시 구글맵 글리치 방지) — panelView가 덮음
    $('#sheet').classList.toggle('hidden', t !== 'map');
    $('#panelView').classList.toggle('hidden', t === 'map');
    $('#itinerary').classList.toggle('hidden', t !== 'list');
    $('#moveView').classList.toggle('hidden', t !== 'move');
    $('#moreView').classList.toggle('hidden', t !== 'more');
    if (t === 'list') renderItinerary();
    else if (t === 'move') renderMove();
    else if (t === 'more') renderMore();
  }

  /* ================= 렌더링 ================= */
  function renderTripName() {
    const trip = currentTrip();
    $('#tripName').textContent = trip ? trip.name : '여행';
  }

  function renderChips() {
    const trip = currentTrip(); if (!trip) return;
    let h = '<button class="day-chip' + (activeDay === 0 ? ' active' : '') + '" data-day="0" style="--chip-color:#2F6D80"><span>전체</span></button>';
    trip.days.forEach((d, i) => {
      const short = d.date ? d.date.slice(5).replace('-', '/') : (i + 1) + '일';
      h += '<button class="day-chip' + (activeDay === i + 1 ? ' active' : '') + '" data-day="' + (i + 1) + '" style="--chip-color:' + dayColor(i) + '">' +
        '<span class="cd">' + short + '</span><span>' + esc(d.title) + '</span></button>';
    });
    $('#dayChips').innerHTML = h;
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
      row.className = 'place-row' + (rm ? ' rm' : '') +
        (rm && routePick && routePick.originId === p.id ? ' pick-origin' : '') +
        (rm && routePick && routePick.destId === p.id ? ' pick-dest' : '');
      if (rm) {
        const badge = routePick && routePick.originId === p.id ? '<span class="pick-badge origin">🚩 출발</span>'
          : routePick && routePick.destId === p.id ? '<span class="pick-badge dest">🏁 도착</span>' : '';
        row.innerHTML =
          '<div class="pmain" data-pick="' + p.id + '">' +
            '<div class="pname">' + cat.emoji + ' ' + esc(p.name) + badge +
              (r.extra ? ' <span class="rt-badge">경로 전용</span>' : '') +
              ' <span class="cat">' + cat.label + '</span></div>' +
            (p.note ? '<div class="pnote">' + esc(p.note) + '</div>' : '') +
            tags +
          '</div>' +
          (r.extra ? '<button class="rt-del" data-act="rtdel" data-rtid="' + p.id + '" title="경로에서 제거">✕</button>' : '');
      } else {
        row.innerHTML =
          '<span class="pdot" style="background:' + dayColor(r.dayIdx) + '"></span>' +
          '<div class="pmain" data-act="edit" data-day="' + r.dayIdx + '" data-idx="' + r.pIdx + '">' +
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

  async function refreshDay() {
    const trip = currentTrip(); if (!trip) return;
    const title = $('#sheetTitle');
    if (activeDay === 0) {
      title.innerHTML = '<span>전체 일정</span><span class="cnt">' + trip.days.reduce((a, d) => a + d.places.length, 0) + '곳</span>';
    } else {
      const day = trip.days[activeDay - 1];
      title.innerHTML = '<span>' + activeDay + '일차 · ' + esc(day.title) + '</span><span class="cnt">' + day.places.length + '곳</span>';
    }

    const rows = placeRows();
    let listRows = rows;
    if (routeModeOn && activeDay > 0) {
      listRows = rows.concat(dayExtras().map(p => ({ dayIdx: activeDay - 1, pIdx: null, place: p, extra: true })));
    }
    const listEl = $('#placeList');
    const emptyEl = $('#sheetEmpty');
    if (!listRows.length) {
      listEl.innerHTML = '';
      listEl.classList.add('hidden');
      emptyEl.classList.remove('hidden');
    } else {
      emptyEl.classList.add('hidden');
      listEl.classList.remove('hidden');
      await renderRowsInto(listEl, listRows, routeModeOn);
    }

    if (mapsReady) {
      const items = rows.map(r => ({
        place: r.place, color: dayColor(r.dayIdx),
        flag: routePick && routePick.originId === r.place.id ? 'A' : (routePick && routePick.destId === r.place.id ? 'B' : null)
      }));
      M.setMarkers(items, p => {
        const hit = rows.find(r => r.place.id === p.id); if (!hit) return;
        if (routeModeOn) tapEndpoint(p.id);
        else openPlaceModal({ dayIdx: hit.dayIdx, pIdx: hit.pIdx });
      });
      M.fitBounds(rows.map(r => ({ lat: r.place.lat, lng: r.place.lng })));
    }

    if (tab === 'list') await renderItinerary();
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
          (day.places.length >= 2 ? '<button class="btn btn-ghost" data-itroute="' + di + '">🚗 경로</button>' : '') +
        '</div>' +
        (day.transport ? '<div class="it-transport">🚌 ' + esc(day.transport) + '</div>' : '') +
        '<div class="place-list it-places"></div>';
      wrap.appendChild(sec);
      const listEl = sec.querySelector('.it-places');
      if (!rows.length) listEl.innerHTML = '<div class="empty"><p>아직 장소가 없어요. 지도 탭에서 검색으로 추가해 보세요.</p></div>';
      else await renderRowsInto(listEl, rows);
    }
  }

  /* ================= 바텀시트 ================= */
  function setSheet(state, opts) {
    opts = opts || {};
    const peek = routeModeOn ? ROUTE_PEEK : SHEET_PEEK;
    const h = state === 'peek' ? peek + 'px' : state === 'half' ? '45vh' : '100%';
    const sheet = $('#sheet');
    if (!opts.instant) sheet.classList.remove('dragging');
    sheet.style.height = h;
    document.documentElement.style.setProperty('--sheet-h', h);
    sheetState = state;
    $('#fabStack').classList.toggle('hidden', state === 'full');
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
  function openSearchModal(mode) {
    const trip = currentTrip(); if (!trip) return;
    const body =
      '<div class="field"><input type="text" id="srQuery" placeholder="' +
      (mode === 'nearby'
        ? (activeDay > 0 ? '선택한 일자 첫 장소 주변 맛집 — 반경 약 1.2km' : '지도 중심 주변 맛집 — 반경 약 1.2km (일자 칩 선택 시 그날 첫 장소 기준)')
        : '예: 오타루 초밥, 삿포로 스프카레') + '"></div>' +
      '<button class="btn btn-primary btn-block" data-srgo>' + (mode === 'nearby' ? '🍜 주변 맛집 찾기' : '🔍 검색') + '</button>' +
      '<div id="srResults" style="margin-top:12px"></div>' +
      '<div class="hint">결과의 [추가]는 현재 선택한 일자 맨 뒤에 넣어요. ' +
      (activeDay === 0 ? '<b>일자 칩을 먼저 선택하면 그날 일정에 추가됩니다.</b>' : '') + '</div>';
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
        '<button class="btn btn-primary" style="min-height:42px;padding:0 12px;font-size:13.5px" data-sradd="' + i + '" data-idx="' + i + '">추가</button>' +
        '<button class="btn btn-ghost" style="min-height:42px;padding:0 12px;font-size:13.5px" data-srpan="' + i + '" data-idx="' + i + '">지도</button>' +
        '</div></div>';
    }).join('');
  }

  function addSearchResult(idx, btn) {
    const trip = currentTrip(); const r = lastSearchResults[idx];
    if (!trip || !r) return;
    if (activeDay === 0) { openPlaceDetail(idx); return; }
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
    $('#pdMap').addEventListener('click', () => { closeModal(); switchTab('map'); M.panTo(r.lat, r.lng); });
  }

  /* ================= 여행 선택 ================= */
  function openTripModal() {
    const st = S.getState();
    if (!st || !st.trips.length) return;
    const body = st.trips.map(t =>
      '<button class="trip-row" data-trip="' + t.id + '"><span class="chk">' + (t.id === st.activeTripId ? '✓' : '') + '</span>' +
      '<span style="flex:1;min-width:0;overflow:hidden;text-overflow:ellipsis">' + esc(t.name) + '</span>' +
      '<span style="color:var(--muted);font-size:12.5px">' + t.days.length + '일</span></button>').join('') +
      '<div class="hint" style="margin-top:10px">새 여행 추가는 [더보기] 탭에서 할 수 있어요.</div>';
    showModal('여행 선택', body);
    document.querySelectorAll('#modalRoot [data-trip]').forEach(b => b.addEventListener('click', () => {
      S.setActiveTrip(b.dataset.trip);
      activeDay = 0;
      routePick = null;
      if (routeModeOn) exitRouteMode();
      hideRoute();
      renderTripName();
      renderChips();
      refreshDay();
      if (tab === 'move') renderMove();
      if (tab === 'more') renderMore();
      closeModal();
      toast('여행을 바꿨어요');
    }));
  }

  function afterTripChange() {
    activeDay = 0;
    routePick = null;
    if (routeModeOn) exitRouteMode();
    renderTripName();
    renderChips();
    refreshDay();
    if (tab === 'move') renderMove();
    if (tab === 'more') renderMore();
  }

  /* ================= 경로 (출발지·도착지 선택) ================= */
  function dayObj() {
    const t = currentTrip();
    return (t && activeDay > 0) ? t.days[activeDay - 1] : null;
  }
  // 경로 전용 장소: 일자 데이터에 저장 (리프레시 후에도 유지, 데스크톱과 공유)
  function dayExtras() {
    const d = dayObj();
    return (d && Array.isArray(d.routeExtras)) ? d.routeExtras : [];
  }
  function saveExtras(arr) {
    const t = currentTrip();
    const d = (t && activeDay > 0) ? t.days[activeDay - 1] : null;
    if (!d) return;
    d.routeExtras = arr;
    S.saveTrip(t);
  }
  function removeExtra(id) {
    if (routePick && routePick.originId === id) routePick.originId = null;
    if (routePick && routePick.destId === id) routePick.destId = null;
    saveExtras(dayExtras().filter(x => x.id !== id));
    renderRoutePickBar();
    redrawPicked();
  }

  function enterRouteMode() {
    const day = dayObj(); if (!day) return;
    if (day.places.length + dayExtras().length < 2) { toast('경로를 보려면 장소가 2개 이상 필요해요'); return; }
    routeModeOn = true;
    routePick = { originId: null, destId: null };
    applyRouteMode();
  }

  function exitRouteMode() {
    if (!routeModeOn) return;
    routeModeOn = false;
    routePick = null;
    applyRouteMode();
  }

  function applyRouteMode() {
    const bar = $('#routeBar');
    bar.classList.toggle('hidden', !routeModeOn);
    if (routeModeOn) {
      setSheet('half'); // 꽉 채우지 않아 지도가 보임
      $('#routeBarSeg').innerHTML = Object.keys(MODE_LABEL).map(m =>
        '<button data-mode="' + m + '" class="' + (routeMode === m ? 'on' : '') + '">' + MODE_LABEL[m] + '</button>').join('');
      renderRoutePickBar();
      refreshDay();
    } else {
      hideRoute();
      setSheet('half');
      refreshDay();
    }
  }

  // 출발/도착 선택 상태 바 (이동수단 아래)
  function renderRoutePickBar() {
    const bar = $('#routeBar');
    const old = bar.querySelector('#rbPick');
    if (old) old.remove();
    if (!routeModeOn) return;
    const all = placesForPick();
    const o = routePick && all.find(p => p.id === routePick.originId);
    const d = routePick && all.find(p => p.id === routePick.destId);
    const wrap = document.createElement('div');
    wrap.id = 'rbPick';
    wrap.innerHTML =
      '<button class="rb-pick-btn' + (o ? ' on' : '') + '" data-pickbtn="originId">🚩 출발 <span class="val">' + esc(o ? o.name : '선택') + '</span>' + (o ? '<span data-pickclear="originId">✕</span>' : '') + '</button>' +
      '<button class="rb-pick-btn' + (d ? ' on' : '') + '" data-pickbtn="destId">🏁 도착 <span class="val">' + esc(d ? d.name : '선택') + '</span>' + (d ? '<span data-pickclear="destId">✕</span>' : '') + '</button>';
    bar.insertBefore(wrap, bar.querySelector('.rb-info'));
    $('#rbCount').textContent = (o && d) ? '출발 → 도착 경로 표시 중' : (o ? '도착지를 선택하세요' : '출발지를 선택하세요 — 목록이나 지도 마커를 눌러요');
  }

  function placesForPick() {
    const day = dayObj(); if (!day) return [];
    return day.places.concat(dayExtras());
  }

  // 행/마커 탭: 첫 탭=출발, 둘째=도착, 같은 곳 재탭=해제
  function tapEndpoint(id) {
    if (!routeModeOn || !routePick) return;
    if (routePick.originId === id) routePick.originId = null;
    else if (routePick.destId === id) routePick.destId = null;
    else if (!routePick.originId) routePick.originId = id;
    else routePick.destId = id;
    renderRoutePickBar();
    refreshDay();
    redrawPicked();
  }

  function clearEndpoint(which) {
    if (!routePick) return;
    routePick[which] = null;
    renderRoutePickBar();
    refreshDay();
    redrawPicked();
  }

  // 출발/도착 버튼 탭 → 목록에서 고르는 모달 (시트가 접혀 있어도 변경 가능)
  function openPickModal(which) {
    const day = dayObj(); if (!day) return;
    const all = placesForPick();
    const cur = routePick ? routePick[which] : null;
    const body =
      '<div class="field"><label>' + (which === 'originId' ? '🚩 출발 장소' : '🏁 도착 장소') + '</label>' +
      '<div class="rs-list" id="pkList">' +
      all.map(p =>
        '<label class="rs-row"><input type="radio" name="pk" value="' + p.id + '"' + (p.id === cur ? ' checked' : '') + '><span>' + catInfo(p).emoji + ' ' + esc(p.name) +
        (dayExtras().some(x => x.id === p.id) ? ' <span class="rt-badge">경로 전용</span>' : '') + '</span></label>'
      ).join('') + '</div></div>' +
      '<button id="pkOk" class="btn btn-primary btn-block">선택</button>';
    showModal(which === 'originId' ? '출발지 선택' : '도착지 선택', body);
    $('#pkOk').addEventListener('click', () => {
      const sel = document.querySelector('#pkList input[name="pk"]:checked');
      if (!sel) { toast('장소를 선택해 주세요'); return; }
      routePick[which] = sel.value;
      closeModal();
      renderRoutePickBar();
      refreshDay();
      redrawPicked();
    });
  }

  function setRouteMode(m) {
    routeMode = m;
    document.querySelectorAll('[data-mode]').forEach(b => b.classList.toggle('on', b.dataset.mode === m));
    if (!routeModeOn && activeDay === 0) { drawAllDays(); return; }
    redrawPicked();
  }

  // 출발·도착 모두 선택되면 자동 경로 탐색
  function redrawPicked() {
    const day = dayObj(); if (!day || !routeModeOn || !routePick) { hideRoute(); return; }
    const o = routePick.originId, d = routePick.destId;
    if (!o || !d || o === d) { hideRoute(); return; }
    const all = placesForPick();
    const op = all.find(p => p.id === o), dp = all.find(p => p.id === d);
    if (!op || !dp) { hideRoute(); return; }
    drawRouteBetween(op, dp);
  }

  function drawRouteBetween(op, dp) {
    if (!M.isReady()) { toast('지도를 기다리는 중이에요'); return; }
    routePanelExpanded = false; // 새 경로는 접힌 요약줄로 (지도 확보)
    showRoutePanel(null, null);
    const color = dayColor(activeDay - 1);
    let guard = setTimeout(() => renderRouteResult({ error: '경로 계산이 오래 걸리고 있어요. 네트워크를 확인하고 다시 시도해 주세요.' }), 20000);
    const finish = (r) => { clearTimeout(guard); renderRouteResult(r); };
    try {
      if (routeMode === 'TRANSIT') M.drawTransit([op, dp], color, finish);
      else M.drawRoute([op, dp], routeMode, color, finish);
    } catch (e) { clearTimeout(guard); renderRouteResult({ error: '경로 요청 오류: ' + e.message }); }
    // 경로가 보이게 지도 프레임 조정 + 시트 접어 지도 확보
    M.fitBounds([{ lat: op.lat, lng: op.lng }, { lat: dp.lat, lng: dp.lng }]);
    setSheet('peek');
  }

  async function openRoutePicker() {
    const trip = currentTrip(); if (!trip || activeDay === 0) return;
    const body =
      '<div class="field"><input type="text" id="rtQuery" placeholder="예: 오타루 스시, 삿포로 카페"></div>' +
      '<button id="rtGo" class="btn btn-primary btn-block">🔍 검색</button>' +
      '<div id="rtResults" style="margin-top:12px"></div>' +
      '<div class="hint" style="margin-top:10px">선택한 장소는 경로에만 추가돼요 (일정에는 안 들어감). 체크 해제하거나 ✕로 제거할 수 있어요.</div>';
    showModal('다른 장소 추가 (경로 전용)', body);
    const q = $('#rtQuery');
    const run = async () => {
      const v = (q.value || '').trim();
      const resEl = $('#rtResults');
      if (!v) { toast('검색어를 입력해 주세요'); return; }
      resEl.innerHTML = '<div class="hint">검색 중…</div>';
      const r = await M.searchText(v, M.getCenter());
      routePickResults = r.results;
      if (!r.ok) { resEl.innerHTML = '<div class="empty"><p>검색 실패 (' + esc(r.status) + ')</p></div>'; return; }
      if (!r.results.length) { resEl.innerHTML = '<div class="empty"><p>결과가 없어요. 검색어를 바꿔 보세요.</p></div>'; return; }
      resEl.innerHTML = r.results.map((x, i) =>
        '<div class="sr-row"><div class="sr-main"><div class="sr-name-btn" style="text-decoration:none">' + esc(x.name) + '</div>' +
        '<div class="sr-meta">' + (x.rating ? '★ ' + x.rating + ' (' + x.reviews + ')' : '') + '<br>' + esc(x.address) + '</div></div>' +
        '<button class="btn btn-primary" style="min-height:42px;padding:0 12px;font-size:13.5px" data-rtadd="' + i + '">경로에 추가</button></div>'
      ).join('');
      resEl.querySelectorAll('[data-rtadd]').forEach(b => b.addEventListener('click', () => {
        const x = routePickResults[Number(b.dataset.rtadd)];
        if (!x) return;
        const arr = dayExtras();
        arr.push({
          id: 'rt_' + S.uid(), name: x.name,
          category: (x.name || '').includes('카페') || (x.name || '').toLowerCase().includes('cafe') ? 'cafe' : 'restaurant',
          lat: x.lat, lng: x.lng, note: x.rating ? '★ ' + x.rating + ' (리뷰 ' + x.reviews + ')' : '', tags: ['경로 전용'], links: {}
        });
        saveExtras(arr);
        b.textContent = '✓ 추가됨';
        b.disabled = true;
        refreshDay();
      }));
    };
    q.addEventListener('keydown', e => { if (e.key === 'Enter') run(); });
    $('#rtGo').addEventListener('click', run);
  }

  // 구글 트랜짓 미지원 구간 → 내장 SCHEDULES 참고 교통편
  function findSchedule(from, to) {
    const scheds = (window.FTA_DATA && FTA_DATA.SCHEDULES) || [];
    const f = from || '', t = to || '';
    let best = null, bestScore = 0, bestSpec = 99;
    scheds.forEach(s => {
      const sf = s.match.some(k => f.includes(k)) ? 1 : 0;
      const st = s.match.some(k => t.includes(k)) ? 1 : 0;
      const score = sf + st;
      if (score > bestScore || (score === bestScore && score > 0 && s.match.length < bestSpec)) {
        bestScore = score; best = s; bestSpec = s.match.length;
      }
    });
    return bestScore >= 1 ? best : null;
  }

  function showRoutePanel(summary, detail, opts) {
    lastRoutePanel = { summary: summary || null, detail: detail || null };
    if (opts && opts.expanded) routePanelExpanded = true;
    renderRoutePanel();
  }

  // 지도 상단 경로 카드: 기본 접힘 요약줄 (지도를 가리지 않게) + 탭하면 구간 상세
  function renderRoutePanel() {
    const el = $('#routeInfo');
    $('#sheetRouteInfo').classList.add('hidden');
    if (!lastRoutePanel) return;
    el.classList.remove('hidden');
    const seg = routeModeOn ? '' : '<div class="seg">' + Object.keys(MODE_LABEL).map(m =>
      '<button data-mode="' + m + '" class="' + (routeMode === m ? 'on' : '') + '">' + MODE_LABEL[m] + '</button>').join('') + '</div>';
    const close = '<div style="text-align:right;margin-top:4px"><button id="routeClose" style="color:var(--muted);font-size:13px;padding:6px">✕ 닫기</button></div>';
    const { summary, detail } = lastRoutePanel;
    if (!detail) {
      el.innerHTML = seg + '<div class="rp-detail"><div class="hint">경로 계산 중…</div></div>' + close;
      return;
    }
    const toggle = '<button class="rp-toggle" data-rptoggle type="button">' + (routePanelExpanded ? '접기 ▴' : '구간 보기 ▾') + '</button>';
    el.innerHTML = seg +
      '<div class="rp-summary" data-rptoggle><b>' + esc(summary || '경로 정보') + '</b>' + toggle + '</div>' +
      '<div class="rp-detail' + (routePanelExpanded ? '' : ' hidden') + '">' + detail + '</div>' + close;
  }

  function renderRouteResult(r) {
    if (r.error) { showRoutePanel('경로 계산 실패', '<div style="color:var(--danger)">' + esc(r.error) + '</div>', { expanded: true }); return; }
    if (r.transit) {
      let h = '';
      r.legs.forEach((leg, i) => {
        h += '<div class="leg"><b>' + (i + 1) + '. ' + esc(leg.from) + ' → ' + esc(leg.to) + '</b>' +
          '<span class="tm">' + esc(leg.dur) + (leg.dist ? ' · ' + esc(leg.dist) : '') + '</span>';
        if (leg.noTransit) {
          h += '<div class="tt-note">🚌 대중교통 정보 없음(구글 미지원 구간) — 참고 교통편:</div>';
          const sched = findSchedule(leg.from, leg.to);
          if (sched) {
            h += '<div class="tt-sched">' +
              '<span class="tt-line">' + sched.emoji + ' ' + esc(sched.line) + '</span>' +
              '<div class="tm">' + esc(sched.info) + '</div>' +
              (sched.hours ? '<div class="tm">🕐 ' + esc(sched.hours) + '</div>' : '') +
              (sched.note ? '<div class="tm">💡 ' + esc(sched.note) + '</div>' : '') +
              '<a class="tp-link" href="' + esc(sched.url) + '" target="_blank" rel="noopener">공식 시간표 · 예약</a>' +
              '</div>';
          } else {
            h += '<div class="tt-note">— [이동] 탭의 공식 사이트에서 확인해 주세요</div>';
          }
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
      showRoutePanel('대중교통 · ' + r.legs.length + '개 구간', h);
    } else {
      let h = '';
      r.legs.forEach((leg, i) => {
        h += '<div class="leg"><b>' + (i + 1) + '. ' + esc(leg.from) + ' → ' + esc(leg.to) + '</b>' +
          '<span class="tm">' + esc(leg.dur) + ' · ' + esc(leg.dist) + '</span>' +
          (leg.line ? '<div><span class="line">' + esc(leg.vehicle === 'BUS' ? '🚌' : '🚄') + ' ' + esc(leg.line) + '</span></div>' : '') +
          '</div>';
      });
      showRoutePanel('전체 ' + esc(r.dist) + 'km · 약 ' + esc(r.time) + '분', h);
    }
  }

  // 전체 보기: 일자별 동선을 색으로 한 지도에 표시 (카드는 접힌 요약으로)
  async function drawAllDays() {
    const trip = currentTrip(); if (!trip) return;
    if (!M.isReady()) { toast('지도를 기다리는 중이에요'); return; }
    const days = trip.days.map((d, i) => ({ d, i }))
      .filter(x => x.d.places.filter(p => isFinite(p.lat) && isFinite(p.lng)).length >= 2);
    if (!days.length) { toast('경로를 보려면 장소가 2개 이상인 일자가 필요해요'); return; }
    M.clearRoute();
    const mode = routeMode;
    const lines = [];
    let done = 0;
    for (const { d, i } of days) {
      const places = d.places.filter(p => isFinite(p.lat) && isFinite(p.lng));
      lines.push('<div class="leg"><b>' + (i + 1) + '일차 · ' + esc(d.title) + '</b> <span class="tm">계산 중…</span></div>');
      showRoutePanel('전체 동선 계산 중 (' + (i + 1) + '/' + days.length + ')…', lines.join(''), { expanded: true });
      let res = null;
      try {
        res = await new Promise(cb => {
          if (mode === 'TRANSIT') M.drawTransit(places, dayColor(i), cb, { keep: true });
          else M.drawRoute(places, mode, dayColor(i), cb, { keep: true });
        });
      } catch (e) { res = { error: e.message }; }
      let status;
      if (!res || res.error) status = res && res.error ? '실패 (' + esc(res.error) + ')' : '실패';
      else if (res.transit) status = '구간 ' + res.legs.length + '개';
      else status = res.dist + 'km · 약 ' + res.time + '분';
      lines[lines.length - 1] = lines[lines.length - 1].replace('계산 중…', status);
      done++;
    }
    routePanelExpanded = false;
    showRoutePanel('전체 동선 완료 — ' + done + '개 일자 · 색상은 일자별', lines.join(''));
  }

  function hideRoute() {
    $('#routeInfo').classList.add('hidden');
    $('#sheetRouteInfo').classList.add('hidden');
    lastRoutePanel = null;
    M.clearRoute();
  }

  /* ================= 이동 탭 ================= */
  function renderMove() {
    const trip = currentTrip(); if (!trip) return;
    const wrap = $('#moveView');
    let guides;
    if (activeDay === 0) {
      guides = trip.days.map((d, i) =>
        '<div class="tp-guide"><b>' + (i + 1) + '일차 · ' + esc(d.title) + '</b>' + esc(d.transport || '이동 정보 없음') + '</div>').join('');
    } else {
      const day = trip.days[activeDay - 1];
      guides = '<div class="tp-guide">' + esc(day.transport || '이동 정보 없음') + '</div>';
    }
    const links = D.TRANSPORT_LINKS.map(l =>
      '<a class="tp-link" href="' + l.url + '" target="_blank" rel="noopener">' + l.emoji + ' ' + esc(l.name) + '</a>').join('');
    wrap.innerHTML =
      '<div class="tp-head">🚌 일자별 이동 안내</div>' + guides +
      '<div class="tp-head">📅 공식 시간표 · 예약 사이트</div>' + links +
      '<div class="tp-guide">💡 팁: 지도 탭에서 [경로] → [대중교통]을 누르면 구간별 버스·열차와 출발/도착 시간을 바로 보여줘요. (구글 데이터 기준)</div>';
  }

  /* ================= 더보기 탭 ================= */
  async function renderMore() {
    const trip = currentTrip();
    const photoCount = await S.countPhotos();
    $('#moreView').innerHTML =
      '<div class="set-card"><div class="card-head">✈️ 새 여행</div><div class="set-form">' +
        '<div class="field-sm"><label>여행 이름</label><input type="text" id="stName" placeholder="예: 도쿄 가족여행"></div>' +
        '<div class="field-sm"><label>기간</label><div class="date-row"><input type="date" id="stStart"><input type="date" id="stEnd"></div></div>' +
        '<button class="btn btn-primary btn-block" data-act="add-trip">여행 추가</button>' +
      '</div></div>' +
      '<div class="set-card"><div class="card-head">📌 현재 여행</div>' +
        '<div class="set-row"><span class="lbl">' + esc(trip ? trip.name : '') + '</span>' +
        '<button class="btn btn-danger" data-act="del-trip">삭제</button></div>' +
      '</div>' +
      '<div class="set-card"><div class="card-head">📖 추억</div>' +
        '<div class="set-row"><span class="lbl">여행 리포트 <span class="sub">사진·일정 한눈에 · PDF 저장</span></span>' +
        '<button class="btn btn-ghost" data-act="report">📖 열기</button></div>' +
      '</div>' +
      '<div class="set-card"><div class="card-head">💾 데이터</div>' +
        '<div class="set-row"><span class="lbl">백업 내보내기</span><button class="btn btn-ghost" data-act="export">내보내기</button></div>' +
        '<div class="set-row"><span class="lbl">백업 불러오기</span><button class="btn btn-ghost" data-act="import">가져오기</button></div>' +
        '<div class="set-row"><span class="lbl">저장된 사진 <span class="sub">' + photoCount + '장 · 이 기기에만</span></span></div>' +
        '<div class="set-row"><span class="lbl" style="color:var(--danger)">모든 데이터 초기화</span><button class="btn btn-danger" data-act="reset">초기화</button></div>' +
      '</div>' +
      '<div class="tp-guide">PC에서는 <a href="index.html" style="color:var(--accent);font-weight:700">웹 버전</a>을 사용하세요. 같은 데이터를 공유해요.</div>';
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

  /* ================= 사진 ================= */
  async function onPhotoFile(e) {
    const files = Array.from(e.target.files || []); e.target.value = '';
    if (!files.length || !pendingPhoto) return;
    const ctx = pendingPhoto; pendingPhoto = null;
    const trip = currentTrip();
    if (!trip) return;
    const place = trip.days[ctx.dayIdx] && trip.days[ctx.dayIdx].places[ctx.pIdx];
    if (!place) return;
    let saved = 0;
    try {
      for (const f of files) {
        const dataUrl = await S.compressImage(f);
        await S.addPhoto(trip.id, place.id, { id: S.uid(), dataUrl, ts: Date.now() });
        saved++;
      }
      refreshDay();
      toast(saved + '장의 사진을 저장했어요');
    } catch (err) {
      toast('사진 저장 실패: ' + err.message + (saved ? ' (' + saved + '장 저장됨)' : ''));
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
      del.style.cssText = 'position:fixed;bottom:calc(28px + var(--sab));left:50%;transform:translateX(-50%);background:#C0453E;color:#fff;border:none;border-radius:12px;padding:13px 22px;font-size:15px;font-weight:700';
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

  /* ================= 백업 가져오기 ================= */
  function onImportFile(e) {
    const f = e.target.files[0]; e.target.value = '';
    if (!f) return;
    S.importJSON(f).then(r => {
      afterTripChange();
      toast('백업을 불러왔어요 (' + r.trips + '개 여행)');
    }).catch(err => toast('불러오기 실패: ' + err.message));
  }

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
    const el = $('#toast');
    el.textContent = msg;
    el.classList.remove('hidden');
    clearTimeout(toastTimer);
    toastTimer = setTimeout(() => el.classList.add('hidden'), 2600);
  }

  document.addEventListener('DOMContentLoaded', boot);
})();
