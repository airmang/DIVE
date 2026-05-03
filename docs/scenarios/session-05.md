# 차시 05 — API 호출 + 에러 처리 + 재시도

**학습 목표**: 외부 API(예: `https://api.quotable.io/random` 또는 교사 제공 mock endpoint) 호출. 네트워크 오류 시 DIVE 재시도 + 토스트 경험.

**전제**: 차시 04에서 JS 기본 동작 익힘.

---

## 수업 흐름

### 0-5분: API 개념 간단 설명

- "API = 다른 컴퓨터한테 데이터 요청"
- 오늘 사용 API: `https://api.quotable.io/random` (명언 랜덤 반환)
- 화이트보드에 요청/응답 예시 JSON

### 5-15분: D 단계 — 카드 3개

- 카드 A: "명언 가져오기" 버튼 추가
- 카드 B: fetch API 호출 코드
- 카드 C: 명언 표시 영역 + 에러 표시

### 15-35분: I → V 순환 × 3

각 카드 차례로 진행. 강조점:

**카드 B** 지시: "async function fetchQuote() { const res = await fetch('https://api.quotable.io/random'); const data = await res.json(); document.getElementById('quote').textContent = data.content; }"

- 권한 카드 → diff 확인 → 승인
- **중요**: 이 단계에서 AI가 `try/catch` 없이 작성했다면 카드 C에서 보강
- verified

**카드 C** 지시: "fetch 실패 시 '명언 가져오기 실패' 메시지 표시. fetchQuote() 함수에 try/catch 추가"
- edit_file → diff → 승인
- verified

### 35-45분: 에러 시나리오 연습

**교사 유도**:
1. 학생 각자 네트워크 끄기 (Wi-Fi 일시 차단)
2. "명언 가져오기" 버튼 클릭 → 에러 발생
3. 학생들이 구현한 에러 메시지 뜨는 것 확인
4. 네트워크 복구 → 정상 동작

**DIVE 재시도 체험**:
1. 채팅에 "명언 하나 더 가져와줘" 입력 (학생)
2. 교사가 네트워크 살짝 끊었다가 복구
3. DIVE가 자동 재시도 (토스트 "재시도 중…" 표시)
4. 성공 시 success 토스트

### 45-50분: Export

---

## 교사 개입 포인트

### CORS / 네트워크 환경

- `api.quotable.io`는 공개 API지만 학교 방화벽이 막을 수 있음 → 미리 확인
- 막히면 교사 PC에서 mock 서버(`python -m http.server`) 실행 + 고정 JSON 파일 제공

### 에러 처리 교육

- "에러는 버그가 아니라 **정보**야"
- "사용자에게 '실패함'을 알려주는 게 좋은 UX"

### DIVE 재시도 vs 코드 재시도

- DIVE 레벨 재시도: 네트워크 오류 시 provider.chat() 자동 3회
- 코드 레벨 재시도: 학생 코드 안의 `try/catch` → 사용자에게 메시지
- 두 레이어가 **독립적**임을 강조

## 예상 문제

- **CORS 오류**: 학생 콘솔에 "blocked by CORS policy" → 교사 mock 서버 사용
- **async/await 개념 낯섦**: 처음 접하는 학생 많음 → 지시에 명시적으로 async 키워드 포함
- **토스트 못 봄**: 너무 빨리 사라짐 → 토스트 기본 5초 유지 → 학생에게 화면 우하단 집중 안내

## 차시 종료 체크

- [ ] 학생 40%+ 카드 3개 모두 verified (난이도 상승)
- [ ] 학생 50%+ 명언 1회 이상 실제 가져오기 성공
- [ ] 의도적 네트워크 끊기 실험 수행

## 관련 명세

- §9.6 에러 + 재시도
- §12.4 에러 메시지 i18n
