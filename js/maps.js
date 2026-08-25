// 구글 지도: 지도 초기화 · 일자별 마커 · 경로(차/대중교통/도보) · 장소·맛집 검색
window.FTMap = (function () {
  let map = null, info = null, markers = [], renderers = [], started = false;

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
    window.dispatchEvent(new CustomEvent('ftmapsready'));
  }

  /* ---------- 마커 ---------- */
  function pinIcon(dayColor, emoji) {
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
        icon: pinIcon(color, cat.emoji),
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

  function fitBounds(latlngs) {
    if (!latlngs.length) return;
    if (latlngs.length === 1) { map.setCenter(latlngs[0]); map.setZoom(15); return; }
    const b = new google.maps.LatLngBounds();
    latlngs.forEach(ll => b.extend(ll));
    map.fitBounds(b, 60);
  }
  function panTo(lat, lng) { map.panTo({ lat, lng }); }
  function getCenter() { return map ? map.getCenter() : null; }
  function isReady() { return !!map; }

  /* ---------- 경로 ---------- */
  function clearRoute() {
    renderers.forEach(r => r.setMap(null));
    renderers = [];
  }

  // 차/도보: waypoints 한 번에 요청
  function drawRoute(places, mode, dayColor, onDone) {
    clearRoute();
    if (places.length < 2) { onDone({ error: '경로를 보려면 장소가 2개 이상 필요해요' }); return; }
    const svc = new google.maps.DirectionsService();
    const origin = places[0], dest = places[places.length - 1];
    const waypoints = places.slice(1, -1).map(p => ({ location: { lat: p.lat, lng: p.lng }, stopover: true }));
    svc.route({
      origin: { lat: origin.lat, lng: origin.lng },
      destination: { lat: dest.lat, lng: dest.lng },
      waypoints: waypoints, optimizeWaypoints: false, travelMode: mode
    }, (res, status) => {
      if (status !== 'OK') { onDone({ error: '경로를 찾지 못했어요 (' + status + ')' }); return; }
      const r = new google.maps.DirectionsRenderer({ map: map, suppressMarkers: true,
        polylineOptions: { strokeColor: dayColor, strokeWeight: 6, strokeOpacity: 0.85 } });
      r.setDirections(res);
      renderers.push(r);
      const legs = res.routes[0].legs;
      const totalD = legs.reduce((a, l) => a + l.distance.value, 0) / 1000;
      const totalT = legs.reduce((a, l) => a + l.duration.value, 0) / 60;
      const steps = [];
      legs.forEach((l, i) => {
        const main = l.steps.find(s => s.travel_mode === 'TRANSIT');
        steps.push({
          from: places[i].name, to: places[i + 1].name,
          dist: l.distance.text, dur: l.duration.text,
          line: main && main.transit ? (main.transit.line.short_name || main.transit.line.name) : null,
          vehicle: main && main.transit ? main.transit.line.vehicle.type : null
        });
      });
      onDone({ ok: true, dist: totalD.toFixed(1), time: Math.round(totalT), legs: steps });
    });
  }

  // 대중교통: 구간별로 요청 (경유지 미지원) → 구간별 노선·시간 안내
  // 대중교통 구간이 없는 짧은 이동(ZERO_RESULTS)은 도보로 자동 대체
  function drawTransit(places, dayColor, onDone) {
    clearRoute();
    if (places.length < 2) { onDone({ error: '경로를 보려면 장소가 2개 이상 필요해요' }); return; }
    const svc = new google.maps.DirectionsService();
    const legsOut = [];
    let pending = places.length - 1, failed = false;

    function finishLeg(i, res, walkOnly) {
      if (failed) return;
      const leg = res.routes[0].legs[0];
      // 도보로 대체했는데 40분 초과면 실용적이지 않음 → 시간표 안내로 전환
      const walkTooLong = walkOnly && leg.duration.value > 2400;
      if (!walkTooLong) {
        const r = new google.maps.DirectionsRenderer({ map: map, suppressMarkers: true,
          polylineOptions: { strokeColor: dayColor, strokeWeight: 5, strokeOpacity: 0.75 } });
        r.setDirections(res);
        renderers.push(r);
      }
      const transitSteps = walkOnly ? [] : leg.steps.filter(s => s.travel_mode === 'TRANSIT').map(s => {
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
      legsOut[i] = {
        from: places[i].name, to: places[i + 1].name,
        dur: leg.duration.text, dist: leg.distance ? leg.distance.text : '',
        transit: transitSteps, walkOnly: walkOnly && !walkTooLong, noTransit: walkTooLong
      };
      pending--;
      if (pending === 0) onDone({ ok: true, transit: true, legs: legsOut });
    }

    for (let i = 0; i < places.length - 1; i++) {
      (function (i) {
        const req = {
          origin: { lat: places[i].lat, lng: places[i].lng },
          destination: { lat: places[i + 1].lat, lng: places[i + 1].lng }
        };
        svc.route(Object.assign({ travelMode: 'TRANSIT' }, req), (res, status) => {
          if (failed) return;
          if (status === 'OK') { finishLeg(i, res, false); return; }
          // 대중교통 구간 없음(ZERO_RESULTS 등) → 도보로 대체
          svc.route(Object.assign({ travelMode: 'WALKING' }, req), (res2, st2) => {
            if (failed) return;
            if (st2 === 'OK') finishLeg(i, res2, true);
            else { failed = true; onDone({ error: (i + 1) + '번째 구간 경로를 찾지 못했어요 (' + status + ')' }); }
          });
        });
      })(i);
    }
  }

  /* ---------- 검색 ---------- */
  function service() { return new google.maps.places.PlacesService(map); }

  function searchText(query, center) {
    return new Promise((res) => {
      service().textSearch({ query: query, location: center, radius: 30000 }, (results, status) => {
        if (status !== 'OK' || !results) { res([]); return; }
        res(results.slice(0, 12).map(p => fmtPlace(p)));
      });
    });
  }
  function nearbyFood(center, radius) {
    return new Promise((res) => {
      service().nearbySearch({ location: center, radius: radius || 1200, type: 'restaurant' }, (results, status) => {
        if (status !== 'OK' || !results) { res([]); return; }
        const good = results
          .filter(p => p.rating && p.rating >= 4.0)
          .sort((a, b) => (b.rating - a.rating) || ((b.user_ratings_total || 0) - (a.user_ratings_total || 0)));
        res(good.slice(0, 12).map(p => fmtPlace(p)));
      });
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

  return { init, setMarkers, clearMarkers, fitBounds, panTo, getCenter, isReady, clearRoute, drawRoute, drawTransit, searchText, nearbyFood };
})();
