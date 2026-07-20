use crate::db::dao::{json_to_string, optional_json_to_string, parse_json, parse_optional_json};
use crate::db::models::{NewToolCall, ToolCallRow};
use crate::db::{now_ms, DbError};
use rusqlite::{params, Connection, OptionalExtension};
fn map_row(row: &rusqlite::Row<'_>) -> Result<ToolCallRow, DbError> {
    Ok(ToolCallRow {
        id: row.get(0)?,
        message_id: row.get(1)?,
        name: row.get(2)?,
        input: parse_json(row.get(3)?)?,
        output: parse_optional_json(row.get(4)?)?,
        approved: row.get(5)?,
        risk_level: row.get(6)?,
        created_at: row.get(7)?,
    })
}
fn query_map_row(row: &rusqlite::Row<'_>) -> rusqlite::Result<ToolCallRow> {
    map_row(row).map_err(|e| {
        rusqlite::Error::FromSqlConversionFailure(3, rusqlite::types::Type::Text, Box::new(e))
    })
}
pub fn insert(conn: &Connection, row: &NewToolCall) -> Result<i64, DbError> {
    let input = json_to_string(&row.input)?;
    let output = optional_json_to_string(row.output.as_ref())?;
    conn.execute("INSERT INTO ToolCall(message_id, name, input, output, approved, risk_level, created_at) VALUES (?, ?, ?, ?, ?, ?, ?)",params![row.message_id,row.name,input,output,row.approved,row.risk_level,now_ms()])?;
    Ok(conn.last_insert_rowid())
}
pub fn get_by_id(conn: &Connection, id: i64) -> Result<Option<ToolCallRow>, DbError> {
    Ok(conn.query_row("SELECT id, message_id, name, input, output, approved, risk_level, created_at FROM ToolCall WHERE id = ?",[id],query_map_row).optional()?)
}
pub fn list(conn: &Connection) -> Result<Vec<ToolCallRow>, DbError> {
    let mut stmt=conn.prepare("SELECT id, message_id, name, input, output, approved, risk_level, created_at FROM ToolCall ORDER BY id")?;
    let rows = stmt
        .query_map([], query_map_row)?
        .collect::<Result<Vec<_>, _>>()?;
    Ok(rows)
}
pub fn list_by_message(conn: &Connection, message_id: i64) -> Result<Vec<ToolCallRow>, DbError> {
    let mut stmt=conn.prepare("SELECT id, message_id, name, input, output, approved, risk_level, created_at FROM ToolCall WHERE message_id = ? ORDER BY id")?;
    let rows = stmt
        .query_map([message_id], query_map_row)?
        .collect::<Result<Vec<_>, _>>()?;
    Ok(rows)
}
/// Count tool calls attributable to a card in a single query (S-069 G1),
/// replacing the former full-`Message`-scan + per-message `list_by_message`
/// N+1. Per-message semantics are preserved exactly: structured `ToolCall`
/// rows win when present, otherwise the `Message.tool_calls` JSON array length
/// is used (0 when the column is NULL or holds a non-array JSON value).
pub fn count_by_card(conn: &Connection, card_id: i64) -> Result<i64, DbError> {
    let count: i64 = conn.query_row(
        "SELECT COALESCE(SUM(
            CASE WHEN tc_count > 0 THEN tc_count
                 ELSE COALESCE(json_array_length(tool_calls), 0) END
         ), 0)
         FROM (
            SELECT m.tool_calls AS tool_calls,
                   (SELECT COUNT(*) FROM ToolCall tc WHERE tc.message_id = m.id) AS tc_count
            FROM Message m
            WHERE m.card_id = ?
         )",
        [card_id],
        |row| row.get(0),
    )?;
    Ok(count)
}
/// Per-card tool-call counts for a whole session in one query (S-069 P4-1),
/// replacing the per-card `count_by_card` fan-out that `card_tool_call_stats`
/// drove — one IPC round-trip per card on every workmap refresh. Same
/// per-message semantics as [`count_by_card`]; only cards with at least one
/// message appear, so callers must default an absent card to 0 (identical to a
/// per-card count of 0).
pub fn counts_by_session(conn: &Connection, session_id: i64) -> Result<Vec<(i64, i64)>, DbError> {
    let mut stmt = conn.prepare(
        "SELECT card_id, COALESCE(SUM(
            CASE WHEN tc_count > 0 THEN tc_count
                 ELSE COALESCE(json_array_length(tool_calls), 0) END
         ), 0) AS n
         FROM (
            SELECT m.card_id AS card_id,
                   m.tool_calls AS tool_calls,
                   (SELECT COUNT(*) FROM ToolCall tc WHERE tc.message_id = m.id) AS tc_count
            FROM Message m
            WHERE m.session_id = ? AND m.card_id IS NOT NULL
         )
         GROUP BY card_id",
    )?;
    let rows = stmt
        .query_map([session_id], |row| Ok((row.get(0)?, row.get(1)?)))?
        .collect::<Result<Vec<(i64, i64)>, _>>()?;
    Ok(rows)
}
pub fn update(conn: &Connection, id: i64, row: &NewToolCall) -> Result<(), DbError> {
    let input = json_to_string(&row.input)?;
    let output = optional_json_to_string(row.output.as_ref())?;
    conn.execute("UPDATE ToolCall SET message_id = ?, name = ?, input = ?, output = ?, approved = ?, risk_level = ? WHERE id = ?",params![row.message_id,row.name,input,output,row.approved,row.risk_level,id])?;
    Ok(())
}
pub fn delete(conn: &Connection, id: i64) -> Result<(), DbError> {
    conn.execute("DELETE FROM ToolCall WHERE id = ?", [id])?;
    Ok(())
}
#[cfg(test)]
mod tests {
    use super::*;
    use crate::db::dao::message;
    use crate::db::models::NewMessage;
    use crate::db::tests::{fresh_db, seed_project_session};
    use serde_json::json;
    fn tc(mid: i64, n: &str) -> NewToolCall {
        NewToolCall {
            message_id: mid,
            name: n.into(),
            input: json!({"p":"x"}),
            output: Some(json!({"ok":true})),
            approved: Some(true),
            risk_level: "safe".into(),
        }
    }
    #[test]
    fn crud_roundtrip_and_list_by_message() {
        let (db, _) = fresh_db();
        let (_, sid) = seed_project_session(db.conn());
        let mid = message::insert(
            db.conn(),
            &NewMessage {
                session_id: sid,
                card_id: None,
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
        let id = insert(db.conn(), &tc(mid, "read")).unwrap();
        assert_eq!(
            get_by_id(db.conn(), id).unwrap().unwrap().input,
            json!({"p":"x"})
        );
        update(db.conn(), id, &tc(mid, "search")).unwrap();
        assert_eq!(list_by_message(db.conn(), mid).unwrap()[0].name, "search");
        assert_eq!(list(db.conn()).unwrap().len(), 1);
        delete(db.conn(), id).unwrap();
        assert!(get_by_id(db.conn(), id).unwrap().is_none());
    }
    #[test]
    fn invalid_risk_level_fails_check() {
        let (db, _) = fresh_db();
        let (_, sid) = seed_project_session(db.conn());
        let mid = message::insert(
            db.conn(),
            &NewMessage {
                session_id: sid,
                card_id: None,
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
        let mut row = tc(mid, "bash");
        row.risk_level = "extreme".into();
        assert!(insert(db.conn(), &row).is_err());
    }
}
