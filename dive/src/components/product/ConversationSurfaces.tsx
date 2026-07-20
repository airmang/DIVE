import { lazy, memo, Suspense, type ComponentProps } from "react";
import { PrdAuthoringBoard } from "./PrdAuthoringBoard";
import { FinalPrdReadView } from "./FinalPrdReadView";
import { SocraticInterviewPanel } from "./SocraticInterviewPanel";
import { PlanDraftRecoveryScreen } from "./PlanDraftRecoveryScreen";
import { PlanDraftPendingScreen } from "./PlanDraftPendingScreen";
import type { PlanDraftApprovalScreen as PlanDraftApprovalScreenComponent } from "./PlanDraftApprovalScreen";

const PlanDraftApprovalScreen = lazy(() =>
  import("./PlanDraftApprovalScreen").then((module) => ({
    default: module.PlanDraftApprovalScreen,
  })),
);

// The shell controller exposes these surfaces as plain data (props + a variant
// tag) instead of building React elements itself; ConversationPanel renders the
// matching component. This keeps the hook free of createElement while producing
// exactly the same output ChatArea consumed before.
export type InterviewSurfaceData = ComponentProps<typeof SocraticInterviewPanel>;

export type PrdSurfaceData =
  | { mode: "authoring"; props: ComponentProps<typeof PrdAuthoringBoard> }
  | { mode: "read"; props: ComponentProps<typeof FinalPrdReadView> };

export type PlanDraftSurfaceData =
  | { mode: "approval"; props: ComponentProps<typeof PlanDraftApprovalScreenComponent> }
  | { mode: "recovery"; props: ComponentProps<typeof PlanDraftRecoveryScreen> }
  | { mode: "pending" };

// Wrapped in memo so a referentially stable `data` (e.g. the memoized
// prdSurface) bails out of re-render, preserving the same-element
// reconciliation skip these surfaces had before ConversationPanel wrapped
// controller data into elements.
export const InterviewSurface = memo(function InterviewSurface({
  data,
}: {
  data: InterviewSurfaceData;
}) {
  return <SocraticInterviewPanel {...data} />;
});

export const PrdSurface = memo(function PrdSurface({ data }: { data: PrdSurfaceData }) {
  return data.mode === "authoring" ? (
    <PrdAuthoringBoard {...data.props} />
  ) : (
    <FinalPrdReadView {...data.props} />
  );
});

export const PlanDraftSurface = memo(function PlanDraftSurface({
  data,
}: {
  data: PlanDraftSurfaceData;
}) {
  if (data.mode === "approval") {
    return (
      <Suspense fallback={null}>
        <PlanDraftApprovalScreen {...data.props} />
      </Suspense>
    );
  }
  if (data.mode === "recovery") {
    return <PlanDraftRecoveryScreen {...data.props} />;
  }
  return <PlanDraftPendingScreen />;
});
