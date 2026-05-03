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
    defaultSummary: "지시 작성 대기 — 카드를 클릭해 시작하세요",
    progressText: "D",
  },
  instructed: {
    label: "진행 중",
    colorToken: "accent",
    barClass: "bg-accent",
    iconBgClass: "bg-accent-subtle",
    iconFgClass: "text-accent",
    icon: CircleDashed,
    animate: false,
    defaultSummary: "지시 작성됨 — I 단계 진행 중",
    progressText: "DI",
  },
  verifying: {
    label: "검증 중",
    colorToken: "warn",
    barClass: "bg-warn",
    iconBgClass: "bg-warn/15",
    iconFgClass: "text-warn",
    icon: Loader2,
    animate: true,
    defaultSummary: "AI 자체검증 진행 중…",
    progressText: "DIV",
  },
  verified: {
    label: "완료",
    colorToken: "success",
    barClass: "bg-success",
    iconBgClass: "bg-success/15",
    iconFgClass: "text-success",
    icon: CheckCircle2,
    animate: false,
    defaultSummary: "검증 통과 — 코드 보기로 결과 확인",
    progressText: "DIVE",
  },
  rejected: {
    label: "거부",
    colorToken: "danger",
    barClass: "bg-danger",
    iconBgClass: "bg-danger/15",
    iconFgClass: "text-danger",
    icon: XCircle,
    animate: false,
    defaultSummary: "검증 거부 — 지시를 수정해 다시 시도",
    progressText: "DIV",
  },
  extended: {
    label: "확장 완료",
    colorToken: "success",
    barClass: "bg-success/70",
    iconBgClass: "bg-success/10",
    iconFgClass: "text-success",
    icon: PlusCircle,
    animate: false,
    defaultSummary: "E 단계 통합·확장 완료",
    progressText: "DIVE",
  },
};

export function getCardStateMeta(state: CardState): CardStateMeta {
  return CARD_STATE_META[state];
}
