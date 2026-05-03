import { Moon, Sun, AlertTriangle, CheckCircle2, Info, Sparkles } from "lucide-react";
import { useTheme } from "../hooks/useTheme";
import { Button } from "../components/ui/button";
import {
  Card,
  CardContent,
  CardDescription,
  CardFooter,
  CardHeader,
  CardTitle,
} from "../components/ui/card";
import { Badge } from "../components/ui/badge";
import { Input } from "../components/ui/input";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "../components/ui/tabs";
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from "../components/ui/tooltip";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "../components/ui/dialog";

function ThemeToggleButton() {
  const { theme, toggleTheme } = useTheme();
  const nextLabel = theme === "dark" ? "라이트 모드로" : "다크 모드로";
  return (
    <Button variant="outline" size="sm" onClick={toggleTheme} aria-label={nextLabel}>
      {theme === "dark" ? <Sun /> : <Moon />}
      {nextLabel}
    </Button>
  );
}

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <section className="space-y-3">
      <h2 className="text-xl font-semibold text-fg">{title}</h2>
      <div className="rounded-lg border bg-bg-panel p-4">{children}</div>
    </section>
  );
}

export default function ShowcasePage() {
  const { theme } = useTheme();

  return (
    <TooltipProvider delayDuration={200}>
      <div className="min-h-full bg-bg text-fg">
        <header className="flex items-center justify-between border-b bg-bg-panel px-6 py-4">
          <div className="flex items-center gap-3">
            <div className="h-8 w-8 rounded-md bg-accent" aria-hidden />
            <div>
              <h1 className="text-2xl font-semibold leading-tight">DIVE 디자인 시스템</h1>
              <p className="text-xs text-fg-muted">
                명세 §2.3 · 현재 모드: <span className="font-mono">{theme}</span>
              </p>
            </div>
          </div>
          <ThemeToggleButton />
        </header>

        <main className="mx-auto max-w-5xl space-y-8 px-6 py-8">
          <Section title="Button">
            <div className="flex flex-wrap items-center gap-3">
              <Button variant="primary">Primary</Button>
              <Button variant="secondary">Secondary</Button>
              <Button variant="outline">Outline</Button>
              <Button variant="ghost">Ghost</Button>
              <Button variant="danger">Danger</Button>
              <Button variant="link">Link</Button>
              <Button disabled>Disabled</Button>
            </div>
            <div className="mt-3 flex flex-wrap items-center gap-3">
              <Button size="sm">
                <Sparkles />
                Small
              </Button>
              <Button size="md">Medium</Button>
              <Button size="lg">Large</Button>
              <Button size="icon" aria-label="도움말">
                <Info />
              </Button>
            </div>
          </Section>

          <Section title="Badge">
            <div className="flex flex-wrap items-center gap-2">
              <Badge variant="default">기본</Badge>
              <Badge variant="accent">Accent</Badge>
              <Badge variant="success">
                <CheckCircle2 className="size-3" />
                통과
              </Badge>
              <Badge variant="warn">
                <AlertTriangle className="size-3" />
                주의
              </Badge>
              <Badge variant="danger">위험</Badge>
              <Badge variant="info">정보</Badge>
              <Badge variant="outline">outline</Badge>
            </div>
          </Section>

          <Section title="Card">
            <div className="grid gap-4 sm:grid-cols-2">
              <Card>
                <CardHeader>
                  <CardTitle>D — 분해</CardTitle>
                  <CardDescription>요구를 작은 카드로 쪼갭니다.</CardDescription>
                </CardHeader>
                <CardContent className="text-sm text-fg-muted">
                  워크맵 하단 가로 띠의 카드 한 장을 닮았습니다. 패널 배경(panel2)과 1px 테두리만
                  사용합니다.
                </CardContent>
                <CardFooter>
                  <Button variant="primary" size="sm">
                    카드 추가
                  </Button>
                  <Button variant="ghost" size="sm">
                    취소
                  </Button>
                </CardFooter>
              </Card>
              <Card>
                <CardHeader>
                  <CardTitle>V — 검증</CardTitle>
                  <CardDescription>의도-코드 일치 여부를 확인합니다.</CardDescription>
                </CardHeader>
                <CardContent className="flex flex-wrap gap-2">
                  <Badge variant="success">검증 통과</Badge>
                  <Badge variant="warn">검증 중</Badge>
                  <Badge variant="danger">실패</Badge>
                </CardContent>
              </Card>
            </div>
          </Section>

          <Section title="Input">
            <div className="grid max-w-md gap-3">
              <Input placeholder="할 일 앱을 만들고 싶어요" aria-label="프로젝트 의도" />
              <Input type="password" placeholder="sk-..." aria-label="API 키" />
              <Input disabled placeholder="비활성 상태" />
            </div>
          </Section>

          <Section title="Tabs">
            <Tabs defaultValue="code" className="w-full">
              <TabsList>
                <TabsTrigger value="code">코드</TabsTrigger>
                <TabsTrigger value="preview">미리보기</TabsTrigger>
                <TabsTrigger value="terminal">터미널</TabsTrigger>
              </TabsList>
              <TabsContent value="code">
                <div className="rounded-md border bg-bg-panel2 p-4 font-mono text-sm">
                  <span className="text-success">+ function</span>
                  <span className="text-fg"> add(a, b) {"{"}</span>
                  <br />
                  <span className="ml-4 text-fg">return a + b;</span>
                  <br />
                  <span className="text-fg">{"}"}</span>
                </div>
              </TabsContent>
              <TabsContent value="preview">
                <div className="rounded-md border bg-bg-panel2 p-8 text-center text-sm text-fg-muted">
                  미리보기 영역 placeholder
                </div>
              </TabsContent>
              <TabsContent value="terminal">
                <pre className="rounded-md border bg-bg-panel2 p-4 font-mono text-xs text-fg-muted">
                  $ pnpm typecheck{"\n"}✓ 에러 없음
                </pre>
              </TabsContent>
            </Tabs>
          </Section>

          <Section title="Tooltip">
            <div className="flex gap-3">
              <Tooltip>
                <TooltipTrigger asChild>
                  <Button variant="outline" size="sm">
                    마우스를 올려 보세요
                  </Button>
                </TooltipTrigger>
                <TooltipContent>키보드 포커스에도 나타납니다 (Tab)</TooltipContent>
              </Tooltip>
              <Tooltip>
                <TooltipTrigger asChild>
                  <Button variant="ghost" size="icon" aria-label="도움말">
                    <Info />
                  </Button>
                </TooltipTrigger>
                <TooltipContent>명세 §5.5 — 권한 카드 상세</TooltipContent>
              </Tooltip>
            </div>
          </Section>

          <Section title="Dialog">
            <Dialog>
              <DialogTrigger asChild>
                <Button variant="primary">모달 열기</Button>
              </DialogTrigger>
              <DialogContent>
                <DialogHeader>
                  <DialogTitle>프로젝트를 삭제합니다</DialogTitle>
                  <DialogDescription>
                    관련 세션·카드·체크포인트가 모두 제거됩니다. 되돌릴 수 없습니다.
                  </DialogDescription>
                </DialogHeader>
                <DialogFooter>
                  <Button variant="ghost">취소</Button>
                  <Button variant="danger">영구 삭제</Button>
                </DialogFooter>
              </DialogContent>
            </Dialog>
          </Section>

          <footer className="pt-6 text-xs text-fg-subtle">
            모든 색상은 DIVE_SPEC.md §2.3 디자인 토큰으로만 정의되었습니다.
          </footer>
        </main>
      </div>
    </TooltipProvider>
  );
}
