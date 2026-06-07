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
  /** i18n key resolved with `t()` at the call site (e.g. `card_state.verified.label`). */
  labelKey: string;
  colorToken: StateColorToken;
  barClass: string;
  iconBgClass: string;
  iconFgClass: string;
  icon: LucideIcon;
  animate: boolean;
  /** i18n key for the fallback summary shown when a card has no user summary. */
  defaultSummaryKey: string;
  progressText: string;
}

export const CARD_STATE_META: Record<CardState, CardStateMeta> = {
  decomposed: {
    labelKey: "card_state.decomposed.label",
    colorToken: "info",
    barClass: "bg-info",
    iconBgClass: "bg-info/15",
    iconFgClass: "text-info",
    icon: Circle,
    animate: false,
    defaultSummaryKey: "card_state.decomposed.summary",
    progressText: "1",
  },
  instructed: {
    labelKey: "card_state.instructed.label",
    colorToken: "accent",
    barClass: "bg-accent",
    iconBgClass: "bg-accent-subtle",
    iconFgClass: "text-accent",
    icon: CircleDashed,
    animate: false,
    defaultSummaryKey: "card_state.instructed.summary",
    progressText: "2",
  },
  verifying: {
    labelKey: "card_state.verifying.label",
    colorToken: "warn",
    barClass: "bg-warn",
    iconBgClass: "bg-warn/15",
    iconFgClass: "text-warn",
    icon: Loader2,
    animate: true,
    defaultSummaryKey: "card_state.verifying.summary",
    progressText: "3",
  },
  verified: {
    labelKey: "card_state.verified.label",
    colorToken: "success",
    barClass: "bg-success",
    iconBgClass: "bg-success/15",
    iconFgClass: "text-success",
    icon: CheckCircle2,
    animate: false,
    defaultSummaryKey: "card_state.verified.summary",
    progressText: "4",
  },
  rejected: {
    labelKey: "card_state.rejected.label",
    colorToken: "danger",
    barClass: "bg-danger",
    iconBgClass: "bg-danger/15",
    iconFgClass: "text-danger",
    icon: XCircle,
    animate: false,
    defaultSummaryKey: "card_state.rejected.summary",
    progressText: "3",
  },
  extended: {
    labelKey: "card_state.extended.label",
    colorToken: "success",
    barClass: "bg-success/70",
    iconBgClass: "bg-success/10",
    iconFgClass: "text-success",
    icon: PlusCircle,
    animate: false,
    defaultSummaryKey: "card_state.extended.summary",
    progressText: "4",
  },
};

export function getCardStateMeta(state: CardState): CardStateMeta {
  return CARD_STATE_META[state];
}
