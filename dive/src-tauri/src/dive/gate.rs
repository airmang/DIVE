use rusqlite::Connection;
use serde::Serialize;

use crate::db::dao::card;
use crate::db::DbError;

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize)]
#[serde(rename_all = "lowercase")]
pub enum DiveStage {
    D,
    I,
    V,
    E,
}

impl DiveStage {
    pub fn as_str(self) -> &'static str {
        match self {
            Self::D => "D",
            Self::I => "I",
            Self::V => "V",
            Self::E => "E",
        }
    }
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
#[serde(tag = "kind", rename_all = "snake_case")]
pub enum GateDecision {
    Allow,
    Block { stage: DiveStage, reason: String },
}

pub struct DiveGateEngine;

impl DiveGateEngine {
    /// D gate: refuse chat when the workmap has zero cards for the session.
    /// Spec §4.2 — the user must first decompose their request into cards.
    pub fn check_stage_d(conn: &Connection, session_id: i64) -> Result<GateDecision, DbError> {
        let cards = card::list_by_session(conn, session_id)?;
        if cards.is_empty() {
            Ok(GateDecision::Block {
                stage: DiveStage::D,
                reason: "먼저 작업을 카드로 분해해 워크맵에 추가하세요.".into(),
            })
        } else {
            Ok(GateDecision::Allow)
        }
    }

    pub fn check_stage_i(_conn: &Connection, _session_id: i64) -> Result<GateDecision, DbError> {
        Ok(GateDecision::Allow)
    }

    pub fn check_stage_v(_conn: &Connection, _session_id: i64) -> Result<GateDecision, DbError> {
        Ok(GateDecision::Allow)
    }

    pub fn check_stage_e(_conn: &Connection, _session_id: i64) -> Result<GateDecision, DbError> {
        Ok(GateDecision::Allow)
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::db::dao::card as card_dao;
    use crate::db::models::{CardState, NewCard};
    use crate::db::tests::{fresh_db, seed_project_session};

    #[test]
    fn d_blocks_when_no_cards() {
        let (db, _) = fresh_db();
        let (_, sid) = seed_project_session(db.conn());
        let decision = DiveGateEngine::check_stage_d(db.conn(), sid).unwrap();
        assert!(matches!(
            decision,
            GateDecision::Block {
                stage: DiveStage::D,
                ..
            }
        ));
    }

    #[test]
    fn d_allows_with_at_least_one_card() {
        let (db, _) = fresh_db();
        let (_, sid) = seed_project_session(db.conn());
        card_dao::insert(
            db.conn(),
            &NewCard {
                session_id: sid,
                title: "c1".into(),
                instruction: None,
                state: CardState::Decomposed,
                verify_log: None,
                changed_files: None,
                position: 1,
            },
        )
        .unwrap();
        assert_eq!(
            DiveGateEngine::check_stage_d(db.conn(), sid).unwrap(),
            GateDecision::Allow
        );
    }

    #[test]
    fn ive_placeholders_always_allow() {
        let (db, _) = fresh_db();
        let (_, sid) = seed_project_session(db.conn());
        assert_eq!(
            DiveGateEngine::check_stage_i(db.conn(), sid).unwrap(),
            GateDecision::Allow
        );
        assert_eq!(
            DiveGateEngine::check_stage_v(db.conn(), sid).unwrap(),
            GateDecision::Allow
        );
        assert_eq!(
            DiveGateEngine::check_stage_e(db.conn(), sid).unwrap(),
            GateDecision::Allow
        );
    }
}
