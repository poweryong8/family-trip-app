# 🧳 우리 가족 여행 (Family Trip App)

가족 여행을 **여행 전(계획) → 여행 중(현장) → 여행 후(리포트)** 한 곳에서 관리하는 웹앱.
첫 여행 데이터로 '삿포로 가족여행 (2026-09-12 ~ 16)'이 들어 있습니다.

## 기능

- **일정 편집** — 일자별 장소 추가/수정/삭제, 자동 저장 (브라우저 localStorage)
- **구글 지도** — 일자별 색상 마커(맛집🍜 관광🏔️ 숙소🏨 교통🚉 …), 클릭 시 메모·링크
- **이동 경로** — 차 / 대중교통 / 도보 모드. 대중교통은 구간별 버스·열차 노선과 출발/도착 시간 표시
- **시간표·이동** — 일자별 이동 안내 + 공식 시간표/예약 사이트 링크 (JR 홋카이도, 공항 리무진, Resort Liner, 도난버스)
- **맛집 검색** — 장소 검색 / 지도 주변 맛집(평점·리뷰·영업시간) → 일정에 바로 추가
- **사진 기록** — 현장에서 촬영(또는 앨범 선택) → 해당 장소에 첨부, 기기 저장소(IndexedDB) 보관
- **여행 리포트** — 일자별 사진+방문지+메모 자동 조합 → PDF로 저장/가족 공유
- **여행 여러 개** — 여행 추가/선택, 백업 JSON 내보내기/가져오기

## 실행 (로컬)

```bash
cd family-trip-app
python3 -m http.server 8123
# 브라우저에서 http://localhost:8123
```

`file://`로 열면 브라우저 제한으로 일부 기능이 안 될 수 있으니 반드시 로컬 서버를 쓰세요.

## 필요: Google Cloud API 키

`js/config.js`의 `FTA_CONFIG.apiKey`에 키를 넣습니다. 키에 **3개 API가 모두 활성화**되어야
전체 기능이 동작합니다:

| API | 용도 | 없으면 |
|---|---|---|
| Maps JavaScript API | 지도·마커 | 지도 안 나옴 |
| Directions API | 이동 경로 | 경로 REQUEST_DENIED |
| Places API | 맛집/장소 검색 | 검색 결과 0건 |

활성화: console.cloud.google.com → 프로젝트 선택 → 'API 및 서비스' → '라이브러리' →
Directions API, Places API 각각 '사용 설정'.

**보안**: 키에 'HTTP 리퍼러 제한'을 걸어 두세요. 배포 주소(예: `https://내아이디.github.io/*`)와
`http://localhost:*`를 허용 목록에 추가. 그래야 키가 다른 곳에서 도용돼도 쓸 수 없습니다.

## 배포 (GitHub Pages, 무료)

```bash
cd family-trip-app
git init && git add -A && git commit -m "family trip app"
git remote add origin https://github.com/내아이디/family-trip-app.git
git push -u origin main
```

GitHub 저장소 → Settings → Pages → Source: `main` branch / root → 저장.
배포된 `https://내아이디.github.io/family-trip-app/`를 키의 리퍼러 제한에 추가하면
폰에서 바로 사용할 수 있습니다.

**주의**: `js/config.js`의 API 키는 배포 시 공개되지만, 리퍼러 제한이 걸려 있으면
내 도메인에서만 동작하므로 안전합니다.

## 데이터는 어디에?

- 일정·메모·즐겨찾기 → 브라우저 localStorage (기기별)
- 사진 → 브라우저 IndexedDB (기기별, 용량 큼)
- **백업**: 설정 → 내보내기로 JSON 저장 / 여행 리포트를 PDF로 저장해 보존하세요.
  브라우저 데이터 삭제 시 사진이 사라집니다.

## 파일 구조

```
index.html          앱 셸
css/style.css       디자인 시스템 (모바일 우선)
js/config.js        API 키 설정
js/data.js          카테고리·일자 색상·교통 링크·기본 여행(삿포로) 데이터
js/storage.js       localStorage + IndexedDB + 이미지 압축 + 백업
js/maps.js          구글 지도: 마커·경로·검색
js/report.js        여행 리포트 생성
js/app.js           메인 로직 (일정 편집·모달·사진·설정)
```
