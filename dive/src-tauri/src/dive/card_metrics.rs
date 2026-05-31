use rusqlite::Connection;

use crate::db::dao::{message, tool_call};
use crate::db::DbError;

/// Count tool calls whose backing message belongs to the given card.
/// Runtime message persistence stores OpenAI/Anthropic tool calls in
/// `Message.tool_calls`; older/structured paths may also populate `ToolCall`.
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
    use crate::db::models::{CardState, NewCard, NewMessage, NewToolCall};
    use crate::db::tests::{fresh_db, seed_project_session};
    use serde_json::json;

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
                reasoning_content: None,
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
                reasoning_content: None,
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
