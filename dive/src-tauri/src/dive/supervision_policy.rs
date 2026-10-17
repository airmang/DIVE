//! Versioned deterministic supervision policy (spec 015 FR-002).
//!
//! Every tunable trigger threshold for review cards lives in one JSON file,
//! `dive/src/features/provocation/supervision-policy.json`, read by the
//! frontend (which computes the assessments) and embedded here for the Rust
//! provoke gate. Values change only between releases, each with a new
//! `policyVersion` that is logged with every supervisor evaluation (D-015-01).
//! Output-contract limits (question length, evidence/action caps, prompt byte
//! cap) are schema, not policy, and stay constants in `supervisor/mod.rs`.

use std::sync::OnceLock;

use serde::Deserialize;

/// Path of the policy file relative to this source file. The frontend imports
/// the same file; `supervision_policy_parity.test.ts` and the Rust parity test
/// below both check that the two sides resolve to one file.
pub const SUPERVISION_POLICY_SOURCE: &str =
    include_str!("../../../src/features/provocation/supervision-policy.json");

#[derive(Debug, Clone, PartialEq, Eq, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct SupervisionPolicy {
    pub policy_version: String,
    /// RetryLoop: minimum repeated failures of one fingerprint before the
    /// supervisor may provoke.
    pub retry_loop_min_failures: usize,
    /// PlanDrafted: a step expecting at least this many files is "broad".
    pub broad_step_min_expected_files: u32,
    /// ScopeExpansion: debounce before an add-step draft is evaluated.
    pub scope_supervisor_debounce_ms: u32,
    /// Evidence summaries: default text truncation length.
    pub evidence_text_max_chars: u32,
    /// Evidence summaries: default list truncation length.
    pub evidence_list_max_items: u32,
    /// PlanDrafted: maximum evidence refs sent to the supervisor.
    pub plan_draft_evidence_ref_cap: u32,
    /// AI self-report detection: how many recent assistant reports are read.
    pub recent_assistant_report_count: u32,
}

pub fn supervision_policy() -> &'static SupervisionPolicy {
    static POLICY: OnceLock<SupervisionPolicy> = OnceLock::new();
    POLICY.get_or_init(|| {
        serde_json::from_str(SUPERVISION_POLICY_SOURCE)
            .expect("supervision-policy.json matches SupervisionPolicy")
    })
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn embedded_policy_parses_with_current_values() {
        let policy = supervision_policy();
        assert_eq!(policy.policy_version, "1.0.0");
        // Behavior-preserving move (S-076): these equal the constants they
        // replaced in decision.rs, adapters.ts, and PlanAddStepPanel.tsx.
        assert_eq!(policy.retry_loop_min_failures, 2);
        assert_eq!(policy.broad_step_min_expected_files, 4);
        assert_eq!(policy.scope_supervisor_debounce_ms, 650);
        assert_eq!(policy.evidence_text_max_chars, 160);
        assert_eq!(policy.evidence_list_max_items, 6);
        assert_eq!(policy.plan_draft_evidence_ref_cap, 16);
        assert_eq!(policy.recent_assistant_report_count, 3);
    }

    #[test]
    fn policy_version_is_semver() {
        let parts = supervision_policy()
            .policy_version
            .split('.')
            .collect::<Vec<_>>();
        assert_eq!(parts.len(), 3);
        assert!(parts.iter().all(|part| part.parse::<u32>().is_ok()));
    }

    #[test]
    fn unknown_policy_keys_are_rejected() {
        let mut value: serde_json::Value = serde_json::from_str(SUPERVISION_POLICY_SOURCE).unwrap();
        value["untypedThreshold"] = serde_json::json!(1);
        assert!(serde_json::from_value::<SupervisionPolicy>(value).is_err());
    }

    #[test]
    fn embedded_policy_is_the_file_the_frontend_imports() {
        let manifest_dir = std::path::Path::new(env!("CARGO_MANIFEST_DIR"));
        let policy_path = manifest_dir.join("../src/features/provocation/supervision-policy.json");
        let on_disk = std::fs::read_to_string(&policy_path).unwrap();
        assert_eq!(on_disk, SUPERVISION_POLICY_SOURCE);

        let frontend_module =
            std::fs::read_to_string(manifest_dir.join("../src/features/provocation/policy.ts"))
                .unwrap();
        assert!(
            frontend_module.contains("from \"./supervision-policy.json\""),
            "the frontend policy module must import the same supervision-policy.json"
        );
    }
}
