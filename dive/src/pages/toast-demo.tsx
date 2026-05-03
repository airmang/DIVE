import { useState } from "react";
import { Button } from "../components/ui/button";
import { useToast } from "../components/toast/toast-context";

export function ToastDemoPage() {
  const { toast } = useToast();
  const [retrying, setRetrying] = useState(false);

  const fireError = () => {
    toast({
      variant: "error",
      title: "네트워크 오류",
      description: "응답을 받지 못했습니다. 잠시 후 다시 시도하세요.",
      actionLabel: "다시 시도",
      onAction: () => {
        setRetrying(true);
        setTimeout(() => {
          setRetrying(false);
          toast({
            variant: "success",
            title: "재시도 성공",
            description: "메시지 전송이 완료되었습니다.",
          });
        }, 500);
      },
    });
  };

  return (
    <div className="min-h-screen bg-bg p-8 text-fg" data-testid="toast-demo-shell">
      <div className="mx-auto flex max-w-xl flex-col gap-4">
        <div>
          <h1 className="text-2xl font-bold">토스트 데모</h1>
          <p className="text-sm text-fg-muted">
            4 variant + stacking (최대 3개) + auto dismiss 5초.
          </p>
        </div>
        <div className="flex flex-wrap gap-2">
          <Button
            onClick={() =>
              toast({ variant: "success", title: "체크포인트 저장됨", description: "auto-2" })
            }
            data-testid="btn-toast-success"
          >
            Success
          </Button>
          <Button
            variant="outline"
            onClick={() => toast({ variant: "info", title: "알림", description: "메시지 전송 중" })}
            data-testid="btn-toast-info"
          >
            Info
          </Button>
          <Button
            variant="outline"
            onClick={() =>
              toast({
                variant: "warn",
                title: "주의",
                description: "API 키 유효시간이 곧 만료됩니다",
              })
            }
            data-testid="btn-toast-warn"
          >
            Warn
          </Button>
          <Button variant="outline" onClick={fireError} data-testid="btn-toast-error">
            Error (with retry action)
          </Button>
        </div>
        <div className="text-xs text-fg-muted" data-testid="retrying-status">
          retrying: {retrying ? "true" : "false"}
        </div>
      </div>
    </div>
  );
}

export default ToastDemoPage;
