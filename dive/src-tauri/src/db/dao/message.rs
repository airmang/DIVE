use crate::db::dao::{optional_json_to_string, parse_optional_json};
use crate::db::models::{MessageRow, NewMessage};
use crate::db::{now_ms, DbError};
use rusqlite::{params, Connection, OptionalExtension};
fn map_row(row: &rusqlite::Row<'_>) -> Result<MessageRow, DbError> {
    Ok(MessageRow {
        id: row.get(0)?,
        session_id: row.get(1)?,
        card_id: row.get(2)?,
        role: row.get(3)?,
        content: row.get(4)?,
        reasoning_content: row.get(5)?,
        tool_calls: parse_optional_json(row.get(6)?)?,
        usage: parse_optional_json(row.get(7)?)?,
        provider: row.get(8)?,
        model: row.get(9)?,
        created_at: row.get(10)?,
    })
}
fn query_map_row(row: &rusqlite::Row<'_>) -> rusqlite::Result<MessageRow> {
    map_row(row).map_err(|e| {
        rusqlite::Error::FromSqlConversionFailure(6, rusqlite::types::Type::Text, Box::new(e))
    })
}
pub fn insert(conn: &Connection, row: &NewMessage) -> Result<i64, DbError> {
    let tool_calls = optional_json_to_string(row.tool_calls.as_ref())?;
    let usage = optional_json_to_string(row.usage.as_ref())?;
    conn.execute("INSERT INTO Message(session_id, card_id, role, content, reasoning_content, tool_calls, usage, provider, model, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)",params![row.session_id,row.card_id,row.role,row.content,row.reasoning_content.as_deref(),tool_calls,usage,row.provider,row.model,now_ms()])?;
    Ok(conn.last_insert_rowid())
}
pub fn get_by_id(conn: &Connection, id: i64) -> Result<Option<MessageRow>, DbError> {
    Ok(conn.query_row("SELECT id, session_id, card_id, role, content, reasoning_content, tool_calls, usage, provider, model, created_at FROM Message WHERE id = ?",[id],query_map_row).optional()?)
}
pub fn list(conn: &Connection) -> Result<Vec<MessageRow>, DbError> {
    let mut stmt=conn.prepare("SELECT id, session_id, card_id, role, content, reasoning_content, tool_calls, usage, provider, model, created_at FROM Message ORDER BY id")?;
    let rows = stmt
        .query_map([], query_map_row)?
        .collect::<Result<Vec<_>, _>>()?;
    Ok(rows)
}
pub fn list_by_session(
    conn: &Connection,
    session_id: i64,
    limit: i64,
) -> Result<Vec<MessageRow>, DbError> {
    // S-064 E1: keep the *newest* `limit` messages, then hand them back in
    // chronological order. The naive `ORDER BY created_at, id LIMIT ?` kept the
    // oldest N instead — on a session past the cap it dropped the most recent
    // turns (including the user input just inserted) from the LLM history. The
    // inner query selects the newest N (DESC), the outer re-sorts ascending so
    // every consumer still sees oldest→newest.
    let mut stmt=conn.prepare("SELECT id, session_id, card_id, role, content, reasoning_content, tool_calls, usage, provider, model, created_at FROM (SELECT id, session_id, card_id, role, content, reasoning_content, tool_calls, usage, provider, model, created_at FROM Message WHERE session_id = ? ORDER BY created_at DESC, id DESC LIMIT ?) ORDER BY created_at, id")?;
    let rows = stmt
        .query_map(params![session_id, limit], query_map_row)?
        .collect::<Result<Vec<_>, _>>()?;
    Ok(rows)
}
pub fn update(conn: &Connection, id: i64, row: &NewMessage) -> Result<(), DbError> {
    let tool_calls = optional_json_to_string(row.tool_calls.as_ref())?;
    let usage = optional_json_to_string(row.usage.as_ref())?;
    conn.execute("UPDATE Message SET session_id = ?, card_id = ?, role = ?, content = ?, reasoning_content = ?, tool_calls = ?, usage = ?, provider = ?, model = ? WHERE id = ?",params![row.session_id,row.card_id,row.role,row.content,row.reasoning_content.as_deref(),tool_calls,usage,row.provider,row.model,id])?;
    Ok(())
}
pub fn delete(conn: &Connection, id: i64) -> Result<(), DbError> {
    conn.execute("DELETE FROM Message WHERE id = ?", [id])?;
    Ok(())
}
#[cfg(test)]
mod tests {
    use super::*;
    use crate::db::tests::{fresh_db, seed_project_session};
    use serde_json::json;
    fn msg(sid: i64, c: &str) -> NewMessage {
        NewMessage {
            session_id: sid,
            card_id: None,
            role: "assistant".into(),
            content: c.into(),
            reasoning_content: Some("reasoning".into()),
            tool_calls: Some(json!([{ "name":"read" }])),
            usage: Some(json!({"tokens":3})),
            provider: Some("openai".into()),
            model: Some("gpt".into()),
        }
    }
    #[test]
    fn crud_roundtrip_json_and_list_by_session() {
        let (db, _) = fresh_db();
        let (_, sid) = seed_project_session(db.conn());
        let id = insert(db.conn(), &msg(sid, "a")).unwrap();
        insert(db.conn(), &msg(sid, "b")).unwrap();
        assert_eq!(
            get_by_id(db.conn(), id)
                .unwrap()
                .unwrap()
                .tool_calls
                .unwrap(),
            json!([{ "name":"read" }])
        );
        update(db.conn(), id, &msg(sid, "c")).unwrap();
        assert_eq!(list_by_session(db.conn(), sid, 10).unwrap().len(), 2);
        assert_eq!(list(db.conn()).unwrap().len(), 2);
        delete(db.conn(), id).unwrap();
        assert!(get_by_id(db.conn(), id).unwrap().is_none());
    }
    #[test]
    fn list_by_session_honors_limit() {
        let (db, _) = fresh_db();
        let (_, sid) = seed_project_session(db.conn());
        insert(db.conn(), &msg(sid, "a")).unwrap();
        insert(db.conn(), &msg(sid, "b")).unwrap();
        // The single kept row must be the newest ("b"), not the oldest.
        let rows = list_by_session(db.conn(), sid, 1).unwrap();
        assert_eq!(rows.len(), 1);
        assert_eq!(rows[0].content, "b");
    }

    // S-064 E1: on a session past the cap, list_by_session must keep the newest
    // N and drop the oldest — the previous ASC+LIMIT kept the oldest N and lost
    // the most recent turns (including the just-inserted user input).
    #[test]
    fn list_by_session_keeps_newest_when_over_limit() {
        let (db, _) = fresh_db();
        let (_, sid) = seed_project_session(db.conn());
        for i in 0..201 {
            insert(db.conn(), &msg(sid, &format!("m{i:03}"))).unwrap();
        }
        let rows = list_by_session(db.conn(), sid, 200).unwrap();
        assert_eq!(rows.len(), 200);
        // Oldest message dropped, newest message kept.
        assert_eq!(rows.first().unwrap().content, "m001");
        assert_eq!(rows.last().unwrap().content, "m200");
        // Still returned oldest→newest (ascending by id/created_at).
        let ids: Vec<i64> = rows.iter().map(|r| r.id).collect();
        let mut sorted = ids.clone();
        sorted.sort_unstable();
        assert_eq!(ids, sorted);
    }
}
