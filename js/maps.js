// 구글 지도: 지도 초기화 · 일자별 마커 · 경로(차/대중교통/도보) · 장소·맛집 검색
window.FTMap = (function () {
  let map = null, info = null, markers = [], routeLayers = [], started = false;

  function esc(s) {
    return String(s == null ? '' : s).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  }

  /* ---------- 초기화 ---------- */
  function init() {
    if (map) return;
    if (started) return;
    started = true;
    if (window.google && window.google.maps) { setup(); return; }
    window.__ftMapsReady = setup;
    const s = document.createElement('script');
    s.src = 'https://maps.googleapis.com/maps/api/js?key=' + FTA_CONFIG.apiKey +
      '&libraries=places&callback=__ftMapsReady&language=' + FTA_CONFIG.mapLang +
      '&region=' + FTA_CONFIG.mapRegion;
    s.async = true;
    s.onerror = () => { window.dispatchEvent(new CustomEvent('ftmapsfail', { detail: '네트워크 오류' })); };
    document.head.appendChild(s);
  }
  window.gm_authFailure = function () {
    window.dispatchEvent(new CustomEvent('ftmapsfail', {
      detail: '지도 API 키가 잘못되었거나 리퍼러 제한에 걸렸어요. Google Cloud Console에서 키 제한(HTTP 리퍼러: 배포 주소 + localhost)을 확인해 주세요.'
    }));
  };
  function setup() {
    map = new google.maps.Map(document.getElementById('map'), {
      center: { lat: 43.06, lng: 141.35 },
      zoom: 12,
      mapTypeControl: false,
      fullscreenControl: false,
      streetViewControl: false
    });
    info = new google.maps.InfoWindow();
    // 지도 빈 곳 탭 → 좌표 이벤트 (모바일: 장소 추가/위치 선택용)
    map.addListener('click', e => {
      if (!e.latLng) return;
      window.dispatchEvent(new CustomEvent('ftmapclick', { detail: { lat: e.latLng.lat(), lng: e.latLng.lng() } }));
    });
    window.dispatchEvent(new CustomEvent('ftmapsready'));
  }

  /* ---------- 마커 ---------- */
  function pinIcon(dayColor, emoji, flag) {
    // 출발(A)/도착(B) 선택 마커: 알파벳 원형 핀
    if (flag) {
      const col = flag === 'A' ? '#2F6D80' : '#C0453E';
      const svg = '<svg xmlns="http://www.w3.org/2000/svg" width="44" height="44" viewBox="0 0 44 44">' +
        '<circle cx="22" cy="22" r="20" fill="' + col + '" stroke="#fff" stroke-width="3"/>' +
        '<text x="22" y="30" font-size="20" font-weight="bold" text-anchor="middle" fill="#fff">' + flag + '</text></svg>';
      return {
        url: 'data:image/svg+xml;charset=utf-8,' + encodeURIComponent(svg),
        scaledSize: new google.maps.Size(40, 40),
        anchor: new google.maps.Point(20, 20)
      };
    }
    const svg = '<svg xmlns="http://www.w3.org/2000/svg" width="46" height="58" viewBox="0 0 46 58">' +
      '<path d="M23 1C11.4 1 2 10.4 2 22c0 16.2 21 35 21 35s21-18.8 21-35C44 10.4 34.6 1 23 1z" fill="' + dayColor + '" stroke="#fff" stroke-width="2.5"/>' +
      '<text x="23" y="33" font-size="22" text-anchor="middle">' + emoji + '</text></svg>';
    return {
      url: 'data:image/svg+xml;charset=utf-8,' + encodeURIComponent(svg),
      scaledSize: new google.maps.Size(36, 45),
      anchor: new google.maps.Point(18, 45)
    };
  }

  function clearMarkers() {
    markers.forEach(m => m.setMap(null));
    markers = [];
  }

  // items: [{ place, color }] 또는 [{place, color}...] — 전체 보기에서 일자별 색상 유지
  function setMarkers(items, onClick) {
    clearMarkers();
    const D = window.FTA_DATA;
    items.forEach(it => {
      const p = it.place || it;
      const color = it.color || '#2F6D80';
      const cat = D.CATEGORIES[p.category] || D.CATEGORIES.other;
      const m = new google.maps.Marker({
        position: { lat: p.lat, lng: p.lng },
        map: map,
        icon: pinIcon(color, cat.emoji, it.flag),
        title: p.name
      });
      m.addListener('click', () => {
        if (info) info.close();
        const links = [];
        const gurl = 'https://www.google.com/maps/search/?api=1&query=' + encodeURIComponent(p.name + ' ' + p.lat + ',' + p.lng);
        links.push('<a href="' + gurl + '" target="_blank" rel="noopener">구글 지도</a>');
        if (p.links && p.links.official) links.push('<a href="' + esc(p.links.official) + '" target="_blank" rel="noopener">공식 사이트</a>');
        const content = '<div style="font-family:inherit;font-size:14px;min-width:170px;max-width:230px">' +
          '<b>' + esc(p.name) + '</b>' +
          (p.note ? '<div style="color:#555;margin-top:3px">' + esc(p.note) + '</div>' : '') +
          (links.length ? '<div style="margin-top:6px;font-size:13px">' + links.join(' · ') + '</div>' : '') +
          '</div>';
        info.setContent(content);
        info.open(map, m);
      });
      markers.push(m);
    });
  }

  function fitBounds(latlngs, pad) {
    if (!latlngs.length) return;
    if (latlngs.length === 1) { map.setCenter(latlngs[0]); map.setZoom(15); return; }
    const b = new google.maps.LatLngBounds();
    latlngs.forEach(ll => b.extend(ll));
    // pad: 숫자(전방향) 또는 {top,right,bottom,left} — 모바일은 시트/카드가 지도를 덮으므로 여백 필수
    map.fitBounds(b, pad || 60);
  }
  function panTo(lat, lng) { map.panTo({ lat, lng }); }
  function getCenter() { return map ? map.getCenter() : null; }
  function isReady() { return !!map; }

  /* ---------- 경로 ---------- */
  function clearRoute() {
    routeLayers.forEach(l => l.setMap(null));
    routeLayers = [];
  }
  function rendererCount() { return routeLayers.length; }

  // Directions 결과에서 폴리라인 경로점 추출 (overview_path 우선, 없으면 step 경로 연결)
  function routePath(res) {
    const r0 = res.routes[0];
    if (r0 && r0.overview_path && r0.overview_path.length) return r0.overview_path;
    const pts = [];
    (r0 && r0.legs || []).forEach(l => (l.steps || []).forEach(s => { if (s.path && s.path.length) pts.push.apply(pts, s.path); }));
    return pts;
  }

  // 경로선 2겹: 흰색 테두리(아래) + 일자 색상(위) → 지도 도로와 색이 같아도 항상 보임
  function addRoutePolyline(path, color, weight) {
    if (!path || !path.length) return;
    const outline = new google.maps.Polyline({ map: map, path: path, strokeColor: '#ffffff', strokeWeight: weight + 3, strokeOpacity: 0.95, zIndex: 1 });
    const main = new google.maps.Polyline({ map: map, path: path, strokeColor: color, strokeWeight: weight, strokeOpacity: 0.95, zIndex: 2 });
    routeLayers.push(outline, main);
  }

  // Directions 요청 래퍼: 타임아웃(10초) + 예외 방지 — 절대 안 끝나지 않는 콜백 없음
  function routeReq(svc, req, ms) {
    return new Promise((resolve) => {
      const t = setTimeout(() => resolve({ status: 'TIMEOUT' }), ms || 10000);
      try {
        svc.route(req, (r, st) => { clearTimeout(t); resolve({ status: st, res: r }); });
      } catch (e) { clearTimeout(t); resolve({ status: 'EXCEPTION', error: e.message }); }
    });
  }

  // 차/도보: waypoints 한 번에 요청
  // opts.alternatives: 대안 경로 수집 (단일 구간 + 차량에서 유효 — 구글은 일본 대중교통 미지원)
  function drawRoute(places, mode, color, onDone, opts) {
    opts = opts || {};
    if (!opts.keep) clearRoute();
    const valid = places.filter(p => isFinite(p.lat) && isFinite(p.lng));
    if (valid.length < 2) { onDone({ error: '좌표가 올바른 장소가 2개 이상 필요해요 (장소를 수정해 주세요)' }); return; }
    const svc = new google.maps.DirectionsService();
    const origin = valid[0], dest = valid[valid.length - 1];
    const waypoints = valid.slice(1, -1).map(p => ({ location: { lat: p.lat, lng: p.lng }, stopover: true }));
    const wantAlt = !!opts.alternatives && valid.length === 2;
    routeReq(svc, {
      origin: { lat: origin.lat, lng: origin.lng },
      destination: { lat: dest.lat, lng: dest.lng },
      waypoints: waypoints, optimizeWaypoints: false, travelMode: mode,
      provideRouteAlternatives: wantAlt
    }).then(got => {
      if (got.status !== 'OK') { onDone({ error: '경로를 찾지 못했어요 (' + got.status + ')' }); return; }
      const res = got.res;
      addRoutePolyline(routePath(res), color, 6);
      const legs = res.routes[0].legs;
      const totalD = legs.reduce((a, l) => a + l.distance.value, 0) / 1000;
      const totalT = legs.reduce((a, l) => a + l.duration.value, 0) / 60;
      const steps = [];
      legs.forEach((l, i) => {
        const main = l.steps.find(s => s.travel_mode === 'TRANSIT');
        steps.push({
          from: valid[i].name, to: valid[i + 1].name,
          dist: l.distance.text, dur: l.duration.text,
          line: main && main.transit ? (main.transit.line.short_name || main.transit.line.name) : null,
          vehicle: main && main.transit ? main.transit.line.vehicle.type : null
        });
      });
      const out = { ok: true, dist: totalD.toFixed(1), time: Math.round(totalT), legs: steps };
      // 대안 수집 (idx 0 = 기본 경로, 위에서 그림)
      if (wantAlt && res.routes.length > 1) {
        const toAlt = (rt, idx) => {
          const l0 = rt.legs[0];
          const main = l0.steps.find(s => s.travel_mode === 'TRANSIT');
          return {
            idx: idx,
            summary: rt.summary || '경로 ' + (idx + 1),
            dur: l0.duration.text, dist: l0.distance.text,
            line: main && main.transit ? (main.transit.line.short_name || main.transit.line.name) : null,
            vehicle: main && main.transit ? main.transit.line.vehicle.type : null,
            path: routePath({ routes: [rt] })
          };
        };
        out.alternatives = [Object.assign(toAlt(res.routes[0], 0), { selected: true })]
          .concat(res.routes.slice(1, 6).map((rt, k) => toAlt(rt, k + 1)));
        out.altSelected = 0;
      }
      onDone(out);
    });
  }

  // 대중교통: 구간별 순차 요청 (경유지 미지원 + 할당량 폭주 방지)
  // 대중교통 없으면 도보 대체 → 그것도 실패/과도하면 '시간표 안내' 처리 (항상 완료됨)
  // opts.alternatives: 출발지→도착지 1구간일 때 여러 대안 경로도 함께 수집
  async function drawTransit(places, color, onDone, opts) {
    opts = opts || {};
    if (!opts.keep) clearRoute();
    const valid = places.filter(p => isFinite(p.lat) && isFinite(p.lng));
    if (valid.length < 2) { onDone({ error: '좌표가 올바른 장소가 2개 이상 필요해요 (장소를 수정해 주세요)' }); return; }
    const svc = new google.maps.DirectionsService();
    const legsOut = [];

    function legInfo(res) {
      const leg = res.routes[0].legs[0];
      return {
        dur: leg.duration.text,
        dist: leg.distance ? leg.distance.text : '',
        transit: leg.steps.filter(s => s.travel_mode === 'TRANSIT').map(s => {
          const t = s.transit;
          return {
            line: t.line.short_name || t.line.name,
            vehicle: t.line.vehicle.type,
            dep: t.departure_stop.name, arr: t.arrival_stop.name,
            depT: t.departure_time ? t.departure_time.text : null,
            arrT: t.arrival_time ? t.arrival_time.text : null,
            dur: s.duration.text
          };
        })
      };
    }

    // 대안 경로(alt): 하나의 leg를 여러 후보로 표현 — 지도에는 선택된 것만 그림
    function altInfo(res, idx) {
      const leg = res.legs[0];
      const transit = leg.steps.filter(s => s.travel_mode === 'TRANSIT').map(s => {
        const t = s.transit;
        return {
          line: t.line.short_name || t.line.name,
          vehicle: t.line.vehicle.type,
          dep: t.departure_stop.name, arr: t.arrival_stop.name,
          depT: t.departure_time ? t.departure_time.text : null,
          arrT: t.arrival_time ? t.arrival_time.text : null,
          dur: s.duration.text
        };
      });
      const summaryLines = [];
      leg.steps.forEach(s => {
        if (s.travel_mode === 'TRANSIT' && s.transit) summaryLines.push(s.transit.line.short_name || s.transit.line.name);
      });
      const summary = summaryLines.length ? summaryLines.join(' + ') : '도보';
      return {
        idx: idx,
        summary: summary,
        dur: leg.duration.text,
        dist: leg.distance ? leg.distance.text : '',
        transit: transit,
        walkOnly: transit.length === 0 && leg.duration.value <= 2400,
        noTransit: transit.length === 0 && leg.duration.value > 2400,
        path: routePath({ routes: [res] })
      };
    }

    for (let i = 0; i < valid.length - 1; i++) {
      const from = valid[i], to = valid[i + 1];
      const req = { origin: { lat: from.lat, lng: from.lng }, destination: { lat: to.lat, lng: to.lng } };
      // TRANSIT은 departureTime 필수 (없으면 ZERO_RESULTS/NOT_FOUND) — 현재 시각 기준 요청
      // 대안: 단일 구간일 때만 provideRouteAlternatives (구간별 폭주 방지)
      const wantAlt = !!opts.alternatives && valid.length === 2;
      let got = await routeReq(svc, Object.assign({
        travelMode: 'TRANSIT',
        transitOptions: { departureTime: new Date() },
        provideRouteAlternatives: wantAlt
      }, req));
      if (got.status !== 'OK') {
        got = await routeReq(svc, Object.assign({ travelMode: 'WALKING' }, req));
      }
      const out = { from: from.name, to: to.name, fromLat: from.lat, fromLng: from.lng, toLat: to.lat, toLng: to.lng, dur: '', dist: '', transit: [], walkOnly: false, noTransit: false };
      if (got.status === 'OK') {
        const info = legInfo(got.res);
        const leg = got.res.routes[0].legs[0];
        const walkOnly = info.transit.length === 0;
        const walkTooLong = walkOnly && leg.duration.value > 2400; // 도보 40분 초과는 비현실적
        out.dur = info.dur; out.dist = info.dist;
        out.transit = info.transit;
        out.walkOnly = walkOnly && !walkTooLong;
        out.noTransit = walkTooLong;
        // 폴백이든 대중교통이든 지도에는 항상 경로를 그려줌 (안내 문구만 다름)
        addRoutePolyline(routePath(got.res), color, 5);
        // 대안 수집: 대중교통 응답에서 2번째 이후 경로 (idx 0은 위에서 그린 기본 경로)
        if (wantAlt && got.res.routes && got.res.routes.length > 1) {
          out.alternatives = got.res.routes.slice(1, 6).map((rt, k) => altInfo(rt, k + 1));
          // 기본 경로도 alternatives 목록에 포함 (선택 UI 통일)
          out.alternatives.unshift(Object.assign(altInfo(got.res.routes[0], 0), { selected: true }));
          out.altSelected = 0;
        }
      } else {
        out.noTransit = true;
        out.dur = got.status;
      }
      legsOut.push(out);
    }
    onDone({ ok: true, transit: true, legs: legsOut });
  }

  // 대안 경로 지도 반영: 캐시된 경로점으로 폴리라인 교체 (재요청 없음)
  function drawPath(path, color, weight) {
    clearRoute();
    if (path && path.length) addRoutePolyline(path, color, weight || 5);
  }

  /* ---------- 검색 ---------- */
  function service() { return new google.maps.places.PlacesService(map); }

  function searchText(query, center) {
    return new Promise((res) => {
      try {
        service().textSearch({ query: query, location: center, radius: 30000 }, (results, status) => {
          res({ ok: status === 'OK', status: status, results: status === 'OK' && results ? results.slice(0, 12).map(p => fmtPlace(p)) : [] });
        });
      } catch (e) { res({ ok: false, status: 'EXCEPTION', results: [] }); }
    });
  }
  function nearbyFood(center, radius) {
    return new Promise((res) => {
      try {
        service().nearbySearch({ location: center, radius: radius || 1200, type: 'restaurant' }, (results, status) => {
          if (status !== 'OK' || !results) { res({ ok: false, status: status, results: [] }); return; }
          const good = results
            .filter(p => p.rating && p.rating >= 4.0)
            .sort((a, b) => (b.rating - a.rating) || ((b.user_ratings_total || 0) - (a.user_ratings_total || 0)));
          res({ ok: true, status: status, results: good.slice(0, 12).map(p => fmtPlace(p)) });
        });
      } catch (e) { res({ ok: false, status: 'EXCEPTION', results: [] }); }
    });
  }
  function fmtPlace(p) {
    return {
      name: p.name,
      rating: p.rating || null,
      reviews: p.user_ratings_total || 0,
      price: p.price_level || null,
      open: p.opening_hours ? p.opening_hours.open_now : null,
      address: p.vicinity || p.formatted_address || '',
      lat: p.geometry.location.lat(),
      lng: p.geometry.location.lng(),
      placeId: p.place_id,
      url: 'https://www.google.com/maps/search/?api=1&query=' + encodeURIComponent(p.name) + '&query_place_id=' + p.place_id
    };
  }

  // 가게 상세 (영업시간·전화·웹사이트·리뷰)
  function placeDetails(placeId) {
    return new Promise((res) => {
      try {
        service().getDetails({ placeId: placeId, fields: ['name', 'rating', 'user_ratings_total', 'formatted_address', 'formatted_phone_number', 'website', 'opening_hours', 'price_level', 'url', 'geometry', 'reviews'] }, (p, status) => {
          if (status !== 'OK' || !p) { res(null); return; }
          res({
            rating: p.rating || null,
            reviews: p.user_ratings_total || 0,
            price: p.price_level || null,
            open: p.opening_hours ? p.opening_hours.open_now : null,
            hours: p.opening_hours ? (p.opening_hours.weekday_text || null) : null,
            address: p.formatted_address || '',
            phone: p.formatted_phone_number || null,
            website: p.website || null,
            url: p.url || null,
            reviewList: (p.reviews || []).slice(0, 5).map(rv => ({
              author: rv.author_name || '',
              rating: rv.rating || null,
              text: (rv.text || '').slice(0, 300),
              rel: rv.relative_time_description || ''
            }))
          });
        });
      } catch (e) { res(null); }
    });
  }

  return { init, setMarkers, clearMarkers, fitBounds, panTo, getCenter, isReady, clearRoute, rendererCount, drawRoute, drawTransit, drawPath, searchText, nearbyFood, placeDetails };
})();
