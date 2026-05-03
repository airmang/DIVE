# 작업 18: 익명화 export (JSONL)

## 컨텍스트
연구 산출물 평가의 데이터 기반. 차시 단위로 EventLog와 카드·메시지 데이터를 SHA-256 해시 마스킹 후 JSONL로 출력합니다. 명세 §6.7.

## 이번 작업 범위
- export 메뉴 (설정 → 데이터 내보내기)
- 차시 선택 + 마스킹 옵션 체크박스 + 명시 동의
- JSONL 생성 — 명세 §6.7.3 스키마
- SHA-256 해시 마스킹 (학번 등 식별자)
- 사용자 PC에 직접 저장 (다이얼로그)

## 명세 참조
- DIVE_SPEC.md §6.7 — 익명화 export 전체
- DIVE_SPEC.md §9.4 — 데이터 프라이버시
- DIVE_SPEC.md §10.5 — EventLog

## 단계

1. `src-tauri/src/export/mod.rs` — export 코어:
   ```rust
   pub struct ExportOptions {
       session_ids: Vec<String>,
       include_card_titles: bool,
       include_card_instructions: bool,
       include_message_bodies: bool,
       include_diff_bodies: bool,
       student_id_hash_salt: String,
   }
   pub async fn export_jsonl(options: ExportOptions, output_path: &Path)
       -> Result<ExportSummary>
   ```
2. JSONL 생성 — 이벤트 종류별 한 줄씩:
   ```jsonl
   {"event":"session_start","ts":1735000000,"sid":"a1b2","uid":"hash_xxx"}
   {"event":"stage_enter","ts":...,"sid":"a1b2","stage":"D"}
   {"event":"card_create","ts":...,"sid":"a1b2","card":"c01","title_len":18}
   {"event":"stage_exit","ts":...,"sid":"a1b2","stage":"D","duration_ms":420000,"cards":4}
   {"event":"tool_call","ts":...,"sid":"a1b2","tool":"edit_file","approved":1,"latency_ms":2300}
   {"event":"verify_result","ts":...,"sid":"a1b2","card":"c01","ai_pass":1,"user_approve":1}
   ```
3. 옵션별 추가 필드:
   - `include_card_titles=true` → `"title":"..."` 추가
   - `include_message_bodies=true` → `"content":"..."` 추가
   - 옵션 OFF 시 길이만 (`"title_len":18`)
4. 학번 해시 — 사용자가 학번 입력하면 SHA-256(salt + 학번)로 마스킹. 원본 저장 안 함.
5. UI (`src/components/export/ExportDialog.tsx`):
   - 설정 → "데이터 내보내기" 진입
   - 차시 선택 (체크박스 다중)
   - 옵션 체크박스 — 카드 본문 포함, 메시지 본문 포함, 코드 변경 diff 포함
   - 명시 동의 체크박스 — "이 데이터는 후속 분석·연구 목적으로만 사용됩니다"
   - 학번 입력 (옵션, 학번이 있을 때만 마스킹 적용)
   - [내보내기] → 저장 다이얼로그 → JSONL 생성
6. 주의 사항 안내 텍스트 — 카드/메시지 본문 포함 시 추가 경고 ("개인 식별 가능 텍스트가 포함될 수 있습니다. 익명화 후 사용을 권장합니다.")
7. export 완료 후 — 요약 토스트 ("3개 차시, 1,234개 이벤트, 2.3MB 저장됨")

## 완료 조건
- [ ] JSONL 파일이 명세 §6.7.3 스키마와 일치
- [ ] 옵션 OFF 시 본문 미포함 (길이 등 메타만)
- [ ] 학번 입력 시 해시 마스킹 적용, 원본 미저장
- [ ] 명시 동의 체크박스 미체크 시 [내보내기] 비활성
- [ ] 차시 여러 개 선택 시 한 파일에 모두 포함
- [ ] EventLog의 모든 이벤트 종류가 export 대상
- [ ] `cargo test` 통과

## 확인 질문
- salt 관리 — 매 export마다 새 salt vs 사용자 PC 고정 salt. 새 salt 추천 (export 간 학번 매칭 불가능 → 더 안전). 단, 같은 export 내에서는 일관성 있게 적용.
- 코드 변경 diff 포함 시 용량 — 큰 프로젝트에서 수백 MB 가능. 파일 크기 경고 표시.
- export 진행 중 UI — 큰 차시 export는 수십 초. 프로그레스 바 + 취소 버튼.
- export된 파일에 메타데이터 헤더 추가 — JSONL 첫 줄에 export 시점·옵션 등 메타 이벤트. 분석 시 도움.

## 작업 후
- DIVE_PROGRESS.md 3-6 `[x]`
- **Phase 3 완료. v0.2 핵심 기능 완성. Phase 4 시작 전 사용자 점검 시점.**
- ADR: salt 관리 정책, export 진행 UX
