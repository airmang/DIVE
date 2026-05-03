import { useState } from "react";
import { Inbox, FolderPlus, MessageSquarePlus } from "lucide-react";
import { Button } from "../components/ui/button";
import { Card } from "../components/ui/card";
import { Skeleton } from "../components/ui/skeleton";
import { RestoreConfirmDialog } from "../components/slide-in/RestoreConfirmDialog";
import { useToast } from "../components/toast/toast-context";

export function PolishDemoPage() {
  const { toast } = useToast();
  const [restoreOpen, setRestoreOpen] = useState(false);
  const [loadingProjects, setLoadingProjects] = useState(true);
  const [loadingChat, setLoadingChat] = useState(true);

  const confirmRestore = () => {
    toast({
      variant: "info",
      title: "체크포인트 복원 중…",
      description: "[V 통과] 로그인 폼",
    });
    setTimeout(() => {
      toast({
        variant: "success",
        title: "복원 완료",
        description: "파일이 이전 체크포인트 상태로 되돌아갔습니다.",
      });
    }, 400);
  };

  return (
    <div className="min-h-screen bg-bg p-8 text-fg" data-testid="polish-demo-shell">
      <div className="mx-auto flex max-w-4xl flex-col gap-8">
        <div>
          <h1 className="text-2xl font-bold">폴리싱 데모</h1>
          <p className="text-sm text-fg-muted">
            Skeleton · 빈 상태 · 복원 확인 다이얼로그 · 토스트
          </p>
        </div>

        <section data-testid="demo-section-skeleton">
          <h2 className="text-lg font-semibold">스켈레톤 로딩</h2>
          <div className="mt-3 grid grid-cols-2 gap-4">
            <Card className="flex flex-col gap-2 p-3" data-testid="skeleton-panel-projects">
              <div className="flex items-center justify-between">
                <span className="text-xs font-semibold text-fg-muted">프로젝트</span>
                <Button
                  size="sm"
                  variant="ghost"
                  onClick={() => setLoadingProjects((s) => !s)}
                  data-testid="skeleton-toggle-projects"
                >
                  {loadingProjects ? "로드 완료" : "다시 로드"}
                </Button>
              </div>
              {loadingProjects ? (
                <>
                  <Skeleton height={24} />
                  <Skeleton height={24} />
                  <Skeleton height={24} width="70%" />
                </>
              ) : (
                <ul className="text-sm">
                  <li>로그인 페이지</li>
                  <li>쇼핑 카트</li>
                </ul>
              )}
            </Card>

            <Card className="flex flex-col gap-2 p-3" data-testid="skeleton-panel-chat">
              <div className="flex items-center justify-between">
                <span className="text-xs font-semibold text-fg-muted">채팅</span>
                <Button
                  size="sm"
                  variant="ghost"
                  onClick={() => setLoadingChat((s) => !s)}
                  data-testid="skeleton-toggle-chat"
                >
                  {loadingChat ? "로드 완료" : "다시 로드"}
                </Button>
              </div>
              {loadingChat ? (
                <>
                  <Skeleton height={48} />
                  <Skeleton height={32} width="85%" />
                </>
              ) : (
                <p className="text-sm text-fg-muted">메시지가 로드되었습니다.</p>
              )}
            </Card>
          </div>
        </section>

        <section data-testid="demo-section-empty">
          <h2 className="text-lg font-semibold">빈 상태 (4종 일관성)</h2>
          <div className="mt-3 grid grid-cols-2 gap-4">
            <EmptyState
              testId="empty-project"
              icon={<FolderPlus className="h-6 w-6 text-fg-muted" />}
              title="프로젝트가 없습니다"
              description="새 프로젝트를 만들어 시작하세요."
              actionLabel="+ 새 프로젝트"
              onAction={() => toast({ variant: "info", title: "새 프로젝트 생성 화면 열기" })}
            />
            <EmptyState
              testId="empty-session"
              icon={<MessageSquarePlus className="h-6 w-6 text-fg-muted" />}
              title="세션이 없습니다"
              description="첫 세션을 만들어 AI와 대화를 시작하세요."
              actionLabel="+ 새 세션"
              onAction={() => toast({ variant: "info", title: "새 세션 생성" })}
            />
            <EmptyState
              testId="empty-messages"
              icon={<Inbox className="h-6 w-6 text-fg-muted" />}
              title="메시지가 없습니다"
              description="무엇을 만들지 아래에 적어 보세요."
            />
            <EmptyState
              testId="empty-cards"
              icon={<Inbox className="h-6 w-6 text-fg-muted" />}
              title="카드가 없습니다"
              description="AI 도움 받기로 4개 카드를 자동 생성할 수 있습니다."
              actionLabel="AI 도움 받기"
              onAction={() => toast({ variant: "info", title: "AI 도움 열기" })}
            />
          </div>
        </section>

        <section data-testid="demo-section-restore">
          <h2 className="text-lg font-semibold">복원 확인 다이얼로그</h2>
          <div className="mt-3 flex gap-2">
            <Button onClick={() => setRestoreOpen(true)} data-testid="btn-open-restore">
              체크포인트로 복원…
            </Button>
            <Button
              variant="outline"
              onClick={() =>
                toast({
                  variant: "success",
                  title: "체크포인트 저장됨",
                  description: "수동 저장",
                })
              }
              data-testid="btn-save-ctrl-s"
            >
              Ctrl+S (토스트 테스트)
            </Button>
          </div>
        </section>
      </div>
      <RestoreConfirmDialog
        open={restoreOpen}
        onOpenChange={setRestoreOpen}
        checkpointLabel="[V 통과] 로그인 폼"
        onConfirm={confirmRestore}
      />
    </div>
  );
}

function EmptyState({
  testId,
  icon,
  title,
  description,
  actionLabel,
  onAction,
}: {
  testId: string;
  icon: React.ReactNode;
  title: string;
  description: string;
  actionLabel?: string;
  onAction?: () => void;
}) {
  return (
    <Card className="flex flex-col items-center gap-2 p-6 text-center" data-testid={testId}>
      <div className="flex h-10 w-10 items-center justify-center rounded-full bg-bg-panel2">
        {icon}
      </div>
      <div className="text-sm font-semibold text-fg">{title}</div>
      <div className="text-xs text-fg-muted">{description}</div>
      {actionLabel && onAction ? (
        <Button size="sm" variant="outline" onClick={onAction}>
          {actionLabel}
        </Button>
      ) : null}
    </Card>
  );
}

export default PolishDemoPage;
