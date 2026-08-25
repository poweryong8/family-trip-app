// 저장소: 여행/일정(localStorage) + 사진(IndexedDB) + 백업 내보내기/가져오기
window.FTStore = (function () {
  const LS_KEY = 'ft-state-v1';
  const DB_NAME = 'ft-photos';
  const DB_VER = 1;
  const STORE = 'photos';

  function uid() {
    return 'p' + Date.now().toString(36) + Math.random().toString(36).slice(2, 7);
  }
  function clone(o) { return JSON.parse(JSON.stringify(o)); }

  /* ---------- 여행/일정 (localStorage) ---------- */
  function getState() {
    try {
      const s = localStorage.getItem(LS_KEY);
      if (s) {
        const st = JSON.parse(s);
        if (st && Array.isArray(st.trips) && st.trips.length) return st;
      }
    } catch (e) { /* 손상 시 시드 재생성 */ }
    return null;
  }
  function saveState(st) { localStorage.setItem(LS_KEY, JSON.stringify(st)); }

  function ensureSeed() {
    if (!getState()) {
      const seed = clone(FTA_DATA.SEED_TRIPS);
      saveState({ trips: seed, activeTripId: seed[0].id });
    }
  }
  function activeTrip() {
    const st = getState();
    if (!st) return null;
    return st.trips.find(t => t.id === st.activeTripId) || st.trips[0];
  }
  function setActiveTrip(id) {
    const st = getState(); if (!st) return;
    if (st.trips.some(t => t.id === id)) { st.activeTripId = id; saveState(st); }
  }
  function saveTrip(trip) {
    const st = getState(); if (!st) return;
    const i = st.trips.findIndex(t => t.id === trip.id);
    if (i >= 0) st.trips[i] = trip; else st.trips.push(trip);
    saveState(st);
  }
  function deleteTrip(id) {
    const st = getState(); if (!st) return;
    st.trips = st.trips.filter(t => t.id !== id);
    if (st.activeTripId === id) st.activeTripId = st.trips[0] ? st.trips[0].id : null;
    if (!st.trips.length) { ensureSeed(); return; }
    saveState(st);
  }
  function addTrip(name, startDate, endDate) {
    const st = getState(); if (!st) return null;
    const days = [];
    const s = new Date(startDate), e = new Date(endDate);
    let n = 1;
    for (let d = new Date(s); d <= e; d.setDate(d.getDate() + 1)) {
      days.push({ date: d.toISOString().slice(0, 10), title: n + '일차', transport: '', places: [] });
      n++;
    }
    const trip = { id: uid(), name, startDate, endDate, days };
    st.trips.push(trip);
    st.activeTripId = trip.id;
    saveState(st);
    return trip;
  }

  /* ---------- 사진 (IndexedDB) ---------- */
  function idb() {
    return new Promise((res, rej) => {
      const r = indexedDB.open(DB_NAME, DB_VER);
      r.onupgradeneeded = () => { r.result.createObjectStore(STORE); };
      r.onsuccess = () => res(r.result);
      r.onerror = () => rej(r.error);
    });
  }
  function pkey(tripId, placeId) { return tripId + '::' + placeId; }

  async function getPhotos(tripId, placeId) {
    const db = await idb();
    return new Promise((res) => {
      const tx = db.transaction(STORE, 'readonly');
      const rq = tx.objectStore(STORE).get(pkey(tripId, placeId));
      rq.onsuccess = () => res(rq.result || []);
      rq.onerror = () => res([]);
    });
  }
  async function addPhoto(tripId, placeId, photo) {
    const db = await idb();
    const key = pkey(tripId, placeId);
    const list = await getPhotos(tripId, placeId);
    list.push(photo);
    return new Promise((res, rej) => {
      const tx = db.transaction(STORE, 'readwrite');
      tx.objectStore(STORE).put(list, key);
      tx.oncomplete = () => res(list);
      tx.onerror = () => rej(tx.error);
    });
  }
  async function deletePhoto(tripId, placeId, photoId) {
    const db = await idb();
    const key = pkey(tripId, placeId);
    const list = await getPhotos(tripId, placeId);
    const next = list.filter(p => p.id !== photoId);
    return new Promise((res, rej) => {
      const tx = db.transaction(STORE, 'readwrite');
      const os = tx.objectStore(STORE);
      if (next.length) os.put(next, key); else os.delete(key);
      tx.oncomplete = () => res(next);
      tx.onerror = () => rej(tx.error);
    });
  }
  async function countPhotos() {
    const db = await idb();
    return new Promise((res) => {
      const tx = db.transaction(STORE, 'readonly');
      const rq = tx.objectStore(STORE).getAll();
      rq.onsuccess = () => res(rq.result.reduce((a, l) => a + l.length, 0));
      rq.onerror = () => res(0);
    });
  }

  /* ---------- 이미지 압축 (사진 촬영/선택 → 저장) ---------- */
  function compressImage(file, max = 1280, quality = 0.78) {
    return new Promise((res, rej) => {
      const img = new Image();
      const url = URL.createObjectURL(file);
      img.onload = () => {
        const scale = Math.min(1, max / Math.max(img.width, img.height));
        const w = Math.max(1, Math.round(img.width * scale));
        const h = Math.max(1, Math.round(img.height * scale));
        const c = document.createElement('canvas');
        c.width = w; c.height = h;
        c.getContext('2d').drawImage(img, 0, 0, w, h);
        URL.revokeObjectURL(url);
        res(c.toDataURL('image/jpeg', quality));
      };
      img.onerror = () => { URL.revokeObjectURL(url); rej(new Error('이미지를 읽을 수 없어요 (HEIC인 경우 JPEG로 찍어 주세요)')); };
      img.src = url;
    });
  }

  /* ---------- 백업 내보내기/가져오기 ---------- */
  function exportJSON() {
    const st = getState();
    const data = { app: 'family-trip-app', version: 1, exportedAt: new Date().toISOString(), trips: st.trips, activeTripId: st.activeTripId };
    const blob = new Blob([JSON.stringify(data, null, 1)], { type: 'application/json' });
    const a = document.createElement('a');
    const d = new Date();
    const f = '가족여행-백업-' + d.getFullYear() + String(d.getMonth() + 1).padStart(2, '0') + String(d.getDate()).padStart(2, '0') + '.json';
    a.href = URL.createObjectURL(blob);
    a.download = f;
    a.click();
    URL.revokeObjectURL(a.href);
  }
  function importJSON(file) {
    return new Promise((res, rej) => {
      const r = new FileReader();
      r.onload = () => {
        try {
          const data = JSON.parse(r.result);
          if (!Array.isArray(data.trips) || !data.trips.length) throw new Error('여행 데이터가 없어요');
          for (const t of data.trips) {
            if (!t.id || !Array.isArray(t.days)) throw new Error('파일 형식이 올바르지 않아요');
          }
          const active = data.trips.some(t => t.id === data.activeTripId) ? data.activeTripId : data.trips[0].id;
          saveState({ trips: data.trips, activeTripId: active });
          res({ ok: true, trips: data.trips.length });
        } catch (e) { rej(e); }
      };
      r.onerror = () => rej(new Error('파일을 읽지 못했어요'));
      r.readAsText(file);
    });
  }

  return { uid, clone, getState, saveState, ensureSeed, activeTrip, setActiveTrip, saveTrip, deleteTrip, addTrip,
           getPhotos, addPhoto, deletePhoto, countPhotos, compressImage, exportJSON, importJSON };
})();
