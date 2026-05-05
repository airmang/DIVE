export function explainTestCommand(command: string | null | undefined): string {
  const trimmed = command?.trim();
  if (!trimmed) return "검증 명령이 없으면 실제 테스트는 실행되지 않습니다.";
  if (/\bpnpm\s+(test|vitest)\b/.test(trimmed)) {
    return "프론트엔드 자동 테스트를 실행해 UI/로직 회귀를 확인합니다.";
  }
  if (/\bnpm\s+(test|run\s+test)\b/.test(trimmed)) {
    return "Node 기반 자동 테스트를 실행해 기능 회귀를 확인합니다.";
  }
  if (/\bcargo\s+test\b/.test(trimmed)) {
    return "Rust 단위/통합 테스트를 실행해 백엔드 로직을 검증합니다.";
  }
  if (/\bcargo\s+check\b/.test(trimmed)) {
    return "Rust 코드가 컴파일 가능한지 빠르게 확인합니다.";
  }
  if (/\b(tsc|pnpm\s+typecheck)\b/.test(trimmed)) {
    return "TypeScript 타입 오류가 없는지 확인합니다.";
  }
  if (/\b(eslint|pnpm\s+lint)\b/.test(trimmed)) {
    return "정적 분석으로 코드 품질과 규칙 위반을 확인합니다.";
  }
  if (/\bplaywright\b/.test(trimmed)) {
    return "브라우저 시나리오를 실행해 실제 사용자 흐름을 검증합니다.";
  }
  return "프로젝트 루트에서 실행되는 검증 명령입니다. stdout/stderr와 종료 코드를 확인하세요.";
}
