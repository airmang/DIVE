use serde::{Deserialize, Serialize};
use thiserror::Error;

use crate::db::models::CardState;

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum CardTransition {
    EnterInstruct,
    RequestVerify,
    Approve,
    Reject,
    ReopenFromReject,
    Extend,
}

#[derive(Debug, Clone, PartialEq, Eq, Error, Serialize)]
pub enum TransitionError {
    #[error("invalid transition: cannot {transition:?} from {from:?}")]
    InvalidTransition {
        from: CardState,
        transition: CardTransition,
    },
}

pub fn apply(current: CardState, transition: CardTransition) -> Result<CardState, TransitionError> {
    use CardState::*;
    use CardTransition::*;

    let next = match (current, transition) {
        (Decomposed, EnterInstruct) => Instructed,
        (Instructed, EnterInstruct) => Instructed,
        (Instructed, RequestVerify) => Verifying,
        (Verifying, Approve) => Verified,
        (Verifying, Reject) => Rejected,
        (Rejected, Reject) => Rejected,
        (Rejected, ReopenFromReject) => Instructed,
        (Verified, Extend) => Extended,
        _ => {
            return Err(TransitionError::InvalidTransition {
                from: current,
                transition,
            })
        }
    };
    Ok(next)
}

#[cfg(test)]
mod tests {
    use super::*;
    use CardState::*;
    use CardTransition::*;

    #[test]
    fn decomposed_enters_instructed() {
        assert_eq!(apply(Decomposed, EnterInstruct).unwrap(), Instructed);
    }

    #[test]
    fn instructed_requests_verify() {
        assert_eq!(apply(Instructed, RequestVerify).unwrap(), Verifying);
    }

    #[test]
    fn instructed_reenter_is_idempotent() {
        assert_eq!(apply(Instructed, EnterInstruct).unwrap(), Instructed);
    }

    #[test]
    fn verifying_approve_to_verified() {
        assert_eq!(apply(Verifying, Approve).unwrap(), Verified);
    }

    #[test]
    fn verifying_reject_to_rejected() {
        assert_eq!(apply(Verifying, Reject).unwrap(), Rejected);
    }

    #[test]
    fn rejected_reopens_to_instructed() {
        assert_eq!(apply(Rejected, ReopenFromReject).unwrap(), Instructed);
    }

    #[test]
    fn rejected_reject_is_idempotent() {
        assert_eq!(apply(Rejected, Reject).unwrap(), Rejected);
    }

    #[test]
    fn verified_extends_to_extended() {
        assert_eq!(apply(Verified, Extend).unwrap(), Extended);
    }

    #[test]
    fn decomposed_cannot_skip_to_verified() {
        assert!(matches!(
            apply(Decomposed, Approve).unwrap_err(),
            TransitionError::InvalidTransition { .. }
        ));
    }

    #[test]
    fn verified_cannot_go_back_to_instructed() {
        assert!(matches!(
            apply(Verified, EnterInstruct).unwrap_err(),
            TransitionError::InvalidTransition { .. }
        ));
    }

    #[test]
    fn extended_is_terminal() {
        for t in [
            EnterInstruct,
            RequestVerify,
            Approve,
            Reject,
            ReopenFromReject,
            Extend,
        ] {
            assert!(apply(Extended, t).is_err(), "Extended should reject {t:?}");
        }
    }

    #[test]
    fn instructed_cannot_approve_without_verifying() {
        assert!(apply(Instructed, Approve).is_err());
    }

    #[test]
    fn decomposed_cannot_request_verify() {
        assert!(apply(Decomposed, RequestVerify).is_err());
    }
}
