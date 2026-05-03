#!/usr/bin/env bash
# DIVE Ralph 루프 실행 스크립트
# ChatGPT 구독 기반 codex CLI 사용

set -e

# 설정
SPEC_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PROMPT_FILE="$SPEC_DIR/RALPH_PROMPT.md"
NEXT_FILE="$SPEC_DIR/DIVE_NEXT.md"
LOG_DIR="$SPEC_DIR/ralph_logs"
mkdir -p "$LOG_DIR"

echo "DIVE Ralph 루프 시작 — $(date)"
echo "프롬프트: $PROMPT_FILE"
echo "로그: $LOG_DIR"
echo ""

# Phase 게이트 / BLOCKED 시 자동 정지
check_should_stop() {
  if grep -q "^\[PHASE_GATE\]" "$NEXT_FILE" 2>/dev/null; then
    echo ""
    echo "🛑 Phase 게이트에 도달했습니다. 사용자 확인이 필요합니다."
    echo "   $NEXT_FILE 를 확인하세요."
    exit 0
  fi
  if grep -q "^상태: \[BLOCKED\]" "$NEXT_FILE" 2>/dev/null; then
    echo ""
    echo "🛑 작업이 차단되었습니다 (BLOCKED). 사용자 결정이 필요합니다."
    echo "   $NEXT_FILE 의 '사용자에게 묻고 싶은 것' 섹션을 확인하세요."
    exit 0
  fi
}

# 메인 루프
turn=1
while true; do
  echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
  echo "턴 $turn — $(date '+%H:%M:%S')"
  echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"

  # 작업 시작 전 정지 조건 확인
  check_should_stop

  # 현재 작업 표시
  if [ -f "$NEXT_FILE" ]; then
    head -5 "$NEXT_FILE" | sed 's/^/  /'
  fi
  echo ""

  # codex 호출 (ChatGPT 구독)
  # codex CLI 사용법은 환경에 따라 조정 필요
  log_file="$LOG_DIR/turn_$(printf '%04d' $turn)_$(date '+%Y%m%d_%H%M%S').log"

  codex --model gpt-5.2-codex \
        --working-dir "$SPEC_DIR/.." \
        < "$PROMPT_FILE" \
        2>&1 | tee "$log_file"

  # 작업 후 정지 조건 다시 확인
  check_should_stop

  # 짧은 휴식 (rate limit 방지)
  sleep 5

  turn=$((turn + 1))

  # 안전장치: 1000턴 초과 시 자동 정지
  if [ "$turn" -gt 1000 ]; then
    echo "🛑 1000턴 초과. 사용자 점검을 위해 정지합니다."
    exit 0
  fi
done
