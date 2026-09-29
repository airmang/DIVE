import policyJson from "./supervision-policy.json";

/**
 * Spec 015 FR-002 — versioned deterministic supervision policy.
 *
 * Every tunable review-card trigger threshold lives in `supervision-policy.json`,
 * which the Rust provoke gate embeds too (`src-tauri/src/dive/supervision_policy.rs`,
 * `include_str!` of the same file). Values change only between releases, each
 * with a new `policyVersion` that is sent with every supervisor evaluation and
 * logged on `provocation.supervisor_evaluated` (D-015-01). Output-contract
 * limits (question length, evidence/action caps) are schema, not policy.
 */
export interface SupervisionPolicy {
  policyVersion: string;
  /** RetryLoop: minimum repeated failures of one fingerprint. */
  retryLoopMinFailures: number;
  /** PlanDrafted: a step expecting at least this many files is "broad". */
  broadStepMinExpectedFiles: number;
  /** ScopeExpansion: debounce before an add-step draft is evaluated. */
  scopeSupervisorDebounceMs: number;
  /** Evidence summaries: default text truncation length. */
  evidenceTextMaxChars: number;
  /** Evidence summaries: default list truncation length. */
  evidenceListMaxItems: number;
  /** PlanDrafted: maximum evidence refs sent to the supervisor. */
  planDraftEvidenceRefCap: number;
  /** AI self-report detection: how many recent assistant reports are read. */
  recentAssistantReportCount: number;
}

export const SUPERVISION_POLICY: Readonly<SupervisionPolicy> = Object.freeze(policyJson);
