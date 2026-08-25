// 여행 데이터: 카테고리·일자 색상·공식 교통 링크·기본 여행(삿포로)
window.FTA_DATA = {
  DAY_COLORS: ['#E07A5F', '#3D8B7D', '#7C9A4D', '#5B7DB1', '#9B6B9E'],

  CATEGORIES: {
    restaurant: { label: '맛집',     emoji: '🍜' },
    cafe:       { label: '카페·디저트', emoji: '☕' },
    hotel:      { label: '숙소',     emoji: '🏨' },
    attraction: { label: '관광',     emoji: '🏔️' },
    shopping:   { label: '쇼핑',     emoji: '🛍️' },
    transport:  { label: '교통',     emoji: '🚉' },
    other:      { label: '기타',     emoji: '⭐' }
  },

  // 공식 교통/예약 사이트 (실시간 시간표는 여기서 확인)
  TRANSPORT_LINKS: [
    { name: 'JR 홋카이도 — 열차 시간표·운임', url: 'https://www.jrhokkaido.co.jp/', emoji: '🚄' },
    { name: 'JR 후라노·비에이 여행 가이드', url: 'https://www.jrhokkaido.co.jp/travel/furanobiei/index.html', emoji: '🌾' },
    { name: '공항 리무진·시내버스 (홋카이도 중앙버스)', url: 'https://www.chuo-bus.co.jp/airport/', emoji: '🚌' },
    { name: 'Resort Liner 예약 (access-n)', url: 'https://www.access-n.jp/', emoji: '🎟️' },
    { name: '도난버스 고속온센호 — 삿포로↔노보리베쓰 (예약제)', url: 'https://www.donanbus.co.jp/map/sap_onsen/', emoji: '♨️' },
    { name: '도난버스 도시간버스 — 노보리베쓰↔신치토세', url: 'https://www.donanbus.co.jp/citybus/', emoji: '✈️' }
  ],

  // 구간별 교통편 안내 (구글 트랜짓 미지원 구간 대체용 — 참고값, 최신은 공식 링크)
  // match: 구간 양 끝 장소명에 모두 포함되면 표시
  SCHEDULES: [
    { id: 'sap-otaru', match: ['삿포로', '오타루'], emoji: '🚄', line: 'JR函館본선 快速 에어포트',
      info: '최속 32분 · 800엔 · 매시간 3편 (1일 163편)', hours: '5:40~23:30 운행',
      note: '미나미오타루역 하차 → 오르골당·상점가 내리막길', url: 'https://www.jrhokkaido.co.jp/' },
    { id: 'cts-sap', match: ['신치토세', '삿포로'], emoji: '🚄', line: 'JR 快速 에어포트',
      info: '최속 37분(특급 33분) · 1,150엔 · 매시간 6편 (약 10분 간격)', hours: '5:30~23:30 운행',
      note: '공항↔삿포로 모두 동일. 공항 리무진(약 70분, 1,300엔)도 있음', url: 'https://www.jrhokkaido.co.jp/airport/' },
    { id: 'sap-nobo', match: ['삿포로', '노보리베쓰'], emoji: '🚄', line: 'JR 특급 스즈란',
      info: '약 1시간 10분 · 4,890엔(특급 포함) · 하루 약 7회', hours: '대표: 7:30 / 9:21 / 13:46 / 16:07 / 19:14 발',
      note: '登別역→온천거리 버스 약 15분 별도. 일반열차는 2,530엔·약 2시간', url: 'https://www.jrhokkaido.co.jp/' },
    { id: 'sap-nobo-bus', match: ['삿포로', '노보리베쓰'], emoji: '🚌', line: '도난버스 고속온센호',
      info: '약 1시간 50분 · 2,800~3,800엔 · 완전 예약제', hours: '삿포로역앞 → 登別온천(문전 하차)',
      note: 'JR보다 저렴하고 온천 앞까지 직행', url: 'https://www.donanbus.co.jp/map/sap_onsen/' },
    { id: 'nobo-cts', match: ['노보리베쓰', '신치토세'], emoji: '🚌', line: '도난버스 고속登別온천 에어포트호',
      info: '약 1시간 · 예약제', hours: '登別온천 → 공항 직행',
      note: '5일차 이동에 최적. JR 경유(登別→南千歳→공항)도 가능', url: 'https://www.donanbus.co.jp/citybus/' },
    { id: 'sap-biei', match: ['삿포로', '비에이'], emoji: '🚌', line: 'Resort Liner / 일일 투어버스',
      info: '시즌(6~10월) 운행 · 예약 필수', hours: '아침 출발 · 저녁 복귀 1일 코스',
      note: '3일차 비에이·후라노 이동은 공식 예약 사이트에서 확인', url: 'https://www.access-n.jp/' },
    { id: 'zoo', match: ['동물원'], emoji: '🚇', line: '지하철 도호선 + 도보',
      info: '오도리 → 마루야마공원 약 10분 · 290엔', hours: '',
      note: '마루야마공원역 → 동물원 도보 약 10분', url: 'https://www.jrhokkaido.co.jp/' }
  ],

  SEED_TRIPS: [
    {
      id: 'sapporo-202609',
      name: '삿포로 가족여행',
      startDate: '2026-09-12',
      endDate: '2026-09-16',
      days: [
        {
          date: '2026-09-12', title: '입국 · 시내',
          transport: '인천→신치토세 직항(약 2시간 50분)\n공항→숙소: JR 쾌속 에어포트(약 37분) 또는 공항 리무진(약 70분)\n저녁 이후는 전부 도보 동선',
          places: [
            { name: '라젠트 스테이 삿포로 오도리 (숙소)', category: 'hotel', lat: 43.0577548, lng: 141.3506687,
              note: '체크인. 다누키코지 상점가 바로 옆, 오도리 공원·스스키노 도보권',
              tags: ['숙소'], links: {} },
            { name: '히라츠카 징기스칸 스스키노점 (저녁)', category: 'restaurant', lat: 43.0541601, lng: 141.3570077,
              note: '풍수스스키노역 도보 1분. 양고기 징기스칸, 가족 테이블 OK. 예약 추천',
              tags: ['아이 좋아함'], links: { official: 'https://hiratsuka-genghiskhan-susukino.foodre.jp/' } },
            { name: '다누키코지 상점가', category: 'shopping', lat: 43.0569761, lng: 141.3505831,
              note: '캡슐토이(가챠) 매장 들르기 — 아이 선물. 숙소에서 도보 1~2분',
              tags: ['아이 좋아함'], links: {} },
            { name: '오도리 공원 & 삿포로 TV 타워 (야경)', category: 'attraction', lat: 43.0611129, lng: 141.3564484,
              note: '저녁 산책 겸 야경. TV타워 전망대는 21:00까지(계절 변동)',
              tags: ['야경'], links: {} }
          ]
        },
        {
          date: '2026-09-13', title: '동물원 · 오타루',
          transport: '숙소→마루야마 동물원: 지하철 도호선(오도리→마루야마공원, 약 10분) + 도보 10분\n동물원→JR 삿포로역: 택시 약 15분\n삿포로→미나미오타루: JR 函館본선 약 35분 → 이후 내리막길 도보 관광',
          places: [
            { name: '마루야마 동물원', category: 'attraction', lat: 43.0487514, lng: 141.306127,
              note: '오전 개장(9:30~). 북극곰·호랑이 인기. 지하철 마루야마공원역 + 도보 10분',
              tags: ['아이 좋아함'], links: {} },
            { name: 'JR 삿포로역 (이동)', category: 'transport', lat: 43.0686555, lng: 141.350787,
              note: '동물원→역은 택시 약 15분. 삿포로→미나미오타루 JR 약 35분',
              tags: [], links: {} },
            { name: '미나미오타루역 (이동)', category: 'transport', lat: 43.1870812, lng: 141.0076355,
              note: '여기서 하차 → 오르골당·상점가까지 내리막길 도보',
              tags: [], links: {} },
            { name: '오타루 오르골당', category: 'attraction', lat: 43.1905785, lng: 141.007792,
              note: '오르골 체험·기념품. 아이에게 인기',
              tags: ['아이 좋아함'], links: {} },
            { name: '르타오 본점', category: 'cafe', lat: 43.1913074, lng: 141.0074398,
              note: '더블프롬마쥬 케이크·소프트크림. 3층 테라스',
              tags: ['디저트'], links: {} },
            { name: '키타이치 유리 & 사카이마치 상점가', category: 'shopping', lat: 43.1915406, lng: 141.0073024,
              note: '사카이마치 거리 구경, 유리 공예',
              tags: [], links: {} },
            { name: '오타루 운하 (야경)', category: 'attraction', lat: 43.1978359, lng: 141.0032805,
              note: '아사쿠사바시 부근이 사진 명소. 운하 플라자 인근',
              tags: ['야경'], links: {} }
          ]
        },
        {
          date: '2026-09-14', title: '비에이 · 후라노 투어',
          transport: '월요일이라 주말보다 한산.\nResort Liner(예약 필수, access-n.jp) 또는 일일 투어버스로 이동\nJR 이용 시: 삿포로→아사히카와→비에이(특급+보통, 약 2시간)',
          places: [
            { name: '청의 호수 (비에이)', category: 'attraction', lat: 43.4934902, lng: 142.6140976,
              note: '맑은 날 일렉트릭블루. 투어/버스로 이동',
              tags: ['아이 좋아함'], links: {} },
            { name: '흰수염 폭포 (시라히게)', category: 'attraction', lat: 43.4745828, lng: 142.6391874,
              note: '청의 호수에서 도보 5분 거리',
              tags: [], links: {} },
            { name: '팜 토미타 (후라노, 선택)', category: 'attraction', lat: 43.4172981, lng: 142.4254766,
              note: '라벤더 시즌이 아니어도 꽃밭·멜론빵. 시간 여유 있을 때',
              tags: ['아이 좋아함'], links: {} }
          ]
        },
        {
          date: '2026-09-15', title: '노보리베쓰 온천',
          transport: 'JR 특급 스즈란(삿포로→노보리베쓰, 약 70분) + 역에서 온천행 버스(약 15분)\n또는 도난버스 고속온센호(삿포로역앞→노보리베쓰온천, 약 1시간 50분, 예약제)',
          places: [
            { name: '지옥계곡 (지고쿠다니)', category: 'attraction', lat: 42.4975716, lng: 141.1453349,
              note: '화산 연기·유황 냄새. 산책로 20~40분. 아이가 신기해함',
              tags: ['아이 좋아함'], links: {} },
            { name: '노보리베쓰 온천거리', category: 'shopping', lat: 42.4947756, lng: 141.1451398,
              note: '유령상점(유귀)·온천 계란(유다마고). 료칸 체크인 전후 산책',
              tags: [], links: {} },
            { name: '료칸 온천 & 가이세키 저녁', category: 'hotel', lat: 42.4947756, lng: 141.1451398,
              note: '온천 2~3회 + 가이세키 만찬. 누적 피로 회복',
              tags: ['온천'], links: {} }
          ]
        },
        {
          date: '2026-09-16', title: '신치토세 공항 · 귀국',
          transport: '노보리베쓰→공항: 도난버스 고속登別온천에어포트호(약 1시간) 또는 JR 경유\n14:30 비행기 → 11:30~12:00 공항 도착 목표(탑승 2시간 전)',
          places: [
            { name: '도라에몽 와쿠와쿠 스카이 파크', category: 'attraction', lat: 42.786787, lng: 141.6829598,
              note: '공항 3층. 놀이기구·포토존. 아이 최애',
              tags: ['아이 좋아함'], links: {} },
            { name: '헬로키티 해피 플라이트', category: 'attraction', lat: 42.7874263, lng: 141.6787725,
              note: '공항 3층. 키티 포토존·기념품',
              tags: ['아이 좋아함'], links: {} },
            { name: '로이즈 초콜릿 월드', category: 'cafe', lat: 42.786787, lng: 141.6829598,
              note: '초콜릿 공장 관람 + 공항 한정 상품',
              tags: [], links: {} },
            { name: '출국 (14:30 비행기)', category: 'transport', lat: 42.786787, lng: 141.6829598,
              note: '탑승 2시간 전 보안검색 통과 목표',
              tags: [], links: {} }
          ]
        }
      ]
    }
  ]
};
