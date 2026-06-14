import { ArrowLeft, FileQuestion, LifeBuoy } from "lucide-react";
import { Button } from "../components/ui/button";

type GuideDoc = "index" | "troubleshooting";

const GUIDE_INDEX = `# DIVE 사용자 가이드

학생, 교사, 일반 사용자를 위한 실용 문서입니다.

## 문서 안내

- tutorial.md: 처음 DIVE를 접하는 학습자
- faq.md: 이미 써본 사용자의 자주 묻는 질문
- troubleshooting.md: 문제가 생겼을 때 증상별 해결 절차

## 역할별 추천 순서

### 학생

1. tutorial.md - 4단계 완주
2. 어려운 상황에서 troubleshooting.md
3. 궁금하면 faq.md

### 교사

1. teacher-manual.md - 운영 매뉴얼
2. scenarios/ - 차시별 지도안
3. tutorial.md - 학생이 보는 가이드를 직접 실행
4. faq.md Q19, Q20 - 익명화 export로 사후 분석 준비

### IT 담당자

1. windows-build-guide.md - 배포 경로 3종
2. packaging-windows.md - 릴리스 패키징 상세
3. troubleshooting.md - WebView2와 설치 문제 확인`;

const TROUBLESHOOTING = `# DIVE 트러블슈팅

증상, 원인, 해결 순으로 정리했습니다.

## 설치

### 증상: SmartScreen 경고 "게시자를 알 수 없음"

- 원인: EV 코드 서명 미적용
- 해결: 추가 정보 -> 실행을 선택합니다.

### 증상: WebView2 런타임 설치 실패

- 원인: 오프라인 환경 또는 Windows 10 초기 빌드
- 해결: Microsoft 공식 WebView2 런타임을 별도 설치한 뒤 DIVE를 다시 설치합니다.

## 첫 실행

### 증상: 앱을 실행했는데 창이 안 보임 또는 까만 창

1. DIVE 로그 폴더의 최신 로그를 확인합니다.
2. WebView2 런타임을 재설치합니다.
3. 계속 실패하면 GPU 드라이버를 업데이트하고 로그를 교사나 지원 담당자에게 공유합니다.

### 증상: 온보딩에서 폴더 선택이 응답 없음

- 원인: 관리자 권한이 필요한 경로를 프로젝트 폴더로 지정
- 해결: 사용자 홈 아래의 일반 폴더를 선택합니다.

## AI 프로바이더 연결

### 증상: 프로바이더 미연결이 사라지지 않음

1. 설정 -> 프로바이더 -> 연결 테스트를 실행합니다.
2. 401이면 키 만료 또는 형식 오류를 확인합니다.
3. 새 키를 발급해 교체합니다.

### 증상: 429 Rate Limited가 반복됨

- 원인: 크레딧 소진 또는 분당 요청 제한
- 해결: 프로바이더 콘솔에서 잔여 크레딧과 모델 제한을 확인합니다.

## DIVE 4단계 흐름

### 증상: 채팅창이 계속 잠겨 있음

- 원인: 현재 단계의 게이트 조건 미충족
- 해결: 배너 안내에 따라 카드 추가, 지시 입력, 검증 단계 전환을 완료합니다.`;

const DOCS: Record<
  GuideDoc,
  { title: string; description: string; icon: typeof LifeBuoy; body: string }
> = {
  index: {
    title: "DIVE 사용자 가이드",
    description: "학생, 교사, IT 담당자를 위한 로컬 사용 문서입니다.",
    icon: LifeBuoy,
    body: GUIDE_INDEX,
  },
  troubleshooting: {
    title: "DIVE 트러블슈팅",
    description: "문제 신고 전에 확인할 증상별 해결 절차입니다.",
    icon: FileQuestion,
    body: TROUBLESHOOTING,
  },
};

function currentDoc(): GuideDoc {
  if (typeof window === "undefined") return "index";
  return window.location.search.includes("doc=troubleshooting") ? "troubleshooting" : "index";
}

function goBackToWorkspace() {
  const url = new URL(window.location.href);
  url.searchParams.delete("route");
  url.searchParams.delete("doc");
  window.history.pushState({}, "", url.toString());
  window.dispatchEvent(new PopStateEvent("popstate"));
}

function MarkdownText({ markdown }: { markdown: string }) {
  return (
    <pre className="whitespace-pre-wrap break-words font-sans text-sm leading-7 text-fg">
      {markdown}
    </pre>
  );
}

export function UserGuidePage() {
  const doc = DOCS[currentDoc()];
  const Icon = doc.icon;

  return (
    <div className="min-h-screen bg-bg text-fg" data-testid="user-guide-page">
      <header className="border-b bg-bg-panel px-6 py-4">
        <div className="mx-auto flex max-w-5xl items-center gap-3">
          <Button
            variant="ghost"
            size="sm"
            onClick={goBackToWorkspace}
            aria-label="작업공간으로 돌아가기"
          >
            <ArrowLeft aria-hidden size={16} />
            작업공간
          </Button>
          <div className="h-6 w-px bg-border" aria-hidden />
          <Icon aria-hidden className="text-primary" size={20} />
          <div>
            <h1 className="text-base font-semibold">{doc.title}</h1>
            <p className="text-xs text-fg-muted">{doc.description}</p>
          </div>
        </div>
      </header>
      <main className="mx-auto max-w-5xl px-6 py-6">
        <div className="rounded-md border bg-bg-panel p-5">
          <MarkdownText markdown={doc.body} />
        </div>
      </main>
    </div>
  );
}

export default UserGuidePage;
