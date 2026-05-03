import { useState } from "react";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "../ui/dialog";
import { Button } from "../ui/button";
import { Input } from "../ui/input";
import { useProjectSessionStore } from "../../stores/project-session";

interface Props {
  open: boolean;
  onOpenChange: (open: boolean) => void;
}

const PROVIDER_CHOICES: Array<{ kind: string; label: string; hint: string }> = [
  { kind: "anthropic", label: "Anthropic", hint: "claude-sonnet-4.5 등" },
  { kind: "openai", label: "OpenAI", hint: "gpt-4o, o1 등" },
  { kind: "openrouter", label: "OpenRouter", hint: "여러 모델 통합" },
];

export function OnboardingDialog({ open, onOpenChange }: Props) {
  const connectProvider = useProjectSessionStore((s) => s.connectProvider);
  const setOnboarded = useProjectSessionStore((s) => s.setOnboarded);
  const [kind, setKind] = useState("anthropic");
  const [apiKey, setApiKey] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const handleConnect = async () => {
    if (!apiKey.trim()) {
      setError("API 키를 입력하세요.");
      return;
    }
    setSubmitting(true);
    setError(null);
    try {
      await connectProvider(kind, apiKey.trim());
      setOnboarded(true);
      onOpenChange(false);
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setSubmitting(false);
    }
  };

  const handleSkip = () => {
    setOnboarded(true);
    onOpenChange(false);
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent data-testid="onboarding-dialog" className="max-w-md">
        <DialogHeader>
          <DialogTitle>DIVE 시작하기</DialogTitle>
          <DialogDescription>
            학생이라면 선생님에게 받은 키를, 교사라면 직접 발급한 키를 입력하세요.
          </DialogDescription>
        </DialogHeader>
        <div className="flex flex-col gap-3">
          <div className="flex flex-col gap-1.5">
            <label className="text-xs font-medium text-fg-muted" htmlFor="onb-kind">
              프로바이더
            </label>
            <div className="grid grid-cols-3 gap-2" data-testid="onb-provider-list">
              {PROVIDER_CHOICES.map((p) => (
                <button
                  key={p.kind}
                  type="button"
                  onClick={() => setKind(p.kind)}
                  data-testid={`onb-kind-${p.kind}`}
                  data-selected={kind === p.kind}
                  className={
                    kind === p.kind
                      ? "rounded-md border-2 border-accent bg-accent-subtle px-3 py-2 text-left"
                      : "rounded-md border px-3 py-2 text-left hover:bg-bg-panel2"
                  }
                >
                  <div className="text-sm font-medium text-fg">{p.label}</div>
                  <div className="text-[10px] text-fg-muted">{p.hint}</div>
                </button>
              ))}
            </div>
          </div>
          <div className="flex flex-col gap-1.5">
            <label className="text-xs font-medium text-fg-muted" htmlFor="onb-api-key">
              API 키
            </label>
            <Input
              id="onb-api-key"
              data-testid="onb-api-key"
              type="password"
              value={apiKey}
              onChange={(e) => setApiKey(e.target.value)}
              placeholder="sk-..."
              autoComplete="off"
              spellCheck={false}
            />
          </div>
          {error ? (
            <p className="text-xs text-danger" role="alert" data-testid="onb-error">
              {error}
            </p>
          ) : null}
        </div>
        <DialogFooter>
          <Button variant="ghost" onClick={handleSkip} data-testid="onb-skip" disabled={submitting}>
            나중에 설정
          </Button>
          <Button onClick={handleConnect} data-testid="onb-connect" disabled={submitting}>
            {submitting ? "연결 중…" : "연결하기"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

export default OnboardingDialog;
