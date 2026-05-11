use rusqlite::Connection;
use serde::Serialize;

use crate::db::dao::{card, message, tool_call, workmap};
use crate::db::models::CardState;
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

    pub fn parse(value: &str) -> Option<Self> {
        match value {
            "D" | "d" => Some(Self::D),
            "I" | "i" => Some(Self::I),
            "V" | "v" => Some(Self::V),
            "E" | "e" => Some(Self::E),
            _ => None,
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
    pub fn check_stage_d(
        conn: &Connection,
        session_id: i64,
        plan_accepted: bool,
    ) -> Result<GateDecision, DbError> {
        if !plan_accepted {
            return Ok(GateDecision::Allow);
        }
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

    /// I gate — spec §4.3: the session must have a `current_card_id` whose
    /// card carries a non-empty `instruction`. Without that, the agent
    /// cannot know what the user is asking for in I stage.
    pub fn check_stage_i(conn: &Connection, session_id: i64) -> Result<GateDecision, DbError> {
        let Some(current_card) = current_card(conn, session_id)? else {
            return Ok(GateDecision::Block {
                stage: DiveStage::I,
                reason: "먼저 작업할 카드를 선택하세요.".into(),
            });
        };
        let has_instruction = current_card
            .instruction
            .as_ref()
            .map(|s| !s.trim().is_empty())
            .unwrap_or(false);
        if !has_instruction {
            return Ok(GateDecision::Block {
                stage: DiveStage::I,
                reason: "카드에 지시를 작성한 뒤 대화를 시작하세요.".into(),
            });
        }
        Ok(GateDecision::Allow)
    }

    /// V gate — spec §4.4: verification chat only makes sense when the
    /// current card is already in `Verifying`. Earlier states have nothing
    /// to verify; later states are already past V.
    pub fn check_stage_v(conn: &Connection, session_id: i64) -> Result<GateDecision, DbError> {
        let Some(current_card) = current_card(conn, session_id)? else {
            return Ok(GateDecision::Block {
                stage: DiveStage::V,
                reason: "검증할 카드가 선택되지 않았습니다.".into(),
            });
        };
        if current_card.state != CardState::Verifying {
            return Ok(GateDecision::Block {
                stage: DiveStage::V,
                reason: "검증을 시작한 카드만 V 단계 대화가 가능합니다.".into(),
            });
        }
        Ok(GateDecision::Allow)
    }

    /// E gate — spec §4.5: all cards in the session must be Verified or
    /// Extended before the user can enter E (integration/extension).
    pub fn check_stage_e(conn: &Connection, session_id: i64) -> Result<GateDecision, DbError> {
        let cards = card::list_by_session(conn, session_id)?;
        if cards.is_empty() {
            return Ok(GateDecision::Block {
                stage: DiveStage::E,
                reason: "확장할 카드가 없습니다.".into(),
            });
        }
        let all_done = cards
            .iter()
            .all(|c| matches!(c.state, CardState::Verified | CardState::Extended));
        if !all_done {
            return Ok(GateDecision::Block {
                stage: DiveStage::E,
                reason: "모든 카드가 검증(Verified) 상태가 되어야 E 단계에 진입할 수 있습니다."
                    .into(),
            });
        }
        Ok(GateDecision::Allow)
    }

    pub fn check(
        conn: &Connection,
        session_id: i64,
        stage: DiveStage,
        plan_accepted: bool,
    ) -> Result<GateDecision, DbError> {
        if gates_disabled_for_research() {
            return Ok(GateDecision::Allow);
        }
        match stage {
            DiveStage::D => Self::check_stage_d(conn, session_id, plan_accepted),
            DiveStage::I => Self::check_stage_i(conn, session_id),
            DiveStage::V => Self::check_stage_v(conn, session_id),
            DiveStage::E => Self::check_stage_e(conn, session_id),
        }
    }
}

pub fn gates_disabled_for_research() -> bool {
    #[cfg(feature = "dev-mock")]
    {
        std::env::var("DIVE_RESEARCH_ABLATION_GATES")
            .map(|value| matches!(value.as_str(), "1" | "true" | "TRUE" | "on" | "ON"))
            .unwrap_or(false)
    }

    #[cfg(not(feature = "dev-mock"))]
    {
        false
    }
}

fn current_card(
    conn: &Connection,
    session_id: i64,
) -> Result<Option<crate::db::models::CardRow>, DbError> {
    let Some(wm) = workmap::get(conn, session_id)? else {
        return Ok(None);
    };
    let Some(cid) = wm.current_card_id else {
        return Ok(None);
    };
    card::get_by_id(conn, cid)
}

/// Count tool calls whose backing message belongs to the given card.
/// Runtime message persistence stores OpenAI/Anthropic tool calls in
/// `Message.tool_calls`; older/structured paths may also populate `ToolCall`.
/// Spec §4.3: I→V transition requires at least one tool call on the card.
pub fn card_tool_call_count(conn: &Connection, card_id: i64) -> Result<i64, DbError> {
    let msgs = message::list(conn)?;
    let mut count = 0_i64;
    for m in msgs.iter().filter(|m| m.card_id == Some(card_id)) {
        let structured_count = tool_call::list_by_message(conn, m.id)?.len() as i64;
        if structured_count > 0 {
            count += structured_count;
            continue;
        }
        count += m
            .tool_calls
            .as_ref()
            .and_then(|calls| calls.as_array())
            .map(|calls| calls.len() as i64)
            .unwrap_or(0);
    }
    Ok(count)
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::db::dao::card as card_dao;
    use crate::db::dao::message as msg_dao;
    use crate::db::dao::tool_call as tc_dao;
    use crate::db::dao::workmap as wm_dao;
    use crate::db::models::{CardState, NewCard, NewMessage, NewToolCall};
    use crate::db::tests::{fresh_db, seed_project_session};
    use serde_json::json;

    #[test]
    fn ablation_env_is_ignored_without_dev_mock_feature() {
        std::env::set_var("DIVE_RESEARCH_ABLATION_GATES", "1");
        let disabled = gates_disabled_for_research();
        std::env::remove_var("DIVE_RESEARCH_ABLATION_GATES");

        #[cfg(feature = "dev-mock")]
        assert!(disabled);

        #[cfg(not(feature = "dev-mock"))]
        assert!(!disabled);
    }

    fn insert_card(conn: &rusqlite::Connection, sid: i64, state: CardState, pos: i64) -> i64 {
        card_dao::insert(
            conn,
            &NewCard {
                session_id: sid,
                title: format!("c{pos}"),
                instruction: None,
                assist_summary: None,
                acceptance_criteria: None,
                retrospective: None,
                change_summary: None,
                state,
                verify_log: None,
                changed_files: None,
                test_command: None,
                position: pos,
            },
        )
        .unwrap()
    }

    fn insert_card_with_instruction(
        conn: &rusqlite::Connection,
        sid: i64,
        state: CardState,
        instruction: Option<&str>,
        pos: i64,
    ) -> i64 {
        card_dao::insert(
            conn,
            &NewCard {
                session_id: sid,
                title: format!("c{pos}"),
                instruction: instruction.map(str::to_string),
                assist_summary: None,
                acceptance_criteria: None,
                retrospective: None,
                change_summary: None,
                state,
                verify_log: None,
                changed_files: None,
                test_command: None,
                position: pos,
            },
        )
        .unwrap()
    }

    #[test]
    fn d_blocks_when_no_cards_after_plan_accepted() {
        let (db, _) = fresh_db();
        let (_, sid) = seed_project_session(db.conn());
        let decision = DiveGateEngine::check_stage_d(db.conn(), sid, true).unwrap();
        assert!(matches!(
            decision,
            GateDecision::Block {
                stage: DiveStage::D,
                ..
            }
        ));
    }

    #[test]
    fn d_allows_when_plan_not_yet_accepted_even_with_no_cards() {
        let (db, _) = fresh_db();
        let (_, sid) = seed_project_session(db.conn());
        assert_eq!(
            DiveGateEngine::check_stage_d(db.conn(), sid, false).unwrap(),
            GateDecision::Allow
        );
    }

    #[test]
    fn d_allows_with_at_least_one_card() {
        let (db, _) = fresh_db();
        let (_, sid) = seed_project_session(db.conn());
        insert_card(db.conn(), sid, CardState::Decomposed, 1);
        assert_eq!(
            DiveGateEngine::check_stage_d(db.conn(), sid, true).unwrap(),
            GateDecision::Allow
        );
    }

    #[test]
    fn i_blocks_when_no_current_card() {
        let (db, _) = fresh_db();
        let (_, sid) = seed_project_session(db.conn());
        insert_card(db.conn(), sid, CardState::Decomposed, 1);
        assert!(matches!(
            DiveGateEngine::check_stage_i(db.conn(), sid).unwrap(),
            GateDecision::Block {
                stage: DiveStage::I,
                ..
            }
        ));
    }

    #[test]
    fn i_blocks_when_current_card_has_no_instruction() {
        let (db, _) = fresh_db();
        let (_, sid) = seed_project_session(db.conn());
        let cid = insert_card_with_instruction(db.conn(), sid, CardState::Instructed, None, 1);
        wm_dao::set_current_card(db.conn(), sid, Some(cid)).unwrap();
        assert!(matches!(
            DiveGateEngine::check_stage_i(db.conn(), sid).unwrap(),
            GateDecision::Block {
                stage: DiveStage::I,
                ..
            }
        ));
    }

    #[test]
    fn i_blocks_when_instruction_is_whitespace_only() {
        let (db, _) = fresh_db();
        let (_, sid) = seed_project_session(db.conn());
        let cid =
            insert_card_with_instruction(db.conn(), sid, CardState::Instructed, Some("   \n\t"), 1);
        wm_dao::set_current_card(db.conn(), sid, Some(cid)).unwrap();
        assert!(matches!(
            DiveGateEngine::check_stage_i(db.conn(), sid).unwrap(),
            GateDecision::Block {
                stage: DiveStage::I,
                ..
            }
        ));
    }

    #[test]
    fn i_allows_when_current_card_has_instruction() {
        let (db, _) = fresh_db();
        let (_, sid) = seed_project_session(db.conn());
        let cid = insert_card_with_instruction(
            db.conn(),
            sid,
            CardState::Instructed,
            Some("do the thing"),
            1,
        );
        wm_dao::set_current_card(db.conn(), sid, Some(cid)).unwrap();
        assert_eq!(
            DiveGateEngine::check_stage_i(db.conn(), sid).unwrap(),
            GateDecision::Allow
        );
    }

    #[test]
    fn v_blocks_when_current_card_is_not_verifying() {
        let (db, _) = fresh_db();
        let (_, sid) = seed_project_session(db.conn());
        let cid = insert_card_with_instruction(db.conn(), sid, CardState::Instructed, Some("x"), 1);
        wm_dao::set_current_card(db.conn(), sid, Some(cid)).unwrap();
        assert!(matches!(
            DiveGateEngine::check_stage_v(db.conn(), sid).unwrap(),
            GateDecision::Block {
                stage: DiveStage::V,
                ..
            }
        ));
    }

    #[test]
    fn v_blocks_when_no_current_card() {
        let (db, _) = fresh_db();
        let (_, sid) = seed_project_session(db.conn());
        insert_card(db.conn(), sid, CardState::Verifying, 1);
        assert!(matches!(
            DiveGateEngine::check_stage_v(db.conn(), sid).unwrap(),
            GateDecision::Block {
                stage: DiveStage::V,
                ..
            }
        ));
    }

    #[test]
    fn v_allows_when_current_card_is_verifying() {
        let (db, _) = fresh_db();
        let (_, sid) = seed_project_session(db.conn());
        let cid = insert_card(db.conn(), sid, CardState::Verifying, 1);
        wm_dao::set_current_card(db.conn(), sid, Some(cid)).unwrap();
        assert_eq!(
            DiveGateEngine::check_stage_v(db.conn(), sid).unwrap(),
            GateDecision::Allow
        );
    }

    #[test]
    fn e_blocks_when_some_cards_unverified() {
        let (db, _) = fresh_db();
        let (_, sid) = seed_project_session(db.conn());
        insert_card(db.conn(), sid, CardState::Verified, 1);
        insert_card(db.conn(), sid, CardState::Instructed, 2);
        assert!(matches!(
            DiveGateEngine::check_stage_e(db.conn(), sid).unwrap(),
            GateDecision::Block {
                stage: DiveStage::E,
                ..
            }
        ));
    }

    #[test]
    fn e_blocks_when_no_cards() {
        let (db, _) = fresh_db();
        let (_, sid) = seed_project_session(db.conn());
        assert!(matches!(
            DiveGateEngine::check_stage_e(db.conn(), sid).unwrap(),
            GateDecision::Block {
                stage: DiveStage::E,
                ..
            }
        ));
    }

    #[test]
    fn e_allows_when_all_cards_verified_or_extended() {
        let (db, _) = fresh_db();
        let (_, sid) = seed_project_session(db.conn());
        insert_card(db.conn(), sid, CardState::Verified, 1);
        insert_card(db.conn(), sid, CardState::Extended, 2);
        assert_eq!(
            DiveGateEngine::check_stage_e(db.conn(), sid).unwrap(),
            GateDecision::Allow
        );
    }

    #[test]
    fn check_dispatches_to_right_stage() {
        let (db, _) = fresh_db();
        let (_, sid) = seed_project_session(db.conn());
        let d = DiveGateEngine::check(db.conn(), sid, DiveStage::D, true).unwrap();
        assert!(matches!(
            d,
            GateDecision::Block {
                stage: DiveStage::D,
                ..
            }
        ));
    }

    #[test]
    fn tool_call_count_on_card_is_accurate() {
        let (db, _) = fresh_db();
        let (_, sid) = seed_project_session(db.conn());
        let cid = insert_card(db.conn(), sid, CardState::Instructed, 1);
        let mid = msg_dao::insert(
            db.conn(),
            &NewMessage {
                session_id: sid,
                card_id: Some(cid),
                role: "assistant".into(),
                content: "m".into(),
                tool_calls: None,
                usage: None,
                provider: None,
                model: None,
            },
        )
        .unwrap();
        tc_dao::insert(
            db.conn(),
            &NewToolCall {
                message_id: mid,
                name: "read_file".into(),
                input: json!({"path":"a"}),
                output: None,
                approved: Some(true),
                risk_level: "safe".into(),
            },
        )
        .unwrap();
        tc_dao::insert(
            db.conn(),
            &NewToolCall {
                message_id: mid,
                name: "read_file".into(),
                input: json!({"path":"b"}),
                output: None,
                approved: Some(true),
                risk_level: "safe".into(),
            },
        )
        .unwrap();
        assert_eq!(card_tool_call_count(db.conn(), cid).unwrap(), 2);
    }

    #[test]
    fn tool_call_count_uses_message_tool_calls_json_when_rows_absent() {
        let (db, _) = fresh_db();
        let (_, sid) = seed_project_session(db.conn());
        let cid = insert_card(db.conn(), sid, CardState::Instructed, 1);
        msg_dao::insert(
            db.conn(),
            &NewMessage {
                session_id: sid,
                card_id: Some(cid),
                role: "assistant".into(),
                content: "m".into(),
                tool_calls: Some(json!([
                    {"id":"call_1","name":"read_file"},
                    {"id":"call_2","name":"edit_file"}
                ])),
                usage: None,
                provider: None,
                model: None,
            },
        )
        .unwrap();

        assert_eq!(card_tool_call_count(db.conn(), cid).unwrap(), 2);
    }
}
