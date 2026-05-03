# 작업 17: OpenRouter Provisioning Keys (학생 키 분배)

## 컨텍스트
파일럿 운영의 핵심 인프라. 교사가 메인 키 1개로 학생용 임시 키를 차시별 발급하고 종료 시 일괄 폐기. 명세 §7.5.

## 이번 작업 범위
- OpenRouter 어댑터 추가 (LlmProvider 구현)
- Provisioning Keys API 통합 — 자식 키 발급·조회·폐기
- 교사용 UI — 차시별 키 발급 다이얼로그
- 학생용 UI — QR 또는 짧은 URL로 키 등록
- 차시 종료 시 일괄 폐기

## 명세 참조
- DIVE_SPEC.md §7.5 — OpenRouter (부수) 전체
- DIVE_SPEC.md §10.2 — ProviderConfig

## 단계

1. `src-tauri/src/providers/openrouter.rs` — LlmProvider 구현 (OpenAI 호환이라 단순)
2. `src-tauri/src/providers/openrouter_keys.rs` — Provisioning Keys API:
   ```rust
   pub async fn create_child_key(parent_key: &str, label: &str, limit: u64, expires_at: i64)
       -> Result<ChildKey>
   pub async fn list_child_keys(parent_key: &str) -> Result<Vec<ChildKey>>
   pub async fn revoke_child_key(parent_key: &str, key_id: &str) -> Result<()>
   pub async fn revoke_all_child_keys(parent_key: &str, label_prefix: &str) -> Result<u32>
   ```
3. 교사용 UI (`src/components/teacher/KeyDispatcher.tsx`):
   - 메인 OpenRouter 키 등록 (keyring 저장)
   - 차시 정보 입력 — 학생 수, 차시별 한도(예: 50,000 토큰), 만료 시각
   - [발급] 클릭 → 학생 수만큼 자식 키 생성, 라벨 형식 `YYYY-MM-DD-period-N-student-M`
   - 발급된 키 목록 표시 — QR 코드 + 짧은 URL
   - 차시별 [폐기] 버튼 — 라벨 prefix로 일괄 revoke
4. 학생용 UI (`src/components/student/KeyImport.tsx`):
   - 첫 실행 시 또는 설정에서 [수업용 키 등록] 진입
   - 카메라 QR 스캔 (`@zxing/library`) 또는 짧은 URL 입력
   - 키 등록 시 OpenRouter 프로바이더 자동 활성화, ProviderConfig 등록
5. QR 인코딩 — JSON: `{ "key": "sk-or-child-...", "url": "https://openrouter.ai/api/v1", "label": "..." }`
6. 한도 도달 시 — OpenRouter API가 429 반환. 사용자에게 "수업용 키 한도 도달" 토스트
7. 만료 처리 — `expires_at` 도래 시 OpenRouter가 자동 거부. 사용자에게 친절한 에러 메시지
8. 단위 테스트 — mock OpenRouter API 응답으로 발급·조회·폐기 동작

## 완료 조건
- [ ] 메인 키로 자식 키 발급 성공
- [ ] 발급된 키로 LLM 호출 성공
- [ ] 한도 도달 시 명확한 에러 토스트
- [ ] 만료 후 사용 시 명확한 에러
- [ ] [폐기] 시 OpenRouter 측에서 실제로 무효화 확인
- [ ] QR 스캔 → 자동 등록 흐름 동작
- [ ] 단위 테스트 통과

## 확인 질문
- 메인 키 안전 — 학생 PC에 저장되면 노출 위험. 메인 키는 **교사 PC에만**, 학생 PC에는 자식 키만. UI에서 명확히 구분 필요.
- QR 코드 — 키를 직접 인코딩 vs 짧은 URL을 통해 한 번 더 fetch. 직접 인코딩 추천 (오프라인 가능).
- 키 분배 채널 — QR + 짧은 URL 외에 NFC, 블루투스 등? 학교 환경 고려해 QR + URL만으로 충분할 듯.
- 한도 단위 — 명세는 토큰. 비용($)으로도 가능. 토큰 추천 (예측 용이).
- 학생이 키 등록 후 메인 화면에 어떻게 안내할지 — 자동 프로바이더 전환 + 토스트 "수업용 키 등록 완료, 차시 종료 시 자동 폐기됩니다"

## 작업 후
- DIVE_PROGRESS.md 3-5 `[x]`
- ADR: 메인 키 분리 정책, QR 인코딩 형식, 한도 단위 결정
