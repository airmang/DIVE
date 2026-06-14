use serde::{Deserialize, Serialize};

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum ApprovalOutcome {
    Approved,
    ApprovedWithConcern,
    RevisionRequested,
    VerificationDeferred,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub struct ApprovalJudgment {
    pub outcome: ApprovalOutcome,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub note: Option<String>,
    pub decided_at: i64,
}

impl ApprovalJudgment {
    /// Note is required for risk-accepted approval or revision requests.
    pub fn validate(&self) -> Result<(), String> {
        if !matches!(
            self.outcome,
            ApprovalOutcome::Approved | ApprovalOutcome::VerificationDeferred
        ) {
            let ok = self
                .note
                .as_ref()
                .map(|s| !s.trim().is_empty())
                .unwrap_or(false);
            if !ok {
                return Err("note required when outcome is not 'approved'".into());
            }
        }
        Ok(())
    }

    pub fn to_json_string(&self) -> String {
        serde_json::to_string(self).expect("ApprovalJudgment -> JSON")
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn approved_needs_no_note() {
        let j = ApprovalJudgment {
            outcome: ApprovalOutcome::Approved,
            note: None,
            decided_at: 1,
        };
        assert!(j.validate().is_ok());
    }

    #[test]
    fn concern_requires_nonempty_note() {
        let bad = ApprovalJudgment {
            outcome: ApprovalOutcome::ApprovedWithConcern,
            note: Some("  ".into()),
            decided_at: 1,
        };
        assert!(bad.validate().is_err());
        let ok = ApprovalJudgment {
            outcome: ApprovalOutcome::ApprovedWithConcern,
            note: Some("불안한 지점".into()),
            decided_at: 1,
        };
        assert!(ok.validate().is_ok());
    }

    #[test]
    fn revision_requires_note() {
        let bad = ApprovalJudgment {
            outcome: ApprovalOutcome::RevisionRequested,
            note: None,
            decided_at: 1,
        };
        assert!(bad.validate().is_err());
    }

    #[test]
    fn verification_deferred_needs_no_note() {
        let j = ApprovalJudgment {
            outcome: ApprovalOutcome::VerificationDeferred,
            note: None,
            decided_at: 1,
        };
        assert!(j.validate().is_ok());
    }
}
