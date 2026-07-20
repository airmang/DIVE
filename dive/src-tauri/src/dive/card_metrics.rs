use rusqlite::Connection;

use crate::db::dao::tool_call;
use crate::db::DbError;

/// Count tool calls whose backing message belongs to the given card.
/// Runtime message persistence stores OpenAI/Anthropic tool calls in
/// `Message.tool_calls`; older/structured paths may also populate `ToolCall`.
///
/// S-069 G1: this delegates to a single scoped SQL query
/// ([`tool_call::count_by_card`]) instead of loading the entire `Message`
/// table and re-querying `ToolCall` per matching message. Behavior is
/// preserved exactly — see the equivalence test below.
pub fn card_tool_call_count(conn: &Connection, card_id: i64) -> Result<i64, DbError> {
    tool_call::count_by_card(conn, card_id)
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::db::dao::card as card_dao;
    use crate::db::dao::message as msg_dao;
    use crate::db::dao::tool_call as tc_dao;
    use crate::db::models::{CardState, NewCard, NewMessage, NewToolCall};
    use crate::db::tests::{fresh_db, seed_project_session};
    use serde_json::{json, Value};

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
                approval_judgment: None,
                approval_provenance: None,
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

    /// Reference implementation of the pre-S-069 Rust-side scan, retained so
    /// the SQL replacement can be proven identical (S-069 G1 "동일 결과").
    fn reference_count(conn: &rusqlite::Connection, card_id: i64) -> i64 {
        let msgs = msg_dao::list(conn).unwrap();
        let mut count = 0_i64;
        for m in msgs.iter().filter(|m| m.card_id == Some(card_id)) {
            let structured = tc_dao::list_by_message(conn, m.id).unwrap().len() as i64;
            if structured > 0 {
                count += structured;
                continue;
            }
            count += m
                .tool_calls
                .as_ref()
                .and_then(|calls| calls.as_array())
                .map(|calls| calls.len() as i64)
                .unwrap_or(0);
        }
        count
    }

    fn insert_msg(
        conn: &rusqlite::Connection,
        sid: i64,
        cid: Option<i64>,
        tc: Option<Value>,
    ) -> i64 {
        msg_dao::insert(
            conn,
            &NewMessage {
                session_id: sid,
                card_id: cid,
                role: "assistant".into(),
                content: "m".into(),
                reasoning_content: None,
                tool_calls: tc,
                usage: None,
                provider: None,
                model: None,
            },
        )
        .unwrap()
    }

    fn insert_row(conn: &rusqlite::Connection, mid: i64) {
        tc_dao::insert(
            conn,
            &NewToolCall {
                message_id: mid,
                name: "read_file".into(),
                input: json!({ "path": "x" }),
                output: None,
                approved: Some(true),
                risk_level: "safe".into(),
            },
        )
        .unwrap();
    }

    // S-069 G1: the single-query count must match the former Rust-side scan
    // exactly across every message shape — structured rows winning over JSON,
    // JSON fallback, non-array JSON, JSON null, empty, and cross-card isolation.
    #[test]
    fn count_by_card_matches_reference_scan_across_message_shapes() {
        let (db, _) = fresh_db();
        let (_, sid) = seed_project_session(db.conn());
        let conn = db.conn();
        let a = insert_card(conn, sid, CardState::Instructed, 1);
        let b = insert_card(conn, sid, CardState::Instructed, 2);
        let empty = insert_card(conn, sid, CardState::Instructed, 3);

        // Card A: rows win over JSON (2 rows + 3-elem JSON → counts 2).
        let m1 = insert_msg(
            conn,
            sid,
            Some(a),
            Some(json!([{"n":"a"},{"n":"b"},{"n":"c"}])),
        );
        insert_row(conn, m1);
        insert_row(conn, m1);
        // Card A: JSON fallback (no rows, 2-elem JSON → counts 2).
        insert_msg(conn, sid, Some(a), Some(json!([{"n":"x"},{"n":"y"}])));
        // Card A: non-array JSON object → counts 0.
        insert_msg(conn, sid, Some(a), Some(json!({"not":"an array"})));
        // Card A: JSON null literal → counts 0.
        insert_msg(conn, sid, Some(a), Some(json!(null)));
        // Card A: NULL tool_calls, no rows → counts 0.
        insert_msg(conn, sid, Some(a), None);
        // Card A: NULL tool_calls but 3 structured rows → counts 3.
        let m6 = insert_msg(conn, sid, Some(a), None);
        insert_row(conn, m6);
        insert_row(conn, m6);
        insert_row(conn, m6);

        // Card B: isolated, single JSON entry → must not bleed into A.
        insert_msg(conn, sid, Some(b), Some(json!([{"n":"only"}])));
        // Unassigned message (card_id NULL) must be excluded entirely.
        let orphan = insert_msg(conn, sid, None, Some(json!([{"n":"o1"},{"n":"o2"}])));
        insert_row(conn, orphan);

        for card in [a, b, empty] {
            assert_eq!(
                card_tool_call_count(conn, card).unwrap(),
                reference_count(conn, card),
                "card {card} diverged from reference scan"
            );
        }
        // Concrete expectations, not just self-consistency with the reference.
        // Card A message contributions: 2 (rows) + 2 (json) + 0 (object) +
        // 0 (json null) + 0 (empty) + 3 (rows) = 7.
        assert_eq!(card_tool_call_count(conn, a).unwrap(), 7);
        assert_eq!(card_tool_call_count(conn, b).unwrap(), 1);
        assert_eq!(card_tool_call_count(conn, empty).unwrap(), 0);
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
