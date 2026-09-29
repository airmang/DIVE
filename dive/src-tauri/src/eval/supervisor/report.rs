//! Report JSON (schema: `dive/eval/supervisor/README.md`, rendered by
//! `scripts/eval-report.mjs`). Field semantics live in `metrics.rs`.

use std::collections::BTreeMap;

use serde::{Deserialize, Serialize};

use super::Split;
use crate::dive::supervisor::{
    SupervisorDropReason, SupervisorEvent, SupervisorMode, SupervisorValidationOutcome,
};

pub const REPORT_SCHEMA_VERSION: u8 = 1;
pub const REPORT_KIND: &str = "supervisor-eval-report";

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum EvalMode {
    Recorded,
    Live,
}

impl EvalMode {
    pub fn as_str(self) -> &'static str {
        match self {
            Self::Recorded => "recorded",
            Self::Live => "live",
        }
    }
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct EvalReport {
    pub schema_version: u8,
    pub kind: String,
    pub mode: EvalMode,
    pub generated_at: String,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub note: Option<String>,
    pub fixture_count: usize,
    pub groups: Vec<ReportGroup>,
}

#[derive(Debug, Clone, PartialEq, Eq, PartialOrd, Ord, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct GroupKey {
    // Field order is the group sort order: split first, then versions.
    pub split: Split,
    pub prompt_version: String,
    pub policy_version: String,
    pub model: String,
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct ReportGroup {
    pub key: GroupKey,
    pub result_count: usize,
    pub outcomes: OutcomeCounts,
    pub drop_reasons: BTreeMap<String, usize>,
    pub provoke_agreement: ProvokeAgreement,
    pub drop_reason_match: DropReasonMatch,
    pub locale_compliance: LocaleCompliance,
    pub criterion_linkage: CriterionLinkage,
    pub evidence_precision: EvidencePrecision,
    pub question_length: QuestionLength,
    /// Secondary: every model call, retries included.
    pub attempts: AttemptStats,
    pub results: Vec<EvalResult>,
}

/// Per-call view of a group: the production retry loop can make several calls
/// per fixture; the primary metrics above only count each trial's final one.
#[derive(Debug, Clone, Default, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct AttemptStats {
    pub calls: usize,
    pub retries: usize,
    pub outcomes: OutcomeCounts,
    pub drop_reasons: BTreeMap<String, usize>,
}

#[derive(Debug, Clone, Default, PartialEq, Eq, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct OutcomeCounts {
    pub shown: usize,
    pub none: usize,
    pub dropped: usize,
    pub error: usize,
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct ProvokeAgreement {
    pub checked: usize,
    pub agree: usize,
    pub false_provoke: usize,
    pub missed_provoke: usize,
    pub rate: Option<f64>,
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct DropReasonMatch {
    pub checked: usize,
    pub matched: usize,
    pub rate: Option<f64>,
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct LocaleCompliance {
    pub checked: usize,
    pub compliant: usize,
    pub rate: Option<f64>,
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct CriterionLinkage {
    pub checked: usize,
    pub linked: usize,
    pub rate: Option<f64>,
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct EvidencePrecision {
    pub checked: usize,
    pub mean: Option<f64>,
    pub required_cited: usize,
    pub required_checked: usize,
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct QuestionLength {
    pub count: usize,
    pub min: Option<usize>,
    pub median: Option<f64>,
    pub max: Option<usize>,
    pub mean: Option<f64>,
    pub over_limit: usize,
}

/// One trial of a fixture: the final outcome of the production retry loop
/// (the call that ended it), with every call of the trial in `calls`.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct EvalResult {
    pub fixture_id: String,
    pub split: Split,
    pub event: SupervisorEvent,
    pub locale: String,
    pub mode: SupervisorMode,
    /// Identifies the trial: index of its first recording under the
    /// promptVersion (recorded mode); 0 in live mode.
    pub recording_index: usize,
    pub source: String,
    pub model: String,
    pub expected: ExpectedSummary,
    pub gate_passes: bool,
    pub prompt_sent: bool,
    pub outcome: SupervisorValidationOutcome,
    pub drop_reason: Option<SupervisorDropReason>,
    pub decision: Option<DecisionSummary>,
    pub checks: Checks,
    /// Every model call of the trial in order; empty when no call was made
    /// (gate closed, or the prompt could not be built).
    pub calls: Vec<CallOutcome>,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct CallOutcome {
    pub outcome: SupervisorValidationOutcome,
    pub drop_reason: Option<SupervisorDropReason>,
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct ExpectedSummary {
    pub should_provoke: bool,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub expected_drop_reason: Option<SupervisorDropReason>,
}

/// The parsed `SupervisorDecision` fields the metrics read.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct DecisionSummary {
    pub concern: String,
    pub question: String,
    pub evidence_ref_ids: Vec<String>,
    pub suggested_action_ids: Vec<String>,
}

#[derive(Debug, Clone, Default, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct Checks {
    pub provoke_agreement: Option<bool>,
    pub drop_reason_match: Option<bool>,
    pub locale_compliant: Option<bool>,
    pub criterion_linked: Option<bool>,
    pub evidence_precision: Option<f64>,
    pub required_evidence_cited: Option<bool>,
    pub question_chars: Option<usize>,
}
