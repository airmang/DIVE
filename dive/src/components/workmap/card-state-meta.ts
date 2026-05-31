import {
  CheckCircle2,
  Circle,
  CircleDashed,
  Loader2,
  PlusCircle,
  XCircle,
  type LucideIcon,
} from "lucide-react";
import type { CardState } from "./types";

export type StateColorToken = "info" | "accent" | "warn" | "success" | "danger";

interface CardStateMeta {
  label: string;
  colorToken: StateColorToken;
  barClass: string;
  iconBgClass: string;
  iconFgClass: string;
  icon: LucideIcon;
  animate: boolean;
  defaultSummary: string;
  progressText: string;
}

export const CARD_STATE_META: Record<CardState, CardStateMeta> = {
  decomposed: {
    label: "대기",
    colorToken: "info",
    barClass: "bg-info",
    iconBgClass: "bg-info/15",
    iconFgClass: "text-info",
    icon: Circle,
    animate: false,
    defaultSummary: "할 일 작성 대기 — 단계를 클릭해 시작하세요",
    progressText: "1",
  },
  instructed: {
    label: "진행 중",
    colorToken: "accent",
    barClass: "bg-accent",
    iconBgClass: "bg-accent-subtle",
    iconFgClass: "text-accent",
    icon: CircleDashed,
    animate: false,
    defaultSummary: "할 일 작성됨 — 실행 준비 완료",
    progressText: "2",
  },
  verifying: {
    label: "검증 중",
    colorToken: "warn",
    barClass: "bg-warn",
    iconBgClass: "bg-warn/15",
    iconFgClass: "text-warn",
    icon: Loader2,
    animate: true,
    defaultSummary: "검증 진행 중…",
    progressText: "3",
  },
  verified: {
    label: "완료",
    colorToken: "success",
    barClass: "bg-success",
    iconBgClass: "bg-success/15",
    iconFgClass: "text-success",
    icon: CheckCircle2,
    animate: false,
    defaultSummary: "AI 검토 통과 — 직접 확인 권장",
    progressText: "4",
  },
  rejected: {
    label: "거부",
    colorToken: "danger",
    barClass: "bg-danger",
    iconBgClass: "bg-danger/15",
    iconFgClass: "text-danger",
    icon: XCircle,
    animate: false,
    defaultSummary: "검증 거부 — 할 일을 수정해 다시 시도",
    progressText: "3",
  },
  extended: {
    label: "완료",
    colorToken: "success",
    barClass: "bg-success/70",
    iconBgClass: "bg-success/10",
    iconFgClass: "text-success",
    icon: PlusCircle,
    animate: false,
    defaultSummary: "단계 완료",
    progressText: "4",
  },
};

export function getCardStateMeta(state: CardState): CardStateMeta {
  return CARD_STATE_META[state];
}
