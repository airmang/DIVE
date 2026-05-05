import { useMemo, useState } from "react";
import { ArrowLeft } from "lucide-react";
import { Button } from "../components/ui/button";

type ScaleKey = "sus" | "nasa_tlx_short" | "dive_learning_flow";

interface Item {
  id: string;
  label: string;
  scale: ScaleKey;
}

const ITEMS: Item[] = [
  { id: "sus_01", scale: "sus", label: "DIVE를 자주 사용하고 싶다고 느꼈다." },
  { id: "sus_02", scale: "sus", label: "DIVE는 불필요하게 복잡하다고 느꼈다." },
  { id: "sus_03", scale: "sus", label: "DIVE는 사용하기 쉽다고 느꼈다." },
  { id: "sus_04", scale: "sus", label: "DIVE 사용에는 전문가 도움이 필요하다고 느꼈다." },
  { id: "sus_05", scale: "sus", label: "DIVE의 기능들이 잘 통합되어 있다고 느꼈다." },
  { id: "sus_06", scale: "sus", label: "DIVE에는 일관성이 부족하다고 느꼈다." },
  { id: "sus_07", scale: "sus", label: "대부분의 사람이 DIVE를 빠르게 배울 것 같다." },
  { id: "sus_08", scale: "sus", label: "DIVE는 사용하기 번거롭다고 느꼈다." },
  { id: "sus_09", scale: "sus", label: "DIVE를 자신 있게 사용할 수 있었다." },
  { id: "sus_10", scale: "sus", label: "DIVE를 쓰기 전 많은 것을 배워야 한다고 느꼈다." },
  { id: "tlx_mental", scale: "nasa_tlx_short", label: "정신적 요구가 컸다." },
  { id: "tlx_effort", scale: "nasa_tlx_short", label: "많은 노력이 필요했다." },
  { id: "tlx_frustration", scale: "nasa_tlx_short", label: "좌절감이 컸다." },
  { id: "tlx_performance", scale: "nasa_tlx_short", label: "내 수행 결과에 만족한다." },
  { id: "tlx_temporal", scale: "nasa_tlx_short", label: "시간 압박이 컸다." },
  { id: "tlx_physical", scale: "nasa_tlx_short", label: "신체적 부담이 컸다." },
  {
    id: "dive_goal",
    scale: "dive_learning_flow",
    label: "내가 만든 기능의 전체 목표를 설명할 수 있다.",
  },
  {
    id: "dive_stage",
    scale: "dive_learning_flow",
    label: "활동 중 내가 D/I/V/E 어느 단계에 있는지 알 수 있었다.",
  },
  {
    id: "dive_reason",
    scale: "dive_learning_flow",
    label: "AI가 왜 도구 권한을 요청하는지 이해할 수 있었다.",
  },
  {
    id: "dive_verify",
    scale: "dive_learning_flow",
    label: "최종 결과가 검증되었는지 판단할 수 있었다.",
  },
  {
    id: "dive_error",
    scale: "dive_learning_flow",
    label: "오류가 났을 때 다음 행동을 알 수 있었다.",
  },
];

const SCALE_LABEL: Record<ScaleKey, string> = {
  sus: "SUS",
  nasa_tlx_short: "NASA-TLX short form",
  dive_learning_flow: "DIVE learning-flow items",
};

function initialResponses() {
  return Object.fromEntries(ITEMS.map((item) => [item.id, 3])) as Record<string, number>;
}

function scoreSus(responses: Record<string, number>) {
  const values = ITEMS.filter((item) => item.scale === "sus").map((item, index) => {
    const raw = responses[item.id] ?? 3;
    return index % 2 === 0 ? raw - 1 : 5 - raw;
  });
  return values.reduce((sum, value) => sum + value, 0) * 2.5;
}

export default function ResearchSurveyPage() {
  const [responses, setResponses] = useState<Record<string, number>>(initialResponses);

  const payload = useMemo(() => {
    const byScale = ITEMS.reduce<Record<ScaleKey, Array<{ id: string; value: number }>>>(
      (acc, item) => {
        acc[item.scale].push({ id: item.id, value: responses[item.id] ?? 3 });
        return acc;
      },
      { sus: [], nasa_tlx_short: [], dive_learning_flow: [] },
    );
    return {
      exported_at: new Date().toISOString(),
      instrument_version: "2026-05-05",
      responses: byScale,
      scores: {
        sus_total: scoreSus(responses),
        nasa_tlx_short_mean:
          byScale.nasa_tlx_short.reduce((sum, item) => sum + item.value, 0) /
          byScale.nasa_tlx_short.length,
        dive_learning_flow_mean:
          byScale.dive_learning_flow.reduce((sum, item) => sum + item.value, 0) /
          byScale.dive_learning_flow.length,
      },
    };
  }, [responses]);

  const backToSettings = () => {
    const url = new URL(window.location.href);
    url.searchParams.set("route", "settings");
    window.history.pushState({}, "", url.toString());
    window.dispatchEvent(new PopStateEvent("popstate"));
  };

  const downloadJson = () => {
    const blob = new Blob([`${JSON.stringify(payload, null, 2)}\n`], {
      type: "application/json",
    });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = "dive-research-survey.json";
    a.click();
    URL.revokeObjectURL(url);
  };

  return (
    <div className="min-h-screen w-screen overflow-y-auto bg-bg px-8 py-6 text-fg">
      <div className="mx-auto flex max-w-4xl flex-col gap-6">
        <div className="flex items-center justify-between">
          <Button
            variant="ghost"
            size="sm"
            onClick={backToSettings}
            data-testid="research-survey-back"
          >
            <ArrowLeft className="h-4 w-4" />
            설정으로
          </Button>
          <h1 className="text-2xl font-bold">연구 설문</h1>
          <Button variant="outline" size="sm" onClick={downloadJson} data-testid="survey-download">
            JSON 저장
          </Button>
        </div>

        {(["sus", "nasa_tlx_short", "dive_learning_flow"] as const).map((scale) => (
          <section key={scale} className="rounded-md border bg-bg-panel p-4">
            <h2 className="text-lg font-semibold">{SCALE_LABEL[scale]}</h2>
            <p className="mt-1 text-xs text-fg-muted">1 = 전혀 아니다, 5 = 매우 그렇다</p>
            <div className="mt-4 flex flex-col gap-3">
              {ITEMS.filter((item) => item.scale === scale).map((item) => (
                <label
                  key={item.id}
                  className="grid gap-2 rounded-md border bg-bg px-3 py-2 text-sm md:grid-cols-[1fr_160px]"
                >
                  <span>{item.label}</span>
                  <select
                    value={responses[item.id] ?? 3}
                    onChange={(e) =>
                      setResponses((prev) => ({ ...prev, [item.id]: Number(e.target.value) }))
                    }
                    data-testid={`survey-${item.id}`}
                    className="rounded-md border bg-bg-panel px-2 py-1 text-sm"
                  >
                    {[1, 2, 3, 4, 5].map((value) => (
                      <option key={value} value={value}>
                        {value}
                      </option>
                    ))}
                  </select>
                </label>
              ))}
            </div>
          </section>
        ))}

        <section className="rounded-md border bg-bg-panel p-4">
          <h2 className="text-lg font-semibold">집계 미리보기</h2>
          <pre className="mt-2 max-h-72 overflow-auto rounded bg-bg p-3 text-xs">
            {JSON.stringify(payload, null, 2)}
          </pre>
        </section>
      </div>
    </div>
  );
}
