// 여행 리포트: 일자별 사진 + 방문 장소 + 메모 자동 조합
window.FTReport = (function () {
  const D = window.FTA_DATA, S = window.FTStore;
  const DAYS = ['일', '월', '화', '수', '목', '금', '토'];

  function esc(s) {
    return String(s == null ? '' : s).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  }
  function fmtDate(d) {
    if (!d) return '';
    const p = d.split('-');
    const dt = new Date(p[0], p[1] - 1, p[2]);
    return p[0] + '년 ' + Number(p[1]) + '월 ' + Number(p[2]) + '일 (' + DAYS[dt.getDay()] + ')';
  }

  async function build(trip) {
    let photosTotal = 0;
    let html = '<div id="report">';
    html += '<h1>🧳 ' + esc(trip.name) + '</h1>';
    html += '<div class="r-sub">' + fmtDate(trip.startDate) + ' ~ ' + fmtDate(trip.endDate) + '</div>';

    for (let di = 0; di < trip.days.length; di++) {
      const day = trip.days[di];
      const color = D.DAY_COLORS[di % D.DAY_COLORS.length];
      html += '<section class="r-day">';
      html += '<div class="r-day-head"><span class="r-dot" style="background:' + color + '"></span>' +
        '<div><h2>' + (di + 1) + '일차 · ' + esc(day.title) + '</h2>' +
        '<div class="r-date">' + fmtDate(day.date) + '</div></div></div>';

      for (const p of day.places) {
        const cat = D.CATEGORIES[p.category] || D.CATEGORIES.other;
        html += '<div class="r-place"><span>' + cat.emoji + '</span><span class="n">' + esc(p.name) + '</span>' +
          '<span class="c">' + cat.label + '</span></div>';
        if (p.note) html += '<div class="r-note">' + esc(p.note) + '</div>';
        const photos = await S.getPhotos(trip.id, p.id);
        if (photos.length) {
          photosTotal += photos.length;
          html += '<div class="r-photos">' + photos.map(ph => '<img src="' + ph.dataUrl + '" alt="' + esc(p.name) + '">').join('') + '</div>';
        }
      }
      if (day.transport) html += '<div class="r-note">🚌 ' + esc(day.transport) + '</div>';
      html += '</section>';
    }
    html += '</div>';

    return { html, photoCount: photosTotal };
  }

  return { build, fmtDate };
})();
